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
import { createMxeRescueCipher } from "../lib/arciumInference";
import {
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
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

// Arcium devnet cluster offset (from Arcium.toml)
const ARCIUM_CLUSTER_OFFSET = 456;

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
      if (!mxeProgramId) {
        throw new Error("Set VITE_MXE_PROGRAM_ID in app/.env (the MXE scaffold program ID).");
      }

      const mxePubkey = new PublicKey(mxeProgramId);

      // Phase 1: Encrypt input with Arcium SDK
      setPhase("encrypting");

      const provider = new AnchorProvider(
        connection,
        { publicKey, signTransaction, signAllTransactions: async (txs: any[]) => txs } as any,
        AnchorProvider.defaultOptions()
      );

      const { cipher, ephemeralPublicKey, nonce } = await createMxeRescueCipher(
        provider,
        mxePubkey
      );

      // Convert input text to numeric features (simple hash-based encoding)
      const textBytes = new TextEncoder().encode(inputText.trim());
      const hashBuf = await crypto.subtle.digest("SHA-256", textBytes.buffer as ArrayBuffer);
      const hashArr = new Uint8Array(hashBuf);

      // Model weights (u8): simple fixed weights for the demo classifier
      const w0 = BigInt(3);
      const w1 = BigInt(2);
      const bias = BigInt(10);
      const threshold = BigInt(50);
      // Features derived from input hash
      const f0 = BigInt(hashArr[0]);
      const f1 = BigInt(hashArr[1]);

      // Encrypt all 6 values: [w0, w1, bias, threshold, f0, f1]
      const plaintext = [w0, w1, bias, threshold, f0, f1];
      const ciphertexts = cipher.encrypt(plaintext, nonce);

      // Phase 2: Submit on-chain
      setPhase("submitting");

      // Also submit to the main proof-of-inference program for tracking
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
        .requestInference(Buffer.from(textBytes), Array.from(inferenceNonce))
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

      // Now queue the MXE computation
      try {
        const mxeIdlResp = await fetch(`/target/idl/poi_mxe_scaffold.json`);
        if (mxeIdlResp.ok) {
          const mxeIdl = await mxeIdlResp.json();
          const mxeProgram = new Program(mxeIdl as Idl, provider);
          const computationOffset = new BN(crypto.getRandomValues(new Uint8Array(8)));

          await mxeProgram.methods
            .runInference(
              computationOffset,
              ciphertexts.map((ct: any) => Array.from(ct)),
              Array.from(ephemeralPublicKey),
              new BN(deserializeLE(nonce).toString()),
            )
            .accountsPartial({
              payer: publicKey,
              computationAccount: getComputationAccAddress(ARCIUM_CLUSTER_OFFSET, computationOffset),
              clusterAccount: getClusterAccAddress(ARCIUM_CLUSTER_OFFSET),
              mxeAccount: getMXEAccAddress(mxePubkey),
              mempoolAccount: getMempoolAccAddress(ARCIUM_CLUSTER_OFFSET),
              executingPool: getExecutingPoolAccAddress(ARCIUM_CLUSTER_OFFSET),
              compDefAccount: getCompDefAccAddress(
                mxePubkey,
                Buffer.from(getCompDefAccOffset("run_inference")).readUInt32LE(),
              ),
            })
            .rpc({ skipPreflight: true });
        }
      } catch (mxeErr: any) {
        console.warn("MXE queue failed (may need localnet):", mxeErr.message);
      }

      // Phase 3: Poll for callback
      setPhase("polling");
      const verified = await pollForVerification(program, inferencePda, 90);

      if (verified) {
        const account = await (program.account as any).verifiedInference.fetch(inferencePda);
        const updates: Partial<VerifiedInferenceRecord> = {
          outputHash: toHex(new Uint8Array(account.outputHash as number[])),
          outputData: Buffer.from(account.outputData as number[]).toString("utf8"),
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
                <Row label="Output" value={currentInference.outputData} />
                <Row label="Cluster" value={currentInference.cluster} mono />
                <Row label="TX" value={currentInference.tx} mono link />
              </div>
            )}

            {currentInference?.status === "Pending" && phase === "done" && (
              <div className="p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-md text-xs text-gray-400">
                <span className="badge-pending mb-2 inline-block">Pending</span>
                <p>Inference submitted. Waiting for Arcium MPC callback.</p>
                <code className="block mt-2 text-gray-600 bg-gray-950 p-2 rounded text-[11px]">
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
