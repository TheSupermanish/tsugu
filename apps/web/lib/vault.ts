import { formatEther, type Address } from "viem";
import {
  vaultAbi,
  vaultDeployments,
  shannon,
  PACT_KINDS,
  CLAIM_TYPES,
  PACT_STATUS,
  CHECK_STATUS,
  type PactKind,
  type ClaimType,
  type PactStatus,
  type CheckStatus,
} from "@tsugu/sdk";

export { vaultAbi };
export type { PactKind, ClaimType, PactStatus, CheckStatus };
export const vaultAddress = vaultDeployments[shannon.id].vault as Address;
export const strategyAddress = vaultDeployments[shannon.id].strategy as Address;
export const vaultDeployBlock = vaultDeployments[shannon.id].deployBlock;
export const EXPLORER = "https://shannon-explorer.somnia.network";

/** Explicit gas limits — Shannon's gas is ~20x and the estimator undercounts, so we
 *  pin generous limits (unused gas is refunded) to keep writes from reverting. */
export const GAS = {
  create: 18_000_000n,
  contribute: 5_000_000n,
  resolve: 25_000_000n,
  settle: 6_000_000n,
  expire: 3_000_000n,
} as const;

// --- on-chain shapes (mirror Vault.sol structs) -------------------------------

export type Check = {
  claimType: number;
  resolveUrl: boolean;
  source: string;
  jsonPath: string;
  status: number;
  requestId: bigint;
  answer: string;
};

export type Pact = {
  creator: Address;
  beneficiary: Address;
  kind: number;
  status: number;
  quorum: number;
  deadline: bigint;
  confirmedAt: bigint;
  disputeWindow: bigint;
  escrow: bigint;
  yieldOn: boolean;
  shares: bigint;
  claim: string;
  checks: readonly Check[];
};

// --- enum helpers -------------------------------------------------------------

export const kindName = (k: number): PactKind => PACT_KINDS[k] ?? "Custom";
export const claimName = (c: number): ClaimType => CLAIM_TYPES[c] ?? "Web";
export const statusName = (s: number): PactStatus => PACT_STATUS[s] ?? "Open";
export const checkName = (s: number): CheckStatus => CHECK_STATUS[s] ?? "Pending";

// --- presentation metadata ----------------------------------------------------

export const KIND_META: Record<PactKind, { label: string; blurb: string; glyph: string }> = {
  Relief: { label: "Relief", blurb: "Disaster aid, released when the event is verified", glyph: "🜂" },
  Medical: { label: "Medical", blurb: "Care funded against verified medical evidence", glyph: "✛" },
  Fundraise: { label: "Fundraise", blurb: "Raised against milestones, verified one by one", glyph: "△" },
  Insurance: { label: "Insurance", blurb: "Parametric payout when the trigger is confirmed", glyph: "◈" },
  Custom: { label: "Custom", blurb: "Any claim backed by evidence", glyph: "✶" },
};

export const CLAIM_META: Record<ClaimType, { label: string; agent: string; glyph: string }> = {
  Web: { label: "Web page", agent: "Parse-website agent", glyph: "🌐" },
  Data: { label: "Data feed", agent: "JSON-API agent", glyph: "{ }" },
  Text: { label: "Statement", agent: "LLM-inference agent", glyph: "✎" },
};

export type Tone = "gold" | "amber" | "rust" | "jade" | "neutral" | "dim";

export const STATUS_META: Record<PactStatus, { label: string; tone: Tone; pulse?: boolean }> = {
  Open: { label: "Open", tone: "neutral" },
  Resolving: { label: "Verifying", tone: "amber", pulse: true },
  Confirmed: { label: "Confirmed", tone: "gold" },
  Denied: { label: "Denied", tone: "rust" },
  Released: { label: "Released", tone: "jade" },
  Expired: { label: "Expired", tone: "dim" },
};

export const CHECK_META: Record<CheckStatus, { label: string; tone: Tone; pulse?: boolean }> = {
  Pending: { label: "Awaiting", tone: "dim" },
  Requested: { label: "Verifying", tone: "amber", pulse: true },
  Confirmed: { label: "Confirmed", tone: "gold" },
  Denied: { label: "Denied", tone: "rust" },
  Inconclusive: { label: "Inconclusive", tone: "neutral" },
};

// chip classes per tone
export const TONE_CLASS: Record<Tone, string> = {
  gold: "border-gold-600/50 bg-gold-500/10 text-gold-300",
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  rust: "border-rust/40 bg-rust/10 text-rust",
  jade: "border-jade/40 bg-jade/10 text-jade",
  neutral: "border-ink-600 bg-ink-800/60 text-porcelain-muted",
  dim: "border-ink-700 bg-ink-900/60 text-porcelain-dim",
};

// --- formatters ---------------------------------------------------------------

export const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

/** Format wei → STT with up to 4 significant decimals, trimmed. */
export function fmtStt(wei: bigint): string {
  const s = formatEther(wei);
  if (!s.includes(".")) return s;
  const [i, d] = s.split(".");
  const dd = d.slice(0, 4).replace(/0+$/, "");
  return dd ? `${i}.${dd}` : i;
}

export function timeLeft(deadline: bigint): string {
  const now = Math.floor(Date.now() / 1000);
  const d = Number(deadline) - now;
  if (d <= 0) return "ended";
  const days = Math.floor(d / 86400);
  if (days >= 1) return `${days}d left`;
  const hrs = Math.floor(d / 3600);
  if (hrs >= 1) return `${hrs}h left`;
  return `${Math.max(1, Math.floor(d / 60))}m left`;
}
