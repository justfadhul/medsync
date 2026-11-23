import type { ExamView } from "./exam/model";
import type { ImpressionView } from "./impression/model";
import type { PlanView } from "./plan/model";
import type { SiView } from "./si-model";
import type { DxData } from "./use-catalogue";
import type { DeskPayload, KeyInput } from "@/components/emr/desk/model";
import type { History, HistoryHeader, SymptomEntry, YesNo } from "@/lib/clerking/answers";
import type { Catalogue, PatientSex, Symptom } from "@/lib/clerking/catalogue";
import type { Block } from "@/lib/clerking/compose";
import type { VitalsPrev } from "@/lib/clerking/desk-data";
import type { ExamCatalogue } from "@/lib/clerking/exam/catalogue";
import type { ClassifierResult, ExamSignoff } from "@/lib/clerking/exam/classifiers";
import type { ExamContext, VitalValues } from "@/lib/clerking/exam/context";
import type { Badge, Flag, Signoff } from "@/lib/clerking/flags";
import type { Linked } from "@/lib/clerking/linkage";
import type { SectionId, SectionStatus, Tone } from "@/lib/clerking/status";
import type { VitalClass, VitalCtx } from "@/lib/clerking/vital-classification";
import type { NoteContent, SignValidation } from "@/lib/emr/note-rules";
import type { DeskDiabetes } from "@/lib/ncd/pack/desk";
import type { DiabetesPack } from "@/lib/ncd/pack/types";
import type { AdultVitals, News2Result } from "@/lib/triage/types";

import { deskValidation, hasContent, itemsOf, itemWords } from "@/components/emr/desk/model";
import { rank } from "@/components/emr/desk/search";
import { durationText, emptyHistory } from "@/lib/clerking/answers";
import { appliesTo, rosSystemsFor } from "@/lib/clerking/catalogue";
import { familyConditions, v2CommitLines } from "@/lib/clerking/commit";
import { compose, lc, list } from "@/lib/clerking/compose";
import { conversionFlags } from "@/lib/clerking/convert";
import { bmiClass, classifierIsLive, waistRisk } from "@/lib/clerking/exam/classifiers";
import { bmiOf } from "@/lib/clerking/exam/vitals";
import { evaluateFlags, toBadges } from "@/lib/clerking/flags";
import { composeImpression } from "@/lib/clerking/impression/compose";
import { linkedAnswers } from "@/lib/clerking/linkage";
import { doneCount, SECTIONS, sectionStatuses } from "@/lib/clerking/status";
import { classifyVital } from "@/lib/clerking/vital-classification";
import { captureFromNote } from "@/lib/ncd/cfc-map";
import { deskDiabetes } from "@/lib/ncd/pack/desk";
import { packInputFromClerking } from "@/lib/ncd/pack/from-clerking";
import { toPackValues } from "@/lib/ncd/pack/live";
import {
  NEWS2_PULSE,
  NEWS2_RESP_RATE,
  NEWS2_SPO2_SCALE1,
  NEWS2_SYSTOLIC_BP,
  NEWS2_TEMPERATURE,
} from "@/lib/triage/constants";
import { scoreNews2 } from "@/lib/triage/scoring/news2";
import { deriveExam, previousFormat } from "./exam/model";
import { deriveImpression } from "./impression/model";
import { derivePlan } from "./plan/model";
import { deriveSi, refinementOf } from "./si-model";

/**
 * Clerking desk v2's pure view model (PROMPT-CLERKING-DESK-V2 §5): no React, no I/O. What the shell
 * derives from the payload, the catalogue and the draft content, the words the rail and the cards
 * show, and the keyboard map. Clinical content stays in the catalogue (Law 2); the words here are
 * chrome ("Step 3 of 10") or the record's own labels.
 */

/** One line under each section title (the prototype's `secOrder()`), chrome only. */
export const BLURB: Record<SectionId, string> = {
  complaint: "What brought the patient, with the properties of each symptom.",
  history: "The story in your words, and what else you asked about.",
  systems: "Yes or no for each; open any yes to record its properties.",
  pmh: "Conditions, operations and transfusions, medicines and allergies.",
  fh: "Conditions in parents, siblings and children.",
  social: "Tobacco, alcohol, home, activity and work.",
  exam: "Vital signs, general examination and systems.",
  summary: "The case in one paragraph, composed from your entries as you change them.",
  impression: "Your leading diagnosis, what supports it, and what else it could be.",
  plan: "Tests and actions, ordered as you tap.",
};

