"use client";

/**
 * The doctor's clinic line (ADRs 0493, 0495): status, who is with you, calling, the brief while they walk in,
 * the line in the signed order (`lineOrder`), away for tests, and the session dialogs (finish, running late,
 * end session, the waiting-room screen preview). Every change is one floor event through the context.
 */
import type { FloorCtx, Modal } from "./floor";
import type { FloorPerson } from "@/lib/clinic-floor/fixture";
import type { DoctorStatus, FloorRow, Outcome } from "@/lib/clinic-floor/model";
import { useState } from "react";

import { Ticket } from "@/components/landing/tether/ticket";
import { EditorDialog } from "@/components/medsync/editor-dialog";
import { c, DeskDialog } from "@/components/reception/ui";
import { FLOOR } from "@/content/clinic-floor/floor";
import { fill } from "@/content/lab-workspace-v2";
import { TICKET } from "@/content/tether-landing/copy";
import { floorMetrics, recheckDueAt, screenFeed } from "@/lib/clinic-floor/model";
import { initials } from "@/lib/reception/desk/model";
import { ScreenBoard } from "./board";
import { dayLabel, first, hm, levelCls, levelTxt, mins, vitalChips, whoOf } from "./shared";
import { Trends } from "./trends";
import { Av } from "./triage";

const L = FLOOR.line;

/** The latest running-late note for this doctor today, or "". */
export function lateOf(ctx: FloorCtx, doctorId: string): string {
  const e = ctx.events
    .filter((x) => x.kind === "running_late" && x.doctorUserId === doctorId)
    .at(-1);
  return e?.note ?? "";
}

