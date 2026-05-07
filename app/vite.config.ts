import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const appDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // One physical web3 install (pinned in package.json). Prevents stale or
    // duplicate @solana/web3.js copies from triggering SendTransactionError
    // bugs that only exist in web3 ≥1.92 while Anchor still uses the old ctor.
    dedupe: ["@solana/web3.js"],
    alias: {
      "@solana/web3.js": path.join(appDir, "node_modules/@solana/web3.js"),
    },
  },
  plugins: [
    react(),
    nodePolyfills({
      include: ["buffer", "crypto", "stream", "util", "process"],
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  root: ".",
  publicDir: "public",
  server: {
    port: 8080,
    strictPort: true,
    host: "0.0.0.0",
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
