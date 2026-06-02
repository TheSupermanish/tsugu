# Deployments

## Shannon testnet (chain 50312)

### Identity layer (current) — hardened, reentrancy-guarded

`<name>@tsugu` agents with ERC-6551 wallets. `register()` is now `nonReentrant` and
reserves the name before minting — closing the `_safeMint` reentrancy that let a
malicious owner claim one name twice (see [`../../SECURITY.md`](../../SECURITY.md)).

| Contract | Address |
|---|---|
| **AgentRegistry** (name resolver + factory) | [`0x9Df3c688e2aE988Ff63672A98335d3BEfAdC452E`](https://shannon-explorer.somnia.network/address/0x9Df3c688e2aE988Ff63672A98335d3BEfAdC452E) |
| **AgentNFT** (ERC-721 ownership token) | [`0x2DCD1758CaA40c004cA9F8593b032c384eA10925`](https://shannon-explorer.somnia.network/address/0x2DCD1758CaA40c004cA9F8593b032c384eA10925) |
| **ERC6551Registry** (TBA factory) | [`0x7f3b56f5D737010885FaAeAa771fb2e61d33Ec8B`](https://shannon-explorer.somnia.network/address/0x7f3b56f5D737010885FaAeAa771fb2e61d33Ec8B) |
| **AgentAccount** (TBA implementation) | [`0x4c4e4B24613c285e33c4c0b5DB0603936A0df600`](https://shannon-explorer.somnia.network/address/0x4c4e4B24613c285e33c4c0b5DB0603936A0df600) |

Registry deploy block: **398072018** (the SDK uses this to bound `hasEverOwned` log scans).
`AgentNFT.minter` is wired to the registry and locked.

**Live end-to-end verification (2026-06-02)** — the full self-sovereign lifecycle,
run against this deployment with an HD-derived owner key (`qa-c9d36e@tsugu`, token #1,
wallet [`0xe462…55C1`](https://shannon-explorer.somnia.network/address/0xe4622f4768A3Dfc0b6cB5619Ee2Bf5b793da55C1)):

| Step | Result | Tx |
|---|---|---|
| **create** | agent minted, wallet seeded 0.02 STT, owned by its own derived key | [`0x0b68…9242`](https://shannon-explorer.somnia.network/tx/0x0b6891118348de2d2261788a5ec9977664f47a386048c4661b88df9936b99242) |
| **exec** | agent sent **0.005 STT from its own wallet** (0.02 → 0.015) | [`0x66e3…de6e`](https://shannon-explorer.somnia.network/tx/0x66e3429df99f49de43f87da37fe029d2de30c65bd9d8a29d2a7e0b603fc4de6e) |
| non-owner exec | **rejected** (owner-gated) | — |
| **transfer** | ownership moved; `resolve()` reflects new owner; `hasEverOwned(old)` stays true | [`0x377b…7092`](https://shannon-explorer.somnia.network/tx/0x377b13cdc531a27a3f7f9a19d758035a6ff86fe0f2308ebd4c6cc34ba5597092) |

Reproduce with `PRIVATE_KEY=0x… tsx packages/cli/scripts/verify-shannon.mts`.

**Notes for integrators:**
- `register(name, owner)` is payable — forwarded STT seeds the new agent wallet.
- Transfer the AgentNFT → the agent's wallet control transfers with it. No migration.
- `AgentAccount.execute(to, value, data, 0)` is how an agent acts — owner-gated.
- Names: lowercase `a-z`, `0-9`, hyphen; 1–32 chars; no leading/trailing/doubled hyphen.
- ERC-1271 (smart-account signatures) is deferred: OZ's `SignatureChecker` uses `mcopy`
  (Cancun), unavailable on Shannon's pre-Shanghai EVM. OZ pinned to v5.0.2.

#### Identity layer v1 (deprecated)

| Contract | Address | Status |
|---|---|---|
| AgentRegistry | [`0xa98a6d4BC0099D2fc5D1d81a79770592c2a91a08`](https://shannon-explorer.somnia.network/address/0xa98a6d4BC0099D2fc5D1d81a79770592c2a91a08) | **Deprecated** |

**Do not use.** `register()` followed checks-effects-interactions incorrectly: the
duplicate-name guard ran before the name record was written, so a contract `owner`
could re-enter via `onERC721Received` and register the same name twice (two agents,
one name). Replaced by the guarded deployment above. Reference only.

---

### Coordination layer (current) — discovery + the agent economy

The open, permissionless complement to Somnia's (mainnet-only, curated) AI-agent
registry: any `name@tsugu` agent advertises capabilities and agents hire/pay each
other. See [`../../docs/SOMNIA_AI.md`](../../docs/SOMNIA_AI.md) for how this layers on
Somnia's AI infra.

| Contract | Address |
|---|---|
| **CapabilityRegistry** (discovery) | [`0xb92168c5D637A3087Da85f757c607F2f508DDc96`](https://shannon-explorer.somnia.network/address/0xb92168c5D637A3087Da85f757c607F2f508DDc96) |
| **TaskBoard** (coordination / escrow) | [`0xA59f329689fD5DA78D0fE79dc285297E050a2B16`](https://shannon-explorer.somnia.network/address/0xA59f329689fD5DA78D0fE79dc285297E050a2B16) |

Hardened across two adversarial review rounds: `MAX_TAGS` (64) cap + `providersPage`
paginated discovery (anti-DoS), payout safety assert, and — closing a HIGH found on
re-review — `submitResult` now enforces the deadline so a worker can't front-run the
poster's refund and steal the escrow. Supersedes `0x8f8A…`/`0x0C44…` and `0x023e…752c`.
Wired to the identity stack: `TaskBoard.caps` → CapabilityRegistry, `.nft`/`.registry`
→ the hardened identity deployment. Rewards pay into the worker agent's ERC-6551 wallet.

**Live end-to-end verification (2026-06-02, hardened)** — advertise → discover → post →
accept → submit → approve, worker `wkr-42a553@tsugu` (token 6):

| Step | Tx |
|---|---|
| **advertise** `demo.echo` (then `providers("demo.echo") = [6]`) | [`0x2de3…ee32`](https://shannon-explorer.somnia.network/tx/0x2de36500403b85533ed4348552b1baa56fe846f3c19cff25d6994d3b257fee32) |
| **postTask** #1 (0.02 STT escrowed) | [`0xbad0…652e`](https://shannon-explorer.somnia.network/tx/0xbad0b1830bc737a856e5f49f1860521e6c2ab75638bc66e2649a0795b142652e) |
| **accept** + submit + **approve** → reward into the agent's wallet (0 → 0.02 STT) | [`0x389b…e986`](https://shannon-explorer.somnia.network/tx/0x389bbaa47af34a40bce7fe828d0fdf0f335a9d9ed6fcf1fbf7f8342933b1e986) · [`0x55a4…4b18`](https://shannon-explorer.somnia.network/tx/0x55a43fc21fafb01664b2b12cb36a14a934db07558a63b8755d4a64f46be34b18) |

Reproduce: `PRIVATE_KEY=0x… tsx packages/cli/scripts/verify-coordination.mts`.

---

### OracleAgent (current) — hardened

Consensus-verified price oracle via the Somnia Agents JSON API. Adds a non-owner
overpayment **refund**, `Withdrawn`/`Refunded` events, a `withdrawAll` sweep, and
`nonReentrant` on the request/withdraw paths.

| Field | Value |
|---|---|
| Address | [`0x4C9Fab534F97c76F4Ed6895Fda07Eb601f363188`](https://shannon-explorer.somnia.network/address/0x4C9Fab534F97c76F4Ed6895Fda07Eb601f363188) |
| Platform | `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776` |
| Agent ID | `13174292974160097713` (JSON API) · subcommittee 3 · per-agent reward 0.03 STT |
| Required deposit | **0.12 STT** (read live via the precompile) |
| Access model | **Caller-pays** — non-owners forward `msg.value ≥ requiredDeposit()`; overpayment refunded. |

**Live verification (2026-06-02):** seeded 0.15 STT
([`0x0fb6…48d7`](https://shannon-explorer.somnia.network/tx/0x0fb6dde5728a6e8790daead26ddab17a8bd21a3314c3c1cc2dc7e6c2415248d7)),
then `requestBitcoinPrice()` (requestId `3864073`,
[`0x8352…8cf5`](https://shannon-explorer.somnia.network/tx/0x8352ae9190dd65d11c451f762e424b7f143e43b87de64ef53ea53ccf9e088cf5)).
Consensus callback updated `latestPrice = 7,116,900,000,000` → **BTC = $71,169.00**
(8 decimals, 3 validators); `pendingRequests` cleared.

#### OracleAgent — earlier deploys (deprecated)

| Address | Status |
|---|---|
| [`0xC221B027E8Ba0f9c680c3c55533105BC1491Ae79`](https://shannon-explorer.somnia.network/address/0xC221B027E8Ba0f9c680c3c55533105BC1491Ae79) | Superseded by the hardened deploy above (refund + events + guards). |
| [`0x272A6F953C17FB528aE0d5085629A9024F1c6DE0`](https://shannon-explorer.somnia.network/address/0x272A6F953C17FB528aE0d5085629A9024F1c6DE0) | Day-1 open-callable `requestUintFromJson` (DoS / arbitrary-URL). Funds withdrawn. |

## Notes for integrators

- **Reading** `latestPrice()`/`lastUpdated()` is free. Always check
  `block.timestamp - lastUpdated()` before trading on the value — there is no
  automatic staleness guard.
- **Requesting** a fresh price costs `requiredDeposit()` (0.12 STT). Non-owners send it
  as `msg.value`; overpayment is refunded.
- All four canonical Somnia Agents pitfalls (deposit math, `receive()`, callback gating,
  status branching) are tested in `test/OracleAgent.t.sol`.
- See `src/agents/lib/SomniaAgents.sol` for the canonical platform types — pin imports
  against this file, not the docs, so a doc revision can't silently break compilation.

## Test coverage

`forge test` → **102** (identity + fuzz + invariant + security + oracle + coordination + SomniaAI).
`pnpm --filter @tsugu/sdk test` → **34** · `pnpm --filter @tsugu/cli test` → **29**. CI runs all three.
