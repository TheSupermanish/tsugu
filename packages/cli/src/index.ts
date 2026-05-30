import { Command } from "commander";
import pc from "picocolors";
import { parseEther } from "viem";
import { config as loadEnv } from "dotenv";
import { AsomClient, type Agent } from "@asom/sdk";
import { saveAgent, readAgent, listAgents } from "./store.js";
import {
  ASOM_HOME,
  hasKeystore,
  keystoreAddress,
  saveKeystore,
  loadKeystore,
  removeKeystore,
  prompt,
} from "./keystore.js";

loadEnv();

const FAUCET_URL = "https://cloud.google.com/application/web3/faucet/somnia/shannon";

// --- palette ---------------------------------------------------------------
const brand = (s: string) => pc.bold(pc.magenta(s));
const accent = (s: string) => pc.cyan(s);
const ok = (s: string) => pc.green(s);
const warn = (s: string) => pc.yellow(s);
const bad = (s: string) => pc.red(s);
const muted = (s: string) => pc.dim(s);
const label = (s: string) => pc.dim(pc.gray(s.padEnd(9)));

function banner() {
  console.log("");
  console.log(`  ${brand("◆ asom")} ${muted("· agents on Somnia")}`);
}

const program = new Command();
program
  .name("asom")
  .description("Create and operate agents on Somnia — every agent gets a name and a wallet.")
  .version("0.0.2");

/**
 * Resolve the signing key, non-custodially:
 *   1. PRIVATE_KEY env  (testnet shortcut — your risk)
 *   2. encrypted keystore (asom login) — unlock with password (or ASOM_PASSWORD)
 * Never stored by asom beyond the local encrypted file.
 */
async function getKey(): Promise<`0x${string}`> {
  const fromEnv = process.env.PRIVATE_KEY as `0x${string}` | undefined;
  if (fromEnv) return fromEnv;

  if (hasKeystore()) {
    const pw = process.env.ASOM_PASSWORD ?? (await prompt("  password: ", true));
    try {
      return loadKeystore(pw);
    } catch {
      console.error(bad("  ✗ wrong password."));
      process.exit(1);
    }
  }

  console.log("");
  console.error(bad("  ✗ No key found."));
  console.error(`    Import your funded Somnia key once: ${accent("asom login")}`);
  console.error(muted(`    (or export PRIVATE_KEY=0x… for a quick testnet run)`));
  console.error(muted(`    No STT? Faucet → ${FAUCET_URL}`));
  console.log("");
  process.exit(1);
}

function client(key?: `0x${string}`): AsomClient {
  return new AsomClient({ privateKey: key, rpcUrl: process.env.SHANNON_RPC_URL });
}

function formatStt(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 4);
  return `${whole}.${frac}`;
}

async function assertFunded(c: AsomClient, needStt: number, what: string): Promise<void> {
  const addr = c.signerAddress!;
  const bal = await c.getBalance(addr);
  if (bal >= parseEther(needStt.toString())) return;
  console.log("");
  console.error(bad(`  ✗ Not enough STT to ${what}.`));
  console.error(`    ${accent(addr)} has ${warn(formatStt(bal))} STT, needs ~${needStt}.`);
  if (c.chainId === 50312) {
    console.error(`    Grab testnet STT → ${accent(FAUCET_URL)}`);
  } else {
    console.error(`    Send ${accent("SOMI")} to ${accent(addr)} to fund it.`);
  }
  console.log("");
  process.exit(1);
}

function printAgent(c: AsomClient, agent: Agent, balanceWei?: bigint) {
  console.log("");
  console.log(`  ${pc.bold(pc.bgMagenta(pc.white(` ${agent.name}@asom `)))}`);
  console.log("");
  console.log(`  ${label("token")} ${pc.bold("#" + agent.tokenId)}`);
  console.log(`  ${label("wallet")} ${accent(agent.account)}`);
  console.log(`  ${label("owner")} ${agent.owner}`);
  if (balanceWei !== undefined) console.log(`  ${label("balance")} ${ok(formatStt(balanceWei))} STT`);
  const url = c.explorer("address", agent.account);
  if (url) console.log(`  ${label("explorer")} ${muted(url)}`);
  console.log("");
}

// --- key management --------------------------------------------------------

