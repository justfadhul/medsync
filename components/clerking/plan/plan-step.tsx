"use client";

import type { AllergyItems } from "./medicines";
import type { PlanView } from "./model";
import type { PharmacyHandlers } from "./pharmacy";
import type { PrescribeTarget } from "./problem-card";
import type { PlanBasketRx, PlanDraft, PlanOrderLine } from "@/lib/clerking/plan/draft";
import type { ObsFrequency } from "@/lib/emr/charts/rules";
import type { PlanRx } from "@/lib/prescribing/plan-rx";
import { useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { ChevronLeftIcon, XIcon } from "lucide-react";

import { MonitoringChartsView } from "@/components/emr/chart/monitoring/monitoring-charts-view";
import { StatusWord } from "@/components/emr/status-word";
import { Button } from "@/components/ui/button";
import { PRESCRIBER_PHARMACY_COPY } from "@/content/pharmacy-prescriber";
import { words } from "@/lib/clerking/impression/board";
import { REASON_WORDS, statusWord } from "@/lib/clerking/plan/checklist";
import {
  FOLLOW_UP_WHEN,
  TALKED_THROUGH,
  TALKED_THROUGH_DISCHARGE,
} from "@/lib/clerking/plan/compose";
import { basketOf, OBS_FREQUENCIES } from "@/lib/clerking/plan/draft";
import {
  dischargeCaution,
  lessOftenThanRequired,
  OBS_WORD,
  urgentBandLine,
} from "@/lib/clerking/plan/observations";
import { standing } from "@/lib/clerking/plan/record";
import { CHART_FREQUENCY_WORD, CHART_NAME } from "@/lib/emr/charts/rules";
import { ORDER_PRIORITY_WORD } from "@/lib/emr/orders";
import { cn } from "@/lib/utils";
import { MedicinesSection } from "./medicines";
import {
  Caution,
  CheckLine,
  DraftLabel,
  inputClass,
  PriorityTag,
  Row,
  Section,
  Seg,
  Tag,
  Toggle,
} from "./parts";
import { PharmacyAnnounce, PharmacyItemBlock } from "./pharmacy";
import { envOfPlan, PlanPrescribeDialog } from "./prescribe-dialog";
import { ProblemCard } from "./problem-card";

/**
 * Step 10, Plan by problem (ADR 0184). Four questions in order: where and how closely; what
 * happens for each problem; what the patient already takes; what must be true before signing.
 * Tests and prescriptions wait in one basket; nothing is sent until it is placed, and the server
 * checks again. Behind CLERKING_PLAN_V2.
 */

export interface PlacePlanRequest {
  orders: PlanOrderLine[];
  prescriptions: PlanRx[];
  observationFrequency: ObsFrequency | null;
  measureUrine: boolean;
}

export interface PlanHandlers {
  onPlacePlan?: (r: PlacePlanRequest) => Promise<boolean>;
  onSyncCharts?: (r: {
    observationFrequency: ObsFrequency | null;
    measureUrine: boolean;
  }) => Promise<boolean>;
  onMedicine?: (
    id: string,
    answer: "continued" | "held" | "stopped",
    reasonCode?: string,
    reasonText?: string,
  ) => unknown;
}

export interface PlanStepProps {
  v: PlanView;
  allergies: AllergyItems;
  editable: boolean;
  act: boolean;
  actor: string;
  busy: string | null;
  onPlan: (fn: (d: PlanDraft) => PlanDraft) => void;
  on: PlanHandlers;
  time: (iso: string) => string;
  onBack: () => void;
  /** NCD_DM_DESK (ADR 0216): the diabetes pack's due checks and targets, read only. */
  diabetes?: {
    care: { id: string; display: string }[];
    targets: { id: string; display: string }[];
  } | null;
}

const DISPOSITION_OPTIONS = [
  { id: "admit" as const, label: "Admit" },
  { id: "observe_eu" as const, label: "Observe in EU" },
  { id: "refer" as const, label: "Refer" },
  { id: "discharge" as const, label: "Discharge" },
];
const SENIOR_OPTIONS = [
  { id: "now" as const, label: "Now" },
  { id: "within_1h" as const, label: "Within 1 hour" },
  { id: "routine" as const, label: "Routine" },
];
const OBS_OPTIONS = OBS_FREQUENCIES.map((f) => ({ id: f, label: OBS_WORD[f] }));

export function PlanStatusPill({ v }: { v: PlanView }) {
  const s = v.status;
  return s.kind === "todo" ? (
    <StatusWord tone="caution">{statusWord(s)}</StatusWord>
  ) : (
    <StatusWord tone="neutral">{statusWord(s)}</StatusWord>
  );
}

function Where({
  v,
  editable,
  onPlan,
}: {
  v: PlanView;
  editable: boolean;
  onPlan: PlanStepProps["onPlan"];
}) {
  const d = v.draft;
  const refer = useId();
  const obsWhy = useId();
  const ward = useId();
  const n = v.news2;
  const req = v.obsRequired;
  const lessOften = lessOftenThanRequired(d.observations?.frequency, req);
  const band = urgentBandLine(n);
  return (
    <Section id="plan-where" title="Where, and how closely">
      <div className="flex flex-col gap-4">
        <Row label="Disposition">
          <Seg
            label="Disposition"
            options={DISPOSITION_OPTIONS}
            value={d.disposition?.kind}
            disabled={!editable}
            onPick={(kind) => onPlan((x) => ({ ...x, disposition: { kind } }))}
          />
          {d.disposition?.kind === "admit" ? (
            v.payload.wards.length ? (
              <div role="group" aria-label="Ward" className="flex flex-wrap gap-1.5">
                {v.payload.wards.map((w) => (
                  <Toggle
                    key={w.id}
                    on={
                      d.disposition?.wardId
                        ? d.disposition.wardId === w.id
                        : d.disposition?.ward === w.name
                    }
                    disabled={!editable}
                    onPress={() =>
                      onPlan((x) => ({
                        ...x,
                        disposition: { kind: "admit", ward: w.name, wardId: w.id },
                      }))
                    }
                  >
                    {w.name}
                    {w.counts ? (
                      <span className="text-muted-foreground font-normal"> · {w.counts}</span>
                    ) : null}
                  </Toggle>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <label htmlFor={ward} className="text-caption text-muted-foreground">
                  Ward (no ward list is set up for this hospital)
                </label>
                <input
                  id={ward}
                  value={d.disposition.ward ?? ""}
                  maxLength={120}
                  disabled={!editable}
                  onChange={(e) =>
                    onPlan((x) => ({ ...x, disposition: { kind: "admit", ward: e.target.value } }))
                  }
                  className={inputClass}
                />
              </div>
            )
          ) : null}
          {d.disposition?.kind === "refer" ? (
            <div className="flex flex-col gap-1">
              <label htmlFor={refer} className="text-caption text-muted-foreground">
                Refer to
              </label>
              <input
                id={refer}
                value={d.disposition.referTo ?? ""}
                maxLength={200}
                disabled={!editable}
                onChange={(e) =>
                  onPlan((x) => ({ ...x, disposition: { kind: "refer", referTo: e.target.value } }))
                }
                className={inputClass}
              />
            </div>
          ) : null}
          {d.disposition?.kind === "discharge" && dischargeCaution(n) ? (
            <Caution>
              {`NEWS2 ${n!.total} at the last set: discharging is a caution.${
                v.payload.intern ? " A senior must agree." : ""
              }`}
            </Caution>
          ) : null}
        </Row>
        <Row label="Observations">
          <Seg
            label="Observations"
            options={OBS_OPTIONS}
            value={d.observations?.frequency}
            disabled={!editable}
            onPick={(frequency) =>
              onPlan((x) => ({ ...x, observations: { ...x.observations, frequency } }))
            }
          />
          {n && req ? (
            <p className="text-caption text-muted-foreground">
              {`NEWS2 ${n.total}${n.provisional ? " (some inputs missing)" : ""}: at least ${OBS_WORD[
                req.frequency
              ].toLowerCase()}. `}
              {band ? <span>{`${band.text} (RCP 2017).`}</span> : null}
            </p>
          ) : (
            <p className="text-caption text-muted-foreground">No NEWS2 at this visit yet.</p>
          )}
          {lessOften ? (
            <div className="flex flex-col gap-1">
              <label
                htmlFor={obsWhy}
                className="text-body-s dark:text-status-caution-fg text-amber-800"
              >
                {`Less often than NEWS2 calls for (${OBS_WORD[req!.frequency].toLowerCase()}): why?`}
              </label>
              <input
                id={obsWhy}
                value={d.observations?.reason ?? ""}
                maxLength={500}
                disabled={!editable}
                onChange={(e) =>
                  onPlan((x) => ({
                    ...x,
                    observations: { frequency: x.observations!.frequency, reason: e.target.value },
                  }))
                }
                className={inputClass}
              />
              {words(d.observations?.reason ?? "") < REASON_WORDS ? (
                <span className="text-caption text-muted-foreground">
                  A reason of three words or more; it goes into the note.
                </span>
              ) : null}
            </div>
          ) : null}
        </Row>
        <Row label="Senior review">
          <Seg
            label="Senior review"
            options={SENIOR_OPTIONS}
            value={d.seniorReview}
            disabled={!editable}
            onPick={(seniorReview) => onPlan((x) => ({ ...x, seniorReview }))}
          />
        </Row>
      </div>
    </Section>
  );
}

function Basket({
  v,
  canWrite,
  busy,
  onPlan,
  onPlace,
}: {
  v: PlanView;
  canWrite: boolean;
  busy: boolean;
  onPlan: PlanStepProps["onPlan"];
  onPlace: () => void;
}) {
  const b = basketOf(v.draft);
  const problem = (ids: readonly string[]) =>
    v.cards
      .filter((c) => ids.includes(c.versionId))
      .map((c) => c.display)
      .join(", ") || "a problem no longer on the visit";
  const n = b.orders.length;
  const m = b.prescriptions.length;
  if (!n && !m) return null;
  const place = `Place ${n} ${n === 1 ? "order" : "orders"} and ${m} ${m === 1 ? "prescription" : "prescriptions"}`;
  return (
    <section
      aria-labelledby="plan-basket"
      className="border-border bg-card shadow-card sticky bottom-0 z-10 flex flex-col gap-3 rounded-lg border px-4 py-3"
    >
      <h3 id="plan-basket" className="text-label text-foreground">
        Basket
      </h3>
      <ul className="flex flex-col gap-1.5">
        {b.orders.map((o) => (
          <li key={o.clientKey} className="text-body-s flex flex-wrap items-center gap-2">
            <span className="text-foreground">{o.display}</span>
            <PriorityTag priority={o.priority} word={ORDER_PRIORITY_WORD[o.priority]} />
            <span className="text-muted-foreground">{`for ${problem(o.reasonConditionIds)}`}</span>
            <Button
              size="iconSm"
              variant="ghost"
              aria-label={`Remove ${o.display}`}
              disabled={!canWrite}
              onClick={() =>
                onPlan((d) => {
                  const x = basketOf(d);
                  return {
                    ...d,
                    basket: { ...x, orders: x.orders.filter((y) => y.clientKey !== o.clientKey) },
                  };
                })
              }
            >
              <XIcon aria-hidden className="size-3.5" />
            </Button>
          </li>
        ))}
        {b.prescriptions.map((r) => (
          <li key={r.clientKey} className="text-body-s flex flex-wrap items-center gap-2">
            <span className="text-foreground">{r.display}</span>
            <span className="text-muted-foreground">
              {`for ${problem(r.conditionId ? [r.conditionId] : [])}`}
            </span>
            <Button
              size="iconSm"
              variant="ghost"
              aria-label={`Remove ${r.drugName}`}
              disabled={!canWrite}
              onClick={() =>
                onPlan((d) => {
                  const x = basketOf(d);
                  return {
                    ...d,
                    basket: {
                      ...x,
                      prescriptions: x.prescriptions.filter((y) => y.clientKey !== r.clientKey),
                    },
                  };
                })
              }
            >
              <XIcon aria-hidden className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>
      <Button className="self-start" disabled={!canWrite || busy} onClick={onPlace}>
        {place}
      </Button>
    </section>
  );
}

export function PlanStep(props: PlanStepProps) {
  const { v, editable, act, onPlan, on, time } = props;
  const canWrite = editable && act;
  // Pharmacy Phase 4 (5.3, RN-3): Renew from the renewal list opens the dialog pre-loaded, once. Nothing is placed
  // until the prescriber places it; the server re-checks the request.
  const search = useSearchParams();
  const [target, setTarget] = useState<PrescribeTarget | null>(() => {
    const renew = search.get("renew");
    const drugId = search.get("rx");
    if (!renew || !drugId || !canWrite || !v.payload.repeats || !v.cards.length) return null;
    const problem = v.cards.find((c) => c.versionId === search.get("for")) ?? v.cards[0]!;
    return { problem, drugId, renewalId: renew };
  });
  const [placing, setPlacing] = useState(false);
  const pharmacy = v.payload.pharmacy ?? null;
  // Pharmacy Phase 1 (5.4): the line a dialog opened from a query or notice is changing.
  const [replacing, setReplacing] = useState<PlanBasketRx["replaces"] | null>(null);
  const d = v.draft;
  const discharge = d.disposition?.kind === "discharge";
  const whereId = useId();
  const fluidOpen =
    v.record.charts.some((c) => c.kind === "fluid_balance") ||
    v.willOpen.some((c) => c.kind === "fluid_balance");
  const talked = discharge ? [...TALKED_THROUGH, ...TALKED_THROUGH_DISCHARGE] : TALKED_THROUGH;

  const place = async () => {
    const b = basketOf(v.draft);
    setPlacing(true);
    const ok = await on.onPlacePlan?.({
      orders: b.orders,
      prescriptions: b.prescriptions.map(
        ({ display: _d, drugName: _n, problemLogicalId: _p, ...rx }) => rx,
      ),
      observationFrequency: v.draft.observations?.frequency ?? null,
      measureUrine: !!v.draft.measureUrine,
    });
    setPlacing(false);
    if (ok)
      onPlan((x) => {
        // Keep anything added while placing; drop what was placed.
        const now = basketOf(x);
        const orders = new Set(b.orders.map((o) => o.clientKey));
        const rx = new Set(b.prescriptions.map((r) => r.clientKey));
        return {
          ...x,
          basket: {
            orders: now.orders.filter((o) => !orders.has(o.clientKey)),
            prescriptions: now.prescriptions.filter((r) => !rx.has(r.clientKey)),
          },
        };
      });
  };

  const pharmacyHandlers: PharmacyHandlers | undefined = pharmacy
    ? {
        canChange: v.payload.prescribing && v.cards.length > 0,
        inBasket: new Set(
          basketOf(v.draft).prescriptions.flatMap((r) => (r.replaces ? [r.replaces.lineId] : [])),
        ),
        onChange: (item, line) => {
          const problem = v.cards.find((c) => c.versionId === line.conditionId) ?? v.cards[0];
          if (!problem) return;
          setReplacing({
            lineId: line.id,
            ref: item.id,
            kind: item.kind === "query" ? "query" : "notice",
          });
          setTarget({ problem, drugId: line.drugId });
        },
      }
    : undefined;
  // Items not shown under a line on a card: a whole prescription, or a line from another visit.
  const onCard = new Set(
    v.record.prescriptions
      .filter((r) => standing(r) && v.cards.some((c) => c.versionId === r.conditionId))
      .map((r) => r.id),
  );
  const loose =
    pharmacy?.items.filter(
      (i) =>
        (i.kind === "query" && i.scope === "prescription") ||
        !i.lines.some((l) => onCard.has(l.id)),
    ) ?? [];

  const markDone = async () => {
    onPlan((x) => ({
      ...x,
      done: { by: props.actor, at: new Date().toISOString(), hash: v.fingerprint },
    }));
    await on.onSyncCharts?.({
      observationFrequency: v.draft.observations?.frequency ?? null,
      measureUrine: !!v.draft.measureUrine,
    });
  };

  const addRx = (rx: PlanBasketRx) =>
    onPlan((x) => {
      const b = basketOf(x);
      return { ...x, basket: { ...b, prescriptions: [...b.prescriptions, rx] } };
    });

  return (
    <div className="flex flex-col gap-8">
      {pharmacy ? <PharmacyAnnounce announce={pharmacy.announce} /> : null}
      {pharmacy && pharmacyHandlers && loose.length ? (
        <Section id="plan-pharmacy" title={PRESCRIBER_PHARMACY_COPY.heading}>
          <ul className="flex flex-col gap-3">
            {loose.map((i) => (
              <li key={i.id} className="flex flex-col gap-1">
                {!i.thisVisit ? (
                  <span className="text-caption text-muted-foreground">
                    {PRESCRIBER_PHARMACY_COPY.earlier}
                  </span>
                ) : null}
                <PharmacyItemBlock
                  item={i}
                  view={pharmacy}
                  canWrite={canWrite}
                  handlers={pharmacyHandlers}
                />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Where v={v} editable={editable} onPlan={onPlan} />

      <Section id="plan-problems" title="By problem">
        {v.cards.length ? (
          <ul className="flex flex-col gap-3">
            {v.cards.map((c, i) => (
              <ProblemCard
                key={c.logicalId}
                card={c}
                v={v}
                editable={editable}
                act={act}
                onPlan={onPlan}
                onPrescribe={(t) => {
                  setReplacing(null);
                  setTarget(t);
                }}
                time={time}
                defaultOpen={i === 0 || c.mustNotMiss}
                pharmacy={pharmacyHandlers}
              />
            ))}
          </ul>
        ) : (
          <p className="text-body-s text-muted-foreground">
            No problems yet: add the leading diagnosis in Impression first.
          </p>
        )}
      </Section>

      {props.diabetes && (props.diabetes.care.length || props.diabetes.targets.length) ? (
        <Section id="plan-diabetes" title="Diabetes: due and targets">
          <p className="text-caption text-muted-foreground">
            From the diabetes pack, as suggestions: nothing here is ordered. Order tests from the
            problem above.
          </p>
          <ul className="text-body-s text-foreground flex flex-col gap-1">
            {props.diabetes.care.map((c) => (
              <li key={c.id}>{c.display}</li>
            ))}
            {props.diabetes.targets.map((t) => (
              <li key={t.id}>{`Target: ${t.display}`}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section id="plan-medicines" title="Medicines">
        <MedicinesSection
          v={v}
          allergies={props.allergies}
          canWrite={canWrite}
          time={time}
          onMedicine={on.onMedicine}
        />
      </Section>

      <Section id="plan-charts" title="Monitoring charts">
        <div className="flex flex-col gap-3">
          {v.willOpen.length ? (
            <p className="text-caption text-muted-foreground">
              These open when the basket is placed or the plan is marked done:
            </p>
          ) : null}
          {v.willOpen.length ? (
            <ul aria-label="Charts that open with the plan" className="flex flex-col gap-1.5">
              {v.willOpen.map((c) => (
                <li key={c.kind} className="text-body-s flex flex-wrap items-center gap-2">
                  <span className="text-foreground">{CHART_NAME[c.kind]}</span>
                  <Tag>{c.frequency ? CHART_FREQUENCY_WORD[c.frequency] : "As scheduled"}</Tag>
                  <span className="text-muted-foreground">{`Opened by: ${c.label}`}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {fluidOpen ? (
            <Toggle
              on={!!d.measureUrine}
              disabled={!editable}
              onPress={() => {
                const measureUrine = !d.measureUrine;
                onPlan((x) => ({ ...x, measureUrine }));
                if (v.record.charts.some((c) => c.kind === "fluid_balance"))
                  void on.onSyncCharts?.({
                    observationFrequency: d.observations?.frequency ?? null,
                    measureUrine,
                  });
              }}
            >
              Measure urine output
            </Toggle>
          ) : null}
          {v.payload.monitoring && v.payload.monitoring.charts.length ? (
            <MonitoringChartsView payload={v.payload.monitoring} defaultOpen="none" />
          ) : !v.willOpen.length ? (
            <p className="text-body-s text-muted-foreground">
              No charts open yet. The plan opens them: observations, IV fluids, glucose-lowering
              medicines and any prescription each open their chart when placed.
            </p>
          ) : null}
        </div>
      </Section>

      <Section
        id="plan-talked"
        title="Talked through"
        aside={<DraftLabel>Draft wording, not CSO-signed</DraftLabel>}
      >
        <div role="group" aria-label="Talked through" className="flex flex-wrap gap-1.5">
          {talked.map((t) => (
            <Toggle
              key={t.id}
              on={!!d.talkedThrough?.[t.id]}
              disabled={!editable}
              onPress={() =>
                onPlan((x) => ({
                  ...x,
                  talkedThrough: { ...x.talkedThrough, [t.id]: !x.talkedThrough?.[t.id] },
                }))
              }
            >
              {t.label}
            </Toggle>
          ))}
        </div>
        {discharge ? (
          <div className="flex flex-col gap-3">
            <Row label="Follow-up">
              <Seg
                label="Follow-up"
                options={Object.entries(FOLLOW_UP_WHEN).map(([id, label]) => ({ id, label }))}
                value={d.followUp?.when}
                disabled={!editable}
                onPick={(when) => onPlan((x) => ({ ...x, followUp: { ...x.followUp, when } }))}
              />
              <label htmlFor={whereId} className="text-caption text-muted-foreground">
                Where
              </label>
              <input
                id={whereId}
                value={d.followUp?.where ?? ""}
                maxLength={200}
                disabled={!editable}
                onChange={(e) =>
                  onPlan((x) => ({ ...x, followUp: { ...x.followUp, where: e.target.value } }))
                }
                className={inputClass}
              />
            </Row>
            <Toggle
              on={!!d.followUp?.comeBackAdvice}
              disabled={!editable}
              onPress={() =>
                onPlan((x) => ({
                  ...x,
                  followUp: { ...x.followUp, comeBackAdvice: !x.followUp?.comeBackAdvice },
                }))
              }
            >
              When-to-come-back advice given
            </Toggle>
          </div>
        ) : null}
      </Section>

      <Section id="plan-check" title="Before you sign" aside={<PlanStatusPill v={v} />}>
        <ul className="flex flex-col gap-1.5">
          {v.checklist.map((i) => (
            <CheckLine key={i.id} done={i.done} label={i.label} detail={i.detail} />
          ))}
        </ul>
      </Section>

      <Basket
        v={v}
        canWrite={canWrite}
        busy={placing || props.busy === "plan:place"}
        onPlan={onPlan}
        onPlace={place}
      />

      <div className="border-border flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="secondary" onClick={props.onBack} className="self-start">
          <ChevronLeftIcon aria-hidden />
          Impression
        </Button>
        <p className="text-caption text-muted-foreground max-w-prose">
          Decision support: MedSync never chooses a medicine. Doses pre-set only from a signed,
          verified reference; drafts are labelled.
        </p>
        <Button
          className={cn("self-start sm:self-auto")}
          disabled={!editable || v.status.kind !== "ready"}
          onClick={() => void markDone()}
        >
          {v.status.kind === "done" ? "Plan done" : "Mark plan done"}
        </Button>
      </div>

      {target ? (
        <PlanPrescribeDialog
          env={envOfPlan(v)}
          allergies={props.allergies}
          target={target}
          onClose={() => {
            setTarget(null);
            setReplacing(null);
          }}
          onAdd={(rx) => {
            addRx(replacing ? { ...rx, replaces: replacing } : rx);
            setTarget(null);
            setReplacing(null);
          }}
          time={time}
        />
      ) : null}
    </div>
  );
}
