"use client";

import type { AllergyItems } from "./medicines";
import type { PlanView } from "./model";
import type { PrescribeTarget } from "./problem-card";
import type { PlanBasketRx } from "@/lib/clerking/plan/draft";
import type { PlanPayload } from "@/lib/clerking/plan/payload";
import type { ProblemCard } from "@/lib/clerking/plan/problems";
import type { BrandOption } from "@/lib/emr/read/prescribe";
import type { ResolvedRegimen } from "@/lib/prescribing/formulary";
import type { StockLine } from "@/lib/prescribing/pharmacy";
import type { PrescribePlace } from "@/lib/prescribing/places";
import type { PlanCheck, PlanCheckContext } from "@/lib/prescribing/plan-checks";
import type { AnswerId, FluidPurpose, PlanRx } from "@/lib/prescribing/plan-rx";
import type {
  DoseUnit,
  Drug,
  FormularyRoute,
  RxCourse,
  RxFrequency,
} from "@/lib/prescribing/reference/formulary-types";
import type { ReactNode } from "react";
import { useEffect, useId, useMemo, useState } from "react";
import { ArrowRightIcon, CheckIcon, SearchIcon, StarIcon, XIcon } from "lucide-react";

import { EditorDialog } from "@/components/medsync/editor-dialog";
import { Button } from "@/components/ui/button";
import { SheetBody, SheetClose, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PRESCRIBE_COPY as C, fill } from "@/content/prescribing";
import { basketOf } from "@/lib/clerking/plan/draft";
import { standing } from "@/lib/clerking/plan/record";
import { stockLines } from "@/lib/emr/actions/pharmacy-stock";
import { prescribeBrands } from "@/lib/emr/actions/prescribe";
import {
  BAND_WORD,
  classById,
  drugById,
  DRUGS,
  drugsInClass,
  isFluid,
  patientBand,
  REFERENCE_TAG_WORD,
  referenceTag,
  resolveRegimens,
  searchDrugs,
} from "@/lib/prescribing/formulary";
import { STOCK_LINE_COPY, stockLineWords } from "@/lib/prescribing/pharmacy";
import { pharmacyGroups } from "@/lib/prescribing/pharmacy-classes";
import { PLACE } from "@/lib/prescribing/places";
import {
  egfrOf,
  needingAnswer,
  OUTCOME_WORD,
  planChecks,
  verifyAnswers,
} from "@/lib/prescribing/plan-checks";
import {
  CHECK_REASONS,
  COURSE_WORD,
  DILUENTS,
  durationWords,
  EDIT_FIELD_WORD,
  fluidRate,
  FREQUENCY_WORD,
  INFUSION_OVER,
  OVERRIDE_REASONS,
  PURPOSE_WORD,
  regimenEdits,
  ROUTE_WORD,
  STOCK_REASONS,
  willRead,
} from "@/lib/prescribing/plan-rx";
import {
  DOSE_UNITS,
  RX_COURSES,
  RX_FREQUENCIES,
} from "@/lib/prescribing/reference/formulary-types";
import { supplyQuantity } from "@/lib/prescribing/supply";
import { cn } from "@/lib/utils";
import { Caution, Chevron, DraftLabel, FOCUS, inputClass, Seg, Tag, Toggle } from "./parts";
import { NO_REPEATS, readRepeats, RepeatsField } from "./repeats";

/**
 * The one Prescribe dialog (ADR 0186, prescribing kit F1–F3), laid out as the 11 Nov 2026 prototype:
 * the patient strip under the name, then three columns, 1 · What (search, group, order sets, the
 * medicine list with the brand under the one picked), 2 · How (weight, regimen, your own dose, how to
 * give it, the problem, the supply) and 3 · Check (the checks, then this prescription and what is
 * already prescribed). A dose arrives pre-set only from a signed, verified regimen; every change from
 * it is shown and recorded. The checks run live here and again on the server.
 */

/**
 * What the dialog reads about the patient and the place (prescribing kit F1): the clerking Plan
 * builds it from its view (`envOfPlan`), every other place from the session the server opens.
 */
export interface PrescribeEnv {
  facts: PlanPayload["facts"];
  cosign: PlanPayload["cosign"];
  bloodCulture: PlanPayload["bloodCulture"];
  kidneyTestOrdered: boolean;
  interactions?: PlanPayload["interactions"];
  stockAnswer?: PlanPayload["stockAnswer"];
  repeats?: PlanPayload["repeats"];
  /** The problems a line can be for (the clerking Plan); empty elsewhere. */
  cards: ProblemCard[];
  /** Placed and standing this visit, then the lines in the basket. */
  standing: { drugId: string; drugName: string }[];
  basket: { drugId: string; drugName: string }[];
  basketTests: string[];
  /** PRESCRIBE_V2: the place, its collect point, brands, supply and the kit's checks. */
  v2: {
    place: PrescribePlace;
    collect: string;
    surface: "doctor" | "clinician";
    patientUserId: string;
  } | null;
}

export function envOfPlan(v: PlanView): PrescribeEnv {
  const basket = basketOf(v.draft);
  const who = v.payload.stockAnswer ?? v.payload.repeats?.who;
  return {
    facts: v.payload.facts,
    cosign: v.payload.cosign,
    bloodCulture: v.payload.bloodCulture,
    kidneyTestOrdered: v.payload.kidneyTestOrdered,
    interactions: v.payload.interactions,
    stockAnswer: v.payload.stockAnswer,
    repeats: v.payload.repeats,
    cards: v.cards,
    standing: v.record.prescriptions.filter(standing),
    basket: basket.prescriptions,
    basketTests: basket.orders.map((o) => o.testKey),
    v2:
      v.payload.prescribeV2 && who
        ? {
            place: "clerking",
            collect: PLACE.clerking.collect,
            surface: who.surface,
            patientUserId: who.patientUserId,
          }
        : null,
  };
}

/** "Medicines | Protocols · N" (kit F6). */
export interface PrescribeModes {
  value: "medicines" | "protocols";
  count: number | null;
  onChange: (m: "medicines" | "protocols") => void;
}

/**
 * The one Prescribe outside the clerking Plan (prescribe-session.tsx) fills these: the patient's
 * name, the mode switch and the Protocols columns, the order sets, the basket and what is already
 * prescribed (column 3), and the footer's Review and send. Without them the dialog is the Plan's.
 */
export interface PrescribeSessionSlots {
  patient: { name: string; mrn: string | null };
  home: string[];
  modes: PrescribeModes | null;
  protocols: ReactNode;
  sets: { id: string; label: string; title: string; onPick: () => void }[];
  notice: string | null;
  lists: ReactNode;
  footer: { n: number; summary: string; onReview: () => void };
}

const STAR_KEY = (drugId: string) => `medsync.rx.star.${drugId}`;
const readStar = (drugId: string) => {
  try {
    return window.localStorage.getItem(STAR_KEY(drugId));
  } catch {
    return null;
  }
};

const FLUID_DRUGS = ["sodium_chloride_0_9", "ringers_lactate", "glucose_5", "glucose_10"] as const;
const VOLUMES = [250, 500, 1000] as const;
const OVER_BOLUS = [15, 30, 60] as const;
const OVER_INFUSION = [240, 360, 480, 720, 1440] as const;
const PURPOSES: FluidPurpose[] = ["bolus", "maintenance", "replacement"];
const LEVEL_ORDER: Record<string, number> = { stop: 0, check: 1, note: 2 };

const newKey = () => `plan-rx-${crypto.randomUUID()}`;
const notLinkedLine: StockLine = {
  state: "not_linked",
  level: "not_checked",
  pointId: null,
  point: null,
  lastCountAt: null,
  lastReceiptAt: null,
  since: null,
  elsewhere: [],
};
const intermittent = (m: string | null) => !!m && /intermittent infusion/i.test(m);
const selectClass = cn(inputClass, "pointer-coarse:min-h-11");
const OVER = "text-caption text-muted-foreground font-medium tracking-[0.06em] uppercase";

interface FluidState {
  purpose: FluidPurpose | null;
  volumeMl: number | null;
  overMinutes: number | null;
  delivery: "pump" | "gravity" | null;
  dropsPerMl: 20 | 60 | null;
  warmed: boolean;
}

interface State {
  conditionId: string | null;
  /** PRESCRIBE_V2: the brand chosen; null = any brand. */
  productId: string | null;
  drugId: string | null;
  /** Glucose 10% is a drug for hypoglycaemia and a fluid for maintenance: how it was chosen says. */
  mode: "drug" | "fluid";
  regimenId: string | null;
  doseNum: number | null;
  unit: DoseUnit;
  strength: string | null;
  route: FormularyRoute | null;
  method: string | null;
  infusionOver: (typeof INFUSION_OVER)[number] | null;
  diluent: (typeof DILUENTS)[number] | null;
  frequency: RxFrequency | null;
  prn: boolean;
  course: RxCourse | null;
  start: "now" | "next_round";
  note: string;
  fluid: FluidState;
  answers: Record<string, { answer: AnswerId; text?: string }>;
  witness: string;
  typedDose: string;
}

