import type { EuBoardData } from "@/lib/eu/load";
import Link from "next/link";

import { Tag } from "@/components/medsync/tag";
import { EU_LIST } from "@/content/eu/words";
import { durationWords, euClocks, overLimit } from "@/lib/eu/clock";
import { levelWords } from "@/lib/eu/level-words";

/** What the list reads of the EU board: the page sends this, not the whole board. */
export type EuListData = Pick<EuBoardData, "rows" | "needsAttention" | "limitHours" | "names">;

const at = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Kampala",
  });

const th = "text-caption text-ink-600 px-3 py-2 text-left font-medium whitespace-nowrap";
const td = "text-body-s text-foreground px-3 py-2 align-top";

/**
 * The EU tracking list (ADR 0541): one row per open stay, for EU staff. Clocks are text counted from `nowMs`
 * (the page's last live read); over the limit is a slate Tag and a Needs attention line, never a colour.
 * The patient column exists only when `data.names`.
 */
export function EuList({
  data,
  nowMs,
  links,
  triageSystem = null,
}: {
  data: EuListData;
  nowMs: number;
  links: { resus: (episodeId: string) => string | null };
  triageSystem?: string | null;
}) {
  const C = EU_LIST.col;
  const resusHref = (id: string | null) => (id ? links.resus(id) : null);
  const whoOf = (id: string) => {
    const r = data.rows.find((x) => x.stayId === id);
    return (data.names ? (r?.name ?? r?.mrn) : null) ?? r?.bedLabel ?? EU_LIST.noSpace;
  };
  return (
    <div className="flex flex-col gap-4 p-3">
      {data.needsAttention.length ? (
        <section aria-labelledby="eu-attention" className="flex flex-col gap-1.5">
          <h2 id="eu-attention" className="text-heading-s text-foreground">
            {EU_LIST.needsAttention}
          </h2>
          <ul className="text-body-s text-foreground flex flex-col gap-0.5">
            {data.needsAttention.map((a) => (
              <li key={`${a.stayId}:${a.code}`}>
                <span className="font-medium">{whoOf(a.stayId)}</span> · {a.words}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {data.rows.length ? (
        <div className="border-border bg-card overflow-x-auto rounded-md border">
          <table className="w-full min-w-[1100px] border-collapse">
            <caption className="sr-only">{EU_LIST.title}</caption>
            <thead className="border-border border-b">
              <tr>
                <th scope="col" className={th}>
                  {C.space}
                </th>
                {data.names ? (
                  <th scope="col" className={th}>
                    {C.patient}
                  </th>
                ) : null}
                <th scope="col" className={th}>
                  {C.level}
                </th>
                <th scope="col" className={th}>
                  {C.inHospital}
                </th>
                <th scope="col" className={th}>
                  {C.inEu}
                </th>
                <th scope="col" className={th}>
                  {C.inSpace}
                </th>
                <th scope="col" className={th}>
                  {C.boarding}
                </th>
                <th scope="col" className={th}>
                  {C.clinician}
                </th>
                <th scope="col" className={th}>
                  {C.nextObs}
                </th>
                <th scope="col" className={th}>
                  {C.results}
                </th>
                <th scope="col" className={th}>
                  {C.status}
                </th>
                <th scope="col" className={th}>
                  {C.resus}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const boarding =
                  r.admission && r.admission.status !== "cancelled" ? r.admission : null;
                const k = euClocks({
                  nowMs,
                  hospitalArrivedAt: r.hospitalArrivedAt,
                  decidedAt: r.decidedAt,
                  spaceStartedAt: r.spaceStartedAt,
                  admissionDecidedAt: boarding?.decidedAt ?? null,
                });
                const clock = (ms: number | null) => (ms === null ? "—" : durationWords(ms));
                const due = r.nextObsDueAt;
                return (
                  <tr key={r.stayId} className="border-ink-150 border-b last:border-b-0">
                    <td className={td}>
                      {r.status === "awaiting_space" ? (
                        EU_LIST.noSpace
                      ) : (
                        <span className="font-mono">{r.bedLabel ?? "—"}</span>
                      )}
                    </td>
                    {data.names ? (
                      <td className={td}>
                        <div className="flex flex-col">
                          {r.name ? <span>{r.name}</span> : null}
                          <span className="text-mono-s text-ink-600 font-mono">
                            {r.mrn ?? EU_LIST.noMrn}
                          </span>
                        </div>
                      </td>
                    ) : null}
                    <td className={td}>{r.level ? levelWords(triageSystem, r.level) : "—"}</td>
                    <td className={`${td} tabular-nums`}>{clock(k.inHospitalMs)}</td>
                    <td className={`${td} tabular-nums`}>{clock(k.inEuMs)}</td>
                    <td className={`${td} tabular-nums`}>{clock(k.inSpaceMs)}</td>
                    <td className={`${td} tabular-nums`}>{clock(k.boardingMs)}</td>
                    <td className={td}>{r.responsibleName ?? "—"}</td>
                    <td className={`${td} tabular-nums`}>
                      {r.obsFrequency === "continuous"
                        ? EU_LIST.continuous
                        : due
                          ? `${at(due)}${nowMs > Date.parse(due) ? ` · ${EU_LIST.overdue}` : ""}`
                          : EU_LIST.notSet}
                    </td>
                    <td className={td}>{r.resultsReady ? EU_LIST.resultsBack : "—"}</td>
                    <td className={td}>
                      <div className="flex flex-col items-start gap-1">
                        <span>{r.statusWord}</span>
                        {overLimit(k.inEuMs, data.limitHours) ? (
                          <Tag hue="slate">{EU_LIST.overLimit(data.limitHours)}</Tag>
                        ) : null}
                      </div>
                    </td>
                    <td className={td}>
                      {resusHref(r.resusEpisodeId) ? (
                        <Link
                          href={resusHref(r.resusEpisodeId)!}
                          className="text-teal-text focus-visible:shadow-focus rounded-xs hover:underline"
                        >
                          {EU_LIST.resus}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-body-s text-muted-foreground">{EU_LIST.empty}</p>
      )}
    </div>
  );
}
