# @tsugu/sdk

TypeScript SDK for [Tsugu](../../README.md) — read and write AI-verified escrow **Pacts** on
Somnia. Built on [viem](https://viem.sh).

Exports:

- `vaultAbi`, `vaultDeployments` (Vault + yield-strategy addresses by chain)
- `PACT_KINDS`, `CLAIM_TYPES`, `CHECK_STATUS`, `PACT_STATUS`, `CLAIM_AGENT` (+ their types)
- `shannon` (the Somnia Shannon chain), `somniaAgents` / `somniaPlatform` (Somnia AI constants)
- `validateName` / `isValidName`, `parseStt` (client-side helpers)

```ts
import { createPublicClient, http } from "viem";
import { vaultAbi, vaultDeployments, shannon } from "@tsugu/sdk";

const client = createPublicClient({ chain: shannon, transport: http() });
const vault = vaultDeployments[shannon.id].vault;
const pact = await client.readContract({ address: vault, abi: vaultAbi, functionName: "getPact", args: [0n] });
```

Writes (createPact / contribute / requestResolution / release / refund) are plain `vaultAbi`
calls via a wallet client — the [web app](../../apps/web) is the reference integration.
