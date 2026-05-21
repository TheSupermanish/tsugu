# Deployments

## Shannon testnet (chain 50312)

### OracleAgent (current) — hardened post-review

| Field | Value |
|---|---|
| Address | [`0xC221B027E8Ba0f9c680c3c55533105BC1491Ae79`](https://shannon-explorer.somnia.network/address/0xC221B027E8Ba0f9c680c3c55533105BC1491Ae79) |
| Deployer / owner | `0x875eFb079A2b68267a1bE03cAd0E1A7Ee4bA0B2E` |
| Platform | `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776` |
| Agent ID | `13174292974160097713` (JSON API) |
| Subcommittee size | 3 |
| Per-agent reward | 0.03 STT |
| Required deposit | 0.12 STT |
| Access model | **Caller-pays** — non-owners must forward `msg.value >= requiredDeposit()`. Owner may spend contract balance. |

**Deploy + seed (2026-05-21):**

| Step | Block | Tx |
|---|---|---|
| Deploy | 388,449,876 | [`0x924a...0162`](https://shannon-explorer.somnia.network/tx/0x924a83e659b5c33f2da3e84fc11e44a95028774083fa6a72e8ba7c2b12860162) (15.9M gas) |
| Seed (0.15 STT) | — | [`0xe550...a808e`](https://shannon-explorer.somnia.network/tx/0xe55031f683b8afd1610f3883ed2d994d76b028b1ae8586192e871566869a808e) |
| `requestBitcoinPrice()` | 388,450,063 | [`0x63f7...ec2d`](https://shannon-explorer.somnia.network/tx/0x63f79f26d14ae67d930728ed3725607de674b4d4d8d99013abe66f61c11cec2d) (655k gas) |

**Result:** `latestPrice = 7,715,000,000,000` → **BTC = $77,150.00** (8 decimals, consensus of 3 validators)

### OracleAgent v1 (deprecated)

| Field | Value |
|---|---|
| Address | [`0x272A6F953C17FB528aE0d5085629A9024F1c6DE0`](https://shannon-explorer.somnia.network/address/0x272A6F953C17FB528aE0d5085629A9024F1c6DE0) |
| Status | **Deprecated.** Open-callable `requestUintFromJson` permitted DoS + arbitrary-URL attacks against contract balance. Funds withdrawn back to owner. |
| Withdraw tx | [`0x3a45...d141`](https://shannon-explorer.somnia.network/tx/0x3a4599c83b80d281642d96336cb5b5b12200072c88933c960592e4009969d141) |

Do not use. Reference only for the history of the initial Day-1 deploy.

## Notes for integrators

- **Reading** `latestPrice()` and `lastUpdated()` is free (view functions, no gas). Always check `block.timestamp - lastUpdated()` before trading on the value — there is no automatic staleness guard.
- **Requesting** a fresh price costs `requiredDeposit()` (currently 0.12 STT). Send it as `msg.value` if you are not the contract owner.
- All four canonical Somnia Agents pitfalls (deposit math, `receive()`, callback gating, status branching) are tested in `test/OracleAgent.t.sol` (20/20 passing).
- See `src/agents/lib/SomniaAgents.sol` for the canonical platform types — pin imports against this file, not the docs directly, so a doc revision can't silently break compilation.
