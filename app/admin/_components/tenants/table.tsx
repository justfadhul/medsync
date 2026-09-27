"use client";

import type { ActivateState, SetEmergencyPhoneState } from "../../tenants/actions";
import type { TenantItem } from "./types";
import type { DataTableColumn, SortDirection } from "@/components/ui/data-table";
import { useActionState, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DataTable,
  DataTableEmpty,
  DataTableToolbar,
  FilterChip,
  Pill,
} from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { activateHospitalAction, setEmergencyPhoneAction } from "../../tenants/actions";
import { CreateHospitalButton } from "./create-hospital-button";

/**
 * Tenants table — every hospital on the platform with its lifecycle
 * state, admin count, whether it has a verified emergency line (ADR 0084
 * §3), and the two implemented mutations: activate, and set/clear that
 * number. Suspend / deactivate are four-eyes-class and deferred per the
 * kickoff.
 *
 * Same DataTable + Sheet pattern Approvals uses. Filter chips switch
 * by state.
 */

interface TableProps {
  items: ReadonlyArray<TenantItem>;
}

type StateFilter = "all" | "pending_approval" | "active" | "suspended" | "deactivated";

const STATE_TONE: Record<string, "stable" | "caution" | "critical" | "neutral"> = {
  active: "stable",
  pending_approval: "caution",
  pending: "caution",
  suspended: "critical",
  deactivated: "critical",
};

