import type { AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  getMXEPublicKey,
  RescueCipher,
  x25519,
} from "@arcium-hq/client";

export type MpcPlaintextDisplay = {
  classification: number;
  label: string;
  score: number;
};

export function circuitClassificationLabel(classification: number): string {
  switch (classification) {
    case 0:
      return "Negative";
    case 1:
      return "Positive";
    default:
      return "Unknown";
  }
}

/** Wire: `classification_ct[32] || score_ct[32]` + optional `|| mpc_output_nonce[16]`. */
export function tryDecryptMpcOutputPayload(
  raw: Uint8Array,
  cipher: RescueCipher,
  requestEncryptNonce: Uint8Array | null
): MpcPlaintextDisplay | null {
  if (raw.length === 0) return null;

  let ctSlice: Uint8Array;
  let decryptNonce: Uint8Array | null = null;
  if (raw.length >= 80) {
    ctSlice = raw.subarray(0, 64);
    decryptNonce = raw.subarray(64, 80);
  } else if (raw.length === 64) {
    ctSlice = raw;
    decryptNonce = requestEncryptNonce;
  } else {
    return null;
  }

  if (!decryptNonce || decryptNonce.length !== 16 || ctSlice.length !== 64) {
    return null;
  }

  try {
    const classificationCt = Array.from(ctSlice.subarray(0, 32));
    const scoreCt = Array.from(ctSlice.subarray(32, 64));
    const values = cipher.decrypt([classificationCt, scoreCt], decryptNonce);
    const clsRaw = values[0];
    const scoreRaw = values[1];
    const classification =
      typeof clsRaw === "bigint" ? Number(clsRaw) : Number(clsRaw);
    if (
      !Number.isInteger(classification) ||
      classification < 0 ||
      classification > 1
    ) {
      return null;
    }
    if (
      typeof scoreRaw !== "bigint" ||
      scoreRaw < 0n ||
      scoreRaw > 65535n
    ) {
      return null;
    }
    const score = Number(scoreRaw);
    return {
      classification,
      label: circuitClassificationLabel(classification),
      score,
    };
  } catch {
    return null;
  }
}

export async function tryDecryptMpcOutputPayloadFromSecrets(
  provider: AnchorProvider,
  mxeProgramId: PublicKey,
  raw: Uint8Array,
  ephemeralSecret: Uint8Array,
  requestEncryptNonce: Uint8Array
): Promise<MpcPlaintextDisplay | null> {
  const mxePk = await getMXEPublicKey(provider, mxeProgramId);
  if (!mxePk?.length) return null;
  const shared = x25519.getSharedSecret(ephemeralSecret, mxePk);
  const cipher = new RescueCipher(shared);
  return tryDecryptMpcOutputPayload(raw, cipher, requestEncryptNonce);
}

export function formatInferenceOutputForRecord(
  raw: Uint8Array,
  cipher: RescueCipher | null,
  requestEncryptNonce: Uint8Array | null
): string {
  if (raw.length === 0) return "";

  const pt =
    cipher && requestEncryptNonce
      ? tryDecryptMpcOutputPayload(raw, cipher, requestEncryptNonce)
      : null;
  if (pt) return JSON.stringify(pt);

  try {
    const asText = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    JSON.parse(asText);
    return asText;
  } catch {}

  return JSON.stringify({
    raw: Array.from(raw).map((b) => b.toString(16).padStart(2, "0")).join(""),
  });
}

export function mpcPlaintextToJson(p: MpcPlaintextDisplay): string {
  return JSON.stringify(p);
}

export function hexStringToBytes(hex: string): Uint8Array | null {
  const t = hex.trim();
  if (!/^[0-9a-f]+$/i.test(t) || t.length % 2 !== 0) return null;
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(t.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
