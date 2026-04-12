use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

const COMP_DEF_OFFSET_RUN_INFERENCE: u32 = comp_def_offset("run_inference");

declare_id!("5D8rVRC34GVskVdYVAHnkBwrxCdTKhT4TpJ5CMswu6Mp");

#[arcium_program]
pub mod poi_mxe_scaffold {
    use super::*;

    pub fn init_run_inference_comp_def(ctx: Context<InitRunInferenceCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    /// Queue a confidential inference computation on the Arcium MPC network.
    ///
    /// `ciphertexts` must contain exactly 6 elements (each [u8; 32]):
    ///   [0..1] = model weights w0, w1 (u8)
    ///   [2]    = bias (u8)
    ///   [3]    = threshold (u8)
    ///   [4..5] = input features f0, f1 (u8)
    pub fn run_inference(
        ctx: Context<RunInference>,
        computation_offset: u64,
        ciphertexts: Vec<[u8; 32]>,
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        require!(ciphertexts.len() == 6, ErrorCode::WrongCiphertextCount);
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let mut builder = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce);

        for ct in ciphertexts.iter() {
            builder = builder.encrypted_u8(*ct);
        }

        let args = builder.build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![RunInferenceCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    /// Callback invoked by the Arcium MPC network after computation completes.
    /// The output contains encrypted classification (u8) and confidence (f64).
    #[arcium_callback(encrypted_ix = "run_inference")]
    pub fn run_inference_callback(
        ctx: Context<RunInferenceCallback>,
        output: SignedComputationOutputs<RunInferenceOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(RunInferenceOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        emit!(InferenceResultEvent {
            classification_ct: o.ciphertexts[0],
            confidence_ct: o.ciphertexts[1],
            nonce: o.nonce.to_le_bytes(),
        });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Account contexts
// ---------------------------------------------------------------------------

#[queue_computation_accounts("run_inference", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct RunInference<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(
        mut,
        address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_RUN_INFERENCE))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("run_inference")]
#[derive(Accounts)]
pub struct RunInferenceCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_RUN_INFERENCE))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account, checked by arcium program via constraints in the callback context.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,
}

#[init_computation_definition_accounts("run_inference", payer)]
#[derive(Accounts)]
pub struct InitRunInferenceCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    /// Can't check it here as it's not initialized yet.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: address_lookup_table, checked by arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program is the Address Lookup Table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------------------
// Events and errors
// ---------------------------------------------------------------------------

#[event]
pub struct InferenceResultEvent {
    pub classification_ct: [u8; 32],
    pub confidence_ct: [u8; 32],
    pub nonce: [u8; 16],
}

#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
    #[msg("Expected exactly 6 ciphertexts")]
    WrongCiphertextCount,
}
