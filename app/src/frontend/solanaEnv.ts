import { clusterApiUrl, type Cluster } from "@solana/web3.js";

const KNOWN_CLUSTERS: Cluster[] = ["devnet", "testnet", "mainnet-beta"];

function parseCluster(raw: string | undefined): Cluster {
  const s = (raw ?? "devnet").trim().toLowerCase();
  if (KNOWN_CLUSTERS.includes(s as Cluster)) return s as Cluster;
  return "devnet";
}

/**
 * RPC endpoint for `ConnectionProvider`.
 * Prefer `VITE_SOLANA_RPC_URL` when set; otherwise `clusterApiUrl(VITE_SOLANA_CLUSTER)`.
 */
export function getSolanaRpcEndpoint(): string {
  const custom = import.meta.env.VITE_SOLANA_RPC_URL?.trim();
  if (custom) return custom;
  return clusterApiUrl(parseCluster(import.meta.env.VITE_SOLANA_CLUSTER));
}
