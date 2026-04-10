import idlJson from "../../target/idl/proof_of_inference.json";

export { ProofOfInference } from "./client";
export const IDL = idlJson;
export type { ProofOfInference as ProofOfInferenceProgram } from "../../target/types/proof_of_inference";
export type {
  ModelType,
  VerificationStatus,
  VerificationResult,
  ModelRegistryAccount,
  VerifiedInferenceAccount,
} from "./types";
