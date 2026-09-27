"use client";

import type { ClinicRow, TemplateRow } from "@/lib/services/data";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, PrinterIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CATALOGUE_CLINICS } from "@/supabase/functions/_shared/services-hub";
import { addClosure, previewClosure, saveClinicDay, setClinicLive } from "../actions";
import {
  Amber,
  ConfirmBlock,
  ErrorLine,
  Field,
  fmtDay,
  HubPanel,
  inputClass,
  PanelColumns,
  RowButton,
  Select,
  StatusChip,
  useHub,
  YesNo,
} from "./hub-ui";

export interface TimetableCell {
  clinicId: string;
  clinic: string;
  status: ClinicRow["status"];
  confidential: boolean;
  day: string;
  weekday: number;
  start: number;
  end: number;
  place: string | null;
  capacity: number;
  booked: number;
  pattern: "weekly" | "every" | "nth" | "one_off";
}

type Dept = {
  id: string;
  parentId: string | null;
  name: string;
  catalogueCode: string | null;
  live: boolean;
};
type Option = { id: string; name: string };

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const addDays = (ymd: string, n: number) =>
  new Date(new Date(`${ymd}T12:00:00+03:00`).getTime() + n * 86_400_000).toLocaleDateString(
    "en-CA",
    { timeZone: "Africa/Kampala" },
  );
const AUDIENCE = [
  { value: "patients", label: "Patients book directly" },
  { value: "referral", label: "Referral only" },
  { value: "staff", label: "Staff book it" },
];

export function patternText(
  t: Pick<TemplateRow, "weekday" | "repeatEveryWeeks" | "nthWeekday" | "validFrom" | "validUntil">,
) {
  if (t.validUntil && t.validFrom === t.validUntil) return `One-off, ${fmtDay(t.validFrom)}`;
  if (t.nthWeekday) {
    const nth =
      t.nthWeekday === -1 ? "Last" : ["1st", "2nd", "3rd", "4th", "5th"][t.nthWeekday - 1];
    return `${nth} ${DAYS[t.weekday - 1]} monthly`;
  }
  if (t.repeatEveryWeeks > 1) return `${DAYS[t.weekday - 1]}s, every ${t.repeatEveryWeeks} weeks`;
  return `${DAYS[t.weekday - 1]}s`;
}

