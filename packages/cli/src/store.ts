import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";

/**
 * Local agent store under ~/.asom (override with ASOM_HOME).
 *
 *   ~/.asom/agents/<name>.json — a generated, self-sovereign agent: its own
 *   key, owner address, ERC-6551 wallet, and tokenId.
 *
 * The funding key (the wallet that pays gas to create agents) is NOT stored
 * here — you bring your own via the PRIVATE_KEY env var or a .env file.
 *
 * Agent keys are stored in plaintext (chmod 600). Fine for the Shannon testnet —
 * `cast wallet` and most dev tooling do the same — but these files must be
 * encrypted before anything here controls mainnet value.
 */

export const ASOM_HOME = process.env.ASOM_HOME || join(homedir(), ".asom");
const AGENTS_DIR = join(ASOM_HOME, "agents");

type Hex = `0x${string}`;

export interface AgentFile {
  name: string;
  /** The agent's own EOA — owns its NFT and controls its wallet. */
  ownerAddress: Address;
  ownerKey: Hex;
  /** ERC-6551 token-bound account (the agent's on-chain wallet; a contract). */
  account: Address;
  tokenId: string;
  chainId: number;
  createdAt: string;
}

/** Generate a fresh keypair for a new agent. */
export function generateAgentKey(): { privateKey: Hex; address: Address } {
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;
  return { privateKey, address };
}

export function agentPath(name: string): string {
  return join(AGENTS_DIR, `${name}.json`);
}

export function saveAgent(file: AgentFile): void {
  if (!existsSync(AGENTS_DIR)) mkdirSync(AGENTS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(agentPath(file.name), JSON.stringify(file, null, 2) + "\n", { mode: 0o600 });
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
