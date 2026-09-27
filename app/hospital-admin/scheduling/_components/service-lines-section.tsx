"use client";

import type { CapacityActionState, FeeActionState } from "../actions";
import type { DataTableColumn, PillTone } from "@/components/ui/data-table";
import { startTransition, useActionState, useEffect, useState } from "react";
import { PlusIcon, SearchIcon } from "lucide-react";

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
import { PATIENT_REASON_CODES } from "@/supabase/functions/_shared/sessions-sql";
import { setServiceLineFeeAction, upsertServiceLineAction } from "../actions";
import { INPUT_CLASS } from "./policy-form";

/**
 * Service lines — the hospital's bookable services and, per line, which of
 * the three capacity modes it runs in (ADR 0087). Table of every line, row →
 * sheet editor, "New service line" → the same editor blank. The editor posts
 * to `upsertServiceLineAction` → `ha-upsert-service-line`, which owns audit
 * and the write; the form only refuses what the 0058 CHECKs would refuse.
 */

export interface ServiceLineRow {
  id: string;
  name: string;
  slug: string;
  departmentId: string;
  departmentName: string;
  capacityMode: string;
  timeToCareDays: number;
  continuityDefault: boolean;
  confidential: boolean;
  paymentPosture: string;
  feeUgx: number | null;
  depositUgx: number | null;
  reasonCodes: string[];
  isDefault: boolean;
  active: boolean;
}

export interface DepartmentOption {
  id: string;
  name: string;
}

const MODE_LABEL: Record<string, string> = {
  slot: "Slot",
  session: "Session",
  open_queue: "Open queue",
};

const MODE_TONE: Record<string, PillTone> = {
  slot: "neutral",
  session: "info",
  open_queue: "notice",
};

export const REASON_LABEL: Record<string, string> = {
  follow_up: "Follow-up",
  post_discharge: "Post-discharge",
  new_concern: "New concern",
  refill: "Refill",
  test_results: "Test results",
  antenatal: "Antenatal",
  immunisation: "Immunisation",
  child_wellness: "Child wellness",
  specialist_review: "Specialist review",
  routine: "Routine",
  procedure: "Procedure",
  counselling: "Counselling",
  second_opinion: "Second opinion",
  other: "Other",
};

/** The 13 Appendix A codes plus the shipped catch-all, in Appendix A order. */
const REASON_OPTIONS = [...PATIENT_REASON_CODES, "other"] as const;

/** A clinical cadre a fee may attach to (ADR 0092). */
export interface CadreOption {
  id: string;
  name: string;
}

/** One override: what a line costs when this cadre is the one seen. */
export interface CadreFeeRow {
  serviceLineId: string;
  cadreId: string;
  cadreName: string;
  feeUgx: number;
}

