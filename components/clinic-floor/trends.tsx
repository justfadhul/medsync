"use client";

/**
 * Trends across visits (ADR 0496): small multiples from `trendCards` (pure, lib/clinic-floor/trends.ts). Target
 * bands are content (D-CF-08), shown as a shaded band with the word, never colour alone; while unsigned each
 * band says "draft". Every point is reachable by mouse, touch and keyboard (a focusable column per reading).
 */
import type { FloorPerson } from "@/lib/clinic-floor/fixture";
import type { Series, TrendCard } from "@/lib/clinic-floor/trends";
import { useState } from "react";

import { c } from "@/components/reception/ui";
import { CLINIC_FLOOR_BANDS_STATUS } from "@/content/clinic-floor/bands";
import { FLOOR } from "@/content/clinic-floor/floor";
import { fill } from "@/content/lab-workspace-v2";
import { bandStatus, trendCards } from "@/lib/clinic-floor/trends";

const TR = FLOOR.trends;
const dm = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Kampala",
  day: "numeric",
  month: "short",
});
const d = (t: number) => dm.format(t);

export function Trends({ p }: { p: FloorPerson }) {
  const cards = trendCards(p.readings, p.clinic, p.sex);
  const [tab, setTab] = useState<"all" | "vitals" | "labs">("all");
  if (!cards.length) return null;
  const both = cards.some((x) => x.kind === "labs") && cards.some((x) => x.kind === "vitals");
  const shown = cards.filter((x) => tab === "all" || x.kind === tab);
  return (
    <div className={c("cf-sec")}>
      <div className={c("cf-trtop")}>
        <span className={c("cap")}>{FLOOR.line.trends}</span>
        {both ? (
          <span className={c("cf-trtabs")} role="group" aria-label={FLOOR.line.trends}>
            {(["all", "vitals", "labs"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={c(tab === k && "on")}
                aria-pressed={tab === k}
                onClick={() => setTab(k)}
              >
                {TR.tabs[k]}
              </button>
            ))}
          </span>
        ) : null}
      </div>
      <div className={c("cf-trs")}>
        {shown.map((card) => (
          <Card key={card.key} card={card} />
        ))}
      </div>
    </div>
  );
}

const fmt = (v: number, dp: number) => v.toFixed(dp);

