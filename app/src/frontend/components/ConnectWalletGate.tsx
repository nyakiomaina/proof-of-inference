import React from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export function ConnectWalletGate({ children }: { children: React.ReactNode }) {
  const { connected } = useWallet();
  if (connected) return <>{children}</>;

  return (
    <div className="text-center py-6 space-y-3">
      <p className="text-xs text-gray-600">Connect a Solana wallet to continue.</p>
      <WalletMultiButton />
    </div>
  );
}
