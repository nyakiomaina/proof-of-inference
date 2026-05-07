import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import type { VerifiedInferenceRecord } from "./useDemoState";
import { loadInferenceDecryptSecrets } from "../lib/inferenceDecryptStorage";
import {
  hexStringToBytes,
  mpcPlaintextToJson,
  tryDecryptMpcOutputPayloadFromSecrets,
} from "../lib/mpcOutputDecrypt";

function needsHexDecrypt(outputData: string): boolean {
  const t = outputData.trim();
  return /^[0-9a-f]+$/i.test(t) && t.length >= 128;
}

/**
 * For Verified MPC rows loaded from chain as ciphertext hex, decrypt client-side
 * when this wallet still has the ephemeral secret from the run (localStorage).
 */
export function useDecryptedMpcOutputs(
  inferences: VerifiedInferenceRecord[]
): Record<string, string> {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [map, setMap] = useState<Record<string, string>>({});

  const signature = useMemo(() => {
    return inferences
      .filter((i) => i.status === "Verified" && i.route === "MPC")
      .map((i) => `${i.pda}:${i.outputData}`)
      .join("|");
  }, [inferences]);

  useEffect(() => {
    if (!publicKey || !signTransaction) {
      setMap({});
      return;
    }
    const mxeRaw = import.meta.env.VITE_MXE_PROGRAM_ID as string | undefined;
    if (!mxeRaw) return;

    let cancelled = false;
    const provider = new AnchorProvider(
      connection,
      {
        publicKey,
        signTransaction,
        signAllTransactions: async (txs: any[]) => txs,
      } as any,
      AnchorProvider.defaultOptions()
    );

    (async () => {
      const mxeProgramId = new PublicKey(mxeRaw);
      const walletStr = publicKey.toBase58();
      const next: Record<string, string> = {};

      for (const inf of inferences) {
        if (inf.status !== "Verified" || inf.route !== "MPC") continue;
        if (!needsHexDecrypt(inf.outputData)) continue;

        const secrets = loadInferenceDecryptSecrets(walletStr, inf.pda);
        if (!secrets) continue;

        const raw = hexStringToBytes(inf.outputData);
        if (!raw || (raw.length !== 64 && raw.length !== 80)) continue;

        const pt = await tryDecryptMpcOutputPayloadFromSecrets(
          provider,
          mxeProgramId,
          raw,
          secrets.ephemeralSecret,
          secrets.encryptionNonce
        );
        if (pt) next[inf.pda] = mpcPlaintextToJson(pt);
      }

      if (!cancelled) setMap(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [connection, publicKey, signTransaction, signature]);

  return map;
}
