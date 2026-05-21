// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAgentRequester, IJsonApiAgent, Response, Request, ResponseStatus} from "./lib/SomniaAgents.sol";

/// @title  OracleAgent — tsugu's day-1 Somnia Agents wrapper
/// @notice Fetches a uint256 price from any HTTPS JSON endpoint via the
///         Somnia Agents JSON API agent and stores the consensus-verified
///         result on-chain.
/// @dev    All four canonical Somnia Agents pitfalls are wired explicitly:
///         (1) deposit  = floor + per-agent reward × subcommittee size
///         (2) receive() accepts rebates pushed back from the platform
///         (3) handleResponse() is gated on platform sender + known requestId
///         (4) ResponseStatus is checked before any abi.decode of the result
contract OracleAgent {
    IAgentRequester public immutable platform;
    uint256 public immutable jsonApiAgentId;
    uint256 public immutable subcommitteeSize;
    uint256 public immutable perAgentReward;

    /// @notice Immutable. If the deployer's key is lost, all funds in the contract
    ///         are unrecoverable. Day-1 hackathon scope — ownership will move to
    ///         AgentNFT.ownerOf(tokenId) once the ERC-6551 layer ships.
    address public immutable owner;

    /// @notice Last consensus-verified price, in `decimals`-fixed-point units.
    /// @dev    Consumers MUST also read `lastUpdated` and check freshness against
    ///         `block.timestamp`. A bare `latestPrice()` read with no staleness
    ///         guard can return a value that is hours/days old.
    uint256 public latestPrice;
    uint256 public lastUpdated;
    uint256 public lastRequestId;

    mapping(uint256 => bool) public pendingRequests;
    mapping(uint256 => Quote) public quotes;

    struct Quote {
        uint256 price;
        uint256 timestamp;
        ResponseStatus status;
    }

    event PriceRequested(uint256 indexed requestId, string url, string jsonPath);
    event PriceReceived(uint256 indexed requestId, uint256 price, uint256 timestamp);
    event RequestFailed(uint256 indexed requestId, ResponseStatus status);
    event Funded(address indexed from, uint256 amount);

    error InsufficientDeposit(uint256 sent, uint256 required);
    error NotPlatform(address caller);
    error UnknownRequest(uint256 requestId);
    error NotOwner();
    error EmptySuccessResponse(uint256 requestId);

    constructor(address platform_, uint256 jsonApiAgentId_, uint256 subcommitteeSize_, uint256 perAgentReward_) {
        platform = IAgentRequester(platform_);
        jsonApiAgentId = jsonApiAgentId_;
        subcommitteeSize = subcommitteeSize_;
        perAgentReward = perAgentReward_;
        owner = msg.sender;
    }

    /// @notice Total wei needed to dispatch one request: floor + reward pot.
    /// @dev    Runners skip requests whose perAgentBudget is below
    ///         the scheduled execution cost — the floor alone is not enough.
    function requiredDeposit() public view returns (uint256) {
        return platform.getRequestDeposit() + (perAgentReward * subcommitteeSize);
    }

    /// @notice Convenience: fetch BTC price from CoinGecko via the JSON API agent.
    function requestBitcoinPrice() external payable returns (uint256 requestId) {
        return requestUintFromJson(
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", "bitcoin.usd", 8
        );
    }

    /// @notice Generic JSON fetch — any URL, any dot-path, any decimals.
    /// @dev    Caller-pays model: non-owners MUST forward msg.value >= requiredDeposit().
    ///         Owner may pay from the contract's accumulated balance (rebates,
    ///         prior top-ups) without forwarding value. This prevents anyone
    ///         from draining the contract by spamming requests with msg.value=0.
    function requestUintFromJson(string memory url, string memory jsonPath, uint8 decimals)
        public
        payable
        returns (uint256 requestId)
    {
        if (msg.value > 0) emit Funded(msg.sender, msg.value);

        uint256 deposit = requiredDeposit();

        // Non-owners must fund their own request — prevents DoS and arbitrary-URL
        // attacks against the contract's working capital.
        if (msg.sender != owner && msg.value < deposit) {
            revert InsufficientDeposit(msg.value, deposit);
        }
        if (address(this).balance < deposit) {
            revert InsufficientDeposit(address(this).balance, deposit);
        }

        bytes memory payload = abi.encodeWithSelector(IJsonApiAgent.fetchUint.selector, url, jsonPath, decimals);

        requestId = platform.createRequest{value: deposit}(
            jsonApiAgentId, address(this), this.handleResponse.selector, payload
        );

        pendingRequests[requestId] = true;
        lastRequestId = requestId;

        emit PriceRequested(requestId, url, jsonPath);
    }

    /// @notice Platform callback. Gated on sender + known requestId. Status checked
    ///         before any decode of responses[0].result to avoid panics on
    ///         Failed / TimedOut where the bytes may be empty or malformed.
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
            // Defensive: a Success status with zero responses is structurally
            // contradictory. Fail loud rather than emit RequestFailed(_, Success)
            // (which would confuse off-chain indexers branching on the event).
            if (responses.length == 0) revert EmptySuccessResponse(requestId);

            uint256 price = abi.decode(responses[0].result, (uint256));
            latestPrice = price;
            lastUpdated = block.timestamp;
            quotes[requestId] = Quote({price: price, timestamp: block.timestamp, status: status});
            emit PriceReceived(requestId, price, block.timestamp);
        } else {
            quotes[requestId] = Quote({price: 0, timestamp: block.timestamp, status: status});
            emit RequestFailed(requestId, status);
        }
    }

    /// @notice Pull funds back out (owner only). Useful at end-of-demo.
    function withdraw(address payable to, uint256 amount) external {
        if (msg.sender != owner) revert NotOwner();
        (bool ok,) = to.call{value: amount}("");
        require(ok, "withdraw failed");
    }

    /// @dev Accepts rebates from the platform (and topups from the owner).
    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }
}
