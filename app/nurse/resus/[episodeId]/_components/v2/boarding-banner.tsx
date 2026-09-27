"use client";

import { useMemo, useState } from "react";
import { ActivityIcon, BedIcon, DoorOpenIcon, RotateCcwIcon } from "lucide-react";

import { reactivateResusV2 } from "@/app/nurse/resus/_v2/actions-closeout";
import { ADULT_MIN_AGE_YEARS } from "@/lib/resus/reference/levels-of-care";
import { cn } from "@/lib/utils";
import { clock, FIELD } from "./after-arrest-shared";
import { boardingSince, latestDisposition, news2Response, refText } from "./close-out-model";
import { news2Reading } from "./close-out-sbar";
import { AMBER_NOTE, DESTINATION_WORD, levelShort, PRIMARY, SECONDARY } from "./close-out-words";
import { useDeskCtx } from "./desk-context";
import { toOutcome, useNow } from "./use-desk";

/**
 * Lane U6 — boarding (catalog §5, CO-BRD-01..04): the destination is decided
 * but the patient cannot leave yet. The resus clock has stopped; a boarding
 * clock runs. Monitoring follows the NEWS2 response (CO-NEWS-01..05). Vitals
 * and actions keep working below. Deterioration → re-activate (same episode);
 * leaving → the close-out sheet records the handover and ends the resus.
 */

/** CO-BRD-03's own word — one tap re-activates with it. */
const DETERIORATION = "Deterioration";

function BoardingClock({ sinceIso }: { sinceIso: string }) {
  const { store } = useDeskCtx();
  const now = useNow(store.nowMs, 1000);
  return (
    <span className="text-body-m text-foreground font-mono tabular-nums">
      {clock(now - Date.parse(sinceIso))}
    </span>
  );
}

export function BoardingBanner() {
  const d = useDeskCtx();
  const { store, ui } = d;
  const events = store.activeEvents;
  const dispo = latestDisposition(events);
  const since = boardingSince(events) ?? dispo?.atIso ?? store.episode.dispositionDecidedAtIso;
  const unit = d.initial.careUnits.find((u) => u.id === dispo?.unitId) ?? null;
  // CO-BRD-02: the one set the recommender scores, never a per-field mix.
  const news2 = useMemo(
    () => news2Reading(events, d.ageYears)?.news2 ?? null,
    [events, d.ageYears],
  );
  const response = news2Response(news2);
  const urgent = !!response && response.id !== "CO-NEWS-04" && response.id !== "CO-NEWS-05";
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");

  const reactivate = (why: string) => {
    setAsking(false);
    setReason("");
    store.submit({
      label: "Resus re-activated",
      optimistic: () => [
        {
          kind: "decision",
          step: "pre",
          payload: {
            decision: "phase",
            phase: "survey",
            reason: why || null,
            label: why ? `Resus re-activated — ${why}` : "Resus re-activated",
          },
        },
      ],
      run: async ({ clientEventId, recordedAt }) =>
        toOutcome(
          await reactivateResusV2({
            episodeId: store.episode.id,
            clientEventId,
            recordedAt,
            reason: why || null,
          }),
        ),
    });
    ui.toast({ message: "Re-activated — back to the survey" });
  };

  const where = [
    dispo?.destination ? (DESTINATION_WORD[dispo.destination] ?? dispo.destination) : "a bed",
    dispo?.chosenLevel ? `(${levelShort(dispo.chosenLevel)})` : null,
    unit ? `— ${unit.name}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const child = d.ageYears !== null && d.ageYears < ADULT_MIN_AGE_YEARS;

  return (
    <section
      data-testid="boarding-banner"
      aria-labelledby="boarding-title"
      className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <BedIcon aria-hidden className="size-5 text-teal-700" />
        <h2 id="boarding-title" className="text-heading-s text-foreground">
          Awaiting bed — {where}
        </h2>
        {since ? (
          <span className="text-body-s text-muted-foreground ml-auto inline-flex items-center gap-2">
            boarding <BoardingClock sinceIso={since} />
          </span>
        ) : null}
      </div>

      <p
        className={cn(
          "text-body-s flex items-start gap-2 rounded-md px-3 py-2",
          urgent ? AMBER_NOTE : "bg-muted text-foreground",
        )}
      >
        <ActivityIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          {response && news2 ? (
            <>
              <span className="font-medium">NEWS2 {news2.total}</span> — {refText(response)}
            </>
          ) : child ? (
            "NEWS2 is for adults — no monitoring cadence is shown for a child."
          ) : (
            "NEWS2 not available — record a full set of vitals to get the monitoring cadence."
          )}
          {response && news2 ? <span className="opacity-70"> · {response.id}</span> : null}
        </span>
      </p>

      {asking ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="boarding-reason" className="text-caption text-muted-foreground">
            Why re-activate? (optional)
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => reactivate(DETERIORATION)} className={PRIMARY}>
              {DETERIORATION}
            </button>
            <input
              id="boarding-reason"
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Or say why"
              className={cn(FIELD, "min-h-11 min-w-0 flex-1")}
            />
            <button type="button" onClick={() => reactivate(reason.trim())} className={SECONDARY}>
              Re-activate
            </button>
            <button type="button" onClick={() => setAsking(false)} className={SECONDARY}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={store.readOnly}
            onClick={() => setAsking(true)}
            className={SECONDARY}
          >
            <RotateCcwIcon aria-hidden className="size-4" />
            Re-activate resus
          </button>
          <button
            type="button"
            disabled={store.readOnly}
            onClick={() => ui.openCloseOut()}
            className={PRIMARY}
          >
            <DoorOpenIcon aria-hidden className="size-4" />
            Patient left resus
          </button>
        </div>
      )}
    </section>
  );
}
