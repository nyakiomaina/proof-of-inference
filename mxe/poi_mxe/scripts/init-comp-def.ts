/**
 * Initializes the run_inference computation definition and uploads the circuit.
 *
 * Circuit upload sends **many** transactions. The public RPC
 * (`https://api.devnet.solana.com`) will return **429 Too Many Requests** and the
 * client may throw `SendTransactionError: Unknown action 'undefined'`.
 *
 * Use a **paid / high-rate devnet RPC** (Helius, Triton, QuickNode, etc.):
 *
 *   ANCHOR_PROVIDER_URL='https://devnet.helius-rpc.com/?api-key=YOUR_KEY' \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx tsx scripts/init-comp-def.ts
 *
 * Optional: `ARCIUM_UPLOAD_CHUNK_SIZE` — parallel upload txs per batch (default 1;
 * higher is faster but more likely to 429 on weak RPCs).
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  getArciumAccountBaseSeed,
  getArciumProgramId,
  getArciumProgram,
  getCompDefAccOffset,
  getMXEAccAddress,
  getLookupTableAddress,
  uploadCircuit,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Load wallet
const walletPath = process.env.ANCHOR_WALLET || `${os.homedir()}/.config/solana/id.json`;
const walletJson = JSON.parse(fs.readFileSync(walletPath, "utf8"));
const owner = anchor.web3.Keypair.fromSecretKey(new Uint8Array(walletJson));

// Set up provider (longer timeout helps large circuit uploads on slow RPCs)
const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const connection = new anchor.web3.Connection(rpcUrl, {
  commitment: "confirmed",
  confirmTransactionInitialTimeout: 120_000,
});
const wallet = new anchor.Wallet(owner);
const provider = new anchor.AnchorProvider(connection, wallet, {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});
anchor.setProvider(provider);

// Load program IDL
const projectRoot = path.resolve(__dirname, "..");
const idlPath = path.join(projectRoot, "target", "idl", "poi_mxe_scaffold.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
const program = new Program(idl, provider);

async function main() {
  console.log("\n=== Init run_inference Computation Definition ===\n");
  console.log("Program ID:", program.programId.toBase58());
  console.log("Wallet:", owner.publicKey.toBase58());

  const arciumProgram = getArciumProgram(provider);

  // Derive comp def PDA
  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const offset = getCompDefAccOffset("run_inference");
  const compDefPDA = PublicKey.findProgramAddressSync(
    [baseSeed, program.programId.toBuffer(), offset],
    getArciumProgramId(),
  )[0];
  console.log("Comp def PDA:", compDefPDA.toBase58());

  // Get MXE account + LUT
  const mxeAccount = getMXEAccAddress(program.programId);
  const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
  const lutAddress = getLookupTableAddress(program.programId, mxeAcc.lutOffsetSlot);

  // Step 1: Init comp def (skip if already exists)
  const compDefInfo = await connection.getAccountInfo(compDefPDA);
  if (compDefInfo) {
    console.log("\n[1/2] Computation definition already initialized. Skipping.");
  } else {
    console.log("\n[1/2] Initializing computation definition...");
    const sig = await program.methods
      .initRunInferenceCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount,
        addressLookupTable: lutAddress,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });
    console.log("  Signature:", sig);
  }

  // Step 2: Upload circuit
  if (rpcUrl.includes("api.devnet.solana.com") || rpcUrl.includes("api.mainnet-beta.solana.com")) {
    console.warn(
      "\n⚠️  Using the public Solana RPC. Large `uploadCircuit` runs often hit 429.\n" +
        "   Prefer ANCHOR_PROVIDER_URL with a provider that allows higher throughput.\n"
    );
  }
  console.log("\n[2/2] Uploading run_inference circuit...");
  const circuitPath = path.join(projectRoot, "build", "run_inference.arcis");
  const rawCircuit = fs.readFileSync(circuitPath);
  const uploadChunkSize = Math.max(
    1,
    parseInt(process.env.ARCIUM_UPLOAD_CHUNK_SIZE || "1", 10)
  );
  console.log(`  Parallel txs per batch (chunkSize): ${uploadChunkSize}`);
  await uploadCircuit(
    provider,
    "run_inference",
    program.programId,
    rawCircuit,
    true,
    uploadChunkSize,
    {
      commitment: "confirmed",
    },
  );
  console.log("  Circuit uploaded.");

  console.log("\n=== Done! Computation definition initialized and circuit uploaded. ===\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