/** The v2 template's sections that still render a v1 body (Summary is v2's own step 08). */
export const V1_SECTION: Partial<Record<SectionId, string>> = {
  exam: "s11",
  impression: "s13",
  plan: "s14",
};

export const sectionIndex = (id: string) => SECTIONS.findIndex((s) => s.id === id);

/* ─── Content v2 ────────────────────────────────────────────────── */

export function historyOf(c: NoteContent): History {
  const h = (c.history ?? {}) as Partial<History>;
  const e = emptyHistory();
  return {
    ...e,
    ...h,
    past: { ...e.past, ...h.past },
    social: { ...e.social, ...h.social },
  } as History;
}

export function headerOf(c: NoteContent): HistoryHeader {
  const h = c.header ?? {};
  const s = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return { historian: s(h.historian), language: s(h.language), interpreter: s(h.interpreter) };
}

/** The draft with this history, stamped schema 2 and the catalogue version (Law 3). */
export function withHistory(c: NoteContent, h: History, catalogueVersion: string): NoteContent {
  return { ...c, schema: 2, catalogueVersion, history: h as unknown as NoteContent["history"] };
}

/* ─── Examination, Summary, Impression, Plan as note text ───────── */

function sectionWords(c: NoteContent, sid: string): string[] {
  const s = c.sections[sid];
  if (!s) return [];
  return [
    ...(s.items ?? []).map(itemWords).filter((x): x is string => !!x),
    ...Object.values(s.fields ?? {}).filter((v): v is string => !!v?.trim()),
    ...(s.narrative?.trim() ? [s.narrative.trim()] : []),
  ];
}

/**
 * The v1 s11–s14 content as plain text for the note pane's Examination, Impression and Plan blocks,
 * with this visit's diagnoses and orders (the chart holds them; the note mirrors them) and the latest
 * vital signs as the record shows them (read, never copied into the draft).
 */
export function sectionText(
  p: DeskPayload,
  c: NoteContent,
  /** The structured examination's paragraph (exam v2); replaces v1's s11 words. */
  examBody?: string,
  /** The Summary block (step 08): composed, the clinician's words, or as signed. */
  summaryBody?: string,
  /** The Impression block (step 09), composed by `composer.impression`. */
  impressionBody?: string,
  /** The Plan block (step 10 by problem, ADR 0184), composed by `composePlanLines`. */
  planBody?: string,
): Partial<Record<"exam" | "summary" | "impression" | "plan", string>> {
  const exam: string[] = [];
  if (examBody !== undefined) {
    if (examBody) exam.push(examBody);
  } else {
    if (p.context.vitals.length)
      exam.push(
        `Vital signs: ${p.context.vitals.map((v) => `${v.label} ${v.value}${v.unit ? ` ${v.unit}` : ""}`).join(", ")}.`,
      );
    exam.push(...sectionWords(c, "s11"));
  }
  // Step 08 writes its own block (S-1); an old draft's s12 words reach it through the summary
  // model ("In my words"), never the examination block.
  const summary = summaryBody ?? sectionWords(c, "s12").join(" ");

  const dx = sectionWords(c, "s13");
  const mirroredDx = new Set(itemsOf(c, "s13", "encounter_diagnosis").map((i) => i.conditionId));
  for (const d of p.diagnoses) if (!mirroredDx.has(d.id)) dx.push(d.display);

  const plan = sectionWords(c, "s14");
  const mirroredOrders = new Set(itemsOf(c, "s14", "order").map((i) => i.orderId));
  for (const o of p.orders) if (!mirroredOrders.has(o.id)) plan.push(o.display);

  const join = (a: string[]) => a.join("\n");
  return {
    exam: join(exam),
    summary,
    impression: impressionBody ?? join(dx),
    plan: planBody ?? join(plan),
  };
}

/** Examination's status for the section bar, from the v1 body's content. */
export function examTone(p: DeskPayload, c: NoteContent): Tone {
  const signs = itemsOf(c, "s11", "exam_finding").length > 0;
  const vitals = p.context.vitals.length > 0;
  if (signs && vitals) return "done";
  return signs || vitals || hasContent(c, "s11") ? "partial" : "open";
}

/** Examination's status from the structured examination: done once a set is saved (or the record
 *  holds vitals), consciousness and air or oxygen are answered, and a system beyond General has
 *  findings; partly while anything is recorded. */
