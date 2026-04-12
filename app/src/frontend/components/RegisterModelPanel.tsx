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
  const data = new TextEncoder().encode(input) as BufferSource;
  const buf = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(buf);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
      // Compute or generate weight commitment
      const commitment = weightInput.trim()
        ? await sha256Bytes(weightInput.trim())
        : randomBytes32();

      const [modelPda] = findModelPda(publicKey, commitment);

      // MXE config — use SystemProgram as placeholder until Arcium MXE is configured
      const mxeConfig = SystemProgram.programId;

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
      setError(err.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <svg className="w-5 h-5 text-solana-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        Panel 1 &mdash; Register Model
      </div>

      <ConnectWalletGate>
        <div className="space-y-4">
          <div>
            <label className="label">Model Name</label>
            <input
              className="input"
              placeholder="e.g. sentiment-v1"
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
              <label className="label">Model Type</label>
              <select
                className="input"
                value={modelType}
                onChange={(e) => setModelType(e.target.value)}
              >
                {MODEL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label">
              Weight Commitment (paste weights text to SHA-256, or leave blank to auto-generate)
            </label>
            <input
              className="input font-mono text-xs"
              placeholder="Arbitrary string to SHA-256 (e.g. serialized weights)"
              value={weightInput}
              onChange={(e) => setWeightInput(e.target.value)}
            />
          </div>

          <button
            className="btn-primary w-full"
            disabled={!canSubmit}
            onClick={handleRegister}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Spinner /> Submitting to Solana...
              </span>
            ) : (
              "Register Model"
            )}
          </button>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
              <strong>Error:</strong> {error}
            </div>
          )}

          {result && (
            <div className="mt-4 p-4 bg-gray-800/50 rounded-lg border border-solana-purple/30 space-y-2 text-sm">
              <div className="text-solana-green font-semibold flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Model Registered On-Chain
              </div>
              <Field label="Owner" value={result.owner} mono />
              <Field label="PDA" value={result.pda} mono />
              <Field label="Name" value={result.name} />
              <Field label="Weight Commitment" value={result.weightCommitment} mono />
              <Field label="TX" value={result.tx} mono link />
            </div>
          )}
        </div>
      </ConnectWalletGate>
    </div>
  );
}

function Field({ label, value, mono, link }: { label: string; value: string; mono?: boolean; link?: boolean }) {
  const solanaCluster = import.meta.env.VITE_SOLANA_CLUSTER || "devnet";
  const explorerUrl = `https://explorer.solana.com/tx/${value}?cluster=${solanaCluster}`;

  return (
    <div>
      <span className="text-gray-500 text-xs">{label}: </span>
      {link ? (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-solana-purple hover:underline font-mono text-xs break-all"
        >
          {value}
        </a>
      ) : (
        <span className={`text-gray-300 ${mono ? "font-mono text-xs break-all" : ""}`}>
          {value}
        </span>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
