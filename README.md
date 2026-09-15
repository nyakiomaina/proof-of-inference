# Proof of Inference

Cryptographic, on-chain attestations of AI model inference on Solana — every output is signed off by an Arcium MPC cluster, finalized through a Cross-Program Invocation, and consumable by any other Solana program.

A model owner registers a model by committing a salted SHA3-256 hash of its weights to a PDA. When a user requests inference their inputs are encrypted client-side (x25519 + Rescue), the Arcium MPC nodes jointly run the circuit without any single node seeing full data, and the MXE callback **CPIs back into `proof-of-inference`** to flip the on-chain `VerifiedInference` PDA to `Verified` with the encrypted output and cluster metadata in a single MPC trip — no off-chain relayer.

## Why this matters

AI agents make decisions in DeFi, governance, and autonomous systems, but today an agent can claim "my model said X" with zero proof. Proof of Inference closes that gap: the on-chain attestation is bound to (a) the committed hash of the model weights — re-derived inside MPC and checked on chain, not merely asserted — (b) the Arcium cluster that ran it, (c) the count of attesting MPC nodes. Other programs gate decisions on `check_verification` via CPI — the included `poi-consumer` program is a one-instruction example.

## Programs

| Program | Address (after redeploy) | Purpose |
|---|---|---|
| `proof_of_inference` | `5s7exNede5PNdwQYH6vguTGNV6K2iT5nQWo1SLrMGWgh` | Model registry, inference PDAs, callback, `check_verification` |
| `poi_consumer`        | `EqDLfkt6ZVyTo1ga3KtkFpV93qZFZZqQfpkZgMoDFcaj` | Demo consumer: gates an action on a verified inference via CPI |
| `poi_mxe_scaffold`    | `EFZ1VFf9ws338N9YktYuVQXB8ascEhQ3agtRvVE2rzKF` | Arcium MXE: queues `run_inference`, callback CPIs into `proof_of_inference` |

The program IDs above match the keypairs in `target/deploy/` and `mxe/poi_mxe/target/deploy/`. After cloning, `anchor deploy` will use these same IDs as long as the keypair files are present.

## Architecture

```
User                 proof_of_inference          poi_mxe_scaffold        Arcium MPC
 |                          |                          |                      |
 |-- register_model ------->|  (PDA: H(weights||salt)) |                      |
 |                          |                          |                      |
 |-- request_inference ---->|  (Pending PDA + fee)     |                      |
 |                          |                          |                      |
 |-- run_inference -------->|------------------------->|--- queue_computation>|
 |   (encrypted u8 inputs)  |                          |                      |
 |                          |                          |<-- signed output ----|
 |                          |<-- callback_verified ----|   (MXE invoke_signed)|
 |                          |   (ciphertext + cluster, |                      |
 |                          |    node_count, commitment)                      |
 |                          |                          |                      |
other program  ──CPI──►  check_verification  ─►  Returns VerificationResult
```

0. **Initialize protocol** (once per deployment) — `initialize_protocol` creates the singleton `ProtocolConfig` PDA that pins the fee vault and the fee. `request_inference` refuses any other vault, so nothing works until this exists. `scripts/devnet-setup.js` does it for you.
1. **Register model** — owner commits `SHA3-256("poi-weights-v2" || w0 || w1 || bias || threshold || salt)` to a PDA.
2. **Encrypt inputs** — frontend encrypts the 14-tuple `(w0, w1, bias, threshold, f0, f1, salt[8])` client-side using Arcium's x25519 + Rescue cipher.
3. **Queue computation** — the MXE program forwards the ciphertexts to the Arcium MPC network along with the `poi_program / poi_inference / poi_model_registry` extra accounts so the callback can finalize them.
4. **MPC inference** — cluster nodes jointly compute `score = bias + f0*w0 + f1*w1`, classify against `threshold`, and return two encrypted bytes (`classification`, `score`) sealed to the requester's pubkey.
5. **Callback CPI** — the MXE callback verifies the cluster signature, then `invoke_signed`s into `proof_of_inference::callback_verified_inference` (signing as its own `ArciumSignerAccount` PDA) with the output blob, the real `node_count` from the cluster account, and **the weight commitment the circuit recomputed inside MPC**. The program rejects the callback unless that commitment equals the one registered for the model. The status flips to `Verified` end-to-end without any off-chain relayer.
6. **Consume** — any program calls `check_verification` via CPI and reads the typed `VerificationResult` from `get_return_data()`. See `programs/poi-consumer/` for a worked example.

## The MPC circuit

