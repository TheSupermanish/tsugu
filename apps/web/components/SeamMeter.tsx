import { checkName, CHECK_META } from "@/lib/vault";

const SEG: Record<string, string> = {
  Confirmed: "bg-gold-grad shadow-seam",
  Denied: "bg-rust/80",
  Requested: "shimmer-gold",
  Inconclusive: "bg-porcelain-faint/40",
  Pending: "bg-ink-700",
};

/**
 * The mended seam. One segment per evidence check — gold where a source has
 * confirmed, rust where it denied, shimmering while a verdict is in flight.
 * The crack fills with gold as the claim is proven.
 */
export function SeamMeter({ statuses, quorum }: { statuses: number[]; quorum: number }) {
  const names = statuses.map(checkName);
  const confirmed = names.filter((n) => n === "Confirmed").length;
  return (
    <div>
      <div className="flex gap-1.5">
        {names.map((n, i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${SEG[n] ?? SEG.Pending}`} />
        ))}
      </div>
      <div className="mt-1.5 text-xs text-porcelain-dim">
        <span className={confirmed >= quorum ? "text-gold-300" : ""}>{confirmed}</span> of {quorum} confirmations needed
        {statuses.length > quorum ? ` · ${statuses.length} sources` : ""}
      </div>
    </div>
  );
}
