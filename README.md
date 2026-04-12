# Proof of Inference

Verified on-chain attestations of AI model inference on Solana, using Arcium MPC for confidential computation.

A model owner registers a model by committing a hash of its weights to a Solana PDA. When a user requests inference, their inputs are encrypted client-side and submitted to the Arcium MPC network, where nodes jointly compute the result without any single node seeing the full data. The output and verification metadata are written back on-chain, and any Solana program can verify the attestation via CPI.

## Why this matters

AI agents are making decisions in DeFi, governance, and autonomous systems, but there is no way to verify that a specific model actually produced a specific output. Any agent can claim "my model said X" with zero proof. Proof of Inference closes this gap by creating a cryptographic attestation that a registered model ran a specific computation -- without revealing model weights, user inputs, or intermediate state.

## Deployed programs (devnet)

| Program | ID |
|---|---|
| proof-of-inference (Anchor) | `CCdibNmqNCG58v4fVjAKvwXora2ekGYToUTTQF6QVmuh` |
| poi_mxe (Arcium MXE scaffold) | `5D8rVRC34GVskVdYVAHnkBwrxCdTKhT4TpJ5CMswu6Mp` |

## Architecture

```
User                   Solana                    Arcium MPC Network
 |                       |                             |
 |-- register_model ---->| (PDA: SHA-256 weight hash)  |
 |                       |                             |
 |-- encrypt inputs -----|---> queue_computation ----->|
 |   (x25519 + Rescue)   |    (MXE scaffold)          |
 |                       |                             |
 |                       |<--- callback_verified ------|
 |                       |    (encrypted result +      |
 |                       |     verification metadata)  |
 |                       |                             |
 |<-- check_verification-|                             |
```

1. **Register model** -- Owner commits a SHA-256 hash of model weights to a PDA. Stores MXE config pubkey for Arcium routing.
2. **Encrypt inputs** -- Client encrypts input features using Arcium's x25519 + Rescue cipher (`@arcium-hq/client`).
3. **Queue computation** -- Encrypted ciphertexts are submitted to the MXE scaffold program, which queues the job on the Arcium MPC network.
4. **MPC inference** -- Cluster nodes jointly compute the inference. No single node sees full data.
5. **Callback** -- Arcium's callback authority writes encrypted results + verification metadata on-chain, sets status to `Verified`.
6. **Verification** -- Any program can read the PDA or call `check_verification` via CPI.

## The MPC circuit

A sentiment classifier using u8 fixed-point arithmetic: 2 weights + bias + threshold + 2 input features. Computes a dot product, applies a piecewise rational sigmoid approximation (avoids `exp()` in MPC), and thresholds to produce a classification + confidence score. The output is encrypted.

Note: the sigmoid approximation is **not** the standard logistic function. When the linear score is exactly zero, the approximation yields confidence = 1.0, not 0.5. See `confidential/src/lib.rs` for details.

## Project structure

```
programs/proof-of-inference/     Anchor program (v1.0.0): register_model, request_inference,
                                 callback_verified_inference, check_verification,
                                 update_model, fail_inference

mxe/poi_mxe/                    Arcium MXE scaffold (Anchor 0.32.1): arcium build/deploy/test.
                                 Contains encrypted-ixs/, the arcis circuit, and build artifacts.

confidential/                   Reference implementation of inference logic. Plaintext (no Arcis)
                                 for unit testing; feature-gated arcis circuit for MPC.

app/                            React 18 frontend (Vite + Tailwind). Wallet Adapter integration
                                 (Phantom, Solflare). Arcium encryption helpers in
                                 app/src/frontend/lib/arciumInference.ts.

scripts/
  devnet-setup.js               Creates SPL token mint + accounts for devnet fee mechanism.
  devnet-callback.js            Simulates Arcium callback for devnet testing.
  watch-inference-requested.cjs Log subscriber for on-chain Inference* events.

tests/
  proof-of-inference.ts         Local e2e: register -> request -> mock callback -> verified.
  fixtures/                     Test keypairs (not for production use).
```

## Prerequisites

- **Rust** (stable) + **Solana CLI** + **Anchor CLI 1.0.x**
- **Arcium CLI** (`arcup`) -- for the MXE scaffold under `mxe/poi_mxe/`
- **Node.js v22+**
- A Solana wallet with devnet SOL (~10 SOL recommended)
- A devnet RPC endpoint (Helius free tier recommended for circuit upload)

## Build and test (local)

