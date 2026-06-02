// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AgentNFT} from "../identity/AgentNFT.sol";
import {AgentRegistry} from "../identity/AgentRegistry.sol";
import {CapabilityRegistry} from "./CapabilityRegistry.sol";

/// @title  TaskBoard — tsugu's coordination layer (the agent economy)
/// @notice Post a task with an escrowed STT reward and a required capability tag.
///         A capable agent (one whose CapabilityRegistry listing has that tag)
///         accepts it, submits a result, and on the poster's approval the reward is
///         paid into the WORKER AGENT'S OWN ERC-6551 wallet — so agents accrue
///         earnings in their own wallets. Composes identity + wallets + discovery.
/// @dev    Fairness is two-sided:
///         - poster can cancel an un-accepted (Open) task anytime, and reclaim a
///           reward if an accepted task isn't submitted by the deadline;
///         - a worker who submits can claim the reward itself if the poster neither
///           approves nor disputes within REVIEW_WINDOW (no poster-side griefing).
///         All payouts follow checks-effects-interactions and are nonReentrant: the
///         task moves to a terminal status before any STT leaves the contract.
contract TaskBoard is ReentrancyGuard {
    AgentNFT public immutable nft;
    AgentRegistry public immutable registry; // resolves tokenId -> the agent's TBA wallet
    CapabilityRegistry public immutable caps;

    /// @notice Grace period after submission during which only the poster may
    ///         approve; afterwards the worker can self-claim a submitted task.
    uint64 public constant REVIEW_WINDOW = 3 days;

    enum Status {
        None,
        Open,
        Accepted,
        Submitted,
        Approved,
        Refunded
    }

    struct Task {
        address poster;
        bytes32 capability;
        uint256 reward;
        uint64 deadline; // accept-and-submit-by
        uint64 submittedAt; // set on submitResult; starts the review window
        uint256 workerTokenId; // 0 until accepted
        Status status;
        string specURI;
        string resultURI;
    }

    mapping(uint256 => Task) private _tasks;
    uint256 public nextTaskId = 1;

    event TaskPosted(
        uint256 indexed taskId,
        address indexed poster,
        bytes32 indexed capability,
        uint256 reward,
        uint64 deadline,
        string specURI
    );
    event TaskAccepted(uint256 indexed taskId, uint256 indexed workerTokenId, address worker);
    event TaskSubmitted(uint256 indexed taskId, string resultURI);
    event TaskApproved(uint256 indexed taskId, uint256 indexed workerTokenId, address wallet, uint256 reward);
    event TaskRefunded(uint256 indexed taskId, address indexed poster, uint256 reward);

    error EmptyReward();
    error BadDeadline();
    error NotOpen(uint256 taskId);
    error Expired(uint256 taskId);
    error NotAccepted(uint256 taskId);
    error NotSubmitted(uint256 taskId);
    error NotPoster(uint256 taskId);
    error NotWorkerOwner(uint256 taskId);
    error MissingCapability(uint256 tokenId, bytes32 capability);
    error NotRefundable(uint256 taskId);
    error ReviewWindowOpen(uint256 taskId);
    error PayoutFailed();
    error RefundFailed();
    error WorkerWalletNotDeployed();

    constructor(AgentNFT nft_, AgentRegistry registry_, CapabilityRegistry caps_) {
        nft = nft_;
        registry = registry_;
        caps = caps_;
    }

    /// @notice Full task record.
    function getTask(uint256 taskId) external view returns (Task memory) {
        return _tasks[taskId];
    }

    /// @notice Post a task. The STT sent is escrowed as the reward.
    /// @param capability  the capability tag a worker must advertise to accept
    /// @param specURI     off-chain task spec / brief
    /// @param deadline    unix time the worker must have submitted by
    function postTask(bytes32 capability, string calldata specURI, uint64 deadline)
        external
        payable
        returns (uint256 taskId)
    {
        if (msg.value == 0) revert EmptyReward();
        if (deadline <= block.timestamp) revert BadDeadline();
        taskId = nextTaskId++;
        Task storage t = _tasks[taskId];
        t.poster = msg.sender;
        t.capability = capability;
        t.reward = msg.value;
        t.deadline = deadline;
        t.status = Status.Open;
        t.specURI = specURI;
        emit TaskPosted(taskId, msg.sender, capability, msg.value, deadline, specURI);
    }

    /// @notice A capable agent claims an open task. Caller must own `workerTokenId`
    ///         and that agent must advertise the task's capability.
    function acceptTask(uint256 taskId, uint256 workerTokenId) external {
        Task storage t = _tasks[taskId];
        if (t.status != Status.Open) revert NotOpen(taskId);
        if (block.timestamp >= t.deadline) revert Expired(taskId);
        if (nft.ownerOf(workerTokenId) != msg.sender) revert NotWorkerOwner(taskId);
        if (!caps.hasCapability(workerTokenId, t.capability)) revert MissingCapability(workerTokenId, t.capability);
        t.workerTokenId = workerTokenId;
        t.status = Status.Accepted;
        emit TaskAccepted(taskId, workerTokenId, msg.sender);
    }

    /// @notice The worker submits a result, starting the review window.
    function submitResult(uint256 taskId, string calldata resultURI) external {
        Task storage t = _tasks[taskId];
        if (t.status != Status.Accepted) revert NotAccepted(taskId);
        // Must submit BY the deadline. Without this, a worker who blew the deadline
        // could front-run the poster's refund() with a late/garbage submitResult,
        // flipping the task to Submitted (no longer refundable) and self-claiming the
        // reward after the review window — stealing the escrow for zero work.
        if (block.timestamp >= t.deadline) revert Expired(taskId);
        if (nft.ownerOf(t.workerTokenId) != msg.sender) revert NotWorkerOwner(taskId);
        t.resultURI = resultURI;
        t.submittedAt = uint64(block.timestamp);
        t.status = Status.Submitted;
        emit TaskSubmitted(taskId, resultURI);
    }

    /// @notice The poster approves a submitted task; reward is paid into the worker
    ///         agent's own ERC-6551 wallet.
    function approveTask(uint256 taskId) external nonReentrant {
        Task storage t = _tasks[taskId];
        if (t.status != Status.Submitted) revert NotSubmitted(taskId);
        if (msg.sender != t.poster) revert NotPoster(taskId);
        _payout(taskId, t);
    }

    /// @notice If the poster neither approves nor disputes within REVIEW_WINDOW of
    ///         submission, the worker can claim the reward itself (anti-griefing).
    function workerClaim(uint256 taskId) external nonReentrant {
        Task storage t = _tasks[taskId];
        if (t.status != Status.Submitted) revert NotSubmitted(taskId);
        if (nft.ownerOf(t.workerTokenId) != msg.sender) revert NotWorkerOwner(taskId);
        if (block.timestamp < uint256(t.submittedAt) + REVIEW_WINDOW) revert ReviewWindowOpen(taskId);
        _payout(taskId, t);
    }

    /// @notice Poster reclaims the escrow: an Open task can be cancelled anytime;
    ///         an Accepted task can be reclaimed once the deadline passes with no
    ///         submission. (A Submitted task pays out — use the review window.)
    function refund(uint256 taskId) external nonReentrant {
        Task storage t = _tasks[taskId];
        if (msg.sender != t.poster) revert NotPoster(taskId);
        bool openCancel = (t.status == Status.Open);
        bool acceptedExpired = (t.status == Status.Accepted && block.timestamp >= t.deadline);
        if (!openCancel && !acceptedExpired) revert NotRefundable(taskId);

        t.status = Status.Refunded; // effects before interaction
        uint256 reward = t.reward;
        (bool ok,) = t.poster.call{value: reward}("");
        if (!ok) revert RefundFailed();
        emit TaskRefunded(taskId, t.poster, reward);
    }

    /// @dev Terminal-state-then-pay payout into the worker agent's TBA wallet.
    function _payout(uint256 taskId, Task storage t) internal {
        t.status = Status.Approved; // effects before interaction (also blocks re-entry to a 2nd payout)
        address wallet = registry.previewAccount(t.workerTokenId); // the agent's ERC-6551 wallet
        // Defense-in-depth: register() always deploys the TBA, but never pay a
        // counterfactual address that has no code (funds would be silently stranded).
        if (wallet.code.length == 0) revert WorkerWalletNotDeployed();
        uint256 reward = t.reward;
        (bool ok,) = wallet.call{value: reward}("");
        if (!ok) revert PayoutFailed();
        emit TaskApproved(taskId, t.workerTokenId, wallet, reward);
    }
}
