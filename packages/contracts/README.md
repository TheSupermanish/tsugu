# @tsugu/contracts

Solidity contracts for [Tsugu](../../README.md) — money that moves on proof.

## What's here

- **`src/tsugu/Vault.sol`** — `Vault is AgentCompute`: the AI-verified conditional escrow
  (**Pacts**). Multi-source M-of-N quorum across all three Somnia agents (Web→parse, Data→JSON,
  Text→LLM); opt-in yield; escrow ring-fenced; CEI + `nonReentrant`; pull-payment release.
- **`src/tsugu/IYieldStrategy.sol` + `DemoYieldStrategy.sol`** — the pluggable, opt-in yield venue
  (the demo strategy is a labelled testnet stand-in; mainnet swaps in a real adapter).
- **`src/agents/`** — the Somnia AI engine the Vault builds on: `AgentCompute` (hardened
  request/callback/funding base + consensus receipts), `SomniaAI`/`SomniaAgents` (payload encoders
  + canonical ids), and the `LlmAgent` / `ParseAgent` / `OracleAgent` reference wrappers.

## Develop

```bash
forge build
forge test            # 114 tests (lifecycle, all 3 agents, quorum, ring-fence, reentrancy, yield)
forge fmt --check

# deploy Vault + yield strategy to Shannon (paris EVM, no PUSH0; high gas multiplier)
forge script script/DeployVault.s.sol --rpc-url shannon --broadcast --legacy --gas-estimate-multiplier 2000
```

Solidity 0.8.24, OpenZeppelin 5.0.2, `evm_version = paris`, `via_ir = off`. Deployed addresses +
live verification: [`DEPLOYMENTS.md`](./DEPLOYMENTS.md). Somnia AI grounding:
[`../../docs/SOMNIA_AI.md`](../../docs/SOMNIA_AI.md).
