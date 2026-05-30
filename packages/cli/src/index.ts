import { Command } from "commander";
import pc from "picocolors";
import { parseEther } from "viem";
import { config as loadEnv } from "dotenv";
import { AsomClient, type Agent } from "@asom/sdk";
import { generateAgentKey, saveAgent, readAgent, listAgents, agentPath } from "./store.js";

loadEnv();

const FAUCET_URL = "https://cloud.google.com/application/web3/faucet/somnia/shannon";

// --- palette ---------------------------------------------------------------
const brand = (s: string) => pc.bold(pc.magenta(s));
const accent = (s: string) => pc.cyan(s);
const ok = (s: string) => pc.green(s);
const warn = (s: string) => pc.yellow(s);
const bad = (s: string) => pc.red(s);
const muted = (s: string) => pc.dim(s);
const label = (s: string) => pc.dim(pc.gray(s.padEnd(8)));

function banner() {
  // shown once per command, keeps the CLI feeling alive
  console.log("");
  console.log(`  ${brand("◆ asom")} ${muted("· agents on Somnia")}`);
}

const program = new Command();

program
  .name("asom")
  .description("Create and operate agents on Somnia — every agent gets a name and a wallet.")
  .version("0.0.2");

/** Your own funding wallet — bring your own key via PRIVATE_KEY (env or .env). */
function requireKey(): `0x${string}` {
  const key = process.env.PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) {
    console.log("");
    console.error(bad("  ✗ PRIVATE_KEY not set."));
    console.error(`    Creating an agent costs gas, so bring a funded Somnia key:`);
    console.error(`    ${accent("export PRIVATE_KEY=0xYOUR_KEY")} ${muted("(or put it in a .env file)")}`);
    console.error(muted(`    No STT yet? Faucet → ${FAUCET_URL}`));
    console.log("");
    process.exit(1);
  }
  return key;
}

function client(key?: `0x${string}`): AsomClient {
  return new AsomClient({ privateKey: key, rpcUrl: process.env.SHANNON_RPC_URL });
}

function formatStt(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 4);
  return `${whole}.${frac}`;
}

/** Check the signer can afford an op; if not, point at the faucet (testnet) or SOMI (mainnet). */
async function assertFunded(c: AsomClient, needStt: number, what: string): Promise<void> {
  const addr = c.signerAddress!;
  const bal = await c.getBalance(addr);
  if (bal >= parseEther(needStt.toString())) return;

  console.log("");
  console.error(bad(`  ✗ Not enough STT to ${what}.`));
  console.error(`    ${accent(addr)} has ${warn(formatStt(bal))} STT, needs ~${needStt}.`);
  if (c.chainId === 50312) {
    console.error(`    Grab testnet STT → ${accent(FAUCET_URL)}`);
    console.error(muted(`    or Somnia Discord → #dev-chat`));
  } else {
    console.error(`    Send ${accent("SOMI")} to ${accent(addr)} to fund it.`);
  }
  console.log("");
  process.exit(1);
}

function printAgent(c: AsomClient, agent: Agent, balanceWei?: bigint) {
  console.log("");
  console.log(`  ${pc.bold(pc.bgMagenta(pc.white(` ${agent.name}@asom `)))}  ${muted("self-sovereign agent")}`);
  console.log("");
  console.log(`  ${label("token")} ${pc.bold("#" + agent.tokenId)}`);
  console.log(`  ${label("wallet")} ${accent(agent.account)}`);
  console.log(`  ${label("owner")} ${agent.owner}`);
  if (balanceWei !== undefined) {
    console.log(`  ${label("balance")} ${ok(formatStt(balanceWei))} STT`);
  }
  const url = c.explorer("address", agent.account);
  if (url) console.log(`  ${label("explorer")} ${muted(url)}`);
  console.log("");
}

