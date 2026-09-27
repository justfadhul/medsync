"use client";

import type { NurseActionState } from "../../actions";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { ClipboardPenIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { assignPatientToNurseAction } from "../../actions";

interface NurseOption {
  id: string;
  label: string;
}

interface WardOption {
  id: string;
  name: string;
}

export function AssignForm({
  nurses,
  wards,
}: {
  nurses: ReadonlyArray<NurseOption>;
  wards: ReadonlyArray<WardOption>;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<NurseActionState, FormData>(
    assignPatientToNurseAction,
    {},
  );

  if (state.ok) {
    return (
      <div className="border-border bg-card scale-in ring-brand-500/10 flex flex-col items-start gap-3 rounded-lg border p-5 ring-1">
        <span
          aria-hidden
          className="scale-in bg-iris-tint text-iris-icon inline-flex size-9 items-center justify-center rounded-full"
          style={{ animationDelay: "90ms" }}
        >
          <ClipboardPenIcon className="size-4" />
        </span>
        <span className="text-foreground text-[14px] font-medium">Patient assigned</span>
        <Button type="button" className="tap" onClick={() => router.refresh()}>
          Assign another
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="nurse" className="text-caption tracking-tight">
          Nurse
        </Label>
        <select
          id="nurse"
          name="nurse_user_id"
          required
          defaultValue=""
          className="border-input bg-background text-foreground focus-visible:ring-ring/50 text-body-s rounded-md border px-3 py-2 outline-none focus-visible:ring-[3px]"
        >
          <option value="" disabled>
            Choose a nurse on shift
          </option>
          {nurses.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="patient" className="text-caption tracking-tight">
            Patient (UUID)
          </Label>
          <Input
            id="patient"
            name="patient_user_id"
            placeholder="Paste patient UUID"
            required
            className="font-mono text-[12px]"
          />
          <p className="text-muted-foreground text-[10.5px]">
            The picker lands with the patient-directory polish pass.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ward" className="text-caption tracking-tight">
            Ward (optional)
          </Label>
          <select
            id="ward"
            name="ward_id"
            defaultValue=""
            className="border-input bg-background text-foreground focus-visible:ring-ring/50 text-body-s rounded-md border px-3 py-2 outline-none focus-visible:ring-[3px]"
          >
            <option value="">— Department-level —</option>
            {wards.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rk" className="text-caption tracking-tight">
          Relationship
        </Label>
        <select
          id="rk"
          name="relationship_kind"
          defaultValue="primary"
          className="border-input bg-background text-foreground focus-visible:ring-ring/50 text-body-s rounded-md border px-3 py-2 outline-none focus-visible:ring-[3px]"
        >
          <option value="primary">Primary nurse</option>
          <option value="cover">Cover</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ar" className="text-caption tracking-tight">
          Audit note (≥ 8 chars)
        </Label>
        <Input
          id="ar"
          name="reason"
          minLength={8}
          maxLength={200}
          defaultValue="Assigned for today's shift."
          required
        />
      </div>

      {state.error ? (
        <p className="text-destructive border-destructive/30 bg-destructive/5 scale-in rounded-md border px-3 py-2 text-[12px]">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center justify-end">
        <Button type="submit" className="tap" disabled={pending}>
          {pending ? "Assigning…" : "Assign"}
        </Button>
      </div>
    </form>
  );
}
