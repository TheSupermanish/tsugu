import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createTestClient,
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

  const capabilityRegistry = await deploy("CapabilityRegistry.sol/CapabilityRegistry.json", [nft]);
  const taskBoard = await deploy("TaskBoard.sol/TaskBoard.json", [nft, registry, capabilityRegistry]);

  addresses = {
    agentRegistry: registry,
    agentNFT: nft,
    erc6551Registry: reg6551,
    agentAccount: impl,
    capabilityRegistry,
    taskBoard,
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

  it("agentCountOf reflects ownership (for free-index scanning)", async () => {
    const c = client();
    const fresh = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address; // anvil acct #3, owns nothing
    expect(await c.agentCountOf(fresh)).toBe(0n);
    const agent = await c.createAgent("indexer", { owner: fresh });
    expect(agent.owner).toBe(getAddress(fresh));
    expect(await c.agentCountOf(fresh)).toBe(1n);
  });
});

// Anvil default keys not used by the tests above (#0=operator, #1/#3 already own
// agents). Deriving addresses from keys keeps owner/recipient in sync.
const KEY4 = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" as const;
const KEY5 = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" as const;
const KEY6 = "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e" as const;
const KEY7 = "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356" as const;
const KEY8 = "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97" as const;
const KEY9 = "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6" as const;
const addrOf = (k: `0x${string}`): Address => privateKeyToAccount(k).address;
function owned(key: `0x${string}`): TsuguClient {
  return new TsuguClient({ chain: anvil, rpcUrl: handle.rpcUrl, addresses, privateKey: key });
}

