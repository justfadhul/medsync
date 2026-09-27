"use client";

import type { StaffActionState } from "../actions";
import type {
  DirectoryAffiliationRow,
  DirectoryDepartmentOption,
  DirectoryRoleOption,
} from "../page";
import type { PillTone } from "@/components/ui/data-table";
import type { ChangeEvent } from "react";
import { useActionState, useEffect, useState } from "react";
import { KeyRoundIcon, PauseIcon, PlayIcon, ShieldOffIcon, UserCogIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { assignStaffRoleAction, resetStaffMfaAction, setStaffStatusAction } from "../actions";

// Workflow states are tags, never a patient's clinical colours (ADR 0162).
const STATUS_TONES: Record<string, PillTone> = {
  active: "active",
  approved: "active",
  suspended: "notice",
  deactivated: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  approved: "Active",
  suspended: "Suspended",
  deactivated: "Deactivated",
};

type Mode = "view" | "suspend" | "deactivate" | "reactivate" | "reset_mfa" | "assign_role";

interface SheetProps {
  item: DirectoryAffiliationRow | null;
  roleCatalog: ReadonlyArray<DirectoryRoleOption>;
  departmentCatalog: ReadonlyArray<DirectoryDepartmentOption>;
  onOpenChange: (open: boolean) => void;
}

/**
 * Directory detail panel.
 *
 * Renders the per-affiliation facts (always read-only) plus a row of
 * action buttons whose set depends on the current state:
 *
 *   active / approved  → Change role…  · Reset MFA…  · Suspend…  · Deactivate…
 *   suspended          → Change role…  · Reset MFA…  · Reactivate…
 *   deactivated        → Reactivate…                                (cold case)
 *
 * Every action opens an inline form requiring a ≥ 8 char reason
 * (audited via sa_audit_log). Sensitive actions (Suspend, Deactivate,
 * Reset MFA) carry an amber tone so the friction reads visually.
 */
export function DirectoryDetailSheet({
  item,
  roleCatalog,
  departmentCatalog,
  onOpenChange,
}: SheetProps) {
  return (
    <Sheet open={!!item} onOpenChange={onOpenChange}>
      <SheetContent widthClassName="w-full sm:max-w-[600px]">
        {item ? (
          <DetailContent
            key={item.id}
            item={item}
            roleCatalog={roleCatalog}
            departmentCatalog={departmentCatalog}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailContent({
  item,
  roleCatalog,
  departmentCatalog,
  onClose,
}: {
  item: DirectoryAffiliationRow;
  roleCatalog: ReadonlyArray<DirectoryRoleOption>;
  departmentCatalog: ReadonlyArray<DirectoryDepartmentOption>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("view");
  const isActive = item.state === "active" || item.state === "approved";
  const isSuspended = item.state === "suspended";
  const isDeactivated = item.state === "deactivated";

  return (
    <>
      <SheetHeader className="gap-0 px-6 pt-6 pb-5">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Pill tone={STATUS_TONES[item.state] ?? "neutral"}>
              {STATUS_LABEL[item.state] ?? item.state}
            </Pill>
            <Pill tone="neutral">{item.cadreName}</Pill>
          </div>

          <div className="flex flex-col gap-1.5">
            <h2 className="text-foreground text-heading-l leading-[1.15] tracking-[-0.015em]">
              {item.fullName}
            </h2>
            <p className="text-muted-foreground text-body-s leading-snug">
              {item.roleName} · {item.departmentName}
            </p>
          </div>

          <div className="bg-ink-300 h-px w-10" aria-hidden />

          <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5 text-[11.5px]">
            <Meta label="Email" value={item.email} mono />
            <Meta label="Council" value={item.councilName} />
            <Meta label="Reg. #" value={item.registrationNumber} mono />
          </dl>
        </div>
      </SheetHeader>

      <SheetBody className="px-0 py-0">
        <Section title="Affiliation on file">
          <Rows
            rows={[
              { label: "Role", value: item.roleName },
              { label: "Cadre", value: item.cadreName },
              { label: "Department", value: item.departmentName },
              {
                label: "Employment",
                value: item.employmentType.replace(/_/g, " "),
              },
              { label: "Council", value: item.councilName },
              { label: "Registration #", value: item.registrationNumber, mono: true },
            ]}
          />
        </Section>

        <Section title="Status">
          <p className="text-muted-foreground border-l-2 border-l-transparent px-2.5 text-[12.5px] leading-relaxed">
            {isActive
              ? "This staff member can sign in and act in their role at this hospital."
              : isSuspended
                ? "Sign-in is blocked for this hospital. Other hospitals where this person works are unaffected."
                : "Account is closed for this hospital. The audit trail remains; the person cannot regain access without explicit reactivation."}
          </p>
        </Section>
      </SheetBody>

      <SheetFooter>
        {mode === "view" ? (
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            {isActive ? (
              <>
                <Button variant="secondary" onClick={() => setMode("assign_role")}>
                  <UserCogIcon className="size-3.5" />
                  Change role…
                </Button>
                <Button variant="secondary" onClick={() => setMode("reset_mfa")}>
                  <KeyRoundIcon className="size-3.5" />
                  Reset MFA…
                </Button>
                <Button variant="secondary" onClick={() => setMode("suspend")}>
                  <PauseIcon className="size-3.5" />
                  Suspend…
                </Button>
                <Button variant="secondary" onClick={() => setMode("deactivate")}>
                  <ShieldOffIcon className="size-3.5" />
                  Deactivate…
                </Button>
              </>
            ) : null}
            {isSuspended ? (
              <>
                <Button variant="secondary" onClick={() => setMode("assign_role")}>
                  <UserCogIcon className="size-3.5" />
                  Change role…
                </Button>
                <Button variant="secondary" onClick={() => setMode("reset_mfa")}>
                  <KeyRoundIcon className="size-3.5" />
                  Reset MFA…
                </Button>
                <Button variant="primary" onClick={() => setMode("reactivate")}>
                  <PlayIcon className="size-3.5" />
                  Reactivate…
                </Button>
              </>
            ) : null}
            {isDeactivated ? (
              <Button variant="primary" onClick={() => setMode("reactivate")}>
                <PlayIcon className="size-3.5" />
                Reactivate…
              </Button>
            ) : null}
          </div>
        ) : (
          <ActionForm
            item={item}
            mode={mode}
            roleCatalog={roleCatalog}
            departmentCatalog={departmentCatalog}
            onCancel={() => setMode("view")}
            onSuccess={onClose}
          />
        )}
      </SheetFooter>
    </>
  );
}

/* ─── Action form ─────────────────────────────────────────────────── */

function ActionForm({
  item,
  mode,
  roleCatalog,
  departmentCatalog,
  onCancel,
  onSuccess,
}: {
  item: DirectoryAffiliationRow;
  mode: Exclude<Mode, "view">;
  roleCatalog: ReadonlyArray<DirectoryRoleOption>;
  departmentCatalog: ReadonlyArray<DirectoryDepartmentOption>;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  if (mode === "assign_role") {
    return (
      <AssignRoleForm
        item={item}
        roleCatalog={roleCatalog}
        departmentCatalog={departmentCatalog}
        onCancel={onCancel}
        onSuccess={onSuccess}
      />
    );
  }
  if (mode === "reset_mfa") {
    return (
      <ReasonForm
        action={resetStaffMfaAction}
        item={item}
        cta="Confirm MFA reset"
        ctaPending="Resetting…"
        sensitive
        label="Reason for reset"
        placeholder="e.g. Staff member lost their authenticator; verified identity by phone."
        warning="This unenrols every MFA factor on this person's account. They'll be forced to enrol a new one at next sign-in. Affects their access at every hospital they're affiliated with."
        onCancel={onCancel}
        onSuccess={onSuccess}
      />
    );
  }

  // suspend / deactivate / reactivate — all submit to setStaffStatusAction
  // with a target_state hidden input.
  const target =
    mode === "suspend" ? "suspended" : mode === "deactivate" ? "deactivated" : "approved";
  const sensitive = mode === "suspend" || mode === "deactivate";
  const cta =
    mode === "suspend"
      ? "Confirm suspension"
      : mode === "deactivate"
        ? "Confirm deactivation"
        : "Confirm reactivation";
  const ctaPending =
    mode === "suspend" ? "Suspending…" : mode === "deactivate" ? "Deactivating…" : "Reactivating…";
  const label =
    mode === "suspend"
      ? "Reason for suspension"
      : mode === "deactivate"
        ? "Reason for deactivation"
        : "Reason for reactivation";
  const placeholder =
    mode === "suspend"
      ? "e.g. Internal investigation; access paused while we review."
      : mode === "deactivate"
        ? "e.g. Resigned 2026-04-01; no further access required."
        : "e.g. Investigation closed; restoring access.";
  const warning =
    mode === "suspend"
      ? "Sign-in here blocks immediately. Other hospital affiliations are unaffected."
      : mode === "deactivate"
        ? "This closes the account for this hospital. Reactivation later is possible but should be explicit."
        : undefined;

  return (
    <ReasonForm
      action={setStaffStatusAction}
      item={item}
      cta={cta}
      ctaPending={ctaPending}
      sensitive={sensitive}
      label={label}
      placeholder={placeholder}
      warning={warning}
      onCancel={onCancel}
      onSuccess={onSuccess}
      extraInputs={<input type="hidden" name="target_state" value={target} />}
    />
  );
}

/* ─── ReasonForm primitive ─────────────────────────────────────────── */

function ReasonForm({
  action,
  item,
  cta,
  ctaPending,
  sensitive,
  label,
  placeholder,
  warning,
  onCancel,
  onSuccess,
  extraInputs,
}: {
  action: (state: StaffActionState, fd: FormData) => Promise<StaffActionState>;
  item: DirectoryAffiliationRow;
  cta: string;
  ctaPending: string;
  sensitive?: boolean;
  label: string;
  placeholder: string;
  warning?: string;
  onCancel: () => void;
  onSuccess: () => void;
  extraInputs?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<StaffActionState, FormData>(action, {});

  useEffect(() => {
    if (state.ok) onSuccess();
  }, [state.ok, onSuccess]);

  return (
    <form action={formAction} className="flex w-full flex-col gap-3">
      <input type="hidden" name="affiliation_id" value={item.id} />
      {extraInputs}

      {warning ? (
        <p
          className={cn(
            "rounded-md border px-3 py-2 text-[12px] leading-relaxed",
            sensitive
              ? "border-amber-200 bg-amber-50/60 text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-200"
              : "border-border bg-muted/30 text-muted-foreground",
          )}
          role={sensitive ? "alert" : undefined}
        >
          {warning}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5 text-left">
        <Label htmlFor="reason">
          {label} <span className="text-muted-foreground font-normal">(≥ 8 chars, audited)</span>
        </Label>
        <Input
          id="reason"
          name="reason"
          required
          minLength={8}
          autoFocus
          placeholder={placeholder}
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
        <Button type="submit" variant={sensitive ? "secondary" : "primary"} disabled={pending}>
          {pending ? ctaPending : cta}
        </Button>
      </div>
    </form>
  );
}

/* ─── Assign-role form ─────────────────────────────────────────────── */

function AssignRoleForm({
  item,
  roleCatalog,
  departmentCatalog,
  onCancel,
  onSuccess,
}: {
  item: DirectoryAffiliationRow;
  roleCatalog: ReadonlyArray<DirectoryRoleOption>;
  departmentCatalog: ReadonlyArray<DirectoryDepartmentOption>;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [state, formAction, pending] = useActionState<StaffActionState, FormData>(
    assignStaffRoleAction,
    {},
  );
  const [roleId, setRoleId] = useState<string>(item.roleId);
  const [departmentId, setDepartmentId] = useState<string>(item.departmentId);

  useEffect(() => {
    if (state.ok) onSuccess();
  }, [state.ok, onSuccess]);

  const dirty = roleId !== item.roleId || departmentId !== item.departmentId;

  return (
    <form action={formAction} className="flex w-full flex-col gap-3">
      <input type="hidden" name="affiliation_id" value={item.id} />
      <input type="hidden" name="new_role_id" value={roleId} />
      <input type="hidden" name="new_department_id" value={departmentId} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="department-select">Department</Label>
          <select
            id="department-select"
            value={departmentId}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setDepartmentId(e.target.value)}
            className="border-border text-foreground text-body-s focus-visible:ring-ring rounded-md border bg-transparent px-2 py-1.5 outline-none focus-visible:ring-2"
          >
            {departmentCatalog.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role-select">Role</Label>
          <select
            id="role-select"
            value={roleId}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setRoleId(e.target.value)}
            className="border-border text-foreground text-body-s focus-visible:ring-ring rounded-md border bg-transparent px-2 py-1.5 outline-none focus-visible:ring-2"
          >
            {roleCatalog.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.cadreName})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 text-left">
        <Label htmlFor="reason">
          Reason for change{" "}
          <span className="text-muted-foreground font-normal">(≥ 8 chars, audited)</span>
        </Label>
        <Input
          id="reason"
          name="reason"
          required
          minLength={8}
          autoFocus
          placeholder="e.g. Promoted to Head of Internal Medicine effective 2026-06-01."
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
        <Button type="submit" variant="primary" disabled={pending || !dirty}>
          {pending ? "Saving…" : dirty ? "Confirm change" : "Pick a new role or department"}
        </Button>
      </div>
    </form>
  );
}

/* ─── Layout primitives (mirror of pending-detail-sheet) ───────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-border/70 flex flex-col gap-3 px-6 py-5 [&:not(:first-child)]:border-t">
      <header className="flex items-baseline gap-3">
        <h3 className="text-foreground text-[12.5px] font-medium tracking-[-0.005em]">{title}</h3>
        <span
          aria-hidden
          className="from-border/80 ml-2 h-px flex-1 bg-gradient-to-r to-transparent"
        />
      </header>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: ReadonlyArray<{ label: string; value: string; mono?: boolean }> }) {
  return (
    <dl className="flex flex-col">
      {rows.map((row, i) => (
        <div
          key={i}
          className="border-border/40 grid grid-cols-[140px_1fr] gap-x-5 border-l-2 border-l-transparent py-2 pl-2.5 sm:py-1.5 [&:not(:first-child)]:border-t"
        >
          <dt className="text-muted-foreground self-baseline text-[11.5px] font-medium">
            {row.label}
          </dt>
          <dd
            className={cn(
              "text-foreground text-body-s self-baseline leading-relaxed wrap-break-word",
              row.mono && "font-mono text-[12.5px] tabular-nums",
            )}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted-foreground font-mono text-[10px] tracking-[0.08em] uppercase">
        {label}
      </dt>
      <dd className={cn("text-foreground", mono && "font-mono tabular-nums")}>{value}</dd>
    </div>
  );
}
