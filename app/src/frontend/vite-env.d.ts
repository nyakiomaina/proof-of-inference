/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOLANA_RPC_URL?: string;
  readonly VITE_SOLANA_CLUSTER?: string;
  readonly VITE_MXE_PROGRAM_ID?: string;
  readonly VITE_REQUESTER_TOKEN_ACCOUNT?: string;
  readonly VITE_PROTOCOL_FEE_VAULT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
