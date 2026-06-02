/// Minimal ABIs for the tsugu identity layer. `as const` so viem infers types.

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
