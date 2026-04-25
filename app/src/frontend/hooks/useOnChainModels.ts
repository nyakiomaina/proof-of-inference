import { useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Program } from "@coral-xyz/anchor";
import type { RegisteredModel } from "./useDemoState";

const MODEL_TYPE_FROM_VARIANT = (raw: any): string => {
  if (!raw || typeof raw !== "object") return "Unknown";
  const key = Object.keys(raw)[0];
  if (!key) return "Unknown";
  return key.charAt(0).toUpperCase() + key.slice(1);
};

function bytesToHex(bytes: number[] | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Loads every `ModelRegistry` PDA owned by the connected wallet and pushes
 * them into shared state. Keeps UI in sync with devnet on page reloads and
 * prevents "already in use" errors from re-registering the same model.
 */
export function useOnChainModels(
  program: Program | null,
  onLoaded: (models: RegisteredModel[]) => void
) {
  const { publicKey } = useWallet();

  useEffect(() => {
    if (!program || !publicKey) return;

    let cancelled = false;
    (async () => {
      try {
        const accounts = await (program.account as any).modelRegistry.all([
          {
            memcmp: {
              // Account layout: [8-byte discriminator][owner: Pubkey 32b]...
              offset: 8,
              bytes: publicKey.toBase58(),
            },
          },
        ]);

        const loaded: RegisteredModel[] = accounts.map((a: any) => {
          const acc = a.account;
          return {
            pda: a.publicKey.toBase58(),
            owner: (acc.owner as any).toBase58(),
            name: acc.modelName as string,
            version: Number(acc.modelVersion),
            type: MODEL_TYPE_FROM_VARIANT(acc.modelType),
            weightCommitment: bytesToHex(acc.weightCommitment),
            totalInferences: Number(acc.totalInferences ?? 0),
            createdAt: Number(acc.createdAt ?? 0),
            tx: "",
          };
        });

        if (!cancelled) onLoaded(loaded);
      } catch (err) {
        console.warn("Could not load on-chain models:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [program, publicKey?.toBase58()]);
}
