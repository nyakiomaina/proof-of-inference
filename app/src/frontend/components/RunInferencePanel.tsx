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
import { DEFAULT_WEIGHTS, loadWeights } from "../lib/modelWeights";
import { formatInferenceOutputForRecord } from "../lib/mpcOutputDecrypt";
import { persistInferenceDecryptSecrets } from "../lib/inferenceDecryptStorage";
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

/**
 * Squeezes whatever shape an error comes back as (Anchor `SendTransactionError`,
 * a plain Error, a wallet-adapter rejection object, a stringified RPC payload)
 * down to a single human-readable string. Stops `[object Object]` from ever
 * making it to the UI.
 */
function formatError(err: unknown): string {
  let raw: string;
  if (err instanceof Error) {
    const anchorLogs =
      typeof (err as any).getLogs === "function"
        ? (() => {
            try {
              const logs = (err as any).getLogs();
              return Array.isArray(logs) ? logs.join("\n") : "";
            } catch {
              return "";
            }
          })()
        : Array.isArray((err as any).logs)
          ? (err as any).logs.join("\n")
          : "";
    raw = anchorLogs ? `${err.message}\n\n${anchorLogs}` : err.message;
  } else if (typeof err === "string") {
    raw = err;
  } else if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") raw = obj.message;
    else if (Array.isArray(obj.logs)) raw = obj.logs.join("\n");
    else {
      try {
        raw = JSON.stringify(obj, null, 2);
      } catch {
        raw = String(obj);
      }
    }
  } else {
    raw = String(err);
  }
  return raw;
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
    !loading &&
    MXE_IDL_AVAILABLE;

  const mxeProgramId = import.meta.env.VITE_MXE_PROGRAM_ID;
  const requesterTokenAddr = import.meta.env.VITE_REQUESTER_TOKEN_ACCOUNT;
  const feeVaultAddr = import.meta.env.VITE_PROTOCOL_FEE_VAULT;

  async function handleSubmit() {
    if (!model || !publicKey || !program || !signTransaction) return;
    setLoading(true);
    setError(null);
    setCurrentInference(null);

    try {
      /*
       * End-to-end flow (each step depends on the last):
       *
       * 1) Encrypt plaintext features + weights tuple with Rescue using the MXE’s
       *    on-chain x25519 key (`createMxeRescueCipher` → same MXE program as step 2b).
       * 2a) `proof_of_inference::request_inference` — protocol fee + creates Pending `VerifiedInference`.
       * 2b) MXE `run_inference_v2` — queues Arcium MPC (`accountsPartial` fills PDAs;
       *    fixed pool/clock/arcium addrs come from IDL). On completion the MXE callback CPIs
       *    `callback_verified_inference` so the PDA becomes Verified.
       * 3) Poll chain until Verified or timeout.
       *
       * Anchor always sends transactions to `idl.address`; env MXE id MUST match `mxe_idl.json`.
       */
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

      // Model weights (u8) — pulled from the same canonical tuple that produced
      // `weight_commitment` at registration time. Falls back to defaults for
      // models registered before the weight-binding flow existed.
      const stored = loadWeights(model.pda) ?? DEFAULT_WEIGHTS;
      const w0 = BigInt(stored.w0);
      const w1 = BigInt(stored.w1);
      const bias = BigInt(stored.bias);
      const threshold = BigInt(stored.threshold);
      const f0 = BigInt(hashArr[0]);
      const f1 = BigInt(hashArr[1]);
      const plaintext = [w0, w1, bias, threshold, f0, f1];

      // The Arcium MPC pipeline is the only path. If we can't encrypt or queue
      // a real MPC computation we fail here — submitting an inference that
      // would never be finalized by MPC pollutes the on-chain story.
      if (!mxeProgramId) {
        throw new Error(
          "VITE_MXE_PROGRAM_ID is not set. The frontend cannot queue an Arcium MPC computation without it."
        );
      }
      if (!MXE_IDL_AVAILABLE) {
        throw new Error(
          "MXE IDL not synced. Run `arcium build` in mxe/poi_mxe/ then `npm run sync-idl` from the repo root."
        );
      }

      let mxePubkey: PublicKey;
      try {
        mxePubkey = new PublicKey(mxeProgramId);
      } catch {
        throw new Error(
          `VITE_MXE_PROGRAM_ID is not a valid base58 pubkey: ${mxeProgramId}`
        );
      }

      const idlMxeId = new PublicKey((mxeIdlJson as { address: string }).address);
      if (!mxePubkey.equals(idlMxeId)) {
        throw new Error(
          `MXE program id mismatch: VITE_MXE_PROGRAM_ID is ${mxePubkey.toBase58()} but app/src/mxe_idl.json declares ${idlMxeId.toBase58()}. Anchor always invokes the IDL address — encryption/PDA helpers used your env id. Run \`npm run sync-idl\` after deploy or fix app/.env so they match.`
        );
      }

      // Preflight: confirm the MXE program account exists on the configured
      // cluster *and* is owned by the BPF loader. Without this we'd let the
      // wallet pop a "Simulation failed" with no useful detail.
      const mxeAccountInfo = await connection.getAccountInfo(mxePubkey);
      if (!mxeAccountInfo) {
        throw new Error(
          `MXE program ${mxeProgramId} does not exist on ${
            import.meta.env.VITE_SOLANA_CLUSTER ?? "devnet"
          }. Deploy it (\`anchor deploy\` in mxe/poi_mxe/) and run \`arcium deploy\` to initialise it before running an inference.`
        );
      }
      if (!mxeAccountInfo.executable) {
        throw new Error(
          `Account ${mxeProgramId} exists but is not an executable program. Check VITE_MXE_PROGRAM_ID.`
        );
      }

      let cipher: RescueCipher;
      let ephemeralSecret: Uint8Array;
      let ephemeralPublicKey: Uint8Array;
      let encryptionNonce: Uint8Array;
      let ciphertexts: number[][];
      try {
        const enc = await createMxeRescueCipher(provider, mxePubkey);
        cipher = enc.cipher;
        ephemeralSecret = enc.ephemeralSecret;
        ephemeralPublicKey = enc.ephemeralPublicKey;
        encryptionNonce = enc.nonce;
        ciphertexts = cipher.encrypt(plaintext, encryptionNonce);
      } catch (encErr: unknown) {
        throw new Error(
          `Arcium x25519 / Rescue encryption failed: ${formatError(
            encErr
          )}. Make sure the MXE has been initialised with \`arcium deploy\` so its MXEAccount + cluster bindings exist.`
        );
      }

      // `encrypted_input` on `request_inference` stores the flattened
      // ciphertexts + ephemeral pubkey + nonce so the input is reproducible
      // off-chain by anyone with the cipher state.
      const ctBytes = ciphertexts.reduce<number[]>(
        (acc, ct) => acc.concat(ct),
        []
      );
      const encryptedInputBytes = new Uint8Array([
        ...ctBytes,
        ...Array.from(ephemeralPublicKey),
        ...Array.from(encryptionNonce),
      ]);

      // Phase 2a — proof_of_inference::request_inference (consumer program).
      // Creates the VerifiedInference PDA in Pending; does not touch Arcium MPC.
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

      let requestInferenceSig: string;
      try {
        requestInferenceSig = await program.methods
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
      } catch (reqErr: unknown) {
        throw new Error(
          `proof_of_inference request_inference failed (nothing queued on Arcium yet):\n${formatError(reqErr)}`
        );
      }

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
        tx: requestInferenceSig,
        route: "Unknown",
      };
      onInferenceCreated(inference);
      setCurrentInference(inference);

      // Phase 2b — MXE scaffold run_inference_v2 → Arcium core queues MPC.
      // CPI callback later invokes proof_of_inference::callback_verified_inference.
      try {
        const mxeProgram = new Program(mxeIdlJson as unknown as Idl, provider);
        const offsetBytes = crypto.getRandomValues(new Uint8Array(8));
        const computationOffset = new BN(Array.from(offsetBytes), "le");

        await mxeProgram.methods
          .runInferenceV2(
            computationOffset,
            ciphertexts.map((ct) => Array.from(ct)),
            Array.from(ephemeralPublicKey),
            new BN(deserializeLE(encryptionNonce).toString()),
            program.programId,
            inferencePda,
            modelPda,
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
              Buffer.from(getCompDefAccOffset("run_inference_v2")).readUInt32LE()
            ),
          })
          .rpc();
      } catch (mxeErr: unknown) {
        console.error("MXE run_inference_v2 failed:", mxeErr);
        throw new Error(
          `MXE run_inference_v2 failed after request_inference confirmed.\n` +
            `request_inference tx: ${requestInferenceSig}\n` +
            `The VerifiedInference PDA stays Pending until MPC runs.\n\n` +
            `${formatError(mxeErr)}\n\n` +
            `Typical causes: computation definition not uploaded/finalized (Arcium custom 6300), wrong cluster offset, or stale env vs synced app/src/mxe_idl.json.`
        );
      }

      // Phase 3: poll for the MXE callback to CPI-finalize this PDA.
      setPhase("polling");
      const verified = await pollForVerification(program, inferencePda, 90);

      if (verified) {
        const account = await (program.account as any).verifiedInference.fetch(
          inferencePda
        );
        const rawOutput = new Uint8Array(account.outputData as number[]);
        if (rawOutput.length !== 64 && rawOutput.length !== 80) {
          throw new Error(
            `Inference finalized with an unexpected payload size (${rawOutput.length} bytes, expected 64 legacy or 80 with MPC output nonce).`
          );
        }
        const decoded = formatInferenceOutputForRecord(
          rawOutput,
          cipher,
          encryptionNonce
        );
        persistInferenceDecryptSecrets(
          publicKey.toBase58(),
          inferencePda.toBase58(),
          ephemeralSecret,
          encryptionNonce
        );
        const updates: Partial<VerifiedInferenceRecord> = {
          outputHash: toHex(new Uint8Array(account.outputHash as number[])),
          outputData: decoded,
          nodeCount: account.nodeCount as number,
          cluster: (account.arciumCluster as PublicKey).toBase58(),
          status: "Verified",
          route: "MPC",
        };
        onInferenceVerified(inferencePda.toBase58(), updates);
        onModelIncrement(model.pda);
        setCurrentInference((prev) => (prev ? { ...prev, ...updates } : prev));
        setPhase("verified");
      } else {
        setPhase("done");
      }
    } catch (err: unknown) {
      console.error("Inference failed:", err);
      setError(formatError(err));
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
              <div className="p-2.5 bg-red-500/5 border border-red-500/20 rounded-md text-[11px] text-red-400/80">
                <strong>MXE IDL not synced.</strong> Inference is disabled until
                the Arcium MPC pipeline is ready. Build with{" "}
                <code>arcium build</code> in <code>mxe/poi_mxe/</code> and run{" "}
                <code>npm run sync-idl</code> from the repo root.
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
                <p>
                  Inference request landed on-chain but the MPC callback hasn't
                  arrived within the timeout. Re-queue from the MXE explorer or
                  retry — once the MXE callback CPIs into{" "}
                  <code>callback_verified_inference</code>, this PDA flips to
                  Verified automatically.
                </p>
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

function summarizeOutput(outputData: string): string {
  if (!outputData) return "";
  try {
    const parsed = JSON.parse(outputData);
    if (parsed.label) {
      return typeof parsed.score === "number"
        ? `${parsed.label} (score ${parsed.score})`
        : parsed.label;
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
