import { Program, AnchorProvider, BN, Idl } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createHash } from "crypto";

import idlJson from "../../target/idl/proof_of_inference.json";
import type { ProofOfInference as ProofOfInferenceProgram } from "../../target/types/proof_of_inference";
import type {
  ModelType,
  VerificationResult,
  RegisterModelResult,
  RequestInferenceResult,
  InferenceOutput,
  ModelRegistryAccount,
  VerifiedInferenceAccount,
} from "./types";

const DEFAULT_PROGRAM_ID = new PublicKey(
  (idlJson as { address: string }).address
);

/**
 * ProofOfInference client SDK.
 *
 * Wraps the raw Anchor program calls into a clean API for:
 * - Model owners to register models
 * - Users to request verified inferences
 * - Anyone to check verification status
 * - Protocols to integrate via on-chain CPI
 */
export class ProofOfInference {
  public program: Program<ProofOfInferenceProgram>;
  public provider: AnchorProvider;

  constructor(provider: AnchorProvider, programId?: PublicKey) {
    this.provider = provider;
    const idl: Idl = {
      ...(idlJson as object),
      address: (programId ?? DEFAULT_PROGRAM_ID).toBase58(),
    } as Idl;
    this.program = new Program(idl, provider) as Program<ProofOfInferenceProgram>;
  }

  // -----------------------------------------------------------------
  // PDA derivation helpers
  // -----------------------------------------------------------------

