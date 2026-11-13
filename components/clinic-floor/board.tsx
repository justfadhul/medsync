"use client";

/**
 * The floor board (ADR 0491) and the waiting-room screen (ADR 0494). The board is staff-only: every person on
 * the floor by step and clinic, filterable, and "Needs a hand". The screen takes ONLY a `ScreenFeed`: booking
 * codes and rooms, never a name, a place in line or a wait (S3, ADR 0084).
 */
import type { FloorCtx } from "./floor";
import type { FloorStep, ScreenFeed } from "@/lib/clinic-floor/model";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { c } from "@/components/reception/ui";
import { FLOOR } from "@/content/clinic-floor/floor";
import { fill } from "@/content/lab-workspace-v2";
import { FLOOR_STEPS, floorMetrics, recheckDueAt, triageOrder } from "@/lib/clinic-floor/model";
import { hm, levelCls, levelTxt, mins } from "./shared";
import { Av, PrivBtn } from "./triage";

const B = FLOOR.floor;

export function BoardView({ ctx }: { ctx: FloorCtx }) {
  const { rows, byId, now, data } = ctx;
  const [f, setF] = useState<{ st: FloorStep | ""; cl: string }>({ st: "", cl: "" });
  const pick = (st: FloorStep | "", cl: string) =>
    setF((o) => (o.st === st && o.cl === cl ? { st: "", cl: "" } : { st, cl }));
  const m = floorMetrics(rows, ctx.events, now);
  const live = FLOOR_STEPS.filter((s) => s !== "done");
  const onFloor = rows.filter((r) => r.step !== "done");
  const longest = Math.max(0, ...live.map((s) => m.longest[s]));
  const q = ctx.q.trim().toLowerCase();

  const list = rows
    .filter(
      (r) => (f.st ? r.step === f.st : r.step !== "done") && (!f.cl || r.departmentId === f.cl),
    )
    .filter(
      (r) =>
        !q || byId.get(r.intakeId)!.name.toLowerCase().includes(q) || r.code?.toLowerCase() === q,
    )
    .sort((a, b) => a.since - b.since);
  const clinics = data.clinics.filter((cl) => rows.some((r) => r.departmentId === cl.id));
  const docLine = (id: string) =>
    ctx
      .clinicOf(id)
      .doctors.map((d) => {
        const s = ctx.doctors.get(d.id)?.status;
        return s
          ? `${d.name} ${B.docStatus[s === "in_room" ? "in_room" : s === "away" ? "away" : "break"]}`
          : d.name;
      })
      .join(" · ");

  // Needs a hand: overdue re-checks, urgent still waiting, results back, the longest wait for triage, needs.
  type Att = {
    key: string;
    what: string;
    name: string;
    sub: string;
    cls: string;
    btn: string;
    go: () => void;
  };
  const att: Att[] = [];
  for (const r of rows) {
    const due = recheckDueAt(r);
    const p = byId.get(r.intakeId)!;
    if (due != null && due <= now)
      att.push({
        key: `re${r.intakeId}`,
        what: B.att.recheck,
        name: p.name,
        sub: fill(B.att.recheckSub, { t: hm(r.triagedAt!), level: levelTxt(r.level) }),
        cls: "due",
        btn: B.att.btnRecheck,
        go: () => {
          ctx.setSel({ id: r.intakeId, re: true });
          ctx.go("triage");
        },
      });
  }
  for (const r of rows.filter((x) => x.step === "line" && x.level != null && x.level <= 2)) {
    const p = byId.get(r.intakeId)!;
    att.push({
      key: `u${r.intakeId}`,
      what: fill(B.att.urgent, { level: levelTxt(r.level) }),
      name: p.name,
      sub: fill(B.att.urgentSub, {
        clinic: ctx.clinicOf(r.departmentId).short,
        n: mins(now - r.since),
      }),
      cls: "urg",
      btn: B.att.btnLine,
      go: () => {
        ctx.setClinic(r.departmentId!);
        ctx.go("line");
      },
    });
  }
  for (const r of rows.filter((x) => x.step === "line" && x.resultsReady)) {
    att.push({
      key: `r${r.intakeId}`,
      what: B.att.results,
      name: byId.get(r.intakeId)!.name,
      sub: fill(B.att.resultsSub, { clinic: ctx.clinicOf(r.departmentId).short }),
      cls: "res",
      btn: B.att.btnLine,
      go: () => {
        ctx.setClinic(r.departmentId!);
        ctx.go("line");
      },
    });
  }
  const w0 = triageOrder(rows)[0];
  if (w0)
    att.push({
      key: `w${w0.intakeId}`,
      what: B.att.longest,
      name: byId.get(w0.intakeId)!.name,
      sub: fill(B.att.longestSub, { n: mins(now - w0.arrivedAt), t: hm(w0.arrivedAt) }),
      cls: "",
      btn: B.att.btnTriage,
      go: () => {
        ctx.setSel({ id: w0.intakeId, re: false });
        ctx.go("triage");
      },
    });
  for (const r of onFloor) {
    const p = byId.get(r.intakeId)!;
    if (p.needs.length && !att.some((a) => a.name === p.name))
      att.push({
        key: `n${r.intakeId}`,
        what: p.needs.join(" · "),
        name: p.name,
        sub: fill(B.att.needsSub, {
          step: B.steps[r.step][0],
          clinic: ctx.clinicOf(r.departmentId).short,
        }),
        cls: "need",
        btn: B.att.btnFind,
        go: () => pick(r.step, r.departmentId ?? ""),
      });
  }

  const where = (r: (typeof rows)[number]) => {
    const p = byId.get(r.intakeId)!;
    switch (r.step) {
      case "with":
        return ctx.docName(r.doctorUserId);
      case "tests":
        return p.testsFor ?? B.where.tests;
      case "done":
        return r.outcome
          ? (B.outcome[r.outcome as keyof typeof B.outcome] ?? B.where.seen)
          : B.where.seen;
      case "called":
        return r.room ?? "";
      case "line":
        return r.doctorUserId
          ? fill(B.where.line, { doc: ctx.docName(r.doctorUserId) })
          : B.where.any;
      default:
        return fill(B.where.arrived, { t: hm(r.arrivedAt) });
    }
  };

  return (
    <div className={c("cf-wrap")}>
      <div className={c("cf-l")}>
        <div className={c("ahead")}>
          <div className={c("ahl")}>
            <h1>{B.title}</h1>
            <span className={c("adate")}>{fill(B.date, { time: hm(now) })}</span>
          </div>
          <div className={c("cf-stats")}>
            <span className={c("cf-stat")}>
              <b>{onFloor.length}</b> {B.onFloor}
            </span>
            {onFloor.length ? (
              <span className={c("cf-stat")}>
                {B.longestWait} <b>{mins(longest)}</b>
              </span>
            ) : null}
          </div>
          <span className={c("grow")} />
          <PrivBtn ctx={ctx} />
        </div>
        <div className={c("cf-flb")}>
          <div className={c("cf-flow")} role="group" aria-label={B.flowLabel}>
            {FLOOR_STEPS.map((s) => {
              const n = m.count[s];
              const slow = m.slowest === s;
              return (
                <button
                  key={s}
                  type="button"
                  className={c("cf-fs", f.st === s && !f.cl && "on", !n && "zero", slow && "slow")}
                  aria-pressed={f.st === s && !f.cl}
                  onClick={() => pick(s, "")}
                >
                  <span className={c("cf-fsl")}>
                    {B.steps[s][0]}
                    {slow ? <i>{B.slowest}</i> : null}
                  </span>
                  <b>{n}</b>
                  <small>
                    {!n
                      ? B.noOne
                      : s === "done"
                        ? B.seenToday
                        : s === "called"
                          ? fill(B.calledAgo, { n: mins(m.longest[s]) })
                          : fill(B.longestN, { n: mins(m.longest[s]) })}
                  </small>
                </button>
              );
            })}
          </div>
          <div className={c("cf-flg")}>
            <div className={c("cf-flm")}>
              <div className={c("cf-mx")} role="table" aria-label={B.table}>
                <div className={c("cf-mxr", "cf-mxh")} role="row">
                  <span role="columnheader">{B.clinic}</span>
                  {FLOOR_STEPS.map((s) => (
                    <span key={s} role="columnheader">
                      {B.steps[s][1]}
                    </span>
                  ))}
                </div>
                {clinics.map((cl) => (
                  <div key={cl.id} className={c("cf-mxr")} role="row">
                    <button
                      type="button"
                      className={c("cf-mxc", f.cl === cl.id && !f.st && "on")}
                      onClick={() => pick("", cl.id)}
                      role="rowheader"
                    >
                      <span>
                        <i style={{ background: cl.hue }} />
                        {cl.name}
                      </span>
                      <small>
                        {cl.rooms} · {docLine(cl.id)}
                      </small>
                    </button>
                    {FLOOR_STEPS.map((s) => {
                      const here = rows
                        .filter((r) => r.step === s && r.departmentId === cl.id)
                        .sort((a, b) => a.since - b.since);
                      const n = here.length;
                      const L = n ? now - here[0]!.since : 0;
                      return (
                        <button
                          key={s}
                          type="button"
                          className={c(
                            "cf-mxd",
                            f.st === s && f.cl === cl.id && "on",
                            !n && "zero",
                            n > 0 && s === m.slowest && L === m.longest[s] && "slow",
                          )}
                          onClick={() => n && pick(s, cl.id)}
                          role="cell"
                          aria-label={fill(B.cellAria, { clinic: cl.name, step: B.steps[s][0], n })}
                        >
                          {n ? (
                            <>
                              <span className={c("cf-mxn")}>
                                <b>{n}</b>
                                <small>{s !== "done" ? mins(L) : ""}</small>
                              </span>
                              {s !== "done" ? (
                                <span className={c("cf-avs")}>
                                  {here.slice(0, 3).map((r) => (
                                    <Av key={r.intakeId} name={byId.get(r.intakeId)!.name} />
                                  ))}
                                  {n > 3 ? <em>+{n - 3}</em> : null}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span className={c("cf-mx0")}>–</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className={c("cf-fll")}>
                <div className={c("cf-fllh")}>
                  <b>
                    {(f.st ? B.steps[f.st][0] : B.everyone) +
                      (f.cl ? ` · ${ctx.clinicOf(f.cl).name}` : "")}
                  </b>
                  <em>{list.length}</em>
                  <span className={c("grow")} />
                  {f.st || f.cl ? (
                    <button
                      type="button"
                      className={c("btn", "sm", "q")}
                      onClick={() => setF({ st: "", cl: "" })}
                    >
                      {B.showEveryone}
                    </button>
                  ) : null}
                </div>
                {!list.length ? <p className={c("cf-flnone")}>{B.noneHere}</p> : null}
                {list.map((r) => {
                  const p = byId.get(r.intakeId)!;
                  const cl = ctx.clinicOf(r.departmentId);
                  const due = recheckDueAt(r);
                  return (
                    <button
                      key={r.intakeId}
                      type="button"
                      className={c("cf-flr")}
                      onClick={() => {
                        if (r.step === "triage") {
                          ctx.setSel({ id: r.intakeId, re: false });
                          ctx.go("triage");
                        } else if (r.step !== "done") {
                          ctx.setClinic(cl.id);
                          ctx.go("line");
                        }
                      }}
                    >
                      <Av name={p.name} />
                      <span className={c("cf-flrn")}>
                        <b>{p.name}</b>
                        <small>
                          <i style={{ background: cl.hue }} />
                          {cl.short} · {where(r)}
                        </small>
                      </span>
                      <span className={c("cf-flrs")}>
                        <span className={c("cf-stg", r.step)}>{B.steps[r.step][1]}</span>
                        {r.level != null ? (
                          <span className={c("pri", levelCls(r.level))}>{levelTxt(r.level)}</span>
                        ) : null}
                        {p.needs.map((x) => (
                          <span key={x} className={c("cf-flag", "need")}>
                            {x}
                          </span>
                        ))}
                        {due != null ? (
                          <span className={c("cf-flag", due <= now && "due")}>
                            {fill(FLOOR.line.flags.recheck, {
                              due:
                                due <= now
                                  ? FLOOR.triage.dueNow
                                  : fill(FLOOR.triage.dueIn, { n: mins(due - now) }),
                            })}
                          </span>
                        ) : null}
                        {r.resultsReady ? (
                          <span className={c("cf-flag", "res")}>{FLOOR.line.flags.results}</span>
                        ) : null}
                      </span>
                      <span className={c("cf-flrw")}>
                        {r.step === "done" ? "" : mins(now - r.since)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <aside className={c("cf-att")} aria-label={B.hand}>
              <div className={c("cf-atth")}>
                <b>{B.hand}</b>
                <small>{FLOOR.line.staffOnly}</small>
              </div>
              {!att.length ? <p className={c("cf-flnone")}>{B.flowing}</p> : null}
              {att.slice(0, 7).map((a) => (
                <div key={a.key} className={c("cf-ati", a.cls)}>
                  <span className={c("cf-atit")}>
                    <b>{a.what}</b>
                    <span>{a.name}</span>
                    <small>{a.sub}</small>
                  </span>
                  <button type="button" className={c("btn", "sm")} onClick={a.go}>
                    {a.btn}
                  </button>
                </div>
              ))}
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The waiting-room screen: codes and rooms only (S3). Used by the preview dialog and `/clinic/screen`. */
export function ScreenBoard({
  head,
  clock,
  feed,
  late,
}: {
  head: string;
  clock: string;
  feed: ScreenFeed;
  late: boolean;
}) {
  const S = FLOOR.screen;
  const items = [
    ...feed.now.map((x) => ({ ...x, live: true })),
    ...feed.recent.map((x) => ({ ...x, live: false })),
  ];
  return (
    <div className={c("cf-wr")} aria-live="polite">
      <div className={c("cf-wrh")}>
        <b>{head}</b>
        <span>{clock}</span>
      </div>
      {feed.paused.map((x) => (
        <div key={x.room} className={c("cf-wrn", "cf-wpause")}>
          <span className={c("cf-wwho")}>
            <span>{x.room}</span>
            <b className={c("cf-wpt")}>{S.paused[x.status]}</b>
          </span>
        </div>
      ))}
      {items.map((w) => (
        <div key={`${w.code}${w.calledAt}`} className={c("cf-wrn", w.live && "cf-live")}>
          <span className={c("cf-wwho")}>
            <span>{w.live ? S.now : S.recent}</span>
            <b>{`${w.code.slice(0, 3)} ${w.code.slice(3)}`}</b>
          </span>
          <span className={c("cf-wrm")}>
            <small>{S.goTo}</small>
            {w.room}
          </span>
        </div>
      ))}
      {!items.length ? (
        <div className={c("cf-wrn")}>
          <span className={c("cf-wwho")}>
            <span>{S.wait}</span>
            <b>{S.noneYet}</b>
          </span>
        </div>
      ) : null}
      <div className={c("cf-wrf")}>
        <span>{S.foot}</span>
        <span>{late ? S.running : ""}</span>
      </div>
    </div>
  );
}

/** The full-screen waiting-room screen: its own clock, and a fresh feed from the server every 10 s. */
export function ScreenLive({
  head,
  feed,
  late,
}: {
  head: string;
  feed: ScreenFeed;
  late: boolean;
}) {
  const router = useRouter();
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () => setClock(hm(Date.now()));
    tick();
    const a = setInterval(tick, 15_000);
    const b = setInterval(() => router.refresh(), 10_000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [router]);
  return (
    <main
      className={c("tokens")}
      style={{ minHeight: "100svh", display: "grid", placeItems: "center", padding: 16 }}
    >
      <ScreenBoard head={head} clock={clock} feed={feed} late={late} />
    </main>
  );
}
