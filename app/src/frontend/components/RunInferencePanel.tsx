import React, { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type {
  RegisteredModel,
  VerifiedInferenceRecord,
} from "../hooks/useDemoState";
import { ConnectWalletGate } from "./ConnectWalletGate";
import { useProgram, findInferencePda } from "../hooks/useProgram";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface Props {
  models: RegisteredModel[];
  onInferenceCreated: (inf: VerifiedInferenceRecord) => void;
  onInferenceVerified: (pda: string, updates: Partial<VerifiedInferenceRecord>) => void;
  onModelIncrement: (modelPda: string) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
}

export function RunInferencePanel({
  models,
  onInferenceCreated,
  onInferenceVerified,
  onModelIncrement,
  loading,
  setLoading,
}: Props) {
  const { publicKey } = useWallet();
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

  const requesterTokenAddr = import.meta.env.VITE_REQUESTER_TOKEN_ACCOUNT;
  const feeVaultAddr = import.meta.env.VITE_PROTOCOL_FEE_VAULT;

  async function handleSubmit() {
    if (!model || !publicKey || !program) return;
    setLoading(true);
    setError(null);
    setCurrentInference(null);

    try {
      // Phase 1: Encrypt input (in production, use Arcium SDK)
      setPhase("encrypting");
      const inputBytes = new TextEncoder().encode(inputText.trim());
      const nonce = new Uint8Array(32);
      crypto.getRandomValues(nonce);

      // Phase 2: Submit request_inference on-chain
      setPhase("submitting");
      const modelPda = new PublicKey(model.pda);
      const [inferencePda] = findInferencePda(modelPda, nonce);

      if (!requesterTokenAddr || !feeVaultAddr) {
        throw new Error(
          "Set VITE_REQUESTER_TOKEN_ACCOUNT and VITE_PROTOCOL_FEE_VAULT in app/.env. " +
          "Run: node scripts/devnet-setup.js to create them."
        );
      }

      const tx = await program.methods
        .requestInference(Buffer.from(inputBytes), Array.from(nonce))
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
        inputHash: "(on-chain)",
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

      // Phase 3: Poll for callback (Arcium MPC or devnet simulator)
      setPhase("polling");
      const verified = await pollForVerification(program, inferencePda, 60);

      if (verified) {
        const account = await (program.account as any).verifiedInference.fetch(
          inferencePda
        );
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
        setError(
          "Inference is still Pending. Run the callback simulator:\n" +
          "  node scripts/devnet-callback.js " + inferencePda.toBase58()
        );
      }
    } catch (err: any) {
      console.error("request_inference failed:", err);
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
      <div className="card-header">
        <svg className="w-5 h-5 text-solana-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        Panel 2 &mdash; Run Verified Inference
      </div>

      {models.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p className="text-sm">No models registered yet.</p>
          <p className="text-xs mt-1">Register a model in Panel 1 first.</p>
        </div>
      ) : (
        <ConnectWalletGate>
          <div className="space-y-4">
            <div>
              <label className="label">Select Model</label>
              <select
                className="input"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                <option value="">-- choose a model --</option>
                {models.map((m) => (
                  <option key={m.pda} value={m.pda}>
                    {m.name} v{m.version} ({m.type})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Input Text (sentiment to analyze)</label>
              <textarea
                className="input min-h-[80px] resize-y"
                placeholder="e.g. Solana is building the future of finance"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={phase !== "idle"}
              />
            </div>

            {phase === "idle" ? (
              <button
                className="btn-green w-full"
                disabled={!canSubmit}
                onClick={handleSubmit}
              >
                Run Verified Inference
              </button>
            ) : phase === "verified" || phase === "done" ? (
              <button className="btn-outline w-full" onClick={handleReset}>
                Run Another Inference
              </button>
            ) : null}

            {/* Progress steps */}
            {phase !== "idle" && (
              <div className="space-y-2 mt-2">
                <Step
                  label="Encrypting input"
                  status={stepStatus("encrypting", phase)}
                />
                <Step
                  label="Submitting request_inference on-chain (wallet signing)"
                  status={stepStatus("submitting", phase)}
                />
                <Step
                  label="Waiting for Arcium MPC callback..."
                  status={stepStatus("polling", phase)}
                />
                <Step
                  label="VerifiedInference PDA updated"
                  status={stepStatus("verified", phase)}
                />
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400 whitespace-pre-wrap">
                <strong>Error:</strong> {error}
              </div>
            )}

            {/* Result */}
            {currentInference && currentInference.status === "Verified" && (
              <div className="mt-4 p-4 bg-gray-800/50 rounded-lg border border-solana-green/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="badge-verified">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Verified On-Chain
                  </span>
                  <span className="text-xs text-gray-500">
                    {currentInference.nodeCount} MPC nodes
                  </span>
                </div>

                <div className="space-y-1 text-xs">
                  <Field label="Requester" value={currentInference.requester} mono />
                  <Field label="Inference PDA" value={currentInference.pda} mono />
                  <Field label="Model Commitment" value={currentInference.modelCommitment} mono />
                  <Field label="Output Hash" value={currentInference.outputHash} mono />
                  <Field label="Output Data" value={currentInference.outputData} />
                  <Field label="Cluster" value={currentInference.cluster} mono />
                  <Field label="TX" value={currentInference.tx} mono link />
                </div>
              </div>
            )}

            {currentInference && currentInference.status === "Pending" && phase === "done" && (
              <div className="mt-4 p-4 bg-yellow-500/10 rounded-lg border border-yellow-500/30 space-y-2">
                <span className="badge-pending">Pending</span>
                <p className="text-xs text-gray-400">
                  Inference PDA created on-chain. Waiting for callback.
                </p>
                <code className="block text-xs text-gray-500 bg-gray-800 p-2 rounded">
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

/**
 * Polls the VerifiedInference account until status flips to Verified,
 * or until `timeoutSec` seconds elapse.
 */
async function pollForVerification(
  program: any,
  inferencePda: PublicKey,
  timeoutSec: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    try {
      const account = await program.account.verifiedInference.fetch(inferencePda);
      if (account.status && "verified" in (account.status as object)) {
        return true;
      }
    } catch {
      // account may not be fetched yet
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

type StepPhase = "encrypting" | "submitting" | "polling" | "verified" | "done";

const PHASE_ORDER: StepPhase[] = ["encrypting", "submitting", "polling", "verified", "done"];

function stepStatus(
  step: StepPhase,
  current: string
): "pending" | "active" | "done" {
  const stepIdx = PHASE_ORDER.indexOf(step);
  const currentIdx = PHASE_ORDER.indexOf(current as StepPhase);
  if (currentIdx > stepIdx) return "done";
  if (currentIdx === stepIdx) return "active";
  return "pending";
}

function Step({
  label,
  status,
}: {
  label: string;
  status: "pending" | "active" | "done";
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {status === "done" ? (
        <svg className="w-4 h-4 text-solana-green flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      ) : status === "active" ? (
        <svg className="animate-spin h-4 w-4 text-solana-purple flex-shrink-0" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <div className="w-4 h-4 rounded-full border border-gray-700 flex-shrink-0" />
      )}
      <span
        className={
          status === "done"
            ? "text-gray-400"
            : status === "active"
            ? "text-white"
            : "text-gray-600"
        }
      >
        {label}
      </span>
    </div>
  );
}

function Field({ label, value, mono, link }: { label: string; value: string; mono?: boolean; link?: boolean }) {
  const solanaCluster = import.meta.env.VITE_SOLANA_CLUSTER || "devnet";
  const explorerUrl = `https://explorer.solana.com/tx/${value}?cluster=${solanaCluster}`;

  return (
    <div>
      <span className="text-gray-500">{label}: </span>
      {link ? (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-solana-purple hover:underline font-mono break-all"
        >
          {value}
        </a>
      ) : (
        <span className={`text-gray-300 ${mono ? "font-mono break-all" : ""}`}>
          {value}
        </span>
      )}
    </div>
  );
}
