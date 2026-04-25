/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/proof_of_inference.json`.
 */
export type ProofOfInference = {
  "address": "CCdibNmqNCG58v4fVjAKvwXora2ekGYToUTTQF6QVmuh",
  "metadata": {
    "name": "proofOfInference",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "On-chain verified AI inference attestation for Solana"
  },
  "instructions": [
    {
      "name": "callbackVerifiedInference",
      "docs": [
        "Callback invoked by the Arcium MPC network after confidential computation",
        "completes. Only the designated Arcium callback authority can call this.",
        "It writes the encrypted output, cluster metadata, and flips the status",
        "to Verified. The model's lifetime inference counter is incremented."
      ],
      "discriminator": [
        199,
        159,
        139,
        151,
        193,
        7,
        242,
        75
      ],
      "accounts": [
        {
          "name": "verifiedInference",
          "writable": true
        },
        {
          "name": "modelRegistry",
          "writable": true
        },
        {
          "name": "arciumAuthority",
          "docs": [
            "The Arcium callback authority. Only this signer can finalize inferences."
          ],
          "signer": true
        }
      ],
      "args": [
        {
          "name": "outputData",
          "type": "bytes"
        },
        {
          "name": "cluster",
          "type": "pubkey"
        },
        {
          "name": "nodeCount",
          "type": "u8"
        }
      ]
    },
    {
      "name": "checkVerification",
      "docs": [
        "CPI-callable verification check. Any Solana program can call this via CPI,",
        "passing a VerifiedInference PDA, to get a structured verification result.",
        "This is the composability surface — DeFi vaults, DAOs, and dApps consume",
        "this to gate actions on proven AI computation."
      ],
      "discriminator": [
        99,
        44,
        73,
        238,
        56,
        170,
        136,
        125
      ],
      "accounts": [
        {
          "name": "verifiedInference"
        }
      ],
      "args": [],
      "returns": {
        "defined": {
          "name": "verificationResult"
        }
      }
    },
    {
      "name": "failInference",
      "docs": [
        "Marks a pending inference as failed. Only callable by the Arcium callback",
        "authority when the MPC computation could not complete successfully."
      ],
      "discriminator": [
        224,
        69,
        171,
        225,
        252,
        229,
        167,
        122
      ],
      "accounts": [
        {
          "name": "verifiedInference",
          "writable": true
        },
        {
          "name": "arciumAuthority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "reason",
          "type": "string"
        }
      ]
    },
    {
      "name": "registerModel",
      "docs": [
        "Registers a new AI model on-chain by committing the SHA-256 hash of its weights.",
        "The model owner also specifies which Arcium MXE configuration will host the model",
        "for confidential computation. The actual weights never touch the chain."
      ],
      "discriminator": [
        111,
        236,
        93,
        31,
        195,
        210,
        142,
        125
      ],
      "accounts": [
        {
          "name": "modelRegistry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "weightCommitment"
              }
            ]
          }
        },
        {
          "name": "mxeConfig",
          "docs": [
            "The Arcium MXE configuration account. Validated off-chain during",
            "model weight upload; stored here for reference."
          ]
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "weightCommitment",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "modelName",
          "type": "string"
        },
        {
          "name": "modelVersion",
          "type": "u16"
        },
        {
          "name": "modelType",
          "type": {
            "defined": {
              "name": "modelType"
            }
          }
        }
      ]
    },
    {
      "name": "requestInference",
      "docs": [
        "Requests a verified inference from a registered model. The user's input",
        "is encrypted client-side before submission; only the encrypted blob and",
        "a nonce are sent on-chain. A verification fee is transferred to the",
        "protocol vault. The instruction creates a Pending VerifiedInference PDA",
        "and emits an event that off-chain relayers / Arcium watchers use to",
        "trigger the MPC computation."
      ],
      "discriminator": [
        92,
        72,
        143,
        109,
        60,
        207,
        61,
        135
      ],
      "accounts": [
        {
          "name": "modelRegistry"
        },
        {
          "name": "verifiedInference",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  102,
                  101,
                  114,
                  101,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "modelRegistry"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "requester",
          "writable": true,
          "signer": true
        },
        {
          "name": "requesterToken",
          "writable": true
        },
        {
          "name": "protocolFeeVault",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "encryptedInput",
          "type": "bytes"
        },
        {
          "name": "nonce",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "updateModel",
      "docs": [
        "Updates a registered model (owner only). Can toggle active status,",
        "update the MXE config, or bump the version."
      ],
      "discriminator": [
        76,
        230,
        44,
        16,
        103,
        83,
        24,
        73
      ],
      "accounts": [
        {
          "name": "modelRegistry",
          "writable": true
        },
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "modelRegistry"
          ]
        }
      ],
      "args": [
        {
          "name": "active",
          "type": {
            "option": "bool"
          }
        },
        {
          "name": "mxeConfig",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "modelVersion",
          "type": {
            "option": "u16"
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "modelRegistry",
      "discriminator": [
        174,
        72,
        180,
        46,
        185,
        165,
        246,
        200
      ]
    },
    {
      "name": "verifiedInference",
      "discriminator": [
        199,
        105,
        232,
        48,
        122,
        229,
        71,
        34
      ]
    }
  ],
  "events": [
    {
      "name": "inferenceFailed",
      "discriminator": [
        188,
        160,
        228,
        220,
        86,
        169,
        164,
        74
      ]
    },
    {
      "name": "inferenceRequested",
      "discriminator": [
        221,
        6,
        41,
        160,
        184,
        105,
        114,
        15
      ]
    },
    {
      "name": "inferenceVerified",
      "discriminator": [
        141,
        49,
        77,
        148,
        87,
        180,
        45,
        15
      ]
    },
    {
      "name": "modelRegistered",
      "discriminator": [
        220,
        196,
        19,
        71,
        42,
        237,
        219,
        138
      ]
    },
    {
      "name": "modelUpdated",
      "discriminator": [
        176,
        73,
        246,
        100,
        211,
        248,
        16,
        248
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "modelNameTooLong",
      "msg": "Model name exceeds maximum length of 64 bytes"
    },
    {
      "code": 6001,
      "name": "modelInactive",
      "msg": "Model is not active and cannot accept inference requests"
    },
    {
      "code": 6002,
      "name": "unauthorizedCallback",
      "msg": "Only the Arcium callback authority can finalize inferences"
    },
    {
      "code": 6003,
      "name": "inferenceNotPending",
      "msg": "Inference is not in Pending status"
    },
    {
      "code": 6004,
      "name": "outputDataTooLarge",
      "msg": "Output data exceeds maximum allowed size"
    },
    {
      "code": 6005,
      "name": "invalidNodeCount",
      "msg": "Node count must be greater than zero"
    },
    {
      "code": 6006,
      "name": "tokenOwnerMismatch",
      "msg": "Token account owner does not match requester"
    },
    {
      "code": 6007,
      "name": "modelMismatch",
      "msg": "Model registry does not match the inference record"
    }
  ],
  "types": [
    {
      "name": "inferenceFailed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "inference",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "reason",
            "type": "string"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "inferenceRequested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "requester",
            "type": "pubkey"
          },
          {
            "name": "inference",
            "type": "pubkey"
          },
          {
            "name": "inputHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "inferenceVerified",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "inference",
            "type": "pubkey"
          },
          {
            "name": "nodeCount",
            "type": "u8"
          },
          {
            "name": "cluster",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "modelRegistered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "weightCommitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "modelName",
            "type": "string"
          },
          {
            "name": "modelVersion",
            "type": "u16"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "modelRegistry",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "docs": [
              "The wallet that registered and owns this model."
            ],
            "type": "pubkey"
          },
          {
            "name": "weightCommitment",
            "docs": [
              "SHA-256 hash of the model weights — the on-chain identity of the model."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "modelName",
            "docs": [
              "Human-readable name (max 64 bytes)."
            ],
            "type": "string"
          },
          {
            "name": "modelVersion",
            "docs": [
              "Semver-style version number for the model."
            ],
            "type": "u16"
          },
          {
            "name": "modelType",
            "docs": [
              "Classification of the model's purpose."
            ],
            "type": {
              "defined": {
                "name": "modelType"
              }
            }
          },
          {
            "name": "totalInferences",
            "docs": [
              "Lifetime count of verified inferences produced by this model."
            ],
            "type": "u64"
          },
          {
            "name": "createdAt",
            "docs": [
              "Unix timestamp when the model was registered."
            ],
            "type": "i64"
          },
          {
            "name": "active",
            "docs": [
              "Whether the model is accepting inference requests."
            ],
            "type": "bool"
          },
          {
            "name": "mxeConfig",
            "docs": [
              "The Arcium MXE configuration account that hosts this model's encrypted weights."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "modelType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "sentimentClassifier"
          },
          {
            "name": "textClassifier"
          },
          {
            "name": "riskScorer"
          },
          {
            "name": "anomalyDetector"
          },
          {
            "name": "customClassifier"
          }
        ]
      }
    },
    {
      "name": "modelUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "modelVersion",
            "type": "u16"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "verificationResult",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "verified",
            "type": "bool"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "modelCommitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "nodeCount",
            "type": "u8"
          },
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "cluster",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "verificationStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "pending"
          },
          {
            "name": "verified"
          },
          {
            "name": "failed"
          }
        ]
      }
    },
    {
      "name": "verifiedInference",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "docs": [
              "The ModelRegistry PDA that this inference was requested against."
            ],
            "type": "pubkey"
          },
          {
            "name": "modelCommitment",
            "docs": [
              "Snapshot of the model's weight_commitment at request time."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "nonce",
            "docs": [
              "Request nonce used to derive this VerifiedInference PDA."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "inputHash",
            "docs": [
              "SHA-256 hash of the encrypted input blob."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "outputHash",
            "docs": [
              "SHA-256 hash of the output data (set after callback)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "outputData",
            "docs": [
              "The encrypted output data from the MPC computation (sealed to requester)."
            ],
            "type": "bytes"
          },
          {
            "name": "requester",
            "docs": [
              "The wallet that requested this inference."
            ],
            "type": "pubkey"
          },
          {
            "name": "arciumCluster",
            "docs": [
              "The Arcium cluster that performed the MPC computation."
            ],
            "type": "pubkey"
          },
          {
            "name": "nodeCount",
            "docs": [
              "Number of MPC nodes that participated."
            ],
            "type": "u8"
          },
          {
            "name": "timestamp",
            "docs": [
              "Unix timestamp when the inference was requested."
            ],
            "type": "i64"
          },
          {
            "name": "status",
            "docs": [
              "Current verification status."
            ],
            "type": {
              "defined": {
                "name": "verificationStatus"
              }
            }
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed."
            ],
            "type": "u8"
          }
        ]
      }
    }
  ]
};
