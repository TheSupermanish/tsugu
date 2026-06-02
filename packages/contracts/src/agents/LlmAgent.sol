// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AgentCompute} from "./AgentCompute.sol";
import {SomniaAI} from "./lib/SomniaAI.sol";
import {SomniaAgentIds} from "./lib/SomniaAgents.sol";

/// @title  LlmAgent — consensus LLM inference on Somnia (Qwen3, temp=0)
/// @notice asom's "reason" primitive: ask the Somnia LLM-inference agent to classify
///         a prompt into one of `allowedValues` (a hard-to-game, multi-validator
///         referee — e.g. ["accept","reject"] for advisory task judging) or to infer
///         a bounded number (e.g. a 0–100 quality score). Results are consensus-verified
///         off-EVM and delivered to `handleResponse` in a later block.
/// @dev    Built on the audited `AgentCompute` base (deposit math, the four callback
///         guards, refund, reentrancy, receive()). The LLM agent id + inferString ABI
///         are confirmed on the official Somnia console (see SomniaAgents.sol /
///         docs/SOMNIA_AI.md); should any live id/ABI ever drift, the request degrades
///         to TimedOut (handled by `_onFailed`) — it never corrupts stored state.
contract LlmAgent is AgentCompute {
    /// @notice The Somnia agent id this contract calls (default LLM_INFERENCE).
    uint256 public immutable agentId;

    enum Kind {
        None,
        Classification,
        Number
    }

    /// @notice What each dispatched request expects back, so `_onResult` decodes the
    ///         right type (both classify and number hit the same LLM agent id).
    mapping(uint256 => Kind) public kindOf;

    // Classification (string, constrained to allowedValues)
    mapping(uint256 => string) public verdicts;
    string public lastVerdict;
    uint256 public lastVerdictRequestId;

    // Bounded number (int256)
    mapping(uint256 => int256) public numbers;
    mapping(uint256 => bool) public numberReady; // distinguishes a real 0 from "no result"
    int256 public lastNumber;
    uint256 public lastNumberRequestId;

    event ClassificationRequested(uint256 indexed requestId, string prompt);
    event ClassificationReceived(uint256 indexed requestId, string verdict);
    event NumberRequested(uint256 indexed requestId, string prompt);
    event NumberReceived(uint256 indexed requestId, int256 value);

    error UnexpectedResultKind(uint256 requestId);

    constructor(address platform_, uint256 agentId_, uint256 subcommitteeSize_, uint256 perAgentReward_)
        AgentCompute(platform_, subcommitteeSize_, perAgentReward_)
    {
        agentId = agentId_ == 0 ? SomniaAgentIds.LLM_INFERENCE : agentId_;
    }

    /// @notice Classify `prompt` into exactly one of `allowedValues` under consensus.
    ///         Constraining the output (an enum) is what makes the validator
    ///         subcommittee a reliable, byte-identical referee.
    /// @param prompt        the question / content to judge
    /// @param system        system instruction (tone / rubric); may be empty
    /// @param allowedValues the permitted answers (e.g. ["accept","reject"])
    /// @return requestId    poll `verdicts(requestId)` once the callback lands
    function requestClassification(string calldata prompt, string calldata system, string[] calldata allowedValues)
        external
        payable
        returns (uint256 requestId)
    {
        // cot=false: deterministic (temp=0 + fixed seed) so validators reach a
        // byte-identical result — required for Majority consensus to succeed.
        requestId = _dispatch(agentId, SomniaAI.encodeInferString(prompt, system, false, allowedValues));
        kindOf[requestId] = Kind.Classification;
        emit ClassificationRequested(requestId, prompt);
    }

    /// @notice Infer a bounded integer in [min, max] under consensus.
    /// @return requestId    poll `numbers(requestId)` (with `numberReady`) once it lands
    function requestNumber(string calldata prompt, string calldata system, int256 min, int256 max)
        external
        payable
        returns (uint256 requestId)
    {
        requestId = _dispatch(agentId, SomniaAI.encodeInferNumber(prompt, system, min, max, false));
        kindOf[requestId] = Kind.Number;
        emit NumberRequested(requestId, prompt);
    }

    /// @dev Decode by the kind recorded at dispatch (both share the LLM agent id).
    function _onResult(uint256 requestId, bytes memory result) internal override {
        Kind k = kindOf[requestId];
        if (k == Kind.Classification) {
            string memory v = abi.decode(result, (string));
            verdicts[requestId] = v;
            lastVerdict = v;
            lastVerdictRequestId = requestId;
            emit ClassificationReceived(requestId, v);
        } else if (k == Kind.Number) {
            int256 n = abi.decode(result, (int256));
            numbers[requestId] = n;
            numberReady[requestId] = true;
            lastNumber = n;
            lastNumberRequestId = requestId;
            emit NumberReceived(requestId, n);
        } else {
            // A pending request must have been tagged at dispatch; reaching here means
            // a callback for a requestId we never classified — fail loud.
            revert UnexpectedResultKind(requestId);
        }
    }
}