export function ServiceLinesSection({
  lines,
  departments,
  cadres,
  fees,
  className,
}: {
  lines: ReadonlyArray<ServiceLineRow>;
  departments: ReadonlyArray<DepartmentOption>;
  cadres: ReadonlyArray<CadreOption>;
  fees: ReadonlyArray<CadreFeeRow>;
  className?: string;
}) {
  // null = closed; "new" = blank editor; a row = edit that row.
  const [selected, setSelected] = useState<ServiceLineRow | "new" | null>(null);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? lines.filter(
        (l) => l.name.toLowerCase().includes(q) || l.departmentName.toLowerCase().includes(q),
      )
    : lines;

  const columns: ReadonlyArray<DataTableColumn<ServiceLineRow>> = [
    {
      id: "name",
      header: "Service line",
      cell: (row) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="text-foreground truncate font-medium">{row.name}</span>
            {row.isDefault ? <Pill tone="active">Default</Pill> : null}
            {row.confidential ? <Pill tone="sensitive">Confidential</Pill> : null}
            {row.active ? null : <Pill tone="neutral">Inactive</Pill>}
          </span>
          <span className="text-muted-foreground text-caption truncate">{row.departmentName}</span>
        </div>
      ),
    },
    {
      id: "mode",
      header: "Mode",
      cell: (row) => (
        <Pill tone={MODE_TONE[row.capacityMode] ?? "neutral"}>
          {MODE_LABEL[row.capacityMode] ?? row.capacityMode}
        </Pill>
      ),
    },
    {
      id: "fee",
      header: "Fee",
      mono: true,
      cell: (row) =>
        row.paymentPosture === "none" || row.feeUgx === null ? (
          <span className="text-muted-foreground">Free</span>
        ) : (
          `UGX ${row.feeUgx.toLocaleString("en-UG")}${row.paymentPosture === "deposit" ? " · deposit" : ""}`
        ),
    },
    {
      id: "ttc",
      header: "Time to care",
      mono: true,
      cell: (row) => `${row.timeToCareDays} d`,
      hideOnNarrow: true,
    },
  ];

  return (
    <Panel
      title="Service lines"
      count={lines.length}
      className={className}
      action={
        <>
          <label className="relative hidden sm:block">
            <span className="sr-only">Search service lines</span>
            <SearchIcon
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search line or department"
              className="h-9 w-56 rounded-md pl-8"
            />
          </label>
          <Button
            type="button"
            onClick={() => setSelected("new")}
            disabled={departments.length === 0}
          >
            <PlusIcon className="size-3.5" />
            New
          </Button>
        </>
      }
    >
      <DataTable
        data={shown}
        columns={columns}
        rowKey={(row) => row.id}
        onRowSelect={(row) => setSelected(row)}
        selectedRowId={selected && selected !== "new" ? selected.id : null}
        caption="Service lines at this hospital"
        // Cropped: the panel is its grid row's height, never the table's.
        className="min-h-0 flex-1"
        scrollClassName="max-h-[21rem] min-h-0 flex-1 xl:max-h-none"
        empty={
          <DataTableEmpty
            title={q ? "Nothing matches" : "No service lines yet"}
            description={
              q
                ? "Try the line's name or its department."
                : "Add a department first, or create a line here."
            }
          />
        }
      />

      <EditorDialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        {selected !== null ? (
          <ServiceLineEditor
            key={selected === "new" ? "new" : selected.id}
            line={selected === "new" ? null : selected}
            departments={departments}
            cadres={cadres}
            fees={selected === "new" ? [] : fees.filter((f) => f.serviceLineId === selected.id)}
            onClose={() => setSelected(null)}
          />
        ) : null}
      </EditorDialog>
    </Panel>
  );
}

/* ─── Editor ───────────────────────────────────────────────────────── */

