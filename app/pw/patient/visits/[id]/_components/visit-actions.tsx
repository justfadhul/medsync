"use client";

import type { MoveOption } from "@/lib/patient-web/visits-data";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  clockOf,
  longDayOf,
  MIN_REASON_CHARS,
  reasonTooShort,
  shortDayOf,
} from "@patient-core/visits-calendar";
import { CalendarIcon, CheckIcon, XIcon } from "lucide-react";

import {
  acceptRebookingAction,
  cancelMyAppointmentAction,
  confirmAttendanceAction,
  markArrivedAction,
} from "@/app/patient/appointments/actions";
import { Chip, ChipRow, Dialog, TextField } from "@/components/tide/controls";
import { Button, buttonClass, ICON, Note } from "@/components/tide/kit";
import { VISITS_COPY as C } from "@/content/patient/visits";
import { moveOptionsAction, moveVisitAction } from "../../_lib/actions";

type Mode = "idle" | "move" | "cancel";

/**
 * One visit's three actions (the phone's visits/[id].tsx footer and sheets, as centred dialogs, W1):
 * "I'm coming" answers the day-before request (`pt-confirm-attendance`) and becomes "I'm here" on the day
 * (`ha-mark-arrived`); "Move it" offers this clinician's open days and times (`reschedule-appointment`);
 * "Cancel" asks why (`cancel-appointment`). Both reasons refuse under eight characters and say so. Every
 * refusal from the server is shown word for word.
 */
