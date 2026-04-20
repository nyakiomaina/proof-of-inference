// Hand-written IDL for the Proof of Inference Anchor program.
// Format: Anchor >=0.30 ("new" IDL shape). Regenerate via `anchor build`
// (output in `target/idl/proof_of_inference.json`) once available.
//
// Discriminators were computed as:
//   instruction: sha256("global:<snake_case_name>").slice(0, 8)
//   account:     sha256("account:<PascalCaseName>").slice(0, 8)
//   event:       sha256("event:<PascalCaseName>").slice(0, 8)

export type ProofOfInferenceIDL = {
  address: string;
  metadata: { name: string; version: string; spec: string };
  instructions: any[];
  accounts: any[];
  events: any[];
  types: any[];
  errors: any[];
};

export const IDL = {
  address: "CCdibNmqNCG58v4fVjAKvwXora2ekGYToUTTQF6QVmuh",
  metadata: {
    name: "proof_of_inference",
    version: "0.1.0",
    spec: "0.1.0",
  },
  instructions: [
    {
      name: "registerModel",
      discriminator: [111, 236, 93, 31, 195, 210, 142, 125],
      accounts: [
        { name: "modelRegistry", writable: true },
        { name: "mxeConfig" },
        { name: "owner", writable: true, signer: true },
        { name: "systemProgram", address: "11111111111111111111111111111111" },
      ],
      args: [
        { name: "weightCommitment", type: { array: ["u8", 32] } },
        { name: "modelName", type: "string" },
        { name: "modelVersion", type: "u16" },
        { name: "modelType", type: { defined: { name: "ModelType" } } },
      ],
    },
    {
      name: "updateModel",
      discriminator: [76, 230, 44, 16, 103, 83, 24, 73],
      accounts: [
        { name: "modelRegistry", writable: true },
        { name: "owner", signer: true },
      ],
      args: [
        { name: "active", type: { option: "bool" } },
        { name: "mxeConfig", type: { option: "pubkey" } },
        { name: "modelVersion", type: { option: "u16" } },
      ],
    },
    {
      name: "requestInference",
      discriminator: [92, 72, 143, 109, 60, 207, 61, 135],
      accounts: [
        { name: "modelRegistry" },
        { name: "verifiedInference", writable: true },
        { name: "requester", writable: true, signer: true },
        { name: "requesterToken", writable: true },
        { name: "protocolFeeVault", writable: true },
        { name: "tokenProgram" },
        { name: "systemProgram", address: "11111111111111111111111111111111" },
      ],
      args: [
        { name: "encryptedInput", type: "bytes" },
        { name: "nonce", type: { array: ["u8", 32] } },
      ],
    },
    {
      name: "callbackVerifiedInference",
      discriminator: [199, 159, 139, 151, 193, 7, 242, 75],
      accounts: [
        { name: "verifiedInference", writable: true },
        { name: "modelRegistry", writable: true },
        { name: "arciumAuthority", signer: true },
      ],
      args: [
        { name: "outputData", type: "bytes" },
        { name: "cluster", type: "pubkey" },
        { name: "nodeCount", type: "u8" },
      ],
    },
    {
      name: "failInference",
      discriminator: [224, 69, 171, 225, 252, 229, 167, 122],
      accounts: [
        { name: "verifiedInference", writable: true },
        { name: "arciumAuthority", signer: true },
      ],
      args: [{ name: "reason", type: "string" }],
    },
    {
      name: "checkVerification",
      discriminator: [99, 44, 73, 238, 56, 170, 136, 125],
      accounts: [{ name: "verifiedInference" }],
      args: [],
    },
  ],
  accounts: [
    {
      name: "ModelRegistry",
      discriminator: [174, 72, 180, 46, 185, 165, 246, 200],
    },
    {
      name: "VerifiedInference",
      discriminator: [199, 105, 232, 48, 122, 229, 71, 34],
    },
  ],
  events: [
    {
      name: "ModelRegistered",
      discriminator: [220, 196, 19, 71, 42, 237, 219, 138],
    },
    {
      name: "ModelUpdated",
      discriminator: [176, 73, 246, 100, 211, 248, 16, 248],
    },
    {
      name: "InferenceRequested",
      discriminator: [221, 6, 41, 160, 184, 105, 114, 15],
    },
    {
      name: "InferenceVerified",
      discriminator: [141, 49, 77, 148, 87, 180, 45, 15],
    },
    {
      name: "InferenceFailed",
      discriminator: [188, 160, 228, 220, 86, 169, 164, 74],
    },
  ],
  types: [
    {
      name: "ModelRegistry",
      type: {
        kind: "struct",
        fields: [
          { name: "owner", type: "pubkey" },
          { name: "weightCommitment", type: { array: ["u8", 32] } },
          { name: "modelName", type: "string" },
          { name: "modelVersion", type: "u16" },
          { name: "modelType", type: { defined: { name: "ModelType" } } },
          { name: "totalInferences", type: "u64" },
          { name: "createdAt", type: "i64" },
          { name: "active", type: "bool" },
          { name: "mxeConfig", type: "pubkey" },
          { name: "bump", type: "u8" },
        ],
      },
    },
    {
      name: "VerifiedInference",
      type: {
        kind: "struct",
        fields: [
          { name: "model", type: "pubkey" },
          { name: "modelCommitment", type: { array: ["u8", 32] } },
          { name: "inputHash", type: { array: ["u8", 32] } },
          { name: "outputHash", type: { array: ["u8", 32] } },
          { name: "outputData", type: "bytes" },
          { name: "requester", type: "pubkey" },
          { name: "arciumCluster", type: "pubkey" },
          { name: "nodeCount", type: "u8" },
          { name: "timestamp", type: "i64" },
          { name: "status", type: { defined: { name: "VerificationStatus" } } },
          { name: "bump", type: "u8" },
        ],
      },
    },
    {
      name: "ModelType",
      type: {
        kind: "enum",
        variants: [
          { name: "SentimentClassifier" },
          { name: "TextClassifier" },
          { name: "RiskScorer" },
          { name: "AnomalyDetector" },
          { name: "CustomClassifier" },
        ],
      },
    },
    {
      name: "VerificationStatus",
      type: {
        kind: "enum",
        variants: [
          { name: "Pending" },
          { name: "Verified" },
          { name: "Failed" },
        ],
      },
    },
    {
      name: "VerificationResult",
      type: {
        kind: "struct",
        fields: [
          { name: "verified", type: "bool" },
          { name: "model", type: "pubkey" },
          { name: "modelCommitment", type: { array: ["u8", 32] } },
          { name: "nodeCount", type: "u8" },
          { name: "timestamp", type: "i64" },
          { name: "cluster", type: "pubkey" },
        ],
      },
    },
    {
      name: "ModelRegistered",
      type: {
        kind: "struct",
        fields: [
          { name: "model", type: "pubkey" },
          { name: "owner", type: "pubkey" },
          { name: "weightCommitment", type: { array: ["u8", 32] } },
          { name: "modelName", type: "string" },
          { name: "modelVersion", type: "u16" },
          { name: "timestamp", type: "i64" },
        ],
      },
    },
    {
      name: "ModelUpdated",
      type: {
        kind: "struct",
        fields: [
          { name: "model", type: "pubkey" },
          { name: "active", type: "bool" },
          { name: "modelVersion", type: "u16" },
          { name: "timestamp", type: "i64" },
        ],
      },
    },
    {
      name: "InferenceRequested",
      type: {
        kind: "struct",
        fields: [
          { name: "model", type: "pubkey" },
          { name: "requester", type: "pubkey" },
          { name: "inference", type: "pubkey" },
          { name: "inputHash", type: { array: ["u8", 32] } },
          { name: "timestamp", type: "i64" },
        ],
      },
    },
    {
      name: "InferenceVerified",
      type: {
        kind: "struct",
        fields: [
          { name: "model", type: "pubkey" },
          { name: "inference", type: "pubkey" },
          { name: "nodeCount", type: "u8" },
          { name: "cluster", type: "pubkey" },
          { name: "timestamp", type: "i64" },
        ],
      },
    },
    {
      name: "InferenceFailed",
      type: {
        kind: "struct",
        fields: [
          { name: "inference", type: "pubkey" },
          { name: "model", type: "pubkey" },
          { name: "reason", type: "string" },
          { name: "timestamp", type: "i64" },
        ],
      },
    },
  ],
  errors: [
    { code: 6000, name: "ModelNameTooLong", msg: "Model name exceeds maximum length of 64 bytes" },
    { code: 6001, name: "ModelInactive", msg: "Model is not active and cannot accept inference requests" },
    { code: 6002, name: "UnauthorizedCallback", msg: "Only the Arcium callback authority can finalize inferences" },
    { code: 6003, name: "InferenceNotPending", msg: "Inference is not in Pending status" },
    { code: 6004, name: "OutputDataTooLarge", msg: "Output data exceeds maximum allowed size" },
    { code: 6005, name: "InvalidNodeCount", msg: "Node count must be greater than zero" },
    { code: 6006, name: "TokenOwnerMismatch", msg: "Token account owner does not match requester" },
    { code: 6007, name: "ModelMismatch", msg: "Model registry does not match the inference record" },
  ],
} as const;
