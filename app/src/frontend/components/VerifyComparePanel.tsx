import React from "react";
import type { VerifiedInferenceRecord } from "../hooks/useDemoState";
import { useDecryptedMpcOutputs } from "../hooks/useDecryptedMpcOutputs";

interface Props {
  inferences: VerifiedInferenceRecord[];
}

interface DisplayOutput {
  label: string;
  score: number | null;
  /** Present when `output_data` is ciphertext hex — no plaintext in this browser session. */
  sealedDetail?: string;
}

function parseOutput(outputData: string): DisplayOutput | null {
  if (!outputData) return null;
  const trimmed = outputData.trim();

  // Reloaded from chain: `useOnChainInferences` stores binary `output_data` as hex.
  if (/^[0-9a-f]+$/i.test(trimmed) && trimmed.length >= 32) {
    return {
      label: "Sealed",
      score: null,
      sealedDetail:
        trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed,
    };
  }

  try {
    const p = JSON.parse(outputData);

    if (typeof p.raw === "string" && /^[0-9a-f]+$/i.test(p.raw)) {
      const raw = p.raw;
      return {
        label: "Sealed",
        score: null,
        sealedDetail: raw.length > 120 ? `${raw.slice(0, 120)}…` : raw,
      };
    }

    const label =
      typeof p.label === "string"
        ? p.label
        : labelForCircuit(p.classification);
    const score = sanitizeScore(p.score);
    if (!label && score === null) return null;
    return { label: label ?? "Unknown", score };
  } catch {
    return null;
  }
}

/** Matches `encrypted-ixs` InferenceOutput: u8 0 | 1 only. */
function labelForCircuit(classification: unknown): string | null {
  if (typeof classification !== "number" || !Number.isInteger(classification)) {
    return null;
  }
  switch (classification) {
    case 0:
      return "Negative";
    case 1:
      return "Positive";
    default:
      return null;
  }
}

/** Circuit score is u16; reject garbage from failed decryption. */
function sanitizeScore(score: unknown): number | null {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  if (!Number.isInteger(score) || score < 0 || score > 65535) return null;
  return score;
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
  const decryptedByPda = useDecryptedMpcOutputs(inferences);

  const outputFor = (inf: VerifiedInferenceRecord | undefined): string =>
    inf ? decryptedByPda[inf.pda] ?? inf.outputData : "";

  const verifiedResult = latestVerified
    ? parseOutput(outputFor(latestVerified))
    : null;

  const failedAll = inferences
    .filter((i) => i.status === "Failed")
    .sort((a, b) => b.timestamp - a.timestamp);

  const cluster = import.meta.env.VITE_SOLANA_CLUSTER || "devnet";
  const explorer = (pda: string) =>
    `https://explorer.solana.com/address/${pda}?cluster=${cluster}`;

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="card-header">Latest verified inference</div>

        {!latestVerified ? (
          <div className="py-8 text-center text-sm text-gray-500">
            No verified MPC inferences yet.
          </div>
        ) : (
          <div className="p-4 rounded-md border border-emerald-500/20 bg-emerald-500/[0.03] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wide text-emerald-300/90 border border-emerald-500/25 rounded px-1.5 py-0.5">
                MPC
              </span>
            </div>

            {verifiedResult ? (
              <div className="space-y-2">
                <div
                  className={`text-xl font-semibold ${
                    verifiedResult.label === "Positive"
                      ? "text-emerald-400"
                      : verifiedResult.label === "Negative"
                        ? "text-red-400"
                        : verifiedResult.label === "Sealed"
                          ? "text-gray-400"
                          : "text-yellow-400"
                  }`}
                >
                  {verifiedResult.label}
                  {verifiedResult.score !== null && (
                    <span className="text-sm font-normal text-gray-500 ml-2">
                      score {verifiedResult.score}
                    </span>
                  )}
                </div>
                {verifiedResult.sealedDetail ? (
                  <div className="text-[10px] font-mono text-gray-600 break-all bg-black/20 rounded px-2 py-1.5 max-h-28 overflow-y-auto">
                    {verifiedResult.sealedDetail}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-sm text-gray-500 font-mono break-all">
                {outputFor(latestVerified) || "—"}
              </div>
            )}

            <div className="space-y-1.5 text-xs pt-1 border-t border-emerald-500/10">
              <ExplorerPair label="Inference" href={explorer(latestVerified.pda)} short={shortPda(latestVerified.pda)} full={latestVerified.pda} />
              <ExplorerPair
                label="Model registry"
                href={explorer(latestVerified.modelPda)}
                short={shortPda(latestVerified.modelPda)}
                full={latestVerified.modelPda}
              />
              <ProofRow
                ok
                label="Weight hash"
                value={
                  latestVerified.modelCommitment.length > 28
                    ? `${latestVerified.modelCommitment.slice(0, 12)}…${latestVerified.modelCommitment.slice(-8)}`
                    : latestVerified.modelCommitment
                }
                plain
              />
              <ProofRow ok label="Nodes" value={String(latestVerified.nodeCount)} plain />
              <ProofRow ok label="Cluster" value={latestVerified.cluster} />
              <ProofRow ok label="Status" value="Verified" plain />
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
                  <th className="py-2 pr-3 font-medium">Inference</th>
                  <th className="py-2 font-medium">Model registry</th>
                </tr>
              </thead>
              <tbody>
                {verifiedAll.slice(0, 12).map((inf) => {
                  const r = parseOutput(outputFor(inf));
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
                                    : r.label === "Sealed"
                                      ? "text-gray-500"
                                      : "text-yellow-400"
                              }
                            >
                              {r.label}
                            </span>
                            {r.score !== null && (
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

      {failedAll.length > 0 && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <span>Failed inferences</span>
            <span className="text-xs text-gray-600 font-normal">
              {failedAll.length}
            </span>
          </div>

          <div className="overflow-x-auto -mx-4 px-4 pb-3 pt-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800/60">
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">Inference</th>
                  <th className="py-2 font-medium">Model registry</th>
                </tr>
              </thead>
              <tbody>
                {failedAll.slice(0, 12).map((inf) => (
                  <tr
                    key={inf.pda}
                    className="border-b border-gray-800/30 hover:bg-gray-900/30"
                  >
                    <td className="py-1.5 pr-3 text-gray-500">
                      {fmtRelativeTime(inf.timestamp)}
                    </td>
                    <td className="py-1.5 pr-3">
                      <span className="badge-failed text-[10px] mr-2 align-middle">
                        Failed
                      </span>
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
                ))}
              </tbody>
            </table>
          </div>
          {failedAll.length > 12 && (
            <p className="text-[11px] text-gray-600 px-4 pb-3">
              Showing 12 most recent. {failedAll.length - 12} more on-chain.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ExplorerPair({
  label,
  href,
  short,
  full,
}: {
  label: string;
  href: string;
  short: string;
  full: string;
}) {
  return (
    <div className="flex items-start gap-1.5 min-w-0">
      <span className="shrink-0 mt-0.5 text-emerald-500">+</span>
      <span className="text-gray-600 shrink-0">{label}:</span>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={full}
        className="text-gray-400 hover:text-gray-200 font-mono truncate min-w-0"
      >
        {short}
      </a>
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
