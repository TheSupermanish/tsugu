// Genuine multi-agent coordination on Somnia Shannon.
//
//   poster ──hire(summarize, 0.02)──▶ Agent A (coordinator)
//                                        │ spends its OWN wallet to hire help:
//                                        ├─hire(data.fetch, 0.005)──▶ Agent B  → B's wallet earns
//                                        └─hire(web.extract,0.005)──▶ Agent C  → C's wallet earns
//                                        │ composes, submits
//   poster approves ──────────────────────▶ Agent A's wallet earns 0.02 (net +0.01 after paying B,C)
//
// Distinct agent identities, each with its OWN ERC-6551 wallet; escrow secures every hop.
// PK via env DEMO_PK (never printed). Agents B/C are reused across runs via .demo-agents.json.
import { AsomClient, capabilityTag, shannon } from "../packages/sdk/dist/index.js";
import { createPublicClient, createWalletClient, http, formatEther, encodeFunctionData, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const RPC = "https://dream-rpc.somnia.network";
const EXPLORER = "https://shannon-explorer.somnia.network";
const TASKBOARD = "0xA59f329689fD5DA78D0fE79dc285297E050a2B16";
const STATE = new URL("./.demo-agents.json", import.meta.url).pathname;
const STATUS = ["None", "Open", "Accepted", "Submitted", "Approved", "Refunded"];

const pkRaw = process.env.DEMO_PK;
if (!pkRaw) throw new Error("set DEMO_PK");
const pk = pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`;
const account = privateKeyToAccount(pk);

const client = new AsomClient({ rpcUrl: RPC, privateKey: pk });
const pub = createPublicClient({ chain: shannon, transport: http(RPC) });

const POST_TASK = { type: "function", name: "postTask", stateMutability: "payable", inputs: [{ name: "capability", type: "bytes32" }, { name: "specURI", type: "string" }, { name: "deadline", type: "uint64" }], outputs: [{ name: "taskId", type: "uint256" }] };
const APPROVE_TASK = { type: "function", name: "approveTask", stateMutability: "nonpayable", inputs: [{ name: "taskId", type: "uint256" }], outputs: [] };
const TASK_POSTED = { type: "event", name: "TaskPosted", inputs: [{ name: "taskId", type: "uint256", indexed: true }, { name: "poster", type: "address", indexed: true }, { name: "capability", type: "bytes32", indexed: true }, { name: "reward", type: "uint256" }, { name: "deadline", type: "uint64" }, { name: "specURI", type: "string" }] };

const link = (h) => `${EXPLORER}/tx/${h}`;
const bal = async (a) => Number(formatEther(await pub.getBalance({ address: a })));
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 3600);

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};

async function ensureAgent(key, name, cap) {
  // reuse a previously-created demo agent if it's still ours
  if (state[key]) {
    try {
      const a = await client.resolve(state[key].name);
      if (a.owner.toLowerCase() === account.address.toLowerCase()) return a;
    } catch {}
  }
  let agent;
  try {
    const a = await client.resolve(name);
    agent = a.owner.toLowerCase() === account.address.toLowerCase() ? a : null;
  } catch { agent = null; }
  if (!agent) {
    console.log(`   creating agent ${name} (cap ${cap})…`);
    agent = await client.createAgent(name, {});
  }
  const caps = (await client.capabilitiesOf(agent.tokenId)).map((x) => x.toLowerCase());
  if (!caps.includes(capabilityTag(cap).toLowerCase())) {
    console.log(`   advertising ${cap} on ${name}…`);
    await client.advertise(agent.tokenId, { capabilities: [cap] });
  }
  state[key] = { name: agent.name ?? name, tokenId: agent.tokenId.toString(), account: agent.account };
  writeFileSync(STATE, JSON.stringify(state, null, 2));
  return agent;
}

async function subHire(coordinator, cap, worker, escrowStt) {
  const data = encodeFunctionData({ abi: [POST_TASK], functionName: "postTask", args: [capabilityTag(cap), `ipfs://demo/${cap}-spec.json`, deadline()] });
  const postHash = await client.agentExecute(coordinator.account, { to: TASKBOARD, value: escrowStt, data });
  const rcpt = await pub.waitForTransactionReceipt({ hash: postHash });
  const ev = parseEventLogs({ abi: [TASK_POSTED], logs: rcpt.logs })[0];
  const subId = ev.args.taskId;
  console.log(`   • A's wallet posted subtask #${subId} (${cap}, ${escrowStt} STT)  ${link(postHash)}`);
  await client.acceptTask(subId, worker.tokenId);
  await client.submitResult(subId, `ipfs://demo/${cap}-result.json`);
  const approveData = encodeFunctionData({ abi: [APPROVE_TASK], functionName: "approveTask", args: [subId] });
  const approveHash = await client.agentExecute(coordinator.account, { to: TASKBOARD, data: approveData });
  await pub.waitForTransactionReceipt({ hash: approveHash });
  console.log(`   • worker accepted, submitted; A approved #${subId} → worker paid  ${link(approveHash)}`);
  return subId;
}

