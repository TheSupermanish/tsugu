# Security

asom is a platform other developers build on. This document states the trust
boundaries, the threat model, and the known constraints so integrators don't
inherit a footgun. If you find a vulnerability, please open a private security
advisory on the GitHub repository rather than a public issue.

## Trust model

| Component | Who is trusted | What it protects |
|---|---|---|
| **AgentNFT** | the `minter` (set once to AgentRegistry) | only the registry can mint; token IDs/names stay consistent |
| **AgentRegistry** | nobody (permissionless `register`) | name uniqueness, strict name validation, one-name→one-agent |
| **AgentAccount** (ERC-6551 wallet) | the bound NFT's current owner | only the owner can `execute`; control follows the NFT |
| **ERC6551Registry** | nobody (permissionless `createAccount`) | deterministic, idempotent account address; binding is in bytecode |
| **CLI keystore** | the local machine + your password | the seed never leaves your machine in plaintext |
| **Somnia Agents platform** | the platform contract `0x037Bb9…6776` | only it may invoke `OracleAgent.handleResponse` |

The headline guarantee: **holding AgentNFT #N is controlling agent #N** — its
name, its wallet, and its funds. Transferring the NFT transfers everything, with
no migration. `resolve()` always reports the live owner.

## Contract-level protections

- **Reentrancy.** `AgentRegistry.register` is `nonReentrant` and writes the name
  reservation *before* minting. `_safeMint` calls `onERC721Received` on a contract
  recipient; without the guard a malicious `owner` could re-enter `register` during
  that callback — before the name record is written — and claim the same name
  twice, minting two agents that both believe they own one name. The guard +
  checks-effects-interactions ordering close that window. Regression-tested in
  `test/AgentIdentitySecurity.t.sol` (both swallowing and non-swallowing attackers).
  `OracleAgent.requestUintFromJson`/`withdraw`/`withdrawAll` are `nonReentrant` too.
- **Name validation** is strict and on-chain (lowercase `a-z`, `0-9`, hyphen; 1–32
  chars; no leading/trailing/doubled hyphen). Multi-byte UTF-8 and homoglyphs are
  rejected at the byte level. Differentially fuzzed against a reference spec in
  `test/AgentIdentityFuzz.t.sol`.
- **Owner-gated execution.** `AgentAccount.execute` reverts `NotAuthorized` for any
  caller that is not the current NFT owner — proven to hold even under reentrancy
  (a callee that calls back into `execute` is not the owner) and across transfers.
- **Permissionless account creation is safe.** Anyone can deploy the counterfactual
  TBA for any token; doing so grants no control — the binding is read from the
  account's own bytecode footer, and only the NFT owner can operate it.
- **Somnia Agents wiring.** `OracleAgent` and the `AgentCompute` base satisfy the four
  canonical pitfalls: deposit = `getRequestDeposit()` + reward pot; `receive()` accepts
  rebates; `handleResponse` is gated on `msg.sender == platform` and a known `requestId`;
  and `ResponseStatus` is checked before any `abi.decode`. A non-owner's overpayment is
  refunded rather than trapped. `AgentCompute._dispatch` is `nonReentrant` and subclass
  entrypoints add no second guard (a double lock would revert). Regression-tested in
  `test/AgentCompute.t.sol` (incl. a refund-reentrancy attacker).
- **AI compute primitives (`LlmAgent` / `ParseAgent`).** Caller-pays funding (non-owners
  forward `≥ requiredDeposit()`, overpay refunded) prevents draining a contract's working
  capital. A successful callback records a **consensus receipt** (validator count + median
  execution cost) before the subclass decodes — so a result's consensus backing is auditable.
  A `Failed`/`TimedOut` callback decodes nothing and leaves no poisoned state (`numberReady` /
  `extractionReady` distinguish a real `0`/`""` from "no result"). The **LLM agent id is
  experimental**: a wrong live id/ABI degrades to `TimedOut`, never to a corrupted verdict.
