/**
 * Stores per-inference x25519 ephemeral material so this browser can decrypt
 * MPC `output_data` after reload. Scoped by wallet + inference PDA.
 * Does not leave the device (localStorage).
 */
const PREFIX = "poi_mxe_sk:v1";

type StoredPayload = { es: string; en: string };

function toB64(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function persistInferenceDecryptSecrets(
  wallet: string,
  inferencePda: string,
  ephemeralSecret: Uint8Array,
  encryptionNonce: Uint8Array
): void {
  try {
    const key = `${PREFIX}:${wallet}:${inferencePda}`;
    const payload: StoredPayload = {
      es: toB64(ephemeralSecret),
      en: toB64(encryptionNonce),
    };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

export function loadInferenceDecryptSecrets(
  wallet: string,
  inferencePda: string
): { ephemeralSecret: Uint8Array; encryptionNonce: Uint8Array } | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}:${wallet}:${inferencePda}`);
    if (!raw) return null;
    const payload = JSON.parse(raw) as StoredPayload;
    if (!payload.es || !payload.en) return null;
    return {
      ephemeralSecret: fromB64(payload.es),
      encryptionNonce: fromB64(payload.en),
    };
  } catch {
    return null;
  }
}
