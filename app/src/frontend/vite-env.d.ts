/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Full RPC URL; when set, overrides `VITE_SOLANA_CLUSTER`. */
  readonly VITE_SOLANA_RPC_URL?: string;
  /** `devnet` | `testnet` | `mainnet-beta` when `VITE_SOLANA_RPC_URL` is unset. */
  readonly VITE_SOLANA_CLUSTER?: string;
  /** MXE program id from `arcium deploy` (`mxe/poi_mxe`); used with @arcium-hq/client. */
  readonly VITE_MXE_PROGRAM_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
