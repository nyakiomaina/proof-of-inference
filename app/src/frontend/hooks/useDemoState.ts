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
 * Shared UI state for registered models and verified inferences. Actual Solana
 * transactions are submitted by the panels themselves; this hook only mirrors
 * the results client-side so all panels see the same list.
 */
export function useDemoState() {
  const [models, setModels] = useState<RegisteredModel[]>([]);
  const [inferences, setInferences] = useState<VerifiedInferenceRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const registerModel = useCallback(
    (model: RegisteredModel) => {
      setModels((prev) => {
        if (prev.some((m) => m.pda === model.pda)) return prev;
        return [...prev, model];
      });
    },
    []
  );

  const loadModels = useCallback((next: RegisteredModel[]) => {
    setModels(next);
  }, []);

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
    loadModels,
    addInference,
    updateInference,
    incrementModelInferences,
  };
}
