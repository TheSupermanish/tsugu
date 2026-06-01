// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {AgentNFT} from "../src/identity/AgentNFT.sol";
import {AgentRegistry} from "../src/identity/AgentRegistry.sol";
import {AgentAccount} from "../src/accounts/AgentAccount.sol";
import {ERC6551Registry} from "../src/accounts/ERC6551Registry.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @dev Drives the registry under invariant fuzzing: registers agents with valid,
///      unique names and transfers them between EOA actors. The invariant suite
///      asserts the tsugu guarantees hold after every action sequence.
contract RegistryHandler is Test {
    AgentRegistry internal registry;
    AgentNFT internal nft;
    address[] internal actors;

    uint256 public created;
    uint256[] public tokenIds;
    mapping(uint256 => address) public accountOf;
    mapping(uint256 => string) public nameOf;

    constructor(AgentRegistry registry_, AgentNFT nft_, address[] memory actors_) {
        registry = registry_;
        nft = nft_;
        actors = actors_;
    }

    function tokenCount() external view returns (uint256) {
        return tokenIds.length;
    }

    /// "a" + base-10 digits of n → always within {a, 0-9}, valid and unique per n.
    function _name(uint256 n) internal pure returns (string memory) {
        if (n == 0) return "a0";
        bytes memory digits;
        uint256 x = n;
        while (x > 0) {
            digits = abi.encodePacked(bytes1(uint8(48 + (x % 10))), digits);
            x /= 10;
        }
        return string(abi.encodePacked("a", digits));
    }

    function registerAgent(uint256 ownerSeed, uint256 seedStt) external {
        address owner = actors[ownerSeed % actors.length];
        seedStt = bound(seedStt, 0, 1 ether);
        vm.deal(address(this), address(this).balance + seedStt);
        string memory name = _name(created);
        (uint256 tokenId, address account) = registry.register{value: seedStt}(name, owner);
        tokenIds.push(tokenId);
        accountOf[tokenId] = account;
        nameOf[tokenId] = name;
        created++;
    }

    function transferAgent(uint256 idxSeed, uint256 toSeed) external {
        if (tokenIds.length == 0) return;
        uint256 tokenId = tokenIds[idxSeed % tokenIds.length];
        address from = nft.ownerOf(tokenId);
        address to = actors[toSeed % actors.length];
        if (from == to) return;
        vm.prank(from);
        IERC721(address(nft)).transferFrom(from, to, tokenId);
    }

    receive() external payable {}
}

contract AgentIdentityInvariantTest is Test {
    AgentNFT internal nft;
    ERC6551Registry internal accounts;
    AgentAccount internal accountImpl;
    AgentRegistry internal registry;
    RegistryHandler internal handler;

    function setUp() public {
        nft = new AgentNFT(address(this));
        accounts = new ERC6551Registry();
        accountImpl = new AgentAccount();
        registry = new AgentRegistry(nft, accounts, address(accountImpl));
        nft.setMinter(address(registry));

        // EOA actors only — _safeMint to a non-receiver contract would revert.
        address[] memory actors = new address[](4);
        actors[0] = address(0xA11CE);
        actors[1] = address(0xB0B);
        actors[2] = address(0xCA11);
        actors[3] = address(0xD00D);

        handler = new RegistryHandler(registry, nft, actors);
        targetContract(address(handler));
    }

    /// Every mint corresponds to exactly one registration — no duplicates, no gaps.
    function invariant_mintedEqualsRegistered() public view {
        assertEq(nft.totalMinted(), handler.created(), "totalMinted == registrations");
    }

    /// Wallet control always tracks the NFT owner, including after transfers.
    function invariant_walletOwnerTracksNft() public view {
        uint256 count = handler.tokenCount();
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = handler.tokenIds(i);
            address account = handler.accountOf(tokenId);
            assertEq(AgentAccount(payable(account)).owner(), nft.ownerOf(tokenId), "wallet.owner == nft.ownerOf");
        }
    }

    /// The counterfactual address prediction always equals the deployed wallet.
    function invariant_accountPredictionMatches() public view {
        uint256 count = handler.tokenCount();
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = handler.tokenIds(i);
            assertEq(registry.previewAccount(tokenId), handler.accountOf(tokenId), "previewAccount == deployed");
        }
    }

    /// Each name resolves to its one token + wallet, with the live owner.
    function invariant_nameResolvesUniquely() public view {
        uint256 count = handler.tokenCount();
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = handler.tokenIds(i);
            (uint256 rTokenId, address rAccount, address rOwner,) = registry.resolve(handler.nameOf(tokenId));
            assertEq(rTokenId, tokenId, "resolve tokenId");
            assertEq(rAccount, handler.accountOf(tokenId), "resolve account");
            assertEq(rOwner, nft.ownerOf(tokenId), "resolve owner is live");
        }
    }
}
