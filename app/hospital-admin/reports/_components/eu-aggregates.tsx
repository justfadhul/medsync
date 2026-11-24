import type { EuReportRead } from "@/lib/eu/report-load";

import { k } from "@/components/clinics-schedule/shared";
import { Tag } from "@/components/medsync/tag";
import { EU_REPORT as W } from "@/content/eu/words";
import v from "./reports-view.module.css";

const mins = (m: number | null) => (m === null ? W.tooFew : W.minutes(m));

/** The EU indicators: neutral counts and times, each with its basis and window; no colour, no target. */
export function EuAggregates({ read }: { read: EuReportRead }) {
  const { report: r, window: w, limitHours } = read;
  const spread = (s: typeof r.lengthOfStay) =>
    s.medianMin === null ? W.tooFew : W.spread(mins(s.medianMin), mins(s.p90Min), s.n);
  return (
    <div className={k("su-card")} aria-labelledby="eu-heading">
      <div className={k("su-ch")}>
        <b id="eu-heading">{W.title}</b>
        <small>{W.stays(r.stays, w.days)}</small>
      </div>
      <p className={`${k("su-note")} ${v.pad}`}>{W.lede}</p>
      <dl className={`${v.pad} flex flex-col gap-3`}>
        <div>
          <dt>{W.deathsTitle}</dt>
          <dd className="flex flex-wrap gap-2">
            <Tag>{W.within(2, r.deaths.within2h)}</Tag>
            <Tag>{W.within(8, r.deaths.within8h)}</Tag>
            <Tag>{W.within(24, r.deaths.within24h)}</Tag>
          </dd>
          <dd>{W.noArrival(r.deaths.noArrivalTime)}</dd>
        </div>
        <div>
          <dt>{W.losTitle}</dt>
          <dd>{spread(r.lengthOfStay)}</dd>
        </div>
        <div>
          <dt>{W.boardTitle}</dt>
          <dd>{spread(r.boarding)}</dd>
        </div>
        <div>
          <dt>{W.overTitle}</dt>
          <dd>
            {r.overLimit.share === null
              ? W.tooFew
              : W.over(r.overLimit.numerator, r.overLimit.denominator, limitHours)}
          </dd>
          <dd>{W.overBasis}</dd>
        </div>
      </dl>
    </div>
  );
}
