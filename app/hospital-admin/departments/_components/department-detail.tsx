"use client";

import type { BookedAs, BookingRules, ClinicWeek, DepartmentsData } from "../_lib/model";
import type { DepartmentRow } from "@/lib/services/data";
import Link from "next/link";
import { useState } from "react";

import { Chip, ChipRow, Field, k, Seg, Toggle } from "@/components/clinics-schedule/shared";
import { DUTY_ROTA_COPY } from "@/content/duty-rota";
import { DEPTS } from "@/content/hospital-admin/departments";
import { fill } from "@/content/lab-workspace-v2";
import { PHARMACY } from "@/content/pharmacy";
import { LAB_SECTIONS } from "@/supabase/functions/_shared/services-hub";
import { saveBookingRulesAction } from "../_lib/actions";
import {
  abbr,
  bookedAs,
  clinicWeeks,
  DAY_SHORT,
  fmtDate,
  hm,
  idsOf,
  isNarrowed,
  plural,
  rulesSummary,
  UNSET_RULES,
  windowToSave,
} from "../_lib/model";
import { useOp } from "../_lib/use-op";
import { itemHistory } from "../actions";
import d from "./departments.module.css";

type Tab = "overview" | "booking" | "inside";
const D = DEPTS.detail;
const SERVES = ["window", "wards", "emergency", "all"] as const;

/**
 * One department's panel (the desk's `det su-det`), three tabs as the prototype: Overview (live on Tether, the
 * head, place and hours, rename, archive, history), Booking rules (the old Booking policy page, per department)
 * and Clinics and wards (links out, plus its units, sections or dispensing points).
 */
