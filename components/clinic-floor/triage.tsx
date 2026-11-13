"use client";

/**
 * Triage (ADR 0492): the worklist and the four-step panel. The panel is a pure consumer of the triage engine:
 * the level, the reasons, the vital tones and the re-check band all come from `runTriage` / `interpretVitals` /
 * `recommend`; the save goes through the engine's own action (`submitTriageAction`, via the port), which
 * re-computes, checks override authority and audits. No vital-sign threshold lives in this file (S10).
 */
import type { FloorCtx } from "./floor";
import type { Draft, Field } from "./shared";
import type { FloorPerson } from "@/lib/clinic-floor/fixture";
import type { FloorRow } from "@/lib/clinic-floor/model";
import type { AcuityLevel, Acvpu } from "@/lib/triage/types";
import { useMemo, useState } from "react";

import { c } from "@/components/reception/ui";
import { FLOOR, FLOOR_ERRORS } from "@/content/clinic-floor/floor";
import { fill } from "@/content/lab-workspace-v2";
import { floorMetrics, recheckDueAt, triageOrder } from "@/lib/clinic-floor/model";
import { initials } from "@/lib/reception/desk/model";
import { runTriage } from "@/lib/triage/engine";
import { interpretVitals } from "@/lib/triage/interpret";
import { recommend } from "@/lib/triage/recommend";
import {
  deskFlag,
  draftInput,
  first,
  hm,
  levelCls,
  levelTxt,
  mins,
  NEEDED,
  num,
  THREAT_LABEL,
  THREATS,
  toneCls,
  whoOf,
} from "./shared";

const P = FLOOR.panel;
const T = FLOOR.triage;

function freshDraft(p: FloorPerson, re: boolean): Draft {
  return {
    threats: [],
    none: false,
    v: {},
    avpu: "A",
    o2: false,
    sugar: re && p.triage?.input.vitals.bloodGlucose != null,
    pick: null,
    why: "",
    clinic: p.clinic,
    doc: p.doctorId,
    note: "",
  };
}

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
        <Panel
          key={`${sel.id}${ctx.sel!.re}`}
          ctx={ctx}
          p={sel}
          re={ctx.sel!.re}
          reason={reason(sel)}
          rCls={rCls(sel)}
        />
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