  /**
   * Derives the ModelRegistry PDA for a given owner and weight commitment.
   */
  findModelPda(
    owner: PublicKey,
    weightCommitment: Uint8Array
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("model"),
        owner.toBuffer(),
        Buffer.from(weightCommitment),
      ],
      this.program.programId
    );
  }

  /**
   * Derives the VerifiedInference PDA for a given model and nonce.
   */
  findInferencePda(
    modelPda: PublicKey,
    nonce: Uint8Array
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("inference"),
        modelPda.toBuffer(),
        Buffer.from(nonce),
      ],
      this.program.programId
    );
  }

  // -----------------------------------------------------------------
  // Instructions
  // -----------------------------------------------------------------

  /**
   * Registers a new AI model on-chain.
   *
   * @param weightCommitment SHA-256 hash of the model weights (32 bytes)
   * @param modelName        Human-readable model name (max 64 chars)
   * @param modelVersion     Version number
   * @param modelType        Classification of the model's purpose
   * @param mxeConfig        Arcium MXE config account public key
   */
  async registerModel(
    weightCommitment: Uint8Array,
    modelName: string,
    modelVersion: number,
    modelType: ModelType,
    mxeConfig: PublicKey
  ): Promise<RegisterModelResult> {
    const owner = this.provider.publicKey;
    const [modelPda] = this.findModelPda(owner, weightCommitment);

    const tx = await this.program.methods
      .registerModel(
        Array.from(weightCommitment) as any,
        modelName,
        modelVersion,
        modelType
      )
      .accounts({
        modelRegistry: modelPda,
        mxeConfig,
        owner,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    return { pda: modelPda, tx };
  }

  /**
   * Updates a registered model's configuration.
   * Only the model owner can call this.
   */
  async updateModel(
    modelPda: PublicKey,
    params: {
      active?: boolean;
      mxeConfig?: PublicKey;
      modelVersion?: number;
    }
  ): Promise<string> {
    const tx = await this.program.methods
      .updateModel(
        params.active ?? null,
        params.mxeConfig ?? null,
        params.modelVersion ?? null
      )
      .accounts({
        modelRegistry: modelPda,
        owner: this.provider.publicKey,
      } as any)
      .rpc();

    return tx;
  }

  /**
   * Requests a verified inference from a registered model.
   *
   * The input is encrypted client-side. A verification fee is transferred
   * from the requester's token account to the protocol vault.
   *
   * @param modelPda         The ModelRegistry PDA to run inference against
   * @param inputData        Raw input data (will be used as-is; encrypt before calling)
   * @param nonce            32-byte unique nonce for this request
   * @param requesterToken   Requester's USDC token account
   * @param protocolFeeVault Protocol's fee collection token account
   */
  async requestInference(
    modelPda: PublicKey,
    inputData: Uint8Array,
    nonce: Uint8Array,
    requesterToken: PublicKey,
    protocolFeeVault: PublicKey
  ): Promise<RequestInferenceResult> {
    const [inferencePda] = this.findInferencePda(modelPda, nonce);

    const tx = await this.program.methods
      .requestInference(
        Buffer.from(inputData),
        Array.from(nonce) as any
      )
      .accounts({
        modelRegistry: modelPda,
        verifiedInference: inferencePda,
        requester: this.provider.publicKey,
        requesterToken,
        protocolFeeVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    return { inferencePda, tx };
  }

  /**
   * Fetches and returns the verification status of an inference.
   */
  async getVerification(inferencePda: PublicKey): Promise<VerificationResult> {
    const account = (await this.program.account.verifiedInference.fetch(
      inferencePda
    )) as unknown as VerifiedInferenceAccount;

    return {
      verified: "verified" in account.status,
      model: account.model,
      modelCommitment: new Uint8Array(account.modelCommitment),
      nodeCount: account.nodeCount,
      timestamp: account.timestamp.toNumber(),
      cluster: account.arciumCluster,
    };
  }

  /**
   * Fetches the full VerifiedInference account data.
   */
  async getInferenceAccount(
    inferencePda: PublicKey
  ): Promise<VerifiedInferenceAccount> {
    return (await this.program.account.verifiedInference.fetch(
      inferencePda
    )) as unknown as VerifiedInferenceAccount;
  }

  /**
   * Fetches the full ModelRegistry account data.
   */
  async getModelAccount(modelPda: PublicKey): Promise<ModelRegistryAccount> {
    return (await this.program.account.modelRegistry.fetch(
      modelPda
    )) as unknown as ModelRegistryAccount;
  }

  /**
   * Fetches all registered models.
   */
  async getAllModels(): Promise<
    { publicKey: PublicKey; account: ModelRegistryAccount }[]
  > {
    return (await this.program.account.modelRegistry.all()) as any;
  }

  /**
   * Fetches all inferences for a specific model.
   */
  async getModelInferences(
    modelPda: PublicKey
  ): Promise<{ publicKey: PublicKey; account: VerifiedInferenceAccount }[]> {
    return (await this.program.account.verifiedInference.all([
      {
        memcmp: {
          offset: 8, // after discriminator
          bytes: modelPda.toBase58(),
        },
      },
    ])) as any;
  }

  /**
   * Fetches all inferences requested by a specific wallet.
   */
  async getRequesterInferences(
    requester: PublicKey
  ): Promise<{ publicKey: PublicKey; account: VerifiedInferenceAccount }[]> {
    // requester field offset: 8 (discriminator) + 32 (model) + 32 (model_commitment)
    //   + 32 (input_hash) + 32 (output_hash) + 4 + up to 1024 (output_data vec)
    // Due to variable-length output_data, filter client-side instead.
    const all = (await this.program.account.verifiedInference.all()) as any[];
    return all.filter(
      (item: any) => item.account.requester.toBase58() === requester.toBase58()
    );
  }

  // -----------------------------------------------------------------
  // Utility helpers
  // -----------------------------------------------------------------

  /**
   * Computes a SHA-256 weight commitment from raw model weight bytes.
   * Use this to generate the commitment before calling registerModel.
   */
  static computeWeightCommitment(weightBytes: Uint8Array): Uint8Array {
    const hash = createHash("sha256");
    hash.update(weightBytes);
    return new Uint8Array(hash.digest());
  }

  /**
   * Generates a random 32-byte nonce for an inference request.
   */
  static generateNonce(): Uint8Array {
    return Keypair.generate().publicKey.toBytes();
  }

  /**
   * Parses the decrypted output bytes into a structured InferenceOutput.
   * The output format matches the Arcis circuit's InferenceOutput struct.
   */
  static parseOutput(decryptedBytes: Uint8Array): InferenceOutput {
    // Layout: classification (1 byte) + confidence (8 bytes f64 LE) + model_hash (32 bytes)
    if (decryptedBytes.length < 41) {
      throw new Error(
        `Invalid output length: expected >= 41 bytes, got ${decryptedBytes.length}`
      );
    }

    const classification = decryptedBytes[0];
    const confidenceView = new DataView(decryptedBytes.buffer, decryptedBytes.byteOffset + 1, 8);
    const confidence = confidenceView.getFloat64(0, true); // little-endian
    const modelHash = decryptedBytes.slice(9, 41);

    return { classification, confidence, modelHash };
  }

  /**
   * Returns a human-readable label for a classification value.
   */
  static classificationLabel(classification: number): string {
    switch (classification) {
      case 0:
        return "Negative";
      case 1:
        return "Neutral";
      case 2:
        return "Positive";
      default:
        return "Unknown";
    }
  }
}
