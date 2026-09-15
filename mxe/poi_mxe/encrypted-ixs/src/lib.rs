use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    // -----------------------------------------------------------------------
    // Proof-of-Inference: minimal sentiment classifier
    //
    // 2 weights + bias + threshold, all u8. Score widened to u16.
    //
    // The circuit also re-derives the model's weight commitment *inside* MPC and
    // reveals it as a plaintext output. `proof_of_inference` compares that value
    // against the `weight_commitment` recorded at model registration and refuses
    // to finalize on a mismatch, so an attestation can only ever name the model
    // whose weights actually entered the computation. Without this the weights
    // are just caller-supplied arguments and the commitment is decorative.
    //
    // The salt keeps the commitment non-invertible: w0/w1/bias/threshold are one
    // byte each, so an unsalted hash is brute-forceable in 2^32.
    // -----------------------------------------------------------------------

    /// `b"poi-weights-v2"`. Domain-separates this preimage from the v1 scheme
    /// (unsalted SHA-256), which is not accepted any more.
    const DOMAIN: [u8; 14] = [
        112, 111, 105, 45, 119, 101, 105, 103, 104, 116, 115, 45, 118, 50,
    ];

    // 8 bytes, not 16: every secret byte costs its own 32-byte ciphertext in the
    // `run_inference_v2` instruction, and a legacy (non-LUT) transaction only has
    // room for ~16 of them. 6 inputs + 8 salt bytes = 14 ciphertexts ≈ 1146 bytes,
    // inside the 1232-byte cap. A 64-bit salt over 32 bits of weights still puts
    // the commitment preimage out of brute-force range.
    const SALT_LEN: usize = 8;
    const PREIMAGE_LEN: usize = 14 + 4 + SALT_LEN;

    pub struct InferenceInput {
        w0: u8,
        w1: u8,
        bias: u8,
        threshold: u8,
        f0: u8,
        f1: u8,
        /// Secret blinding factor for the weight commitment. Held off-chain
        /// alongside the weights; never revealed.
        salt: [u8; SALT_LEN],
    }

    pub struct InferenceOutput {
        /// 0 = below threshold, 1 = above threshold
        classification: u8,
        /// Raw linear score
        score: u16,
    }

    #[instruction]
    pub fn run_inference_v2(
        input_ctxt: Enc<Shared, InferenceInput>,
    ) -> (Enc<Shared, InferenceOutput>, [u8; 32]) {
        let inp = input_ctxt.to_arcis();

        let score = (inp.bias as u16)
            + (inp.f0 as u16) * (inp.w0 as u16)
            + (inp.f1 as u16) * (inp.w1 as u16);

        let classification = if score > (inp.threshold as u16) {
            1u8
        } else {
            0u8
        };

        // commitment = SHA3-256(DOMAIN || w0 || w1 || bias || threshold || salt)
        let mut preimage = [0u8; PREIMAGE_LEN];
        for i in 0..14 {
            preimage[i] = DOMAIN[i];
        }
        preimage[14] = inp.w0;
        preimage[15] = inp.w1;
        preimage[16] = inp.bias;
        preimage[17] = inp.threshold;
        for j in 0..SALT_LEN {
            preimage[18 + j] = inp.salt[j];
        }
        let commitment = SHA3_256::new().digest(&preimage);

        let output = InferenceOutput {
            classification,
            score,
        };

        (input_ctxt.owner.from_arcis(output), commitment.reveal())
    }
}
