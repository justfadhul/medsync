"use client";

import type { ArrestDebrief, Ratio } from "@/lib/resus/debrief/metrics";
import { useMemo, useState } from "react";
import { CircleCheckIcon, InfoIcon, LockIcon, UsersRoundIcon } from "lucide-react";

import { saveDebriefV2 } from "@/app/nurse/resus/_v2/actions-closeout";
import { Button } from "@/components/ui/button";
import { debriefMetrics } from "@/lib/resus/debrief/metrics";
import { cn } from "@/lib/utils";
import { afterCloseWindow, Choice, clock, FIELD } from "./after-arrest-shared";
import { useDeskCtx } from "./desk-context";
import { useNow } from "./use-desk";

/**
 * DebriefPanel — the data-driven debrief (closeout catalog §8, CO-DBF-01..07;
 * ALS-TOR-10): per-arrest metrics computed from the record, then what went well,
 * what to improve, actions, equipment issues, the welfare check and attendees.
 * Save draft / Submit; immutable once submitted; editable until 24 h after close.
 * The saved debrief seeds the form from the store snapshot (loader + re-read on
 * record changes); a submit on another device locks it here too.
 */

interface DebriefDraft {
  attendeeCount: number | null;
  wentWell: string;
  toImprove: string;
  actions: string;
  equipmentIssues: string;
  welfareCheckDone: boolean;
}
export type { DebriefSeed } from "./types";

const EMPTY: DebriefDraft = {
  attendeeCount: null,
  wentWell: "",
  toImprove: "",
  actions: "",
  equipmentIssues: "",
  welfareCheckDone: false,
};

const TEXT_FIELDS: {
  key: "wentWell" | "toImprove" | "actions" | "equipmentIssues";
  label: string;
}[] = [
  { key: "wentWell", label: "What went well" },
  { key: "toImprove", label: "What to improve" },
  { key: "actions", label: "Actions (who, by when)" },
  { key: "equipmentIssues", label: "Equipment issues" },
];

const ms = (v: number | null) => (v === null ? "—" : clock(v));
const ratio = (r: Ratio) => (r.value === null ? "—" : `${r.n} of ${r.of}`);

const AIRWAY = { sga: "supraglottic", ett: "tracheal tube" } as const;

function metricRows(a: ArrestDebrief): [id: string, label: string, value: string][] {
  const capno =
    a.capnographyUsed === null ? "not recorded" : a.capnographyUsed ? "used" : "not available";
  return [
    ["CO-DBF-01", "Time to first shock", ms(a.timeToFirstShockMs)],
    ["CO-DBF-02", "Time to first adrenaline", ms(a.timeToFirstAdrenalineMs)],
    ["CO-DBF-03", "Adrenaline intervals in the window", ratio(a.adrenalineIntervalsInWindow)],
    ["CO-DBF-04", "Rhythm checks on time", ratio(a.cyclesOnTime)],
    [
      "CO-DBF-05",
      "Time to advanced airway",
      `${ms(a.timeToAdvancedAirwayMs)}${a.advancedAirway ? ` (${AIRWAY[a.advancedAirway]})` : ""}`,
    ],
    ["CO-DBF-05c", "Capnography", capno],
    ["CO-DBF-06", "Reversible causes addressed", ratio(a.reversibleCausesAddressed)],
    ["CO-DBF-07", "Compressor swaps per rhythm check", ratio(a.compressorSwapsPerCheck)],
  ];
}

