import type { AnchorProvider } from "@coral-xyz/anchor";
import type { PublicKey } from "@solana/web3.js";
import { getMXEPublicKey, RescueCipher, x25519 } from "@arcium-hq/client";

/**
 * Build a Rescue cipher for encrypting inputs to an MXE (X25519 + Rescue, per Arcium docs).
 * Next step: pack plaintext into `bigint[]` for your circuit and call `cipher.encrypt`.
 *
 * @see https://docs.arcium.com/developers/js-client-library/encryption
 */
export async function createMxeRescueCipher(
  provider: AnchorProvider,
  mxeProgramId: PublicKey
): Promise<{
  cipher: RescueCipher;
  ephemeralSecret: Uint8Array;
  ephemeralPublicKey: Uint8Array;
  nonce: Uint8Array;
}> {
  const mxePk = await getMXEPublicKey(provider, mxeProgramId);
  if (!mxePk?.length) {
    throw new Error(
      "MXE x25519 public key missing — deploy/init the MXE (`mxe/poi_mxe`) first."
    );
  }
  const ephemeralSecret = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralSecret);
  const shared = x25519.getSharedSecret(ephemeralSecret, mxePk);
  const cipher = new RescueCipher(shared);
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  return { cipher, ephemeralSecret, ephemeralPublicKey, nonce };
}

export { getMXEPublicKey, RescueCipher, x25519 };
