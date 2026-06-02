# Somnia AI Infrastructure — and how asom maximizes it

*Lead architect synthesis · verified 2026-06-02 · target chain: Somnia Shannon testnet (50312)*

asom is an on-chain agent-identity + economy layer on Somnia: named `name@asom` agents, each with an ERC-6551 token-bound account (TBA), that can execute calls and transfer ownership. This report maps Somnia's native AI infrastructure to a concrete integration plan for asom's **discovery + coordination** layer — agents advertising capabilities and hiring/paying each other — and identifies the *fundamental AI primitives* worth building on top.

The strategic thesis, verified across four independent research passes: **Somnia ships the AI compute, the consensus, and the automation substrate, but it has not shipped an open, permissionless discovery/coordination/identity layer.** That gap is exactly asom's wedge. Lean on Agents + Reactivity + AA; own discovery + coordination + identity.

---

## 1. The Agents platform — mechanics and economics

Somnia Agents is an on-chain framework for invoking decentralized off-EVM compute (LLM inference, HTTP/JSON fetch, website parsing) from a smart contract, with **multi-validator consensus** baked into the result. It is the headline primitive of Somnia's April-2026 repositioning as "the Agentic L1."

### Call flow

A contract calls a single platform contract:

```solidity
function createRequest(
    uint256 agentId,
    address callbackAddress,
    bytes4  callbackSelector,
    bytes   calldata payload
) external payable returns (uint256 requestId);
```

A randomly elected **subcommittee of validators (default size 3)** re-runs the named agent off-EVM, reaches consensus, and the platform pushes the result back into your contract asynchronously via the callback selector you registered. This is **not** a synchronous round-trip: `createRequest` returns a `requestId` immediately; the AI result lands in a *later block* through your callback. Design for a `Pending` state.

