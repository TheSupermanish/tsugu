export { TsuguClient, capabilityTag } from "./client.js";
export type { Agent, TsuguClientOptions, TsuguAddresses, Task } from "./client.js";
export { shannon } from "./chain.js";
export { deployments } from "./addresses.js";
export {
  agentRegistryAbi,
  agentNftAbi,
  agentAccountAbi,
  capabilityRegistryAbi,
  taskBoardAbi,
  llmAgentAbi,
  parseAgentAbi,
  somniaAgentRegistryAbi,
} from "./abis.js";
export { validateName, isValidName, parseStt } from "./validate.js";
export { somniaAgents, somniaPlatform, somniaAgentRegistry } from "./somnia.js";
export type { SomniaAgentInfo } from "./somnia.js";
export type { AiKind, AiResult, ExtractParams } from "./client.js";
// Tsugu Vault — AI-verified conditional escrow (Pacts).
export { vaultAbi, vaultDeployments, PACT_KINDS, CLAIM_TYPES, CHECK_STATUS, PACT_STATUS, CLAIM_AGENT } from "./vault.js";
export type { PactKind, ClaimType, CheckStatus, PactStatus } from "./vault.js";
