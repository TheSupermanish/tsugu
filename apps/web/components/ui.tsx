import { TONE_CLASS, type Tone } from "@/lib/vault";

/** A status / category chip. `pulse` adds a soft gold heartbeat dot (for "verifying"). */
export function Badge({ label, tone, pulse }: { label: string; tone: Tone; pulse?: boolean }) {
  return (
    <span className={`chip ${TONE_CLASS[tone]}`}>
      {pulse && <span className="h-1.5 w-1.5 rounded-full bg-current animate-gold-pulse" />}
      {label}
    </span>
  );
}

/** A kintsugi seam — a hairline of gold. */
export function Seam({ className = "" }: { className?: string }) {
  return <div className={`seam ${className}`} />;
}
