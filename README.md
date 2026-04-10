# Proof of Inference

On-chain attestation that a **registered model** produced a given inference: model commitment, encrypted I/O metadata, Arcium cluster info, and verification status — without putting model weights or user plaintext on-chain.

This repo is the **primitive** (Anchor program + Arcis circuit sketch + client hooks), not a full product.

## Run the full on-chain loop locally (no mainnet / no devnet)

You get a **throwaway local validator**, deployed program, SPL mint, fee payment, `Pending` → **`Verified`** — everything the Solana program does — in one command:

```bash
npm install
npm test
```

`npm test` runs `anchor test --validator legacy` so **Solana’s `solana-test-validator` is used**. (Anchor 1.0 defaults to **Surfpool**; if you don’t have Surfpool installed, plain `anchor test` fails with “Failed to spawn surfpool”.)

**What this simulates:** the test signs `callback_verified_inference` with the keypair in `tests/fixtures/arcium_callback_authority.json`, which matches `ARCIUM_CALLBACK_AUTHORITY` in the program. That **stands in for Arcium’s real callback** so you can prove the product path without MPC.

**Before production:** replace that pubkey in `programs/proof-of-inference/src/lib.rs` with Arcium’s callback authority and **do not** reuse the committed test keypair.

**Check:** after `anchor build`, you should have `target/deploy/proof_of_inference.so`. If the validator log says the `.so` is missing, install/upgrade Solana CLI platform tools (`cargo build-sbf` / `solana-install`) until `anchor build` produces that file.

## Repository layout

| Path | Role |
|------|------|
| `programs/proof-of-inference/` | Solana program: `register_model`, `request_inference`, `callback_verified_inference`, `check_verification`, plus `update_model`, `fail_inference` |
| `confidential/` | Arcis confidential circuit (`feature = "arcis"`) and a **plaintext reference** implementation + unit tests when Arcis is not enabled |
| `app/` | Frontend / demo (if present) |
| `Anchor.toml` | Program IDs per cluster; provider wallet |
| `tests/proof-of-inference.ts` | Local e2e: register → request → mock Arcium callback → verified |
| `tests/fixtures/arcium_callback_authority.json` | Keypair used only for local tests (see above) |

## Prerequisites

- **Rust** (stable)
- **Solana CLI** and **Anchor CLI 1.0.x** (this workspace uses **anchor-lang / anchor-spl 1.0.0**)
- Optional: **Arcium** toolchain (`arcup`) to compile the `#[encrypted]` circuit for real MPC

## Build and test

```bash
# On-chain program + IDL (must produce target/deploy/proof_of_inference.so)
anchor build

# Full local integration test (validator + deploy + TS suite)
npm test

# Whole workspace (program + confidential reference crate)
cargo build

# Reference inference logic only (no Solana, no Arcis)
cargo test -p proof-of-inference-circuit --lib
```

If Anchor reports a **program ID mismatch**, sync the keypair and sources:

```bash
anchor keys sync
```

## Confidential circuit: sigmoid approximation (important)

The Arcis circuit uses a **piecewise rational approximation** of the sigmoid so the MPC path avoids `exp()`. It is **not** the same as the standard logistic σ(x) = 1/(1+e^(-x)).

In particular, when the linear score is **exactly zero**, the branch used for `score <= 0` gives **confidence = 1.0**, not σ(0) ≈ 0.5. So:

- **Neutral** in this circuit means `confidence <= threshold` (per the classification rules in code), **not** “score is zero.”
- Demos and docs should not claim “zero score ⇒ neutral” unless you change the approximation or the rules.

The same behavior is documented inline in `confidential/src/lib.rs` next to the Arcis and reference implementations.

## On-chain flow (summary)

1. **Register model** — owner commits `weight_commitment` (e.g. SHA-256 of weights); stores `mxe_config` pubkey for Arcium.
2. **Request inference** — payer creates a `VerifiedInference` PDA (seeds include `nonce`), pays fee in SPL tokens, stores hash of **encrypted** input blob.
3. **Callback** — only the configured Arcium callback authority can set `output_data`, cluster, node count, and `Verified` status.
4. **Check** — integrators read the account or call `check_verification` for a structured result.

## TypeScript client

Root `package.json` uses `@coral-xyz/anchor` **^0.32.1** (current npm line for **Anchor CLI 1.x** / `anchor-lang` **1.0** programs):

```bash
npm install
```

## Further reading

- [Anchor](https://www.anchor-lang.com/)
- [Arcium developers](https://docs.arcium.com/developers)