function Card({ card }: { card: TrendCard }) {
  const [pick, setPick] = useState(0);
  const [hot, setHot] = useState<number | null>(null);
  const s: Series = card.series[Math.min(pick, card.series.length - 1)]!;
  const pts = s.points;
  const last = pts.at(-1)!;
  const firstP = pts[0]!;
  const two = card.key === "bp";
  const all = pts.flatMap((x) => (two && x.value2 != null ? [x.value, x.value2] : [x.value]));
  const bandVals = [s.band?.[0], s.band?.[1]].filter((x): x is number => x != null);
  const lo = Math.min(...all, ...bandVals);
  const hi = Math.max(...all, ...bandVals);
  const pad = (hi - lo || 1) * 0.12;
  const y = (v: number) => 40 - ((v - lo + pad) / (hi - lo + 2 * pad)) * 38;
  const t0 = firstP.at;
  const span = last.at - t0 || 1;
  const x = (t: number) => 4 + ((t - t0) / span) * 92;
  const path = (k: "value" | "value2") =>
    pts
      .filter((q) => q[k] != null)
      .map((q, i) => `${i ? "L" : "M"}${x(q.at).toFixed(2)} ${y(q[k]!).toFixed(2)}`)
      .join(" ");

  // Blood pressure has upper limits only; `out` already folds the diastolic band in (lib/clinic-floor/trends.ts).
  const st = !s.band ? null : two ? (last.out ? "above" : "in") : bandStatus(s.band, last.value);
  const change = last.value - firstP.value;
  const dir =
    Math.abs(change) < 10 ** -card.dp / 2
      ? fill(TR.same, { first: d(firstP.at) })
      : fill(TR.since, {
          d: `${change > 0 ? "▲" : "▼"} ${fmt(Math.abs(change), card.dp)}`,
          first: d(firstP.at),
        });
  const label = (q: (typeof pts)[number]) =>
    `${two ? `${q.value}/${q.value2 ?? "–"}` : fmt(q.value, card.dp)} ${card.unit}`;
  const title = TR.cards[card.key];
  const pickLabel = (k: Series["pick"]) =>
    k == null
      ? ""
      : k in TR.timing
        ? TR.timing[k as keyof typeof TR.timing]
        : TR.lipid[k as keyof typeof TR.lipid];

  return (
    <div className={c("cf-tr", card.series.length > 1 && "wide")}>
      <div className={c("cf-trh")}>
        <span className={c("cf-trn")}>{title}</span>
        {st ? (
          <i className={c("cf-trs-st", st === "in" ? "ok" : "bad")}>
            {TR.status[st]}
            {CLINIC_FLOOR_BANDS_STATUS.status !== "signed" ? ` · ${TR.draft}` : ""}
          </i>
        ) : null}
      </div>
      <div className={c("cf-trv")}>
        <b>{two ? `${last.value}/${last.value2 ?? "–"}` : fmt(last.value, card.dp)}</b>
        <span>{card.unit}</span>
        <em className={c("cf-trd")}>{dir}</em>
      </div>
      {card.series.length > 1 ? (
        <div className={c("cf-trp")} role="group" aria-label={title}>
          {card.series.map((q, i) => (
            <button
              key={String(q.pick)}
              type="button"
              className={c(i === pick && "on")}
              aria-pressed={i === pick}
              onClick={() => setPick(i)}
            >
              {pickLabel(q.pick)}
            </button>
          ))}
        </div>
      ) : null}
      <div className={c("cf-plot")} onMouseLeave={() => setHot(null)}>
        <svg
          className={c("cf-ch")}
          viewBox="0 0 100 42"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {s.band ? (
            <rect
              className={c("cf-band")}
              x="0"
              width="100"
              y={y(s.band[1] ?? hi + pad)}
              height={Math.max(0, y(s.band[0] ?? lo - pad) - y(s.band[1] ?? hi + pad))}
            />
          ) : null}
          <line className={c("cf-guide")} x1="0" x2="100" y1="41" y2="41" />
          <path className={c("cf-ln-a")} d={path("value")} />
          {two ? <path className={c("cf-ln-b")} d={path("value2")} /> : null}
        </svg>
        {pts.map((q, i) => (
          <span
            key={`a${q.at}`}
            className={c(
              "cf-dot",
              q.out && "out",
              i === pts.length - 1 && "last",
              hot === i && "on",
            )}
            style={{ left: `${x(q.at)}%`, top: `${(y(q.value) / 42) * 100}%` }}
          />
        ))}
        {two
          ? pts.map((q) =>
              q.value2 == null ? null : (
                <span
                  key={`b${q.at}`}
                  className={c("cf-dot", "b")}
                  style={{ left: `${x(q.at)}%`, top: `${(y(q.value2) / 42) * 100}%` }}
                />
              ),
            )
          : null}
        {pts.map((q, i) => {
          const w = 92 / Math.max(1, pts.length - 1);
          const aria = fill(TR.point, { label: title, date: d(q.at), value: label(q) });
          return (
            <span
              key={`h${q.at}`}
              className={c("cf-hit")}
              style={{ left: `${Math.max(0, x(q.at) - w / 2)}%`, width: `${Math.min(w, 100)}%` }}
              tabIndex={0}
              role="button"
              aria-label={aria}
              onMouseEnter={() => setHot(i)}
              onFocus={() => setHot(i)}
              onClick={() => setHot(i)}
              onBlur={() => setHot(null)}
            />
          );
        })}
        {hot != null && pts[hot] ? (
          <span
            className={c("cf-tip", x(pts[hot].at) > 60 ? "r" : "l")}
            style={{ left: `${x(pts[hot].at)}%`, top: `${(y(pts[hot].value) / 42) * 100}%` }}
          >
            <b>{label(pts[hot])}</b>
            <span>
              {d(pts[hot].at)}
              {pts[hot].source ? ` · ${pts[hot].source}` : ""}
            </span>
          </span>
        ) : null}
      </div>
      <div className={c("cf-trx")}>
        <span>{d(firstP.at)}</span>
        <span>{pts.length > 2 ? d(pts[Math.floor(pts.length / 2)]!.at) : ""}</span>
        <span>{d(last.at)}</span>
      </div>
    </div>
  );
}
