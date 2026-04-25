/**
 * Real on-chain IDL for the Proof of Inference Anchor program.
 *
 * The canonical source of truth is `target/idl/proof_of_inference.json`,
 * produced by `anchor idl build`. It is copied into this directory by
 * `npm run sync-idl` at the repo root so that Vite (whose build context is
 * `app/`) can bundle it without reaching outside the Docker build context.
 *
 * DO NOT HAND-EDIT `idl.json` or `proof_of_inference.ts` — regenerate with
 * `anchor build && npm run sync-idl` from the repo root.
 */

import idlJson from "./idl.json";
import type { ProofOfInference } from "./proof_of_inference";

export const IDL = idlJson;
export type ProofOfInferenceIDL = typeof idlJson;
export type { ProofOfInference };
