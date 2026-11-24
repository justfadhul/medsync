import { ClockIcon } from "lucide-react";

import { CARE_REQUEST_COPY } from "@/content/care-requests";

/**
 * "Escalations may be delayed" (ADR 0536): shown when response times are signed but the scheduler has
 * not run lately. A neutral card with an icon and its words, never red (Tide: a stopped clock is not a
 * clinical emergency). Nothing renders when `show` is false.
 */
export function DelayedBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p
      role="status"
      className="border-border bg-card text-body-s text-foreground flex items-center gap-2 rounded-xl border px-4 py-3"
    >
      <ClockIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
      {CARE_REQUEST_COPY.page.delayed}
    </p>
  );
}
