"use client";

import type { CardReading } from "@patient-core/care-plan";
import {
  careTodayState,
  kampalaDayKey,
  kampalaInstant,
  medsWeek,
  planDay,
  tenDays,
} from "@patient-core/care-plan";
import { checksThisYear, teamCards } from "@patient-core/my-care";
import { UNITS } from "@patient-core/readings";
import { heroFor } from "@patient-core/today-hero";

import { ReadingForm } from "@/components/tide/reading-dialog";
import { CareTodayWeb, MyCareWeb, PlanWeb } from "@/components/tide/v2-care-web";
import { ReadingsPageWeb } from "@/components/tide/v2-readings-web";

/** Fixed sample day: Monday 16 Nov 2026, 08:10 in Kampala. Invented plan and readings; no patient data. */
const NOW = kampalaInstant("2026-11-16", "08:10");
const DAY = kampalaDayKey(NOW);
const ITEMS = [
  { key: "sugar", name: "Sugar before breakfast", kind: "check" as const, times: ["07:00"] },
  { key: "metformin", name: "Metformin", why: "For your sugar", times: ["08:00", "20:00"] },
  { key: "amlodipine", name: "Amlodipine", why: "For your blood pressure", times: ["08:00"] },
  { key: "walk", name: "Walk", kind: "walk" as const, times: ["17:00"] },
];
const TICKS = [
  {
    medicineKey: "sugar",
    dueAtIso: kampalaInstant(DAY, "07:00").toISOString(),
    status: "taken" as const,
    recordedAtIso: NOW.toISOString(),
  },
];
const SUGAR = [8.4, 7.9, null, 7.6, 6.8, 7.4, null, 6.9, 7.2, 6.6];
const BP: ([number, number] | null)[] = [
  [152, 96],
  [148, 94],
  null,
  [146, 92],
  [150, 95],
  null,
  [142, 90],
  [139, 88],
  null,
  [136, 86],
];
const READINGS: CardReading[] = [
  ...SUGAR.flatMap((v, i) =>
    v === null
      ? []
      : [
          {
            at: new Date(NOW.getTime() - (9 - i) * 86_400_000 - 3600_000).toISOString(),
            input: { kind: "sugar" as const, value: v, context: "fasting" },
          },
        ],
  ),
  ...BP.flatMap((v, i) =>
    v === null
      ? []
      : [
          {
            at: new Date(NOW.getTime() - (9 - i) * 86_400_000 - 3600_000).toISOString(),
            input: { kind: "bp" as const, top: v[0], bottom: v[1] },
          },
        ],
  ),
  {
    at: new Date(NOW.getTime() - 2 * 86_400_000).toISOString(),
    input: { kind: "weight" as const, value: 81.2 },
  },
  {
    at: new Date(NOW.getTime() - 9 * 86_400_000).toISOString(),
    input: { kind: "weight" as const, value: 82.0 },
  },
];
const ok = async () => ({ ok: true });

export function CareV2Fixtures({ screen }: { screen: string }) {
  const slots = planDay(ITEMS, TICKS, DAY, NOW);
  const week = medsWeek(ITEMS, TICKS, NOW).map((d, i) => ({
    label: ["Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"][i]!,
    mark: d.mark,
  }));
  if (screen === "plan") return <PlanWeb slots={slots} week={week} tick={ok} />;
  if (screen === "mycare")
    return (
      <MyCareWeb
        team={teamCards(
          [
            {
              id: "1",
              role: "nurse",
              firstContact: true,
              nextStep: "Calls you on Friday",
              memberUserId: null,
            },
            {
              id: "2",
              role: "medical_officer",
              firstContact: false,
              nextStep: "Reviews your plan in December",
              memberUserId: null,
            },
            {
              id: "3",
              role: "nutritionist",
              firstContact: false,
              nextStep: null,
              memberUserId: null,
            },
          ],
          new Map(),
        )}
        checks={checksThisYear(
          { hba1c: 3, eyes: 12, feet: 12 },
          new Map([
            ["hba1c", "2026-10-01T00:00:00Z"],
            ["feet", "2025-08-01T00:00:00Z"],
          ]),
          NOW,
        )}
        messages={[
          {
            id: "a",
            fromPatient: false,
            kind: "request",
            body: "How are your feet this week?",
            at: "2026-11-16 07:30",
          },
        ]}
        send={ok}
      />
    );
  if (screen === "readings")
    return (
      <ReadingsPageWeb readings={READINGS} recent={[]} nowIso={NOW.toISOString()} initial="sugar" />
    );
  if (screen === "reading")
    return (
      <div className="max-w-[720px]">
        <ReadingForm initialKind="sugar" recent={[]} careFlow />
      </div>
    );
  const hero = heroFor(
    careTodayState({
      items: ITEMS,
      ticks: TICKS,
      alerts: [],
      asks: [],
      visitToday: null,
      now: NOW,
    }),
  );
  const snippets = (["sugar", "bp", "weight"] as const).map((m) => ({
    metric: m,
    unit: UNITS[m],
    ...tenDays(READINGS, m, NOW),
  }));
  return (
    <CareTodayWeb
      hero={hero}
      slots={slots}
      nowLabel="08:10"
      snippets={snippets}
      tick={ok}
      logHref={(m) => `/pw/gallery/care-v2?screen=reading&kind=${m}`}
      detailsHref="/pw/gallery/care-v2?screen=plan"
      heroHref={null}
    />
  );
}
