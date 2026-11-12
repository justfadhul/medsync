"use client";

import type { MovedBooking } from "../actions";
import type { LineOption } from "@/app/patient/book/_lib/booking";
import type { DeskBooking } from "@/lib/reception/bookings";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { SessionStep, SlotStep } from "@/app/patient/book/_components/pick-steps";
import { firstOpenDay, REASONS } from "@/app/patient/book/_lib/booking";
import { EditorDialog } from "@/components/medsync/editor-dialog";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { formatArrivalWindow, formatFullDate, formatTime } from "@/lib/patient/booking-format";
import { cancelBookingAction, moveBookingAction } from "../actions";

/** Words, never colour alone. */
const STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  pending_approval: "Waiting for the clinician",
  confirmed: "Confirmed",
  arrived: "Here today",
};

const MIN_REASON = 8;

function when(b: DeskBooking): string {
  const day = formatFullDate(b.startsAtIso);
  if (b.sessionId) {
    const window =
      b.arrivalWindowStartIso && b.arrivalWindowEndIso
        ? ` · arrive ${formatArrivalWindow(b.arrivalWindowStartIso, b.arrivalWindowEndIso)}`
        : "";
    return `${day} · clinic day · No. ${b.positionNumber ?? "–"}${window}`;
  }
  return `${day} · ${formatTime(b.startsAtIso)}${b.clinicianName ? ` · ${b.clinicianName}` : ""}`;
}

/**
 * One booking the desk found, with Cancel and Move (ADR 0473). `moveLine` is
 * the clinic it may move within — the same line for a clinic day, the same
 * department for a time — or null when it cannot move (here today, or no
 * other day open).
 */
