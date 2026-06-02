import { describe, it, expect } from "vitest";
import { AsomClient, shannon, deployments, validateName, isValidName, parseStt } from "../src/index.js";
import { parseEther } from "viem";

const ANVIL_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

describe("AsomClient unit (no chain)", () => {
  it("defaults to Shannon with its known deployment", () => {
    const c = new AsomClient();
    expect(c.chainId).toBe(50312);
    expect(c.addresses.agentRegistry).toBe(deployments[50312].agentRegistry);
  });

  it("builds Shannon explorer URLs", () => {
    const c = new AsomClient();
    expect(c.explorer("tx", "0xabc")).toBe(
      "https://shannon-explorer.somnia.network/tx/0xabc",
    );
    expect(c.explorer("address", "0xdef")).toBe(
      "https://shannon-explorer.somnia.network/address/0xdef",
    );
  });

  it("throws for an unknown chain when no addresses are given", () => {
    const unknown = { ...shannon, id: 999_999 };
    expect(() => new AsomClient({ chain: unknown })).toThrow(/no deployment known/);
  });

  it("accepts an address override for an unknown chain", () => {
    const unknown = { ...shannon, id: 999_999 };
    const addresses = {
      agentRegistry: "0x0000000000000000000000000000000000000001",
      agentNFT: "0x0000000000000000000000000000000000000002",
      erc6551Registry: "0x0000000000000000000000000000000000000003",
      agentAccount: "0x0000000000000000000000000000000000000004",
    } as const;
    const c = new AsomClient({ chain: unknown, addresses });
    expect(c.addresses.agentRegistry).toBe(addresses.agentRegistry);
  });

  it("has no signer address without a private key", () => {
    expect(new AsomClient().signerAddress).toBeUndefined();
  });

  it("derives the signer address from a private key", () => {
    const c = new AsomClient({ privateKey: ANVIL_KEY });
    expect(c.signerAddress).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
  });

  it("rejects a malformed private key with a clear message", () => {
    expect(() => new AsomClient({ privateKey: "0xdead" as `0x${string}` })).toThrow(/32-byte hex/);
    expect(() => new AsomClient({ privateKey: "nope" as `0x${string}` })).toThrow(/32-byte hex/);
  });
});

describe("validateName (mirrors the on-chain validator)", () => {
  it("accepts valid names", () => {
    for (const n of ["neo", "agent-007", "x", "trinity99", "a".repeat(32)]) {
      expect(isValidName(n)).toBe(true);
    }
  });

  it("rejects empty, too-long, and out-of-charset names", () => {
    expect(() => validateName("")).toThrow(/empty/);
    expect(() => validateName("a".repeat(33))).toThrow(/too long/);
    expect(() => validateName("Neo")).toThrow(/invalid character/);
    expect(() => validateName("neo bot")).toThrow(/invalid character/);
    expect(() => validateName("my_agent")).toThrow(/invalid character/);
    expect(() => validateName("café")).toThrow(/invalid character/);
  });

  it("rejects bad hyphen placement", () => {
    expect(() => validateName("-neo")).toThrow(/start or end with a hyphen/);
    expect(() => validateName("neo-")).toThrow(/start or end with a hyphen/);
    expect(() => validateName("ne--o")).toThrow(/doubled hyphen/);
  });
});

describe("parseStt", () => {
  it("parses positive decimals to wei", () => {
    expect(parseStt("0.05")).toBe(parseEther("0.05"));
    expect(parseStt("0")).toBe(0n);
    expect(parseStt("12")).toBe(parseEther("12"));
  });

  it("rejects NaN, negative, and non-finite amounts", () => {
    expect(() => parseStt("abc")).toThrow(/positive decimal/);
    expect(() => parseStt("-1")).toThrow(/positive decimal/);
    expect(() => parseStt("")).toThrow(/positive decimal/);
  });

  it("rejects scientific/hex notation and >18 decimals (no opaque parseEther passthrough)", () => {
    for (const bad of ["1e-3", "1E3", "0x10", "1.2345678901234567890", "Infinity", "1,5", ".", "5."]) {
      expect(() => parseStt(bad)).toThrow(/positive decimal/);
    }
  });

  it("trims surrounding whitespace", () => {
    expect(parseStt("  0.05  ")).toBe(parseEther("0.05"));
  });
});

describe("Somnia base-agent resolution + AI compute (no chain)", () => {
  it("falls back to hardcoded constants on testnet (Somnia registry not deployed there)", async () => {
    const c = new AsomClient(); // Shannon 50312 — no Somnia AgentRegistry
    const agents = await c.resolveSomniaAgents();
    expect(agents.length).toBe(3);
    expect(agents.every((a) => a.source === "constants")).toBe(true);
    const caps = agents.map((a) => a.capability);
    expect(caps).toContain("somnia.json-fetch");
    expect(caps).toContain("somnia.llm-inference");
    expect(caps).toContain("somnia.parse-website");
  });

  it("guards AI calls when no compute contract is configured", async () => {
    const c = new AsomClient(); // Shannon deployment has no llmAgent/parseAgent yet
    await expect(c.aiRequiredDeposit("classify")).rejects.toThrow(/no LlmAgent/);
    await expect(c.aiRequiredDeposit("extract")).rejects.toThrow(/no ParseAgent/);
  });

  it("accepts an injected account (browser-wallet shape) without a private key", () => {
    const account = { address: "0x0000000000000000000000000000000000001234", type: "json-rpc" } as never;
    const c = new AsomClient({ account });
    expect(c.signerAddress).toBe("0x0000000000000000000000000000000000001234");
  });
});
