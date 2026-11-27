"use client";

import type { CloseActions } from "./close-visit";
import type { DeskPayload } from "./model";
import type { PickerBed } from "@/lib/emr/actions/close";
import type { EuDraft, WaitReason } from "@/lib/emr/closure";
import type { BedState, Need, WardLayout } from "@/supabase/functions/_shared/ward-layout";
import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { PlanView } from "@/components/wards/plan/plan-view";
import { EU_SEND } from "@/content/eu/words";
import { countsWords, WAIT_REASON_WORDS } from "@/lib/emr/closure";
import { cn } from "@/lib/utils";
import { freeByNeed } from "@/supabase/functions/_shared/ward-layout";
import { ChoiceChips } from "../orders/choice-chips";
import { StatusWord } from "../status-word";

const chip = (on: boolean) =>
  cn(
    "text-body-s rounded-md border px-3 py-1.5 text-left",
    on ? "border-teal-700 bg-teal-50 text-teal-900" : "border-border bg-card hover:bg-ink-50",
  );

/**
 * Send to EU (ADR 0541): the emergency unit, then one of its free spaces or why the patient waits. The
 * spaces are states and services only, never another patient's name (ADR 0199 §7).
 */
export function EuFields({
  p,
  e,
  set,
  surface,
  act,
}: {
  p: DeskPayload & { close: NonNullable<DeskPayload["close"]> };
  e: EuDraft;
  set: (x: Partial<EuDraft>) => void;
  surface: "doctor" | "clinician";
  act: Pick<CloseActions, "wardBeds">;
}) {
  const wards = p.close.eu.wards;
  const [read, setRead] = useState<{
    wardId: string;
    beds: { doc: WardLayout | null; beds: PickerBed[] } | null;
    error: string | null;
  } | null>(null);
  const [need, setNeed] = useState<Need>("any");
  const wardId = e.wardId;

  useEffect(() => {
    if (!wardId || !p.close.bedsLive) return;
    let live = true;
    void act.wardBeds({ surface, wardId }).then((r) => {
      if (live)
        setRead({ wardId, beds: r.ok ? (r.data ?? null) : null, error: r.ok ? null : r.error });
    });
    return () => {
      live = false;
    };
  }, [wardId, p.close.bedsLive, surface, act]);

  const current = read && read.wardId === wardId ? read : null;
  const beds = current?.beds ?? null;
  // A need no free space meets is not offered.
  const byNeed = freeByNeed(
    (beds?.beds ?? []).map((b) => ({
      ...b,
      id: b.bedId,
      state: b.state as BedState,
      roomKind: b.roomKind,
    })),
    { eu: true },
  ).filter((n) => n.need === "any" || n.beds.length);
  const fits = new Set(byNeed.find((n) => n.need === need)?.beds.map((b) => b.id));
  const free = (beds?.beds ?? []).filter((b) => b.state === "free" && fits.has(b.bedId));
  const chosen = beds?.beds.find((b) => b.bedId === e.bedId);

  return (
    <>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-body-s text-foreground mb-1 font-medium">{EU_SEND.group}</legend>
        <div role="radiogroup" aria-label={EU_SEND.group} className="flex flex-wrap gap-2">
          {wards.map((w) => (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={e.wardId === w.id}
              onClick={() => set({ wardId: w.id, bedId: null })}
              className={chip(e.wardId === w.id)}
            >
              <span className="text-foreground block">{w.name}</span>
              {w.where ? (
                <span className="text-caption text-muted-foreground block">{w.where}</span>
              ) : null}
              {w.counts ? (
                <span className="text-caption text-muted-foreground block">
                  {countsWords(w.counts)}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </fieldset>

      {wardId && p.close.bedsLive ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-body-s text-foreground mb-1 font-medium">{EU_SEND.space}</legend>
          {!current ? (
            <p className="text-body-s text-muted-foreground">Loading the spaces…</p>
          ) : null}
          {current?.error ? <StatusWord tone="caution">{current.error}</StatusWord> : null}
          {beds ? (
            beds.doc ? (
              <div className="flex flex-col gap-3">
                <ChoiceChips
                  name="eu-need"
                  label={EU_SEND.need}
                  options={byNeed.map((n) => ({ value: n.need, label: n.label }))}
                  value={need}
                  onChange={(n) => {
                    setNeed(n);
                    set({ bedId: null });
                  }}
                />
                <div className="border-border max-h-[320px] overflow-auto rounded-md border p-2">
                  <PlanView
                    doc={beds.doc}
                    mode="live"
                    label={`Spaces of the unit: ${free.length} free`}
                    states={Object.fromEntries(beds.beds.map((b) => [b.key, b.state as BedState]))}
                    selected={chosen ? { kind: "bed", key: chosen.key } : null}
                    onPointerDown={(ev) => {
                      const raw = (ev.target as Element)
                        .closest("[data-ref]")
                        ?.getAttribute("data-ref");
                      const bed = raw?.startsWith("bed:")
                        ? beds.beds.find((b) => b.key === raw.slice(4))
                        : null;
                      if (bed?.state === "free") set({ bedId: bed.bedId, waitReason: null });
                    }}
                  />
                </div>
                <div role="radiogroup" aria-label="Free spaces" className="flex flex-wrap gap-2">
                  {free.length ? (
                    free.map((b) => (
                      <button
                        key={b.bedId}
                        type="button"
                        role="radio"
                        aria-checked={e.bedId === b.bedId}
                        onClick={() => set({ bedId: b.bedId, waitReason: null })}
                        className={chip(e.bedId === b.bedId)}
                      >
                        {b.label}
                        {b.roomName ? (
                          <span className="text-muted-foreground"> · {b.roomName}</span>
                        ) : null}
                      </button>
                    ))
                  ) : (
                    <p className="text-body-s text-muted-foreground">{EU_SEND.noFreeSpace}</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-body-s text-muted-foreground">{EU_SEND.noLayout}</p>
            )
          ) : null}
        </fieldset>
      ) : null}
      {wardId ? (
        <>
          <ChoiceChips
            name="eu-wait"
            label={EU_SEND.waitWhy}
            options={(Object.keys(WAIT_REASON_WORDS) as WaitReason[]).map((k) => ({
              value: k,
              label: WAIT_REASON_WORDS[k],
            }))}
            value={e.waitReason}
            onChange={(waitReason) => set({ waitReason, bedId: null })}
          />
          {e.waitReason === "other" ? (
            <Input
              aria-label={EU_SEND.waitWhy}
              value={e.waitNote}
              maxLength={500}
              onChange={(ev) => set({ waitNote: ev.target.value })}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}
