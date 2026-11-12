"use client";

import type { AllergyItems } from "./medicines";
import type { PlanView } from "./model";
import type { PrescribeTarget } from "./problem-card";
import type { PlanBasketRx } from "@/lib/clerking/plan/draft";
import type { PlanPayload } from "@/lib/clerking/plan/payload";
import type { ProblemCard } from "@/lib/clerking/plan/problems";
import type { BrandOption } from "@/lib/emr/read/prescribe";
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
import { useEffect, useId, useMemo, useState } from "react";
import { LayoutGridIcon, SearchIcon, StarIcon } from "lucide-react";

import { EmrDialog } from "@/components/emr/emr-dialog";
import { Button } from "@/components/ui/button";
import { PRESCRIBE_COPY as C, fill } from "@/content/prescribing";
import { basketOf } from "@/lib/clerking/plan/draft";
import { standing } from "@/lib/clerking/plan/record";
import { stockLines } from "@/lib/emr/actions/pharmacy-stock";
import { prescribeBrands } from "@/lib/emr/actions/prescribe";
import {
  BAND_WORD,
  classById,
  drugById,
  drugsInClass,
  formularyBrowse,
  isFluid,
  offersRegimens,
  patientBand,
  REFERENCE_TAG_WORD,
  referenceTag,
  resolveRegimens,
  searchDrugs,
} from "@/lib/prescribing/formulary";
import { STOCK_LINE_COPY, stockLineWords } from "@/lib/prescribing/pharmacy";
import { PLACE } from "@/lib/prescribing/places";
import {
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
  DOSE_BANDS,
  DOSE_UNITS,
  RX_COURSES,
  RX_FREQUENCIES,
} from "@/lib/prescribing/reference/formulary-types";
import { supplyQuantity } from "@/lib/prescribing/supply";
import { cn } from "@/lib/utils";
import { FactChips } from "./medicines";
import { MedicinesBrowseDialog } from "./medicines-browse-dialog";
import { Caution, DraftLabel, FOCUS, inputClass, Seg, Tag, Toggle } from "./parts";
import { NO_REPEATS, readRepeats, RepeatsField } from "./repeats";

