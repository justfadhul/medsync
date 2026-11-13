"use client";

import type { DeskCtx } from "./desk";
import type { AgeInput, AgeMode, DeskRow, DeskSession } from "@/lib/reception/desk/model";
import { useState } from "react";

import { Ticket } from "@/components/landing/tether/ticket";
import { fill } from "@/content/lab-workspace-v2";
import { DESK } from "@/content/reception/desk";
import { TICKET } from "@/content/tether-landing/copy";
import {
  addDays,
  ageOf,
  clinicRouteAllowed,
  codeSpoken,
  fmtDay,
  hhmm,
  initials,
  whoOf,
} from "@/lib/reception/desk/model";
import { SlipCard } from "./desk-dialogs";
import { c, Chips, DeskDialog, Icon } from "./ui";

export interface SlipData {
  kind: string;
  when: string;
  name: string;
  code: string;
  clinic: string;
  go: string;
  phone?: string;
}

type Person = DeskCtx["data"]["directory"][number];
const ugx = (n: number) => `UGX ${n.toLocaleString("en-US")}`;
const AG = DESK.age;

/* ─── shared fields ─── */
function AgeField({ v, set }: { v: AgeInput; set: (p: Partial<AgeInput>) => void }) {
  const r = ageOf(v, kampalaToday());
  const num = (k: keyof AgeInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set({ [k]: e.target.value.replace(/\D/g, "") });
  return (
    <div className={c("agebx")}>
      <Chips<AgeMode>
        items={[
          ["year", AG.modes.year],
          ["date", AG.modes.date],
          ["age", AG.modes.age],
        ]}
        value={v.mode}
        onPick={(mode) => set({ mode })}
        label={DESK.walkIn.age}
      />
      {v.mode === "year" ? (
        <input
          className={c("fin")}
          type="text"
          inputMode="numeric"
          maxLength={4}
          placeholder="Year of birth, e.g. 1990"
          value={v.yob ?? ""}
          onChange={num("yob")}
          aria-label={AG.modes.year}
        />
      ) : v.mode === "date" ? (
        <div className={c("dob")}>
          <input
            className={c("fin")}
            type="text"
            inputMode="numeric"
            maxLength={2}
            placeholder={AG.day}
            value={v.dd ?? ""}
            onChange={num("dd")}
            aria-label="Day"
          />
          <input
            className={c("fin")}
            type="text"
            inputMode="numeric"
            maxLength={2}
            placeholder={AG.monthPh}
            value={v.mm ?? ""}
            onChange={num("mm")}
            aria-label="Month"
          />
          <input
            className={c("fin")}
            type="text"
            inputMode="numeric"
            maxLength={4}
            placeholder={AG.yearPh}
            value={v.yy ?? ""}
            onChange={num("yy")}
            aria-label="Year"
          />
        </div>
      ) : (
        <input
          className={c("fin")}
          type="text"
          inputMode="numeric"
          maxLength={3}
          placeholder="Age in years"
          value={v.ag ?? ""}
          onChange={num("ag")}
          aria-label={AG.modes.age}
        />
      )}
      <p className={c("agep", r.err ? "err" : r.ok && "ok")} aria-live="polite">
        {r.txt}
      </p>
    </div>
  );
}

/** Kampala's calendar date for the age rules (an adult is 18 by the desk's own day). */
function kampalaToday() {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kampala" })
    .format(new Date())
    .split("-")
    .map(Number);
  return { y: y!, m: m!, d: d! };
}

function Phone({
  cc,
  setCc,
  value,
  set,
  placeholder,
  id,
}: {
  cc: string;
  setCc: (v: string) => void;
  value: string;
  set: (v: string) => void;
  placeholder: string;
  id?: string;
}) {
  const i = Math.max(
    0,
    DESK.countries.findIndex(([, code]) => code === cc),
  );
  const [iso, code] = DESK.countries[i]!;
  return (
    <div className={c("phn")}>
      <button
        type="button"
        className={c("ccode")}
        onClick={() => setCc(DESK.countries[(i + 1) % DESK.countries.length]![1])}
        aria-label={`Country code ${code}, tap to change`}
        title="Tap to change country"
      >
        <small>{iso}</small>
        {code}
        <Icon n="down" size={12} w={2.2} />
      </button>
      <input
        id={id}
        className={c("fin")}
        type="tel"
        inputMode="tel"
        placeholder={placeholder}
        value={value}
        onChange={(e) => set(e.target.value)}
        aria-label={DESK.walkIn.phone}
      />
    </div>
  );
}

const findPeople = (dir: Person[], q: string) => {
  const qq = q.toLowerCase().replace(/\s/g, "");
  if (qq.length < 2) return [];
  return dir
    .filter(
      (p) =>
        p.phone.replace(/\s/g, "").includes(qq) ||
        p.pno.toLowerCase().includes(qq) ||
        p.name.toLowerCase().replace(/\s/g, "").includes(qq),
    )
    .slice(0, 3);
};
const who = (p: Person) => `${p.sex === "F" ? "Female" : "Male"} · ${p.age}`;
const dobOf = (v: AgeInput) =>
  v.mode === "date" && v.dd && v.mm && v.yy
    ? `${v.yy}-${v.mm.padStart(2, "0")}-${v.dd.padStart(2, "0")}`
    : v.mode === "year" && v.yob
      ? `${v.yob}-07-01`
      : null;

/* ─── walk-in, and registering an emergency patient later ─── */
export function WalkInDialog({
  open,
  ctx,
  regFor,
  close,
  toEmergency,
  done,
}: {
  open: boolean;
  ctx: DeskCtx;
  regFor: DeskRow | null;
  close: () => void;
  toEmergency: (name: string) => void;
  done: (slip: SlipData, row: Partial<DeskRow> & { name: string }) => void;
}) {
  const W = DESK.walkIn;
  const blank = {
    danger: [] as string[],
    safeOk: false,
    q: "",
    pick: null as Person | null,
    name: "",
    phone: "",
    cc: "+256",
    age: { mode: "year" } as AgeInput,
    sex: "" as "" | "F" | "M",
    idNo: "",
    clinic: "",
    reason: "",
    note: "",
    route: "triage" as "triage" | "clinic",
    needs: [] as string[],
    err: "",
    busy: false,
  };
  const [v, setV] = useState(() => ({
    ...blank,
    name: regFor && regFor.name !== DESK.row.noName ? regFor.name : "",
  }));
  const set = (p: Partial<typeof blank>) => setV((x) => ({ ...x, ...p, err: "" }));

  const em = !!regFor;
  const todayS = ctx.sessionsOn(ctx.today, true);
  const se = todayS.find((x) => x.id === v.clinic);
  const waitN = (id: string) =>
    ctx.rows.filter((r) => r.clinic === id && (r.stage === "here" || r.stage === "nurse")).length;
  const waitTxt = (id: string) => {
    const m = Math.max(10, waitN(id) * 8);
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  };
  const dangerYes = v.danger.length > 0;
  const matches = findPeople(ctx.data.directory, v.q);
  const digits = v.phone.replace(/\D/g, "").replace(/^0+/, "");
  const dup =
    !v.pick && digits.length >= 9
      ? ctx.data.directory.find((p) => p.phone.replace(/\D/g, "").replace(/^0+/, "") === digits)
      : undefined;
  const fee = se ? ctx.clinic(se.id).fee : 0;
  const direct = clinicRouteAllowed(v.reason);
  const missing = [
    !em && !dangerYes && !v.safeOk && "the safety check",
    !v.pick && !v.name.trim() && "their name",
    !v.pick && !v.sex && "female or male",
    !em && !v.clinic && "a clinic",
  ].filter(Boolean) as string[];
  const age = ageOf(v.age, kampalaToday());
  const sorted = todayS
    .slice()
    .sort(
      (a, b) =>
        Number(!!ctx.data.mine.includes(b.id)) - Number(!!ctx.data.mine.includes(a.id)) ||
        ctx.clinic(a.id).name.localeCompare(ctx.clinic(b.id).name),
    );
  const slipName = v.pick ? v.pick.name : v.name.trim();
  const now = hhmm(ctx.nowHour);
  const go = em
    ? DESK.nav.emergency
    : v.route === "clinic" && direct
      ? W.routes.clinic
      : DESK.arrivals.filters.triageFirst;

  const save = async () => {
    if (dangerYes) return set({ err: W.emergencyFirst });
    if (missing.length)
      return set({ err: fill(W.stillNeeded, { list: missing.join(", ") }) + "." });
    if (!v.pick && age.err)
      return set({ err: age.txt + (age.txt === AG.under18 ? ` ${AG.paper}` : "") });
    setV((x) => ({ ...x, busy: true }));
    const phone = v.pick
      ? v.pick.phone
      : v.phone.trim()
        ? `${v.cc} ${v.phone.trim().replace(/^0+/, "")}`
        : "";
    const res = await ctx.port.walkIn({
      pickId: v.pick?.id ?? null,
      name: slipName,
      phone,
      dateOfBirth: v.pick ? null : (age.dob ?? dobOf(v.age)),
      ageOnly: v.pick || v.age.mode !== "age" ? null : (age.age ?? null),
      sex: v.pick ? v.pick.sex : v.sex || null,
      clinic: em ? "em" : v.clinic,
      route: v.route === "clinic" && direct ? "clinic" : "triage",
      reason: v.reason,
      note: v.note,
    });
    setV((x) => ({ ...x, busy: false }));
    if (!res.ok) return set({ err: res.error });
    const row: Partial<DeskRow> & { name: string } = {
      id: `w-${res.code}`,
      appointmentId: null,
      intakeId: null,
      clinic: em ? "em" : v.clinic,
      name: slipName,
      sex: v.pick ? v.pick.sex : (v.sex as "F" | "M"),
      age: v.pick ? v.pick.age : (age.age ?? null),
      pno: v.pick ? v.pick.pno : res.pno,
      code: res.code,
      time: "",
      doc: se?.docs[0] ?? "Clinic team",
      stage: "here",
      route: em ? "emergency" : v.route === "clinic" && direct ? "clinic" : "triage",
      arr: now,
      flag: ctx.offline ? "queued" : !v.pick && v.age.mode === "age" ? "idc" : undefined,
      reason: v.reason || v.note,
      ownWords: !!v.note && !v.reason,
      fee,
      paid: false,
      go: { st: "here" },
    };
    done(
      {
        kind: "Walk-in",
        when: `${fmtDay(ctx.today)} · ${now}`,
        name: slipName,
        code: res.code,
        clinic: se ? ctx.clinic(se.id).name : DESK.nav.emergency,
        go,
        phone: phone || undefined,
      },
      row,
    );
  };

  return (
    <DeskDialog
      open={open}
      onClose={close}
      label={W.title}
      size="xw"
      tile="walk"
      title={em ? DESK.emergency.registerTitle : W.title}
      lead={em ? DESK.emergency.registerLead : W.lead}
    >
      <div className={c("bk2")}>
        <div className={c("bkf")}>
          {!em ? (
            <section className={c("bks", "wkSafe", dangerYes ? "hot" : v.safeOk && "ok")}>
              <h3>
                <i>1</i>
                {W.safety}
              </h3>
              <p className={c("ask")}>{W.safetyAsk}</p>
              <Chips
                items={DESK.dangerSigns}
                value={v.danger}
                multi
                onPick={(x) =>
                  set({
                    danger: v.danger.includes(x)
                      ? v.danger.filter((d) => d !== x)
                      : [...v.danger, x],
                    safeOk: false,
                  })
                }
                extra={
                  <button
                    type="button"
                    className={c("chip", v.safeOk && "on")}
                    aria-pressed={v.safeOk}
                    onClick={() => set({ danger: [], safeOk: !v.safeOk })}
                  >
                    {DESK.book.noneOfThese}
                  </button>
                }
              />
              {dangerYes ? (
                <div className={c("dangerbox")} role="alert">
                  <b>{W.stop}</b> {W.stopLine}{" "}
                  <button
                    type="button"
                    className={c("btn", "sm", "r")}
                    onClick={() => toEmergency(slipName)}
                  >
                    {W.sendEmergency}
                  </button>
                </div>
              ) : null}
              <p className={c("note")}>{DESK.book.waitingSignOff}</p>
            </section>
          ) : null}

          <section className={c("bks")}>
            <h3>
              <i>{em ? 1 : 2}</i>
              {W.who}
            </h3>
            {!v.pick ? (
              <>
                <div className={c("wkFind")}>
                  <Icon n="search" size={16} w={2} />
                  <input
                    className={c("fin")}
                    type="text"
                    autoComplete="off"
                    placeholder={W.find}
                    value={v.q}
                    onChange={(e) => set({ q: e.target.value })}
                    aria-label={W.find}
                  />
                </div>
                {matches.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={c("pick")}
                    onClick={() => set({ pick: p, q: "" })}
                  >
                    <span className={c("av", "sm")}>{initials(p.name)}</span>
                    <span>
                      <b>{p.name}</b>
                      <span className={c("mt")}>
                        {who(p)} · {p.phone} · {p.pno}
                      </span>
                    </span>
                    <span className={c("r")}>{W.use}</span>
                  </button>
                ))}
                {v.q.replace(/\s/g, "").length >= 2 && !matches.length ? (
                  <p className={c("note")}>{W.notFound}</p>
                ) : null}
                <div className={c("wkOr")}>
                  <span>{W.newPatient}</span>
                </div>
                <div className={c("form")}>
                  <div className={c("frow")}>
                    <label htmlFor="desk-wn">{W.fullName}</label>
                    <input
                      id="desk-wn"
                      className={c("fin")}
                      type="text"
                      value={v.name}
                      onChange={(e) => set({ name: e.target.value })}
                    />
                  </div>
                  <div className={c("frow")}>
                    <label htmlFor="desk-wp">{W.phone}</label>
                    <Phone
                      id="desk-wp"
                      cc={v.cc}
                      setCc={(cc) => set({ cc })}
                      value={v.phone}
                      set={(phone) => set({ phone })}
                      placeholder="772 418 900"
                    />
                  </div>
                  <div className={c("frow")}>
                    <span>{W.age}</span>
                    <AgeField v={v.age} set={(p) => set({ age: { ...v.age, ...p } })} />
                  </div>
                  <div className={c("frow")}>
                    <span>{W.sex}</span>
                    <Chips<"F" | "M">
                      items={[
                        ["F", W.sexes[0]],
                        ["M", W.sexes[1]],
                      ]}
                      value={v.sex}
                      onPick={(sex) => set({ sex })}
                      label={W.sex}
                    />
                  </div>
                  <div className={c("frow")}>
                    <label htmlFor="desk-wid">{W.id}</label>
                    <input
                      id="desk-wid"
                      className={c("fin")}
                      type="text"
                      placeholder="National ID or any card"
                      value={v.idNo}
                      onChange={(e) => set({ idNo: e.target.value })}
                    />
                  </div>
                </div>
                {dup ? (
                  <div className={c("warnbox")}>
                    <b>{fill(W.dupTitle, { name: dup.name })}</b> {W.dupLine}{" "}
                    <button
                      type="button"
                      className={c("btn", "sm")}
                      onClick={() => set({ pick: dup })}
                    >
                      {fill(W.dupUse, { name: dup.name })}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className={c("pick", "on")}>
                  <span className={c("av", "sm")}>{initials(v.pick.name)}</span>
                  <span>
                    <b>{v.pick.name}</b>
                    <span className={c("mt")}>
                      {fill(W.returning, {
                        name: who(v.pick),
                        phone: v.pick.phone,
                        pno: v.pick.pno,
                      })}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={c("btn", "sm", "q", "r")}
                    onClick={() => set({ pick: null })}
                  >
                    {DESK.book.change}
                  </button>
                </div>
                <p className={c("note")}>{W.returningLine}</p>
              </>
            )}
          </section>

          {!em ? (
            <>
              <section className={c("bks")}>
                <h3>
                  <i>3</i>
                  {W.clinic}
                </h3>
                <div className={c("wkCls")}>
                  {sorted.map((x) => {
                    const k = ctx.clinic(x.id);
                    const left = Math.max(0, x.cap - x.booked);
                    const onC = v.clinic === x.id;
                    return (
                      <button
                        key={x.key}
                        type="button"
                        className={c("wkCl", onC && "on")}
                        aria-pressed={onC}
                        onClick={() => set({ clinic: x.id })}
                      >
                        <span className={c("wkCt")}>
                          <i style={{ background: k.hue }} />
                          <b>{k.name}</b>
                          <span>
                            {k.fee ? `UGX ${Math.round(k.fee / 1000)}k` : DESK.row.fee.none}
                          </span>
                        </span>
                        <span className={c("wkCm")}>
                          <span>
                            <b>{waitN(x.id)}</b> {W.waiting}
                          </span>
                          <span>
                            about <b>{waitTxt(x.id)}</b>
                          </span>
                        </span>
                        <span className={c("wkCd")}>
                          {x.docs.join(", ") || DESK.calendar.noDoctorYet} · until {hhmm(x.en)}
                        </span>
                        <span className={c("wkCc", !left && "full")}>
                          {left ? `${left} places left` : W.full}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className={c("note")}>{W.clinicNote}</p>
              </section>

              <section className={c("bks")}>
                <h3>
                  <i>4</i>
                  {W.reason}
                </h3>
                <Chips
                  items={W.reasons}
                  value={v.reason}
                  onPick={(x) =>
                    set({
                      reason: v.reason === x ? "" : x,
                      route: clinicRouteAllowed(x) && v.reason !== x ? v.route : "triage",
                    })
                  }
                />
                <input
                  className={c("fin")}
                  type="text"
                  placeholder="In their words (optional)"
                  value={v.note}
                  onChange={(e) => set({ note: e.target.value })}
                  aria-label="Reason in their words"
                />
                <p className={c("sublbl")}>{W.sendTo}</p>
                <div className={c("wkRt")}>
                  {(
                    [
                      ["triage", W.routes.triage, W.routes.triageLine, false],
                      [
                        "clinic",
                        W.routes.clinic,
                        direct ? W.routes.clinicLine : W.routes.locked,
                        !direct,
                      ],
                    ] as const
                  ).map(([k, l, sub, off]) => (
                    <button
                      key={k}
                      type="button"
                      className={c("wkR", v.route === k && "on")}
                      aria-pressed={v.route === k}
                      disabled={off}
                      onClick={() => set({ route: k })}
                    >
                      <b>{l}</b>
                      <span>{sub}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className={c("bks")}>
                <h3>
                  <i>5</i>
                  {W.payment}
                </h3>
                <div className={c("feeline")}>
                  <span>
                    {fill(W.feeFor, { clinic: se ? ctx.clinic(se.id).name : "the clinic" })}
                  </span>
                  <b>{se ? (fee ? ugx(fee) : DESK.row.fee.none) : DESK.book.missing.clinic}</b>
                </div>
                {fee ? <p className={c("note")}>{W.cashOfficeLine}</p> : null}
                <p className={c("sublbl")}>{W.needs}</p>
                <Chips
                  items={W.needList}
                  value={v.needs}
                  multi
                  onPick={(x) =>
                    set({
                      needs: v.needs.includes(x) ? v.needs.filter((n) => n !== x) : [...v.needs, x],
                    })
                  }
                />
              </section>
            </>
          ) : null}
        </div>

        <aside className={c("bksum")}>
          <p className={c("cap")}>{em ? W.record : W.slipLive}</p>
          {!em ? (
            <div className={c("wkStaff")}>
              <span>{W.staffWait}</span>
              <b>
                {se
                  ? `${ctx.clinic(se.id).short}: ${waitN(se.id)} waiting · about ${waitTxt(se.id)}`
                  : DESK.book.missing.clinic}
              </b>
              <em>{W.staffWaitLine}</em>
            </div>
          ) : null}
          <SlipCard
            slip={{
              kind: em ? DESK.nav.emergency : W.title,
              when: `${fmtDay(ctx.today)} · ${now}`,
              name: slipName,
              code: "",
              clinic: em ? DESK.nav.emergency : se ? ctx.clinic(se.id).name : "—",
              go,
            }}
            hospital={ctx.data.hospitalName}
            pending
          />
          {v.err ? (
            <p className={c("err")} role="alert">
              {v.err}
            </p>
          ) : null}
          <p className={c("why")}>
            {missing.length
              ? fill(W.stillNeeded, { list: missing.join(", ") }) + "."
              : em
                ? W.readySave
                : W.ready}
          </p>
          <div className={c("acts")}>
            <button type="button" className={c("btn")} onClick={close}>
              {W.cancel}
            </button>
            <button
              type="button"
              className={c("btn", "k", "grow")}
              onClick={save}
              disabled={missing.length > 0 || dangerYes || v.busy}
            >
              {em ? W.save : W.submit}
            </button>
          </div>
        </aside>
      </div>
    </DeskDialog>
  );
}

/* ─── book for a caller ─── */
const slotTimes = (se: DeskSession) => {
  const out: string[] = [];
  for (let h = se.st; h < se.en - 1e-6; h += 1 / 3) out.push(hhmm(h));
  return out.filter((t) => !(se.taken && t in se.taken));
};

export function BookDialog({
  open,
  ctx,
  preset,
  close,
}: {
  open: boolean;
  ctx: DeskCtx;
  preset?: { clinic: string; key: string; slot: string };
  close: () => void;
}) {
  const B = DESK.book;
  const blank = {
    forWho: "self" as "self" | "other",
    callerName: "",
    callerPhone: "",
    callerCc: "+256",
    rel: "",
    cq: "",
    person: null as Person | null,
    isNew: false,
    nc: { name: "", phone: "", cc: "+256", age: { mode: "year" } as AgeInput },
    ncErr: "",
    newPerson: null as null | {
      name: string;
      phone: string;
      dob: string | null;
      ageOnly: number | null;
      who: string;
    },
    reason: "",
    note: "",
    danger: [] as string[],
    clinic: "",
    key: "",
    slot: "",
    doc: "any",
    rem: true,
    needs: [] as string[],
    cnote: "",
    code: "",
    busy: false,
    err: "",
  };
  const [v, setV] = useState(() => ({
    ...blank,
    clinic: preset?.clinic ?? "",
    key: preset?.key ?? "",
    slot: preset?.slot ?? "",
  }));
  const set = (p: Partial<typeof blank>) => setV((x) => ({ ...x, ...p }));
  const [flip, setFlip] = useState(false);

  if (ctx.offline && !v.code)
    return (
      <DeskDialog
        open={open}
        onClose={close}
        label={B.title}
        tile="phone"
        title={B.title}
        lead={B.lead}
      >
        <div className={c("stepbox")}>
          <b>{B.offline}</b>
          <p className={c("note")}>{B.offlineLine}</p>
        </div>
      </DeskDialog>
    );

  const matches = findPeople(ctx.data.directory, v.cq);
  const days: DeskSession[] = [];
  if (v.clinic)
    for (let i = 0; i < 21 && days.length < 8; i++) {
      const se = ctx.data.sessions.find(
        (x) => x.date === addDays(ctx.today, i) && x.id === v.clinic,
      );
      if (se) days.push(se);
    }
  const se = days.find((x) => x.key === v.key);
  const needSlot = se?.kind === "times";
  const dangerYes = v.danger.length > 0;
  const newProb = v.reason === B.reasons[5];
  const otherOk = v.forWho !== "other" || !!v.callerName.trim();
  const personName = v.person?.name ?? v.newPerson?.name ?? "";
  const hasPerson = !!(v.person || v.newPerson);
  const dup = v.person
    ? ctx.rows.find((r) => r.name === v.person!.name && r.stage === "expected")
    : undefined;
  const ready = hasPerson && !!se && (!needSlot || !!v.slot) && !!v.reason && !dangerYes && otherOk;
  const fee = v.clinic ? ctx.clinic(v.clinic).fee : 0;
  const why = dangerYes
    ? B.missing.danger
    : !otherOk
      ? B.missing.caller
      : !hasPerson
        ? B.missing.patient
        : !v.reason
          ? B.missing.reason
          : !v.clinic
            ? B.missing.clinic
            : !se
              ? B.missing.day
              : B.missing.time;
  const reasonShort =
    v.reason === B.reasons[5]
      ? "a new problem"
      : v.reason === B.reasons[0]
        ? "a review"
        : v.reason.toLowerCase();
  const readBack = ready
    ? fill(needSlot ? B.readBackSlot : B.readBackLine, {
        name: personName,
        clinic: ctx.clinic(v.clinic).name,
        reason: reasonShort,
        day: fmtDay(se!.date),
        time: needSlot ? v.slot : hhmm(se!.st),
      }) + (fee ? ` The fee is ${ugx(fee)}, paid at the clinic.` : " There is no fee.")
    : "";
  const sum: [string, string][] = [
    [
      "Patient",
      hasPerson ? `${personName} · ${v.person?.phone ?? v.newPerson?.phone}` : "Not chosen",
    ],
    [
      DESK.ticket.bookedBy,
      v.forWho === "other"
        ? `${v.callerName || "Caller name missing"}${v.rel ? ` · ${v.rel.toLowerCase()}` : ""}`
        : DESK.ticket.byPhone,
    ],
    ["Why", v.reason ? v.reason + (v.note ? ` · "${v.note}"` : "") : "Not chosen"],
    ["Clinic", v.clinic ? ctx.clinic(v.clinic).name : "Not chosen"],
    ["Day", se ? fmtDay(se.date) : "Not chosen"],
    ["Time", se ? (needSlot ? v.slot || "Not chosen" : `Doors ${hhmm(se.st)}, line order`) : "—"],
    ["Doctor", se ? (v.doc === "any" ? B.anyDoctor : v.doc) : "—"],
    ["Fee", v.clinic ? (fee ? `${ugx(fee)} · at the clinic` : DESK.row.fee.none) : "—"],
    ["Messages", v.rem ? `Code now + reminder · ${DESK.smsLanguages[0]}` : B.noTexts],
    ["Needs", v.needs.join(", ") || "None"],
  ];

  const save = async () => {
    set({ busy: true, err: "" });
    const res = await ctx.port.book({
      personId: v.person?.id ?? null,
      newCaller: v.newPerson
        ? {
            name: v.newPerson.name,
            phone: v.newPerson.phone,
            dateOfBirth: v.newPerson.dob,
            ageOnly: v.newPerson.ageOnly,
          }
        : null,
      sessionKey: se!.key,
      slot: needSlot ? v.slot : null,
      reason: v.reason,
      note: [v.note, v.cnote, v.needs.join(", ")].filter(Boolean).join(" · "),
      texts: v.rem,
    });
    if (!res.ok) return set({ busy: false, err: res.error });
    set({ busy: false, code: res.code });
  };

  if (v.code)
    return (
      <DeskDialog
        open={open}
        onClose={close}
        label={B.title}
        size="xw"
        tile="phone"
        title={DESK.ticket.booked}
        lead={personName}
      >
        <div className={c("bk2")}>
          <div className={c("bkdone")}>
            <span className={c("cap")}>{B.codeTitle}</span>
            <div className={c("codes")} aria-label={`Booking code ${v.code.split("").join(" ")}`}>
              {v.code.split("").map((ch, i) => (
                <b key={i} style={{ animationDelay: `${i * 0.04}s` }}>
                  {ch}
                </b>
              ))}
            </div>
            <div className={c("say")}>
              {fill(B.sayCode, {
                code: codeSpoken(v.code),
                day: se ? fmtDay(se.date) + (needSlot ? ` at ${v.slot}` : "") : "",
              })}
            </div>
            <p className={c("note")}>{B.codeRule}</p>
            <div className={c("sumrows")}>
              {sum
                .slice(0, 1)
                .concat([
                  [
                    "When",
                    se
                      ? fmtDay(se.date) + (needSlot ? ` at ${v.slot}` : `, doors ${hhmm(se.st)}`)
                      : "",
                  ],
                  ["Payment", fee ? B.payAtClinic : DESK.row.fee.none],
                  [
                    "Texts",
                    v.rem
                      ? `${fill(B.codeSent, { lang: DESK.smsLanguages[0] })}, reminder the day before`
                      : B.noTexts,
                  ],
                ])
                .map(([k, val]) => (
                  <div key={k} className={c("sr2")}>
                    <span>{k}</span>
                    <b>{val}</b>
                  </div>
                ))}
            </div>
            <div className={c("mf")}>
              <span className={c("grow")} />
              <button type="button" className={c("btn")} onClick={close}>
                {B.done}
              </button>
              <button type="button" className={c("btn", "k")} onClick={() => setV({ ...blank })}>
                {B.another}
              </button>
            </div>
          </div>
          <aside className={c("bksum")}>
            <p className={c("cap")}>{B.ticket}</p>
            {/* ADR 0490: the same Ticket as the landing, in real mode, from this booking. */}
            <Ticket
              mode="real"
              name={`${B.ticket}: ${personName}`}
              status="ok"
              date={se ? fmtDay(se.date) : ""}
              time={se ? (needSlot ? v.slot : hhmm(se.st)) : ""}
              note={B.sameTicket}
              fields={[{ label: TICKET.clinic, value: ctx.clinic(v.clinic).name }]}
              doctor={{ label: "Doctor", value: v.doc === "any" ? B.anyDoctor : v.doc }}
              visit={{
                patient: personName,
                initials: initials(personName),
                sexAge: v.person ? whoOf(v.person) : (v.newPerson?.who ?? ""),
                clinic: ctx.clinic(v.clinic).name,
                code: v.code,
                fee: fee ? ugx(fee) : DESK.row.fee.none,
                doctorInitials: [],
                bring: [],
              }}
              flipped={flip}
              onTurn={() => setFlip(!flip)}
            />
          </aside>
        </div>
      </DeskDialog>
    );

  return (
    <DeskDialog
      open={open}
      onClose={close}
      label={B.title}
      size="xw"
      tile="phone"
      title={B.title}
      lead={B.lead}
    >
      <div className={c("bk2")}>
        <div className={c("bkf")}>
          <section className={c("bks")}>
            <h3>
              <i>1</i>
              {B.who}
            </h3>
            <Chips<"self" | "other">
              items={[
                ["self", B.forCaller],
                ["other", B.forSomeoneElse],
              ]}
              value={v.forWho}
              onPick={(forWho) => set({ forWho })}
            />
            {v.forWho === "other" ? (
              <>
                <div className={c("inl")}>
                  <input
                    className={c("fin")}
                    type="text"
                    placeholder={B.callerName}
                    value={v.callerName}
                    onChange={(e) => set({ callerName: e.target.value })}
                    aria-label={B.callerName}
                  />
                  <Phone
                    cc={v.callerCc}
                    setCc={(callerCc) => set({ callerCc })}
                    value={v.callerPhone}
                    set={(callerPhone) => set({ callerPhone })}
                    placeholder="Caller's phone"
                  />
                </div>
                <Chips items={B.relations} value={v.rel} onPick={(rel) => set({ rel })} />
                <p className={c("note")}>{B.whoLine}</p>
              </>
            ) : null}
            <p className={c("sublbl")}>Patient</p>
            {!hasPerson && !v.isNew ? (
              <>
                <input
                  className={c("fin")}
                  type="text"
                  autoComplete="off"
                  placeholder={B.findPatient}
                  value={v.cq}
                  onChange={(e) => set({ cq: e.target.value })}
                  aria-label={B.findPatient}
                  autoFocus
                />
                {matches.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={c("pick")}
                    onClick={() => set({ person: p })}
                  >
                    <span className={c("av", "sm")}>{initials(p.name)}</span>
                    <span>
                      <b>{p.name}</b>
                      <span className={c("mt")}>
                        {who(p)} · {p.phone}
                      </span>
                    </span>
                    <span className={c("r", "mono")}>{p.pno}</span>
                  </button>
                ))}
                {v.cq.replace(/\s/g, "").length >= 2 && !matches.length ? (
                  <p className={c("note")}>{B.nobody}</p>
                ) : null}
                <button
                  type="button"
                  className={c("btn", "sm", "q")}
                  onClick={() =>
                    set({ isNew: true, nc: { ...blank.nc, phone: v.cq.replace(/[^0-9 ]/g, "") } })
                  }
                >
                  {B.newCaller}
                </button>
              </>
            ) : null}
            {!hasPerson && v.isNew ? (
              <>
                <input
                  className={c("fin")}
                  type="text"
                  placeholder={DESK.walkIn.fullName}
                  value={v.nc.name}
                  onChange={(e) => set({ nc: { ...v.nc, name: e.target.value }, ncErr: "" })}
                  aria-label={DESK.walkIn.fullName}
                />
                <Phone
                  cc={v.nc.cc}
                  setCc={(cc) => set({ nc: { ...v.nc, cc } })}
                  value={v.nc.phone}
                  set={(phone) => set({ nc: { ...v.nc, phone }, ncErr: "" })}
                  placeholder="772 418 900"
                />
                <AgeField
                  v={v.nc.age}
                  set={(p) => set({ nc: { ...v.nc, age: { ...v.nc.age, ...p } }, ncErr: "" })}
                />
                {v.ncErr ? (
                  <p className={c("note")} role="alert">
                    <b>{v.ncErr}</b>
                  </p>
                ) : null}
                <div className={c("acts")}>
                  <button
                    type="button"
                    className={c("btn", "sm", "k")}
                    onClick={() => {
                      const n = v.nc;
                      const ar = ageOf(n.age, kampalaToday());
                      if (!n.name.trim() || !n.phone.trim())
                        return set({ ncErr: B.missing.nameAndPhone });
                      if (!ar.ok) return set({ ncErr: ar.err ? ar.txt : B.missing.age });
                      const ageTx = ar.exact ? `${ar.show} years` : `Age ${ar.show}`;
                      set({
                        newPerson: {
                          name: n.name.trim(),
                          phone: `${n.cc} ${n.phone.trim().replace(/^0+/, "")}`,
                          dob: ar.dob ?? dobOf(n.age),
                          ageOnly: n.age.mode === "age" ? (ar.age ?? null) : null,
                          who: `${ageTx} · ${DESK.row.state.toConfirm.toLowerCase()}`,
                        },
                        isNew: false,
                      });
                    }}
                  >
                    {B.useDetails}
                  </button>
                  <button
                    type="button"
                    className={c("btn", "sm", "q")}
                    onClick={() => set({ isNew: false })}
                  >
                    {B.backToSearch}
                  </button>
                </div>
                <p className={c("note")}>{B.newCallerNote}</p>
              </>
            ) : null}
            {hasPerson ? (
              <div className={c("pick", "on")}>
                <span className={c("av", "sm")}>{initials(personName)}</span>
                <span>
                  <b>{personName}</b>
                  <span className={c("mt")}>
                    {v.person
                      ? `${who(v.person)} · ${v.person.phone}`
                      : `${v.newPerson!.who} · ${v.newPerson!.phone}`}
                  </span>
                </span>
                <button
                  type="button"
                  className={c("btn", "sm", "q", "r")}
                  onClick={() => set({ person: null, newPerson: null, isNew: false })}
                >
                  {B.change}
                </button>
              </div>
            ) : null}
            {dup ? (
              <div className={c("warnbox")}>
                <b>{B.already}</b>{" "}
                {fill(B.alreadyLine, {
                  name: dup.name.split(" ")[0]!,
                  clinic: ctx.clinic(dup.clinic).name,
                  day: `today, ${dup.time} (${dup.code})`,
                })}
              </div>
            ) : null}
          </section>

          <section className={c("bks")}>
            <h3>
              <i>2</i>
              {B.why}
            </h3>
            <Chips
              items={v.clinic === "anc" ? [B.antenatal, ...B.reasons] : B.reasons}
              value={v.reason}
              onPick={(reason) => set({ reason, danger: [] })}
            />
            <input
              className={c("fin")}
              type="text"
              placeholder="In their words (optional)"
              value={v.note}
              onChange={(e) => set({ note: e.target.value })}
              aria-label="Reason in their words"
            />
            {newProb ? (
              <div className={c("dangerq")}>
                <p>
                  <b>{B.askFirst}</b> {B.askQuestion}
                </p>
                <Chips
                  items={DESK.dangerSigns}
                  value={v.danger}
                  multi
                  onPick={(x) =>
                    set({
                      danger: v.danger.includes(x)
                        ? v.danger.filter((d) => d !== x)
                        : [...v.danger, x],
                    })
                  }
                />
                <p className={c("note")}>{B.waitingSignOff}</p>
              </div>
            ) : null}
            {newProb && dangerYes ? (
              <div className={c("dangerbox")} role="alert">
                <b>{B.stop}</b> {B.stopLine}{" "}
                <button
                  type="button"
                  className={c("btn", "sm", "r")}
                  onClick={() => {
                    close();
                    ctx.say(B.toldToast);
                  }}
                >
                  {B.toldThem}
                </button>
              </div>
            ) : null}
          </section>

          <section className={c("bks")}>
            <h3>
              <i>3</i>
              {B.when}
            </h3>
            <div className={c("chips")}>
              {ctx.data.mine.map((id) => {
                const k = ctx.clinic(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className={c("chip", v.clinic === id && "on")}
                    style={{ "--ci": k.hue } as React.CSSProperties}
                    aria-pressed={v.clinic === id}
                    onClick={() => set({ clinic: id, key: "", slot: "" })}
                  >
                    <i />
                    {k.name}
                  </button>
                );
              })}
            </div>
            {v.clinic ? (
              <>
                <p className={c("sublbl")}>Day</p>
                <div className={c("hs")}>
                  {days.map((d) => {
                    const full = d.booked >= d.cap || !d.docs.length;
                    return (
                      <button
                        key={d.key}
                        type="button"
                        className={c("chip", v.key === d.key && "on")}
                        aria-pressed={v.key === d.key}
                        disabled={full}
                        onClick={() => set({ key: d.key, slot: "" })}
                      >
                        {d.date === ctx.today ? DESK.calendar.today : fmtDay(d.date)}{" "}
                        <small>
                          {!d.docs.length
                            ? "no doctor yet"
                            : full
                              ? "full"
                              : `${d.cap - d.booked} left`}
                        </small>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}
            {se ? (
              <>
                <p className={c("sublbl")}>Time</p>
                {needSlot ? (
                  <Chips items={slotTimes(se)} value={v.slot} onPick={(slot) => set({ slot })} />
                ) : (
                  <span className={c("fv")}>
                    {fill(DESK.calendar.doorsOpen, { time: hhmm(se.st) })} · seen in line order
                  </span>
                )}
                <p className={c("sublbl")}>Doctor</p>
                <Chips
                  items={[["any", B.anyDoctor] as const, ...se.docs.map((d) => [d, d] as const)]}
                  value={v.doc}
                  onPick={(doc) => set({ doc })}
                />
              </>
            ) : null}
          </section>

          <section className={c("bks")}>
            <h3>
              <i>4</i>
              {B.payment}
            </h3>
            <div className={c("feeline")}>
              <span>{B.clinicFee}</span>
              <b>{v.clinic ? (fee ? ugx(fee) : DESK.row.fee.none) : B.missing.clinic}</b>
            </div>
            {fee ? <p className={c("note")}>{B.payAtClinicLine}</p> : null}
            <button
              type="button"
              className={c("togg", v.rem && "on")}
              onClick={() => set({ rem: !v.rem })}
              aria-pressed={v.rem}
            >
              <span className={c("toggTb")} />
              {B.texts}
            </button>
          </section>

          <section className={c("bks")}>
            <h3>
              <i>5</i>
              {B.needs}
            </h3>
            <Chips
              items={B.needList}
              value={v.needs}
              multi
              onPick={(x) =>
                set({
                  needs: v.needs.includes(x) ? v.needs.filter((n) => n !== x) : [...v.needs, x],
                })
              }
            />
            <input
              className={c("fin")}
              type="text"
              placeholder={`${B.note} (optional)`}
              value={v.cnote}
              onChange={(e) => set({ cnote: e.target.value })}
              aria-label={B.note}
            />
          </section>
        </div>

        <aside className={c("bksum")}>
          <p className={c("cap")}>{DESK.ticket.live}</p>
          <div className={c("sumrows")}>
            {sum.map(([k, val]) => (
              <div
                key={k}
                className={c("sr2", /^(Not chosen|—|Caller name missing)/.test(val) && "miss")}
              >
                <span>{k}</span>
                <b>{val}</b>
              </div>
            ))}
          </div>
          {ready ? (
            <div className={c("say")}>
              <span className={c("cap")}>{B.readBack}</span>
              {readBack}
            </div>
          ) : (
            <p className={c("why")}>{why}</p>
          )}
          {v.err ? (
            <p className={c("err")} role="alert">
              {v.err}
            </p>
          ) : null}
          <div className={c("acts")}>
            <button type="button" className={c("btn")} onClick={close}>
              {B.cancel}
            </button>
            <button
              type="button"
              className={c("btn", "k", "grow")}
              onClick={save}
              disabled={!ready || v.busy}
            >
              {B.book}
            </button>
          </div>
        </aside>
      </div>
    </DeskDialog>
  );
}
