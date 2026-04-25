import React, { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { AnchorProvider, Program, Idl, BN } from "@coral-xyz/anchor";
import type {
  RegisteredModel,
  VerifiedInferenceRecord,
} from "../hooks/useDemoState";
import { ConnectWalletGate } from "./ConnectWalletGate";
import { useProgram, findInferencePda } from "../hooks/useProgram";
import { createMxeRescueCipher, RescueCipher } from "../lib/arciumInference";
import mxeIdlJson from "../../mxe_idl.json";
import {
  getCompDefAccOffset,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getCompDefAccAddress,
  deserializeLE,
} from "@arcium-hq/client";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface Props {
  models: RegisteredModel[];
  onInferenceCreated: (inf: VerifiedInferenceRecord) => void;
  onInferenceVerified: (pda: string, updates: Partial<VerifiedInferenceRecord>) => void;
  onModelIncrement: (modelPda: string) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
}

// Arcium cluster offset — cluster-dependent (see mxe/poi_mxe/Arcium.toml:
// devnet = 456, mainnet = 2026). Override with VITE_ARCIUM_CLUSTER_OFFSET.
const ARCIUM_CLUSTER_OFFSET = (() => {
  const raw = import.meta.env.VITE_ARCIUM_CLUSTER_OFFSET;
  if (raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(
        `VITE_ARCIUM_CLUSTER_OFFSET must be a non-negative integer, got: ${raw}`
      );
    }
    return n;
  }
  const cluster = (import.meta.env.VITE_SOLANA_CLUSTER ?? "devnet").toLowerCase();
  if (cluster === "mainnet-beta" || cluster === "mainnet") return 2026;
  return 456;
})();

// MXE IDL is synced by scripts/sync-mxe-idl.cjs. A stub is written when
// `arcium build` hasn't run yet. Detect that and degrade gracefully.
const MXE_IDL_AVAILABLE =
  !(mxeIdlJson as any)?._stub && Array.isArray((mxeIdlJson as any)?.instructions);

