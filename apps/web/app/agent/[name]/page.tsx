"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getAgent, short, fmtStt, EXPLORER, type Agent } from "@/lib/api";
import { useAsom } from "@/lib/hooks";
import { CANONICAL_TAGS } from "@/lib/sdk";

export default function AgentPage({ params }: { params: { name: string } }) {
  const { name } = params;
  const { client, address, connected } = useAsom();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void getAgent(name).then((a) => {
      setAgent(a);
      setLoading(false);
    });
  }, [name]);

  const isOwner = !!(agent && address && agent.owner.toLowerCase() === address.toLowerCase());

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm text-fuchsia-500 hover:underline">
        ← discover
      </Link>

      {loading && <p className="mt-8 text-neutral-500">loading…</p>}
      {!loading && !agent && <p className="mt-8 text-neutral-400">{name}@asom not found.</p>}

      {agent && (
        <>
          <h1 className="mt-6 text-3xl font-bold">
            {agent.name}
            <span className="text-neutral-500">@asom</span>
          </h1>
          {agent.description && <p className="mt-2 text-neutral-400">{agent.description}</p>}

          <div className="mt-6 flex flex-wrap gap-2">
            {agent.capabilities.map((c) => (
              <span key={c} className="rounded-full bg-cyan-950 px-3 py-1 text-sm text-cyan-300">
                {c.startsWith("0x") ? short(c) : c}
              </span>
            ))}
          </div>

          <dl className="mt-8 grid grid-cols-[7rem_1fr] gap-y-3 text-sm">
            <dt className="text-neutral-500">token</dt>
            <dd>#{agent.tokenId}</dd>
            <dt className="text-neutral-500">wallet</dt>
            <dd>
              <a className="text-cyan-400 hover:underline" href={`${EXPLORER}/address/${agent.account}`} target="_blank">
                {agent.account}
              </a>
            </dd>
            <dt className="text-neutral-500">owner</dt>
            <dd>
              <a className="text-cyan-400 hover:underline" href={`${EXPLORER}/address/${agent.owner}`} target="_blank">
                {agent.owner}
              </a>
            </dd>
            {Number(agent.pricePerCall) > 0 && (
              <>
                <dt className="text-neutral-500">price</dt>
                <dd>{fmtStt(agent.pricePerCall)} STT / call</dd>
              </>
            )}
            {agent.serviceURI && (
              <>
                <dt className="text-neutral-500">service</dt>
                <dd className="break-all text-neutral-300">{agent.serviceURI}</dd>
              </>
            )}
          </dl>

          {connected && isOwner && (
            <AdvertisePanel
              // Remount when the on-chain capabilities change (e.g. after a save refetch)
              // so the checkbox selection re-syncs to the persisted listing.
              key={agent.capabilities.join(",")}
              tokenId={BigInt(agent.tokenId)}
              current={agent.capabilities.filter((c) => !c.startsWith("0x"))}
              onSaved={() => getAgent(name).then(setAgent)}
              advertise={(caps, uri, price) =>
                client.advertise(BigInt(agent.tokenId), { capabilities: caps, serviceURI: uri, pricePerCall: price })
              }
            />
          )}
        </>
      )}
    </main>
  );
}

function AdvertisePanel({
  tokenId,
  current,
  advertise,
  onSaved,
}: {
  tokenId: bigint;
  current: string[];
  advertise: (caps: string[], uri: string, price: string) => Promise<unknown>;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(current);
  const [uri, setUri] = useState("");
  const [price, setPrice] = useState("0");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggle(tag: string) {
    setSelected((s) => (s.includes(tag) ? s.filter((t) => t !== tag) : [...s, tag]));
  }

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      await advertise(selected, uri, price);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10 rounded-xl border border-fuchsia-900/60 bg-neutral-900/40 p-5">
      <h2 className="text-sm font-semibold text-neutral-300">📣 Advertise capabilities (you own this agent #{tokenId.toString()})</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {CANONICAL_TAGS.map((tag) => (
          <button
            key={tag}
            onClick={() => toggle(tag)}
            className={`rounded-full px-3 py-1 text-xs ${selected.includes(tag) ? "bg-cyan-700 text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"}`}
          >
            {tag}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input value={uri} onChange={(e) => setUri(e.target.value)} placeholder="service URI (optional)"
          className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-fuchsia-600" />
        <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="price/call STT"
          className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-fuchsia-600" />
      </div>
      <button onClick={save} disabled={busy || selected.length === 0}
        className="mt-3 rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-medium hover:bg-fuchsia-500 disabled:opacity-50">
        {busy ? "Saving…" : "Save listing"}
      </button>
      {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
    </section>
  );
}
