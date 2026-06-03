# Deployments

## Shannon testnet (chain 50312)

### Tsugu — Vault + yield strategy

`Vault is AgentCompute` — the AI-verified conditional escrow (**Pacts**). Multi-source M-of-N
quorum across all three Somnia agents (Web→parse, Data→JSON, Text→LLM); opt-in yield; escrow
ring-fenced; pull-payment release. Security-reviewed (multi-agent adversarial + Slither); a
critical ERC-4626 inflation attack on the yield strategy was found and fixed. `forge test` → **114**.

| Contract | Address |
|---|---|
| **Vault** (Pacts) | [`0x5F7CF1e3206140CB73e5365E287AE8D1d7B770dC`](https://shannon-explorer.somnia.network/address/0x5F7CF1e3206140CB73e5365E287AE8D1d7B770dC) |
| **DemoYieldStrategy** (testnet yield reserve) | [`0xFFFF7c37D382e17B88A4F92c363dE6511E9bDfEF`](https://shannon-explorer.somnia.network/address/0xFFFF7c37D382e17B88A4F92c363dE6511E9bDfEF) |

Config: platform `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776`, subcommittee 3, per-agent reward
0.1 STT → `requiredDeposit()` ≈ **0.33 STT per check** (caller-paid). Earlier redeploys are
superseded (iteration during the security review).

**Live end-to-end verification (2026-06-02 → 03)** — five demo pacts, each CONFIRMED by real
consensus AI with per-check on-chain receipts (validator count + median execution cost):

| Pact | Kind | Claim | Verified by |
|---|---|---|---|
| #0 | Relief | Hurricane Katrina (Aug 2005) | Web/parse + Text/LLM (2-of-2) |
| #1 | Medical | Insulin treats diabetes | Web/parse + Text/LLM (2-of-2) |
| #2 | Fundraise | Ethereum = smart-contract chain | Web/parse + Text/LLM (2-of-2) |
| #3 | Medical + **yield** | Penicillin = antibiotic | Web/parse + Text/LLM (2-of-2) |
| #4 | Insurance | external task complete | Data/JSON `fetchBool` (1-of-1) |

Pact #3 opted into yield: principal 2 STT → after a reserve top-up, `yieldValue` ≈ 2.2 STT (+0.2);
release pays principal + yield. Pact #4 is resolved purely by the **JSON-API agent**
(`fetchBool` over a live endpoint → `true` → Confirmed), so **all three Somnia agents (parse,
JSON, LLM) are live-verified** end-to-end.

Reproduce: `forge script script/DeployVault.s.sol --rpc-url shannon --broadcast --legacy --gas-estimate-multiplier 2000`,
then create + fund a pact and call `requestResolution(pactId, checkIndex)` per check (≈0.33 STT each).

---

### Somnia AI engine (what the Vault builds on)

The Vault calls Somnia's base agents directly through `AgentCompute` + `SomniaAI` (no separate
agent contracts to deploy). Canonical ids (same on both networks; only the platform address
differs) — see [`src/agents/lib/SomniaAgents.sol`](./src/agents/lib/SomniaAgents.sol):

| Agent | Somnia id | Used for |
|---|---|---|
| parse-website | `12875401142070969085` | Web claim checks |
| JSON-API | `13174292974160097713` | Data claim checks |
| LLM-inference | `12847293847561029384` | Text claim checks |

`LlmAgent` / `ParseAgent` (in `src/agents/`) are standalone reference wrappers on the same base;
the Vault does not require them deployed. `OracleAgent` (the JSON reference impl) is deployed at
[`0x4C9Fab534F97c76F4Ed6895Fda07Eb601f363188`](https://shannon-explorer.somnia.network/address/0x4C9Fab534F97c76F4Ed6895Fda07Eb601f363188)
(live-verified BTC price fetch, 2026-06-02).

## Notes for integrators

- A resolution is **caller-paid**: forward `msg.value ≥ requiredDeposit()` (≈0.33 STT/check);
  non-owner overpayment is refunded by the base `_dispatch`.
- Pin contract imports against `src/agents/lib/SomniaAgents.sol` (the canonical platform types),
  not the docs, so a doc revision can't silently break compilation.

## Test coverage

`forge test` → **114** (Vault + yield + AgentCompute + SomniaAI + the three agent wrappers).
`pnpm --filter @tsugu/sdk test` → **7**. CI runs both.
