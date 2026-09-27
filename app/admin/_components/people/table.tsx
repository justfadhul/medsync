"use client";

import type { PeopleActionState } from "../../people/actions";
import type { PeopleItem } from "./types";
import type { DataTableColumn, PillTone, SortDirection } from "@/components/ui/data-table";
import { useActionState, useEffect, useMemo, useState } from "react";
import {
  KeyRoundIcon,
  PauseIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  UserMinusIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable, DataTableEmpty, DataTableToolbar, Pill } from "@/components/ui/data-table";
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
import {
  createSuperadminAction,
  deactivateUserAction,
  resetUserMfaAction,
  suspendUserAction,
} from "../../people/actions";

/**
 * People table — operators + clinicians + patients across tenants.
 * Operational fields only — no decrypted PHI ever surfaces here.
 *
 * The detail panel exposes four actions:
 *   1. Suspend         — operational, reversible
 *   2. Reset MFA       — unenrols TOTP via Auth admin API
 *   3. Deactivate      — soft delete; refuses self + superadmin
 *   4. Promote → SA    — four-eyes-class; auto-satisfies with 1 SA
 *                         today, will enforce a 2nd approval once
 *                         a 2nd real superadmin exists.
 *
 * Promote-to-SA carries the kickoff's sensitive-action visual
 * language: amber surface, explicit "what happens next" copy, and
 * the four-eyes pending result is surfaced inline.
 */

interface TableProps {
  items: ReadonlyArray<PeopleItem>;
  /** Currently-signed-in operator's id — used to disable self-actions. */
  currentUserId: string;
  /** Pre-populated search input (driven by ?q= server-side). */
  initialQuery: string;
}

// Workflow states are tags, never a patient's clinical colours (ADR 0162).
const STATE_TONE: Record<string, PillTone> = {
  active: "active",
  verified: "active",
  pending_approval: "notice",
  rejected: "neutral",
  suspended: "notice",
  deactivated: "neutral",
  unverified: "neutral",
};

