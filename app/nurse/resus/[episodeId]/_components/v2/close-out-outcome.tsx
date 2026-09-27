"use client";

import type { CloseOutDraft, StepProps } from "./close-out-model";
import type { OutcomeCode } from "@/lib/resus/model";

import { idleClass } from "@/lib/resus/closeout/idle";
import { Choice, FIELD, NEUTRAL_DARK } from "./after-arrest-shared";
import { Note } from "./close-out-ui";
import { OUTCOME_WORD, SECONDARY } from "./close-out-words";
import { useDeskCtx } from "./desk-context";

/**
 * Lane U6 — close-out step 1: the outcome. Mid-arrest it first asks how the
 * arrest ended (ROSC / stop / leaving with CPR ongoing) — a data prompt, never
 * a block. Opened in error cancels with a reason; an idle episode offers the
 * administrative close to an in-charge / consultant (CO-IDLE-03).
 */

const OUTCOMES: readonly (OutcomeCode | "died" | "cancel")[] = [
  "stabilised",
  "rosc_sustained",
  "rosc_not_sustained",
  "died",
  "transferred_out",
  "cancel",
];

export function OutcomeStep({
  draft,
  patch,
  facts,
  actions,
  busy,
  blocked,
}: StepProps & {
  actions: { cancel: () => void; adminClose: () => void; closeSheet: () => void };
  busy: boolean;
  blocked: string | null;
}) {
  const d = useDeskCtx();
  const choose = (o: CloseOutDraft["outcome"]) => {
    const died = o === "died_after_cpr" || o === "died_cpr_not_attempted";
    patch({
      outcome: o,
      ...(died
        ? { destination: "mortuary", unitId: null, mismatch: null, bed: null }
        : draft.destination === "mortuary"
          ? { destination: null }
          : {}),
    });
  };
  const leave = (then?: () => void) => () => {
    actions.closeSheet();
    then?.();
  };

  const lastIso = d.store.events.reduce(
    (m, e) => (e.createdAt > m ? e.createdAt : m),
    d.store.episode.lastActivityAtIso ?? d.store.episode.startedAtIso,
  );
  const idle = idleClass(Date.parse(lastIso), d.store.nowMs());
  const adminClose = idle.class === "admin_close" && d.initial.me.canAdminClose;
  // After a stop (no later ROSC) or a confirmed death, only Died fits the record:
  // signs of life are recorded on the desk, never chosen as an outcome here.
  const deathPath = facts.stopped || facts.deathConfirmed;
  const offered = deathPath ? OUTCOMES.filter((o) => o === "died" || o === "cancel") : OUTCOMES;

  return (
    <>
      {facts.inArrest ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-heading-s text-foreground mb-3">How did the arrest end?</legend>
          <div className="flex flex-wrap gap-2">
            <Choice
              selected={draft.arrestEnd === "rosc"}
              onClick={() => patch({ arrestEnd: "rosc", outcome: null })}
            >
              ROSC
            </Choice>
            <Choice
              selected={draft.arrestEnd === "stop"}
              onClick={() => patch({ arrestEnd: "stop", outcome: null })}
            >
              Stop resuscitation
            </Choice>
            <Choice
              selected={draft.arrestEnd === "cpr_ongoing"}
              onClick={() => patch({ arrestEnd: "cpr_ongoing", outcome: null, destination: null })}
            >
              Leaving resus with CPR ongoing
            </Choice>
            <Choice
              selected={draft.outcome === "cancel"}
              onClick={() => patch({ arrestEnd: null, outcome: "cancel" })}
            >
              Opened in error
            </Choice>
          </div>
          {draft.arrestEnd === "rosc" ? (
            <Note
              action={
                <button type="button" onClick={leave()} className={SECONDARY}>
                  Back to the console
                </button>
              }
            >
              Record ROSC in the console first — the ROSC confirm records the signs and starts the
              sustain timer. Then end the resus from post-ROSC.
            </Note>
          ) : null}
          {draft.arrestEnd === "stop" ? (
            <Note
              action={
                <button type="button" onClick={leave(d.ui.openTermination)} className={SECONDARY}>
                  Open the termination review
                </button>
              }
            >
              Stopping is a team decision, recorded on the termination review. Death is confirmed
              after it; then end the resus here.
            </Note>
          ) : null}
          {draft.arrestEnd === "cpr_ongoing" ? (
            <p className="text-body-s text-muted-foreground">
              Recorded as transferred out with CPR ongoing. Choose the destination next.
            </p>
          ) : null}
        </fieldset>
      ) : (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-heading-s text-foreground mb-3">Outcome</legend>
          <div className="flex flex-wrap gap-2">
            {offered.map((o) => {
              const code = o === "died" ? facts.deathCode : o;
              return (
                <Choice key={o} selected={draft.outcome === code} onClick={() => choose(code)}>
                  {o === "cancel" ? "Opened in error" : o === "died" ? "Died" : OUTCOME_WORD[o]}
                </Choice>
              );
            })}
          </div>
          {facts.stopped ? (
            <p className="text-caption text-muted-foreground">
              Death is being confirmed on the desk. Signs of life are recorded there (Signs of life
              — resume), not here.
            </p>
          ) : null}
          {facts.deathConfirmed ? (
            <p className="text-caption text-muted-foreground">
              Death is confirmed — the outcome is a death.
            </p>
          ) : null}
          {!deathPath && facts.roscRecorded && facts.roscSustained !== null ? (
            <p className="text-caption text-muted-foreground">
              The record shows ROSC {facts.roscSustained ? "sustained" : "not yet sustained"}.
            </p>
          ) : null}
          {(draft.outcome === "rosc_sustained" || draft.outcome === "rosc_not_sustained") &&
          !facts.roscRecorded ? (
            <Note>No ROSC is recorded in this resus — choose another outcome.</Note>
          ) : null}
          {(draft.outcome === "died_after_cpr" || draft.outcome === "died_cpr_not_attempted") &&
          !facts.deathConfirmed ? (
            <Note
              action={
                facts.stopped ? (
                  <button type="button" onClick={leave()} className={SECONDARY}>
                    Go to confirmation of death
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={leave(() => d.ui.openArrestConfirm("desk"))}
                    className={SECONDARY}
                  >
                    Open the arrest confirm
                  </button>
                )
              }
            >
              Confirm death first.{" "}
              {facts.stopped
                ? "The confirmation of death is on the desk."
                : "It follows a stop, or CPR not attempted recorded from the arrest confirm."}
            </Note>
          ) : null}
        </fieldset>
      )}

      {draft.outcome === "cancel" ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="co-cancel" className="text-caption text-muted-foreground">
            Why was it opened in error? (required — the record becomes read-only)
          </label>
          <textarea
            id="co-cancel"
            rows={2}
            maxLength={300}
            value={draft.cancelReason}
            onChange={(e) => patch({ cancelReason: e.target.value })}
            className={FIELD}
          />
          <button
            type="button"
            disabled={draft.cancelReason.trim().length < 3 || busy || !!blocked}
            onClick={actions.cancel}
            className={NEUTRAL_DARK}
          >
            {busy ? "Recording…" : "Cancel this resus"}
          </button>
          {blocked ? <Note>{blocked}</Note> : null}
        </div>
      ) : null}

      {adminClose ? (
        <section
          className="border-border flex flex-col gap-2 border-t pt-5"
          aria-labelledby="co-admin"
        >
          <h3 id="co-admin" className="text-heading-s text-foreground">
            Close administratively
          </h3>
          <p className="text-body-s text-muted-foreground">
            {idle.label}. No clinical outcome is recorded; the episode is left out of clinical
            statistics and kept in data-quality reports.
          </p>
          <label htmlFor="co-admin-reason" className="text-caption text-muted-foreground">
            Reason (required)
          </label>
          <textarea
            id="co-admin-reason"
            rows={2}
            maxLength={300}
            value={draft.adminReason}
            onChange={(e) => patch({ adminReason: e.target.value })}
            className={FIELD}
          />
          <button
            type="button"
            disabled={draft.adminReason.trim().length < 3 || busy || !!blocked}
            onClick={actions.adminClose}
            className={NEUTRAL_DARK}
          >
            {busy ? "Recording…" : "Close administratively"}
          </button>
        </section>
      ) : null}
    </>
  );
}
