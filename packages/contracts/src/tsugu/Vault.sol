// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AgentCompute} from "../agents/AgentCompute.sol";
import {SomniaAI} from "../agents/lib/SomniaAI.sol";
import {SomniaAgentIds, ResponseStatus} from "../agents/lib/SomniaAgents.sol";
import {IYieldStrategy} from "./IYieldStrategy.sol";

/// @title  Vault — Tsugu's AI-verified conditional escrow
/// @notice Money that moves on proof, not promises. A **Pact** is a permissionless
///         escrow whose funds release to a beneficiary ONLY when a claim is proven
///         true — and refund to contributors when it is proven false. No middleman
///         decides: Somnia's consensus AI fetches the real evidence, classifies it,
///         and records the verdict (with its consensus receipt) on-chain for anyone
///         to audit.
///
///         Trust is not one call. A Pact verifies its claim against **N independent
///         evidence checks** and releases only when a **quorum (M-of-N)** of them
///         agree — corroboration across sources and across agents, not a single
///         fetch that could be wrong or gamed. Each check picks the right Somnia
///         agent for its evidence:
///           - WEB  → parse-website agent `ExtractString(["confirmed","denied"])`:
///                    one consensus call that reads the page AND classifies it.
///           - DATA → JSON-API agent `fetchBool(url, jsonPath)`: a structured boolean
///                    from a live endpoint.
///           - TEXT → LLM-inference agent `inferString(["confirmed","denied"])`:
///                    consensus reasoning over a pasted statement / evidence — no URL.
///
///         The kintsugi soul: something breaks (trust in online giving), Tsugu mends
///         it, and the corroborated proof is the gold in the seam.
///
/// @dev    `Vault is AgentCompute`: it inherits the hardened request/callback/funding
///         pattern (deposit math, platform-gated callback, status-checked decode,
///         consensus receipts) and adds the escrow + quorum state machine on top.
///
///         MONEY SAFETY (this contract custodies third-party funds — reviewed
///         adversarially):
///           1. Escrow is ring-fenced. `totalEscrow` tracks every wei owed to pacts;
///              the owner's inherited {withdraw}/{withdrawAll} are overridden to sweep
///              only the free (rebate/top-up) balance — never escrow.
///           2. Resolution is per-check and caller-paid. Each `requestResolution`
///              requires `msg.value >= requiredDeposit()` (no owner exemption), so the
///              AI deposit forwarded to the platform is always covered by new money and
///              escrow is never tapped to pay for compute. (One request per tx keeps
///              the base `_dispatch` overpayment refund correct.)
///           3. Every value-moving path (release, refund) is `nonReentrant` and follows
///              checks-effects-interactions. `requestResolution` does NOT add its own
///              guard — it calls the base `_dispatch`, which is already `nonReentrant`.
contract Vault is AgentCompute {
    /// @notice Human-facing framing for a pact. Does NOT change the resolver.
    enum PactKind {
        Relief, // disaster donations released when the event is AI-confirmed
        Medical, // a patient's fund released against verified hospital reports
        Fundraise, // a founder raises against milestones, released when each is verified
        Insurance, // a premium pays out when the parametric event is AI-confirmed
        Custom // any claim backed by evidence
    }

    /// @notice Which Somnia AI agent verifies a given check.
    enum ClaimType {
        Web, // parse-website agent: read `source` (a URL), classify against the claim
        Data, // JSON-API agent: fetch a boolean at `jsonPath` from `source` (a URL)
        Text // LLM-inference agent: reason over the claim + `source` (evidence text)
    }

    /// @notice Per-check outcome. Inconclusive checks can be re-requested.
    enum CheckStatus {
        Pending, // not yet dispatched
        Requested, // dispatched, awaiting the consensus callback
        Confirmed,
        Denied,
        Inconclusive // a fuzzy answer — retryable, never releases funds
    }

    /// @notice Pact lifecycle (driven by the quorum tally over its checks).
    enum PactStatus {
        Open, // accepting contributions; no check in flight yet
        Resolving, // at least one check dispatched, quorum not yet decided
        Confirmed, // >= quorum checks confirmed; releasable after the dispute window
        Denied, // quorum became unreachable; contributors can refund
        Released, // escrow paid to the beneficiary
        Expired // deadline passed undecided; contributors can refund
    }

    /// @notice One independent piece of evidence and its consensus verdict.
    struct Check {
        ClaimType claimType;
        bool resolveUrl; // WEB: true = domain-search the page first; false = direct scrape
        string source; // WEB/DATA: the URL; TEXT: the evidence/statement to reason over
        string jsonPath; // DATA: dot-path to the boolean (ignored otherwise)
        CheckStatus status;
        uint256 requestId; // the platform request (look up `consensusOf` with it)
        string answer; // raw AI answer once resolved
    }

    /// @notice A unit of trust-minimised funding.
    struct Pact {
        address creator;
        address beneficiary;
        PactKind kind;
        PactStatus status;
        uint8 quorum; // # of checks that must Confirm for the pact to Confirm
        uint64 deadline; // claim must be proven by here; after, contributors can refund
        uint64 confirmedAt; // when quorum was reached (starts the dispute window)
        uint64 disputeWindow; // seconds after confirmedAt before release is allowed (0 = instant)
        uint256 escrow; // principal contributed (held in-vault, or sent to the yield strategy)
        bool yieldOn; // opt-in: escrow is deployed to the yield strategy to earn while it waits
        uint256 shares; // yield-strategy shares held for this pact (only when yieldOn)
        string claim; // the human claim every check verifies
        Check[] checks; // 1..MAX_CHECKS independent evidence sources
    }

    /// @notice One evidence source for {createPact} (the on-chain verdict fields are
    ///         filled by the resolver, so they're not part of the input).
    struct NewCheck {
        ClaimType claimType;
        bool resolveUrl;
        string source;
        string jsonPath;
    }

    /// @notice Parameters for {createPact}, bundled to dodge stack-too-deep (via_ir off).
    struct NewPact {
        PactKind kind;
        address beneficiary;
        uint64 deadline;
        uint64 disputeWindow;
        uint8 quorum;
        bool earnYield; // opt-in: put the escrow to work in the yield strategy while it waits
        string claim;
        NewCheck[] checks;
    }

    /// @notice Somnia agent ids for the three resolver paths (defaulted to the canonical
    ///         ids when constructed with 0).
    uint256 public immutable parseAgentId;
    uint256 public immutable jsonAgentId;
    uint256 public immutable llmAgentId;

    /// @notice Confidence gate (0–100) handed to the parse agent; extraction below this
    ///         fails rather than guessing.
    uint8 public constant PARSE_CONFIDENCE = 50;

    /// @notice Upper bound on evidence checks per pact — caps the quorum-tally loop.
    uint8 public constant MAX_CHECKS = 8;

    /// @notice Upper bound on a pact's dispute window. Bounds the release timelock and
    ///         keeps confirmedAt + disputeWindow well inside uint64 (no truncation).
    uint64 public constant MAX_DISPUTE_WINDOW = 30 days;

    Pact[] internal pacts;

    /// @notice Sum of in-vault native escrow (non-yield pacts). The owner can never
    ///         withdraw below this. Yield pacts' funds live in the strategy, not here.
    uint256 public totalEscrow;

    /// @notice Optional yield venue for opt-in pacts. address(0) = yield disabled.
    ///         Owner-settable only while no shares are deployed (no active yield pacts).
    IYieldStrategy public yieldStrategy;

    /// @notice Aggregate strategy shares held across all yield pacts.
    uint256 public outstandingShares;

    /// @notice pactId → contributor → wei contributed (the refundable ledger).
    mapping(uint256 => mapping(address => uint256)) public contributions;

    /// @notice pactId → contributor → yield-strategy shares minted for that contributor
    ///         (yield pacts only). Refund redeems each contributor's EXACT shares so
    ///         yield that accrued between contributions is split by share, not by a
    ///         principal fraction (which would mis-pay co-contributors).
    mapping(uint256 => mapping(address => uint256)) public contributionShares;

    /// @notice Pull-payment ledger: native owed to a beneficiary whose push failed on
    ///         release (e.g. a contract that rejects value). Withdrawn via {claim} — so
    ///         a reverting beneficiary can never permanently brick a Confirmed pact.
    mapping(address => uint256) public claimable;
    /// @notice Sum of `claimable`, ring-fenced from owner withdrawal alongside escrow.
    uint256 public totalPending;

    /// @notice requestId → pactId and → check index, set when a check is dispatched so
    ///         the platform callback (`_onResult`) knows which check a verdict belongs to.
    mapping(uint256 => uint256) public requestToPact;
    mapping(uint256 => uint256) public requestToCheck;

    event PactCreated(
        uint256 indexed pactId,
        address indexed creator,
        address indexed beneficiary,
        PactKind kind,
        uint8 quorum,
        uint8 checkCount,
        uint64 deadline
    );
    event PactContributed(uint256 indexed pactId, address indexed contributor, uint256 amount, uint256 newEscrow);
    event PactResolutionRequested(
        uint256 indexed pactId, uint256 indexed requestId, uint256 checkIndex, ClaimType claimType
    );
    event CheckResolved(
        uint256 indexed pactId, uint256 checkIndex, uint256 indexed requestId, string answer, CheckStatus status
    );
    event PactConfirmed(
        uint256 indexed pactId, uint256 indexed requestId, uint256 confirmedChecks, uint64 releasableAt
    );
    event PactDenied(uint256 indexed pactId, uint256 indexed requestId, uint256 confirmedChecks, uint256 deniedChecks);
    event PactResolutionFailed(uint256 indexed pactId, uint256 indexed requestId, ResponseStatus status);
    event PactReleased(uint256 indexed pactId, address indexed beneficiary, uint256 amount);
    event PactRefunded(uint256 indexed pactId, address indexed contributor, uint256 amount);
    event PactExpired(uint256 indexed pactId);
    event YieldStrategySet(address indexed strategy);
    event PactReleasePending(uint256 indexed pactId, address indexed beneficiary, uint256 amount);
    event Claimed(address indexed who, uint256 amount);

    error BadBeneficiary();
    error BadDeadline();
    error EmptyClaim();
    error NoChecks();
    error TooManyChecks(uint256 given, uint256 max);
    error BadQuorum(uint8 quorum, uint256 checkCount);
    error EmptySource();
    error EmptyJsonPath();
    error UnknownPact(uint256 pactId);
    error UnknownCheck(uint256 pactId, uint256 checkIndex);
    error PactNotActive(PactStatus status);
    error CheckNotResolvable(CheckStatus status);
    error DeadlinePassed();
    error NotOpenForContribution(PactStatus status);
    error NothingContributed();
    error ResolutionFeeTooLow(uint256 sent, uint256 required);
    error NotConfirmed(PactStatus status);
    error DisputeWindowActive(uint64 releasableAt);
    error EmptyEscrow();
    error NotRefundable(PactStatus status);
    error NothingToRefund();
    error NotExpirable();
    error RefundFailedTo(address to);
    error EscrowLocked(uint256 requested, uint256 free);
    error YieldUnavailable();
    error YieldStrategyLocked();
    error ZeroShares();
    error BadDisputeWindow();
    error NothingToClaim();
    error ClaimFailed();

    /// @param platform_         Somnia Agents platform (createRequest/handleResponse).
    /// @param parseAgentId_     parse-website agent id (0 → canonical PARSE_WEBSITE).
    /// @param jsonAgentId_      JSON-API agent id (0 → canonical JSON_API).
    /// @param llmAgentId_       LLM-inference agent id (0 → canonical LLM_INFERENCE).
    /// @param subcommitteeSize_ validators per request (deposit = floor + reward × size).
    /// @param perAgentReward_   per-validator reward in wei (set high enough for the
    ///                          priciest path — the parse agent — so runners don't skip).
    constructor(
        address platform_,
        uint256 parseAgentId_,
        uint256 jsonAgentId_,
        uint256 llmAgentId_,
        uint256 subcommitteeSize_,
        uint256 perAgentReward_
    ) AgentCompute(platform_, subcommitteeSize_, perAgentReward_) {
        parseAgentId = parseAgentId_ == 0 ? SomniaAgentIds.PARSE_WEBSITE : parseAgentId_;
        jsonAgentId = jsonAgentId_ == 0 ? SomniaAgentIds.JSON_API : jsonAgentId_;
        llmAgentId = llmAgentId_ == 0 ? SomniaAgentIds.LLM_INFERENCE : llmAgentId_;
    }

    /// @notice Set (or migrate) the yield venue. Owner-only, and only while no yield
    ///         pacts hold shares — so a live position can never be moved out from under
    ///         contributors. Deploy order: Vault → strategy(vault) → setYieldStrategy.
    function setYieldStrategy(address strategy_) external {
        if (msg.sender != owner) revert NotOwner();
        if (outstandingShares != 0) revert YieldStrategyLocked();
        yieldStrategy = IYieldStrategy(strategy_);
        emit YieldStrategySet(strategy_);
    }

    // --- Create & fund ------------------------------------------------------

    /// @notice Open a pact with one or more evidence checks. Permissionless. Optionally
    ///         seed it by sending value (counts as the creator's first contribution).
    /// @return pactId index of the new pact.
    function createPact(NewPact calldata n) external payable nonReentrant returns (uint256 pactId) {
        if (n.beneficiary == address(0)) revert BadBeneficiary();
        if (n.deadline <= block.timestamp) revert BadDeadline();
        if (bytes(n.claim).length == 0) revert EmptyClaim();
        uint256 k = n.checks.length;
        if (k == 0) revert NoChecks();
        if (k > MAX_CHECKS) revert TooManyChecks(k, MAX_CHECKS);
        if (n.quorum == 0 || n.quorum > k) revert BadQuorum(n.quorum, k);
        if (n.disputeWindow > MAX_DISPUTE_WINDOW) revert BadDisputeWindow();
        if (n.earnYield && address(yieldStrategy) == address(0)) revert YieldUnavailable();

        pactId = pacts.length;
        Pact storage p = pacts.push();
        p.creator = msg.sender;
        p.beneficiary = n.beneficiary;
        p.kind = n.kind;
        p.status = PactStatus.Open;
        p.quorum = n.quorum;
        p.yieldOn = n.earnYield;
        p.deadline = n.deadline;
        p.disputeWindow = n.disputeWindow;
        p.claim = n.claim;

        for (uint256 i; i < k; i++) {
            NewCheck calldata nc = n.checks[i];
            if (bytes(nc.source).length == 0) revert EmptySource();
            if (nc.claimType == ClaimType.Data && bytes(nc.jsonPath).length == 0) revert EmptyJsonPath();
            Check storage c = p.checks.push();
            c.claimType = nc.claimType;
            c.resolveUrl = nc.resolveUrl;
            c.source = nc.source;
            c.jsonPath = nc.jsonPath;
            c.status = CheckStatus.Pending;
        }

        emit PactCreated(pactId, msg.sender, n.beneficiary, n.kind, n.quorum, uint8(k), n.deadline);

        if (msg.value > 0) _contribute(p, pactId, msg.value);
    }

    /// @notice Add funds to a pact's escrow while it is still active and before deadline.
    function contribute(uint256 pactId) external payable nonReentrant {
        Pact storage p = _pact(pactId);
        if (p.status != PactStatus.Open && p.status != PactStatus.Resolving) {
            revert NotOpenForContribution(p.status);
        }
        if (block.timestamp > p.deadline) revert DeadlinePassed();
        if (msg.value == 0) revert NothingContributed();
        _contribute(p, pactId, msg.value);
    }

    /// @dev For a yield pact, the contribution is deposited into the strategy and the
    ///      pact is credited shares; otherwise it's held in-vault as native escrow.
    ///      Called only from {createPact}/{contribute}, both nonReentrant.
    function _contribute(Pact storage p, uint256 pactId, uint256 amount) private {
        contributions[pactId][msg.sender] += amount;
        p.escrow += amount;
        if (p.yieldOn) {
            uint256 s = yieldStrategy.deposit{value: amount}();
            if (s == 0) revert ZeroShares(); // never record principal backed by zero shares
            p.shares += s;
            outstandingShares += s;
            contributionShares[pactId][msg.sender] += s;
        } else {
            totalEscrow += amount;
        }
        emit PactContributed(pactId, msg.sender, amount, p.escrow);
    }

    // --- Resolve ------------------------------------------------------------

    /// @notice Pay the consensus AI to verify ONE evidence check. Permissionless and
    ///         caller-paid: forward `msg.value >= requiredDeposit()`. Resolve several
    ///         checks (in any order, by anyone) to corroborate the claim; the pact
    ///         confirms once a quorum agree. The verdict arrives later via the platform
    ///         callback; overpayment is refunded by the base `_dispatch`.
    /// @dev    Not `nonReentrant` here — `_dispatch` already holds the guard.
    /// @return requestId the dispatched platform request.
    function requestResolution(uint256 pactId, uint256 checkIndex) external payable returns (uint256 requestId) {
        Pact storage p = _pact(pactId);
        if (p.status != PactStatus.Open && p.status != PactStatus.Resolving) revert PactNotActive(p.status);
        if (block.timestamp > p.deadline) revert DeadlinePassed();
        if (checkIndex >= p.checks.length) revert UnknownCheck(pactId, checkIndex);

        Check storage c = p.checks[checkIndex];
        if (c.status != CheckStatus.Pending && c.status != CheckStatus.Inconclusive) {
            revert CheckNotResolvable(c.status);
        }

        uint256 dep = requiredDeposit();
        if (msg.value < dep) revert ResolutionFeeTooLow(msg.value, dep);

        requestId = _dispatchCheck(p.claim, c);

        c.status = CheckStatus.Requested;
        c.requestId = requestId;
        requestToPact[requestId] = pactId;
        requestToCheck[requestId] = checkIndex;
        if (p.status == PactStatus.Open) p.status = PactStatus.Resolving;
        emit PactResolutionRequested(pactId, requestId, checkIndex, c.claimType);
    }

    /// @dev Encode the right payload for a check's claim type and dispatch it.
    function _dispatchCheck(string storage claimText, Check storage c) private returns (uint256 requestId) {
        if (c.claimType == ClaimType.Web) {
            bytes memory payload = SomniaAI.encodeExtractString(
                "verdict",
                "whether the claim is confirmed or denied by the evidence on this page",
                _verdictOptions(),
                claimText,
                c.source,
                c.resolveUrl,
                c.resolveUrl ? uint8(3) : uint8(1),
                PARSE_CONFIDENCE
            );
            requestId = _dispatch(parseAgentId, payload);
        } else if (c.claimType == ClaimType.Data) {
            bytes memory payload = SomniaAI.encodeFetchBool(c.source, c.jsonPath);
            requestId = _dispatch(jsonAgentId, payload);
        } else {
            string memory prompt = string.concat(
                "Claim to verify: ",
                claimText,
                "\n\nEvidence:\n",
                c.source,
                "\n\nIs the claim supported by the evidence?"
            );
            bytes memory payload = SomniaAI.encodeInferString(
                prompt,
                "You verify whether a funding claim is supported by the supplied evidence. Answer with exactly one of the allowed values.",
                true,
                _verdictOptions()
            );
            requestId = _dispatch(llmAgentId, payload);
        }
    }

    /// @notice Decode a check's consensus verdict and re-tally the pact. Called by the
    ///         base from `handleResponse` after the consensus receipt is recorded — so
    ///         `consensusOf(requestId)` is already populated when this runs.
    function _onResult(uint256 requestId, bytes memory result) internal override {
        uint256 pactId = requestToPact[requestId];
        uint256 ci = requestToCheck[requestId];
        Check storage c = pacts[pactId].checks[ci];
        if (c.status != CheckStatus.Requested) return; // defensive: ignore stray callbacks

        string memory answer;
        CheckStatus outcome;
        if (c.claimType == ClaimType.Data) {
            bool v = abi.decode(result, (bool));
            answer = v ? "true" : "false";
            outcome = v ? CheckStatus.Confirmed : CheckStatus.Denied;
        } else {
            answer = abi.decode(result, (string));
            bytes32 h = keccak256(bytes(_toLower(answer)));
            if (h == keccak256("confirmed")) outcome = CheckStatus.Confirmed;
            else if (h == keccak256("denied")) outcome = CheckStatus.Denied;
            else outcome = CheckStatus.Inconclusive; // a fuzzy answer must never release funds
        }

        c.answer = answer;
        c.status = outcome;
        emit CheckResolved(pactId, ci, requestId, answer, outcome);
        _evaluate(pactId, requestId);
    }

    /// @notice A Failed/TimedOut check returns to Pending so it can be retried.
    function _onFailed(uint256 requestId, ResponseStatus status) internal override {
        uint256 pactId = requestToPact[requestId];
        uint256 ci = requestToCheck[requestId];
        Check storage c = pacts[pactId].checks[ci];
        if (c.status == CheckStatus.Requested) c.status = CheckStatus.Pending;
        emit PactResolutionFailed(pactId, requestId, status);
        _evaluate(pactId, requestId);
    }

    /// @dev Re-tally a pact after a check changes. Confirm at quorum; deny once quorum
    ///      is unreachable; otherwise Resolving (a check in flight) or back to Open.
    function _evaluate(uint256 pactId, uint256 requestId) private {
        Pact storage p = pacts[pactId];
        // Only an UNDECIDED pact can change verdict. Confirmed/Denied/Released/Expired
        // are terminal — a late callback (e.g. one that lands after markExpired and a
        // refund) must never flip a settled pact back to Confirmed.
        if (p.status != PactStatus.Open && p.status != PactStatus.Resolving) return;

        uint256 n = p.checks.length;
        uint256 confirmed;
        uint256 denied;
        uint256 inflight;
        for (uint256 i; i < n; i++) {
            CheckStatus s = p.checks[i].status;
            if (s == CheckStatus.Confirmed) confirmed++;
            else if (s == CheckStatus.Denied) denied++;
            else if (s == CheckStatus.Requested) inflight++;
        }

        if (confirmed >= p.quorum) {
            p.status = PactStatus.Confirmed;
            p.confirmedAt = uint64(block.timestamp);
            uint64 releaseAt = uint64(block.timestamp + p.disputeWindow);
            emit PactConfirmed(pactId, requestId, confirmed, releaseAt);
        } else if (denied > n - p.quorum) {
            // even if every remaining check confirmed, quorum is now impossible
            p.status = PactStatus.Denied;
            emit PactDenied(pactId, requestId, confirmed, denied);
        } else {
            p.status = inflight > 0 ? PactStatus.Resolving : PactStatus.Open;
        }
    }

    // --- Settle -------------------------------------------------------------

    /// @notice Release a confirmed pact's escrow to its beneficiary (NO skim). Callable
    ///         by anyone once the dispute window has elapsed. CEI + nonReentrant.
    function release(uint256 pactId) external nonReentrant {
        Pact storage p = _pact(pactId);
        if (p.status != PactStatus.Confirmed) revert NotConfirmed(p.status);
        // Gate computed in uint256 (disputeWindow is bounded, so this also fits uint64).
        uint256 releasableTs = uint256(p.confirmedAt) + uint256(p.disputeWindow);
        if (block.timestamp < releasableTs) revert DisputeWindowActive(uint64(releasableTs));
        if (p.escrow == 0) revert EmptyEscrow();

        address beneficiary = p.beneficiary;
        p.status = PactStatus.Released;

        // Bring the payout into the vault: redeem yield shares here; non-yield escrow
        // is already held here.
        uint256 amount;
        if (p.yieldOn) {
            uint256 sh = p.shares;
            p.shares = 0;
            p.escrow = 0;
            outstandingShares -= sh;
            amount = yieldStrategy.redeem(sh, address(this)); // principal + yield → this vault
        } else {
            amount = p.escrow;
            p.escrow = 0;
            totalEscrow -= amount;
        }

        // Push to the beneficiary; if they reject value, hold it as a claimable credit
        // (pull fallback) so a reverting beneficiary can never permanently lock escrow.
        (bool ok,) = beneficiary.call{value: amount}("");
        if (ok) {
            emit PactReleased(pactId, beneficiary, amount);
        } else {
            claimable[beneficiary] += amount;
            totalPending += amount;
            emit PactReleasePending(pactId, beneficiary, amount);
        }
    }

    /// @notice Refund the caller's contribution from a Denied or Expired pact. Each
    ///         contributor pulls their own funds. CEI + nonReentrant.
    function refund(uint256 pactId) external nonReentrant {
        Pact storage p = _pact(pactId);
        if (p.status != PactStatus.Denied && p.status != PactStatus.Expired) revert NotRefundable(p.status);

        uint256 principal = contributions[pactId][msg.sender];
        if (principal == 0) revert NothingToRefund();
        contributions[pactId][msg.sender] = 0;

        uint256 paid;
        if (p.yieldOn) {
            // Redeem this contributor's EXACT shares (recorded at deposit time): their
            // principal + the yield those specific shares earned. Splitting by principal
            // fraction would mis-pay co-contributors when yield accrued between deposits.
            uint256 sh = contributionShares[pactId][msg.sender];
            contributionShares[pactId][msg.sender] = 0;
            p.shares -= sh;
            p.escrow -= principal;
            outstandingShares -= sh;
            paid = yieldStrategy.redeem(sh, msg.sender);
        } else {
            p.escrow -= principal;
            totalEscrow -= principal;
            paid = principal;
            (bool ok,) = msg.sender.call{value: principal}("");
            if (!ok) revert RefundFailedTo(msg.sender);
        }
        emit PactRefunded(pactId, msg.sender, paid);
    }

    /// @notice Withdraw a payout that couldn't be pushed to you on {release} (pull
    ///         pattern). Lets a beneficiary recover funds even if their address rejected
    ///         the direct transfer. CEI + nonReentrant.
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        totalPending -= amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert ClaimFailed();
        emit Claimed(msg.sender, amount);
    }

    /// @notice Mark an undecided pact Expired once its deadline has passed, unlocking
    ///         refunds. Permissionless.
    function markExpired(uint256 pactId) external {
        Pact storage p = _pact(pactId);
        if (p.status != PactStatus.Open && p.status != PactStatus.Resolving) revert NotExpirable();
        if (block.timestamp <= p.deadline) revert NotExpirable();
        p.status = PactStatus.Expired;
        emit PactExpired(pactId);
    }

    // --- Owner withdrawal (escrow-protected) --------------------------------

    /// @notice Free balance the owner may withdraw: total balance minus ring-fenced
    ///         escrow. This is rebate dust / owner top-ups — never contributor money.
    function freeBalance() public view returns (uint256) {
        uint256 locked = totalEscrow + totalPending;
        uint256 bal = address(this).balance;
        return bal > locked ? bal - locked : 0;
    }

    /// @inheritdoc AgentCompute
    /// @dev Overridden to cap withdrawals at {freeBalance} so escrow can never be swept.
    function withdraw(address payable to, uint256 amount) external override nonReentrant {
        if (msg.sender != owner) revert NotOwner();
        uint256 free = freeBalance();
        if (amount > free) revert EscrowLocked(amount, free);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(to, amount);
    }

    /// @inheritdoc AgentCompute
    /// @dev Overridden to sweep only {freeBalance}, leaving every pact's escrow intact.
    function withdrawAll(address payable to) external override nonReentrant {
        if (msg.sender != owner) revert NotOwner();
        uint256 amount = freeBalance();
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(to, amount);
    }

    // --- Views --------------------------------------------------------------

    /// @notice Number of pacts ever created.
    function pactCount() external view returns (uint256) {
        return pacts.length;
    }

    /// @notice Full pact record (claim + all checks) for a UI/indexer.
    function getPact(uint256 pactId) external view returns (Pact memory) {
        return _pact(pactId);
    }

    /// @notice The checks of a pact (verdicts included).
    function getChecks(uint256 pactId) external view returns (Check[] memory) {
        return _pact(pactId).checks;
    }

    /// @notice Confirmed-check tally for a pact (for progress UIs): (confirmed, denied, total, quorum).
    function tally(uint256 pactId)
        external
        view
        returns (uint256 confirmed, uint256 denied, uint256 total, uint8 quorum)
    {
        Pact storage p = _pact(pactId);
        total = p.checks.length;
        quorum = p.quorum;
        for (uint256 i; i < total; i++) {
            CheckStatus s = p.checks[i].status;
            if (s == CheckStatus.Confirmed) confirmed++;
            else if (s == CheckStatus.Denied) denied++;
        }
    }

    /// @notice The caller-or-other's refundable contribution to a pact.
    function contributionOf(uint256 pactId, address who) external view returns (uint256) {
        return contributions[pactId][who];
    }

    /// @notice Timestamp from which a Confirmed pact may be released (0 if not confirmed).
    function releasableAt(uint256 pactId) external view returns (uint256) {
        Pact storage p = _pact(pactId);
        if (p.status != PactStatus.Confirmed) return 0;
        return uint256(p.confirmedAt) + uint256(p.disputeWindow);
    }

    /// @notice Current redeemable value of a pact's escrow: principal for non-yield
    ///         pacts, principal + accrued yield for yield pacts. `yieldValue - escrow`
    ///         is the yield earned so far.
    function yieldValue(uint256 pactId) external view returns (uint256) {
        Pact storage p = _pact(pactId);
        if (!p.yieldOn || address(yieldStrategy) == address(0)) return p.escrow;
        return yieldStrategy.valueOf(p.shares);
    }

    // --- Internal -----------------------------------------------------------

    function _pact(uint256 pactId) internal view returns (Pact storage) {
        if (pactId >= pacts.length) revert UnknownPact(pactId);
        return pacts[pactId];
    }

    function _verdictOptions() private pure returns (string[] memory options) {
        options = new string[](2);
        options[0] = "confirmed";
        options[1] = "denied";
    }

    /// @dev ASCII lower-case, so a "Confirmed"/"DENIED" answer reads the same as the
    ///      lower-case options the agent was constrained to.
    function _toLower(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] >= 0x41 && b[i] <= 0x5A) b[i] = bytes1(uint8(b[i]) + 32);
        }
        return string(b);
    }
}
