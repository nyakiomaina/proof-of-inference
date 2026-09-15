#!/usr/bin/env node
/**
 * devnet-setup.js
 *
 * One-time setup for running Proof of Inference on Solana devnet:
 *   1. Airdrops SOL to the deployer wallet
 *   2. Deploys the program (or skips if already deployed)
 *   3. Creates a devnet SPL token mint (stands in for USDC)
 *   4. Creates the protocol fee vault token account
 *   5. Creates a requester token account and mints test tokens
 *   6. Initializes the singleton ProtocolConfig (pins the fee vault)
 *
 * Then prints / merges the env vars you need into app/.env.
 *
 * Usage:
 *   node scripts/devnet-setup.js [--wallet ~/.config/solana/id.json]
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
  SystemProgram,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import anchor from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse --wallet flag
const walletFlag = process.argv.indexOf("--wallet");
const walletPath =
  walletFlag !== -1 && process.argv[walletFlag + 1]
    ? process.argv[walletFlag + 1]
    : path.join(process.env.HOME, ".config", "solana", "id.json");

async function main() {
  console.log("\n=== Proof of Inference — Devnet Setup ===\n");

  // Load deployer keypair
  const walletJson = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  const deployer = Keypair.fromSecretKey(Uint8Array.from(walletJson));
  console.log("Deployer wallet:", deployer.publicKey.toBase58());
  console.log("Wallet path:   ", walletPath);

  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  // 1. Airdrop SOL
  console.log("\n[1/6] Airdropping 2 SOL...");
  try {
    const sig = await connection.requestAirdrop(
      deployer.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
    console.log("  Airdrop confirmed.");
  } catch (e) {
    console.log("  Airdrop failed (rate limit?). Continuing with existing balance...");
  }

  const balance = await connection.getBalance(deployer.publicKey);
  console.log("  Balance:", balance / LAMPORTS_PER_SOL, "SOL");

  // 2. Check program deployment
  console.log("\n[2/6] Checking program deployment...");
  const idlPath = path.join(__dirname, "..", "target", "idl", "proof_of_inference.json");
  if (!fs.existsSync(idlPath)) {
    console.error("  ERROR: target/idl/proof_of_inference.json not found.");
    console.error("  Run `anchor build` (Anchor CLI >= 1.0.0) first.");
    console.error("  Tip: `avm use 1.0.0` if your active CLI is older.");
    process.exit(1);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const programId = idl.address;
  if (!programId) {
    console.error("  ERROR: target/idl/proof_of_inference.json has no `address` field.");
    process.exit(1);
  }
  console.log("  Program ID:", programId);

  const programInfo = await connection.getAccountInfo(
    new (await import("@solana/web3.js")).PublicKey(programId)
  );
  if (programInfo) {
    console.log("  Program already deployed on devnet.");
  } else {
    console.log("  Program NOT deployed. Deploy with:");
    console.log("    anchor deploy --provider.cluster devnet");
    console.log("  Then re-run this script.");
    process.exit(1);
  }

  // 3. Create devnet token mint (6 decimals, like USDC)
  console.log("\n[3/6] Creating devnet token mint...");
  const mint = await createMint(
    connection,
    deployer,
    deployer.publicKey,
    null,
    6 // decimals
  );
  console.log("  Mint:", mint.toBase58());

  // 4. Create protocol fee vault. Its owner must differ from the requester
  //    (otherwise the fee transfer is a self-transfer), and it must be persisted
  //    — a generated-then-discarded owner keypair permanently locks every fee
  //    the protocol ever collects.
  console.log("\n[4/6] Creating protocol fee vault token account...");
  const vaultOwnerPath = path.join(__dirname, "fee-vault-owner.json");
  let vaultOwner;
  if (fs.existsSync(vaultOwnerPath)) {
    vaultOwner = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(vaultOwnerPath, "utf8")))
    );
    console.log("  Reusing vault owner from", vaultOwnerPath);
  } else {
    vaultOwner = Keypair.generate();
    fs.writeFileSync(
      vaultOwnerPath,
      JSON.stringify(Array.from(vaultOwner.secretKey))
    );
    console.log("  Vault owner keypair written to", vaultOwnerPath);
  }
  console.log("  Vault owner:", vaultOwner.publicKey.toBase58());
  const protocolFeeVault = await getOrCreateAssociatedTokenAccount(
    connection,
    deployer,   // payer (deployer pays rent)
    mint,
    vaultOwner.publicKey
  );
  console.log("  Fee vault:", protocolFeeVault.address.toBase58());

  // 5. Create requester token account + mint test tokens
  console.log("\n[5/6] Creating requester token account and minting test tokens...");
  const requesterAta = await getOrCreateAssociatedTokenAccount(
    connection,
    deployer,
    mint,
    deployer.publicKey
  );

  // Mint 100 tokens (100_000_000 smallest units at 6 decimals)
  await mintTo(
    connection,
    deployer,
    mint,
    requesterAta.address,
    deployer.publicKey,
    100_000_000
  );
  console.log("  Requester ATA:", requesterAta.address.toBase58());
  console.log("  Minted: 100 test tokens");

  // 6. Initialize the singleton ProtocolConfig. `request_inference` constrains
  //    the fee vault against this account, so nothing works until it exists.
  console.log("\n[6/6] Initializing protocol config...");
  const { PublicKey } = await import("@solana/web3.js");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(deployer),
    { commitment: "confirmed" }
  );
  const program = new anchor.Program(idl, provider);
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    new PublicKey(programId)
  );
  const existingConfig = await program.account.protocolConfig.fetchNullable(
    configPda
  );
  if (existingConfig) {
    console.log("  Config already initialized at", configPda.toBase58());
    console.log("  Pinned fee vault:", existingConfig.feeVault.toBase58());
    console.log(
      "  NOTE: the vault above is the one the program will accept — the vault\n" +
        "        created in step 4 is ignored unless you call update_protocol."
    );
  } else {
    await program.methods
      .initializeProtocol()
      .accounts({
        protocolConfig: configPda,
        feeVault: protocolFeeVault.address,
        authority: deployer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  Config:", configPda.toBase58());
    console.log("  Authority:", deployer.publicKey.toBase58());
  }

  // Print env vars
  console.log("\n=== Add these to app/.env ===\n");
  const envLines = [
    `VITE_SOLANA_CLUSTER=devnet`,
    `# VITE_SOLANA_RPC_URL=https://api.devnet.solana.com`,
    `VITE_REQUESTER_TOKEN_ACCOUNT=${requesterAta.address.toBase58()}`,
    `VITE_PROTOCOL_FEE_VAULT=${protocolFeeVault.address.toBase58()}`,
    `VITE_TOKEN_MINT=${mint.toBase58()}`,
  ];
  envLines.forEach((l) => console.log(l));

  // Merge into app/.env rather than overwriting it — a plain write would drop
  // VITE_MXE_PROGRAM_ID and any RPC override already configured there.
  const envPath = path.join(__dirname, "..", "app", ".env");
  const existing = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf8").split("\n")
    : [];
  const managed = new Set(
    envLines
      .filter((l) => !l.startsWith("#"))
      .map((l) => l.split("=")[0])
  );
  const preserved = existing.filter((line) => {
    const key = line.split("=")[0];
    return line.trim() !== "" && !managed.has(key);
  });
  fs.writeFileSync(envPath, [...preserved, ...envLines].join("\n") + "\n");
  console.log("\n  Merged into", envPath);

  console.log("\n=== Setup Complete ===");
  console.log("Now run: cd app && npm run dev");
  console.log("Connect your Solana wallet (same deployer wallet or airdrop to another).\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
