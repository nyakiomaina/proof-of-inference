import React from "react";
import { WalletProvider } from "./WalletProvider";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { RegisterModelPanel } from "./components/RegisterModelPanel";
import { RunInferencePanel } from "./components/RunInferencePanel";
import { VerifyComparePanel } from "./components/VerifyComparePanel";
import { useDemoState } from "./hooks/useDemoState";

function Dashboard() {
  const {
    models,
    inferences,
    loading,
    setLoading,
    registerModel,
    addInference,
    updateInference,
    incrementModelInferences,
  } = useDemoState();

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-solana-purple to-solana-green flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight">
                Proof of Inference
              </h1>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest">
                The Trust Layer for AI Agents on Solana
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Stats */}
            <div className="hidden sm:flex items-center gap-4 text-xs text-gray-400 mr-4">
              <div>
                <span className="text-gray-500">Models:</span>{" "}
                <span className="text-white font-medium">{models.length}</span>
              </div>
              <div>
                <span className="text-gray-500">Inferences:</span>{" "}
                <span className="text-white font-medium">{inferences.length}</span>
              </div>
              <div>
                <span className="text-gray-500">Verified:</span>{" "}
                <span className="text-solana-green font-medium">
                  {inferences.filter((i) => i.status === "Verified").length}
                </span>
              </div>
            </div>
            <WalletMultiButton />
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-8 pb-6">
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold mb-2 bg-gradient-to-r from-solana-purple via-white to-solana-green bg-clip-text text-transparent">
            Verified AI Computation on Solana
          </h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            Register a model. Run a confidential inference through Arcium's MPC network.
            Get an on-chain attestation that a specific model produced a specific output &mdash;
            without revealing weights, inputs, or intermediate state.
          </p>
        </div>
      </section>

      {/* Three Panels */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pb-12 space-y-6">
        {/* Row 1: Register + Inference side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

        {/* Row 2: Verify vs Unverified (full width) */}
        <VerifyComparePanel inferences={inferences} />

        {/* Architecture diagram */}
        <div className="card">
          <div className="card-header">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            How It Works
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
            <FlowStep
              step={1}
              title="Register Model"
              description="Owner commits SHA-256 hash of weights to a Solana PDA. Weights never touch the chain."
              color="purple"
            />
            <FlowStep
              step={2}
              title="Request Inference"
              description="User encrypts input with Arcium SDK. Submits to chain with fee. Creates Pending PDA."
              color="blue"
            />
            <FlowStep
              step={3}
              title="MPC Computation"
              description="Arcium cluster splits data across nodes. No single node sees full weights or input."
              color="yellow"
            />
            <FlowStep
              step={4}
              title="On-chain Attestation"
              description="Callback writes output + cluster info + Verified status. Any program can check via CPI."
              color="green"
            />
          </div>

          <div className="mt-6 p-3 bg-gray-800/50 rounded-lg">
            <pre className="text-xs text-gray-400 font-mono overflow-x-auto whitespace-pre">{`// Any Solana program integrates with one CPI call:
let result = proof_of_inference::cpi::check_verification(cpi_ctx)?;
require!(result.verified, "Unverified inference");
require!(result.model_commitment == TRUSTED_MODEL, "Wrong model");
// proceed with AI-recommended action`}</pre>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-6 text-center text-xs text-gray-600">
        Proof of Inference &mdash; Built on Solana + Arcium
      </footer>
    </div>
  );
}

function FlowStep({
  step,
  title,
  description,
  color,
}: {
  step: number;
  title: string;
  description: string;
  color: "purple" | "blue" | "yellow" | "green";
}) {
  const colors = {
    purple: "from-solana-purple/20 to-solana-purple/5 border-solana-purple/30 text-solana-purple",
    blue: "from-blue-500/20 to-blue-500/5 border-blue-500/30 text-blue-400",
    yellow: "from-yellow-500/20 to-yellow-500/5 border-yellow-500/30 text-yellow-400",
    green: "from-solana-green/20 to-solana-green/5 border-solana-green/30 text-solana-green",
  };

  return (
    <div className={`p-4 rounded-lg border bg-gradient-to-b ${colors[color]}`}>
      <div className="text-xs font-bold mb-1 opacity-60">STEP {step}</div>
      <div className="font-semibold mb-1 text-white">{title}</div>
      <p className="text-xs text-gray-400 leading-relaxed">{description}</p>
    </div>
  );
}

export function App() {
  return (
    <WalletProvider>
      <Dashboard />
    </WalletProvider>
  );
}
