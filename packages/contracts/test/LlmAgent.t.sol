// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {LlmAgent} from "../src/agents/LlmAgent.sol";
import {SomniaAgentIds, ResponseStatus} from "../src/agents/lib/SomniaAgents.sol";
import {MockAgentPlatform} from "./helpers/MockAgentPlatform.sol";

contract LlmAgentTest is Test {
    MockAgentPlatform platform;
    LlmAgent llm;

    uint256 constant SUB = 3;
    uint256 constant REWARD = 0.07 ether;
    address user = address(0xABCD);

    function setUp() public {
        platform = new MockAgentPlatform();
        // agentId 0 → defaults to the canonical LLM_INFERENCE id.
        llm = new LlmAgent(address(platform), 0, SUB, REWARD);
        vm.deal(user, 100 ether);
    }

    function deposit() internal view returns (uint256) {
        return platform.FLOOR() + REWARD * SUB;
    }

    function _allow() internal pure returns (string[] memory a) {
        a = new string[](2);
        a[0] = "accept";
        a[1] = "reject";
    }

    function test_defaultsToCanonicalLlmId() public view {
        assertEq(llm.agentId(), SomniaAgentIds.LLM_INFERENCE);
    }

    function test_classification_encodesToLlmAgent_andStoresVerdict() public {
        uint256 dep = deposit();
        string[] memory allow = _allow();
        vm.prank(user);
        uint256 id = llm.requestClassification{value: dep}("is 2+2=4?", "be strict", allow);
        assertEq(platform.lastAgentId(), SomniaAgentIds.LLM_INFERENCE);
        assertTrue(llm.pendingRequests(id));
        assertEq(uint8(llm.kindOf(id)), uint8(LlmAgent.Kind.Classification));

        vm.expectEmit(true, false, false, true, address(llm));
        emit LlmAgent.ClassificationReceived(id, "accept");
        platform.fireString(address(llm), id, "accept");

        assertEq(llm.verdicts(id), "accept");
        assertEq(llm.lastVerdict(), "accept");
        assertEq(llm.lastVerdictRequestId(), id);
        assertFalse(llm.pendingRequests(id));
    }

    function test_number_storesBoundedInt_withReadyFlag() public {
        uint256 dep = deposit();
        vm.prank(user);
        uint256 id = llm.requestNumber{value: dep}("score 0-100", "", int256(0), int256(100));
        assertEq(uint8(llm.kindOf(id)), uint8(LlmAgent.Kind.Number));

        // A real zero must be distinguishable from "no result yet".
        assertFalse(llm.numberReady(id));
        platform.fireInt(address(llm), id, int256(0));
        assertTrue(llm.numberReady(id));
        assertEq(llm.numbers(id), int256(0));
        assertEq(llm.lastNumber(), int256(0));
    }

    function test_negativeNumberDecodes() public {
        uint256 dep = deposit();
        vm.prank(user);
        uint256 id = llm.requestNumber{value: dep}("delta", "", int256(-100), int256(100));
        platform.fireInt(address(llm), id, int256(-42));
        assertEq(llm.numbers(id), int256(-42));
    }

    function test_failure_leavesNoVerdict() public {
        uint256 dep = deposit();
        string[] memory allow = _allow();
        vm.prank(user);
        uint256 id = llm.requestClassification{value: dep}("q", "", allow);
        platform.fireFailure(address(llm), id, ResponseStatus.TimedOut);
        assertEq(bytes(llm.verdicts(id)).length, 0);
        assertFalse(llm.pendingRequests(id));
    }

    function test_nonOwner_underfunded_reverts() public {
        vm.prank(user);
        vm.expectRevert();
        llm.requestClassification("q", "", _allow());
    }
}
