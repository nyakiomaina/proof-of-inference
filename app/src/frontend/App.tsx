import React from "react";
import { WalletProvider } from "./WalletProvider";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { RegisterModelPanel } from "./components/RegisterModelPanel";
import { RunInferencePanel } from "./components/RunInferencePanel";
import { VerifyComparePanel } from "./components/VerifyComparePanel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useDemoState } from "./hooks/useDemoState";
import { useOnChainModels } from "./hooks/useOnChainModels";
import { useOnChainInferences } from "./hooks/useOnChainInferences";
import { useProgram } from "./hooks/useProgram";

function Dashboard() {
  const {
    models,
    inferences,
    loading,
    setLoading,
    registerModel,
    loadModels,
    loadInferences,
    addInference,
    updateInference,
    incrementModelInferences,
  } = useDemoState();

  const { program } = useProgram();
  useOnChainModels(program, loadModels);
  useOnChainInferences(program, loadInferences);

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-800/60 bg-gray-950 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt=""
              width={112}
              height={74}
              className="h-7 w-auto object-contain rounded-md ring-1 ring-gray-800/80"
              decoding="async"
            />
            <span className="text-sm font-semibold text-gray-100 tracking-tight">
              proof-of-inference
            </span>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-3 text-xs text-gray-500">
              <span>{models.length} models</span>
              <span className="text-gray-700">|</span>
              <span>{inferences.filter((i) => i.status === "Verified").length} verified</span>
              <span className="text-gray-700">|</span>
              <span>{inferences.filter((i) => i.status === "Failed").length} failed</span>
            </div>
            <WalletMultiButton />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Intro */}
        <div className="max-w-xl">
          <h2 className="text-xl font-semibold text-gray-100 mb-1">
            Verified AI inference on Solana
          </h2>
          <p className="text-sm text-gray-500 leading-relaxed">
            Cryptographic proof that a specific model produced a specific output,
            computed via Arcium MPC. No weights, inputs, or intermediate state revealed.
          </p>
        </div>

        {/* Panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <RegisterModelPanel
            onRegister={registerModel}
            loading={loading}
            setLoading={setLoading}
          />
          <RunInferencePanel
            models={models}
            onInferenceCreated={addInference}
            onInferenceVerified={updateInference}
            onModelIncrement={incrementModelInferences}
            loading={loading}
            setLoading={setLoading}
          />
        </div>

        <VerifyComparePanel inferences={inferences} />

        {/* How it works */}
        <div className="card">
          <div className="card-header">Protocol flow</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <FlowStep
              n="01"
              title="Register"
              text="Owner commits SHA-256 of weights to a Solana PDA. Weights stay off-chain."
            />
            <FlowStep
              n="02"
              title="Encrypt"
              text="User encrypts input features with x25519 + Rescue cipher via Arcium SDK."
            />
            <FlowStep
              n="03"
              title="Compute"
              text="Arcium MPC cluster runs the circuit. No single node sees full data."
            />
            <FlowStep
              n="04"
              title="Attest"
              text="Callback writes encrypted result + cluster metadata on-chain. Verifiable via CPI."
            />
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-800/40 py-4 text-center text-xs text-gray-700">
        proof-of-inference &middot; solana + arcium
      </footer>
    </div>
  );
}

function FlowStep({ n, title, text }: { n: string; title: string; text: string }) {
  return (
    <div className="p-3 rounded-md border border-gray-800/60 bg-gray-900/40">
      <div className="text-[10px] font-mono text-gray-600 mb-1">{n}</div>
      <div className="text-sm font-medium text-gray-200 mb-0.5">{title}</div>
      <p className="text-xs text-gray-500 leading-relaxed">{text}</p>
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <WalletProvider>
        <Dashboard />
      </WalletProvider>
    </ErrorBoundary>
  );
}