export function VisitActions({
  visitId,
  controls,
  live,
  answered,
  rebook,
}: {
  visitId: string;
  controls: {
    mine: boolean;
    arrivable: boolean;
    confirmable: boolean;
    canMove: boolean;
    canCancel: boolean;
  };
  live: boolean;
  /** The patient already said they are coming. */
  answered: boolean;
  /** The clinic cancelled the day: the next day its message offered (null: none open), or undefined. */
  rebook?: { sessionId: string; day: string } | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [options, setOptions] = useState<MoveOption[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [pick, setPick] = useState<MoveOption | null>(null);

  if (!controls.mine) return null;

  const close = () => {
    setMode("idle");
    setReason("");
    setDay(null);
    setPick(null);
    setError(null);
  };

  /** One write through an existing action: the server's own sentence on a refusal, verbatim. */
  const run = async (
    act: (prev: object, fd: FormData) => Promise<{ ok?: boolean; error?: string }>,
    fields: Record<string, string>,
    done: string,
  ) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    const res = await act({}, fd);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? C.visitFailed);
      return false;
    }
    setNotice(done);
    router.refresh();
    return true;
  };

  const primary = () =>
    controls.arrivable
      ? run(markArrivedAction, { appointment_id: visitId }, C.hereDone)
      : run(confirmAttendanceAction, { appointment_id: visitId }, C.comingDone);

  const openMove = () => {
    setMode("move");
    setError(null);
    if (options === null)
      void moveOptionsAction(visitId).then((r) => {
        setOptions(r.ok ? r.options : []);
        if (!r.ok) setError(r.error);
      });
  };

  const days = [...new Set((options ?? []).map((o) => o.dayKey))];
  const moveDay = day && days.includes(day) ? day : (days[0] ?? null);
  const dayOptions = (options ?? []).filter((o) => o.dayKey === moveDay);
  const chosen = (pick && pick.dayKey === moveDay ? pick : dayOptions[0]) ?? null;
  const short = reasonTooShort(reason);
  const shortWords = C.reasonShort(MIN_REASON_CHARS);

  const submitMove = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    const res = await moveVisitAction({
      appointmentId: visitId,
      startsAtIso: chosen.startsAtIso,
      endsAtIso: chosen.endsAtIso,
      reason: reason.trim(),
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    close();
    setOptions(null);
    setNotice(C.movedDone);
    if (res.newId) router.replace(`/patient/visits/${res.newId}`);
    else router.refresh();
  };

  const submitCancel = async () => {
    if (
      await run(
        cancelMyAppointmentAction,
        { appointment_id: visitId, reason: reason.trim() },
        C.cancelledDone,
      )
    )
      close();
  };

  const reasonField = (
    <TextField
      label={C.reasonLabel}
      placeholder={C.reasonPlaceholder}
      value={reason}
      onChange={(e) => setReason(e.target.value)}
      maxLength={300}
    />
  );

  return (
    <>
      {notice ? <Note tone="info">{notice}</Note> : null}
      {error && mode === "idle" ? <Note>{error}</Note> : null}

      {live ? (
        <div className="flex flex-wrap items-start gap-3">
          <Button
            tone="accent"
            busy={busy && mode === "idle"}
            disabledReason={
              controls.arrivable || controls.confirmable
                ? undefined
                : answered
                  ? C.comingDone
                  : C.primaryOff
            }
            onClick={() => void primary()}
          >
            <CheckIcon className="size-5" {...ICON} />
            {controls.arrivable ? C.imHere : C.imComing}
          </Button>
          <Button
            tone="outline"
            disabledReason={controls.canMove ? undefined : C.moveOff}
            onClick={openMove}
          >
            <CalendarIcon className="size-5" {...ICON} />
            {C.moveIt}
          </Button>
          <Button
            tone="outline"
            disabledReason={controls.canCancel ? undefined : C.cancelOff}
            onClick={() => {
              setMode("cancel");
              setError(null);
            }}
          >
            <XIcon className="size-5" {...ICON} />
            {C.cancel}
          </Button>
        </div>
      ) : null}

      {rebook !== undefined && !notice ? (
        <div className="flex flex-col items-start gap-2">
          {rebook ? (
            <>
              <Button
                tone="accent"
                busy={busy}
                onClick={() =>
                  void run(
                    acceptRebookingAction,
                    { cancelled_appointment_id: visitId, session_id: rebook.sessionId },
                    C.rebookDone,
                  )
                }
              >
                <CalendarIcon className="size-5" {...ICON} />
                {C.rebook(rebook.day)}
              </Button>
              <p className="text-pw-ink-2 text-[15px]">{C.rebookHint}</p>
            </>
          ) : null}
          <Link href="/patient/book" className={buttonClass("soft", "l")}>
            {C.chooseAnotherDay}
          </Link>
        </div>
      ) : null}

      <Dialog
        open={mode === "move"}
        onOpenChange={(o) => (o ? null : close())}
        title={C.moveTitle}
        width="wide"
        footer={
          <>
            <Button tone="soft" onClick={close}>
              {C.keepIt}
            </Button>
            <Button
              busy={busy}
              disabledReason={!chosen ? C.pickDay : short ? shortWords : undefined}
              onClick={() => void submitMove()}
            >
              {C.moveSubmit}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {options === null ? (
            <p role="status" className="text-pw-ink-2 text-[15px]">
              {C.moveLoading}
            </p>
          ) : options.length === 0 ? (
            <Note>{C.moveNone}</Note>
          ) : (
            <>
              <ChipRow label={C.moveDays}>
                {days.map((k) => (
                  <Chip
                    key={k}
                    selected={k === moveDay}
                    onClick={() => {
                      setDay(k);
                      setPick(null);
                    }}
                  >
                    {shortDayOf(k)}
                  </Chip>
                ))}
              </ChipRow>
              {moveDay ? (
                <ChipRow label={C.moveTimes(longDayOf(moveDay))}>
                  {dayOptions.map((o) => (
                    <Chip
                      key={o.startsAtIso}
                      selected={o.startsAtIso === chosen?.startsAtIso}
                      onClick={() => setPick(o)}
                    >
                      {clockOf(o.startsAtIso)}
                    </Chip>
                  ))}
                </ChipRow>
              ) : null}
            </>
          )}
          <p className="text-pw-ink-2 text-[15px]">{C.slotNote}</p>
          {reasonField}
          {error ? <Note>{error}</Note> : null}
        </div>
      </Dialog>

      <Dialog
        open={mode === "cancel"}
        onOpenChange={(o) => (o ? null : close())}
        title={C.cancelTitle}
        withHelp
        footer={
          <>
            <Button tone="soft" onClick={close}>
              {C.keepIt}
            </Button>
            <Button
              busy={busy}
              disabledReason={short ? shortWords : undefined}
              onClick={() => void submitCancel()}
            >
              {C.cancelSubmit}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-pw-ink-2 text-[17px]">{C.cancelBody}</p>
          {reasonField}
          {error ? <Note>{error}</Note> : null}
        </div>
      </Dialog>
    </>
  );
}
