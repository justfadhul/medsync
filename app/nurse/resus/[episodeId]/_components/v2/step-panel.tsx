"use client";

import type { StepDraft } from "./step-panel-draft";
import type { StepLocalToggles } from "@/lib/resus/model";
import type { AbcdeLetter } from "@/lib/resus/types";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { HeartPulseIcon } from "lucide-react";

import { recordStepFindingsV2 } from "@/app/nurse/resus/_v2/actions-survey";
import { EMPTY_LOCAL } from "@/lib/resus/model";
import {
  findingLabel,
  STEP_LOCAL_CONTROLS,
  STEP_PRESENTATION,
} from "@/lib/resus/reference/presentation";
import {
  abcAbnormalFrom,
  legacyStepContext,
  lowRespRateSuggested,
} from "@/lib/resus/survey/context";
import { visibleFindings } from "@/lib/resus/survey/disclosure";
import { buildAssessmentPayload } from "@/lib/resus/v2-payloads";
import { VITAL_INPUT_BOUNDS } from "@/lib/resus/vitals";
import { DEFAULT_TIME_ZONE } from "@/supabase/functions/_shared/slots";
import { ActionsBoard } from "./actions-board";
import { allergyNoteRows } from "./ample-drawer";
import { useDeskCtx } from "./desk-context";
import { StepExtras } from "./step-extras";
import {
  Chip,
  FindingRow,
  LocalToggle,
  MoreSigns,
  overallLabel,
  SearchSigns,
} from "./step-panel-chips";
import {
  baseKeyOf,
  diffCount,
  findingsFor,
  inRange,
  latestAssessment,
  seedFor,
  STEP_NAME,
  stepDrafts,
} from "./step-panel-draft";
import { DerivedRow, MovedBanner, RecordBar, SelectedRow } from "./step-panel-record";
import { toOutcome } from "./use-desk";

/**
 * Resus Desk v2 — the centre step panel (prompt §5.2, GATE A §3). Overall
 * picture → key signs (+ context-promoted) → More / search, with the vitals-
 * derived findings shown read-only. Drafts live in `stepDrafts` (per episode +
 * step), so they survive tab switches, mode changes and unmounts; when the
 * record moves under an unsaved draft the draft is kept and flagged, never
 * dropped. Budgets: ≤ 12 finding chips and ≤ 22 interactive elements in
 * `data-measure="findings"` on load.
 */

const TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: DEFAULT_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function StepPanel({ step }: { step: AbcdeLetter }) {
  const { store, ui, flags, inArrest, survey } = useDeskCtx();
  const readOnly = store.readOnly;
  const episodeId = store.episode.id;
  const events = store.activeEvents;
  const latest = useMemo(() => latestAssessment(step, events), [step, events]);
  const seed = useMemo(() => seedFor(step, events), [step, events]);
  useSyncExternalStore(stepDrafts.subscribe, stepDrafts.version, stepDrafts.version);
  const [view, setView] = useState({ step, query: "", more: false });
  const v = view.step === step ? view : { step, query: "", more: false };

  const baseKey = baseKeyOf(latest);
  const held = readOnly ? undefined : stepDrafts.get(episodeId, step);
  const heldDirty = !!held && diffCount(held.draft, seed.draft) > 0;
  // Recorded elsewhere under an unsaved draft: keep it and say so.
  const moved = !!held && held.base !== baseKey && heldDirty;
  const fresh = step === "D" && !readOnly ? survey.measure.values.glucose : undefined;
  const draft: StepDraft =
    held && (held.base === baseKey || heldDirty)
      ? held.draft
      : fresh != null && seed.draft.glucose === ""
        ? { ...seed.draft, glucose: String(fresh) } // prefill as a draft, never auto-recorded
        : seed.draft;
  const update = (patch: Partial<StepDraft>) =>
    stepDrafts.set(episodeId, step, {
      base: moved && held ? held.base : baseKey,
      draft: { ...draft, ...patch },
    });
  const toggle = (code: string) =>
    update({
      present: draft.present.includes(code)
        ? draft.present.filter((c) => c !== code)
        : [...draft.present, code],
    });
  const setLocal = (k: keyof StepLocalToggles, on: boolean) => {
    update({ local: { ...draft.local, [k]: on } });
    ui.setLocal({ [k]: on });
  };

  const unsaved = diffCount(draft, seed.draft);
  const vis = visibleFindings(step, { flags, selected: draft.present, query: v.query });
  const promotedBy = STEP_PRESENTATION[step].promotions
    .filter((pr) => pr.when(flags) && pr.codes.some((c) => vis.promoted.includes(c)))
    .map((pr) => pr.by);
  const derived = step === "E" ? [] : survey.measure[step];
  const rr = survey.measure.values.rr ?? null;
  const locals = STEP_LOCAL_CONTROLS.filter((c) => c.step === step && c.toggle);
  const hintFor = (suggestedBy?: string) =>
    !readOnly && suggestedBy === "rr_low_falling" && lowRespRateSuggested(rr)
      ? `suggested from RR ${rr}`
      : null;
  const inBody = locals.filter(
    (c) => c.placement === "step" || draft.local[c.toggle!] || hintFor(c.suggestedBy),
  );
  const localToggles = (list: typeof locals) =>
    list.map((c) => (
      <LocalToggle
        key={c.id}
        label={c.label}
        on={!!draft.local[c.toggle!]}
        hint={draft.local[c.toggle!] ? null : hintFor(c.suggestedBy)}
        disabled={readOnly}
        onToggle={() => setLocal(c.toggle!, !draft.local[c.toggle!])}
      />
    ));

  const { glucose: G, temperature: T } = VITAL_INPUT_BOUNDS;
  const valid = inRange(draft.glucose, G.min, G.max) && inRange(draft.coreTemp, T.min, T.max);

  function record() {
    const findings = findingsFor(step, draft, seed.carry);
    const local: StepLocalToggles = { ...EMPTY_LOCAL, ...ui.local, ...draft.local };
    const context = legacyStepContext(step, {
      flags,
      inArrest,
      local,
      abcAbnormal: abcAbnormalFrom(survey.states),
    });
    const { ample, ...rest } = findings;
    const fs: Record<string, unknown> = { ...rest, context };
    if (step === "E") fs.ample = ample ?? null;
    store.submit({
      label: `Record ${step} findings`,
      optimistic: () => [
        { kind: "assessment", step, payload: buildAssessmentPayload(step, fs) },
        ...(step === "E" ? allergyNoteRows(ample) : []),
      ],
      run: async ({ clientEventId, recordedAt }) =>
        toOutcome(
          await recordStepFindingsV2({
            episodeId: store.episode.id,
            clientEventId,
            recordedAt,
            step,
            findings,
            local,
          }),
        ),
    });
    stepDrafts.set(episodeId, step, null);
    ui.toast({ message: `Recorded ${step} findings` });
  }
  // Return to A records an unsaved E draft first (AMPLE — prompt §5.3).
  const autosave = step === "E" && !readOnly && valid && unsaved > 0;
  useEffect(() => {
    if (!autosave) return;
    ui.setDraftSaver(record);
    return () => ui.setDraftSaver(null);
  });
  const chips = (codes: string[]) =>
    codes.map((c) => (
      <Chip
        key={c}
        label={findingLabel(step, c)}
        on={draft.present.includes(c)}
        disabled={readOnly}
        onToggle={() => toggle(c)}
      />
    ));

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="survey-step-heading"
        className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4"
      >
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="survey-step-heading"
              tabIndex={-1}
              className="text-heading-m text-foreground outline-none"
            >
              {step} · {STEP_NAME[step]}
            </h2>
            <p className="text-body-s text-muted-foreground">
              {latest ? `Recorded ${TIME.format(new Date(latest.recordedAt))}` : "Not yet recorded"}
              {unsaved > 0 && !readOnly ? (
                <span className="text-amber-700 dark:text-amber-300"> · {unsaved} unsaved</span>
              ) : null}
            </p>
          </div>
          {!readOnly && !inArrest ? (
            // A safety label never truncates: it wraps.
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => ui.openArrestConfirm("step")}
              className="tap border-border text-body-s text-foreground hover:bg-muted inline-flex min-h-11 max-w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left font-medium"
            >
              <HeartPulseIcon className="size-4 shrink-0" aria-hidden />
              No pulse / no signs of life
            </button>
          ) : null}
        </header>

        {moved && latest ? (
          <MovedBanner
            at={TIME.format(new Date(latest.recordedAt))}
            unsaved={unsaved}
            onDiscard={() => stepDrafts.set(episodeId, step, null)}
          />
        ) : null}

        {/* Scroll margin: a focused chip never lands under the sticky Record bar. */}
        <div
          data-measure="findings"
          tabIndex={-1}
          className="flex flex-col gap-4 outline-none [&_button]:scroll-mb-40 [&_input]:scroll-mb-40 [&_select]:scroll-mb-40"
        >
          <SelectedRow
            codes={draft.present}
            label={(c) => findingLabel(step, c)}
            readOnly={readOnly}
            onRemove={toggle}
          />

          <FindingRow label="Overall picture">
            {vis.overall.map((code) => (
              <Chip
                key={code}
                overall
                label={overallLabel(step, code).short}
                detail={overallLabel(step, code).detail}
                on={draft.headline === code}
                disabled={readOnly}
                onToggle={() => update({ headline: draft.headline === code ? null : code })}
              />
            ))}
          </FindingRow>

          <DerivedRow
            ageMin={survey.measure.ageMin}
            codes={derived}
            label={(c) => findingLabel(step, c)}
          />

          <FindingRow label="Key signs">{chips(vis.key)}</FindingRow>
          {vis.promoted.length > 0 ? (
            <FindingRow label={`Promoted by ${promotedBy.join(", ")}`}>
              {chips(vis.promoted)}
            </FindingRow>
          ) : null}
          {vis.selectedExtra.length > 0 ? (
            <FindingRow label="Also selected">{chips(vis.selectedExtra)}</FindingRow>
          ) : null}
          {inBody.length > 0 ? (
            <div className="flex flex-wrap gap-2">{localToggles(inBody)}</div>
          ) : null}

          <StepExtras step={step} placement="step" draft={draft} update={update} />
          <MoreSigns
            step={step}
            groups={vis.more}
            open={v.more}
            onOpen={(more) => setView({ ...v, more })}
            renderChips={chips}
          >
            {step === "D" ? (
              <>
                {localToggles(locals.filter((c) => !inBody.includes(c)))}
                <StepExtras step={step} placement="more" draft={draft} update={update} />
              </>
            ) : null}
          </MoreSigns>
          <SearchSigns
            query={v.query}
            onQuery={(query) => setView({ ...v, query })}
            matches={vis.matches}
            renderChips={chips}
          />

          {readOnly ? null : (
            <RecordBar
              step={step}
              unsaved={unsaved}
              recorded={latest !== null}
              valid={valid}
              onRecord={record}
            />
          )}
        </div>
      </section>

      <ActionsBoard step={step} />
    </div>
  );
}