A minimal linear classifier in Arcis (`mxe/poi_mxe/encrypted-ixs/src/lib.rs`):

```
score          = bias + f0*w0 + f1*w1     // u16, no overflow checks needed for u8 inputs
classification = score >= threshold ? 1 : 0
commitment     = SHA3-256(DOMAIN || w0 || w1 || bias || threshold || salt)   // revealed
```

Both `classification` and `score` are returned as Rescue-encrypted u8 ciphertexts (32 bytes each), sealed to the requester's ephemeral x25519 pubkey supplied at queue time. The frontend decrypts them after observing the `VerifiedInference` PDA flip to `Verified`.

### How the weights are bound to the model

The circuit receives the weights as caller-supplied ciphertexts, so the call
itself proves nothing about *which* weights were used. The circuit therefore
recomputes the commitment inside MPC over the weights it was actually given and
`reveal()`s it as a plaintext output. `callback_verified_inference` compares that
value to the `weight_commitment` snapshotted at request time and returns
`WeightCommitmentMismatch` if they differ — so a `Verified` attestation cannot
name a model whose weights did not enter the computation.

The salt is what keeps the weights secret: `w0/w1/bias/threshold` are one byte
each, so an unsalted commitment is brute-forceable in 2^32. It is 8 bytes because
every secret byte costs a 32-byte ciphertext in the queue instruction, and a
legacy transaction only fits ~16 of them (14 used, ≈1146 of 1232 bytes).

Client and circuit must agree byte for byte; see `app/src/frontend/lib/modelWeights.ts`
and `mxe/poi_mxe/encrypted-ixs/src/lib.rs`.

## Project structure

```
programs/
  proof-of-inference/             Main Anchor program (v1.0). register_model,
                                  request_inference, callback_verified_inference,
                                  fail_inference, update_model, check_verification.
                                  Plus initialize_protocol / update_protocol.
                                  build.rs bakes in the MXE callback-signer pubkey
                                  (and, only under `test-callback`, a test signer).

  poi-consumer/                   Demo consumer (v1.0). One instruction
                                  (`gated_action`) that CPIs into check_verification,
                                  asserts node_count + model commitment, then logs.

mxe/poi_mxe/                      Arcium MXE scaffold (Anchor 0.32). `arcium build`,
                                  `arcium test`, `arcium deploy`. Callback
                                  CPIs into the main program via invoke_signed.

app/                              Vite + React 18 + Tailwind frontend. Wallet Adapter
                                  (Phantom, Solflare). Arcium client-side encryption
                                  via @arcium-hq/client + arcium-rescue.

scripts/
  devnet-setup.js                 One-shot SPL mint + ATAs + ProtocolConfig init.
  fetch-user-inferences.cjs       Read-only: list a wallet's VerifiedInference PDAs.

tests/
  proof-of-inference.ts           Local e2e: register → request → simulated callback → verified.
  poi-consumer.ts                 Local e2e: gated_action CPI happy + sad paths.
  fixtures/                       Test-only callback authority keypair.
```

## Prerequisites

- Rust (stable), Solana CLI, **Anchor CLI 1.0.x** (root) and **0.32.x** (MXE).
- Arcium CLI (`arcup install`).
- Node.js v22+.
- A devnet wallet with ~10 SOL.
- A reliable devnet RPC (Helius free tier strongly recommended for circuit upload).

## Build and test (local)

```bash
npm install
npm test
```

This runs `anchor test --validator legacy -- --features test-callback`, which spins up
`solana-test-validator`, deploys both programs, and executes the TypeScript suite.

`test-callback` is what compiles in `tests/fixtures/arcium_callback_authority.json`
as an accepted callback signer. **A release build accepts only the MXE's signing
PDA.** Build without the feature and the suite fails with `UnauthorizedCallback`,
which is the intended behaviour — that keypair is committed to this repo, and
anyone holding it could otherwise forge `Verified` attestations. Never pass
`--features test-callback` for an artifact you deploy.

Other useful commands:

```bash
anchor build                      # main + consumer programs
cd mxe/poi_mxe && arcium build    # MXE circuit + scaffold
npm run sync-idl                  # copy IDLs into app/src/ for the frontend
```

## Devnet deployment

### 1. Deploy the main + consumer programs

```bash
anchor build
anchor deploy --provider.cluster devnet
```

If the program IDs in `Anchor.toml` and `declare_id!` don't match (e.g. you regenerated keypairs):

```bash
anchor keys sync && anchor build && anchor deploy --provider.cluster devnet
```

