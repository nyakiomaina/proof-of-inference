#!/usr/bin/env node
/**
 * Devnet relayer: bridges InferenceRequested events to callback_verified_inference.
 *
 * This is the off-chain glue that, in production, would be the Arcium MPC
 * callback. For devnet / local testing we:
 *
 *   1. Subscribe to InferenceRequested events on the proof-of-inference program.
 *   2. Fetch the referenced inference PDA to read the input_hash, model, etc.
 *   3. Derive a deterministic classification + score from the input_hash so
 *      the same input produces the same output (stable demo, not real MPC).
 *   4. Sign callback_verified_inference with the test callback authority
 *      (tests/fixtures/arcium_callback_authority.json) to flip the status to
 *      Verified and write the output bytes.
 *
 * Replace step 3 with a real MXE bridge (subscribe to the MXE program's
 * InferenceResultEvent and forward ciphertexts) once the MXE is deployed.
 *
 * Usage:
 *   RPC_URL=https://api.devnet.solana.com \
 *   POI_PROGRAM_ID=CCdibNmqNCG58v4fVjAKvwXora2ekGYToUTTQF6QVmuh \
 *   node scripts/watch-inference-requested.cjs
 */

const {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
} = require("@solana/web3.js");
const { AnchorProvider, Program, Wallet } = require("@coral-xyz/anchor");
const fs = require("fs");
const path = require("path");

const DEFAULT_PROGRAM_ID = "CCdibNmqNCG58v4fVjAKvwXora2ekGYToUTTQF6QVmuh";

async function main() {
  const programIdStr = process.env.POI_PROGRAM_ID || DEFAULT_PROGRAM_ID;
  const rpc =
    process.env.RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    clusterApiUrl("devnet");
  const connection = new Connection(rpc, "confirmed");

  // Callback authority — must match the ARCIUM_CALLBACK_AUTHORITY constant
  // compiled into the main program. For devnet that's the test fixture.
  const authorityPath = path.join(
    __dirname,
    "..",
    "tests",
    "fixtures",
    "arcium_callback_authority.json"
  );
  if (!fs.existsSync(authorityPath)) {
    console.error(
      `ERROR: ${authorityPath} not found. Cannot sign callbacks without the Arcium authority keypair.`
    );
    process.exit(1);
  }
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(authorityPath, "utf8")))
  );

  // Payer wallet (pays tx fees; distinct from the callback signer).
  const payerPath =
    process.env.PAYER_KEYPAIR ||
    path.join(process.env.HOME, ".config", "solana", "id.json");
  if (!fs.existsSync(payerPath)) {
    console.error(
      `ERROR: payer keypair ${payerPath} not found. Set PAYER_KEYPAIR or run \`solana-keygen new\`.`
    );
    process.exit(1);
  }
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(payerPath, "utf8")))
  );

  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  const idlPath = path.join(
    __dirname,
    "..",
    "target",
    "idl",
    "proof_of_inference.json"
  );
  if (!fs.existsSync(idlPath)) {
    console.error(
      `ERROR: ${idlPath} not found. Run \`anchor build\` first.`
    );
    process.exit(1);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const programId = new PublicKey(programIdStr);
  const program = new Program({ ...idl, address: programId.toBase58() }, provider);

  console.log("\n=== proof-of-inference relayer ===\n");
  console.log("RPC:        ", rpc);
  console.log("Program:    ", programId.toBase58());
  console.log("Authority:  ", authority.publicKey.toBase58());
  console.log("Payer:      ", payer.publicKey.toBase58());
  console.log("\nListening for InferenceRequested events...\n");

  const inFlight = new Set();

  const listener = program.addEventListener(
    "InferenceRequested",
    async (event, slot, sig) => {
      const inferencePda = event.inference;
      const key = inferencePda.toBase58();
      if (inFlight.has(key)) return;
      inFlight.add(key);

      try {
        console.log(
          `[slot ${slot}] InferenceRequested inference=${key} model=${event.model.toBase58()}`
        );

        // Let the request tx fully confirm before fetching the PDA.
        await new Promise((r) => setTimeout(r, 2000));

        let inference;
        try {
          inference = await program.account.verifiedInference.fetch(
            inferencePda
          );
        } catch (e) {
          console.warn(`  skip ${key}: fetch failed (${e.message})`);
          return;
        }

        if (!("pending" in inference.status)) {
          console.log(`  skip ${key}: not Pending (already handled)`);
          return;
        }

        const outputBytes = buildDeterministicOutput(inference.inputHash);
        const simulatedCluster = Keypair.generate().publicKey;
        const nodeCount = 3;

        const tx = await program.methods
          .callbackVerifiedInference(outputBytes, simulatedCluster, nodeCount)
          .accounts({
            verifiedInference: inferencePda,
            modelRegistry: inference.model,
            arciumAuthority: authority.publicKey,
          })
          .signers([authority])
          .rpc();

        console.log(`  -> Verified tx=${tx}`);
      } catch (err) {
        console.error(`  callback failed for ${key}:`, err.message ?? err);
      } finally {
        inFlight.delete(key);
      }
    }
  );

  const shutdown = async () => {
    console.log("\nShutting down...");
    try {
      await program.removeEventListener(listener);
    } catch {}
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * Derives a deterministic JSON output from the input hash so identical inputs
 * produce identical outputs. Three outcome buckets based on the first hash byte.
 * Not real inference — replace with MXE ciphertext forwarding for production.
 */
function buildDeterministicOutput(inputHashArray) {
  const h = Buffer.from(inputHashArray);
  const a = h[0];
  const b = h[1];

  let classification;
  let label;
  if (a < 85) {
    classification = 0;
    label = "Negative";
  } else if (a < 170) {
    classification = 1;
    label = "Neutral";
  } else {
    classification = 2;
    label = "Positive";
  }
  const confidence = 0.5 + b / 512; // 0.5..~0.998
  const score = a * 2 + b;

  return Buffer.from(
    JSON.stringify({
      classification,
      label,
      confidence: Number(confidence.toFixed(4)),
      score,
    })
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