console.log("=== asom multi-agent coordination — live on Shannon (50312) ===\n");

console.log("Setting up agents (each is a distinct identity with its OWN wallet):");
let A;
try { A = await client.resolve("summarizer-875e"); } catch { A = { name: "summarizer-875e", tokenId: 8n, account: "0xF3d20e1a562ba6ff752921a9697d44a91FaBA685", owner: account.address }; }
console.log(`   A = ${A.name} (coordinator, llm.summarize)  wallet ${A.account}`);
const B = await ensureAgent("fetcher", "fetcher-bot", "data.fetch");
console.log(`   B = ${B.name ?? "fetcher-bot"} (data.fetch)  wallet ${B.account}`);
const C = await ensureAgent("extractor", "extractor-bot", "web.extract");
console.log(`   C = ${C.name ?? "extractor-bot"} (web.extract)  wallet ${C.account}`);

// A needs funds in its OWN wallet to hire B and C (2 × 0.005 + buffer)
if (await bal(A.account) < 0.02) {
  console.log("\n   funding A's wallet so it can hire help…");
  await client.send(A.account, "0.03");
}

const before = { A: await bal(A.account), B: await bal(B.account), C: await bal(C.account) };
console.log(`\nwallet balances BEFORE — A:${before.A}  B:${before.B}  C:${before.C} STT`);

console.log("\n1) poster hires coordinator A (cap llm.summarize, escrow 0.02)");
const t1 = await client.postTask({ capability: "llm.summarize", rewardStt: "0.02", deadline: deadline(), specURI: "ipfs://demo/compound-job.json" });
console.log(`   task #${t1.taskId} Open  ${link(t1.txHash)}`);
await client.acceptTask(t1.taskId, A.tokenId);
console.log(`   A accepted task #${t1.taskId}`);

console.log("\n2) A (an agent!) hires two other agents from its OWN wallet:");
await subHire(A, "data.fetch", B, "0.005");
await subHire(A, "web.extract", C, "0.005");

console.log("\n3) A composes B+C's results, submits; poster approves");
await client.submitResult(t1.taskId, "ipfs://demo/final-composed.json");
const approveTop = await client.approveTask(t1.taskId);
console.log(`   poster approved #${t1.taskId} → A's wallet paid  ${link(approveTop)}`);

const after = { A: await bal(A.account), B: await bal(B.account), C: await bal(C.account) };
console.log(`\nwallet balances AFTER  — A:${after.A}  B:${after.B}  C:${after.C} STT`);
console.log(`   Δ  A:${(after.A - before.A).toFixed(4)} (earned 0.02, spent 0.01 hiring)   B:+${(after.B - before.B).toFixed(4)}   C:+${(after.C - before.C).toFixed(4)}`);
console.log("\n=== one agent hired two others; all three settled into their OWN wallets; escrow secured every hop ===");
