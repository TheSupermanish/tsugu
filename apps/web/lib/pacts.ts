import { createPublicClient, http } from "viem";
import { shannon } from "@asom/sdk";
import { vaultAbi, vaultAddress, type Pact } from "./vault";

const RPC = process.env.SHANNON_RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL ?? "https://dream-rpc.somnia.network";

const client = createPublicClient({ chain: shannon, transport: http(RPC) });

export type PactRow = { id: number; pact: Pact };

/** Read every pact straight from the Vault (no indexer), newest first. */
export async function loadPacts(): Promise<PactRow[]> {
  const count = (await client.readContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "pactCount",
  })) as bigint;

  const n = Number(count);
  if (n === 0) return [];

  const ids = Array.from({ length: n }, (_, i) => n - 1 - i); // newest first
  const rows = await Promise.all(
    ids.map(async (id) => {
      const pact = (await client.readContract({
        address: vaultAddress,
        abi: vaultAbi,
        functionName: "getPact",
        args: [BigInt(id)],
      })) as Pact;
      return { id, pact };
    }),
  );
  return rows;
}
