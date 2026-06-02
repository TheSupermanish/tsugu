/**
 * Live verification of the asom coordination layer on Somnia Shannon:
 *   advertise (discovery) → discover → post task (escrow) → accept → submit →
 *   approve → reward paid into the WORKER AGENT'S OWN wallet.
 *
 * The worker's owner key starts cold and is topped to opGasBudget before each write
 * (mirrors the CLI). Run: PRIVATE_KEY=0x... tsx scripts/verify-coordination.mts
 */
import { AsomClient } from "@asom/sdk";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { formatEther, type Address } from "viem";

const RPC = process.env.SHANNON_RPC_URL ?? "https://dream-rpc.somnia.network";
const PK = process.env.PRIVATE_KEY as `0x${string}` | undefined;
if (!PK) throw new Error("set PRIVATE_KEY");

const operator = new AsomClient({ privateKey: PK, rpcUrls: [RPC] }); // poster + funder
const workerKey = generatePrivateKey();
const workerAddr = privateKeyToAccount(workerKey).address;
const worker = new AsomClient({ privateKey: workerKey, rpcUrls: [RPC] });

const CAP = "demo.echo";
const NAME = `wkr-${workerAddr.slice(2, 8).toLowerCase()}`;
const REWARD = "0.02";
const stt = (w: bigint) => `${formatEther(w)} STT`;
const ex = (h: string) => operator.explorer("tx", h);
const log = (...a: unknown[]) => console.log(...a);

async function topUp(addr: Address): Promise<void> {
  const budget = await operator.opGasBudget();
  const bal = await operator.getBalance(addr);
  if (bal < budget) await operator.sendWei(addr, budget - bal);
}

async function main() {
  log(`\n■ asom coordination verification — capability "${CAP}" on Shannon (chain ${operator.chainId})`);
  log(`  poster (operator) ${operator.signerAddress}`);
  log(`  worker owner key  ${workerAddr} (cold; gas auto-topped)`);

  // 0) Mint the worker agent.
  const agent = await operator.createAgent(NAME, { owner: workerAddr });
  log(`\n[0] worker agent ${NAME}@asom — token ${agent.tokenId}, wallet ${agent.account}  ${ex(agent.txHash)}`);

  // 1) Discovery: the worker advertises the capability.
  await topUp(workerAddr);
  const adTx = await worker.advertise(agent.tokenId, {
    capabilities: [CAP],
    serviceURI: "https://worker.example/agent.json",
    pricePerCall: "0.001",
  });
  log(`\n[1] advertised "${CAP}"  ${ex(adTx)}`);
  const provs = await operator.providers(CAP);
  log(`    hasCapability: ${await operator.hasCapability(agent.tokenId, CAP)}`);
  log(`    providers("${CAP}"): [${provs.map(String).join(", ")}]`);
  if (!provs.map(String).includes(String(agent.tokenId))) throw new Error("agent not discoverable");

  // 2) Coordination: poster posts a task with an escrowed reward.
  const { taskId, txHash: postTx } = await operator.postTask({
    capability: CAP,
    rewardStt: REWARD,
    deadline: 2_000_000_000,
    specURI: "ipfs://demo-task",
  });
  log(`\n[2] posted task #${taskId} (reward ${REWARD} STT escrowed)  ${ex(postTx)}`);

  // 3) Worker accepts + submits.
  await topUp(workerAddr);
  const acceptTx = await worker.acceptTask(taskId, agent.tokenId);
  log(`\n[3] worker accepted task #${taskId}  ${ex(acceptTx)}`);
  await topUp(workerAddr);
  const submitTx = await worker.submitResult(taskId, "ipfs://demo-result");
  log(`    worker submitted result  ${ex(submitTx)}`);

  // 4) Poster approves → reward into the worker agent's OWN wallet.
  const before = await operator.getBalance(agent.account);
  const approveTx = await operator.approveTask(taskId);
  const after = await operator.getBalance(agent.account);
  log(`\n[4] poster approved → reward paid to the agent wallet  ${ex(approveTx)}`);
  log(`    agent wallet: ${stt(before)} → ${stt(after)}`);
  if (after - before !== 20_000_000_000_000_000n) throw new Error("reward not paid into the agent's own wallet");

  const t = await operator.getTask(taskId);
  if (t.status !== 4) throw new Error(`expected Approved (4), got status ${t.status}`);

  log(`\n✓ ALL COORDINATION CHECKS PASSED`);
  log(`\nEVIDENCE (for DEPLOYMENTS.md):`);
  log(`  worker=${NAME}@asom token=${agent.tokenId} wallet=${agent.account}`);
  log(`  advertise=${adTx}`);
  log(`  postTask=${postTx} (taskId ${taskId})`);
  log(`  accept=${acceptTx}`);
  log(`  submit=${submitTx}`);
  log(`  approve=${approveTx}`);
}

main().catch((e) => {
  console.error("\n✗ coordination verification failed:", e);
  process.exit(1);
});
