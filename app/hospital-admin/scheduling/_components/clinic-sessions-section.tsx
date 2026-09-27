"use client";

import type { CapacityActionState } from "../actions";
import type { DataTableColumn, PillTone } from "@/components/ui/data-table";
import { useActionState, useEffect, useState } from "react";
import { PlusIcon } from "lucide-react";

import { EditorDialog } from "@/components/medsync/editor-dialog";
import { Panel } from "@/components/medsync/panel";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableEmpty, Pill } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SheetBody,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { upsertSessionTemplateAction } from "../actions";
import { INPUT_CLASS, timeFromMinutes, WEEKDAYS } from "./policy-form";
import { SessionActions } from "./session-actions";

/**
 * Clinic sessions — the weekly rules ("Tuesday Diabetes Clinic, 08:00, 4 h,
 * cap 60, 36 booked / 24 walk-in") and the dated instances the rules have
 * produced for the next 14 days. Editing a rule posts to
 * `upsertSessionTemplateAction` → `ha-upsert-session-template`, which writes
 * the template and materialises its instances; the list below is what that
 * produced, read straight from `clinic_sessions`. Selecting a dated session
 * opens its actions (Gate E): running late, or cancel the day with the
 * affected count shown before confirming.
 */

export interface SessionTemplateRow {
  id: string;
  serviceLineId: string;
  serviceLineName: string;
  clinicianUserId: string | null;
  clinicianName: string | null;
  venue: string | null;
  weekday: number;
  startMinutesLocal: number;
  durationMinutes: number;
  capacityTotal: number;
  capacityBooked: number;
  interleaveBooked: number;
  interleaveWalkIn: number;
  overbookingFactor: number;
  validFrom: string;
  validUntil: string | null;
  active: boolean;
}

/** Pre-formatted on the server in the hospital's zone — no client-side date maths. */
export interface ClinicSessionRow {
  id: string;
  dateLabel: string;
  timeLabel: string;
  serviceLineName: string;
  clinicianName: string | null;
  bookedCount: number;
  capacityBooked: number;
  capacityTotal: number;
  overbookingFactor: number;
  status: string;
  /** Gate E: "running late by N minutes". */
  delayMinutes: number;
}

export interface ServiceLineOption {
  id: string;
  name: string;
}

export interface ClinicianOption {
  userId: string;
  fullName: string;
}

const WEEKDAY_LABEL: Record<number, string> = Object.fromEntries(
  WEEKDAYS.map((d) => [d.value, d.label]),
);

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  cancelled: "Cancelled",
  closed: "Closed",
};

// Workflow states are tags, never a patient's clinical colours (ADR 0162).
const STATUS_TONE: Record<string, PillTone> = {
  draft: "notice",
  published: "active",
  cancelled: "neutral",
  closed: "neutral",
};

