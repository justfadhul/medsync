"use client";

import type { Support } from "./death-confirmation-parts";
import type { DeathConfirmedPayload } from "@/lib/resus/model";
import { useMemo, useRef, useState } from "react";
import { CircleCheckIcon, ClipboardCheckIcon, InfoIcon } from "lucide-react";

import { confirmDeathV2 } from "@/app/nurse/resus/_v2/actions-arrest";
import { Button } from "@/components/ui/button";
import { currentArrestSeq } from "@/lib/resus/als/timing";
import { deathChecklistComplete, deathObservation } from "@/lib/resus/death/confirmation";
import { DEATH_OBSERVATION_MS } from "@/lib/resus/reference/als-catalog";
import { DEATH_CHECKLIST } from "@/lib/resus/reference/death-confirmation";
import { Choice, clock, hhmm, latest, NEUTRAL_DARK } from "./after-arrest-shared";
import {
  CheckRow,
  Confirmed,
  Group,
  isStart,
  OBS,
  ref,
  SignsOfLife,
  SUPPORT_LABEL,
} from "./death-confirmation-parts";
import { useDeskCtx } from "./desk-context";
import { toOutcome, useNow } from "./use-desk";

/**
 * DeathConfirmation — after a stop (or CPR not attempted) until death is
 * confirmed (prompt §5.11; AoMRC 2025, ALS-DTH-01..09). A 5:00 observation from
 * "CPR stopped"; the bedside checklist in the order it is performed; any return
 * of function → "Signs of life — resume". Confirm is enabled only when the
 * observation is complete and every criterion is recorded. Who may confirm,
 * certification and reportable deaths are configured tasks (D10), not law.
 */

type Criteria = DeathConfirmedPayload["criteria"];
type Corneal = "absent" | "present" | "not_tested";

