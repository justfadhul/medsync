"use client";

import type { ImpressionHandlers } from "@/components/clerking/impression/impression-step";
import type { PlacePlanRequest, PlanHandlers } from "@/components/clerking/plan/plan-step";
import type { DeskDiagnosis, DeskPayload } from "@/components/emr/desk/model";
import type { DxPick } from "@/components/emr/desk/pickers";
import type { DxOptions } from "@/components/emr/desk/sections";
import type { NoteContent } from "@/lib/emr/note-rules";
import { useMemo, useRef, useState } from "react";

import { ClerkingDesk } from "@/components/clerking/clerking-desk";
import {
  useCatalogue,
  useDxCatalogue,
  useExamCatalogue,
} from "@/components/clerking/use-catalogue";
import { syncRecorded } from "@/components/emr/desk/model";
import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { chartsToOpen } from "@/lib/emr/charts/rules";
import { drugById } from "@/lib/prescribing/formulary";
import { willRead } from "@/lib/prescribing/plan-rx";

/**
 * The desk over local state: every write stays in the page (a fixture, D-SI-29). Diagnoses and
 * orders are kept here the way the server would return them, so the Impression step can be walked
 * end to end without a database.
 */
export function FixtureDesk({ p, step }: { p: DeskPayload; step: string }) {
  const [content, setContent] = useState<NoteContent>(p.draft!.content);
  const [current, setCurrent] = useState(step);
  const [diagnoses, setDiagnoses] = useState<DeskDiagnosis[]>(p.diagnoses);
  const [orders, setOrders] = useState(p.orders);
  const [plan, setPlan] = useState(p.plan);
  const seq = useRef(10);
  const { cat } = useCatalogue(p.clerking?.catalogueUrl);
  const { cat: ecat } = useExamCatalogue(p.clerking?.exam.catalogueUrl);
  const { cat: dx, failed } = useDxCatalogue(p.clerking?.dx?.catalogueUrl);

  const nextId = () => `00000000-0000-4000-8000-${String(++seq.current).padStart(12, "0")}`;
  // A write makes a new version under the same logical id, as the server does.
  const revise = (logicalId: string, patch: Partial<DeskDiagnosis>) =>
    setDiagnoses((ds) =>
      ds.map((d) => (d.logicalId === logicalId ? { ...d, ...patch, id: nextId() } : d)),
    );
  const onDiagnosis = (pick: DxPick, opts: DxOptions) => {
    const id = nextId();
    const termId = "term" in pick ? pick.term.id : undefined;
    const row: DeskDiagnosis = {
      id,
      logicalId: nextId(),
      display: "term" in pick ? pick.term.display : pick.typed,
      code: "term" in pick && pick.term.verified ? pick.term.icd11 : null,
      verification: opts.verification,
      rank: opts.primary ? "primary" : "secondary",
      termId: termId ?? null,
      restricted: "term" in pick && pick.term.restricted,
      onProblemList: !!opts.addToProblemList,
      cosignPending: false,
    };
    setDiagnoses((ds) => [
      ...ds.map((d) =>
        opts.primary && d.rank === "primary" ? { ...d, rank: "secondary" as const } : d,
      ),
      row,
    ]);
  };
  // Step 10 (ADR 0184): placing moves the basket into the record, as the server would.
  const clock = "2026-09-27T20:16:00.000Z";
  const onPlacePlan = async (r: PlacePlanRequest) => {
    setPlan((x) =>
      x
        ? {
            ...x,
            record: {
              ...x.record,
              orders: [
                ...x.record.orders,
                ...r.orders.map((o) => ({
                  id: nextId(),
                  display: o.display,
                  testKey: o.testKey,
                  testId: o.testId,
                  priority: o.priority,
                  frequency: o.frequency,
                  reasonConditionIds: o.reasonConditionIds,
                  at: clock,
                  statusText: o.testKey === "test.ecg" ? "To do" : "To collect",
                  open: true,
                })),
              ],
              prescriptions: [
                ...x.record.prescriptions,
                ...r.prescriptions.map((rx) => {
                  const drug = drugById(rx.drugId)!;
                  return {
                    id: nextId(),
                    drugId: rx.drugId,
                    drugName: drug.generic,
                    display: willRead(rx, drug),
                    conditionId: rx.conditionId,
                    kind: rx.kind,
                    state: "active",
                    awaitingCosign: drug.flags.controlled,
                    cosignWithheld: false,
                    answered: [],
                    edits: [],
                    at: clock,
                  };
                }),
              ],
              requests: [
                ...x.record.requests,
                ...r.requests.map((q) => ({
                  id: nextId(),
                  kind: q.kind,
                  urgency: q.urgency,
                  helpWanted: q.helpWanted,
                  targetWords:
                    x.requests?.departments.find((d) => d.id === q.targetDepartmentId)?.name ?? "",
                  stateWord: CARE_REQUEST_COPY.state.sent,
                  at: clock,
                })),
              ],
              charts: [
                ...x.record.charts,
                ...chartsToOpen({
                  observationFrequency: r.observationFrequency,
                  problems: [],
                  items: r.prescriptions.map((rx) => ({
                    type: "prescription" as const,
                    id: rx.clientKey,
                    drugId: rx.drugId,
                    classId: drugById(rx.drugId)?.class ?? "",
                    kind: rx.kind,
                    label: drugById(rx.drugId)?.generic ?? rx.drugId,
                  })),
                  news2AtClerking: null,
                })
                  .filter((o) => !x.record.charts.some((c) => c.kind === o.kind))
                  .map((o) => ({
                    id: nextId(),
                    kind: o.kind,
                    frequency: o.frequency,
                    measureUrine: r.measureUrine,
                    openedByLabel: o.label,
                  })),
              ],
            },
          }
        : x,
    );
    return true;
  };
  const on: ImpressionHandlers &
    Omit<PlanHandlers, "onMedicine"> & {
      onContent: typeof setContent;
      onSection: typeof setCurrent;
      onMedicine: (id: string, answer: "continued" | "stopped" | "changed" | "held") => void;
    } = {
    onPlacePlan,
    onSyncCharts: async () => true,
    onMedicine: (id, answer) =>
      setPlan((x) =>
        x
          ? {
              ...x,
              record: {
                ...x.record,
                medicines: x.record.medicines.map((m) => (m.id === id ? { ...m, answer } : m)),
              },
            }
          : x,
      ),
    onContent: setContent,
    onSection: setCurrent,
    onDiagnosis,
    onLeading: (row) =>
      setDiagnoses((ds) =>
        ds.map((d) =>
          d.logicalId === row.dx.logicalId
            ? {
                ...d,
                rank: "primary",
                verification: d.verification === "confirmed" ? "confirmed" : "provisional",
              }
            : d.rank === "primary"
              ? { ...d, rank: "secondary", verification: "differential" }
              : d,
        ),
      ),
    onToDifferential: (row) =>
      revise(row.dx.logicalId, { rank: "secondary", verification: "differential" }),
    onDxStatus: (row, to) =>
      revise(row.dx.logicalId, { verification: to === "final" ? "confirmed" : "provisional" }),
    onRemove: (row) => setDiagnoses((ds) => ds.filter((d) => d.logicalId !== row.dx.logicalId)),
    onProblemList: (row) => revise(row.dx.logicalId, { onProblemList: true }),
    onAddToPlan: (testId, row) =>
      setOrders((os) => [
        ...os,
        {
          id: nextId(),
          display: dx?.tests[testId] ?? testId,
          statusText: "Ordered",
          at: "11:32",
          open: true,
          ...{ testId: dx?.testIds[testId], reasonConditionIds: [row.dx.versionId] },
        },
      ]),
  };

  // The note mirrors what is recorded, as the live desk does after each refresh.
  const payload = useMemo(
    () => ({ ...p, diagnoses, orders, ...(plan ? { plan } : {}) }),
    [p, diagnoses, orders, plan],
  );
  const shown = useMemo(() => syncRecorded(content, payload), [content, payload]);

  return (
    <div className="flex h-dvh flex-col">
      <ClerkingDesk
        p={payload}
        cat={cat}
        ecat={ecat}
        dx={dx}
        dxFailed={failed}
        actor="Fixture clinician"
        content={shown}
        current={current}
        save={{ tone: "neutral", text: "Saved 11:32" }}
        on={on}
        loaders={{
          findings: async () => [],
          terms: async () => (dx ? fixtureTerms(dx) : []),
        }}
      />
    </div>
  );
}

/** The picker's terms from the catalogue's names (the fixture has no term index). */
function fixtureTerms(dx: NonNullable<ReturnType<typeof useDxCatalogue>["cat"]>) {
  return Object.entries(dx.termIds).map(([uuid, id]) => {
    const n = dx.names[id];
    return {
      id: uuid,
      display: n?.display ?? id,
      synonyms: [],
      icd11: null,
      verified: false,
      chronic: false,
      symptomLevel: false,
      restricted: !!n?.restricted,
      notifiable: false,
    };
  });
}
