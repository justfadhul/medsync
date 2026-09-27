import type { CalendarEvent } from "./types";

import { KindChip, StatusPill } from "./chips";
import { AVAILABILITY_KIND_LABEL, describeEvent } from "./helpers";
import { kindTone, STATUS_TONE, STATUS_WORD } from "./tones";

/**
 * The key to the calendar, drawn with the grid's own chips from the one
 * colour map (tones.ts), so it cannot drift from what the grid shows:
 * square chips for kinds of time, round pills for where a booking stands.
 * Only what is in the window — a key to blocks nobody declared explains
 * nothing. Kinds in AVAILABILITY_KINDS order (held by
 * tests/scheduling/availability-kinds.test.ts), the clinic day first.
 */
export function AvailabilityLegend({ events }: { events: ReadonlyArray<CalendarEvent> }) {
  const kinds = new Set(
    events.flatMap((e) => (e.kind === "availability" ? [e.availabilityKind] : [])),
  );
  const hasSession = events.some((e) => e.kind === "session");
  const statuses = new Set(
    events.flatMap((e) => {
      const s = describeEvent(e).status;
      return s ? [s] : [];
    }),
  );
  const kindKeys = [
    ...(hasSession ? ["session"] : []),
    ...Object.keys(AVAILABILITY_KIND_LABEL).filter((k) => kinds.has(k)),
  ];
  const statusKeys = (Object.keys(STATUS_TONE) as Array<keyof typeof STATUS_TONE>).filter((s) =>
    statuses.has(s),
  );
  if (kindKeys.length === 0 && statusKeys.length === 0) return null;
  return (
    <ul aria-label="Calendar key" className="flex flex-wrap items-center gap-1.5">
      {kindKeys.map((k) => {
        const tone = kindTone(k);
        return (
          <li key={k}>
            <KindChip hue={tone.hue} icon={tone.icon}>
              {k === "session" ? "Clinic day" : AVAILABILITY_KIND_LABEL[k]}
            </KindChip>
          </li>
        );
      })}
      {statusKeys.length > 0 && kindKeys.length > 0 ? (
        <li aria-hidden className="bg-border mx-1 h-4 w-px" />
      ) : null}
      {statusKeys.map((s) => (
        <li key={s}>
          <StatusPill status={s}>{STATUS_WORD[s]}</StatusPill>
        </li>
      ))}
    </ul>
  );
}
