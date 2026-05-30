import { Command } from "commander";
import pc from "picocolors";
import { parseEther } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { config as loadEnv } from "dotenv";
import { TsuguClient, type Agent } from "@tsugu/sdk";
import { saveAgent, readAgent, listAgents } from "./store.js";
import {
  TSUGU_HOME,
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
  console.log(`  ${brand("◆ tsugu")} ${muted("· agents on Somnia")}`);
}

const program = new Command();
program
  .name("tsugu")
  .description("Create and operate agents on Somnia — every agent gets a name and a wallet.")
  .version("0.0.2");

/**
 * Resolve the signing key, non-custodially:
 *   1. PRIVATE_KEY env  (testnet shortcut — your risk)
 *   2. encrypted keystore (tsugu login) — unlock with password (or TSUGU_PASSWORD)
 * Never stored by tsugu beyond the local encrypted file.
 */
async function getKey(): Promise<`0x${string}`> {
  const fromEnv = process.env.PRIVATE_KEY as `0x${string}` | undefined;
  if (fromEnv) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(fromEnv)) {
      console.error(bad("  ✗ PRIVATE_KEY is set but not a valid 0x-prefixed 32-byte key."));
      process.exit(1);
    }
    console.error(
      muted("  ⚠ using a plaintext PRIVATE_KEY — fine for testnet. For an encrypted wallet: ") +
        accent("tsugu login"),
    );
    return fromEnv;
  }

  if (hasKeystore()) {
    const envPw = process.env.TSUGU_PASSWORD;
    if (envPw) console.error(muted("  ⚠ using TSUGU_PASSWORD from env — for automation only (it's visible to child processes)."));
    const pw = envPw ?? (await prompt("  password: ", true, false));
    try {
      return loadKeystore(pw);
    } catch (e) {
      console.error(bad(`  ✗ ${(e as Error).message}.`));
      process.exit(1);
    }
  }

  console.log("");
  console.error(bad("  ✗ No key found."));
  console.error(`    Import your funded Somnia key once: ${accent("tsugu login")}`);
  console.error(muted(`    (or export PRIVATE_KEY=0x… for a quick testnet run)`));
  console.error(muted(`    No STT? Faucet → ${FAUCET_URL}`));
  console.log("");
  process.exit(1);
}

function client(key?: `0x${string}`): TsuguClient {
  return new TsuguClient({ privateKey: key, rpcUrl: process.env.SHANNON_RPC_URL });
}

function formatStt(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 4);
  return `${whole}.${frac}`;
}

