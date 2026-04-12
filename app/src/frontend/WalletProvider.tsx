import React, { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { getSolanaRpcEndpoint } from "./solanaEnv";
import "@solana/wallet-adapter-react-ui/styles.css";

/** Wallet-adapter types target newer React `FC` signatures; keep JSX valid under React 18 types. */
const RpcConnectionProvider = ConnectionProvider as unknown as React.FC<{
  endpoint: string;
  children: React.ReactNode;
}>;

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(() => getSolanaRpcEndpoint(), []);
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <RpcConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </SolanaWalletProvider>
    </RpcConnectionProvider>
  );
}
