"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parseEther, parseEventLogs } from "viem";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { PACT_KINDS, CLAIM_TYPES, shannon } from "@asom/sdk";
import { vaultAbi, vaultAddress, GAS, KIND_META, CLAIM_META, type ClaimType } from "@/lib/vault";
import { ConnectButton } from "@/components/ConnectButton";
import { Seam } from "@/components/ui";

type CheckDraft = { claimType: ClaimType; source: string; jsonPath: string; resolveUrl: boolean };

const WINDOWS = [
  { label: "Instant", secs: 0 },
  { label: "1 hour", secs: 3600 },
  { label: "1 day", secs: 86400 },
  { label: "3 days", secs: 259200 },
];

const blankCheck = (): CheckDraft => ({ claimType: "Web", source: "", jsonPath: "", resolveUrl: false });

export default function CreatePact() {
  const router = useRouter();
  const { isConnected, chainId } = useAccount();
  const wrongNetwork = isConnected && chainId !== undefined && chainId !== shannon.id;
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { data: receipt, isLoading: confirming } = useWaitForTransactionReceipt({ hash });

  const [kind, setKind] = useState<number>(0);
  const [claim, setClaim] = useState("");
  const [beneficiary, setBeneficiary] = useState("");
  const [days, setDays] = useState(7);
  const [windowSecs, setWindowSecs] = useState(3600);
  const [checks, setChecks] = useState<CheckDraft[]>([blankCheck()]);
  const [quorum, setQuorum] = useState(1);
  const [seed, setSeed] = useState("");
  const [earnYield, setEarnYield] = useState(false);

  useEffect(() => {
    if (!receipt) return;
    try {
      const ev = parseEventLogs({ abi: vaultAbi, eventName: "PactCreated", logs: receipt.logs })[0] as
        | { args: { pactId: bigint } }
        | undefined;
      router.push(ev ? `/pact/${Number(ev.args.pactId)}` : "/");
    } catch {
      router.push("/");
    }
  }, [receipt, router]);

  const setCheck = (i: number, patch: Partial<CheckDraft>) =>
    setChecks((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const addCheck = () => setChecks((cs) => (cs.length < 8 ? [...cs, blankCheck()] : cs));
  const removeCheck = (i: number) =>
    setChecks((cs) => {
      const next = cs.filter((_, j) => j !== i);
      setQuorum((q) => Math.min(q, next.length));
      return next;
    });

  const beneficiaryOk = /^0x[a-fA-F0-9]{40}$/.test(beneficiary);
  const checksOk = checks.every(
    (c) => c.source.trim().length > 0 && (c.claimType !== "Data" || c.jsonPath.trim().length > 0),
  );
  const valid =
    claim.trim().length > 0 && beneficiaryOk && checks.length > 0 && checksOk && quorum >= 1 && quorum <= checks.length;

  const seedWei = useMemo(() => {
    try {
      return seed.trim() ? parseEther(seed.trim()) : 0n;
    } catch {
      return null;
    }
  }, [seed]);

  function submit() {
    if (!valid || seedWei === null) return;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + days * 86400);
    writeContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "createPact",
      args: [
        {
          kind,
          beneficiary: beneficiary as `0x${string}`,
          deadline,
          disputeWindow: BigInt(windowSecs),
          quorum,
          earnYield,
          claim: claim.trim(),
          checks: checks.map((c) => ({
            claimType: CLAIM_TYPES.indexOf(c.claimType),
            resolveUrl: c.resolveUrl,
            source: c.source.trim(),
            jsonPath: c.claimType === "Data" ? c.jsonPath.trim() : "",
          })),
        },
      ],
      value: seedWei,
      gas: GAS.create,
      chainId: shannon.id, // pin to Somnia — never dispatch createPact on the wrong chain
    });
  }

  const busy = isPending || confirming;

  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <p className="text-sm uppercase tracking-[0.2em] text-porcelain-dim">New pact</p>
      <h1 className="mt-2 text-4xl">Fund something worth proving.</h1>
      <p className="mt-3 max-w-xl text-porcelain-muted">
        Define the claim, point the AI at the evidence, and set how many independent sources must agree
        before the money releases.
      </p>

      <div className="mt-10 space-y-8">
        {/* The claim */}
        <section className="panel p-6">
          <h2 className="text-lg">The claim</h2>
          <p className="mt-1 text-sm text-porcelain-dim">A statement the AI will judge true or false against the evidence.</p>

          <div className="mt-5">
            <span className="label">Kind</span>
            <div className="flex flex-wrap gap-2">
              {PACT_KINDS.map((k, i) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(i)}
                  className={`chip ${
                    kind === i
                      ? "border-gold-600/60 bg-gold-500/10 text-gold-200"
                      : "border-ink-600 bg-ink-900/60 text-porcelain-dim hover:text-porcelain-muted"
                  }`}
                  title={KIND_META[k].blurb}
                >
                  <span className="text-gold-400">{KIND_META[k].glyph}</span> {k}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-porcelain-faint">{KIND_META[PACT_KINDS[kind]].blurb}</p>
          </div>

          <div className="mt-5">
            <label className="label" htmlFor="claim">Claim</label>
            <textarea
              id="claim"
              rows={3}
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
              placeholder="e.g. The patient completed heart surgery at St. Mary's Hospital in June 2026."
              className="input resize-none"
            />
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="ben">Beneficiary (paid on proof)</label>
              <input
                id="ben"
                value={beneficiary}
                onChange={(e) => setBeneficiary(e.target.value)}
                placeholder="0x…"
                className={`input font-mono text-sm ${beneficiary && !beneficiaryOk ? "border-rust/60" : ""}`}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Deadline</label>
                <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="input">
                  {[3, 7, 14, 30, 60].map((d) => (
                    <option key={d} value={d}>{d} days</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" title="A cooling-off delay after confirmation, before release.">Dispute window</label>
                <select value={windowSecs} onChange={(e) => setWindowSecs(Number(e.target.value))} className="input">
                  {WINDOWS.map((w) => (
                    <option key={w.secs} value={w.secs}>{w.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* Evidence */}
        <section className="panel p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg">Evidence sources</h2>
              <p className="mt-1 text-sm text-porcelain-dim">Each is verified independently by a Somnia AI agent.</p>
            </div>
            <button type="button" onClick={addCheck} disabled={checks.length >= 8} className="btn-ghost py-1.5 text-xs disabled:opacity-40">
              + Add source
            </button>
          </div>

          <div className="mt-5 space-y-4">
            {checks.map((c, i) => (
              <div key={i} className="rounded-xl border border-ink-700 bg-ink-950/40 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex gap-1.5">
                    {CLAIM_TYPES.map((ct) => (
                      <button
                        key={ct}
                        type="button"
                        onClick={() => setCheck(i, { claimType: ct })}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                          c.claimType === ct ? "bg-gold-500/15 text-gold-200" : "text-porcelain-dim hover:text-porcelain-muted"
                        }`}
                        title={CLAIM_META[ct].agent}
                      >
                        {CLAIM_META[ct].label}
                      </button>
                    ))}
                  </div>
                  {checks.length > 1 && (
                    <button type="button" onClick={() => removeCheck(i)} className="text-xs text-porcelain-faint hover:text-rust">
                      remove
                    </button>
                  )}
                </div>

                <div className="mt-3">
                  <input
                    value={c.source}
                    onChange={(e) => setCheck(i, { source: e.target.value })}
                    placeholder={
                      c.claimType === "Text"
                        ? "Paste the statement / evidence the LLM should reason over…"
                        : "https://… (the page or JSON endpoint the AI will read)"
                    }
                    className="input text-sm"
                  />
                </div>

                {c.claimType === "Data" && (
                  <div className="mt-3">
                    <input
                      value={c.jsonPath}
                      onChange={(e) => setCheck(i, { jsonPath: e.target.value })}
                      placeholder="JSON path to a boolean, e.g. data.confirmed"
                      className="input font-mono text-xs"
                    />
                  </div>
                )}
                {c.claimType === "Web" && (
                  <label className="mt-3 flex items-center gap-2 text-xs text-porcelain-dim">
                    <input type="checkbox" checked={c.resolveUrl} onChange={(e) => setCheck(i, { resolveUrl: e.target.checked })} />
                    Domain-search the site first (instead of reading this exact page)
                  </label>
                )}
                <p className="mt-2 text-xs text-porcelain-faint">→ {CLAIM_META[c.claimType].agent}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <span className="label mb-0">Quorum</span>
            <select value={quorum} onChange={(e) => setQuorum(Number(e.target.value))} className="input w-auto">
              {Array.from({ length: checks.length }, (_, i) => i + 1).map((q) => (
                <option key={q} value={q}>{q}</option>
              ))}
            </select>
            <span className="text-sm text-porcelain-dim">of {checks.length} sources must confirm</span>
          </div>
        </section>

        {/* Seed + yield */}
        <section className="panel p-6">
          <h2 className="text-lg">Seed it (optional)</h2>
          <p className="mt-1 text-sm text-porcelain-dim">Kick off the escrow with your own contribution. Others can add more.</p>
          <div className="mt-4 flex items-center gap-2">
            <input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="0.0"
              inputMode="decimal"
              className={`input w-40 font-mono ${seedWei === null ? "border-rust/60" : ""}`}
            />
            <span className="text-porcelain-dim">STT</span>
          </div>

          <button
            type="button"
            onClick={() => setEarnYield((v) => !v)}
            className={`mt-5 flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors ${
              earnYield ? "border-gold-600/60 bg-gold-500/5" : "border-ink-700 hover:border-ink-600"
            }`}
          >
            <span
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border ${
                earnYield ? "border-gold-500 bg-gold-500 text-ink-950" : "border-ink-600"
              }`}
            >
              {earnYield ? "✓" : ""}
            </span>
            <span>
              <span className="text-porcelain">Earn yield while it waits</span>
              <span className="mt-0.5 block text-xs text-porcelain-dim">
                Escrow is put to work until proof. On release the beneficiary gets principal + yield; if denied or
                unresolved, contributors are refunded principal + their share of yield. Adds venue risk — opt-in.
              </span>
            </span>
          </button>
        </section>

        <Seam />

        {/* Submit */}
        <div className="flex flex-col items-start gap-3">
          {!isConnected ? (
            <div className="flex items-center gap-3">
              <ConnectButton />
              <span className="text-sm text-porcelain-dim">Connect your wallet to open a pact.</span>
            </div>
          ) : wrongNetwork ? (
            <div className="flex items-center gap-3">
              <ConnectButton />
              <span className="text-sm text-amber-200">Switch to Somnia Shannon to open a pact.</span>
            </div>
          ) : (
            <button onClick={submit} disabled={!valid || busy || seedWei === null} className="btn-gold">
              {busy ? "Opening pact…" : "Open pact"}
            </button>
          )}
          {!valid && isConnected && (
            <p className="text-xs text-porcelain-faint">Add a claim, a valid beneficiary address, and at least one evidence source.</p>
          )}
          {error && <p className="text-sm text-rust">{(error as { shortMessage?: string }).shortMessage ?? "Transaction failed."}</p>}
        </div>
      </div>
    </div>
  );
}
