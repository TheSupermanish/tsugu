// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {AgentCompute} from "../src/agents/AgentCompute.sol";
import {ResponseStatus, Response, Request} from "../src/agents/lib/SomniaAgents.sol";
import {MockAgentPlatform} from "./helpers/MockAgentPlatform.sol";

/// @dev Minimal concrete subclass: exposes `_dispatch` publicly and records the
///      last decoded result / failure so the base behaviors can be exercised directly.
contract EchoCompute is AgentCompute {
    bytes public lastResult;
    uint256 public resultCount;
    ResponseStatus public lastFailureStatus;
    uint256 public failureCount;

    constructor(address platform_, uint256 sub_, uint256 reward_) AgentCompute(platform_, sub_, reward_) {}

    function dispatchPublic(uint256 agentId, bytes calldata payload) external payable returns (uint256) {
        return _dispatch(agentId, payload);
    }

    function _onResult(uint256, bytes memory result) internal override {
        lastResult = result;
        resultCount++;
    }

    function _onFailed(uint256, ResponseStatus status) internal override {
        lastFailureStatus = status;
        failureCount++;
    }
}

/// @dev Non-owner attacker that re-enters `_dispatch` from its refund `receive()`.
contract Reenterer {
    EchoCompute public immutable echo;
    bool internal entered;

    constructor(EchoCompute echo_) {
        echo = echo_;
    }

    function attack(uint256 overpay) external payable {
        echo.dispatchPublic{value: overpay}(1, hex"01");
    }

    receive() external payable {
        if (!entered) {
            entered = true;
            // Re-enter during the overpayment refund — must be blocked by nonReentrant.
            echo.dispatchPublic{value: 0}(1, hex"01");
        }
    }
}

