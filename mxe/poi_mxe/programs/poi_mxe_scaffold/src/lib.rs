use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

const COMP_DEF_OFFSET_RUN_INFERENCE: u32 = comp_def_offset("run_inference_v2");

/// Anchor 8-byte discriminator for `proof_of_inference::callback_verified_inference`.
/// Source: `target/idl/proof_of_inference.json`. Re-derive with
/// `sha256("global:callback_verified_inference")[..8]` if you ever rename the ix.
const CALLBACK_VERIFIED_INFERENCE_DISC: [u8; 8] =
    [199, 159, 139, 151, 193, 7, 242, 75];

declare_id!("EFZ1VFf9ws338N9YktYuVQXB8ascEhQ3agtRvVE2rzKF");

#[arcium_program]
pub mod poi_mxe_scaffold {
    use super::*;
    use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
    use anchor_lang::solana_program::program::invoke_signed;
    use arcium_client::idl::arcium::types::CallbackAccount;

    pub fn init_run_inference_v2_comp_def(ctx: Context<InitRunInferenceV2CompDef>) -> Result<()> {
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
    ///
    /// `poi_program`, `poi_inference`, `poi_model_registry` are forwarded to the
    /// callback as extra accounts so the callback can CPI into
    /// `proof_of_inference::callback_verified_inference` and finalize the
    /// `VerifiedInference` PDA in the same MPC trip — no off-chain relayer needed.
    pub fn run_inference_v2(
        ctx: Context<RunInferenceV2>,
        computation_offset: u64,
        ciphertexts: Vec<[u8; 32]>,
        pubkey: [u8; 32],
        nonce: u128,
        poi_program: Pubkey,
        poi_inference: Pubkey,
        poi_model_registry: Pubkey,
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

        // Order matters — the callback reads these from `ctx.remaining_accounts`
        // by index. See `run_inference_v2_callback` below.
        let extra_accs = [
            CallbackAccount {
                pubkey: poi_program,
                is_writable: false,
            },
            CallbackAccount {
                pubkey: poi_inference,
                is_writable: true,
            },
            CallbackAccount {
                pubkey: poi_model_registry,
                is_writable: true,
            },
            CallbackAccount {
                pubkey: ctx.accounts.sign_pda_account.key(),
                is_writable: false,
            },
        ];

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![RunInferenceV2Callback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &extra_accs,
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    /// Callback invoked by the Arcium MPC network after computation completes.
    ///
    /// In addition to emitting the encrypted result event, this CPIs into
    /// `proof_of_inference::callback_verified_inference` with `invoke_signed`
    /// (signing as the MXE's `ArciumSignerAccount` PDA) so the on-chain
    /// `VerifiedInference` PDA flips to `Verified` end-to-end without any
    /// off-chain relayer touching it.
    #[arcium_callback(encrypted_ix = "run_inference_v2")]
    pub fn run_inference_v2_callback(
        ctx: Context<RunInferenceV2Callback>,
        output: SignedComputationOutputs<RunInferenceV2Output>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(RunInferenceV2Output { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        emit!(InferenceResultEvent {
            classification_ct: o.ciphertexts[0],
            confidence_ct: o.ciphertexts[1],
            nonce: o.nonce.to_le_bytes(),
        });

        // ---- CPI into proof-of-inference::callback_verified_inference ------
        let remaining = ctx.remaining_accounts;
        require!(
            remaining.len() >= 4,
            ErrorCode::MissingCallbackExtraAccounts
        );
        let poi_program = &remaining[0];
        let poi_inference = &remaining[1];
        let poi_model_registry = &remaining[2];
        let mxe_signer = &remaining[3];

        let (expected_signer, signer_bump) =
            Pubkey::find_program_address(&[SIGN_PDA_SEED], &crate::ID);
        require_keys_eq!(
            mxe_signer.key(),
            expected_signer,
            ErrorCode::WrongMxeSigner
        );

        // The 64-byte payload the main program treats as `output_data`:
        // `classification_ct[32] || score_ct[32]`. Decoded by the frontend.
        let mut output_data = Vec::with_capacity(64);
        output_data.extend_from_slice(&o.ciphertexts[0]);
        output_data.extend_from_slice(&o.ciphertexts[1]);

        let cluster = ctx.accounts.cluster_account.key();
        // Real attestation count from the Arcium Cluster account. Saturating
        // cast because `nodes` is a `Vec<NodeRef>` (in practice always small)
        // and the on-chain field is `u8`. If cluster has 0 nodes we'd never
        // reach this callback (computation would have failed), but guard anyway.
        let node_count: u8 = ctx
            .accounts
            .cluster_account
            .nodes
            .len()
            .clamp(1, u8::MAX as usize) as u8;

        let mut data = Vec::with_capacity(8 + 4 + output_data.len() + 32 + 1);
        data.extend_from_slice(&CALLBACK_VERIFIED_INFERENCE_DISC);
        // Borsh `Vec<u8>`: u32 LE length || bytes.
        data.extend_from_slice(&(output_data.len() as u32).to_le_bytes());
        data.extend_from_slice(&output_data);
        data.extend_from_slice(cluster.as_ref());
        data.push(node_count);

        let cpi_ix = Instruction {
            program_id: poi_program.key(),
            accounts: vec![
                AccountMeta::new(poi_inference.key(), false),
                AccountMeta::new(poi_model_registry.key(), false),
                AccountMeta::new_readonly(mxe_signer.key(), true),
            ],
            data,
        };

        let signer_seeds: &[&[&[u8]]] = &[&[SIGN_PDA_SEED, &[signer_bump]]];
        invoke_signed(
            &cpi_ix,
            &[
                poi_inference.clone(),
                poi_model_registry.clone(),
                mxe_signer.clone(),
                poi_program.clone(),
            ],
            signer_seeds,
        )?;

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Account contexts
// ---------------------------------------------------------------------------

#[queue_computation_accounts("run_inference_v2", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct RunInferenceV2<'info> {
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

#[callback_accounts("run_inference_v2")]
#[derive(Accounts)]
pub struct RunInferenceV2Callback<'info> {
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

#[init_computation_definition_accounts("run_inference_v2", payer)]
#[derive(Accounts)]
pub struct InitRunInferenceV2CompDef<'info> {
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
    #[msg("Callback context is missing one of the proof-of-inference extra accounts")]
    MissingCallbackExtraAccounts,
    #[msg("Provided MXE signer PDA does not match this program's derived address")]
    WrongMxeSigner,
}