const EMPTY_FLUID: FluidState = {
  purpose: null,
  volumeMl: null,
  overMinutes: null,
  delivery: null,
  dropsPerMl: null,
  warmed: false,
};

/** A fluid chosen from the fluid chips is a fluid; from the list, a fluid with a signed drug
 *  regimen (glucose 10% for hypoglycaemia) is prescribed as a drug. */
function modeFor(d: Drug | undefined, via: "fluids" | "list"): "drug" | "fluid" {
  if (!d) return via === "fluids" ? "fluid" : "drug";
  if (via === "fluids") return "fluid";
  return isFluid(d) && !d.dose.regimens.some((r) => !r.fluidPurpose) ? "fluid" : "drug";
}

export type Target = Omit<PrescribeTarget, "problem"> & {
  problem?: ProblemCard;
  /** Kit F2 "Edit": the line as it was added, to change it. */
  from?: PlanBasketRx;
};

/** A basket line back into the dialog's state (Edit). */
function fromRx(r: PlanBasketRx): State {
  const f = r.fluid;
  return {
    conditionId: r.conditionId,
    productId: r.productId ?? null,
    drugId: r.drugId,
    mode: r.kind,
    regimenId: r.regimenId,
    doseNum: r.kind === "fluid" ? null : r.doseNum,
    unit: r.unit,
    strength: r.strength,
    route: r.route,
    method: r.kind === "fluid" ? null : r.method,
    infusionOver: r.infusionOver,
    diluent: r.diluent,
    frequency: r.kind === "fluid" ? null : r.frequency,
    prn: r.prn,
    course: r.course,
    start: r.start,
    note: r.note ?? "",
    fluid: f
      ? {
          purpose: f.purpose,
          volumeMl: f.volumeMl,
          overMinutes: f.overMinutes,
          delivery: f.delivery,
          dropsPerMl: f.dropsPerMl,
          warmed: f.warmed,
        }
      : EMPTY_FLUID,
    answers: Object.fromEntries(r.answers.map((a) => [a.code, { answer: a.answer, text: a.text }])),
    witness: r.witness ?? "",
    typedDose: r.typedDose != null ? String(r.typedDose) : "",
  };
}

function initial(
  target: Target,
  via: "fluids" | "list" = target.fluids ? "fluids" : "list",
): State {
  if (target.from) return fromRx(target.from);
  const drug = target.drugId ? drugById(target.drugId) : undefined;
  const route = drug?.routes.length === 1 ? drug.routes[0]! : null;
  const mode = modeFor(drug, via);
  return {
    conditionId: target.problem?.versionId ?? null,
    productId: null,
    drugId: target.drugId ?? null,
    mode,
    regimenId: null,
    doseNum: null,
    unit: mode === "fluid" ? "mL" : "mg",
    strength: null,
    route: mode === "fluid" ? "iv" : route,
    method: null,
    infusionOver: null,
    diluent: null,
    frequency: null,
    prn: false,
    course: null,
    start: "now",
    note: "",
    fluid: EMPTY_FLUID,
    answers: {},
    witness: "",
    typedDose: "",
  };
}

type Facts = PlanPayload["facts"];

/** The regimens for this use: fluid regimens (a bolus) in fluid mode, drug regimens otherwise. */
function regimensFor(drug: Drug | undefined, f: Facts, fluidMode: boolean) {
  if (!drug) return null;
  const r = resolveRegimens(drug, { ageYears: f.ageYears, weight: f.weight });
  const regimens = r.regimens.filter((x) => !!x.regimen.fluidPurpose === fluidMode);
  return regimens.length || !r.regimens.length
    ? { ...r, regimens }
    : { ...r, regimens, note: "No verified regimen for this use yet: choose the values." };
}

/** A regimen's values into the state (also "Use the regimen"). */
function withRegimen(x: State, r: ResolvedRegimen): State {
  const g = r.regimen;
  if (x.mode === "fluid")
    return {
      ...x,
      regimenId: g.id,
      route: "iv",
      fluid: {
        ...x.fluid,
        purpose: g.fluidPurpose ?? x.fluid.purpose,
        volumeMl: r.dose.num ?? x.fluid.volumeMl,
      },
    };
  return {
    ...x,
    regimenId: g.id,
    doseNum: r.dose.num,
    unit: g.unit,
    strength: g.strength ?? null,
    route: g.route,
    method: g.method ?? null,
    frequency: g.freq,
    course: g.course ?? null,
  };
}

/** Kit F2: picking a medicine pre-selects the signed regimen that applies to this patient, if any. */
function picked(st: State, f: Facts): State {
  if (!st.drugId || st.regimenId) return st;
  const r = regimensFor(drugById(st.drugId), f, st.mode === "fluid")?.regimens.find(
    (x) => x.applies && x.dose.num != null,
  );
  return r ? withRegimen(st, r) : st;
}

function toRx(s: State, drug: Drug | undefined, weightAt: string | null): PlanRx | null {
  if (!drug || !s.route) return null;
  const fluidMode = s.mode === "fluid";
  const f = s.fluid;
  return {
    clientKey: "draft",
    kind: fluidMode ? "fluid" : "drug",
    drugId: drug.id,
    conditionId: s.conditionId,
    regimenId: s.regimenId,
    doseNum: fluidMode ? f.volumeMl : s.doseNum,
    unit: fluidMode ? "mL" : s.unit,
    strength: s.strength,
    route: fluidMode ? "iv" : s.route,
    method: fluidMode
      ? f.delivery === "gravity"
        ? "Gravity drip"
        : f.delivery === "pump"
          ? "Infusion pump"
          : null
      : s.method,
    infusionOver: fluidMode ? null : s.infusionOver,
    diluent: fluidMode ? null : s.diluent,
    frequency: fluidMode ? "stat" : (s.frequency ?? "stat"),
    prn: fluidMode ? false : s.prn,
    course: fluidMode ? null : s.course,
    start: s.start,
    note: s.note.trim() || null,
    fluid:
      fluidMode && f.purpose && f.volumeMl && f.overMinutes && f.delivery
        ? {
            purpose: f.purpose,
            volumeMl: f.volumeMl,
            overMinutes: f.overMinutes,
            delivery: f.delivery,
            dropsPerMl: f.delivery === "gravity" ? f.dropsPerMl : null,
            warmed: f.warmed,
          }
        : null,
    answers: Object.entries(s.answers).map(([code, a]) => ({
      code,
      answer: a.answer,
      text: a.text,
    })),
    witness: s.witness.trim() || null,
    weightAt,
    typedDose: s.typedDose.trim() ? Number(s.typedDose) : null,
    ...(s.productId ? { productId: s.productId } : {}),
  };
}

/** Why "Add" is disabled, in words; null when it can be pressed. */
function blocked(
  s: State,
  drug: Drug | undefined,
  rx: PlanRx | null,
  verdict: string | null,
): string | null {
  if (!drug) return "Choose a medicine.";
  if (!s.route) return "Choose the route.";
  if (s.mode === "fluid") {
    const f = s.fluid;
    if (!f.purpose) return "Choose what the fluid is for.";
    if (!f.volumeMl) return "Choose the volume.";
    if (!f.overMinutes) return "Choose how long it runs.";
    if (!f.delivery) return "Choose pump or gravity drip.";
    if (f.delivery === "gravity" && !f.dropsPerMl)
      return "Choose the giving set: 20 or 60 drops per mL.";
  } else {
    if (s.doseNum == null) return "Type the dose.";
    if (!s.frequency) return "Choose how often.";
    if (intermittent(s.method) && (!s.infusionOver || !s.diluent))
      return "Choose how long the infusion runs and what it is diluted in.";
  }
  if (!rx) return "Complete the prescription.";
  return verdict;
}

