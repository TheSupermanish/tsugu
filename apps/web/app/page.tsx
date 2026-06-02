import Link from "next/link";
import { loadPacts, type PactRow } from "@/lib/pacts";
import { PactCard } from "@/components/PactCard";
import { Seam } from "@/components/ui";

export const revalidate = 0;

const KINDS = [
  { glyph: "🜂", label: "Relief" },
  { glyph: "✛", label: "Medical" },
  { glyph: "△", label: "Fundraise" },
  { glyph: "◈", label: "Insurance" },
  { glyph: "✶", label: "Custom" },
];

const STEPS = [
  {
    n: "01",
    title: "Fund",
    body: "Anyone opens a Pact — a claim worth funding — and contributors escrow STT. The money is held by the contract, not a middleman.",
  },
  {
    n: "02",
    title: "Verify",
    body: "Somnia's consensus AI fetches the real evidence from multiple independent sources and classifies it. A quorum must agree.",
  },
  {
    n: "03",
    title: "Release",
    body: "Proven true → funds release to the beneficiary, no skim. Proven false → contributors refund. Every verdict is on-chain.",
  },
];

export default async function Home() {
  let rows: PactRow[] = [];
  let loadError = false;
  try {
    rows = await loadPacts();
  } catch {
    loadError = true;
  }

  return (
    <div className="mx-auto max-w-6xl px-6">
      {/* Hero */}
      <section className="relative pt-20 pb-16 sm:pt-28">
        <div className="animate-fade-up">
          <span className="chip border-gold-700/40 bg-gold-500/5 text-gold-300">
            <span className="h-1.5 w-1.5 rounded-full bg-gold-400" /> Verified by Somnia consensus AI
          </span>
        </div>
        <h1 className="mt-6 max-w-3xl animate-fade-up animate-delay-100 text-5xl font-semibold leading-[1.05] sm:text-7xl">
          <span className="text-gold">Proof</span>,
          <br className="hidden sm:block" /> not{" "}
          <span className="text-porcelain-faint line-through decoration-rust/60 decoration-2">promises</span>.
        </h1>
        <p className="mt-6 max-w-xl animate-fade-up animate-delay-200 text-lg leading-relaxed text-porcelain-muted">
          Online giving is broken by trust. Tsugu mends it: fund anything worth funding, the money is held
          safe, and it&apos;s released only when the claim is proven true — by AI that reads the real evidence,
          from multiple sources, in the open.
        </p>
        <div className="mt-8 flex animate-fade-up animate-delay-300 flex-wrap items-center gap-3">
          <Link href="/create" className="btn-gold">Start a pact</Link>
          <a href="#pacts" className="btn-ghost">See live pacts</a>
        </div>
        <div className="mt-10 flex flex-wrap gap-2.5">
          {KINDS.map((k) => (
            <span key={k.label} className="chip border-ink-700 bg-ink-900/60 text-porcelain-dim">
              <span className="text-gold-400">{k.glyph}</span> {k.label}
            </span>
          ))}
        </div>
      </section>

      <Seam />

      {/* How it works */}
      <section className="py-16">
        <h2 className="text-sm font-medium uppercase tracking-[0.2em] text-porcelain-dim">How a pact moves</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="panel p-6">
              <div className="font-mono text-sm text-gold-500">{s.n}</div>
              <h3 className="mt-2 text-2xl">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-porcelain-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <Seam />

      {/* Live pacts */}
      <section id="pacts" className="py-16">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-3xl">Live pacts</h2>
            <p className="mt-1 text-sm text-porcelain-dim">Read straight from the Vault on Somnia Shannon — no indexer.</p>
          </div>
          <Link href="/create" className="btn-ghost hidden sm:inline-flex">Start a pact</Link>
        </div>

        {loadError ? (
          <p className="mt-10 text-sm text-rust">Couldn&apos;t reach Somnia Shannon right now. Refresh to retry.</p>
        ) : rows.length === 0 ? (
          <div className="panel mt-8 p-12 text-center">
            <p className="text-porcelain-muted">No pacts yet. Be the first to fund something worth proving.</p>
            <Link href="/create" className="btn-gold mt-5">Start the first pact</Link>
          </div>
        ) : (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => (
              <PactCard key={r.id} id={r.id} pact={r.pact} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
