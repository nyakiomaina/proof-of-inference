#!/bin/bash
export PATH="$HOME/.nvm/versions/node/v22.9.0/bin:$PATH"
cd "$(dirname "$0")"
echo ""
echo "  Proof of Inference — after Vite prints \"ready\", open in your browser:"
echo "    http://127.0.0.1:8080/"
echo "  If that still fails, see app/vite.config.ts (server) comments / check proxy & HTTPS-only."
echo ""
exec npx vite