function Chips<V extends string | number>({
  label,
  options,
  value,
  onPick,
  word = (v) => String(v),
}: {
  label: string;
  options: readonly V[];
  value: V | null;
  onPick: (v: V) => void;
  word?: (v: V) => string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <Toggle key={String(o)} on={value === o} onPress={() => onPick(o)}>
          {word(o)}
        </Toggle>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** A labelled native select (the prototype's "How to give it" grid). */
function SelectField<V extends string>({
  label,
  value,
  options,
  onPick,
  empty = true,
}: {
  label: string;
  value: V | null;
  options: readonly { v: V; label: string }[];
  onPick: (v: V | null) => void;
  empty?: boolean;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-label text-muted-foreground">{label}</span>
      <select
        aria-label={label}
        value={value ?? ""}
        onChange={(e) => onPick((e.target.value || null) as V | null)}
        className={selectClass}
      >
        {empty ? (
          <option value="" disabled={value != null}>
            {C.choose}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The mode switch (kit F6), above column 1 in both modes. */
export function ModeSwitch({ modes }: { modes: PrescribeModes }) {
  return (
    <div
      role="group"
      aria-label="Prescribe a medicine or a protocol"
      className="bg-muted inline-flex gap-1 self-start rounded-full p-1"
    >
      {(["medicines", "protocols"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={modes.value === m}
          onClick={() => modes.onChange(m)}
          className={cn(
            "text-label min-h-8 rounded-full px-3.5 pointer-coarse:min-h-11",
            FOCUS,
            modes.value === m
              ? "bg-card text-teal-text shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {m === "medicines"
            ? C.medicines
            : modes.count != null
              ? `Protocols · ${modes.count}`
              : "Protocols"}
        </button>
      ))}
    </div>
  );
}

interface Fact {
  label: string;
  value: string;
  sub: string;
  tone?: "warn" | "unknown";
  /** The line under it shows always (otherwise only for a caution or an unknown). */
  showSub?: boolean;
}

/** The patient strip (kit F1): what the checks read, as the prototype's label · value chips. */
function factsOf(
  f: Facts,
  allergies: AllergyItems,
  kidneyTestOrdered: boolean,
  time: (iso: string) => string,
  v2: boolean,
  home: string[] | null,
): Fact[] {
  const out: Fact[] = [];
  if (allergies.status === "listed" && allergies.items.length)
    out.push({
      label: C.allergy,
      value: allergies.items.map((i) => i.name).join(", "),
      sub: allergies.items
        .map((i) => (i.reactions.length ? i.reactions.join(", ") : C.reactionUnknown))
        .join("; ")
        .concat(allergies.items.some((i) => !i.coded) ? ` · ${C.notCoded}` : ""),
      tone: "warn",
    });
  else if (allergies.status === "no_known_drug_allergies")
    out.push({ label: C.allergy, value: C.allergyNone, sub: C.recorded });
  else
    out.push({
      label: C.allergy,
      value: allergies.status === "unable_to_assess" ? C.allergyUnable : C.allergyNotAsked,
      sub: C.allergyAsk,
      tone: "unknown",
    });
  out.push(
    f.weight
      ? {
          label: C.weight,
          value: `${f.weight.kg} kg`,
          sub: `${f.weight.source}, ${time(f.weight.at)}`,
        }
      : { label: C.weight, value: C.notRecorded, sub: C.weightNeeded, tone: "unknown" },
  );
  const e = v2 ? egfrOf(f) : null;
  if (f.creatinine) {
    const cr = fill(C.creatinine, {
      value: f.creatinine.value,
      unit: f.creatinine.unit,
      date: time(f.creatinine.at),
    });
    out.push(
      e
        ? {
            label: C.kidney,
            value: `${fill(C.egfr, { value: e.value })} (${e.category})`,
            sub: cr,
            tone: e.value < 60 ? "warn" : undefined,
            showSub: true,
          }
        : { label: C.kidney, value: C.noEgfr, sub: cr, showSub: true },
    );
  } else
    out.push({
      label: C.kidney,
      value: kidneyTestOrdered ? C.creatinineOrdered : C.noEgfr,
      sub: kidneyTestOrdered ? C.waitingResult : C.noCreatinine,
      tone: "unknown",
    });
  if (v2 && f.sex === "female" && f.ageYears != null && f.ageYears >= 12 && f.ageYears <= 55) {
    const p = f.pregnancy;
    out.push(
      !p
        ? { label: C.pregnancy, value: C.notRecorded, sub: C.pregnancyAsk, tone: "unknown" }
        : p.state === "pregnant"
          ? {
              label: C.pregnancy,
              value: p.weeks != null ? fill(C.pregnantWeeks, { n: p.weeks }) : C.pregnant,
              sub: C.recorded,
              tone: "warn",
            }
          : {
              label: C.pregnancy,
              value: p.state === "postpartum" ? C.postpartum : C.notPregnant,
              sub: C.recorded,
            },
    );
  }
  if (home)
    out.push(
      home.length
        ? {
            label: C.taking,
            value: home.length === 1 ? C.takingOne : fill(C.takingN, { n: home.length }),
            sub: home.join(", "),
            showSub: true,
          }
        : { label: C.taking, value: C.takingNone, sub: C.takingNoneSub },
    );
  return out;
}

const FACT_TONE = {
  warn: "bg-status-caution-bg text-amber-800 dark:text-status-caution-fg",
  unknown: "border-border border border-dashed",
  none: "bg-muted text-foreground",
} as const;

function FactStrip({ facts }: { facts: Fact[] }) {
  return (
    <ul aria-label="What the checks read" className="flex flex-wrap gap-1.5">
      {facts.map((x) => (
        <li
          key={x.label}
          title={x.sub}
          className={cn(
            "inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 rounded-full px-3 py-1",
            FACT_TONE[x.tone ?? "none"],
          )}
        >
          <span
            className={cn(
              "text-caption tracking-[0.06em] uppercase",
              !x.tone && "text-muted-foreground",
            )}
          >
            {x.label}
          </span>
          <span className="text-body-s font-medium">{x.value}</span>
          {x.tone || x.showSub ? (
            <span className={cn("text-caption", !x.tone && "text-muted-foreground")}>{x.sub}</span>
          ) : (
            <span className="sr-only">{`, ${x.sub}`}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

interface Row {
  key: string;
  drug: Drug;
  via: "fluids" | "list";
}

export function PlanPrescribeDialog({
  env,
  allergies,
  target,
  onClose,
  onAdd,
  time,
  session,
}: {
  env: PrescribeEnv;
  allergies: AllergyItems;
  target: Target;
  onClose: () => void;
  onAdd: (rx: PlanBasketRx) => void;
  time: (iso: string) => string;
  session?: PrescribeSessionSlots;
}) {
  const f = env.facts;
  const [s, setS] = useState<State>(() => picked(initial(target), f));
  const [seen, setSeen] = useState(target);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [hi, setHi] = useState(-1);
  const [brandOpen, setBrandOpen] = useState(true);
  const [showPassed, setShowPassed] = useState(false);
  const [rep, setRep] = useState(NO_REPEATS);
  // A new target (the next order-set medicine, Edit, Prescribe again) starts the line afresh.
  if (seen !== target) {
    setSeen(target);
    setS(picked(initial(target), f));
    setBrandOpen(true);
    setRep(NO_REPEATS);
  }
  const ids = { what: useId(), how: useId(), check: useId(), list: useId(), group: useId() };
  const noteId = useId();
  const witnessId = useId();
  const typedId = useId();
  const otherId = useId();
  const fluidsFirst = !!target.fluids && !target.drugId;

  // Pharmacy Phase 1 (5.10): the stock line per medicine, asked once each; absent with the flag off.
  const stockAt = env.stockAnswer;
  const v2 = env.v2;
  const [lines, setLines] = useState<Record<string, StockLine>>({});
  const asked = s.drugId && stockAt && !lines[s.drugId] ? s.drugId : null;
  const surface = stockAt?.surface;
  const patientUserId = stockAt?.patientUserId;
  const encounterId = stockAt?.encounterId;
  useEffect(() => {
    if (!asked || !surface) return;
    let live = true;
    void stockLines({
      surface,
      patientUserId,
      encounterId,
      medicineIds: [asked],
      ...(v2 ? { place: v2.place } : {}),
    })
      .then(
        (r) => (r.ok ? (r.data?.lines ?? null) : null),
        () => null,
      )
      .then((got) => {
        // Law 10: no answer reads as the baseline ("not linked"); the server answers again on placing.
        if (live) setLines((x) => ({ ...x, ...(got ?? { [asked]: notLinkedLine }) }));
      });
    return () => {
      live = false;
    };
    // v2's place is fixed for the dialog's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, surface, patientUserId, encounterId]);

  // Kit F2: the brands here, with whether each is at the collect point; asked once per medicine.
  const [brands, setBrands] = useState<Record<string, BrandOption[]>>({});
  const brandAsked = v2 && s.drugId && !brands[s.drugId] ? s.drugId : null;
  useEffect(() => {
    if (!brandAsked || !v2) return;
    let live = true;
    void prescribeBrands({
      surface: v2.surface,
      patientUserId: v2.patientUserId,
      place: v2.place,
      medicineId: brandAsked,
    })
      .then(
        (r) => (r.ok ? (r.data?.brands ?? []) : []),
        () => [],
      )
      .then((got) => {
        if (!live) return;
        setBrands((x) => ({ ...x, [brandAsked]: got }));
        const star = readStar(brandAsked);
        if (star && got.some((b) => b.id === star))
          setS((x) => (x.drugId === brandAsked ? { ...x, productId: star } : x));
      });
    return () => {
      live = false;
    };
  }, [brandAsked, v2]);
  const [starred, setStarred] = useState<string | null>(null);

  const set = (patch: Partial<State>) => setS((x) => ({ ...x, ...patch }));
  const setFluid = (patch: Partial<FluidState>) =>
    setS((x) => ({ ...x, fluid: { ...x.fluid, ...patch } }));
  const drug = s.drugId ? drugById(s.drugId) : undefined;
  const fluidMode = s.mode === "fluid";
  const problem = env.cards.find((c) => c.versionId === s.conditionId) ?? target.problem ?? null;
  const weight = f.weight;
  const band = patientBand(f.ageYears);

  const resolution = useMemo(
    () => regimensFor(drug, f, fluidMode),
    // f is the env's, fixed for the dialog's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drug, f.ageYears, weight, fluidMode],
  );
  const chosen = resolution?.regimens.find((r) => r.regimen.id === s.regimenId) ?? null;

  const pickDrug = (d: Drug, via: "fluids" | "list") => {
    setS((x) => {
      const next = initial({ ...target, from: undefined, drugId: d.id }, via);
      return picked(
        {
          ...next,
          conditionId: x.conditionId,
          start: x.start,
          note: x.note,
          fluid: next.mode === "fluid" ? x.fluid : EMPTY_FLUID,
        },
        f,
      );
    });
    setBrandOpen(true);
    setRep(NO_REPEATS);
  };

  const applyRegimen = (id: string) => {
    const r = resolution?.regimens.find((x) => x.regimen.id === id);
    if (r) setS((x) => withRegimen(x, r));
  };

  const weightAt = chosen?.regimen.perKg && weight ? weight.at : null;
  const rx = toRx(s, drug, weightAt);

  const cultureInBasket = env.basketTests.includes("test.blood_culture");
  const ctx: PlanCheckContext = {
    ageYears: f.ageYears,
    weight,
    allergies: allergies.items.map((a) => ({ substance: a.name })),
    allergyStatus:
      allergies.status === "listed"
        ? "has_allergies"
        : allergies.status === "no_known_drug_allergies"
          ? "none_known"
          : "unknown",
    conditions: f.conditions,
    creatinine: f.creatinine,
    kidneyTestPlanned:
      env.kidneyTestOrdered ||
      env.basketTests.some((t) => t === "test.urea_electrolytes" || t === "test.creatinine"),
    glucose: f.glucose,
    sepsisTypeProblem: !!problem?.tests.some((t) => t.key === "test.blood_culture"),
    bloodCulture: env.bloodCulture === "none" && cultureInBasket ? "in_basket" : env.bloodCulture,
    others: [
      ...env.standing.map((r) => ({
        drugId: r.drugId,
        classId: drugById(r.drugId)?.class,
        display: r.drugName,
        source: "this_visit" as const,
      })),
      ...env.basket.map((r) => ({
        drugId: r.drugId,
        classId: drugById(r.drugId)?.class,
        display: r.drugName,
        source: "basket" as const,
      })),
    ],
    cosign: drug?.flags.controlled ? env.cosign.controlled : env.cosign.routine,
    stock: drug ? (lines[drug.id] ?? null) : null,
    interactions: env.interactions ?? null,
    v2: !!v2,
    sex: f.sex ?? null,
    pregnancy: f.pregnancy ?? null,
  };
  const stockLine = drug && stockAt ? (lines[drug.id] ?? null) : null;
  // D-PH1-22: "Pick something else" answers nothing; it goes back to choosing.
  const pickElse = () =>
    setS((x) => ({
      ...initial({ ...target, from: undefined, drugId: undefined }),
      conditionId: x.conditionId,
      start: x.start,
      note: x.note,
    }));
  const checks: PlanCheck[] = drug && rx ? planChecks(drug, rx, ctx) : [];
  const verdict = rx ? verifyAnswers(checks, rx) : null;
  const firing = checks
    .filter((c) => c.outcome === "stop" || c.outcome === "check" || c.outcome === "note")
    .sort((a, b) => LEVEL_ORDER[a.outcome]! - LEVEL_ORDER[b.outcome]!);
  const rest = checks.filter((c) => !firing.includes(c));
  const passed = rest.filter((c) => c.outcome === "passed");
  const toAnswer = needingAnswer(firing).filter((c) => !s.answers[c.code]).length;
  const edits = rx ? regimenEdits(rx, chosen) : [];
  // Kit F2: the supply from the chosen brand's own strength and pack; the server works it out again.
  const product = drug && s.productId ? brands[drug.id]?.find((b) => b.id === s.productId) : null;
  const supply =
    rx && rx.kind === "drug" && product
      ? supplyQuantity({
          doseNum: rx.doseNum,
          unit: rx.unit,
          frequency: rx.frequency,
          course: rx.course,
          prn: rx.prn,
          product,
        })
      : null;
  // Pharmacy Phase 4 (5.2): the Repeats step, only for a medicine the signed list allows; never a controlled drug.
  const repeats = env.repeats;
  const repBounds =
    repeats?.bounds && drug && !drug.flags.controlled && repeats.bounds.offered.includes(drug.id)
      ? repeats.bounds
      : null;
  const repRead = repBounds && repeats ? readRepeats(rep, repBounds, repeats.today) : null;
  const reason =
    blocked(s, drug, rx, verdict && !verdict.ok ? verdict.reason : null) ?? repRead?.error ?? null;
  const rate = rx?.fluid ? fluidRate(rx.fluid) : null;

  const add = () => {
    if (!rx || !drug || reason) return;
    const clientKey = newKey();
    onAdd({
      ...rx,
      clientKey,
      display: willRead(rx, drug),
      drugName: drug.generic,
      problemLogicalId: problem?.logicalId ?? null,
      repeats: repRead?.terms ?? null,
      ...(target.renewalId ? { renewalId: target.renewalId } : {}),
    });
  };

  /* ── 1 · What: the list (kit F2) ── */
  // The usual dose on a row comes only from a signed regimen that applies to this patient.
  const usual = useMemo(
    () =>
      new Map(
        DRUGS.map((d) => {
          const r = regimensFor(d, f, false)?.regimens.find((x) => x.applies && x.dose.num != null);
          return [
            d.id,
            r
              ? fill(C.usual, {
                  dose: `${r.dose.num} ${r.dose.unit} · ${FREQUENCY_WORD[r.regimen.freq].toLowerCase()}`,
                })
              : null,
          ] as const;
        }),
      ),
    // f is the env's, fixed for the dialog's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [f.ageYears, weight],
  );
  const q = query.trim();
  const matched = useMemo(() => (q ? searchDrugs(q, DRUGS.length) : DRUGS), [q]);
  const allGroups = useMemo(() => pharmacyGroups(matched), [matched]);
  const shownGroups = group ? allGroups.filter((g) => g.name === group) : allGroups;
  const inBasket = new Set(env.basket.map((b) => b.drugId));
  const placed = new Set(env.standing.map((b) => b.drugId));
  const sections: { title: string; sub: string; tint: boolean; rows: Row[] }[] = [];
  const fluidsSection =
    problem?.supportive.includes("fluids") || fluidsFirst
      ? {
          title: C.fluids,
          sub: C.fluidsSub,
          tint: true,
          rows: FLUID_DRUGS.flatMap((id) => {
            const d = drugById(id);
            return d ? [{ key: `fluid:${id}`, drug: d, via: "fluids" as const }] : [];
          }),
        }
      : null;
  if (!q && !group) {
    if (fluidsFirst && fluidsSection) sections.push(fluidsSection);
    const mapped = problem?.classes.flatMap((id) => drugsInClass(id)) ?? [];
    if (mapped.length)
      sections.push({
        title: C.suggested,
        sub: C.suggestedSub,
        tint: true,
        rows: [...new Map(mapped.map((d) => [d.id, d])).values()].map((d) => ({
          key: `sug:${d.id}`,
          drug: d,
          via: "list" as const,
        })),
      });
    if (!fluidsFirst && fluidsSection) sections.push(fluidsSection);
  }
  for (const g of shownGroups)
    sections.push({
      title: g.name,
      sub: String(g.drugs.length),
      tint: false,
      rows: g.drugs.map((d) => ({ key: `${g.name}:${d.id}`, drug: d, via: "list" as const })),
    });
  const flat = sections.flatMap((x) => x.rows);
  const rowId = (i: number) => `${ids.list}-row-${i}`;
  useEffect(() => {
    if (hi >= 0) document.getElementById(rowId(hi))?.scrollIntoView?.({ block: "nearest" });
    // rowId is stable for the dialog's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hi]);
  const pickRow = (r: Row) => {
    if (drug?.id === r.drug.id && (r.via === "fluids") === fluidMode) {
      setBrandOpen((x) => !x);
      return;
    }
    pickDrug(r.drug, r.via);
  };
  const emptyText = q
    ? group
      ? fill(C.noMatchIn, { q, group: group.toLowerCase() })
      : fill(C.noMatch, { q })
    : C.emptyGroup;

  const brandList = drug ? (brands[drug.id] ?? []) : [];
  const starOf = drug ? (starred ?? readStar(drug.id)) : null;
  const showBrands = !!v2 && !fluidMode;
  const brandName = brandList.find((b) => b.id === s.productId)?.name ?? C.anyBrand;
  const methods = drug && s.route ? (drug.methods[s.route] ?? []) : [];
  const overOptions = s.fluid.purpose === "bolus" ? OVER_BOLUS : OVER_INFUSION;
  const weightBased = !!resolution?.regimens.some((r) => r.regimen.perKg);
  const modes = session?.modes ?? null;
  const protocols = modes?.value === "protocols";
  const n = session?.footer.n ?? 0;
  const addWord = toAnswer ? fill(C.addAnswer, { n: toAnswer }) : C.add;
  const meta = [
    f.ageYears == null ? "Age not recorded" : `${f.ageYears} y${v2 && f.sex ? ` · ${f.sex}` : ""}`,
    band ? BAND_WORD[band] : null,
    session?.patient.mrn ?? null,
    !session && problem ? fill(C.forProblem, { problem: problem.display }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const name = session?.patient.name || C.title;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <EditorDialog
      open
      onOpenChange={(o) => !o && onClose()}
      width="xl"
      className="ease-expo-out duration-100"
    >
      <SheetHeader className="gap-3 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pr-10">
          <span
            aria-hidden
            className="bg-muted text-label text-foreground grid size-9 shrink-0 place-items-center rounded-full"
          >
            {initials}
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5">
            <SheetTitle className="text-heading-m font-sans">{name}</SheetTitle>
            <span className="text-body-s text-muted-foreground">{meta}</span>
          </div>
          {v2 ? (
            <span className="bg-muted text-body-s inline-flex max-w-full flex-wrap items-center gap-x-1.5 rounded-full px-3 py-1.5">
              <span className="text-muted-foreground">{C.from}</span>
              <span className="font-medium">{PLACE[v2.place].label}</span>
              <ArrowRightIcon
                aria-label="collected at"
                className="text-muted-foreground size-3.5"
              />
              <span className="font-medium">{v2.collect}</span>
            </span>
          ) : null}
        </div>
        <FactStrip
          facts={factsOf(f, allergies, env.kidneyTestOrdered, time, !!v2, session?.home ?? null)}
        />
        {v2?.place === "resus" ? (
          <p className="text-caption text-muted-foreground">{C.resusNote}</p>
        ) : null}
      </SheetHeader>
      <SheetBody
        className="px-4 py-4 sm:px-6"
        onKeyDown={(e) => {
          // Kit F2: Ctrl+Enter adds the line.
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !protocols) {
            e.preventDefault();
            add();
          }
        }}
      >
        {protocols ? (
          session?.protocols
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)]">
            {/* ── 1 · What ── */}
            <section aria-labelledby={ids.what} className="flex min-w-0 flex-col gap-3">
              {modes ? <ModeSwitch modes={modes} /> : null}
              <h3 id={ids.what} className={OVER}>
                {C.whatHead}
              </h3>
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <SearchIcon
                    aria-hidden
                    className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
                  />
                  <input
                    value={query}
                    placeholder={C.search}
                    aria-label={C.searchLabel}
                    aria-controls={ids.list}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setHi(-1);
                    }}
                    onKeyDown={(e) => {
                      // Kit F2: arrow keys move through the list, Enter picks.
                      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        const k = flat.length;
                        if (k)
                          setHi((h) => (e.key === "ArrowDown" ? (h + 1) % k : (h - 1 + k) % k));
                      } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && flat.length) {
                        e.preventDefault();
                        pickRow(flat[Math.max(hi, 0)]!);
                      }
                    }}
                    className={cn(inputClass, "min-h-10 pl-9", query && "pr-16")}
                  />
                  {query ? (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setHi(-1);
                      }}
                      aria-label="Clear the search"
                      className={cn(
                        "bg-muted text-caption text-muted-foreground absolute top-1/2 right-1.5 -translate-y-1/2 rounded-full px-2.5 py-1",
                        FOCUS,
                      )}
                    >
                      {C.clear}
                    </button>
                  ) : null}
                </div>
                <label htmlFor={ids.group} className="sr-only">
                  {C.group}
                </label>
                <select
                  id={ids.group}
                  value={group}
                  onChange={(e) => {
                    setGroup(e.target.value);
                    setHi(-1);
                  }}
                  className={cn(inputClass, "min-h-10 w-auto max-w-[45%] font-medium")}
                >
                  <option value="">
                    {fill(C.groupN, { name: C.allGroups, n: matched.length })}
                  </option>
                  {allGroups.map((g) => (
                    <option key={g.name} value={g.name}>
                      {fill(C.groupN, { name: g.name, n: g.drugs.length })}
                    </option>
                  ))}
                </select>
              </div>
              {session?.sets.length ? (
                <div role="group" aria-label={C.sets} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-label text-muted-foreground">{C.sets}</span>
                    <DraftLabel>{C.setsDraft}</DraftLabel>
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                    {session.sets.map((x) => (
                      <button
                        key={x.id}
                        type="button"
                        title={x.title}
                        onClick={x.onPick}
                        className={cn(
                          "border-border bg-card text-label text-teal-text hover:bg-teal-tint min-h-9 shrink-0 rounded-full border px-3 pointer-coarse:min-h-11",
                          FOCUS,
                        )}
                      >
                        {x.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {session?.notice ? (
                <p role="status" className="bg-teal-tint text-body-s rounded-lg px-3 py-2">
                  {session.notice}
                </p>
              ) : null}
              <div
                id={ids.list}
                role="group"
                aria-label={C.medicines}
                className="border-border bg-card max-h-[470px] overflow-y-auto rounded-xl border"
              >
                {!flat.length ? (
                  <div className="flex flex-col items-start gap-1.5 p-4">
                    <span className="text-body-s font-medium">{emptyText}</span>
                    <span className="text-caption text-muted-foreground">{C.emptyHint}</span>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setQuery("");
                        setGroup("");
                      }}
                    >
                      {C.showAll}
                    </Button>
                  </div>
                ) : null}
                {sections.map((sec, si) => (
                  <div key={sec.title} role="group" aria-label={sec.title}>
                    <div
                      className={cn(
                        "text-caption sticky top-0 z-[1] flex items-baseline justify-between gap-2 px-3.5 py-2 font-medium tracking-[0.06em] uppercase",
                        si > 0 && "border-border border-t",
                        sec.tint ? "bg-teal-tint text-teal-text" : "bg-muted text-muted-foreground",
                      )}
                    >
                      <span>{sec.title}</span>
                      <span className="font-normal tracking-normal normal-case">{sec.sub}</span>
                    </div>
                    {sec.rows.map((r) => {
                      const i = flat.indexOf(r);
                      const d = r.drug;
                      const on = drug?.id === d.id && (r.via === "fluids") === fluidMode;
                      const usualDose = r.via === "list" ? (usual.get(d.id) ?? null) : null;
                      const tag = inBasket.has(d.id)
                        ? C.inPrescription
                        : placed.has(d.id)
                          ? C.alreadyPrescribed
                          : null;
                      return (
                        <div
                          key={r.key}
                          className={cn("border-border border-t", on && "bg-teal-tint")}
                        >
                          <button
                            id={rowId(i)}
                            type="button"
                            aria-pressed={on}
                            aria-expanded={on && showBrands ? brandOpen : undefined}
                            onClick={() => {
                              setHi(i);
                              pickRow(r);
                            }}
                            className={cn(
                              "flex min-h-14 w-full items-center gap-3 px-3.5 py-2.5 text-left outline-none",
                              "focus-visible:shadow-focus",
                              !on && "hover:bg-muted",
                              i === hi && "shadow-focus",
                            )}
                          >
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="text-body-m text-foreground font-medium">
                                {d.generic}
                              </span>
                              {usualDose ? (
                                <span className="text-body-s text-foreground flex min-w-0 items-center gap-1.5">
                                  <span className="bg-muted text-caption text-muted-foreground shrink-0 rounded-[3px] px-1.5 font-medium uppercase">
                                    {d.routes.map((x) => ROUTE_WORD[x] ?? x).join(" / ")}
                                  </span>
                                  <span className="truncate">{usualDose}</span>
                                </span>
                              ) : null}
                              <span className="text-caption text-muted-foreground truncate">
                                {[
                                  classById(d.class)?.name ?? d.class,
                                  d.flags.controlled ? C.controlled : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                              {tag ? <Tag className="self-start">{tag}</Tag> : null}
                            </span>
                            {on && showBrands ? <Chevron open={brandOpen} /> : null}
                          </button>
                          {on && showBrands ? (
                            brandOpen ? (
                              <div
                                role="radiogroup"
                                aria-label={C.brand}
                                className="flex flex-col gap-1.5 px-3.5 pb-3"
                              >
                                <span className="text-label text-muted-foreground">
                                  {`${C.brand} `}
                                  <span className="text-caption">
                                    {brandList.length === 1
                                      ? C.brandOne
                                      : brandList.length
                                        ? fill(C.brandsHere, { n: brandList.length })
                                        : C.brandsNone}
                                  </span>
                                </span>
                                <BrandButton
                                  on={!s.productId}
                                  name={C.anyBrand}
                                  sub={C.anyBrandSub}
                                  onPick={() => {
                                    set({ productId: null });
                                    setBrandOpen(false);
                                  }}
                                />
                                {brandList.map((b) => (
                                  <div key={b.id} className="flex items-center gap-1.5">
                                    <BrandButton
                                      on={s.productId === b.id}
                                      name={b.name}
                                      sub={[b.strength, b.manufacturer].filter(Boolean).join(" · ")}
                                      stock={
                                        b.inStock == null || !v2
                                          ? null
                                          : fill(b.inStock ? C.inStock : C.outOfStock, {
                                              collect: v2.collect,
                                            })
                                      }
                                      onPick={() => {
                                        set({ productId: b.id });
                                        setBrandOpen(false);
                                      }}
                                    />
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      aria-label={C.star}
                                      aria-pressed={starOf === b.id}
                                      className="pointer-coarse:size-11"
                                      onClick={() => {
                                        try {
                                          window.localStorage.setItem(STAR_KEY(d.id), b.id);
                                        } catch {
                                          // A per-viewer convenience: nothing is lost without storage.
                                        }
                                        setStarred(b.id);
                                      }}
                                    >
                                      <StarIcon
                                        aria-hidden
                                        className={cn(starOf === b.id && "fill-current")}
                                      />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-body-s flex items-center justify-between gap-2 px-3.5 pb-2.5">
                                <span className="text-muted-foreground">
                                  {fill(C.brandIs, { name: brandName })}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setBrandOpen(true)}
                                >
                                  {C.change}
                                </Button>
                              </div>
                            )
                          ) : null}
                          {on && stockAt ? (
                            <p
                              className="text-caption text-muted-foreground px-3.5 pb-3"
                              aria-live="polite"
                            >
                              {stockLine ? stockLineWords(stockLine) : C.stockAsking}
                              <span className="block">{STOCK_LINE_COPY.footer}</span>
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <span className="text-caption text-muted-foreground">
                {v2 ? fill(C.listFoot, { collect: v2.collect }) : C.listFootPlan}
              </span>
            </section>

            {/* ── 2 · How ── */}
            <section aria-labelledby={ids.how} className="flex min-w-0 flex-col gap-4">
              <h3 id={ids.how} className={OVER}>
                {C.howHead}
              </h3>
              {!drug ? (
                <p className="border-border bg-muted/40 text-body-s text-muted-foreground rounded-xl border border-dashed px-3.5 py-3">
                  {fluidsFirst ? C.pickFluid : modes ? C.pickFirst : C.pickFirstMeds}
                </p>
              ) : (
                <>
                  <div className="flex flex-col gap-1">
                    <h4 className="text-heading-m text-foreground">{drug.generic}</h4>
                    <div className="flex flex-wrap items-center gap-2">
                      <Tag>{REFERENCE_TAG_WORD[referenceTag(drug.dose)]}</Tag>
                      <span className="text-caption text-muted-foreground">
                        {drug.presentationsDraft.join(", ")}
                      </span>
                    </div>
                  </div>

                  {weightBased ? (
                    <div
                      className={cn(
                        "flex flex-col gap-0.5 rounded-xl px-3.5 py-3",
                        weight
                          ? "border-border border"
                          : "bg-status-caution-bg dark:text-status-caution-fg text-amber-800",
                      )}
                    >
                      <span className={cn("text-label", weight && "text-muted-foreground")}>
                        {C.weightUsed}
                      </span>
                      <span className="text-body-m font-medium">
                        {weight ? `${weight.kg} kg` : C.weightNone}
                      </span>
                      <span className={cn("text-caption", weight && "text-muted-foreground")}>
                        {weight
                          ? fill(C.weightFrom, { source: weight.source, date: time(weight.at) })
                          : C.weightNeed}
                      </span>
                    </div>
                  ) : null}

                  <Field label={C.regimen}>
                    {resolution && resolution.regimens.length ? (
                      <div role="radiogroup" aria-label="Regimen" className="flex flex-col gap-1.5">
                        {resolution.regimens.map((r) => (
                          <button
                            key={r.regimen.id}
                            type="button"
                            role="radio"
                            aria-checked={s.regimenId === r.regimen.id}
                            onClick={() => applyRegimen(r.regimen.id)}
                            className={cn(
                              "text-body-s flex flex-col items-start gap-0.5 rounded-xl border px-3.5 py-2.5 text-left",
                              FOCUS,
                              s.regimenId === r.regimen.id
                                ? "bg-teal-tint border-teal-600"
                                : "border-border bg-card hover:bg-muted",
                            )}
                          >
                            <span className="text-foreground font-medium">
                              {r.regimen.label}
                              {r.applies ? (
                                <span className="text-muted-foreground font-normal">
                                  {` · ${C.regimenThis}`}
                                </span>
                              ) : null}
                            </span>
                            <span className="text-muted-foreground">
                              {r.working ??
                                r.unresolved ??
                                (r.dose.num != null
                                  ? `${r.dose.num} ${r.dose.unit}${r.regimen.strength ? ` of ${r.regimen.strength}` : ""}`
                                  : `${r.dose.low}–${r.dose.high} ${r.dose.unit}`)}
                              {` · ${ROUTE_WORD[r.regimen.route]}${r.regimen.admin ? ` ${r.regimen.admin}` : ""} · ${FREQUENCY_WORD[r.regimen.freq]}`}
                            </span>
                            {r.regimen.then ? (
                              <span className="text-caption text-muted-foreground">
                                {r.regimen.then}
                              </span>
                            ) : null}
                          </button>
                        ))}
                        {resolution.note ? (
                          <p className="text-caption text-muted-foreground">{resolution.note}</p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="border-border text-body-s text-muted-foreground rounded-xl border border-dashed px-3.5 py-2.5">
                        {resolution?.note ?? "No verified regimen yet: type the dose."}
                      </p>
                    )}
                  </Field>

                  {fluidMode ? (
                    <>
                      <Field label={C.purpose}>
                        <Seg
                          label={C.purpose}
                          options={PURPOSES.map((p) => ({ id: p, label: PURPOSE_WORD[p] }))}
                          value={s.fluid.purpose}
                          onPick={(purpose) => setFluid({ purpose, overMinutes: null })}
                        />
                      </Field>
                      <Field label={C.volume}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Chips
                            label={C.volume}
                            options={VOLUMES}
                            value={
                              (VOLUMES as readonly number[]).includes(s.fluid.volumeMl ?? -1)
                                ? (s.fluid.volumeMl as 250)
                                : null
                            }
                            onPick={(volumeMl) => setFluid({ volumeMl })}
                            word={(v) => `${v} mL`}
                          />
                          <label htmlFor={otherId} className="sr-only">
                            Other volume in mL
                          </label>
                          <input
                            id={otherId}
                            inputMode="decimal"
                            placeholder={C.otherVolume}
                            value={
                              s.fluid.volumeMl != null &&
                              !(VOLUMES as readonly number[]).includes(s.fluid.volumeMl)
                                ? String(s.fluid.volumeMl)
                                : ""
                            }
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setFluid({ volumeMl: e.target.value && v > 0 ? v : null });
                            }}
                            className={cn(inputClass, "w-28")}
                          />
                        </div>
                      </Field>
                      <Field label={C.over}>
                        <Chips
                          label={C.over}
                          options={overOptions}
                          value={
                            (overOptions as readonly number[]).includes(s.fluid.overMinutes ?? -1)
                              ? (s.fluid.overMinutes as number)
                              : null
                          }
                          onPick={(overMinutes) => setFluid({ overMinutes })}
                          word={durationWords}
                        />
                      </Field>
                      <Field label={C.method}>
                        <Seg
                          label={C.method}
                          options={[
                            { id: "pump" as const, label: "Infusion pump" },
                            { id: "gravity" as const, label: "Gravity drip" },
                          ]}
                          value={s.fluid.delivery}
                          onPick={(delivery) =>
                            setFluid({
                              delivery,
                              dropsPerMl: delivery === "pump" ? null : s.fluid.dropsPerMl,
                            })
                          }
                        />
                        {s.fluid.delivery === "gravity" ? (
                          <Seg
                            label={C.givingSet}
                            options={[
                              { id: "20" as const, label: "20 drops/mL" },
                              { id: "60" as const, label: "60 drops/mL" },
                            ]}
                            value={
                              s.fluid.dropsPerMl
                                ? (String(s.fluid.dropsPerMl) as "20" | "60")
                                : null
                            }
                            onPick={(v) => setFluid({ dropsPerMl: v === "20" ? 20 : 60 })}
                          />
                        ) : null}
                      </Field>
                      <Field label={C.warmed}>
                        <Seg
                          label={C.warmed}
                          options={[
                            { id: "yes" as const, label: "Yes" },
                            { id: "no" as const, label: "No" },
                          ]}
                          value={s.fluid.warmed ? "yes" : "no"}
                          onPick={(w) => setFluid({ warmed: w === "yes" })}
                        />
                      </Field>
                      <Field label={C.start}>
                        <Seg
                          label={C.start}
                          options={[
                            { id: "now" as const, label: "Give now" },
                            { id: "next_round" as const, label: "Next drug round" },
                          ]}
                          value={s.start}
                          onPick={(start) => set({ start })}
                        />
                      </Field>
                    </>
                  ) : (
                    <div className="border-border flex flex-col gap-2 rounded-xl border px-3.5 py-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="flex min-w-0 flex-[1_1_120px] flex-col gap-1">
                          <span className="text-label text-muted-foreground">
                            {s.regimenId ? C.ownDose : C.yourDose}
                          </span>
                          <input
                            inputMode="decimal"
                            placeholder={C.amount}
                            aria-label="Dose"
                            value={s.doseNum ?? ""}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              set({
                                doseNum: e.target.value && Number.isFinite(v) && v > 0 ? v : null,
                              });
                            }}
                            className={cn(selectClass, "font-mono tabular-nums")}
                          />
                        </label>
                        <div className="flex-[0_1_150px]">
                          <SelectField
                            label={C.unit}
                            value={s.unit}
                            empty={false}
                            options={DOSE_UNITS.map((u) => ({ v: u, label: u }))}
                            onPick={(unit) => unit && set({ unit })}
                          />
                        </div>
                      </div>
                      {resolution?.regimens.length ? (
                        <span className="text-caption text-muted-foreground">
                          {fill(C.standard, {
                            list: [
                              ...new Set(
                                resolution.regimens.map(
                                  (r) =>
                                    `${r.working ?? r.regimen.label} ${FREQUENCY_WORD[r.regimen.freq].toLowerCase()}`,
                                ),
                              ),
                            ].join(" · "),
                          })}
                        </span>
                      ) : null}
                    </div>
                  )}

                  <div className="bg-teal-tint flex flex-col gap-1 rounded-xl px-3.5 py-3">
                    <span className="text-label text-muted-foreground">{C.dose}</span>
                    <span className="text-body-m text-foreground font-medium" aria-live="polite">
                      {rx && drug && (fluidMode || s.doseNum != null)
                        ? willRead(rx, drug)
                        : C.doseEmpty}
                    </span>
                    {rate && rate.mlPerHour != null ? (
                      <span className="text-body-s text-foreground font-mono tabular-nums">
                        {`${rate.mlPerHour} mL/h`}
                        {rate.dropsPerMinute != null ? ` · ${rate.dropsPerMinute} drops/min` : ""}
                        <span className="text-caption text-muted-foreground font-sans">
                          {` · ${C.arithmetic}`}
                        </span>
                      </span>
                    ) : null}
                    {chosen?.regimen.then ? (
                      <span className="text-caption text-muted-foreground">
                        {chosen.regimen.then}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-label text-muted-foreground">{C.howToGive}</span>
                      {edits.length && s.regimenId ? (
                        <span className="text-caption text-muted-foreground inline-flex items-center gap-1.5">
                          <Tag>{C.changedFromRegimen}</Tag>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => applyRegimen(s.regimenId!)}
                          >
                            {C.useRegimen}
                          </Button>
                        </span>
                      ) : null}
                    </div>
                    {edits.map((e) => (
                      <p key={e.field} className="text-caption text-muted-foreground">
                        {`${EDIT_FIELD_WORD[e.field]}: `}
                        <s>{e.from}</s>
                        {` → ${e.to}`}
                        <span className="sr-only">{`, changed from ${e.from}`}</span>
                      </p>
                    ))}
                    {fluidMode ? null : (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <SelectField
                          label={C.route}
                          value={s.route}
                          options={drug.routes.map((r) => ({ v: r, label: ROUTE_WORD[r] ?? r }))}
                          onPick={(route) =>
                            set({ route, method: null, infusionOver: null, diluent: null })
                          }
                        />
                        <SelectField
                          label={C.howOften}
                          value={s.frequency}
                          options={RX_FREQUENCIES.map((x) => ({
                            v: x,
                            label: `${FREQUENCY_WORD[x]}${chosen?.regimen.freq === x ? " (regimen)" : ""}`,
                          }))}
                          onPick={(frequency) => set({ frequency })}
                        />
                        <SelectField
                          label={C.forHowLong}
                          value={s.course}
                          options={RX_COURSES.map((x) => ({
                            v: x,
                            label: `${COURSE_WORD[x]}${chosen?.regimen.course === x ? " (regimen)" : ""}`,
                          }))}
                          onPick={(course) => set({ course })}
                        />
                        <SelectField
                          label={C.start}
                          value={s.start}
                          empty={false}
                          options={[
                            { v: "now" as const, label: C.startNow },
                            { v: "next_round" as const, label: C.startNext },
                          ]}
                          onPick={(start) => start && set({ start })}
                        />
                        {methods.length ? (
                          <SelectField
                            label={C.method}
                            value={s.method}
                            options={methods.map((m) => ({ v: m, label: m }))}
                            onPick={(method) =>
                              set({
                                method,
                                ...(intermittent(method)
                                  ? {}
                                  : { infusionOver: null, diluent: null }),
                              })
                            }
                          />
                        ) : null}
                        {intermittent(s.method) ? (
                          <>
                            <SelectField
                              label={C.infusionOver}
                              value={s.infusionOver}
                              options={INFUSION_OVER.map((x) => ({ v: x, label: x }))}
                              onPick={(infusionOver) => set({ infusionOver })}
                            />
                            <SelectField
                              label={C.dilutedIn}
                              value={s.diluent}
                              options={DILUENTS.map((x) => ({ v: x, label: x }))}
                              onPick={(diluent) => set({ diluent })}
                            />
                          </>
                        ) : null}
                        <label className="text-body-s flex min-h-9 items-center gap-2 sm:col-span-2">
                          <input
                            type="checkbox"
                            checked={s.prn}
                            onChange={(e) => set({ prn: e.target.checked })}
                            className="size-4 accent-teal-600"
                          />
                          {C.prn}
                        </label>
                      </div>
                    )}
                  </div>

                  {env.cards.length ? (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-label text-muted-foreground">{C.forWhich}</span>
                      <div
                        role="group"
                        aria-label={C.forWhich}
                        className="grid grid-cols-1 gap-1.5 sm:grid-cols-2"
                      >
                        {env.cards.map((c, i) => (
                          <button
                            key={c.versionId}
                            type="button"
                            aria-pressed={s.conditionId === c.versionId}
                            onClick={() => set({ conditionId: c.versionId })}
                            className={cn(
                              "text-body-s flex min-h-11 flex-col items-start rounded-lg border px-3 py-1.5 text-left",
                              FOCUS,
                              s.conditionId === c.versionId
                                ? "bg-teal-tint border-teal-600"
                                : "border-border bg-card hover:bg-muted",
                            )}
                          >
                            <span className="font-medium">{c.display}</span>
                            <span className="text-caption text-muted-foreground">
                              {fill(C.problemN, { n: i + 1 })}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-1">
                    <label htmlFor={noteId} className="text-label text-muted-foreground">
                      {C.note}
                    </label>
                    <input
                      id={noteId}
                      value={s.note}
                      maxLength={500}
                      onChange={(e) => set({ note: e.target.value })}
                      className={selectClass}
                    />
                  </div>

                  {v2 && !fluidMode ? (
                    <div className="bg-muted flex flex-col gap-1 rounded-xl px-3.5 py-3">
                      <span className="text-label text-muted-foreground">{C.toSupply}</span>
                      <span className="text-body-m font-medium">
                        {supply?.text ?? (s.doseNum != null ? C.quantityUnknown : C.supplyLater)}
                      </span>
                    </div>
                  ) : null}
                  {repBounds && repeats ? (
                    <RepeatsField
                      bounds={repBounds}
                      today={repeats.today}
                      value={rep}
                      onChange={setRep}
                    />
                  ) : null}
                </>
              )}
            </section>

            {/* ── 3 · Check ── */}
            <section aria-labelledby={ids.check} className="flex min-w-0 flex-col gap-3">
              <h3 id={ids.check} className={OVER}>
                {C.checkHead}
              </h3>
              {!drug ? (
                <p className="border-border bg-muted/40 text-body-s text-muted-foreground rounded-xl border border-dashed px-3.5 py-3">
                  {modes ? C.checksHere : C.checksHereMeds}
                </p>
              ) : rx ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Tag>
                    {toAnswer
                      ? fill(C.toAnswer, { n: toAnswer })
                      : firing.length
                        ? needingAnswer(firing).length
                          ? C.answered
                          : firing.length === 1
                            ? C.noteOne
                            : fill(C.notes, { n: firing.length })
                        : C.allClear}
                  </Tag>
                  <span className="text-caption text-muted-foreground">
                    {toAnswer ? C.toAnswerText : firing.length ? C.readThem : C.allClearText}
                  </span>
                </div>
              ) : null}
              {firing.length ? (
                <ul className="flex flex-col gap-2">
                  {firing.map((c) => (
                    <CheckItem
                      key={c.code}
                      c={c}
                      answer={s.answers[c.code]}
                      onAnswer={(a) =>
                        setS((x) => {
                          const answers = { ...x.answers };
                          if (a) answers[c.code] = a;
                          else delete answers[c.code];
                          return { ...x, answers };
                        })
                      }
                      needsAnswer={needingAnswer([c]).length > 0}
                      onPickElse={c.code === "stock" ? pickElse : undefined}
                    />
                  ))}
                </ul>
              ) : null}
              {rest.length ? (
                <div className="border-border overflow-hidden rounded-xl border">
                  <button
                    type="button"
                    aria-expanded={showPassed}
                    onClick={() => setShowPassed((x) => !x)}
                    className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left", FOCUS)}
                  >
                    <span className="bg-teal-tint text-teal-text grid size-[22px] shrink-0 place-items-center rounded-full">
                      <CheckIcon aria-hidden className="size-3.5" />
                    </span>
                    <span className="text-body-s min-w-0 flex-1">
                      <span className="font-medium">{fill(C.passed, { n: passed.length })}</span>
                      <span className="text-muted-foreground">
                        {passed.length ? ` · ${passed.map((c) => c.title).join(", ")}` : ""}
                      </span>
                    </span>
                    <Chevron open={showPassed} />
                  </button>
                  {showPassed ? (
                    <ul>
                      {rest.map((c) => (
                        <li
                          key={c.code}
                          className="border-border flex flex-col gap-0.5 border-t py-2 pr-3 pl-11"
                        >
                          <span className="text-body-s text-foreground font-medium">
                            {`${c.title} · ${OUTCOME_WORD[c.outcome]}`}
                            {c.proposed ? (
                              <span className="text-muted-foreground font-normal">
                                {" · proposed"}
                              </span>
                            ) : null}
                          </span>
                          <span className="text-caption text-muted-foreground">{c.message}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {drug?.flags.controlled ? (
                <div className="flex flex-col gap-1">
                  <label htmlFor={witnessId} className="text-label text-muted-foreground">
                    {C.witness}
                  </label>
                  <input
                    id={witnessId}
                    value={s.witness}
                    maxLength={120}
                    onChange={(e) => set({ witness: e.target.value })}
                    className={selectClass}
                  />
                </div>
              ) : null}
              {checks.some((c) => c.egregious) ? (
                <div className="flex flex-col gap-1">
                  <label htmlFor={typedId} className="text-label text-muted-foreground">
                    {C.typedDose}
                  </label>
                  <input
                    id={typedId}
                    inputMode="decimal"
                    value={s.typedDose}
                    onChange={(e) => set({ typedDose: e.target.value })}
                    className={cn(selectClass, "font-mono")}
                  />
                </div>
              ) : null}
              {drug ? (
                <>
                  <p className="text-caption text-muted-foreground">{C.decisionSupport}</p>
                  {reason ? (
                    <p className="text-body-s text-foreground" aria-live="polite">
                      {reason}
                    </p>
                  ) : null}
                </>
              ) : null}
              {session?.lists}
            </section>
          </div>
        )}
      </SheetBody>
      <SheetFooter className="flex-row flex-wrap items-center gap-3 px-4 sm:px-6">
        {session ? (
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-label text-foreground">
              {`${C.thisPrescription} · ${n === 1 ? C.lineOne : fill(C.lines, { n })}`}
            </span>
            <span className="text-caption text-muted-foreground truncate">
              {session.footer.summary || C.nothingAdded}
            </span>
          </div>
        ) : (
          <span className="flex-1" />
        )}
        {protocols ? null : (
          <>
            <span className="text-caption text-muted-foreground hidden lg:inline">{C.keys}</span>
            <Button
              variant={session ? "soft" : "primary"}
              disabled={!!reason}
              onClick={add}
              className="pointer-coarse:min-h-11"
            >
              {addWord}
            </Button>
          </>
        )}
        {session ? (
          <Button
            disabled={!n}
            onClick={session.footer.onReview}
            className="pointer-coarse:min-h-11"
          >
            {C.reviewSend}
          </Button>
        ) : null}
      </SheetFooter>
      <SheetClose
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close"
            className="absolute top-3 right-3 rounded-full"
          />
        }
      >
        <XIcon className="size-4" />
      </SheetClose>
    </EditorDialog>
  );
}

function BrandButton({
  on,
  name,
  sub,
  stock = null,
  onPick,
}: {
  on: boolean;
  name: string;
  sub: string;
  stock?: string | null;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className={cn(
        "bg-card flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2.5 rounded-lg border px-3 py-1.5 text-left",
        FOCUS,
        on ? "border-teal-600" : "border-border hover:bg-muted",
      )}
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-body-s font-medium">{name}</span>
        {sub ? <span className="text-caption text-muted-foreground">{sub}</span> : null}
      </span>
      {stock ? <Tag>{stock}</Tag> : null}
    </button>
  );
}

function CheckItem({
  c,
  answer,
  onAnswer,
  needsAnswer,
  onPickElse,
}: {
  c: PlanCheck;
  answer: { answer: AnswerId; text?: string } | undefined;
  onAnswer: (a: { answer: AnswerId; text?: string } | null) => void;
  needsAnswer: boolean;
  /** A stock Check's second choice (D-PH1-22). */
  onPickElse?: () => void;
}) {
  const tid = useId();
  const chips =
    c.code === "stock" ? STOCK_REASONS : c.outcome === "stop" ? OVERRIDE_REASONS : CHECK_REASONS;
  const word = OUTCOME_WORD[c.outcome];
  // Kit F3: an answered check folds to one line, with Change to answer again.
  if (needsAnswer && answer && answer.answer !== "other")
    return (
      <li className="border-border flex items-center gap-2.5 rounded-xl border px-3 py-2">
        <span className="bg-teal-tint text-teal-text grid size-[22px] shrink-0 place-items-center rounded-full">
          <CheckIcon aria-hidden className="size-3.5" />
        </span>
        <span className="text-body-s min-w-0 flex-1">
          <span className="font-medium">{c.title}</span>
          <span className="text-muted-foreground">
            {` · ${(chips as Record<string, string>)[answer.answer] ?? answer.answer}`}
          </span>
        </span>
        <Button variant="ghost" size="sm" onClick={() => onAnswer(null)}>
          {C.change}
        </Button>
      </li>
    );
  return (
    <li className="bg-muted/60 flex flex-col gap-2 rounded-xl px-3.5 py-3">
      <span className="text-body-s flex flex-wrap items-center gap-2">
        {c.outcome === "note" ? <Tag>{word}</Tag> : <Caution>{word}</Caution>}
        <span className="text-foreground font-medium">{c.title}</span>
        {c.proposed ? <span className="text-caption text-muted-foreground">proposed</span> : null}
      </span>
      <span className="text-body-s text-muted-foreground">{c.message}</span>
      {needsAnswer ? (
        <>
          <div
            role="group"
            aria-label={`${c.outcome === "stop" ? "Override reason" : "Answer"}: ${c.title}`}
            className="flex flex-wrap gap-1.5"
          >
            {(Object.entries(chips) as [AnswerId, string][]).map(([id, label]) => (
              <Toggle
                key={id}
                on={answer?.answer === id}
                onPress={() => onAnswer({ answer: id, text: answer?.text })}
              >
                {label}
              </Toggle>
            ))}
            {onPickElse ? (
              <Button size="sm" variant="ghost" onClick={onPickElse}>
                {STOCK_LINE_COPY.pickElse}
              </Button>
            ) : null}
          </div>
          {answer?.answer === "other" ? (
            <>
              <label htmlFor={tid} className="sr-only">{`Your reason: ${c.title}`}</label>
              <input
                id={tid}
                value={answer.text ?? ""}
                maxLength={500}
                onChange={(e) => onAnswer({ answer: "other", text: e.target.value })}
                className={inputClass}
              />
            </>
          ) : null}
          <span className="text-caption text-muted-foreground italic">{C.draftAnswers}</span>
        </>
      ) : null}
    </li>
  );
}
