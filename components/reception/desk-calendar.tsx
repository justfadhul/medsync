"use client";

import type { DeskCtx, Intent, View } from "./desk";
import type { Modal } from "./desk-dialogs";
import type { DeskSession, Tone } from "@/lib/reception/desk/model";
import { useState } from "react";

import { fill } from "@/content/lab-workspace-v2";
import { DESK } from "@/content/reception/desk";
import {
  addDays,
  dayDiff,
  fmtDay,
  hhmm,
  initials,
  keyOf,
  monthName,
  parseKey,
  tone,
} from "@/lib/reception/desk/model";
import { c, Icon } from "./ui";

const H = 84;
const START = 7;
const END = 17;
const K = DESK.calendar;
const TONE: Record<Tone, string> = {
  done: "tDone",
  run: "tRun",
  next: "tNext",
  fut: "tFut",
  sel: "tSel",
};
const ci = (v: string) => ({ "--ci": v }) as React.CSSProperties;
const U = DESK.ui;
const DSH = U.days;
const DLONG = U.daysLong;

/** "Doctor's times": 20-minute slots from start to end. */
const slotTimes = (se: DeskSession) => {
  const out: { t: string; h: number }[] = [];
  for (let h = se.st; h < se.en - 1e-6; h += 1 / 3) out.push({ t: hhmm(h), h });
  return out;
};

