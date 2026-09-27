"use client";

import type { DeathConfirmedPayload, RoscSign } from "@/lib/resus/model";
import type { TimelineEvent } from "@/lib/resus/types";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRightIcon,
  HeartPulseIcon,
  InfoIcon,
  SquareCheckIcon,
  SquareIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { recordRoscV2 } from "@/app/nurse/resus/_v2/actions-arrest";
import { Button } from "@/components/ui/button";
import { ROSC_SIGNS } from "@/lib/resus/model";
import { ALS_REFS, DEATH_OBSERVATION_MS } from "@/lib/resus/reference/als-catalog";
import { cn } from "@/lib/utils";
import { Choice, clock, hhmm } from "./after-arrest-shared";
import { useDeskCtx } from "./desk-context";
import { toOutcome } from "./use-desk";

/**
 * Parts of the death-confirmation panel (death-confirmation.tsx): the checklist
 * row, the group heading, "Signs of life — resume" (ALS-DTH-05) and the
 * confirmed view with End resus → Died.
 */

export type Support = DeathConfirmedPayload["supportedBy"][number];

export const ref = (id: string) => ALS_REFS[id]?.text ?? "";
/** The observation length from the signed constant (ALS-DTH-01), "05:00". */
export const OBS = clock(DEATH_OBSERVATION_MS);

export const SUPPORT_LABEL: Record<Support, string> = {
  ecg_asystole: "ECG asystole",
  no_arterial_trace: "No pulsatile arterial trace",
  echo_no_activity: "Echo: no contractile activity",
};

const ROSC_SIGN_LABEL: Record<RoscSign, string> = {
  pulse: "Pulse",
  bp_arterial_waveform: "BP / arterial waveform",
  etco2_rise: "EtCO₂ rise",
  signs_of_life: "Signs of life",
};

export const isStart = (e: TimelineEvent) =>
  e.kind === "resuscitation_stopped" ||
  (e.kind === "decision" && e.payload.decision === "cpr_not_attempted");

/** A full-width checklist row (≥ 44 px): square + word, check when confirmed. */
export function CheckRow({
  checked,
  disabled,
  onToggle,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const Icon = checked ? SquareCheckIcon : SquareIcon;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "tap text-body-s flex min-h-11 w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left outline-none",
        "focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50",
        checked
          ? "border-teal-600 bg-teal-50 text-teal-800"
          : "border-border bg-card text-foreground hover:bg-muted",
      )}
    >
      <Icon className="size-5 shrink-0" aria-hidden />
      {children}
    </button>
  );
}

export function Group({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-overline text-muted-foreground uppercase">{title}</h3>
      {note ? <p className="text-caption text-muted-foreground">{note}</p> : null}
      {children}
    </section>
  );
}

/** "Signs of life — resume" (ALS-DTH-05): back to the console, or record ROSC. */
export function SignsOfLife({ arrestSeq, onCancel }: { arrestSeq: number; onCancel: () => void }) {
  const { store, ui } = useDeskCtx();
  const [signs, setSigns] = useState<RoscSign[]>([]);
  // The opening button unmounts as this mounts: the focus comes here, not to <body>.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const toggle = (s: RoscSign) =>
    setSigns((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s]));
  const recordRosc = () => {
    const label = `ROSC — ${signs.map((s) => s.replace(/_/g, " ")).join(", ")}`;
    const episodeId = store.episode.id;
    store.submit({
      label: "ROSC",
      optimistic: () => [
        { kind: "rosc", step: "arrest", arrestSeq, payload: { arrestSeq, signs, label } },
      ],
      // R8: "Recorded" only once the server has it; a refusal raises the desk's error toast.
      run: async ({ clientEventId, recordedAt }) => {
        const o = toOutcome(
          await recordRoscV2({ episodeId, clientEventId, recordedAt, arrestSeq, signs }),
        );
        if (o.ok) ui.toast({ message: "Recorded — ROSC" });
        return o;
      },
    });
    ui.toast({ message: "Saving…" });
  };
  return (
    <div className="border-border space-y-3 rounded-lg border p-3">
      <h3
        ref={headingRef}
        tabIndex={-1}
        className="text-overline text-muted-foreground scroll-mt-4 uppercase"
      >
        Signs of life — resume
      </h3>
      <p className="text-body-s text-foreground">{ref("ALS-DTH-05")}</p>
      <Button variant="emergency" size="lg" onClick={() => ui.openArrestConfirm("desk")}>
        <TriangleAlertIcon className="size-5" aria-hidden />
        {arrestSeq > 0 ? "Resume CPR — arrest" : "Start CPR — arrest"}
      </Button>
      {arrestSeq > 0 ? (
        <div className="space-y-2">
          <p className="text-caption text-muted-foreground">
            Or circulation returned — which signs?
          </p>
          <div className="flex flex-wrap gap-2">
            {ROSC_SIGNS.map((s) => (
              <Choice key={s} selected={signs.includes(s)} onClick={() => toggle(s)}>
                {ROSC_SIGN_LABEL[s]}
              </Choice>
            ))}
          </div>
          <Button size="lg" disabled={signs.length === 0} onClick={recordRosc}>
            <HeartPulseIcon className="size-5" aria-hidden />
            Record ROSC
          </Button>
        </div>
      ) : null}
      <Button variant="ghost" size="lg" onClick={onCancel}>
        Back to confirmation
      </Button>
    </div>
  );
}

/** After confirmation: the recorded facts, then End resus → Died. */
export function Confirmed({ event }: { event: TimelineEvent }) {
  const { ui } = useDeskCtx();
  const p = event.payload as Partial<DeathConfirmedPayload>;
  return (
    <section
      data-testid="death-confirmation"
      aria-labelledby="death-confirmed-heading"
      className="border-border bg-card shadow-card space-y-3 rounded-lg border px-4 py-4 sm:px-6"
    >
      <h2 id="death-confirmed-heading" className="text-heading-s text-foreground">
        Death confirmed · {hhmm(p.confirmedAtIso ?? event.recordedAt)}
      </h2>
      <p className="text-body-s text-muted-foreground">
        {p.label ?? "Death confirmed"}
        {p.observationStartedAtIso ? ` · observation from ${hhmm(p.observationStartedAtIso)}` : ""}
      </p>
      <p className="text-caption text-muted-foreground inline-flex gap-1.5">
        <InfoIcon className="size-3.5 shrink-0" aria-hidden />
        {ref("ALS-DTH-09")}
      </p>
      <Button size="lg" onClick={() => ui.openCloseOut()}>
        End resus
        <ArrowRightIcon className="size-4" aria-hidden />
        Died
      </Button>
    </section>
  );
}