export function examViewTone(e: ExamView): Tone {
  if (!e.hasContent) return "open";
  const general = !!e.exam.blocks.consciousness && !!e.exam.entries["ex.general.oxygen"];
  const vitals = !!e.exam.vitalsSavedAt || e.news2Latest !== null;
  const system = e.ecat.systems.some((s) => s.id !== "general" && e.systems[s.id]!.tone !== "open");
  return general && vitals && system ? "done" : "partial";
}

/** The Impression block: composed from the board (steps 09), or as signed (D-SI-20). A draft
 *  with nothing on the board and no deferral keeps the v1 words (old drafts, §8). */
function impressionText(
  p: DeskPayload,
  c: NoteContent,
  si: SiView | null,
  imp: ImpressionView | null,
  dx: DxData | null,
): string | undefined {
  const signed = (c.impression as { text?: string } | undefined)?.text;
  if (p.draft === null && p.signed) return signed;
  if (!si || !imp) return undefined;
  if (!si.recorded.length && !si.board.deferred) return undefined;
  const r = refinementOf(si, p.clerking?.exam.gestationWeeks ?? null, dx);
  return composeImpression({
    board: si.board,
    draft: si.impression,
    findings: imp.findings,
    unexplained: imp.unexplained,
    audience: "clinical",
    relations: si.relations,
    background: si.background,
    ruledOut: si.ruledOut,
    stages: r.stages,
    risk: r.risk,
  });
}

/* ─── Everything the shell derives, in one pure pass ─────────────── */

/** The pack on the clerking record; answers typed in "More diabetes questions" fill only what
 *  the record does not answer (the record wins). */
function deskDiabetesOf(
  dm: { pack: DiabetesPack; fields: readonly string[] },
  p: DeskPayload,
  c: NoteContent,
  x: NonNullable<ExamView["x"]>,
): DeskDiabetes {
  const k = p.clerking!;
  const { input } = packInputFromClerking({
    x,
    problems: p.context.problems,
    diagnoses: p.diagnoses,
    pregnancy: { gestationWeeks: k.exam.gestationWeeks, weeksPostpartum: k.exam.weeksPostpartum },
    // Restricted classes (HIV, TB, mental health, SRH) only for a viewer who may see them.
    viewer: k.canSeeRestricted ? undefined : { classes: new Set<string>() },
  });
  const typed = captureFromNote(c);
  return deskDiabetes(
    dm.pack,
    typed ? { ...input, values: { ...toPackValues(typed, dm.fields), ...input.values } } : input,
  );
}

export interface Derived {
  /** The structured examination (null while its catalogue loads, or for a previous-format draft). */
  exam: ExamView | null;
  history: History;
  header: HistoryHeader;
  linked: Map<string, Linked>;
  news2: News2Result | null;
  flags: Flag[];
  badges: Badge[];
  blocks: Block[];
  statuses: Record<SectionId, SectionStatus>;
  done: number;
  validation: SignValidation;
  /** Steps 08 and 09 (null while the examination catalogue loads). */
  si: SiView | null;
  /** Step 10 by problem (null where CLERKING_PLAN_V2 is off, or while 08–09 load). */
  plan: PlanView | null;
  /** The diabetes pack on this record (NCD_DM_DESK; null when off or while the exam loads). */
  diabetes: DeskDiabetes | null;
}

