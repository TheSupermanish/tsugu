// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAgentRequester, Response, Request, ResponseStatus, ConsensusType} from "../../src/agents/lib/SomniaAgents.sol";
import {AgentCompute} from "../../src/agents/AgentCompute.sol";

/// @dev Reusable stand-in for the Somnia Agents platform for any `AgentCompute`
///      subclass. Records the last request and lets tests fire the async callback
///      with a typed result, a raw response array, or a failure status. The callback
///      selector is `AgentCompute.handleResponse` — identical across every primitive.
contract MockAgentPlatform is IAgentRequester {
    uint256 public constant FLOOR = 0.01 ether;
    uint256 public nextRequestId = 1;

    uint256 public lastRequestId;
    uint256 public lastValue;
    uint256 public lastAgentId;
    bytes public lastPayload;
    address public lastCallback;
    bytes4 public lastSelector;

    function getRequestDeposit() external pure returns (uint256) {
        return FLOOR;
    }

    function createRequest(uint256 agentId, address callbackAddress, bytes4 callbackSelector, bytes calldata payload)
        external
        payable
        returns (uint256 requestId)
    {
        requestId = nextRequestId++;
        lastRequestId = requestId;
        lastValue = msg.value;
        lastAgentId = agentId;
        lastPayload = payload;
        lastCallback = callbackAddress;
        lastSelector = callbackSelector;
    }

    /// @notice Deliver a successful callback carrying an abi-encoded `string` result.
    function fireString(address target, uint256 requestId, string memory value) external {
        Response[] memory responses = _one(abi.encode(value));
        _deliver(target, requestId, responses, ResponseStatus.Success);
    }

    /// @notice Deliver a successful callback carrying an abi-encoded `int256` result.
    function fireInt(address target, uint256 requestId, int256 value) external {
        Response[] memory responses = _one(abi.encode(value));
        _deliver(target, requestId, responses, ResponseStatus.Success);
    }

    /// @notice Deliver a successful callback carrying an abi-encoded `uint256` result.
    function fireUint(address target, uint256 requestId, uint256 value) external {
        Response[] memory responses = _one(abi.encode(value));
        _deliver(target, requestId, responses, ResponseStatus.Success);
    }

    /// @notice Deliver a successful callback carrying an abi-encoded `bool` result
    ///         (the JSON-API `fetchBool` resolver path).
    function fireBool(address target, uint256 requestId, bool value) external {
        Response[] memory responses = _one(abi.encode(value));
        _deliver(target, requestId, responses, ResponseStatus.Success);
    }

    /// @notice Deliver a non-success terminal status (Failed / TimedOut) with no results.
    function fireFailure(address target, uint256 requestId, ResponseStatus status) external {
        _deliver(target, requestId, new Response[](0), status);
    }

    /// @notice Deliver an arbitrary response array + status (edge cases, e.g. Success+empty).
    function fireRaw(address target, uint256 requestId, Response[] memory responses, ResponseStatus status) external {
        _deliver(target, requestId, responses, status);
    }

    /// @notice Deliver a multi-validator success carrying the same `string` result from
    ///         each validator, with per-validator receipt ids and execution costs — so
    ///         tests can assert the consensus receipt (validator count + median cost).
    function fireStringConsensus(
        address target,
        uint256 requestId,
        string memory value,
        uint256[] memory executionCosts,
        uint256 firstReceiptId
    ) external {
        uint256 k = executionCosts.length;
        Response[] memory responses = new Response[](k);
        for (uint256 i = 0; i < k; i++) {
            responses[i] = Response({
                validator: address(uint160(0x5A11DA70 + i)),
                result: abi.encode(value),
                status: ResponseStatus.Success,
                receipt: i == 0 ? firstReceiptId : firstReceiptId + i,
                timestamp: block.timestamp,
                executionCost: executionCosts[i]
            });
        }
        _deliver(target, requestId, responses, ResponseStatus.Success);
    }

    function _one(bytes memory result) internal view returns (Response[] memory responses) {
        responses = new Response[](1);
        responses[0] = Response({
            validator: address(0xBEEF),
            result: result,
            status: ResponseStatus.Success,
            receipt: 1,
            timestamp: block.timestamp,
            executionCost: 0.03 ether
        });
    }

    function _deliver(address target, uint256 requestId, Response[] memory responses, ResponseStatus status) internal {
        Request memory details;
        details.id = requestId;
        details.status = status;
        details.consensusType = ConsensusType.Majority;
        (bool ok, bytes memory ret) = target.call(
            abi.encodeWithSelector(AgentCompute.handleResponse.selector, requestId, responses, status, details)
        );
        if (!ok) {
            // bubble up the revert reason so tests can assert on it
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }
}
