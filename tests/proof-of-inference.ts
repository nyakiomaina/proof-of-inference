import * as anchor from "@coral-xyz/anchor";
import { Idl } from "@coral-xyz/anchor";
import { expect } from "chai";
import BN from "bn.js";
import { randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import idl from "../target/idl/proof_of_inference.json";
import type { ProofOfInference as ProofOfInferenceProgram } from "../target/types/proof_of_inference";

/**
 * Full local flow on the validator that `anchor test` starts:
 * register → request (fee transfer) → callback (signs with committed test keypair) → verified.
 * No mainnet/devnet, no real Arcium — the callback keypair matches the program constant.
 */
describe("proof_of_inference (local e2e)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new anchor.Program(
    idl as Idl,
    provider
  ) as anchor.Program<ProofOfInferenceProgram>;

  const wallet = provider.wallet as anchor.Wallet;
  const payer = wallet.payer;
  const connection = provider.connection;

  const arciumJsonPath = path.join(
    __dirname,
    "fixtures",
    "arcium_callback_authority.json"
  );
  const arciumAuthority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(arciumJsonPath, "utf8")))
  );

  it("register → request_inference → callback → verified", async () => {
    expect(arciumAuthority.publicKey.toBase58()).to.equal(
      "frM1CnN1bvUDTHFSLCHQ7Mnb9PZp5u2fW7CLuWXscZM"
    );

    const mint = await createMint(
      connection,
      payer,
      wallet.publicKey,
      null,
      6
    );

    const vaultOwner = Keypair.generate();
    {
      const sig = await connection.requestAirdrop(vaultOwner.publicKey, 2e9);
      const latest = await connection.getLatestBlockhash();
      await connection.confirmTransaction(
        { signature: sig, ...latest },
        "confirmed"
      );
    }

    const requesterAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      wallet.publicKey
    );

    const protocolFeeVault = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      vaultOwner.publicKey
    );

    await mintTo(
      connection,
      payer,
      mint,
      requesterAta.address,
      wallet.publicKey,
      1_000_000
    );

    const weightCommitment = Uint8Array.from(randomBytes(32));
    const mxeConfig = SystemProgram.programId;

    const [modelPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("model"),
        wallet.publicKey.toBuffer(),
        Buffer.from(weightCommitment),
      ],
      program.programId
    );

    await program.methods
      .registerModel(
        Array.from(weightCommitment),
        "local-test-model",
        1,
        { sentimentClassifier: {} }
      )
      .accounts({
        modelRegistry: modelPda,
        mxeConfig,
        owner: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    const nonce = Uint8Array.from(randomBytes(32));
    const [inferencePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("inference"),
        modelPda.toBuffer(),
        Buffer.from(nonce),
      ],
      program.programId
    );

    const fakeCiphertext = Buffer.from("local-test-not-real-encryption");

    await program.methods
      .requestInference(fakeCiphertext, Array.from(nonce))
      .accounts({
        modelRegistry: modelPda,
        verifiedInference: inferencePda,
        requester: wallet.publicKey,
        requesterToken: requesterAta.address,
        protocolFeeVault: protocolFeeVault.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    let inf = await program.account.verifiedInference.fetch(inferencePda);
    expect(inf.status).to.have.property("pending");

    const cluster = Keypair.generate().publicKey;
    const outputData = Buffer.from([0, 1, 2, 3, 4]);

    await program.methods
      .callbackVerifiedInference(outputData, cluster, 3)
      .accounts({
        verifiedInference: inferencePda,
        modelRegistry: modelPda,
        arciumAuthority: arciumAuthority.publicKey,
      } as any)
      .signers([arciumAuthority])
      .rpc();

    inf = await program.account.verifiedInference.fetch(inferencePda);
    expect(inf.status).to.have.property("verified");
    expect(inf.nodeCount).to.equal(3);
    expect(Buffer.from(inf.outputData).equals(outputData)).to.be.true;

    const model = await program.account.modelRegistry.fetch(modelPda);
    const total =
      model.totalInferences instanceof BN
        ? model.totalInferences.toNumber()
        : Number(model.totalInferences);
    expect(total).to.equal(1);
  });
});