- **AI-judged settlement is advisory.** The LLM "accept/reject" verdict (`asom ai judge`,
  the console's "Ask AI to judge") is surfaced to the **poster**, who still calls
  `approveTask`/`refund`. The deployed `TaskBoard` is unchanged and grants no contract
  unilateral payout authority — there is no new trust assumption from AI judging.
- **Browser-wallet signing.** The web console builds `AsomClient` from an injected viem
  `WalletClient`; asom holds no key and every state change is signed by the user's own wallet.

### Documented residual risks (by design, on testnet)

- **Front-running `register`.** Like any first-come namespace, a pending
  `register(name, owner)` can be front-run. Acceptable for a testnet land-grab;
  a commit–reveal scheme is the production answer if name-sniping becomes real.
- **`OracleAgent.owner` is immutable.** If the deployer key is lost, funds in the
  oracle are unrecoverable. Day-1 scope; bind to `AgentNFT.ownerOf` or `Ownable2Step`
  before mainnet.
- **Price staleness.** `latestPrice()` has no built-in staleness guard. Consumers
  MUST check `block.timestamp - lastUpdated()` before trading on it.

## Key management (CLI)

asom is **non-custodial**: there is no server, and your key never leaves your
machine. One BIP-39 seed is encrypted at `~/.asom/keystore.json` with
**scrypt (N=2¹⁵, r=8, p=1) → AES-256-GCM**. Every account is derived from it
(BIP-44 `m/44'/60'/0'/0/i`): index 0 funds agent creation; index 1+ is each
agent's own self-sovereign key.

Hardening in `keystore.ts` (tested in `test/keystore.test.ts`):

- The plaintext seed is never written to disk; the keystore is `0600` in a `0700` dir.
- Passwords are **not trimmed** (leading/trailing spaces are significant) — so a
  keystore stays loadable verbatim on another machine.
- On load, the envelope is validated before any crypto: `version`/`type` are checked,
  and KDF params are bounded — scrypt `N` must be a power of two within
  `[2¹⁴, 2¹⁸]` (rejects both a brute-force **downgrade** and an
  inflated value that could force a **memory-exhaustion OOM**).
- A truncated/forged GCM tag fails the integrity check.
- On a non-TTY with no `ASOM_PASSWORD`/`PRIVATE_KEY`, the CLI fails loudly rather
  than silently reading an empty secret.

**HD index allocation is transfer-safe.** New agents are assigned the first HD
index whose derived address has *never* owned an agent (`hasEverOwned`, from
on-chain `AgentRegistered` history) — not merely one that owns nothing *right now*.
This means selling or transferring an agent can never cause a later `create` to
re-derive that same key for a new agent.

**Trade-offs to know:**

- `PRIVATE_KEY` (plaintext env) and `ASOM_PASSWORD` are supported for automation
  but are visible to child processes — prefer the interactive keystore for real keys.
- Do not mix single-key (`PRIVATE_KEY`) and HD (seed) modes against agents you
  intend to keep recoverable from one place.

## Considered, deferred

- **AAD-binding the keystore envelope** (authenticate `address`/KDF params with the
  GCM tag): correct, but a format change that would invalidate existing keystores.
  The explicit `version`/`type` + KDF-bound checks above cover the practical tampering
  vectors; AAD is a clean follow-up behind a keystore `version` bump.
- **An indexer/subgraph for `hasEverOwned`.** The live event scan is bounded by
  Shannon's 1000-block `eth_getLogs` cap and grows with registry age; a production
  deployment should front it with an indexer instead of scanning the chain.

## Shannon EVM constraints (why the gas looks unusual)

Shannon is pre-Shanghai and inflates gas ~20× vs mainnet:

- Contracts compile with `evm_version = "paris"` (no `PUSH0`); OpenZeppelin is
  pinned to **v5.0.2** (no `mcopy`/Cancun). ERC-1271 via OZ's `SignatureChecker` is
  therefore deferred until Shannon ships Cancun.
- The SDK pins explicit, generous gas on every write (you only pay what's used).
  Forge's estimator undercounts Shannon by ~8×, so deploys use a high
  `--gas-estimate-multiplier`.
