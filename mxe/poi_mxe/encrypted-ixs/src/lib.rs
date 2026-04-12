use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    // -----------------------------------------------------------------------
    // Proof-of-Inference: minimal sentiment classifier
    //
    // 2 weights + bias + threshold, all u8. Score widened to u16.
    // Minimal circuit size for devnet deployment while still demonstrating
    // real encrypted MPC inference.
    // -----------------------------------------------------------------------

    pub struct InferenceInput {
        w0: u8,
        w1: u8,
        bias: u8,
        threshold: u8,
        f0: u8,
        f1: u8,
    }

    pub struct InferenceOutput {
        /// 0 = below threshold, 1 = above threshold
        classification: u8,
        /// Raw linear score
        score: u16,
    }

    #[instruction]
    pub fn run_inference(
        input_ctxt: Enc<Shared, InferenceInput>,
    ) -> Enc<Shared, InferenceOutput> {
        let inp = input_ctxt.to_arcis();

        let score = (inp.bias as u16)
            + (inp.f0 as u16) * (inp.w0 as u16)
            + (inp.f1 as u16) * (inp.w1 as u16);

        let classification = if score > (inp.threshold as u16) {
            1u8
        } else {
            0u8
        };

        let output = InferenceOutput {
            classification,
            score,
        };

        input_ctxt.owner.from_arcis(output)
    }
}
