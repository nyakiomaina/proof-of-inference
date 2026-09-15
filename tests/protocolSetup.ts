import * as anchor from "@coral-xyz/anchor";
import {
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

export interface Protocol {
  configPda: PublicKey;
  feeVault: PublicKey;
  mint: PublicKey;
  /** Funded fee-paying token account owned by the provider wallet. */
  requesterAta: PublicKey;
}

/** Enough for many requests at the default 50_000 fee. */
const FUND_AMOUNT = 1_000_000;

/**
 * Resolves the singleton `ProtocolConfig`, creating it (along with a fee mint
 * and vault) the first time it is needed on this validator.
 *
 * It owns the mint rather than taking one, because the config is a singleton:
 * whichever spec runs first fixes the fee vault for the whole validator, and a
 * spec that then minted its own unrelated token would fail `WrongFeeVault`. On
 * a second call the mint is recovered from the already-pinned vault so every
 * spec pays fees in the same token.
 */
export async function ensureProtocol(
  // Loosely typed: this helper is shared by specs holding differently-typed
  // Program handles, and the generated IDL types blow past tsc's instantiation
  // depth when threaded through here.
  program: any,
  provider: anchor.AnchorProvider
): Promise<Protocol> {
  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  const existing = await program.account.protocolConfig.fetchNullable(configPda);
  if (existing) {
    const vault = await getAccount(connection, existing.feeVault);
    return {
      configPda,
      feeVault: existing.feeVault,
      mint: vault.mint,
      requesterAta: await fundRequester(provider, vault.mint),
    };
  }

  // Mint authority is the test wallet so specs can fund their own requesters.
  const mint = await createMint(
    connection,
    wallet.payer,
    wallet.publicKey,
    null,
    6
  );
  // Vault owner is a throwaway key: it only needs to differ from the requester,
  // otherwise the fee transfer would be a self-transfer and prove nothing.
  const vault = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet.payer,
    mint,
    Keypair.generate().publicKey
  );

  await program.methods
    .initializeProtocol()
    .accounts({
      protocolConfig: configPda,
      feeVault: vault.address,
      authority: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc();

  return {
    configPda,
    feeVault: vault.address,
    mint,
    requesterAta: await fundRequester(provider, mint),
  };
}

/**
 * Creates the wallet's fee ATA and tops it up only when it is actually short.
 * Minting unconditionally makes both specs submit a byte-identical `mintTo` in
 * the same slot, which the validator rejects as an already-processed duplicate.
 */
async function fundRequester(
  provider: anchor.AnchorProvider,
  mint: PublicKey
): Promise<PublicKey> {
  const wallet = provider.wallet as anchor.Wallet;
  const ata = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    wallet.payer,
    mint,
    wallet.publicKey
  );

  if (ata.amount < BigInt(FUND_AMOUNT) / 2n) {
    await mintTo(
      provider.connection,
      wallet.payer,
      mint,
      ata.address,
      wallet.publicKey,
      FUND_AMOUNT
    );
  }
  return ata.address;
}
