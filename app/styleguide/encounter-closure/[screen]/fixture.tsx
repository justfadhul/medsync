"use client";

import type { Screen } from "./page";
import type { CloseActions } from "@/components/emr/desk/close-visit";
import type { DeskPayload } from "@/components/emr/desk/model";
import type { PlanDraft } from "@/lib/clerking/plan/draft";

import { CloseVisitView } from "@/components/emr/desk/close-visit";
import { VisitSummaryView } from "@/components/patient/visit-summary-view";
import { Button } from "@/components/ui/button";
import { composeVisitSummary } from "@/lib/patient/visit-summary";
import { boardData } from "@/tests/wards/fixtures";

const WARD = "00000000-0000-4000-8000-00000000c0a1";
const ok = <T,>(data: T) => ({
  ok: true as const,
  id: "fixture",
  serverTime: "2026-10-03T08:00:00Z",
  data,
});
const board = boardData();
const COPY = composeVisitSummary({
  encounter: { state: "completed", closureKind: "clinical", disposition: "home" },
  visit: {
    startedAt: "2026-10-03T07:30:00Z",
    hospitalName: "Fixture Hospital",
    clinicianName: "Dr Fixture",
    clinicianCadre: "Medical officer",
  },
  outcome: { kind: "home" },
  diagnoses: [
    {
      id: "d1",
      display: "Malaria, uncomplicated",
      verification: "confirmed",
      rank: "primary",
      restricted: false,
    },
    {
      id: "d2",
      display: "Dehydration, mild",
      verification: "provisional",
      rank: "secondary",
      restricted: false,
    },
    {
      id: "d3",
      display: "Restricted diagnosis",
      verification: "confirmed",
      rank: "secondary",
      restricted: true,
    },
  ],
  medicines: [
    {
      id: "r1",
      name: "Artemether/lumefantrine",
      dose: "4 tablets",
      route: "By mouth",
      frequency: "12-hourly",
      duration: "3 days",
      instructions: "With food",
      restricted: false,
    },
    {
      id: "r2",
      name: "Paracetamol",
      dose: "1 g",
      route: "By mouth",
      frequency: "6-hourly as needed",
      duration: "3 days",
      instructions: null,
      restricted: false,
    },
  ],
  stopped: [{ id: "r3", name: "Ibuprofen", restricted: false }],
  tests: [{ id: "o1", display: "Malaria RDT", restricted: false }],
  next: "Booked: Fri 17 Oct, 09:20, Medical OPD.",
  comeBackIf: "Fever comes back, you cannot keep fluids down, or you feel drowsy.",
});

const ACTIONS: Partial<CloseActions> = {
  completeEncounter: async () => ok(undefined),
  bookFollowUp: async () =>
    ok({ appointmentId: "00000000-0000-4000-8000-00000000c0f1", startsAt: "2026-10-17T06:20:00Z" }),
  wardBeds: async () =>
    ok({
      doc: board.doc,
      beds: board.beds.map((b) => ({
        key: b.key,
        bedId: b.bedId,
        label: b.label,
        state: b.state,
        services: b.services,
        roomName: b.roomName,
        roomKind: b.roomKind,
        type: b.type,
      })),
    }),
  followUpOptions: async () =>
    ok({
      target: "2026-10-17",
      reason: "follow_up" as const,
      clinics: [
        {
          lineId: "00000000-0000-4000-8000-00000000c0b1",
          name: "Medical OPD",
          clinicians: [
            {
              userId: "00000000-0000-4000-8000-00000000c0c1",
              name: "Dr Fixture",
              you: true,
              slots: ["2026-10-17T06:20:00Z", "2026-10-17T06:40:00Z", "2026-10-20T07:00:00Z"].map(
                (s) => ({
                  lineId: "00000000-0000-4000-8000-00000000c0b1",
                  clinicianUserId: "00000000-0000-4000-8000-00000000c0c1",
                  departmentId: "00000000-0000-4000-8000-00000000c0d1",
                  startsAt: s,
                  endsAt: s,
                }),
              ),
            },
          ],
          sessions: [],
        },
      ],
    }),
  visitSummaryPreview: async () =>
    ok(
      COPY.ok ? { content: COPY.content, restrictedCount: COPY.restrictedCount } : (null as never),
    ),
};
const NO_CLINIC: Partial<CloseActions> = {
  ...ACTIONS,
  followUpOptions: async () =>
    ok({ target: "2026-10-17", reason: "follow_up" as const, clinics: [] }),
};

export type ClosePayload = DeskPayload & { close: NonNullable<DeskPayload["close"]> };

/** The desk payload with the close context (the server page builds the desk part: it reads catalogues). */
function payload(p: DeskPayload, open: boolean): ClosePayload {
  return {
    ...p,
    encounter: { ...p.encounter, open, state: open ? "in_progress" : "completed" },
    close: {
      wards: [
        {
          id: WARD,
          name: "Medical ward 4B",
          counts: { free: 4, arriving: 2, occupied: 9, other: 4 },
        },
        {
          id: "00000000-0000-4000-8000-00000000c0a2",
          name: "HDU",
          counts: { free: 0, arriving: 0, occupied: 6, other: 0 },
        },
      ],
      bedsLive: true,
      summaryLive: true,
      eu: { live: false, wards: [], stay: null },
      takeHome: [
        {
          id: "00000000-0000-4000-8000-00000000c0e1",
          name: "Artemether/lumefantrine",
          line: "4 tablets, By mouth, 12-hourly, for 3 days",
        },
        {
          id: "00000000-0000-4000-8000-00000000c0e2",
          name: "Ibuprofen",
          line: "400 mg, By mouth, 8-hourly, for 3 days",
        },
      ],
      closed: open ? null : { disposition: "home", closureKind: "clinical", detail: null },
      summary: null,
    },
  };
}

const PLANS: Record<string, PlanDraft> = {
  admit: { disposition: { kind: "admit", ward: "Medical ward 4B", wardId: WARD } },
  home: { disposition: { kind: "discharge" }, followUp: { when: "2w" } },
  refer: { disposition: { kind: "refer", referTo: "Regional referral hospital" } },
};

export function FixtureClose({ screen, desk }: { screen: Screen; desk: DeskPayload }) {
  if (screen === "patient-visit" && COPY.ok)
    return (
      <main className="bg-background mx-auto flex min-h-svh max-w-xl flex-col gap-4 p-4">
        <p className="text-caption text-muted-foreground">My care · Your visit</p>
        <VisitSummaryView
          content={COPY.content}
          itemAction={(item, section) =>
            section === "medicines" ? (
              <Button size="sm" variant="secondary">
                Add to my medicines<span className="sr-only"> {item.text}</span>
              </Button>
            ) : null
          }
        />
      </main>
    );
  const open = screen !== "copy";
  const plan = screen.startsWith("close-admit")
    ? PLANS.admit
    : screen.startsWith("close-home")
      ? PLANS.home
      : screen === "close-refer"
        ? PLANS.refer
        : undefined;
  return (
    <main className="bg-background flex min-h-svh items-start justify-center p-6">
      <div className="bg-card border-border w-full max-w-5xl rounded-xl border p-6 shadow-lg">
        <h2 className="text-heading-s mb-1">{open ? "Close visit" : "Patient copy"}</h2>
        <p className="text-body-s text-muted-foreground mb-5">Fixture patient · MS-000-FIX</p>
        <CloseVisitView
          p={payload(desk, open)}
          plan={plan}
          surface="doctor"
          onChanged={() => {}}
          actions={screen === "close-home-noclinic" ? NO_CLINIC : ACTIONS}
        />
      </div>
    </main>
  );
}
