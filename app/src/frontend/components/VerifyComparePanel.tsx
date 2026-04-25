import React from "react";
import type { VerifiedInferenceRecord } from "../hooks/useDemoState";

interface Props {
  inferences: VerifiedInferenceRecord[];
}

interface DisplayOutput {
  label: string;
  confidence: number | null;
  score: number | null;
}

function parseOutput(outputData: string): DisplayOutput | null {
  if (!outputData) return null;
  try {
    const p = JSON.parse(outputData);
    const label = typeof p.label === "string" ? p.label : labelFor(p.classification);
    const confidence =
      typeof p.confidence === "number" ? p.confidence : null;
    const score = typeof p.score === "number" ? p.score : null;
    if (!label && confidence === null && score === null) return null;
    return { label: label ?? "Unknown", confidence, score };
  } catch {
    return null;
  }
}

function labelFor(classification: unknown): string | null {
  if (typeof classification !== "number") return null;
  switch (classification) {
    case 0:
      return "Negative";
    case 1:
      return "Neutral";
    case 2:
      return "Positive";
    default:
      return null;
  }
}

function flipLabel(label: string): string {
  if (label === "Positive") return "Negative";
  if (label === "Negative") return "Positive";
  return "Neutral";
}

export function VerifyComparePanel({ inferences }: Props) {
  const latestVerified = inferences.find((i) => i.status === "Verified");
  const verifiedResult = latestVerified
    ? parseOutput(latestVerified.outputData)
    : null;

  return (
    <div className="card">
      <div className="card-header">Verified vs unverified</div>

      {!latestVerified ? (
        <p className="text-sm text-gray-600 py-6 text-center">
          No verified inferences yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Verified */}
          <div className="p-4 rounded-md border border-emerald-500/20 bg-emerald-500/[0.03] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-emerald-400">Verified inference</span>
              <span className="badge-verified">proven</span>
            </div>

            {verifiedResult ? (
              <div
                className={`text-xl font-semibold ${
                  verifiedResult.label === "Positive"
                    ? "text-emerald-400"
                    : verifiedResult.label === "Negative"
                      ? "text-red-400"
                      : "text-yellow-400"
                }`}
              >
                {verifiedResult.label}
                {verifiedResult.confidence !== null && (
                  <span className="text-sm font-normal text-gray-500 ml-2">
                    {(verifiedResult.confidence * 100).toFixed(1)}%
                  </span>
                )}
                {verifiedResult.confidence === null &&
                  verifiedResult.score !== null && (
                    <span className="text-sm font-normal text-gray-500 ml-2">
                      score {verifiedResult.score}
                    </span>
                  )}
              </div>
            ) : (
              <div className="text-sm text-gray-500 font-mono break-all">
                {latestVerified.outputData || "(no output data)"}
              </div>
            )}

            <div className="space-y-1 text-xs">
              <ProofRow ok label="PDA" value={latestVerified.pda} />
              <ProofRow ok label="Model" value={latestVerified.modelCommitment} />
              <ProofRow ok label="Nodes" value={`${latestVerified.nodeCount} attested`} plain />
              <ProofRow ok label="Cluster" value={latestVerified.cluster} />
              <ProofRow ok label="Status" value="Verified" plain />
            </div>

            <p className="text-[11px] text-emerald-400/50 pt-2 border-t border-emerald-500/10">
              Verifiable on-chain via <code className="font-mono">check_verification</code> CPI.
            </p>
          </div>

          {/* Unverified */}
          <div className="p-4 rounded-md border border-red-500/20 bg-red-500/[0.03] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-red-400">Unverified claim</span>
              <span className="badge-unverified">no proof</span>
            </div>

            {verifiedResult && (
              <div className="text-xl font-semibold text-gray-600">
                {flipLabel(verifiedResult.label)}
                <span className="text-sm font-normal text-gray-700 ml-2">80.0%</span>
              </div>
            )}

            <div className="space-y-1 text-xs">
              <ProofRow label="PDA" value="None" plain />
              <ProofRow label="Model" value="Unknown" plain />
              <ProofRow label="Nodes" value="0" plain />
              <ProofRow label="Cluster" value="None" plain />
              <ProofRow label="Status" value="Unverifiable" plain />
            </div>

            <p className="text-[11px] text-red-400/50 pt-2 border-t border-red-500/10">
              No on-chain proof. Could be fabricated or from a different model.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function ProofRow({
  ok,
  label,
  value,
  plain,
}: {
  ok?: boolean;
  label: string;
  value: string;
  plain?: boolean;
}) {
  return (
    <div className="flex items-start gap-1.5">
      <span className={`shrink-0 mt-0.5 ${ok ? "text-emerald-500" : "text-red-500"}`}>
        {ok ? "+" : "-"}
      </span>
      <span className="text-gray-600">{label}:</span>
      <span className={`${ok ? "text-gray-400" : "text-gray-600"} ${!plain ? "font-mono truncate" : ""}`}>
        {!plain && value.length > 24 ? value.slice(0, 12) + "..." + value.slice(-8) : value}
      </span>
    </div>
  );
}
