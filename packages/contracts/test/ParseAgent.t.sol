// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ParseAgent} from "../src/agents/ParseAgent.sol";
import {SomniaAgentIds, ResponseStatus} from "../src/agents/lib/SomniaAgents.sol";
import {MockAgentPlatform} from "./helpers/MockAgentPlatform.sol";

contract ParseAgentTest is Test {
    MockAgentPlatform platform;
    ParseAgent parse;

    uint256 constant SUB = 3;
    uint256 constant REWARD = 0.1 ether;
    address user = address(0xBEEF11);

    function setUp() public {
        platform = new MockAgentPlatform();
        parse = new ParseAgent(address(platform), 0, SUB, REWARD);
        vm.deal(user, 100 ether);
    }

    function deposit() internal view returns (uint256) {
        return platform.FLOOR() + REWARD * SUB;
    }

    function _params() internal pure returns (ParseAgent.ExtractParams memory p) {
        p.key = "headline";
        p.description = "the main headline";
        p.options = new string[](0);
        p.prompt = "extract the headline";
        p.url = "https://example.com";
        p.resolveUrl = false;
        p.numPages = 1;
        p.confidenceThreshold = 70;
    }

    function test_defaultsToCanonicalParseId() public view {
        assertEq(parse.agentId(), SomniaAgentIds.PARSE_WEBSITE);
    }

    function test_extract_routesToParseAgent_andStoresResult() public {
        uint256 dep = deposit();
        ParseAgent.ExtractParams memory p = _params();
        vm.prank(user);
        uint256 id = parse.requestExtract{value: dep}(p);
        assertEq(platform.lastAgentId(), SomniaAgentIds.PARSE_WEBSITE);
        assertTrue(parse.pendingRequests(id));

        vm.expectEmit(true, false, false, true, address(parse));
        emit ParseAgent.ExtractionReceived(id, "Hello World");
        platform.fireString(address(parse), id, "Hello World");

        assertTrue(parse.extractionReady(id));
        assertEq(parse.extractions(id), "Hello World");
        assertEq(parse.lastExtraction(), "Hello World");
        assertEq(parse.lastExtractionRequestId(), id);
        assertFalse(parse.pendingRequests(id));
    }

    function test_failure_leavesNoExtraction() public {
        uint256 dep = deposit();
        ParseAgent.ExtractParams memory p = _params();
        vm.prank(user);
        uint256 id = parse.requestExtract{value: dep}(p);
        platform.fireFailure(address(parse), id, ResponseStatus.Failed);
        assertFalse(parse.extractionReady(id));
        assertEq(bytes(parse.extractions(id)).length, 0);
    }

    function test_overpayment_refunded() public {
        uint256 dep = deposit();
        ParseAgent.ExtractParams memory p = _params();
        uint256 before = user.balance;
        vm.prank(user);
        parse.requestExtract{value: dep + 1 ether}(p);
        assertEq(user.balance, before - dep);
    }
}
