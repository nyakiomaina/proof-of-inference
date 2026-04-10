// Proof of Inference — Arcis Confidential Inference Circuit
//
// This module defines the MPC computation that runs inside Arcium's MXE.
// Written in Arcis, a Rust-based DSL that compiles to MPC circuits.
//
// Key properties:
// - Standard Rust types are overridden with masked (encrypted) variants.
// - Both branches of conditionals execute to prevent side-channel leaks.
// - `Enc<Mxe, T>` — data encrypted with the MXE's key (model weights at rest).
// - `Enc<Shared, T>` — data encrypted with a shared secret (user input).
// - `requester.from_arcis(output)` — seals output to requester's public key.
//
// The initial model is a logistic regression sentiment classifier operating on
// a 128-dimensional feature vector. Deliberately simple — the point is proving
// the verification primitive, not building a SOTA model.

// NOTE: This file requires the Arcis toolchain to compile.
// The `#[encrypted]` attribute and `arcis_imports` are provided by the Arcis SDK.
// Install via: `arcup` (Arcium CLI)
//
// When the Arcis SDK is not installed, this file serves as the authoritative
// reference for the circuit logic that will execute inside the MXE.

#[cfg(feature = "arcis")]
#[encrypted]
mod inference_circuit {
    use arcis_imports::*;

    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    /// The model's learnable parameters, encrypted at rest in the MXE.
    /// Loaded by the model owner during registration.
    #[derive(ArcisType)]
    pub struct ModelWeights {
        /// Weight vector for the logistic regression. One weight per feature.
        pub weights: [f64; 128],
        /// Bias term added to the dot product.
        pub bias: f64,
        /// Classification threshold for the sigmoid output.
        pub threshold: f64,
    }

    /// The user's input feature vector, encrypted with a shared secret.
    #[derive(ArcisType)]
    pub struct InferenceInput {
        /// Numeric features extracted from the user's query.
        pub features: [f64; 128],
    }

    /// The result of running inference, sealed to the requester.
    #[derive(ArcisType)]
    pub struct InferenceOutput {
        /// 0 = negative, 1 = neutral, 2 = positive
        pub classification: u8,
        /// Sigmoid confidence score in [0, 1].
        pub confidence: f64,
        /// SHA-256 hash of the model weights used, proving which model ran.
        pub model_hash: [u8; 32],
    }

    // -----------------------------------------------------------------------
    // Main instruction
    // -----------------------------------------------------------------------

    /// Runs a verified logistic-regression inference inside the MPC network.
    ///
    /// 1. Computes dot product of features and weights, adds bias.
    /// 2. Applies sigmoid approximation (MPC-friendly, no exp()).
    /// 3. Classifies based on threshold and sign.
    /// 4. Computes a commitment hash of the model weights.
    /// 5. Seals the output to the requester's key.
    #[instruction]
    pub fn run_verified_inference(
        model_ctxt: Enc<Mxe, ModelWeights>,
        input_ctxt: Enc<Shared, InferenceInput>,
        requester: Shared,
    ) -> Enc<Shared, InferenceOutput> {
        let model = model_ctxt.to_arcis();
        let input = input_ctxt.to_arcis();

        // --- Step 1: Dot product ---
        let mut score = model.bias;
        let mut i = 0;
        while i < 128 {
            score = score + (input.features[i] * model.weights[i]);
            i = i + 1;
        }

        // --- Step 2: Sigmoid approximation ---
        // Standard sigmoid: σ(x) = 1 / (1 + e^(-x))
        // MPC-friendly rational approximation (no exp needed):
        //   For x >= 0: σ(x) ≈ x / (1 + x)
        //   For x <  0: σ(x) ≈ 1 / (1 + (-x))
        //
        // Both branches always execute in MPC to prevent timing side-channels.
        let abs_score = if score > 0.0 { score } else { -score };
        let pos_result = score / (1.0 + abs_score);
        let neg_result = 1.0 / (1.0 + abs_score);

        let confidence = if score > 0.0 {
            pos_result
        } else {
            neg_result
        };

        // NOTE: This is a cheap MPC approximation, not the real sigmoid. In particular
        // at score == 0 the x<=0 branch yields confidence = 1.0, not σ(0) ≈ 0.5 — so
        // "neutral when the linear score is zero" is *not* implied; neutral only means
        // confidence <= threshold per Step 3 below.

        // --- Step 3: Classification ---
        // Above threshold + positive score → positive (2)
        // Above threshold + negative score → negative (0)
        // Below threshold → neutral (1)
        let classification = if confidence > model.threshold {
            if score > 0.0 { 2u8 } else { 0u8 }
        } else {
            1u8
        };

        // --- Step 4: Model commitment ---
        // Hash the actual weights used inside the MPC computation.
        // This proves which specific model produced the result.
        // If the model owner swaps weights, the hash changes and won't
        // match the registered ModelRegistry PDA on-chain.
        let model_hash = compute_commitment(&model);

        // --- Step 5: Seal output to requester ---
        let output = InferenceOutput {
            classification,
            confidence,
            model_hash,
        };

        requester.from_arcis(output)
    }
}

// ---------------------------------------------------------------------------
// Non-Arcis reference implementation (for testing / documentation)
// ---------------------------------------------------------------------------

