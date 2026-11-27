import Link from "next/link";

import { DUTY_ROTA_COPY } from "@/content/duty-rota";
import { addDays } from "@/lib/rota/cover";
import { dayLabel } from "./gap-report";

const P = DUTY_ROTA_COPY.page;
const pill =
  "border-ink-300 bg-card text-foreground hover:bg-ink-50 inline-flex h-9 items-center rounded-full border px-4 text-[13.5px]";

/** The rota's week, with Previous and Next. `base` is the page's URL with its query, ending in `?` or `&`. */
export function WeekNav({ weekStart, base }: { weekStart: string; base: string }) {
  return (
    <nav aria-label={P.week(dayLabel(weekStart))} className="flex flex-wrap items-center gap-3">
      <Link href={`${base}week=${addDays(weekStart, -7)}`} className={pill}>
        {P.previous}
      </Link>
      <span className="text-label text-foreground">{P.week(dayLabel(weekStart))}</span>
      <Link href={`${base}week=${addDays(weekStart, 7)}`} className={pill}>
        {P.next}
      </Link>
    </nav>
  );
}