program
  .command("create")
  .description("Create a self-sovereign agent: generates its keypair, mints its NFT + wallet")
  .argument("<name>", "agent name (a-z, 0-9, hyphen; 1-32 chars)")
  .option("-s, --seed <stt>", "STT to seed the new agent wallet (TBA) with", "0.02")
  .option("-g, --gas <stt>", "STT to fund the agent's owner key for gas so it can act", "0.005")
  .action(async (name: string, opts: { seed: string; gas: string }) => {
    banner();
    const c = client(requireKey());
    await assertFunded(c, parseFloat(opts.seed) + parseFloat(opts.gas) + 0.05, `create ${name}@asom`);

    if (!(await c.isAvailable(name))) {
      console.error(bad(`  ✗ ${name}@asom is already taken.`));
      process.exit(1);
    }
    if (readAgent(name)) {
      console.error(bad(`  ✗ You already have a local agent named ${name} (${agentPath(name)}).`));
      process.exit(1);
    }

    // Generate the agent's OWN key and register the NFT to it — the agent owns
    // itself. Your wallet only pays gas + the seed.
    const { privateKey, address } = generateAgentKey();
    console.log(muted(`  spinning up ${name}@asom...`));

    try {
      const agent = await c.createAgent(name, { owner: address, seedStt: opts.seed });
      saveAgent({
        name,
        ownerAddress: address,
        ownerKey: privateKey,
        account: agent.account,
        tokenId: agent.tokenId.toString(),
        chainId: c.chainId,
        createdAt: new Date().toISOString(),
      });

      let gasTx: string | undefined;
      if (parseFloat(opts.gas) > 0) gasTx = await c.send(address, opts.gas);

      console.log(ok(`  ✨ ${pc.bold(name + "@asom")} is alive and owns itself.`));
      printAgent(c, agent, await c.getBalance(agent.account));
      console.log(`  ${label("🔑 key")} ${muted(agentPath(name) + " (chmod 600)")}`);
      console.log(`  ${label("📜 tx")} ${muted(c.explorer("tx", agent.txHash))}`);
      if (gasTx) {
        console.log(`  ${label("⛽ gas")} ${ok(opts.gas + " STT")} → owner ${muted("(can act now)")}`);
      } else {
        console.log(muted(`  note: fund ${name}'s owner key to let it act — asom fund ${name}`));
      }
      console.log("");
    } catch (err) {
      console.error(bad("  ✗ create failed:"), (err as Error).message);
      process.exit(1);
    }
  });

program
  .command("resolve")
  .description("Resolve a name to its agent (no key needed)")
  .argument("<name>", "agent name to look up")
  .action(async (name: string) => {
    const c = client();
    try {
      const agent = await c.resolve(name);
      printAgent(c, agent, await c.getBalance(agent.account));
    } catch {
      console.log("");
      console.error(warn(`  ${name}@asom is not registered yet.`) + muted(`  (claim it: asom create ${name})`));
      console.log("");
      process.exit(1);
    }
  });

program
  .command("available")
  .description("Check whether a name is still free")
  .argument("<name>", "agent name to check")
  .action(async (name: string) => {
    const free = await client().isAvailable(name);
    console.log(
      free ? ok(`  ✓ ${pc.bold(name + "@asom")} is available`) : bad(`  ✗ ${name}@asom is taken`),
    );
  });

program
  .command("ls")
  .description("List the agents you own locally (~/.asom/agents)")
  .action(() => {
    const agents = listAgents();
    if (agents.length === 0) {
      console.log(muted("  No local agents yet. Create one: ") + accent("asom create neo"));
      return;
    }
    console.log("");
    console.log(`  ${brand(`your agents (${agents.length})`)}`);
    for (const a of agents) {
      console.log(`  ${accent("◆")} ${pc.bold(a.name + "@asom")} ${muted("#" + a.tokenId)}  ${muted(a.account)}`);
    }
    console.log("");
  });

program
  .command("fund")
  .description("Top up an agent's owner key (gas) and/or its wallet (TBA)")
  .argument("<name>", "agent name")
  .option("-g, --gas <stt>", "STT to send to the owner key (for gas to act)", "0.01")
  .option("-w, --wallet <stt>", "STT to send to the agent wallet (TBA)", "0")
  .action(async (name: string, opts: { gas: string; wallet: string }) => {
    banner();
    const c = client(requireKey());
    let agent: Agent;
    try {
      agent = await c.resolve(name);
    } catch {
      console.error(warn(`  ${name}@asom is not registered.`));
      process.exit(1);
    }
    const total = parseFloat(opts.gas) + parseFloat(opts.wallet);
    if (total <= 0) {
      console.log(muted("  Nothing to send. Use --gas <stt> and/or --wallet <stt>."));
      return;
    }
    await assertFunded(c, total + 0.02, `fund ${name}@asom`);

    if (parseFloat(opts.gas) > 0) {
      const tx = await c.send(agent.owner, opts.gas);
      console.log(ok(`  ⛽ ${opts.gas} STT`) + ` → owner ${muted(agent.owner)}`);
      console.log(`     ${muted(c.explorer("tx", tx))}`);
    }
    if (parseFloat(opts.wallet) > 0) {
      const tx = await c.send(agent.account, opts.wallet);
      console.log(ok(`  👛 ${opts.wallet} STT`) + ` → wallet ${muted(agent.account)}`);
      console.log(`     ${muted(c.explorer("tx", tx))}`);
    }
  });

program
  .command("whoami")
  .description("Show the address of your funding key (PRIVATE_KEY)")
  .action(() => {
    const key = process.env.PRIVATE_KEY as `0x${string}` | undefined;
    console.log(key ? accent(client(key).signerAddress!) : muted("PRIVATE_KEY not set"));
  });

program.parseAsync(process.argv);
