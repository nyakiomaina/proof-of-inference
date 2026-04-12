use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use solana_pubkey::pubkey;
use solana_sha256_hasher::hash as sha256_hash;

// Synced with `target/deploy/proof_of_inference-keypair.json`.
declare_id!("CCdibNmqNCG58v4fVjAKvwXora2ekGYToUTTQF6QVmuh");

/// Verification fee per inference request (in token smallest units).
/// For USDC with 6 decimals: 50_000 = $0.05
const VERIFICATION_FEE: u64 = 50_000;

/// Maximum length for model name strings.
const MAX_MODEL_NAME_LEN: usize = 64;

/// Maximum size for encrypted output data.
const MAX_OUTPUT_DATA_LEN: usize = 1024;

#[program]
pub mod proof_of_inference {
    use super::*;

    /// Registers a new AI model on-chain by committing the SHA-256 hash of its weights.
    /// The model owner also specifies which Arcium MXE configuration will host the model
    /// for confidential computation. The actual weights never touch the chain.
    pub fn register_model(
        ctx: Context<RegisterModel>,
        weight_commitment: [u8; 32],
        model_name: String,
        model_version: u16,
        model_type: ModelType,
    ) -> Result<()> {
        require!(
            model_name.len() <= MAX_MODEL_NAME_LEN,
            ErrorCode::ModelNameTooLong
        );

        let model = &mut ctx.accounts.model_registry;
        model.owner = ctx.accounts.owner.key();
        model.weight_commitment = weight_commitment;
        model.model_name = model_name;
        model.model_version = model_version;
        model.model_type = model_type;
        model.total_inferences = 0;
        model.created_at = Clock::get()?.unix_timestamp;
        model.active = true;
        model.mxe_config = ctx.accounts.mxe_config.key();
        model.bump = ctx.bumps.model_registry;

        emit!(ModelRegistered {
            model: model.key(),
            owner: model.owner,
            weight_commitment,
            model_name: model.model_name.clone(),
            model_version,
            timestamp: model.created_at,
        });

        Ok(())
    }

