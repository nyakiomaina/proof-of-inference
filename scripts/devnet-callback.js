#!/usr/bin/env node
/**
 * devnet-callback.js
 *
 * Simulates the Arcium MPC callback on devnet by signing
 * `callback_verified_inference` with the test authority keypair.
 *
 * In production, Arcium's MPC network signs this callback after
 * the confidential computation completes. For devnet testing,
 * we use the same keypair from tests/fixtures/.
 *
 * Usage:
 *   node scripts/devnet-callback.js <inference-pda> [--output "some output data"]
 *
 * The script:
 *   1. Loads the Arcium callback authority keypair
 *   2. Reads the VerifiedInference PDA to find the model
 *   3. Sends callback_verified_inference with output data
 *   4. Confirms the inference is now Verified
 */

import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const inferencePdaStr = process.argv[2];
  if (!inferencePdaStr) {
    console.error("Usage: node scripts/devnet-callback.js <inference-pda> [--output \"data\"]");
    process.exit(1);
  }

  const outputIdx = process.argv.indexOf("--output");
  const outputStr =
    outputIdx !== -1 && process.argv[outputIdx + 1]
      ? process.argv[outputIdx + 1]
      : JSON.stringify({
          classification: 2,
          label: "Positive",
          confidence: 0.87,
        });

  console.log("\n=== Proof of Inference — Devnet Callback Simulator ===\n");

  // Load Arcium callback authority keypair
  const authorityPath = path.join(
    __dirname,
    "..",
    "tests",
    "fixtures",
    "arcium_callback_authority.json"
  );
  if (!fs.existsSync(authorityPath)) {
    console.error("ERROR: tests/fixtures/arcium_callback_authority.json not found.");
    process.exit(1);
  }
  const authorityKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(authorityPath, "utf8")))
  );
  console.log("Callback authority:", authorityKeypair.publicKey.toBase58());

  // Load deployer wallet (payer for the transaction)
  const walletPath = path.join(process.env.HOME, ".config", "solana", "id.json");
  const payerKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );
  console.log("Payer wallet:     ", payerKeypair.publicKey.toBase58());

  // Load IDL
  const idlPath = path.join(__dirname, "..", "target", "idl", "proof_of_inference.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const wallet = new Wallet(payerKeypair);
  const provider = new AnchorProvider(connection, wallet, AnchorProvider.defaultOptions());
  const program = new Program(idl, provider);

  const inferencePda = new PublicKey(inferencePdaStr);

  // Fetch current inference state
  console.log("\nFetching inference PDA:", inferencePda.toBase58());
  let inference;
  try {
    inference = await program.account.verifiedInference.fetch(inferencePda);
  } catch (e) {
    console.error("ERROR: Could not fetch VerifiedInference account. Is the PDA correct?");
    process.exit(1);
  }

  if ("verified" in (inference.status)) {
    console.log("Inference is already Verified. Nothing to do.");
    process.exit(0);
  }

  if (!("pending" in (inference.status))) {
    console.error("ERROR: Inference status is not Pending:", inference.status);
    process.exit(1);
  }

  const modelPda = inference.model;
  console.log("Model PDA:        ", modelPda.toBase58());

  // Build and send callback
  const outputData = Buffer.from(outputStr);
  const cluster = Keypair.generate().publicKey; // simulated cluster
  const nodeCount = 3;

  console.log("\nSending callback_verified_inference...");
  console.log("  Output:", outputStr);
  console.log("  Nodes: ", nodeCount);

  const tx = await program.methods
    .callbackVerifiedInference(outputData, cluster, nodeCount)
    .accounts({
      verifiedInference: inferencePda,
      modelRegistry: modelPda,
      arciumAuthority: authorityKeypair.publicKey,
    })
    .signers([authorityKeypair])
    .rpc();

  console.log("\nCallback TX:", tx);
  console.log("Explorer:  ", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);

  // Verify
  const updated = await program.account.verifiedInference.fetch(inferencePda);
  const isVerified = "verified" in (updated.status);
  console.log("\nStatus:    ", isVerified ? "VERIFIED" : "NOT VERIFIED");

  if (isVerified) {
    console.log("\nThe frontend will auto-detect this change (polling).");
    console.log("If the browser already moved past polling, refresh the page");
    console.log("and check the VerifiedInference PDA on Solana Explorer.\n");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
