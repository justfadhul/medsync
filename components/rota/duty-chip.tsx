import type { myDuties } from "@/lib/rota/read";
import Link from "next/link";

import { Tag } from "@/components/medsync/tag";
import { DUTY_ROTA_COPY } from "@/content/duty-rota";

/** HH:MM on the Kampala wall clock (UTC+03:00, no daylight saving), whatever the server's zone. */
export const kampalaTime = (iso: string | Date) =>
  new Date(new Date(iso).getTime() + 3 * 3600_000).toISOString().slice(11, 16);

/**
 * The person's own planned duty in the top bar: the post's own name and when it ends. Post and time only, no patient.
 * `href` null draws it without a link (the lab in the Tether desk has no rota page of its own, ADR 0545).
 */
export function DutyChip({
  duties,
  href = "/doctor/rota",
}: {
  duties: Awaited<ReturnType<typeof myDuties>>;
  href?: string | null;
}) {
  const d = duties[0];
  if (!d) return null;
  const tag = <Tag hue="slate">{DUTY_ROTA_COPY.chip.onCall(d.postName, kampalaTime(d.until))}</Tag>;
  if (!href)
    return (
      <span title={DUTY_ROTA_COPY.plannedNotPresent} className="inline-flex items-center">
        {tag}
      </span>
    );
  return (
    <Link
      href={href}
      title={DUTY_ROTA_COPY.plannedNotPresent}
      className="focus-visible:shadow-focus inline-flex min-h-11 items-center rounded-sm outline-none sm:min-h-0"
    >
      {tag}
    </Link>
  );
}
