// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AgentNFT} from "../identity/AgentNFT.sol";

/// @title  CapabilityRegistry — tsugu's discovery layer
/// @notice The directory of the agent economy: an agent (by its AgentNFT tokenId)
///         advertises WHAT IT DOES — a set of capability tags (e.g.
///         keccak256("llm.summarize"), keccak256("oracle.price")), a service URI
///         (an off-chain endpoint / metadata doc), and an optional price per call.
///         Anyone can then discover capable agents on-chain with `providers(tag)`.
/// @dev    Edits are gated to the agent's CURRENT NFT owner (read live), so a
///         listing always reflects who controls the agent — transfer the agent and
///         the new owner controls its listing. Capability membership is kept as an
///         enumerable set both per-agent (`capabilitiesOf`) and per-tag
///         (`providers`) so discovery is a single on-chain read, not a log scan.
contract CapabilityRegistry {
    AgentNFT public immutable nft;

    // tokenId => its capability tags (enumerable set; _capPos is 1-based, 0 = absent)
    mapping(uint256 => bytes32[]) private _caps;
    mapping(uint256 => mapping(bytes32 => uint256)) private _capPos;

    // capability tag => tokenIds advertising it (enumerable set)
    mapping(bytes32 => uint256[]) private _providers;
    mapping(bytes32 => mapping(uint256 => uint256)) private _provPos;

    struct Listing {
        string serviceURI; // off-chain endpoint / metadata (how to actually call the agent)
        uint256 pricePerCall; // advertised price in wei (informational; 0 = unset/free)
        bool listed;
    }

    mapping(uint256 => Listing) public listings;

    event CapabilityAdded(uint256 indexed tokenId, bytes32 indexed tag);
    event CapabilityRemoved(uint256 indexed tokenId, bytes32 indexed tag);
    event ServiceUpdated(uint256 indexed tokenId, string serviceURI, uint256 pricePerCall);

    error NotAgentOwner(uint256 tokenId, address caller);

    constructor(AgentNFT nft_) {
        nft = nft_;
    }

    /// @dev Reverts if the token doesn't exist (ownerOf reverts) or the caller
    ///      isn't its live owner — so you can only list an agent you control.
    modifier onlyAgentOwner(uint256 tokenId) {
        address owner = nft.ownerOf(tokenId);
        if (msg.sender != owner) revert NotAgentOwner(tokenId, msg.sender);
        _;
    }

    /// @notice Advertise capabilities + service info in one call (idempotent on tags).
    function advertise(uint256 tokenId, bytes32[] calldata tags, string calldata serviceURI, uint256 pricePerCall)
        external
        onlyAgentOwner(tokenId)
    {
        for (uint256 i = 0; i < tags.length; i++) {
            _addCap(tokenId, tags[i]);
        }
        listings[tokenId] = Listing({serviceURI: serviceURI, pricePerCall: pricePerCall, listed: true});
        emit ServiceUpdated(tokenId, serviceURI, pricePerCall);
    }

    /// @notice Add one capability tag to an agent.
    function addCapability(uint256 tokenId, bytes32 tag) external onlyAgentOwner(tokenId) {
        _addCap(tokenId, tag);
    }

    /// @notice Remove one capability tag from an agent.
    function removeCapability(uint256 tokenId, bytes32 tag) external onlyAgentOwner(tokenId) {
        _removeCap(tokenId, tag);
    }

    /// @notice Update the service URI / price without touching capabilities.
    function setService(uint256 tokenId, string calldata serviceURI, uint256 pricePerCall)
        external
        onlyAgentOwner(tokenId)
    {
        Listing storage l = listings[tokenId];
        l.serviceURI = serviceURI;
        l.pricePerCall = pricePerCall;
        l.listed = true;
        emit ServiceUpdated(tokenId, serviceURI, pricePerCall);
    }

    // --- discovery views ------------------------------------------------------

    /// @notice True if `tokenId` advertises `tag`.
    function hasCapability(uint256 tokenId, bytes32 tag) public view returns (bool) {
        return _capPos[tokenId][tag] != 0;
    }

    /// @notice All capability tags an agent advertises.
    function capabilitiesOf(uint256 tokenId) external view returns (bytes32[] memory) {
        return _caps[tokenId];
    }

    /// @notice All agents (tokenIds) advertising `tag` — the discovery query.
    function providers(bytes32 tag) external view returns (uint256[] memory) {
        return _providers[tag];
    }

    /// @notice How many agents advertise `tag`.
    function providerCount(bytes32 tag) external view returns (uint256) {
        return _providers[tag].length;
    }

    // --- internal enumerable-set ops -----------------------------------------

    function _addCap(uint256 tokenId, bytes32 tag) internal {
        if (_capPos[tokenId][tag] != 0) return; // already present — idempotent
        _caps[tokenId].push(tag);
        _capPos[tokenId][tag] = _caps[tokenId].length;
        _providers[tag].push(tokenId);
        _provPos[tag][tokenId] = _providers[tag].length;
        emit CapabilityAdded(tokenId, tag);
    }

    function _removeCap(uint256 tokenId, bytes32 tag) internal {
        uint256 pos = _capPos[tokenId][tag];
        if (pos == 0) return; // absent — no-op

        // swap-and-pop from the agent's tag list
        bytes32[] storage tags = _caps[tokenId];
        uint256 lastIdx = tags.length - 1;
        if (pos - 1 != lastIdx) {
            bytes32 moved = tags[lastIdx];
            tags[pos - 1] = moved;
            _capPos[tokenId][moved] = pos;
        }
        tags.pop();
        _capPos[tokenId][tag] = 0;

        // swap-and-pop from the tag's provider list
        uint256[] storage provs = _providers[tag];
        uint256 ppos = _provPos[tag][tokenId];
        uint256 pLastIdx = provs.length - 1;
        if (ppos - 1 != pLastIdx) {
            uint256 movedToken = provs[pLastIdx];
            provs[ppos - 1] = movedToken;
            _provPos[tag][movedToken] = ppos;
        }
        provs.pop();
        _provPos[tag][tokenId] = 0;

        emit CapabilityRemoved(tokenId, tag);
    }
}