export function LineView({
  ctx,
  line,
  callNext,
}: {
  ctx: FloorCtx;
  line: FloorRow[];
  callNext: () => void;
}) {
  const { clinic, rows, byId, now, user, priv, myState } = ctx;
  const [breakMins, setBreakMins] = useState<10 | 15 | 30>(15);
  const reason = (p: FloorPerson) =>
    priv ? FLOOR.hiddenReason : p.own ? `"${p.reason}"` : p.reason;
  const rCls = (p: FloorPerson) => c(priv ? "hid" : p.own && "own");

  const me = user.id;
  const withRow = rows.find((r) => r.doctorUserId === me && r.step === "with");
  const callRow = rows.find((r) => r.doctorUserId === me && r.step === "called");
  const away = rows.filter((r) => r.step === "tests" && r.departmentId === clinic.id);
  const seenN = rows.filter((r) => r.step === "done" && r.departmentId === clinic.id).length;
  const m = floorMetrics(rows, ctx.events, now);
  const late = lateOf(ctx, me);
  const status: "in_room" | "break" | "away" =
    !myState || myState.status === "in_room"
      ? "in_room"
      : myState.status === "away"
        ? "away"
        : "break";
  const busy = !!withRow || !!callRow || status !== "in_room";

  const setStatus = (s: DoctorStatus) => {
    ctx.record("doctor_status", null, { detail: s, room: clinic.room, departmentId: clinic.id });
    if (s === "in_room") ctx.say(L.toasts.inRoom);
    else if (s === "away") ctx.say(L.toasts.awayOn);
    else ctx.say(fill(L.toasts.breakOn, { t: hm(now + Number(s.slice(6)) * 60_000) }));
  };

  // Groups in display order: level groups, back from tests, not triaged (lineOrder already ordered them).
  const groups = new Map<string, FloorRow[]>();
  for (const r of line) {
    const k = r.resultsReady ? "back" : r.level == null ? "none" : String(r.level);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const gLabel = (k: string): [string, string] =>
    k === "back"
      ? [L.groups.back, L.groups.backSub]
      : k === "none"
        ? [L.groups.untriaged, L.groups.untriagedSub]
        : [levelTxt(Number(k) as 1), L.groups.sub[Number(k) as 1]];
  let no = 0;
  const next = line[0] ? byId.get(line[0].intakeId) : undefined;

  return (
    <div className={c("cf-wrap")}>
      <div className={c("cf-l")}>
        <div className={c("ahead")}>
          <div className={c("ahl")}>
            <h1>{L.title}</h1>
            <span className={c("adate")}>
              {fill(L.date, { clinic: clinic.name, room: clinic.room, hours: clinic.hours })}
            </span>
          </div>
          <div className={c("cf-stats")}>
            <span className={c("cf-stat")}>
              <b>{seenN}</b> {L.seen}
            </span>
            <span className={c("cf-stat")}>
              <b>{line.length}</b> {L.inLine}
            </span>
            {m.medianVisit != null ? (
              <span className={c("cf-stat")}>{fill(L.about, { n: mins(m.medianVisit) })}</span>
            ) : null}
            {late ? <span className={c("cf-stat")}>{fill(L.running, { n: late })}</span> : null}
          </div>
          <span className={c("grow")} />
          <div className={c("cf-st")} role="group" aria-label={L.statusLabel}>
            {(["in_room", "break", "away"] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={c(s === "in_room" ? "in" : s, status === s && "on")}
                aria-pressed={status === s}
                onClick={() => status !== s && setStatus(s === "break" ? `break_${breakMins}` : s)}
              >
                <i />
                {L.status[s]}
              </button>
            ))}
          </div>
          <div className={c("cf-hb")}>
            <button
              type="button"
              className={c("btn", "sm", "q")}
              onClick={() => ctx.setModal("screen")}
              title={L.screenTitle}
            >
              {L.screen}
            </button>
            <button
              type="button"
              className={c("btn", "sm", "q")}
              onClick={() => ctx.setModal("late")}
            >
              {L.late}
            </button>
            <button type="button" className={c("btn", "sm")} onClick={() => ctx.setModal("end")}>
              {L.end}
            </button>
          </div>
        </div>

        <div className={c("cf-ln")}>
          <div className={c("cf-now")}>
            {withRow ? (
              <WithYou
                ctx={ctx}
                row={withRow}
                p={byId.get(withRow.intakeId)!}
                reason={reason}
                rCls={rCls}
              />
            ) : callRow ? (
              <Calling
                ctx={ctx}
                row={callRow}
                p={byId.get(callRow.intakeId)!}
                reason={reason}
                rCls={rCls}
              />
            ) : status !== "in_room" ? (
              <div className={c("cf-idle", "cf-out")}>
                <h2>{status === "break" ? L.onBreak : L.away}</h2>
                <p>
                  {status === "away"
                    ? L.awayLine
                    : myState?.until && myState.until > now
                      ? fill(L.breakLine, { t: hm(myState.until), n: mins(myState.until - now) })
                      : L.breakUp}
                </p>
                {status === "break" ? (
                  <div className={c("chips")} style={{ justifyContent: "center" }}>
                    {([10, 15, 30] as const).map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={c("chip", "sm2", breakMins === n && "on")}
                        aria-pressed={breakMins === n}
                        onClick={() => {
                          setBreakMins(n);
                          ctx.record("doctor_status", null, {
                            detail: `break_${n}`,
                            room: clinic.room,
                            departmentId: clinic.id,
                          });
                        }}
                      >
                        {fill(L.breaks, { n })}
                      </button>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  className={c("btn", "k", "cf-big")}
                  onClick={() => setStatus("in_room")}
                >
                  {L.back}
                </button>
              </div>
            ) : (
              <div className={c("cf-idle")}>
                <h2>{L.noOne}</h2>
                {next ? (
                  <>
                    <p>{L.nextRule}</p>
                    <button type="button" className={c("btn", "k", "cf-big")} onClick={callNext}>
                      {fill(L.callNext, { name: next.name })}
                      <small>
                        {levelTxt(line[0]!.level)} ·{" "}
                        {fill(L.waited, { n: mins(now - line[0]!.arrivedAt) })}
                      </small>
                    </button>
                    <p className={c("cf-mt")}>{L.orN}</p>
                  </>
                ) : (
                  <p>{L.emptyLine}</p>
                )}
              </div>
            )}
          </div>

          <div className={c("cf-q")} aria-label={L.theLine}>
            <div className={c("cf-qh")}>
              <h3>{L.theLine}</h3>
              <span className={c("cf-stat")} style={{ padding: "2px 10px" }}>
                <b>{line.length}</b>
              </span>
              <span className={c("grow")} />
              <span className={c("cf-mt")}>{L.staffOnly}</span>
            </div>
            <div className={c("cf-qs")}>
              {[...groups].map(([k, rs]) => (
                <div key={k}>
                  <div className={c("cf-grp")}>
                    {gLabel(k)[0]}
                    <em>{gLabel(k)[1]}</em>
                  </div>
                  {rs.map((r) => {
                    const p = byId.get(r.intakeId)!;
                    const due = recheckDueAt(r);
                    no += 1;
                    return (
                      <div key={r.intakeId} className={c("cf-qi")}>
                        <span className={c("no")}>{no}</span>
                        <Av name={p.name} />
                        <span className={c("qn")}>
                          <b>{p.name}</b>
                          <span>
                            {fill(L.sub.waited, { n: mins(now - r.arrivedAt) })}
                            {r.resultsReady ? L.sub.results : r.level == null ? L.sub.direct : ""}
                          </span>
                          <span className={c("qv")}>
                            <span className={c("pri", levelCls(r.level))}>{levelTxt(r.level)}</span>
                            {p.triage
                              ? vitalChips(p.triage.input)
                                  .filter((v) => v.cls && v.cls !== "ok")
                                  .slice(0, 2)
                                  .map((v) => (
                                    <span key={v.key} className={c("cf-mini", v.cls)}>
                                      {v.k} {v.v}
                                    </span>
                                  ))
                              : null}
                            {p.needs.map((x) => (
                              <span key={x} className={c("cf-flag", "need")}>
                                {x}
                              </span>
                            ))}
                            {due != null ? (
                              <span className={c("cf-flag", due <= now && "due")}>
                                {fill(L.flags.recheck, {
                                  due:
                                    due <= now
                                      ? FLOOR.triage.dueNow
                                      : fill(FLOOR.triage.dueIn, { n: mins(due - now) }),
                                })}
                              </span>
                            ) : null}
                            {r.resultsReady ? (
                              <span className={c("cf-flag", "res")}>{L.flags.results}</span>
                            ) : null}
                          </span>
                        </span>
                        <button
                          type="button"
                          className={c("btn", "sm")}
                          onClick={() => ctx.call(r.intakeId)}
                          disabled={busy}
                        >
                          {L.call}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
              {away.length ? (
                <>
                  <div className={c("cf-grp")}>
                    {L.awayTests}
                    <em>{away.length}</em>
                  </div>
                  {away.map((r) => {
                    const p = byId.get(r.intakeId)!;
                    return (
                      <div key={r.intakeId} className={c("cf-away")}>
                        <span className={c("av", "sm")}>{initials(p.name)}</span>
                        <span className={c("grow")}>
                          <b>{p.name}</b>
                          <span className={c("cf-mt")} style={{ display: "block" }}>
                            {[p.testsFor, fill(FLOOR.triage.since, { t: hm(r.since) })]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        {ctx.data.fixture ? (
                          <button
                            type="button"
                            className={c("btn", "sm")}
                            onClick={() => {
                              ctx.setPeople((ps) =>
                                ps.map((x) =>
                                  x.id === p.id
                                    ? { ...x, resultsReleasedAt: [...x.resultsReleasedAt, now] }
                                    : x,
                                ),
                              );
                              ctx.say(fill(L.toasts.results, { name: p.name }));
                            }}
                          >
                            {L.resultsBack}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </>
              ) : null}
              {!line.length && !away.length ? (
                <div className={c("empty")} style={{ margin: 12 }}>
                  <b>{L.noWaiting[0]}</b>
                  <span>{L.noWaiting[1]}</span>
                </div>
              ) : null}
            </div>
            <p className={c("cf-qf")}>{L.order}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

type Shown = {
  ctx: FloorCtx;
  row: FloorRow;
  p: FloorPerson;
  reason: (p: FloorPerson) => string;
  rCls: (p: FloorPerson) => string;
};

function Allergy({ p }: { p: FloorPerson }) {
  const cls = p.allergy == null ? "unk" : p.allergy ? "yes" : "none";
  return (
    <div className={c("cf-al", cls)} role="note">
      <b>{L.allergies}</b>
      <span>{p.allergy == null ? L.allergy.unrecorded : p.allergy || L.allergy.none}</span>
    </div>
  );
}

function Vitals({ p }: { p: FloorPerson }) {
  if (!p.triage) return null;
  return (
    <div className={c("cf-vs")}>
      {vitalChips(p.triage.input).map((v) => (
        <div key={v.key} className={c("cf-vc", v.cls)}>
          <span>{v.k}</span>
          <b>{v.v}</b>
          <em>{v.tag}</em>
        </div>
      ))}
    </div>
  );
}

function WithYou({ ctx, row, p, reason, rCls }: Shown) {
  const t = p.triage;
  return (
    <div className={c("cf-nc")}>
      <div className={c("cf-nb")}>
        <b>{L.withYou}</b>
        <span className={c("pri", levelCls(row.level))}>{levelTxt(row.level)}</span>
        <span className={c("tm")}>{mins(ctx.now - row.since)}</span>
      </div>
      <div className={c("cf-nm")}>
        <Av name={p.name} xl />
        <div>
          <h2>{p.name}</h2>
          <p>
            {whoOf(p)} · <span className={c("mono")}>{p.code}</span> · {p.pno}
          </p>
          {p.needs.length ? (
            <span className={c("cf-tags")}>
              {p.needs.map((x) => (
                <span key={x} className={c("cf-flag", "need")}>
                  {x}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      </div>
      <div className={c("cf-sec")}>
        <Allergy p={p} />
        <div className={c("cf-bgl")}>
          <span>
            <b>{L.history}</b> {p.history.join(", ") || L.nothing}
          </span>
          <span>
            <b>{L.medicines}</b> {p.meds.join(", ") || L.noneRecorded}
          </span>
        </div>
      </div>
      <div className={c("cf-sec")}>
        <span className={c("cap")}>{L.whyCame}</span>
        <p className={rCls(p)} style={{ fontSize: 16, lineHeight: "22px" }}>
          {reason(p)}
        </p>
      </div>
      <div className={c("cf-sec")}>
        <span className={c("cap")}>
          {fill(L.atTriage, { v: t ? `${hm(t.at)} · ${t.by}` : L.notTriaged })}
        </span>
        {t ? (
          <>
            <div className={c("cf-lvl")}>
              <span className={c("pri", levelCls(t.level))}>{levelTxt(t.level)}</span>
            </div>
            <Vitals p={p} />
          </>
        ) : (
          <p className={c("note")}>{L.noVitals}</p>
        )}
        {t?.note ? (
          <p className={c("cf-note")}>
            &ldquo;{t.note}&rdquo; <span className={c("cf-mt")}>· {t.by}</span>
          </p>
        ) : null}
      </div>
      <Trends p={p} />
      <div className={c("cf-sec")}>
        <span className={c("cap")}>{L.before}</span>
        <div className={c("cf-hist")}>
          {p.hist.length ? (
            p.hist.map((h) => (
              <div key={h.date + h.text} className={c("cf-hr")}>
                <b>{h.date}</b>
                <span>{h.text}</span>
              </div>
            ))
          ) : (
            <div className={c("cf-hr")}>
              <b>{L.firstVisit}</b>
              <span>{L.noEarlier}</span>
            </div>
          )}
        </div>
      </div>
      <div className={c("cf-na")}>
        <button
          type="button"
          className={c("btn")}
          onClick={() => {
            ctx.record("sent_for_tests", p.id, { departmentId: p.clinic });
            ctx.say(fill(L.toasts.tests, { name: p.name }));
          }}
        >
          {L.sendTests}
        </button>
        <button type="button" className={c("btn", "q")} onClick={() => ctx.say(L.toasts.record)}>
          {L.record}
        </button>
        <span className={c("grow")} />
        <button type="button" className={c("btn", "k")} onClick={() => ctx.setModal("finish")}>
          {L.finish}
        </button>
      </div>
    </div>
  );
}

function Calling({ ctx, row, p, reason, rCls }: Shown) {
  const ago =
    ctx.now - row.since < 60_000
      ? L.justNow
      : fill(L.ago, { n: Math.floor((ctx.now - row.since) / 60_000) });
  const t = p.triage;
  return (
    <>
      <div className={c("cf-call")} aria-live="assertive">
        <span className={c("cf-ring")}>
          <Av name={p.name} />
        </span>
        <p>{fill(L.callingTo, { room: row.room ?? ctx.clinic.room })}</p>
        <h2>{p.name}</h2>
        <span className={c("mono")}>{`${p.code.slice(0, 3)} ${p.code.slice(3)}`}</span>
        {p.needs.length ? (
          <div className={c("cf-cneed")}>
            {p.needs.map((x) => (
              <span key={x}>{x}</span>
            ))}
            <small>{L.deskTold}</small>
          </div>
        ) : null}
        <p>
          {fill(L.called, {
            ago,
            times: row.calls > 1 ? fill(L.calledTimes, { n: row.calls }) : "",
          })}
        </p>
        <div className={c("acts")}>
          <button
            type="button"
            className={c("btn", "k")}
            onClick={() => {
              ctx.record("here", p.id, {
                room: row.room,
                departmentId: p.clinic,
                doctorUserId: ctx.user.id,
              });
              ctx.say(fill(L.toasts.here, { name: p.name }));
            }}
          >
            {L.here[p.sex ?? "X"]}
          </button>
          <button
            type="button"
            className={c("btn")}
            onClick={() => {
              ctx.record("call_again", p.id, { room: row.room, departmentId: p.clinic });
              ctx.say(L.toasts.again);
            }}
          >
            {L.again}
          </button>
          <button
            type="button"
            className={c("btn")}
            onClick={() => {
              ctx.record("didnt_come", p.id, { departmentId: p.clinic });
              ctx.say(
                fill(row.didntCome >= 1 ? L.toasts.didnt2 : L.toasts.didnt1, { name: p.name }),
              );
            }}
          >
            {L.didnt}
          </button>
        </div>
      </div>
      <div className={c("cf-brief")}>
        <div className={c("cf-brh")}>
          <span className={c("cap")}>{fill(L.whileWalks, { first: first(p.name) })}</span>
          <span className={c("cf-mt")}>{fill(L.waited, { n: mins(ctx.now - p.arrivedAt) })}</span>
        </div>
        <Allergy p={p} />
        <div className={c("cf-bg")}>
          <div className={c("cf-bi", "wide")}>
            <span className={c("cap")}>{L.complaint}</span>
            <p className={rCls(p)}>{reason(p)}</p>
            {t?.note ? (
              <p className={c("cf-note")}>
                &ldquo;{t.note}&rdquo;{" "}
                <span className={c("cf-mt")}>
                  · {t.by} · {hm(t.at)}
                </span>
              </p>
            ) : null}
          </div>
          <div className={c("cf-bi", "wide")}>
            <span className={c("cap")}>{L.triage}</span>
            <div className={c("cf-lvl")}>
              <span className={c("pri", levelCls(row.level))}>{levelTxt(row.level)}</span>
              {t ? null : <span className={c("cf-lb")}>{L.notTriaged}</span>}
            </div>
            <Vitals p={p} />
          </div>
          <div className={c("cf-bi")}>
            <span className={c("cap")}>{L.pmh}</span>
            <ul>
              {(p.history.length ? p.history : [L.nothing]).map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
          <div className={c("cf-bi")}>
            <span className={c("cap")}>{L.meds}</span>
            <ul>
              {(p.meds.length ? p.meds : [L.noneRecorded]).map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
          <div className={c("cf-bi", "wide")}>
            <span className={c("cap")}>{L.lastVisit}</span>
            <p>{p.hist[0] ? `${p.hist[0].date} · ${p.hist[0].text}` : L.firstVisit}</p>
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── finish visit ─── */
const F = FLOOR.finish;
type When = keyof typeof F.when;
const WHEN_DAYS: Partial<Record<When, number>> = { "2w": 14, "1m": 30, "3m": 91 };

/** Clinic days near a target (the clinic's own weekdays), as epoch ms at noon Kampala. */
function clinicDays(days: number[], from: number, target: number | null, n = 5): number[] {
  const out: number[] = [];
  const start = target == null ? from + 86_400_000 : target - 3 * 86_400_000;
  for (
    let t = Math.max(start, from + 86_400_000);
    out.length < n && t < from + 400 * 86_400_000;
    t += 86_400_000
  ) {
    const dow = new Date(t + 3 * 3_600_000).getUTCDay();
    if (days.includes(dow)) out.push(t);
  }
  return out;
}

export function FinishDialog({ ctx, row }: { ctx: FloorCtx; row: FloorRow }) {
  const p = ctx.byId.get(row.intakeId)!;
  const cl = ctx.clinicOf(p.clinic);
  const [out, setOut] = useState<Outcome | null>(null);
  const [when, setWhen] = useState<When>("none");
  const [day, setDay] = useState<number | null>(null);
  const [who, setWho] = useState<"me" | "any">("me");
  const [why, setWhy] = useState<string>(F.whys[0]);
  const [sms, setSms] = useState(true);
  const [busy, setBusy] = useState(false);
  const fu = when !== "none";
  const days = fu
    ? clinicDays(cl.days, ctx.now, WHEN_DAYS[when] ? ctx.now + WHEN_DAYS[when]! * 86_400_000 : null)
    : [];
  const off = busy || !out || (fu && day == null);
  const close = () => ctx.setModal(null);

  const save = async () => {
    if (off) return;
    setBusy(true);
    let code = "";
    if (fu && day != null) {
      const r = await ctx.port.followUp({
        intakeId: p.id,
        clinicId: cl.id,
        day,
        doctorUserId: who === "me" ? ctx.user.id : null,
        reason: why,
        texts: sms,
      });
      if (r.ok) code = r.code;
    }
    if (out === "tests_back") ctx.record("sent_for_tests", p.id, { departmentId: p.clinic });
    else ctx.record("finish", p.id, { detail: out, departmentId: p.clinic });
    setBusy(false);
    close();
    ctx.say(
      code
        ? fill(F.booked, { code })
        : fu
          ? F.deskBooks
          : fill(L.toasts.finished, { name: p.name }),
    );
  };

  const chip = (
    on: boolean,
    label: string,
    onClick: () => void,
    extra?: string,
    small?: string,
  ) => (
    <button
      key={label}
      type="button"
      className={c("chip", extra, on && "on")}
      aria-pressed={on}
      onClick={onClick}
    >
      {label}
      {small ? <small className={c("cf-mt")}>{small}</small> : null}
    </button>
  );

  return (
    <DeskDialog
      open
      onClose={close}
      label={L.finish}
      size="xw"
      tile="tick"
      title={fill(F.title, { first: first(p.name) })}
      lead={`${whoOf(p)} · ${p.code}`}
    >
      <div className={c("bk2")}>
        <div className={c("bkf")}>
          <section className={c("bks")}>
            <h3>
              <i>1</i>
              {F.s1}
            </h3>
            <div className={c("cf-ofs")}>
              {(Object.keys(F.outs) as Outcome[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={c("cf-of", out === k && "on")}
                  aria-pressed={out === k}
                  onClick={() => setOut(k)}
                >
                  <b>{F.outs[k][0]}</b>
                  <span>{F.outs[k][1]}</span>
                </button>
              ))}
            </div>
          </section>
          <section className={c("bks")}>
            <h3>
              <i>2</i>
              {F.s2}
            </h3>
            <div className={c("chips")}>
              {(Object.keys(F.when) as When[]).map((k) =>
                chip(when === k, F.when[k], () => {
                  setWhen(k);
                  setDay(null);
                }),
              )}
            </div>
            {fu ? (
              <>
                <p className={c("sublbl")}>{F.days}</p>
                <div className={c("chips", "hs")}>
                  {days.map((t) => chip(day === t, dayLabel(t), () => setDay(t)))}
                </div>
                <p className={c("sublbl")}>{F.withLbl}</p>
                <div className={c("chips")}>
                  {chip(
                    who === "me",
                    fill(F.whoMe, { name: ctx.user.name }),
                    () => setWho("me"),
                    "sm2",
                  )}
                  {chip(who === "any", F.whoAny, () => setWho("any"), "sm2")}
                </div>
                <p className={c("sublbl")}>{F.whyLbl}</p>
                <div className={c("chips")}>
                  {F.whys.map((w) => chip(why === w, w, () => setWhy(w), "sm2"))}
                </div>
              </>
            ) : null}
          </section>
          <section className={c("bks")}>
            <h3>
              <i>3</i>
              {F.s3}
            </h3>
            <button
              type="button"
              className={c("ck", "togg", sms && "on")}
              role="switch"
              aria-checked={sms}
              onClick={() => setSms(!sms)}
              style={{ justifyContent: "space-between" }}
            >
              {fu ? F.smsFu : F.smsThanks}
              <span className={c("tb")} />
            </button>
            <p className={c("note")}>{fu ? F.smsFuNote : F.smsNote}</p>
          </section>
        </div>
        {/* The shared Ticket needs about 340 px; the canvas's own ticket was narrower. */}
        <aside className={c("bksum")} style={{ flexBasis: 372 }}>
          <p className={c("cap")}>{fu ? F.sideFu : F.side}</p>
          {fu ? (
            <Ticket
              mode="real"
              name={`${F.ticketTitle}: ${p.name}`}
              status="ok"
              statusWord={F.ticketTitle}
              date={day != null ? dayLabel(day) : F.chooseDay}
              time={cl.hours.split("–")[0] ?? ""}
              note={why}
              fields={[{ label: TICKET.clinic, value: cl.name }]}
              doctor={{ label: F.withLbl, value: who === "me" ? ctx.user.name : F.whoAny }}
              visit={{
                patient: p.name,
                initials: initials(p.name),
                sexAge: whoOf(p),
                clinic: cl.name,
                code: "······",
                fee: "",
                doctorInitials: [],
                bring: [],
              }}
              flipped={false}
              onTurn={() => {}}
            />
          ) : (
            <div className={c("cf-nofu")}>
              <b>{F.noFu[0]}</b>
              <span>{F.noFu[1]}</span>
            </div>
          )}
          <div className={c("cf-nofu")}>
            <span className={c("cap")}>{F.after}</span>
            <b>{out ? F.outs[out][0] : F.choose}</b>
            <span>{out ? (out === "tests_back" ? F.stays : F.ends) : F.chooseSub}</span>
          </div>
          <div className={c("acts")}>
            <button type="button" className={c("btn")} onClick={close}>
              {F.cancel}
            </button>
            <button
              type="button"
              className={c("btn", "k")}
              style={{ flex: 1 }}
              onClick={save}
              disabled={off}
            >
              {out === "tests_back" ? F.saveTests : F.save}
            </button>
          </div>
        </aside>
      </div>
    </DeskDialog>
  );
}

/* ─── running late, end session, the screen preview ─── */
export function LineDialogs({ ctx, modal }: { ctx: FloorCtx; modal: Modal }) {
  const close = () => ctx.setModal(null);
  const { clinic } = ctx;
  return (
    <>
      {modal === "late" ? <LateDialog ctx={ctx} close={close} /> : null}
      {modal === "end" ? <EndDialog ctx={ctx} close={close} /> : null}
      {/* The canvas shows the screen itself on the scrim, with no card around it. */}
      <EditorDialog
        open={modal === "screen"}
        onOpenChange={(o) => !o && close()}
        width="xl"
        className="w-auto max-w-none overflow-visible rounded-none bg-transparent p-0 shadow-none ring-0 sm:max-h-none sm:max-w-none"
      >
        <div className={c("tokens")} aria-label={FLOOR.screen.title}>
          <ScreenBoard
            head={fill(FLOOR.screen.head, { hospital: ctx.data.hospitalName, clinic: clinic.name })}
            clock={hm(ctx.now)}
            feed={screenFeed(
              ctx.rows.filter((r) => r.departmentId === clinic.id),
              ctx.doctors,
            )}
            late={!!lateOf(ctx, ctx.user.id)}
          />
        </div>
      </EditorDialog>
    </>
  );
}

function LateDialog({ ctx, close }: { ctx: FloorCtx; close: () => void }) {
  const [sel, setSel] = useState<string>(lateOf(ctx, ctx.user.id) || FLOOR.late.opts[0]);
  const send = (note: string | null) => {
    ctx.record("running_late", null, { note, departmentId: ctx.clinic.id });
    ctx.say(note ? FLOOR.line.toasts.late : FLOOR.line.toasts.onTime);
    close();
  };
  return (
    <DeskDialog
      open
      onClose={close}
      label={FLOOR.late.title}
      tile="clock"
      title={FLOOR.late.title}
      lead={`${ctx.clinic.name} · ${ctx.clinic.room}`}
    >
      <div className={c("chips")}>
        {FLOOR.late.opts.map((o) => (
          <button
            key={o}
            type="button"
            className={c("chip", sel === o && "on")}
            aria-pressed={sel === o}
            onClick={() => setSel(o)}
          >
            {o}
          </button>
        ))}
      </div>
      <p className={c("note")}>{FLOOR.late.note}</p>
      <div className={c("mf")}>
        <span className={c("grow")} />
        <button type="button" className={c("btn")} onClick={() => send(null)}>
          {FLOOR.late.onTime}
        </button>
        <button type="button" className={c("btn", "k")} onClick={() => send(sel)}>
          {FLOOR.late.tell}
        </button>
      </div>
    </DeskDialog>
  );
}

function EndDialog({ ctx, close }: { ctx: FloorCtx; close: () => void }) {
  const E = FLOOR.end;
  const waiting = ctx.rows.filter(
    (r) =>
      (r.step === "line" || r.step === "called") &&
      r.departmentId === ctx.clinic.id &&
      (r.doctorUserId == null || r.doctorUserId === ctx.user.id),
  );
  const [pick, setPick] = useState<Record<string, keyof typeof E.opts>>({});
  const [sms, setSms] = useState(true);
  const [note, setNote] = useState("");
  const seenN = ctx.rows.filter(
    (r) => r.step === "done" && r.departmentId === ctx.clinic.id,
  ).length;
  const save = () => {
    for (const r of waiting) {
      const o = pick[r.intakeId] ?? "next_day";
      if (o === "other_doctor")
        ctx.record("moved", r.intakeId, {
          detail: o,
          doctorUserId: null,
          departmentId: r.departmentId,
        });
      else ctx.record("finish", r.intakeId, { detail: o, departmentId: r.departmentId });
    }
    ctx.record("end_session", null, { note: note || null, departmentId: ctx.clinic.id });
    ctx.say(fill(FLOOR.line.toasts.ended, { n: waiting.length }));
    close();
  };
  return (
    <DeskDialog
      open
      onClose={close}
      label={E.title}
      size="cbm"
      tile="clock"
      title={E.title}
      lead={fill(E.sub, { clinic: ctx.clinic.name, room: ctx.clinic.room, n: seenN })}
    >
      {waiting.length ? (
        <>
          <p style={{ fontSize: 15 }}>{fill(E.still, { n: waiting.length })}</p>
          <div className={c("cf-es")}>
            {waiting.map((r) => {
              const p = ctx.byId.get(r.intakeId)!;
              const cur = pick[r.intakeId] ?? "next_day";
              return (
                <div key={r.intakeId} className={c("cf-er")}>
                  <div>
                    <b>{p.name}</b>
                    <span>{levelTxt(r.level)}</span>
                  </div>
                  <div className={c("chips")}>
                    {(Object.keys(E.opts) as (keyof typeof E.opts)[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        className={c("chip", "sm2", cur === k && "on")}
                        aria-pressed={cur === k}
                        onClick={() => setPick((x) => ({ ...x, [r.intakeId]: k }))}
                      >
                        {E.opts[k]}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className={c("ck", "togg", sms && "on")}
            role="switch"
            aria-checked={sms}
            onClick={() => setSms(!sms)}
            style={{ justifyContent: "space-between" }}
          >
            {E.sms}
            <span className={c("tb")} />
          </button>
        </>
      ) : (
        <p className={c("note")}>{E.none}</p>
      )}
      <input
        className={c("fin")}
        type="text"
        placeholder={E.handover}
        value={note}
        maxLength={280}
        onChange={(e) => setNote(e.target.value)}
        aria-label={E.handover}
      />
      <div className={c("mf")}>
        <span className={c("note")}>{E.deskSees}</span>
        <span className={c("grow")} />
        <button type="button" className={c("btn")} onClick={close}>
          {E.notYet}
        </button>
        <button type="button" className={c("btn", "k")} onClick={save}>
          {E.save}
        </button>
      </div>
    </DeskDialog>
  );
}
