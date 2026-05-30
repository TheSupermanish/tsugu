# @asom/cli

The `asom` command-line tool. Create and operate **self-sovereign agents** on Somnia — each agent gets a name, its own keypair, and an ERC-6551 wallet.

```bash
npm i -g @asom/cli
export PRIVATE_KEY=0x...         # your funded Somnia key — only needed for writes

asom create neo                  # generate neo's key + mint its NFT + wallet
asom resolve neo                 # look up an agent (no key needed)
asom available trinity           # is a name free?
asom ls                          # agents you own locally
asom fund neo --gas 0.01         # top up an agent's owner key / wallet
asom whoami                      # your funding address
```

## `asom create <name>`

Generates a **fresh keypair for the agent**, registers the NFT to that address (so the agent **owns itself**), deploys its ERC-6551 wallet, seeds the wallet, and funds the agent's owner key with gas — so it can act on its own.

```bash
asom create neo                       # defaults: --seed 0.02 (wallet), --gas 0.005 (owner key)
asom create neo --seed 0.05 --gas 0.01
```

The agent's private key is saved to `~/.asom/agents/neo.json` (chmod 600).

```
  neo@asom   self-sovereign agent

  token    #1
  wallet   0x3Ec0397677a61121CAe3b503835EDd3bB76061d3   ← ERC-6551 account (a contract)
  owner    0x60d7…                                         ← neo's own key, controls the wallet
  balance  0.0200 STT
  🔑 key   ~/.asom/agents/neo.json
  ⛽ gas    0.005 STT → owner (can act now)
```

## Two pockets, one agent

| Thing | What it is | Funded by |
|---|---|---|
| **wallet** (TBA) | the agent's ERC-6551 account — what it holds/spends | `--seed` |
| **owner key** | the EOA that *signs* for the agent (controls the wallet) | `--gas` |

`asom fund <name> --gas <stt> --wallet <stt>` tops up either pocket later.

## Bring your own key

The funding wallet (pays gas to create agents) is **yours** — set `PRIVATE_KEY` in your env or a `.env` file. The CLI never stores it. Out of STT? It points you at the faucet. Per-agent keys *are* stored, under `~/.asom/agents/` (plaintext, chmod 600 — testnet only; encryption before mainnet).

| Env var | Purpose | Required |
|---|---|---|
| `PRIVATE_KEY` | Your funding signer (writes: `create`, `fund`) | writes only |
| `SHANNON_RPC_URL` | RPC override | no |

Built on [`@asom/sdk`](../sdk).