export function deriveDesk(
  cat: Catalogue,
  p: DeskPayload,
  c: NoteContent,
  ecat: ExamCatalogue | null = null,
  timeOf?: (iso: string) => string,
  dx: DxData | null = null,
  /** NCD_DM_DESK: the lean diabetes pack (and its form's own field codes), run on the record. */
  dm: { pack: DiabetesPack; fields: readonly string[] } | null = null,
): Derived {
  const k = p.clerking!;
  const history = historyOf(c);
  const header = headerOf(c);
  const linked = linkedAnswers(cat, history.complaints);
  const exam =
    ecat && !previousFormat(c)
      ? deriveExam({ ecat, cat, p, content: c, history, linked, timeOf })
      : null;
  const news2 = k.vitalsAt ? scoreNews2(k.vitals) : null;
  const diabetes = dm && exam ? deskDiabetesOf(dm, p, c, exam.x) : null;
  const patient = { ageYears: k.ageYears, sex: k.sex };
  const flags = evaluateFlags(cat, {
    history,
    linked,
    patient,
    settings: { outbreakMode: k.outbreakMode },
    medicines: k.medicines.map((m) => ({ name: m.name, adherence: m.adherence })),
    allergies: {
      status: k.allergies.status,
      items: k.allergies.items.map((a) => ({ name: a.name, reactions: a.reactions })),
    },
    news2,
    signoff: k.signoff,
  })
    .concat(conversionFlags(cat, k.conversionFlags ?? {}, history))
    .concat(exam?.flags ?? [])
    .concat(diabetes?.flags ?? []);
  const allergiesConfirmed = k.allergies.touchedThisVisit || !!history.past.allergiesConfirmed;
  const si = deriveSi({
    p,
    content: c,
    cat,
    ecat,
    history,
    linked,
    examX: exam?.x ?? null,
    news2,
    dx,
    signed: p.draft === null && !!p.signed,
  });
  const imp = si
    ? deriveImpression(si, dx, { inPlan: () => new Set(), diabetes: diabetes?.verdict ?? null })
    : null;
  const plan =
    si && p.plan
      ? derivePlan({ p, content: c, board: si.board, dx, news2: exam?.news2Latest ?? news2 })
      : null;
  const signedPlan =
    p.draft === null && p.signed ? (c.plan as { text?: string } | undefined)?.text : undefined;
  const blocks = compose({
    cat,
    header,
    history,
    linked,
    patient: { name: p.patient.name, ...patient },
    medicines: k.medicines.map((m) => ({
      name: m.name,
      dose: m.doseText,
      frequency: m.frequencyCode,
      adherence: m.adherence,
      source: m.informant,
      restricted: m.restricted,
    })),
    allergies: {
      status: k.allergies.status,
      confirmedThisVisit: allergiesConfirmed,
      items: k.allergies.items,
    },
    sectionText: sectionText(
      p,
      c,
      exam ? exam.text : undefined,
      si?.noteText,
      impressionText(p, c, si, imp, dx),
      signedPlan ?? plan?.lines.join("\n"),
    ),
    edited: c.edited ?? {},
    audience: "clinical",
  });
  // Steps 08 and 09 at signing (D-SI-06, D-SI-08): a must-not-miss marked unlikely without its
  // reason blocks, by name; an unreviewed summary is a prompt only.
  const base = deskValidation(p, c);
  const siBlocks = imp?.signBlocks ?? [];
  // ADR 0184 §5: signing waits for "plan done".
  const planBlocks = plan && plan.status.kind !== "done" ? ["Mark the plan done"] : [];
  const validation: SignValidation = {
    canSign: base.canSign && siBlocks.length === 0 && planBlocks.length === 0,
    missing: [
      ...base.missing,
      ...siBlocks.map((message) => ({
        id: imp?.causeBlocks.includes(message) ? "si.cause_removed" : "si.mnm_reason",
        message,
      })),
      ...planBlocks.map((message) => ({ id: "plan.done", message })),
    ],
    warnings: [
      ...base.warnings,
      ...(si && si.review !== "reviewed"
        ? [{ id: "si.summary_review", message: "Summary not reviewed" }]
        : []),
    ],
  };
  const baseStatuses = sectionStatuses({
    cat,
    history,
    linked,
    sex: k.sex,
    allergyConfirmedThisVisit: allergiesConfirmed,
    exam: exam ? examViewTone(exam) : examTone(p, c),
    summary: si?.review ?? null,
    missing: validation.missing.map((m) => m.id),
  });
  const statuses = plan
    ? {
        ...baseStatuses,
        plan:
          plan.status.kind === "done"
            ? { text: "Done", tone: "done" as const }
            : plan.status.kind === "ready"
              ? { text: "Ready", tone: "partial" as const }
              : { text: `${plan.status.count} to do`, tone: "required" as const },
      }
    : baseStatuses;
  return {
    exam,
    history,
    header,
    linked,
    news2,
    flags,
    badges: toBadges(flags, k.canSeeRestricted),
    blocks,
    statuses,
    done: doneCount(statuses),
    validation,
    si,
    plan,
    diabetes,
  };
}

/** A reference value the CSO signed and did not withhold (Law 7), as a number. */
export function signedRef(cat: Catalogue, s: Signoff, id: string): number | null {
  const signed = s.referenceEntries === "all" || s.referenceEntries.includes(id);
  const v = cat.refValue(id);
  return signed && !s.withheld.includes(id) && typeof v === "number" ? v : null;
}

/* ─── Complaint cards ───────────────────────────────────────────── */

