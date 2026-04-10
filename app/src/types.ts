import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

// -------------------------------------------------------------------
// Enum types mirroring the on-chain program
// -------------------------------------------------------------------

export type ModelType =
  | { sentimentClassifier: {} }
  | { textClassifier: {} }
  | { riskScorer: {} }
  | { anomalyDetector: {} }
  | { customClassifier: {} };

export type VerificationStatus =
  | { pending: {} }
  | { verified: {} }
  | { failed: {} };

// -------------------------------------------------------------------
// Deserialized on-chain account types
// -------------------------------------------------------------------

export interface ModelRegistryAccount {
  owner: PublicKey;
  weightCommitment: number[];
  modelName: string;
  modelVersion: number;
  modelType: ModelType;
  totalInferences: BN;
  createdAt: BN;
  active: boolean;
  mxeConfig: PublicKey;
  bump: number;
}

export interface VerifiedInferenceAccount {
  model: PublicKey;
  modelCommitment: number[];
  inputHash: number[];
  outputHash: number[];
  outputData: Buffer;
  requester: PublicKey;
  arciumCluster: PublicKey;
  nodeCount: number;
  timestamp: BN;
  status: VerificationStatus;
  bump: number;
}

// -------------------------------------------------------------------
// Return types for the SDK
// -------------------------------------------------------------------

export interface VerificationResult {
  verified: boolean;
  model: PublicKey;
  modelCommitment: Uint8Array;
  nodeCount: number;
  timestamp: number;
  cluster: PublicKey;
}

export interface RegisterModelResult {
  pda: PublicKey;
  tx: string;
}

export interface RequestInferenceResult {
  inferencePda: PublicKey;
  tx: string;
}

export interface InferenceOutput {
  classification: number;
  confidence: number;
  modelHash: Uint8Array;
}
