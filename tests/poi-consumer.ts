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

import poiIdl from "../target/idl/proof_of_inference.json";
import consumerIdl from "../target/idl/poi_consumer.json";
import type { ProofOfInference } from "../target/types/proof_of_inference";
import type { PoiConsumer } from "../target/types/poi_consumer";

/**
 * End-to-end sanity check that the consumer program can CPI into
 * `check_verification` and gate an action on the result. Mirrors the existing
 * proof-of-inference local test up to the `Verified` state, then invokes
 * `gated_action` and asserts the action log was written and the on-chain
 * checks (Verified status, node_count >= min, model_commitment match) hold.
 */
describe("poi_consumer (gated_action via CPI)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new anchor.Program(
    poiIdl as Idl,
    provider
  ) as anchor.Program<ProofOfInference>;
  const consumer = new anchor.Program(
    consumerIdl as Idl,
    provider
  ) as anchor.Program<PoiConsumer>;

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

  it("register → request → callback → gated_action via CPI", async () => {
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
        "consumer-test-model",
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
      [Buffer.from("inference"), modelPda.toBuffer(), Buffer.from(nonce)],
      program.programId
    );

    await program.methods
      .requestInference(
        Buffer.from("consumer-test-encrypted-input"),
        Array.from(nonce)
      )
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

    const cluster = Keypair.generate().publicKey;
    const outputData = Buffer.from([7, 8, 9, 10]);
    await program.methods
      .callbackVerifiedInference(outputData, cluster, 4)
      .accounts({
        verifiedInference: inferencePda,
        modelRegistry: modelPda,
        arciumAuthority: arciumAuthority.publicKey,
      } as any)
      .signers([arciumAuthority])
      .rpc();

    const actionId = new BN(42);
    const [actionLogPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("action"),
        wallet.publicKey.toBuffer(),
        actionId.toArrayLike(Buffer, "le", 8),
      ],
      consumer.programId
    );

    await consumer.methods
      .gatedAction(actionId, 3, Array.from(weightCommitment))
      .accounts({
        user: wallet.publicKey,
        verifiedInference: inferencePda,
        actionLog: actionLogPda,
        proofOfInferenceProgram: program.programId,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    const log = await consumer.account.gatedActionLog.fetch(actionLogPda);
    expect(log.user.toBase58()).to.equal(wallet.publicKey.toBase58());
    expect(log.inference.toBase58()).to.equal(inferencePda.toBase58());
    expect(log.model.toBase58()).to.equal(modelPda.toBase58());
    expect(log.nodeCount).to.equal(4);
    expect(log.cluster.toBase58()).to.equal(cluster.toBase58());

    let threw: any = null;
    try {
      const replayId = new BN(43);
      const [replayPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("action"),
          wallet.publicKey.toBuffer(),
          replayId.toArrayLike(Buffer, "le", 8),
        ],
        consumer.programId
      );
      await consumer.methods
        .gatedAction(replayId, 99, Array.from(weightCommitment))
        .accounts({
          user: wallet.publicKey,
          verifiedInference: inferencePda,
          actionLog: replayPda,
          proofOfInferenceProgram: program.programId,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
    } catch (e: any) {
      threw = e;
    }
    expect(threw, "should reject when min_node_count exceeds attestation").to
      .not.be.null;
    expect(String(threw)).to.match(/InsufficientAttestation|0x[0-9a-fA-F]+/);
  });
});