    /// Updates a registered model (owner only). Can toggle active status,
    /// update the MXE config, or bump the version.
    pub fn update_model(
        ctx: Context<UpdateModel>,
        active: Option<bool>,
        mxe_config: Option<Pubkey>,
        model_version: Option<u16>,
    ) -> Result<()> {
        let model = &mut ctx.accounts.model_registry;

        if let Some(active) = active {
            model.active = active;
        }
        if let Some(mxe_config) = mxe_config {
            model.mxe_config = mxe_config;
        }
        if let Some(model_version) = model_version {
            model.model_version = model_version;
        }

        emit!(ModelUpdated {
            model: model.key(),
            active: model.active,
            model_version: model.model_version,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Requests a verified inference from a registered model. The user's input
    /// is encrypted client-side before submission; only the encrypted blob and
    /// a nonce are sent on-chain. A verification fee is transferred to the
    /// protocol vault. The instruction creates a Pending VerifiedInference PDA
    /// and emits an event that off-chain relayers / Arcium watchers use to
    /// trigger the MPC computation.
    pub fn request_inference(
        ctx: Context<RequestInference>,
        encrypted_input: Vec<u8>,
        nonce: [u8; 32],
    ) -> Result<()> {
        let model = &ctx.accounts.model_registry;
        require!(model.active, ErrorCode::ModelInactive);

        // Transfer verification fee
        let fee_transfer = Transfer {
            from: ctx.accounts.requester_token.to_account_info(),
            to: ctx.accounts.protocol_fee_vault.to_account_info(),
            authority: ctx.accounts.requester.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.key(), fee_transfer),
            VERIFICATION_FEE,
        )?;

        let inference = &mut ctx.accounts.verified_inference;
        inference.model = model.key();
        inference.model_commitment = model.weight_commitment;
        inference.nonce = nonce;
        inference.input_hash = sha256_hash(&encrypted_input).to_bytes();
        inference.output_hash = [0u8; 32];
        inference.output_data = Vec::new();
        inference.requester = ctx.accounts.requester.key();
        inference.arcium_cluster = Pubkey::default();
        inference.node_count = 0;
        inference.timestamp = Clock::get()?.unix_timestamp;
        inference.status = VerificationStatus::Pending;
        inference.bump = ctx.bumps.verified_inference;

        emit!(InferenceRequested {
            model: model.key(),
            requester: ctx.accounts.requester.key(),
            inference: inference.key(),
            input_hash: inference.input_hash,
            timestamp: inference.timestamp,
        });

        Ok(())
    }

    /// Callback invoked by the Arcium MPC network after confidential computation
    /// completes. Only the designated Arcium callback authority can call this.
    /// It writes the encrypted output, cluster metadata, and flips the status
    /// to Verified. The model's lifetime inference counter is incremented.
    pub fn callback_verified_inference(
        ctx: Context<CallbackVerifiedInference>,
        output_data: Vec<u8>,
        cluster: Pubkey,
        node_count: u8,
    ) -> Result<()> {
        require!(
            output_data.len() <= MAX_OUTPUT_DATA_LEN,
            ErrorCode::OutputDataTooLarge
        );
        require!(node_count > 0, ErrorCode::InvalidNodeCount);

        let inference = &mut ctx.accounts.verified_inference;
        require!(
            inference.status == VerificationStatus::Pending,
            ErrorCode::InferenceNotPending
        );

        inference.output_data = output_data.clone();
        inference.output_hash = sha256_hash(&output_data).to_bytes();
        inference.arcium_cluster = cluster;
        inference.node_count = node_count;
        inference.status = VerificationStatus::Verified;

        let model = &mut ctx.accounts.model_registry;
        model.total_inferences = model.total_inferences.checked_add(1).unwrap();

        emit!(InferenceVerified {
            model: model.key(),
            inference: inference.key(),
            node_count,
            cluster,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Marks a pending inference as failed. Only callable by the Arcium callback
    /// authority when the MPC computation could not complete successfully.
    pub fn fail_inference(ctx: Context<FailInference>, reason: String) -> Result<()> {
        let inference = &mut ctx.accounts.verified_inference;
        require!(
            inference.status == VerificationStatus::Pending,
            ErrorCode::InferenceNotPending
        );

        inference.status = VerificationStatus::Failed;

        emit!(InferenceFailed {
            inference: inference.key(),
            model: inference.model,
            reason,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// CPI-callable verification check. Any Solana program can call this via CPI,
    /// passing a VerifiedInference PDA, to get a structured verification result.
    /// This is the composability surface — DeFi vaults, DAOs, and dApps consume
    /// this to gate actions on proven AI computation.
    pub fn check_verification(ctx: Context<CheckVerification>) -> Result<VerificationResult> {
        let inference = &ctx.accounts.verified_inference;

        Ok(VerificationResult {
            verified: inference.status == VerificationStatus::Verified,
            model: inference.model,
            model_commitment: inference.model_commitment,
            node_count: inference.node_count,
            timestamp: inference.timestamp,
            cluster: inference.arcium_cluster,
        })
    }
}

// ---------------------------------------------------------------------------
// Account Structures
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct ModelRegistry {
    /// The wallet that registered and owns this model.
    pub owner: Pubkey,
    /// SHA-256 hash of the model weights — the on-chain identity of the model.
    pub weight_commitment: [u8; 32],
    /// Human-readable name (max 64 bytes).
    #[max_len(64)]
    pub model_name: String,
    /// Semver-style version number for the model.
    pub model_version: u16,
    /// Classification of the model's purpose.
    pub model_type: ModelType,
    /// Lifetime count of verified inferences produced by this model.
    pub total_inferences: u64,
    /// Unix timestamp when the model was registered.
    pub created_at: i64,
    /// Whether the model is accepting inference requests.
    pub active: bool,
    /// The Arcium MXE configuration account that hosts this model's encrypted weights.
    pub mxe_config: Pubkey,
    /// PDA bump seed.
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct VerifiedInference {
    /// The ModelRegistry PDA that this inference was requested against.
    pub model: Pubkey,
    /// Snapshot of the model's weight_commitment at request time.
    pub model_commitment: [u8; 32],
    /// Request nonce used to derive this VerifiedInference PDA.
    pub nonce: [u8; 32],
    /// SHA-256 hash of the encrypted input blob.
    pub input_hash: [u8; 32],
    /// SHA-256 hash of the output data (set after callback).
    pub output_hash: [u8; 32],
    /// The encrypted output data from the MPC computation (sealed to requester).
    #[max_len(1024)]
    pub output_data: Vec<u8>,
    /// The wallet that requested this inference.
    pub requester: Pubkey,
    /// The Arcium cluster that performed the MPC computation.
    pub arcium_cluster: Pubkey,
    /// Number of MPC nodes that participated.
    pub node_count: u8,
    /// Unix timestamp when the inference was requested.
    pub timestamp: i64,
    /// Current verification status.
    pub status: VerificationStatus,
    /// PDA bump seed.
    pub bump: u8,
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ModelType {
    SentimentClassifier,
    TextClassifier,
    RiskScorer,
    AnomalyDetector,
    CustomClassifier,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum VerificationStatus {
    Pending,
    Verified,
    Failed,
}

// ---------------------------------------------------------------------------
// Return type for check_verification
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct VerificationResult {
    pub verified: bool,
    pub model: Pubkey,
    pub model_commitment: [u8; 32],
    pub node_count: u8,
    pub timestamp: i64,
    pub cluster: Pubkey,
}

// ---------------------------------------------------------------------------
// Instruction Account Contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(weight_commitment: [u8; 32])]
pub struct RegisterModel<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + ModelRegistry::INIT_SPACE,
        seeds = [b"model", owner.key().as_ref(), &weight_commitment],
        bump
    )]
    pub model_registry: Account<'info, ModelRegistry>,
    /// The Arcium MXE configuration account. Validated off-chain during
    /// model weight upload; stored here for reference.
    /// CHECK: Arcium MXE config; validated off-chain by the Arcium SDK.
    pub mxe_config: UncheckedAccount<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateModel<'info> {
    #[account(
        mut,
        has_one = owner,
        seeds = [b"model", owner.key().as_ref(), &model_registry.weight_commitment],
        bump = model_registry.bump
    )]
    pub model_registry: Account<'info, ModelRegistry>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(encrypted_input: Vec<u8>, nonce: [u8; 32])]
pub struct RequestInference<'info> {
    #[account(
        seeds = [b"model", model_registry.owner.as_ref(), &model_registry.weight_commitment],
        bump = model_registry.bump
    )]
    pub model_registry: Account<'info, ModelRegistry>,
    #[account(
        init,
        payer = requester,
        space = 8 + VerifiedInference::INIT_SPACE,
        seeds = [b"inference", model_registry.key().as_ref(), &nonce],
        bump
    )]
    pub verified_inference: Account<'info, VerifiedInference>,
    #[account(mut)]
    pub requester: Signer<'info>,
    #[account(
        mut,
        constraint = requester_token.owner == requester.key() @ ErrorCode::TokenOwnerMismatch
    )]
    pub requester_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub protocol_fee_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CallbackVerifiedInference<'info> {
    #[account(
        mut,
        seeds = [b"inference", model_registry.key().as_ref(), &verified_inference.nonce],
        bump = verified_inference.bump
    )]
    pub verified_inference: Account<'info, VerifiedInference>,
    #[account(
        mut,
        constraint = verified_inference.model == model_registry.key() @ ErrorCode::ModelMismatch
    )]
    pub model_registry: Account<'info, ModelRegistry>,
    /// The Arcium callback authority. Only this signer can finalize inferences.
    /// CHECK: Validated against the ARCIUM_CALLBACK_AUTHORITY constant.
    #[account(
        signer,
        constraint = arcium_authority.key() == ARCIUM_CALLBACK_AUTHORITY @ ErrorCode::UnauthorizedCallback
    )]
    pub arcium_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct FailInference<'info> {
    #[account(mut)]
    pub verified_inference: Account<'info, VerifiedInference>,
    /// CHECK: Validated against the ARCIUM_CALLBACK_AUTHORITY constant.
    #[account(
        signer,
        constraint = arcium_authority.key() == ARCIUM_CALLBACK_AUTHORITY @ ErrorCode::UnauthorizedCallback
    )]
    pub arcium_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CheckVerification<'info> {
    pub verified_inference: Account<'info, VerifiedInference>,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct ModelRegistered {
    pub model: Pubkey,
    pub owner: Pubkey,
    pub weight_commitment: [u8; 32],
    pub model_name: String,
    pub model_version: u16,
    pub timestamp: i64,
}