describe("TsuguClient agent operations (anvil)", () => {
  it("agentExecute makes the agent spend its OWN wallet funds, gated to the owner", async () => {
    const operator = client();
    const ownerAddr = addrOf(KEY4);
    const recipient = addrOf(KEY5);
    const agent = await operator.createAgent("exec-agent", { owner: ownerAddr });

    // Fund the agent's wallet (not the owner key).
    await operator.send(agent.account, "0.5");
    expect(await operator.getBalance(agent.account)).toBe(parseEther("0.5"));

    // The owner drives the agent to send 0.1 from its own wallet.
    const before = await operator.getBalance(recipient);
    await owned(KEY4).agentExecute(agent.account, { to: recipient, value: "0.1" });
    expect((await operator.getBalance(recipient)) - before).toBe(parseEther("0.1"));
    expect(await operator.getBalance(agent.account)).toBe(parseEther("0.4")); // came from the wallet

    // A non-owner cannot drive it.
    await expect(operator.agentExecute(agent.account, { to: recipient, value: "0.1" })).rejects.toThrow(
      /not the owner/,
    );
  });

  it("agentExecute resolves the wallet by name", async () => {
    const operator = client();
    const agent = await operator.createAgent("exec-by-name", { owner: addrOf(KEY4) });
    await operator.send(agent.account, "0.2");
    const recipient = addrOf(KEY6);
    const before = await operator.getBalance(recipient);
    await owned(KEY4).agentExecute("exec-by-name", { to: recipient, value: "0.05" });
    expect((await operator.getBalance(recipient)) - before).toBe(parseEther("0.05"));
  });

  it("transferAgent moves ownership and wallet control follows", async () => {
    const operator = client();
    const agent = await operator.createAgent("xfer-agent", { owner: addrOf(KEY4) });
    expect(agent.owner).toBe(getAddress(addrOf(KEY4)));

    await owned(KEY4).transferAgent("xfer-agent", addrOf(KEY6));
    expect((await operator.resolve("xfer-agent")).owner).toBe(getAddress(addrOf(KEY6)));

    // The new owner can operate the wallet; the old owner can no longer transfer it.
    await operator.send(agent.account, "0.2");
    const recipient = addrOf(KEY5);
    const before = await operator.getBalance(recipient);
    await owned(KEY6).agentExecute(agent.account, { to: recipient, value: "0.05" });
    expect((await operator.getBalance(recipient)) - before).toBe(parseEther("0.05"));

    await expect(owned(KEY4).transferAgent("xfer-agent", addrOf(KEY5))).rejects.toThrow(/not the owner/);
  });

  it("transferAgent rejects the zero address", async () => {
    const operator = client();
    await operator.createAgent("xfer-guard", { owner: addrOf(KEY4) });
    await expect(
      owned(KEY4).transferAgent("xfer-guard", "0x0000000000000000000000000000000000000000" as Address),
    ).rejects.toThrow(/zero address/);
  });

  it("hasEverOwned is monotonic — stays true after the agent is transferred away", async () => {
    const operator = client();
    const histOwner = addrOf(KEY7); // fresh, never registered

    expect(await operator.hasEverOwned(histOwner)).toBe(false);
    const agent = await operator.createAgent("hist-agent", { owner: histOwner });
    expect(await operator.hasEverOwned(histOwner)).toBe(true);
    expect(await operator.agentCountOf(histOwner)).toBe(1n);

    // Transfer it away: live balance drops to 0, but history is permanent — so the
    // CLI will never re-derive this index's key for a new agent.
    await owned(KEY7).transferAgent("hist-agent", addrOf(KEY5));
    expect(await operator.agentCountOf(histOwner)).toBe(0n);
    expect(await operator.hasEverOwned(histOwner)).toBe(true);
    expect(agent.account).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("agentExecute / transferAgent without a key throw", async () => {
    const reader = client(false);
    await expect(reader.transferAgent("neo", addrOf(KEY5))).rejects.toThrow(/requires a privateKey/);
    await expect(reader.agentExecute("neo", { to: addrOf(KEY5) })).rejects.toThrow(/requires a privateKey/);
  });

  it("agentExecute rejects pre-broadcast when the agent wallet is underfunded", async () => {
    const operator = client();
    const agent = await operator.createAgent("poor-agent", { owner: addrOf(KEY4) });
    // Wallet holds nothing; trying to send 1 STT from it must fail at simulate.
    await expect(owned(KEY4).agentExecute(agent.account, { to: addrOf(KEY5), value: "1" })).rejects.toThrow();
  });

  it("discovery + coordination: advertise → discover → post → accept → submit → approve pays the worker wallet", async () => {
    const poster = client(); // ANVIL_KEY funds + posts
    const workerAddr = addrOf(KEY4);
    const agent = await poster.createAgent("coord-worker", { owner: workerAddr });
    const worker = owned(KEY4);

    // Discovery: the worker advertises a capability.
    await worker.advertise(agent.tokenId, {
      capabilities: ["llm.summarize"],
      serviceURI: "https://worker.example/agent.json",
      pricePerCall: "0.01",
    });
    expect(await poster.hasCapability(agent.tokenId, "llm.summarize")).toBe(true);
    const provs = await poster.providers("llm.summarize");
    expect(provs.map(String)).toContain(String(agent.tokenId));

    // Coordination: post a task, worker accepts + submits, poster approves.
    const { taskId } = await poster.postTask({
      capability: "llm.summarize",
      rewardStt: "0.1",
      deadline: 2_000_000_000, // far future
      specURI: "ipfs://spec",
    });
    await worker.acceptTask(taskId, agent.tokenId);
    await worker.submitResult(taskId, "ipfs://result");

    const before = await poster.getBalance(agent.account);
    await poster.approveTask(taskId);
    expect((await poster.getBalance(agent.account)) - before).toBe(parseEther("0.1")); // paid into the agent's OWN wallet

    const t = await poster.getTask(taskId);
    expect(t.status).toBe(4); // Approved
    expect(t.workerTokenId).toBe(agent.tokenId);
  });

  it("accept fails for an agent that doesn't advertise the capability", async () => {
    const poster = client();
    const agent = await poster.createAgent("coord-noskill", { owner: addrOf(KEY5) });
    const { taskId } = await poster.postTask({ capability: "image.generate", rewardStt: "0.05", deadline: 2_000_000_000 });
    await expect(owned(KEY5).acceptTask(taskId, agent.tokenId)).rejects.toThrow();
  });

  it("coordination methods throw when no TaskBoard is configured", async () => {
    const noBoard = new TsuguClient({
      chain: anvil,
      rpcUrl: handle.rpcUrl,
      addresses: { ...addresses, taskBoard: undefined },
      privateKey: ANVIL_KEY,
    });
    await expect(noBoard.postTask({ capability: "x", rewardStt: "0.1", deadline: 2_000_000_000 })).rejects.toThrow(
      /no TaskBoard/,
    );
  });

  it("hasEverOwned pages across multiple 1000-block windows", async () => {
    const operator = client();
    const test = createTestClient({ chain: anvil, mode: "anvil", transport: http(handle.rpcUrl) });
    const lateOwner = addrOf(KEY8);
    const neverOwner = addrOf(KEY9);

    expect(await operator.hasEverOwned(lateOwner)).toBe(false);
    // Advance well past one 1000-block scan window, THEN register — so finding the
    // owner forces the scan to page beyond the first window.
    await test.mine({ blocks: 1100 });
    const agent = await operator.createAgent("late-window", { owner: lateOwner });
    expect(agent.owner).toBe(getAddress(lateOwner));

    expect(await operator.hasEverOwned(lateOwner)).toBe(true);
    expect(await operator.hasEverOwned(neverOwner)).toBe(false);
  });
});
