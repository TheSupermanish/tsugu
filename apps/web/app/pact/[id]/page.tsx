"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { parseEther, zeroAddress } from "viem";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { shannon } from "@asom/sdk";
import {
  vaultAbi,
  vaultAddress,
  GAS,
  EXPLORER,
  type Pact,
  type Check,
  kindName,
  claimName,
  statusName,
  checkName,
  KIND_META,
  CLAIM_META,
  STATUS_META,
  CHECK_META,
  fmtStt,
  shortAddr,
  timeLeft,
} from "@/lib/vault";
import { Badge, Seam } from "@/components/ui";
import { SeamMeter } from "@/components/SeamMeter";
import { ConnectButton } from "@/components/ConnectButton";

export default function PactPage({ params }: { params: { id: string } }) {
  const id = BigInt(params.id);
  const { address, isConnected, chainId } = useAccount();
  const wrongNetwork = isConnected && chainId !== undefined && chainId !== shannon.id;

  const pactQ = useReadContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "getPact",
    args: [id],
    query: { refetchInterval: 5000 },
  });
  const depQ = useReadContract({ address: vaultAddress, abi: vaultAbi, functionName: "requiredDeposit" });
  const mineQ = useReadContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "contributionOf",
    args: [id, (address ?? zeroAddress) as `0x${string}`],
    query: { enabled: !!address, refetchInterval: 5000 },
  });
  const yieldQ = useReadContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "yieldValue",
    args: [id],
    query: { refetchInterval: 5000 },
  });

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const [action, setAction] = useState<string>("");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (isSuccess) {
      pactQ.refetch();
      mineQ.refetch();
      setAction("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  const pact = pactQ.data as Pact | undefined;
  const deposit = (depQ.data as bigint | undefined) ?? 0n;
  const mine = (mineQ.data as bigint | undefined) ?? 0n;
  const busy = isPending || confirming;

  if (pactQ.isLoading && !pact) {
    return <div className="mx-auto max-w-4xl px-6 py-20 text-porcelain-dim">Reading the pact from Somnia…</div>;
  }
  if (pactQ.isError || !pact) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-20">
        <p className="text-rust">No pact #{params.id} found.</p>
        <Link href="/" className="btn-ghost mt-4">← All pacts</Link>
      </div>
    );
  }

  const kind = kindName(pact.kind);
  const status = statusName(pact.status);
  const sm = STATUS_META[status];
  const km = KIND_META[kind];
  const statuses = pact.checks.map((c) => c.status);
  const confirmed = statuses.filter((s) => checkName(s) === "Confirmed").length;
  const now = Math.floor(Date.now() / 1000);
  const releasableTs = Number(pact.confirmedAt) + Number(pact.disputeWindow);
  const active = pact.status === 0 || pact.status === 1;
  const canRelease = pact.status === 2 && now >= releasableTs && pact.escrow > 0n;
  const inWindow = pact.status === 2 && now < releasableTs;
  const canRefund = (pact.status === 3 || pact.status === 5) && mine > 0n;
  const canExpire = active && now > Number(pact.deadline);
  const releaseAmt = pact.yieldOn ? ((yieldQ.data as bigint | undefined) ?? pact.escrow) : pact.escrow;

  // Parse the fund amount once (null = empty or invalid) so the button can validate.
  let fundWei: bigint | null;
  try {
    fundWei = amount.trim() ? parseEther(amount.trim()) : null;
  } catch {
    fundWei = null;
  }

  const send = (functionName: string, args: unknown[], opts: { value?: bigint; gas: bigint }, label: string) => {
    setAction(label);
    // chainId pins the write to Somnia: on the wrong network wagmi throws instead of
    // silently dispatching to this address on another chain.
    writeContract({ address: vaultAddress, abi: vaultAbi, functionName, args, chainId: shannon.id, ...opts } as never);
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <Link href="/" className="text-sm text-porcelain-dim transition-colors hover:text-porcelain-muted">← All pacts</Link>

      {/* Header */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span className="chip border-ink-600 bg-ink-800/60 text-porcelain-muted">
          <span className="text-gold-400">{km.glyph}</span> {km.label}
        </span>
        <Badge label={sm.label} tone={sm.tone} pulse={sm.pulse} />
        <span className="text-xs text-porcelain-faint">Pact #{params.id}</span>
      </div>
      <h1 className="mt-4 text-3xl leading-tight sm:text-4xl">{pact.claim}</h1>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-porcelain-dim">
        <span>
          Beneficiary{" "}
          <a className="font-mono text-porcelain-muted hover:text-gold-300" href={`${EXPLORER}/address/${pact.beneficiary}`} target="_blank" rel="noreferrer">
            {shortAddr(pact.beneficiary)}
          </a>
        </span>
        <span>{active ? timeLeft(pact.deadline) : `deadline ${new Date(Number(pact.deadline) * 1000).toLocaleDateString()}`}</span>
      </div>

      {/* Escrow + seam */}
      <div className="panel-raised mt-8 p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-porcelain-dim">Escrowed</div>
            <div className="font-mono text-3xl text-gold-300">{fmtStt(pact.escrow)} <span className="text-lg text-porcelain-dim">STT</span></div>
          </div>
          {mine > 0n && <div className="text-sm text-porcelain-dim">You contributed <span className="text-porcelain">{fmtStt(mine)} STT</span></div>}
        </div>
        {pact.yieldOn && (() => {
          const yv = (yieldQ.data as bigint | undefined) ?? pact.escrow;
          const earned = yv > pact.escrow ? yv - pact.escrow : 0n;
          return (
            <div className="mt-3 flex items-center gap-2 text-sm">
              <span className="chip border-gold-600/50 bg-gold-500/10 text-gold-300">⟳ Earning yield</span>
              <span className="text-porcelain-dim">
                now worth <span className="font-mono text-porcelain">{fmtStt(yv)} STT</span>
                {earned > 0n && <span className="text-jade"> (+{fmtStt(earned)})</span>}
              </span>
            </div>
          );
        })()}
        <div className="mt-5">
          <SeamMeter statuses={statuses} quorum={pact.quorum} />
        </div>
      </div>

      {/* Evidence checks */}
      <h2 className="mt-10 text-sm font-medium uppercase tracking-[0.2em] text-porcelain-dim">
        Evidence — {confirmed}/{pact.quorum} confirmed across {pact.checks.length} {pact.checks.length === 1 ? "source" : "sources"}
      </h2>
      <div className="mt-4 space-y-3">
        {pact.checks.map((c, i) => (
          <CheckRow
            key={i}
            index={i}
            check={c}
            canVerify={active && now <= Number(pact.deadline) && (checkName(c.status) === "Pending" || checkName(c.status) === "Inconclusive")}
            deposit={deposit}
            connected={isConnected}
            busy={busy}
            pendingThis={action === `verify-${i}`}
            onVerify={() => send("requestResolution", [id, BigInt(i)], { value: deposit, gas: GAS.resolve }, `verify-${i}`)}
          />
        ))}
      </div>

      <Seam className="my-10" />

      {wrongNetwork && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
          <span className="text-sm text-amber-200">You&apos;re on the wrong network — Tsugu lives on Somnia Shannon.</span>
          <ConnectButton />
        </div>
      )}

      {/* Actions */}
      <div className="grid gap-5 sm:grid-cols-2">
        {/* Fund */}
        {active && (
          <div className="panel p-5">
            <h3 className="text-lg">Fund this pact</h3>
            <p className="mt-1 text-sm text-porcelain-dim">Escrowed safely. Released on proof, refundable if denied.</p>
            <div className="mt-4 flex gap-2">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                inputMode="decimal"
                className={`input font-mono ${amount && fundWei === null ? "border-rust/60" : ""}`}
              />
              {isConnected ? (
                <button
                  className="btn-gold whitespace-nowrap"
                  disabled={busy || fundWei === null || wrongNetwork}
                  onClick={() => fundWei !== null && send("contribute", [id], { value: fundWei, gas: GAS.contribute }, "fund")}
                >
                  {action === "fund" && busy ? "Funding…" : "Fund"}
                </button>
              ) : (
                <ConnectButton />
              )}
            </div>
          </div>
        )}

        {/* Settlement */}
        <div className="panel p-5">
          <h3 className="text-lg">Settlement</h3>
          {pact.status === 2 && (
            <>
              <p className="mt-1 text-sm text-jade">Claim proven by {pact.quorum}-of-{pact.checks.length} consensus.</p>
              {inWindow ? (
                <p className="mt-3 text-sm text-porcelain-dim">
                  Releasable {new Date(releasableTs * 1000).toLocaleString()} (dispute window).
                </p>
              ) : (
                <button className="btn-gold mt-4" disabled={busy || !canRelease || wrongNetwork} onClick={() => send("release", [id], { gas: GAS.settle }, "release")}>
                  {action === "release" && busy
                    ? "Releasing…"
                    : `Release ${fmtStt(releaseAmt)} STT to beneficiary${pact.yieldOn ? " (principal + yield)" : ""}`}
                </button>
              )}
            </>
          )}
          {(pact.status === 3 || pact.status === 5) && (
            <>
              <p className="mt-1 text-sm text-porcelain-dim">{status === "Denied" ? "Quorum unreachable — contributors can refund." : "Expired undecided — contributors can refund."}</p>
              {canRefund ? (
                <button className="btn-ghost mt-4" disabled={busy || wrongNetwork} onClick={() => send("refund", [id], { gas: GAS.settle }, "refund")}>
                  {action === "refund" && busy ? "Refunding…" : `Refund my ${fmtStt(mine)} STT`}
                </button>
              ) : (
                <p className="mt-3 text-sm text-porcelain-faint">No contribution to refund.</p>
              )}
            </>
          )}
          {pact.status === 4 && <p className="mt-1 text-sm text-jade">Escrow released to the beneficiary. ✓</p>}
          {active && (
            <p className="mt-1 text-sm text-porcelain-dim">
              {canExpire ? "Deadline passed." : "Verify the sources above to reach quorum."}
              {canExpire && (
                <button className="btn-ghost ml-2 py-1 text-xs" disabled={busy || wrongNetwork} onClick={() => send("markExpired", [id], { gas: GAS.expire }, "expire")}>
                  Mark expired
                </button>
              )}
            </p>
          )}
        </div>
      </div>

      {error && <p className="mt-5 text-sm text-rust">{(error as { shortMessage?: string }).shortMessage ?? "Transaction failed."}</p>}
    </div>
  );
}

