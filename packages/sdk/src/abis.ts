/// Minimal ABIs for the asom identity layer. `as const` so viem infers types.

export const agentRegistryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "payable",
    inputs: [
      { name: "name", type: "string" },
      { name: "owner", type: "address" },
    ],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "account", type: "address" },
    ],
  },
  {
    type: "function",
    name: "resolve",
    stateMutability: "view",
    inputs: [{ name: "name", type: "string" }],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "account", type: "address" },
      { name: "owner", type: "address" },
      { name: "createdAt", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "isAvailable",
    stateMutability: "view",
    inputs: [{ name: "name", type: "string" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "previewAccount",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "AgentRegistered",
    inputs: [
      { name: "name", type: "string", indexed: false },
      { name: "nameHash", type: "bytes32", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "account", type: "address", indexed: false },
    ],
  },
] as const;

export const agentNftAbi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "nameOf",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "totalMinted",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  // Ownership transfer — handing over the NFT hands over the whole agent
  // (name + wallet). safeTransferFrom enforces the receiver can custody an
  // ERC-721 (EOA or onERC721Received-implementing contract).
  {
    type: "function",
    name: "safeTransferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/// CapabilityRegistry — the discovery layer. Agents advertise capability tags +
/// a service URI; `providers(tag)` finds capable agents on-chain.
export const capabilityRegistryAbi = [
  {
    type: "function",
    name: "advertise",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "tags", type: "bytes32[]" },
      { name: "serviceURI", type: "string" },
      { name: "pricePerCall", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "addCapability",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "tag", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "removeCapability",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "tag", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setService",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "serviceURI", type: "string" },
      { name: "pricePerCall", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "hasCapability",
    stateMutability: "view",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "tag", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "capabilitiesOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32[]" }],
  },
  {
    type: "function",
    name: "providers",
    stateMutability: "view",
    inputs: [{ name: "tag", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "providerCount",
    stateMutability: "view",
    inputs: [{ name: "tag", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "providersPage",
    stateMutability: "view",
    inputs: [
      { name: "tag", type: "bytes32" },
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [{ name: "page", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "listings",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "serviceURI", type: "string" },
      { name: "pricePerCall", type: "uint256" },
      { name: "listed", type: "bool" },
    ],
  },
] as const;

/// TaskBoard — the coordination layer. Post a task with an escrowed reward + a
/// required capability; a capable agent accepts, submits, and is paid into its wallet.
export const taskBoardAbi = [
  {
    type: "function",
    name: "postTask",
    stateMutability: "payable",
    inputs: [
      { name: "capability", type: "bytes32" },
      { name: "specURI", type: "string" },
      { name: "deadline", type: "uint64" },
    ],
    outputs: [{ name: "taskId", type: "uint256" }],
  },
  {
    type: "function",
    name: "acceptTask",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "workerTokenId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "submitResult",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "resultURI", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "approveTask",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "workerClaim",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "refund",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getTask",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "poster", type: "address" },
          { name: "capability", type: "bytes32" },
          { name: "reward", type: "uint256" },
          { name: "deadline", type: "uint64" },
          { name: "submittedAt", type: "uint64" },
          { name: "workerTokenId", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "specURI", type: "string" },
          { name: "resultURI", type: "string" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "nextTaskId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "REVIEW_WINDOW",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "event",
    name: "TaskPosted",
    inputs: [
      { name: "taskId", type: "uint256", indexed: true },
      { name: "poster", type: "address", indexed: true },
      { name: "capability", type: "bytes32", indexed: true },
      { name: "reward", type: "uint256", indexed: false },
      { name: "deadline", type: "uint64", indexed: false },
      { name: "specURI", type: "string", indexed: false },
    ],
  },
] as const;

/// AgentAccount — the ERC-6551 token-bound wallet. Only the bound NFT's owner
/// may `execute`; this is how an agent acts on-chain (move funds, call contracts).
export const agentAccountAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
    ],
    outputs: [{ name: "result", type: "bytes" }],
  },
  {
    type: "function",
    name: "token",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "chainId", type: "uint256" },
      { name: "tokenContract", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "state",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isValidSigner",
    stateMutability: "view",
    inputs: [
      { name: "signer", type: "address" },
      { name: "", type: "bytes" },
    ],
    outputs: [{ name: "magicValue", type: "bytes4" }],
  },
] as const;

/// Somnia AI compute primitives (AgentCompute subclasses). Includes the shared
/// base surface (requiredDeposit, consensus receipt, pendingRequests) plus each
/// agent's request/result methods. See packages/contracts/src/agents.

/// Fields shared by every AgentCompute primitive (deposit math + consensus receipt).
const computeBase = [
  {
    type: "function",
    name: "requiredDeposit",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "agentId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "pendingRequests",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "consensusOf",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "validators", type: "uint64" },
          { name: "finalizedAt", type: "uint64" },
          { name: "receiptId", type: "uint256" },
          { name: "executionCost", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "event",
    name: "RequestDispatched",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "agentId", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    name: "ConsensusReached",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "validators", type: "uint64", indexed: false },
      { name: "receiptId", type: "uint256", indexed: false },
      { name: "medianExecutionCost", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RequestFailed",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "status", type: "uint8", indexed: false },
    ],
  },
] as const;

export const llmAgentAbi = [
  ...computeBase,
  {
    type: "function",
    name: "requestClassification",
    stateMutability: "payable",
    inputs: [
      { name: "prompt", type: "string" },
      { name: "system", type: "string" },
      { name: "allowedValues", type: "string[]" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    type: "function",
    name: "requestNumber",
    stateMutability: "payable",
    inputs: [
      { name: "prompt", type: "string" },
      { name: "system", type: "string" },
      { name: "min", type: "int256" },
      { name: "max", type: "int256" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    type: "function",
    name: "verdicts",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "numbers",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "int256" }],
  },
  {
    type: "function",
    name: "numberReady",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "lastVerdict",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "event",
    name: "ClassificationReceived",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "verdict", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "NumberReceived",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "value", type: "int256", indexed: false },
    ],
  },
] as const;

export const parseAgentAbi = [
  ...computeBase,
  {
    type: "function",
    name: "requestExtract",
    stateMutability: "payable",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "key", type: "string" },
          { name: "description", type: "string" },
          { name: "options", type: "string[]" },
          { name: "prompt", type: "string" },
          { name: "url", type: "string" },
          { name: "resolveUrl", type: "bool" },
          { name: "numPages", type: "uint8" },
          { name: "confidenceThreshold", type: "uint8" },
        ],
      },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    type: "function",
    name: "extractions",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "extractionReady",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "lastExtraction",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "event",
    name: "ExtractionReceived",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "value", type: "string", indexed: false },
    ],
  },
] as const;

/// Somnia's mainnet AgentRegistry — the enumerable, curated catalog of the platform's
/// base AI agents. Read-only and OPTIONAL: it is mainnet-only (empty bytecode on
/// Shannon) and undocumented, so the SDK falls back to the hardcoded SomniaAgentIds on
/// testnet. See docs/SOMNIA_AI.md §3.
export const somniaAgentRegistryAbi = [
  {
    type: "function",
    name: "agentCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getAllAgents",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "getAgent",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    // Returns a SINGLE struct, not three flat values. Verified live against the mainnet
    // registry 0xaD3101… — a flat (uint256,string,string) decode overruns (missing the
    // outer tuple offset). Keep this a tuple.
    outputs: [
      {
        name: "agent",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "metadataJsonUri", type: "string" },
          { name: "tarUri", type: "string" },
        ],
      },
    ],
  },
] as const;