export function DeskCalendar({
  ctx,
  view,
  setView,
  date,
  setDate,
  on,
  openRow,
  setModal,
  setIntent,
  setSessF,
}: {
  ctx: DeskCtx;
  view: View;
  setView: (v: View) => void;
  date: string;
  setDate: (d: string) => void;
  on: Record<string, boolean>;
  openRow: (id: string, check: boolean) => void;
  setModal: (m: Modal) => void;
  setIntent: (i: Intent) => void;
  setSessF: (id: string) => void;
}) {
  const { today, nowHour, rows, clinic, sessionsOn, data } = ctx;
  const [my, setMy] = useState<[number, number]>(() => {
    const d = parseKey(date);
    return [d.getUTCFullYear(), d.getUTCMonth()];
  });
  const [pop, setPop] = useState<{ key: string; col: number; n: number; top: number } | null>(null);
  const [moM, setMoM] = useState<"booked" | "left" | "seen">("booked");
  const pick = (k: string, v: View = view === "month" ? "day" : view) => {
    setDate(k);
    setView(v);
    setPop(null);
    const d = parseKey(k);
    setMy([d.getUTCFullYear(), d.getUTCMonth()]);
  };
  const drill = (k: string, id: string) => {
    const ds = sessionsOn(k);
    const idx = ds.findIndex((z) => z.id === id);
    pick(k, "day");
    if (idx >= 0)
      setPop({ key: ds[idx]!.key, col: idx, n: ds.length, top: (ds[idx]!.st - START) * H + 4 });
  };
  const goToday = () => pick(today, view);

  /* month cells: 6 rows, or 5 when the month fits */
  const first = new Date(Date.UTC(my[0], my[1], 1));
  const off = (first.getUTCDay() + 6) % 7;
  const dim = new Date(Date.UTC(my[0], my[1] + 1, 0)).getUTCDate();
  const cells = Array.from({ length: off + dim <= 35 ? 35 : 42 }, (_, i) =>
    keyOf(new Date(Date.UTC(my[0], my[1], 1 - off + i))),
  );
  const inMonth = (k: string) => parseKey(k).getUTCMonth() === my[1];
  const prevM = () => setMy(([y, m]) => (m === 0 ? [y - 1, 11] : [y, m - 1]));
  const nextM = () => setMy(([y, m]) => (m === 11 ? [y + 1, 0] : [y, m + 1]));
  const miniTitle = `${monthName(my[1])} ${my[0]}`;

  /* today's numbers for a clinic, from the rows only */
  const todayOf = (id: string) => {
    const rs = rows.filter((r) => r.clinic === id);
    const n = (st: string) => rs.filter((r) => r.stage === st).length;
    return { rs, n };
  };
  const cardStats = (se: DeskSession): { v: number | string; l: string }[] => {
    const df = dayDiff(se.date, today);
    if (df < 0)
      return se.seen === undefined
        ? [{ v: se.booked, l: "were booked" }]
        : [
            { v: se.seen, l: "seen" },
            { v: se.noShow ?? 0, l: "no-shows" },
            { v: se.booked, l: "were booked" },
          ];
    if (df > 0)
      return [
        { v: se.booked, l: "booked" },
        { v: Math.max(0, se.cap - se.booked), l: "places left" },
        { v: se.docs.length, l: se.docs.length === 1 ? "doctor" : "doctors" },
      ];
    const { rs, n } = todayOf(se.id);
    const st = [
      { v: n("here"), l: "waiting" },
      { v: n("nurse"), l: "with nurse" },
      { v: n("doctor"), l: "with doctor" },
      { v: n("done"), l: "seen" },
      {
        v: rs.filter((r) => r.stage === "expected" && r.go.st === "route").length,
        l: "on the way",
      },
      { v: n("expected"), l: "still expected" },
    ];
    return se.en - se.st < 4.5 ? st.slice(0, 4) : st;
  };
  const nowLine = (se: DeskSession) => {
    if (dayDiff(se.date, today) !== 0) return se.docs.length ? "" : K.noDoctorYet;
    const doc = rows.find((r) => r.clinic === se.id && r.stage === "doctor");
    return doc
      ? fill(K.nowWith, { name: doc.name })
      : se.st > nowHour
        ? fill(K.startsAt, { time: hhmm(se.st) })
        : "";
  };

  /* ─── left panel ─── */
  const panel = (
    <aside className={c("cpanel")} aria-label="Pick a date">
      <div className={c("mini")}>
        <div className={c("miniH")}>
          <button type="button" className={c("nb")} onClick={prevM} aria-label="Previous month">
            <Icon n="left" size={14} w={2.2} />
          </button>
          <b>{miniTitle}</b>
          <button type="button" className={c("nb")} onClick={nextM} aria-label="Next month">
            <Icon n="right" size={14} w={2.2} />
          </button>
        </div>
        <div className={c("mg")}>
          {K.weekdays.map((d) => (
            <span key={d} className={c("dn")}>
              {d}
            </span>
          ))}
          {cells.map((k) => (
            <button
              key={k}
              type="button"
              className={c("md", !inMonth(k) && "o", k === today && "t", k === date && "s")}
              onClick={() => pick(k)}
              aria-label={fmtDay(k)}
            >
              {parseKey(k).getUTCDate()}
              {inMonth(k) && sessionsOn(k).length ? <i /> : null}
            </button>
          ))}
        </div>
      </div>
      <div className={c("dl")}>
        <p className={c("cap")}>On {fmtDay(date)}</p>
        {sessionsOn(date).map((se) => (
          <button
            key={se.key}
            type="button"
            className={c("dli", TONE[tone(se, today, nowHour)])}
            style={ci(clinic(se.id).hue)}
            onClick={() => drill(date, se.id)}
          >
            <span className={c("dotc")} />
            <span>
              <b>{clinic(se.id).name}</b>
              <small>
                {hhmm(se.st)}–{hhmm(se.en)}
                {se.late ? ` · late ${se.late} min` : ""}
              </small>
            </span>
            <em>{se.docs.length ? `${se.booked}/${se.cap}` : K.noDoctor}</em>
          </button>
        ))}
        {sessionsOn(date).length === 0 ? <p className={c("note")}>{K.noClinic}</p> : null}
      </div>
    </aside>
  );

  const head = (
    title: string,
    prev: () => void,
    next: () => void,
    hint: string,
    extra?: React.ReactNode,
  ) => (
    <div className={c("calh")}>
      <button type="button" className={c("nb")} onClick={prev} aria-label="Previous">
        <Icon n="left" size={14} w={2.2} />
      </button>
      <button type="button" className={c("nb")} onClick={next} aria-label="Next">
        <Icon n="right" size={14} w={2.2} />
      </button>
      <h1>{title}</h1>
      <button type="button" className={c("btn", "sm")} onClick={goToday}>
        {K.today}
      </button>
      <span className={c("grow")} />
      {extra ?? <span className={c("why")}>{hint}</span>}
    </div>
  );

  const compactCard = (se: DeskSession, short: boolean) => {
    const k = clinic(se.id);
    const st = cardStats(se);
    const now = nowLine(se);
    return (
      <>
        <span className={c("ch")}>
          <span className={c("tagp")}>
            <span className={c("dotc")} />
            {short ? k.short : k.name}
          </span>
          {se.late ? (
            <span className={c("late")}>{fill(K.late, { n: `${se.late} min` })}</span>
          ) : (
            <span className={c("dots")} aria-hidden="true">
              ···
            </span>
          )}
        </span>
        <span className={c("cbdy")}>
          <b>
            {hhmm(se.st)}–{hhmm(se.en)}
          </b>
          <small>
            {se.kind === "times" ? K.doctorsTimes : K.clinicDay} ·{" "}
            {st
              .slice(0, 2)
              .map((x) => `${x.v} ${x.l}`)
              .join(" · ")}
          </small>
          <span className={c("bar")}>
            <i style={{ width: `${Math.round((se.booked / Math.max(1, se.cap)) * 100)}%` }} />
          </span>
          {now ? <small className={c("know")}>{now}</small> : null}
        </span>
        <span className={c("cft")}>
          <span>{se.docs.length ? `${se.booked} / ${se.cap} booked` : K.noDoctorYet}</span>
          <span className={c("stack")} aria-hidden="true">
            {se.docs.slice(0, 2).map((d) => (
              <span key={d} className={c("av", "sm")}>
                {initials(d)}
              </span>
            ))}
          </span>
        </span>
      </>
    );
  };

  /* ─── week ─── */
  if (view === "week") {
    const d = parseKey(date);
    const wkStart = addDays(date, -((d.getUTCDay() + 6) % 7));
    const days = Array.from({ length: 7 }, (_, i) => addDays(wkStart, i));
    const title = `${parseKey(wkStart).getUTCDate()} – ${parseKey(days[6]!).getUTCDate()} ${monthName(parseKey(days[6]!).getUTCMonth()).slice(0, 3)} ${parseKey(days[6]!).getUTCFullYear()}`;
    return (
      <div className={c("calwrap")}>
        {panel}
        <div className={c("calmain")}>
          <div className={c("cal")}>
            {head(
              title,
              () => pick(addDays(date, -7)),
              () => pick(addDays(date, 7)),
              K.clickHint,
            )}
            <div className={c("gwrap")}>
              <div className={c("wk")}>
                <div className={c("wkr", "wkh")}>
                  <span className={c("wh")}>{K.clinicCol.toUpperCase()}</span>
                  {days.map((k) => (
                    <span key={k} className={c("wh", k === today && "today")}>
                      {DSH[parseKey(k).getUTCDay()]}{" "}
                      <span className={c("dnum")}>{parseKey(k).getUTCDate()}</span>
                    </span>
                  ))}
                </div>
                {data.clinics
                  .filter((x) => on[x.id])
                  .map((cl) => (
                    <div key={cl.id} className={c("wkr")}>
                      <span className={c("wl")} style={ci(cl.hue)}>
                        <i />
                        <span>
                          <b>{cl.name}</b>
                          <small>{cl.pattern}</small>
                        </span>
                      </span>
                      {days.map((k) => {
                        const se = sessionsOn(k).find((z) => z.id === cl.id);
                        const df = dayDiff(k, today);
                        return (
                          <div key={k} className={c("wc", df === 0 && "today", df < 0 && "past")}>
                            {se ? (
                              <button
                                type="button"
                                className={c("card", "wcard", TONE[tone(se, today, nowHour)])}
                                style={ci(cl.hue)}
                                onClick={() => drill(k, cl.id)}
                                aria-label={`${cl.name}, ${fmtDay(k)}, ${se.booked} of ${se.cap} booked`}
                              >
                                {compactCard(se, true)}
                              </button>
                            ) : (
                              <span className={c("wnone")}>{K.noClinic.split(" runs")[0]}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ─── month ─── */
  if (view === "month") {
    let bk = 0,
      cap = 0,
      seen = 0,
      ns = 0,
      pastBk = 0,
      pastDays = 0;
    let busy: { k: string; r: number } | null = null;
    const att: { k: string; what: string; bad: boolean; ord: number }[] = [];
    const days = cells.map((k) => {
      const inM = inMonth(k);
      const ss = inM ? sessionsOn(k) : [];
      const df = dayDiff(k, today);
      const past = df < 0;
      let dc = 0,
        db = 0,
        dSeen = 0,
        dNs = 0;
      const pills = ss.map((se) => {
        const prob = se.docs.length === 0;
        if (!prob) {
          dc += se.cap;
          db += se.booked;
        }
        dSeen += se.seen ?? 0;
        dNs += se.noShow ?? 0;
        const left = Math.max(0, se.cap - se.booked);
        const full = !past && left === 0;
        const name = clinic(se.id).name;
        if (inM && !past) {
          if (prob) att.push({ k, what: fill(U.attNoDoctor, { name }), bad: true, ord: 0 });
          else if (left === 0) att.push({ k, what: `${name} is full`, bad: false, ord: 1 });
          else if (se.late)
            att.push({ k, what: fill(U.attLate, { name, n: se.late }), bad: false, ord: 1 });
        }
        const fillTxt = prob
          ? K.noDoctor.toLowerCase()
          : moM === "left"
            ? past
              ? "—"
              : full
                ? DESK.month.full
                : `${left} left`
            : moM === "seen"
              ? past
                ? se.seen === undefined
                  ? "—"
                  : `${se.seen} · ${se.noShow ?? 0}`
                : `${se.booked} due`
              : `${se.booked}/${se.cap}`;
        return {
          key: se.key,
          name: clinic(se.id).short,
          hue: clinic(se.id).hue,
          w: prob ? "0%" : `${Math.round((se.booked / Math.max(1, se.cap)) * 100)}%`,
          fill: fillTxt,
          cls: [prob ? "prob" : full ? "full" : "", moM === "seen" ? "mnb" : ""],
        };
      });
      if (inM && ss.length) {
        if (past) {
          seen += dSeen;
          ns += dNs;
          pastBk += db;
          pastDays++;
        } else {
          bk += db;
          cap += dc;
          if (df > 0 && dc && (!busy || db / dc > busy.r)) busy = { k, r: db / dc };
        }
      }
      const pct = dc ? Math.round((db / dc) * 100) : 0;
      const hereN =
        df === 0 ? rows.filter((r) => ["here", "nurse", "doctor"].includes(r.stage)).length : 0;
      const prob = ss.some((z) => z.docs.length === 0);
      const tag =
        !inM || !ss.length
          ? ""
          : df === 0
            ? K.today
            : prob
              ? "Check"
              : past
                ? "Done"
                : pct >= 95
                  ? DESK.month.full
                  : "";
      const foot = !inM
        ? ""
        : !ss.length
          ? DESK.clinics.noClinics
          : past
            ? `${dSeen} seen · ${dNs} no-shows`
            : df === 0
              ? fill(U.hereLeft, { here: hereN, left: Math.max(0, dc - db) })
              : fill(U.left, { n: Math.max(0, dc - db) });
      return {
        k,
        inM,
        past,
        df,
        pills,
        pct,
        tag,
        tagCls: df === 0 ? "mtd" : prob ? "bad" : "",
        foot,
        has: inM && ss.length > 0,
        n: ss.length,
      };
    });
    att.sort((a, b) => a.ord - b.ord || a.k.localeCompare(b.k));
    const b = busy as { k: string; r: number } | null;
    const stats = [
      {
        l: DESK.month.bookedAhead,
        v: bk.toLocaleString("en-US"),
        s: fill(U.monthCap, { n: cap.toLocaleString("en-US") }),
        pct: cap ? Math.round((bk / cap) * 100) : null,
      },
      {
        l: DESK.month.seenSoFar,
        v: seen.toLocaleString("en-US"),
        s: fill(U.monthDays, { n: pastDays }),
        pct: null,
      },
      {
        l: DESK.month.noShows,
        v: `${pastBk ? Math.round((ns / pastBk) * 100) : 0}%`,
        s: fill(U.monthNoShow, { n: ns.toLocaleString("en-US") }),
        pct: null,
      },
      {
        l: DESK.month.busiest,
        v: b ? `${DSH[parseKey(b.k).getUTCDay()]} ${parseKey(b.k).getUTCDate()}` : "—",
        s: b ? fill(U.monthPct, { n: Math.round(b.r * 100) }) : DESK.month.nothingBooked,
        pct: b ? Math.round(b.r * 100) : null,
      },
    ];
    return (
      <div className={c("cal")}>
        {head(
          miniTitle,
          prevM,
          nextM,
          "",
          <div className={c("moSeg")} role="group" aria-label="What each day shows">
            {(["booked", "left", "seen"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={c(moM === m && "on")}
                aria-pressed={moM === m}
                onClick={() => setMoM(m)}
              >
                {DESK.month.metrics[m]}
              </button>
            ))}
          </div>,
        )}
        <div className={c("mwrap")}>
          <div className={c("moSum")}>
            {stats.map((k) => (
              <div key={k.l} className={c("moK")}>
                <span className={c("moKl")}>{k.l}</span>
                <b>{k.v}</b>
                <span className={c("moKs")}>{k.s}</span>
                {k.pct !== null ? (
                  <span className={c("moBar")}>
                    <i style={{ width: `${k.pct}%` }} />
                  </span>
                ) : null}
              </div>
            ))}
            <div className={c("moK", "moAtt")}>
              <span className={c("moKl")}>
                {DESK.month.attention}
                <em>{att.length}</em>
              </span>
              {att.length === 0 ? (
                <span className={c("moKs")}>{DESK.month.attentionNone}</span>
              ) : null}
              {att.slice(0, 8).map((a) => (
                <button
                  key={a.k + a.what}
                  type="button"
                  className={c("moAi", a.bad && "bad")}
                  onClick={() => pick(a.k, "day")}
                >
                  <b>
                    {DSH[parseKey(a.k).getUTCDay()]} {parseKey(a.k).getUTCDate()}
                  </b>
                  <span>{a.what}</span>
                </button>
              ))}
            </div>
          </div>
          <div className={c("mhead2")}>
            {DESK.calendar.weekdaysLong.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className={c("mgrid")}>
            {days.map((d) => (
              <button
                key={d.k}
                type="button"
                className={c("mcell", !d.inM && "o", d.df === 0 && "t", d.past && "past")}
                onClick={() => pick(d.k, "day")}
                aria-label={fill(U.monthDayLabel, { day: fmtDay(d.k), n: d.n, pct: d.pct })}
              >
                <span className={c("moTop")}>
                  <span className={c("n")}>{parseKey(d.k).getUTCDate()}</span>
                  <span className={c("moTag", d.tagCls)}>{d.tag}</span>
                  <span className={c("moPct")}>{d.has ? `${d.pct}%` : ""}</span>
                </span>
                {d.has ? (
                  <span className={c("moDay")}>
                    <i style={{ width: `${d.pct}%` }} />
                  </span>
                ) : null}
                {d.pills.slice(0, 3).map((p) => (
                  <span key={p.key} className={c("moP", ...p.cls)} style={ci(p.hue)}>
                    <i />
                    <span className={c("moPn")}>{p.name}</span>
                    <span className={c("moPb")}>
                      <s style={{ width: p.w }} />
                    </span>
                    <em>{p.fill}</em>
                  </span>
                ))}
                {d.pills.length > 3 ? (
                  <span className={c("moP", "more")}>
                    <span className={c("moPn")}>
                      {fill(DESK.month.more, { n: d.pills.length - 3 })} clinics
                    </span>
                  </span>
                ) : null}
                {d.inM ? <span className={c("moF")}>{d.foot}</span> : null}
              </button>
            ))}
          </div>
          <p className={c("moKey")}>
            {fill(DESK.month.keyLine, { metric: DESK.month.metricKey[moM] })}
          </p>
        </div>
      </div>
    );
  }

  /* ─── day ─── */
  const ds = sessionsOn(date);
  const colsN = Math.max(1, ds.length);
  const cols = `64px repeat(${colsN}, minmax(${colsN > 4 ? 190 : 0}px, 1fr))`;
  const hours = Array.from({ length: END - START }, (_, i) => START + i);
  const dd = parseKey(date);
  const title = `${DLONG[dd.getUTCDay()]}, ${dd.getUTCDate()} ${monthName(dd.getUTCMonth())} ${dd.getUTCFullYear()}`;
  const pse = pop ? ds.find((z) => z.key === pop.key) : undefined;

  const liveCard = (se: DeskSession, wide: boolean, idx: number) => {
    const k = clinic(se.id);
    const top = (se.st - START) * H + 4;
    const h = Math.max((se.en - se.st) * H - 8, 500);
    const { rs, n } = todayOf(se.id);
    const order = { doctor: 0, nurse: 1, here: 2 } as Record<string, number>;
    const line = rs
      .filter((r) => r.stage === "here" || r.stage === "nurse" || r.stage === "doctor")
      .sort(
        (a, b) => order[a.stage]! - order[b.stage]! || (a.arr ?? "").localeCompare(b.arr ?? ""),
      );
    const minsSince = (hm?: string) => {
      if (!hm) return 0;
      const [hh, mm] = hm.split(":").map(Number);
      return Math.max(0, Math.round((nowHour - hh! - mm! / 60) * 60));
    };
    const closeAt = se.en - 1;
    const left = Math.max(0, Math.round((closeAt - nowHour) * 3600));
    const cd = `${Math.floor(left / 3600) ? `${Math.floor(left / 3600)}:` : ""}${String(Math.floor((left % 3600) / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
    const withDoc = line.filter((r) => r.stage === "doctor");
    const waits = line.filter((r) => r.stage === "here").map((r) => minsSince(r.arr));
    const avg = waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0;
    const groups: [string, string][] = [
      ["doctor", K.withDoctor],
      ["nurse", K.withNurse],
      ["here", "Waiting"],
    ];
    let no = 0;
    return (
      <div
        key={se.key}
        className={c("card", "live", wide && "wide")}
        style={{ ...ci(k.hue), top, height: h, left: 6, width: "calc(100% - 12px)" }}
      >
        <button
          type="button"
          className={c("lh", TONE[tone(se, today, nowHour, pop?.key === se.key)])}
          onClick={() =>
            setPop(pop?.key === se.key ? null : { key: se.key, col: idx, n: colsN, top })
          }
          aria-label={`${k.name}, ${fmtDay(se.date)}, ${se.booked} of ${se.cap} booked`}
        >
          <span className={c("lh1")}>
            <span className={c("tagp")}>
              <span className={c("dotc")} />
              {k.name}
            </span>
            {se.late ? (
              <span className={c("late")}>{fill(K.late, { n: `${se.late} min` })}</span>
            ) : null}
          </span>
          <b>
            {hhmm(se.st)}–{hhmm(se.en)}
          </b>
          <span className={c("cdn")}>
            <Icon n="clock" size={13} w={2} />
            {left > 0 ? K.closesIn : K.closed}{" "}
            <b className={c("mono")}>{left > 0 ? cd : hhmm(closeAt)}</b>
          </span>
        </button>
        <div className={c("ls")}>
          <p className={c("lcap")}>{K.inClinic}</p>
          {se.docs.map((d, i) => {
            const seeing =
              withDoc.find((r) => r.doc === d) ??
              (i === 0 && withDoc[0] && !se.docs.includes(withDoc[0].doc) ? withDoc[0] : undefined);
            return (
              <div key={d} className={c("ldoc")}>
                <span className={c("av", "sm")}>{initials(d)}</span>
                <span className={c("ln")}>
                  <b>{d}</b>
                  <small>
                    <i className={c(seeing ? "busy" : "free")} />
                    {seeing
                      ? fill(K.seeing, { name: seeing.name.split(" ")[0]! })
                      : se.st > nowHour
                        ? fill(K.startsAt, { time: hhmm(se.st) })
                        : "Free"}
                  </small>
                </span>
              </div>
            );
          })}
          {se.docs.length === 0 ? <p className={c("note")}>{K.noDoctorYet}</p> : null}
        </div>
        <div className={c("ls", "lsGrow")}>
          <p className={c("lcap")}>
            {K.theLine} <em>{line.length}</em>
          </p>
          <div className={c("lth")} aria-hidden="true">
            <span />
            <span />
            <span>{U.cols.patient}</span>
            <span>{U.cols.whyCame}</span>
            <span>{U.cols.doctor}</span>
            <span>{U.cols.arrived}</span>
            <span>{U.cols.fee}</span>
          </div>
          <div className={c("lline")}>
            {groups.map(([st, label]) => {
              const g = line.filter((r) => r.stage === st);
              if (!g.length) return null;
              return (
                <div key={st}>
                  <div className={c("lgh")}>
                    {label}
                    <em>{g.length}</em>
                  </div>
                  {g.map((r) => {
                    no++;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        className={c("lp")}
                        onClick={() => openRow(r.id, false)}
                      >
                        <span className={c("lno")}>{no}</span>
                        <span className={c("av", "sm")} aria-hidden="true">
                          {initials(r.name)}
                        </span>
                        <span className={c("ln")}>
                          <b>{r.name}</b>
                          <small>
                            <span className={c("lm")}>
                              {r.sex} {r.age ?? ""} · {minsSince(r.arr)} min
                            </span>
                          </small>
                        </span>
                        <span className={c("lx")}>{r.reason}</span>
                        <span className={c("lx")}>{r.doc}</span>
                        <span className={c("lx")}>Arrived {r.arr}</span>
                        <span className={c("lx")}>
                          {r.fee
                            ? r.paid
                              ? DESK.row.fee.paid
                              : DESK.row.fee.notPaid
                            : DESK.row.fee.none}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {line.length === 0 ? <p className={c("note")}>{K.nobodyWaiting}</p> : null}
          </div>
        </div>
        <div className={c("lstat")}>
          <p className={c("lcap", "lsc")}>{K.soFar}</p>
          {[
            { v: se.booked, l: "booked" },
            {
              v: rs.filter((r) => r.stage !== "expected" && r.stage !== "notseen").length,
              l: "arrived",
            },
            { v: n("done"), l: "seen" },
            { v: n("expected"), l: "expected" },
            { v: `${avg}m`, l: "avg wait" },
          ].map((x) => (
            <span key={x.l}>
              <b>{x.v}</b>
              {x.l}
            </span>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className={c("calwrap")}>
      {panel}
      <div className={c("calmain")}>
        <div className={c("cal")}>
          {head(
            title,
            () => pick(addDays(date, -1)),
            () => pick(addDays(date, 1)),
            K.dayHint,
          )}
          <div className={c("gwrap")}>
            <div className={c("gin")}>
              <div className={c("ghead")} style={{ gridTemplateColumns: cols }}>
                <span className={c("gh")}>{K.timezone}</span>
                {ds.length ? (
                  ds.map((se) => (
                    <span key={se.key} className={c("gh")} style={ci(clinic(se.id).hue)}>
                      <span className={c("ghc")}>
                        <i />
                        {clinic(se.id).name}
                      </span>
                    </span>
                  ))
                ) : (
                  <span className={c("gh")}>
                    <span className={c("ghc")}>{DESK.clinics.noClinics}</span>
                  </span>
                )}
              </div>
              <div
                className={c("gbody")}
                style={{ gridTemplateColumns: cols, height: (END - START) * H }}
              >
                <div className={c("gtime")}>
                  {hours.map((h) => (
                    <span key={h} style={{ top: (h - START) * H }}>
                      {h > 12 ? h - 12 : h} {h >= 12 ? "PM" : "AM"}
                    </span>
                  ))}
                </div>
                <div className={c("hlines")} aria-hidden="true">
                  {hours.map((h) => (
                    <span key={h} className={c("hl")} style={{ top: (h - START) * H }} />
                  ))}
                </div>
                {(ds.length ? ds : [null]).map((se, idx) => {
                  if (!se) return <div key="none" className={c("gcol")} />;
                  const df = dayDiff(se.date, today);
                  const k = clinic(se.id);
                  if (se.kind === "times") {
                    const taken = se.taken ?? {};
                    return (
                      <div
                        key={se.key}
                        className={c("gcol", df === 0 && "today", df < 0 && "past")}
                      >
                        {slotTimes(se).map((x) => {
                          const booked = x.t in taken;
                          const name = taken[x.t];
                          return (
                            <button
                              key={x.t}
                              type="button"
                              className={c("slot", !booked ? "open" : df < 0 && "past")}
                              style={{
                                top: (x.h - START) * H + 3,
                                height: H / 3 - 6,
                                left: 6,
                                right: 6,
                              }}
                              onClick={() => {
                                if (!booked) {
                                  if (df < 0) return;
                                  setIntent({ book: { clinic: se.id, key: se.key, slot: x.t } });
                                  setModal("book");
                                } else {
                                  const rr = rows.find((r) => r.clinic === se.id && r.time === x.t);
                                  if (rr) openRow(rr.id, false);
                                }
                              }}
                            >
                              <span className={c("t")}>{x.t}</span>
                              {!booked
                                ? df < 0
                                  ? K.notBooked
                                  : K.openSlot
                                : (name ?? DESK.ticket.booked)}
                            </button>
                          );
                        })}
                      </div>
                    );
                  }
                  const tn = tone(se, today, nowHour);
                  if (df === 0 && tn !== "done")
                    return (
                      <div key={se.key} className={c("gcol", "today")}>
                        {liveCard(se, colsN <= 2, idx)}
                      </div>
                    );
                  const top = (se.st - START) * H + 4;
                  return (
                    <div key={se.key} className={c("gcol", df === 0 && "today", df < 0 && "past")}>
                      <button
                        type="button"
                        className={c("card", TONE[tone(se, today, nowHour, pop?.key === se.key)])}
                        style={{
                          ...ci(k.hue),
                          top,
                          height: (se.en - se.st) * H - 8,
                          left: 6,
                          width: "calc(100% - 12px)",
                        }}
                        onClick={() =>
                          setPop(
                            pop?.key === se.key ? null : { key: se.key, col: idx, n: colsN, top },
                          )
                        }
                        aria-label={`${k.name}, ${fmtDay(se.date)}, ${se.booked} of ${se.cap} booked`}
                      >
                        {compactCard(se, false)}
                      </button>
                    </div>
                  );
                })}
                {date === today ? (
                  <div className={c("nowLine")} style={{ top: (nowHour - START) * H }}>
                    <span>{`${Math.floor(nowHour) > 12 ? Math.floor(nowHour) - 12 : Math.floor(nowHour)}:${String(Math.floor((nowHour % 1) * 60)).padStart(2, "0")} ${nowHour >= 12 ? "PM" : "AM"}`}</span>
                  </div>
                ) : null}
                {pop && pse ? (
                  <div
                    className={c("pop")}
                    style={{
                      top: Math.max(8, Math.min(pop.top, (END - START) * H - 470)),
                      left:
                        pop.n === 1
                          ? "calc(50% - 170px)"
                          : pop.col < pop.n - 1
                            ? `calc(64px + ((100% - 64px) / ${pop.n}) * ${pop.col + 1} - 4px)`
                            : `calc(64px + ((100% - 64px) / ${pop.n}) * ${pop.col} - 344px)`,
                    }}
                    role="dialog"
                    aria-label={clinic(pse.id).name}
                  >
                    <div className={c("dh")}>
                      <span className={c("tile")} aria-hidden="true">
                        <Icon n="calendar" size={18} />
                      </span>
                      <div>
                        <h2>{clinic(pse.id).name}</h2>
                        <p>
                          {fmtDay(pse.date)} · {pse.kind === "times" ? K.doctorsTimes : K.clinicDay}
                        </p>
                      </div>
                      <button
                        type="button"
                        className={c("btn", "sm", "q", "x")}
                        onClick={() => setPop(null)}
                      >
                        {DESK.panel.close}
                      </button>
                    </div>
                    <div className={c("form")}>
                      <div className={c("fr")}>
                        <span>{DESK.panel.time}</span>
                        <span className={c("fv")}>
                          {hhmm(pse.st)}–{hhmm(pse.en)} ·{" "}
                          {pse.kind === "times" ? "20-minute times" : "seen in line order"}
                        </span>
                      </div>
                      <div className={c("fr")}>
                        <span>{DESK.pop.doctors}</span>
                        <span className={c("fv")}>{pse.docs.join(", ") || K.noDoctorYet}</span>
                      </div>
                      <div className={c("fr")}>
                        <span>{DESK.pop.full}</span>
                        <span className={c("fv")}>
                          {pse.booked} of {pse.cap} booked
                        </span>
                      </div>
                      <div className={c("fr")}>
                        <span>{DESK.pop.status}</span>
                        <span className={c("fv")}>
                          {!pse.docs.length
                            ? K.needsDoctor
                            : pse.late
                              ? fill(K.running, { n: pse.late })
                              : dayDiff(pse.date, today) < 0
                                ? "Done"
                                : "On"}
                        </span>
                      </div>
                    </div>
                    {dayDiff(pse.date, today) === 0 ? (
                      <div className={c("acts")}>
                        <button
                          type="button"
                          className={c("btn", "k", "sm")}
                          onClick={() => {
                            setSessF(pse.id);
                            setView("arr");
                          }}
                        >
                          {DESK.pop.open}
                        </button>
                        <button
                          type="button"
                          className={c("btn", "sm")}
                          onClick={() => {
                            setIntent({ lateKey: pse.key });
                            setModal("late");
                          }}
                        >
                          {DESK.pop.late}
                        </button>
                        <button
                          type="button"
                          className={c("btn", "sm")}
                          onClick={() => window.print()}
                        >
                          {DESK.pop.print}
                        </button>
                      </div>
                    ) : null}
                    {dayDiff(pse.date, today) > 0 ? (
                      <div className={c("acts")}>
                        <button
                          type="button"
                          className={c("btn", "k", "sm")}
                          disabled={pse.booked >= pse.cap}
                          onClick={() => {
                            setIntent({ book: { clinic: pse.id, key: pse.key, slot: "" } });
                            setModal("book");
                          }}
                        >
                          {DESK.pop.book}
                        </button>
                      </div>
                    ) : null}
                    {dayDiff(pse.date, today) < 0 ? (
                      <p className={c("note")}>
                        {fill(DESK.pop.over, {
                          seen:
                            pse.seen === undefined
                              ? ""
                              : `${pse.seen} seen, ${pse.noShow ?? 0} no-shows.`,
                        })}
                      </p>
                    ) : null}
                    {!pse.docs.length ? (
                      <p className={c("note")}>
                        <b>{DESK.pop.noDoctor}</b> {DESK.pop.adminTold}
                      </p>
                    ) : null}
                    <div className={c("hr")} />
                    <div className={c("mf")}>
                      <button type="button" className={c("btn", "sm")} disabled>
                        {DESK.pop.cancelDay}
                      </button>
                      <span className={c("why")}>{DESK.pop.cancelDayWhy}</span>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
