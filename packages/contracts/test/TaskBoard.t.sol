// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {AgentNFT} from "../src/identity/AgentNFT.sol";
import {AgentRegistry} from "../src/identity/AgentRegistry.sol";
import {AgentAccount} from "../src/accounts/AgentAccount.sol";
import {ERC6551Registry} from "../src/accounts/ERC6551Registry.sol";
import {CapabilityRegistry} from "../src/coordination/CapabilityRegistry.sol";
import {TaskBoard} from "../src/coordination/TaskBoard.sol";

/// @dev A poster that re-enters refund() on receiving its refund, to prove the
///      nonReentrant guard + CEI prevent any double-spend / drain.
contract ReentrantPoster {
    TaskBoard internal board;
    uint256 internal taskId;
    bool internal reenter;

    constructor(TaskBoard board_) {
        board = board_;
    }

    function post(bytes32 cap, uint64 deadline) external payable returns (uint256) {
        taskId = board.postTask{value: msg.value}(cap, "spec", deadline);
        return taskId;
    }

    function armAndRefund(bool reenter_) external {
        reenter = reenter_;
        board.refund(taskId);
    }

    receive() external payable {
        if (reenter) {
            reenter = false; // only once
            board.refund(taskId); // must revert under the guard
        }
    }
}

contract TaskBoardTest is Test {
    AgentNFT internal nft;
    ERC6551Registry internal accounts;
    AgentAccount internal accountImpl;
    AgentRegistry internal registry;
    CapabilityRegistry internal caps;
    TaskBoard internal board;

    address internal poster = address(0xF05E5);
    address internal worker = address(0x404E12);
    address internal stranger = address(0x57A);

    bytes32 internal constant LLM = keccak256("llm.summarize");
    bytes32 internal constant ORACLE = keccak256("oracle.price");

    uint256 internal workerId;
    address internal workerWallet;

    event TaskApproved(uint256 indexed taskId, uint256 indexed workerTokenId, address wallet, uint256 reward);

    function setUp() public {
        nft = new AgentNFT(address(this));
        accounts = new ERC6551Registry();
        accountImpl = new AgentAccount();
        registry = new AgentRegistry(nft, accounts, address(accountImpl));
        nft.setMinter(address(registry));
        caps = new CapabilityRegistry(nft);
        board = new TaskBoard(nft, registry, caps);

        (workerId, workerWallet) = registry.register("worker", worker);
        // worker advertises the LLM capability
        vm.prank(worker);
        caps.addCapability(workerId, LLM);

        vm.deal(poster, 100 ether);
    }

    function _post(uint256 reward, uint64 deadline) internal returns (uint256 taskId) {
        vm.prank(poster);
        taskId = board.postTask{value: reward}(LLM, "ipfs://spec", deadline);
    }

    // ---------------------------------------------------------------------
    // Happy path: post → accept → submit → approve → worker wallet paid
    // ---------------------------------------------------------------------

    function test_fullLifecycle_paysWorkerWallet() public {
        uint256 taskId = _post(1 ether, uint64(block.timestamp + 1 days));
        assertEq(address(board).balance, 1 ether, "reward escrowed");

        vm.prank(worker);
        board.acceptTask(taskId, workerId);

        vm.prank(worker);
        board.submitResult(taskId, "ipfs://result");

        uint256 walletBefore = workerWallet.balance;
        vm.expectEmit(true, true, false, true, address(board));
        emit TaskApproved(taskId, workerId, workerWallet, 1 ether);
        vm.prank(poster);
        board.approveTask(taskId);

        assertEq(workerWallet.balance - walletBefore, 1 ether, "reward paid into the agent's OWN wallet");
        assertEq(address(board).balance, 0, "escrow released");
        assertEq(uint8(board.getTask(taskId).status), uint8(TaskBoard.Status.Approved));
    }

    // ---------------------------------------------------------------------
    // Capability gating + access control on accept/submit/approve
    // ---------------------------------------------------------------------

    function test_accept_requiresAdvertisedCapability() public {
        // a worker agent that does NOT advertise LLM
        (uint256 otherId,) = registry.register("noskill", worker);
        uint256 taskId = _post(1 ether, uint64(block.timestamp + 1 days));
        vm.prank(worker);
        vm.expectRevert(abi.encodeWithSelector(TaskBoard.MissingCapability.selector, otherId, LLM));
        board.acceptTask(taskId, otherId);
    }

    function test_accept_requiresOwningWorkerToken() public {
        uint256 taskId = _post(1 ether, uint64(block.timestamp + 1 days));
        vm.prank(stranger); // stranger doesn't own workerId
        vm.expectRevert(abi.encodeWithSelector(TaskBoard.NotWorkerOwner.selector, taskId));
        board.acceptTask(taskId, workerId);
    }

    function test_accept_rejectedAfterDeadline() public {
        uint256 taskId = _post(1 ether, uint64(block.timestamp + 1 days));
        vm.warp(block.timestamp + 2 days);
        vm.prank(worker);
        vm.expectRevert(abi.encodeWithSelector(TaskBoard.Expired.selector, taskId));
        board.acceptTask(taskId, workerId);
    }

    function test_accept_rejectedWhenNotOpen() public {
        uint256 taskId = _post(1 ether, uint64(block.timestamp + 1 days));
        vm.prank(worker);
        board.acceptTask(taskId, workerId);
        vm.prank(worker);
        vm.expectRevert(abi.encodeWithSelector(TaskBoard.NotOpen.selector, taskId));
        board.acceptTask(taskId, workerId);
    }

    function test_submit_onlyWorkerOwnerWhenAccepted() public {
        uint256 taskId = _post(1 ether, uint64(block.timestamp + 1 days));
        // not yet accepted
        vm.prank(worker);
        vm.expectRevert(abi.encodeWithSelector(TaskBoard.NotAccepted.selector, taskId));
        board.submitResult(taskId, "x");

        vm.prank(worker);
        board.acceptTask(taskId, workerId);
        // a stranger can't submit
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TaskBoard.NotWorkerOwner.selector, taskId));
        board.submitResult(taskId, "x");
    }

    function test_approve_onlyPosterWhenSubmitted() public {
        uint256 taskId = _post(1 ether, uint64(block.timestamp + 1 days));
        vm.prank(worker);
        board.acceptTask(taskId, workerId);
        // not submitted yet
        vm.prank(poster);
        vm.expectRevert(abi.encodeWithSelector(TaskBoard.NotSubmitted.selector, taskId));
        board.approveTask(taskId);

        vm.prank(worker);
        board.submitResult(taskId, "r");
        // stranger can't approve
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TaskBoard.NotPoster.selector, taskId));
        board.approveTask(taskId);
    }

    function test_doubleApprove_reverts() public {
        uint256 taskId = _post(1 ether, uint64(block.timestamp + 1 days));
        vm.prank(worker);
        board.acceptTask(taskId, workerId);
        vm.prank(worker);
        board.submitResult(taskId, "r");
        vm.prank(poster);
        board.approveTask(taskId);
        vm.prank(poster);
        vm.expectRevert(abi.encodeWithSelector(TaskBoard.NotSubmitted.selector, taskId));
        board.approveTask(taskId);
    }

    // ---------------------------------------------------------------------
    // Fairness: worker self-claim after the review window; poster refunds
    // ---------------------------------------------------------------------

    function test_workerClaim_blockedDuringReviewWindowThenPays() public {
        uint256 taskId = _post(1 ether, uint64(block.timestamp + 1 days));
        vm.prank(worker);
        board.acceptTask(taskId, workerId);
        vm.prank(worker);
        board.submitResult(taskId, "r");

        // too early
        vm.prank(worker);
        vm.expectRevert(abi.encodeWithSelector(TaskBoard.ReviewWindowOpen.selector, taskId));
        board.workerClaim(taskId);

        // after the review window the worker can self-claim
        vm.warp(block.timestamp + board.REVIEW_WINDOW() + 1);
        uint256 before = workerWallet.balance;
        vm.prank(worker);
        board.workerClaim(taskId);
        assertEq(workerWallet.balance - before, 1 ether, "worker self-claimed into its wallet");
    }

    function test_refund_openCancelAnytime() public {
        uint256 taskId = _post(1 ether, uint64(block.timestamp + 1 days));
        uint256 before = poster.balance;
        vm.prank(poster);
        board.refund(taskId);
        assertEq(poster.balance - before, 1 ether, "open task cancelled, escrow returned");
        assertEq(uint8(board.getTask(taskId).status), uint8(TaskBoard.Status.Refunded));
    }

    function test_refund_acceptedReclaimableOnlyAfterDeadline() public {
        uint256 taskId = _post(1 ether, uint64(block.timestamp + 1 days));
        vm.prank(worker);
        board.acceptTask(taskId, workerId);

        // accepted, not yet expired → not refundable
        vm.prank(poster);
        vm.expectRevert(abi.encodeWithSelector(TaskBoard.NotRefundable.selector, taskId));
        board.refund(taskId);

        // after deadline with no submission → poster reclaims
        vm.warp(block.timestamp + 2 days);
        uint256 before = poster.balance;
        vm.prank(poster);
        board.refund(taskId);
        assertEq(poster.balance - before, 1 ether);
    }

    function test_refund_notRefundableWhenSubmitted() public {
        uint256 taskId = _post(1 ether, uint64(block.timestamp + 1 days));
        vm.prank(worker);
        board.acceptTask(taskId, workerId);
        vm.prank(worker);
        board.submitResult(taskId, "r");
        vm.warp(block.timestamp + 10 days);
        vm.prank(poster);
        vm.expectRevert(abi.encodeWithSelector(TaskBoard.NotRefundable.selector, taskId));
        board.refund(taskId);
    }

    function test_refund_onlyPoster() public {
        uint256 taskId = _post(1 ether, uint64(block.timestamp + 1 days));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TaskBoard.NotPoster.selector, taskId));
        board.refund(taskId);
    }

    // ---------------------------------------------------------------------
    // Post validation
    // ---------------------------------------------------------------------

    function test_post_rejectsEmptyReward() public {
        vm.prank(poster);
        vm.expectRevert(TaskBoard.EmptyReward.selector);
        board.postTask{value: 0}(LLM, "s", uint64(block.timestamp + 1 days));
    }

    function test_post_rejectsPastDeadline() public {
        vm.prank(poster);
        vm.expectRevert(TaskBoard.BadDeadline.selector);
        board.postTask{value: 1 ether}(LLM, "s", uint64(block.timestamp));
    }

    // ---------------------------------------------------------------------
    // Reentrancy: a malicious poster re-entering refund cannot double-spend
    // ---------------------------------------------------------------------

    function test_refund_reentrancyGuarded() public {
        ReentrantPoster evil = new ReentrantPoster(board);
        vm.deal(address(evil), 5 ether);
        uint256 taskId = evil.post{value: 1 ether}(LLM, uint64(block.timestamp + 1 days));
        assertEq(address(board).balance, 1 ether);

        // The re-entrant refund call must fail (guard); no double payout, escrow intact.
        vm.expectRevert(); // RefundFailed (inner re-entry reverted under the guard)
        evil.armAndRefund(true);
        assertEq(address(board).balance, 1 ether, "escrow not drained by reentrancy");
        assertEq(uint8(board.getTask(taskId).status), uint8(TaskBoard.Status.Open), "state rolled back");

        // Without re-entry, the same poster refunds exactly once.
        uint256 before = address(evil).balance;
        evil.armAndRefund(false);
        assertEq(address(evil).balance - before, 1 ether, "clean refund once");
    }
}
