"use client";

import type { DoctorScheduleActionState } from "../actions";
import type { PatientIdentity } from "@/components/medsync/patient-identity";
import { useActionState, useState } from "react";
import { AlertTriangleIcon, CheckIcon, MessageSquareIcon, XIcon } from "lucide-react";

import { Panel } from "@/components/medsync/panel";
import { PatientIdentityCard } from "@/components/medsync/patient-identity";
import { Button } from "@/components/ui/button";
import { approveAppointmentAction, declineAppointmentAction } from "../actions";

interface PendingRow {
  id: string;
  startsAtIso: string;
  endsAtIso: string;
  type: string;
  reason: string;
  reasonNote: string | null;
  patientName: string;
  patientCode: string;
  identity: PatientIdentity;
  priority: string;
}

export function PendingApprovalsRail({ rows }: { rows: ReadonlyArray<PendingRow> }) {
  return (
    // Capped at the calendar's height beside it; the list scrolls inside.
    <Panel
      title="Awaiting approval"
      count={rows.length}
      className="max-h-[max(60svh,520px)] lg:max-h-[min(72svh,760px)]"
    >
      {rows.length === 0 ? (
        <div className="px-4 py-4">
          <p className="border-border text-muted-foreground text-body-s rounded-[10px] border border-dashed px-3 py-3">
            Nothing waiting for you.
          </p>
        </div>
      ) : (
        <ul className="divide-border/60 min-h-0 flex-1 divide-y overflow-auto px-3">
          {rows.map((r) => (
            <li key={r.id} className="px-2 py-3">
              <PendingRow row={r} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function PendingRow({ row }: { row: PendingRow }) {
  const [mode, setMode] = useState<"view" | "decline">("view");
  const [approveState, approveAction, approvePending] = useActionState<
    DoctorScheduleActionState,
    FormData
  >(approveAppointmentAction, {});
  const [declineState, declineAction, declinePending] = useActionState<
    DoctorScheduleActionState,
    FormData
  >(declineAppointmentAction, {});

  // Approve/Decline name the person when the reveal came through, else the code.
  const who = row.identity.displayName ?? row.patientCode;

  return (
    <div className="flex flex-col gap-2">
      {/* The rail is 20rem wide: the card takes the row and the actions take
          their own — beside each other they left the name ~60px. */}
      <PatientIdentityCard patient={row.identity} />
      {/* The card carries the note inside its complaint line; the when-line stays its own row. */}
      <span className="text-muted-foreground text-body-s inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        {formatWhen(row.startsAtIso)} · {row.reason}
        {row.type === "virtual" ? " · Virtual" : ""}
        {row.priority === "urgent" ? (
          // No entrance animation on the chip: `scale-in` overshoots on
          // --ease-spring, and a priority flag that pops is motion without
          // meaning on a clinical surface.
          <span className="text-caption inline-flex items-center gap-0.5 rounded-full bg-rose-100 px-1.5 py-0.5 font-mono font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertTriangleIcon className="size-2.5" aria-hidden />
            URGENT
          </span>
        ) : null}
      </span>

      {mode === "view" ? (
        <div className="flex items-center justify-end gap-1.5">
          <form action={approveAction}>
            <input type="hidden" name="appointment_id" value={row.id} />
            <input type="hidden" name="reason" value="Approved from pending rail." />
            {/* size="sm" is ~24px tall; min-h-11 restores the 44px touch
                    floor without changing the dense chrome. */}
            <Button
              type="submit"
              size="sm"
              className="min-h-11"
              disabled={approvePending}
              aria-label={`Approve ${who}`}
            >
              <CheckIcon className="size-3.5" aria-hidden />
              Accept
            </Button>
          </form>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11"
            onClick={() => setMode("decline")}
            aria-label={`Decline ${who}`}
          >
            <XIcon className="size-3.5" aria-hidden />
            Decline
          </Button>
        </div>
      ) : null}

      {mode === "decline" ? (
        <form action={declineAction} className="reveal-up flex flex-col gap-2 pt-1">
          <label
            htmlFor={`decline-reason-${row.id}`}
            className="text-muted-foreground text-caption inline-flex items-center gap-1.5 tracking-tight"
          >
            <MessageSquareIcon className="size-3" aria-hidden />
            Reason (≥ 8 chars · audited, staff only — the patient reads a fixed sentence)
          </label>
          <input type="hidden" name="appointment_id" value={row.id} />
          <textarea
            id={`decline-reason-${row.id}`}
            name="reason"
            rows={2}
            required
            minLength={8}
            maxLength={500}
            placeholder="Briefly explain why this slot can't go ahead."
            className="border-input bg-background text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-ring/50 focus-visible:border-ring text-body-s resize-none rounded-md border px-3 py-2 leading-relaxed outline-none focus-visible:ring-[3px]"
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              onClick={() => setMode("view")}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="emergency"
              size="sm"
              className="min-h-11"
              disabled={declinePending}
            >
              {declinePending ? "Sending…" : "Send decline"}
            </Button>
          </div>
        </form>
      ) : null}

      {approveState.error ? (
        <p role="alert" className="text-destructive ncd-reveal text-caption">
          {approveState.error}
        </p>
      ) : null}
      {declineState.error ? (
        <p role="alert" className="text-destructive ncd-reveal text-caption">
          {declineState.error}
        </p>
      ) : null}
    </div>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}
