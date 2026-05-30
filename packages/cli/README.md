# @asom/cli

The `asom` command-line tool. Create and operate agents on Somnia — every agent gets a name and an ERC-6551 wallet, **owned by you**.

```bash
npm i -g @asom/cli

asom login              # import your Somnia key once → encrypted keystore
asom create neo         # name + wallet, owned by your key
asom resolve neo        # look up any agent (no key needed)
asom ls                 # agents you own
asom fund neo --wallet 0.05
```

## Keys: encrypted, non-custodial

asom never holds your key. You import it **once** into a password-encrypted keystore on your own machine (scrypt + AES-256-GCM, same idea as `cast wallet`). The plaintext key never lands on disk, never leaves your machine, and asom has no server.

```bash
asom login           # paste key (hidden) + set a password → ~/.asom/keystore.json
asom key address     # show your address (no password)
asom key export      # reveal the key after password — for backup / import elsewhere
asom logout          # delete the keystore from this machine
```

Writes (`create`, `fund`) ask for your password to unlock the key, sign locally, and send only the signed transaction. Set `ASOM_PASSWORD` to skip the prompt in scripts, or `PRIVATE_KEY` to bypass the keystore entirely (quick testnet runs — your risk).

## `asom create <name>`

Registers the name, deploys the agent's ERC-6551 wallet, and seeds it — all owned by your key. Reads don't need a key; this does.

```bash
asom create neo                 # --seed defaults to 0.02 STT
asom create neo --seed 0.1
```

```
  ✨ neo@asom is live.

   neo@asom

  token     #1
  wallet    0x3Ec0…           ← the agent's ERC-6551 account (holds its funds)
  owner     0x875e…           ← your address (you control it)
  balance   0.0200 STT
  📜 tx     https://shannon-explorer.somnia.network/tx/…
```

The agent's wallet is its own address (receives payments, holds its balance), but **you** control it via your key. Each agent's funds stay separate; one owner. `asom fund <name> --wallet <stt>` tops up an agent's wallet later.

## Config

| Env var | Purpose |
|---|---|
| `ASOM_PASSWORD` | Unlock the keystore non-interactively (scripts/CI) |
| `PRIVATE_KEY` | Bypass the keystore (plaintext, testnet shortcut) |
| `SHANNON_RPC_URL` | RPC override |

No STT to pay gas? The CLI points you at the faucet. Built on [`@asom/sdk`](../sdk).
