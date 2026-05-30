import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Address } from "viem";
import { TSUGU_HOME } from "./keystore.js";

/**
 * Local record of agents you own, under ~/.tsugu/agents/<name>.json.
 *
 * These files hold NO secrets — just public, on-chain-derivable facts (name,
 * tokenId, wallet, owner). Safe to sync or commit. The only secret in tsugu is
 * your key, which lives encrypted in the keystore (see keystore.ts).
 */

const AGENTS_DIR = join(TSUGU_HOME, "agents");

export interface AgentFile {
  name: string;
  /** ERC-6551 token-bound account — the agent's on-chain wallet (a contract). */
  account: Address;
  /** NFT owner = who controls the agent (the agent's own derived address in HD mode). */
  owner: Address;
  /** BIP-44 address index this agent's key is derived from (HD mode). Null in single-key mode. */
  index: number | null;
  tokenId: string;
  chainId: number;
  createdAt: string;
}

export function agentPath(name: string): string {
  return join(AGENTS_DIR, `${name}.json`);
}

export function saveAgent(file: AgentFile): void {
  if (!existsSync(AGENTS_DIR)) mkdirSync(AGENTS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(agentPath(file.name), JSON.stringify(file, null, 2) + "\n", { mode: 0o644 });
}

export function readAgent(name: string): AgentFile | null {
  const path = agentPath(name);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AgentFile;
  } catch {
    return null;
  }
}

/** Next free HD address index for a new agent. Index 0 is the funding account,
 *  so agents start at 1. Uses max(existing)+1 so deleting a record won't reuse. */
export function nextAgentIndex(): number {
  const used = listAgents()
    .map((a) => a.index)
    .filter((i): i is number => typeof i === "number");
  return used.length === 0 ? 1 : Math.max(...used) + 1;
}

export function listAgents(): AgentFile[] {
  if (!existsSync(AGENTS_DIR)) return [];
  return readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(AGENTS_DIR, f), "utf8")) as AgentFile;
      } catch {
        return null;
      }
    })
    .filter((a): a is AgentFile => a !== null);
}