contract AgentComputeTest is Test {
    MockAgentPlatform platform;
    EchoCompute echo;

    uint256 constant SUB = 3;
    uint256 constant REWARD = 0.03 ether;
    address owner; // this test contract owns echo (it deploys it)
    address user = address(0x5E5);

    function setUp() public {
        platform = new MockAgentPlatform();
        echo = new EchoCompute(address(platform), SUB, REWARD);
        owner = address(this);
        vm.deal(user, 100 ether);
    }

    function deposit() internal view returns (uint256) {
        return platform.FLOOR() + REWARD * SUB;
    }

    function test_requiredDeposit_isFloorPlusRewardPot() public view {
        assertEq(echo.requiredDeposit(), platform.FLOOR() + REWARD * SUB);
    }

    function test_owner_canDispatchFromContractBalance() public {
        // Owner pays from the contract's own balance (no msg.value), like rebate reuse.
        vm.deal(address(echo), deposit());
        echo.dispatchPublic(1, hex"01");
        assertEq(platform.lastValue(), deposit());
        assertTrue(echo.pendingRequests(echo.lastRequestId()));
    }

    function test_owner_underfundedContract_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(AgentCompute.InsufficientDeposit.selector, 0, deposit()));
        echo.dispatchPublic(1, hex"01");
    }

    function test_nonOwner_mustForwardDeposit() public {
        uint256 dep = deposit();
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(AgentCompute.InsufficientDeposit.selector, 0, dep));
        echo.dispatchPublic(1, hex"01");
    }

    function test_nonOwner_exactDeposit_dispatches() public {
        uint256 dep = deposit(); // compute before prank — a view call here would consume it
        vm.prank(user);
        echo.dispatchPublic{value: dep}(1, hex"01");
        assertEq(platform.lastValue(), dep);
        assertEq(echo.pendingRequests(echo.lastRequestId()), true);
    }

    function test_nonOwner_overpayment_isRefunded() public {
        uint256 dep = deposit();
        uint256 before = user.balance;
        vm.prank(user);
        echo.dispatchPublic{value: dep + 0.5 ether}(1, hex"01");
        // Only the deposit leaves the user; the 0.5 ether overpay is refunded.
        assertEq(user.balance, before - dep);
        assertEq(platform.lastValue(), dep);
    }

    function test_receive_acceptsRebate() public {
        vm.expectEmit(true, false, false, true, address(echo));
        emit AgentCompute.Funded(address(this), 1 ether);
        (bool ok,) = address(echo).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(echo).balance, 1 ether);
    }

    function test_handleResponse_onlyPlatform() public {
        vm.deal(address(echo), deposit());
        echo.dispatchPublic(1, hex"01");
        uint256 id = echo.lastRequestId();
        Response[] memory empty = new Response[](0);
        Request memory details;
        vm.expectRevert(abi.encodeWithSelector(AgentCompute.NotPlatform.selector, address(this)));
        echo.handleResponse(id, empty, ResponseStatus.Success, details);
    }

    function test_handleResponse_unknownRequest_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(AgentCompute.UnknownRequest.selector, uint256(999)));
        platform.fireUint(address(echo), 999, 42);
    }

    function test_handleResponse_successEmpty_reverts() public {
        vm.deal(address(echo), deposit());
        echo.dispatchPublic(1, hex"01");
        uint256 id = echo.lastRequestId();
        Response[] memory empty = new Response[](0);
        vm.expectRevert(abi.encodeWithSelector(AgentCompute.EmptySuccessResponse.selector, id));
        platform.fireRaw(address(echo), id, empty, ResponseStatus.Success);
    }

    function test_handleResponse_success_storesResult_andClearsPending() public {
        vm.deal(address(echo), deposit());
        echo.dispatchPublic(1, hex"01");
        uint256 id = echo.lastRequestId();
        platform.fireUint(address(echo), id, 7);
        assertEq(echo.resultCount(), 1);
        assertEq(abi.decode(echo.lastResult(), (uint256)), 7);
        assertFalse(echo.pendingRequests(id));
    }

    function test_handleResponse_failure_emitsAndHooks_noPoisonedState() public {
        vm.deal(address(echo), deposit());
        echo.dispatchPublic(1, hex"01");
        uint256 id = echo.lastRequestId();
        vm.expectEmit(true, false, false, true, address(echo));
        emit AgentCompute.RequestFailed(id, ResponseStatus.TimedOut);
        platform.fireFailure(address(echo), id, ResponseStatus.TimedOut);
        assertEq(echo.failureCount(), 1);
        assertEq(uint8(echo.lastFailureStatus()), uint8(ResponseStatus.TimedOut));
        assertEq(echo.resultCount(), 0); // no success result stored
        assertFalse(echo.pendingRequests(id)); // pending cleared either way
    }

    function test_consensusReceipt_recordsValidatorsAndMedianCost() public {
        vm.deal(address(echo), deposit());
        echo.dispatchPublic(1, hex"01");
        uint256 id = echo.lastRequestId();

        // Three validators agree on "ok" with costs [5, 1, 3] → median 3.
        uint256[] memory costs = new uint256[](3);
        costs[0] = 5;
        costs[1] = 1;
        costs[2] = 3;
        vm.expectEmit(true, false, false, true, address(echo));
        emit AgentCompute.ConsensusReached(id, 3, 1000, 3);
        platform.fireStringConsensus(address(echo), id, "ok", costs, 1000);

        AgentCompute.Receipt memory r = echo.consensusOf(id);
        assertEq(r.validators, 3);
        assertEq(r.receiptId, 1000);
        assertEq(r.executionCost, 3); // median, not mean/first
        assertGt(r.finalizedAt, 0);
    }

    function test_consensusReceipt_evenValidators_averagesTwoMiddle() public {
        vm.deal(address(echo), deposit());
        echo.dispatchPublic(1, hex"01");
        uint256 id = echo.lastRequestId();

        // Four validators with costs [1, 2, 4, 8] → true median (2+4)/2 = 3.
        uint256[] memory costs = new uint256[](4);
        costs[0] = 1;
        costs[1] = 2;
        costs[2] = 4;
        costs[3] = 8;
        platform.fireStringConsensus(address(echo), id, "ok", costs, 500);

        AgentCompute.Receipt memory r = echo.consensusOf(id);
        assertEq(r.validators, 4);
        assertEq(r.executionCost, 3); // (2+4)/2, not the upper-middle 4
    }

    function test_doubleCallback_secondIsUnknown() public {
        vm.deal(address(echo), deposit());
        echo.dispatchPublic(1, hex"01");
        uint256 id = echo.lastRequestId();
        platform.fireUint(address(echo), id, 1);
        // pending already cleared — a replayed callback is rejected.
        vm.expectRevert(abi.encodeWithSelector(AgentCompute.UnknownRequest.selector, id));
        platform.fireUint(address(echo), id, 2);
    }

    function test_withdraw_ownerOnly() public {
        vm.deal(address(echo), 1 ether);
        vm.prank(user);
        vm.expectRevert(AgentCompute.NotOwner.selector);
        echo.withdraw(payable(user), 1 ether);

        uint256 before = address(this).balance;
        echo.withdraw(payable(address(this)), 0.4 ether);
        assertEq(address(this).balance, before + 0.4 ether);
        assertEq(address(echo).balance, 0.6 ether);
    }

    function test_withdrawAll_sweeps() public {
        vm.deal(address(echo), 2 ether);
        uint256 before = address(this).balance;
        echo.withdrawAll(payable(address(this)));
        assertEq(address(echo).balance, 0);
        assertEq(address(this).balance, before + 2 ether);
    }

    function test_reentrancy_refundCannotReenterDispatch() public {
        Reenterer attacker = new Reenterer(echo);
        vm.deal(address(attacker), 100 ether);
        uint256 overpay = deposit() + 1; // compute before expectRevert (a view call would consume it)
        // The refund triggers the attacker's receive(), which re-enters _dispatch;
        // nonReentrant blocks it, the refund call fails → RefundFailed, whole tx reverts.
        vm.expectRevert(AgentCompute.RefundFailed.selector);
        attacker.attack(overpay);
        // Everything rolled back: no request persisted.
        assertEq(platform.nextRequestId(), 1);
    }

    // accept withdraw payouts
    receive() external payable {}
}
