import { useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Program } from "@coral-xyz/anchor";
import { classifyRoute, type VerifiedInferenceRecord } from "./useDemoState";

const STATUS_FROM_VARIANT = (
  raw: any
): "Pending" | "Verified" | "Failed" => {
  if (!raw || typeof raw !== "object") return "Pending";
  const key = Object.keys(raw)[0]?.toLowerCase();
  if (key === "verified") return "Verified";
  if (key === "failed") return "Failed";
  return "Pending";
};

function bytesToHex(bytes: number[] | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToString(bytes: number[] | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // Try to decode as UTF-8 (JSON-like outputs); fall back to hex.
  try {
    const str = new TextDecoder("utf-8", { fatal: true }).decode(arr);
    if (/^[\x20-\x7e\s]*$/.test(str)) return str;
  } catch {
    /* not utf-8, fall through */
  }
  return bytesToHex(arr);
}

/**
 * Loads every `VerifiedInference` PDA whose `requester` matches the connected
 * wallet, and pushes them into shared state on mount. Without this hook,
 * inferences submitted in a previous browser session disappear after a
 * page refresh even though they remain on chain.
 *
 * `requester` lives after a dynamic-length `output_data` field, so we can't
 * memcmp it. We fetch all and filter client-side. Fine for a hackathon demo;
 * swap to an indexer if/when this scales.
 */
export function useOnChainInferences(
  program: Program | null,
  onLoaded: (records: VerifiedInferenceRecord[]) => void
) {
  const { publicKey } = useWallet();

  useEffect(() => {
    if (!program || !publicKey) return;

    let cancelled = false;
    (async () => {
      try {
        const accounts = await (program.account as any).verifiedInference.all();
        const wallet = publicKey.toBase58();

        const mine: VerifiedInferenceRecord[] = accounts
          .filter((a: any) => {
            const req = a.account.requester;
            return req && req.toBase58() === wallet;
          })
          .map((a: any): VerifiedInferenceRecord => {
            const acc = a.account;
            const outputBytes = (acc.outputData ?? []) as number[];
            return {
              pda: a.publicKey.toBase58(),
              modelPda: acc.model.toBase58(),
              modelCommitment: bytesToHex(acc.modelCommitment),
              inputHash: bytesToHex(acc.inputHash),
              outputHash: bytesToHex(acc.outputHash),
              outputData: bytesToString(outputBytes),
              nodeCount: Number(acc.nodeCount ?? 0),
              cluster: acc.arciumCluster.toBase58(),
              timestamp: Number(acc.timestamp ?? 0),
              status: STATUS_FROM_VARIANT(acc.status),
              requester: acc.requester.toBase58(),
              tx: "",
              route: classifyRoute(outputBytes.length),
            };
          })
          .sort(
            (a: VerifiedInferenceRecord, b: VerifiedInferenceRecord) =>
              b.timestamp - a.timestamp
          );

        if (!cancelled) onLoaded(mine);
      } catch (err) {
        console.warn("Could not load on-chain inferences:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [program, publicKey?.toBase58()]);
}