function ServiceLineEditor({
  line,
  departments,
  cadres,
  fees,
  onClose,
}: {
  line: ServiceLineRow | null;
  departments: ReadonlyArray<DepartmentOption>;
  cadres: ReadonlyArray<CadreOption>;
  fees: ReadonlyArray<CadreFeeRow>;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<CapacityActionState, FormData>(
    upsertServiceLineAction,
    {},
  );
  const [posture, setPosture] = useState(line?.paymentPosture ?? "none");
  const [mode, setMode] = useState(line?.capacityMode ?? "session");

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col">
      {line ? <input type="hidden" name="id" value={line.id} /> : null}
      {line ? <input type="hidden" name="slug" value={line.slug} /> : null}

      <SheetHeader>
        <SheetTitle>{line ? line.name : "New service line"}</SheetTitle>
        <SheetDescription>
          {line
            ? "Applies to new bookings; published clinic days keep theirs."
            : "One bookable service in one department."}
        </SheetDescription>
      </SheetHeader>

      <SheetBody className="grid items-start gap-5 lg:grid-cols-3">
        <fieldset className="border-border bg-background/40 flex flex-col gap-3 rounded-md border p-4">
          <legend className="text-muted-foreground -ml-1 px-1 font-mono text-[10.5px] tracking-[0.14em] uppercase">
            Line
          </legend>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sl-name" className="text-caption tracking-tight">
              Name
            </Label>
            <Input
              id="sl-name"
              name="name"
              required
              minLength={2}
              maxLength={120}
              defaultValue={line?.name ?? ""}
              placeholder="e.g. Diabetes Clinic"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sl-department" className="text-caption tracking-tight">
              Department
            </Label>
            <select
              id="sl-department"
              name="department_id"
              required
              defaultValue={line?.departmentId ?? departments[0]?.id ?? ""}
              className={INPUT_CLASS}
            >
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sl-mode" className="text-caption tracking-tight">
              Capacity mode
            </Label>
            <select
              id="sl-mode"
              name="capacity_mode"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className={INPUT_CLASS}
            >
              <option value="session">Session — numbered position in a clinic</option>
              <option value="slot">Slot — one patient per timed slot</option>
              <option value="open_queue">Open queue — same-day ticket</option>
            </select>
            <span className="text-muted-foreground text-caption">
              {mode === "session"
                ? "A position and an arrival window, from weekly rules."
                : mode === "slot"
                  ? "A time, from each clinician's availability."
                  : "A same-day ticket."}
            </span>
          </div>
        </fieldset>

        <fieldset className="border-border bg-background/40 flex flex-col gap-3 rounded-md border p-4">
          <legend className="text-muted-foreground -ml-1 px-1 font-mono text-[10.5px] tracking-[0.14em] uppercase">
            Access
          </legend>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sl-ttc" className="text-caption tracking-tight">
              Time to care (days)
            </Label>
            <Input
              id="sl-ttc"
              name="time_to_care_days"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              required
              defaultValue={line?.timeToCareDays ?? 7}
              className="sm:max-w-[160px]"
            />
            <span className="text-muted-foreground text-caption">
              The longest wait before this line is flagged.
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span id="sl-reasons-label" className="text-caption text-foreground font-medium">
              Reasons a patient can book this line for
            </span>
            <div role="group" aria-labelledby="sl-reasons-label" className="flex flex-wrap gap-1.5">
              {REASON_OPTIONS.map((code) => (
                <label
                  key={code}
                  className="text-body-s has-checked:border-brand-300 has-checked:bg-accent has-checked:text-accent-foreground border-input bg-background text-muted-foreground ease-expo-out cursor-pointer rounded-md border px-3 py-1.5 transition-colors duration-150 hover:border-gray-300 has-checked:font-medium"
                >
                  <input
                    type="checkbox"
                    name="reason_codes"
                    value={code}
                    defaultChecked={line ? line.reasonCodes.includes(code) : false}
                    className="sr-only"
                  />
                  {REASON_LABEL[code] ?? code}
                </label>
              ))}
            </div>
          </div>
          <label className="text-body-s flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              name="continuity_default"
              defaultChecked={line?.continuityDefault ?? false}
              className="accent-brand-600 mt-0.5 size-4"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-foreground font-medium">Offer continuity first</span>
              <span className="text-muted-foreground text-caption">
                Returning patients see their last clinician first.
              </span>
            </span>
          </label>
          <label className="text-body-s flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              name="confidential"
              defaultChecked={line?.confidential ?? false}
              className="accent-brand-600 mt-0.5 size-4"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-foreground font-medium">Confidential service</span>
              <span className="text-muted-foreground text-caption">
                Hidden from proxy bookers; never named in messages.
              </span>
            </span>
          </label>
        </fieldset>

        <div className="flex flex-col gap-5">
          <fieldset className="border-border bg-background/40 flex flex-col gap-3 rounded-md border p-4">
            <legend className="text-muted-foreground -ml-1 px-1 font-mono text-[10.5px] tracking-[0.14em] uppercase">
              Payment posture
            </legend>
            <p className="text-muted-foreground text-caption">
              Stated to patients; nothing is charged in the app.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sl-posture" className="text-caption tracking-tight">
                  Posture
                </Label>
                <select
                  id="sl-posture"
                  name="payment_posture"
                  value={posture}
                  onChange={(e) => setPosture(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="none">No payment</option>
                  <option value="deposit">Deposit to book</option>
                  <option value="full">Full fee to book</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sl-fee" className="text-caption tracking-tight">
                  Fee (UGX)
                </Label>
                <Input
                  id="sl-fee"
                  name="fee_ugx"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={100}
                  required={posture !== "none"}
                  defaultValue={line?.feeUgx ?? ""}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sl-deposit" className="text-caption tracking-tight">
                  Deposit (UGX)
                </Label>
                <Input
                  id="sl-deposit"
                  name="deposit_ugx"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={100}
                  disabled={posture !== "deposit"}
                  defaultValue={line?.depositUgx ?? ""}
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="border-border bg-background/40 flex flex-col gap-3 rounded-md border p-4">
            <legend className="text-muted-foreground -ml-1 px-1 font-mono text-[10.5px] tracking-[0.14em] uppercase">
              Status
            </legend>
            <label className="text-body-s flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                name="is_default"
                defaultChecked={line?.isDefault ?? false}
                className="accent-brand-600 mt-0.5 size-4"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-foreground font-medium">Hospital default</span>
                <span className="text-muted-foreground text-caption">
                  Where a patient lands with no service chosen. One per hospital.
                </span>
              </span>
            </label>
            <label className="text-body-s flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                name="active"
                defaultChecked={line?.active ?? true}
                className="accent-brand-600 mt-0.5 size-4"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-foreground font-medium">Active</span>
                <span className="text-muted-foreground text-caption">
                  Inactive: no new bookings; held ones stand.
                </span>
              </span>
            </label>
          </fieldset>

          {/* ADR 0092: what this line costs per cadre — a sparse override on the
            flat fee above. Only for a saved, charging line: an override on a
            free line is a contradiction, and the row must exist to attach to.
            Its controls are not part of this form (nested forms are invalid);
            the action is driven directly. */}
          {line && posture !== "none" ? (
            <CadreFees line={line} cadres={cadres} fees={fees} />
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5 lg:col-span-3">
          <Label htmlFor="sl-reason" className="text-caption tracking-tight">
            Audit note
          </Label>
          <Input
            id="sl-reason"
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
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : line ? "Save service line" : "Create service line"}
        </Button>
      </SheetFooter>
    </form>
  );
}

/* ─── Fees by cadre (ADR 0092) ─────────────────────────────────────── */

/**
 * The override table for one line: what it costs when a clinician of a
 * given cadre is the one seen. Zero rows is the common — and compliant —
 * case (Uganda prices by facility level and class, never by cadre, and
 * Mulago charges one consultation fee whoever sees you); a facility that
 * chooses otherwise adds a row here. Held bookings keep their own quote.
 *
 * The cadre's REGISTERED name is the only label — never "senior" or
 * "premium" (UMDPC 2019 §5(d)).
 */
function CadreFees({
  line,
  cadres,
  fees,
}: {
  line: ServiceLineRow;
  cadres: ReadonlyArray<CadreOption>;
  fees: ReadonlyArray<CadreFeeRow>;
}) {
  const [state, action, pending] = useActionState<FeeActionState, FormData>(
    setServiceLineFeeAction,
    {},
  );
  const [cadreId, setCadreId] = useState<string>("");
  const [fee, setFee] = useState<string>("");
  const [reason, setReason] = useState<string>("");

  const submit = (override: { cadreId: string; feeUgx: string | null }) => {
    const fd = new FormData();
    fd.set("service_line_id", line.id);
    fd.set("cadre_id", override.cadreId);
    if (override.feeUgx !== null) fd.set("fee_ugx", override.feeUgx);
    fd.set("reason", reason);
    // Outside a transition, useActionState's `pending` never flips (React 19).
    startTransition(() => action(fd));
  };

  return (
    <div className="border-border flex flex-col gap-3 rounded-md border p-3">
      <div className="flex flex-col gap-1">
        <span className="text-foreground text-body-s font-medium">Fees by cadre</span>
        <span className="text-muted-foreground text-caption">
          Optional. No rows = the flat fee above for everyone. Held bookings keep their quote.
        </span>
      </div>

      {fees.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {fees.map((f) => (
            <li key={f.cadreId} className="flex items-center justify-between gap-3">
              <span className="text-body-s">
                <span className="text-foreground font-medium">{f.cadreName}</span>
                <span className="text-muted-foreground font-mono tabular-nums">
                  {" "}
                  · UGX {f.feeUgx.toLocaleString("en-UG")}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending || reason.length < 8}
                onClick={() => submit({ cadreId: f.cadreId, feeUgx: null })}
              >
                Clear
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="slf-cadre" className="text-caption tracking-tight">
            Cadre
          </Label>
          <select
            id="slf-cadre"
            value={cadreId}
            onChange={(e) => setCadreId(e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">Choose a cadre</option>
            {cadres.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="slf-fee" className="text-caption tracking-tight">
            Fee (UGX)
          </Label>
          <Input
            id="slf-fee"
            type="number"
            inputMode="numeric"
            min={0}
            step={100}
            value={fee}
            onChange={(e) => setFee(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="slf-reason" className="text-caption tracking-tight">
          Audit note
        </Label>
        <Input
          id="slf-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={8}
          placeholder="Why — at least 8 characters"
        />
      </div>

      {state.error ? (
        <p
          role="alert"
          className="border-alert-border bg-alert-bg text-alert-fg text-body-s rounded-md border p-3"
        >
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p className="text-brand-700 text-body-s" role="status">
          Saved.
        </p>
      ) : null}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending || !cadreId || fee === "" || reason.length < 8}
        onClick={() => submit({ cadreId, feeUgx: fee })}
        className="self-start"
      >
        {pending ? "Saving…" : "Set fee for this cadre"}
      </Button>
    </div>
  );
}
