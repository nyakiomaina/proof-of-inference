import React, { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { SystemProgram, PublicKey } from "@solana/web3.js";
import type { RegisteredModel } from "../hooks/useDemoState";
import { ConnectWalletGate } from "./ConnectWalletGate";
import { useProgram, findModelPda } from "../hooks/useProgram";
import {
  DEFAULT_WEIGHTS,
  commitmentForWeights,
  saveWeights,
  type ModelWeights,
} from "../lib/modelWeights";

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

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
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
  const [weights, setWeights] = useState<ModelWeights>(DEFAULT_WEIGHTS);
  const [result, setResult] = useState<RegisteredModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = Boolean(publicKey) && Boolean(program) && modelName.trim().length > 0 && !loading;

  function setWeight(key: keyof ModelWeights, raw: string) {
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n)) {
      setWeights((prev) => ({ ...prev, [key]: 0 }));
      return;
    }
    const clamped = Math.max(0, Math.min(255, n));
    setWeights((prev) => ({ ...prev, [key]: clamped }));
  }

  async function handleRegister() {
    if (!publicKey || !program) return;
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const commitment = await commitmentForWeights(weights);

      const [modelPda] = findModelPda(publicKey, commitment);
      const modelPdaStr = modelPda.toBase58();

      const existing = await (program.account as any).modelRegistry
        .fetchNullable(modelPda)
        .catch(() => null);

      if (existing) {
        saveWeights(modelPdaStr, weights);
        const model: RegisteredModel = {
          pda: modelPdaStr,
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
        setError(
          "Model with these weights is already registered — loaded existing PDA. Change any weight to register a fresh one."
        );
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

      saveWeights(modelPdaStr, weights);

      const model: RegisteredModel = {
        pda: modelPdaStr,
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
          "That model PDA is already allocated on-chain. Change a weight to register a new model, or pick the existing one in the Run inference panel."
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
            <label className="label">
              Model weights{" "}
              <span className="text-gray-600 font-normal">
                (u8 — fed into the MPC circuit)
              </span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              {(["w0", "w1", "bias", "threshold"] as const).map((k) => (
                <div key={k}>
                  <input
                    className="input font-mono text-xs text-center"
                    type="number"
                    min={0}
                    max={255}
                    value={weights[k]}
                    onChange={(e) => setWeight(k, e.target.value)}
                    aria-label={k}
                  />
                  <div className="text-[10px] text-gray-600 text-center mt-1 font-mono">
                    {k}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-gray-600 mt-2 leading-relaxed">
              Commitment is{" "}
              <code className="font-mono">SHA-256("poi-weights-v1" || w0 || w1 || bias || threshold)</code>.
              Anyone with the four weights can re-derive and verify the on-chain hash.
            </p>
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
