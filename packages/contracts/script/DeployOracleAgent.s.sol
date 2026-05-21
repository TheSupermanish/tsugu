// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {OracleAgent} from "../src/agents/OracleAgent.sol";

/// @notice Deploys OracleAgent to Shannon and funds it with one request's worth of STT.
/// @dev    Reads from env:
///         - PRIVATE_KEY                (required) deployer key
///         - SOMNIA_AGENTS_PLATFORM     (default 0x037Bb9...) Somnia Agents platform addr
///         - JSON_API_AGENT_ID          (default 13174292974160097713)
///         - SUBCOMMITTEE_SIZE          (default 3)
///         - PER_AGENT_REWARD_WEI       (default 0.03 ether) — per-agent reward for the JSON API agent
///         - INITIAL_FUND_WEI           (default 0.3 ether)  — STT to seed the contract
contract DeployOracleAgent is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");

        address platform = vm.envOr("SOMNIA_AGENTS_PLATFORM", address(0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776));
        uint256 agentId = vm.envOr("JSON_API_AGENT_ID", uint256(13174292974160097713));
        uint256 subSize = vm.envOr("SUBCOMMITTEE_SIZE", uint256(3));
        uint256 perAgentReward = vm.envOr("PER_AGENT_REWARD_WEI", uint256(0.03 ether));
        uint256 initialFund = vm.envOr("INITIAL_FUND_WEI", uint256(0.3 ether));

        console2.log("== asom :: DeployOracleAgent ==");
        console2.log("deployer       ", vm.addr(pk));
        console2.log("platform       ", platform);
        console2.log("jsonApiAgentId ", agentId);
        console2.log("subSize        ", subSize);
        console2.log("perAgentReward ", perAgentReward);
        console2.log("initialFund    ", initialFund);

        vm.startBroadcast(pk);
        OracleAgent oracle = new OracleAgent(platform, agentId, subSize, perAgentReward);
        if (initialFund > 0) {
            (bool ok,) = address(oracle).call{value: initialFund}("");
            require(ok, "seed transfer failed");
        }
        vm.stopBroadcast();

        console2.log("OracleAgent    ", address(oracle));
        console2.log("balance (wei)  ", address(oracle).balance);
        // NB: oracle.requiredDeposit() would staticcall the Somnia Agents platform,
        //     which is backed by a precompile and not resolvable in forge's local
        //     simulator. Read it post-deploy via `cast call` against the live RPC.
    }
}
