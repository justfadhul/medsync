"use client";

/**
 * The Tether clinic floor (ADR 0491): one surface, three views (Triage, Clinic line, Floor) in the reception
 * desk's shell. State is the visits and the append-only floor events; every step is projected by the pure model
 * (`lib/clinic-floor/model.ts`), never stored. Writes go through the port: the server actions live, memory on
 * the styleguide fixture. Copy: content/clinic-floor/floor.ts (draft).
 */
import type { FloorPort } from "./port";
import type { FloorEventInput } from "@/app/clinic/actions";
import type { ShellToast } from "@/components/reception/shell";
import type { FloorClinic, FloorData, FloorPerson, Role } from "@/lib/clinic-floor/fixture";
import type { DoctorState, EventKind, FloorEvent, FloorRow } from "@/lib/clinic-floor/model";
import { useEffect, useMemo, useRef, useState } from "react";

import { DeskShell } from "@/components/reception/shell";
import { c, DeskDialog, Icon } from "@/components/reception/ui";
import { FLOOR } from "@/content/clinic-floor/floor";
import { fill } from "@/content/lab-workspace-v2";
import { canCall, doctorStates, lineOrder, projectFloor } from "@/lib/clinic-floor/model";
import { BoardView } from "./board";
import { FinishDialog, LineDialogs, LineView } from "./line";
import { dayLabel, first, floorKey, hm, toVisit } from "./shared";
import { TriageView } from "./triage";

export type View = "triage" | "line" | "floor";
export type Modal = "keys" | "emerg" | "pre" | "user" | "late" | "end" | "screen" | "finish" | null;
type Sent = Omit<FloorEventInput, "clientId" | "kind" | "intakeId">;

export interface FloorCtx {
  data: FloorData;
  now: number;
  priv: boolean;
  offline: boolean;
  user: FloorData["user"];
  people: FloorPerson[];
  byId: Map<string, FloorPerson>;
  rows: FloorRow[];
  events: FloorEvent[];
  rowOf: Map<string, FloorRow>;
  doctors: Map<string, DoctorState>;
  /** The line this screen shows (the doctor's own clinic by default). */
  clinic: FloorClinic;
  clinicOf: (id: string | null) => FloorClinic;
  docName: (id: string | null) => string;
  myState: DoctorState | undefined;
  record: (kind: EventKind, intakeId: string | null, o?: Sent) => void;
  say: (text: string, undo?: () => void) => void;
  setPeople: (f: (p: FloorPerson[]) => FloorPerson[]) => void;
  setModal: (m: Modal) => void;
  go: (v: View) => void;
  call: (id: string) => void;
  /** The triage panel's person, and whether it is a re-check. */
  sel: { id: string; re: boolean } | null;
  setSel: (s: { id: string; re: boolean } | null) => void;
  togglePriv: () => void;
  setClinic: (id: string) => void;
  q: string;
  port: FloorPort;
}

