//! Tiny demo program that *consumes* a proof-of-inference attestation.
//!
//! `gated_action` is the canonical "any Solana program can verify the
//! attestation via CPI" story made concrete. It does three things:
//!
//! 1. CPIs into `proof_of_inference::check_verification` with the supplied
//!    `VerifiedInference` PDA.
//! 2. Reads the structured `VerificationResult` from the CPI return data.
//! 3. Asserts the inference is `Verified`, was attested by at least
//!    `min_node_count` MPC nodes, and matches the model commitment the caller
//!    expected — then records the action in a `GatedActionLog` PDA.
//!
//! In a real DeFi / DAO use-case the third step would mint a token, release
//! treasury funds, or cast a governance vote. The shape is identical.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::get_return_data;
use proof_of_inference::cpi::accounts::CheckVerification;
use proof_of_inference::program::ProofOfInference;
use proof_of_inference::{self, VerificationResult, VerifiedInference};

declare_id!("EqDLfkt6ZVyTo1ga3KtkFpV93qZFZZqQfpkZgMoDFcaj");

#[program]
pub mod poi_consumer {
    use super::*;

    /// Records an action gated by a verified MPC inference.
    ///
    /// `action_id` lets the caller scope multiple gated actions per user.
    /// `min_node_count` is a policy knob: refuse to act unless the MPC cluster
    /// that produced the attestation had at least this many nodes.
    /// `expected_model_commitment` is the caller's expectation of *which* model
    /// produced the inference — refuse if the on-chain attestation disagrees.
    pub fn gated_action(
        ctx: Context<GatedAction>,
        action_id: u64,
        min_node_count: u8,
        expected_model_commitment: [u8; 32],
    ) -> Result<()> {
        let cpi_accounts = CheckVerification {
            verified_inference: ctx.accounts.verified_inference.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.proof_of_inference_program.key(),
            cpi_accounts,
        );
        proof_of_inference::cpi::check_verification(cpi_ctx)?;

        let (program_id, return_bytes) =
            get_return_data().ok_or(ConsumerError::MissingReturnData)?;
        require_keys_eq!(
            program_id,
            ctx.accounts.proof_of_inference_program.key(),
            ConsumerError::ReturnDataFromWrongProgram
        );
        let result = VerificationResult::try_from_slice(&return_bytes)
            .map_err(|_| ConsumerError::MalformedReturnData)?;

        require!(result.verified, ConsumerError::InferenceNotVerified);
        require!(
            result.node_count >= min_node_count,
            ConsumerError::InsufficientAttestation
        );
        require!(
            result.model_commitment == expected_model_commitment,
            ConsumerError::ModelCommitmentMismatch
        );

        let log = &mut ctx.accounts.action_log;
        log.user = ctx.accounts.user.key();
        log.inference = ctx.accounts.verified_inference.key();
        log.model = result.model;
        log.action_id = action_id;
        log.node_count = result.node_count;
        log.cluster = result.cluster;
        log.timestamp = Clock::get()?.unix_timestamp;
        log.bump = ctx.bumps.action_log;

        emit!(ActionGated {
            user: log.user,
            action_id,
            inference: log.inference,
            model: log.model,
            node_count: log.node_count,
        });

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(action_id: u64)]
pub struct GatedAction<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    /// The verified inference attestation produced by the MPC network.
    pub verified_inference: Account<'info, VerifiedInference>,
    /// PDA that records the fact that this user invoked this action with this
    /// inference. Re-using the same `(user, action_id)` will fail the second
    /// time, which is the desired anti-replay behaviour for most consumers.
    #[account(
        init,
        payer = user,
        space = 8 + GatedActionLog::INIT_SPACE,
        seeds = [b"action", user.key().as_ref(), &action_id.to_le_bytes()],
        bump
    )]
    pub action_log: Account<'info, GatedActionLog>,
    pub proof_of_inference_program: Program<'info, ProofOfInference>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct GatedActionLog {
    pub user: Pubkey,
    pub inference: Pubkey,
    pub model: Pubkey,
    pub action_id: u64,
    pub node_count: u8,
    pub cluster: Pubkey,
    pub timestamp: i64,
    pub bump: u8,
}

#[event]
pub struct ActionGated {
    pub user: Pubkey,
    pub action_id: u64,
    pub inference: Pubkey,
    pub model: Pubkey,
    pub node_count: u8,
}

#[error_code]
pub enum ConsumerError {
    #[msg("check_verification CPI did not set return data")]
    MissingReturnData,
    #[msg("Return data was set by a program other than proof_of_inference")]
    ReturnDataFromWrongProgram,
    #[msg("Could not deserialize VerificationResult from CPI return data")]
    MalformedReturnData,
    #[msg("Referenced inference is not in Verified status")]
    InferenceNotVerified,
    #[msg("MPC attestation has fewer nodes than the policy requires")]
    InsufficientAttestation,
    #[msg("Verified inference references a different model than expected")]
    ModelCommitmentMismatch,
}
