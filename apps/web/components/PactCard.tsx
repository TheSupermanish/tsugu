import Link from "next/link";
import { type Pact, kindName, KIND_META, statusName, STATUS_META, fmtStt, timeLeft } from "@/lib/vault";
import { Badge } from "./ui";
import { SeamMeter } from "./SeamMeter";

export function PactCard({ id, pact }: { id: number; pact: Pact }) {
  const kind = kindName(pact.kind);
  const status = statusName(pact.status);
  const km = KIND_META[kind];
  const sm = STATUS_META[status];
  const statuses = pact.checks.map((c) => c.status);
  const active = pact.status < 2; // Open or Verifying

  return (
    <Link href={`/pact/${id}`} className="card-link block p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="chip border-ink-600 bg-ink-800/60 text-porcelain-muted">
          <span className="text-gold-400">{km.glyph}</span> {km.label}
        </span>
        <Badge label={sm.label} tone={sm.tone} pulse={sm.pulse} />
      </div>

      <h3 className="mt-3.5 line-clamp-2 text-lg font-medium leading-snug text-porcelain">{pact.claim}</h3>

      <div className="mt-4">
        <SeamMeter statuses={statuses} quorum={pact.quorum} />
      </div>

      <div className="mt-4 flex items-end justify-between">
        <div>
          <div className="font-mono text-base text-gold-300">{fmtStt(pact.escrow)} STT</div>
          <div className="text-xs text-porcelain-faint">escrowed</div>
        </div>
        <span className="text-xs text-porcelain-dim">{active ? timeLeft(pact.deadline) : sm.label.toLowerCase()}</span>
      </div>
    </Link>
  );
}