### 2. Deploy the MXE scaffold and upload the circuit

```bash
cd mxe/poi_mxe
arcium build
anchor deploy --provider.cluster devnet
arcium deploy \
  --keypair-path ~/.config/solana/id.json \
  --cluster-offset 456 \
  --recovery-set-size 4 \
  --skip-deploy \
  -u devnet
```

If you change the MXE program ID, recompute the callback signer PDA and re-deploy `proof_of_inference` so it accepts the new MXE:

```bash
NEW_MXE_ID=$(solana address -k mxe/poi_mxe/target/deploy/poi_mxe_scaffold-keypair.json)
NEW_SIGN_PDA=$(solana find-program-derived-address $NEW_MXE_ID string:ArciumSignerAccount | head -1)
POI_MXE_SIGN_PDA=$NEW_SIGN_PDA anchor build
anchor deploy --provider.cluster devnet
```

### 3. Create the SPL token + protocol fee accounts

```bash
node scripts/devnet-setup.js
```

Note the printed `VITE_REQUESTER_TOKEN_ACCOUNT` and `VITE_PROTOCOL_FEE_VAULT` values.

### 4. Run the frontend

```bash
cd app
cp .env.example .env
# Fill in:
#   VITE_MXE_PROGRAM_ID=<from `solana address -k mxe/poi_mxe/target/deploy/poi_mxe_scaffold-keypair.json`>
#   VITE_REQUESTER_TOKEN_ACCOUNT=<from step 3>
#   VITE_PROTOCOL_FEE_VAULT=<from step 3>
npm install
npm run dev
```

The app runs at `http://localhost:8080` (`vite.config.ts` pins `strictPort`). The production build (`npm run build`) is what the included `Dockerfile` + `fly.toml` ship.

## Environment variables

`app/.env` (Vite — substituted at build time, **not** at runtime):

| Variable | Required | Description |
|---|---|---|
| `VITE_SOLANA_CLUSTER`        | Yes | `devnet`, `testnet`, or `mainnet-beta` |
| `VITE_SOLANA_RPC_URL`        | No  | Explicit RPC endpoint (overrides cluster default) |
| `VITE_MXE_PROGRAM_ID`        | Yes | Address of the deployed MXE scaffold program |
| `VITE_ARCIUM_CLUSTER_OFFSET` | No  | Override the auto-picked Arcium cluster offset |
| `VITE_REQUESTER_TOKEN_ACCOUNT` | Yes | SPL token account that pays the verification fee |
| `VITE_PROTOCOL_FEE_VAULT`    | Yes | SPL token account that receives the verification fee |

Root `.env` (used by build scripts and `cargo` builds):

| Variable | When | Description |
|---|---|---|
| `POI_ARCIUM_CALLBACK_AUTHORITY` | Before `anchor build -- --features test-callback` | Override the test-only off-chain callback signer. Ignored unless that feature is on. |
| `POI_MXE_SIGN_PDA`              | Before `anchor build` | Override the production MXE callback signer PDA |

## On-chain instructions

| Instruction | Caller | What it does |
|---|---|---|
| `register_model`             | Model owner             | Commits weight hash to PDA, stores MXE config |
| `update_model`               | Model owner             | Toggles active / updates MXE config / version |
| `request_inference`          | Anyone                  | Creates Pending `VerifiedInference` PDA, charges SPL fee |
| `callback_verified_inference`| MXE PDA or test signer | Writes 64-byte output, cluster, node_count → `Verified` |
| `fail_inference`             | MXE PDA or test signer | Marks Pending inference as `Failed` |
| `check_verification`         | Any program (CPI)       | Returns `VerificationResult { verified, model, model_commitment, node_count, timestamp, cluster }` |

`poi_consumer::gated_action` is the worked CPI example. It calls `check_verification`, reads `get_return_data()`, then asserts `verified && node_count >= min && model_commitment == expected` before writing a `GatedActionLog` PDA.

## Tech stack

- **Anchor** 1.0 (main + consumer) and 0.32 (MXE scaffold).
- **Arcium** 0.9.7 — `arcis` circuit compiler, `arcium-anchor`, `@arcium-hq/client`, `arcium-rescue`.
- **Solana** Agave / Solana CLI.
- **React** 18, Vite 5, Tailwind 3, Solana Wallet Adapter (Phantom, Solflare).

## Links

- [Anchor](https://www.anchor-lang.com/)
- [Arcium developer docs](https://docs.arcium.com/developers)
- [Solana developer docs](https://solana.com/docs)