export function ClinicsView(props: {
  week: string;
  weekEnd: string;
  view: "timetable" | "list";
  printMode: boolean;
  openId: string | null;
  addOpen: boolean;
  clinics: ClinicRow[];
  departments: Dept[];
  places: Option[];
  clinicians: { userId: string; name: string }[];
  cells: TimetableCell[];
  skipped: { clinic: string; day: string; why: string }[];
  upcomingHolidays: { date: string; name: string }[];
  closures: { serviceLineId: string | null; startsOn: string; endsOn: string; reason: string }[];
  hospitalName: string;
}) {
  const { week, clinics, departments, cells } = props;
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(props.openId);
  const [adding, setAdding] = useState(props.addOpen);
  const deptName = (id: string) => departments.find((d) => d.id === id)?.name ?? "—";
  const open = clinics.find((c) => c.id === openId) ?? null;
  const visible = clinics.filter((c) => c.status !== "archived");
  const nextHoliday = props.upcomingHolidays.find((h) => h.date >= week);

  useEffect(() => {
    if (props.printMode) {
      const t = setTimeout(() => window.print(), 300);
      return () => clearTimeout(t);
    }
  }, [props.printMode]);

  const href = (q: Record<string, string>) =>
    `/hospital-admin/departments/clinics?${new URLSearchParams({ week, view: props.view, ...q })}`;
  const weekDays = useMemo(() => {
    const hasWeekend = cells.some((c) => c.weekday >= 6);
    return Array.from({ length: hasWeekend ? 7 : 5 }, (_, i) => ({
      i: i + 1,
      ymd: addDays(week, i),
    }));
  }, [cells, week]);

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div
          role="group"
          aria-label="View"
          className="border-border inline-flex rounded-md border p-0.5"
        >
          {(["timetable", "list"] as const).map((v) => (
            <Link
              key={v}
              href={href({ view: v })}
              aria-current={props.view === v ? "true" : undefined}
              className={cn(
                "text-body-s rounded-sm px-3 py-1",
                props.view === v
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "timetable" ? "Timetable" : "List"}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden /> Add clinics
          </Button>
          <Button size="sm" variant="secondary" onClick={() => window.print()}>
            <PrinterIcon aria-hidden /> Print timetable
          </Button>
        </div>
      </div>

      {props.view === "timetable" ? (
        <section className="flex flex-col gap-3 print:hidden">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-foreground text-body-s font-medium">Week of {fmtDay(week)}</span>
            <span className="inline-flex gap-1">
              <Button
                variant="ghost"
                size="iconSm"
                aria-label="Previous week"
                onClick={() => router.push(href({ week: addDays(week, -7) }))}
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                variant="ghost"
                size="iconSm"
                aria-label="Next week"
                onClick={() => router.push(href({ week: addDays(week, 7) }))}
              >
                <ChevronRightIcon />
              </Button>
            </span>
            {nextHoliday ? (
              <span className="text-muted-foreground text-caption">
                Next holiday: {fmtDay(nextHoliday.date)}, {nextHoliday.name}
                {props.skipped.length
                  ? ` · ${props.skipped.length} session${props.skipped.length === 1 ? "" : "s"} skip this week`
                  : ""}
              </span>
            ) : null}
          </div>
          <Timetable days={weekDays} cells={cells} onOpen={setOpenId} />
          {props.skipped.length ? (
            <ul className="text-muted-foreground text-caption flex flex-col gap-0.5">
              {props.skipped.map((s, i) => (
                <li key={i}>
                  {s.clinic} — {fmtDay(s.day)} skipped ({s.why})
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : (
        <section className="border-border bg-card overflow-hidden rounded-lg border print:hidden">
          {visible.length ? (
            <ul className="divide-border divide-y">
              {visible.map((c) => (
                <li key={c.id}>
                  <RowButton label={`Open ${c.name}`} onClick={() => setOpenId(c.id)}>
                    <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                      <span className="text-foreground text-body-s truncate font-medium sm:w-56">
                        {c.name}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <StatusChip status={c.status === "live" ? "live" : "planned"} />
                        {c.confidential ? (
                          <span className="text-muted-foreground text-caption">Confidential</span>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground text-caption truncate sm:w-40">
                        {deptName(c.departmentId)}
                      </span>
                      <span className="text-muted-foreground text-caption truncate sm:ml-auto">
                        {c.templates
                          .filter((t) => t.active)
                          .map((t) => `${SHORT[t.weekday - 1]} ${hhmm(t.startMinutesLocal)}`)
                          .join(" · ") || "No days yet"}
                      </span>
                    </span>
                  </RowButton>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-s text-muted-foreground p-5">
              No clinics yet. Add them from the catalogue.
            </p>
          )}
        </section>
      )}

      <PrintTimetable
        week={week}
        weekEnd={props.weekEnd}
        days={weekDays}
        cells={cells}
        clinics={clinics}
        deptName={deptName}
        hospitalName={props.hospitalName}
      />

      <AddClinicsPanel
        open={adding}
        onClose={() => setAdding(false)}
        departments={departments}
        existing={clinics}
      />
      {open ? (
        <ClinicPanel
          key={open.id}
          clinic={open}
          departments={departments}
          places={props.places}
          clinicians={props.clinicians}
          holidays={props.upcomingHolidays}
          closures={props.closures.filter((c) => c.serviceLineId === open.id)}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}

/* ─── the week grid (§5.5, §10: a table; each session a button with its full name) ── */

function Timetable({
  days,
  cells,
  onOpen,
}: {
  days: { i: number; ymd: string }[];
  cells: TimetableCell[];
  onOpen: (id: string) => void;
}) {
  const rows: { label: string; test: (c: TimetableCell) => boolean }[] = [
    { label: "AM", test: (c) => c.start < 12 * 60 },
    { label: "PM", test: (c) => c.start >= 12 * 60 },
  ];
  if (!cells.length) {
    return (
      <p className="text-body-s text-muted-foreground border-border rounded-xl border p-5">
        No clinic days this week. Open a clinic to add its days.
      </p>
    );
  }
  return (
    <div className="border-border overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[720px] table-fixed border-collapse">
        <caption className="sr-only">Clinic days this week</caption>
        <thead>
          <tr>
            <th scope="col" className="border-border bg-muted/40 w-12 border-b">
              <span className="sr-only">Time of day</span>
            </th>
            {days.map((d) => (
              <th
                key={d.ymd}
                scope="col"
                className="border-border bg-muted/40 text-muted-foreground border-b border-l px-2 py-2 text-left font-mono text-[10.5px] font-medium tracking-[0.12em] uppercase"
              >
                {SHORT[d.i - 1]}{" "}
                <span className="text-foreground/70 tabular-nums">
                  {fmtDay(d.ymd).split(" ").slice(1).join(" ")}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th
                scope="row"
                className="border-border text-muted-foreground border-b px-2 py-2 text-left align-top font-mono text-[10.5px] tracking-[0.12em]"
              >
                {r.label}
              </th>
              {days.map((d) => {
                const here = cells
                  .filter((c) => c.day === d.ymd && r.test(c))
                  .sort((a, b) => a.start - b.start);
                return (
                  <td key={d.ymd} className="border-border border-b border-l p-1.5 align-top">
                    <div className="flex flex-col gap-1.5">
                      {here.map((c) => (
                        <button
                          key={`${c.clinicId}-${c.start}`}
                          type="button"
                          onClick={() => onOpen(c.clinicId)}
                          aria-label={`${c.clinic}, ${DAYS[c.weekday - 1]} ${hhmm(c.start)} to ${hhmm(c.end)}${c.place ? `, ${c.place}` : ""}, ${c.capacity} places${c.status === "planned" ? ", planned" : ""}`}
                          className={cn(
                            "hover:border-foreground/30 flex flex-col gap-0.5 rounded-md border px-2 py-1.5 text-left transition-colors duration-100",
                            c.status === "planned"
                              ? "border-dashed border-gray-300 bg-transparent"
                              : "border-border bg-card",
                          )}
                        >
                          <span className="text-foreground text-caption leading-tight font-medium">
                            {c.clinic}
                            {c.confidential ? (
                              <span className="text-muted-foreground font-normal">
                                {" "}
                                (confidential)
                              </span>
                            ) : null}
                          </span>
                          <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
                            {hhmm(c.start)}–{hhmm(c.end)}
                          </span>
                          {c.place ? (
                            <span className="text-muted-foreground text-[11px] leading-tight">
                              {c.place}
                            </span>
                          ) : null}
                          <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
                            {c.capacity} · {c.booked}/{c.capacity - c.booked}
                            {c.status === "planned" ? " · planned" : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Print CSS only (E-SVC-06): one A4 landscape page per week, grouped by department, with places; black and white. */
function PrintTimetable({
  week,
  weekEnd,
  days,
  cells,
  clinics,
  deptName,
  hospitalName,
}: {
  week: string;
  weekEnd: string;
  days: { i: number; ymd: string }[];
  cells: TimetableCell[];
  clinics: ClinicRow[];
  deptName: (id: string) => string;
  hospitalName: string;
}) {
  const byDept = new Map<string, TimetableCell[]>();
  for (const c of cells) {
    const d = deptName(clinics.find((x) => x.id === c.clinicId)?.departmentId ?? "");
    byDept.set(d, [...(byDept.get(d) ?? []), c]);
  }
  return (
    <section className="hidden text-black print:block" aria-hidden>
      <style>{`@media print { @page { size: A4 landscape; margin: 10mm; } body { background: #fff !important; } aside, header, nav, [role="tablist"], [data-print-hide] { display: none !important; } }`}</style>
      <h1 className="text-[16pt] font-medium">
        {hospitalName} — clinic timetable, {fmtDay(week)} to {fmtDay(weekEnd)}
      </h1>
      {[...byDept.entries()].map(([dept, list]) => (
        <div key={dept} className="mt-3 break-inside-avoid">
          <h2 className="border-b border-black text-[11pt] font-semibold">{dept}</h2>
          <table className="mt-1 w-full table-fixed border-collapse text-[9pt]">
            <thead>
              <tr>
                {days.map((d) => (
                  <th
                    key={d.ymd}
                    className="border border-black px-1 py-0.5 text-left font-semibold"
                  >
                    {fmtDay(d.ymd)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {days.map((d) => (
                  <td key={d.ymd} className="border border-black px-1 py-0.5 align-top">
                    {list
                      .filter((c) => c.day === d.ymd)
                      .sort((a, b) => a.start - b.start)
                      .map((c) => (
                        <div key={`${c.clinicId}-${c.start}`} className="mb-1">
                          <strong>{c.clinic}</strong> {hhmm(c.start)}–{hhmm(c.end)}
                          {c.place ? <div>{c.place}</div> : null}
                        </div>
                      ))}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

/* ─── + Add clinics (catalogue checklist; confidentiality default shown) ── */

function AddClinicsPanel({
  open,
  onClose,
  departments,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  departments: Dept[];
  existing: ClinicRow[];
}) {
  const hub = useHub();
  const top = departments.filter((d) => d.parentId === null);
  const have = new Set(existing.filter((c) => c.status !== "archived").map((c) => c.catalogueCode));
  const defaultDept = (code: string) => {
    const cat = CATALOGUE_CLINICS.find((c) => c.code === code);
    return top.find((d) => d.catalogueCode === cat?.department)?.id ?? top[0]?.id ?? "";
  };
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState({ name: "", department_id: "" });
  const toggle = (code: string) =>
    setPicked((p) => {
      const n = { ...p };
      if (code in n) delete n[code];
      else n[code] = defaultDept(code);
      return n;
    });
  const items = [
    ...Object.entries(picked).map(([code, department_id]) => ({ code, department_id })),
    ...(custom.name.trim().length >= 2 && custom.department_id
      ? [{ name: custom.name.trim(), department_id: custom.department_id }]
      : []),
  ];
  return (
    <HubPanel
      open={open}
      onClose={onClose}
      title="Add clinics"
      description="New clinics start as Planned. Add their days, then set them live for booking."
      footer={
        <div className="flex w-full flex-col gap-2">
          <ErrorLine error={hub.error} />
          <div className="flex items-center gap-3">
            <Button
              disabled={hub.pending || items.length === 0 || top.length === 0}
              onClick={() =>
                hub.run({ op: "add_clinics", items }, () => {
                  setPicked({});
                  setCustom({ name: "", department_id: "" });
                  onClose();
                })
              }
            >
              {hub.pending ? "Adding…" : items.length ? `Add ${items.length}` : "Add"}
            </Button>
            <span aria-live="polite" className="text-muted-foreground text-caption">
              {items.length} selected
            </span>
          </div>
        </div>
      }
    >
      {top.length === 0 ? (
        <p className="text-body-s text-muted-foreground">
          Add a department first — every clinic belongs to one.
        </p>
      ) : null}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-foreground text-body-s mb-1 font-medium">Catalogue</legend>
        {CATALOGUE_CLINICS.map((c) => {
          const already = have.has(c.code);
          const on = c.code in picked;
          return (
            <div key={c.code} className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
              <label
                className={cn(
                  "text-body-s flex flex-1 items-center gap-2.5 px-1 py-1",
                  already ? "text-muted-foreground" : "cursor-pointer",
                )}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-teal-700"
                  checked={already || on}
                  disabled={already}
                  onChange={() => toggle(c.code)}
                />
                {c.label}
                {c.confidential ? (
                  <span className="text-muted-foreground text-caption">
                    Confidential by default
                  </span>
                ) : null}
                {already ? <span className="text-caption">Already added</span> : null}
              </label>
              {on ? (
                <Select
                  className="sm:w-56"
                  value={picked[c.code] ?? ""}
                  onChange={(v) => setPicked((p) => ({ ...p, [c.code]: v }))}
                  options={top.map((d) => ({ value: d.id, label: d.name }))}
                />
              ) : null}
            </div>
          );
        })}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-foreground text-body-s mb-1 font-medium">Other</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            className={inputClass}
            placeholder="A clinic not in the list"
            value={custom.name}
            onChange={(e) => setCustom((c) => ({ ...c, name: e.target.value }))}
            maxLength={120}
            aria-label="Other clinic name"
          />
          <Select
            aria-label="Other clinic department"
            value={custom.department_id}
            onChange={(v) => setCustom((c) => ({ ...c, department_id: v }))}
            placeholder="Department"
            options={top.map((d) => ({ value: d.id, label: d.name }))}
          />
        </div>
      </fieldset>
    </HubPanel>
  );
}

/* ─── the clinic panel ──────────────────────────────────────────────── */

function ClinicPanel({
  clinic,
  departments,
  places,
  clinicians,
  holidays,
  closures,
  onClose,
}: {
  clinic: ClinicRow;
  departments: Dept[];
  places: Option[];
  clinicians: { userId: string; name: string }[];
  holidays: { date: string; name: string }[];
  closures: { startsOn: string; endsOn: string; reason: string }[];
  onClose: () => void;
}) {
  const hub = useHub();
  const [editing, setEditing] = useState<TemplateRow | "new" | "one_off" | null>(null);
  const top = departments.filter((d) => d.parentId === null);
  const dept = departments.find((d) => d.id === clinic.departmentId);
  const units = departments.filter((d) => d.parentId === clinic.departmentId);
  const days = clinic.templates.filter((t) => t.active);
  const planned = clinic.status === "planned";
  const sessionMode = clinic.capacityMode === "session";
  // Upcoming exceptions: the public holidays that land on one of this clinic's days (and it doesn't run on them).
  const exceptions = holidays.filter((h) => {
    const wd = ((new Date(`${h.date}T12:00:00+03:00`).getUTCDay() + 6) % 7) + 1;
    return days.some(
      (t) =>
        t.weekday === wd &&
        !t.runsOnHolidays &&
        t.validFrom <= h.date &&
        (!t.validUntil || t.validUntil >= h.date),
    );
  });

  return (
    <HubPanel
      open
      wide
      onClose={onClose}
      title={clinic.name}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <StatusChip
            status={
              clinic.status === "live"
                ? "live"
                : clinic.status === "planned"
                  ? "planned"
                  : "archived"
            }
          />
          {dept?.name}
        </span>
      }
    >
      <ErrorLine error={hub.error} />
      {clinic.status === "archived" ? (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          disabled={hub.pending}
          onClick={() => hub.run({ op: "unarchive", target: "clinic", id: clinic.id })}
        >
          Restore from the archive
        </Button>
      ) : (
        <PanelColumns
          left={
            <>
              <section className="flex flex-col gap-2">
                <h3 className="text-foreground text-body-s font-medium">Booking</h3>
                {planned ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body-s text-muted-foreground">
                      Planned — nobody can book it yet.
                    </span>
                    <Button
                      size="sm"
                      disabled={hub.pending || !dept?.live}
                      onClick={() => hub.call(() => setClinicLive(clinic.id, true))}
                    >
                      Set live for booking
                    </Button>
                    {!dept?.live ? (
                      <span className="text-muted-foreground text-caption">
                        Set {dept?.name ?? "its department"} live first.
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body-s text-muted-foreground">
                      Live — bookable in the days below.
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={hub.pending}
                      onClick={() => hub.call(() => setClinicLive(clinic.id, false))}
                    >
                      Back to planned
                    </Button>
                  </div>
                )}
              </section>

              <section className="grid gap-3 sm:grid-cols-2">
                <Field label="Who can book">
                  <Select
                    value={clinic.audience}
                    onChange={(v) =>
                      hub.run({ op: "update_clinic", service_line_id: clinic.id, audience: v })
                    }
                    options={AUDIENCE}
                  />
                </Field>
                <Field label="Place">
                  <Select
                    value={clinic.placeId ?? ""}
                    placeholder="No place set"
                    onChange={(v) =>
                      hub.run({
                        op: "update_clinic",
                        service_line_id: clinic.id,
                        place_id: v || null,
                      })
                    }
                    options={places.map((p) => ({ value: p.id, label: p.name }))}
                  />
                </Field>
                <Field label="Department">
                  <Select
                    value={clinic.departmentId}
                    onChange={(v) =>
                      hub.run({
                        op: "update_clinic",
                        service_line_id: clinic.id,
                        department_id: v,
                        unit_id: null,
                      })
                    }
                    options={top.map((d) => ({ value: d.id, label: d.name }))}
                  />
                </Field>
                <Field label="Unit (optional)">
                  <Select
                    value={clinic.unitId ?? ""}
                    placeholder="The whole department"
                    onChange={(v) =>
                      hub.run({
                        op: "update_clinic",
                        service_line_id: clinic.id,
                        unit_id: v || null,
                      })
                    }
                    options={units.map((u) => ({ value: u.id, label: u.name }))}
                  />
                </Field>
              </section>

              <section className="flex flex-col gap-1.5">
                <h3 className="text-foreground text-body-s font-medium">Confidential</h3>
                <YesNo
                  name="Confidential"
                  value={clinic.confidential}
                  onChange={(v) =>
                    hub.run({ op: "update_clinic", service_line_id: clinic.id, confidential: v })
                  }
                />
                <p className="text-muted-foreground text-caption">
                  Patient messages won&apos;t name this clinic.
                </p>
              </section>
            </>
          }
          right={
            <>
              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-foreground text-body-s font-medium">Clinic days</h3>
                  {sessionMode ? (
                    <span className="flex gap-1.5">
                      <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
                        <PlusIcon aria-hidden /> Add days
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing("one_off")}>
                        One-off session
                      </Button>
                    </span>
                  ) : null}
                </div>
                {!sessionMode ? (
                  <p className="text-body-s text-muted-foreground">
                    This line books by clinician slots. Its days live in each clinician&apos;s
                    schedule —{" "}
                    <Link
                      href="/hospital-admin/scheduling"
                      className="text-teal-700 hover:underline"
                    >
                      Scheduling
                    </Link>
                    .
                  </p>
                ) : days.length ? (
                  <ul className="divide-border border-border divide-y rounded-md border">
                    {days.map((t) => (
                      <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <span className="text-foreground text-body-s flex-1">
                          {patternText(t)}, {hhmm(t.startMinutesLocal)}–
                          {hhmm(t.startMinutesLocal + t.durationMinutes)}
                          <span className="text-muted-foreground text-caption block">
                            {t.capacityTotal} places · {t.capacityBooked} booked /{" "}
                            {t.capacityTotal - t.capacityBooked} walk-in
                            {t.venue ? ` · ${t.venue}` : ""}
                            {t.runsOnHolidays ? " · runs on public holidays" : ""}
                          </span>
                        </span>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                          Change
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-body-s text-muted-foreground">No days yet.</p>
                )}
                {editing ? (
                  <DayForm
                    key={typeof editing === "string" ? editing : editing.id}
                    clinicId={clinic.id}
                    existing={typeof editing === "string" ? null : editing}
                    oneOff={editing === "one_off"}
                    places={places}
                    clinicians={clinicians}
                    onDone={() => setEditing(null)}
                  />
                ) : null}
              </section>

              {exceptions.length || closures.length ? (
                <section className="flex flex-col gap-1.5">
                  <h3 className="text-foreground text-body-s font-medium">Upcoming exceptions</h3>
                  <ul className="text-body-s text-muted-foreground flex flex-col gap-1">
                    {exceptions.map((h) => (
                      <li key={h.date}>
                        {fmtDay(h.date)} — {h.name}: skipped
                      </li>
                    ))}
                    {closures.map((c, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2">
                        {c.startsOn >
                        new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Kampala" }) ? (
                          <StatusChip status="planned" />
                        ) : (
                          <Amber>Closed</Amber>
                        )}{" "}
                        {fmtDay(c.startsOn)}
                        {c.endsOn !== c.startsOn ? ` – ${fmtDay(c.endsOn)}` : ""}: {c.reason}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <CloseForDates clinicId={clinic.id} />

              <section className="border-border border-t pt-4">
                <ConfirmBlock
                  verb="Archive clinic"
                  tone="caution"
                  pending={hub.pending}
                  consequence={
                    <>
                      It stops taking bookings and leaves every list. Refused while future sessions
                      hold bookings — close those days first.
                    </>
                  }
                  onConfirm={(reason) =>
                    hub.run({ op: "archive", target: "clinic", id: clinic.id, reason }, onClose)
                  }
                />
              </section>
            </>
          }
        />
      )}
    </HubPanel>
  );
}

function DayForm({
  clinicId,
  existing,
  oneOff,
  places,
  clinicians,
  onDone,
}: {
  clinicId: string;
  existing: TemplateRow | null;
  oneOff: boolean;
  places: Option[];
  clinicians: { userId: string; name: string }[];
  onDone: () => void;
}) {
  const hub = useHub();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Kampala" });
  const [f, setF] = useState({
    weekdays: existing ? [existing.weekday] : [2],
    date: existing?.validFrom ?? today,
    start: existing ? hhmm(existing.startMinutesLocal) : "08:00",
    end: existing ? hhmm(existing.startMinutesLocal + existing.durationMinutes) : "13:00",
    capacity: String(existing?.capacityTotal ?? 60),
    booked: String(existing?.capacityBooked ?? 40),
    repeat: existing?.nthWeekday
      ? "nth"
      : (existing?.repeatEveryWeeks ?? 1) > 1
        ? "every"
        : "weekly",
    every: String(existing?.repeatEveryWeeks ?? 2),
    nth: String(existing?.nthWeekday ?? 1),
    holidays: existing?.runsOnHolidays ?? false,
    place: existing?.placeId ?? "",
    clinician: existing?.clinicianUserId ?? "",
    from: existing?.validFrom ?? today,
    until: existing?.validUntil ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const duration = toMin(f.end) - toMin(f.start);
  const cap = Number(f.capacity);
  const booked = Number(f.booked);
  const valid =
    duration >= 15 &&
    cap >= 1 &&
    booked >= 1 &&
    booked <= cap &&
    (oneOff ? !!f.date : f.weekdays.length > 0);
  const save = (active = true) => {
    const common = {
      service_line_id: clinicId,
      start_minutes_local: toMin(f.start),
      duration_minutes: duration,
      capacity_total: cap,
      capacity_booked: booked,
      runs_on_holidays: f.holidays,
      place_id: f.place || null,
      clinician_user_id: f.clinician || null,
      active,
    };
    hub.call(async () => {
      if (oneOff) {
        const wd = ((new Date(`${f.date}T12:00:00+03:00`).getUTCDay() + 6) % 7) + 1;
        return saveClinicDay({ ...common, weekday: wd, valid_from: f.date, valid_until: f.date });
      }
      const recurrence = {
        repeat_every_weeks: f.repeat === "every" ? Number(f.every) : 1,
        nth_weekday: f.repeat === "nth" ? Number(f.nth) : null,
        valid_from: f.from,
        valid_until: f.until || null,
      };
      if (existing)
        return saveClinicDay({
          ...common,
          ...recurrence,
          id: existing.id,
          weekday: f.weekdays[0] ?? existing.weekday,
        });
      // "Tue and Thu" = one booking-engine template per weekday.
      for (const wd of f.weekdays) {
        const r = await saveClinicDay({ ...common, ...recurrence, weekday: wd });
        if (!r.ok) return r;
      }
      return { ok: true as const };
    }, onDone);
  };
  return (
    <div className="border-border bg-muted/40 flex flex-col gap-3 rounded-md border p-3">
      <ErrorLine error={hub.error} />
      {oneOff ? (
        <Field label="Date">
          <input
            type="date"
            className={inputClass}
            value={f.date}
            min={today}
            onChange={(e) => set("date", e.target.value)}
          />
        </Field>
      ) : (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-muted-foreground text-caption mb-1 font-medium">
            {existing ? "Day" : "Days"}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {SHORT.map((d, i) => {
              const on = f.weekdays.includes(i + 1);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    set(
                      "weekdays",
                      existing
                        ? [i + 1]
                        : on
                          ? f.weekdays.filter((x) => x !== i + 1)
                          : [...f.weekdays, i + 1].sort(),
                    )
                  }
                  className={cn(
                    "text-body-s rounded-sm border px-2.5 py-1",
                    on
                      ? "border-teal-700 bg-teal-50 text-teal-900"
                      : "border-input text-foreground hover:bg-muted",
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Starts">
          <input
            type="time"
            className={inputClass}
            value={f.start}
            onChange={(e) => set("start", e.target.value)}
          />
        </Field>
        <Field label="Ends">
          <input
            type="time"
            className={inputClass}
            value={f.end}
            onChange={(e) => set("end", e.target.value)}
          />
        </Field>
        <Field label="Places">
          <input
            className={cn(inputClass, "font-mono")}
            inputMode="numeric"
            value={f.capacity}
            onChange={(e) => set("capacity", e.target.value.replace(/\D/g, ""))}
          />
        </Field>
        <Field
          label="Of which booked"
          hint={cap && booked <= cap ? `${cap - booked} walk-in` : undefined}
        >
          <input
            className={cn(inputClass, "font-mono")}
            inputMode="numeric"
            value={f.booked}
            onChange={(e) => set("booked", e.target.value.replace(/\D/g, ""))}
          />
        </Field>
      </div>
      {!oneOff ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Repeats">
            <Select
              value={f.repeat}
              onChange={(v) => set("repeat", v)}
              options={[
                { value: "weekly", label: "Every week" },
                { value: "every", label: "Every few weeks" },
                { value: "nth", label: "One week a month" },
              ]}
            />
          </Field>
          {f.repeat === "every" ? (
            <Field label="Every">
              <Select
                value={f.every}
                onChange={(v) => set("every", v)}
                options={[2, 3, 4, 6, 8].map((n) => ({ value: String(n), label: `${n} weeks` }))}
              />
            </Field>
          ) : null}
          {f.repeat === "nth" ? (
            <Field label="Which week">
              <Select
                value={f.nth}
                onChange={(v) => set("nth", v)}
                options={[
                  ["1", "1st"],
                  ["2", "2nd"],
                  ["3", "3rd"],
                  ["4", "4th"],
                  ["-1", "Last"],
                ].map(([value, label]) => ({ value: value!, label: label! }))}
              />
            </Field>
          ) : null}
          <Field label="From">
            <input
              type="date"
              className={inputClass}
              value={f.from}
              onChange={(e) => set("from", e.target.value)}
            />
          </Field>
          <Field label="Until (optional)">
            <input
              type="date"
              className={inputClass}
              value={f.until}
              onChange={(e) => set("until", e.target.value)}
            />
          </Field>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Place">
          <Select
            value={f.place}
            onChange={(v) => set("place", v)}
            placeholder="The clinic's place"
            options={places.map((p) => ({ value: p.id, label: p.name }))}
          />
        </Field>
        <Field label="Clinician (optional)">
          <Select
            value={f.clinician}
            onChange={(v) => set("clinician", v)}
            placeholder="Not named"
            options={clinicians.map((c) => ({ value: c.userId, label: c.name }))}
          />
        </Field>
      </div>
      {!oneOff ? (
        <label className="text-body-s flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-teal-700"
            checked={f.holidays}
            onChange={(e) => set("holidays", e.target.checked)}
          />
          Runs on public holidays
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={hub.pending || !valid} onClick={() => save(true)}>
          {hub.pending ? "Saving…" : "Save"}
        </Button>
        {existing ? (
          <Button size="sm" variant="ghost" disabled={hub.pending} onClick={() => save(false)}>
            Stop this day
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <p className="text-muted-foreground text-caption">
        Days with bookings keep their promise; only empty future days follow a change.
      </p>
    </div>
  );
}

/** Closing a clinic for dates — consequence first, then the booking engine's cancel flow (S9). */
function CloseForDates({ clinicId }: { clinicId: string }) {
  const hub = useHub();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const key = from && to && to >= from ? `${from}|${to}` : null;
  const [preview, setPreview] = useState<{
    key: string;
    sessions: number;
    bookings: number;
  } | null>(null);
  const impact = preview && preview.key === key ? preview : null;
  useEffect(() => {
    if (!key) return;
    let live = true;
    previewClosure({ scope: "clinic", target_id: clinicId, starts_on: from, ends_on: to }).then(
      (r) => {
        if (live && r.ok) setPreview({ key, sessions: r.sessions, bookings: r.bookings });
      },
    );
    return () => {
      live = false;
    };
  }, [clinicId, from, to, key]);
  if (!open) {
    return (
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setOpen(true)}>
        Close for some days…
      </Button>
    );
  }
  return (
    <section className="flex flex-col gap-3 rounded-md border border-amber-300/60 bg-amber-50/60 p-3 dark:bg-amber-950/20">
      <h3 className="text-foreground text-body-s font-medium">Close this clinic for some days</h3>
      <ErrorLine error={hub.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From">
          <input
            type="date"
            className={inputClass}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            className={inputClass}
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
      </div>
      {impact ? (
        <p className="text-body-s text-foreground">
          {impact.sessions} session{impact.sessions === 1 ? "" : "s"} and {impact.bookings} booking
          {impact.bookings === 1 ? "" : "s"} are affected. Each patient gets one message with the
          next clinic day to rebook in one tap.
        </p>
      ) : null}
      <Field label="Reason (patients are told the day is cancelled)">
        <input
          className={inputClass}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={280}
          placeholder="For example, the clinician is at a conference"
        />
      </Field>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={hub.pending || !from || !to || reason.trim().length < 10 || !impact}
          onClick={() =>
            hub.call(
              () =>
                addClosure({
                  scope: "clinic",
                  target_id: clinicId,
                  starts_on: from,
                  ends_on: to,
                  reason: reason.trim(),
                }),
              () => setOpen(false),
            )
          }
        >
          {hub.pending ? "Closing…" : "Close and tell patients"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Keep it open
        </Button>
      </div>
    </section>
  );
}
