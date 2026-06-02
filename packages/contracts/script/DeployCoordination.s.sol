// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {AgentNFT} from "../src/identity/AgentNFT.sol";
import {AgentRegistry} from "../src/identity/AgentRegistry.sol";
import {CapabilityRegistry} from "../src/coordination/CapabilityRegistry.sol";
import {TaskBoard} from "../src/coordination/TaskBoard.sol";

/// @notice Deploys the tsugu coordination layer (CapabilityRegistry + TaskBoard) and
///         wires it to the existing identity stack.
/// @dev    Reads from env (defaults = the hardened Shannon identity deployment):
///         - PRIVATE_KEY      (required)
///         - AGENT_NFT        (default 0x2DCD…0925)
///         - AGENT_REGISTRY   (default 0x9Df3…452E)
///         Shannon: broadcast with a high --gas-estimate-multiplier (estimator undercounts ~8x).
contract DeployCoordination is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address nft = vm.envOr("AGENT_NFT", address(0x2DCD1758CaA40c004cA9F8593b032c384eA10925));
        address registry = vm.envOr("AGENT_REGISTRY", address(0x9Df3c688e2aE988Ff63672A98335d3BEfAdC452E));

        console2.log("== tsugu :: DeployCoordination ==");
        console2.log("deployer ", vm.addr(pk));
        console2.log("nft      ", nft);
        console2.log("registry ", registry);

        vm.startBroadcast(pk);
        CapabilityRegistry caps = new CapabilityRegistry(AgentNFT(nft));
        TaskBoard board = new TaskBoard(AgentNFT(nft), AgentRegistry(registry), caps);
        vm.stopBroadcast();

        console2.log("CapabilityRegistry", address(caps));
        console2.log("TaskBoard         ", address(board));
    }
}
