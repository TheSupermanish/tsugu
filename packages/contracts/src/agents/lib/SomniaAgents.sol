// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Canonical types and interfaces for Somnia Agents platform calls.
/// @dev Mirrors the structures defined at
///      https://docs.somnia.network/agents/invoking-agents/from-solidity
///      Pinned here so every asom agent contract compiles against one source of truth.

enum ConsensusType {
    Majority,
    Threshold
}

enum ResponseStatus {
    None,
    Pending,
    Success,
    Failed,
    TimedOut
}

struct Response {
    address validator;
    bytes result;
    ResponseStatus status;
    uint256 receipt;
    uint256 timestamp;
    uint256 executionCost;
}

struct Request {
    uint256 id;
    address requester;
    address callbackAddress;
    bytes4 callbackSelector;
    address[] subcommittee;
    Response[] responses;
    uint256 responseCount;
    uint256 failureCount;
    uint256 threshold;
    uint256 createdAt;
    uint256 deadline;
    ResponseStatus status;
    ConsensusType consensusType;
    uint256 remainingBudget;
    uint256 perAgentBudget;
}

interface IAgentRequester {
    function createRequest(uint256 agentId, address callbackAddress, bytes4 callbackSelector, bytes calldata payload)
        external
        payable
        returns (uint256 requestId);

    function getRequestDeposit() external view returns (uint256);
}

interface IJsonApiAgent {
    function fetchUint(string calldata url, string calldata selector, uint8 decimals) external returns (uint256);
    function fetchInt(string calldata url, string calldata selector, uint8 decimals) external returns (int256);
    function fetchString(string calldata url, string calldata selector) external returns (string memory);
    function fetchBool(string calldata url, string calldata selector) external returns (bool);
}

/// @dev Somnia LLM inference agent (Qwen3-30B, deterministic temp=0). id + inferString
///      ABI confirmed on the official Somnia console (agents.somnia.network → LLM
///      Inference): same id as SomniaAgentIds.LLM_INFERENCE, signature
///      `inferString(string,string,bool,string[])`, 0.24 SOMI deposit. Console also lists
///      inferChat/inferToolsChat (not wrapped). Confirm inferNumber's ABI in a live round.
interface ILlmAgent {
    function inferString(string calldata prompt, string calldata system, bool cot, string[] calldata allowedValues)
        external
        returns (string memory);
    function inferNumber(string calldata prompt, string calldata system, int256 min, int256 max, bool cot)
        external
        returns (int256);
}

/// @dev Somnia "parse website" agent. Signature confirmed against
///      docs.somnia.network/agents/base-agents/llm-parse-website: numPages and
///      confidenceThreshold are `uint8` (not uint256) — this is part of the function
///      selector, so the width must match or the live agent never sees a valid call.
interface IParseAgent {
    function ExtractString(
        string calldata key,
        string calldata description,
        string[] calldata options,
        string calldata prompt,
        string calldata url,
        bool resolveUrl,
        uint8 numPages,
        uint8 confidenceThreshold
    ) external returns (string memory);
}

/// @dev Tunable-consensus entrypoints (separate interface so it doesn't force every
///      IAgentRequester implementer to provide them).
interface IAgentRequesterAdvanced {
    function createAdvancedRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload,
        uint256 subcommitteeSize,
        uint256 threshold,
        ConsensusType consensusType,
        uint256 timeout
    ) external payable returns (uint256 requestId);

    function getAdvancedRequestDeposit(uint256 agentId, uint256 subcommitteeSize) external view returns (uint256);
}

/// @notice Canonical Somnia Agents IDs + platform addresses. Same agentId on both
///         networks; only the platform address differs.
/// @dev    All three ids are confirmed: JSON via the live OracleAgent, LLM_INFERENCE
///         and PARSE_WEBSITE on the official Somnia console (agents.somnia.network).
///         On Shannon (testnet) there is no on-chain AgentRegistry — treat these as
///         constants. See repo docs/SOMNIA_AI.md.
library SomniaAgentIds {
    uint256 internal constant JSON_API = 13174292974160097713;
    uint256 internal constant LLM_INFERENCE = 12847293847561029384; // id+inferString ABI confirmed (console)
    uint256 internal constant PARSE_WEBSITE = 12875401142070969085;

    address internal constant PLATFORM_TESTNET = 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776; // Shannon (50312)
    address internal constant PLATFORM_MAINNET = 0x5E5205CF39E766118C01636bED000A54D93163E6; // Somnia (5031)
}