const ROLE_VIEW: Record<Role, View> = { doctor: "line", nurse: "triage", incharge: "floor" };
export function ClinicFloor({
  data,
  port,
  offline = false,
  view: first0,
}: {
  data: FloorData;
  port: FloorPort;
  offline?: boolean;
  view?: View;
}) {
  const [user, setUser] = useState(data.user);
  const [people, setPeople] = useState(data.people);
  const [events, setEvents] = useState<FloorEvent[]>(data.events);
  const [view, setView] = useState<View>(first0 ?? ROLE_VIEW[data.user.role]);
  const [priv, setPriv] = useState(false);
  const [rail, setRail] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState<ShellToast | null>(null);
  const [sel, setSel] = useState<FloorCtx["sel"]>(null);
  const [q, setQ] = useState("");
  const qRef = useRef<HTMLInputElement>(null);

  // The clock: live time; the fixture starts at its own morning and runs on from there.
  const base = Date.parse(data.nowIso);
  const [now, setNow] = useState(base);
  useEffect(() => {
    const start = Date.now();
    const tick = () => setNow(data.fixture ? base + Date.now() - start : Date.now());
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [base, data.fixture]);

  const mine = (cl: FloorClinic) => cl.doctors.some((d) => d.id === user.id);
  const [clinicId, setClinicId] = useState(
    () => (data.clinics.find(mine) ?? data.clinics[0])?.id ?? "",
  );
  const clinicOf = (id: string | null) => data.clinics.find((x) => x.id === id) ?? data.clinics[0]!;
  const clinic = clinicOf(clinicId);

  const rows = useMemo(() => projectFloor(people.map(toVisit), events), [people, events]);
  const rowOf = useMemo(() => new Map(rows.map((r) => [r.intakeId, r])), [rows]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const doctors = useMemo(() => doctorStates(events), [events]);
  const docName = (id: string | null) =>
    id
      ? (data.clinics.flatMap((x) => x.doctors).find((d) => d.id === id)?.name ?? "")
      : FLOOR.triage.anyDoctor;
  const myState = doctors.get(user.id);

  const say = (text: string, undo?: () => void) => setToast({ text, undo });
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(id);
  }, [toast]);

  const record: FloorCtx["record"] = (kind, intakeId, o = {}) => {
    const self =
      kind === "doctor_status" ||
      kind === "running_late" ||
      kind === "end_session" ||
      kind === "call" ||
      kind === "call_again";
    const e: FloorEvent = {
      intakeId,
      kind,
      detail: o.detail ?? null,
      doctorUserId: self ? user.id : (o.doctorUserId ?? null),
      departmentId: o.departmentId ?? (intakeId ? (byId.get(intakeId)?.clinic ?? null) : clinic.id),
      room: o.room ?? null,
      note: o.note ?? null,
      at: now,
    };
    setEvents((xs) => [...xs, e]);
    void port.record({ clientId: crypto.randomUUID(), kind, intakeId, ...o }).then((r) => {
      if (!r.ok) {
        setEvents((xs) => xs.filter((x) => x !== e));
        say(r.error);
      }
    });
  };

  const go = (v: View) => {
    setView(v);
    setDrawer(false);
  };

  const call = (id: string) => {
    const r = rowOf.get(id);
    const p = byId.get(id);
    if (!r || !p) return;
    if (!canCall(myState)) return say(FLOOR.line.toasts.notIn);
    if (rows.some((x) => x.doctorUserId === user.id && (x.step === "with" || x.step === "called")))
      return say(FLOOR.line.toasts.busy);
    record("call", id, { room: clinic.room, departmentId: clinic.id });
    say(
      fill(FLOOR.line.toasts.calling, { first: first(p.name), room: clinic.room }) +
        (p.needs.length ? fill(FLOOR.line.toasts.deskNeeds, { needs: p.needs.join(", ") }) : ""),
    );
  };

  const togglePriv = () => {
    setPriv((p) => !p);
    say(priv ? FLOOR.privacy.toastOff : FLOOR.privacy.toastOn);
  };

  const ctx: FloorCtx = {
    data,
    now,
    priv,
    offline,
    user,
    people,
    byId,
    rows,
    events,
    rowOf,
    doctors,
    clinic,
    clinicOf,
    docName,
    myState,
    record,
    say,
    setPeople,
    setModal,
    go,
    call,
    sel,
    setSel,
    togglePriv,
    setClinic: setClinicId,
    q,
    port,
  };

  const myLine = lineOrder(rows).filter(
    (r) => r.departmentId === clinic.id && (r.doctorUserId == null || r.doctorUserId === user.id),
  );
  const withMe = rows.find((r) => r.doctorUserId === user.id && r.step === "with");
  const callNext = () => {
    if (!myLine[0]) return say(FLOOR.line.toasts.empty);
    call(myLine[0].intakeId);
  };

  /* ─── keys (S5) ─── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = floorKey(e, !!modal);
      if (!k) return;
      if (k === "escape") {
        if (modal) return; // the dialog closes itself
        if (sel) return setSel(null);
        if (drawer) return setDrawer(false);
        return;
      }
      e.preventDefault();
      const act: Record<string, () => void> = {
        n: () => {
          go("line");
          if (!withMe) callNext();
        },
        f: () => withMe && setModal("finish"),
        h: togglePriv,
        e: () => setModal("emerg"),
        "1": () => go("triage"),
        "2": () => go("line"),
        "3": () => go("floor"),
        "[": () => setRail((r) => !r),
        "?": () => setModal("keys"),
      };
      act[k]?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ─── sidebar numbers ─── */
  const nStep = (s: FloorRow["step"]) => rows.filter((r) => r.step === s).length;
  const forTriage = nStep("triage");
  const inLine = nStep("line") + nStep("called");
  const seen = nStep("done");
  const reDue = rows
    .filter((r) => r.recheck === "continuous" || r.recheck === "hourly")
    .filter((r) => r.step === "line").length;
  const dayPct = Math.max(
    0,
    Math.min(1, (Number(hm(now).slice(0, 2)) + Number(hm(now).slice(3)) / 60 - 7) / 10),
  );
  const ringC = 2 * Math.PI * 24;
  const pre = data.preAlerts;
  const emWho = sel ? byId.get(sel.id) : withMe ? byId.get(withMe.intakeId) : undefined;

  const find = () => {
    const qq = q.trim().toLowerCase();
    if (!qq) return;
    const hit = people.find(
      (p) => p.name.toLowerCase().includes(qq) || p.code.toLowerCase() === qq,
    );
    if (!hit) return;
    if (rowOf.get(hit.id)?.step === "triage") {
      setSel({ id: hit.id, re: false });
      go("triage");
    } else go("floor");
  };

  const nav = (v: View, label: string, icon: string, key: string, em?: string, dot?: boolean) => (
    <button
      type="button"
      className={c("nv", view === v && "on")}
      onClick={() => go(v)}
      title={`${label} (${key})`}
    >
      <Icon n={icon} size={19} />
      <span className={c("lbl")}>{label}</span>
      {em ? <em>{em}</em> : null}
      {dot ? <i className={c("dot")} aria-hidden="true" /> : null}
    </button>
  );

  return (
    <DeskShell
      label={FLOOR.navLabel}
      priv={priv}
      offline={offline}
      banner={
        <>
          <b>{FLOOR.offline.title}</b>
          <span>{FLOOR.offline.lineSafe}</span>
          <span className={c("grow")} />
          <button type="button" className={c("btn", "sm")} onClick={() => window.print()}>
            {FLOOR.offline.print}
          </button>
        </>
      }
      rail={rail}
      setRail={setRail}
      drawer={drawer}
      setDrawer={setDrawer}
      hospitalName={data.hospitalName}
      user={{
        name: user.name,
        place:
          user.role === "doctor"
            ? myState && myState.status !== "in_room"
              ? myState.status === "away"
                ? FLOOR.line.away
                : FLOOR.line.onBreak
              : `${clinic.name} · ${clinic.room}`
            : FLOOR.roles[user.role],
      }}
      syncText={offline ? FLOOR.sync.offline : FLOOR.sync.online}
      onKeys={() => setModal("keys")}
      onSwitchUser={() => setModal("user")}
      onEmergency={() => setModal("emerg")}
      toast={toast}
      clearToast={() => setToast(null)}
      side={
        <>
          <button
            type="button"
            className={c("today")}
            onClick={() => go("floor")}
            aria-label={fill(FLOOR.today.aria, { a: forTriage, b: inLine, c: seen })}
          >
            <span className={c("tt", "full")}>
              <span>{dayLabel(now)}</span>
              <b className={c("mono")}>{hm(now)}</b>
            </span>
            <span className={c("ring", "railOnly")} aria-hidden="true">
              <svg viewBox="0 0 56 56">
                <circle
                  cx="28"
                  cy="28"
                  r="24"
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity=".16"
                  strokeWidth="3.5"
                />
                <circle
                  cx="28"
                  cy="28"
                  r="24"
                  fill="none"
                  stroke="var(--next)"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeDasharray={`${(ringC * dayPct).toFixed(1)} ${ringC.toFixed(1)}`}
                  transform="rotate(-90 28 28)"
                />
              </svg>
              <b className={c("mono")}>{hm(now)}</b>
            </span>
            <span className={c("rs", "railOnly")}>
              <span>
                <b>{forTriage}</b>
                <small>{FLOOR.today.railTriage}</small>
              </span>
              <span>
                <b>{inLine}</b>
                <small>{FLOOR.today.railLine}</small>
              </span>
            </span>
            <span className={c("ts", "full")}>
              <span>
                <b>{forTriage}</b>
                <small>{FLOOR.today.forTriage}</small>
              </span>
              <span>
                <b>{inLine}</b>
                <small>{FLOOR.today.inLine}</small>
              </span>
              <span className={c("full")}>
                <b>{seen}</b>
                <small>{FLOOR.today.seen}</small>
              </span>
            </span>
            <span className={c("tb", "full")} aria-hidden="true">
              <i style={{ width: `${Math.round(dayPct * 100)}%` }} />
            </span>
            <span className={c("tf", "full")}>
              {fill(FLOOR.today.foot, { w: nStep("with"), t: nStep("tests") })}
            </span>
          </button>

          <nav className={c("nav")} aria-label={FLOOR.navLabel}>
            {nav(
              "triage",
              FLOOR.views.triage,
              "person",
              "1",
              reDue ? fill(FLOOR.nav.due, { n: reDue }) : String(forTriage),
              forTriage > 0,
            )}
            {nav(
              "line",
              FLOOR.views.line,
              "arrivals",
              "2",
              fill(FLOOR.nav.inLine, { n: myLine.length }),
            )}
            {nav("floor", FLOOR.views.floor, "calendar", "3")}
            {pre.length ? (
              <button
                type="button"
                className={c("nv", "navEm")}
                onClick={() => setModal("pre")}
                title={FLOOR.nav.emTitle}
              >
                <Icon n="alert" size={19} />
                <span className={c("lbl")}>{FLOOR.nav.emergency}</span>
                <em>{fill(FLOOR.nav.coming, { n: pre.length })}</em>
                <i className={c("dot")} aria-hidden="true" />
              </button>
            ) : null}
          </nav>

          <div className={c("rule")} aria-hidden="true" />
          <div className={c("secH", "full")}>
            {FLOOR.clinics.title}
            <small>{FLOOR.clinics.sub}</small>
          </div>
          <div className={c("clw", "full")}>
            <div className={c("cl2")}>
              {data.clinics.map((cl) => {
                const on = cl.id === clinic.id;
                const n = lineOrder(rows).filter((r) => r.departmentId === cl.id).length;
                return (
                  <button
                    key={cl.id}
                    type="button"
                    className={c("ck2", on && "on")}
                    aria-pressed={on}
                    title={cl.name}
                    onClick={() => {
                      setClinicId(cl.id);
                      if (view === "triage") go("line");
                      setDrawer(false);
                    }}
                  >
                    <span className={c("box")} aria-hidden="true">
                      <Icon n="tick" size={10} w={3.4} />
                    </span>
                    <i style={{ background: cl.hue }} />
                    <span className={c("cn")}>{cl.name}</span>
                    <span className={c("cm")}>{fill(FLOOR.clinics.inLine, { n })}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className={c("dots", "railOnly")} aria-label={FLOOR.clinics.title}>
            {data.clinics.map((cl) => (
              <span key={cl.id} title={cl.name} style={{ background: cl.hue }} />
            ))}
          </div>
        </>
      }
      top={
        <>
          <div className={c("seg")} role="group" aria-label="View">
            {(["triage", "line", "floor"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={c(view === v && "on")}
                aria-pressed={view === v}
                onClick={() => go(v)}
              >
                {FLOOR.views[v]}
              </button>
            ))}
          </div>
          <span className={c("grow")} />
          {pre.length ? (
            <button
              type="button"
              className={c("prepill")}
              onClick={() => setModal("pre")}
              aria-label={fill(FLOOR.top.preAria, { n: pre.length })}
            >
              <span className={c("pulse")} aria-hidden="true" />
              <b>{pre.length}</b>
              <span className={c("tl")}>{FLOOR.top.preAlert}</span>
            </button>
          ) : null}
          <label className={c("srch")}>
            <span className={c("sr")}>{FLOOR.top.search}</span>
            <Icon n="search" size={16} w={2} />
            <input
              ref={qRef}
              type="text"
              autoComplete="off"
              placeholder={FLOOR.top.findPlaceholder}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && find()}
            />
          </label>
        </>
      }
      after={
        <>
          <DeskDialog
            open={modal === "keys"}
            onClose={() => setModal(null)}
            label={FLOOR.keys.title}
            tile="keys"
            title={FLOOR.keys.title}
            lead={FLOOR.keys.sub}
          >
            <div className={c("kys")}>
              {FLOOR.keys.list.map(([what, ks]) => (
                <div key={what} className={c("ky")}>
                  <span>{what}</span>
                  <span className={c("kk")}>
                    {ks.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </DeskDialog>

          <DeskDialog
            open={modal === "emerg"}
            onClose={() => setModal(null)}
            label={FLOOR.emergency.title}
            tile="alert"
            red
            title={FLOOR.emergency.title}
            lead={emWho ? fill(FLOOR.emergency.who, { name: emWho.name }) : FLOOR.emergency.noOne}
          >
            <p style={{ fontSize: 15, lineHeight: "22px" }}>{FLOOR.emergency.line}</p>
            <div className={c("mf")}>
              <span className={c("note")}>{FLOOR.emergency.leaves}</span>
              <span className={c("grow")} />
              <a
                className={c("btn", "r")}
                href={user.role === "doctor" ? "/doctor/resus" : "/nurse/resus"}
              >
                {emWho ? FLOOR.emergency.go : FLOOR.emergency.openDesk}
              </a>
            </div>
          </DeskDialog>

          <DeskDialog
            open={modal === "pre"}
            onClose={() => setModal(null)}
            label={FLOOR.emergency.preTitle}
            tile="alert"
            red
            title={FLOOR.emergency.preTitle}
            lead={FLOOR.emergency.preSub}
          >
            {pre.map((p) => (
              <div key={p.id} className={c("cf-er")}>
                <div>
                  <b>{p.name}</b>
                  <span>{p.what}</span>
                </div>
                <b className={c("redText")}>{p.km}</b>
              </div>
            ))}
            <p className={c("note")}>{FLOOR.emergency.preNote}</p>
          </DeskDialog>

          <DeskDialog
            open={modal === "user"}
            onClose={() => setModal(null)}
            label={FLOOR.user.title}
            tile="swap"
            title={FLOOR.user.title}
            lead={FLOOR.user.sub}
          >
            <div className={c("chips")}>
              {data.users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className={c("chip", u.id === user.id && "on")}
                  aria-pressed={u.id === user.id}
                  onClick={() => {
                    setUser(u);
                    setView(ROLE_VIEW[u.role]);
                    setSel(null);
                    setModal(null);
                    record("user_switch", null);
                    say(
                      fill(FLOOR.user.signedIn, {
                        name: u.name,
                        view: FLOOR.views[ROLE_VIEW[u.role]],
                      }),
                    );
                  }}
                >
                  {fill(FLOOR.user.as, { name: u.name, role: FLOOR.roles[u.role] })}
                </button>
              ))}
            </div>
            {data.fixture ? null : (
              <form action="/sign-out" method="post" className={c("mf")}>
                <span className={c("grow")} />
                <button type="submit" className={c("btn")}>
                  {FLOOR.user.signOut}
                </button>
              </form>
            )}
          </DeskDialog>

          <LineDialogs ctx={ctx} modal={modal} />
          {modal === "finish" && withMe ? <FinishDialog ctx={ctx} row={withMe} /> : null}
        </>
      }
    >
      {view === "triage" ? <TriageView ctx={ctx} /> : null}
      {view === "line" ? <LineView ctx={ctx} line={myLine} callNext={callNext} /> : null}
      {view === "floor" ? <BoardView ctx={ctx} /> : null}
    </DeskShell>
  );
}
