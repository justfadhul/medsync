import { cn } from "@/lib/cn";

export type BadgeTone =
  | "stable"
  | "critical"
  | "caution"
  | "admitted"
  | "discharged"
  | "pending"
  | "teal";

export interface BadgeProps {
  /** The written label. Required: colour on its own never carries meaning. */
  label: string;
  tone?: BadgeTone;
  /** Show the small colour dot beside the label. */
  dot?: boolean;
  className?: string;
}

const TONES: Record<BadgeTone, string> = {
  stable: "bg-status-stable-bg text-status-stable-fg",
  critical: "bg-status-critical-bg text-status-critical-fg",
  caution: "bg-status-caution-bg text-status-caution-fg",
  admitted: "bg-status-admitted-bg text-status-admitted-fg",
  discharged: "bg-status-discharged-bg text-status-discharged-fg",
  pending: "bg-status-pending-bg text-status-pending-fg",
  teal: "bg-teal-50 text-teal-700",
};

/** A status pill. The label always renders, so the colour is never the only cue. */
export function Badge({ label, tone = "pending", dot = true, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xs px-2.5 py-0.5",
        "text-caption",
        TONES[tone],
        className,
      )}
    >
      {dot ? (
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      ) : null}
      {label}
    </span>
  );
}