export function DepartmentDetail({
  dept,
  data,
  assign,
  onClose,
}: {
  dept: DepartmentRow;
  data: DepartmentsData;
  assign: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const ids = idsOf(dept, data.departments);
  // ADR 0527: only a department that sees patients in clinics has clinic booking rules.
  const mode = bookedAs(
    dept,
    data.clinics.some((c) => ids.includes(c.departmentId) && c.status !== "archived"),
  );
  const n = (m: Record<string, number>) => ids.reduce((s, id) => s + (m[id] ?? 0), 0);
  const beds = data.wards
    .filter((w) => !w.archived && w.departmentId && ids.includes(w.departmentId))
    .reduce((s, w) => s + w.bedCount, 0);
  const facts = fill(DEPTS.facts, {
    clinics: plural(DEPTS.clinics, n(data.counts.clinics)),
    wards: plural(DEPTS.wards, n(data.counts.wards)),
    beds,
  });

  return (
    <aside className={k("det", "su-det")} aria-label={dept.name}>
      <div className={k("su-dh")}>
        <span className={`${k("su-ctile")} ${d.tile}`} aria-hidden="true">
          {abbr(dept.name)}
        </span>
        <div>
          <h2>{dept.name}</h2>
          <p>{fill(D.sub, { kind: DEPTS.kinds[dept.kind], facts })}</p>
        </div>
        <button type="button" className={k("btn", "sm", "q", "x")} onClick={onClose}>
          {D.close}
        </button>
      </div>
      <Seg
        opts={[
          ["overview", D.tabs.overview] as const,
          ...(mode === "none"
            ? []
            : [["booking", mode === "clinic" ? D.tabs.booking : D.tabs.priced] as const]),
          ["inside", D.tabs.inside] as const,
        ]}
        value={tab}
        onPick={setTab}
        label={dept.name}
        className={d.tabs}
        tour="wt-dp-tabs"
      />
      {tab === "overview" ? (
        <Overview
          dept={dept}
          data={data}
          assign={assign}
          mode={mode}
          onBooking={() => setTab("booking")}
        />
      ) : tab === "booking" && mode !== "none" ? (
        mode === "clinic" ? (
          <BookingRulesTab
            dept={dept}
            rules={data.rules[dept.id] ?? null}
            weeks={clinicWeeks(ids, data.clinics, data.sessions)}
          />
        ) : (
          <PricedByItem mode={mode} />
        )
      ) : (
        <Inside dept={dept} data={data} />
      )}
    </aside>
  );
}

function ErrorNote({ error }: { error: string | null }) {
  return error ? (
    <p className={k("su-note")} role="alert">
      {error}
    </p>
  ) : null;
}

/* ─── overview ─────────────────────────────────────────────────────── */

function Overview({
  dept,
  data,
  assign,
  mode,
  onBooking,
}: {
  dept: DepartmentRow;
  data: DepartmentsData;
  assign: boolean;
  mode: BookedAs;
  onBooking: () => void;
}) {
  const op = useOp();
  const [confirmOff, setConfirmOff] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [why, setWhy] = useState("");
  const [name, setName] = useState(dept.name);
  const [hours, setHours] = useState(dept.serviceHours ?? "");
  const [acting, setActing] = useState({ userId: "", until: "" });
  const ids = idsOf(dept, data.departments);
  const n = (m: Record<string, number>) => ids.reduce((s, id) => s + (m[id] ?? 0), 0);
  const staff = n(data.counts.staff);
  const booked = n(data.counts.bookedSessions);
  const wardN = n(data.counts.wards);
  const current = data.heads.current.filter((h) => h.departmentId === dept.id);
  const head = current.filter((h) => !h.acting);
  const actingNow = current.filter((h) => h.acting);
  const people = [
    ...new Map(
      data.pool
        .filter((p) => ids.includes(p.departmentId) || p.departmentId === dept.parentId)
        .map((p) => [p.userId, p]),
    ).values(),
  ];
  const inCharge = dept.catalogueCode === "LABORATORY" || dept.parentId !== null;

  if (dept.archived) {
    return (
      <div className={k("su-sec")}>
        <span className={k("su-st", "setup")}>{DEPTS.archived}</span>
        <ErrorNote error={op.error} />
        <button
          type="button"
          className={k("btn", "sm")}
          disabled={op.busy}
          onClick={() => op.run({ op: "unarchive", target: "department", id: dept.id })}
        >
          {D.restore}
        </button>
      </div>
    );
  }

  return (
    <>
      <ErrorNote error={op.error} />
      <div className={k("su-sec")} data-tour="wt-dp-live">
        <Toggle
          on={dept.live}
          disabled={op.busy}
          flip={() =>
            dept.live
              ? setConfirmOff(true)
              : op.run({ op: "set_department_live", department_id: dept.id, live: true })
          }
          t={D.live}
        />
        {confirmOff ? (
          <div className={d.confirm}>
            <b>{fill(D.takeOff, { name: dept.name })}</b>
            <span className={k("su-note")}>{fill(D.takeOffSub, { staff, booked })}</span>
            <div className={d.row}>
              <button
                type="button"
                className={k("btn", "sm", "k")}
                disabled={op.busy}
                onClick={() =>
                  op.run({ op: "set_department_live", department_id: dept.id, live: false }, () =>
                    setConfirmOff(false),
                  )
                }
              >
                {D.takeOffGo}
              </button>
              <button type="button" className={k("btn", "sm")} onClick={() => setConfirmOff(false)}>
                {D.keep}
              </button>
            </div>
          </div>
        ) : null}
        {!dept.parentId && dept.live ? (
          dept.isStart ? (
            <p className={k("su-note")}>{D.isStart}</p>
          ) : (
            <button
              type="button"
              className={`${k("btn", "sm", "q")} ${d.start}`}
              disabled={op.busy}
              onClick={() => op.run({ op: "set_start_department", department_id: dept.id })}
            >
              {D.makeStart}
            </button>
          )
        ) : null}
      </div>

      <div className={k("su-sec")} data-tour="wt-dp-heads">
        <span className={k("cap")}>{inCharge ? D.inChargeCap : D.headCap}</span>
        {people.length ? (
          <ChipRow label={inCharge ? D.inChargeCap : D.headCap}>
            <Chip
              on={head.length === 0}
              onClick={() => {
                if (!head.length || op.busy) return;
                for (const h of head) op.run({ op: "end_head", head_id: h.id });
              }}
            >
              {DEPTS.noHead}
            </Chip>
            {people.map((p) => {
              const on = head.some((h) => h.userId === p.userId);
              return (
                <Chip
                  key={p.userId}
                  on={on}
                  title={p.cadre ?? undefined}
                  onClick={() =>
                    !on &&
                    !op.busy &&
                    op.run({
                      op: "assign_head",
                      department_id: dept.id,
                      user_id: p.userId,
                      acting: false,
                    })
                  }
                >
                  {p.name}
                </Chip>
              );
            })}
          </ChipRow>
        ) : (
          <p className={k("su-note")}>{D.noEligible}</p>
        )}
        {head.length ? (
          <p className={k("su-note")}>
            {head
              .map((h) => `${h.name} · ${fill(D.since, { date: fmtDate(h.startsAt) })}`)
              .join(" · ")}
          </p>
        ) : assign ? (
          <p className={k("su-note")}>{D.headHint}</p>
        ) : null}
      </div>

      <div className={k("su-sec")}>
        <span className={k("cap")}>{D.actingCap}</span>
        {actingNow.length ? (
          actingNow.map((h) => (
            <div key={h.id} className={d.row}>
              <span className={k("su-tgt")}>
                <b>{h.name}</b>
                <small>
                  {fill(D.since, { date: fmtDate(h.startsAt) })}
                  {h.endsAt ? ` · ${fill(D.until, { date: fmtDate(h.endsAt) })}` : ""}
                </small>
              </span>
              <span className={d.grow} />
              <button
                type="button"
                className={k("btn", "sm", "q")}
                disabled={op.busy}
                onClick={() => op.run({ op: "end_head", head_id: h.id })}
              >
                {D.end}
              </button>
            </div>
          ))
        ) : (
          <p className={k("su-note")}>{D.actingNone}</p>
        )}
        {people.length ? (
          <div className={d.row}>
            <select
              className={`${k("in")} ${d.select}`}
              aria-label={D.actingWho}
              value={acting.userId}
              onChange={(e) => setActing((a) => ({ ...a, userId: e.target.value }))}
            >
              <option value="">{D.actingPick}</option>
              {people.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.cadre ? `${p.name}, ${p.cadre}` : p.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              className={`${k("in")} ${d.select} ${d.narrowIn}`}
              aria-label={`${D.actingUntil} (${D.actingUntilHint})`}
              value={acting.until}
              onChange={(e) => setActing((a) => ({ ...a, until: e.target.value }))}
            />
            <button
              type="button"
              className={k("btn", "sm")}
              disabled={op.busy || !acting.userId}
              onClick={() =>
                op.run(
                  {
                    op: "assign_head",
                    department_id: dept.id,
                    user_id: acting.userId,
                    acting: true,
                    ends_on: acting.until || null,
                  },
                  () => setActing({ userId: "", until: "" }),
                )
              }
            >
              {D.actingAdd}
            </button>
          </div>
        ) : null}
      </div>

      <div className={k("su-sec")}>
        <span className={k("cap")}>{D.bookingCap}</span>
        <p className={k("su-note")}>
          {mode === "clinic" ? bookingLine(dept, data) : DEPTS.priced[mode].line}
        </p>
        {mode === "none" ? null : (
          <button type="button" className={`${k("btn", "sm", "q")} ${d.start}`} onClick={onBooking}>
            {mode === "clinic" ? D.tabs.booking : D.tabs.priced}
          </button>
        )}
      </div>

      <div className={k("su-sec")}>
        <span className={k("cap")}>{D.placeCap}</span>
        <Field as="label" label={D.place}>
          <select
            className={`${k("in")} ${d.select}`}
            value={dept.placeId ?? ""}
            disabled={op.busy}
            onChange={(e) =>
              op.run({
                op: "update_department",
                department_id: dept.id,
                place_id: e.target.value || null,
              })
            }
          >
            <option value="">{D.noPlace}</option>
            {data.places
              .filter((p) => !p.archived || p.id === dept.placeId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </Field>
        <Field as="label" label={D.hours}>
          <input
            className={`${k("in")} ${d.select}`}
            value={hours}
            maxLength={60}
            placeholder={D.hoursPh}
            onChange={(e) => setHours(e.target.value)}
            onBlur={() =>
              hours.trim() !== (dept.serviceHours ?? "") &&
              op.run({
                op: "update_department",
                department_id: dept.id,
                service_hours: hours.trim() || null,
              })
            }
          />
        </Field>
      </div>

      <div className={k("su-sec")}>
        <span className={k("cap")}>{D.nameCap}</span>
        <div className={d.row}>
          <input
            className={`${k("in")} ${d.select}`}
            value={name}
            maxLength={80}
            aria-label={D.nameCap}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            className={k("btn", "sm")}
            disabled={op.busy || name.trim() === dept.name || name.trim().length < 2}
            onClick={() =>
              op.run({ op: "update_department", department_id: dept.id, name: name.trim() })
            }
          >
            {D.rename}
          </button>
        </div>
      </div>

      <div className={k("su-sec")}>
        <span className={k("cap")}>{D.archiveCap}</span>
        {dept.isStart ? (
          <p className={k("su-note")}>{D.archiveStart}</p>
        ) : staff + booked + wardN > 0 ? (
          <p className={k("su-note")}>{fill(D.archiveBusy, { staff, booked, wards: wardN })}</p>
        ) : archiving ? (
          <div className={d.confirm}>
            <span className={k("su-note")}>{D.archiveSub}</span>
            <input
              className={`${k("in")} ${d.select}`}
              value={why}
              maxLength={500}
              placeholder={D.archiveWhy}
              aria-label={D.archiveWhy}
              onChange={(e) => setWhy(e.target.value)}
            />
            <div className={d.row}>
              <button
                type="button"
                className={k("btn", "sm", "k")}
                disabled={op.busy || why.trim().length < 8}
                onClick={() =>
                  op.run({ op: "archive", target: "department", id: dept.id, reason: why.trim() })
                }
              >
                {D.archiveGo}
              </button>
              <button type="button" className={k("btn", "sm")} onClick={() => setArchiving(false)}>
                {D.cancel}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={`${k("btn", "sm", "q")} ${d.start}`}
            onClick={() => setArchiving(true)}
          >
            {D.archive}
          </button>
        )}
      </div>

      <History dept={dept} data={data} />
    </>
  );
}

function History({ dept, data }: { dept: DepartmentRow; data: DepartmentsData }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof itemHistory>> | null>(null);
  const [open, setOpen] = useState(false);
  const heads = data.heads.history.filter((h) => h.departmentId === dept.id);
  const show = () => {
    setOpen(true);
    itemHistory(dept.id).then(setRows);
  };
  return (
    <div className={k("su-sec")}>
      <span className={k("cap")}>{D.history}</span>
      {!open ? (
        <button type="button" className={`${k("btn", "sm", "q")} ${d.start}`} onClick={show}>
          {D.showHistory}
        </button>
      ) : (
        <>
          {heads.length ? (
            <ul className={d.lines} aria-label={D.heads}>
              {heads.map((h) => (
                <li key={h.id}>
                  {fill(D.headLine, {
                    name: h.name,
                    acting: h.acting ? D.actingWord : "",
                    from: fmtDate(h.startsAt),
                    to: h.endsAt ? fmtDate(h.endsAt) : D.now,
                  })}
                </li>
              ))}
            </ul>
          ) : null}
          {rows === null ? (
            <p className={k("su-note")}>{D.loading}</p>
          ) : rows.length === 0 ? (
            <p className={k("su-note")}>{D.noHistory}</p>
          ) : (
            <ul className={d.lines}>
              {rows.map((r, i) => (
                <li key={i}>
                  <b>
                    {(D.actions as Record<string, string>)[r.action] ?? r.action.replace(/_/g, " ")}
                  </b>{" "}
                  · {r.actor} · {fmtDate(r.at)}
                  {r.reason ? ` · ${r.reason}` : ""}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/* ─── booking rules (was the Booking policy page) ──────────────────── */

const withCurrent = (base: readonly number[], cur: number) =>
  [...new Set([...base, cur])].sort((a, b) => a - b);

/** The laboratory and the pharmacy: no clinic rules; what a visit costs and when it is open is set per item. */
function PricedByItem({ mode }: { mode: "tests" | "medicines" }) {
  const P = DEPTS.priced[mode];
  return (
    <div className={k("su-sec")}>
      <p className={k("su-note")}>{P.lead}</p>
      <ul className={d.lines}>
        {P.points.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      {P.href ? (
        <Link href={P.href} className={`${k("btn", "sm", "q")} ${d.start}`}>
          {P.open}
        </Link>
      ) : (
        <p className={k("su-note")}>{P.open}</p>
      )}
    </div>
  );
}

/** The overview's one line: the clinics' week plans where they hold the rules, else the department's own. */
function bookingLine(dept: DepartmentRow, data: DepartmentsData): string {
  const weeks = clinicWeeks(idsOf(dept, data.departments), data.clinics, data.sessions);
  if (!weeks.length) return rulesSummary(data.rules[dept.id]);
  return fill(DEPTS.rules.onClinics, {
    list: weeks.map((w) => `${w.name} (${rulesSummary(w.rules)})`).join("; "),
  });
}

function BookingRulesTab({
  dept,
  rules,
  weeks,
}: {
  dept: DepartmentRow;
  rules: BookingRules | null;
  /** The department's clinics that have a week plan: they hold days, hours and slot length (ADR 0526). */
  weeks: ClinicWeek[];
}) {
  const clinicLed = weeks.length > 0;
  const op = useOp();
  const R = DEPTS.rules;
  const start = rules ?? UNSET_RULES;
  const [v, setV] = useState<BookingRules>(start);
  const [why, setWhy] = useState("");
  const [said, setSaid] = useState("");
  const set = (patch: Partial<BookingRules>) => {
    setSaid("");
    setV((x) => ({ ...x, ...patch }));
  };
  const stale = clinicLed && !!rules && isNarrowed(rules);
  const changed = !rules || stale || JSON.stringify(v) !== JSON.stringify(start);
  const problem = clinicLed ? null : !v.days.length ? R.noDays : v.end <= v.start ? R.order : null;
  const win = windowToSave(v, clinicLed);
  const mins = (list: readonly number[]) => list.map((m) => [m, fill(R.min, { n: m })] as const);
  const times = (list: readonly number[]) => list.map((m) => [m, hm(m)] as const);

  const save = () =>
    op.call(
      () =>
        saveBookingRulesAction({
          department_id: dept.id,
          default_slot_minutes: v.slot,
          default_buffer_minutes: v.buffer,
          default_auto_confirm: v.auto,
          bookable_weekdays: win.days,
          bookable_start_minutes_local: win.start,
          bookable_end_minutes_local: win.end,
          reminder_lead_minutes: v.twoReminders ? [1440, 60] : [1440],
          allow_virtual: v.virtual,
          notes: v.notes?.trim() || null,
          reason: why.trim(),
        }),
      () => {
        setWhy("");
        setSaid(R.saved);
      },
    );

  return (
    <div className={k("su-sec")}>
      {clinicLed ? (
        <>
          <p className={k("su-note")}>{R.fromClinics}</p>
          <span className={k("cap")}>{R.clinicsCap}</span>
          <div className={d.rlist}>
            {weeks.map((w) => (
              <Link
                key={w.clinicId}
                href={`/hospital-admin/clinics?view=clinics&clinic=${w.clinicId}&tab=sessions`}
                className={d.ritem}
              >
                <b>{w.name}</b>
                <small>
                  {rulesSummary(w.rules)} · {R.openClinic}
                </small>
              </Link>
            ))}
          </div>
          {stale ? (
            <p className={k("su-note")}>{fill(R.oldLimit, { summary: rulesSummary(rules) })}</p>
          ) : null}
          <span className={k("cap")}>{R.diaryCap}</span>
        </>
      ) : (
        <>
          <p className={k("su-note")}>{rules ? R.note : R.unset}</p>
          <span className={k("cap")}>{R.days}</span>
          <ChipRow label={R.days}>
            {DAY_SHORT.map((label, i) => {
              const day = i + 1;
              const on = v.days.includes(day);
              return (
                <Chip
                  key={label}
                  on={on}
                  onClick={() =>
                    set({
                      days: on
                        ? v.days.filter((x) => x !== day)
                        : [...v.days, day].sort((a, b) => a - b),
                    })
                  }
                >
                  {label}
                </Chip>
              );
            })}
          </ChipRow>
          <span className={k("cap")}>{R.from}</span>
          <Seg
            opts={times(withCurrent([360, 420, 480, 540], v.start))}
            value={v.start}
            onPick={(m) => set({ start: m })}
            label={R.from}
            className={d.wrapSeg}
          />
          <span className={k("cap")}>{R.until}</span>
          <Seg
            opts={times(withCurrent([780, 960, 1020, 1080, 1200], v.end))}
            value={v.end}
            onPick={(m) => set({ end: m })}
            label={R.until}
            className={d.wrapSeg}
          />
          <span className={k("cap")}>{R.slot}</span>
          <Seg
            opts={mins(withCurrent([10, 15, 20, 30], v.slot))}
            value={v.slot}
            onPick={(m) => set({ slot: m })}
            label={R.slot}
            className={d.wrapSeg}
          />
        </>
      )}
      <span className={k("cap")}>{R.buffer}</span>
      <Seg
        opts={mins(withCurrent([0, 5, 10, 15], v.buffer))}
        value={v.buffer}
        onPick={(m) => set({ buffer: m })}
        label={R.buffer}
        className={d.wrapSeg}
      />
      <span className={k("cap")}>{R.reminders}</span>
      <Seg
        opts={[
          ["one", R.reminderOpts.one],
          ["two", R.reminderOpts.two],
        ]}
        value={v.twoReminders ? "two" : "one"}
        onPick={(x) => set({ twoReminders: x === "two" })}
        label={R.reminders}
        className={d.wrapSeg}
      />
      <p className={k("su-note")}>{R.remindersHint}</p>
      <Toggle on={v.auto} flip={() => set({ auto: !v.auto })} t={R.auto} />
      <Toggle on={v.virtual} flip={() => set({ virtual: !v.virtual })} t={R.virtual} />
      <Field as="label" label={R.notes} hint={R.notesHint}>
        <input
          className={`${k("in")} ${d.select}`}
          value={v.notes ?? ""}
          maxLength={500}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </Field>
      <Field as="label" label={R.why}>
        <input
          className={`${k("in")} ${d.select}`}
          value={why}
          maxLength={500}
          placeholder={R.whyPh}
          onChange={(e) => setWhy(e.target.value)}
        />
      </Field>
      {problem ? <p className={k("su-note")}>{problem}</p> : null}
      <ErrorNote error={op.error} />
      <button
        type="button"
        className={k("btn", "sm", "k")}
        disabled={op.busy || !changed || !!problem || why.trim().length < 8}
        onClick={save}
      >
        {R.save}
      </button>
      <p className={k("su-note")} role="status" aria-live="polite">
        {said}
      </p>
    </div>
  );
}

/* ─── clinics and wards ────────────────────────────────────────────── */

function Inside({ dept, data }: { dept: DepartmentRow; data: DepartmentsData }) {
  const op = useOp();
  const [unitName, setUnitName] = useState("");
  const [section, setSection] = useState("");
  const ids = idsOf(dept, data.departments);
  const units = data.departments.filter((u) => u.parentId === dept.id);
  const isLab = dept.catalogueCode === "LABORATORY";
  const isPharmacy = dept.catalogueCode === "PHARMACY";
  const which = isLab ? "section" : isPharmacy ? "point" : "unit";
  const clinics = data.clinics.filter(
    (c) => ids.includes(c.departmentId) && c.status !== "archived",
  );
  const wards = data.wards.filter(
    (w) => w.departmentId && ids.includes(w.departmentId) && !w.archived,
  );
  const staff = ids.reduce((s, id) => s + (data.counts.staff[id] ?? 0), 0);
  const onTether = (departmentId: string) =>
    data.departments.find((x) => x.id === departmentId)?.live ?? dept.live;

  return (
    <>
      <div className={k("su-sec")}>
        <span className={k("cap")}>{D.clinicsCap}</span>
        {clinics.length ? (
          <div className={d.rlist}>
            {clinics.map((c) =>
              // Clinics & schedule lists a clinic only while its department is live on Tether (ADR 0525).
              onTether(c.departmentId) ? (
                <Link key={c.id} href="/hospital-admin/clinics?view=clinics" className={d.ritem}>
                  <b>{c.name}</b>
                  <small>
                    {c.status === "live" ? D.clinicLive : D.clinicPlanned} · {D.openClinic}
                  </small>
                </Link>
              ) : (
                <div key={c.id} className={d.ritem}>
                  <b>{c.name}</b>
                  <small>{D.clinicOff}</small>
                </div>
              ),
            )}
          </div>
        ) : (
          <p className={k("su-note")}>{D.noClinics}</p>
        )}
      </div>

      <div className={k("su-sec")}>
        <span className={k("cap")}>{D.wardsCap}</span>
        {wards.length ? (
          <div className={d.rlist}>
            {wards.map((w) => (
              <Link
                key={w.id}
                href={`/hospital-admin/departments/wards?open=${w.id}`}
                className={d.ritem}
              >
                <b>{w.name}</b>
                <small>{fill(w.closed ? D.wardClosed : D.wardBeds, { n: w.bedCount })}</small>
              </Link>
            ))}
          </div>
        ) : (
          <p className={k("su-note")}>{D.noWards}</p>
        )}
      </div>

      {data.rotaLive ? (
        <div className={k("su-sec")}>
          <span className={k("cap")}>{DUTY_ROTA_COPY.page.title}</span>
          <Link
            href={`/hospital-admin/departments/rota?department=${dept.id}`}
            className={`${k("btn", "sm", "q")} ${d.start}`}
          >
            {DUTY_ROTA_COPY.page.open}
          </Link>
        </div>
      ) : null}

      <div className={k("su-sec")}>
        <span className={k("cap")}>{D.unitsCap[which]}</span>
        <ErrorNote error={op.error} />
        {units.filter((u) => !u.archived).length ? (
          <div className={d.rlist}>
            {units
              .filter((u) => !u.archived)
              .map((u) =>
                isPharmacy ? (
                  <div key={u.id} className={d.ritem}>
                    <b>{u.name}</b>
                    <small>
                      {fill(D.staffN, { n: data.counts.staff[u.id] ?? 0 })}
                      {u.serviceHours ? ` · ${u.serviceHours}` : ""}
                    </small>
                    <div className={d.row}>
                      <select
                        className={`${k("in")} ${d.select}`}
                        aria-label={`${D.serves}: ${u.name}`}
                        value={data.points[u.id] ?? ""}
                        disabled={op.busy}
                        onChange={(e) =>
                          e.target.value &&
                          op.run({
                            op: "set_dispensing_point",
                            department_id: u.id,
                            serves: e.target.value,
                          })
                        }
                      >
                        <option value="" disabled>
                          {D.servesNot}
                        </option>
                        {SERVES.map((s) => (
                          <option key={s} value={s}>
                            {D.servesOpts[s]}
                          </option>
                        ))}
                      </select>
                      {data.goLive && data.points[u.id] ? (
                        <Link
                          href={`/hospital-admin/departments/pharmacy/${u.id}`}
                          className={k("btn", "sm", "q")}
                        >
                          {D.goingLive}
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div key={u.id} className={d.ritem}>
                    <b>{u.name}</b>
                    <small>{fill(D.staffN, { n: data.counts.staff[u.id] ?? 0 })}</small>
                  </div>
                ),
              )}
          </div>
        ) : (
          <p className={k("su-note")}>{D.noUnits}</p>
        )}
        {isPharmacy && units.length ? <p className={k("su-note")}>{PHARMACY.points.note}</p> : null}
        {isPharmacy && data.goLive ? (
          <Link
            href="/hospital-admin/departments/pharmacy"
            className={`${k("btn", "sm", "q")} ${d.start}`}
          >
            {D.pharmacySettings}
          </Link>
        ) : null}
        {isPharmacy && data.pharmacyDemo ? (
          <Link
            href="/hospital-admin/departments/pharmacy/demo"
            className={`${k("btn", "sm", "q")} ${d.start}`}
          >
            {D.pharmacyDemo}
          </Link>
        ) : null}
        {!dept.parentId && !dept.archived ? (
          <div className={d.row}>
            {isLab ? (
              <select
                className={`${k("in")} ${d.select}`}
                aria-label={D.addUnit.section}
                value={section}
                onChange={(e) => setSection(e.target.value)}
              >
                <option value="">{D.sectionPick}</option>
                {LAB_SECTIONS.filter((s) => !units.some((u) => u.catalogueCode === s.code)).map(
                  (s) => (
                    <option key={s.code} value={s.code}>
                      {s.label}
                    </option>
                  ),
                )}
              </select>
            ) : (
              <input
                className={`${k("in")} ${d.select}`}
                aria-label={D.addUnit[which]}
                value={unitName}
                maxLength={80}
                placeholder={D.unitPh}
                onChange={(e) => setUnitName(e.target.value)}
              />
            )}
            <button
              type="button"
              className={k("btn", "sm")}
              disabled={op.busy || (isLab ? !section : unitName.trim().length < 2)}
              onClick={() =>
                op.run(
                  isLab
                    ? { op: "add_unit", department_id: dept.id, catalogue_code: section }
                    : { op: "add_unit", department_id: dept.id, name: unitName.trim() },
                  () => {
                    setUnitName("");
                    setSection("");
                  },
                )
              }
            >
              {D.addUnit[which]}
            </button>
          </div>
        ) : null}
      </div>

      <div className={k("su-sec")}>
        <p className={k("su-note")}>{fill(D.staffLine, { n: staff })}</p>
        <Link href="/hospital-admin/staff" className={`${k("btn", "sm", "q")} ${d.start}`}>
          {D.openStaff}
        </Link>
      </div>
    </>
  );
}
