"use client";

import type { WebSnippet } from "@/components/tide/v2-care-web";
import type { PlanSlot } from "@patient-core/care-plan";
import type { Hero } from "@patient-core/today-hero";

import { CareTodayWeb, PlanWeb } from "@/components/tide/v2-care-web";
import { tickDoseAction } from "@/lib/patient-web/care-v2-actions";

const tickWith = (planVersionId: string | null) => async (s: PlanSlot, key: string) =>
  planVersionId
    ? tickDoseAction({
        clientKey: key,
        planVersionId,
        medicineKey: s.itemKey,
        dueAtIso: s.dueAtIso,
      })
    : { ok: false };

/** Binds Today and the Plan page to their server actions (Step 9). */
export function TodayClient(p: {
  hero: Hero;
  slots: PlanSlot[];
  nowLabel: string;
  snippets: WebSnippet[];
  planVersionId: string | null;
}) {
  const heroHref =
    p.hero.kind === "danger"
      ? "/patient/help"
      : p.hero.kind === "team"
        ? "/patient/care/my-care"
        : p.hero.kind === "visit"
          ? "/patient/visits"
          : null;
  return (
    <CareTodayWeb
      hero={p.hero}
      slots={p.slots}
      nowLabel={p.nowLabel}
      snippets={p.snippets}
      tick={tickWith(p.planVersionId)}
      logHref={(m) => `/patient/care/readings?kind=${m}`}
      detailsHref="/patient/care/readings"
      heroHref={heroHref}
    />
  );
}

export function PlanClient(p: {
  slots: PlanSlot[];
  week: { label: string; mark: "taken" | "some" | "missed" | "due" | "none" }[];
  planVersionId: string | null;
}) {
  return <PlanWeb slots={p.slots} week={p.week} tick={tickWith(p.planVersionId)} />;
}
