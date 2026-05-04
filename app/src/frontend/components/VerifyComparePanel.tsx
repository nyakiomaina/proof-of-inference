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

function shortPda(pda: string, head = 6, tail = 4): string {
  if (!pda || pda.length <= head + tail + 2) return pda;
  return `${pda.slice(0, head)}…${pda.slice(-tail)}`;
}

function fmtRelativeTime(unixSeconds: number): string {
  if (!unixSeconds) return "";
  const deltaSec = Math.floor(Date.now() / 1000) - unixSeconds;
  if (deltaSec < 60) return `${deltaSec}s ago`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  return `${Math.floor(deltaSec / 86400)}d ago`;
}

export function VerifyComparePanel({ inferences }: Props) {
  // Only Arcium MPC attestations qualify as "verified inference" in this UI —
  // any other on-chain rows (e.g. historical records from removed code paths)
  // would dilute the proof story and are filtered out.
  const verifiedAll = inferences
    .filter((i) => i.status === "Verified" && i.route === "MPC")
    .sort((a, b) => b.timestamp - a.timestamp);
  const latestVerified = verifiedAll[0];
  const verifiedResult = latestVerified
    ? parseOutput(latestVerified.outputData)
    : null;

  const cluster = import.meta.env.VITE_SOLANA_CLUSTER || "devnet";
  const explorer = (pda: string) =>
    `https://explorer.solana.com/address/${pda}?cluster=${cluster}`;

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="card-header">Verified vs unverified</div>

        {!latestVerified ? (
          <div className="py-8 text-center space-y-1">
            <p className="text-sm text-gray-500">
              No MPC-attested inferences yet.
            </p>
            <p className="text-xs text-gray-700">
              Run an inference above — the Arcium cluster will sign the result
              and the MXE callback will write it on-chain.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Verified */}
            <div className="p-4 rounded-md border border-emerald-500/20 bg-emerald-500/[0.03] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-emerald-400">
                  Verified inference
                </span>
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-block px-1.5 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wide bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                    title="Output finalized by the Arcium MPC cluster CPI'ing into proof-of-inference. End-to-end MPC."
                  >
                    Arcium MPC
                  </span>
                  <span className="badge-verified">proven</span>
                </div>
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

            {/* Unverified — illustrates that without on-chain proof an agent
                can claim ANYTHING. We deliberately do NOT render a single
                fake-precise number; we show a few wildly different bogus
                claims to make it obvious nothing is anchoring them. */}
            <div className="p-4 rounded-md border border-red-500/20 bg-red-500/[0.03] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-red-400">
                  Unverified claim
                </span>
                <span className="badge-unverified">no proof</span>
              </div>

              <div className="space-y-1.5">
                <div className="text-xl font-semibold text-gray-500">
                  ??
                  <span className="text-sm font-normal text-gray-700 ml-2">
                    any value
                  </span>
                </div>
                <div className="text-[11px] text-red-300/70 leading-relaxed">
                  Without an on-chain attestation an agent could claim:
                </div>
                <ul className="text-[11px] font-mono text-gray-500 space-y-0.5 pl-3">
                  <li>· Positive 99.9% (no proof)</li>
                  <li>· Negative 12.0% (no proof)</li>
                  <li>· Neutral 50.0% (no proof)</li>
                  <li>· …or any other value</li>
                </ul>
              </div>

              <div className="space-y-1 text-xs">
                <ProofRow label="PDA" value="None" plain />
                <ProofRow label="Model" value="Unknown" plain />
                <ProofRow label="Nodes" value="0" plain />
                <ProofRow label="Cluster" value="None" plain />
                <ProofRow label="Status" value="Unverifiable" plain />
              </div>

              <p className="text-[11px] text-red-400/50 pt-2 border-t border-red-500/10">
                No on-chain proof. Nothing distinguishes a real model output
                from a fabricated one — that is exactly what proof-of-inference
                fixes.
              </p>
            </div>
          </div>
        )}
      </div>

      {verifiedAll.length > 0 && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <span>MPC inference history</span>
            <span className="text-xs text-gray-600 font-normal">
              {verifiedAll.length} attested
            </span>
          </div>
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800/60">
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">Result</th>
                  <th className="py-2 pr-3 font-medium">Nodes</th>
                  <th className="py-2 pr-3 font-medium">PDA</th>
                  <th className="py-2 font-medium">Model</th>
                </tr>
              </thead>
              <tbody>
                {verifiedAll.slice(0, 12).map((inf) => {
                  const r = parseOutput(inf.outputData);
                  return (
                    <tr
                      key={inf.pda}
                      className="border-b border-gray-800/30 hover:bg-gray-900/30"
                    >
                      <td className="py-1.5 pr-3 text-gray-500">
                        {fmtRelativeTime(inf.timestamp)}
                      </td>
                      <td className="py-1.5 pr-3 text-gray-300">
                        {r ? (
                          <>
                            <span
                              className={
                                r.label === "Positive"
                                  ? "text-emerald-400"
                                  : r.label === "Negative"
                                    ? "text-red-400"
                                    : "text-yellow-400"
                              }
                            >
                              {r.label}
                            </span>
                            {r.confidence !== null && (
                              <span className="text-gray-600 ml-1.5">
                                {(r.confidence * 100).toFixed(0)}%
                              </span>
                            )}
                            {r.confidence === null && r.score !== null && (
                              <span className="text-gray-600 ml-1.5">
                                · score {r.score}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-gray-600 font-mono">
                            sealed
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-gray-500">
                        {inf.nodeCount}
                      </td>
                      <td className="py-1.5 pr-3">
                        <a
                          href={explorer(inf.pda)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-400 hover:text-gray-200 font-mono"
                        >
                          {shortPda(inf.pda)}
                        </a>
                      </td>
                      <td className="py-1.5">
                        <a
                          href={explorer(inf.modelPda)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-400 hover:text-gray-200 font-mono"
                        >
                          {shortPda(inf.modelPda)}
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {verifiedAll.length > 12 && (
            <p className="text-[11px] text-gray-600 mt-2">
              Showing 12 most recent. {verifiedAll.length - 12} more on-chain.
            </p>
          )}
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