function Panel({
  ctx,
  p,
  re,
  reason,
  rCls,
}: {
  ctx: FloorCtx;
  p: FloorPerson;
  re: boolean;
  reason: string;
  rCls: string;
}) {
  const [d, setD] = useState<Draft>(() => freshDraft(p, re));
  const [busy, setBusy] = useState(false);
  const set = (x: Partial<Draft>) => setD((o) => ({ ...o, ...x }));
  const setV = (k: Field, v: string) => set({ v: { ...d.v, [k]: v } });

  const input = useMemo(() => draftInput(p, d), [p, d]);
  const missing = NEEDED.filter(([, fs]) => fs.some((f) => num(d.v[f]) == null)).map(
    ([k]) => P.missing[k],
  );
  const threat = d.threats.length > 0;
  const ready = threat || missing.length === 0;
  const result = useMemo(() => (ready ? runTriage(input) : null), [ready, input]);
  const iv = useMemo(
    () => interpretVitals(input.vitals, result ?? runTriage(input)),
    [input, result],
  );
  const recs = result ? recommend(result, d.pick ?? undefined) : [];
  const engine = result?.level ?? null;
  const level = (d.pick ?? engine) as AcuityLevel | null;
  const changed = d.pick != null && d.pick !== engine;
  const needWhy = changed && !d.why;
  const isL1 = engine === 1 || level === 1;
  const clinic = ctx.clinicOf(d.clinic);
  const still = [
    ...(!threat && !d.none ? [P.missingThreat] : []),
    ...(threat ? [] : missing),
    ...(needWhy ? [P.missingWhy] : []),
  ];
  const off = busy || !result || isL1 || still.length > 0;

  const tag = (k: keyof typeof iv, present: boolean) =>
    present && iv[k].tone !== "normal" && iv[k].tone !== "missing" ? iv[k].label : "";
  const vitals: {
    label: string;
    unit: string;
    f: Field;
    f2?: Field;
    key: keyof typeof iv;
    ph?: [string, string];
  }[] = [
    {
      label: P.vitals.bp[0],
      unit: P.vitals.bp[3],
      f: "sys",
      f2: "dia",
      key: "systolicBp",
      ph: [P.vitals.bp[1], P.vitals.bp[2]],
    },
    { label: P.vitals.pulse[0], unit: P.vitals.pulse[1], f: "pulse", key: "pulse" },
    { label: P.vitals.rr[0], unit: P.vitals.rr[1], f: "rr", key: "respiratoryRate" },
    { label: P.vitals.spo2[0], unit: P.vitals.spo2[1], f: "spo2", key: "spo2" },
    { label: P.vitals.temp[0], unit: P.vitals.temp[1], f: "temp", key: "temperature" },
    ...(d.sugar
      ? [
          {
            label: P.vitals.sugar[0],
            unit: P.vitals.sugar[1],
            f: "sugar" as Field,
            key: "bloodGlucose" as const,
          },
        ]
      : []),
  ];

  const send = async () => {
    if (off || !result || !level) return;
    setBusy(true);
    const payload = {
      intake_id: p.id,
      patient_user_id: p.patientUserId,
      age_years: p.age,
      pregnancy: input.context.pregnancy,
      reproductive_age_female: input.context.reproductiveAgeFemale,
      spo2_scale2_enabled: false,
      vitals: input.vitals,
      life_threat_flags: input.lifeThreatFlags,
      prior_level: p.triage?.level ?? null,
      assigned_level: level,
      override_reason: changed ? d.why : undefined,
    };
    const res = await ctx.port.triage(payload, {
      clientId: crypto.randomUUID(),
      intakeId: p.id,
      recheck: re,
      departmentId: d.clinic,
      doctorUserId: d.doc,
      note: d.note || null,
    });
    setBusy(false);
    if (!res.ok) return ctx.say(res.error ?? FLOOR_ERRORS.saveFailed);
    const band =
      res.recheck ??
      recommend(result, level).find((r) => r.code === "monitor_interval")?.recheck ??
      null;
    const before = p.triage?.level ?? null;
    ctx.setPeople((ps) =>
      ps.map((x) =>
        x.id !== p.id
          ? x
          : {
              ...x,
              clinic: d.clinic,
              doctorId: d.doc,
              triage: {
                input,
                level,
                at: ctx.now,
                by: first(ctx.user.name),
                note: d.note || (re ? (x.triage?.note ?? "") : ""),
                recheck: band,
                earlier: x.triage
                  ? [
                      ...(x.triage.earlier ?? []),
                      { input: x.triage.input, level: x.triage.level, at: x.triage.at },
                    ]
                  : [],
              },
            },
      ),
    );
    ctx.setSel(null);
    if (!re) ctx.say(fill(P.sent, { name: p.name, clinic: clinic.short, level: levelTxt(level) }));
    else if (before != null && level < before)
      ctx.say(fill(P.movedUp, { name: p.name, level: levelTxt(level) }));
    else if (before != null && level > before)
      ctx.say(fill(P.movedDown, { name: p.name, level: levelTxt(level) }));
    else ctx.say(fill(P.rechecked, { level: levelTxt(level) }));
  };

  const resus = ctx.user.role === "doctor" ? "/doctor/resus" : "/nurse/resus";
  const chip = (on: boolean, label: string, onClick: () => void, extra?: string) => (
    <button
      key={label}
      type="button"
      className={c("chip", extra, on && "on")}
      aria-pressed={on}
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    <aside className={c("det", "cf-det")} aria-label={T.title} aria-live="polite">
      <div className={c("dh")}>
        <Av name={p.name} xl />
        <div>
          <h2>{p.name}</h2>
          <p>
            {whoOf(p)} · <span className={c("mono")}>{p.code}</span>
          </p>
        </div>
        <button type="button" className={c("btn", "sm", "q", "x")} onClick={() => ctx.setSel(null)}>
          {P.close}
        </button>
      </div>
      {re && p.triage ? (
        <div className={c("stepbox", "cf-reb")}>
          <span className={c("cap")}>{P.recheckCap}</span>
          <p className={c("cf-mt")} style={{ whiteSpace: "normal" }}>
            {fill(P.last, { v: `${hm(p.triage.at)} · ${levelTxt(p.triage.level)}` })}
          </p>
          <p className={c("note")}>{P.recheckNote}</p>
        </div>
      ) : null}
      <div className={c("form")}>
        <div className={c("fr")}>
          <span>{P.bookedFor}</span>
          <b>
            <i className={c("dot")} style={{ background: ctx.clinicOf(p.clinic).hue }} />{" "}
            {ctx.clinicOf(p.clinic).name} · {ctx.docName(p.doctorId)}
          </b>
        </div>
        <div className={c("fr")}>
          <span>{P.why}</span>
          <span className={rCls}>{reason}</span>
        </div>
        <div className={c("fr")}>
          <span>{P.waiting}</span>
          <span>{fill(P.waitLine, { w: mins(ctx.now - p.arrivedAt), t: hm(p.arrivedAt) })}</span>
        </div>
        {p.needs.length ? (
          <div className={c("fr")}>
            <span>{P.needs}</span>
            <span className={c("cf-tags")}>
              {p.needs.map((x) => (
                <span key={x} className={c("cf-tag")}>
                  {x}
                </span>
              ))}
            </span>
          </div>
        ) : null}
      </div>

      <div className={c("stepbox", "wk-safe", d.none && "ok")}>
        <span className={c("cap")}>{P.s1}</span>
        <p className={c("ask")}>{P.s1Ask}</p>
        <div className={c("chips")}>
          {THREATS.map(([code, key]) =>
            chip(d.threats.includes(key), THREAT_LABEL.get(code) ?? code, () =>
              set({
                none: false,
                threats: d.threats.includes(key)
                  ? d.threats.filter((x) => x !== key)
                  : [...d.threats, key],
              }),
            ),
          )}
          {chip(d.none, P.none, () => set({ none: !d.none, threats: [] }), "wk-none")}
        </div>
        {threat ? (
          <div className={c("dangerbox")} role="alert">
            <b>{fill(P.l1Title, { level: levelTxt(1) })}</b> {P.l1Line}{" "}
            <a className={c("btn", "sm", "r")} href={resus}>
              {P.openResus}
            </a>
          </div>
        ) : null}
      </div>

      <div className={c("stepbox")}>
        <span className={c("cap")}>{P.s2}</span>
        <div className={c("cf-vg")}>
          {vitals.map((v) => {
            const has = num(d.v[v.f]) != null;
            const t = tag(v.key, has);
            return (
              <label key={v.f} className={c("cf-v", has && toneCls(iv[v.key].tone))}>
                <span className={c("cf-vh")}>
                  {v.label}
                  <span className={c("cf-vt")}>{t}</span>
                </span>
                <span className={c("cf-vi")}>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder={v.ph?.[0]}
                    value={d.v[v.f] ?? ""}
                    onChange={(e) => setV(v.f, e.target.value)}
                    aria-label={v.ph ? `${v.label}, ${v.ph[0]}` : v.label}
                  />
                  {v.f2 ? (
                    <>
                      <span className={c("sl")}>/</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder={v.ph?.[1]}
                        value={d.v[v.f2] ?? ""}
                        onChange={(e) => setV(v.f2!, e.target.value)}
                        aria-label={`${v.label}, ${v.ph?.[1]}`}
                      />
                    </>
                  ) : null}
                  <em>{v.unit}</em>
                </span>
              </label>
            );
          })}
        </div>
        <p className={c("sublbl")}>{P.consciousness}</p>
        <div className={c("chips")}>
          {(Object.keys(P.acvpu) as Acvpu[]).map((k) =>
            chip(d.avpu === k, P.acvpu[k], () => set({ avpu: k }), "sm2"),
          )}
          {chip(d.o2, P.oxygen, () => set({ o2: !d.o2 }), "sm2")}
        </div>
        {!d.sugar ? (
          <button
            type="button"
            className={c("btn", "sm", "q")}
            style={{ alignSelf: "flex-start" }}
            onClick={() => set({ sugar: true })}
          >
            {P.addSugar}
          </button>
        ) : null}
      </div>

      <div className={c("stepbox", "cf-res")}>
        <span className={c("cap")}>{P.s3}</span>
        {!result ? <p className={c("cf-miss")}>{P.waitEngine}</p> : null}
        {result ? (
          <>
            <div className={c("cf-lvl")}>
              <span className={c("pri", "big", levelCls(level))}>{levelTxt(level)}</span>
              <span className={c("cf-lb")}>{result.reasoning[0]}</span>
            </div>
            {result.news2 ? (
              <span className={c("cf-mt")}>{fill(P.scores, { n: result.news2.total })}</span>
            ) : null}
            {recs.length ? (
              <ul className={c("cf-recs")}>
                {recs.map((r) => (
                  <li key={r.code}>{r.suggestion}</li>
                ))}
              </ul>
            ) : null}
            {!isL1 ? (
              <>
                <p className={c("sublbl")}>{P.yourLevel}</p>
                <div className={c("cf-seg")} role="group" aria-label={P.levelGroup}>
                  {([2, 3, 4, 5] as AcuityLevel[]).map((l) => (
                    <button
                      key={l}
                      type="button"
                      className={c(levelCls(l), level === l && "on")}
                      aria-pressed={level === l}
                      onClick={() => set({ pick: l === engine ? null : l, why: "" })}
                    >
                      <b>{levelTxt(l)}</b>
                    </button>
                  ))}
                </div>
                {changed ? (
                  <>
                    <p className={c("sublbl")}>{P.whyChange}</p>
                    <div className={c("chips")}>
                      {(d.pick! > engine! ? P.whyDown : P.whyUp).map((w) =>
                        chip(d.why === w, w, () => set({ why: w }), "sm2"),
                      )}
                    </div>
                  </>
                ) : null}
              </>
            ) : (
              <a className={c("btn", "r")} style={{ alignSelf: "flex-start" }} href={resus}>
                {P.openResus}
              </a>
            )}
          </>
        ) : null}
        <p className={c("note")}>{P.engineNote}</p>
      </div>

      <div className={c("stepbox")}>
        <span className={c("cap")}>{P.s4}</span>
        <div className={c("chips")}>
          {ctx.data.clinics.map((cl) => (
            <button
              key={cl.id}
              type="button"
              className={c("chip", d.clinic === cl.id && "on")}
              aria-pressed={d.clinic === cl.id}
              onClick={() =>
                set({ clinic: cl.id, doc: cl.doctors.some((x) => x.id === d.doc) ? d.doc : null })
              }
            >
              <i className={c("dot")} style={{ background: cl.hue }} />
              {cl.name}
            </button>
          ))}
        </div>
        <div className={c("chips")}>
          {chip(d.doc == null, T.anyDoctor, () => set({ doc: null }), "sm2")}
          {clinic.doctors.map((x) => chip(d.doc === x.id, x.name, () => set({ doc: x.id }), "sm2"))}
        </div>
        <input
          className={c("fin")}
          type="text"
          placeholder={P.note}
          value={d.note}
          maxLength={280}
          onChange={(e) => set({ note: e.target.value })}
          aria-label={P.note}
        />
      </div>
      <p className={c("cf-miss")}>
        {isL1
          ? fill(P.l1Missing, { level: levelTxt(1) })
          : still.length
            ? fill(P.stillNeeded, { list: still.join(", ") })
            : P.ready}
      </p>
      <div className={c("acts")}>
        <button
          type="button"
          className={c("btn", "k")}
          style={{ flex: 1 }}
          onClick={send}
          disabled={off}
        >
          {fill(re ? P.saveRecheck : P.send, {
            clinic: clinic.short,
            level: level ? levelTxt(level) : "",
          })}
        </button>
      </div>
    </aside>
  );
}
