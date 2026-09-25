import type { FlowIdentity } from "@/lib/workspace/flow";

import { sexLabel } from "@/lib/patient/sex";

/**
 * Two identifiers on every row, sheet and panel (Law 7, WHO Patient Safety
 * Solution 2): the name — the audited reveal — and the MRN, with age and sex.
 * A failed reveal titles the row with the MRN; an arrival with no account
 * carries the desk's label. Never a bay or a room alone.
 */
export function patientTitle(identity: FlowIdentity): string {
  return identity.name ?? identity.code ?? identity.unknownLabel ?? "Unidentified patient";
}

/** "45 y · Female · MS-2026-00012" — the MRN is dropped only when it already titles the row. */
export function patientMeta(identity: FlowIdentity): string {
  return [
    identity.ageYears !== null ? `${identity.ageYears} y` : null,
    sexLabel(identity.sex),
    identity.name ? identity.code : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Spans only: it sits inside the row's button, where only phrasing content is valid. */
export function PatientLine({
  identity,
  size = "row",
}: {
  identity: FlowIdentity;
  size?: "row" | "panel";
}) {
  const meta = patientMeta(identity);
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span
        className={
          size === "panel"
            ? "text-heading-s text-foreground font-medium"
            : "text-body-m text-foreground truncate font-medium"
        }
      >
        {patientTitle(identity)}
      </span>
      {meta ? (
        <span className="text-caption text-muted-foreground font-mono tabular-nums">{meta}</span>
      ) : null}
    </span>
  );
}
