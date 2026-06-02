import {
  createPublicClient,
  createWalletClient,
  http,
  fallback,
  getAddress,
  isAddress,
  keccak256,
  parseEventLogs,
  toBytes,
  zeroAddress,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { shannon } from "./chain.js";
import { deployments } from "./addresses.js";
import {
  agentRegistryAbi,
  agentNftAbi,
  agentAccountAbi,
  capabilityRegistryAbi,
  taskBoardAbi,
  llmAgentAbi,
  parseAgentAbi,
  somniaAgentRegistryAbi,
} from "./abis.js";
import { validateName, parseStt } from "./validate.js";
import { somniaAgents, somniaPlatform, somniaAgentRegistry, type SomniaAgentInfo } from "./somnia.js";

/** Capability tag = keccak256 of the UTF-8 capability name (e.g. "llm.summarize"),
 *  matching the on-chain bytes32 tags. */
export function capabilityTag(name: string): Hex {
  return keccak256(toBytes(name));
}

export interface Agent {
  name: string;
  tokenId: bigint;
  /** ERC-6551 token-bound wallet. */
  account: Address;
  /** Live owner of the AgentNFT (controls the wallet). */
  owner: Address;
  createdAt: number;
}

/** asom contract addresses for a single deployment. */
export interface AsomAddresses {
  agentRegistry: Address;
  agentNFT: Address;
  erc6551Registry: Address;
  agentAccount: Address;
  /** Discovery layer — optional (a deployment may not include the coordination layer). */
  capabilityRegistry?: Address;
  /** Coordination layer — optional. */
  taskBoard?: Address;
  /** AI compute primitives — optional (LlmAgent / ParseAgent / OracleAgent). */
  llmAgent?: Address;
  parseAgent?: Address;
  oracleAgent?: Address;
}

/** A coordination task. `status`: 0 None,1 Open,2 Accepted,3 Submitted,4 Approved,5 Refunded. */
export interface Task {
  poster: Address;
  capability: Hex;
  reward: bigint;
  deadline: bigint;
  submittedAt: bigint;
  workerTokenId: bigint;
  status: number;
  specURI: string;
  resultURI: string;
}

/** The three AI compute primitives. classify/number → LlmAgent; extract → ParseAgent. */
export type AiKind = "classify" | "number" | "extract";

/** Parameters for a parse-website extraction (mirrors ParseAgent.ExtractParams). */
export interface ExtractParams {
  key: string;
  description: string;
  options?: string[];
  prompt: string;
  url: string;
  resolveUrl?: boolean;
  numPages?: bigint | number;
  confidenceThreshold?: bigint | number;
}

/** A resolved AI result once the consensus callback has landed. */
export interface AiResult {
  /** True if consensus succeeded; false if the request Failed / TimedOut. */
  ok: boolean;
  kind: AiKind;
  /** Decoded value — a verdict/extraction string, or a bigint for `number`. Unset on failure. */
  value?: string | bigint;
  /** Consensus receipt: how many validators backed it + median execution cost. */
  receipt?: { validators: number; finalizedAt: number; receiptId: bigint; executionCost: bigint };
}

export interface AsomClientOptions {
  /** Target chain. Defaults to Somnia Shannon. Pass a custom chain (e.g. anvil) for tests/forks. */
  chain?: Chain;
  /** RPC URL override. Defaults to the chain's public RPC. */
  rpcUrl?: string;
  /** Multiple RPC URLs for a viem fallback transport (resilience). Takes precedence over rpcUrl. */
  rpcUrls?: string[];
  /** 0x-prefixed private key. Required only for write operations (server/CLI signing). */
  privateKey?: Hex;
  /** An externally-supplied viem WalletClient (e.g. a browser/injected wallet via wagmi).
   *  Use this INSTEAD of `privateKey` for self-custodial signing in the UI. */
  walletClient?: WalletClient;
  /** The signing account. Defaults to `walletClient.account`. Required if a walletClient
   *  without a bound account is supplied. Ignored when `privateKey` is set. */
  account?: Account;
  /** Address override. Defaults to the known deployment for `chain.id`. */
  addresses?: AsomAddresses;
  /** Lower-bound block for event scans (hasEverOwned). Defaults to the known deploy block, else 0. */
  deployBlock?: bigint;
}

// Shannon inflates gas ~20x across the board and its estimator undercounts ~8x,
// so we pin explicit, generous limits (you only pay gas actually used).
const GAS = {
  register: 5_000_000n,
  // Shannon inflates gas ~20x: an ERC-721 safeTransferFrom does several SSTOREs,
  // and execute does an SSTORE plus an arbitrary forwarded call — pin generously
  // (you only pay gas actually used on success).
  transfer: 2_000_000n,
  execute: 3_000_000n,
  send: 800_000n,
  // Coordination layer: enumerable-set writes + a string store + escrow/payout. On
  // Shannon (~20x gas) `advertise` alone measures ~3.5M, so pin well above that.
  advertise: 8_000_000n,
  coord: 8_000_000n,
} as const;

/** The largest write-gas limit — what an agent's owner key must be funded to cover. */
const MAX_WRITE_GAS = [GAS.advertise, GAS.coord, GAS.execute, GAS.transfer].reduce((a, b) => (a > b ? a : b));

// Chunk size for paginated log scans. Shannon's public RPC caps eth_getLogs at a
// 1000-block range, so we page in 1000-block windows from the registry's deploy
// block. NB: on a fast chain this scan grows with registry age — a production
// deployment fronts this with an indexer/subgraph rather than scanning live.
const LOG_SCAN_CHUNK = 1000n;

const HTTP_OPTS = { retryCount: 3, timeout: 30_000 } as const;

const agentRegisteredEvent = agentRegistryAbi.find(
  (item): item is Extract<(typeof agentRegistryAbi)[number], { type: "event" }> =>
    item.type === "event" && item.name === "AgentRegistered",
)!;

/**
 * AsomClient — the programmatic entry point to asom.
 *
 * Read methods (resolve, isAvailable, getBalance, hasEverOwned) need no key.
 * Write methods (createAgent, transferAgent, agentExecute, send) require `privateKey`.
 */
export class AsomClient {
  readonly chain: Chain;
  readonly chainId: number;
  readonly addresses: AsomAddresses;
  /** Block from which event scans start (registry deploy block on a known chain). */
  readonly deployBlock: bigint;
  private readonly publicClient: PublicClient;
  private readonly account?: Account;
  private readonly walletClient?: WalletClient;

  constructor(opts: AsomClientOptions = {}) {
    this.chain = opts.chain ?? shannon;
    this.chainId = this.chain.id;

    const dep = deployments[this.chainId];
    const addresses = opts.addresses ?? dep;
    if (!addresses) {
      throw new Error(`asom: no deployment known for chain ${this.chainId}; pass { addresses }`);
    }
    this.addresses = {
      agentRegistry: addresses.agentRegistry,
      agentNFT: addresses.agentNFT,
      erc6551Registry: addresses.erc6551Registry,
      agentAccount: addresses.agentAccount,
      capabilityRegistry: addresses.capabilityRegistry,
      taskBoard: addresses.taskBoard,
      llmAgent: addresses.llmAgent,
      parseAgent: addresses.parseAgent,
      oracleAgent: addresses.oracleAgent,
    };
    this.deployBlock = opts.deployBlock ?? dep?.deployBlock ?? 0n;

    const urls = opts.rpcUrls?.length ? opts.rpcUrls : opts.rpcUrl ? [opts.rpcUrl] : [];
    const transport =
      urls.length > 1
        ? fallback(urls.map((u) => http(u, HTTP_OPTS)))
        : http(urls[0], HTTP_OPTS);
    this.publicClient = createPublicClient({ chain: this.chain, transport });

    if (opts.privateKey) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(opts.privateKey)) {
        throw new Error("asom: privateKey must be a 0x-prefixed 32-byte hex string");
      }
      this.account = privateKeyToAccount(opts.privateKey);
      this.walletClient = createWalletClient({ account: this.account, chain: this.chain, transport });
    } else if (opts.walletClient) {
      // Externally-supplied signer (e.g. a browser/injected wallet). Used directly for
      // writes; reads/simulations still go through our publicClient with `this.account`.
      this.walletClient = opts.walletClient;
      const acct = opts.account ?? opts.walletClient.account;
      if (!acct) {
        throw new Error("asom: a walletClient without a bound account requires an explicit `account`");
      }
      this.account = acct;
    } else if (opts.account) {
      // Account only (e.g. read-with-identity); writes will still require a walletClient.
      this.account = opts.account;
    }
  }

  /** Address of the signer, if a private key was provided. */
  get signerAddress(): Address | undefined {
    return this.account?.address;
  }

  private requireSigner(method: string): { account: Account; walletClient: WalletClient } {
    if (!this.walletClient || !this.account) {
      throw new Error(`asom: ${method} requires a privateKey`);
    }
    return { account: this.account, walletClient: this.walletClient };
  }

  /** Resolve `<name>` to its agent. Throws if unregistered. */
  async resolve(name: string): Promise<Agent> {
    const [tokenId, account, owner, createdAt] = await this.publicClient.readContract({
      address: this.addresses.agentRegistry,
      abi: agentRegistryAbi,
      functionName: "resolve",
      args: [name],
    });
    return {
      name,
      tokenId,
      account: getAddress(account),
      owner: getAddress(owner),
      createdAt: Number(createdAt),
    };
  }

  /** True if `<name>` is still available to register. */
  async isAvailable(name: string): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.addresses.agentRegistry,
      abi: agentRegistryAbi,
      functionName: "isAvailable",
      args: [name],
    });
  }

  /** Native STT balance of any address (e.g. an agent wallet), in wei. */
  async getBalance(address: Address): Promise<bigint> {
    return this.publicClient.getBalance({ address: getAddress(address) });
  }

  /** Total agents minted (for enumerating the registry). */
  async totalAgents(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.addresses.agentNFT,
      abi: agentNftAbi,
      functionName: "totalMinted",
    });
  }

  /** How many agent NFTs an address currently owns. */
  async agentCountOf(owner: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.addresses.agentNFT,
      abi: agentNftAbi,
      functionName: "balanceOf",
      args: [getAddress(owner)],
    });
  }

  /**
   * True if `owner` has EVER been the registered owner of any agent — even if
   * the agent was later transferred away. Scans AgentRegistered events (owner is
   * indexed). Unlike a live `balanceOf`, this is monotonic: it lets the CLI pick
   * a fresh HD index that has never been used, so transferring an agent can never
   * cause a later `create` to re-derive the same key. Chain-derived, so it works
   * from the seed alone with no local state.
   */
  async hasEverOwned(owner: Address): Promise<boolean> {
    const target = getAddress(owner);
    // cacheTime: 0 — force a FRESH head. viem caches getBlockNumber (~4s), which
    // would otherwise miss an agent registered moments ago and make a just-used HD
    // index look free (the exact key-reuse footgun this guards against).
    const latest = await this.publicClient.getBlockNumber({ cacheTime: 0 });
    // Fail loud rather than silently report "never owned": a deployBlock ahead of
    // the chain head (misconfig / wrong network / reorg) would make every address
    // look free and could lead to HD key reuse.
    if (this.deployBlock > latest) {
      throw new Error(
        `asom: deployBlock ${this.deployBlock} is ahead of chain head ${latest} — refusing to report ownership (wrong network or misconfigured deployBlock?)`,
      );
    }
    for (let from = this.deployBlock; from <= latest; from += LOG_SCAN_CHUNK) {
      const to = from + LOG_SCAN_CHUNK - 1n > latest ? latest : from + LOG_SCAN_CHUNK - 1n;
      const logs = await this.publicClient.getLogs({
        address: this.addresses.agentRegistry,
        event: agentRegisteredEvent,
        fromBlock: from,
        toBlock: to,
      });
      // Match owner in JS rather than via an indexed-topic arg filter — robust
      // across RPC quirks, and the decoded `args.owner` is exact.
      if (logs.some((l) => l.args.owner !== undefined && getAddress(l.args.owner) === target)) return true;
    }
    return false;
  }

  /** The registered name of an agent by tokenId (for reverse lookup / discovery display). */
  async nameOf(tokenId: bigint): Promise<string> {
    return this.publicClient.readContract({
      address: this.addresses.agentNFT,
      abi: agentNftAbi,
      functionName: "nameOf",
      args: [tokenId],
    });
  }

  /** The current on-chain `state` nonce of an agent wallet (bumps on every execute). */
  async agentState(account: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: getAddress(account),
      abi: agentAccountAbi,
      functionName: "state",
    });
  }

  /** Current gas price (wei). */
  async getGasPrice(): Promise<bigint> {
    return this.publicClient.getGasPrice();
  }

  /**
   * Recommended STT (wei) an agent's owner key should hold to safely send one
   * write (execute/transfer). Sized from the largest pinned gas limit and the live
   * gas price, with a 2× margin to cover EIP-1559 base-fee inflation + tip + drift.
   * The CLI uses this to top up a cold owner key — so the top-up tracks the gas the
   * SDK actually pins, instead of a stale hardcoded floor.
   */
  async opGasBudget(): Promise<bigint> {
    const gasPrice = await this.getGasPrice();
    return gasPrice * MAX_WRITE_GAS * 2n;
  }

  /**
   * Create an agent: mint the NFT, deploy its ERC-6551 wallet, register the name.
   * @param name   the agent name (validated client-side AND on-chain)
   * @param opts.owner  who receives the agent NFT (defaults to the signer)
   * @param opts.seedStt  STT to seed the new wallet with, as a decimal string (e.g. "0.05")
   * @returns the created agent plus the registration tx hash
   */
  async createAgent(name: string, opts: { owner?: Address; seedStt?: string } = {}): Promise<Agent & { txHash: Hash }> {
    const { account, walletClient } = this.requireSigner("createAgent");
    validateName(name); // fail fast with a friendly message before any RPC
    const owner = opts.owner ? getAddress(opts.owner) : account.address;
    const value = opts.seedStt ? parseStt(opts.seedStt) : 0n;

    // Simulate first: reverts early (with the decoded reason, e.g. NameTaken)
    // before any gas is spent. Shannon's estimator undercounts, so pin gas.
    const { request } = await this.publicClient.simulateContract({
      address: this.addresses.agentRegistry,
      abi: agentRegistryAbi,
      functionName: "register",
      args: [name, owner],
      value,
      gas: GAS.register,
      account,
    });

    const hash = await walletClient.writeContract(request);

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      throw new Error(`asom: register("${name}") reverted on-chain (tx ${hash})`);
    }

    // Read the canonical result from the AgentRegistered event we just emitted,
    // rather than re-resolving by name (avoids an extra read + name coupling).
    const events = parseEventLogs({ abi: agentRegistryAbi, eventName: "AgentRegistered", logs: receipt.logs });
    const ev = events.find((e) => getAddress(e.address) === getAddress(this.addresses.agentRegistry));
    if (ev) {
      const block = await this.publicClient.getBlock({ blockNumber: receipt.blockNumber });
      return {
        name,
        tokenId: ev.args.tokenId,
        account: getAddress(ev.args.account),
        owner: getAddress(ev.args.owner),
        createdAt: Number(block.timestamp),
        txHash: hash,
      };
    }
    // Fallback: the log was somehow absent — resolve by name.
    const agent = await this.resolve(name);
    return { ...agent, txHash: hash };
  }

  /**
   * Transfer an agent to a new owner — hands over the NFT, and with it the
   * agent's wallet and name. The signer MUST be the agent's current owner.
   * @param name  the agent to transfer
   * @param to    the new owner
   */
  async transferAgent(name: string, to: Address): Promise<Hash> {
    const { account, walletClient } = this.requireSigner("transferAgent");
    const recipient = getAddress(to);
    if (recipient === zeroAddress) throw new Error("asom: cannot transfer an agent to the zero address");

    const agent = await this.resolve(name);
    if (getAddress(agent.owner) !== account.address) {
      throw new Error(
        `asom: signer ${account.address} is not the owner of ${name}@asom (owner is ${agent.owner}); only the owner can transfer it`,
      );
    }

    // Simulate first: e.g. a `to` contract that can't receive an ERC-721 reverts
    // here (decoded) instead of after mining and wasting the owner's gas.
    const { request } = await this.publicClient.simulateContract({
      address: this.addresses.agentNFT,
      abi: agentNftAbi,
      functionName: "safeTransferFrom",
      args: [agent.owner, recipient, agent.tokenId],
      account,
      gas: GAS.transfer,
    });
    const hash = await walletClient.writeContract(request);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") throw new Error(`asom: transfer of ${name}@asom reverted (tx ${hash})`);
    return hash;
  }

  /**
   * Make an agent act: call `execute` on its ERC-6551 wallet so the agent sends
   * STT, calls a contract, or moves a token it custodies. The signer MUST be the
   * agent's current owner (execute is owner-gated on-chain).
   * @param target  the agent name, an Agent, or the agent wallet address
   * @param call.to        the call target
   * @param call.value     STT to send with the call, as a decimal string (default "0")
   * @param call.data      calldata hex (default "0x" — a plain value transfer)
   * @param call.operation must be 0 (CALL); reserved for future ops
   */
  async agentExecute(
    target: string | Agent | Address,
    call: { to: Address; value?: string; data?: Hex; operation?: number },
  ): Promise<Hash> {
    const { account, walletClient } = this.requireSigner("agentExecute");

    let acct: Address;
    if (typeof target === "object") acct = getAddress(target.account);
    else if (isAddress(target)) acct = getAddress(target);
    else acct = (await this.resolve(target)).account;

    // Friendly pre-check: surface "you're not the owner" before spending gas.
    const owner = await this.publicClient.readContract({
      address: acct,
      abi: agentAccountAbi,
      functionName: "owner",
    });
    if (getAddress(owner) !== account.address) {
      throw new Error(
        `asom: signer ${account.address} is not the owner of agent wallet ${acct} (owner is ${owner}); execute is owner-gated`,
      );
    }

    const value = call.value ? parseStt(call.value) : 0n;
    const data: Hex = call.data ?? "0x";
    const operation = call.operation ?? 0;

    // Simulate first: a too-poor wallet, a reverting target, or a bad operation
    // fails here with a decoded reason and no gas spent. No msg.value — the agent
    // spends its OWN wallet balance for `value` (the point of it having funds).
    const { request } = await this.publicClient.simulateContract({
      address: acct,
      abi: agentAccountAbi,
      functionName: "execute",
      args: [getAddress(call.to), value, data, operation],
      account,
      gas: GAS.execute,
    });
    const hash = await walletClient.writeContract(request);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") throw new Error(`asom: agent execute reverted (tx ${hash})`);
    return hash;
  }

  /**
   * Send native STT from the signer to any address.
   * @param to   recipient (an agent's owner key for gas, or its wallet/TBA for funds)
   * @param stt  amount as a decimal string, e.g. "0.01"
   */
  async send(to: Address, stt: string): Promise<Hash> {
    return this.sendWei(to, parseStt(stt));
  }

  /** Send an exact wei amount — used when the caller already has a bigint (e.g. a
   *  gas top-up) and rounding through a decimal string would lose precision. */
  async sendWei(to: Address, value: bigint): Promise<Hash> {
    const { account, walletClient } = this.requireSigner("send");
    const recipient = getAddress(to);
    if (recipient === zeroAddress) throw new Error("asom: cannot send to the zero address");

    const hash = await walletClient.sendTransaction({
      to: recipient,
      value,
      account,
      chain: this.chain,
      // Shannon inflates intrinsic gas: a plain transfer that's ~21k elsewhere
      // OOGs well past 100k here. Pin generously — you only pay gas actually used.
      gas: GAS.send,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") throw new Error(`asom: send to ${recipient} reverted (tx ${hash})`);
    return hash;
  }

  // --- discovery (CapabilityRegistry) --------------------------------------

  private capsAddr(): Address {
    const a = this.addresses.capabilityRegistry;
    if (!a) throw new Error("asom: no CapabilityRegistry for this chain; pass addresses.capabilityRegistry");
    return a;
  }

  private boardAddr(): Address {
    const a = this.addresses.taskBoard;
    if (!a) throw new Error("asom: no TaskBoard for this chain; pass addresses.taskBoard");
    return a;
  }

  private async finishWriteReceipt(request: unknown, label: string) {
    const hash = await this.walletClient!.writeContract(request as Parameters<WalletClient["writeContract"]>[0]);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") throw new Error(`asom: ${label} reverted (tx ${hash})`);
    return receipt;
  }

  private async finishWrite(request: unknown, label: string): Promise<Hash> {
    return (await this.finishWriteReceipt(request, label)).transactionHash;
  }

  /** Advertise an agent's capabilities + service info in one call (owner-gated). */
  async advertise(
    tokenId: bigint,
    opts: { capabilities: string[]; serviceURI?: string; pricePerCall?: string },
  ): Promise<Hash> {
    const { account } = this.requireSigner("advertise");
    const tags = opts.capabilities.map(capabilityTag);
    const price = opts.pricePerCall ? parseStt(opts.pricePerCall) : 0n;
    const { request } = await this.publicClient.simulateContract({
      address: this.capsAddr(),
      abi: capabilityRegistryAbi,
      functionName: "advertise",
      args: [tokenId, tags, opts.serviceURI ?? "", price],
      account,
      gas: GAS.advertise,
    });
    return this.finishWrite(request, "advertise");
  }

  /** Add a single capability to an agent. */
  async addCapability(tokenId: bigint, capability: string): Promise<Hash> {
    const { account } = this.requireSigner("addCapability");
    const { request } = await this.publicClient.simulateContract({
      address: this.capsAddr(),
      abi: capabilityRegistryAbi,
      functionName: "addCapability",
      args: [tokenId, capabilityTag(capability)],
      account,
      gas: GAS.coord,
    });
    return this.finishWrite(request, "addCapability");
  }

  /** Remove a single capability from an agent. */
  async removeCapability(tokenId: bigint, capability: string): Promise<Hash> {
    const { account } = this.requireSigner("removeCapability");
    const { request } = await this.publicClient.simulateContract({
      address: this.capsAddr(),
      abi: capabilityRegistryAbi,
      functionName: "removeCapability",
      args: [tokenId, capabilityTag(capability)],
      account,
      gas: GAS.coord,
    });
    return this.finishWrite(request, "removeCapability");
  }

  /** True if an agent advertises a capability. */
  async hasCapability(tokenId: bigint, capability: string): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.capsAddr(),
      abi: capabilityRegistryAbi,
      functionName: "hasCapability",
      args: [tokenId, capabilityTag(capability)],
    });
  }

  /** Raw capability tags an agent advertises. */
  async capabilitiesOf(tokenId: bigint): Promise<readonly Hex[]> {
    return this.publicClient.readContract({
      address: this.capsAddr(),
      abi: capabilityRegistryAbi,
      functionName: "capabilitiesOf",
      args: [tokenId],
    });
  }

  /** Discover the agents (tokenIds) advertising a capability. Pages via providersPage
   *  (bounded reads) so a popular tag never trips an eth_call response-size limit. */
  async providers(capability: string): Promise<bigint[]> {
    const tag = capabilityTag(capability);
    const PAGE = 500n;
    const out: bigint[] = [];
    for (let offset = 0n; ; offset += PAGE) {
      const page = await this.publicClient.readContract({
        address: this.capsAddr(),
        abi: capabilityRegistryAbi,
        functionName: "providersPage",
        args: [tag, offset, PAGE],
      });
      out.push(...page);
      if (BigInt(page.length) < PAGE) break;
    }
    return out;
  }

  /** An agent's service listing (URI, price, listed). */
  async listingOf(tokenId: bigint): Promise<{ serviceURI: string; pricePerCall: bigint; listed: boolean }> {
    const [serviceURI, pricePerCall, listed] = await this.publicClient.readContract({
      address: this.capsAddr(),
      abi: capabilityRegistryAbi,
      functionName: "listings",
      args: [tokenId],
    });
    return { serviceURI, pricePerCall, listed };
  }

  // --- coordination (TaskBoard) --------------------------------------------

  /** Post a task: escrow `rewardStt` and require `capability` of any worker. */
  async postTask(opts: {
    capability: string;
    rewardStt: string;
    deadline: number | bigint;
    specURI?: string;
  }): Promise<{ taskId: bigint; txHash: Hash }> {
    const { account } = this.requireSigner("postTask");
    const reward = parseStt(opts.rewardStt);
    const { request } = await this.publicClient.simulateContract({
      address: this.boardAddr(),
      abi: taskBoardAbi,
      functionName: "postTask",
      args: [capabilityTag(opts.capability), opts.specURI ?? "", BigInt(opts.deadline)],
      value: reward,
      account,
      gas: GAS.coord,
    });
    // Decode from the receipt we already waited on (no second fetch — a refetch can
    // miss the just-mined receipt on a fallback/load-balanced RPC and lose the taskId).
    const receipt = await this.finishWriteReceipt(request, "postTask");
    const events = parseEventLogs({ abi: taskBoardAbi, eventName: "TaskPosted", logs: receipt.logs });
    const ev = events.find((e) => getAddress(e.address) === getAddress(this.boardAddr()));
    if (!ev) throw new Error("asom: postTask landed but TaskPosted log was missing");
    return { taskId: ev.args.taskId, txHash: receipt.transactionHash };
  }

  /** A capable agent (workerTokenId, owned by the signer) accepts a task. */
  async acceptTask(taskId: bigint, workerTokenId: bigint): Promise<Hash> {
    const { account } = this.requireSigner("acceptTask");
    const { request } = await this.publicClient.simulateContract({
      address: this.boardAddr(),
      abi: taskBoardAbi,
      functionName: "acceptTask",
      args: [taskId, workerTokenId],
      account,
      gas: GAS.coord,
    });
    return this.finishWrite(request, "acceptTask");
  }

  /** The worker submits a result, starting the review window. */
  async submitResult(taskId: bigint, resultURI: string): Promise<Hash> {
    const { account } = this.requireSigner("submitResult");
    const { request } = await this.publicClient.simulateContract({
      address: this.boardAddr(),
      abi: taskBoardAbi,
      functionName: "submitResult",
      args: [taskId, resultURI],
      account,
      gas: GAS.coord,
    });
    return this.finishWrite(request, "submitResult");
  }

  /** The poster approves a submitted task; reward → the worker agent's wallet. */
  async approveTask(taskId: bigint): Promise<Hash> {
    const { account } = this.requireSigner("approveTask");
    const { request } = await this.publicClient.simulateContract({
      address: this.boardAddr(),
      abi: taskBoardAbi,
      functionName: "approveTask",
      args: [taskId],
      account,
      gas: GAS.coord,
    });
    return this.finishWrite(request, "approveTask");
  }

  /** The worker self-claims a submitted task after the review window lapses. */
  async workerClaim(taskId: bigint): Promise<Hash> {
    const { account } = this.requireSigner("workerClaim");
    const { request } = await this.publicClient.simulateContract({
      address: this.boardAddr(),
      abi: taskBoardAbi,
      functionName: "workerClaim",
      args: [taskId],
      account,
      gas: GAS.coord,
    });
    return this.finishWrite(request, "workerClaim");
  }

  /** The poster reclaims escrow (open task, or accepted-but-expired). */
  async refundTask(taskId: bigint): Promise<Hash> {
    const { account } = this.requireSigner("refundTask");
    const { request } = await this.publicClient.simulateContract({
      address: this.boardAddr(),
      abi: taskBoardAbi,
      functionName: "refund",
      args: [taskId],
      account,
      gas: GAS.coord,
    });
    return this.finishWrite(request, "refundTask");
  }

  /** Read a task record. */
  async getTask(taskId: bigint): Promise<Task> {
    const t = await this.publicClient.readContract({
      address: this.boardAddr(),
      abi: taskBoardAbi,
      functionName: "getTask",
      args: [taskId],
    });
    return {
      poster: getAddress(t.poster),
      capability: t.capability,
      reward: t.reward,
      deadline: t.deadline,
      submittedAt: t.submittedAt,
      workerTokenId: t.workerTokenId,
      status: t.status,
      specURI: t.specURI,
      resultURI: t.resultURI,
    };
  }

  /** The id the next posted task will get — i.e. (tasks posted so far) + 1. Enumerate
   *  the board with `getTask(1..nextTaskId()-1)`. */
  async nextTaskId(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.boardAddr(),
      abi: taskBoardAbi,
      functionName: "nextTaskId",
    });
  }

  /** An agent's ERC-6551 wallet address from its tokenId (deterministic; the same
   *  address `register` deployed). Lets a caller detect that a task's `poster` IS an
   *  agent's wallet — i.e. an agent that hired another agent. */
  async agentWallet(tokenId: bigint): Promise<Address> {
    const wallet = await this.publicClient.readContract({
      address: this.addresses.agentRegistry,
      abi: agentRegistryAbi,
      functionName: "previewAccount",
      args: [tokenId],
    });
    return getAddress(wallet);
  }

  // --- AI compute (LlmAgent / ParseAgent — the fundamental Somnia AI primitives) ---

  private llmAddr(): Address {
    const a = this.addresses.llmAgent;
    if (!a) throw new Error("asom: no LlmAgent deployed for this chain; pass addresses.llmAgent");
    return a;
  }

  private parseAddr(): Address {
    const a = this.addresses.parseAgent;
    if (!a) throw new Error("asom: no ParseAgent deployed for this chain; pass addresses.parseAgent");
    return a;
  }

  private aiTarget(kind: AiKind): { address: Address; abi: typeof llmAgentAbi | typeof parseAgentAbi } {
    return kind === "extract"
      ? { address: this.parseAddr(), abi: parseAgentAbi }
      : { address: this.llmAddr(), abi: llmAgentAbi };
  }

  /** The live deposit (wei) a single AI request needs — read on-chain, never hardcoded
   *  (it depends on the platform floor + the contract's per-agent reward × subcommittee). */
  async aiRequiredDeposit(kind: AiKind): Promise<bigint> {
    const { address, abi } = this.aiTarget(kind);
    return this.publicClient.readContract({ address, abi, functionName: "requiredDeposit" });
  }

  private async dispatchAi(
    kind: AiKind,
    functionName: "requestClassification" | "requestNumber" | "requestExtract",
    args: readonly unknown[],
  ): Promise<{ requestId: bigint; txHash: Hash }> {
    const { account } = this.requireSigner(functionName);
    const { address, abi } = this.aiTarget(kind);
    const deposit = await this.aiRequiredDeposit(kind);
    const { request } = await this.publicClient.simulateContract({
      address,
      abi,
      functionName,
      // viem can't narrow the union of the two ABIs here; the abi/args pair is correct.
      args: args as never,
      value: deposit,
      account,
      gas: GAS.coord,
    });
    const receipt = await this.finishWriteReceipt(request, functionName);
    const events = parseEventLogs({ abi, eventName: "RequestDispatched", logs: receipt.logs });
    const ev = events.find((e) => getAddress(e.address) === getAddress(address));
    if (!ev) throw new Error(`asom: ${functionName} landed but RequestDispatched log was missing`);
    return { requestId: (ev.args as { requestId: bigint }).requestId, txHash: receipt.transactionHash };
  }

  /** Ask the consensus LLM to classify `prompt` into one of `allowedValues`
   *  (e.g. ["accept","reject"] — an advisory, hard-to-game referee). */
  async aiClassify(
    prompt: string,
    allowedValues: string[],
    opts: { system?: string } = {},
  ): Promise<{ requestId: bigint; txHash: Hash }> {
    return this.dispatchAi("classify", "requestClassification", [prompt, opts.system ?? "", allowedValues]);
  }

  /** Ask the consensus LLM to infer a bounded integer in [min, max]. */
  async aiNumber(
    prompt: string,
    min: bigint,
    max: bigint,
    opts: { system?: string } = {},
  ): Promise<{ requestId: bigint; txHash: Hash }> {
    return this.dispatchAi("number", "requestNumber", [prompt, opts.system ?? "", min, max]);
  }

  /** Ask the consensus parse-website agent to extract a field from a page. */
  async aiExtract(p: ExtractParams): Promise<{ requestId: bigint; txHash: Hash }> {
    const tuple = {
      key: p.key,
      description: p.description,
      options: p.options ?? [],
      prompt: p.prompt,
      url: p.url,
      resolveUrl: p.resolveUrl ?? false,
      numPages: BigInt(p.numPages ?? 1),
      confidenceThreshold: BigInt(p.confidenceThreshold ?? 0),
    };
    return this.dispatchAi("extract", "requestExtract", [tuple]);
  }

  /** True while a dispatched request is still awaiting its consensus callback. */
  async aiPending(kind: AiKind, requestId: bigint): Promise<boolean> {
    const { address, abi } = this.aiTarget(kind);
    return this.publicClient.readContract({ address, abi, functionName: "pendingRequests", args: [requestId] });
  }

  /** The consensus receipt for a finalized request (validators + median cost). */
  async aiConsensus(
    kind: AiKind,
    requestId: bigint,
  ): Promise<{ validators: number; finalizedAt: number; receiptId: bigint; executionCost: bigint }> {
    const { address, abi } = this.aiTarget(kind);
    const r = await this.publicClient.readContract({ address, abi, functionName: "consensusOf", args: [requestId] });
    return {
      validators: Number(r.validators),
      finalizedAt: Number(r.finalizedAt),
      receiptId: r.receiptId,
      executionCost: r.executionCost,
    };
  }

  private async readAiValue(kind: AiKind, requestId: bigint): Promise<string | bigint | undefined> {
    if (kind === "classify") {
      const v = await this.publicClient.readContract({
        address: this.llmAddr(),
        abi: llmAgentAbi,
        functionName: "verdicts",
        args: [requestId],
      });
      return v.length > 0 ? v : undefined;
    }
    if (kind === "number") {
      const ready = await this.publicClient.readContract({
        address: this.llmAddr(),
        abi: llmAgentAbi,
        functionName: "numberReady",
        args: [requestId],
      });
      if (!ready) return undefined;
      return this.publicClient.readContract({
        address: this.llmAddr(),
        abi: llmAgentAbi,
        functionName: "numbers",
        args: [requestId],
      });
    }
    const ready = await this.publicClient.readContract({
      address: this.parseAddr(),
      abi: parseAgentAbi,
      functionName: "extractionReady",
      args: [requestId],
    });
    if (!ready) return undefined;
    return this.publicClient.readContract({
      address: this.parseAddr(),
      abi: parseAgentAbi,
      functionName: "extractions",
      args: [requestId],
    });
  }

  /**
   * Poll until a dispatched AI request finalizes (the consensus callback lands in a
   * LATER block — this is not synchronous). Resolves with the decoded value + receipt
   * on success, or `{ ok: false }` if it Failed / TimedOut. Throws on timeout.
   */
  async waitForAiResult(
    kind: AiKind,
    requestId: bigint,
    opts: { timeoutMs?: number; pollMs?: number } = {},
  ): Promise<AiResult> {
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const pollMs = opts.pollMs ?? 3_000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const pending = await this.aiPending(kind, requestId);
      if (!pending) {
        const receipt = await this.aiConsensus(kind, requestId);
        if (receipt.validators === 0) return { ok: false, kind }; // Failed / TimedOut
        const value = await this.readAiValue(kind, requestId);
        return { ok: true, kind, value, receipt };
      }
      if (Date.now() > deadline) {
        throw new Error(`asom: AI request ${requestId} (${kind}) did not finalize within ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  // --- Somnia base-agent resolution (the registry question) ----------------

  /** The live platform deposit floor (wei) for one Somnia Agents request, read on-chain.
   *  NB: the platform read is precompile-backed — it works on a live RPC but reverts
   *  inside forge simulation, so always read it here (off-chain), never hardcode it. */
  async somniaRequestDeposit(): Promise<bigint> {
    const platform = somniaPlatform[this.chainId];
    if (!platform) throw new Error(`asom: no Somnia Agents platform known for chain ${this.chainId}`);
    return this.publicClient.readContract({
      address: platform,
      abi: [
        {
          type: "function",
          name: "getRequestDeposit",
          stateMutability: "view",
          inputs: [],
          outputs: [{ name: "", type: "uint256" }],
        },
      ] as const,
      functionName: "getRequestDeposit",
    });
  }

  /**
   * Resolve Somnia's base AI agents. On a network where Somnia's enumerable
   * AgentRegistry is deployed (mainnet) this READS it (`getAllAgents` + `getAgent`,
   * with metadata URIs). On testnet — where that registry has empty bytecode — it
   * falls back to the hardcoded canonical ids (the documented two-store resolver
   * pattern). `source` on each entry tells you which backed it.
   */
  async resolveSomniaAgents(): Promise<SomniaAgentInfo[]> {
    const registry = somniaAgentRegistry[this.chainId];
    if (registry) {
      try {
        const ids = await this.publicClient.readContract({
          address: registry,
          abi: somniaAgentRegistryAbi,
          functionName: "getAllAgents",
        });
        const known = Object.values(somniaAgents);
        return await Promise.all(
          ids.map(async (id) => {
            const agent = await this.publicClient.readContract({
              address: registry,
              abi: somniaAgentRegistryAbi,
              functionName: "getAgent",
              args: [id],
            });
            const { metadataJsonUri, tarUri } = agent;
            const match = known.find((a) => a.id === id);
            return {
              id,
              capability: match?.capability,
              status: match?.status,
              metadataJsonUri,
              tarUri,
              source: "registry" as const,
            };
          }),
        );
      } catch {
        // Registry unreachable/upgraded — fall through to constants rather than throw.
      }
    }
    return Object.values(somniaAgents).map((a) => ({
      id: a.id,
      capability: a.capability,
      status: a.status,
      source: "constants" as const,
    }));
  }

  /** Explorer URL for an address or tx hash. Empty string if the chain has no explorer. */
  explorer(kind: "address" | "tx", value: string): string {
    const base = this.chain.blockExplorers?.default?.url;
    return base ? `${base}/${kind}/${value}` : "";
  }
}