export function RunInferencePanel({
  models,
  onInferenceCreated,
  onInferenceVerified,
  onModelIncrement,
  loading,
  setLoading,
}: Props) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const { program } = useProgram();
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [inputText, setInputText] = useState("");
  const [currentInference, setCurrentInference] =
    useState<VerifiedInferenceRecord | null>(null);
  const [phase, setPhase] = useState<
    "idle" | "encrypting" | "submitting" | "polling" | "verified" | "done"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  const model = models.find((m) => m.pda === selectedModel);
  const canSubmit =
    Boolean(publicKey) &&
    Boolean(program) &&
    model &&
    inputText.trim().length > 0 &&
    phase === "idle" &&
    !loading;

  const mxeProgramId = import.meta.env.VITE_MXE_PROGRAM_ID;
  const requesterTokenAddr = import.meta.env.VITE_REQUESTER_TOKEN_ACCOUNT;
  const feeVaultAddr = import.meta.env.VITE_PROTOCOL_FEE_VAULT;

  async function handleSubmit() {
    if (!model || !publicKey || !program || !signTransaction) return;
    setLoading(true);
    setError(null);
    setCurrentInference(null);

    try {
      // Phase 1: Encrypt input via Arcium Rescue cipher (if MXE configured)
      setPhase("encrypting");

      const provider = new AnchorProvider(
        connection,
        { publicKey, signTransaction, signAllTransactions: async (txs: any[]) => txs } as any,
        AnchorProvider.defaultOptions()
      );

      const textBytes = new TextEncoder().encode(inputText.trim());
      const hashBuf = await crypto.subtle.digest(
        "SHA-256",
        textBytes.buffer as ArrayBuffer
      );
      const hashArr = new Uint8Array(hashBuf);

      // Model weights (u8) for the demo classifier — match encrypted-ixs/src/lib.rs.
      const w0 = BigInt(3);
      const w1 = BigInt(2);
      const bias = BigInt(10);
      const threshold = BigInt(50);
      const f0 = BigInt(hashArr[0]);
      const f1 = BigInt(hashArr[1]);
      const plaintext = [w0, w1, bias, threshold, f0, f1];

      // Attempt real encryption when an MXE is configured. If the MXE public
      // key cannot be fetched (program not deployed / cluster mismatch), fall
      // back to plaintext-hash tracking so the main program flow still works.
      let ciphertexts: number[][] | null = null;
      let ephemeralPublicKey: Uint8Array | null = null;
      let ephemeralSecret: Uint8Array | null = null;
      let encryptionNonce: Uint8Array | null = null;
      let cipher: RescueCipher | null = null;
      let encryptedInputBytes: Uint8Array = textBytes;

      if (mxeProgramId && MXE_IDL_AVAILABLE) {
        try {
          const mxePubkey = new PublicKey(mxeProgramId);
          const enc = await createMxeRescueCipher(provider, mxePubkey);
          cipher = enc.cipher;
          ephemeralPublicKey = enc.ephemeralPublicKey;
          ephemeralSecret = enc.ephemeralSecret;
          encryptionNonce = enc.nonce;
          ciphertexts = cipher.encrypt(plaintext, encryptionNonce);
          // Flatten all ciphertexts + ephemeral pubkey + nonce into a single
          // byte blob. `encrypted_input` in request_inference stores this.
          const ctBytes = ciphertexts.reduce<number[]>(
            (acc, ct) => acc.concat(ct),
            []
          );
          encryptedInputBytes = new Uint8Array([
            ...ctBytes,
            ...Array.from(ephemeralPublicKey),
            ...Array.from(encryptionNonce),
          ]);
        } catch (encErr: any) {
          console.warn(
            "Arcium encryption unavailable; submitting plaintext-hash for tracking:",
            encErr?.message ?? encErr
          );
        }
      }

      // Phase 2: Submit on-chain
      setPhase("submitting");

      const modelPda = new PublicKey(model.pda);
      const inferenceNonce = new Uint8Array(32);
      crypto.getRandomValues(inferenceNonce);
      const [inferencePda] = findInferencePda(modelPda, inferenceNonce);

      if (!requesterTokenAddr || !feeVaultAddr) {
        throw new Error(
          "Set VITE_REQUESTER_TOKEN_ACCOUNT and VITE_PROTOCOL_FEE_VAULT in app/.env."
        );
      }

      const tx = await program.methods
        .requestInference(Buffer.from(encryptedInputBytes), Array.from(inferenceNonce))
        .accounts({
          modelRegistry: modelPda,
          verifiedInference: inferencePda,
          requester: publicKey,
          requesterToken: new PublicKey(requesterTokenAddr),
          protocolFeeVault: new PublicKey(feeVaultAddr),
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .rpc();

      const inference: VerifiedInferenceRecord = {
        pda: inferencePda.toBase58(),
        modelPda: model.pda,
        modelCommitment: model.weightCommitment,
        inputHash: toHex(hashArr.slice(0, 16)),
        outputHash: "",
        outputData: "",
        nodeCount: 0,
        cluster: "",
        timestamp: Math.floor(Date.now() / 1000),
        status: "Pending",
        requester: publicKey.toBase58(),
        tx,
      };
      onInferenceCreated(inference);
      setCurrentInference(inference);

      // Queue MXE computation if the IDL and ciphertexts are both available.
      if (
        MXE_IDL_AVAILABLE &&
        ciphertexts &&
        ephemeralPublicKey &&
        encryptionNonce &&
        mxeProgramId
      ) {
        try {
          const mxePubkey = new PublicKey(mxeProgramId);
          const mxeProgram = new Program(mxeIdlJson as unknown as Idl, provider);
          const offsetBytes = crypto.getRandomValues(new Uint8Array(8));
          const computationOffset = new BN(Array.from(offsetBytes), "le");

          await mxeProgram.methods
            .runInference(
              computationOffset,
              ciphertexts.map((ct) => Array.from(ct)),
              Array.from(ephemeralPublicKey),
              new BN(deserializeLE(encryptionNonce).toString()),
            )
            .accountsPartial({
              payer: publicKey,
              computationAccount: getComputationAccAddress(
                ARCIUM_CLUSTER_OFFSET,
                computationOffset
              ),
              clusterAccount: getClusterAccAddress(ARCIUM_CLUSTER_OFFSET),
              mxeAccount: getMXEAccAddress(mxePubkey),
              mempoolAccount: getMempoolAccAddress(ARCIUM_CLUSTER_OFFSET),
              executingPool: getExecutingPoolAccAddress(ARCIUM_CLUSTER_OFFSET),
              compDefAccount: getCompDefAccAddress(
                mxePubkey,
                Buffer.from(getCompDefAccOffset("run_inference")).readUInt32LE()
              ),
            })
            .rpc({ skipPreflight: true });
        } catch (mxeErr: any) {
          console.warn(
            "MXE queue failed (falling back to relayer / devnet-callback):",
            mxeErr?.message ?? mxeErr
          );
        }
      }

      // Phase 3: Poll for callback (from MXE callback, or from the relayer /
      // devnet-callback script that writes output_data on the main program).
      setPhase("polling");
      const verified = await pollForVerification(program, inferencePda, 90);

      if (verified) {
        const account = await (program.account as any).verifiedInference.fetch(
          inferencePda
        );
        const rawOutput = new Uint8Array(account.outputData as number[]);
        const decoded = decodeOutput(rawOutput, cipher, encryptionNonce);
        const updates: Partial<VerifiedInferenceRecord> = {
          outputHash: toHex(new Uint8Array(account.outputHash as number[])),
          outputData: decoded,
          nodeCount: account.nodeCount as number,
          cluster: (account.arciumCluster as PublicKey).toBase58(),
          status: "Verified",
        };
        onInferenceVerified(inferencePda.toBase58(), updates);
        onModelIncrement(model.pda);
        setCurrentInference((prev) => (prev ? { ...prev, ...updates } : prev));
        setPhase("verified");
      } else {
        setPhase("done");
      }
    } catch (err: any) {
      console.error("Inference failed:", err);
      setError(err.message ?? String(err));
      setPhase("idle");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setPhase("idle");
    setCurrentInference(null);
    setInputText("");
    setError(null);
  }

  return (
    <div className="card">
      <div className="card-header">Run inference</div>

      {models.length === 0 ? (
        <p className="text-sm text-gray-600 py-6 text-center">
          Register a model first.
        </p>
      ) : (
        <ConnectWalletGate>
          <div className="space-y-3">
            <div>
              <label className="label">Model</label>
              <select
                className="input"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                <option value="">Select a model</option>
                {models.map((m) => (
                  <option key={m.pda} value={m.pda}>
                    {m.name} v{m.version}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Input</label>
              <textarea
                className="input min-h-[72px] resize-y"
                placeholder="Text to classify"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={phase !== "idle"}
              />
            </div>

            {phase === "idle" ? (
              <button className="btn-green w-full" disabled={!canSubmit} onClick={handleSubmit}>
                Run inference
              </button>
            ) : phase === "verified" || phase === "done" ? (
              <button className="btn-outline w-full" onClick={handleReset}>
                New inference
              </button>
            ) : null}

            {/* Progress */}
            {phase !== "idle" && (
              <div className="space-y-1.5 pt-2">
                <Step label="Encrypting with Arcium SDK" status={stepStatus("encrypting", phase)} />
                <Step label="Submitting on-chain" status={stepStatus("submitting", phase)} />
                <Step label="Waiting for MPC callback" status={stepStatus("polling", phase)} />
                <Step label="Verified" status={stepStatus("verified", phase)} />
              </div>
            )}

            {!MXE_IDL_AVAILABLE && phase === "idle" && (
              <div className="p-2.5 bg-yellow-500/5 border border-yellow-500/20 rounded-md text-[11px] text-yellow-400/80">
                MXE IDL not synced. Inference will track on-chain but real MPC
                queueing is skipped. Build with <code>arcium build</code> and
                run <code>npm run sync-idl</code>, or start the relayer
                (<code>npm run listen:inference</code>) for auto-finalization.
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-md text-xs text-red-400 whitespace-pre-wrap">
                {error}
              </div>
            )}

            {currentInference?.status === "Verified" && (
              <div className="p-3 bg-gray-800/30 rounded-md border border-emerald-500/20 space-y-1.5 text-xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="badge-verified">Verified</span>
                  <span className="text-gray-600">{currentInference.nodeCount} nodes</span>
                </div>
                <Row label="PDA" value={currentInference.pda} mono />
                <Row label="Output" value={summarizeOutput(currentInference.outputData)} />
                <Row label="Cluster" value={currentInference.cluster} mono />
                <Row label="TX" value={currentInference.tx} mono link />
              </div>
            )}

            {currentInference?.status === "Pending" && phase === "done" && (
              <div className="p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-md text-xs text-gray-400">
                <span className="badge-pending mb-2 inline-block">Pending</span>
                <p>Inference submitted. Waiting for Arcium MPC callback.</p>
                <p className="mt-1">Start the relayer to auto-finalize:</p>
                <code className="block mt-2 text-gray-600 bg-gray-950 p-2 rounded text-[11px]">
                  npm run listen:inference
                </code>
                <p className="mt-2">Or run a single manual callback:</p>
                <code className="block mt-1 text-gray-600 bg-gray-950 p-2 rounded text-[11px]">
                  node scripts/devnet-callback.js {currentInference.pda}
                </code>
              </div>
            )}
          </div>
        </ConnectWalletGate>
      )}
    </div>
  );
}

async function pollForVerification(
  program: any,
  inferencePda: PublicKey,
  timeoutSec: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    try {
      const account = await program.account.verifiedInference.fetch(inferencePda);
      if (account.status && "verified" in (account.status as object)) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

/**
 * Normalizes the raw on-chain `output_data` bytes into a JSON string that the
 * rest of the UI understands. Three wire formats are handled:
 *
 *   1. Arcium MPC ciphertext blob: exactly 64 bytes (classification_ct[32] +
 *      score_ct[32]). Decrypted in place if we still hold the cipher + nonce.
 *   2. Plain JSON string (what scripts/devnet-callback.js writes).
 *   3. Arbitrary bytes (fallback — stringified hex so nothing is lost).
 */
function decodeOutput(
  raw: Uint8Array,
  cipher: RescueCipher | null,
  nonce: Uint8Array | null
): string {
  if (raw.length === 0) return "";

  if (raw.length === 64 && cipher && nonce) {
    try {
      const classificationCt = Array.from(raw.slice(0, 32));
      const scoreCt = Array.from(raw.slice(32, 64));
      const values = cipher.decrypt([classificationCt, scoreCt], nonce);
      const classification = Number(values[0]);
      const score = Number(values[1]);
      const label = labelFor(classification);
      // score is a u16 in the circuit; derive confidence from threshold 50
      const confidence = Math.max(0, Math.min(1, score / 100));
      return JSON.stringify({ classification, label, score, confidence });
    } catch (e) {
      console.warn("MPC ciphertext decryption failed; falling back.", e);
    }
  }

  try {
    const asText = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    JSON.parse(asText);
    return asText;
  } catch {}

  return JSON.stringify({
    raw: Array.from(raw).map((b) => b.toString(16).padStart(2, "0")).join(""),
  });
}

function labelFor(classification: number): string {
  switch (classification) {
    case 0:
      return "Negative";
    case 1:
      return "Neutral";
    case 2:
      return "Positive";
    default:
      return "Unknown";
  }
}

function summarizeOutput(outputData: string): string {
  if (!outputData) return "";
  try {
    const parsed = JSON.parse(outputData);
    if (parsed.label) {
      if (typeof parsed.confidence === "number") {
        return `${parsed.label} (${(parsed.confidence * 100).toFixed(1)}%)`;
      }
      if (typeof parsed.score === "number") {
        return `${parsed.label} (score ${parsed.score})`;
      }
      return parsed.label;
    }
    return outputData;
  } catch {
    return outputData;
  }
}

type StepPhase = "encrypting" | "submitting" | "polling" | "verified" | "done";
const PHASE_ORDER: StepPhase[] = ["encrypting", "submitting", "polling", "verified", "done"];

function stepStatus(step: StepPhase, current: string): "pending" | "active" | "done" {
  const s = PHASE_ORDER.indexOf(step);
  const c = PHASE_ORDER.indexOf(current as StepPhase);
  if (c > s) return "done";
  if (c === s) return "active";
  return "pending";
}

function Step({ label, status }: { label: string; status: "pending" | "active" | "done" }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {status === "done" ? (
        <span className="text-emerald-400">+</span>
      ) : status === "active" ? (
        <span className="text-gray-300 animate-pulse">~</span>
      ) : (
        <span className="text-gray-700">-</span>
      )}
      <span className={
        status === "done" ? "text-gray-500" : status === "active" ? "text-gray-300" : "text-gray-700"
      }>{label}</span>
    </div>
  );
}

function Row({ label, value, mono, link }: { label: string; value: string; mono?: boolean; link?: boolean }) {
  const cluster = import.meta.env.VITE_SOLANA_CLUSTER || "devnet";
  return (
    <div className="flex gap-2">
      <span className="text-gray-600 shrink-0">{label}</span>
      {link ? (
        <a
          href={`https://explorer.solana.com/tx/${value}?cluster=${cluster}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-400 hover:text-gray-200 font-mono truncate"
        >
          {value}
        </a>
      ) : (
        <span className={`text-gray-400 truncate ${mono ? "font-mono" : ""}`}>{value}</span>
      )}
    </div>
  );
}
