"use client";

import type { Modal } from "./desk-dialogs";
import type { DeskPort } from "./port";
import type { DeskData } from "@/lib/reception/desk/fixture";
import type { DeskRow, DeskSession, QuickFilter, Stage } from "@/lib/reception/desk/model";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";

import { fill } from "@/content/lab-workspace-v2";
import { DESK } from "@/content/reception/desk";
import {
  arrivals,
  clinicRouteAllowed,
  fmtDay,
  goText,
  hhmm,
  initials,
  kampala,
  QUICK,
  shortcut,
  STAGES,
  whoOf,
} from "@/lib/reception/desk/model";
import { DeskCalendar } from "./desk-calendar";
import { DeskDialogs } from "./desk-dialogs";
import s from "./desk.module.css";
import { c, Icon } from "./ui";

export type View = "arr" | "day" | "week" | "month";
/** What a dialog opens with: the calendar's chosen day or time, or the session that is running late. */
export interface Intent {
  book?: { clinic: string; key: string; slot: string };
  lateKey?: string;
}
type IdState = "" | "ask" | "bad" | "stop" | "ok";
const A = DESK.arrivals;
const P = DESK.panel;
const ugx = (n: number) => `UGX ${n.toLocaleString("en-US")}`;
const mins = (now: number, hm?: string) => {
  if (!hm) return 0;
  const [h, m] = hm.split(":").map(Number);
  return Math.max(0, Math.round((now - (h! + m! / 60)) * 60));
};

export interface DeskCtx {
  data: DeskData;
  port: DeskPort;
  rows: DeskRow[];
  setRows: (f: (r: DeskRow[]) => DeskRow[]) => void;
  clinic: (id: string) => { name: string; short: string; hue: string; fee: number };
  sessionsOn: (date: string, all?: boolean) => DeskSession[];
  nowHour: number;
  today: string;
  say: (text: string, undo?: () => void) => void;
  offline: boolean;
}

