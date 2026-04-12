#!/usr/bin/env node
/**
 * Subscribe to transaction logs mentioning the Proof of Inference program.
 * Useful while wiring a custom indexer; it does not run MPC or callbacks.
 *
 * Usage:
 *   POI_PROGRAM_ID=CCdibNmqNCG58v4fVjAKvwXora2ekGYToUTTQF6QVmuh \
 *   RPC_URL=http://127.0.0.1:8899 \
 *   node scripts/watch-inference-requested.cjs
 */
const { Connection, PublicKey } = require("@solana/web3.js");

const programIdStr =
  process.env.POI_PROGRAM_ID ||
  "CCdibNmqNCG58v4fVjAKvwXora2ekGYToUTTQF6QVmuh";
const rpc =
  process.env.RPC_URL || process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";

const programId = new PublicKey(programIdStr);
const connection = new Connection(rpc, "confirmed");

console.error(`Listening for logs (mentions ${programIdStr}) on ${rpc}`);

const subId = connection.onLogs(
  programId,
  (ev, ctx) => {
    const hit = ev.logs.some(
      (l) =>
        l.includes("InferenceRequested") ||
        l.includes("InferenceVerified") ||
        l.includes("InferenceFailed")
    );
    if (!hit) return;
    console.log(
      JSON.stringify(
        {
          signature: ev.signature,
          slot: ctx.slot,
          err: ev.err,
          logs: ev.logs,
        },
        null,
        2
      )
    );
  },
  "confirmed"
);

process.on("SIGINT", () => {
  connection.removeOnLogsListener(subId).then(() => process.exit(0));
});