export function PeopleTable({ items, currentUserId, initialQuery }: TableProps) {
  const [sortKey, setSortKey] = useState<string | undefined>("fullName");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [selected, setSelected] = useState<PeopleItem | null>(null);

  const sorted = useMemo(() => {
    if (!sortKey || sortDir === null) return items;
    const copy = [...items];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "fullName") cmp = a.fullName.localeCompare(b.fullName);
      else if (sortKey === "email") cmp = a.email.localeCompare(b.email);
      else if (sortKey === "state") cmp = a.state.localeCompare(b.state);
      else if (sortKey === "created") {
        cmp = new Date(a.createdAtIso).getTime() - new Date(b.createdAtIso).getTime();
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [items, sortKey, sortDir]);

  const columns: ReadonlyArray<DataTableColumn<PeopleItem>> = useMemo(
    () => [
      {
        id: "fullName",
        header: "Name",
        sortable: true,
        cell: (row) => <span className="text-foreground font-medium">{row.fullName}</span>,
      },
      {
        id: "email",
        header: "Email",
        sortable: true,
        mono: true,
        cell: (row) => <span className="text-muted-foreground">{row.email}</span>,
        hideOnNarrow: true,
      },
      {
        id: "roles",
        header: "Roles",
        cell: (row) => <RolesSummary roles={row.roles} />,
        className: "w-[220px]",
      },
      {
        id: "state",
        header: "State",
        sortable: true,
        cell: (row) => <Pill tone={STATE_TONE[row.state] ?? "neutral"}>{row.state}</Pill>,
        className: "w-[140px]",
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col">
      <header className="border-border border-b px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-1">
          <h1 className="font-display text-display-s text-foreground">People &amp; access</h1>
          <p className="text-muted-foreground text-[13.5px]">
            Operational fields only — no PHI. Every action is audited. Promote-to-superadmin is
            four-eyes-aware and auto-satisfies today.
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1200px] flex-1 px-4 sm:px-8">
        {/* Search form — preserves URL state, server-rendered results */}
        <form
          method="GET"
          className="border-border bg-card mt-6 flex items-center gap-2 rounded-lg border p-3 shadow-[0_0_0_1px_rgba(0,0,0,0.02),0_1px_3px_rgba(0,0,0,0.04)]"
        >
          <Input
            type="search"
            name="q"
            defaultValue={initialQuery}
            placeholder="Search by email or name…"
            className="flex-1"
          />
          <Button type="submit" variant="primary" size="sm">
            Search
          </Button>
        </form>

        <div className="border-border bg-card mt-4 overflow-hidden rounded-lg border shadow-[0_0_0_1px_rgba(0,0,0,0.02),0_1px_3px_rgba(0,0,0,0.04)]">
          <DataTable
            caption="People"
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
            toolbar={<DataTableToolbar count={sorted.length} />}
            empty={
              <DataTableEmpty
                title={initialQuery ? "No people match this search." : "No users yet."}
                description={
                  initialQuery
                    ? "Try a different email or name fragment."
                    : "Users appear here as they sign up or are invited."
                }
              />
            }
          />
        </div>
        <p className="text-muted-foreground mt-3 text-center font-mono text-[10.5px] tracking-[0.05em]">
          ↑↓ navigate · ↵ open · esc close
        </p>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent widthClassName="w-full sm:max-w-[560px]">
          {selected ? (
            <PersonDetailContent
              key={selected.id}
              item={selected}
              currentUserId={currentUserId}
              onClose={() => setSelected(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */

function RolesSummary({ roles }: { roles: ReadonlyArray<PeopleItem["roles"][number]> }) {
  if (roles.length === 0) {
    return <span className="text-muted-foreground text-[12px]">No role</span>;
  }
  const isSuperadmin = roles.some((r) => r.role === "superadmin");
  const hospitalAdminCount = roles.filter((r) => r.role === "hospital_admin").length;
  const others = roles.filter((r) => r.role !== "superadmin" && r.role !== "hospital_admin");

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {isSuperadmin ? <Pill tone="neutral">superadmin</Pill> : null}
      {hospitalAdminCount > 0 ? (
        <Pill tone="neutral">hospital_admin × {hospitalAdminCount}</Pill>
      ) : null}
      {others.map((r) => (
        <Pill key={r.role + (r.hospitalId ?? "")} tone="neutral">
          {r.role}
        </Pill>
      ))}
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────── */

type Mode = "view" | "suspend" | "reset-mfa" | "deactivate" | "promote-sa";

function PersonDetailContent({
  item,
  currentUserId,
  onClose,
}: {
  item: PeopleItem;
  currentUserId: string;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("view");

  const isSelf = item.id === currentUserId;
  const isSuperadmin = item.roles.some((r) => r.role === "superadmin");
  const isSuspended = item.state === "suspended";
  const isDeactivated = item.state === "deactivated";

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2">
          <Pill tone={STATE_TONE[item.state] ?? "neutral"}>{item.state}</Pill>
          {isSuperadmin ? <Pill tone="neutral">superadmin</Pill> : null}
        </div>
        <SheetTitle>{item.fullName}</SheetTitle>
        <SheetDescription className="font-mono text-[12px]">{item.email}</SheetDescription>
      </SheetHeader>

      <SheetBody>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[120px_1fr]">
          <Evidence label="User ID" value={item.id} mono />
          <Evidence label="State" value={item.state} />
          <Evidence label="Created" value={new Date(item.createdAtIso).toLocaleString()} mono />
          <Evidence
            label="Roles"
            value={
              item.roles.length === 0
                ? "(no roles)"
                : item.roles.map((r) => r.role + (r.hospitalId ? ` (hosp)` : "")).join(", ")
            }
          />
        </dl>

        {isSelf ? (
          <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
            This is your account. Self-mutating actions are disabled.
          </div>
        ) : null}
      </SheetBody>

      <SheetFooter>
        {mode === "view" ? (
          <div className="flex w-full flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            {!isSuspended && !isSelf ? (
              <Button variant="secondary" onClick={() => setMode("suspend")}>
                <PauseIcon className="size-3.5" /> Suspend…
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => setMode("reset-mfa")}>
              <KeyRoundIcon className="size-3.5" /> Reset MFA…
            </Button>
            {!isDeactivated && !isSelf && !isSuperadmin ? (
              <Button variant="secondary" onClick={() => setMode("deactivate")}>
                <UserMinusIcon className="size-3.5" /> Deactivate…
              </Button>
            ) : null}
            {!isSuperadmin && !isSelf ? (
              <Button
                onClick={() => setMode("promote-sa")}
                className="border-amber-300/70 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-700/40 dark:bg-amber-950/40 dark:text-amber-200"
              >
                <ShieldOffIcon className="size-3.5" /> Promote to SA…
              </Button>
            ) : null}
          </div>
        ) : null}

        {mode === "suspend" ? (
          <ReasonForm
            action={suspendUserAction}
            userId={item.id}
            label="Reason for suspending (audit log)"
            placeholder="e.g. Account compromised — temporary lock pending investigation."
            submitLabel="Confirm suspend"
            variant="secondary"
            onCancel={() => setMode("view")}
            onSuccess={onClose}
          />
        ) : null}

        {mode === "reset-mfa" ? (
          <ReasonForm
            action={resetUserMfaAction}
            userId={item.id}
            label="Reason for resetting MFA (audit log)"
            placeholder="e.g. Lost authenticator device — re-enrolment required."
            submitLabel="Confirm reset"
            variant="secondary"
            onCancel={() => setMode("view")}
            onSuccess={onClose}
          />
        ) : null}

        {mode === "deactivate" ? (
          <ReasonForm
            action={deactivateUserAction}
            userId={item.id}
            label="Reason for deactivating (audit log)"
            placeholder="e.g. User left the institution — confirmed with hospital admin."
            submitLabel="Confirm deactivate"
            variant="secondary"
            onCancel={() => setMode("view")}
            onSuccess={onClose}
          />
        ) : null}

        {mode === "promote-sa" ? (
          <PromoteToSaForm item={item} onCancel={() => setMode("view")} onSuccess={onClose} />
        ) : null}
      </SheetFooter>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────── */

function ReasonForm({
  action,
  userId,
  label,
  placeholder,
  submitLabel,
  variant,
  onCancel,
  onSuccess,
}: {
  action: (prev: PeopleActionState, formData: FormData) => Promise<PeopleActionState>;
  userId: string;
  label: string;
  placeholder: string;
  submitLabel: string;
  variant: "primary" | "secondary";
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [state, formAction, pending] = useActionState<PeopleActionState, FormData>(action, {});

  useEffect(() => {
    if (state.ok && !state.awaitingSecondApproval) onSuccess();
  }, [state.ok, state.awaitingSecondApproval, onSuccess]);

  return (
    <form action={formAction} className="flex w-full flex-col gap-3">
      <input type="hidden" name="user_id" value={userId} />
      <div className="flex flex-col gap-1.5 text-left">
        <Label htmlFor="reason">
          {label} <span className="text-muted-foreground font-normal">(≥ 8 chars)</span>
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
        <Button type="submit" variant={variant} disabled={pending}>
          {pending ? "Submitting…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/* ────────────────────────────────────────────────────────────────── */

/**
 * Promote-to-superadmin — four-eyes-class, deserves a distinct
 * visual envelope: amber surface, explicit "what happens next"
 * copy, the four-eyes pending result surfaced inline.
 */
function PromoteToSaForm({
  item,
  onCancel,
  onSuccess,
}: {
  item: PeopleItem;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [state, formAction, pending] = useActionState<PeopleActionState, FormData>(
    createSuperadminAction,
    {},
  );

  // Only close on a *terminal* success (not on four-eyes pending — the
  // operator should see the "awaiting second SA" banner before the
  // panel closes).
  useEffect(() => {
    if (state.ok && !state.awaitingSecondApproval) onSuccess();
  }, [state.ok, state.awaitingSecondApproval, onSuccess]);

  return (
    <form
      action={formAction}
      className={cn(
        "flex w-full flex-col gap-3 rounded-md border border-amber-300/70 bg-amber-50 px-3 py-3 ring-1 ring-amber-500/15 ring-inset",
        "dark:border-amber-500/40 dark:bg-amber-950/40",
      )}
    >
      <input type="hidden" name="target_user_id" value={item.id} />

      <div className="flex items-start gap-2">
        <ShieldCheckIcon
          className="size-4 shrink-0 text-amber-700 dark:text-amber-400"
          aria-hidden
        />
        <p className="text-[12.5px] leading-relaxed text-amber-900 dark:text-amber-100">
          Promoting <span className="font-semibold">{item.fullName}</span> to{" "}
          <span className="font-mono">superadmin</span> — the most powerful role in the system.
          Four-eyes-aware: auto-satisfies with 1 SA today, will enforce a 2nd confirmation once a
          2nd exists.
        </p>
      </div>

      <Label htmlFor="justification" className="text-amber-900 dark:text-amber-200">
        Justification <span className="font-normal opacity-70">(≥ 8 chars, audited)</span>
      </Label>
      <Input
        id="justification"
        name="justification"
        required
        minLength={8}
        autoFocus
        placeholder="e.g. Assigning Caroline as co-platform-operator after onboarding."
        aria-invalid={!!state.error}
      />

      {state.error ? (
        <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">
          {state.error}
        </p>
      ) : null}

      {state.ok && state.awaitingSecondApproval ? (
        <p className="rounded-sm bg-amber-100/60 px-2 py-1.5 text-[12px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          ✓ Recorded. Awaiting second superadmin approval{" "}
          {state.pendingId ? (
            <span className="font-mono opacity-70">(id: {state.pendingId.slice(0, 8)}…)</span>
          ) : null}
          .
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Submitting…" : "Confirm promotion"}
        </Button>
      </div>
    </form>
  );
}

function Evidence({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
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