function CheckRow({
  index,
  check,
  canVerify,
  deposit,
  connected,
  busy,
  pendingThis,
  onVerify,
}: {
  index: number;
  check: Check;
  canVerify: boolean;
  deposit: bigint;
  connected: boolean;
  busy: boolean;
  pendingThis: boolean;
  onVerify: () => void;
}) {
  const ct = claimName(check.claimType);
  const cm = CLAIM_META[ct];
  const cs = checkName(check.status);
  const csm = CHECK_META[cs];
  const isUrl = ct !== "Text";

  const recQ = useReadContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "consensusOf",
    args: [check.requestId],
    query: { enabled: check.requestId > 0n, refetchInterval: 5000 },
  });
  const rec = recQ.data as { validators: bigint; receiptId: bigint; executionCost: bigint } | undefined;

  return (
    <div className="panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gold-400">{cm.glyph}</span>
            <span className="text-porcelain">{cm.label}</span>
            <span className="text-porcelain-faint">·</span>
            <span className="text-xs text-porcelain-dim">{cm.agent}</span>
          </div>
          <div className="mt-2 min-w-0 text-sm">
            {isUrl ? (
              <a href={check.source} target="_blank" rel="noreferrer" className="block truncate font-mono text-xs text-porcelain-muted hover:text-gold-300">
                {check.source}
              </a>
            ) : (
              <p className="line-clamp-2 text-porcelain-muted">“{check.source}”</p>
            )}
          </div>
        </div>
        <Badge label={csm.label} tone={csm.tone} pulse={csm.pulse} />
      </div>

      {/* Verdict + consensus receipt */}
      {(cs === "Confirmed" || cs === "Denied" || cs === "Inconclusive") && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-ink-700 bg-ink-950/40 px-3 py-2 text-xs">
          <span className="text-porcelain-dim">
            verdict <span className={cs === "Confirmed" ? "text-gold-300" : cs === "Denied" ? "text-rust" : "text-porcelain-muted"}>“{check.answer}”</span>
          </span>
          {rec && rec.validators > 0n && (
            <>
              <span className="text-porcelain-faint">·</span>
              <span className="text-porcelain-dim">◆ {rec.validators.toString()} validators agreed</span>
              <span className="text-porcelain-faint">·</span>
              <span className="text-porcelain-dim">median {fmtStt(rec.executionCost)} STT</span>
              <span className="text-porcelain-faint">·</span>
              <span className="font-mono text-porcelain-faint">receipt #{rec.receiptId.toString()}</span>
            </>
          )}
        </div>
      )}

      {canVerify && (
        <div className="mt-3 flex items-center gap-3">
          {connected ? (
            <button className="btn-ghost py-1.5 text-xs" disabled={busy} onClick={onVerify}>
              {pendingThis && busy ? "Sending to consensus…" : `Verify this source · ${fmtStt(deposit)} STT`}
            </button>
          ) : (
            <span className="text-xs text-porcelain-faint">Connect a wallet to verify</span>
          )}
        </div>
      )}
    </div>
  );
}
