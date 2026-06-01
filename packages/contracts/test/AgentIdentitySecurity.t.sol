// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {AgentNFT} from "../src/identity/AgentNFT.sol";
import {AgentRegistry} from "../src/identity/AgentRegistry.sol";
import {AgentAccount} from "../src/accounts/AgentAccount.sol";
import {ERC6551Registry} from "../src/accounts/ERC6551Registry.sol";

/// @dev Malicious NFT recipient that tries to re-enter register() with the SAME
///      name during the _safeMint -> onERC721Received callback. `swallow` toggles
///      whether it suppresses the inner revert (a guard-aware attacker) or lets it
///      bubble up and abort the whole mint.
contract ReentrantOwner is IERC721Receiver {
    AgentRegistry public immutable registry;
    string public targetName;
    bool public swallow;
    bool public reentered;
    bool public innerReverted;

    constructor(AgentRegistry registry_) {
        registry = registry_;
    }

    function arm(string calldata name, bool swallow_) external {
        targetName = name;
        swallow = swallow_;
        reentered = false;
        innerReverted = false;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (!reentered) {
            reentered = true;
            if (swallow) {
                // Guard-aware attacker: catch the inner revert and still accept the token.
                try registry.register(targetName, address(this)) {
                // would be the bug: a second agent for the same name
                }
                catch {
                    innerReverted = true;
                }
            } else {
                // Let the inner revert bubble — should abort the outer mint entirely.
                registry.register(targetName, address(this));
            }
        }
        return IERC721Receiver.onERC721Received.selector;
    }
}

/// @dev A target that re-enters AgentAccount.execute() when called. Used to prove
///      the owner-gating holds under reentrancy (the account calling out, then the
///      callee calling back, is msg.sender = this target, not the owner).
contract ReentrantExecTarget {
    AgentAccount public immutable account;

    constructor(AgentAccount account_) {
        account = account_;
    }

    // solhint-disable-next-line no-complex-fallback
    fallback() external payable {
        // msg.sender here is the AgentAccount; we are NOT the NFT owner, so this
        // must revert NotAuthorized.
        account.execute(address(0xDEAD), 0, "", 0);
    }

    receive() external payable {
        account.execute(address(0xDEAD), 0, "", 0);
    }
}

/// @dev A contract that always reverts with a known reason, to assert execute()
///      bubbles the callee's revert.
contract Reverter {
    error Boom(string why);

    fallback() external payable {
        revert Boom("nope");
    }
}

