// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Vault} from "../src/tsugu/Vault.sol";
import {DemoYieldStrategy} from "../src/tsugu/DemoYieldStrategy.sol";
import {AgentCompute} from "../src/agents/AgentCompute.sol";
import {ResponseStatus} from "../src/agents/lib/SomniaAgents.sol";
import {MockAgentPlatform} from "./helpers/MockAgentPlatform.sol";

contract VaultYieldTest is Test {
    MockAgentPlatform platform;
    Vault vault;
    DemoYieldStrategy strat;

    uint256 constant SUB = 3;
    uint256 constant REWARD = 0.1 ether;
    uint256 internal _floor;

    address creator = address(0xC0FFEE);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address beneficiary = address(0xBEEF);

    function setUp() public {
        platform = new MockAgentPlatform();
        vault = new Vault(address(platform), 0, 0, 0, SUB, REWARD); // owner = this
        strat = new DemoYieldStrategy(address(vault));
        vault.setYieldStrategy(address(strat));
        _floor = platform.FLOOR();
        vm.deal(creator, 100 ether);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(address(this), 100 ether);
    }

    function deposit() internal view returns (uint256) {
        return _floor + REWARD * SUB;
    }

    function _yieldPact(uint8 quorum) internal view returns (Vault.NewPact memory n) {
        n.kind = Vault.PactKind.Medical;
        n.beneficiary = beneficiary;
        n.deadline = uint64(block.timestamp + 30 days);
        n.disputeWindow = 0;
        n.quorum = quorum;
        n.earnYield = true;
        n.claim = "The surgery was completed";
        Vault.NewCheck[] memory checks = new Vault.NewCheck[](1);
        checks[0].claimType = Vault.ClaimType.Web;
        checks[0].source = "https://hospital.example/report";
        n.checks = checks;
    }

    /// simulate yield accrual: top up the strategy reserve, raising the share price.
    function _accrue(uint256 amount) internal {
        strat.fund{value: amount}();
    }

    function test_createYieldPact_revertsWithoutStrategy() public {
        Vault fresh = new Vault(address(platform), 0, 0, 0, SUB, REWARD);
        vm.prank(creator);
        vm.expectRevert(Vault.YieldUnavailable.selector);
        fresh.createPact(_yieldPact(1));
    }

    function test_contribute_depositsToStrategy_notVault() public {
        vm.prank(creator);
        uint256 id = vault.createPact{value: 5 ether}(_yieldPact(1));
        // funds went to the strategy, not the vault; non-yield ring-fence untouched
        assertEq(address(strat).balance, 5 ether);
        assertEq(vault.totalEscrow(), 0);
        assertGt(vault.outstandingShares(), 0);
        assertEq(vault.getPact(id).escrow, 5 ether); // principal tracked
        assertEq(vault.yieldValue(id), 5 ether); // no yield yet
    }

    function test_confirm_release_paysPrincipalPlusYield() public {
        vm.prank(creator);
        uint256 id = vault.createPact{value: 10 ether}(_yieldPact(1));

        _accrue(2 ether); // +20% yield in the reserve
        // ~12 ether (virtual-share offset rounds sub-wei in the vault's favour for solvency)
        assertApproxEqAbs(vault.yieldValue(id), 12 ether, 10);

        vm.prank(bob);
        uint256 rid = vault.requestResolution{value: deposit()}(id, 0);
        platform.fireString(address(vault), rid, "confirmed");
        assertEq(uint8(vault.getPact(id).status), uint8(Vault.PactStatus.Confirmed));

        uint256 b0 = beneficiary.balance;
        vault.release(id);
        assertApproxEqAbs(beneficiary.balance, b0 + 12 ether, 10); // principal + yield
        assertEq(vault.outstandingShares(), 0);
        assertEq(uint8(vault.getPact(id).status), uint8(Vault.PactStatus.Released));
    }

    function test_denied_refund_proRataYield() public {
        Vault.NewPact memory n = _yieldPact(1);
        vm.prank(creator);
        uint256 id = vault.createPact(n);
        vm.prank(alice);
        vault.contribute{value: 3 ether}(id);
        vm.prank(bob);
        vault.contribute{value: 1 ether}(id); // total principal 4 ether, alice 75% / bob 25%

        _accrue(4 ether); // doubles the value: 4 -> 8 ether

        vm.prank(creator);
        uint256 rid = vault.requestResolution{value: deposit()}(id, 0);
        platform.fireString(address(vault), rid, "denied");

        uint256 a0 = alice.balance;
        vm.prank(alice);
        vault.refund(id);
        assertApproxEqAbs(alice.balance, a0 + 6 ether, 2); // 3 principal + 3 yield (75% of 4)

        uint256 b0 = bob.balance;
        vm.prank(bob);
        vault.refund(id);
        assertApproxEqAbs(bob.balance, b0 + 2 ether, 2); // 1 principal + 1 yield (25% of 4)

        assertEq(vault.outstandingShares(), 0);
    }

    function test_nonYieldPact_untouchedByStrategy() public {
        // A normal (non-yield) pact still holds native in the vault.
        Vault.NewPact memory n = _yieldPact(1);
        n.earnYield = false;
        vm.prank(creator);
        uint256 id = vault.createPact{value: 2 ether}(n);
        assertEq(vault.totalEscrow(), 2 ether);
        assertEq(address(strat).balance, 0);
        assertEq(vault.outstandingShares(), 0);
        assertEq(vault.yieldValue(id), 2 ether);
    }

    function test_setYieldStrategy_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(AgentCompute.NotOwner.selector);
        vault.setYieldStrategy(address(strat));
    }

    function test_setYieldStrategy_lockedWhileSharesOutstanding() public {
        vm.prank(creator);
        vault.createPact{value: 1 ether}(_yieldPact(1)); // mints shares
        vm.expectRevert(Vault.YieldStrategyLocked.selector);
        vault.setYieldStrategy(address(0));
    }

    function test_strategy_onlyVaultCanDepositOrRedeem() public {
        vm.prank(alice);
        vm.expectRevert(DemoYieldStrategy.NotVault.selector);
        strat.deposit{value: 1 ether}();
        vm.prank(alice);
        vm.expectRevert(DemoYieldStrategy.NotVault.selector);
        strat.redeem(1, alice);
    }

    // --- regression: the ERC-4626 inflation/donation attack is closed ---------

    function test_inflationDonationLever_closed() public {
        // Attacker opens a 1-wei yield pact (mints shares) — allowed.
        vm.prank(bob);
        vault.createPact{value: 1}(_yieldPact(1));
        // ...but CANNOT inflate the share price: fund() is operator-only,
        vm.prank(bob);
        vm.expectRevert(DemoYieldStrategy.NotOperator.selector);
        strat.fund{value: 3 ether}();
        // ...and there is no open receive(), so a raw donation is rejected.
        vm.prank(bob);
        (bool ok,) = address(strat).call{value: 3 ether}("");
        assertFalse(ok);
        // Therefore a victim's contribution to a different yield pact still mints real
        // shares and keeps its full value — no stranding.
        vm.prank(creator);
        uint256 vid = vault.createPact(_yieldPact(1));
        vm.prank(alice);
        vault.contribute{value: 2 ether}(vid);
        assertGt(vault.contributionShares(vid, alice), 0);
        assertApproxEqAbs(vault.yieldValue(vid), 2 ether, 10);
    }

    // --- regression: refund splits yield by SHARES, not principal fraction -----

    function test_refund_yieldSplitByShares_notPrincipal() public {
        vm.prank(creator);
        uint256 id = vault.createPact(_yieldPact(1));
        vm.prank(alice);
        vault.contribute{value: 10 ether}(id); // at par
        _accrue(10 ether); // price doubles BETWEEN the two contributions
        vm.prank(bob);
        vault.contribute{value: 10 ether}(id); // fewer shares (post-accrual)

        vm.prank(creator);
        uint256 rid = vault.requestResolution{value: deposit()}(id, 0);
        platform.fireString(address(vault), rid, "denied");

        // Alice was present through the accrual -> ~20; Bob arrived after -> ~10.
        // (The buggy principal-fraction split would have paid each 15.)
        uint256 a0 = alice.balance;
        vm.prank(alice);
        vault.refund(id);
        assertApproxEqAbs(alice.balance, a0 + 20 ether, 1e9);

        uint256 b0 = bob.balance;
        vm.prank(bob);
        vault.refund(id);
        assertApproxEqAbs(bob.balance, b0 + 10 ether, 1e9);

        assertEq(vault.outstandingShares(), 0);
    }

    receive() external payable {}
}