async function assertFunded(c: TsuguClient, needStt: number, what: string): Promise<void> {
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

function printAgent(c: TsuguClient, agent: Agent, balanceWei?: bigint) {
  console.log("");
  console.log(`  ${pc.bold(pc.bgMagenta(pc.white(` ${agent.name}@tsugu `)))}`);
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
  .description("Set up your wallet: generate a new one or import an existing key (encrypted)")
  .option("--import", "import an existing private key instead of generating a new wallet")
  .action(async (opts: { import?: boolean }) => {
    banner();
    if (hasKeystore()) {
      const yes = await prompt(`  A wallet is already set up (${keystoreAddress()}). Replace it? [y/N] `);
      if (yes.toLowerCase() !== "y") return;
    }

    // Default = generate a fresh wallet. --import (or answering "i") brings your own.
    let mode = opts.import ? "import" : "new";
    if (!opts.import) {
      const choice = await prompt("  [N]ew wallet or [i]mport existing key?  (N) ");
      if (choice.toLowerCase().startsWith("i")) mode = "import";
    }

    let key: `0x${string}`;
    if (mode === "import") {
      key = (await prompt("  private key (0x…, hidden): ", true)) as `0x${string}`;
      if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
        console.error(bad("  ✗ Not a valid 0x-prefixed private key."));
        process.exit(1);
      }
    } else {
      key = generatePrivateKey(); // generated locally, on your machine — never sent anywhere
    }

    const pw = await prompt("  set a password: ", true, false);
    const pw2 = await prompt("  confirm password: ", true, false);
    if (pw !== pw2) {
      console.error(bad("  ✗ Passwords don't match."));
      process.exit(1);
    }
    if (pw.length < 8) {
      console.error(bad("  ✗ Use at least 8 characters."));
      process.exit(1);
    }

    const addr = saveKeystore(key, pw);
    console.log("");
    console.log(ok(`  ✓ Wallet ${mode === "new" ? "created" : "imported"} and encrypted → ${TSUGU_HOME}/keystore.json`));
    console.log(`  ${label("address")} ${accent(addr)}`);
    if (mode === "new") {
      console.log("");
      console.log(muted("  This is a brand-new wallet with 0 STT. Fund it to create agents:"));
      console.log(`  ${accent(FAUCET_URL)}`);
      console.log(muted(`  Back it up any time with: tsugu key export`));
    }
    console.log(muted("  Your key is encrypted on this machine. tsugu never sends or stores it anywhere."));
  });

const key = program.command("key").description("Manage your encrypted key");

key
  .command("export")
  .description("Reveal your private key (after password) — for backup or import elsewhere")
  .action(async () => {
    banner();
    if (!hasKeystore()) {
      console.error(bad("  ✗ No keystore. Run: tsugu login"));
      process.exit(1);
    }
    const pw = await prompt("  password: ", true, false);
    let pk: string;
    try {
      pk = loadKeystore(pw);
    } catch (e) {
      console.error(bad(`  ✗ ${(e as Error).message}.`));
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
    console.log(addr ? accent(addr) : muted("No keystore. Run: tsugu login"));
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
    await assertFunded(c, parseFloat(opts.seed) + 0.05, `create ${name}@tsugu`);

    if (!(await c.isAvailable(name))) {
      console.error(bad(`  ✗ ${name}@tsugu is already taken.`));
      process.exit(1);
    }
    console.log(muted(`  spinning up ${name}@tsugu...`));
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
      console.log(ok(`  ✨ ${pc.bold(name + "@tsugu")} is live.`));
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
      console.error(warn(`  ${name}@tsugu is not registered yet.`) + muted(`  (claim it: tsugu create ${name})`));
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
    console.log(free ? ok(`  ✓ ${pc.bold(name + "@tsugu")} is available`) : bad(`  ✗ ${name}@tsugu is taken`));
  });

program
  .command("ls")
  .description("List the agents you own locally (~/.tsugu/agents)")
  .action(() => {
    const agents = listAgents();
    if (agents.length === 0) {
      console.log(muted("  No local agents yet. Create one: ") + accent("tsugu create neo"));
      return;
    }
    console.log("");
    console.log(`  ${brand(`your agents (${agents.length})`)}`);
    for (const a of agents) {
      console.log(`  ${accent("◆")} ${pc.bold(a.name + "@tsugu")} ${muted("#" + a.tokenId)}  ${muted(a.account)}`);
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
      console.error(warn(`  ${name}@tsugu is not registered.`));
      process.exit(1);
    }
    const amt = parseFloat(opts.wallet);
    if (amt <= 0) {
      console.log(muted("  Nothing to send. Use --wallet <stt>."));
      return;
    }
    await assertFunded(c, amt + 0.02, `fund ${name}@tsugu`);
    const tx = await c.send(agent.account, opts.wallet);
    console.log(ok(`  👛 ${opts.wallet} STT`) + ` → ${name}@tsugu wallet ${muted(agent.account)}`);
    console.log(`     ${muted(c.explorer("tx", tx))}`);
  });

program
  .command("whoami")
  .description("Show your address (from keystore or PRIVATE_KEY)")
  .action(() => {
    const envKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;
    if (envKey) return console.log(accent(client(envKey).signerAddress!) + muted("  (from PRIVATE_KEY)"));
    const addr = keystoreAddress();
    console.log(addr ? accent(addr) + muted("  (keystore)") : muted("No key. Run: tsugu login"));
  });

program.parseAsync(process.argv);
