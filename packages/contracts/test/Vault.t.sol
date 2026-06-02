// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Vault} from "../src/tsugu/Vault.sol";
import {AgentCompute} from "../src/agents/AgentCompute.sol";
import {SomniaAgentIds, ResponseStatus, IParseAgent, IJsonApiAgent, ILlmAgent} from
    "../src/agents/lib/SomniaAgents.sol";
import {MockAgentPlatform} from "./helpers/MockAgentPlatform.sol";

contract VaultTest is Test {
    MockAgentPlatform platform;
    Vault vault;

    uint256 constant SUB = 3;
    uint256 constant REWARD = 0.1 ether;

    address creator = address(0xC0FFEE);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address beneficiary = address(0xBEEF);

    // Cached so deposit() makes no external call — calling platform.FLOOR() inside a
    // `{value: deposit()}` expression would consume the preceding vm.prank/expectRevert.
    uint256 internal _floor;

    function setUp() public {
        platform = new MockAgentPlatform();
        vault = new Vault(address(platform), 0, 0, 0, SUB, REWARD); // owner = this test contract
        _floor = platform.FLOOR();
        vm.deal(creator, 100 ether);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(address(this), 100 ether);
    }

    function deposit() internal view returns (uint256) {
        return _floor + REWARD * SUB;
    }

    // --- builders -----------------------------------------------------------

    function _web(string memory url) internal pure returns (Vault.NewCheck memory c) {
        c.claimType = Vault.ClaimType.Web;
        c.source = url;
    }

    function _data(string memory url, string memory jp) internal pure returns (Vault.NewCheck memory c) {
        c.claimType = Vault.ClaimType.Data;
        c.source = url;
        c.jsonPath = jp;
    }

    function _text(string memory t) internal pure returns (Vault.NewCheck memory c) {
        c.claimType = Vault.ClaimType.Text;
        c.source = t;
    }

    function _checks(Vault.NewCheck memory a) internal pure returns (Vault.NewCheck[] memory arr) {
        arr = new Vault.NewCheck[](1);
        arr[0] = a;
    }

    function _checks(Vault.NewCheck memory a, Vault.NewCheck memory b)
        internal
        pure
        returns (Vault.NewCheck[] memory arr)
    {
        arr = new Vault.NewCheck[](2);
        arr[0] = a;
        arr[1] = b;
    }

    function _checks(Vault.NewCheck memory a, Vault.NewCheck memory b, Vault.NewCheck memory c)
        internal
        pure
        returns (Vault.NewCheck[] memory arr)
    {
        arr = new Vault.NewCheck[](3);
        arr[0] = a;
        arr[1] = b;
        arr[2] = c;
    }

    function _pact(Vault.NewCheck[] memory checks, uint8 quorum, uint64 disputeWindow)
        internal
        view
        returns (Vault.NewPact memory n)
    {
        n.kind = Vault.PactKind.Relief;
        n.beneficiary = beneficiary;
        n.deadline = uint64(block.timestamp + 30 days);
        n.disputeWindow = disputeWindow;
        n.quorum = quorum;
        n.claim = "The relief milestone was reached";
        n.checks = checks;
    }

    function _createWeb() internal returns (uint256 id) {
        vm.prank(creator);
        id = vault.createPact(_pact(_checks(_web("https://example.org/relief")), 1, 1 hours));
    }

    function _status(uint256 id) internal view returns (Vault.PactStatus) {
        return vault.getPact(id).status;
    }

    // --- Create -------------------------------------------------------------

    function test_createPact_storesFieldsAndChecks() public {
        vm.prank(creator);
        uint256 id = vault.createPact(
            _pact(_checks(_web("https://a.example"), _data("https://api.example", "data.ok"), _text("a report")), 2, 0)
        );
        assertEq(id, 0);
        assertEq(vault.pactCount(), 1);
        Vault.Pact memory p = vault.getPact(id);
        assertEq(p.creator, creator);
        assertEq(p.beneficiary, beneficiary);
        assertEq(p.quorum, 2);
        assertEq(p.checks.length, 3);
        assertEq(uint8(p.checks[0].claimType), uint8(Vault.ClaimType.Web));
        assertEq(uint8(p.checks[1].claimType), uint8(Vault.ClaimType.Data));
        assertEq(uint8(p.checks[2].claimType), uint8(Vault.ClaimType.Text));
        assertEq(uint8(p.status), uint8(Vault.PactStatus.Open));
    }

    function test_createPact_seedsContribution() public {
        vm.prank(creator);
        uint256 id = vault.createPact{value: 5 ether}(_pact(_checks(_web("https://a.example")), 1, 0));
        assertEq(vault.getPact(id).escrow, 5 ether);
        assertEq(vault.contributionOf(id, creator), 5 ether);
        assertEq(vault.totalEscrow(), 5 ether);
    }

    function test_createPact_revertsBadBeneficiary() public {
        Vault.NewPact memory n = _pact(_checks(_web("u")), 1, 0);
        n.beneficiary = address(0);
        vm.prank(creator);
        vm.expectRevert(Vault.BadBeneficiary.selector);
        vault.createPact(n);
    }

    function test_createPact_revertsBadDeadline() public {
        Vault.NewPact memory n = _pact(_checks(_web("u")), 1, 0);
        n.deadline = uint64(block.timestamp);
        vm.prank(creator);
        vm.expectRevert(Vault.BadDeadline.selector);
        vault.createPact(n);
    }

    function test_createPact_revertsEmptyClaim() public {
        Vault.NewPact memory n = _pact(_checks(_web("u")), 1, 0);
        n.claim = "";
        vm.prank(creator);
        vm.expectRevert(Vault.EmptyClaim.selector);
        vault.createPact(n);
    }

    function test_createPact_revertsNoChecks() public {
        Vault.NewPact memory n = _pact(new Vault.NewCheck[](0), 1, 0);
        vm.prank(creator);
        vm.expectRevert(Vault.NoChecks.selector);
        vault.createPact(n);
    }

    function test_createPact_revertsBadQuorum() public {
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(Vault.BadQuorum.selector, uint8(2), uint256(1)));
        vault.createPact(_pact(_checks(_web("u")), 2, 0));
    }

    function test_createPact_revertsEmptySource() public {
        vm.prank(creator);
        vm.expectRevert(Vault.EmptySource.selector);
        vault.createPact(_pact(_checks(_web("")), 1, 0));
    }

    function test_createPact_dataRequiresJsonPath() public {
        vm.prank(creator);
        vm.expectRevert(Vault.EmptyJsonPath.selector);
        vault.createPact(_pact(_checks(_data("https://api.example", "")), 1, 0));
    }

    // --- Contribute ---------------------------------------------------------

    function test_contribute_incrementsEscrowAndLedger() public {
        uint256 id = _createWeb();
        vm.prank(alice);
        vault.contribute{value: 2 ether}(id);
        vm.prank(bob);
        vault.contribute{value: 3 ether}(id);
        assertEq(vault.getPact(id).escrow, 5 ether);
        assertEq(vault.contributionOf(id, alice), 2 ether);
        assertEq(vault.contributionOf(id, bob), 3 ether);
        assertEq(vault.totalEscrow(), 5 ether);
    }

    function test_contribute_revertsZeroValue() public {
        uint256 id = _createWeb();
        vm.prank(alice);
        vm.expectRevert(Vault.NothingContributed.selector);
        vault.contribute{value: 0}(id);
    }

    function test_contribute_revertsAfterDeadline() public {
        uint256 id = _createWeb();
        vm.warp(block.timestamp + 31 days);
        vm.prank(alice);
        vm.expectRevert(Vault.DeadlinePassed.selector);
        vault.contribute{value: 1 ether}(id);
    }

    function test_contribute_revertsUnknownPact() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Vault.UnknownPact.selector, uint256(99)));
        vault.contribute{value: 1 ether}(99);
    }

    // --- Resolve routing (all three agents) ---------------------------------

    function test_resolution_web_routesToParseAgent() public {
        uint256 id = _createWeb();
        vm.prank(bob);
        uint256 rid = vault.requestResolution{value: deposit()}(id, 0);
        assertEq(platform.lastAgentId(), SomniaAgentIds.PARSE_WEBSITE);
        assertEq(uint8(_status(id)), uint8(Vault.PactStatus.Resolving));
        assertEq(vault.requestToPact(rid), id);
        assertEq(vault.requestToCheck(rid), 0);
        assertEq(_selector(platform.lastPayload()), IParseAgent.ExtractString.selector);
    }

    function test_resolution_data_routesToJsonAgent() public {
        vm.prank(creator);
        uint256 id = vault.createPact(_pact(_checks(_data("https://api.example", "data.ok")), 1, 0));
        vm.prank(bob);
        vault.requestResolution{value: deposit()}(id, 0);
        assertEq(platform.lastAgentId(), SomniaAgentIds.JSON_API);
        assertEq(_selector(platform.lastPayload()), IJsonApiAgent.fetchBool.selector);
    }

    function test_resolution_text_routesToLlmAgent() public {
        vm.prank(creator);
        uint256 id = vault.createPact(_pact(_checks(_text("the hospital report confirms the surgery")), 1, 0));
        vm.prank(bob);
        vault.requestResolution{value: deposit()}(id, 0);
        assertEq(platform.lastAgentId(), SomniaAgentIds.LLM_INFERENCE);
        assertEq(_selector(platform.lastPayload()), ILlmAgent.inferString.selector);
    }

    function test_resolution_revertsFeeTooLow() public {
        uint256 id = _createWeb();
        uint256 dep = deposit();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Vault.ResolutionFeeTooLow.selector, dep - 1, dep));
        vault.requestResolution{value: dep - 1}(id, 0);
    }

    function test_resolution_overpaymentRefunded() public {
        uint256 id = _createWeb();
        uint256 before = bob.balance;
        vm.prank(bob);
        vault.requestResolution{value: deposit() + 1 ether}(id, 0);
        assertEq(bob.balance, before - deposit());
    }

    function test_resolution_revertsCheckAlreadyRequested() public {
        uint256 id = _createWeb();
        vm.prank(bob);
        vault.requestResolution{value: deposit()}(id, 0);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Vault.CheckNotResolvable.selector, Vault.CheckStatus.Requested));
        vault.requestResolution{value: deposit()}(id, 0);
    }

    function test_resolution_revertsUnknownCheck() public {
        uint256 id = _createWeb();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Vault.UnknownCheck.selector, id, uint256(5)));
        vault.requestResolution{value: deposit()}(id, 5);
    }

    // --- Single-check quorum (the simple case) ------------------------------

    function test_singleCheck_confirm_thenRelease() public {
        uint256 id = _createWeb();
        vm.prank(alice);
        vault.contribute{value: 4 ether}(id);
        vm.prank(creator);
        uint256 rid = vault.requestResolution{value: deposit()}(id, 0);

        platform.fireString(address(vault), rid, "confirmed");
        assertEq(uint8(_status(id)), uint8(Vault.PactStatus.Confirmed));

        vm.expectRevert(abi.encodeWithSelector(Vault.DisputeWindowActive.selector, vault.releasableAt(id)));
        vault.release(id);

        vm.warp(block.timestamp + 1 hours + 1);
        uint256 b0 = beneficiary.balance;
        vault.release(id);
        assertEq(beneficiary.balance, b0 + 4 ether);
        assertEq(uint8(_status(id)), uint8(Vault.PactStatus.Released));
        assertEq(vault.totalEscrow(), 0);
    }

    function test_caseInsensitiveVerdict() public {
        uint256 id = _createWeb();
        vm.prank(creator);
        uint256 rid = vault.requestResolution{value: deposit()}(id, 0);
        platform.fireString(address(vault), rid, "CONFIRMED");
        assertEq(uint8(_status(id)), uint8(Vault.PactStatus.Confirmed));
    }

    // --- Multi-source quorum (M-of-N) ---------------------------------------

    function test_quorum2of3_confirmsOnSecondConfirm() public {
        vm.prank(creator);
        uint256 id = vault.createPact{value: 9 ether}(
            _pact(_checks(_web("https://news.example"), _text("a field report"), _data("https://api.example", "ok")), 2, 0)
        );

        // first confirm — still resolving (quorum not reached)
        vm.prank(bob);
        uint256 r0 = vault.requestResolution{value: deposit()}(id, 0);
        platform.fireString(address(vault), r0, "confirmed");
        assertEq(uint8(_status(id)), uint8(Vault.PactStatus.Open)); // no check in flight now

        // second confirm via the LLM (text) check — quorum reached
        vm.prank(bob);
        uint256 r1 = vault.requestResolution{value: deposit()}(id, 1);
        platform.fireString(address(vault), r1, "confirmed");
        assertEq(uint8(_status(id)), uint8(Vault.PactStatus.Confirmed));

        (uint256 confirmed,, uint256 total, uint8 q) = vault.tally(id);
        assertEq(confirmed, 2);
        assertEq(total, 3);
        assertEq(q, 2);

        uint256 b0 = beneficiary.balance;
        vault.release(id); // disputeWindow 0
        assertEq(beneficiary.balance, b0 + 9 ether);
    }

    function test_quorum2of3_mixedVerdictsStillConfirms() public {
        vm.prank(creator);
        uint256 id = vault.createPact{value: 1 ether}(
            _pact(_checks(_web("a"), _text("b"), _data("c", "ok")), 2, 0)
        );
        vm.prank(bob);
        uint256 r0 = vault.requestResolution{value: deposit()}(id, 0);
        platform.fireString(address(vault), r0, "confirmed");
        vm.prank(bob);
        uint256 r1 = vault.requestResolution{value: deposit()}(id, 1);
        platform.fireString(address(vault), r1, "denied"); // one source disagrees
        vm.prank(bob);
        uint256 r2 = vault.requestResolution{value: deposit()}(id, 2);
        platform.fireBool(address(vault), r2, true); // DATA confirms → quorum 2 reached
        assertEq(uint8(_status(id)), uint8(Vault.PactStatus.Confirmed));
    }

    function test_quorum2of3_deniesWhenUnreachable() public {
        vm.prank(creator);
        uint256 id = vault.createPact{value: 2 ether}(
            _pact(_checks(_web("a"), _text("b"), _data("c", "ok")), 2, 0)
        );
        vm.prank(bob);
        uint256 r0 = vault.requestResolution{value: deposit()}(id, 0);
        platform.fireString(address(vault), r0, "denied");
        assertEq(uint8(_status(id)), uint8(Vault.PactStatus.Open));
        vm.prank(bob);
        uint256 r1 = vault.requestResolution{value: deposit()}(id, 1);
        platform.fireString(address(vault), r1, "denied"); // 2 denied, only 1 left → can't reach 2
        assertEq(uint8(_status(id)), uint8(Vault.PactStatus.Denied));

        // contributor refunds
        uint256 c0 = creator.balance;
        vm.prank(creator);
        vault.refund(id);
        assertEq(creator.balance, c0 + 2 ether);
        assertEq(vault.totalEscrow(), 0);
    }

    function test_data_true_confirms_false_denies() public {
        vm.prank(creator);
        uint256 id = vault.createPact{value: 1 ether}(_pact(_checks(_data("https://api.example", "ok")), 1, 0));
        vm.prank(bob);
        uint256 rid = vault.requestResolution{value: deposit()}(id, 0);
        platform.fireBool(address(vault), rid, true);
        assertEq(uint8(_status(id)), uint8(Vault.PactStatus.Confirmed));

        vm.prank(creator);
        uint256 id2 = vault.createPact{value: 1 ether}(_pact(_checks(_data("https://api.example", "ok")), 1, 0));
        vm.prank(bob);
        uint256 rid2 = vault.requestResolution{value: deposit()}(id2, 0);
        platform.fireBool(address(vault), rid2, false);
        assertEq(uint8(_status(id2)), uint8(Vault.PactStatus.Denied));
    }

    // --- Inconclusive / failure retry ---------------------------------------

    function test_inconclusive_checkRetryable() public {
        uint256 id = _createWeb();
        vm.prank(creator);
        uint256 rid = vault.requestResolution{value: deposit()}(id, 0);
        platform.fireString(address(vault), rid, "maybe");
        assertEq(uint8(vault.getPact(id).checks[0].status), uint8(Vault.CheckStatus.Inconclusive));
        assertEq(uint8(_status(id)), uint8(Vault.PactStatus.Open));
        // retry the same check
        vm.prank(creator);
        vault.requestResolution{value: deposit()}(id, 0);
        assertEq(uint8(vault.getPact(id).checks[0].status), uint8(Vault.CheckStatus.Requested));
    }

    function test_failedRequest_checkBackToPending() public {
        uint256 id = _createWeb();
        vm.prank(creator);
        uint256 rid = vault.requestResolution{value: deposit()}(id, 0);
        platform.fireFailure(address(vault), rid, ResponseStatus.TimedOut);
        assertEq(uint8(vault.getPact(id).checks[0].status), uint8(Vault.CheckStatus.Pending));
        assertEq(uint8(_status(id)), uint8(Vault.PactStatus.Open));
    }

    // --- Release / refund guards --------------------------------------------

    function test_release_revertsIfNotConfirmed() public {
        uint256 id = _createWeb();
        vm.expectRevert(abi.encodeWithSelector(Vault.NotConfirmed.selector, Vault.PactStatus.Open));
        vault.release(id);
    }

    function test_refund_revertsWhenNotRefundable() public {
        uint256 id = _createWeb();
        vm.prank(alice);
        vault.contribute{value: 1 ether}(id);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Vault.NotRefundable.selector, Vault.PactStatus.Open));
        vault.refund(id);
    }

    function test_refund_splitsByContributor_noDouble() public {
        vm.prank(creator);
        uint256 id = vault.createPact(_pact(_checks(_web("a")), 1, 0));
        vm.prank(alice);
        vault.contribute{value: 2 ether}(id);
        vm.prank(bob);
        vault.contribute{value: 3 ether}(id);
        vm.prank(creator);
        uint256 rid = vault.requestResolution{value: deposit()}(id, 0);
        platform.fireString(address(vault), rid, "denied");
        assertEq(uint8(_status(id)), uint8(Vault.PactStatus.Denied));

        uint256 a0 = alice.balance;
        vm.prank(alice);
        vault.refund(id);
        assertEq(alice.balance, a0 + 2 ether);
        vm.prank(alice);
        vm.expectRevert(Vault.NothingToRefund.selector);
        vault.refund(id);

        vm.prank(bob);
        vault.refund(id);
        assertEq(vault.totalEscrow(), 0);
    }

    function test_lateCallback_afterExpiry_cannotConfirm() public {
        // 2-of-2 pact; both checks dispatched (in flight) before the deadline.
        vm.prank(creator);
        uint256 id = vault.createPact{value: 2 ether}(_pact(_checks(_web("a"), _text("b")), 2, 0));
        vm.prank(bob);
        uint256 r0 = vault.requestResolution{value: deposit()}(id, 0);
        vm.prank(bob);
        uint256 r1 = vault.requestResolution{value: deposit()}(id, 1);

        // deadline passes with both still in flight → anyone expires it
        vm.warp(block.timestamp + 31 days);
        vault.markExpired(id);
        assertEq(uint8(_status(id)), uint8(Vault.PactStatus.Expired));

        // the consensus callbacks land LATE — they must not resurrect the pact
        platform.fireString(address(vault), r0, "confirmed");
        platform.fireString(address(vault), r1, "confirmed");
        assertEq(uint8(_status(id)), uint8(Vault.PactStatus.Expired));

        // refund still works; release is impossible
        vm.expectRevert(abi.encodeWithSelector(Vault.NotConfirmed.selector, Vault.PactStatus.Expired));
        vault.release(id);
        uint256 c0 = creator.balance;
        vm.prank(creator);
        vault.refund(id);
        assertEq(creator.balance, c0 + 2 ether);
    }

    function test_markExpired_thenRefund() public {
        uint256 id = _createWeb();
        vm.prank(alice);
        vault.contribute{value: 2 ether}(id);
        vm.expectRevert(Vault.NotExpirable.selector);
        vault.markExpired(id);
        vm.warp(block.timestamp + 31 days);
        vault.markExpired(id);
        assertEq(uint8(_status(id)), uint8(Vault.PactStatus.Expired));
        uint256 a0 = alice.balance;
        vm.prank(alice);
        vault.refund(id);
        assertEq(alice.balance, a0 + 2 ether);
    }

    // --- Consensus receipt --------------------------------------------------

    function test_consensusReceipt_recorded() public {
        uint256 id = _createWeb();
        vm.prank(creator);
        uint256 rid = vault.requestResolution{value: deposit()}(id, 0);
        uint256[] memory costs = new uint256[](3);
        costs[0] = 3e16;
        costs[1] = 1e16;
        costs[2] = 2e16;
        platform.fireStringConsensus(address(vault), rid, "confirmed", costs, 42);
        (uint64 validators,, uint256 receiptId, uint256 medianCost) = vault.receipts(rid);
        assertEq(validators, 3);
        assertEq(receiptId, 42);
        assertEq(medianCost, 2e16);
        assertEq(uint8(_status(id)), uint8(Vault.PactStatus.Confirmed));
    }

    // --- Escrow ring-fence ---------------------------------------------------

    function test_owner_cannotWithdrawEscrow() public {
        uint256 id = _createWeb();
        vm.prank(alice);
        vault.contribute{value: 6 ether}(id);
        (bool ok,) = address(vault).call{value: 1 ether}(""); // simulate a rebate
        assertTrue(ok);
        assertEq(vault.totalEscrow(), 6 ether);
        assertEq(vault.freeBalance(), 1 ether);

        address sink = address(0x5151);
        vm.expectRevert(abi.encodeWithSelector(Vault.EscrowLocked.selector, uint256(1 ether + 1), uint256(1 ether)));
        vault.withdraw(payable(sink), 1 ether + 1);

        vault.withdraw(payable(sink), 1 ether);
        assertEq(sink.balance, 1 ether);
        vault.withdrawAll(payable(sink));
        assertEq(sink.balance, 1 ether); // nothing more to sweep
        assertEq(address(vault).balance, 6 ether);
        assertEq(vault.totalEscrow(), 6 ether);
    }

    function test_withdraw_revertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(AgentCompute.NotOwner.selector);
        vault.withdraw(payable(alice), 0);
    }

    // --- Reentrancy ---------------------------------------------------------

    function test_refund_reentrancyBlocked() public {
        Reentrant attacker = new Reentrant(vault);
        vm.deal(address(attacker), 10 ether);
        uint256 id = _createWeb();
        attacker.contribute{value: 3 ether}(id);
        vm.prank(creator);
        uint256 rid = vault.requestResolution{value: deposit()}(id, 0);
        platform.fireString(address(vault), rid, "denied");

        attacker.arm(id);
        uint256 before = address(attacker).balance;
        attacker.triggerRefund(id); // re-enters refund on receive(); guard blocks the inner call
        assertEq(address(attacker).balance, before + 3 ether); // refunded exactly once
        assertEq(vault.totalEscrow(), 0);
    }

    function test_createPact_revertsBadDisputeWindow() public {
        Vault.NewPact memory n = _pact(_checks(_web("a")), 1, uint64(31 days)); // > MAX_DISPUTE_WINDOW
        vm.prank(creator);
        vm.expectRevert(Vault.BadDisputeWindow.selector);
        vault.createPact(n);
    }

    // --- regression: a reverting beneficiary cannot brick a Confirmed pact ----

    function test_release_revertingBeneficiary_heldClaimable_thenClaimed() public {
        RejectEther rej = new RejectEther();
        Vault.NewPact memory n = _pact(_checks(_web("a")), 1, 0);
        n.beneficiary = address(rej);
        vm.prank(creator);
        uint256 id = vault.createPact(n);
        vm.prank(alice);
        vault.contribute{value: 4 ether}(id);
        vm.prank(creator);
        uint256 rid = vault.requestResolution{value: deposit()}(id, 0);
        platform.fireString(address(vault), rid, "confirmed");

        // Beneficiary rejects the push — release must NOT revert; funds are held claimable.
        vault.release(id);
        assertEq(uint8(_status(id)), uint8(Vault.PactStatus.Released));
        assertEq(vault.claimable(address(rej)), 4 ether);
        assertEq(vault.totalPending(), 4 ether);
        assertEq(address(vault).balance, 4 ether); // still here, ring-fenced
        assertEq(vault.freeBalance(), 0); // owner can't sweep pending payouts

        // Once the beneficiary can receive, it pulls the funds.
        rej.setAccept(true);
        rej.claimFrom(vault);
        assertEq(address(rej).balance, 4 ether);
        assertEq(vault.totalPending(), 0);
    }

    function test_requiredDeposit() public view {
        assertEq(vault.requiredDeposit(), platform.FLOOR() + REWARD * SUB);
    }

    // --- helpers ------------------------------------------------------------

    function _selector(bytes memory payload) internal pure returns (bytes4 sel) {
        assembly {
            sel := mload(add(payload, 0x20))
        }
    }

    receive() external payable {}
}

/// @dev Contributor that tries to re-enter {refund} from its receive() hook.
contract Reentrant {
    Vault public immutable vault;
    uint256 public armedPact;
    bool public armed;

    constructor(Vault v) {
        vault = v;
    }

    function contribute(uint256 pactId) external payable {
        vault.contribute{value: msg.value}(pactId);
    }

    function arm(uint256 pactId) external {
        armedPact = pactId;
        armed = true;
    }

    function triggerRefund(uint256 pactId) external {
        vault.refund(pactId);
    }

    receive() external payable {
        if (armed) {
            armed = false;
            try vault.refund(armedPact) {} catch {}
        }
    }
}

/// @dev Beneficiary that rejects ETH until toggled — to exercise the release pull-fallback.
contract RejectEther {
    bool public accept;

    function setAccept(bool a) external {
        accept = a;
    }

    function claimFrom(Vault v) external {
        v.claim();
    }

    receive() external payable {
        require(accept, "reject");
    }
}
