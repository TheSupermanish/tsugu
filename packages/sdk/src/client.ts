import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  getAddress,
  type Address,
  type Chain,
  type Hash,
  type PublicClient,
  type WalletClient,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { shannon } from "./chain.js";
import { deployments } from "./addresses.js";
import { agentRegistryAbi, agentNftAbi } from "./abis.js";

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
}

export interface AsomClientOptions {
  /** Target chain. Defaults to Somnia Shannon. Pass a custom chain (e.g. anvil) for tests/forks. */
  chain?: Chain;
  /** RPC URL override. Defaults to the chain's public RPC. */
  rpcUrl?: string;
  /** 0x-prefixed private key. Required only for write operations. */
  privateKey?: `0x${string}`;
  /** Address override. Defaults to the known deployment for `chain.id`. */
  addresses?: AsomAddresses;
}

/**
 * AsomClient — the programmatic entry point to asom.
 *
 * Read methods (resolve, isAvailable, getBalance) need no key.
 * Write methods (createAgent) require `privateKey`.
 */
export class AsomClient {
  readonly chain: Chain;
  readonly chainId: number;
  readonly addresses: AsomAddresses;
  private readonly publicClient: PublicClient;
  private readonly account?: Account;
  private readonly walletClient?: WalletClient;

  constructor(opts: AsomClientOptions = {}) {
    this.chain = opts.chain ?? shannon;
    this.chainId = this.chain.id;
    const addresses = opts.addresses ?? deployments[this.chainId];
    if (!addresses) {
      throw new Error(
        `asom: no deployment known for chain ${this.chainId}; pass { addresses }`,
      );
    }
    this.addresses = addresses;

    const transport = http(opts.rpcUrl);
    this.publicClient = createPublicClient({ chain: this.chain, transport });

    if (opts.privateKey) {
      this.account = privateKeyToAccount(opts.privateKey);
      this.walletClient = createWalletClient({
        account: this.account,
        chain: this.chain,
        transport,
      });
    }
  }

  /** Address of the signer, if a private key was provided. */
  get signerAddress(): Address | undefined {
    return this.account?.address;
  }

  /** Resolve `<name>` to its agent. Throws if unregistered. */
  async resolve(name: string): Promise<Agent> {
    const [tokenId, account, owner, createdAt] =
      await this.publicClient.readContract({
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

  /**
   * Create an agent: mint the NFT, deploy its ERC-6551 wallet, register the name.
   * @param name   the agent name (validated on-chain: a-z, 0-9, hyphen; 1-32 chars)
   * @param opts.owner  who receives the agent NFT (defaults to the signer)
   * @param opts.seedStt  STT to seed the new wallet with, as a decimal string (e.g. "0.05")
   * @returns the created agent plus the registration tx hash
   */
  async createAgent(
    name: string,
    opts: { owner?: Address; seedStt?: string } = {},
  ): Promise<Agent & { txHash: Hash }> {
    if (!this.walletClient || !this.account) {
      throw new Error("asom: createAgent requires a privateKey");
    }
    const owner = opts.owner ? getAddress(opts.owner) : this.account.address;
    const value = opts.seedStt ? parseEther(opts.seedStt) : 0n;

    // Simulate first: this reverts early (with the decoded reason, e.g. NameTaken)
    // before any gas is spent, instead of mining a failed tx. Shannon's gas
    // estimator undercounts, so we pin an explicit limit; simulate carries it through.
    const { request } = await this.publicClient.simulateContract({
      address: this.addresses.agentRegistry,
      abi: agentRegistryAbi,
      functionName: "register",
      args: [name, owner],
      value,
      gas: 5_000_000n,
      account: this.account,
    });

    const hash = await this.walletClient.writeContract(request);

    // Defensive: a tx can still revert after a clean simulate (state changed
    // between simulate and mine). waitForTransactionReceipt does NOT throw on
    // a reverted status, so check it explicitly.
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      throw new Error(`asom: register("${name}") reverted on-chain (tx ${hash})`);
    }

    const agent = await this.resolve(name);
    return { ...agent, txHash: hash };
  }

  /**
   * Send native STT from the signer to any address.
   * @param to   recipient (an agent's owner key for gas, or its wallet/TBA for funds)
   * @param stt  amount as a decimal string, e.g. "0.01"
   */
  async send(to: Address, stt: string): Promise<Hash> {
    if (!this.walletClient || !this.account) {
      throw new Error("asom: send requires a privateKey");
    }
    const hash = await this.walletClient.sendTransaction({
      to: getAddress(to),
      value: parseEther(stt),
      account: this.account,
      chain: this.chain,
      // Shannon inflates intrinsic gas: a plain transfer that's ~21k elsewhere
      // OOG's well past 100k here. Pin generously — you only pay gas actually used.
      gas: 500_000n,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      throw new Error(`asom: send to ${to} reverted (tx ${hash})`);
    }
    return hash;
  }

  /** Explorer URL for an address or tx hash. Empty string if the chain has no explorer. */
  explorer(kind: "address" | "tx", value: string): string {
    const base = this.chain.blockExplorers?.default?.url;
    return base ? `${base}/${kind}/${value}` : "";
  }
}
