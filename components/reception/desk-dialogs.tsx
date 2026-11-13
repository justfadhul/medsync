"use client";

import type { DeskCtx, Intent, View } from "./desk";
import type { SlipData } from "./desk-forms";
import type { DeskRow } from "@/lib/reception/desk/model";
import { useState } from "react";

import { fill } from "@/content/lab-workspace-v2";
import { DESK } from "@/content/reception/desk";
import {
  codeHasBadChar,
  codeInput,
  codeSpoken,
  fmtDay,
  hhmm,
  initials,
  whoOf,
} from "@/lib/reception/desk/model";
import { BookDialog, WalkInDialog } from "./desk-forms";
import s from "./desk.module.css";
import { c, Chips, DeskDialog, Icon } from "./ui";

export type Modal =
  | null
  | "book"
  | "emerg"
  | "walk"
  | "register"
  | "close"
  | "late"
  | "move"
  | "cancel"
  | "code"
  | "keys"
  | "slip"
  | "user";

const LATE: [string, number][] = [
  ["15 min", 15],
  ["30 min", 30],
  ["45 min", 45],
  ["1 hour", 60],
  [DESK.ui.overHour, 90],
];

export function DeskDialogs({
  ctx,
  modal,
  setModal,
  intent,
  setLate,
  selR,
  clearSel,
  openRow,
  user,
  setUser,
  setTab,
  setView,
}: {
  ctx: DeskCtx;
  modal: Modal;
  setModal: (m: Modal) => void;
  intent: Intent;
  setLate: (key: string, minutes: number) => void;
  selR: DeskRow | null;
  clearSel: () => void;
  openRow: (id: string, check: boolean) => void;
  user: { id: string; name: string };
  setUser: (u: { id: string; name: string }) => void;
  clinicsOn: Record<string, boolean>;
  setTab: (t: "expected" | "here" | "notseen") => void;
  setView: (v: View) => void;
}) {
  const { rows, setRows, say, data, nowHour } = ctx;
  const close = () => setModal(null);
  const [slip, setSlip] = useState<SlipData | null>(null);
  const [emName, setEmName] = useState("");

  return (
    <>
      {modal === "code" ? (
        <CodeDialog
          open
          ctx={ctx}
          close={close}
          openRow={openRow}
          toWalk={() => setModal("walk")}
        />
      ) : null}

      <DeskDialog
        open={modal === "emerg"}
        onClose={close}
        label={DESK.nav.emergency}
        tile="alert"
        red
        title={DESK.emergency.title}
        lead={DESK.emergency.lead}
      >
        <p className={s.lead15}>{DESK.emergency.line}</p>
        <div className={c("frow")}>
          <label htmlFor="desk-emn">{DESK.emergency.name}</label>
          <input
            id="desk-emn"
            className={c("fin")}
            type="text"
            value={emName}
            onChange={(e) => setEmName(e.target.value)}
          />
        </div>
        <div className={c("mf")}>
          <span className={c("note")}>{DESK.emergency.added}</span>
          <span className={c("grow")} />
          <button
            type="button"
            className={c("btn", "r")}
            onClick={() => {
              const name = emName.trim() || DESK.row.noName;
              setRows((rs) => [
                {
                  id: `em-${Date.now()}`,
                  appointmentId: null,
                  intakeId: null,
                  clinic: "em",
                  name,
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
                  reason: "",
                  ownWords: false,
                  fee: 0,
                  paid: false,
                  go: { st: "here" },
                },
                ...rs,
              ]);
              setEmName("");
              close();
              setView("arr");
              setTab("here");
              say(DESK.emergency.toast);
            }}
          >
            {DESK.emergency.go}
          </button>
        </div>
      </DeskDialog>

      {modal === "walk" || modal === "register" ? (
        <WalkInDialog
          open
          ctx={ctx}
          regFor={modal === "register" ? selR : null}
          close={close}
          toEmergency={(name) => {
            setEmName(name);
            setModal("emerg");
          }}
          done={(sl, row) => {
            if (modal === "register" && selR) {
              setRows((rs) =>
                rs.map((x) => (x.id === selR.id ? { ...x, ...row, flag: undefined } : x)),
              );
              clearSel();
              close();
              say(`${row.name} is registered`);
              return;
            }
            setRows((rs) => [row as DeskRow, ...rs]);
            setSlip(sl);
            setView("arr");
            setTab("here");
            setModal("slip");
          }}
        />
      ) : null}

      {modal === "book" ? <BookDialog open ctx={ctx} preset={intent.book} close={close} /> : null}

      {modal === "close" ? <CloseDayDialog open ctx={ctx} close={close} setTab={setTab} /> : null}

      <LateDialog
        open={modal === "late"}
        sessionKey={intent.lateKey}
        ctx={ctx}
        close={close}
        saved={(key, m) => {
          setLate(key, m);
          close();
        }}
      />

      {selR ? (
        <MoveCancel
          key={modal ?? ""}
          kind={modal === "move" ? "move" : modal === "cancel" ? "cancel" : null}
          r={selR}
          ctx={ctx}
          close={close}
          done={() => {
            const before = rows;
            setRows((rs) => rs.filter((x) => x.id !== selR.id));
            clearSel();
            close();
            return before;
          }}
        />
      ) : null}

      <DeskDialog
        open={modal === "keys"}
        onClose={close}
        label={DESK.keys.title}
        tile="keys"
        title={DESK.keys.title}
        lead={DESK.keys.lead}
      >
        <div className={c("kys")}>
          {DESK.keys.list.map(([k, what]) => (
            <div key={what} className={c("ky")}>
              <span>{what}</span>
              <span className={c("kk")}>
                {k.split(" ").map((x) => (
                  <kbd key={x}>{x}</kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </DeskDialog>

      <SlipDialog
        open={modal === "slip"}
        slip={slip}
        hospital={data.hospitalName}
        close={close}
        say={say}
      />

      {modal === "user" ? (
        <UserDialog open ctx={ctx} user={user} close={close} switched={(u) => setUser(u)} />
      ) : null}

      {/* the printed slip: hidden on screen, alone on paper (D-RD-22) */}
      {slip ? (
        <div className={c("printArea")} data-paper="80">
          <SlipCard slip={slip} hospital={data.hospitalName} />
        </div>
      ) : null}
    </>
  );
}

/* ─── check in by code ─── */
function CodeDialog({
  open,
  ctx,
  close,
  openRow,
  toWalk,
}: {
  open: boolean;
  ctx: DeskCtx;
  close: () => void;
  openRow: (id: string, check: boolean) => void;
  toWalk: () => void;
}) {
  const [raw, setRaw] = useState("");
  const code = codeInput(raw);
  const bad = codeHasBadChar(code);
  const done = code.length === 6;
  const row = done ? ctx.rows.find((r) => r.code === code) : undefined;
  const recent = ctx.rows
    .filter((r) => r.arr && r.stage !== "expected")
    .sort((a, b) => (b.arr ?? "").localeCompare(a.arr ?? ""))
    .slice(0, 3);
  const state = (r: DeskRow) =>
    r.stage === "expected"
      ? `${DESK.row.state.expected} · ${r.time}`
      : r.stage === "notseen"
        ? DESK.panel.notSeenToday
        : r.stage === "done"
          ? DESK.panel.seenToday
          : DESK.panel.checkedIn;
  const cls = bad || (done && !row) ? "bad" : row ? "ok" : "";
  const hint = bad
    ? DESK.code.badChar
    : !code
      ? DESK.code.hint
      : !done
        ? `${6 - code.length} to go`
        : row
          ? "Found"
          : fill(DESK.code.notFound, { code: codeSpoken(code) });
  const go = () => {
    if (!row) return;
    close();
    openRow(row.id, row.stage === "expected");
  };
  const box = (i: number) => (
    <span key={i} className={c(i === code.length && !done && "cur")}>
      {code.charAt(i)}
    </span>
  );
  return (
    <DeskDialog
      open={open}
      onClose={close}
      label={DESK.code.title}
      size="cbm"
      tile="ticket"
      title={DESK.code.title}
      lead={DESK.code.lead}
    >
      <div className={c("cbstage", cls)}>
        <div className={c("cbtop")}>
          <span className={c("cbpill")}>
            <i aria-hidden="true" />
            {DESK.code.scanner}
          </span>
          <span>{ctx.rows.filter((r) => r.stage === "expected").length} still expected today</span>
        </div>
        <div className={c("cbwrap")}>
          <input
            autoFocus
            className={c("cbin")}
            type="text"
            maxLength={9}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={raw}
            onChange={(e) => setRaw(codeInput(e.target.value))}
            onKeyDown={(e) => e.key === "Enter" && row && go()}
            aria-label={DESK.code.title}
            aria-describedby="desk-cbh"
          />
          <div className={c("cbs")} aria-hidden="true">
            {[0, 1, 2].map(box)}
            <em />
            {[3, 4, 5].map(box)}
          </div>
        </div>
        <p className={c("cbh", cls)} id="desk-cbh" aria-live="polite">
          {hint}
        </p>
      </div>
      {row ? (
        <>
          <div className={c("cbp")}>
            <span className={c("av", "xl")} aria-hidden="true">
              {initials(row.name)}
            </span>
            <div className={c("cbpt")}>
              <b>{row.name}</b>
              <span>
                {whoOf(row)} · {row.pno}
              </span>
              <span className={c("kl")}>
                <i style={{ background: ctx.clinic(row.clinic).hue }} />
                {ctx.clinic(row.clinic).name} · {row.time ? `booked ${row.time}` : "today"}
              </span>
            </div>
            <span className={c("fee", row.fee ? row.paid && "paid" : "none")}>
              {row.fee ? (row.paid ? DESK.row.fee.paid : DESK.row.fee.notPaid) : DESK.row.fee.none}
            </span>
          </div>
          <p className={c("cbh", row.stage === "notseen" && "bad")}>{state(row)}</p>
        </>
      ) : null}
      {!code && recent.length ? (
        <div className={c("cbrec")}>
          <span>{DESK.code.recent}</span>
          {recent.map((r) => (
            <button
              key={r.id}
              type="button"
              className={c("cbr")}
              onClick={() => {
                close();
                openRow(r.id, false);
              }}
            >
              <span className={c("av", "sm")}>{initials(r.name)}</span>
              <span className={c("cbrn")}>
                <b>{r.name}</b>
                <span>
                  {ctx.clinic(r.clinic).name} · arrived {r.arr}
                </span>
              </span>
              <Icon n="right" size={14} w={2} />
            </button>
          ))}
        </div>
      ) : null}
      <div className={c("mf")}>
        <span className={c("grow")} />
        {done && !row && !bad ? (
          <>
            <button type="button" className={c("btn")} onClick={close}>
              {DESK.code.searchName}
            </button>
            <button type="button" className={c("btn")} onClick={toWalk}>
              {DESK.arrivals.registerWalkIn}
            </button>
          </>
        ) : null}
        {row && row.stage === "expected" ? (
          <button type="button" className={c("btn", "k")} onClick={go}>
            {DESK.code.go}
          </button>
        ) : null}
        {row && row.stage !== "expected" ? (
          <button type="button" className={c("btn")} onClick={go}>
            {DESK.arrivals.act.open}
          </button>
        ) : null}
      </div>
    </DeskDialog>
  );
}

/* ─── close the day (D-RD-12) ─── */
function CloseDayDialog({
  open,
  ctx,
  close,
  setTab,
}: {
  open: boolean;
  ctx: DeskCtx;
  close: () => void;
  setTab: (t: "notseen") => void;
}) {
  const [off, setOff] = useState<Record<string, boolean>>({});
  const notArr = ctx.rows.filter((r) => r.stage === "expected");
  const waiting = ctx.rows.filter((r) => r.stage === "here");
  const chosen = notArr.filter((r) => !off[r.id]);
  const arrived = ctx.rows.filter((r) => r.stage !== "expected" && r.stage !== "notseen").length;
  return (
    <DeskDialog
      open={open}
      onClose={close}
      label={DESK.closeDay.title}
      tile="calendar"
      title={DESK.closeDay.title}
      lead={fill(DESK.ui.allClinics, { day: fmtDay(ctx.today) })}
    >
      <span className={c("cap")}>{fill(DESK.closeDay.neverArrived, { n: notArr.length })}</span>
      {notArr.map((r) => (
        <label key={r.id} className={c("cbx")}>
          <input
            type="checkbox"
            checked={!off[r.id]}
            onChange={() => setOff((o) => ({ ...o, [r.id]: !o[r.id] }))}
          />
          <span>
            {r.name} · {ctx.clinic(r.clinic).name} · mark no-show
          </span>
        </label>
      ))}
      {notArr.length === 0 ? <p className={c("note")}>{DESK.closeDay.allArrived}</p> : null}
      <span className={c("cap")}>{fill(DESK.closeDay.waiting, { n: waiting.length })}</span>
      {waiting.map((r) => (
        <div key={r.id} className={c("pick")}>
          <span>
            <b>{r.name}</b>
            <span className={c("mt")}>{ctx.clinic(r.clinic).name}</span>
          </span>
        </div>
      ))}
      <div className={c("say")}>
        Today so far: {arrived} arrived · {ctx.rows.filter((r) => r.stage === "done").length} seen ·{" "}
        {chosen.length} will be marked no-show.
      </div>
      <div className={c("mf")}>
        <span className={c("grow")} />
        <button type="button" className={c("btn")} onClick={close}>
          {DESK.closeDay.notYet}
        </button>
        <button
          type="button"
          className={c("btn", "k")}
          onClick={async () => {
            const res = await ctx.port.closeDay(chosen);
            if (!res.ok) return ctx.say(res.error);
            const ids = new Set(chosen.map((r) => r.id));
            const before = ctx.rows;
            ctx.setRows((rs) => rs.map((r) => (ids.has(r.id) ? { ...r, stage: "notseen" } : r)));
            close();
            setTab("notseen");
            ctx.say(fill(DESK.closeDay.done, { n: chosen.length }), async () => {
              const u = await ctx.port.undoCloseDay(res.closureId);
              if (u.ok) ctx.setRows(() => before);
              else ctx.say(u.error);
            });
          }}
        >
          {DESK.closeDay.title}
        </button>
      </div>
    </DeskDialog>
  );
}

/* ─── running late (D-RD-11: lateness only; the engine texts at 30 min or more) ─── */
function LateDialog({
  open,
  sessionKey,
  ctx,
  close,
  saved,
}: {
  open: boolean;
  sessionKey?: string;
  ctx: DeskCtx;
  close: () => void;
  saved: (key: string, m: number) => void;
}) {
  const [m, setM] = useState(30);
  const se = sessionKey ? ctx.data.sessions.find((x) => x.key === sessionKey) : undefined;
  const name = se ? ctx.clinic(se.id).name : "";
  return (
    <DeskDialog
      open={open}
      onClose={close}
      label={DESK.late.title}
      tile="clock"
      title={fill(DESK.ui.lateTitle, { name })}
      lead="Today"
    >
      <Chips
        items={LATE.map(([l, v]) => [String(v), l] as const)}
        value={String(m)}
        onPick={(v) => setM(Number(v))}
        label={DESK.late.title}
      />
      <p className={c("note")}>{m >= 30 ? DESK.ui.lateTexted : DESK.ui.lateNoText}</p>
      <div className={c("mf")}>
        <span className={c("grow")} />
        <button type="button" className={c("btn")} onClick={close}>
          {DESK.book.cancel}
        </button>
        <button
          type="button"
          className={c("btn", "k")}
          onClick={async () => {
            if (!se) return;
            const res = await ctx.port.runningLate(se.sessionId, m);
            if (!res.ok) return ctx.say(res.error);
            saved(se.key, m);
            ctx.say(fill(DESK.late.done, { clinic: name, n: m }));
          }}
        >
          {DESK.late.save}
        </button>
      </div>
    </DeskDialog>
  );
}

/* ─── move / cancel (ADR 0473) ─── */
function MoveCancel({
  kind,
  r,
  ctx,
  close,
  done,
}: {
  kind: "move" | "cancel" | null;
  r: DeskRow;
  ctx: DeskCtx;
  close: () => void;
  done: () => DeskRow[];
}) {
  const [key, setKey] = useState("");
  const [why, setWhy] = useState("");
  const k = ctx.clinic(r.clinic);
  const days = ctx.data.sessions
    .filter((x) => x.id === r.clinic && x.date > ctx.today && x.docs.length && x.booked < x.cap)
    .slice(0, 5);
  if (kind === "move")
    return (
      <DeskDialog
        open
        onClose={close}
        label={fill(DESK.move.title, { name: r.name })}
        tile="calendar"
        title={fill(DESK.move.title, { name: r.name })}
        lead={k.name}
      >
        <span className={c("cap")}>{DESK.move.another}</span>
        <div className={c("hs")}>
          {days.map((d) => (
            <button
              key={d.key}
              type="button"
              className={c("chip", key === d.key && "on")}
              aria-pressed={key === d.key}
              onClick={() => setKey(d.key)}
            >
              {fmtDay(d.date)} <small>{d.cap - d.booked} left</small>
            </button>
          ))}
        </div>
        <span className={c("cap")}>Why</span>
        <Chips items={DESK.move.reasons} value={why} onPick={setWhy} />
        <div className={c("mf")}>
          {!(key && why) ? <span className={c("why")}>{DESK.move.pick}</span> : null}
          <span className={c("grow")} />
          <button
            type="button"
            className={c("btn", "k")}
            disabled={!(key && why)}
            onClick={async () => {
              const res = await ctx.port.move(r, key, why);
              if (!res.ok) return ctx.say(res.error);
              done();
              ctx.say(fill(DESK.move.done, { name: r.name, day: fmtDay(key.split("|")[0]!) }));
            }}
          >
            {DESK.move.go}
          </button>
        </div>
      </DeskDialog>
    );
  if (kind === "cancel")
    return (
      <DeskDialog
        open
        onClose={close}
        label={fill(DESK.cancel.title, { name: r.name })}
        tile="calendar"
        title={fill(DESK.cancel.title, { name: r.name })}
        lead={k.name}
      >
        <span className={c("cap")}>Why</span>
        <Chips items={DESK.cancel.reasons} value={why} onPick={setWhy} />
        <p className={c("note")}>{DESK.cancel.lead}</p>
        <div className={c("mf")}>
          {!why ? <span className={c("why")}>{DESK.cancel.pick}</span> : null}
          <span className={c("grow")} />
          <button type="button" className={c("btn")} onClick={close}>
            {DESK.cancel.keep}
          </button>
          <button
            type="button"
            className={c("btn", "k")}
            disabled={!why}
            onClick={async () => {
              const res = await ctx.port.cancel(r, why);
              if (!res.ok) return ctx.say(res.error);
              done();
              ctx.say(fill(DESK.cancel.done, { name: r.name }));
            }}
          >
            {DESK.cancel.go}
          </button>
        </div>
      </DeskDialog>
    );
  return null;
}

/* ─── slip ─── */
export function SlipCard({
  slip,
  hospital,
  pending,
}: {
  slip: SlipData;
  hospital: string;
  pending?: boolean;
}) {
  return (
    <div className={c("slip")}>
      <div className={c("slh")}>
        <b>{hospital}</b>
        <span>
          {slip.kind} · {slip.when}
        </span>
      </div>
      <div className={c("sln", !slip.name && "miss")}>{slip.name || DESK.slip.noName}</div>
      <div className={c("slc")}>
        <span>{DESK.slip.code}</span>
        <b className={c("mono")}>{pending ? DESK.slip.pending : codeSpoken(slip.code)}</b>
      </div>
      <div className={c("slg")}>
        <div>
          <span>{DESK.panel.clinic}</span>
          <b>{slip.clinic}</b>
        </div>
        <div>
          <span>{DESK.slip.goTo}</span>
          <b>{slip.go}</b>
        </div>
      </div>
      <p className={c("slf")}>{DESK.slip.line}</p>
      <p className={c("slp")}>
        {DESK.poweredBy} {DESK.tether}
      </p>
    </div>
  );
}

function SlipDialog({
  open,
  slip,
  hospital,
  close,
  say,
}: {
  open: boolean;
  slip: SlipData | null;
  hospital: string;
  close: () => void;
  say: DeskCtx["say"];
}) {
  if (!slip) return null;
  return (
    <DeskDialog
      open={open}
      onClose={close}
      label="Walk-in slip"
      size="slm"
      tile="print"
      title={`${slip.name} is registered`}
      lead={DESK.slip.title}
    >
      <SlipCard slip={slip} hospital={hospital} />
      <div className={c("mf")}>
        {slip.phone ? (
          <button
            type="button"
            className={c("btn")}
            onClick={() => say(fill(DESK.slip.texted, { phone: slip.phone! }))}
          >
            {DESK.slip.textToo}
          </button>
        ) : null}
        <span className={c("grow")} />
        <button type="button" className={c("btn")} onClick={close}>
          {DESK.book.done}
        </button>
        <button
          type="button"
          className={c("btn", "k")}
          onClick={() => {
            window.print();
            close();
          }}
        >
          {DESK.slip.print}
        </button>
      </div>
    </DeskDialog>
  );
}

/* ─── who is at the desk (ADR 0489) ─── */
function UserDialog({
  open,
  ctx,
  user,
  close,
  switched,
}: {
  open: boolean;
  ctx: DeskCtx;
  user: { id: string; name: string };
  close: () => void;
  switched: (u: { id: string; name: string }) => void;
}) {
  const [pick, setPick] = useState(user.id);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  return (
    <DeskDialog
      open={open}
      onClose={close}
      label={DESK.user.title}
      tile="swap"
      title={DESK.user.title}
      lead={DESK.user.lead}
    >
      {ctx.data.deskUsers.map((u) => (
        <button
          key={u.id}
          type="button"
          className={c("pick", pick === u.id && "on")}
          onClick={() => setPick(u.id)}
        >
          <span className={c("av")}>{initials(u.name)}</span>
          <b>{u.name}</b>
          <span className={c("r")}>{u.id === user.id ? "At the desk now" : ""}</span>
        </button>
      ))}
      <div className={c("frow")}>
        <label htmlFor="desk-pin">{DESK.user.pin}</label>
        <input
          id="desk-pin"
          className={c("fin")}
          type="password"
          inputMode="numeric"
          maxLength={4}
          placeholder="••••"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        />
      </div>
      {err ? (
        <p className={c("note")} role="alert">
          <b>{err}</b>
        </p>
      ) : null}
      <div className={c("mf")}>
        <span className={c("note")}>{DESK.user.lock}</span>
        <span className={c("grow")} />
        <button
          type="button"
          className={c("btn", "k")}
          onClick={async () => {
            const res = await ctx.port.unlock(pick, pin);
            if (!res.ok) return setErr(res.error);
            if (res.result === "ok") {
              const u = ctx.data.deskUsers.find((x) => x.id === pick)!;
              switched(u);
              close();
              ctx.say(fill(DESK.ui.atDesk, { name: u.name.split(" ")[0] ?? u.name }));
            } else
              setErr(
                res.result === "locked"
                  ? DESK.user.locked
                  : res.result === "no_pin"
                    ? DESK.ui.noPin
                    : fill(DESK.user.wrong, { n: "a few" }),
              );
          }}
        >
          {DESK.user.go}
        </button>
      </div>
    </DeskDialog>
  );
}