/**
 * The prescribing dialog (ADR 0186): a centred landscape dialog in three columns, what, how and
 * check. A dose arrives pre-set only from a signed, verified regimen; otherwise the prescriber
 * types the number and taps the rest. Every change from a regimen is shown struck through and
 * recorded. The checks run live here and again on the server when the basket is placed.
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

/** Why "Add to basket" is disabled, in words; null when it can be pressed. */
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function PlanPrescribeDialog({
  env,
  allergies,
  target,
  onClose,
  onAdd,
  time,
}: {
  env: PrescribeEnv;
  allergies: AllergyItems;
  target: Target;
  onClose: () => void;
  onAdd: (rx: PlanBasketRx) => void;
  time: (iso: string) => string;
}) {
  const [s, setS] = useState<State>(() => initial(target));
  const [query, setQuery] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [byAge, setByAge] = useState(false);
  const [more, setMore] = useState(false);
  const [rep, setRep] = useState(NO_REPEATS);
  const [group, setGroup] = useState<string | null>(null);
  const [hi, setHi] = useState(-1);
  const groups = useMemo(() => (env.v2 ? formularyBrowse() : []), [env.v2]);
  const searchId = useId();
  const doseId = useId();
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
  const f = env.facts;
  const weight = f.weight;
  const band = patientBand(f.ageYears);

  const resolution = useMemo(() => {
    if (!drug) return null;
    const r = resolveRegimens(drug, { ageYears: f.ageYears, weight });
    // Fluid regimens (a bolus) in fluid mode; drug regimens (hypoglycaemia) in drug mode.
    const regimens = r.regimens.filter((x) => !!x.regimen.fluidPurpose === fluidMode);
    return regimens.length || !r.regimens.length
      ? { ...r, regimens }
      : { ...r, regimens, note: "No verified regimen for this use yet: choose the values." };
  }, [drug, f.ageYears, weight, fluidMode]);
  const chosen = resolution?.regimens.find((r) => r.regimen.id === s.regimenId) ?? null;

  const pickDrug = (d: Drug, via: "fluids" | "list") => {
    setS((x) => {
      const next = initial({ ...target, drugId: d.id }, via);
      return {
        ...next,
        conditionId: x.conditionId,
        start: x.start,
        note: x.note,
        fluid: next.mode === "fluid" ? x.fluid : EMPTY_FLUID,
      };
    });
  };

  const applyRegimen = (id: string) => {
    const r = resolution?.regimens.find((x) => x.regimen.id === id);
    if (!r || !drug) return;
    const g = r.regimen;
    if (fluidMode) {
      setS((x) => ({
        ...x,
        regimenId: g.id,
        route: "iv",
        fluid: {
          ...x.fluid,
          purpose: g.fluidPurpose ?? x.fluid.purpose,
          volumeMl: r.dose.num ?? x.fluid.volumeMl,
        },
      }));
      return;
    }
    set({
      regimenId: g.id,
      doseNum: r.dose.num,
      unit: g.unit,
      strength: g.strength ?? null,
      route: g.route,
      method: g.method ?? null,
      frequency: g.freq,
      course: g.course ?? null,
    });
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
      ...initial({ ...target, drugId: undefined }),
      conditionId: x.conditionId,
      start: x.start,
      note: x.note,
    }));
  const checks: PlanCheck[] = drug && rx ? planChecks(drug, rx, ctx) : [];
  const verdict = rx ? verifyAnswers(checks, rx) : null;
  const firing = checks.filter(
    (c) => c.outcome === "stop" || c.outcome === "check" || c.outcome === "note",
  );
  const rest = checks.filter((c) => !firing.includes(c));
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
  const stop = checks.some((c) => c.outcome === "stop" && c.overrideable);
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

  // Kit F2: groups (the catalogue's systems) filter the search; a group alone lists its medicines.
  const groupDrugs = group
    ? (groups.find((g) => g.id === group)?.classes.flatMap((c) => c.drugs) ?? [])
    : null;
  const searchHits = query.trim()
    ? searchDrugs(query).filter((d) => !groupDrugs || groupDrugs.includes(d))
    : (groupDrugs ?? []);
  const pickHit = (d: Drug) => {
    pickDrug(d, "list");
    setQuery("");
    setGroup(null);
    setHi(-1);
  };
  const cls = drug ? classById(drug.class) : undefined;
  const title = drug
    ? `${drug.generic} · ${cls?.name ?? drug.class}`
    : fluidsFirst
      ? "IV fluids"
      : "Choose a medicine";
  const methods = drug && s.route ? (drug.methods[s.route] ?? []) : [];
  const overOptions = s.fluid.purpose === "bolus" ? OVER_BOLUS : OVER_INFUSION;

  return (
    <EmrDialog
      open
      onOpenChange={(o) => !o && onClose()}
      width="xl"
      sheet="tall"
      kicker={
        v2
          ? fill(C.kicker, { place: PLACE[v2.place].label, collect: v2.collect }) +
            (problem ? ` · for ${problem.display}` : "")
          : `Prescribe · for ${problem?.display ?? ""}`
      }
      title={title}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-3">
          {reason ? (
            <span className="text-body-s text-muted-foreground mr-auto" aria-live="polite">
              {reason}
            </span>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!!reason} onClick={add}>
            {stop ? "Override and add" : "Add to basket"}
          </Button>
        </div>
      }
    >
      <div className="mb-5">
        <FactChips
          facts={f}
          kidneyTestOrdered={env.kidneyTestOrdered}
          allergies={allergies}
          time={time}
          v2={!!v2}
        />
        {v2?.place === "resus" ? (
          <p className="text-caption text-muted-foreground mt-2">{C.resusNote}</p>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_minmax(0,1fr)_360px]">
        {/* ── What ── */}
        <section aria-labelledby="rx-what" className="flex min-w-0 flex-col gap-4">
          <h3 id="rx-what" className="text-label text-foreground">
            What
          </h3>
          {env.cards.length ? (
            <Field label="For">
              <div role="group" aria-label="For which problem" className="flex flex-wrap gap-1.5">
                {env.cards.map((c) => (
                  <Toggle
                    key={c.versionId}
                    on={s.conditionId === c.versionId}
                    onPress={() => set({ conditionId: c.versionId })}
                  >
                    {c.display}
                  </Toggle>
                ))}
              </div>
            </Field>
          ) : null}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={searchId} className="text-caption text-muted-foreground">
                Search all classes
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-haspopup="dialog"
                className="pointer-coarse:min-h-11"
                onClick={() => setBrowsing(true)}
              >
                <LayoutGridIcon aria-hidden />
                Show all<span className="sr-only"> medicines</span>
              </Button>
            </div>
            <MedicinesBrowseDialog
              open={browsing}
              onOpenChange={setBrowsing}
              current={s.drugId}
              onPick={(d) => {
                pickDrug(d, "list");
                setQuery("");
              }}
            />
            <div className="relative">
              <SearchIcon
                aria-hidden
                className="text-muted-foreground absolute top-2.5 left-2.5 size-4"
              />
              <input
                id={searchId}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHi(-1);
                }}
                onKeyDown={(e) => {
                  // Kit F2: arrow keys move through the results, Enter picks.
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const n = searchHits.length;
                    if (n) setHi((h) => (e.key === "ArrowDown" ? (h + 1) % n : (h - 1 + n) % n));
                  } else if (e.key === "Enter" && searchHits.length) {
                    e.preventDefault();
                    pickHit(searchHits[Math.max(hi, 0)]!);
                  }
                }}
                role="combobox"
                aria-expanded={searchHits.length > 0}
                aria-controls={`${searchId}-hits`}
                aria-activedescendant={hi >= 0 ? `${searchId}-hit-${hi}` : undefined}
                className={cn(inputClass, "pl-8")}
                placeholder="Generic name or class"
              />
            </div>
            {groups.length ? (
              <div role="group" aria-label={C.groups} className="flex flex-wrap gap-1.5">
                <Toggle on={!group} onPress={() => setGroup(null)}>
                  {C.allGroups}
                </Toggle>
                {groups.map((g) => (
                  <Toggle
                    key={g.id}
                    on={group === g.id}
                    onPress={() => setGroup(group === g.id ? null : g.id)}
                  >
                    {g.name}
                  </Toggle>
                ))}
              </div>
            ) : null}
            {searchHits.length ? (
              <ul
                id={`${searchId}-hits`}
                role="listbox"
                aria-label="Search results"
                className="flex max-h-64 flex-col gap-1 overflow-y-auto"
              >
                {searchHits.map((d, i) => (
                  <li key={d.id} id={`${searchId}-hit-${i}`} role="option" aria-selected={i === hi}>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => pickHit(d)}
                      className={cn(
                        "text-body-s hover:bg-muted w-full rounded-sm px-2 py-1 text-left",
                        FOCUS,
                        i === hi && "bg-muted",
                      )}
                    >
                      {d.generic}
                      <span className="text-muted-foreground">{` · ${classById(d.class)?.name ?? d.class}`}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {problem ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-caption text-muted-foreground tracking-[0.06em] uppercase">
                  Mapped to this problem
                </span>
                <DraftLabel>Draft map, not CSO-signed</DraftLabel>
              </div>
              {problem.classes.length ? (
                <ul className="flex flex-col gap-2.5">
                  {problem.classes.map((id) => (
                    <li key={id} className="flex flex-col gap-1">
                      <span className="text-body-s text-foreground">
                        {classById(id)?.name ?? id}
                      </span>
                      <ul className="flex flex-col">
                        {drugsInClass(id).map((d) => (
                          <li key={d.id}>
                            <button
                              type="button"
                              aria-pressed={s.drugId === d.id}
                              onClick={() => pickDrug(d, "list")}
                              className={cn(
                                "text-body-s flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1 text-left",
                                FOCUS,
                                s.drugId === d.id ? "bg-teal-50 text-teal-800" : "hover:bg-muted",
                              )}
                            >
                              <span>{d.generic}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-body-s text-muted-foreground">
                  No classes mapped: search above.
                </p>
              )}
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            {problem?.supportive.includes("fluids") || fluidsFirst ? (
              <div className="flex flex-col gap-1">
                <span className="text-body-s text-foreground">Supportive: IV fluids</span>
                <Chips
                  label="IV fluids"
                  options={FLUID_DRUGS}
                  value={FLUID_DRUGS.find((x) => x === s.drugId) ?? null}
                  onPick={(id) => pickDrug(drugById(id)!, "fluids")}
                  word={(id) => drugById(id)?.generic.split(" (")[0] ?? id}
                />
              </div>
            ) : null}
          </div>
        </section>

        {/* ── How ── */}
        <section aria-labelledby="rx-how" className="flex min-w-0 flex-col gap-4">
          <h3 id="rx-how" className="text-label text-foreground">
            How
          </h3>
          {!drug ? (
            <p className="text-body-s text-muted-foreground">
              {fluidsFirst
                ? "Choose a fluid."
                : "Choose a medicine from the classes or the search."}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body-m text-foreground">{drug.generic}</span>
                <Tag>{REFERENCE_TAG_WORD[referenceTag(drug.dose)]}</Tag>
                <span className="text-caption text-muted-foreground">
                  {drug.presentationsDraft.join(", ")}
                </span>
              </div>
              {v2 && !fluidMode ? (
                <Field label={C.brand}>
                  <div role="radiogroup" aria-label={C.brand} className="flex flex-col gap-1.5">
                    <Toggle on={!s.productId} onPress={() => set({ productId: null })}>
                      {C.anyBrand}
                    </Toggle>
                    {(brands[drug.id] ?? []).map((b) => (
                      <div key={b.id} className="flex items-center gap-1.5">
                        <Toggle on={s.productId === b.id} onPress={() => set({ productId: b.id })}>
                          {[b.name, b.strength, b.manufacturer].filter(Boolean).join(" · ")}
                        </Toggle>
                        {b.inStock != null ? (
                          <Tag>
                            {fill(b.inStock ? C.inStock : C.outOfStock, { collect: v2.collect })}
                          </Tag>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={C.star}
                          aria-pressed={(starred ?? readStar(drug.id)) === b.id}
                          className="pointer-coarse:size-11"
                          onClick={() => {
                            try {
                              window.localStorage.setItem(STAR_KEY(drug.id), b.id);
                            } catch {
                              // A per-viewer convenience: nothing is lost without storage.
                            }
                            setStarred(b.id);
                          }}
                        >
                          <StarIcon
                            aria-hidden
                            className={cn(
                              (starred ?? readStar(drug.id)) === b.id && "fill-current",
                            )}
                          />
                        </Button>
                      </div>
                    ))}
                  </div>
                </Field>
              ) : null}

              <Field label="Formulary regimens for this patient">
                {resolution && resolution.regimens.length ? (
                  <div className="flex flex-col gap-1.5">
                    <div role="radiogroup" aria-label="Regimen" className="flex flex-col gap-1.5">
                      {resolution.regimens.map((r) => (
                        <button
                          key={r.regimen.id}
                          type="button"
                          role="radio"
                          aria-checked={s.regimenId === r.regimen.id}
                          onClick={() => applyRegimen(r.regimen.id)}
                          className={cn(
                            "text-body-s flex flex-col items-start rounded-md border px-3 py-2 text-left",
                            FOCUS,
                            s.regimenId === r.regimen.id
                              ? "border-teal-600 bg-teal-50"
                              : "border-border bg-card hover:bg-muted",
                          )}
                        >
                          <span className="text-foreground">
                            {r.regimen.label}
                            {r.applies ? (
                              <span className="text-muted-foreground">
                                {" · applies to this patient"}
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
                    </div>
                    {resolution.note ? (
                      <p className="text-caption text-muted-foreground">{resolution.note}</p>
                    ) : null}
                  </div>
                ) : (
                  <p className="border-border text-body-s text-muted-foreground rounded-md border border-dashed px-3 py-2">
                    {resolution?.note ?? "No verified regimen yet: type the dose."}
                  </p>
                )}
                {offersRegimens(drug.dose) ? (
                  <div className="flex flex-col gap-1.5">
                    <Toggle on={byAge} onPress={() => setByAge((x) => !x)}>
                      Dose by age
                    </Toggle>
                    {byAge ? (
                      <div className="overflow-x-auto">
                        <table className="text-body-s w-full">
                          <caption className="sr-only">
                            Dose by age, from the signed reference
                          </caption>
                          <tbody>
                            {DOSE_BANDS.map((b) => (
                              <tr
                                key={b}
                                className={cn(
                                  "border-border border-t align-top",
                                  b === band && "bg-teal-50",
                                )}
                              >
                                <th scope="row" className="text-label py-1.5 pr-3 text-left">
                                  {BAND_WORD[b]}
                                  {b === band ? (
                                    <span className="text-caption text-muted-foreground block">
                                      This patient
                                    </span>
                                  ) : null}
                                </th>
                                <td className="py-1.5">
                                  {drug.dose.bands[b] ?? "No verified regimen"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                    {byAge ? (
                      <p className="text-caption text-muted-foreground font-mono">
                        {[
                          ...new Set(
                            drug.dose.regimens.flatMap((r) =>
                              r.sources.map((x) => `${x.citation} Checked ${x.checkedAt}.`),
                            ),
                          ),
                        ].join(" ")}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </Field>

              {fluidMode ? (
                <>
                  <Field label="Purpose">
                    <Seg
                      label="Purpose"
                      options={PURPOSES.map((p) => ({ id: p, label: PURPOSE_WORD[p] }))}
                      value={s.fluid.purpose}
                      onPick={(purpose) => setFluid({ purpose, overMinutes: null })}
                    />
                  </Field>
                  <Field label="Volume">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Chips
                        label="Volume"
                        options={VOLUMES}
                        value={
                          (VOLUMES as readonly number[]).includes(s.fluid.volumeMl ?? -1)
                            ? (s.fluid.volumeMl as 250)
                            : null
                        }
                        onPick={(volumeMl) => setFluid({ volumeMl })}
                        word={(n) => `${n} mL`}
                      />
                      <label htmlFor={otherId} className="sr-only">
                        Other volume in mL
                      </label>
                      <input
                        id={otherId}
                        inputMode="decimal"
                        placeholder="Other mL"
                        value={
                          s.fluid.volumeMl != null &&
                          !(VOLUMES as readonly number[]).includes(s.fluid.volumeMl)
                            ? String(s.fluid.volumeMl)
                            : ""
                        }
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          setFluid({ volumeMl: e.target.value && n > 0 ? n : null });
                        }}
                        className={cn(inputClass, "w-28")}
                      />
                    </div>
                  </Field>
                  <Field label="Over">
                    <Chips
                      label="Over"
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
                  <Field label="How given">
                    <Seg
                      label="How given"
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
                        label="Giving set"
                        options={[
                          { id: "20" as const, label: "20 drops/mL" },
                          { id: "60" as const, label: "60 drops/mL" },
                        ]}
                        value={
                          s.fluid.dropsPerMl ? (String(s.fluid.dropsPerMl) as "20" | "60") : null
                        }
                        onPick={(d) => setFluid({ dropsPerMl: d === "20" ? 20 : 60 })}
                      />
                    ) : null}
                  </Field>
                  <Field label="Warmed">
                    <Seg
                      label="Warmed"
                      options={[
                        { id: "yes" as const, label: "Yes" },
                        { id: "no" as const, label: "No" },
                      ]}
                      value={s.fluid.warmed ? "yes" : "no"}
                      onPick={(w) => setFluid({ warmed: w === "yes" })}
                    />
                  </Field>
                  {rate && rate.mlPerHour != null ? (
                    <p className="text-body-s text-foreground font-mono tabular-nums">
                      {`${rate.mlPerHour} mL/h`}
                      {rate.dropsPerMinute != null ? ` · ${rate.dropsPerMinute} drops/min` : ""}
                      <span className="text-caption text-muted-foreground font-sans">
                        {" · arithmetic only"}
                      </span>
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  <Field label="Dose">
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor={doseId} className="sr-only">
                        Dose
                      </label>
                      <input
                        id={doseId}
                        inputMode="decimal"
                        value={s.doseNum ?? ""}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          set({
                            doseNum: e.target.value && Number.isFinite(n) && n > 0 ? n : null,
                          });
                        }}
                        className={cn(inputClass, "w-28 font-mono tabular-nums")}
                      />
                      <Chips
                        label="Unit"
                        options={DOSE_UNITS}
                        value={s.unit}
                        onPick={(unit) => set({ unit })}
                      />
                    </div>
                  </Field>
                  <Field label="Route">
                    <Chips
                      label="Route"
                      options={drug.routes}
                      value={s.route}
                      onPick={(route) =>
                        set({ route, method: null, infusionOver: null, diluent: null })
                      }
                      word={(r) => ROUTE_WORD[r] ?? r}
                    />
                  </Field>
                  {methods.length ? (
                    <Field label="How given">
                      <Chips
                        label="How given"
                        options={methods}
                        value={s.method}
                        onPick={(method) =>
                          set({
                            method,
                            ...(intermittent(method) ? {} : { infusionOver: null, diluent: null }),
                          })
                        }
                      />
                    </Field>
                  ) : null}
                  {intermittent(s.method) ? (
                    <>
                      <Field label="Over">
                        <Chips
                          label="Infusion over"
                          options={INFUSION_OVER}
                          value={s.infusionOver}
                          onPick={(infusionOver) => set({ infusionOver })}
                        />
                      </Field>
                      <Field label="Diluted in">
                        <Chips
                          label="Diluted in"
                          options={DILUENTS}
                          value={s.diluent}
                          onPick={(diluent) => set({ diluent })}
                        />
                      </Field>
                    </>
                  ) : null}
                  <Field label="How often">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Chips
                        label="How often"
                        options={RX_FREQUENCIES}
                        value={s.frequency}
                        onPick={(frequency) => set({ frequency })}
                        word={(x) => FREQUENCY_WORD[x]}
                      />
                      <Toggle on={s.prn} onPress={() => set({ prn: !s.prn })}>
                        PRN
                      </Toggle>
                    </div>
                  </Field>
                  <Field label="Course">
                    <Chips
                      label="Course"
                      options={RX_COURSES}
                      value={s.course}
                      onPick={(course) => set({ course })}
                      word={(x) => COURSE_WORD[x]}
                    />
                  </Field>
                </>
              )}
              <Field label="Start">
                <Seg
                  label="Start"
                  options={[
                    { id: "now" as const, label: "Give now" },
                    { id: "next_round" as const, label: "Next drug round" },
                  ]}
                  value={s.start}
                  onPick={(start) => set({ start })}
                />
              </Field>
              <div className="flex flex-col gap-1">
                <label htmlFor={noteId} className="text-caption text-muted-foreground">
                  Note (optional)
                </label>
                <input
                  id={noteId}
                  value={s.note}
                  maxLength={500}
                  onChange={(e) => set({ note: e.target.value })}
                  className={inputClass}
                />
              </div>
            </>
          )}
        </section>

        {/* ── Check ── */}
        <section
          aria-labelledby="rx-check"
          className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-0 lg:self-start"
        >
          <h3 id="rx-check" className="text-label text-foreground">
            Check
          </h3>
          <Field label="Will read">
            <p
              className="text-body-s text-foreground bg-muted rounded-md px-3 py-2"
              aria-live="polite"
            >
              {rx && drug ? willRead(rx, drug) : "Nothing chosen yet."}
            </p>
            {edits.map((e) => (
              <p key={e.field} className="text-caption text-muted-foreground">
                {`${EDIT_FIELD_WORD[e.field]}: `}
                <s>{e.from}</s>
                {` → ${e.to}`}
                <span className="sr-only">{`, changed from ${e.from}`}</span>
              </p>
            ))}
            {v2 && edits.length && s.regimenId ? (
              <div className="flex flex-wrap items-center gap-2">
                <Tag>{C.changedFromRegimen}</Tag>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => applyRegimen(s.regimenId!)}
                >
                  {C.useRegimen}
                </Button>
              </div>
            ) : null}
            {v2 && !fluidMode && drug ? (
              <p className="text-caption text-muted-foreground">
                {`${C.quantity}: `}
                {supply?.text ?? C.quantityUnknown}
              </p>
            ) : null}
            <p className="text-caption text-muted-foreground">
              {`${band ? BAND_WORD[band] : "Age not recorded"} · `}
              {weight ? (
                <span className="font-mono tabular-nums">{`${weight.kg} kg, ${time(weight.at)}, ${weight.source}`}</span>
              ) : (
                "no weight in the vitals"
              )}
            </p>
          </Field>
          <Field label="Pharmacy">
            {stockAt && drug ? (
              <>
                <p
                  className="text-body-s text-foreground bg-muted rounded-md px-3 py-2"
                  aria-live="polite"
                >
                  {stockLine ? stockLineWords(stockLine) : "Asking the pharmacy…"}
                </p>
                <p className="text-caption text-muted-foreground">{STOCK_LINE_COPY.footer}</p>
              </>
            ) : (
              <p className="border-border text-body-s text-muted-foreground rounded-md border border-dashed px-3 py-2">
                Pharmacy not linked yet
              </p>
            )}
          </Field>
          <Field label="Checks">
            {firing.length ? (
              <ul className="flex flex-col gap-3">
                {firing.map((c) => (
                  <CheckItem
                    key={c.code}
                    c={c}
                    answer={s.answers[c.code]}
                    onAnswer={(a) =>
                      setS((x) => ({ ...x, answers: { ...x.answers, [c.code]: a } }))
                    }
                    needsAnswer={needingAnswer([c]).length > 0}
                    onPickElse={c.code === "stock" ? pickElse : undefined}
                  />
                ))}
              </ul>
            ) : drug ? (
              <p className="text-body-s text-muted-foreground">No check needs an answer.</p>
            ) : null}
            {drug?.flags.controlled ? (
              <div className="flex flex-col gap-1">
                <label htmlFor={witnessId} className="text-caption text-muted-foreground">
                  Controlled drug: witness name or staff ID
                </label>
                <input
                  id={witnessId}
                  value={s.witness}
                  maxLength={120}
                  onChange={(e) => set({ witness: e.target.value })}
                  className={inputClass}
                />
              </div>
            ) : null}
            {checks.some((c) => c.egregious) ? (
              <div className="flex flex-col gap-1">
                <label htmlFor={typedId} className="text-caption text-muted-foreground">
                  Type the dose to confirm it
                </label>
                <input
                  id={typedId}
                  inputMode="decimal"
                  value={s.typedDose}
                  onChange={(e) => set({ typedDose: e.target.value })}
                  className={cn(inputClass, "font-mono")}
                />
              </div>
            ) : null}
            {rest.length ? (
              <div className="flex flex-col gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  aria-expanded={more}
                  onClick={() => setMore((x) => !x)}
                >
                  {more ? "Hide the other checks" : `Show ${rest.length} more checks`}
                </Button>
                {more ? (
                  <ul className="flex flex-col gap-1.5">
                    {rest.map((c) => (
                      <li key={c.code} className="text-caption flex flex-col">
                        <span className="text-foreground">
                          {`${c.title} · ${OUTCOME_WORD[c.outcome]}`}
                          {c.proposed ? (
                            <span className="text-muted-foreground">{" · proposed"}</span>
                          ) : null}
                        </span>
                        <span className="text-muted-foreground">{c.message}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </Field>
          {repBounds && repeats ? (
            <RepeatsField bounds={repBounds} today={repeats.today} value={rep} onChange={setRep} />
          ) : null}
        </section>
      </div>
    </EmrDialog>
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
  onAnswer: (a: { answer: AnswerId; text?: string }) => void;
  needsAnswer: boolean;
  /** A stock Check's second choice (D-PH1-22). */
  onPickElse?: () => void;
}) {
  const tid = useId();
  const chips =
    c.code === "stock" ? STOCK_REASONS : c.outcome === "stop" ? OVERRIDE_REASONS : CHECK_REASONS;
  const word = OUTCOME_WORD[c.outcome];
  return (
    <li className="flex flex-col gap-1.5">
      <span className="text-body-s flex flex-wrap items-center gap-2">
        {c.outcome === "note" ? <Tag>{word}</Tag> : <Caution>{word}</Caution>}
        <span className="text-foreground">{c.title}</span>
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
          <span className="text-caption text-muted-foreground italic">
            Answer wording is a draft for the CSO.
          </span>
        </>
      ) : null}
    </li>
  );
}
