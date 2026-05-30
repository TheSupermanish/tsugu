import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  parseEther,
  type Abi,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import { startAnvil, type AnvilHandle, ANVIL_KEY, ANVIL_ACCOUNT } from "./anvil.js";
import { TsuguClient, type TsuguAddresses } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = join(here, "..", "..", "contracts");
const ARTIFACTS = join(CONTRACTS_DIR, "out");

/**
 * Foundry artifacts (`out/`) are gitignored, so they won't exist on a fresh
 * clone or in CI. Build them on demand rather than failing with a cryptic
 * ENOENT — keeps `pnpm test` self-contained given Foundry is installed.
 */
function ensureArtifacts(): void {
  if (existsSync(join(ARTIFACTS, "AgentRegistry.sol/AgentRegistry.json"))) return;
  try {
    execSync("forge build", { cwd: CONTRACTS_DIR, stdio: "ignore" });
  } catch {
    throw new Error(
      "Foundry artifacts missing and `forge build` failed. Install Foundry (foundryup) to run the integration tests.",
    );
  }
}

function artifact(path: string): { abi: Abi; bytecode: `0x${string}` } {
  const json = JSON.parse(readFileSync(join(ARTIFACTS, path), "utf8"));
  return { abi: json.abi as Abi, bytecode: json.bytecode.object as `0x${string}` };
}

let handle: AnvilHandle;
let addresses: TsuguAddresses;
const account = privateKeyToAccount(ANVIL_KEY);

beforeAll(async () => {
  ensureArtifacts();
  handle = await startAnvil();
  const transport = http(handle.rpcUrl);
  const wallet = createWalletClient({ account, chain: anvil, transport });
  const pub = createPublicClient({ chain: anvil, transport });

  async function deploy(path: string, args: unknown[] = []): Promise<Address> {
    const { abi, bytecode } = artifact(path);
    const hash = await wallet.deployContract({ abi, bytecode, args, account, chain: anvil });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`deploy failed: ${path}`);
    return getAddress(receipt.contractAddress);
  }

  const nft = await deploy("AgentNFT.sol/AgentNFT.json", [ANVIL_ACCOUNT]);
  const impl = await deploy("AgentAccount.sol/AgentAccount.json");
  const reg6551 = await deploy("ERC6551Registry.sol/ERC6551Registry.json");
  const registry = await deploy("AgentRegistry.sol/AgentRegistry.json", [nft, reg6551, impl]);

  const { abi: nftAbi } = artifact("AgentNFT.sol/AgentNFT.json");
  const setMinter = await wallet.writeContract({
    address: nft,
    abi: nftAbi,
    functionName: "setMinter",
    args: [registry],
    account,
    chain: anvil,
  });
  await pub.waitForTransactionReceipt({ hash: setMinter });

  addresses = {
    agentRegistry: registry,
    agentNFT: nft,
    erc6551Registry: reg6551,
    agentAccount: impl,
  };
});

afterAll(() => handle?.stop());

function client(withKey = true): TsuguClient {
  return new TsuguClient({
    chain: anvil,
    rpcUrl: handle.rpcUrl,
    addresses,
    privateKey: withKey ? ANVIL_KEY : undefined,
  });
}

describe("TsuguClient integration (anvil)", () => {
  it("createAgent mints NFT, deploys wallet, seeds it, and round-trips via resolve", async () => {
    const c = client();
    const agent = await c.createAgent("neo", { seedStt: "0.05" });

    expect(agent.name).toBe("neo");
    expect(agent.tokenId).toBeGreaterThan(0n);
    expect(agent.owner).toBe(getAddress(ANVIL_ACCOUNT));
    expect(agent.account).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // wallet was actually deployed (has code) and seeded
    const pub = createPublicClient({ chain: anvil, transport: http(handle.rpcUrl) });
    const code = await pub.getCode({ address: agent.account });
    expect(code && code.length > 2).toBe(true);
    expect(await c.getBalance(agent.account)).toBe(parseEther("0.05"));

    // resolve returns the same wallet
    const resolved = await c.resolve("neo");
    expect(resolved.account).toBe(agent.account);
    expect(resolved.tokenId).toBe(agent.tokenId);
    expect(resolved.owner).toBe(agent.owner);
  });

  it("isAvailable reflects registration state", async () => {
    const c = client();
    expect(await c.isAvailable("trinity")).toBe(true);
    await c.createAgent("trinity");
    expect(await c.isAvailable("trinity")).toBe(false);
  });

  it("rejects a duplicate name", async () => {
    const c = client();
    await c.createAgent("morpheus");
    await expect(c.createAgent("morpheus")).rejects.toThrow();
  });

  it("resolve throws for an unregistered name", async () => {
    const c = client(false);
    await expect(c.resolve("ghost-9000")).rejects.toThrow();
  });

  it("createAgent without a key throws", async () => {
    const c = client(false);
    await expect(c.createAgent("nokey")).rejects.toThrow(/requires a privateKey/);
  });

  it("mints to a custom owner when specified", async () => {
    const c = client();
    const other = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // anvil acct #1
    const agent = await c.createAgent("oracle", { owner: other as Address });
    expect(agent.owner).toBe(getAddress(other));
  });

  it("send() transfers native value to a recipient", async () => {
    const c = client();
    const to = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address; // anvil acct #2
    const before = await c.getBalance(to);
    await c.send(to, "0.1");
    expect((await c.getBalance(to)) - before).toBe(parseEther("0.1"));
  });

  it("send() without a key throws", async () => {
    const c = client(false);
    await expect(c.send("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address, "0.1")).rejects.toThrow(
      /requires a privateKey/,
    );
  });
});
