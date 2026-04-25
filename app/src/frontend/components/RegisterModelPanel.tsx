import React, { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { SystemProgram, PublicKey } from "@solana/web3.js";
import type { RegisteredModel } from "../hooks/useDemoState";
import { ConnectWalletGate } from "./ConnectWalletGate";
import { useProgram, findModelPda } from "../hooks/useProgram";

const MODEL_TYPES = [
  "SentimentClassifier",
  "TextClassifier",
  "RiskScorer",
  "AnomalyDetector",
  "CustomClassifier",
] as const;

const MODEL_TYPE_VARIANTS: Record<string, object> = {
  SentimentClassifier: { sentimentClassifier: {} },
  TextClassifier: { textClassifier: {} },
  RiskScorer: { riskScorer: {} },
  AnomalyDetector: { anomalyDetector: {} },
  CustomClassifier: { customClassifier: {} },
};

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", encoded.buffer as ArrayBuffer);
  return new Uint8Array(buf);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomBytes32(): Uint8Array {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return arr;
}

interface Props {
  onRegister: (model: RegisteredModel) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
}

export function RegisterModelPanel({ onRegister, loading, setLoading }: Props) {
  const { publicKey } = useWallet();
  const { program } = useProgram();
  const [modelName, setModelName] = useState("");
  const [modelVersion, setModelVersion] = useState(1);
  const [modelType, setModelType] = useState<string>(MODEL_TYPES[0]);
  const [weightInput, setWeightInput] = useState("");
  const [result, setResult] = useState<RegisteredModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = Boolean(publicKey) && Boolean(program) && modelName.trim().length > 0 && !loading;

  async function handleRegister() {
    if (!publicKey || !program) return;
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const commitment = weightInput.trim()
        ? await sha256Bytes(weightInput.trim())
        : randomBytes32();

      const [modelPda] = findModelPda(publicKey, commitment);

      const existing = await (program.account as any).modelRegistry
        .fetchNullable(modelPda)
        .catch(() => null);

      if (existing) {
        const model: RegisteredModel = {
          pda: modelPda.toBase58(),
          owner: publicKey.toBase58(),
          name: existing.modelName as string,
          version: Number(existing.modelVersion),
          type: modelType,
          weightCommitment: toHex(commitment),
          totalInferences: Number(existing.totalInferences ?? 0),
          createdAt: Number(existing.createdAt ?? Math.floor(Date.now() / 1000)),
          tx: "",
        };
        onRegister(model);
        setResult(model);
        setError("Model already registered on-chain — loaded existing PDA.");
        return;
      }

      const mxeId = import.meta.env.VITE_MXE_PROGRAM_ID;
      const mxeConfig = mxeId ? new PublicKey(mxeId) : SystemProgram.programId;

      const tx = await program.methods
        .registerModel(
          Array.from(commitment),
          modelName.trim(),
          modelVersion,
          MODEL_TYPE_VARIANTS[modelType]
        )
        .accounts({
          modelRegistry: modelPda,
          mxeConfig,
          owner: publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      const model: RegisteredModel = {
        pda: modelPda.toBase58(),
        owner: publicKey.toBase58(),
        name: modelName.trim(),
        version: modelVersion,
        type: modelType,
        weightCommitment: toHex(commitment),
        totalInferences: 0,
        createdAt: Math.floor(Date.now() / 1000),
        tx,
      };

      onRegister(model);
      setResult(model);
    } catch (err: any) {
      console.error("register_model failed:", err);
      const msg = err?.message ?? String(err);
      if (msg.includes("already in use")) {
        setError(
          "That model PDA is already allocated on-chain. Change the Weight commitment input to register a new model, or use the existing one in the Run inference panel."
        );
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header">Register model</div>

      <ConnectWalletGate>
        <div className="space-y-3">
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              placeholder="sentiment-v1"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              maxLength={64}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Version</label>
              <input
                className="input"
                type="number"
                min={1}
                value={modelVersion}
                onChange={(e) => setModelVersion(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Type</label>
              <select
                className="input"
                value={modelType}
                onChange={(e) => setModelType(e.target.value)}
              >
                {MODEL_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Weight commitment</label>
            <input
              className="input font-mono text-xs"
              placeholder="Paste weights text to SHA-256, or leave blank for random"
              value={weightInput}
              onChange={(e) => setWeightInput(e.target.value)}
            />
          </div>

          <button
            className="btn-primary w-full"
            disabled={!canSubmit}
            onClick={handleRegister}
          >
            {loading ? "Submitting..." : "Register"}
          </button>

          {error && (
            <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-md text-xs text-red-400">
              {error}
            </div>
          )}

          {result && (
            <div className="p-3 bg-gray-800/30 rounded-md border border-gray-800/60 space-y-1.5 text-xs">
              <div className="text-emerald-400 font-medium mb-2">Model registered</div>
              <Row label="PDA" value={result.pda} mono />
              <Row label="Name" value={result.name} />
              <Row label="Commitment" value={result.weightCommitment} mono />
              <Row label="TX" value={result.tx} mono link />
            </div>
          )}
        </div>
      </ConnectWalletGate>
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
