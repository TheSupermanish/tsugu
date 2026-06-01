// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AgentNFT} from "./AgentNFT.sol";
import {IERC6551Registry} from "../interfaces/IERC6551.sol";

/// @title  AgentRegistry — tsugu's name resolver and agent factory
/// @notice The single entry point for creating an agent. `register("neo", owner)`
///         mints the AgentNFT, deploys its ERC-6551 wallet, and records the name.
///         `resolve("neo")` returns the agent's wallet, token, and live owner.
/// @dev    Names are the tsugu namespace: `<name>@tsugu`. Validation is strict and
///         on-chain (lowercase a-z, 0-9, hyphen; 1-32 chars; no leading/trailing
///         or doubled hyphen) so the namespace can't be polluted with ambiguous
///         or homoglyph-style entries.
///
///         register() is `nonReentrant`: minting calls `_safeMint`, which invokes
///         `onERC721Received` on a contract `owner`. Without the guard a malicious
///         owner could re-enter register() during that callback — before the name
///         record is written — and claim the SAME name twice, minting two agents
///         that both believe they own one name. The guard closes that window (and
///         the seed-transfer window) so one name maps to exactly one agent.
contract AgentRegistry is ReentrancyGuard {
    AgentNFT public immutable nft;
    IERC6551Registry public immutable accountRegistry;
    address public immutable accountImplementation;

    struct AgentRecord {
        uint256 tokenId;
        address account; // the ERC-6551 token-bound wallet
        uint64 createdAt;
        bool exists;
    }

    mapping(bytes32 => AgentRecord) internal _records; // keccak(name) => record
    mapping(uint256 => bytes32) public nameHashOfToken;

    event AgentRegistered(
        string name, bytes32 indexed nameHash, uint256 indexed tokenId, address indexed owner, address account
    );

    error NameTaken(string name);
    error NameEmpty();
    error NameTooLong();
    error NameBadChar(uint256 index);
    error NameBadHyphen();
    error NotFound(string name);

    constructor(AgentNFT nft_, IERC6551Registry accountRegistry_, address accountImplementation_) {
        nft = nft_;
        accountRegistry = accountRegistry_;
        accountImplementation = accountImplementation_;
    }

    /// @notice Create an agent: mint NFT to `owner`, deploy its wallet, record the name.
    /// @dev    Payable — any STT sent is forwarded to the new agent wallet as seed funds.
    /// @return tokenId  the minted AgentNFT id
    /// @return account  the agent's ERC-6551 wallet address
    function register(string calldata name, address owner)
        external
        payable
        nonReentrant
        returns (uint256 tokenId, address account)
    {
        _validateName(name);
        bytes32 nameHash = keccak256(bytes(name));
        if (_records[nameHash].exists) revert NameTaken(name);

        // Effects before interactions: reserve the name immediately so any
        // re-entry (defense-in-depth alongside nonReentrant) sees it as taken.
        // tokenId/account are backfilled below once minted — `exists` is the
        // only field the duplicate-name guard reads.
        _records[nameHash].exists = true;

        tokenId = nft.mint(owner, name);

        account = accountRegistry.createAccount(accountImplementation, bytes32(0), block.chainid, address(nft), tokenId);

        _records[nameHash].tokenId = tokenId;
        _records[nameHash].account = account;
        _records[nameHash].createdAt = uint64(block.timestamp);
        nameHashOfToken[tokenId] = nameHash;

        // Seed the new wallet with any STT the caller forwarded.
        if (msg.value > 0) {
            (bool ok,) = account.call{value: msg.value}("");
            require(ok, "seed transfer failed");
        }

        emit AgentRegistered(name, nameHash, tokenId, owner, account);
    }

    /// @notice Predict the wallet address a name will get, before registering.
    function previewAccount(uint256 tokenId) external view returns (address) {
        return accountRegistry.account(accountImplementation, bytes32(0), block.chainid, address(nft), tokenId);
    }

    /// @notice Resolve a name to its agent. Reverts if the name is unregistered.
    /// @return tokenId    the AgentNFT id
    /// @return account    the ERC-6551 wallet
    /// @return owner      the live NFT owner (reflects transfers)
    /// @return createdAt  registration timestamp
    function resolve(string calldata name)
        external
        view
        returns (uint256 tokenId, address account, address owner, uint64 createdAt)
    {
        AgentRecord memory r = _records[keccak256(bytes(name))];
        if (!r.exists) revert NotFound(name);
        return (r.tokenId, r.account, IERC721(address(nft)).ownerOf(r.tokenId), r.createdAt);
    }

    /// @notice True if a name is still available to register.
    function isAvailable(string calldata name) external view returns (bool) {
        return !_records[keccak256(bytes(name))].exists;
    }

    /// @notice Raw record by name hash (for indexers / composability).
    function recordByHash(bytes32 nameHash) external view returns (AgentRecord memory) {
        return _records[nameHash];
    }

    /// @dev Strict on-chain name validation for the `<name>@tsugu` namespace.
    function _validateName(string calldata name) internal pure {
        bytes calldata b = bytes(name);
        uint256 len = b.length;
        if (len == 0) revert NameEmpty();
        if (len > 32) revert NameTooLong();

        for (uint256 i = 0; i < len; i++) {
            bytes1 c = b[i];
            bool isLower = (c >= 0x61 && c <= 0x7a); // a-z
            bool isDigit = (c >= 0x30 && c <= 0x39); // 0-9
            bool isHyphen = (c == 0x2d); // -

            if (!isLower && !isDigit && !isHyphen) revert NameBadChar(i);

            if (isHyphen) {
                // No leading, trailing, or consecutive hyphens.
                if (i == 0 || i == len - 1) revert NameBadHyphen();
                if (b[i - 1] == 0x2d) revert NameBadHyphen();
            }
        }
    }
}
