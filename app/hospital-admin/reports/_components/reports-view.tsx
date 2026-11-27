"use client";

import type { ReportsViewData, WeekCell } from "../_lib/view";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { k, Seg } from "@/components/clinics-schedule/shared";
import { REPORTS as R } from "@/content/hospital-admin/profile-reports";
import { fill } from "@/content/lab-workspace-v2";
import v from "./reports-view.module.css";

const PATH = "/hospital-admin/reports";

/**
 * Reports (ADR 0520, phase 2) in the Tether desk look. Every figure is neutral: a rate is not a status, so no tile
 * carries a tone, and the one flag ("positions not honoured") is a neutral square tag with its words. The window is
 * kept in the URL (`?days=`), so the page stays server-rendered from the same queries.
 */
export function ReportsView({
  data,
  windows,
  min,
  pilotWeeks,
  eu,
  lab,
}: {
  data: ReportsViewData;
  windows: readonly number[];
  min: number;
  pilotWeeks: number;
  eu: ReactNode;
  lab: ReactNode;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const pick = (d: number) => start(() => router.push(`${PATH}?days=${d}`, { scroll: false }));

  return (
    <div className={k("su-wrap")}>
      <div className={k("su-page")} aria-busy={busy}>
        <div className={k("ahead")}>
          <div className={k("ahl")}>
            <h1>{R.title}</h1>
            <span className={k("adate")}>{R.lead}</span>
          </div>
          <span className={k("grow")} />
          <Seg
            tour="wt-rep-win"
            label={R.window}
            opts={windows.map((d) => [d, fill(R.windowOpt, { d })] as const)}
            value={data.days}
            onPick={pick}
          />
        </div>

        {/* The ruling, in words (ADR 0094; PRD §3.3.4), above the numbers so it is read before the no-show figure. */}
        <p className={k("su-note")}>
          <b>{R.ruling.title}</b> {R.ruling.body}
        </p>
        <p className={k("su-note")}>{fill(R.since, { date: data.since, min, few: R.tooFew })}</p>

        <div
          className={k("su-dst")}
          data-tour="wt-rep-stats"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
        >
          {data.tiles.map((t) => (
            <div
              key={t.key}
              className={`${k("su-dsc", "mid")} ${v.tile} ${t.wordy ? v.wordy : ""}`}
            >
              <span className={k("su-dsd")} aria-hidden="true" />
              <div>
                <b>{t.value}</b>
                <span>{t.label}</span>
                <small>{t.sub}</small>
              </div>
            </div>
          ))}
        </div>

        <div className={v.g2}>
          <div className={k("su-card")}>
            <div className={k("su-ch")}>
              <b>{R.defs.title}</b>
              <small>{R.defs.sub}</small>
            </div>
            <dl className={`${v.defs} ${v.pad}`}>
              {data.defs.map((d) => (
                <div key={d.term}>
                  <dt>{d.term}</dt>
                  <dd>{d.text}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className={k("su-card")}>
            <div className={k("su-ch")}>
              <b>{R.also.title}</b>
              <small>{R.also.sub}</small>
            </div>
            <div className={`${k("su-sec")} ${v.pad}`}>
              <div className={k("su-sum2")}>
                <div>
                  <span>{R.also.refill}</span>
                  <b>{data.refill}</b>
                </div>
                <div>
                  <span>{R.also.rx}</span>
                  <b>{data.rx}</b>
                </div>
              </div>
              <p className={k("su-note")}>
                {R.also.refillSub}. {R.also.note}
              </p>
            </div>
          </div>
        </div>

        <div className={k("su-card")}>
          <div className={k("su-ch")}>
            <b>{R.weeks.title}</b>
            <small>{fill(R.weeks.sub, { n: pilotWeeks })}</small>
          </div>
          {data.weeks ? (
            <div className={v.scroll}>
              <table className={v.t}>
                <caption className="sr-only">{R.weeks.caption}</caption>
                <thead>
                  <tr>
                    <th scope="col">{R.weeks.cols.week}</th>
                    <th scope="col" className={v.n}>
                      {R.weeks.cols.booked}
                    </th>
                    <th scope="col" className={v.n}>
                      {R.weeks.cols.web}
                    </th>
                    <th scope="col" className={v.n}>
                      {R.weeks.cols.app}
                    </th>
                    <th scope="col" className={v.n}>
                      {R.weeks.cols.desk}
                    </th>
                    <th scope="col" className={v.n}>
                      {R.weeks.cols.ussd}
                    </th>
                    <th scope="col" className={v.n}>
                      {R.weeks.cols.noShows}
                    </th>
                    <th scope="col" className={v.n}>
                      {R.weeks.cols.vsGiven}
                    </th>
                    <th scope="col" className={v.n}>
                      {R.weeks.cols.seen}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.weeks.map((w) => (
                    <tr key={w.key} className={w.sub ? v.sub : undefined}>
                      <td>{w.sub ? w.label : <b>{w.label}</b>}</td>
                      {[w.booked, w.web, w.app, w.desk, w.ussd].map((n, i) => (
                        <td key={i} className={`${v.n} ${n === 0 ? v.zero : ""}`}>
                          {n}
                        </td>
                      ))}
                      <Cell c={w.noShows} />
                      <Cell c={w.vsGiven} />
                      <Cell c={w.seen} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={k("su-none")}>{fill(R.weeks.empty, { n: pilotWeeks })}</p>
          )}
          <p className={`${k("su-note")} ${v.pad}`}>{fill(R.weeks.note, { min })}</p>
        </div>

        <div className={k("su-card")}>
          <div className={k("su-ch")}>
            <b>{R.lines.title}</b>
          </div>
          <p className={`${k("su-note")} ${v.pad}`}>{data.linesNote}</p>
          {data.lines.length ? (
            <div className={v.scroll}>
              <table className={v.t}>
                <caption className="sr-only">{R.lines.caption}</caption>
                <thead>
                  <tr>
                    <th scope="col">{R.lines.cols.name}</th>
                    <th scope="col" className={v.n}>
                      {R.lines.cols.fill}
                    </th>
                    <th scope="col" className={v.n}>
                      {R.lines.cols.seen}
                    </th>
                    <th scope="col">{R.lines.cols.flag}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <b>{l.name}</b>
                      </td>
                      <Cell c={{ value: l.fill, basis: l.fillBasis }} />
                      <Cell c={{ value: l.seen, basis: l.seenBasis }} />
                      <td>
                        {l.flagged ? (
                          <span className={k("su-st", "setup")}>{R.lines.flag}</span>
                        ) : (
                          <span className={v.zero}>{R.none}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={k("su-none")}>{R.lines.empty}</p>
          )}
        </div>

        <div className={k("su-card")}>
          <div className={k("su-ch")}>
            <b>{R.sessions.title}</b>
            <small>{R.sessions.sub}</small>
          </div>
          <p className={`${k("su-note")} ${v.pad}`}>{fill(R.sessions.note, { min })}</p>
          {data.sessions.length ? (
            <div className={v.scroll}>
              <table className={v.t}>
                <caption className="sr-only">{R.sessions.caption}</caption>
                <thead>
                  <tr>
                    <th scope="col">{R.sessions.cols.name}</th>
                    <th scope="col">{R.sessions.cols.when}</th>
                    <th scope="col" className={v.n}>
                      {R.sessions.cols.seen}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.sessions.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <b>{s.name}</b>
                      </td>
                      <td>{s.when}</td>
                      <Cell c={{ value: s.seen, basis: s.seenBasis }} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={k("su-none")}>{R.sessions.empty}</p>
          )}
        </div>

        <div className={k("su-card")}>
          <div className={k("su-ch")}>
            <b>{fill(R.sent.title, { d: data.days })}</b>
            <small>{R.sent.sub}</small>
          </div>
          <p className={`${k("su-note")} ${v.pad}`}>{fill(R.sent.note, { date: data.since })}</p>
          {data.sent.length ? (
            <div className={v.scroll}>
              <table className={v.t}>
                <caption className="sr-only">{fill(R.sent.caption, { d: data.days })}</caption>
                <thead>
                  <tr>
                    <th scope="col">{R.sent.cols.kind}</th>
                    <th scope="col">{R.sent.cols.channel}</th>
                    <th scope="col" className={v.n}>
                      {R.sent.cols.count}
                    </th>
                    <th scope="col" className={v.n}>
                      {R.sent.cols.cost}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.sent.map((r) => (
                    <tr key={r.key}>
                      <td>{r.kind}</td>
                      <td>{r.channel}</td>
                      <td className={v.n}>{r.count}</td>
                      <td className={v.n}>{r.cost}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={k("su-none")}>{R.sent.empty}</p>
          )}
        </div>

        {eu}
        {lab}
      </div>
    </div>
  );
}

/** A value with the counts it came from, right-aligned. */
function Cell({ c }: { c: WeekCell }) {
  return (
    <td className={v.n}>
      <span className={v.cell}>
        <span>{c.value}</span>
        {c.basis ? <small>{c.basis}</small> : null}
      </span>
    </td>
  );
}
