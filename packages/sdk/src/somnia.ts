import type { Address } from "viem";

/**
 * Canonical Somnia AI agents — the consensus-verified compute an asom agent can
 * offer as a capability. Same `agentId` on testnet and mainnet; only the platform
 * address differs. See repo docs/SOMNIA_AI.md.
 *
 * `status` reflects how confirmed each agent is — calling one with a wrong id OR a
 * wrong payload selector burns the createRequest deposit (it just TimedOuts), so both
 * axes matter:
 *   - "verified"     id + ABI confirmed (jsonApi: exercised byte-identically by the live OracleAgent)
 *   - "id-verified"  id confirmed on-chain, ABI/selectors per docs only — verify before relying on payloads
 *   - "experimental" id itself unconfirmed — do not depend on without checking agents.somnia.network
 */
export const somniaAgents = {
  jsonApi: { id: 13174292974160097713n, status: "verified", capability: "somnia.json-fetch" },
  // Somnia's base LLM agent. id + inferString ABI confirmed on the official console
  // (agents.somnia.network → LLM Inference: same id, signature
  // `inferString(string,string,bool,string[])`, 0.24 SOMI deposit). Our LlmAgent wraps it.
  // Stays "id-verified" until we exercise it in a live Shannon round (then → "verified").
  llmInference: { id: 12847293847561029384n, status: "id-verified", capability: "somnia.llm-inference" },
  parseWebsite: { id: 12875401142070969085n, status: "id-verified", capability: "somnia.parse-website" },
} as const;

/** Somnia Agents platform contract (what you CALL to invoke an agent), by chain id. */
export const somniaPlatform: Record<number, Address> = {
  50312: "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776", // Shannon testnet
  5031: "0x5E5205CF39E766118C01636bED000A54D93163E6", // Somnia mainnet
};

/**
 * Somnia's enumerable, curated AgentRegistry (what you READ to discover base agents) —
 * distinct from the invocation platform above. **Mainnet-only and undocumented**: it
 * has empty bytecode on Shannon testnet, so there is intentionally no testnet entry.
 * On testnet, resolve base agents from the hardcoded `somniaAgents` constants instead.
 * See docs/SOMNIA_AI.md §3 — treat as real-but-upgradeable infra, not a stable API.
 */
export const somniaAgentRegistry: Record<number, Address> = {
  5031: "0xaD3101C37F091593fEe7cb471e92b5E9A1205194", // Somnia mainnet (EIP-1967 proxy)
};

/** A Somnia base agent resolved from either the on-chain registry (mainnet) or the
 *  hardcoded constants (testnet). `source` tells you which backed it. */
export interface SomniaAgentInfo {
  id: bigint;
  capability?: string;
  status?: string;
  metadataJsonUri?: string;
  tarUri?: string;
  source: "registry" | "constants";
}