Run the full on-chain loop with a local validator -- no devnet needed:

```bash
npm install
npm test
```

This runs `anchor test --validator legacy`, which spins up `solana-test-validator`, deploys the program, and executes the TS test suite. The test uses a local keypair as a stand-in for Arcium's callback authority.

Individual build commands:

```bash
# Anchor program + IDL
anchor build

# Full workspace (program + confidential reference crate)
cargo build

# Reference inference logic only (no Solana, no Arcis)
cargo test -p proof-of-inference-circuit --lib
```

If Anchor reports a program ID mismatch:

```bash
anchor keys sync
```

## Devnet deployment

### 1. Deploy the main Anchor program

```bash
anchor build
anchor deploy --provider.cluster devnet
```

### 2. Deploy the MXE scaffold

```bash
cd mxe/poi_mxe
arcium build --skip-program
anchor build
anchor deploy --provider.cluster devnet
```

### 3. Initialize the MXE

```bash
arcium deploy \
  --keypair-path ~/.config/solana/id.json \
  --cluster-offset 456 \
  --recovery-set-size 4 \
  --skip-deploy \
  -u devnet
```

### 4. Upload the circuit

Run `scripts/init-comp-def.ts` with a reliable RPC (Helius recommended -- public devnet endpoint will likely fail for large transactions):

```bash
npx ts-node scripts/init-comp-def.ts
```

### 5. Create token accounts

```bash
node scripts/devnet-setup.js
```

This creates the SPL token mint and associated accounts. Note the output values for `VITE_REQUESTER_TOKEN_ACCOUNT` and `VITE_PROTOCOL_FEE_VAULT`.

### 6. Run the frontend

```bash
cd app
cp .env.example .env
# Fill in VITE_REQUESTER_TOKEN_ACCOUNT and VITE_PROTOCOL_FEE_VAULT from step 5
# Set VITE_MXE_PROGRAM_ID=5D8rVRC34GVskVdYVAHnkBwrxCdTKhT4TpJ5CMswu6Mp
npm install
npm run dev
```

The app runs on `http://localhost:5173` by default.

## Environment variables

Copy `app/.env.example` to `app/.env` and configure:

| Variable | Required | Description |
|---|---|---|
| `VITE_SOLANA_CLUSTER` | Yes | `devnet`, `testnet`, or `mainnet-beta` |
| `VITE_SOLANA_RPC_URL` | No | Explicit RPC endpoint (overrides cluster default) |
| `VITE_MXE_PROGRAM_ID` | Yes | MXE scaffold program ID (`5D8rVRC34GVskVdYVAHnkBwrxCdTKhT4TpJ5CMswu6Mp` on devnet) |
| `VITE_REQUESTER_TOKEN_ACCOUNT` | Yes | From `devnet-setup.js` output |
| `VITE_PROTOCOL_FEE_VAULT` | Yes | From `devnet-setup.js` output |

Root `.env.example` has additional variables for scripts (RPC_URL, cluster offsets).

## On-chain flow (instructions)

| Instruction | Who calls it | What it does |
|---|---|---|
| `register_model` | Model owner | Commits weight hash to PDA, stores MXE config |
| `update_model` | Model owner | Updates an existing model registration |
| `request_inference` | Any user | Creates `VerifiedInference` PDA, pays SPL token fee, stores encrypted input hash |
| `callback_verified_inference` | Arcium callback authority only | Writes output data, cluster info, node count, sets status to `Verified` |
| `fail_inference` | Arcium callback authority only | Marks inference as `Failed` |
| `check_verification` | Any program (CPI) | Returns structured verification result |

## Tech stack

- **Anchor** 1.0.0 (main program) / 0.32.1 (MXE scaffold)
- **Arcium SDK** 0.9.7 (`arcis` circuit compiler, `arcium-anchor`, `@arcium-hq/client`)
- **Solana CLI / Agave**
- **React 18**, Vite 5, Tailwind CSS 3
- **Solana Wallet Adapter** (Phantom, Solflare)

## Production notes

The test suite uses a local keypair (`tests/fixtures/arcium_callback_authority.json`) as the callback authority. Before production deployment, replace `ARCIUM_CALLBACK_AUTHORITY` in `programs/proof-of-inference/src/lib.rs` with Arcium's actual callback authority pubkey. Do not reuse the test keypair.

## Links

- [Anchor](https://www.anchor-lang.com/)
- [Arcium developer docs](https://docs.arcium.com/developers)
- [Solana developer docs](https://solana.com/docs)
