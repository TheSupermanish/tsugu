// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {OracleAgent} from "../src/agents/OracleAgent.sol";

/// @notice Calls requestBitcoinPrice() on an already-deployed OracleAgent.
/// @dev    Reads ORACLE_AGENT address from env. The contract must already
///         hold at least `requiredDeposit()` wei; see DeployOracleAgent.
contract RequestBtcPrice is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address oracleAddr = vm.envAddress("ORACLE_AGENT");
        OracleAgent oracle = OracleAgent(payable(oracleAddr));

        console2.log("== tsugu :: RequestBtcPrice ==");
        console2.log("oracle         ", oracleAddr);
        console2.log("balance        ", oracleAddr.balance);
        // NB: oracle.requiredDeposit() staticcalls the Somnia Agents platform,
        //     which is precompile-backed and unresolvable in forge's local
        //     simulator. Read it off-chain via `cast call` if you need it.

        vm.startBroadcast(pk);
        uint256 requestId = oracle.requestBitcoinPrice();
        vm.stopBroadcast();

        console2.log("requestId      ", requestId);
    }
}
