// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {OracleAgent} from "../src/agents/OracleAgent.sol";
import {
    IAgentRequester,
    IJsonApiAgent,
    Response,
    Request,
    ResponseStatus,
    ConsensusType
} from "../src/agents/lib/SomniaAgents.sol";

/// @dev Minimal stand-in for the Somnia Agents platform. Records the last request,
///      lets tests fire the callback with any status.
contract MockAgentPlatform is IAgentRequester {
    uint256 public constant FLOOR = 0.01 ether;
    uint256 public nextRequestId = 1;

    uint256 public lastRequestId;
    uint256 public lastValue;
    uint256 public lastAgentId;
    bytes public lastPayload;
    address public lastCallback;
    bytes4 public lastSelector;

    function getRequestDeposit() external pure returns (uint256) {
        return FLOOR;
    }

    function createRequest(uint256 agentId, address callbackAddress, bytes4 callbackSelector, bytes calldata payload)
        external
        payable
        returns (uint256 requestId)
    {
        requestId = nextRequestId++;
        lastRequestId = requestId;
        lastValue = msg.value;
        lastAgentId = agentId;
        lastPayload = payload;
        lastCallback = callbackAddress;
        lastSelector = callbackSelector;
    }

    /// @notice Tests use this to simulate the platform invoking the callback.
    function fireCallback(address target, uint256 requestId, ResponseStatus status, uint256 priceResult) external {
        Response[] memory responses = new Response[](status == ResponseStatus.Success ? 1 : 0);
        if (status == ResponseStatus.Success) {
            responses[0] = Response({
                validator: address(0xBEEF),
                result: abi.encode(priceResult),
                status: ResponseStatus.Success,
                receipt: 1,
                timestamp: block.timestamp,
                executionCost: 0.03 ether
            });
        }
        _deliverCallback(target, requestId, responses, status);
    }

    /// @notice Tests use this to simulate edge-case callbacks (e.g. Success+empty).
    function fireRawCallback(address target, uint256 requestId, Response[] memory responses, ResponseStatus status)
        external
    {
        _deliverCallback(target, requestId, responses, status);
    }

    function _deliverCallback(address target, uint256 requestId, Response[] memory responses, ResponseStatus status)
        internal
    {
        Request memory details;
        details.id = requestId;
        details.status = status;
        details.consensusType = ConsensusType.Majority;

        (bool ok, bytes memory ret) = target.call(
            abi.encodeWithSelector(OracleAgent.handleResponse.selector, requestId, responses, status, details)
        );
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    receive() external payable {}
}

contract OracleAgentTest is Test {
    MockAgentPlatform internal platform;
    OracleAgent internal oracle;

    uint256 internal constant JSON_API_AGENT_ID = 13174292974160097713;
    uint256 internal constant SUBCOMMITTEE_SIZE = 3;
    uint256 internal constant PER_AGENT_REWARD = 0.03 ether;

    address internal owner = address(this);
    address internal stranger = address(0xC0FFEE);

    event PriceRequested(uint256 indexed requestId, string url, string jsonPath);
    event PriceReceived(uint256 indexed requestId, uint256 price, uint256 timestamp);
    event RequestFailed(uint256 indexed requestId, ResponseStatus status);
    event Funded(address indexed from, uint256 amount);
    event Refunded(address indexed to, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    function setUp() public {
        platform = new MockAgentPlatform();
        oracle = new OracleAgent(address(platform), JSON_API_AGENT_ID, SUBCOMMITTEE_SIZE, PER_AGENT_REWARD);
    }

    function _fund(uint256 amount) internal {
        (bool ok,) = address(oracle).call{value: amount}("");
        require(ok, "fund failed");
    }

    // ---------------------------------------------------------------------
    // Pitfall 1: deposit math
    // ---------------------------------------------------------------------

    function test_requiredDeposit_addsRewardPotOnTop() public view {
        uint256 expected = platform.FLOOR() + (PER_AGENT_REWARD * SUBCOMMITTEE_SIZE);
        assertEq(oracle.requiredDeposit(), expected, "deposit must include reward pot");
    }

    function test_request_revertsWhenContractUnderfunded() public {
        vm.expectRevert(abi.encodeWithSelector(OracleAgent.InsufficientDeposit.selector, 0, oracle.requiredDeposit()));
        oracle.requestBitcoinPrice();
    }

    function test_request_forwardsExactRequiredDepositToPlatform() public {
        _fund(1 ether);
        oracle.requestBitcoinPrice();
        assertEq(platform.lastValue(), oracle.requiredDeposit(), "deposit forwarded");
        assertEq(platform.lastAgentId(), JSON_API_AGENT_ID, "JSON API agent ID");
        assertEq(platform.lastCallback(), address(oracle), "callback addr");
        assertEq(platform.lastSelector(), OracleAgent.handleResponse.selector, "callback selector");
    }

    function test_request_marksRequestPending() public {
        _fund(1 ether);
        uint256 id = oracle.requestBitcoinPrice();
        assertTrue(oracle.pendingRequests(id), "should be pending");
        assertEq(oracle.lastRequestId(), id, "lastRequestId tracked");
    }

    function test_request_emitsPriceRequested() public {
        _fund(1 ether);
        vm.expectEmit(false, false, false, true, address(oracle));
        emit PriceRequested(
            1, "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", "bitcoin.usd"
        );
        oracle.requestBitcoinPrice();
    }

    function test_request_encodesFetchUintPayload() public {
        _fund(1 ether);
        oracle.requestBitcoinPrice();
        bytes memory expected = abi.encodeWithSelector(
            IJsonApiAgent.fetchUint.selector,
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
            "bitcoin.usd",
            uint8(8)
        );
        assertEq(platform.lastPayload(), expected, "payload selector + args");
    }

    // ---------------------------------------------------------------------
    // Pitfall 2: receive() accepts rebates
    // ---------------------------------------------------------------------

    function test_receive_acceptsRebateAndEmitsFunded() public {
        vm.expectEmit(true, false, false, true, address(oracle));
        emit Funded(address(this), 0.5 ether);
        _fund(0.5 ether);
        assertEq(address(oracle).balance, 0.5 ether);
    }

    // ---------------------------------------------------------------------
    // Pitfall 3: callback gating
    // ---------------------------------------------------------------------

    function test_callback_revertsWhenSenderIsNotPlatform() public {
        Response[] memory responses = new Response[](0);
        Request memory details;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(OracleAgent.NotPlatform.selector, stranger));
        oracle.handleResponse(1, responses, ResponseStatus.Success, details);
    }

    function test_callback_revertsForUnknownRequestId() public {
        vm.expectRevert(abi.encodeWithSelector(OracleAgent.UnknownRequest.selector, 999));
        platform.fireCallback(address(oracle), 999, ResponseStatus.Success, 1);
    }

    // ---------------------------------------------------------------------
    // Pitfall 4: status branching
    // ---------------------------------------------------------------------

    function test_callback_successUpdatesLatestPrice() public {
        _fund(1 ether);
        uint256 id = oracle.requestBitcoinPrice();
        uint256 fakePrice = 65_432_00000000;

        vm.expectEmit(true, false, false, true, address(oracle));
        emit PriceReceived(id, fakePrice, block.timestamp);
        platform.fireCallback(address(oracle), id, ResponseStatus.Success, fakePrice);

        assertEq(oracle.latestPrice(), fakePrice, "latest price set");
        assertEq(oracle.lastUpdated(), block.timestamp, "timestamp set");
        assertFalse(oracle.pendingRequests(id), "pending cleared");
        (uint256 qp, uint256 qt, ResponseStatus qs) = oracle.quotes(id);
        assertEq(qp, fakePrice);
        assertEq(qt, block.timestamp);
        assertEq(uint8(qs), uint8(ResponseStatus.Success));
    }

    function test_callback_failedDoesNotDecodeAndEmitsFailure() public {
        _fund(1 ether);
        uint256 id = oracle.requestBitcoinPrice();
        uint256 priceBefore = oracle.latestPrice();

        vm.expectEmit(true, false, false, true, address(oracle));
        emit RequestFailed(id, ResponseStatus.Failed);
        platform.fireCallback(address(oracle), id, ResponseStatus.Failed, 0);

        assertEq(oracle.latestPrice(), priceBefore, "price unchanged on Failed");
        assertFalse(oracle.pendingRequests(id), "pending cleared on Failed");
    }

    function test_callback_timedOutDoesNotDecodeAndEmitsFailure() public {
        _fund(1 ether);
        uint256 id = oracle.requestBitcoinPrice();
        uint256 priceBefore = oracle.latestPrice();

        vm.expectEmit(true, false, false, true, address(oracle));
        emit RequestFailed(id, ResponseStatus.TimedOut);
        platform.fireCallback(address(oracle), id, ResponseStatus.TimedOut, 0);

        assertEq(oracle.latestPrice(), priceBefore, "price unchanged on TimedOut");
        assertFalse(oracle.pendingRequests(id), "pending cleared on TimedOut");
    }

    function test_callback_canNotBeReplayed() public {
        _fund(1 ether);
        uint256 id = oracle.requestBitcoinPrice();
        platform.fireCallback(address(oracle), id, ResponseStatus.Success, 1);
        vm.expectRevert(abi.encodeWithSelector(OracleAgent.UnknownRequest.selector, id));
        platform.fireCallback(address(oracle), id, ResponseStatus.Success, 2);
    }

    // ---------------------------------------------------------------------
    // Withdraw
    // ---------------------------------------------------------------------

    function test_withdraw_onlyOwner() public {
        _fund(1 ether);
        vm.prank(stranger);
        vm.expectRevert(OracleAgent.NotOwner.selector);
        oracle.withdraw(payable(stranger), 1 ether);
    }

    function test_withdraw_transfersFunds() public {
        _fund(1 ether);
        address payable sink = payable(address(0xDEAD));
        uint256 before = sink.balance;
        oracle.withdraw(sink, 0.4 ether);
        assertEq(sink.balance - before, 0.4 ether);
    }

    // ---------------------------------------------------------------------
    // Caller-pays / access-control (review-hardening)
    // ---------------------------------------------------------------------

    function test_request_revertsForNonOwnerWithoutMsgValue() public {
        _fund(1 ether); // contract has plenty of balance, but non-owner can't tap it
        uint256 deposit = oracle.requiredDeposit();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(OracleAgent.InsufficientDeposit.selector, 0, deposit));
        oracle.requestBitcoinPrice();
    }

    function test_request_revertsForNonOwnerWithPartialMsgValue() public {
        _fund(1 ether);
        uint256 deposit = oracle.requiredDeposit();
        uint256 underpaid = deposit - 1;
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(OracleAgent.InsufficientDeposit.selector, underpaid, deposit));
        oracle.requestBitcoinPrice{value: underpaid}();
    }

    function test_request_acceptsCallerPaysForNonOwner() public {
        uint256 deposit = oracle.requiredDeposit();
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        uint256 id = oracle.requestBitcoinPrice{value: deposit}();
        assertTrue(oracle.pendingRequests(id), "should be pending");
        assertEq(platform.lastValue(), deposit, "exact deposit forwarded");
    }

    function test_request_ownerCanStillUseContractBalance() public {
        _fund(1 ether);
        // owner is address(this) (the test contract) — calls with msg.value=0
        uint256 id = oracle.requestBitcoinPrice();
        assertTrue(oracle.pendingRequests(id), "owner request landed");
        assertEq(platform.lastValue(), oracle.requiredDeposit(), "platform got deposit");
    }

    function test_callback_revertsOnSuccessWithEmptyResponses() public {
        _fund(1 ether);
        uint256 id = oracle.requestBitcoinPrice();
        Response[] memory empty = new Response[](0);
        vm.expectRevert(abi.encodeWithSelector(OracleAgent.EmptySuccessResponse.selector, id));
        platform.fireRawCallback(address(oracle), id, empty, ResponseStatus.Success);
    }

    // ---------------------------------------------------------------------
    // Overpayment refund (review-hardening): a non-owner's excess STT must not
    // be trapped as a silent donation to the owner.
    // ---------------------------------------------------------------------

    function test_request_refundsNonOwnerOverpayment() public {
        uint256 deposit = oracle.requiredDeposit();
        uint256 overpay = 0.5 ether;
        vm.deal(stranger, 1 ether);

        vm.expectEmit(true, false, false, true, address(oracle));
        emit Refunded(stranger, overpay);
        vm.prank(stranger);
        oracle.requestBitcoinPrice{value: deposit + overpay}();

        // Stranger is out exactly the deposit; the excess came back.
        assertEq(stranger.balance, 1 ether - deposit, "non-owner only pays the deposit");
        // Oracle forwarded the deposit and refunded the rest — nothing trapped.
        assertEq(address(oracle).balance, 0, "no excess trapped in oracle");
        assertEq(platform.lastValue(), deposit, "platform got exactly the deposit");
    }

    function test_request_noRefundForExactNonOwnerPayment() public {
        uint256 deposit = oracle.requiredDeposit();
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        uint256 id = oracle.requestBitcoinPrice{value: deposit}();
        assertTrue(oracle.pendingRequests(id), "request landed");
        assertEq(stranger.balance, 1 ether - deposit, "exact payment, no change");
        assertEq(address(oracle).balance, 0, "nothing left over");
    }

    function test_request_ownerOverpaymentStaysAsContractTopUp() public {
        // Owner (this contract) intentionally tops up while requesting; the excess
        // stays in the owner's own contract rather than being refunded.
        uint256 deposit = oracle.requiredDeposit();
        uint256 extra = 0.2 ether;
        oracle.requestBitcoinPrice{value: deposit + extra}();
        assertEq(address(oracle).balance, extra, "owner overpayment stays as balance");
    }

    // ---------------------------------------------------------------------
    // Withdraw events + sweep
    // ---------------------------------------------------------------------

    function test_withdraw_emitsWithdrawn() public {
        _fund(1 ether);
        address payable sink = payable(address(0xDEAD));
        vm.expectEmit(true, false, false, true, address(oracle));
        emit Withdrawn(sink, 0.4 ether);
        oracle.withdraw(sink, 0.4 ether);
    }

    function test_withdrawAll_sweepsBalanceAndEmits() public {
        _fund(1 ether);
        address payable sink = payable(address(0xBEEF));
        uint256 before = sink.balance;
        vm.expectEmit(true, false, false, true, address(oracle));
        emit Withdrawn(sink, 1 ether);
        oracle.withdrawAll(sink);
        assertEq(sink.balance - before, 1 ether, "full balance swept");
        assertEq(address(oracle).balance, 0, "oracle emptied");
    }

    function test_withdrawAll_onlyOwner() public {
        _fund(1 ether);
        vm.prank(stranger);
        vm.expectRevert(OracleAgent.NotOwner.selector);
        oracle.withdrawAll(payable(stranger));
    }

    receive() external payable {}
}
