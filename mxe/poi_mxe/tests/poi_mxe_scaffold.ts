import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { PoiMxeScaffold } from "../target/types/poi_mxe_scaffold";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  getArciumProgram,
  uploadCircuit,
  RescueCipher,
  deserializeLE,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getLookupTableAddress,
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

/**
 * Smoke test for the deployed `run_inference_v2` Arcis circuit + MXE program.
 *
 * Flow:
 *   1. Init the run_inference_v2 computation definition + upload the circuit.
 *   2. Encrypt 6 u8 inputs (w0, w1, bias, threshold, f0, f1) with the MXE
 *      public key + a per-request Rescue nonce.
 *   3. Queue a computation. We pass placeholder pubkeys for the
 *      proof-of-inference CPI extras (the callback's CPI back into the main
 *      program is exercised by the e2e tests in the root workspace; here we
 *      only verify the MPC roundtrip itself is healthy).
 *   4. Await the InferenceResultEvent and decrypt both ciphertexts.
 *   5. Assert classification + score are consistent with the plaintext
 *      computation `score = bias + f0*w0 + f1*w1`, `classification = score > threshold`.
 *
 * NOTE: requires `arcium localnet` running. `arcium test` boots it for you.
 */
describe("PoiMxeScaffold", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace
    .PoiMxeScaffold as Program<PoiMxeScaffold>;
  const provider = anchor.getProvider();
  const arciumProgram = getArciumProgram(provider as anchor.AnchorProvider);

  type Event = anchor.IdlEvents<(typeof program)["idl"]>;
  const awaitEvent = async <E extends keyof Event>(
    eventName: E,
  ): Promise<Event[E]> => {
    let listenerId: number;
    const event = await new Promise<Event[E]>((res) => {
      listenerId = program.addEventListener(eventName, (event) => {
        res(event);
      });
    });
    await program.removeEventListener(listenerId);

    return event;
  };

  const arciumEnv = getArciumEnv();
  const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);

  it("queues run_inference_v2 and finalizes with a verifiable result", async () => {
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    console.log("Initializing run_inference_v2 computation definition");
    const initSig = await initRunInferenceV2CompDef(program, owner);
    console.log("  init sig:", initSig);

    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId,
    );
    console.log("MXE x25519 pubkey:", mxePublicKey);

    const ephemeralSecret = x25519.utils.randomSecretKey();
    const ephemeralPublicKey = x25519.getPublicKey(ephemeralSecret);
    const sharedSecret = x25519.getSharedSecret(ephemeralSecret, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    // Plaintext that should classify as "above threshold":
    //   score = 10 + 7*3 + 4*2 = 39   ← below 30 threshold? let's pick numbers
    //   that exceed the threshold to assert a deterministic class.
    //   With w0=3, w1=2, bias=10, threshold=30, f0=7, f1=4 → score = 39 > 30 → class 1.
    const w0 = BigInt(3);
    const w1 = BigInt(2);
    const bias = BigInt(10);
    const threshold = BigInt(30);
    const f0 = BigInt(7);
    const f1 = BigInt(4);
    const expectedScore = Number(bias + f0 * w0 + f1 * w1);
    const expectedClass = expectedScore > Number(threshold) ? 1 : 0;

    const plaintext = [w0, w1, bias, threshold, f0, f1];
    const nonce = randomBytes(16);
    const ciphertext = cipher.encrypt(plaintext, nonce);

    const eventPromise = awaitEvent("inferenceResultEvent");
    const computationOffset = new anchor.BN(randomBytes(8), "hex");

    // Placeholder pubkeys for the proof-of-inference CPI extras. Required by
    // the program signature but the CPI itself isn't exercised here — see the
    // root workspace tests for the cross-program flow. SystemProgram is a
    // safe stand-in (it exists in every cluster).
    const placeholder = SystemProgram.programId;

    const queueSig = await program.methods
      .runInferenceV2(
        computationOffset,
        ciphertext.map((ct) => Array.from(ct)),
        Array.from(ephemeralPublicKey),
        new anchor.BN(deserializeLE(nonce).toString()),
        placeholder,
        placeholder,
        placeholder,
      )
      .accountsPartial({
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          computationOffset,
        ),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(
          arciumEnv.arciumClusterOffset,
        ),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("run_inference_v2")).readUInt32LE(),
        ),
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log("  queue sig:", queueSig);

    const finalizeSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      computationOffset,
      program.programId,
      "confirmed",
    );
    console.log("  finalize sig:", finalizeSig);

    const event = await eventPromise;
    // The MXE callback will likely fail when CPI'ing into SystemProgram with
    // the placeholder accounts — but the InferenceResultEvent is emitted
    // *before* the CPI, so we still observe the encrypted MPC output.
    const decrypted = cipher.decrypt(
      [event.classificationCt, event.confidenceCt],
      event.nonce,
    );
    const classification = Number(decrypted[0]);
    const score = Number(decrypted[1]);

    console.log("  decrypted:", { classification, score });
    expect(classification).to.equal(expectedClass);
    expect(score).to.equal(expectedScore);
  });

  async function initRunInferenceV2CompDef(
    program: Program<PoiMxeScaffold>,
    owner: anchor.web3.Keypair,
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount",
    );
    const offset = getCompDefAccOffset("run_inference_v2");

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgramId(),
    )[0];
    console.log("  comp def PDA:", compDefPDA.toBase58());

    const mxeAccount = getMXEAccAddress(program.programId);
    const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
    const lutAddress = getLookupTableAddress(
      program.programId,
      mxeAcc.lutOffsetSlot,
    );

    // Skip if the comp def already exists (test runs are idempotent).
    const existing = await provider.connection.getAccountInfo(compDefPDA);
    if (existing) {
      console.log("  comp def already initialized — skipping init + upload");
      return "already-initialized";
    }

    const sig = await program.methods
      .initRunInferenceV2CompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount,
        addressLookupTable: lutAddress,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    const rawCircuit = fs.readFileSync("build/run_inference_v2.arcis");
    await uploadCircuit(
      provider as anchor.AnchorProvider,
      "run_inference_v2",
      program.programId,
      rawCircuit,
      true,
      500,
      {
        skipPreflight: true,
        preflightCommitment: "confirmed",
        commitment: "confirmed",
      },
    );

    return sig;
  }
});

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxRetries: number = 20,
  retryDelayMs: number = 500,
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mxePublicKey = await getMXEPublicKey(provider, programId);
      if (mxePublicKey) {
        return mxePublicKey;
      }
    } catch (error) {
      console.log(`  attempt ${attempt} failed:`, error);
    }

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(
    `Failed to fetch MXE public key after ${maxRetries} attempts`,
  );
}

function readKpJson(path: string): anchor.web3.Keypair {
  const file = fs.readFileSync(path);
  return anchor.web3.Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(file.toString())),
  );
}
