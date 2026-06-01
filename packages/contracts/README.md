# @tsugu/contracts

Solidity contracts for [tsugu](../../README.md) — the agentic layer on Somnia.

## Status

Live on Shannon: the identity layer (`<name>@tsugu` agents with ERC-6551 wallets,
reentrancy-guarded) and `OracleAgent` (consensus-verified price oracle). See
[`DEPLOYMENTS.md`](./DEPLOYMENTS.md) for addresses, tx hashes, and live verification.

## Layout

```
src/
├── identity/
│   ├── AgentRegistry.sol     # name resolver + factory; nonReentrant register()
│   └── AgentNFT.sol          # ERC-721 ownership token (minter-gated)
├── accounts/
│   ├── AgentAccount.sol      # ERC-6551 token-bound wallet (owner-gated execute)
│   └── ERC6551Registry.sol   # canonical ERC-6551 reference registry
├── agents/
│   ├── OracleAgent.sol       # consensus-verified BTC price oracle (live on Shannon)
│   └── lib/SomniaAgents.sol  # canonical Somnia Agents types & interfaces
└── interfaces/IERC6551.sol
test/
├── AgentIdentity.t.sol           # core register/resolve/transfer/validation (24)
├── AgentIdentitySecurity.t.sol   # reentrancy + ERC-6551 abuse paths (7)
├── AgentIdentityFuzz.t.sol       # differential fuzz of name validation (4)
├── AgentIdentityInvariant.t.sol  # registry invariants under fuzzed sequences (4)
└── OracleAgent.t.sol             # all 4 Somnia Agents pitfalls + refund/withdraw (26)
script/
├── DeployIdentity.s.sol
├── DeployOracleAgent.s.sol
└── RequestBtcPrice.s.sol
```

`forge test` → **65 tests**. The bounded invariant config lives in `foundry.toml`;
for a deep local run: `forge test --match-path 'test/*Invariant*' --invariant-runs 256 --invariant-depth 256`.

## Commands

```bash
pnpm build         # forge build
pnpm test          # forge test -vvv
pnpm fmt           # forge fmt
```

## Deploying to Shannon

```bash
cp ../../.env.example .env  # then fill in PRIVATE_KEY
source .env
forge script script/DeployOracleAgent.s.sol:DeployOracleAgent \
  --rpc-url shannon --broadcast --gas-estimate-multiplier 800
```

**If forge's gas estimator under-budgets** (it will — see Shannon notes below), use cast directly:
```bash
INIT=$(jq -r '.bytecode.object' out/OracleAgent.sol/OracleAgent.json)
ARGS=$(cast abi-encode "constructor(address,uint256,uint256,uint256)" \
  $SOMNIA_AGENTS_PLATFORM $JSON_API_AGENT_ID $SUBCOMMITTEE_SIZE $PER_AGENT_REWARD_WEI)
cast send --rpc-url $SHANNON_RPC_URL --private-key $PRIVATE_KEY \
  --gas-limit 30000000 --create "${INIT}${ARGS#0x}"
```

## Shannon EVM gotchas (learned the hard way Day 1)

1. **No PUSH0.** Build with `evm_version = "paris"` in `foundry.toml`. Solc 0.8.20+ emits PUSH0 by default and Shannon rejects it.
2. **CREATE costs ~20× standard EVM gas.** Forge's `eth_estimateGas` undercounts by ~8×. Always pass `--gas-limit 30000000` or `--gas-estimate-multiplier 800` for deploys.
3. **Don't read from the Somnia Agents platform inside `forge script`.** It's precompile-backed (`0x0100`), so any staticcall to it reverts in forge's local simulator and aborts the whole broadcast. Move platform reads to off-chain `cast call`.

## Somnia Agents pitfalls baked into every agent contract

1. Deposit = `getRequestDeposit() + (pricePerAgent × subcommitteeSize)`. Floor alone won't get picked up.
2. Implement `receive() external payable` — rebates are pushed.
3. Gate the callback: `require(msg.sender == address(platform))` + check `pendingRequests[requestId]`.
4. Check `ResponseStatus` before decoding `responses[0].result` — non-Success panics on decode.

All four are covered by tests in `test/OracleAgent.t.sol`.
