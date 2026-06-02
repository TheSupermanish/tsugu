// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {AgentNFT} from "../src/identity/AgentNFT.sol";
import {AgentRegistry} from "../src/identity/AgentRegistry.sol";
import {AgentAccount} from "../src/accounts/AgentAccount.sol";
import {ERC6551Registry} from "../src/accounts/ERC6551Registry.sol";
import {CapabilityRegistry} from "../src/coordination/CapabilityRegistry.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

contract CapabilityRegistryTest is Test {
    AgentNFT internal nft;
    ERC6551Registry internal accounts;
    AgentAccount internal accountImpl;
    AgentRegistry internal registry;
    CapabilityRegistry internal caps;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    bytes32 internal constant LLM = keccak256("llm.summarize");
    bytes32 internal constant ORACLE = keccak256("oracle.price");
    bytes32 internal constant TRANSLATE = keccak256("text.translate");

    uint256 internal aliceId;
    uint256 internal bobId;

    event CapabilityAdded(uint256 indexed tokenId, bytes32 indexed tag);
    event CapabilityRemoved(uint256 indexed tokenId, bytes32 indexed tag);

    function setUp() public {
        nft = new AgentNFT(address(this));
        accounts = new ERC6551Registry();
        accountImpl = new AgentAccount();
        registry = new AgentRegistry(nft, accounts, address(accountImpl));
        nft.setMinter(address(registry));
        caps = new CapabilityRegistry(nft);

        (aliceId,) = registry.register("alice-agent", alice);
        (bobId,) = registry.register("bob-agent", bob);
    }

    function test_advertise_setsCapabilitiesAndListing() public {
        bytes32[] memory tags = new bytes32[](2);
        tags[0] = LLM;
        tags[1] = ORACLE;

        vm.prank(alice);
        caps.advertise(aliceId, tags, "https://alice.example/agent.json", 0.01 ether);

        assertTrue(caps.hasCapability(aliceId, LLM));
        assertTrue(caps.hasCapability(aliceId, ORACLE));
        assertFalse(caps.hasCapability(aliceId, TRANSLATE));
        assertEq(caps.capabilitiesOf(aliceId).length, 2);

        (string memory uri, uint256 price, bool listed) = caps.listings(aliceId);
        assertEq(uri, "https://alice.example/agent.json");
        assertEq(price, 0.01 ether);
        assertTrue(listed);

        uint256[] memory llmProviders = caps.providers(LLM);
        assertEq(llmProviders.length, 1);
        assertEq(llmProviders[0], aliceId);
    }

    function test_advertise_onlyAgentOwner() public {
        bytes32[] memory tags = new bytes32[](1);
        tags[0] = LLM;
        vm.prank(bob); // bob doesn't own alice's agent
        vm.expectRevert(abi.encodeWithSelector(CapabilityRegistry.NotAgentOwner.selector, aliceId, bob));
        caps.advertise(aliceId, tags, "x", 0);
    }

    function test_addCapability_isIdempotent() public {
        vm.startPrank(alice);
        caps.addCapability(aliceId, LLM);
        caps.addCapability(aliceId, LLM); // again — no duplicate
        vm.stopPrank();
        assertEq(caps.capabilitiesOf(aliceId).length, 1);
        assertEq(caps.providerCount(LLM), 1);
    }

    function test_discovery_multipleProvidersPerTag() public {
        vm.prank(alice);
        caps.addCapability(aliceId, LLM);
        vm.prank(bob);
        caps.addCapability(bobId, LLM);

        uint256[] memory provs = caps.providers(LLM);
        assertEq(provs.length, 2);
        // order-independent membership
        assertTrue((provs[0] == aliceId && provs[1] == bobId) || (provs[0] == bobId && provs[1] == aliceId));
    }

    function test_removeCapability_updatesBothSets() public {
        vm.startPrank(alice);
        caps.addCapability(aliceId, LLM);
        caps.addCapability(aliceId, ORACLE);
        caps.addCapability(aliceId, TRANSLATE);
        // remove the middle one — exercises swap-and-pop
        caps.removeCapability(aliceId, ORACLE);
        vm.stopPrank();

        assertFalse(caps.hasCapability(aliceId, ORACLE));
        assertTrue(caps.hasCapability(aliceId, LLM));
        assertTrue(caps.hasCapability(aliceId, TRANSLATE));
        assertEq(caps.capabilitiesOf(aliceId).length, 2);
        assertEq(caps.providerCount(ORACLE), 0);
        assertEq(caps.providerCount(LLM), 1);
        assertEq(caps.providerCount(TRANSLATE), 1);
    }

    function test_removeCapability_oneProviderDoesNotAffectOthers() public {
        vm.prank(alice);
        caps.addCapability(aliceId, LLM);
        vm.prank(bob);
        caps.addCapability(bobId, LLM);

        vm.prank(alice);
        caps.removeCapability(aliceId, LLM);

        assertFalse(caps.hasCapability(aliceId, LLM));
        assertTrue(caps.hasCapability(bobId, LLM));
        uint256[] memory provs = caps.providers(LLM);
        assertEq(provs.length, 1);
        assertEq(provs[0], bobId);
    }

    function test_listingFollowsOwnershipAfterTransfer() public {
        vm.prank(alice);
        caps.addCapability(aliceId, LLM);

        // alice transfers the agent to bob
        vm.prank(alice);
        IERC721(address(nft)).transferFrom(alice, bob, aliceId);

        // alice can no longer edit; bob can
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CapabilityRegistry.NotAgentOwner.selector, aliceId, alice));
        caps.addCapability(aliceId, ORACLE);

        vm.prank(bob);
        caps.addCapability(aliceId, ORACLE);
        assertTrue(caps.hasCapability(aliceId, ORACLE));
    }

    function test_advertise_revertsForNonexistentToken() public {
        bytes32[] memory tags = new bytes32[](1);
        tags[0] = LLM;
        vm.prank(alice);
        vm.expectRevert(); // ownerOf(999) reverts
        caps.advertise(999, tags, "x", 0);
    }

    /// Fuzz: add then remove an arbitrary subset of distinct tags; the set stays
    /// consistent (no phantom membership, length tracks adds−removes).
    function testFuzz_addRemove_consistency(uint8 addMask, uint8 removeMask) public {
        bytes32[8] memory pool;
        for (uint256 i = 0; i < 8; i++) {
            pool[i] = keccak256(abi.encode("cap", i));
        }

        vm.startPrank(alice);
        uint256 expected;
        for (uint256 i = 0; i < 8; i++) {
            if (addMask & (uint8(1) << uint8(i)) != 0) {
                caps.addCapability(aliceId, pool[i]);
                expected++;
            }
        }
        for (uint256 i = 0; i < 8; i++) {
            bool added = addMask & (uint8(1) << uint8(i)) != 0;
            if (added && (removeMask & (uint8(1) << uint8(i)) != 0)) {
                caps.removeCapability(aliceId, pool[i]);
                expected--;
            }
        }
        vm.stopPrank();

        assertEq(caps.capabilitiesOf(aliceId).length, expected, "length tracks net adds");
        for (uint256 i = 0; i < 8; i++) {
            bool added = addMask & (uint8(1) << uint8(i)) != 0;
            bool removed = removeMask & (uint8(1) << uint8(i)) != 0;
            bool present = added && !removed;
            assertEq(caps.hasCapability(aliceId, pool[i]), present, "membership matches");
            assertEq(caps.providerCount(pool[i]), present ? 1 : 0, "provider count matches");
        }
    }
}