export function TenantsTable({ items }: TableProps) {
  const [filter, setFilter] = useState<StateFilter>("all");
  const [sortKey, setSortKey] = useState<string | undefined>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [selected, setSelected] = useState<TenantItem | null>(null);

  const counts = useMemo(() => {
    const c = {
      all: items.length,
      pending_approval: 0,
      active: 0,
      suspended: 0,
      deactivated: 0,
    };
    for (const item of items) {
      if (item.state === "pending_approval" || item.state === "pending") c.pending_approval += 1;
      else if (item.state === "active") c.active += 1;
      else if (item.state === "suspended") c.suspended += 1;
      else if (item.state === "deactivated") c.deactivated += 1;
    }
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "pending_approval") {
      return items.filter((i) => i.state === "pending_approval" || i.state === "pending");
    }
    return items.filter((i) => i.state === filter);
  }, [filter, items]);

  const sorted = useMemo(() => {
    if (!sortKey || sortDir === null) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "slug") cmp = a.slug.localeCompare(b.slug);
      else if (sortKey === "level") cmp = a.level.localeCompare(b.level);
      else if (sortKey === "state") cmp = a.state.localeCompare(b.state);
      // Missing numbers sort to the top ascending — one click on "Emergency
      // line" is "show me every hospital that cannot ship" (ADR 0084 §3).
      else if (sortKey === "emergency") {
        cmp = (a.emergencyPhone ?? "").localeCompare(b.emergencyPhone ?? "");
      } else if (sortKey === "admins") cmp = a.adminCount - b.adminCount;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const columns: ReadonlyArray<DataTableColumn<TenantItem>> = useMemo(
    () => [
      {
        id: "name",
        header: "Name",
        sortable: true,
        cell: (row) => <span className="text-foreground font-medium">{row.name}</span>,
      },
      {
        id: "slug",
        header: "Slug",
        sortable: true,
        mono: true,
        cell: (row) => <span className="text-muted-foreground">{row.slug}</span>,
        hideOnNarrow: true,
      },
      {
        id: "level",
        header: "Level",
        sortable: true,
        mono: true,
        cell: (row) => <span className="text-muted-foreground">{row.level}</span>,
        className: "w-[130px]",
      },
      {
        id: "emergency",
        header: "Emergency line",
        sortable: true,
        /**
         * The launch blocker, on the list rather than one panel-open away.
         * Never colour alone: the pill carries the words "Not set" and the
         * header names what is missing. Caution, not critical — a hospital
         * with no verified number is unshippable, not a clinical emergency,
         * and ADR 0084 §3 keeps red off this datum entirely.
         */
        cell: (row) =>
          row.emergencyPhone ? (
            <span className="text-muted-foreground font-mono tabular-nums">
              {row.emergencyPhone}
            </span>
          ) : (
            <Pill tone="neutral">Not set</Pill>
          ),
        className: "w-[160px]",
      },
      {
        id: "admins",
        header: "Admins",
        sortable: true,
        mono: true,
        cell: (row) => <span className="text-muted-foreground">{row.adminCount}</span>,
        className: "w-[90px]",
        headerClassName: "text-right",
      },
      {
        id: "state",
        header: "State",
        sortable: true,
        cell: (row) => <Pill tone={STATE_TONE[row.state] ?? "neutral"}>{row.state}</Pill>,
        className: "w-[150px]",
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col">
      <header className="border-border border-b px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto flex w-full max-w-[1200px] items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-display-s text-foreground">Tenants</h1>
            <p className="text-muted-foreground text-[13.5px]">
              {items.length} hospital{items.length === 1 ? "" : "s"} on the platform. Suspend /
              deactivate are four-eyes-class and currently deferred.
            </p>
          </div>
          <CreateHospitalButton />
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1200px] flex-1 px-4 sm:px-8">
        <div className="border-border bg-card mt-6 overflow-hidden rounded-lg border shadow-[0_0_0_1px_rgba(0,0,0,0.02),0_1px_3px_rgba(0,0,0,0.04)]">
          <DataTable
            caption="Tenant hospitals"
            data={sorted}
            columns={columns}
            rowKey={(row) => row.id}
            sortKey={sortKey}
            sortDir={sortDir}
            onSortChange={(k, d) => {
              setSortKey(k);
              setSortDir(d);
            }}
            onRowSelect={(row) => setSelected(row)}
            selectedRowId={selected?.id ?? null}
            toolbar={
              <DataTableToolbar count={sorted.length}>
                <FilterChip
                  active={filter === "all"}
                  onClick={() => setFilter("all")}
                  count={counts.all}
                >
                  All
                </FilterChip>
                <FilterChip
                  active={filter === "pending_approval"}
                  onClick={() => setFilter("pending_approval")}
                  count={counts.pending_approval}
                >
                  Pending
                </FilterChip>
                <FilterChip
                  active={filter === "active"}
                  onClick={() => setFilter("active")}
                  count={counts.active}
                >
                  Active
                </FilterChip>
                <FilterChip
                  active={filter === "suspended"}
                  onClick={() => setFilter("suspended")}
                  count={counts.suspended}
                >
                  Suspended
                </FilterChip>
              </DataTableToolbar>
            }
            empty={
              <DataTableEmpty
                title="No tenants match this filter."
                description="Hospitals appear here once their application is approved or a superadmin onboards them directly."
              />
            }
          />
        </div>
        <p className="text-muted-foreground mt-3 text-center font-mono text-[10.5px] tracking-[0.05em]">
          ↑↓ navigate · ↵ open · esc close
        </p>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent widthClassName="w-full sm:max-w-[520px]">
          {selected ? (
            <TenantDetailContent
              key={selected.id}
              item={selected}
              onClose={() => setSelected(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function TenantDetailContent({ item, onClose }: { item: TenantItem; onClose: () => void }) {
  const [mode, setMode] = useState<"view" | "activate" | "emergency">("view");

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2">
          <Pill tone={STATE_TONE[item.state] ?? "neutral"}>{item.state}</Pill>
          <Pill tone="neutral">{item.level}</Pill>
        </div>
        <SheetTitle>{item.name}</SheetTitle>
        <SheetDescription className="font-mono text-[12px]">{item.slug}</SheetDescription>
      </SheetHeader>

      <SheetBody>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[120px_1fr]">
          <EvidenceRow label="Hospital ID" value={item.id} mono />
          <EvidenceRow label="Facility level" value={item.level} />
          <EvidenceRow label="State" value={item.state} />
          <EvidenceRow
            label="Emergency line"
            value={item.emergencyPhone ?? "Not set — patients see the destination with no number"}
            mono={!!item.emergencyPhone}
          />
          <EvidenceRow label="Admin count" value={String(item.adminCount)} mono />
          <EvidenceRow label="Created" value={new Date(item.createdAtIso).toLocaleString()} mono />
        </dl>

        {item.adminCount === 0 ? (
          <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
            No hospital_admin assigned yet. Activate is permitted, but consider promoting a
            clinician via People before going live.
          </div>
        ) : null}
      </SheetBody>

      <SheetFooter>
        {mode === "view" ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button variant="secondary" onClick={() => setMode("emergency")}>
              {item.emergencyPhone ? "Emergency line…" : "Set emergency line…"}
            </Button>
            {item.state !== "active" ? (
              <Button variant="primary" onClick={() => setMode("activate")}>
                Activate…
              </Button>
            ) : null}
          </>
        ) : mode === "activate" ? (
          <ActivateForm item={item} onCancel={() => setMode("view")} onSuccess={onClose} />
        ) : (
          <EmergencyPhoneForm item={item} onCancel={() => setMode("view")} onSuccess={onClose} />
        )}
      </SheetFooter>
    </>
  );
}

function ActivateForm({
  item,
  onCancel,
  onSuccess,
}: {
  item: TenantItem;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [state, formAction, pending] = useActionState<ActivateState, FormData>(
    activateHospitalAction,
    {},
  );

  useEffect(() => {
    if (state.ok) onSuccess();
  }, [state.ok, onSuccess]);

  return (
    <form action={formAction} className="flex w-full flex-col gap-3">
      <input type="hidden" name="hospital_id" value={item.id} />
      <div className="flex flex-col gap-1.5 text-left">
        <Label htmlFor="reason">
          Activation note{" "}
          <span className="text-muted-foreground font-normal">(≥ 8 chars, audited)</span>
        </Label>
        <Input
          id="reason"
          name="reason"
          required
          minLength={8}
          autoFocus
          placeholder="e.g. Application reviewed; licence verified."
          aria-invalid={!!state.error}
        />
        {state.error ? (
          <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">
            {state.error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Activating…" : "Confirm activation"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Record or clear hospitals.emergency_phone (ADR 0084 §3).
 *
 * The copy is the safety control. Nothing in the stack can tell whether a
 * superadmin dialled the number or copied it off a form, so the label says
 * which line it must be and the helper says it must be rung — and the
 * verification note is what the audit row carries.
 *
 * Blank submits a clear. A number that turns out to be wrong has to be
 * removable: the ADR makes "destination alone, no number" the correct state,
 * and a wrong number on that block is the one thing worse than no number.
 */
function EmergencyPhoneForm({
  item,
  onCancel,
  onSuccess,
}: {
  item: TenantItem;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [state, formAction, pending] = useActionState<SetEmergencyPhoneState, FormData>(
    setEmergencyPhoneAction,
    {},
  );

  useEffect(() => {
    if (state.ok) onSuccess();
  }, [state.ok, onSuccess]);

  return (
    <form action={formAction} className="flex w-full flex-col gap-3">
      <input type="hidden" name="hospital_id" value={item.id} />
      <div className="flex flex-col gap-1.5 text-left">
        <Label htmlFor="emergency_phone">
          Emergency entrance line{" "}
          <span className="text-muted-foreground font-normal">(patients dial this)</span>
        </Label>
        <Input
          id="emergency_phone"
          name="emergency_phone"
          type="tel"
          inputMode="tel"
          autoFocus
          defaultValue={item.emergencyPhone ?? ""}
          placeholder="+256…"
          aria-describedby="emergency_phone_help"
          aria-invalid={!!state.error}
        />
        <p id="emergency_phone_help" className="text-muted-foreground text-[12px]">
          Dial it yourself before saving — it must reach the emergency entrance, not the
          switchboard. Leave blank to remove a number.
        </p>
      </div>
      <div className="flex flex-col gap-1.5 text-left">
        <Label htmlFor="emergency_reason">
          Verification note{" "}
          <span className="text-muted-foreground font-normal">(≥ 8 chars, audited)</span>
        </Label>
        <Input
          id="emergency_reason"
          name="reason"
          required
          minLength={8}
          placeholder="e.g. Dialled 12 Sep; casualty desk answered."
          aria-invalid={!!state.error}
        />
        {state.error ? (
          <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">
            {state.error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save number"}
        </Button>
      </div>
    </form>
  );
}

function EvidenceRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground font-mono text-[10.5px] font-semibold tracking-[0.06em] uppercase">
        {label}
      </dt>
      <dd className={cn("text-foreground text-body-s", mono && "font-mono tabular-nums")}>
        {value}
      </dd>
    </>
  );
}
