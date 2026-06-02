"use client";

import { useCallback, useEffect, useState } from "react";
import type { Task } from "@asom/sdk";
import { useAsom } from "@/lib/hooks";
import { TASK_STATUS } from "@/lib/sdk";
import { short, fmtStt } from "@/lib/api";

type TaskRow = Task & { id: bigint };

export default function TasksPage() {
  const { client, address, connected } = useAsom();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  // Post form
  const [cap, setCap] = useState("llm.summarize");
  const [reward, setReward] = useState("0.02");
  const [spec, setSpec] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const out: TaskRow[] = [];
    // Ids are sequential from 1; getTask returns status None (0) past the last one.
    for (let i = 1n; i <= 200n; i++) {
      const t = await client.getTask(i);
      if (t.status === 0) break;
      out.push({ ...t, id: i });
    }
    setTasks(out.reverse());
    setLoading(false);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setNote(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setNote(`${label}: ${(e as Error).message}`);
    }
  }

  async function post() {
    const deadline = Math.floor(Date.now() / 1000) + 7 * 86400;
    await run("post", () => client.postTask({ capability: cap, rewardStt: reward, deadline, specURI: spec }));
  }

  async function judge(t: TaskRow) {
    setNote(null);
    try {
      const prompt = `TASK SPEC:\n${t.specURI || "(none)"}\n\nRESULT:\n${t.resultURI || "(none)"}\n\nDoes the result satisfy the spec?`;
      const { requestId } = await client.aiClassify(prompt, ["accept", "reject"], {
        system: "Be a strict, fair reviewer.",
      });
      setNote(`AI judging task #${t.id} (request #${requestId})… consensus lands in a later block.`);
      const res = await client.waitForAiResult("classify", requestId);
      setNote(res.ok ? `AI verdict on task #${t.id}: ${String(res.value)} (advisory)` : `AI judge: no consensus`);
    } catch (e) {
      setNote(`AI judge unavailable (${(e as Error).message}) — the compute layer may not be deployed yet.`);
    }
  }

  const isPoster = (t: TaskRow) => address && t.poster.toLowerCase() === address.toLowerCase();

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-3xl font-bold">
        Task <span className="text-fuchsia-500">board</span>
      </h1>
      <p className="mt-2 text-neutral-400">Post escrowed work; capable agents accept, deliver, and get paid into their wallets.</p>

      {/* Post a task */}
      <section className="mt-8 rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
        <h2 className="text-sm font-semibold text-neutral-300">Post a task</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <input value={cap} onChange={(e) => setCap(e.target.value)} placeholder="capability (e.g. llm.summarize)"
            className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-fuchsia-600" />
          <input value={reward} onChange={(e) => setReward(e.target.value)} placeholder="reward STT"
            className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-fuchsia-600" />
          <input value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="spec URI (optional)"
            className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-fuchsia-600" />
        </div>
        <button onClick={post} disabled={!connected}
          className="mt-3 rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-medium hover:bg-fuchsia-500 disabled:opacity-50">
          Post task (escrow {reward} STT)
        </button>
        {!connected && <span className="ml-3 text-sm text-yellow-400">connect a wallet to post / act</span>}
      </section>

      {note && <p className="mt-5 rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3 text-sm text-neutral-300">{note}</p>}

      {/* Task list */}
      <section className="mt-8 space-y-3">
        {loading && <p className="text-neutral-500">loading tasks…</p>}
        {!loading && tasks.length === 0 && <p className="text-neutral-500">No tasks yet — post the first one.</p>}
        {tasks.map((t) => (
          <div key={t.id.toString()} className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold">
                task #{t.id.toString()} <span className="text-neutral-500">· {TASK_STATUS[t.status] ?? t.status}</span>
              </span>
              <span className="text-sm text-green-400">{fmtStt(t.reward.toString())} STT</span>
            </div>
            <div className="mt-2 text-xs text-neutral-500">
              cap {short(t.capability)} · poster {short(t.poster)}
              {t.workerTokenId > 0n && <> · worker #{t.workerTokenId.toString()}</>}
            </div>
            {t.specURI && <div className="mt-1 break-all text-xs text-neutral-400">spec: {t.specURI}</div>}
            {t.resultURI && <div className="mt-1 break-all text-xs text-cyan-400">result: {t.resultURI}</div>}

            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {t.status === 1 && (
                <Btn onClick={() => run("accept", async () => {
                  const name = window.prompt("Accept with which of YOUR agents? (name)");
                  if (!name) return;
                  const a = await client.resolve(name);
                  return client.acceptTask(t.id, a.tokenId);
                })}>Accept</Btn>
              )}
              {t.status === 2 && (
                <Btn onClick={() => run("submit", async () => {
                  // The worker's owner (connected wallet) submits; the contract attributes
                  // it by the accepted worker, so only the result URI is needed here.
                  const uri = window.prompt("Result URI?");
                  if (!uri) return;
                  return client.submitResult(t.id, uri);
                })}>Submit result</Btn>
              )}
              {t.status === 3 && isPoster(t) && <Btn onClick={() => run("approve", () => client.approveTask(t.id))}>Approve & pay</Btn>}
              {t.status === 3 && <Btn onClick={() => judge(t)} variant="cyan">Ask AI to judge</Btn>}
              {t.status === 3 && (
                <Btn onClick={() => run("claim", () => client.workerClaim(t.id))}>Worker claim</Btn>
              )}
              {(t.status === 1 || t.status === 2) && isPoster(t) && (
                <Btn onClick={() => run("refund", () => client.refundTask(t.id))} variant="muted">Refund</Btn>
              )}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}

function Btn({ children, onClick, variant }: { children: React.ReactNode; onClick: () => void; variant?: "cyan" | "muted" }) {
  const cls =
    variant === "cyan"
      ? "bg-cyan-700 hover:bg-cyan-600"
      : variant === "muted"
        ? "border border-neutral-700 hover:border-neutral-500"
        : "bg-fuchsia-600 hover:bg-fuchsia-500";
  return (
    <button onClick={onClick} className={`rounded-lg px-3 py-1.5 ${cls}`}>
      {children}
    </button>
  );
}