export function ClinicSessionsSection({
  templates,
  sessions,
  sessionLines,
  clinicians,
  todayYmd,
}: {
  templates: ReadonlyArray<SessionTemplateRow>;
  sessions: ReadonlyArray<ClinicSessionRow>;
  /** Active service lines in session mode — the only lines a template can hang on. */
  sessionLines: ReadonlyArray<ServiceLineOption>;
  clinicians: ReadonlyArray<ClinicianOption>;
  /** Today's civil date in the hospital's zone, from the server — the client's clock is not the clinic's. */
  todayYmd: string;
}) {
  const [selected, setSelected] = useState<SessionTemplateRow | "new" | null>(null);
  const [session, setSession] = useState<ClinicSessionRow | null>(null);

  const templateColumns: ReadonlyArray<DataTableColumn<SessionTemplateRow>> = [
    {
      id: "line",
      header: "Clinic",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="text-foreground truncate font-medium">
            {row.serviceLineName}
            {row.active ? "" : <span className="text-muted-foreground"> · inactive</span>}
          </span>
          <span className="text-muted-foreground text-caption truncate">
            {row.clinicianName ?? "Not yet assigned"}
            {row.venue ? ` · ${row.venue}` : ""}
          </span>
        </div>
      ),
    },
    {
      id: "when",
      header: "When",
      mono: true,
      // A time never wraps: the Clinic column is the one that gives.
      className: "w-px whitespace-nowrap",
      cell: (row) =>
        `${WEEKDAY_LABEL[row.weekday] ?? row.weekday} ${timeFromMinutes(row.startMinutesLocal)}`,
    },
    {
      id: "cap",
      header: "Booked / cap",
      mono: true,
      className: "w-px whitespace-nowrap",
      headerClassName: "whitespace-nowrap",
      cell: (row) =>
        `${row.capacityBooked} / ${row.capacityTotal}` +
        (row.overbookingFactor > 1 ? ` · ×${row.overbookingFactor.toFixed(2)}` : ""),
    },
  ];

  const sessionColumns: ReadonlyArray<DataTableColumn<ClinicSessionRow>> = [
    {
      id: "when",
      header: "When",
      mono: true,
      className: "w-px whitespace-nowrap",
      cell: (row) => (
        <span className="flex flex-col">
          <span className="text-foreground">{row.dateLabel}</span>
          <span className="text-muted-foreground text-caption">{row.timeLabel}</span>
        </span>
      ),
    },
    {
      id: "line",
      header: "Clinic",
      cell: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="text-foreground truncate font-medium">{row.serviceLineName}</span>
          <span className="text-muted-foreground text-caption truncate">
            {row.clinicianName ?? "Not yet assigned"}
          </span>
        </span>
      ),
    },
    {
      id: "booked",
      header: "Booked / cap",
      mono: true,
      className: "w-px whitespace-nowrap",
      headerClassName: "whitespace-nowrap",
      cell: (row) => {
        const cap = Math.ceil(row.capacityBooked * row.overbookingFactor);
        return `${row.bookedCount} / ${cap}`;
      },
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <span className="inline-flex items-center gap-2">
          <Pill tone={STATUS_TONE[row.status] ?? "neutral"}>
            {STATUS_LABEL[row.status] ?? row.status}
          </Pill>
          {row.delayMinutes > 0 ? (
            <span className="text-status-caution-fg text-caption">{row.delayMinutes} min late</span>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <Panel title="Next 14 days" count={sessions.length}>
        <DataTable
          data={sessions}
          columns={sessionColumns}
          rowKey={(row) => row.id}
          onRowSelect={(row) => setSession(row)}
          selectedRowId={session?.id ?? null}
          caption="Clinic sessions in the next 14 days"
          className="min-h-0 flex-1"
          scrollClassName="max-h-[19rem] min-h-0 flex-1 xl:max-h-none"
          empty={
            <DataTableEmpty
              title="No clinic days yet"
              description="Days appear once a weekly rule is saved."
            />
          }
        />
      </Panel>

      <Panel
        title="Weekly rules"
        count={templates.length}
        action={
          <Button
            type="button"
            onClick={() => setSelected("new")}
            disabled={sessionLines.length === 0}
          >
            <PlusIcon className="size-3.5" />
            New rule
          </Button>
        }
      >
        <DataTable
          data={templates}
          columns={templateColumns}
          rowKey={(row) => row.id}
          onRowSelect={(row) => setSelected(row)}
          selectedRowId={selected && selected !== "new" ? selected.id : null}
          caption="Weekly session rules at this hospital"
          className="min-h-0 flex-1"
          scrollClassName="max-h-[19rem] min-h-0 flex-1 xl:max-h-none"
          empty={
            <DataTableEmpty
              title="No weekly rules yet"
              description={
                sessionLines.length === 0
                  ? "Set a service line to session mode first."
                  : "Add a rule — day, start, length, capacity."
              }
            />
          }
        />
      </Panel>

      <EditorDialog
        width="medium"
        open={session !== null}
        onOpenChange={(open) => !open && setSession(null)}
      >
        {session ? (
          <SessionActions key={session.id} session={session} onClose={() => setSession(null)} />
        ) : null}
      </EditorDialog>

      <EditorDialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        {selected !== null ? (
          <TemplateEditor
            key={selected === "new" ? "new" : selected.id}
            template={selected === "new" ? null : selected}
            sessionLines={sessionLines}
            clinicians={clinicians}
            todayYmd={todayYmd}
            onClose={() => setSelected(null)}
          />
        ) : null}
      </EditorDialog>
    </>
  );
}

/* ─── Editor ───────────────────────────────────────────────────────── */

function TemplateEditor({
  template,
  sessionLines,
  clinicians,
  todayYmd,
  onClose,
}: {
  template: SessionTemplateRow | null;
  sessionLines: ReadonlyArray<ServiceLineOption>;
  clinicians: ReadonlyArray<ClinicianOption>;
  todayYmd: string;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<CapacityActionState, FormData>(
    upsertSessionTemplateAction,
    {},
  );
  const [total, setTotal] = useState<number>(template?.capacityTotal ?? 60);
  const [booked, setBooked] = useState<string>(template ? String(template.capacityBooked) : "");

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  // Part 8 #4 — what the function writes when the booked field is blank.
  const suggestedBooked = Number.isInteger(total) && total > 0 ? Math.ceil(total * 0.6) : 0;
  const bookedNumber = booked === "" ? suggestedBooked : Number(booked);
  const walkIn =
    Number.isInteger(bookedNumber) && bookedNumber > 0 && bookedNumber <= total
      ? total - bookedNumber
      : null;

  // An edited rule keeps its line: the UNIQUE rule key includes the line, and
  // moving a rule between lines would orphan the sessions already produced.
  const lineOptions =
    template && !sessionLines.some((l) => l.id === template.serviceLineId)
      ? [{ id: template.serviceLineId, name: template.serviceLineName }, ...sessionLines]
      : sessionLines;

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col">
      {template ? <input type="hidden" name="id" value={template.id} /> : null}

      <SheetHeader>
        <SheetTitle>{template ? "Edit weekly rule" : "New weekly rule"}</SheetTitle>
        <SheetDescription>
          {template
            ? "Sessions already published keep their capacity. Unbooked future sessions are cancelled if you deactivate the rule."
            : "Saving publishes this clinic's sessions for the next 14 days straight away."}
        </SheetDescription>
      </SheetHeader>

      <SheetBody className="grid items-start gap-5 lg:grid-cols-3">
        <fieldset className="border-border bg-background/40 flex flex-col gap-3 rounded-md border p-4">
          <legend className="text-muted-foreground -ml-1 px-1 font-mono text-[10.5px] tracking-[0.14em] uppercase">
            Clinic
          </legend>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="st-line" className="text-caption tracking-tight">
              Service line
            </Label>
            <select
              id="st-line"
              name="service_line_id"
              required
              defaultValue={template?.serviceLineId ?? lineOptions[0]?.id ?? ""}
              disabled={template !== null}
              className={INPUT_CLASS}
            >
              {lineOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            {template ? (
              <input type="hidden" name="service_line_id" value={template.serviceLineId} />
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="st-clinician" className="text-caption tracking-tight">
              Clinician
            </Label>
            <select
              id="st-clinician"
              name="clinician_user_id"
              defaultValue={template?.clinicianUserId ?? ""}
              className={INPUT_CLASS}
            >
              <option value="">Not yet assigned</option>
              {clinicians.map((c) => (
                <option key={c.userId} value={c.userId}>
                  {c.fullName}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground text-caption">
              Optional now; a session without a clinician is flagged 12 hours before it starts.
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="st-venue" className="text-caption tracking-tight">
              Venue (optional)
            </Label>
            <Input
              id="st-venue"
              name="venue"
              maxLength={160}
              defaultValue={template?.venue ?? ""}
              placeholder="e.g. OPD Room 4"
            />
          </div>
          <label className="text-body-s flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              name="active"
              defaultChecked={template?.active ?? true}
              className="accent-brand-600 mt-0.5 size-4"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-foreground font-medium">Active</span>
              <span className="text-muted-foreground text-caption">
                Unticking cancels this rule&rsquo;s empty future days; booked ones stay.
              </span>
            </span>
          </label>
        </fieldset>

        <fieldset className="border-border bg-background/40 flex flex-col gap-3 rounded-md border p-4">
          <legend className="text-muted-foreground -ml-1 px-1 font-mono text-[10.5px] tracking-[0.14em] uppercase">
            When
          </legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="st-weekday" className="text-caption tracking-tight">
                Day
              </Label>
              <select
                id="st-weekday"
                name="weekday"
                required
                defaultValue={template?.weekday ?? 2}
                className={INPUT_CLASS}
              >
                {WEEKDAYS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="st-start" className="text-caption tracking-tight">
                Starts (EAT)
              </Label>
              <Input
                id="st-start"
                name="start_local"
                type="time"
                step={300}
                required
                defaultValue={timeFromMinutes(template?.startMinutesLocal ?? 480)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="st-duration" className="text-caption tracking-tight">
                Length (minutes)
              </Label>
              <Input
                id="st-duration"
                name="duration_minutes"
                type="number"
                inputMode="numeric"
                min={15}
                max={720}
                step={15}
                required
                defaultValue={template?.durationMinutes ?? 240}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="st-from" className="text-caption tracking-tight">
                Valid from
              </Label>
              <Input
                id="st-from"
                name="valid_from"
                type="date"
                required
                defaultValue={template?.validFrom ?? todayYmd}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="st-until" className="text-caption tracking-tight">
                Valid until (optional)
              </Label>
              <Input
                id="st-until"
                name="valid_until"
                type="date"
                defaultValue={template?.validUntil ?? ""}
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="border-border bg-background/40 flex flex-col gap-3 rounded-md border p-4">
          <legend className="text-muted-foreground -ml-1 px-1 font-mono text-[10.5px] tracking-[0.14em] uppercase">
            Capacity
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="st-total" className="text-caption tracking-tight">
                Patients per session
              </Label>
              <Input
                id="st-total"
                name="capacity_total"
                type="number"
                inputMode="numeric"
                min={1}
                max={500}
                required
                value={Number.isNaN(total) ? "" : total}
                onChange={(e) => setTotal(Number(e.target.value))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="st-booked" className="text-caption tracking-tight">
                Booked allocation
              </Label>
              <Input
                id="st-booked"
                name="capacity_booked"
                type="number"
                inputMode="numeric"
                min={1}
                max={total > 0 ? total : undefined}
                value={booked}
                placeholder={String(suggestedBooked)}
                aria-invalid={booked !== "" && (bookedNumber < 1 || bookedNumber > total)}
                onChange={(e) => setBooked(e.target.value)}
              />
            </div>
          </div>
          <p className="text-muted-foreground text-body-s leading-relaxed">
            {walkIn === null ? (
              "The booked allocation must be between 1 and the session total."
            ) : (
              <>
                <span className="text-foreground font-mono tabular-nums">{bookedNumber}</span>{" "}
                booked and <span className="text-foreground font-mono tabular-nums">{walkIn}</span>{" "}
                walk-in.
                {booked === "" ? " Blank means 60 % booked, rounded up." : ""} Walk-ins are never
                displaced entirely — the split is published to patients.
              </>
            )}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="st-ib" className="text-caption tracking-tight">
                Booked seen per…
              </Label>
              <Input
                id="st-ib"
                name="interleave_booked"
                type="number"
                inputMode="numeric"
                min={1}
                max={20}
                required
                defaultValue={template?.interleaveBooked ?? 2}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="st-iw" className="text-caption tracking-tight">
                …walk-ins seen
              </Label>
              <Input
                id="st-iw"
                name="interleave_walk_in"
                type="number"
                inputMode="numeric"
                min={1}
                max={20}
                required
                defaultValue={template?.interleaveWalkIn ?? 1}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="st-ob" className="text-caption tracking-tight">
                Overbooking factor
              </Label>
              <Input
                id="st-ob"
                name="overbooking_factor"
                type="number"
                inputMode="decimal"
                min={1}
                max={2}
                step={0.05}
                required
                defaultValue={template?.overbookingFactor.toFixed(2) ?? "1.00"}
              />
            </div>
          </div>
          <p className="text-muted-foreground text-caption leading-relaxed">
            2 : 1 means two booked patients are seen for every walk-in. Overbooking above 1.00
            widens every patient&rsquo;s arrival window, and they are told so.
          </p>
        </fieldset>

        <div className="flex flex-col gap-1.5 lg:col-span-3">
          <Label htmlFor="st-reason" className="text-caption tracking-tight">
            Audit note
          </Label>
          <Input
            id="st-reason"
            name="reason"
            minLength={8}
            required
            placeholder="Why this change — at least 8 characters"
          />
          <span className="text-muted-foreground text-caption">Goes to the audit log.</span>
        </div>

        {state.error ? (
          <p
            role="alert"
            className="border-alert-border bg-alert-bg text-alert-fg text-body-s rounded-md border p-3 lg:col-span-3"
          >
            {state.error}
          </p>
        ) : null}
      </SheetBody>

      <SheetFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || walkIn === null}>
          {pending ? "Saving…" : template ? "Save rule" : "Publish rule"}
        </Button>
      </SheetFooter>
    </form>
  );
}