/** One line of what is recorded for a symptom: "gradual · getting worse · 4 times a night". */
export function entrySummary(cat: Catalogue, s: Symptom, e: SymptomEntry): string {
  const out: string[] = [];
  for (const p of cat.properties(s.id)) {
    const v = e.props[p.id];
    const label = (id: string) => p.options.find((o) => o.id === id)?.label;
    if (p.kind === "one" && typeof v === "string") {
      const l = label(v);
      if (l) out.push(lc(l));
    } else if (p.kind === "many" && Array.isArray(v))
      for (const x of v) {
        const l = label(x);
        if (l) out.push(lc(l));
      }
    else if (p.kind === "count" && typeof v === "number")
      out.push(`${v}${p.unit ? ` ${p.unit}` : ""}`);
    else if (p.kind === "scale" && typeof v === "number") out.push(`${v}/10`);
  }
  const yes = s.red_flags.filter((f) => e.flags[f.id] === "yes").length;
  if (yes) out.push(`${yes} red ${yes === 1 ? "flag" : "flags"}`);
  return out.join(" · ");
}

/** The same with the duration first ("2 months · ribs · dull, aching"), for a system symptom. */
export function detailSummary(cat: Catalogue, s: Symptom, e: SymptomEntry | undefined): string {
  if (!e) return "";
  return [durationText(e.duration), entrySummary(cat, s, e)].filter(Boolean).join(" · ");
}

/** A past condition confirmed on the problem list (D-CV-09): marked in the draft, display only. */
export function withConditionOnList(
  c: NoteContent,
  condition: string,
  catalogueVersion: string,
): NoteContent {
  const h = historyOf(c);
  const cur = h.past.conditions[condition];
  if (cur?.answer !== "yes") return c;
  return withHistory(
    c,
    {
      ...h,
      past: {
        ...h.past,
        conditions: { ...h.past.conditions, [condition]: { ...cur, onProblemList: true } },
      },
    },
    catalogueVersion,
  );
}

/**
 * "Committed with this note" for a v2 draft: what signing charts (lib/clerking/commit.ts, the same
 * pure functions the server runs, over the chartable set the loader sends), the family conditions
 * written at signing (H13), and whatever the v1 sections s11–s14 commit (`v1`).
 */
