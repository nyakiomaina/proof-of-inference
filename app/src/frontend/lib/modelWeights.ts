/**
 * Model weight binding helpers.
 *
 * Today the deployed MPC circuit (`mxe/poi_mxe/encrypted-ixs/src/lib.rs`) consumes
 * four `u8` parameters (`w0`, `w1`, `bias`, `threshold`). On-chain the model
 * registry only stores a 32-byte `weight_commitment` — there is no enforced link
 * between that hash and the bytes the circuit actually receives.
 *
 * To close the gap, the UI:
 *   1. Hashes the canonical 4-byte weight tuple with a domain tag → on-chain commitment.
 *   2. Persists the weights in localStorage keyed by the model PDA so the inference
 *      panel can re-feed them into the MPC queue.
 *
 * This is application-enforced, not on-chain enforced, but it gives the demo a
 * verifiable link any auditor can re-derive: pull the model PDA, fetch its weights
 * from localStorage / off-chain storage, hash them with the same domain tag, and
 * compare to `weight_commitment` on chain.
 */

export interface ModelWeights {
  w0: number;
  w1: number;
  bias: number;
  threshold: number;
}

const DOMAIN_TAG = "poi-weights-v1";

const STORAGE_KEY = "poi.modelWeights";

/**
 * SHA-256(`poi-weights-v1` || w0 || w1 || bias || threshold) as a 32-byte commitment.
 * Domain tag prevents collision with the legacy "SHA-256 of arbitrary text" path.
 */
export async function commitmentForWeights(
  weights: ModelWeights
): Promise<Uint8Array> {
  validate(weights);
  const tag = new TextEncoder().encode(DOMAIN_TAG);
  const body = new Uint8Array([
    weights.w0,
    weights.w1,
    weights.bias,
    weights.threshold,
  ]);
  const buf = new Uint8Array(tag.length + body.length);
  buf.set(tag, 0);
  buf.set(body, tag.length);
  const hashBuf = await crypto.subtle.digest(
    "SHA-256",
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  );
  return new Uint8Array(hashBuf);
}

function validate(w: ModelWeights) {
  for (const [k, v] of Object.entries(w)) {
    if (!Number.isInteger(v) || v < 0 || v > 255) {
      throw new Error(`Weight \`${k}\` must be an integer in [0, 255]; got ${v}`);
    }
  }
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

export const DEFAULT_WEIGHTS: ModelWeights = {
  w0: 3,
  w1: 2,
  bias: 10,
  threshold: 50,
};