export function BookingRow({
  booking,
  moveLine,
  nowIso,
  todayIso,
}: {
  booking: DeskBooking;
  moveLine: LineOption | null;
  nowIso: string;
  todayIso: string;
}) {
  const [open, setOpen] = useState<"cancel" | "move" | null>(null);
  const code = booking.bookingCode?.toUpperCase() ?? "No code";
  const clinic = booking.lineName ?? booking.departmentName ?? "Clinic";
  const movable = booking.status !== "arrived";

  return (
    <li className="bg-card dark:shadow-card flex flex-col gap-3 rounded-xl p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground text-body-m font-mono font-semibold tracking-wider">
            {code}
          </span>
          <Pill tone="neutral">{STATUS_LABEL[booking.status] ?? booking.status}</Pill>
        </div>
        <span className="text-foreground text-body-s">
          {clinic}
          {booking.lineName && booking.departmentName ? ` · ${booking.departmentName}` : ""}
        </span>
        <span className="text-muted-foreground text-caption tabular-nums">{when(booking)}</span>
        <span className="text-muted-foreground text-caption font-mono">
          {booking.patientCode ?? "New caller · identity to confirm"}
        </span>
      </div>
      <div className="flex flex-col items-start gap-1 sm:items-end">
        <div className="flex gap-2">
          {movable && moveLine ? (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 px-4"
              onClick={() => setOpen("move")}
            >
              Move…
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 px-4"
            onClick={() => setOpen("cancel")}
          >
            Cancel…
          </Button>
        </div>
        {!movable ? (
          <span className="text-muted-foreground text-caption">
            Checked in today — it cannot move.
          </span>
        ) : !moveLine ? (
          <span className="text-muted-foreground text-caption">
            No other day open in this clinic.
          </span>
        ) : null}
      </div>

      {open === "cancel" ? (
        <CancelDialog booking={booking} code={code} clinic={clinic} onClose={() => setOpen(null)} />
      ) : null}
      {open === "move" && moveLine ? (
        <MoveDialog
          booking={booking}
          code={code}
          clinic={clinic}
          line={moveLine}
          nowIso={nowIso}
          todayIso={todayIso}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </li>
  );
}

function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        Why{" "}
        <span className="text-muted-foreground font-normal">
          (kept in the audit record; the patient does not see it)
        </span>
      </Label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="e.g. Patient called — travelling that day."
        className="border-input text-foreground placeholder:text-muted-foreground focus-visible:shadow-focus bg-card text-body-m min-h-16 resize-y rounded-lg border px-3 py-2 outline-none"
      />
    </div>
  );
}

function Footer({
  error,
  blockedBy,
  pending,
  confirm,
  onConfirm,
  onClose,
}: {
  error: string | null;
  /** Why the main button is disabled, said beside it; null when it is not. */
  blockedBy: string | null;
  pending: boolean;
  confirm: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="border-border flex flex-col gap-2 border-t px-6 py-4">
      {error ? (
        <p role="alert" className="text-status-caution-fg text-body-s">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {blockedBy ? (
          <span className="text-muted-foreground text-caption mr-auto">{blockedBy}</span>
        ) : null}
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
          Keep the booking
        </Button>
        <Button type="button" disabled={!!blockedBy || pending} onClick={onConfirm}>
          {pending ? "Saving…" : confirm}
        </Button>
      </div>
    </div>
  );
}

function CancelDialog({
  booking,
  code,
  clinic,
  onClose,
}: {
  booking: DeskBooking;
  code: string;
  clinic: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const blockedBy =
    reason.trim().length < MIN_REASON ? `Say why in at least ${MIN_REASON} characters.` : null;

  const confirm = () =>
    start(async () => {
      setError(null);
      const r = await cancelBookingAction({ appointment_id: booking.id, reason: reason.trim() });
      if (!r.ok) return setError(r.error);
      router.refresh();
      onClose();
    });

  return (
    <EditorDialog open onOpenChange={(o) => !o && !pending && onClose()} width="medium">
      <div className="flex flex-col gap-1 px-6 pt-5">
        <DialogTitle>Cancel booking {code}</DialogTitle>
        <DialogDescription>
          {clinic} · {when(booking)}. The patient is told by SMS and in the app that the clinic
          cancelled; the place goes to the next person waiting. This cannot be undone.
        </DialogDescription>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
        <ReasonField value={reason} onChange={setReason} />
      </div>
      <Footer
        error={error}
        blockedBy={blockedBy}
        pending={pending}
        confirm="Cancel the booking"
        onConfirm={confirm}
        onClose={onClose}
      />
    </EditorDialog>
  );
}

function MoveDialog({
  booking,
  code,
  clinic,
  line,
  nowIso,
  todayIso,
  onClose,
}: {
  booking: DeskBooking;
  code: string;
  clinic: string;
  line: LineOption;
  nowIso: string;
  todayIso: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const first = line.clinicians.find((c) => firstOpenDay(c) !== undefined) ?? null;
  const [clinicianUserId, setClinicianUserId] = useState(first?.userId ?? null);
  const [dateIso, setDateIso] = useState(first ? (firstOpenDay(first) ?? "") : "");
  const [slotStartsAtIso, setSlotStartsAtIso] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // One key per attempt; a retry of the same pick replays (ADR 0088).
  const [key, setKey] = useState(() => crypto.randomUUID());
  const bump = () => setKey(crypto.randomUUID());
  const [moved, setMoved] = useState<(MovedBooking & { whenIso: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const nowMs = new Date(nowIso).getTime();

  const isSession = line.capacityMode === "session";
  const clinician = line.clinicians.find((c) => c.userId === clinicianUserId) ?? null;
  const slot = clinician?.slotsByDate[dateIso]?.find((s) => s.startsAtIso === slotStartsAtIso);
  const session = line.sessions.find((s) => s.id === sessionId) ?? null;
  const blockedBy = !(isSession ? session : slot)
    ? isSession
      ? "Choose a clinic day."
      : "Choose a day and time."
    : reason.trim().length < MIN_REASON
      ? `Say why in at least ${MIN_REASON} characters.`
      : null;

  const confirm = () =>
    start(async () => {
      setError(null);
      const to = session
        ? { session_id: session.id }
        : clinician && slot
          ? {
              slot: {
                clinician_user_id: clinician.userId,
                department_id: line.departmentId,
                service_line_id: line.id,
                starts_at: slot.startsAtIso,
                ends_at: slot.endsAtIso,
              },
            }
          : null;
      if (!to) return;
      const r = await moveBookingAction({
        appointment_id: booking.id,
        reason: reason.trim(),
        idempotency_key: key,
        to,
      });
      if (!r.ok) {
        setError(r.error);
        // A full day or a taken time: fetch the offer again; keep the pick.
        router.refresh();
        return;
      }
      // The list refreshes on close: refreshing now would drop this row, and
      // the new code with it, before the clerk has read it out.
      setMoved({ ...r.data, whenIso: session?.startsAtIso ?? slot?.startsAtIso ?? nowIso });
    });
  const close = () => {
    if (moved) router.refresh();
    onClose();
  };

  return (
    <EditorDialog open onOpenChange={(o) => !o && !pending && close()} width="wide">
      <div className="flex flex-col gap-1 px-6 pt-5">
        <DialogTitle>Move booking {code}</DialogTitle>
        <DialogDescription>
          {clinic} · now {when(booking)}. The new booking gets its own code
          {isSession ? " and number" : ""}, and the patient is texted it.
        </DialogDescription>
      </div>

      {moved ? (
        <>
          <div className="flex flex-col items-start gap-2 px-6 py-6" role="status">
            <span className="text-muted-foreground text-overline font-mono uppercase">
              New booking code
            </span>
            <span className="text-foreground text-display-s font-mono font-semibold tracking-widest">
              {moved.booking_code?.toUpperCase() ?? "—"}
            </span>
            <span className="text-foreground text-body-m">
              {formatFullDate(moved.whenIso)}
              {moved.position_number != null ? ` · No. ${moved.position_number}` : ""}
              {moved.arrival_window_start && moved.arrival_window_end
                ? ` · arrive ${formatArrivalWindow(moved.arrival_window_start, moved.arrival_window_end)}`
                : isSession
                  ? ""
                  : ` · ${formatTime(moved.whenIso)}`}
            </span>
            <span className="text-muted-foreground text-body-s">
              Read the code out. It is texted to the patient too; the old code no longer works.
            </span>
          </div>
          <div className="border-border flex justify-end border-t px-6 py-4">
            <Button type="button" onClick={close}>
              Done
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-4">
            <section className="flex flex-col gap-3">
              <h3 className="text-foreground text-heading-s">
                1. {isSession ? "New clinic day" : "New day and time"}
              </h3>
              {isSession ? (
                <SessionStep
                  line={line}
                  sessionId={sessionId}
                  nowMs={nowMs}
                  desk
                  onPick={(id) => {
                    setSessionId(id);
                    bump();
                  }}
                />
              ) : (
                <SlotStep
                  line={line}
                  clinician={clinician}
                  dateIso={dateIso}
                  slotStartsAtIso={slotStartsAtIso}
                  appointmentType="in_person"
                  nowMs={nowMs}
                  todayIso={todayIso}
                  desk
                  onClinician={(userId) => {
                    const next = line.clinicians.find((c) => c.userId === userId);
                    setClinicianUserId(userId);
                    setDateIso(next ? (firstOpenDay(next) ?? "") : "");
                    setSlotStartsAtIso(null);
                    bump();
                  }}
                  onDate={(d) => {
                    setDateIso(d);
                    setSlotStartsAtIso(null);
                    bump();
                  }}
                  onSlot={(s) => {
                    setSlotStartsAtIso(s);
                    bump();
                  }}
                  onType={() => {}}
                />
              )}
            </section>
            <section className="flex flex-col gap-3">
              <h3 className="text-foreground text-heading-s">2. Why it moves</h3>
              <p className="text-muted-foreground text-body-s">
                Reason for the visit stays{" "}
                {REASONS.find((r) => r.value === booking.reason)?.title.toLowerCase() ??
                  booking.reason}
                .
              </p>
              <ReasonField value={reason} onChange={setReason} />
            </section>
          </div>
          <Footer
            error={error}
            blockedBy={blockedBy}
            pending={pending}
            confirm={isSession ? "Move to this day" : "Move to this time"}
            onConfirm={confirm}
            onClose={onClose}
          />
        </>
      )}
    </EditorDialog>
  );
}
