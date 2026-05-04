#!/usr/bin/env node
/**
 * Full-scan RPC helper: decode every VerifiedInference account and print those
 * whose requester matches REQUESTER_WALLET. Same trade-offs as the demo UI hook
 * (fine for hackathon scale; use logs/indexers for production volume).
 *
 * Usage:
 *   RPC_URL=https://api.devnet.solana.com \
 *   POI_PROGRAM_ID=5s7exNede5PNdwQYH6vguTGNV6K2iT5nQWo1SLrMGWgh \
 *   REQUESTER_WALLET=<pubkey> \
 *   node scripts/fetch-user-inferences.cjs
 *
 * Requires `anchor build` first so `target/idl/proof_of_inference.json` exists.
 */

const fs = require("fs");
const path = require("path");
const anchor = require("@coral-xyz/anchor");
const bs58 = require("bs58");
const { Connection, PublicKey } = require("@solana/web3.js");

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const PROGRAM_ID =
  process.env.POI_PROGRAM_ID ||
  "5s7exNede5PNdwQYH6vguTGNV6K2iT5nQWo1SLrMGWgh";
const WALLET = process.env.REQUESTER_WALLET;

const idlPath = path.join(__dirname, "..", "target", "idl", "proof_of_inference.json");

function statusLabel(status) {
  if (!status || typeof status !== "object") return "unknown";
  const k = Object.keys(status)[0];
  return k || "unknown";
}

async function main() {
  if (!WALLET) {
    console.error("REQUESTER_WALLET env var is required (base58 pubkey).");
    process.exit(1);
  }

  if (!fs.existsSync(idlPath)) {
    console.error(`IDL not found at ${idlPath}. Run \`anchor build\` first.`);
    process.exit(1);
  }

  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const coder = new anchor.BorshAccountsCoder(idl);
  const connection = new Connection(RPC_URL, "confirmed");
  const programPk = new PublicKey(PROGRAM_ID);

  const disc = coder.accountDiscriminator("VerifiedInference");
  const raw = await connection.getProgramAccounts(programPk, {
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(disc) } }],
  });

  const walletStr = new PublicKey(WALLET).toBase58();
  const rows = [];

  for (const { pubkey, account } of raw) {
    try {
      const dec = coder.decode("VerifiedInference", account.data);
      if (!dec.requester) continue;
      const req = dec.requester.toBase58();
      if (req !== walletStr) continue;
      rows.push({
        pda: pubkey.toBase58(),
        model: dec.model.toBase58(),
        status: statusLabel(dec.status),
        timestamp: dec.timestamp?.toNumber?.() ?? Number(dec.timestamp),
        outputLen: dec.outputData?.length ?? 0,
      });
    } catch {
      /* skip malformed */
    }
  }

  rows.sort((a, b) => b.timestamp - a.timestamp);

  console.log(
    JSON.stringify(
      {
        rpc: RPC_URL,
        program: PROGRAM_ID,
        requester: walletStr,
        count: rows.length,
        inferences: rows,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
