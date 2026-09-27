"use client";

import type { CloseOutDraft, CloseOutFacts, latestDisposition } from "./close-out-model";
import type { OutcomeCode } from "@/lib/resus/model";
import { useMemo, useState } from "react";

import { computeArrestState } from "@/lib/resus/als/engine";
import { buildSbar } from "@/lib/resus/closeout/handover";
import { levelInputFromRecord, suggestLevel } from "@/lib/resus/closeout/level-of-care";
import { deathObservation } from "@/lib/resus/death/confirmation";
import { closeOutcomeProblem } from "@/lib/resus/v2-rules-closeout";
import { arrestContextOf } from "./after-arrest-shared";
import {
  belowSuggestion,
  chosenLevel,
  deathOutcome,
  outstandingActions,
  recordDevices,
} from "./close-out-model";
import { handoverInput } from "./close-out-sbar";
import { useDeskCtx } from "./desk-context";

/**
 * Lane U6 — what the record says for the close-out sheet, derived from the
 * desk context and the sheet's draft: the arrest facts (frozen at open), the
 * level-of-care suggestion, the chosen level, the SBAR draft and the step gates.
 */

const DIED: readonly string[] = ["died_after_cpr", "died_cpr_not_attempted"];

export function initialDraft(prior: ReturnType<typeof latestDisposition>): CloseOutDraft {
  return {
    arrestEnd: null,
    outcome: null,
    cancelReason: "",
    adminReason: "",
    extras: { agitationDelirium: false, riskOfEscalation: false, rrtNeeded: false },
    destination: prior?.destination ?? null,
    unitId: prior?.unitId ?? null,
    mismatch: prior?.mismatch ?? null,
    mismatchNote: prior?.mismatchNote ?? "",
    bed: null,
    bedAcceptedBy: "",
    sbarEdits: {},
    devices: null,
    dropped: [],
    tests: [],
    escort: "",
    receivingUnit: null,
    receivingCadre: "",
  };
}

export function useCloseOut(draft: CloseOutDraft) {
  const d = useDeskCtx();
  const events = d.store.activeEvents;
  const [nowMs] = useState(() => d.store.nowMs());
  const arrest = useMemo(
    () => computeArrestState(events, nowMs, arrestContextOf(d, events)),
    // d changes identity per desk render; the arrest facts depend on the events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, nowMs],
  );
  const suggestion = useMemo(
    () =>
      suggestLevel(
        levelInputFromRecord(events, { ageYears: d.ageYears, ...draft.extras }),
        d.initial.careUnits,
      ),
    [events, d.ageYears, d.initial.careUnits, draft.extras],
  );

  const deathConfirmed = events.some((e) => e.kind === "death_confirmed");
  const obs = useMemo(() => deathObservation(events, nowMs), [events, nowMs]);
  const phase = d.store.episode.phase;
  const inArrest = d.inArrest;
  const cprOngoing = inArrest && draft.arrestEnd === "cpr_ongoing";
  const outcome: OutcomeCode | null = inArrest
    ? cprOngoing
      ? "transferred_out"
      : null
    : draft.outcome === "cancel"
      ? null
      : draft.outcome;
  const died = !!outcome && DIED.includes(outcome);
  const unit = d.initial.careUnits.find((u) => u.id === draft.unitId) ?? null;
  const chosen = died ? null : chosenLevel(unit, draft.destination);
  const suggested = died ? null : suggestion.level;
  const outstanding = useMemo(() => outstandingActions(d.survey), [d.survey]);
  const devicesDefault = useMemo(() => recordDevices(d.survey, arrest), [d.survey, arrest]);

  const facts: CloseOutFacts = {
    inArrest,
    // The server's rule (closeOutcomeProblem): a stop or CPR-not-attempted with no return since.
    stopped: obs.startedAtMs !== null && !obs.invalidated && !deathConfirmed,
    deathConfirmed,
    deathCode: deathOutcome(events),
    roscRecorded: events.some((e) => e.kind === "rosc"),
    roscSustained: arrest.rosc.atMs !== null ? arrest.rosc.sustained : null,
    boarding: phase === "boarding",
    canBoard: (phase === "survey" || phase === "post_rosc") && !died && !cprOngoing,
    suggestion,
    unit,
    chosen,
    mismatchNeeded: belowSuggestion(suggested, chosen, draft.destination),
    outstanding,
    devicesDefault,
    sbar: buildSbar(
      handoverInput({
        d,
        events,
        arrest,
        draft,
        outcome,
        suggested,
        chosen,
        outstanding,
        devicesDefault,
      }),
    ),
  };

  // R4: the server's own rule, so step 1 never passes an outcome the close would refuse.
  const step1Ok =
    outcome !== null && closeOutcomeProblem(outcome, draft.destination ?? "", events) === null;
  const step2Ok =
    !!draft.destination &&
    (!facts.mismatchNeeded ||
      (!!draft.mismatch &&
        (draft.mismatch !== "clinical_judgement" || draft.mismatchNote.trim().length > 0)));
  return { facts, outcome, died, cprOngoing, suggested, step1Ok, step2Ok };
}
