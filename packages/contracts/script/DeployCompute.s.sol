// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {LlmAgent} from "../src/agents/LlmAgent.sol";
import {ParseAgent} from "../src/agents/ParseAgent.sol";
import {SomniaAgentIds} from "../src/agents/lib/SomniaAgents.sol";

/// @notice Deploys asom's fundamental AI compute primitives (LlmAgent + ParseAgent),
///         the consensus LLM-inference and parse-website wrappers built on AgentCompute.
/// @dev    Reads from env (defaults = the canonical Shannon ids / platform):
///         - PRIVATE_KEY            (required)
///         - SOMNIA_AGENTS_PLATFORM (default Shannon platform 0x037B…6776)
///         - LLM_AGENT_ID           (default SomniaAgentIds.LLM_INFERENCE — EXPERIMENTAL id)
///         - PARSE_AGENT_ID         (default SomniaAgentIds.PARSE_WEBSITE)
///         - SUBCOMMITTEE_SIZE      (default 3)
///         - LLM_PER_AGENT_REWARD   (wei, default 0.07 ether — per-validator LLM price)
///         - PARSE_PER_AGENT_REWARD (wei, default 0.10 ether — per-validator parse price)
///         Shannon: broadcast with a high --gas-estimate-multiplier (estimator undercounts ~8x),
///         then fund each contract above requiredDeposit() before the first request, and
///         set the deployed addresses in packages/sdk/src/addresses.ts + DEPLOYMENTS.md.
contract DeployCompute is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address platform = vm.envOr("SOMNIA_AGENTS_PLATFORM", SomniaAgentIds.PLATFORM_TESTNET);
        uint256 llmId = vm.envOr("LLM_AGENT_ID", SomniaAgentIds.LLM_INFERENCE);
        uint256 parseId = vm.envOr("PARSE_AGENT_ID", SomniaAgentIds.PARSE_WEBSITE);
        uint256 sub = vm.envOr("SUBCOMMITTEE_SIZE", uint256(3));
        uint256 llmReward = vm.envOr("LLM_PER_AGENT_REWARD", uint256(0.07 ether));
        uint256 parseReward = vm.envOr("PARSE_PER_AGENT_REWARD", uint256(0.1 ether));

        console2.log("== asom :: DeployCompute ==");
        console2.log("deployer ", vm.addr(pk));
        console2.log("platform ", platform);
        console2.log("llmId    ", llmId);
        console2.log("parseId  ", parseId);

        vm.startBroadcast(pk);
        LlmAgent llm = new LlmAgent(platform, llmId, sub, llmReward);
        ParseAgent parse = new ParseAgent(platform, parseId, sub, parseReward);
        vm.stopBroadcast();

        console2.log("LlmAgent  ", address(llm));
        console2.log("ParseAgent", address(parse));
    }
}
