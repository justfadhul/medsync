import type { ClinicalStatus } from "@/components/medsync/status-pill";
import type { Hue } from "@/lib/design/domains";
import type { ReactNode } from "react";
import { LockIcon } from "lucide-react";

import { StatusPill } from "@/components/medsync/status-pill";
import { Tag } from "@/components/medsync/tag";

/**
 * Compact chip for a table cell or list row (ADR 0162, MedSync Chroma).
 *
 * Two shapes, never told apart by hue alone:
 *   - the six CLINICAL tones render the round `StatusPill` (icon + word) in the
 *     CSO-owned status tokens — use them only for a patient's clinical state;
 *   - every other tone renders a square `Tag` with a dot in a cool place hue.
 *     Workflow states (active, confirmed, expired…) are tags, never
 *     red/amber/green: those colours belong to the patient.
 *
 * It lives here rather than in `data-table.tsx` so Server Components can show
 * a chip without pulling the client-only sortable table into their bundle;
 * `data-table.tsx` re-exports everything below.
 */
export type PillTone =
  | "neutral"
  | "active"
  | "info"
  | "notice"
  | "place"
  | "sensitive"
  | ClinicalStatus;

const TAG_HUE: Record<Exclude<PillTone, ClinicalStatus>, Hue> = {
  neutral: "slate",
  // Teal tags mean "enrolled / active in MedSync".
  active: "teal",
  info: "sky",
  notice: "iris",
  place: "plum",
  sensitive: "slate",
};

const CLINICAL = new Set<PillTone>([
  "stable",
  "caution",
  "critical",
  "admitted",
  "discharged",
  "pending",
]);

export interface PillProps {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
}

export function Pill({ tone = "neutral", children, className }: PillProps) {
  if (CLINICAL.has(tone)) {
    return (
      <StatusPill status={tone as ClinicalStatus} className={className}>
        {children}
      </StatusPill>
    );
  }
  if (tone === "sensitive") {
    return (
      <span
        className={`bg-slate-tint text-slate-text border-slate-edge text-caption inline-flex h-[22px] w-fit items-center gap-1 rounded-sm border px-2 font-medium whitespace-nowrap ${className ?? ""}`}
      >
        <LockIcon aria-hidden className="size-3" />
        {children}
      </span>
    );
  }
  return (
    <Tag hue={TAG_HUE[tone as Exclude<PillTone, ClinicalStatus>]} className={className}>
      {children}
    </Tag>
  );
}
