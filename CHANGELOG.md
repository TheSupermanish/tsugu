# Changelog

All notable changes to Tsugu are documented here. Packages are versioned in lockstep.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

**Tsugu** — the pivot to *money that moves on proof, not promises*: an AI-verified conditional
escrow, built on the fundamental AI layer below.

### Added — Tsugu

- **`Vault is AgentCompute`** (`src/tsugu/Vault.sol`) — a permissionless registry of **Pacts**
  (AI-verified conditional escrows). Multi-source **M-of-N quorum**: a pact confirms only when M
  independent checks agree, denies once quorum is unreachable. Three `ClaimType`s use all three
  Somnia agents (Web→parse, Data→JSON, Text→LLM). `release` (no skim) / `refund` / `markExpired`;
  escrow ring-fenced (`totalEscrow`), CEI + `nonReentrant`, **pull-payment** release; deadline →
  permissionless refund (funds never lock).
- **Opt-in yield** behind a pluggable `IYieldStrategy` (off by default; `DemoYieldStrategy` is the
  testnet stand-in). Release pays principal + yield; refund pays principal + pro-rata yield.
- **Security review** (multi-agent adversarial + Slither): 13 findings incl. a critical ERC-4626
  inflation attack on the yield strategy — all fixed with regression tests. Suite: **114**.
- **Web** rebuilt as Tsugu (kintsugi gold-seam): home gallery, create (multi-source + quorum +
  yield toggle), pact detail (live verdict + per-source consensus receipts + fund/verify/release/
  refund). `script/DeployVault.s.sol`; SDK exports the Vault ABI/address/enums.

### Added — fundamental AI layer

- **Contracts — `AgentCompute` (abstract base)** distilling `OracleAgent`'s hardened
  Somnia-Agents pattern (deposit math, the four callback guards, overpayment refund,
  reentrancy, `receive()` rebates) into one audited base, plus two new primitives on it:
  - **`LlmAgent`** — consensus LLM inference: `requestClassification` (constrained verdict —
    an advisory referee, e.g. `accept`/`reject`) and `requestNumber` (bounded score).
  - **`ParseAgent`** — consensus website extraction (`requestExtract`).
  - **Consensus receipts**: every successful request now records `{validators, finalizedAt,
    receiptId, executionCost(median)}` and emits `ConsensusReached` — the Somnia receipt data
    was previously discarded. Read via `receipts(id)` / `consensusOf(id)`.
  - `script/DeployCompute.s.sol`.

### Notes

- The Somnia LLM agent id + `inferString` ABI are **confirmed on the official console**
  (agents.somnia.network → LLM Inference: id `12847293847561029384`, signature
  `inferString(string,string,bool,string[])`, 0.24 SOMI deposit). A wrong live id/ABI degrades
  to `TimedOut` (handled) — it never corrupts stored state.

## [0.1.0] — 2026-06-02

Production-hardening pass: a security review (contracts, SDK, CLI, keystore) drove a
reentrancy fix + redeploy, the agent-operation capability that completes the platform,
and a much deeper test suite. All flows verified live on Somnia Shannon.

### Security

- **AgentRegistry.register is now `nonReentrant`** and reserves the name before minting.
  The previous order let a contract `owner` re-enter via `_safeMint`'s
  `onERC721Received` and register the same name twice (two agents, one name). The
  vulnerable deployment is deprecated; a guarded stack is redeployed (see
  `packages/contracts/DEPLOYMENTS.md`).
- **Transfer-safe HD index allocation.** New agents take the first HD index whose
  derived address has *never* owned an agent (chain history via `hasEverOwned`), not
  one that merely owns nothing now — so transferring an agent can't make a later
  `create` re-derive the same key.
- **Keystore hardening:** validate `version`/`type` before crypto; bound scrypt params
  (power-of-two `N` in `[2¹⁴, 2¹⁸]`) to block KDF downgrade *and* memory-exhaustion;
  fail loudly on a non-TTY instead of reading an empty secret.
- **OracleAgent:** refund a non-owner's overpayment (no longer trapped); `Refunded`/
  `Withdrawn` events; `withdrawAll`; `nonReentrant` on request/withdraw paths.
- Added [`SECURITY.md`](./SECURITY.md) — trust model, threat analysis, residual risks.

### Added

- **SDK**: `agentExecute(target, { to, value?, data?, operation? })` (drive the agent
  wallet, owner-gated), `transferAgent(name, to)`, `hasEverOwned(owner)`,
  `agentState(account)`, client-side `validateName` / `isValidName` / `parseStt`,
  `agentAccountAbi`, multi-RPC `rpcUrls` fallback transport.
- **CLI**: `tsugu exec` (make an agent act, auto-tops-up the owner key's gas) and
  `tsugu transfer` (hand an agent over). Client-side name + amount validation.
- **Contracts**: fuzz (name validation), invariant (registry guarantees), and
  security/abuse-path test suites.
- **CI**: `.github/workflows/ci.yml` — forge + vitest across all packages.

### Changed

- SDK `createAgent` reads the `AgentRegistered` event for its result instead of
  re-resolving by name. `viem` is now a **peer dependency** of the SDK.
- CLI `--version` is injected from `package.json` at build time (no drift).
- Bumped gas pins for Shannon's ~20× inflation; `hasEverOwned` pages `eth_getLogs`
  in 1000-block windows (Shannon's cap).

### Fixed

- `hasEverOwned` forces a fresh block number (`cacheTime: 0`) so an agent registered
  moments earlier isn't missed by viem's cached head — which would make a just-used
  index look free; pages `eth_getLogs` in 1000-block windows (Shannon's cap); and
  throws if `deployBlock` is ahead of the chain head rather than silently reporting
  "never owned".
- **CLI gas top-up is now sized from the live gas price × the SDK's pinned gas limit**
  (`opGasBudget`), not a static 0.01 STT floor that was smaller than the ~0.018 STT an
  `exec` actually authorizes — which could leave a freshly-topped owner key unable to
  send. `exec`/`transfer` exact-wei top-up via `sendWei`.
- `parseStt` rejects scientific/hex notation and >18 decimals with the friendly message
  instead of letting them reach `parseEther` (opaque) or silently truncate. CLI amounts
  are compared in wei end-to-end (no lossy `parseFloat`).
- `agentExecute`/`transferAgent` now `simulateContract` first, so underfunded wallets,
  non-receiver recipients, and bad ops fail pre-broadcast with a decoded reason.
- Doc accuracy: SDK README `{ chain }` (not `chainId`), corrected contract test counts.

### Verified on Shannon

- Identity: create → fund → **agent executes from its own wallet** → transfer; owner-gating
  and monotonic `hasEverOwned` confirmed on-chain.
- OracleAgent: `requiredDeposit` 0.12 STT, request → consensus callback → `latestPrice`
  (BTC $71,169.00, 3 validators).

## [0.0.x] — Day 1–3

Initial OracleAgent, identity layer, SDK, and the encrypted HD keychain CLI.