**Platform addresses** (source: [docs.somnia.network/agents/invoking-agents/from-solidity](https://docs.somnia.network/agents/invoking-agents/from-solidity)):
- Testnet (Shannon, chain 50312): `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776`
- Mainnet (chain 5031): `0x5E5205CF39E766118C01636bED000A54D93163E6`
- **Same `agentId` works on both networks**; only the platform address differs (confirmed: [blog.somnia.network — Building on the Agentic L1](https://blog.somnia.network/p/building-on-the-agentic-l1-a-developers)).

### Consensus & the tunable variant

A second entrypoint lets you dial the committee per request:

```solidity
function createAdvancedRequest(
    uint256 agentId, address callbackAddress, bytes4 callbackSelector, bytes calldata payload,
    uint256 subcommitteeSize, uint256 threshold, ConsensusType consensusType, uint256 timeout
) external payable returns (uint256 requestId);

enum ConsensusType { Majority, Threshold }   // Majority = ≥ threshold byte-identical results
enum ResponseStatus { None, Pending, Success, Failed, TimedOut }
```

Under `Majority`, at least `threshold` validators must return **byte-identical** `.result` before `status == Success`. Determinism (fixed seeds, temperature=0 for the LLM agents) is what makes this possible. Under `Threshold`, results may legitimately differ. (The exact success/payout semantics of `Threshold` mode beyond "results may differ" is **UNVERIFIED** — docs are terse.)

### The callback contract

```solidity
function handleResponse(
    uint256 requestId, Response[] memory responses, ResponseStatus status, Request memory details
) external {
    require(msg.sender == address(platform));   // 1. gate on platform sender
    require(pendingRequests[requestId]);        // 2. gate on a request you made
    delete pendingRequests[requestId];
    if (status == ResponseStatus.Success) {     // 3. branch on status BEFORE decode
        require(responses.length > 0);          // 4. guard empty before decode
        uint256 v = abi.decode(responses[0].result, (uint256));
    } // else handle Failed / TimedOut
}
receive() external payable {}                    // REQUIRED — platform pushes the rebate here
```

All four guards are wired in asom's reference `OracleAgent.sol` (`/Users/beyond/Desktop/projects/asom/packages/contracts/src/agents/OracleAgent.sol`, lines ~129–157), and the canonical types are pinned in `/Users/beyond/Desktop/projects/asom/packages/contracts/src/agents/lib/SomniaAgents.sol` — verified against the live repo. **Note:** the lib now declares `IAgentRequester` (createRequest/getRequestDeposit), `IAgentRequesterAdvanced` (createAdvancedRequest/getAdvancedRequestDeposit), an extended `IJsonApiAgent` (fetchUint/Int/String/Bool), `ILlmAgent` (inferString/inferNumber), `IParseAgent` (ExtractString), and `SomniaAgentIds`; pure payload encoders live in `SomniaAI.sol`. Still NOT declared (add before use): `getRequest`/`hasRequest` introspection and the longer-tail fns (fetchStringArray/fetchUintArray/inferChat/inferToolsChat/ExtractANumber).

### Economics (the part that bites you)

`msg.value` is split into:
1. **Operations reserve** = `minPerAgentDeposit × subcommitteeSize` — funds validator gas refunds, callback gas, keeper upkeep. This is what `getRequestDeposit()` returns (for the default committee).
2. **Agent reward pot** = everything above the reserve, distributed as `perAgentBudget = rewardPot / subcommitteeSize` (emitted in `RequestCreated`).

Validators are ultimately paid the **median** of reported `executionCost`; the unused remainder is **rebated to the requester** on finalization (hence the mandatory `receive()`).

```
deposit = platform.getRequestDeposit() + (pricePerAgent × subcommitteeSize)
```

**CRITICAL FAILURE MODE:** if you send only the reserve floor, `perAgentBudget = 0`, runners skip the request (`perAgentBudget < scheduledExecutionCost`), and it ends `TimedOut`. You *must* fund the reward pot on top of `getRequestDeposit()`.

> **Always read `getRequestDeposit()` live on-chain** — do not hardcode. Per asom's firsthand Shannon findings, platform reads are precompile-backed and **revert inside `forge` simulation/`staticcall`** — query via `cast`, off-chain, at request time. The exact `minPerAgentDeposit` constant is **UNVERIFIED** (docs describe the split formula but not the value). The `~0.12 STT` JSON-API total is confirmed live in asom's `DEPLOYMENTS.md`; the LLM/Parse totals below are estimates assuming `minPerAgentDeposit == pricePerAgent`.

---

## 2. Available AI agents / models catalog

Exactly **three** live base agents (Phase 1). Identical `agentId`s on testnet and mainnet. No image/embedding/audio/dedicated-price-feed agent exists yet; custom user-defined agents are a Phase-2 (2026) roadmap item with no firm date (**UNVERIFIED** timing).

| Agent | agentId | Input (key fns) | Output | Cost / validator | Total @ sub=3 | Determinism |
|---|---|---|---|---|---|---|
| **JSON API Request** (`json-fetch`) | `13174292974160097713` ✅ | `fetchUint(url,selector,decimals)`, `fetchInt`, `fetchString`, `fetchBool`, `fetchStringArray`, `fetchUintArray` | typed scalar / array | 0.03 STT | **~0.12 STT** ✅ live | Deterministic (data fetch) |
| **LLM Inference** (`llm-inference`, Qwen3-30B) | `12847293847561029384` ✅ | `inferString(prompt,system,cot,allowedValues[])`, `inferNumber(prompt,system,min,max,cot)`, `inferChat(roles[],msgs[],cot)`, `inferToolsChat(...mcpUrls[],OnchainTool[],maxIterations,cot)` | string / int256 / chat / agentic tuple | 0.07 STT | **0.24 SOMI** ✅ console | Deterministic: fixed seed + temp=0 → byte-identical |
| **LLM Parse Website** (`llm-parse-website`) | `12875401142070969085` ✅ | `ExtractString(key,desc,options[],prompt,url,resolveUrl,numPages,confidence)`, `ExtractANumber(...,min,max,...)` | string / uint256 | 0.10 STT | ~0.33 STT (est.) | Deterministic extraction; `confidenceThreshold` (0–100) gates |

**ID provenance:** JSON (`131742…`) and Parse (`128754…`) are confirmed via the dev blog and on-chain reads of the mainnet AgentRegistry. The **LLM Inference ID `12847293847561029384` is now confirmed on the official Somnia console** ([agents.somnia.network](https://agents.somnia.network/) → *LLM Inference*, observed 2026-06-02): the console shows the exact ID, the `inferString(string prompt, string system, bool chainOfThought, string[] allowedValues)` signature (byte-for-byte our `ILlmAgent`/`SomniaAI` encoder), `4 methods available` (incl. `inferChat`/`inferToolsChat`, not wrapped), and a **0.24 SOMI** deposit (matching our prior estimate). Still *not* in the static from-Solidity docs page, which uses a *placeholder* ID (`12345678901234567890`). **Not yet exercised in a live consensus round** — `inferNumber`/`inferChat`/`inferToolsChat` ABIs and the actual round-trip remain to be verified on Shannon (the deploy + live-verify step).

**Notable agent details:**
- **`decimals` scaling** (JSON agent): `decimals=8` turns `42000.50` into `4200050000000`. Selector syntax is dot/bracket notation: `bitcoin.usd`, `data.price`, `items[0].name`.
- **`inferString` allowedValues** constrains output to an enum (e.g. `["accept","reject"]`) — ideal for trustless classification/judging.
- **`inferToolsChat`** is an agentic loop: `OnchainTool { string signature; string description; }` lets the LLM call **back into on-chain contract functions** during reasoning, and `mcpServerUrls[]` lets off-chain MCP tools join. This is the primitive for "LLM-as-coordinator."
- **Parse Website** `resolveUrl=true` = domain-search mode (discovers pages first); `false` = direct scrape (numPages capped at 1). `reasoning`/`answerable`/`confidence_score` exist in receipts but are excluded from ABI output.

**UNVERIFIED:** token/context-length limits, max prompt/message counts, `maxIterations` bounds, the exact `responses[].result` schema for LLM agents (whether chain-of-thought is appended), and the default `TimedOut` deadline duration. Testnet token is STT; docs label per-validator prices in "SOMI" (mainnet denomination) — asom's deploy config treats JSON reward as `0.03 STT`, consistent.

---

## 3. What "Somnia's agent registry/discovery" actually is — and how asom complements it

This is where the dossier corrected an initial assumption, so it matters for asom's positioning.

### Two distinct contracts the docs blur

1. **The invocation platform** (`createRequest`, selector `0x8bbcbbe2`) — what you *call*. It is **not** a registry: calling `agentCount()`/`getAgent()` on it reverts.
2. **A real, enumerable AgentRegistry** — verified on-chain on **mainnet** at `0xaD3101C37F091593fEe7cb471e92b5E9A1205194` (an EIP-1967 proxy, impl `0x0805bde…`). It exposes `agentCount()` (=3), `getAllAgents() → uint256[]`, and `getAgent(uint256) → (uint256 id, string metadataJsonUri, string tarUri)`. Each metadata JSON (hosted on Google Cloud Storage, author "Somnia Team") carries `name, description, version, author, abi, tags`.

### The three hard truths about Somnia's registry

- **It is NOT documented.** Official docs/blog never mention it; they tell developers to discover agents via the web Explorer ([agents.somnia.network](https://agents.somnia.network/)) and hardcode numeric IDs. Treat `0xaD3101…` as *real-but-undocumented, upgradeable* infra — not a stable public API. (**UNVERIFIED** "official" status; inferred from the GCS bucket + holding exactly the 3 canonical agents.)
- **It is curated, not permissionless.** It holds only Somnia's ~3 first-party base agents. No public `registerAgent` was found. Third parties cannot self-advertise.
- **It is mainnet-only.** `0xaD3101…` has **empty bytecode on Shannon testnet (50312)**. On testnet, treat the 3 IDs as hardcoded constants. Also: 2 of 3 on-chain `metadataJsonUri` pointers currently 404 (versioned/append-style bucket) — don't hard-depend on a stored URI resolving.
- A separate **third-party** registry exists (`0xC9f3452090EEB519467DEa4a390976D38C008347`, the community `somnia-agent-kit` SDK by `xuanbach0212`, 55 demo agents, different ABI `getTotalAgents`). **Not authoritative — do not wire asom to it.**

### How asom's discovery layer complements it

| Somnia's registry | asom's discovery layer |
|---|---|
| Curated catalog of ~3 platform-owned AI primitives | **Open, permissionless directory** any `name@asom` agent self-registers in |
| Mainnet-only, undocumented read path | First-class, indexed, on Shannon today; testnet-native |
| No hiring, payment, or reputation | **Task board**: agents hire/pay each other, escrow, reputation |
| Metadata = name/desc/abi/tags (off-chain GCS) | **Mirror the same schema** for interop |

**Position asom as "the registry for everyone else's agents,"** layered on top of Somnia's registry for the base AI primitives. Concretely:
- **Adopt Somnia's metadata schema** (`name, description, version, author, abi, tags`) so an asom agent looks uniform to a coordinator alongside a Somnia base agent.
- **Bridge entries:** let an asom agent advertise a capability that *is* a Somnia base agent (e.g. capability `price-oracle` → JSON agent `13174292974160097713` + a `fetchUint` payload template). The task board routes a hired task to a human-owned asom agent **or** a Somnia AI agent transparently — the ERC-6551 wallet funds the `createRequest` deposit.
- **Resolver pattern:** one asom discovery interface, two backing stores — check asom's directory first, fall back to Somnia's `getAgent()` for base primitives (hardcode the 3 IDs on testnet).
- Shared **tag vocabulary** (`json, api, oracle, llm, inference, ai`) so "find an agent that can do X" spans both registries.

---

## 4. Reactivity / automation for AI workflows

Somnia ships **keeperless, native automation** as a chain primitive — the missing engine for autonomous AI agents that act without a server.

### Mechanism (verified)

- Precompile at **`0x0100`** (`SomniaExtensions.SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS`). Package: `@somnia-chain/reactivity-contracts`.
- A handler inherits `SomniaEventHandler` and overrides `_onEvent(address emitter, bytes32[] calldata eventTopics, bytes calldata data)`. The precompile invokes it as a **separate synthetic transaction** with `msg.sender == 0x0100`, `tx.origin == subscription owner`, `msg.value == 0`.
- **Same block, but NOT atomic:** the triggering tx commits first, then validators include a synthetic tx that runs the handler in the same block. Do not assume revert-the-event semantics.
- Subscribe via `SomniaExtensions.subscribe(address handler, SubscriptionFilter, SubscriptionOptions)`. Wildcard-only subscriptions (all of `eventTopics`/`origin`/`emitter` zero) are **rejected** — you must pin at least a topic/emitter/origin.

### Scheduling / cron (the AI-workflow enabler)

Set `emitter = 0x0100` and use a system-event topic:
- **`BlockTick(uint64)`** — `eventTopics[1]=0` → fires *every block* (recurring heartbeat, ~10×/sec on Shannon); specific number → one-shot.
- **`EpochTick(uint64,uint64)`** — `eventTopics[1]=0` → end of *every epoch* (~5 min); specific → one-shot.
- **`Schedule(uint256)`** — one-shot, fires at first block whose timestamp ≥ target; **target in milliseconds** (mostly confirmed; ms-vs-seconds was returned inconsistently once — confirm before relying on it for deadlines). The TS SDK enforces a ≥12s lead time.

**Event chaining:** a handler can emit an event matching the next subscription, cascading multi-step workflows in one block (hackathon examples chained 4–7 subscriptions). This is the substrate for keeperless AI pipelines: *fetch → reason → act*.

### Funding & limits

- Owner must hold **≥ 32** native tokens at subscription creation — a sybil floor, **not escrowed/consumed**. Per-firing cost is normal gas `(baseFee + priorityFeePerGas) × gasUsed` from the owner's balance. `gasLimit` ≤ 200,000,000; min base fee 6 gwei; subscription creation ~210k gas.
- A subscription is **auto-removed** if the owner can't cover `(baseFee+priorityFee) × gasLimit` at fire time. Recurring every-block subs (or self-re-triggering handlers) drain balance fast — agents running heartbeats need a documented STT buffer.

> **UNVERIFIED:** the 32-token / 6-gwei / 200M constants are documented in **SOMI (mainnet)**; whether the exact figures/units apply on Shannon (STT) must be confirmed on-chain. The convenience helper names `scheduleSubscriptionAtTimestamp/atBlock/atEpoch` could not be confirmed against source — the *verified* path is subscribing to the `BlockTick/EpochTick/Schedule` system events. Reactivity is currently **testnet-only** per docs.

### Off-chain alternative

WebSocket `eth_subscribe` + `somnia_watch` (`@somnia-chain/reactivity` + viem) pushes matching logs (and optional read-only `eth_call` simulation) to a client. Free, no SOMI, but purely observational — good for the asom task-board UI/indexer, **cannot produce on-chain effects by itself.**

---

## 5. Ecosystem / infra to lean on

- **Chain performance:** EVM L1, ~101ms blocks, sub-second finality, MultiStream Consensus (per-validator data chains + modified-PBFT consensus chain, DA decoupled from finality). The **1M+ TPS figure is a *devnet* benchmark** — testnet processed 10B+ txs cumulatively; mainnet ~14.3M tx/day. **CORRECTION from dossier:** drop any "sustained 500k–800k TPS on testnet" claim — it's unsupported. For a credible narrative: cite 1M TPS as a devnet benchmark, lean on the genuinely good profile (sub-cent fees, ~100ms blocks, sub-second finality) for real-time coordination, not on peak benchmarks.
- **Account abstraction:** Ingot hard fork added EIP-7702 (`authorizationList`). **CAUTION:** the specific RPCs `somnia_getSessionAddress` / `somnia_sendSessionTransaction` are **UNVERIFIED** — no authoritative Somnia source found (a docs `?ask=` query merely echoed the prompt). Do **not** build asom session flows on those RPC names yet; EIP-7702 via standard `authorizationList` is the safe path.
- **Data infra:** Ormi & Protofire subgraphs (indexing); DIA + Protofire price feeds (USDT/USDC/BTC/SOL/WETH/SOMI etc.); Somnia Data Streams (typed pub/sub, no Solidity).
- **Tooling:** Foundry/Hardhat/Remix/viem/ethers all work. Faucets: official hub, Google Cloud Web3, Stakely, Thirdweb.
- **Grants:** Dreamathon ($200k incubator, returning 2026, explicitly lists **AI agents** as a target category — exact dates UNVERIFIED); Dream Catalyst ($10M); $270M ecosystem fund.

### Shannon EVM constraints (firsthand-verified, undocumented — these will bite)

- **Paris-only EVM:** no PUSH0 (Shanghai), no `mcopy` (Cancun) — invalid opcodes burn all gas. **Pin `evm_version=paris`, solc 0.8.24, OpenZeppelin v5.0.2** (5.2+ uses `mcopy`, won't run). ERC-1271 via OZ `SignatureChecker` is **deferred** in asom for this reason (`DEPLOYMENTS.md`).
- **~20× mainnet gas** per tx/byte; `forge`'s estimator undercounts 7–10× — pass generous explicit gas.
- **Platform reads revert inside `forge` simulation** (precompile-backed) — keep `getRequestDeposit`/registry reads off-chain via `cast`.
- **`eth_getLogs` capped at 1000-block range** + very fast blocks ⇒ long scans need a subgraph/indexer, not live `getLogs`. (asom's SDK already bounds scans with the registry deploy block 398072018.)
- **ERC-6551 on Somnia is undocumented** but asom has it **live and verified** on Shannon (full create→exec→transfer lifecycle, 2026-06-02, `DEPLOYMENTS.md`).

---

## IMPLEMENTATION STATUS (updated 2026-06-02)

- **Tier 1.1 — generalized compute mixin: DONE.** `AgentCompute` (abstract) distills the
  `OracleAgent` pattern; `LlmAgent` (inference: classify/number) and `ParseAgent` (web extract)
  are built on it. All three base agents are now reusable on-chain primitives.
- **Tier 1.3 — AI-judged settlement: DONE (advisory).** `LlmAgent.requestClassification` with
  `allowedValues=["accept","reject"]` is exposed via `asom ai judge` and the console's "Ask AI to
  judge". It informs the poster; the deployed `TaskBoard` is unchanged (no contract gets unilateral
  payout authority — a deliberately conservative, no-redeploy choice).
- **Consensus receipts: DONE.** The platform `Response.receipt` / `executionCost` data (previously
  discarded) is now captured per request by `AgentCompute` (`consensusOf(id)` + `ConsensusReached`).
- **Somnia AgentRegistry resolver: DONE (read-only, optional).** `AsomClient.resolveSomniaAgents()`
  reads Somnia's mainnet registry (`getAllAgents`/`getAgent`) and falls back to the hardcoded
  `SomniaAgentIds` on testnet — the §3 two-store resolver. Surfaced by `asom somnia`.
- **Deferred: Tier 2.x reactivity (precompile `0x0100`).** Keeperless schedules, self-refreshing
  oracles, and auto-settling task boards remain UNVERIFIED (constants/units, testnet-only) and are
  not built. The console's Workflows page demonstrates the `fetch → reason → act` pipeline
  client-side without depending on the precompile.

## INTEGRATION PLAN FOR ASOM

Ranked by **impact ÷ effort**. asom already has the hard parts (identity, TBAs, a hardened `OracleAgent.sol` wired to the JSON agent). The wins are in generalizing that into a *capability* and adding the coordination economics Somnia lacks.

### Tier 1 — Highest impact, lowest effort (build first)

**1.1 — `OmniAgentAdapter`: generalize `OracleAgent` into a 3-agent capability mixin.**
*Impact: very high. Effort: low (the pattern exists).* Extend `SomniaAgents.sol` to declare `ILlmAgent` (`inferString/inferNumber/inferChat/inferToolsChat`) and `IParseAgent` (`ExtractString/ExtractANumber`), plus `createAdvancedRequest`, `getAdvancedRequestDeposit`, `getRequest`, `hasRequest`. Then make the existing `OracleAgent` request/callback pattern a reusable mixin any `name@asom` agent's TBA can call via `AgentAccount.execute(platform, deposit, createRequestCalldata, 0)`. Result on `handleResponse` writes back to the agent's own state. **This turns "call AI" from a single shared contract into a per-agent verb.** All four callback guards + `receive()` carry over unchanged.

**1.2 — Capability tags mapped to real Somnia agentIds (the discovery primitive).**
*Impact: very high. Effort: low.* In the discovery layer, let an agent advertise typed capabilities — `cap:json-fetch`, `cap:llm-classify`, `cap:llm-number`, `cap:llm-chat`, `cap:llm-tools`, `cap:web-extract` — where each maps to a concrete `agentId` + payload schema (mirroring Somnia's `{name,description,abi,tags}` manifest). A hiring agent can then **verify the capability is real and estimate cost** via `getRequestDeposit()`/`getAdvancedRequestDeposit()` *before* hiring. Hardcode the 3 base IDs as constants on testnet (registry isn't deployed there).

**1.3 — AI-judged task settlement (trustless arbiter).**
*Impact: very high. Effort: low–medium.* When an agent submits work to the task board, gate payout with `inferString(prompt, system, false, ["accept","reject"])` under `Majority` consensus — the validator subcommittee becomes a **decentralized, hard-to-game referee**, no central arbiter. The median-`executionCost` payout model is also a clean template for how asom agents *price and pay each other*. Extend to reputation: `Parse Website` to pull a deliverable's external proof + `inferNumber` to score it, feeding an on-chain reputation value.

### Tier 2 — High impact, medium effort

**2.1 — Reactivity-powered task board (keeperless coordination engine).**
*Impact: high. Effort: medium.* Use precompile `0x0100`:
- **Deadlines/escrow auto-settlement:** post a one-shot `Schedule` subscription at a task's deadline; if the worker hasn't delivered, the handler auto-refunds the poster or releases escrow. No operator.
- **Self-maintaining discovery index:** subscribe to `CapabilityListed/Updated` events → a handler updates the on-chain index in the same block (no indexer). Pair with the free `somnia_watch` WebSocket feed for a live UI.
- **"No centralized cron" robustness story** — strong for the Dreamathon AI-agents track and for the *platform-quality* bar asom holds (other devs build on this).
- *Watch-out:* fund agent TBAs above the (verify-on-chain) minimum-balance floor; expose this buffer in the CLI during agent provisioning so a self-invoking agent doesn't silently stop.

**2.2 — Self-refreshing oracle / AI heartbeat.**
*Impact: high. Effort: medium.* Give an agent's TBA (or a small companion handler) a recurring `BlockTick`/`EpochTick` subscription whose `_onEvent` calls `createRequest` — e.g. periodically re-fetch a price or re-run an LLM check. Turns `OracleAgent.requestUintFromJson` into a self-refreshing oracle with zero off-chain keeper.

**2.3 — On-chain AI pipelines via event chaining.**
*Impact: high. Effort: medium.* `OracleAgent.handleResponse` already emits `PriceReceived(requestId, price, timestamp)`. A reactive handler subscribed to that event feeds the result into a second AI call (e.g. LLM `inferNumber` to interpret it), building a keeperless multi-stage **fetch → reason → act** workflow entirely on Somnia. This is the buildable core of "fundamental AI primitives."

### Tier 3 — High impact, higher effort / more uncertainty

**3.1 — LLM-as-coordinator ("agent hires agent," feasibility of AI-drives-AI).**
*Impact: very high. Effort: high. Feasibility: plausible but unproven — flag as experimental.* `inferToolsChat` with `OnchainTool` entries pointing at asom's task-board functions lets an LLM autonomously discover capabilities, post/claim tasks, and pay other agents — the LLM becomes the coordinator driving the asom economy, with `mcpServerUrls` bringing off-chain MCP tools in. Also usable as a **semantic matchmaker**: on task post, an asom coordinator invokes the LLM to rank which advertised agents best fit. *Risk:* `maxIterations`/context limits are UNVERIFIED; deterministic consensus on open-ended tool-calling output is the unknown — prototype small, measure consensus-success rate before depending on it.

**3.2 — Higher-assurance tier + agent working capital.**
*Impact: medium-high. Effort: medium.* Expose `createAdvancedRequest` so a poster can dial up `subcommitteeSize`/`threshold` for high-value tasks and pay more, with `perAgentBudget`/median economics shown transparently. Route platform **rebates back into each agent's TBA** (the `receive()` already does this) so agents accumulate the deposit-minus-median slack as operating surplus — a clean primitive for self-funding autonomous agents.

**3.3 — Phase-2 positioning: asom identity *is* agent identity.**
*Impact: strategic. Effort: design-now, build-later.* Design asom so a registered `name@asom` can *become* a Somnia custom agent when Phase 2 ships (timing UNVERIFIED). asom identity = agent identity gives those agents native consensus-backed compute and a head start.

### Explicitly deprioritized / blocked
- Session-key RPCs (`somnia_getSessionAddress`/`somnia_sendSessionTransaction`) — **UNVERIFIED, do not build on yet.** Use standard EIP-7702 `authorizationList` if AA is needed.
- Wiring to the third-party `0xC9f3…` registry — community, not authoritative.
- Depending on the mainnet AgentRegistry read path on testnet (not deployed there) or on stored `metadataJsonUri` resolving (some 404).

---

### Key sources
Platform/interface/economics: [docs.somnia.network/agents/invoking-agents/from-solidity](https://docs.somnia.network/agents/invoking-agents/from-solidity), [blog.somnia.network — Building on the Agentic L1](https://blog.somnia.network/p/building-on-the-agentic-l1-a-developers). Agents catalog: [docs.somnia.network/agents](https://docs.somnia.network/agents) + base-agent pages (`json-api-request`, `llm-inference`, `llm-parse-website`). Reactivity: [docs.somnia.network/developer/reactivity/reactivity-onchain](https://docs.somnia.network/developer/reactivity/reactivity-onchain), cron-subscriptions-via-sdk tutorial. Network: [docs.somnia.network/developer/network-info](https://docs.somnia.network/developer/network-info). asom repo (live-verified 2026-06-02): `/Users/beyond/Desktop/projects/asom/packages/contracts/src/agents/lib/SomniaAgents.sol`, `.../OracleAgent.sol`, `.../DEPLOYMENTS.md`.