function Metrics({ arrests }: { arrests: ArrestDebrief[] }) {
  if (arrests.length === 0)
    return (
      <p className="text-body-s text-muted-foreground">
        No arrest in this resus — no performance metrics.
      </p>
    );
  return (
    <div className="space-y-4">
      {arrests.map((a) => (
        <section key={a.arrestSeq} aria-label={`Arrest ${a.arrestSeq} metrics`}>
          {arrests.length > 1 ? (
            <h4 className="text-caption text-foreground mb-1.5">Arrest #{a.arrestSeq}</h4>
          ) : null}
          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {metricRows(a).map(([id, label, value]) => (
              <div key={id} className="border-border bg-muted rounded-md border px-3 py-2">
                <dt className="text-caption text-muted-foreground">{label}</dt>
                <dd className="text-body-m text-foreground font-mono tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <p className="text-caption text-muted-foreground flex gap-1.5">
        <InfoIcon className="size-3.5 shrink-0" aria-hidden />
        Times are from the arrest declaration. Adrenaline intervals are judged against the standard
        window only — read them with the patient&apos;s temperature and age in view.
      </p>
    </div>
  );
}

export function DebriefPanel() {
  const { store, ui } = useDeskCtx();
  const now = useNow(store.nowMs, 60_000);
  const events = store.activeEvents;
  const metrics = useMemo(() => debriefMetrics(events, now), [events, now]);
  const seeded = store.debrief;
  const [draft, setDraft] = useState<DebriefDraft>(() => seeded ?? EMPTY);
  const [status, setStatus] = useState<"new" | "draft" | "submitted">(seeded?.status ?? "new");
  // The saved version this device builds on (R6): the server refuses a save over a newer one.
  const [base, setBase] = useState<string | null>(seeded?.updatedAtIso ?? null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { editable } = afterCloseWindow(store.episode, now);
  // Submitted here, or elsewhere (the store re-reads the saved debrief).
  const locked = status === "submitted" || seeded?.status === "submitted" || !editable;
  // Opened in error — nothing happened to debrief.
  if (store.episode.state === "cancelled") return null;

  const save = async (submit: boolean) => {
    setSaving(true);
    const r = await saveDebriefV2({
      episodeId: store.episode.id,
      ...draft,
      submit,
      baseUpdatedAtIso: base,
    }).catch(() => ({ ok: false as const, error: "No connection — not saved. Try again." }));
    setSaving(false);
    setConfirming(false);
    if (r.ok) {
      setBase(r.updatedAtIso);
      setStatus(submit ? "submitted" : "draft");
      ui.toast({ message: submit ? "Debrief submitted" : "Draft saved" });
      return;
    }
    if (/already submitted/i.test(r.error)) setStatus("submitted");
    // Told, not overwritten: the next save (a deliberate second tap) replaces the other device's.
    if ("stale" in r && r.stale) setBase(r.updatedAtIso ?? null);
    ui.toast({ message: r.error, tone: "error" });
  };

  return (
    <section
      data-testid="debrief"
      aria-labelledby="debrief-heading"
      className="border-border bg-card shadow-card rounded-lg border"
    >
      <header className="border-border flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3 sm:px-6">
        <h2 id="debrief-heading" className="text-heading-s text-foreground">
          Team debrief
        </h2>
        <p className="text-caption text-muted-foreground inline-flex items-center gap-1.5">
          {status === "submitted" ? (
            <>
              <CircleCheckIcon className="size-3.5" aria-hidden />
              Submitted — read-only
            </>
          ) : !editable ? (
            <>
              <LockIcon className="size-3.5" aria-hidden />
              Read-only — 24 h after close
            </>
          ) : status === "draft" ? (
            "Draft saved"
          ) : (
            "Not started"
          )}
        </p>
      </header>
      <div className="space-y-5 px-4 py-4 sm:px-6">
        <Metrics arrests={metrics.arrests} />
        <div className="grid gap-3 sm:grid-cols-2">
          {TEXT_FIELDS.map((f) => (
            <label key={f.key} className="block space-y-1.5">
              <span className="text-caption text-muted-foreground">{f.label}</span>
              <textarea
                rows={3}
                maxLength={4000}
                disabled={locked}
                value={draft[f.key]}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                className={FIELD}
              />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Choice
            selected={draft.welfareCheckDone}
            disabled={locked}
            onClick={() => setDraft({ ...draft, welfareCheckDone: !draft.welfareCheckDone })}
          >
            Staff welfare check done
          </Choice>
          <label className="flex flex-col gap-1.5">
            <span className="text-caption text-muted-foreground inline-flex items-center gap-1">
              <UsersRoundIcon className="size-3.5" aria-hidden />
              Attendees
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              disabled={locked}
              value={draft.attendeeCount ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  attendeeCount:
                    e.target.value === ""
                      ? null
                      : Math.max(0, Math.min(100, Math.trunc(+e.target.value))),
                })
              }
              className={cn(FIELD, "block w-24 font-mono tabular-nums")}
            />
          </label>
        </div>
      </div>
      {locked ? null : (
        <footer className="border-border flex flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          {confirming ? (
            <>
              <p className="text-body-s text-foreground sm:mr-auto">
                Submit the debrief? It cannot be edited after.
              </p>
              <Button
                variant="secondary"
                size="lg"
                disabled={saving}
                onClick={() => setConfirming(false)}
              >
                Keep editing
              </Button>
              <Button size="lg" disabled={saving} onClick={() => void save(true)}>
                Submit debrief
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="secondary"
                size="lg"
                disabled={saving}
                onClick={() => void save(false)}
              >
                Save draft
              </Button>
              <Button size="lg" disabled={saving} onClick={() => setConfirming(true)}>
                Submit…
              </Button>
            </>
          )}
        </footer>
      )}
    </section>
  );
}
