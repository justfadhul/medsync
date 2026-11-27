import { Panel } from "@/components/medsync/panel";
import { Tag } from "@/components/medsync/tag";
import { DUTY_ROTA_COPY } from "@/content/duty-rota";

const G = DUTY_ROTA_COPY.gaps;
const TZ = "Africa/Kampala";

/** "Mon 23 Nov" for a Kampala calendar day (YYYY-MM-DD). */
export const dayLabel = (day: string) => dateLabel(new Date(`${day}T12:00:00+03:00`));
const dateLabel = (d: Date) =>
  new Date(d)
    .toLocaleDateString("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" })
    .replace(",", "");
/** "Mon 23 Nov 08:00", Kampala, 24-hour. */
export const when = (d: Date) =>
  `${dateLabel(d)} ${new Date(d).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;

/**
 * The rota's gaps (ADR 0534): posts with no one rostered, then duties whose holder is on leave. Staff names and
 * posts only, never a patient (ADR 0199). Planned, not proof of presence.
 */
export function GapReport({
  gaps,
  needsCover,
}: {
  gaps: { postName: string; from: Date; to: Date }[];
  needsCover: { postName: string; name: string; from: Date; to: Date }[];
}) {
  return (
    <Panel title={G.title} count={gaps.length + needsCover.length}>
      <p className="text-muted-foreground text-caption px-4 pt-3">{G.lead}</p>
      {!gaps.length && !needsCover.length ? (
        <p className="text-muted-foreground text-body-s px-4 py-3">{G.clear}</p>
      ) : (
        <ul className="divide-border divide-y">
          {gaps.map((g, i) => (
            <li key={`g${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <Tag>{G.none}</Tag>
              <span className="text-label text-foreground">{g.postName}</span>
              <span className="text-muted-foreground text-caption tabular-nums">
                {when(g.from)} – {when(g.to)}
              </span>
            </li>
          ))}
          {needsCover.map((c, i) => (
            <li key={`c${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <Tag>{G.needsCover}</Tag>
              <span className="text-label text-foreground">
                {c.postName} · {c.name}
              </span>
              <span className="text-muted-foreground text-caption tabular-nums">
                {when(c.from)} – {when(c.to)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
