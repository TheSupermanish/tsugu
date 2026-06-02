// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAgentRequester, Response, Request, ResponseStatus} from "./lib/SomniaAgents.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title  AgentCompute — the reusable base for asom's on-chain AI primitives
/// @notice Distills the proven, hardened request/callback/funding pattern from
///         `OracleAgent.sol` into one audited base so every "fundamental AI" agent
///         (LLM inference, website parse, JSON fetch) speaks to the Somnia Agents
///         platform identically. A subclass only encodes a payload, calls `_dispatch`,
///         and decodes its result in `_onResult` — every Somnia-Agents pitfall is
///         handled here, once.
/// @dev    All four canonical Somnia Agents pitfalls are wired in this base:
///         (1) deposit  = floor + per-agent reward × subcommittee size (read live)
///         (2) receive() accepts rebates pushed back from the platform
///         (3) handleResponse() is gated on platform sender + a known requestId
///         (4) ResponseStatus is checked before any decode of the result bytes
///
///         Funding model (identical to OracleAgent): non-owners must forward
///         `msg.value >= requiredDeposit()` (caller-pays — prevents draining the
///         contract's working capital via spammed requests); the owner may pay from
///         the contract's accumulated balance (rebates / top-ups). A non-owner's
///         overpayment is refunded — never trapped as a silent donation.
abstract contract AgentCompute is ReentrancyGuard {
    IAgentRequester public immutable platform;
    uint256 public immutable subcommitteeSize;
    uint256 public immutable perAgentReward;

    /// @notice Immutable. If the deployer's key is lost, funds in the contract are
    ///         unrecoverable. Ownership maps to the deployer; an asom agent that owns
    ///         this primitive drives it from its ERC-6551 wallet via `execute`.
    address public immutable owner;

    /// @notice Request ids this contract dispatched and is still awaiting a callback for.
    mapping(uint256 => bool) public pendingRequests;
    uint256 public lastRequestId;

    /// @notice The consensus receipt for a finalized request — the on-chain proof that
    ///         the Somnia validator subcommittee actually ran the agent and agreed. We
    ///         keep `validators` (how many results came back), the platform `receipt`
    ///         id of the first reporter, the median `executionCost`, and the finalize
    ///         time. This is what makes "consensus-verified compute" auditable rather
    ///         than asserted — consumers can check how many validators backed a result.
    struct Receipt {
        uint64 validators; // number of validator responses returned
        uint64 finalizedAt; // block time the callback landed
        uint256 receiptId; // platform receipt id (responses[0].receipt)
        uint256 executionCost; // median reported per-validator execution cost
    }

    mapping(uint256 => Receipt) public receipts;

    event RequestDispatched(uint256 indexed requestId, uint256 indexed agentId);
    event ConsensusReached(
        uint256 indexed requestId, uint64 validators, uint256 receiptId, uint256 medianExecutionCost
    );
    event RequestFailed(uint256 indexed requestId, ResponseStatus status);
    event Funded(address indexed from, uint256 amount);
    event Refunded(address indexed to, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    error InsufficientDeposit(uint256 sent, uint256 required);
    error NotPlatform(address caller);
    error UnknownRequest(uint256 requestId);
    error NotOwner();
    error EmptySuccessResponse(uint256 requestId);
    error RefundFailed();
    error WithdrawFailed();

    constructor(address platform_, uint256 subcommitteeSize_, uint256 perAgentReward_) {
        platform = IAgentRequester(platform_);
        subcommitteeSize = subcommitteeSize_;
        perAgentReward = perAgentReward_;
        owner = msg.sender;
    }

    /// @notice Total wei needed to dispatch one request: platform floor + reward pot.
    /// @dev    Runners skip a request whose perAgentBudget is below the scheduled
    ///         execution cost — the floor alone is NOT enough, so the reward pot is
    ///         added on top. Reads the floor live (do not hardcode: on Shannon the
    ///         platform read is precompile-backed and reverts inside forge simulation).
    function requiredDeposit() public view returns (uint256) {
        return platform.getRequestDeposit() + (perAgentReward * subcommitteeSize);
    }

    /// @notice Dispatch a request to a Somnia agent. The funding model and the
    ///         overpayment refund are enforced here so subclasses can't get them wrong.
    /// @dev    `nonReentrant` guards the dispatch+refund region (the external call to
    ///         the platform and the refund to a non-owner caller). Subclass entrypoints
    ///         are plain `payable` and MUST NOT add their own `nonReentrant` (a second
    ///         guard on the same call would revert the reentrancy lock).
    function _dispatch(uint256 agentId, bytes memory payload) internal nonReentrant returns (uint256 requestId) {
        if (msg.value > 0) emit Funded(msg.sender, msg.value);

        uint256 deposit = requiredDeposit();

        // Non-owners must fund their own request — prevents DoS and arbitrary-payload
        // attacks against the contract's working capital.
        if (msg.sender != owner && msg.value < deposit) {
            revert InsufficientDeposit(msg.value, deposit);
        }
        if (address(this).balance < deposit) {
            revert InsufficientDeposit(address(this).balance, deposit);
        }

        requestId =
            platform.createRequest{value: deposit}(agentId, address(this), this.handleResponse.selector, payload);

        pendingRequests[requestId] = true;
        lastRequestId = requestId;

        emit RequestDispatched(requestId, agentId);

        // Refund a non-owner's overpayment so it isn't trapped as a silent donation.
        // (The owner's own overpayment stays as a top-up of their own contract.)
        // Sent last, behind nonReentrant.
        if (msg.sender != owner && msg.value > deposit) {
            uint256 refund = msg.value - deposit;
            (bool ok,) = msg.sender.call{value: refund}("");
            if (!ok) revert RefundFailed();
            emit Refunded(msg.sender, refund);
        }
    }

    /// @notice Platform callback. Gated on sender + a known requestId. Status is
    ///         checked before any decode to avoid panics on Failed / TimedOut where
    ///         the result bytes may be empty or malformed. Delegates decoding of a
    ///         successful result to `_onResult`; a failure to `_onFailed`.
    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory /* details */
    )
        external
    {
        if (msg.sender != address(platform)) revert NotPlatform(msg.sender);
        if (!pendingRequests[requestId]) revert UnknownRequest(requestId);

        delete pendingRequests[requestId];

        if (status == ResponseStatus.Success) {
            // A Success status with zero responses is structurally contradictory —
            // fail loud rather than hand empty bytes to a subclass decoder.
            if (responses.length == 0) revert EmptySuccessResponse(requestId);

            // Capture the consensus receipt (the proof the subcommittee ran + agreed)
            // BEFORE handing the result to the subclass, so it's recorded even if a
            // subclass decoder is strict. The median executionCost mirrors how the
            // platform pays validators (median of reported costs).
            uint256 medianCost = _medianExecutionCost(responses);
            receipts[requestId] = Receipt({
                validators: uint64(responses.length),
                finalizedAt: uint64(block.timestamp),
                receiptId: responses[0].receipt,
                executionCost: medianCost
            });
            emit ConsensusReached(requestId, uint64(responses.length), responses[0].receipt, medianCost);

            _onResult(requestId, responses[0].result);
        } else {
            emit RequestFailed(requestId, status);
            _onFailed(requestId, status);
        }
    }

    /// @notice The consensus receipt for a finalized request (0/empty until it lands).
    function consensusOf(uint256 requestId) external view returns (Receipt memory) {
        return receipts[requestId];
    }

    /// @dev Median of the per-validator `executionCost`s — the same statistic the
    ///      platform uses to pay validators. Insertion sort: response arrays are tiny
    ///      (bounded by the subcommittee size), so this is cheap and avoids a library.
    function _medianExecutionCost(Response[] memory responses) internal pure returns (uint256) {
        uint256 n = responses.length;
        uint256[] memory costs = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            costs[i] = responses[i].executionCost;
        }
        for (uint256 i = 1; i < n; i++) {
            uint256 key = costs[i];
            uint256 j = i;
            while (j > 0 && costs[j - 1] > key) {
                costs[j] = costs[j - 1];
                j--;
            }
            costs[j] = key;
        }
        if (n == 0) return 0;
        // True median: average the two middle elements for an even count (the default
        // subcommittee is odd, but advanced consensus may request an even one).
        return n % 2 == 1 ? costs[n / 2] : (costs[n / 2 - 1] + costs[n / 2]) / 2;
    }

    /// @dev Decode + store a successful consensus result. Implemented by each primitive.
    function _onResult(uint256 requestId, bytes memory result) internal virtual;

    /// @dev Hook for a Failed / TimedOut request. Default: no-op (the base already
    ///      emits RequestFailed and clears the pending flag). Override to record it.
    function _onFailed(uint256 requestId, ResponseStatus status) internal virtual {}

    /// @notice Pull funds back out (owner only). Useful for rebate sweeps / end-of-demo.
    function withdraw(address payable to, uint256 amount) external nonReentrant {
        if (msg.sender != owner) revert NotOwner();
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(to, amount);
    }

    /// @notice Sweep the entire balance back to `to` (owner only).
    function withdrawAll(address payable to) external nonReentrant {
        if (msg.sender != owner) revert NotOwner();
        uint256 amount = address(this).balance;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(to, amount);
    }

    /// @dev Accepts rebates from the platform (and top-ups from the owner). REQUIRED —
    ///      the platform pushes the unused deposit remainder back here on finalization.
    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }
}
