// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AgentCompute} from "./AgentCompute.sol";
import {SomniaAI} from "./lib/SomniaAI.sol";
import {SomniaAgentIds} from "./lib/SomniaAgents.sol";

/// @title  ParseAgent — consensus website extraction on Somnia
/// @notice asom's "read the web" primitive: ask the Somnia parse-website agent to
///         extract a field from a page (optionally constrained to `options`), with a
///         confidence gate. The extraction is consensus-verified off-EVM and delivered
///         to `handleResponse` in a later block.
/// @dev    Built on the audited `AgentCompute` base. The parse agent id is id-verified;
///         its ABI is per docs (verify before mainnet — see docs/SOMNIA_AI.md). A wrong
///         id/ABI degrades to TimedOut (handled), never corrupting stored state.
contract ParseAgent is AgentCompute {
    /// @notice The Somnia agent id this contract calls (default PARSE_WEBSITE).
    uint256 public immutable agentId;

    mapping(uint256 => string) public extractions;
    mapping(uint256 => bool) public extractionReady;
    string public lastExtraction;
    uint256 public lastExtractionRequestId;

    /// @notice Extraction parameters, grouped into a struct so the 8 fields don't
    ///         blow the stack (this contract targets the non-`via_ir` profile).
    /// @param key         the field name (e.g. "headline")
    /// @param description what the field means
    /// @param options     allowed answers ([] = unconstrained)
    /// @param prompt      extraction instruction
    /// @param url         page to read
    /// @param resolveUrl  true = domain-search mode; false = direct scrape (numPages → 1)
    /// @param numPages    pages to read (uint8 — matches the agent's ExtractString selector)
    /// @param confidenceThreshold 0–100 gate below which extraction fails (uint8)
    struct ExtractParams {
        string key;
        string description;
        string[] options;
        string prompt;
        string url;
        bool resolveUrl;
        uint8 numPages;
        uint8 confidenceThreshold;
    }

    event ExtractionRequested(uint256 indexed requestId, string url, string key);
    event ExtractionReceived(uint256 indexed requestId, string value);

    constructor(address platform_, uint256 agentId_, uint256 subcommitteeSize_, uint256 perAgentReward_)
        AgentCompute(platform_, subcommitteeSize_, perAgentReward_)
    {
        agentId = agentId_ == 0 ? SomniaAgentIds.PARSE_WEBSITE : agentId_;
    }

    /// @notice Extract a string field from a web page under consensus.
    /// @return requestId  poll `extractions(requestId)` (with `extractionReady`) once it lands
    function requestExtract(ExtractParams calldata p) external payable returns (uint256 requestId) {
        bytes memory payload = SomniaAI.encodeExtractString(
            p.key, p.description, p.options, p.prompt, p.url, p.resolveUrl, p.numPages, p.confidenceThreshold
        );
        requestId = _dispatch(agentId, payload);
        emit ExtractionRequested(requestId, p.url, p.key);
    }

    function _onResult(uint256 requestId, bytes memory result) internal override {
        string memory v = abi.decode(result, (string));
        extractions[requestId] = v;
        extractionReady[requestId] = true;
        lastExtraction = v;
        lastExtractionRequestId = requestId;
        emit ExtractionReceived(requestId, v);
    }
}
