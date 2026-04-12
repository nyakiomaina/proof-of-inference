import { useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program, Idl } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import idlJson from "../../../../target/idl/proof_of_inference.json";

const PROGRAM_ID = new PublicKey((idlJson as { address: string }).address);

/**
 * Returns an Anchor Program instance connected to the user's wallet.
 * Returns `null` when the wallet is not connected.
 */
export function useProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const provider = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction) return null;
    return new AnchorProvider(
      connection,
      wallet as any,
      AnchorProvider.defaultOptions()
    );
  }, [connection, wallet.publicKey, wallet.signTransaction]);

  const program = useMemo(() => {
    if (!provider) return null;
    const idl: Idl = { ...(idlJson as object) } as Idl;
    return new Program(idl, provider);
  }, [provider]);

  return { program, provider, programId: PROGRAM_ID };
}

/**
 * Derives the ModelRegistry PDA.
 */
export function findModelPda(
  owner: PublicKey,
  weightCommitment: Uint8Array
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("model"), owner.toBuffer(), Buffer.from(weightCommitment)],
    PROGRAM_ID
  );
}

/**
 * Derives the VerifiedInference PDA.
 */
export function findInferencePda(
  modelPda: PublicKey,
  nonce: Uint8Array
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("inference"), modelPda.toBuffer(), Buffer.from(nonce)],
    PROGRAM_ID
  );
}
