/**
 * Model weight binding.
 *
 * The MPC circuit (`mxe/poi_mxe/encrypted-ixs/src/lib.rs`) receives the weights
 * as caller-supplied ciphertexts, so nothing about the call itself proves they
 * are the weights the model committed to. The circuit closes that gap by
 * recomputing the commitment *inside* MPC over the weights it was actually
 * given and revealing it; `proof_of_inference::callback_verified_inference`
 * rejects the attestation unless it equals the registry's `weight_commitment`.
 *
 * That check is only as good as this file agreeing with the circuit byte for
 * byte. The preimage is:
 *
 *   "poi-weights-v2" (14 bytes) || w0 || w1 || bias || threshold || salt (8)
 *
 * hashed with SHA3-256 (Keccak padding), because SHA3-256 is what the arcis
 * standard library provides inside a circuit. WebCrypto has no SHA3, hence
 * `@noble/hashes`.
 *
 * The salt is what keeps the weights secret: the four parameters are one byte
 * each, so an unsalted commitment is brute-forceable in 2^32. It is generated at
 * registration, stored next to the weights, and never leaves the client except
 * as ciphertext bound for the MPC cluster.
 */
import { sha3_256 } from "@noble/hashes/sha3";

export interface ModelWeights {
  w0: number;
  w1: number;
  bias: number;
  threshold: number;
  /** 8-byte commitment salt, hex-encoded (16 chars). */
  salt: string;
}

/** Must equal `DOMAIN` in the circuit. */
const DOMAIN_TAG = "poi-weights-v2";
/** Must equal `SALT_LEN` in the circuit. */
export const SALT_LEN = 8;

const STORAGE_KEY = "poi.modelWeights";

export function randomSalt(): string {
  const bytes = new Uint8Array(SALT_LEN);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export function saltToBytes(salt: string): Uint8Array {
  if (!/^[0-9a-f]{16}$/i.test(salt)) {
    throw new Error(
      `Salt must be ${SALT_LEN} bytes as ${SALT_LEN * 2} hex chars; got "${salt}"`
    );
  }
  const out = new Uint8Array(SALT_LEN);
  for (let i = 0; i < SALT_LEN; i++) {
    out[i] = parseInt(salt.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * SHA3-256("poi-weights-v2" || w0 || w1 || bias || threshold || salt).
 * Synchronous — unlike the old WebCrypto version — so callers no longer await.
 */
export function commitmentForWeights(weights: ModelWeights): Uint8Array {
  validate(weights);
  const tag = new TextEncoder().encode(DOMAIN_TAG);
  const salt = saltToBytes(weights.salt);
  const buf = new Uint8Array(tag.length + 4 + SALT_LEN);
  buf.set(tag, 0);
  buf.set(
    [weights.w0, weights.w1, weights.bias, weights.threshold],
    tag.length
  );
  buf.set(salt, tag.length + 4);
  return sha3_256(buf);
}

function validate(w: ModelWeights) {
  for (const k of ["w0", "w1", "bias", "threshold"] as const) {
    const v = w[k];
    if (!Number.isInteger(v) || v < 0 || v > 255) {
      throw new Error(`Weight \`${k}\` must be an integer in [0, 255]; got ${v}`);
    }
  }
  saltToBytes(w.salt);
}

function readStore(): Record<string, ModelWeights> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, ModelWeights>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* quota / private-mode — silently swallow, demo doesn't depend on this */
  }
}

export function saveWeights(modelPda: string, weights: ModelWeights) {
  validate(weights);
  const store = readStore();
  store[modelPda] = weights;
  writeStore(store);
}

export function loadWeights(modelPda: string): ModelWeights | null {
  return readStore()[modelPda] ?? null;
}

// w0=1, w1=0, bias=0, threshold=127:
// score = f0 * 1 = f0 (0–255, centered at 128)
// f0 encodes net sentiment: 128 + (posCount - negCount) * 20, clamped [0,255]
// score > 127 → Positive; score <= 127 → Negative
//
// The salt is filled in per registration by `randomSalt()`; a shared constant
// salt would defeat the point, so this is only a starting point for the form.
export function defaultWeights(): ModelWeights {
  return { w0: 1, w1: 0, bias: 0, threshold: 127, salt: randomSalt() };
}
