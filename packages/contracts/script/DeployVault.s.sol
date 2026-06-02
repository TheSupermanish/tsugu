// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {Vault} from "../src/tsugu/Vault.sol";
import {DemoYieldStrategy} from "../src/tsugu/DemoYieldStrategy.sol";
import {SomniaAgentIds} from "../src/agents/lib/SomniaAgents.sol";

/// @notice Deploys Tsugu's Vault — the AI-verified conditional escrow built on
///         AgentCompute. Resolves WEB claims via the parse-website agent and DATA
///         claims via the JSON-API agent.
/// @dev    Reads from env (defaults = canonical Shannon ids / platform):
///         - PRIVATE_KEY            (required)
///         - SOMNIA_AGENTS_PLATFORM (default Shannon platform 0x037B…6776)
///         - PARSE_AGENT_ID         (default SomniaAgentIds.PARSE_WEBSITE)
///         - JSON_API_AGENT_ID      (default SomniaAgentIds.JSON_API)
///         - LLM_AGENT_ID           (default SomniaAgentIds.LLM_INFERENCE)
///         - SUBCOMMITTEE_SIZE      (default 3)
///         - PER_AGENT_REWARD_WEI   (wei, default 0.1 ether — covers the parse path)
///         Shannon: broadcast with a high --gas-estimate-multiplier (the estimator
///         undercounts ~8x). Resolution is caller-paid, so the Vault does not need
///         pre-funding; record the address in packages/sdk/src/addresses.ts +
///         packages/contracts/DEPLOYMENTS.md after deploy.
contract DeployVault is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address platform = vm.envOr("SOMNIA_AGENTS_PLATFORM", SomniaAgentIds.PLATFORM_TESTNET);
        uint256 parseId = vm.envOr("PARSE_AGENT_ID", SomniaAgentIds.PARSE_WEBSITE);
        uint256 jsonId = vm.envOr("JSON_API_AGENT_ID", SomniaAgentIds.JSON_API);
        uint256 llmId = vm.envOr("LLM_AGENT_ID", SomniaAgentIds.LLM_INFERENCE);
        uint256 sub = vm.envOr("SUBCOMMITTEE_SIZE", uint256(3));
        uint256 reward = vm.envOr("PER_AGENT_REWARD_WEI", uint256(0.1 ether));

        console2.log("== Tsugu :: DeployVault ==");
        console2.log("deployer ", vm.addr(pk));
        console2.log("platform ", platform);
        console2.log("parseId  ", parseId);
        console2.log("jsonId   ", jsonId);
        console2.log("llmId    ", llmId);

        vm.startBroadcast(pk);
        Vault vault = new Vault(platform, parseId, jsonId, llmId, sub, reward);
        // Yield venue: deploy the (testnet) strategy, bind it to the Vault, optionally
        // seed its reserve. On mainnet, swap DemoYieldStrategy for a real adapter.
        DemoYieldStrategy strat = new DemoYieldStrategy(address(vault));
        vault.setYieldStrategy(address(strat));
        // NB: the yield reserve is funded by the operator AFTER the first yield deposit
        // (fund() rejects an empty pool), so there is no pre-funding step at deploy.
        vm.stopBroadcast();

        // NB: do NOT call vault.requiredDeposit() here — it reads the platform deposit
        // (precompile-backed) which reverts inside forge simulation. Query it live via
        // cast after deploy. Deposit = platform.getRequestDeposit() + reward * sub.
        console2.log("Vault           ", address(vault));
        console2.log("YieldStrategy   ", address(strat));
        console2.log("subcommittee    ", sub);
        console2.log("perAgentReward  ", reward);
    }
}