export function DeathConfirmation() {
  const { store, initial } = useDeskCtx();
  const now = useNow(store.nowMs, 1000);
  const events = store.activeEvents;
  const obs = deathObservation(events, now);
  const start = useMemo(() => latest(events, isStart), [events]);
  // Death confirmed after the latest stop (the desk's own "death_confirmed" test).
  const confirmed = useMemo(
    () =>
      latest(
        events,
        (e) => e.kind === "death_confirmed" && (!start || e.recordedAt >= start.recordedAt),
      ),
    [events, start],
  );
  const arrestSeq = useMemo(() => currentArrestSeq(events), [events]);

  const [c, setC] = useState<Omit<Criteria, "cornealReflexesAbsent">>({
    unconscious: false,
    apnoea: false,
    noCirculation: false,
    pupilsUnreactive: false,
    noMotorResponse: false,
  });
  const [corneal, setCorneal] = useState<Corneal | null>(null);
  const [ventilator, setVentilator] = useState<"disconnected" | "not_ventilated" | null>(null);
  const [supportedBy, setSupportedBy] = useState<Support[]>([]);
  const [familyTold, setFamilyTold] = useState(false);
  const [resume, setResume] = useState(false);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const [sentId, setSentId] = useState<string | null>(null);
  const sent = sentId ? store.pending.find((p) => p.clientEventId === sentId) : undefined;

  if (confirmed) return <Confirmed event={confirmed} />;
  if (obs.startedAtMs === null || !start) return null;

  const criteria: Criteria = {
    ...c,
    cornealReflexesAbsent: corneal === "absent" ? true : corneal === "present" ? false : null,
  };
  const problem = obs.invalidated
    ? "Signs of life were recorded after the stop."
    : sent && sent.status !== "failed"
      ? "Recording the confirmation…"
      : !obs.complete
        ? `Observe ${clock(obs.remainingMs)} more (ALS-DTH-01).`
        : ventilator === null
          ? "Answer the ventilator question (ALS-DTH-03)."
          : corneal === null || !deathChecklistComplete(criteria)
            ? "Confirm every criterion (ALS-DTH-01, -06)."
            : null;
  // A failed attempt (e.g. offline) shows its error; Confirm stays available to re-send.
  const hint = problem ?? sent?.error ?? null;
  const elapsed = Math.min(obs.elapsedMs, DEATH_OBSERVATION_MS);
  const [before, after] = [DEATH_CHECKLIST.slice(0, 3), DEATH_CHECKLIST.slice(3, 5)];

  // Time of death is the bedside moment the clinician is satisfied (AoMRC 2025): the
  // server-anchored tap time, kept when the send is queued offline. No optimistic row:
  // "Death confirmed" is never shown before the server has accepted it. A failed
  // attempt is discarded and re-sent.
  const confirm = () => {
    if (sentId) store.discard(sentId);
    const payload = {
      criteria,
      supportedBy,
      ventilatorDisconnected: ventilator === "disconnected" ? true : null,
      familyToldTimeMayDiffer: familyTold,
    };
    const episodeId = store.episode.id;
    setSentId(
      store.submit({
        label: "Confirm death",
        run: async ({ clientEventId, recordedAt }) =>
          toOutcome(await confirmDeathV2({ ...payload, episodeId, clientEventId, recordedAt })),
      }),
    );
  };

  return (
    <section
      data-testid="death-confirmation"
      aria-labelledby="death-heading"
      className="border-border bg-card shadow-card rounded-lg border"
    >
      <header className="border-border flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-6">
        <h2 id="death-heading" className="text-heading-s text-foreground">
          Confirmation of death
        </h2>
        {obs.complete ? (
          <span className="text-body-s inline-flex items-center gap-1.5 font-medium text-teal-800">
            <CircleCheckIcon className="size-4" aria-hidden />
            {OBS} observed
          </span>
        ) : (
          <span
            className="text-body-m text-foreground font-mono tabular-nums"
            suppressHydrationWarning
          >
            {clock(elapsed)} / {OBS}
          </span>
        )}
        <span
          role="progressbar"
          aria-label="Observation"
          aria-valuemin={0}
          aria-valuemax={DEATH_OBSERVATION_MS / 1000}
          aria-valuenow={Math.floor(elapsed / 1000)}
          className="bg-muted block h-1.5 w-full overflow-hidden rounded-full sm:ml-auto sm:w-40"
        >
          <span
            className="block h-full origin-left bg-teal-500"
            style={{ transform: `scaleX(${elapsed / DEATH_OBSERVATION_MS})` }}
          />
        </span>
        <p className="text-body-s text-muted-foreground w-full">
          {start.kind === "resuscitation_stopped" ? "CPR stopped" : "CPR not attempted"} at{" "}
          {hhmm(obs.startedAtMs)} · observe for at least {OBS} (ALS-DTH-01)
          {obs.restarts > 0 ? ` · observation restarted ${obs.restarts}×` : ""}
        </p>
        <span className="sr-only" aria-live="polite">
          {obs.complete ? `${OBS} observed. Complete the checks after ${OBS}.` : ""}
        </span>
      </header>

      <div className="space-y-5 px-4 py-4 sm:px-6">
        {obs.invalidated ? (
          <p className="text-body-s rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            {ref("ALS-DTH-05")}
          </p>
        ) : null}

        <Group title="Before the observation" note={ref("ALS-DTH-03")}>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Ventilator">
            <Choice
              selected={ventilator === "disconnected"}
              onClick={() => setVentilator("disconnected")}
            >
              Disconnected from the ventilator
            </Choice>
            <Choice
              selected={ventilator === "not_ventilated"}
              onClick={() => setVentilator("not_ventilated")}
            >
              Not ventilated
            </Choice>
          </div>
        </Group>

        <Group title={`Throughout the ${OBS} observation`}>
          {before.map((item) => (
            <CheckRow
              key={item.key}
              checked={c[item.key as keyof typeof c]}
              onToggle={() => setC({ ...c, [item.key]: !c[item.key as keyof typeof c] })}
            >
              {item.text}
            </CheckRow>
          ))}
        </Group>

        <Group title="Supported by (optional)" note={ref("ALS-DTH-04")}>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(SUPPORT_LABEL) as Support[]).map((s) => (
              <Choice
                key={s}
                selected={supportedBy.includes(s)}
                onClick={() =>
                  setSupportedBy((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s]))
                }
              >
                {SUPPORT_LABEL[s]}
              </Choice>
            ))}
          </div>
        </Group>

        <Group
          title={`After ${OBS}`}
          note={obs.complete ? undefined : `Opens when ${OBS} has been observed.`}
        >
          {after.map((item) => (
            <CheckRow
              key={item.key}
              disabled={!obs.complete}
              checked={c[item.key as keyof typeof c]}
              onToggle={() => setC({ ...c, [item.key]: !c[item.key as keyof typeof c] })}
            >
              {item.text}
            </CheckRow>
          ))}
          <div className="space-y-1.5">
            <p className="text-body-s text-foreground">{DEATH_CHECKLIST[5]!.text}</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Corneal reflexes">
              {(["absent", "present", "not_tested"] as const).map((v) => (
                <Choice
                  key={v}
                  disabled={!obs.complete}
                  selected={corneal === v}
                  onClick={() => setCorneal(v)}
                >
                  {v === "absent" ? "Absent" : v === "present" ? "Present" : "Not tested"}
                </Choice>
              ))}
            </div>
            {corneal === "present" ? (
              <p className="text-caption text-muted-foreground">{ref("ALS-DTH-05")}</p>
            ) : null}
          </div>
        </Group>

        <Group title="Family">
          <CheckRow checked={familyTold} onToggle={() => setFamilyTold(!familyTold)}>
            {ref("ALS-DTH-08")}
          </CheckRow>
        </Group>

        <p className="text-caption text-muted-foreground flex gap-1.5">
          <InfoIcon className="size-3.5 shrink-0" aria-hidden />
          <span>
            Confirming clinician: {initial.me.fullName ?? "you"} · {initial.me.cadreName} (
            {ref("ALS-DTH-07")}). {ref("ALS-DTH-09")}
          </span>
        </p>

        {resume ? (
          <SignsOfLife
            arrestSeq={arrestSeq}
            onCancel={() => {
              setResume(false);
              // Back to the button that opened the panel (it re-mounts on this render).
              requestAnimationFrame(() => resumeRef.current?.focus());
            }}
          />
        ) : null}
        <span className="sr-only" aria-live="polite">
          {resume ? "Signs of life — resume: record ROSC or return to the console." : ""}
        </span>
      </div>

      <footer className="border-border flex flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:items-center sm:px-6">
        {resume ? null : (
          <Button
            ref={resumeRef}
            variant="secondary"
            size="lg"
            disabled={store.readOnly}
            onClick={() => setResume(true)}
          >
            Signs of life — resume
          </Button>
        )}
        <p className="text-body-s text-muted-foreground sm:ml-auto" suppressHydrationWarning>
          {hint}
        </p>
        <button
          type="button"
          disabled={problem !== null || store.readOnly}
          onClick={confirm}
          className={NEUTRAL_DARK}
        >
          <ClipboardCheckIcon className="size-5" aria-hidden />
          <span suppressHydrationWarning>Confirm death at {hhmm(now)}</span>
        </button>
      </footer>
    </section>
  );
}