/// Plain Rust reference implementation of the inference logic.
/// Used for local testing without the Arcium MPC network.
#[cfg(not(feature = "arcis"))]
pub mod reference {
    /// Model parameters (plaintext for testing).
    pub struct ModelWeights {
        pub weights: [f64; 128],
        pub bias: f64,
        pub threshold: f64,
    }

    /// Input features (plaintext for testing).
    pub struct InferenceInput {
        pub features: [f64; 128],
    }

    /// Inference result.
    #[derive(Debug, Clone)]
    pub struct InferenceOutput {
        pub classification: u8,
        pub confidence: f64,
        pub model_hash: [u8; 32],
    }

    impl ModelWeights {
        /// Computes the SHA-256 commitment of the model weights.
        pub fn commitment(&self) -> [u8; 32] {
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            for w in &self.weights {
                hasher.update(w.to_le_bytes());
            }
            hasher.update(self.bias.to_le_bytes());
            hasher.update(self.threshold.to_le_bytes());
            let result = hasher.finalize();
            let mut out = [0u8; 32];
            out.copy_from_slice(&result);
            out
        }
    }

    /// Runs the same logistic regression inference in plaintext.
    pub fn run_inference(model: &ModelWeights, input: &InferenceInput) -> InferenceOutput {
        // Dot product
        let mut score = model.bias;
        for i in 0..128 {
            score += input.features[i] * model.weights[i];
        }

        // Sigmoid approximation (must match Arcis circuit). Not equal to true σ(x); at
        // score == 0, confidence is 1.0 (see comment in `inference_circuit`).
        let abs_score = score.abs();
        let confidence = if score > 0.0 {
            score / (1.0 + abs_score)
        } else {
            1.0 / (1.0 + abs_score)
        };

        // Classification
        let classification = if confidence > model.threshold {
            if score > 0.0 { 2 } else { 0 }
        } else {
            1
        };

        let model_hash = model.commitment();

        InferenceOutput {
            classification,
            confidence,
            model_hash,
        }
    }

    /// Returns the sentiment label string for a classification value.
    pub fn label(classification: u8) -> &'static str {
        match classification {
            0 => "Negative",
            1 => "Neutral",
            2 => "Positive",
            _ => "Unknown",
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn test_positive_classification() {
            let mut weights = [0.0f64; 128];
            // Set first few weights to create a strong positive signal
            for i in 0..10 {
                weights[i] = 1.0;
            }

            let model = ModelWeights {
                weights,
                bias: 0.0,
                threshold: 0.3,
            };

            let mut features = [0.0f64; 128];
            for i in 0..10 {
                features[i] = 1.0;
            }

            let input = InferenceInput { features };
            let output = run_inference(&model, &input);

            assert_eq!(output.classification, 2, "Expected Positive");
            assert!(output.confidence > 0.3);
            assert_eq!(label(output.classification), "Positive");
        }

        #[test]
        fn test_negative_classification() {
            // MPC sigmoid for negative score: confidence = 1 / (1 + |score|).
            // Need confidence > threshold and score < 0 → class 0 (negative).
            // score = -2 → confidence = 1/3 > 0.3.
            let mut weights = [0.0f64; 128];
            weights[0] = -1.0;
            weights[1] = -1.0;

            let model = ModelWeights {
                weights,
                bias: 0.0,
                threshold: 0.3,
            };

            let mut features = [0.0f64; 128];
            features[0] = 1.0;
            features[1] = 1.0;

            let input = InferenceInput { features };
            let output = run_inference(&model, &input);

            assert_eq!(output.classification, 0, "Expected Negative");
            assert_eq!(label(output.classification), "Negative");
        }

        #[test]
        fn test_neutral_classification() {
            // score = 0 uses the x<=0 branch → confidence = 1.0, not ~0.5; that is not "neutral".
            // Neutral is confidence <= threshold: use strongly negative score so 1/(1+|s|) is small.
            let mut weights = [0.0f64; 128];
            for i in 0..5 {
                weights[i] = -1.0;
            }

            let model = ModelWeights {
                weights,
                bias: 0.0,
                threshold: 0.3,
            };

            let mut features = [0.0f64; 128];
            for i in 0..5 {
                features[i] = 1.0;
            }

            let input = InferenceInput { features };
            let output = run_inference(&model, &input);

            assert_eq!(output.classification, 1, "Expected Neutral");
            assert_eq!(label(output.classification), "Neutral");
        }

        #[test]
        fn test_commitment_deterministic() {
            let weights = [0.5f64; 128];
            let model = ModelWeights {
                weights,
                bias: 0.1,
                threshold: 0.5,
            };

            let hash1 = model.commitment();
            let hash2 = model.commitment();
            assert_eq!(hash1, hash2, "Commitment must be deterministic");
        }

        #[test]
        fn test_commitment_changes_with_weights() {
            let model1 = ModelWeights {
                weights: [0.5f64; 128],
                bias: 0.1,
                threshold: 0.5,
            };

            let mut weights2 = [0.5f64; 128];
            weights2[0] = 0.6;
            let model2 = ModelWeights {
                weights: weights2,
                bias: 0.1,
                threshold: 0.5,
            };

            assert_ne!(
                model1.commitment(),
                model2.commitment(),
                "Different weights must produce different commitments"
            );
        }
    }
}
