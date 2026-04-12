import React from "react";
import type { VerifiedInferenceRecord } from "../hooks/useDemoState";

interface Props {
  inferences: VerifiedInferenceRecord[];
}

/**
 * Panel 3: Side-by-side comparison of a verified inference (with on-chain proof)
 * vs. an unverified claim (no proof, no PDA, no trust).
 */
export function VerifyComparePanel({ inferences }: Props) {
  const latestVerified = inferences.find((i) => i.status === "Verified");

  // Parse the output to get classification info
  let verifiedResult: { label: string; confidence: number } | null = null;
  if (latestVerified?.outputData) {
    try {
      const parsed = JSON.parse(latestVerified.outputData);
      verifiedResult = {
        label: parsed.label,
        confidence: parsed.confidence,
      };
    } catch {
      // ignore parse errors
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <svg className="w-5 h-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        Panel 3 &mdash; Verified vs. Unverified
      </div>

      {!latestVerified ? (
        <div className="text-center py-8 text-gray-500">
          <p className="text-sm">No verified inferences yet.</p>
          <p className="text-xs mt-1">
            Run an inference in Panel 2 to see the comparison.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* LEFT: Verified */}
          <div className="p-4 rounded-lg border-2 border-emerald-500/40 bg-emerald-500/5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-emerald-400 flex items-center gap-1.5">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Verified Inference
              </h3>
              <span className="badge-verified">PROVEN</span>
            </div>

            {verifiedResult && (
              <div className={`text-2xl font-bold ${
                verifiedResult.label === "Positive"
                  ? "text-emerald-400"
                  : verifiedResult.label === "Negative"
                  ? "text-red-400"
                  : "text-yellow-400"
              }`}>
                {verifiedResult.label}{" "}
                <span className="text-sm font-normal text-gray-400">
                  {(verifiedResult.confidence * 100).toFixed(1)}%
                </span>
              </div>
            )}

            <div className="space-y-2 text-xs">
              <ProofRow
                icon="check"
                label="On-chain PDA"
                value={latestVerified.pda}
              />
              <ProofRow
                icon="check"
                label="Model Commitment"
                value={latestVerified.modelCommitment}
              />
              <ProofRow
                icon="check"
                label="Input Hash"
                value={latestVerified.inputHash}
              />
              <ProofRow
                icon="check"
                label="MPC Nodes"
                value={`${latestVerified.nodeCount} nodes attested`}
                noMono
              />
              <ProofRow
                icon="check"
                label="Cluster"
                value={latestVerified.cluster}
              />
              <ProofRow
                icon="check"
                label="Status"
                value="VerificationStatus::Verified"
                noMono
              />
            </div>

            <div className="text-xs text-emerald-400/70 mt-2 pt-2 border-t border-emerald-500/20">
              Any Solana program can call <code className="font-mono bg-emerald-500/10 px-1 rounded">check_verification</code> via CPI
              and confirm this result is proven.
            </div>
          </div>

          {/* RIGHT: Unverified */}
          <div className="p-4 rounded-lg border-2 border-red-500/40 bg-red-500/5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-red-400 flex items-center gap-1.5">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                Unverified Claim
              </h3>
              <span className="badge-unverified">NO PROOF</span>
            </div>

            {verifiedResult && (
              <div className="text-2xl font-bold text-gray-400">
                {verifiedResult.label === "Positive" ? "Negative" : "Positive"}{" "}
                <span className="text-sm font-normal text-gray-500">
                  80.0%
                </span>
              </div>
            )}

            <div className="space-y-2 text-xs">
              <ProofRow icon="x" label="On-chain PDA" value="None" noMono />
              <ProofRow
                icon="x"
                label="Model Commitment"
                value="Unknown — could be any model"
                noMono
              />
              <ProofRow
                icon="x"
                label="Input Hash"
                value="Not recorded"
                noMono
              />
              <ProofRow
                icon="x"
                label="MPC Nodes"
                value="0 nodes — no attestation"
                noMono
              />
              <ProofRow
                icon="x"
                label="Cluster"
                value="None"
                noMono
              />
              <ProofRow
                icon="x"
                label="Status"
                value="Unverifiable"
                noMono
              />
            </div>

            <div className="text-xs text-red-400/70 mt-2 pt-2 border-t border-red-500/20">
              No on-chain proof. Could be hardcoded, a different model, or
              fabricated entirely. No program can verify this claim.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProofRow({
  icon,
  label,
  value,
  noMono,
}: {
  icon: "check" | "x";
  label: string;
  value: string;
  noMono?: boolean;
}) {
  return (
    <div className="flex items-start gap-1.5">
      {icon === "check" ? (
        <svg className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      )}
      <div>
        <span className="text-gray-500">{label}: </span>
        <span
          className={`${
            icon === "check" ? "text-gray-300" : "text-gray-500"
          } ${!noMono ? "font-mono break-all" : ""}`}
        >
          {!noMono && value.length > 20 ? value.slice(0, 16) + "..." + value.slice(-8) : value}
        </span>
      </div>
    </div>
  );
}
