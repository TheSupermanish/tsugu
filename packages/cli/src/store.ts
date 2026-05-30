import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Address } from "viem";
import { ASOM_HOME } from "./keystore.js";

/**
 * Local record of agents you own, under ~/.asom/agents/<name>.json.
 *
 * These files hold NO secrets — just public, on-chain-derivable facts (name,
 * tokenId, wallet, owner). Safe to sync or commit. The only secret in asom is
 * your key, which lives encrypted in the keystore (see keystore.ts).
 */

const AGENTS_DIR = join(ASOM_HOME, "agents");

export interface AgentFile {
  name: string;
  /** ERC-6551 token-bound account — the agent's on-chain wallet (a contract). */
  account: Address;
  /** NFT owner = who controls the agent. Your address (you own everything). */
  owner: Address;
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