#[event]
pub struct ModelUpdated {
    pub model: Pubkey,
    pub active: bool,
    pub model_version: u16,
    pub timestamp: i64,
}

#[event]
pub struct InferenceRequested {
    pub model: Pubkey,
    pub requester: Pubkey,
    pub inference: Pubkey,
    pub input_hash: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct InferenceVerified {
    pub model: Pubkey,
    pub inference: Pubkey,
    pub node_count: u8,
    pub cluster: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct InferenceFailed {
    pub inference: Pubkey,
    pub model: Pubkey,
    pub reason: String,
    pub timestamp: i64,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum ErrorCode {
    #[msg("Model name exceeds maximum length of 64 bytes")]
    ModelNameTooLong,
    #[msg("Model is not active and cannot accept inference requests")]
    ModelInactive,
    #[msg("Only the Arcium callback authority can finalize inferences")]
    UnauthorizedCallback,
    #[msg("Inference is not in Pending status")]
    InferenceNotPending,
    #[msg("Output data exceeds maximum allowed size")]
    OutputDataTooLarge,
    #[msg("Node count must be greater than zero")]
    InvalidNodeCount,
    #[msg("Token account owner does not match requester")]
    TokenOwnerMismatch,
    #[msg("Model registry does not match the inference record")]
    ModelMismatch,
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// The Arcium callback authority pubkey. For **local testing only**, this matches
/// `tests/fixtures/arcium_callback_authority.json` so `anchor test` can sign callbacks
/// without real MPC.
///
/// **Production:** Replace with the pubkey Arcium documents for your network *or*
/// redesign around an MXE `#[arcium_callback]` (see `mxe/poi_mxe`) so verification
/// follows Arcium’s standard flow. There is no env-var override — recompile after changing.
const ARCIUM_CALLBACK_AUTHORITY: Pubkey =
    pubkey!("frM1CnN1bvUDTHFSLCHQ7Mnb9PZp5u2fW7CLuWXscZM");