contract AgentIdentitySecurityTest is Test {
    AgentNFT internal nft;
    ERC6551Registry internal accounts;
    AgentAccount internal accountImpl;
    AgentRegistry internal registry;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        nft = new AgentNFT(address(this));
        accounts = new ERC6551Registry();
        accountImpl = new AgentAccount();
        registry = new AgentRegistry(nft, accounts, address(accountImpl));
        nft.setMinter(address(registry));
    }

    // ---------------------------------------------------------------------
    // HIGH: register() reentrancy via _safeMint must NOT double-claim a name
    // ---------------------------------------------------------------------

    /// A non-swallowing attacker lets the guard's revert bubble up through
    /// onERC721Received -> _safeMint -> the outer register(), aborting it whole.
    function test_register_reentrancy_nonSwallowingRevertsWholeTx() public {
        ReentrantOwner attacker = new ReentrantOwner(registry);
        attacker.arm("neo", false);

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        registry.register("neo", address(attacker));

        // Nothing was minted; the name is still free.
        assertEq(nft.totalMinted(), 0, "no token minted on reverted register");
        assertTrue(registry.isAvailable("neo"), "name still available");
    }

    /// A guard-aware attacker swallows the inner revert and accepts the token.
    /// The outer register succeeds, but the re-entry produced NOTHING — exactly
    /// one agent exists for the name. This is the core invariant the fix protects.
    function test_register_reentrancy_swallowingYieldsExactlyOneAgent() public {
        ReentrantOwner attacker = new ReentrantOwner(registry);
        attacker.arm("neo", true);

        (uint256 tokenId, address account) = registry.register("neo", address(attacker));

        assertTrue(attacker.reentered(), "re-entry was attempted");
        assertTrue(attacker.innerReverted(), "the re-entrant register() reverted");
        assertEq(nft.totalMinted(), 1, "exactly one agent minted for the name");
        assertEq(tokenId, 1, "single token id");
        assertEq(nft.ownerOf(1), address(attacker), "attacker owns the one token");

        // resolve points at the one-and-only agent.
        (uint256 rTokenId, address rAccount,,) = registry.resolve("neo");
        assertEq(rTokenId, tokenId, "resolve -> the one token");
        assertEq(rAccount, account, "resolve -> the one wallet");
        assertFalse(registry.isAvailable("neo"), "name is taken exactly once");
    }

    // ---------------------------------------------------------------------
    // ERC-6551: createAccount is permissionless, but binding + control are sound
    // ---------------------------------------------------------------------

    /// Anyone may deploy the counterfactual TBA for any token (permissionless by
    /// design). Doing so must NOT grant the deployer any control: the account
    /// still binds to the right token, and only the NFT owner can execute.
    function test_erc6551_permissionlessCreateAccountStaysBoundAndGated() public {
        (uint256 tokenId, address account) = registry.register("neo", alice);

        // A stranger force-deploys the same account (idempotent CREATE2).
        vm.prank(bob);
        address redeployed =
            accounts.createAccount(address(accountImpl), bytes32(0), block.chainid, address(nft), tokenId);
        assertEq(redeployed, account, "permissionless createAccount is idempotent");

        // Binding is intact and owner is still the NFT owner.
        (uint256 chainId, address tokenContract, uint256 boundId) = AgentAccount(payable(account)).token();
        assertEq(chainId, block.chainid);
        assertEq(tokenContract, address(nft));
        assertEq(boundId, tokenId);
        assertEq(AgentAccount(payable(account)).owner(), alice, "owner unchanged by stranger deploy");

        // The stranger who deployed it cannot operate it.
        vm.deal(account, 1 ether);
        vm.prank(bob);
        vm.expectRevert(AgentAccount.NotAuthorized.selector);
        AgentAccount(payable(account)).execute(bob, 1, "", 0);
    }

    // ---------------------------------------------------------------------
    // AgentAccount.execute: gating holds under reentrancy; reverts bubble
    // ---------------------------------------------------------------------

    /// When the agent executes a call into a contract that calls execute() back,
    /// the re-entrant caller is the target (not the owner) — so it must revert
    /// NotAuthorized. Owner-gating, not a reentrancy guard, is what protects here.
    function test_wallet_execute_reentrantCalleeIsNotAuthorized() public {
        (, address account) = registry.register("neo", alice);
        AgentAccount acct = AgentAccount(payable(account));
        vm.deal(account, 1 ether);

        ReentrantExecTarget target = new ReentrantExecTarget(acct);

        // Owner triggers execute -> target.receive() -> target calls execute again
        // as msg.sender=account (not owner) -> inner reverts NotAuthorized -> the
        // outer execute bubbles it.
        vm.prank(alice);
        vm.expectRevert(AgentAccount.NotAuthorized.selector);
        acct.execute(address(target), 0.1 ether, "", 0);
    }

    /// execute() must surface the callee's revert reason, not swallow it.
    function test_wallet_execute_bubblesCalleeRevert() public {
        (, address account) = registry.register("neo", alice);
        AgentAccount acct = AgentAccount(payable(account));
        Reverter reverter = new Reverter();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Reverter.Boom.selector, "nope"));
        acct.execute(address(reverter), 0, hex"deadbeef", 0);
    }

    /// The NFT owner can drive the agent wallet to move its own STT.
    function test_wallet_execute_ownerMovesAgentFunds() public {
        (, address account) = registry.register("neo", alice);
        AgentAccount acct = AgentAccount(payable(account));
        vm.deal(account, 1 ether);

        uint256 before = bob.balance;
        vm.prank(alice);
        acct.execute(bob, 0.4 ether, "", 0);
        assertEq(bob.balance - before, 0.4 ether, "agent sent its own funds");
        assertEq(account.balance, 0.6 ether, "remainder stays in the wallet");
    }

    // ---------------------------------------------------------------------
    // Minting stays gated
    // ---------------------------------------------------------------------

    function test_nft_cannotMintDirectlyEvenAfterRegistryWired() public {
        vm.prank(bob);
        vm.expectRevert(AgentNFT.OnlyMinter.selector);
        nft.mint(bob, "ghost");
    }

    receive() external payable {}
}
