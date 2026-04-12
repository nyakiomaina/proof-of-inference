import { useState, useCallback } from "react";

export interface RegisteredModel {
  pda: string;
  owner: string;
  name: string;
  version: number;
  type: string;
  weightCommitment: string;
  totalInferences: number;
  createdAt: number;
  tx: string;
}

export interface VerifiedInferenceRecord {
  pda: string;
  modelPda: string;
  modelCommitment: string;
  inputHash: string;
  outputHash: string;
  outputData: string;
  nodeCount: number;
  cluster: string;
  timestamp: number;
  status: "Pending" | "Verified" | "Failed";
  requester: string;
  tx: string;
}

/**
 * Shared demo state across all panels.
 * The UI requires a connected Solana wallet to register models and run inferences;
 * the chain flow itself is still simulated locally (no program txs yet) until wired to a program.
 */
export function useDemoState() {
  const [models, setModels] = useState<RegisteredModel[]>([]);
  const [inferences, setInferences] = useState<VerifiedInferenceRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const registerModel = useCallback(
    (model: RegisteredModel) => {
      setModels((prev) => [...prev, model]);
    },
    []
  );

  const addInference = useCallback(
    (inference: VerifiedInferenceRecord) => {
      setInferences((prev) => [...prev, inference]);
    },
    []
  );

  const updateInference = useCallback(
    (pda: string, updates: Partial<VerifiedInferenceRecord>) => {
      setInferences((prev) =>
        prev.map((inf) => (inf.pda === pda ? { ...inf, ...updates } : inf))
      );
    },
    []
  );

  const incrementModelInferences = useCallback(
    (modelPda: string) => {
      setModels((prev) =>
        prev.map((m) =>
          m.pda === modelPda
            ? { ...m, totalInferences: m.totalInferences + 1 }
            : m
        )
      );
    },
    []
  );

  return {
    models,
    inferences,
    loading,
    setLoading,
    registerModel,
    addInference,
    updateInference,
    incrementModelInferences,
  };
}
