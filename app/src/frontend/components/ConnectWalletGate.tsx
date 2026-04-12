import React from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

/**
 * Solana wallet–adapter only registers Solana-compatible wallets (Phantom, Solflare, etc.).
 * This gate keeps demo actions tied to a connected Solana identity.
 */
export function ConnectWalletGate({ children }: { children: React.ReactNode }) {
  const { connected } = useWallet();

  if (connected) return <>{children}</>;

  return (
    <div className="text-center py-8 px-4 space-y-3">
      <p className="text-sm text-gray-400 max-w-sm mx-auto">
        Connect a Solana wallet to use this panel. Only adapters registered in the app
        (Solana wallets) appear in the wallet modal—not Ethereum or other chains.
      </p>
      <WalletMultiButton />
    </div>
  );
}