export function v2CommittedWords(
  cat: Catalogue,
  k: { sex: PatientSex; chartable: readonly string[] },
  c: NoteContent,
  v1: string | null,
): string | null {
  const h = historyOf(c);
  const map = Object.fromEntries(k.chartable.map((s) => [s, s]));
  const { lines, unmapped } = v2CommitLines(cat, map, (t) => t, h, k.sex);
  const findings = lines.filter((l) => l.conceptId !== "soc.tobacco").length;
  const tobacco = lines.length - findings;
  const family = familyConditions(cat, h).length;
  const parts = [
    findings ? `${findings} ${findings === 1 ? "finding" : "findings"}` : null,
    tobacco ? "tobacco status" : null,
    family ? `${family} family history ${family === 1 ? "entry" : "entries"}` : null,
    unmapped ? `${unmapped} kept in the note only (not charted yet)` : null,
    v1,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export interface ComplaintHit {
  symptom: Symptom;
  label: string;
  synonyms: readonly string[];
}

/** Complaint search over labels, synonyms and local terms (§5.2), catalogue order on ties. */
export function complaintIndex(cat: Catalogue): ComplaintHit[] {
  return cat.symptoms
    .filter((s) => s.offer_as_complaint)
    .map((s) => ({ symptom: s, label: s.label, synonyms: [...s.synonyms, ...s.local_terms] }));
}

export function searchComplaints(index: readonly ComplaintHit[], query: string, limit = 8) {
  return rank(index, query, limit);
}

/** Where a symptom sits, in words: its property family and its systems. */
export function whereWords(cat: Catalogue, s: Symptom): string {
  const fam = cat.data.property_families[s.family]?.label;
  const systems = s.systems
    .map((id) => cat.data.review_of_systems.systems.find((x) => x.id === id)?.label)
    .filter((x): x is string => !!x);
  return [fam, ...systems].filter(Boolean).join(" · ");
}

/** "Also asked, because of …" (§5.3): each catalogued complaint's also_ask, keyed as stored. */
export function alsoAskedGroups(cat: Catalogue, h: History) {
  return h.complaints.flatMap((c) => {
    const s = c.symptom ? cat.symptom(c.symptom) : undefined;
    if (!s?.also_ask.length) return [];
    return [
      {
        symptom: s,
        rows: s.also_ask.map((a) => ({ key: `${s.id}:${a.id}`, label: a.label })),
      },
    ];
  });
}

/* ─── The rail's vital signs (NEWS2 through the triage engine) ───── */

export interface VitalRow {
  key: string;
  label: string;
  value: string | null;
  unit: string;
  /** NEWS2 points for this reading (null: not a NEWS2 parameter or not recorded). */
  points: number | null;
  /** A reading scoring 3: which side of normal. */
  arrow: "low" | "high" | null;
  /** A prompt beside the value ("Air or oxygen?"); caution when something is missing. */
  note: { text: string; caution: boolean } | null;
  /** The standard classification beside NEWS2 ("Stage 2 hypertension"); absent when none. */
  cls?: VitalClass | null;
  /** What the reading before this one was ("was 124", as the triage pop-up shows it); absent when
   *  there is no earlier reading. */
  trend?: { was: string } | null;
}

export interface VitalsView {
  rows: VitalRow[];
  news2: News2Result;
  chip: string;
  message: string | null;
  missing: string | null;
}

const MISSING_WORDS: Record<string, string> = {
  respiratory_rate: "respiratory rate",
  spo2: "SpO₂",
  systolic_bp: "blood pressure",
  pulse: "pulse",
  temperature: "temperature",
  consciousness: "consciousness",
  oxygen: "air or oxygen",
};
const ACVPU_WORD: Record<string, string> = {
  A: "Alert",
  C: "New confusion",
  V: "Voice",
  P: "Pain",
  U: "Unresponsive",
};
/** The triage engine's bands, read only to tell low from high for the arrow. */
const BANDS: Record<string, readonly { min: number | null; points: number }[]> = {
  respiratory_rate: NEWS2_RESP_RATE,
  spo2: NEWS2_SPO2_SCALE1,
  systolic_bp: NEWS2_SYSTOLIC_BP,
  pulse: NEWS2_PULSE,
  temperature: NEWS2_TEMPERATURE,
};

function arrowFor(parameter: string, value: unknown, points: number): VitalRow["arrow"] {
  const bands = BANDS[parameter];
  if (points !== 3 || typeof value !== "number" || !bands) return null;
  const zero = bands.find((b) => b.points === 0);
  return zero && zero.min !== null && value < zero.min ? "low" : "high";
}

/** `ctx` adds each reading's standard classification (adults); without it, NEWS2 only. */
export function vitalsView(
  v: AdultVitals,
  context: DeskPayload["context"]["vitals"],
  /** `dbp`: the chart's newest diastolic, when the context list carries none. */
  ctx?: VitalCtx & { dbp?: number | null; prev?: VitalsPrev },
): VitalsView {
  const now: Record<string, [number | null, number | null | undefined]> = {
    systolic_bp: [v.systolicBp, ctx?.prev?.systolicBp],
    pulse: [v.pulse, ctx?.prev?.pulse],
    respiratory_rate: [v.respiratoryRate, ctx?.prev?.respiratoryRate],
    spo2: [v.spo2, ctx?.prev?.spo2],
    temperature: [v.temperature, ctx?.prev?.temperature],
  };
  const trendOf = (key: string): VitalRow["trend"] => {
    const [cur, was] = now[key] ?? [null, null];
    if (cur == null || was == null) return null;
    const dia = ctx?.prev?.diastolicBp;
    return {
      was:
        key === "temperature"
          ? was.toFixed(1)
          : key === "systolic_bp" && dia != null
            ? `${was}/${dia}`
            : String(was),
    };
  };
  const news2 = scoreNews2(v);
  const pt = (id: string) => news2.parameters.find((x) => x.parameter === id);
  const row = (
    key: string,
    label: string,
    value: string | null,
    unit: string,
    note: VitalRow["note"] = null,
    c: VitalClass | null = null,
  ): VitalRow => {
    const s = pt(key);
    const points = s?.present ? s.points : null;
    return {
      key,
      label,
      value,
      unit,
      points,
      arrow: s ? arrowFor(key, s.value, s.points) : null,
      note,
      cls: c,
      trend: trendOf(key),
    };
  };
  const dia =
    context.find((c) => c.conceptId === "obs.bp_diastolic")?.value ??
    (ctx?.dbp != null ? String(ctx.dbp) : undefined);
  const glucose = context.find((c) => /glucose/.test(c.conceptId));
  const cls = (
    kind: Parameters<typeof classifyVital>[0],
    value: Parameters<typeof classifyVital>[1],
  ) =>
    ctx ? classifyVital(kind, value, { spo2Scale: v.spo2Scale, oxygen: v.oxygen, ...ctx }) : null;
  const sbpDbp =
    v.systolicBp !== null && dia && Number.isFinite(Number(dia))
      ? { sbp: v.systolicBp, dbp: Number(dia) }
      : null;
  const rows: VitalRow[] = [
    row(
      "systolic_bp",
      "Blood pressure",
      v.systolicBp === null ? null : `${v.systolicBp}${dia ? `/${dia}` : ""}`,
      "mmHg",
      null,
      cls("bp", sbpDbp),
    ),
    row(
      "pulse",
      "Pulse",
      v.pulse === null ? null : String(v.pulse),
      "/min",
      null,
      cls("pulse", v.pulse),
    ),
    row(
      "respiratory_rate",
      "Respiratory rate",
      v.respiratoryRate === null ? null : String(v.respiratoryRate),
      "/min",
      null,
      cls("rr", v.respiratoryRate),
    ),
    row(
      "spo2",
      "SpO₂",
      v.spo2 === null ? null : String(v.spo2),
      "%",
      v.oxygen === null
        ? { text: "Air or oxygen?", caution: true }
        : { text: v.oxygen === "oxygen" ? "on oxygen" : "on air", caution: false },
      cls("spo2", v.spo2),
    ),
    row(
      "temperature",
      "Temperature",
      v.temperature === null ? null : v.temperature.toFixed(1),
      "°C",
      null,
      cls("temp", v.temperature),
    ),
    row(
      "consciousness",
      "Consciousness",
      v.consciousness ? (ACVPU_WORD[v.consciousness] ?? v.consciousness) : null,
      "",
    ),
    ...(glucose
      ? [
          {
            key: "glucose",
            label: glucose.label,
            value: glucose.value,
            unit: glucose.unit ?? "",
            points: null,
            arrow: null,
            note: { text: "Random or fasting?", caution: true },
            cls: cls("glucose", glucose.value),
          },
        ]
      : []),
  ];
  const three = news2.parameters
    .filter((x) => x.parameter !== "supplemental_oxygen" && x.present && x.points === 3)
    .map((x) => {
      if (x.parameter === "consciousness") return "Consciousness below alert";
      const r = rows.find((y) => y.key === x.parameter);
      return `${r?.label ?? x.parameter} ${r?.value ?? x.value}${r?.unit ? ` ${r.unit}` : ""}`;
    });
  const missing = news2.missing.map((m) => MISSING_WORDS[m] ?? m);
  return {
    rows,
    news2,
    chip: `NEWS2 ${news2.total}${news2.provisional ? ", incomplete" : ""}`,
    message: three.length
      ? `${list(three)} ${three.length === 1 ? "scores 3 on its own" : "each score 3"}. Re-measure now.`
      : null,
    missing: missing.length ? `Missing: ${list(missing)}.` : null,
  };
}

/** Exam classifier tones in the rail's words: never red (the exam's "strong" stays amber). */
const fromExam = (r: ClassifierResult | undefined): VitalClass | null =>
  r?.status === "result" && r.text
    ? {
        label: r.text,
        tone: r.tone === "ok" || r.tone === "neutral" ? "normal" : "caution",
        scheme: r.label,
      }
    : null;

/**
 * Weight, height, BMI and waist from the chart's newest readings, one row for each that is recorded. BMI and
 * waist carry the examination's own classifiers (WHO BMI class, waist risk) when `x` is loaded and
 * the classifier is signed; no new thresholds.
 */
export function bodyRows(
  latest: VitalValues,
  x?: ExamContext | null,
  signoff?: ExamSignoff,
): VitalRow[] {
  const sx = x ? { ...x, vitals: latest } : null;
  const live = (r: ClassifierResult) =>
    sx && signoff && classifierIsLive(sx, r.id, signoff) ? fromExam(r) : null;
  const bmi = bmiOf(latest.weight, latest.height);
  const r = (
    key: string,
    label: string,
    value: number | null,
    unit: string,
    cls: VitalClass | null = null,
  ): VitalRow[] =>
    value === null
      ? []
      : [{ key, label, value: String(value), unit, points: null, arrow: null, note: null, cls }];
  return [
    ...r("weight", "Weight", latest.weight, "kg"),
    ...r("height", "Height", latest.height, "cm"),
    ...r("bmi", "BMI", bmi, "kg/m²", sx ? live(bmiClass(sx)) : null),
    ...r("waist", "Waist", latest.waist, "cm", sx ? live(waistRisk(sx)) : null),
  ];
}

/* ─── Keyboard (§5.13, H9) ─────────────────────────────────────── */

export type ClerkingKeyAction =
  | { type: "section"; index: number }
  | { type: "sign" }
  | { type: "help" }
  | { type: "search" }
  | { type: "answer"; answer: YesNo }
  | { type: "details" };

/**
 * One key → one desk action, or null. Off inside text fields except the sign chord. y, n and d act
 * only when focus sits in a yes/no row (the Details button lives in the row, Phase 5).
 */
export function clerkingKey(
  e: KeyInput & { inYesNo?: boolean },
  at: { current: number; count: number },
): ClerkingKeyAction | null {
  const mod = !!(e.ctrlKey || e.metaKey);
  if (e.key === "Enter" && mod && !e.altKey) return { type: "sign" };
  if (e.altKey || mod || e.inField) return null;
  if (e.key === "?") return { type: "help" };
  if (e.key === "/") return { type: "search" };
  const step = (d: number) => {
    const index = Math.min(at.count - 1, Math.max(0, at.current + d));
    return index === at.current ? null : { type: "section" as const, index };
  };
  if (e.key === "]" || e.key === "j") return step(1);
  if (e.key === "[" || e.key === "k") return step(-1);
  if (/^[0-9]$/.test(e.key)) {
    const index = e.key === "0" ? 9 : Number(e.key) - 1;
    return index < at.count && index !== at.current ? { type: "section", index } : null;
  }
  if (e.inYesNo && (e.key === "y" || e.key === "n"))
    return { type: "answer", answer: e.key === "y" ? "yes" : "no" };
  if (e.inYesNo && e.key === "d") return { type: "details" };
  return null;
}

export const CLERKING_KEY_HELP: readonly [string, string][] = [
  ["[ and ]", "Previous or next section (j and k also work)"],
  ["1 to 9, 0", "Go to that step (0 is step 10)"],
  ["y / n", "Answer the focused yes or no question"],
  ["d", "Open the details of the focused answer"],
  ["/", "Search complaints"],
  ["Ctrl or ⌘ + Enter", "Sign note"],
  ["?", "Show these keys"],
  ["Examination: [ and ]", "Previous or next part"],
  ["Examination: { and }", "Previous or next system"],
  ["Examination: a / p", "The negative or positive answer of the focused row"],
  ["Examination: e", "Everything else normal (asks first)"],
  ["Examination: x", "Not examined"],
  ["Examination: g", "Go to consciousness (GCS)"],
  ["Summary: r", "Mark as reviewed"],
  ["Impression: /", "Add a diagnosis"],
  ["Impression: m", "List or evidence matrix"],
  ["Impression: l / p / u", "Likely, possible or unlikely on the focused row"],
  ["Impression: Alt + ↑ / ↓", "Move the focused row"],
  ["Impression: d", "Details of the focused row"],
  ["Matrix: arrow keys", "Move between cells"],
  ["Matrix: Space", "Change the focused cell"],
  ["Matrix: a", "Accept the focused column's suggestions"],
  ["Esc", "Close Details (focus returns to where it opened)"],
];

/* ─── "Show all" complaints (Complaint quality of life) ──────────── */

export interface ComplaintGroup {
  id: string;
  label: string;
  symptoms: Symptom[];
}

/**
 * Every symptom the catalogue offers as a complaint, for this patient's sex, grouped by body system
 * in the catalogue's review-of-systems order (its own groups and placements). Each symptom appears
 * once: in the first group that lists it, else under its first system, else "Other". Pure.
 */
export function complaintGroups(cat: Catalogue, sex: PatientSex): ComplaintGroup[] {
  const offered = cat.symptoms.filter(
    (s) => s.offer_as_complaint && appliesTo(s.applies_to_sex, sex),
  );
  const systems = rosSystemsFor(cat, sex);
  const labelOf = new Map(cat.data.review_of_systems.systems.map((s) => [s.id, s.label]));
  const placed = new Map<string, string>();
  for (const sys of systems)
    for (const s of sys.items) if (!placed.has(s.id)) placed.set(s.id, sys.id);
  const groups = new Map<string, ComplaintGroup>(
    systems.map((s) => [s.id, { id: s.id, label: s.label, symptoms: [] }]),
  );
  for (const s of offered) {
    const id = placed.get(s.id) ?? s.systems.find((x) => groups.has(x)) ?? "other";
    if (!groups.has(id)) groups.set(id, { id, label: labelOf.get(id) ?? "Other", symptoms: [] });
    groups.get(id)!.symptoms.push(s);
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      symptoms: [...g.symptoms].sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .filter((g) => g.symptoms.length > 0);
}
