"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { Combobox, DateRangePicker, Field } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Audit console filter bar.
 *
 * Server-rendered page reads URL params; this client widget collects
 * filter inputs and on submit replaces the URL — the page re-renders
 * with the new filter applied. No client-side data fetching; all the
 * heavy lifting stays on the server.
 */
export interface AuditFiltersState {
  from: string;
  to: string;
  actor: string;
  action: string;
  target: string;
}

const ACTION_OPTIONS = [
  { value: "approve_staff_affiliation", label: "Approve staff affiliation" },
  { value: "reject_staff_affiliation", label: "Reject staff affiliation" },
  { value: "approve_hospital_application", label: "Approve hospital application" },
  { value: "reject_hospital_application", label: "Reject hospital application" },
  { value: "verify_hospital_application", label: "Verify hospital application" },
  { value: "break_glass_open", label: "Break-glass open" },
  { value: "break_glass_close", label: "Break-glass close" },
  { value: "four_eyes_request", label: "Four-eyes request" },
  { value: "four_eyes_confirm", label: "Four-eyes confirm" },
  { value: "activate_hospital", label: "Activate hospital" },
  { value: "suspend_user", label: "Suspend user" },
  { value: "reset_user_mfa", label: "Reset user MFA" },
  { value: "deactivate_user", label: "Deactivate user" },
  { value: "elevate_admin", label: "Elevate admin (hospital)" },
  { value: "create_superadmin", label: "Create superadmin" },
  { value: "export_audit_log", label: "Export audit log" },
];

const TARGET_OPTIONS = [
  { value: "staff_affiliation", label: "Staff affiliation" },
  { value: "hospital_application", label: "Hospital application" },
  { value: "hospital", label: "Hospital" },
  { value: "user", label: "User" },
  { value: "patient_profile", label: "Patient profile" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "break_glass_grant", label: "Break-glass grant" },
  { value: "audit_log_export", label: "Audit log export" },
];

export function AuditFilters({ initial }: { initial: AuditFiltersState }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [actor, setActor] = useState(initial.actor);
  const [action, setAction] = useState(initial.action);
  const [target, setTarget] = useState(initial.target);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const params = new URLSearchParams(searchParams.toString());
    const setOrDel = (k: string, v: string) => {
      if (v) params.set(k, v);
      else params.delete(k);
    };
    setOrDel("from", from);
    setOrDel("to", to);
    setOrDel("actor", actor);
    setOrDel("action", action);
    setOrDel("target", target);
    startTransition(() => {
      router.push(`/admin/audit?${params.toString()}`);
    });
  };

  const reset = () => {
    setFrom("");
    setTo("");
    setActor("");
    setAction("");
    setTarget("");
    startTransition(() => {
      router.push("/admin/audit");
    });
  };

  return (
    <form
      onSubmit={submit}
      className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4 sm:p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label className="text-muted-foreground text-caption mb-1 inline-flex font-medium tracking-[0.01em]">
            Date range
          </label>
          <DateRangePicker
            name="date"
            defaultFrom={from}
            defaultTo={to}
            onRangeChange={(r) => {
              setFrom(r.from);
              setTo(r.to);
            }}
          />
        </div>

        <Field name="action" label="Action">
          <Combobox
            name="action"
            items={ACTION_OPTIONS}
            value={action}
            placeholder="Any action"
            onValueChange={(v) => setAction(v ?? "")}
          />
        </Field>

        <Field name="target" label="Target">
          <Combobox
            name="target"
            items={TARGET_OPTIONS}
            value={target}
            placeholder="Any target"
            onValueChange={(v) => setTarget(v ?? "")}
          />
        </Field>

        <Field name="actor" label="Actor (UUID)" className="lg:col-span-2">
          <Input
            name="actor"
            placeholder="00000000-0000-0000-0000-000000000000"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={isPending}>
          {isPending ? "Filtering…" : "Apply filter"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={reset}>
          Reset
        </Button>
      </div>
    </form>
  );
}
