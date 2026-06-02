// Live coordination-layer demo on Somnia Shannon.
// Drives a full task lifecycle through the deployed TaskBoard:
//   post (EOA escrows reward) -> accept (agent #8, capability-gated) -> submit -> approve
// and shows the reward landing in agent #8's ERC-6551 wallet.
// PK is passed via env (DEMO_PK) so the key is never written to disk or printed.
import { AsomClient } from "../packages/sdk/dist/index.js";

const RPC = "https://dream-rpc.somnia.network";
const EXPLORER = "https://shannon-explorer.somnia.network";
const AGENT8_WALLET = "0xF3d20e1a562ba6ff752921a9697d44a91FaBA685";
const STATUS = ["None", "Open", "Accepted", "Submitted", "Approved", "Refunded"];

const pk = process.env.DEMO_PK;
if (!pk) throw new Error("set DEMO_PK");

const client = new AsomClient({ rpcUrl: RPC, privateKey: pk.startsWith("0x") ? pk : `0x${pk}` });

const tx = (h) => `${EXPLORER}/tx/${h}`;
async function showStatus(taskId, label) {
  const t = await client.getTask(taskId);
  console.log(`   state: ${STATUS[Number(t.status)]}  (worker tokenId ${t.workerTokenId}, reward ${Number(t.reward) / 1e18} STT)  ${label}`);
}
async function walletBal() {
  const bal = await client.getBalance(AGENT8_WALLET);
  return Number(bal) / 1e18;
}

console.log("=== asom coordination layer — live on Shannon (chain 50312) ===\n");
console.log(`worker agent #8 wallet ${AGENT8_WALLET}`);
console.log(`  balance BEFORE: ${await walletBal()} STT\n`);

const deadline = Math.floor(Date.now() / 1000) + 3600;

console.log("1) postTask  — EOA posts work requiring capability 'llm.summarize', escrows 0.01 STT");
const { taskId, txHash: postTx } = await client.postTask({
  capability: "llm.summarize",
  rewardStt: "0.01",
  deadline,
  specURI: "ipfs://demo/spec-summarize-this-thread.json",
});
console.log(`   taskId ${taskId}  tx ${tx(postTx)}`);
await showStatus(taskId, "(event: TaskPosted)");

console.log("\n2) acceptTask — agent #8 (owned by signer, advertises llm.summarize) claims it");
const acceptTx = await client.acceptTask(taskId, 8n);
console.log(`   tx ${tx(acceptTx)}`);
await showStatus(taskId, "(event: TaskAccepted — capability gate passed)");

console.log("\n3) submitResult — agent #8 delivers, starting the review window");
const submitTx = await client.submitResult(taskId, "ipfs://demo/result-summary.json");
console.log(`   tx ${tx(submitTx)}`);
await showStatus(taskId, "(event: TaskSubmitted)");

console.log("\n4) approveTask — poster approves; reward pays into agent #8's OWN wallet");
const approveTx = await client.approveTask(taskId);
console.log(`   tx ${tx(approveTx)}`);
await showStatus(taskId, "(event: TaskApproved)");

console.log(`\nworker agent #8 wallet balance AFTER: ${await walletBal()} STT  <- reward landed in the agent's wallet`);
console.log("\n=== full post -> accept -> submit -> settle lifecycle confirmed on-chain ===");
