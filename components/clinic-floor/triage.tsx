"use client";

/**
 * Triage (ADR 0492): the worklist and the four-step panel. The panel is a pure consumer of the triage engine:
 * the level, the reasons, the vital tones and the re-check band all come from `runTriage` / `interpretVitals` /
 * `recommend`; the save goes through the engine's own action (`submitTriageAction`, via the port), which
 * re-computes, checks override authority and audits. No vital-sign threshold lives in this file (S10).
 */
import type { FloorCtx } from "./floor";
import type { FloorPerson } from "@/lib/clinic-floor/fixture";
import type { FloorRow } from "@/lib/clinic-floor/model";
import { useState } from "react";

import { c } from "@/components/reception/ui";
import { FLOOR } from "@/content/clinic-floor/floor";
import { fill } from "@/content/lab-workspace-v2";
import { floorMetrics, recheckDueAt, triageOrder } from "@/lib/clinic-floor/model";
import { initials } from "@/lib/reception/desk/model";
import { deskFlag, hm, levelCls, levelTxt, mins, whoOf } from "./shared";
import { TriageDialog } from "./triage-dialog";

const T = FLOOR.triage;

export function TriageView({ ctx }: { ctx: FloorCtx }) {
  const { rows, byId, now, priv } = ctx;
  const [tab, setTab] = useState<"wait" | "re" | "done">("wait");
  const reason = (p: FloorPerson) =>
    priv ? FLOOR.hiddenReason : p.own ? `"${p.reason}"` : p.reason;
  const rCls = (p: FloorPerson) => c(priv ? "hid" : p.own && "own");

  const waitList = triageOrder(rows);
  const reList = rows
    .filter((r) => recheckDueAt(r) != null)
    .sort((a, b) => recheckDueAt(a)! - recheckDueAt(b)!);
  const doneList = ctx.people.filter((p) => p.triage).sort((a, b) => b.triage!.at - a.triage!.at);
  const m = floorMetrics(rows, [], now);
  const longW = Math.max(1, ...waitList.map((r) => now - r.arrivedAt));
  const dueTxt = (r: FloorRow) => {
    const d = recheckDueAt(r)! - now;
    return d <= 0
      ? d > -60_000
        ? T.dueNow
        : fill(T.overdue, { n: mins(-d) })
      : fill(T.dueIn, { n: mins(d) });
  };

  const open = (id: string, re: boolean) => ctx.setSel({ id, re });
  // The canvas: the cards show on the Waiting tab with no panel open; the re-check card only when one is due.
  const cards = tab === "wait" && !ctx.sel;
  const next = cards && waitList[0] ? byId.get(waitList[0].intakeId) : undefined;
  const reDue = reList.filter((r) => recheckDueAt(r)! <= now);
  const reNext = cards ? reDue[0] : undefined;

  type Item = { r: FloorRow | null; p: FloorPerson; kind: "wait" | "re" | "done" };
  const groups: { label: string; sub: string; items: Item[] }[] = [];
  if (tab === "wait") {
    const it = (r: FloorRow): Item => ({ r, p: byId.get(r.intakeId)!, kind: "wait" });
    const flagged = waitList.filter((r) => r.deskFlag).map(it);
    const rest = waitList.filter((r) => !r.deskFlag).map(it);
    if (flagged.length)
      groups.push({ label: T.groups.first, sub: T.groups.firstSub, items: flagged });
    if (rest.length) groups.push({ label: T.groups.arrival, sub: "", items: rest });
  } else if (tab === "re") {
    if (reList.length)
      groups.push({
        label: T.groups.recheck,
        sub: "",
        items: reList.map((r) => ({ r, p: byId.get(r.intakeId)!, kind: "re" })),
      });
  } else if (doneList.length) {
    groups.push({
      label: T.groups.done,
      sub: "",
      items: doneList.map((p) => ({ r: ctx.rowOf.get(p.id) ?? null, p, kind: "done" })),
    });
  }
  const counts = { wait: waitList.length, re: reList.length, done: doneList.length };
  const sel = ctx.sel ? byId.get(ctx.sel.id) : undefined;

  return (
    <div className={c("cf-wrap")}>
      <div className={c("cf-l")}>
        <div className={c("ahead")}>
          <div className={c("ahl")}>
            <h1>{T.title}</h1>
            <span className={c("adate")}>{hm(now)}</span>
          </div>
          <div className={c("cf-stats")}>
            <span className={c("cf-stat")}>
              <b>{waitList.length}</b> {T.waiting}
            </span>
            {waitList.length ? (
              <span className={c("cf-stat")}>
                {T.longest} <b>{mins(longW)}</b>
              </span>
            ) : null}
            {m.clearTriageIn != null && m.medianTriage != null && waitList.length ? (
              <span
                className={c("cf-stat")}
                title={fill(T.clearTitle, { n: mins(m.medianTriage) })}
              >
                {T.clearBy} <b>{hm(now + m.clearTriageIn)}</b>
              </span>
            ) : null}
            <span className={c("cf-stat")}>
              <b>{doneList.length}</b> {T.doneToday}
            </span>
          </div>
          <span className={c("grow")} />
          <PrivBtn ctx={ctx} />
        </div>

        {next || reNext ? (
          <div className={c("cf-nx")}>
            {next ? (
              <div className={c("cf-nxc")}>
                <span className={c("cf-nxk", deskFlag(next.reason) && "flag")}>
                  {fill(T.nextUp, {
                    why: deskFlag(next.reason)
                      ? fill(T.nextWhyFlag, { flag: deskFlag(next.reason)!.toLowerCase() })
                      : T.nextWhyLongest,
                  })}
                </span>
                <div className={c("cf-nxm")}>
                  <Av name={next.name} />
                  <div className={c("cf-nxw")}>
                    <b>{next.name}</b>
                    <span>
                      {whoOf(next)}
                      {next.needs.map((x) => (
                        <em key={x} className={c("cf-tag")}>
                          {x}
                        </em>
                      ))}
                    </span>
                  </div>
                  <div className={c("cf-nxr")}>
                    <span className={rCls(next)}>{reason(next)}</span>
                    <small>
                      <i style={{ background: ctx.clinicOf(next.clinic).hue }} />
                      {ctx.clinicOf(next.clinic).name} · {ctx.docName(next.doctorId)}
                    </small>
                  </div>
                  <div className={c("cf-nxt")}>
                    <b>{mins(now - next.arrivedAt)}</b>
                    <small>{fill(T.since, { t: hm(next.arrivedAt) })}</small>
                  </div>
                  <button
                    type="button"
                    className={c("btn", "k")}
                    onClick={() => open(next.id, false)}
                  >
                    {T.start}
                  </button>
                </div>
              </div>
            ) : null}
            {reNext ? (
              <button
                type="button"
                className={c("cf-nxre")}
                onClick={() => open(reNext.intakeId, true)}
              >
                <span className={c("cf-nxk", "due")}>
                  {fill(T.recheckDue, { due: dueTxt(reNext) })}
                </span>
                <b>{byId.get(reNext.intakeId)!.name}</b>
                <small>
                  {levelTxt(reNext.level)}{" "}
                  {reDue.length > 1 ? (
                    <em>{fill(T.recheckMore, { n: reDue.length - 1 })}</em>
                  ) : null}
                </small>
                <span className={c("btn", "sm")}>{T.recheck}</span>
              </button>
            ) : null}
          </div>
        ) : null}

        <div className={c("cf-card")}>
          <div className={c("ttabs")} role="tablist" aria-label={T.tabsLabel}>
            {(["wait", "re", "done"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                className={c(tab === k && "on")}
                aria-selected={tab === k}
                onClick={() => setTab(k)}
              >
                {T.tabs[k]}
                <b>{counts[k]}</b>
              </button>
            ))}
          </div>
          <div className={c("cf-list")} role="list">
            {groups.map((g) => (
              <div key={g.label} role="presentation">
                <div className={c("cf-grp")}>
                  {g.label}
                  <em>{g.sub}</em>
                </div>
                {g.items.map(({ r, p, kind }) => {
                  const on = ctx.sel?.id === p.id;
                  const w = now - p.arrivedAt;
                  const due = kind === "re" && r ? recheckDueAt(r)! <= now : false;
                  const fl = deskFlag(p.reason);
                  return (
                    <div key={p.id} className={c("cf-row", on && "sel")} role="listitem">
                      <div className={c("cf-who")}>
                        <Av name={p.name} />
                        <div>
                          <button
                            type="button"
                            className={c("nm")}
                            onClick={() => open(p.id, kind === "re")}
                          >
                            {p.name}
                          </button>
                          <span className={c("cf-mt")}>
                            {whoOf(p)} · <span className={c("mono")}>{p.code}</span>
                          </span>
                          {p.needs.length ? (
                            <span className={c("cf-tags")}>
                              {p.needs.map((x) => (
                                <span key={x} className={c("cf-tag")}>
                                  {x}
                                </span>
                              ))}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className={c("cf-why")}>
                        <span className={rCls(p)}>{reason(p)}</span>
                        <span className={c("cf-mt")}>
                          {fl && kind === "wait" ? (
                            <em className={c("cf-dflag")}>{fill(T.desk, { flag: fl })}</em>
                          ) : null}
                          {p.own && !priv ? T.theirWords : ""}
                        </span>
                      </div>
                      <div
                        className={c(
                          "cf-wait",
                          (due || (kind === "wait" && w > 25 * 60_000)) && "long",
                        )}
                      >
                        <b>
                          {kind === "re" && r
                            ? dueTxt(r)
                            : kind === "wait"
                              ? mins(w)
                              : hm(p.triage!.at)}
                        </b>
                        {kind === "wait" ? (
                          <span className={c("cf-wbar")}>
                            <i
                              style={{ width: `${Math.max(6, Math.round((100 * w) / longW))}%` }}
                            />
                          </span>
                        ) : null}
                        <span className={c("cf-mt")}>
                          {kind === "re"
                            ? fill(T.lastAt, { t: hm(p.triage!.at) })
                            : kind === "wait"
                              ? fill(T.since, { t: hm(p.arrivedAt) })
                              : fill(T.triagedBy, { who: p.triage!.by })}
                        </span>
                      </div>
                      <div className={c("cf-cl")}>
                        <span className={c("kl")}>
                          <i style={{ background: ctx.clinicOf(p.clinic).hue }} />
                          {ctx.clinicOf(p.clinic).short}
                        </span>
                        <span className={c("cf-mt")}>{ctx.docName(p.doctorId)}</span>
                      </div>
                      <div className={c("cf-act")}>
                        {p.triage ? (
                          <span className={c("pri", levelCls(p.triage.level))}>
                            {levelTxt(p.triage.level)}
                          </span>
                        ) : null}
                        {kind !== "done" ? (
                          <button
                            type="button"
                            className={c("btn", "sm", due && !on && "k")}
                            onClick={() => open(p.id, kind === "re")}
                          >
                            {kind === "re" ? T.recheck : T.triageBtn}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            {!groups.length ? (
              <div className={c("empty")} style={{ margin: 16 }}>
                <b>{T.empty[tab][0]}</b>
                <span>{T.empty[tab][1]}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {sel ? (
        <TriageDialog key={`${sel.id}${ctx.sel!.re}`} ctx={ctx} p={sel} re={ctx.sel!.re} />
      ) : null}
    </div>
  );
}

export function Av({ name, xl }: { name: string; xl?: boolean }) {
  return (
    <span className={c("pav", xl && "xl")} aria-hidden="true">
      <b>{initials(name)}</b>
    </span>
  );
}

export function PrivBtn({ ctx }: { ctx: FloorCtx }) {
  return (
    <button
      type="button"
      className={c("btn", "sm", "q", ctx.priv && "privon")}
      aria-pressed={ctx.priv}
      onClick={ctx.togglePriv}
      title={FLOOR.privacy.title}
    >
      {ctx.priv ? FLOOR.privacy.on : FLOOR.privacy.off}
    </button>
  );
}