export function Desk({ data, port }: { data: DeskData; port: DeskPort }) {
  const { resolvedTheme, setTheme } = useTheme();
  const today = data.today;
  /* the clock: server instant plus time since mount, so the fixture keeps its 08:41 and the live desk keeps time */
  const [elapsed, setElapsed] = useState(0);
  const t0 = useRef(0);
  useEffect(() => {
    t0.current = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - t0.current), 1000);
    return () => clearInterval(id);
  }, []);
  const now = kampala(new Date(new Date(data.nowIso).getTime() + elapsed));
  const nowHour = now.hour;

  const [rows, setRowsState] = useState(data.rows);
  const setRows = useCallback((f: (r: DeskRow[]) => DeskRow[]) => setRowsState(f), []);
  const [pre, setPre] = useState(data.preAlerts);
  const [view, setView] = useState<View>("arr");
  const [date, setDate] = useState(today);
  const [on, setOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(data.mine.map((id) => [id, true])),
  );
  const [sessF, setSessF] = useState("");
  const [tab, setTab] = useState<Stage>("expected");
  const [qf, setQf] = useState<QuickFilter>("");
  const [sortBy, setSortBy] = useState<"time" | "near">("time");
  const [q, setQ] = useState("");
  const [priv, setPriv] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [idState, setIdState] = useState<IdState>("");
  const [idBy, setIdBy] = useState("");
  const [yob, setYob] = useState("");
  const [ph3, setPh3] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [rail, setRail] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [clQ, setClQ] = useState("");
  const [clShut, setClShut] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [offline, setOffline] = useState(false);
  const [lateMap, setLateMap] = useState<Record<string, number>>({});
  const [user, setUser] = useState(data.user);
  const [intent, setIntent] = useState<Intent>({});
  const qRef = useRef<HTMLInputElement>(null);

  const say = useCallback((text: string, undo?: () => void) => setToast({ text, undo }), []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    const set = () => setOffline(!navigator.onLine);
    const fit = () =>
      setRail(window.matchMedia("(min-width: 761px) and (max-width: 1100px)").matches);
    set();
    fit();
    window.addEventListener("online", set);
    window.addEventListener("offline", set);
    return () => {
      window.removeEventListener("online", set);
      window.removeEventListener("offline", set);
    };
  }, []);

  const clinicMap = useMemo(() => new Map(data.clinics.map((x) => [x.id, x])), [data.clinics]);
  const clinic = useCallback(
    (id: string) =>
      clinicMap.get(id) ?? {
        name: DESK.nav.emergency,
        short: DESK.nav.emergency,
        hue: "var(--red)",
        fee: 0,
      },
    [clinicMap],
  );
  const sessionsOn = useCallback(
    (d: string, all = false) =>
      data.sessions
        .filter((x) => x.date === d && (all || on[x.id]))
        .map((x) => (lateMap[x.key] !== undefined ? { ...x, late: lateMap[x.key]! } : x))
        .sort((a, b) => a.st - b.st || clinic(a.id).name.localeCompare(clinic(b.id).name)),
    [data.sessions, on, lateMap, clinic],
  );

  /* ─── arrivals ─── */
  const searching = !!q.trim();
  const av = arrivals(rows, { on, tab, clinic: sessF, qf, sort: sortBy, q });
  const emRows = pre.filter((p) => p.acknowledged);
  const showPreRows = !searching && tab === "expected" && emRows.length > 0;
  const counts = { ...av.counts, expected: av.counts.expected + emRows.length };
  const selR = rows.find((r) => r.id === sel) ?? null;
  const selPre = pre.find((p) => p.id === sel) ?? null;
  const isExpSel = !!selR && selR.stage === "expected";
  const todaySess = sessionsOn(today);
  const hereN = rows.filter((r) => r.stage === "here").length;
  const expN = rows.filter((r) => r.stage === "expected").length;
  const seenN = rows.filter((r) => r.stage === "done").length;
  const preUnseen = pre.filter((p) => !p.acknowledged);

  const openRow = (id: string, startCheck: boolean) => {
    setSel(id);
    setIdState(startCheck ? "ask" : "");
    setYob("");
    setPh3("");
    setView("arr");
  };
  const closeSel = () => {
    setSel(null);
    setIdState("");
  };

  const verify = async (method: "yob" | "phone3") => {
    if (!selR) return;
    const answer = method === "yob" ? yob : ph3;
    const r = await port.identityCheck(selR, method, answer);
    if (!r.ok) return say(r.error);
    if (r.matched) {
      setIdState("ok");
      setIdBy(method === "yob" ? "year of birth" : "phone number");
    } else setIdState(method === "yob" ? "bad" : "stop");
  };

  const checkIn = async (route: "triage" | "clinic") => {
    if (!selR) return;
    const before = rows;
    const row = selR;
    const res = await port.checkIn(row, route, crypto.randomUUID());
    if (!res.ok) return say(res.error);
    const arr = hhmm(nowHour);
    setRows((rs) =>
      rs.map((x) =>
        x.id === row.id
          ? {
              ...x,
              stage: "here",
              route,
              arr,
              flag: offline ? "queued" : x.flag === "says" || x.flag === "idc" ? undefined : x.flag,
            }
          : x,
      ),
    );
    closeSel();
    qRef.current?.focus();
    say(
      fill(DESK.toast.checkedIn, {
        name: row.name,
        route: route === "triage" ? P.toTriage.toLowerCase() : P.toClinic.toLowerCase(),
      }) + (offline ? ` · ${DESK.row.state.queued.toLowerCase()}` : ""),
      async () => {
        const u = await port.undoCheckIn(row);
        if (u.ok) setRowsState(before);
        else say(u.error);
      },
    );
  };

  const goPre = async () => {
    const ids = pre.filter((p) => !p.acknowledged).map((p) => p.id);
    if (ids.length) {
      const r = await port.preAlertSeen(ids);
      if (!r.ok) return say(r.error);
    }
    setPre((ps) => ps.map((p) => ({ ...p, acknowledged: true })));
    setView("arr");
    setTab("expected");
    setQ("");
    setSessF("");
    setQf("");
    setDrawer(false);
    say(DESK.preAlert.pinned);
  };

  /* ─── keys ─── */
  const go = (v: View) => {
    setView(v);
    setDrawer(false);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = shortcut(e, !!modal);
      if (!k) return;
      if (k === "escape") {
        if (modal) return; // the dialog closes itself
        if (sel) return closeSel();
        if (drawer) return setDrawer(false);
        return;
      }
      e.preventDefault();
      const act: Record<string, () => void> = {
        search: () => {
          setView("arr");
          setTimeout(() => qRef.current?.focus(), 0);
        },
        code: () => setModal("code"),
        book: () => setModal("book"),
        walk: () => setModal("walk"),
        emergency: () => setModal("emerg"),
        privacy: () => {
          setPriv((p) => !p);
          say(priv ? A.privacyToast.off : A.privacyToast.on);
        },
        view1: () => go("arr"),
        view2: () => go("day"),
        view3: () => go("week"),
        view4: () => go("month"),
        rail: () => setRail((r) => !r),
        keys: () => setModal("keys"),
      };
      act[k]?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const ctx: DeskCtx = {
    data,
    port,
    rows,
    setRows,
    clinic,
    sessionsOn,
    nowHour,
    today,
    say,
    offline,
  };

  /* ─── sidebar: clinics ─── */
  const ids = data.clinics.map((x) => x.id);
  const todayIds = sessionsOn(today, true).map((x) => x.id);
  const presets: [string, string[]][] = [
    [DESK.clinics.presets.mine, data.mine],
    [DESK.clinics.presets.today, todayIds],
    [DESK.clinics.presets.all, ids],
    [DESK.clinics.presets.none, []],
  ];
  const setTo = (list: string[]) => {
    setOn(Object.fromEntries(ids.map((id) => [id, list.includes(id)])));
    if (!list.includes(sessF)) setSessF("");
  };
  const qq = clQ.trim().toLowerCase();
  const found = ids.filter(
    (id) =>
      !qq ||
      clinic(id).name.toLowerCase().includes(qq) ||
      clinic(id).short.toLowerCase().includes(qq),
  );
  const byName = (a: string, b: string) => clinic(a).name.localeCompare(clinic(b).name);
  const clinicMeta = (id: string) => {
    const se =
      todaySess.find((x) => x.id === id) ?? sessionsOn(today, true).find((x) => x.id === id);
    if (se) {
      const h = rows.filter(
        (r) => r.clinic === id && ["here", "nurse", "doctor"].includes(r.stage),
      ).length;
      return h ? `${h} ${DESK.today.here}` : `${se.booked} booked`;
    }
    const next = data.sessions.find((x) => x.id === id && x.date > today);
    return next ? fmtDay(next.date).slice(0, 3) : "";
  };
  const groups: [string, string, string[]][] = [
    ["today", DESK.clinics.running, found.filter((id) => todayIds.includes(id)).sort(byName)],
    ["later", DESK.clinics.notToday, found.filter((id) => !todayIds.includes(id)).sort(byName)],
  ];
  const onN = ids.filter((id) => on[id]).length;
  const dayPct = Math.max(0.02, Math.min(1, (nowHour - 7) / 10));
  const ringC = 2 * Math.PI * 24;

  /* ─── row view ─── */
  const rowCells = (r: DeskRow) => {
    const k = clinic(r.clinic);
    const g = goText(r.go, priv);
    const flag =
      r.flag === "says"
        ? DESK.row.state.app
        : r.flag === "idc"
          ? DESK.row.state.toConfirm
          : r.flag === "queued"
            ? DESK.row.state.queued
            : "";
    const st =
      r.stage === "here"
        ? r.route === "clinic"
          ? DESK.row.state.clinic
          : DESK.row.state.triage
        : DESK.row.state[r.stage === "notseen" ? "notSeen" : r.stage];
    return { k, g, flag, st };
  };

  const tableCount = av.shown.length + (showPreRows ? emRows.length : 0);
  const listEmpty = av.shown.length === 0 && !showPreRows;
  const qfN = (f: QuickFilter) => {
    const base = rows.filter(
      (r) =>
        (on[r.clinic] || r.clinic === "em") &&
        r.stage === "expected" &&
        (!sessF || r.clinic === sessF),
    );
    return f ? base.filter(QUICK[f]).length : base.length;
  };
  const expView = !searching && tab === "expected";
  const routeRows = rows.filter((r) => r.stage === "expected" && r.go.st === "route");

  return (
    <div className={`${s.rx} ${c(priv && "priv")}`} data-desk data-ds="tide">
      {offline ? (
        <div className={c("banner")} role="status">
          <b>{DESK.offline.title}</b>
          <span>
            {fill(DESK.offline.line, { n: rows.filter((r) => r.flag === "queued").length })}
          </span>
          <span className={c("grow")} />
          <button type="button" className={c("btn", "sm")} onClick={() => window.print()}>
            {DESK.offline.print}
          </button>
        </div>
      ) : null}

      <div className={c("app")}>
        {drawer ? <div className={c("dscrim")} onClick={() => setDrawer(false)} /> : null}
        <aside
          className={c("side", drawer && "open", rail && !drawer && "rail")}
          aria-label={DESK.nav.label}
        >
          <div className={c("head")}>
            <span className={c("logo")} aria-hidden="true">
              {data.hospitalName.replace(/[^A-Za-z]/g, "").charAt(0) || "H"}
            </span>
            <div className={c("full", "org")}>
              <b>{data.hospitalName}</b>
              <span>
                {DESK.poweredBy} <em>{DESK.tether}</em>
              </span>
            </div>
            <button
              type="button"
              className={c("railBtn")}
              onClick={() => setRail((x) => !x)}
              aria-label={rail ? DESK.rail.expand : DESK.rail.collapse}
              title={rail ? DESK.rail.expand : DESK.rail.collapse}
            >
              <Icon n="rail" size={16} w={2} />
            </button>
          </div>

          <button
            type="button"
            className={c("today")}
            onClick={() => go("arr")}
            aria-label={`Today: ${expN} expected, ${hereN} here, ${seenN} seen`}
          >
            <span className={c("tt", "full")}>
              <span>{fmtDay(today)}</span>
              <b
                className={c("mono")}
              >{`${hhmm(now.hh + now.mm / 60)}:${String(now.ss).padStart(2, "0")}`}</b>
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
              <b className={c("mono")}>{hhmm(now.hh + now.mm / 60)}</b>
            </span>
            <span className={c("rs", "railOnly")}>
              <span>
                <b>{expN}</b>
                <small>{DESK.today.due}</small>
              </span>
              <span>
                <b>{hereN}</b>
                <small>{DESK.today.here}</small>
              </span>
            </span>
            <span className={c("ts", "full")}>
              <span>
                <b>{expN}</b>
                <small>{DESK.today.expected}</small>
              </span>
              <span>
                <b>{hereN}</b>
                <small>{DESK.today.here}</small>
              </span>
              <span className={c("full")}>
                <b>{seenN}</b>
                <small>{DESK.today.seen}</small>
              </span>
            </span>
            <span className={c("tb", "full")} aria-hidden="true">
              <i style={{ width: `${Math.round(dayPct * 100)}%` }} />
            </span>
            <span className={c("tf", "full")}>
              {fill(DESK.deskHours, {
                open: "07:00",
                close: "17:00",
                now: `${todaySess.length} of your clinics running`,
              })}
            </span>
          </button>

          <nav className={c("nav")} aria-label={DESK.nav.label}>
            <button
              type="button"
              className={c("nv", view === "arr" && "on")}
              onClick={() => go("arr")}
              title={`${DESK.nav.arrivals} (1)`}
            >
              <Icon n="arrivals" size={19} />
              <span className={c("lbl")}>{DESK.nav.arrivals}</span>
              <em>{hereN} here</em>
              <i className={c("dot")} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={c("nv", view !== "arr" && "on")}
              onClick={() => go("week")}
              title={`${DESK.nav.calendar} (2–4)`}
            >
              <Icon n="calendar" size={19} />
              <span className={c("lbl")}>{DESK.nav.calendar}</span>
              <em className={c("q")}>{sessionsOn(today, true).length} today</em>
            </button>
            <button
              type="button"
              className={c("nv")}
              onClick={() => setModal("book")}
              title={`${DESK.nav.book} (B)`}
            >
              <Icon n="phone" size={19} />
              <span className={c("lbl")}>{DESK.nav.book}</span>
            </button>
            <button
              type="button"
              className={c("nv")}
              onClick={() => setModal("walk")}
              title={`${DESK.nav.walkIn} (W)`}
            >
              <Icon n="walk" size={19} />
              <span className={c("lbl")}>{DESK.nav.walkIn}</span>
            </button>
            {pre.length ? (
              <button
                type="button"
                className={c("nv", "navEm")}
                onClick={goPre}
                title={DESK.preAlert.title}
              >
                <Icon n="alert" size={19} />
                <span className={c("lbl")}>{DESK.nav.emergency}</span>
                <em>{pre.length} coming</em>
                <i className={c("dot")} aria-hidden="true" />
              </button>
            ) : null}
          </nav>

          <div className={c("rule")} aria-hidden="true" />
          <div className={c("secH", "full")}>
            {DESK.clinics.title}
            <small>{fill(DESK.clinics.shown, { n: onN, of: ids.length })}</small>
          </div>
          <div className={c("cfind", "full")}>
            <Icon n="search" size={15} w={2} />
            <input
              type="search"
              placeholder={DESK.clinics.find}
              value={clQ}
              onChange={(e) => setClQ(e.target.value)}
              aria-label={DESK.clinics.find}
            />
            {clQ ? (
              <button
                type="button"
                className={c("cx")}
                onClick={() => setClQ("")}
                aria-label="Clear"
              >
                ×
              </button>
            ) : null}
          </div>
          <div className={c("cpre", "full")} role="group" aria-label={DESK.clinics.quick}>
            {presets.map(([label, list]) => {
              const same = ids.every((id) => !!on[id] === list.includes(id));
              return (
                <button
                  key={label}
                  type="button"
                  className={c(same && "on")}
                  aria-pressed={same}
                  onClick={() => setTo(list)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className={c("clw", "full")}>
            {groups
              .filter(([, , l]) => l.length)
              .map(([key, label, list]) => {
                const open = qq ? true : !clShut[key];
                return (
                  <div key={key}>
                    <button
                      type="button"
                      className={c("clg")}
                      aria-expanded={open}
                      onClick={() => setClShut((x) => ({ ...x, [key]: open }))}
                    >
                      <span>{label}</span>
                      <em>{list.length}</em>
                      <svg
                        className={c(!open && "shut")}
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                    {open ? (
                      <div className={c("cl2")}>
                        {list.map((id) => (
                          <button
                            key={id}
                            type="button"
                            className={c("ck2", on[id] && "on")}
                            aria-pressed={!!on[id]}
                            title={clinic(id).name}
                            onClick={() => {
                              setOn((o) => ({ ...o, [id]: !o[id] }));
                              if (sessF === id && on[id]) setSessF("");
                            }}
                          >
                            <span className={c("box")} aria-hidden="true">
                              <Icon n="tick" size={10} w={3.4} />
                            </span>
                            <i style={{ background: clinic(id).hue }} />
                            <span className={c("cn")}>{clinic(id).name}</span>
                            <span className={c("cm")}>{clinicMeta(id)}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            {qq && !found.length ? (
              <p className={c("clno")}>{fill(DESK.clinics.none, { q: clQ })}</p>
            ) : null}
          </div>
          <div className={c("dots", "railOnly")} aria-label={DESK.clinics.title}>
            {ids
              .filter((id) => on[id])
              .map((id) => (
                <span key={id} title={clinic(id).name} style={{ background: clinic(id).hue }} />
              ))}
            <button type="button" onClick={() => setRail(false)} title={DESK.clinics.title}>
              {onN}
            </button>
          </div>

          <div className={c("foot")}>
            <div className={c("user")}>
              <span className={c("av")}>{initials(user.name)}</span>
              <div className={c("full", "who2")}>
                <b>{user.name}</b>
                <span>{DESK.deskName}</span>
              </div>
              <div className={c("acts2", "full")}>
                <button
                  type="button"
                  className={c("ib")}
                  role="switch"
                  aria-checked={resolvedTheme === "dark"}
                  onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                  aria-label={DESK.dock.dark}
                  title={DESK.dock.dark}
                >
                  <Icon n={resolvedTheme === "dark" ? "sun" : "moon"} size={17} w={1.9} />
                </button>
                <button
                  type="button"
                  className={c("ib")}
                  onClick={() => setModal("keys")}
                  aria-label={DESK.keys.title}
                  title={`${DESK.keys.title} (?)`}
                >
                  <Icon n="keys" size={17} w={1.9} />
                </button>
                <button
                  type="button"
                  className={c("ib")}
                  onClick={() => setModal("user")}
                  aria-label={DESK.dock.switchUser}
                  title={DESK.dock.switchUser}
                >
                  <Icon n="swap" size={17} w={1.9} />
                </button>
              </div>
            </div>
            <div className={c("sync", offline && "off")}>
              <i aria-hidden="true" />
              <span className={c("full")}>
                {offline
                  ? fill(DESK.dock.offline, { n: rows.filter((r) => r.flag === "queued").length })
                  : DESK.dock.online}
              </span>
            </div>
          </div>
        </aside>

        <section className={c("main")}>
          <header className={c("top")}>
            <button
              type="button"
              className={c("btn", "menub")}
              onClick={() => setDrawer(true)}
              aria-label={DESK.menu}
            >
              <Icon n="menu" size={18} w={2} />
            </button>
            <div className={c("seg")} role="group" aria-label="View">
              {(
                [
                  ["arr", DESK.nav.arrivals],
                  ["day", DESK.top.views.day],
                  ["week", DESK.top.views.week],
                  ["month", DESK.top.views.month],
                ] as const
              ).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  className={c(view === v && "on")}
                  onClick={() => go(v)}
                >
                  {l}
                </button>
              ))}
            </div>
            <span className={c("grow")} />
            {pre.length ? (
              <button
                type="button"
                className={c("prepill")}
                onClick={goPre}
                aria-label={`${pre.length} ${DESK.preAlert.title}`}
              >
                <span className={c("pulse")} aria-hidden="true" />
                <b>{pre.length}</b>
                <span className={c("tl")}>{DESK.top.preAlert}</span>
              </button>
            ) : null}
            <button
              type="button"
              className={c("btn", "k")}
              onClick={() => setModal("code")}
              title={`${DESK.code.title} (C)`}
            >
              <Icon n="ticket" size={16} w={2} />
              <span className={c("cbl")}>{DESK.code.title}</span>
            </button>
            <label className={c("srch")}>
              <span className={c("sr")}>{DESK.top.search}</span>
              <Icon n="search" size={16} w={2} />
              <input
                ref={qRef}
                type="text"
                autoComplete="off"
                placeholder={DESK.top.findPlaceholder}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setView("arr");
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  if (av.shown.length === 1)
                    openRow(av.shown[0]!.id, av.shown[0]!.stage === "expected");
                  else if (searching && av.shown.length === 0) setModal("walk");
                }}
              />
            </label>
            <button type="button" className={c("btn", "r")} onClick={() => setModal("emerg")}>
              <Icon n="alert" size={16} w={2} />
              {DESK.nav.emergency}
            </button>
          </header>

          <div className={c("body")}>
            {view === "arr" ? (
              <div className={c("arr")}>
                <div className={c("arrL")}>
                  <div className={c("ahead")}>
                    <div className={c("ahl")}>
                      <h1>{A.title}</h1>
                      <span className={c("adate")}>
                        {fmtDay(today)} · {hhmm(nowHour)}
                      </span>
                    </div>
                    <div className={c("cchips")} role="group" aria-label={A.allClinics}>
                      <button
                        type="button"
                        className={c("cc", !sessF && "on")}
                        onClick={() => setSessF("")}
                        aria-pressed={!sessF}
                      >
                        {A.allClinics}
                      </button>
                      {todaySess.map((se) => {
                        const k = clinic(se.id);
                        const here = rows.filter(
                          (r) =>
                            r.clinic === se.id && ["here", "nurse", "doctor"].includes(r.stage),
                        ).length;
                        const onC = sessF === se.id;
                        return (
                          <button
                            key={se.key}
                            type="button"
                            className={c("cc", onC && "on")}
                            style={{ "--ci": k.hue } as React.CSSProperties}
                            onClick={() => setSessF(onC ? "" : se.id)}
                            aria-pressed={onC}
                            title={`${hhmm(se.st)}–${hhmm(se.en)} · ${se.docs.join(", ")}`}
                          >
                            <i />
                            {k.short}
                            <span className={c("ccb")}>
                              <span
                                style={{
                                  width: `${Math.round((se.booked / Math.max(1, se.cap)) * 100)}%`,
                                }}
                              />
                            </span>
                            <small>
                              {here} here · {se.booked}/{se.cap}
                            </small>
                            {se.late ? <em>{fill(A.late, { n: `${se.late} min` })}</em> : null}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      className={c("btn", "sm")}
                      onClick={() => setModal("close")}
                    >
                      {A.closeDay}
                    </button>
                  </div>

                  <div
                    className={c("tw", expView && "nostate", selR && "narrow")}
                    role="table"
                    aria-label={
                      searching ? A.searchResults : A.tabs[tab === "notseen" ? "notSeen" : tab]
                    }
                  >
                    {!searching ? (
                      <div className={c("ttabs")} role="tablist" aria-label="Stage">
                        {STAGES.map((st) => (
                          <button
                            key={st}
                            type="button"
                            role="tab"
                            className={c(tab === st && "on")}
                            aria-selected={tab === st}
                            onClick={() => {
                              setTab(st);
                              closeSel();
                            }}
                          >
                            {A.tabs[st === "notseen" ? "notSeen" : st]}
                            <b>{counts[st]}</b>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className={c("ttabs", "srchd")}>
                        <span>
                          <b>{av.shown.length === 1 ? "1 match" : `${av.shown.length} matches`}</b>{" "}
                          {fill(A.searched, {
                            q: q.trim(),
                            hint: av.shown.length === 1 ? "it" : "a single match",
                          })}
                        </span>
                        <span className={c("grow")} />
                        <button
                          type="button"
                          className={c("btn", "sm", "q")}
                          onClick={() => setQ("")}
                        >
                          {A.clearSearch}
                        </button>
                      </div>
                    )}
                    <div className={c("tbar")}>
                      <span className={c("tcount")}>{fill(A.count, { n: tableCount })}</span>
                      {expView ? (
                        <span className={c("qf")} role="group" aria-label="Quick filters">
                          {(
                            [
                              ["", A.allClinics.split(" ")[0]!],
                              ["route", A.filters.onTheWay],
                              ["unpaid", A.filters.notPaid],
                              ["triage", A.filters.triageFirst],
                            ] as [QuickFilter, string][]
                          ).map(([f, l]) => (
                            <button
                              key={f || "all"}
                              type="button"
                              className={c(qf === f && "on")}
                              aria-pressed={qf === f}
                              onClick={() => setQf(f)}
                            >
                              {l}
                              <small>{qfN(f)}</small>
                            </button>
                          ))}
                        </span>
                      ) : null}
                      <span className={c("grow")} />
                      {expView && routeRows.length && !priv ? (
                        <span className={c("why")}>
                          {routeRows.length} on the way · nearest{" "}
                          {Math.min(...routeRows.map((r) => (r.go.st === "route" ? r.go.km : 99)))}{" "}
                          km
                        </span>
                      ) : null}
                      {expView ? (
                        <span className={c("sortseg")} role="group" aria-label="Order">
                          <button
                            type="button"
                            className={c(sortBy === "time" && "on")}
                            onClick={() => setSortBy("time")}
                          >
                            {A.sort.time}
                          </button>
                          <button
                            type="button"
                            className={c(sortBy === "near" && "on")}
                            onClick={() => setSortBy("near")}
                          >
                            <Icon n="nav" size={14} w={2} />
                            {A.sort.closest}
                          </button>
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className={c("btn", "sm", "q", priv && "privon")}
                        onClick={() => {
                          setPriv(!priv);
                          say(priv ? A.privacyToast.off : A.privacyToast.on);
                        }}
                        aria-pressed={priv}
                        title="Hide reasons, photos and distances (H)"
                      >
                        <Icon n="eye" size={16} />
                        <span className={c("hrT")}>{priv ? A.privacy.on : A.privacy.off}</span>
                      </button>
                    </div>
                    <div className={c("thd")} role="row">
                      <span role="columnheader">{A.cols.patient}</span>
                      <span role="columnheader">{A.cols.why}</span>
                      <span role="columnheader" className={c("hG")}>
                        {A.cols.onTheWay}
                      </span>
                      <span role="columnheader">{A.cols.fee}</span>
                      <span role="columnheader" className={c("hK")}>
                        {A.cols.clinic}
                      </span>
                      <span role="columnheader" className={c("hS")}>
                        {A.cols.state}
                      </span>
                      <span role="columnheader">
                        <span className={c("sr")}>{A.cols.action}</span>
                      </span>
                    </div>
                    <div className={c("tbd")} role="rowgroup">
                      {showPreRows ? (
                        <>
                          <div className={c("tgr", "em")} role="row">
                            <span role="cell">
                              <span className={c("pulse")} aria-hidden="true" />
                              {A.emergencyGroup}
                              <em>{emRows.length}</em>
                            </span>
                          </div>
                          {emRows.map((p) => (
                            <div
                              key={p.id}
                              className={c("trw", "em", sel === p.id && "sel")}
                              role="row"
                            >
                              <span role="cell" className={c("cP")}>
                                <span className={c("av")} aria-hidden="true">
                                  {initials(p.name)}
                                </span>
                                <span className={c("ptx")}>
                                  <button
                                    type="button"
                                    className={c("who")}
                                    onClick={() => openRow(p.id, false)}
                                  >
                                    {p.name}
                                  </button>
                                  <span className={c("mt")}>
                                    {p.who} · {P.preAlertFrom}
                                  </span>
                                </span>
                              </span>
                              <span role="cell" className={c("cR")}>
                                <span className={c("rsn", priv && "hid")}>
                                  {priv ? DESK.row.hidden : p.what}
                                </span>
                              </span>
                              <span role="cell" className={c("cG")}>
                                <span className={c("go", "route")}>
                                  <Icon n="nav" size={14} w={2} />
                                  {priv || p.km === null
                                    ? DESK.row.onTheWay.hidden
                                    : `about ${p.km} km`}
                                </span>
                                <span className={c("mt")}>
                                  {fill(DESK.preAlert.arriving, { when: p.eta })}
                                </span>
                              </span>
                              <span role="cell" className={c("cF")}>
                                <span className={c("fee", "none")}>{DESK.row.fee.none}</span>
                              </span>
                              <span role="cell" className={c("cK")}>
                                <span className={c("kl")}>
                                  <i style={{ background: "var(--red)" }} />
                                  {DESK.nav.emergency}
                                </span>
                                <span className={c("mt")}>{P.emergencyTold}</span>
                              </span>
                              <span role="cell" className={c("cS")}>
                                <span className={c("stp", "red")}>{DESK.nav.emergency}</span>
                              </span>
                              <span role="cell" className={c("cA")}>
                                <button
                                  type="button"
                                  className={c("btn", "sm", "ro")}
                                  onClick={async () => {
                                    const res = await port.preAlertArrived(p.id);
                                    if (!res.ok) return say(res.error);
                                    setPre((ps) => ps.filter((x) => x.id !== p.id));
                                    setRows((rs) => [
                                      {
                                        id: `em-${p.id}`,
                                        appointmentId: null,
                                        intakeId: null,
                                        clinic: "em",
                                        name: p.name,
                                        sex: "?",
                                        age: null,
                                        pno: "",
                                        code: "—",
                                        time: "",
                                        doc: DESK.nav.emergency,
                                        stage: "here",
                                        route: "emergency",
                                        arr: hhmm(nowHour),
                                        flag: "emerg",
                                        reason: p.what,
                                        ownWords: false,
                                        fee: 0,
                                        paid: false,
                                        go: { st: "here" },
                                      },
                                      ...rs,
                                    ]);
                                    say(fill(DESK.preAlert.arrived, { when: hhmm(nowHour) }));
                                  }}
                                >
                                  {A.act.arrived}
                                </button>
                              </span>
                            </div>
                          ))}
                        </>
                      ) : null}
                      {av.groups.map((g) => (
                        <div key={g.key} role="presentation">
                          <div className={c("tgr")} role="row">
                            <span role="cell">
                              {g.label}
                              <em>{g.rows.length}</em>
                            </span>
                          </div>
                          {g.rows.map((r) => {
                            const { k, g: gg, flag, st } = rowCells(r);
                            return (
                              <div
                                key={r.id}
                                className={c(
                                  "trw",
                                  sel === r.id && "sel",
                                  r.flag === "emerg" && "em",
                                )}
                                role="row"
                              >
                                <span role="cell" className={c("cP")}>
                                  <span className={c("av")} aria-hidden="true">
                                    {initials(r.name)}
                                  </span>
                                  <span className={c("ptx")}>
                                    <button
                                      type="button"
                                      className={c("who")}
                                      onClick={() => openRow(r.id, false)}
                                    >
                                      {r.name}
                                    </button>
                                    <span className={c("mt")}>
                                      {whoOf(r)} · <span className={c("mono")}>{r.code}</span>
                                      {r.arr ? ` · arrived ${r.arr}` : ""}
                                    </span>
                                    {flag ? (
                                      <span className={c("mt")}>
                                        <span className={c("fl", r.flag === "idc" && "red")}>
                                          {flag}
                                        </span>
                                      </span>
                                    ) : null}
                                  </span>
                                </span>
                                <span role="cell" className={c("cR")}>
                                  <span className={c("rsn", priv ? "hid" : r.ownWords && "own")}>
                                    {priv ? DESK.row.hidden : r.reason}
                                  </span>
                                  {r.ownWords && !priv ? (
                                    <span className={c("mt")}>
                                      {DESK.row.theirWords.replace(" · ", "")}
                                    </span>
                                  ) : null}
                                </span>
                                <span role="cell" className={c("cG")}>
                                  <span className={c("go", gg.route && "route", gg.none && "none")}>
                                    {gg.route ? <Icon n="nav" size={14} w={2} /> : null}
                                    {gg.t}
                                  </span>
                                  <span className={c("mt")}>{gg.s}</span>
                                </span>
                                <span role="cell" className={c("cF")}>
                                  <span className={c("fee", r.fee ? r.paid && "paid" : "none")}>
                                    {r.fee
                                      ? r.paid
                                        ? DESK.row.fee.paid
                                        : DESK.row.fee.notPaid
                                      : DESK.row.fee.none}
                                  </span>
                                  <span className={c("mt")}>
                                    {r.fee
                                      ? r.paid && r.payAt
                                        ? `${r.payBy === "momo" ? "MoMo" : "Cash"} · ${r.payAt}`
                                        : ugx(r.fee)
                                      : ""}
                                  </span>
                                </span>
                                <span role="cell" className={c("cK")}>
                                  <span className={c("kl")}>
                                    <i style={{ background: k.hue }} />
                                    {k.short}
                                  </span>
                                  <span className={c("mt")}>{r.doc}</span>
                                </span>
                                <span role="cell" className={c("cS")}>
                                  <span
                                    className={c(
                                      "stp",
                                      r.stage === "doctor" && "dark",
                                      r.flag === "emerg" && "red",
                                      (r.stage === "done" || r.stage === "notseen") && "out",
                                    )}
                                  >
                                    {r.flag === "emerg" ? DESK.row.state.emergency : st}
                                  </span>
                                </span>
                                <span role="cell" className={c("cA")}>
                                  {r.stage === "expected" ? (
                                    <button
                                      type="button"
                                      className={c("btn", "sm")}
                                      onClick={() => openRow(r.id, true)}
                                    >
                                      {A.act.checkIn}
                                    </button>
                                  ) : r.stage === "here" ? (
                                    <span className={c("mt")}>
                                      {fill(DESK.row.waitingFor, { n: mins(nowHour, r.arr) })}
                                    </span>
                                  ) : null}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                      {listEmpty ? (
                        <div className={c("empty")}>
                          <b>
                            {searching
                              ? fill(A.empty.search, { q: q.trim() })
                              : rows.length === 0
                                ? A.empty.firstRun
                                : A.empty.stage}
                          </b>
                          <span>
                            {searching
                              ? A.empty.searchLine
                              : rows.length === 0
                                ? A.empty.firstRunLine
                                : A.empty.stageLine}
                          </span>
                          <div className={c("acts")}>
                            {searching || rows.length === 0 ? (
                              <button
                                type="button"
                                className={c("btn", "k")}
                                onClick={() => setModal("walk")}
                              >
                                {A.registerWalkIn}
                              </button>
                            ) : null}
                            {!searching && rows.length === 0 ? (
                              <button
                                type="button"
                                className={c("btn")}
                                onClick={() => setModal("book")}
                              >
                                {DESK.nav.book}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                {selR || selPre ? (
                  <aside className={c("det")} aria-label="Selected person" aria-live="polite">
                    {selPre ? (
                      <>
                        <div className={c("dh")}>
                          <span className={c("av", "xl")} aria-hidden="true">
                            {initials(selPre.name)}
                          </span>
                          <div>
                            <h2>{selPre.name}</h2>
                            <p>{selPre.who}</p>
                          </div>
                          <button
                            type="button"
                            className={c("btn", "sm", "q", "x")}
                            onClick={closeSel}
                          >
                            {P.close}
                          </button>
                        </div>
                        <p className={c("note")}>
                          {P.preAlertFrom}. {selPre.what}.
                        </p>
                      </>
                    ) : selR ? (
                      <SelPanel
                        r={selR}
                        ctx={ctx}
                        priv={priv}
                        idState={idState}
                        idBy={idBy}
                        yob={yob}
                        ph3={ph3}
                        setYob={setYob}
                        setPh3={setPh3}
                        start={() => setIdState("ask")}
                        verify={verify}
                        checkIn={checkIn}
                        isExpSel={isExpSel}
                        close={closeSel}
                        openModal={setModal}
                      />
                    ) : null}
                  </aside>
                ) : null}
              </div>
            ) : (
              <DeskCalendar
                ctx={ctx}
                view={view}
                setView={setView}
                date={date}
                setDate={setDate}
                on={on}
                openRow={openRow}
                setModal={setModal}
                setIntent={setIntent}
                setSessF={setSessF}
              />
            )}
          </div>
        </section>
      </div>

      {preUnseen.length && !offline ? (
        <div className={c("precard")} role="alert" aria-label={DESK.preAlert.title}>
          <div className={c("pcH")}>
            <span className={c("tile", "red")} aria-hidden="true">
              <Icon n="alert" size={18} />
            </span>
            <div>
              <b>{DESK.preAlert.title}</b>
              <span>{DESK.preAlert.told}</span>
            </div>
          </div>
          {preUnseen.map((p) => (
            <div key={p.id} className={c("pcI")}>
              <div>
                <b>{p.name}</b>
                <span>{p.what}</span>
              </div>
              <div className={c("pcD")}>
                <b>{p.km === null ? "" : `${p.km} km`}</b>
                <span>{p.eta}</span>
              </div>
            </div>
          ))}
          <div className={c("acts")}>
            <button type="button" className={c("btn", "sm", "r")} onClick={goPre}>
              {DESK.preAlert.show}
            </button>
          </div>
          <p className={c("note")}>{DESK.preAlert.line}</p>
        </div>
      ) : null}

      <DeskDialogs
        ctx={ctx}
        modal={modal}
        setModal={(m) => {
          setModal(m);
          if (!m) setIntent({});
        }}
        intent={intent}
        setLate={(key, m) => setLateMap((x) => ({ ...x, [key]: m }))}
        selR={selR}
        clearSel={closeSel}
        openRow={openRow}
        user={user}
        setUser={setUser}
        clinicsOn={on}
        setTab={setTab}
        setView={setView}
      />

      {toast ? (
        <div className={c("toast")} role="status">
          <span>{toast.text}</span>
          {toast.undo ? (
            <button
              type="button"
              className={c("btn", "sm")}
              onClick={() => {
                const u = toast.undo!;
                setToast(null);
                u();
              }}
            >
              {DESK.toast.undo}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SelPanel({
  r,
  ctx,
  priv,
  idState,
  idBy,
  yob,
  ph3,
  setYob,
  setPh3,
  start,
  verify,
  checkIn,
  isExpSel,
  close,
  openModal,
}: {
  r: DeskRow;
  ctx: DeskCtx;
  priv: boolean;
  idState: IdState;
  idBy: string;
  yob: string;
  ph3: string;
  setYob: (v: string) => void;
  setPh3: (v: string) => void;
  start: () => void;
  verify: (m: "yob" | "phone3") => void;
  checkIn: (route: "triage" | "clinic") => void;
  isExpSel: boolean;
  close: () => void;
  openModal: (m: Modal) => void;
}) {
  const k = ctx.clinic(r.clinic);
  const g = goText(r.go, priv);
  const yobRef = useRef<HTMLInputElement>(null);
  const ph3Ref = useRef<HTMLInputElement>(null);
  const routeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (idState === "ask") yobRef.current?.focus();
    if (idState === "bad") ph3Ref.current?.focus();
    if (idState === "ok") routeRef.current?.focus();
  }, [idState]);
  const direct = clinicRouteAllowed(r.reason);
  const note =
    r.flag === "says"
      ? P.booked
      : r.flag === "idc"
        ? P.bookedByPhone
        : r.stage === "notseen"
          ? P.notSeenToday
          : "";
  const fr = (icon: string, label: string, v: React.ReactNode, col?: boolean) => (
    <div className={c("fr")}>
      <span>
        <Icon n={icon} size={15} />
        {label}
      </span>
      <span className={c("fv", col && "fvCol")}>{v}</span>
    </div>
  );
  return (
    <>
      <div className={c("dh")}>
        <span className={c("av", "xl")} aria-hidden="true">
          {initials(r.name)}
        </span>
        <div>
          <h2>{r.name}</h2>
          <p>
            {whoOf(r)} · <span className={c("mono")}>{r.pno}</span>
          </p>
        </div>
        <button type="button" className={c("btn", "sm", "q", "x")} onClick={close}>
          {P.close}
        </button>
      </div>
      <div className={c("form")}>
        {fr("ticket", P.bookingCode, <span className={c("mono")}>{r.code}</span>)}
        {fr(
          "calendar",
          P.clinic,
          <span className={c("kl")}>
            <i style={{ background: k.hue }} />
            {k.name}
          </span>,
        )}
        {fr("clock", P.time, r.time || (r.arr ? `Arrived ${r.arr}` : "—"))}
        {fr("person", P.doctor, r.doc)}
        {fr(
          "chat",
          P.why,
          <span className={c("fvText")}>
            {priv ? DESK.row.hidden : (r.ownWords ? DESK.row.theirWords : "") + r.reason}
          </span>,
        )}
        {fr(
          "nav",
          A.cols.onTheWay,
          <>
            <span>{g.t}</span>
            <span className={c("mt")}>{g.s}</span>
          </>,
          true,
        )}
        {fr(
          "card",
          P.fee,
          <>
            <span>
              {r.fee
                ? `${ugx(r.fee)} · ${r.paid ? DESK.row.fee.paid : DESK.row.fee.notPaid}`
                : P.feeNone}
            </span>
            <span className={c("mt")}>
              {r.fee && !r.paid
                ? P.feeAuto
                : r.paid && r.payAt
                  ? `${r.payBy === "momo" ? "MoMo" : "Cash"} · ${r.payAt}`
                  : ""}
            </span>
          </>,
          true,
        )}
      </div>
      {note ? <p className={c("note")}>{note}</p> : null}

      {isExpSel && (idState === "ask" || idState === "bad" || idState === "stop") ? (
        <div className={c("stepbox")}>
          <span className={c("cap")}>{P.step1}</span>
          <p className={c("ask")}>{P.askYear}</p>
          <div className={c("inl")}>
            <label className={c("sr")} htmlFor="desk-yob">
              {P.yearLabel}
            </label>
            <input
              ref={yobRef}
              id="desk-yob"
              className={c("in")}
              type="text"
              inputMode="numeric"
              maxLength={4}
              placeholder="e.g. 1990"
              value={yob}
              onChange={(e) => setYob(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && verify("yob")}
              disabled={idState !== "ask"}
            />
            <button
              type="button"
              className={c("btn")}
              onClick={() => verify("yob")}
              disabled={idState !== "ask"}
            >
              {P.check}
            </button>
          </div>
          {idState === "bad" || idState === "stop" ? (
            <>
              <p className={c("note")}>
                <b>{P.noMatch}</b> {P.askPhone}
              </p>
              <div className={c("inl")}>
                <label className={c("sr")} htmlFor="desk-ph3">
                  {P.phoneLabel}
                </label>
                <input
                  ref={ph3Ref}
                  id="desk-ph3"
                  className={c("in")}
                  type="text"
                  inputMode="numeric"
                  maxLength={3}
                  placeholder="e.g. 233"
                  value={ph3}
                  onChange={(e) => setPh3(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && verify("phone3")}
                  disabled={idState === "stop"}
                />
                <button
                  type="button"
                  className={c("btn")}
                  onClick={() => verify("phone3")}
                  disabled={idState === "stop"}
                >
                  {P.check}
                </button>
              </div>
            </>
          ) : null}
          {idState === "stop" ? (
            <p className={c("note")} role="alert">
              <b>{P.stillNoMatch}</b> {P.stillNoMatchLine}
            </p>
          ) : null}
        </div>
      ) : null}

      {isExpSel && idState === "ok" ? (
        <div className={c("stepbox", "ok")}>
          <span className={c("cap")}>{P.step2}</span>
          <p>
            <b>{fill(P.checkedBy, { name: idBy })}</b>
          </p>
          <div className={c("acts")}>
            <button
              ref={routeRef}
              type="button"
              className={c("btn", "k")}
              onClick={() => checkIn("triage")}
            >
              {P.toTriage}
            </button>
            <button
              type="button"
              className={c("btn")}
              onClick={() => checkIn("clinic")}
              disabled={!direct}
              title={direct ? undefined : P.clinicLocked}
            >
              {P.toClinic}
            </button>
          </div>
          <p className={c("note")}>{direct ? P.triageNote : P.clinicLocked}</p>
        </div>
      ) : null}

      {isExpSel && !idState ? (
        <button type="button" className={c("btn", "k")} onClick={start}>
          {A.act.checkIn}
        </button>
      ) : null}

      {isExpSel ? (
        <>
          <div className={c("hr")} />
          <div className={c("acts")}>
            <button type="button" className={c("btn", "sm")} onClick={() => openModal("move")}>
              {P.move}
            </button>
            <button type="button" className={c("btn", "sm")} onClick={() => openModal("cancel")}>
              {P.cancel}
            </button>
            <button type="button" className={c("btn", "sm")} disabled>
              {P.noShow}
            </button>
          </div>
          <p className={c("why")}>{P.noShowWhy}</p>
        </>
      ) : null}

      {r.stage === "here" && r.flag !== "emerg" ? (
        <div className={c("acts")}>
          <button
            type="button"
            className={c("btn", "sm")}
            onClick={async () => {
              const res = await ctx.port.undoCheckIn(r);
              if (!res.ok) return ctx.say(res.error);
              ctx.setRows((rs) =>
                rs.map((x) =>
                  x.id === r.id ? { ...x, stage: "expected", route: undefined, arr: undefined } : x,
                ),
              );
              close();
              ctx.say(DESK.toast.undone);
            }}
          >
            {P.undoCheckIn}
          </button>
          <button
            type="button"
            className={c("btn", "sm")}
            onClick={async () => {
              const res = await ctx.port.leftEarly(r);
              if (!res.ok) return ctx.say(res.error);
              ctx.setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, stage: "notseen" } : x)));
              close();
            }}
          >
            {P.leftEarly}
          </button>
        </div>
      ) : null}

      {r.flag === "emerg" ? (
        <>
          <button type="button" className={c("btn", "k")} onClick={() => openModal("register")}>
            {P.registerNow}
          </button>
          <p className={c("why")}>{P.registerLater}</p>
        </>
      ) : null}
    </>
  );
}