program
  .command("login")
  .description("Import your funded Somnia key into an encrypted keystore (one time)")
  .action(async () => {
    banner();
    if (hasKeystore()) {
      const yes = await prompt(`  A key is already stored (${keystoreAddress()}). Replace it? [y/N] `);
      if (yes.toLowerCase() !== "y") return;
    }
    const key = (await prompt("  private key (0x…, hidden): ", true)) as `0x${string}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      console.error(bad("  ✗ Not a valid 0x-prefixed private key."));
      process.exit(1);
    }
    const pw = await prompt("  new password: ", true);
    const pw2 = await prompt("  confirm password: ", true);
    if (pw !== pw2) {
      console.error(bad("  ✗ Passwords don't match."));
      process.exit(1);
    }
    if (pw.length < 8) {
      console.error(bad("  ✗ Use at least 8 characters."));
      process.exit(1);
    }
    const addr = saveKeystore(key, pw);
    console.log(ok(`  ✓ Key encrypted and saved to ${ASOM_HOME}/keystore.json`));
    console.log(`  ${label("address")} ${accent(addr)}`);
    console.log(muted("  Your key is encrypted on this machine. asom never sends or stores it anywhere else."));
  });

const key = program.command("key").description("Manage your encrypted key");

key
  .command("export")
  .description("Reveal your private key (after password) — for backup or import elsewhere")
  .action(async () => {
    banner();
    if (!hasKeystore()) {
      console.error(bad("  ✗ No keystore. Run: asom login"));
      process.exit(1);
    }
    const pw = await prompt("  password: ", true);
    let pk: string;
    try {
      pk = loadKeystore(pw);
    } catch {
      console.error(bad("  ✗ wrong password."));
      process.exit(1);
    }
    console.log(warn("  ⚠ Anyone with this key controls your wallet. Don't share or paste it anywhere."));
    console.log("");
    console.log(`  ${pk}`);
    console.log("");
  });

key
  .command("address")
  .description("Show your keystore address (no password needed)")
  .action(() => {
    const addr = keystoreAddress();
    console.log(addr ? accent(addr) : muted("No keystore. Run: asom login"));
  });

program
  .command("logout")
  .description("Delete the encrypted keystore from this machine")
  .action(async () => {
    if (!hasKeystore()) {
      console.log(muted("  Nothing to remove."));
      return;
    }
    const yes = await prompt(`  Delete keystore for ${keystoreAddress()}? Make sure you exported it. [y/N] `);
    if (yes.toLowerCase() !== "y") return;
    removeKeystore();
    console.log(ok("  ✓ Keystore removed."));
  });

// --- agents ----------------------------------------------------------------

program
  .command("create")
  .description("Create an agent: a name + its own ERC-6551 wallet, owned by you")
  .argument("<name>", "agent name (a-z, 0-9, hyphen; 1-32 chars)")
  .option("-s, --seed <stt>", "STT to seed the new agent wallet with", "0.02")
  .action(async (name: string, opts: { seed: string }) => {
    banner();
    const c = client(await getKey());
    await assertFunded(c, parseFloat(opts.seed) + 0.05, `create ${name}@asom`);

    if (!(await c.isAvailable(name))) {
      console.error(bad(`  ✗ ${name}@asom is already taken.`));
      process.exit(1);
    }
    console.log(muted(`  spinning up ${name}@asom...`));
    try {
      const agent = await c.createAgent(name, { seedStt: opts.seed }); // owner defaults to you
      saveAgent({
        name,
        account: agent.account,
        owner: agent.owner,
        tokenId: agent.tokenId.toString(),
        chainId: c.chainId,
        createdAt: new Date().toISOString(),
      });
      console.log(ok(`  ✨ ${pc.bold(name + "@asom")} is live.`));
      printAgent(c, agent, await c.getBalance(agent.account));
      console.log(`  ${label("📜 tx")} ${muted(c.explorer("tx", agent.txHash))}`);
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
    console.log(free ? ok(`  ✓ ${pc.bold(name + "@asom")} is available`) : bad(`  ✗ ${name}@asom is taken`));
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
  .description("Send STT to an agent's wallet (TBA)")
  .argument("<name>", "agent name")
  .option("-w, --wallet <stt>", "STT to send to the agent wallet", "0.01")
  .action(async (name: string, opts: { wallet: string }) => {
    banner();
    const c = client(await getKey());
    let agent: Agent;
    try {
      agent = await c.resolve(name);
    } catch {
      console.error(warn(`  ${name}@asom is not registered.`));
      process.exit(1);
    }
    const amt = parseFloat(opts.wallet);
    if (amt <= 0) {
      console.log(muted("  Nothing to send. Use --wallet <stt>."));
      return;
    }
    await assertFunded(c, amt + 0.02, `fund ${name}@asom`);
    const tx = await c.send(agent.account, opts.wallet);
    console.log(ok(`  👛 ${opts.wallet} STT`) + ` → ${name}@asom wallet ${muted(agent.account)}`);
    console.log(`     ${muted(c.explorer("tx", tx))}`);
  });

program
  .command("whoami")
  .description("Show your address (from keystore or PRIVATE_KEY)")
  .action(() => {
    const envKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;
    if (envKey) return console.log(accent(client(envKey).signerAddress!) + muted("  (from PRIVATE_KEY)"));
    const addr = keystoreAddress();
    console.log(addr ? accent(addr) + muted("  (keystore)") : muted("No key. Run: asom login"));
  });

program.parseAsync(process.argv);
