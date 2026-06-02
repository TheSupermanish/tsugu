# Tsugu

**Money that moves on proof, not promises.** Built on [Somnia](https://docs.somnia.network/).

Online giving is broken by trust — is the GoFundMe real? did the founder hit the milestone?
is the patient actually sick? Tsugu fixes it: you fund anything worth funding, the money is
held safe, and it's released **only when the claim is proven true**. No middleman decides —
Somnia's consensus AI fetches the real evidence, the funds release the instant it's verified,
and anyone can see exactly why. *Give without fear. Raise without being doubted.*

> Brand soul: **kintsugi** — something breaks, Tsugu mends it, and the corroborated proof is the
> gold in the seam.

Built for the [Encode Club × Somnia Agentathon](https://www.encodeclub.com/programmes/agentathon).

## How a Pact works

A **Pact** is an AI-verified conditional escrow:

1. **Fund** — anyone opens a Pact (a claim worth funding) and contributors escrow STT. The money
   is held by the contract, not a middleman.
2. **Verify** — Somnia's consensus AI reads the real evidence from **multiple independent sources**
   and classifies it. A pact carries *N* checks and a **quorum (M-of-N)**: it confirms only when
   *M* independent checks agree, and denies the moment quorum is unreachable. Each check is its own
   consensus call with its own on-chain receipt (validator count + median cost).
3. **Release / Refund** — proven true → escrow releases to the beneficiary (**no skim**); proven
   false or undecided by the deadline → contributors refund. Every verdict is on-chain.

One mechanism, many use cases — *the range is the point:*

| Kind | The claim that releases the money |
|---|---|
| **Relief** | a disaster is AI-confirmed from news / data |
| **Medical** | a patient's care is verified against a report |
| **Fundraise** | a founder's milestone is verified |
| **Insurance** | a parametric trigger (flight delay, quake) fires |
| **Custom** | any claim backed by evidence |

`PactKind` is framing for humans — the resolver is identical for all.

## Three Somnia agents, one verdict

Each evidence check routes to the right Somnia base agent. All three are used:

| Check type | Somnia agent | What it does |
|---|---|---|
| **Web** | parse-website | reads the page AND classifies it `confirmed`/`denied` in one consensus call |
| **Data** | JSON-API | a structured boolean from a live endpoint |
| **Text** | LLM-inference | consensus reasoning over a pasted statement / evidence — no URL |

Tsugu's `Vault` is built on **`AgentCompute`** — the hardened Somnia-Agents base (deposit math,
the four callback guards, overpayment refund, reentrancy, `receive()` rebates, and **consensus
receipts**). The verdict that moves money is trustworthy because it's a *validator subcommittee
agreeing on real evidence*, recorded on-chain — only possible on Somnia.

### Optional yield

A Pact can opt in to **earn yield while it waits** (off by default). Escrow is put to work via a
pluggable `IYieldStrategy`; on release the beneficiary gets principal **+ yield**, and a refund
returns each contributor's principal **+ their share of yield**. (`DemoYieldStrategy` is a labelled
testnet stand-in; mainnet swaps in a real lending/staking adapter behind the same interface.)

## Live on Somnia Shannon (chain 50312)

| Contract | Address |
|---|---|
| **Vault** (Pacts) | [`0x5F7CF1e3206140CB73e5365E287AE8D1d7B770dC`](https://shannon-explorer.somnia.network/address/0x5F7CF1e3206140CB73e5365E287AE8D1d7B770dC) |
| **DemoYieldStrategy** (testnet yield) | [`0xFFFF7c37D382e17B88A4F92c363dE6511E9bDfEF`](https://shannon-explorer.somnia.network/address/0xFFFF7c37D382e17B88A4F92c363dE6511E9bDfEF) |

Five demo pacts are live — four **2-of-2 multi-source** (Web/parse + Text/LLM) and one **Data-only**
(JSON-API) — so **all three Somnia agents are proven live end-to-end**, each verdict backed by an
on-chain consensus receipt. Full addresses + tx in
[`packages/contracts/DEPLOYMENTS.md`](./packages/contracts/DEPLOYMENTS.md).

## Security

The money path was put through a **multi-agent adversarial review** (every finding independently
verified) plus Slither — not just self-review. It surfaced **13 findings, including a critical**
ERC-4626 inflation attack on the yield strategy (reproduced with a PoC). **All fixed**, each with a
regression test; a re-review of the patches came back clean. Escrow is ring-fenced, every value
path is CEI + `nonReentrant`, release is pull-payment, and funds can never lock (deadline →
permissionless refund). See [`SECURITY.md`](./SECURITY.md).

## Stack

- **Contracts:** Solidity 0.8.24 (Foundry), OpenZeppelin 5.0.2 — `Vault is AgentCompute`
- **SDK / CLI:** TypeScript + viem ([`@asom/sdk`](./packages/sdk), [`@asom/cli`](./packages/cli))
- **Web:** Next.js app (`apps/web`) — kintsugi gold-seam UI, self-custodial (you sign every write)
- **Monorepo:** pnpm workspaces + Turborepo
- **Chain:** Somnia Shannon testnet (50312)

## Quickstart

```bash
pnpm install

# contracts — 182 tests (lifecycle, all 3 agents, quorum, escrow ring-fence, reentrancy, yield)
pnpm contracts:test
cp packages/contracts/.env.example packages/contracts/.env   # add PRIVATE_KEY

# deploy the Vault + yield strategy, then set the address in packages/sdk/src/vault.ts
forge script script/DeployVault.s.sol --rpc-url shannon --broadcast --legacy --gas-estimate-multiplier 2000

# web app
pnpm --filter @asom/web dev               # http://localhost:3000
```

Deployed addresses + live verification: [`packages/contracts/DEPLOYMENTS.md`](./packages/contracts/DEPLOYMENTS.md).
Somnia AI grounding (agent ids, ABIs, deposit math): [`docs/SOMNIA_AI.md`](./docs/SOMNIA_AI.md).
