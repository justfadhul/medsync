import type { AllergyRow, AssertionRow } from "./allergy";
import type { OrderDerivation } from "./orders";
import type { CriticalRef } from "./reference/critical";
import type { PregnancyAgeRange } from "./reference/pregnancy";
import type { AckState, ResultValue } from "./results";
import type { ClinicalNote, ClinicalNoteEvent } from "@/db/schema/emr";
import type { Encounter } from "@/db/schema/scheduling";
import type { ConceptDef } from "@/lib/facts/catalogue.generated";
import type {
  AllergyFact,
  ClinicalFact,
  ConditionFact,
  FactSnapshot,
  MedicationFact,
  ObservationFact,
  PregnancyFact,
} from "@/lib/facts/types";
import type { RefEntry } from "@/lib/resus/reference/ref";
import type { FlowDeath } from "@/lib/workspace/flow";

import { CONCEPTS } from "@/lib/facts/catalogue.generated";
import { DEFAULT_TIME_ZONE } from "@/supabase/functions/_shared/slots";
import { resolveAllergyStatus } from "./allergy";
import { encounterLifecycle, readDisposition } from "./encounter";
import { NOTE_TEMPLATES, noteStatus, threadNotes } from "./notes";
import { orderStatusText } from "./orders";
import { REF_PREG_AGE } from "./reference/pregnancy";
import { detectCritical, labFlag } from "./results";
import { unitWords } from "./unit-words";

/**
 * The chart and safety-bar payload (PROMPT §5.1–5.2, gate-a-proposal E.1/E.2). PURE: the route
 * loads the snapshot and rows, this module turns them into display-ready words, and the `*View`
 * components render them without deciding anything.
 *
 * Every item carries `restricted`. `toPatientFacing` removes every restricted item and recomputes
 * what was derived from them, so a restricted fact never reaches a patient-facing payload
 * (property-tested). Missing is never shown as normal: allergy "not recorded" stays "not recorded",
 * a value with no laboratory range has no flag, and the pregnancy line is absent (not "not
 * recorded") while REF-PREG-AGE is pending.
 */

/* ─── Input ───────────────────────────────────────────────────────── */

type Sensitivity = string;

export interface ChartPatient {
  name: string;
  mrn: string;
  ageYears: number | null;
  /** patient_profiles.sex as stored. */
  sex: string | null;
}
export type ChartEncounterInput = Pick<
  Encounter,
  | "id"
  | "hospitalId"
  | "encounterType"
  | "state"
  | "closureKind"
  | "startedAt"
  | "endedAt"
  | "disposition"
> & {
  sensitivity?: Sensitivity;
  /** Why it was closed; required when entered in error. */ closureReason?: string | null;
};
export interface ChartOrderInput {
  derivation: OrderDerivation;
  kind: string;
  /** The test or order text. */
  display: string;
  priority: string | null;
  orderedAt: Date;
  sensitivity: Sensitivity;
}
/** One diagnostic report (current version), summarised by lib/emr/results. */
export interface ChartResultInput {
  reportId: string;
  display: string;
  issuedAt: Date;
  ack: AckState;
  /** detectCritical over its values: signed entries only, so false until one is signed. */
  critical: boolean;
  sensitivity: Sensitivity;
}
export type ChartNoteInput = Pick<
  ClinicalNote,
  | "id"
  | "noteType"
  | "templateId"
  | "state"
  | "authorUserId"
  | "authorCadre"
  | "addendumTo"
  | "signedAt"
  | "recordedAt"
  | "effectiveAt"
  | "lateEntry"
  | "sensitivity"
>;
export type ChartNoteEventInput = Pick<
  ClinicalNoteEvent,
  "id" | "noteId" | "kind" | "actorUserId" | "cosignRequestId" | "recordedAt" | "reasonCode"
> & { /** The decrypted reason, when the reader may see it. */ reasonText?: string | null };

export interface ChartInput {
  patient: ChartPatient;
  snapshot: FactSnapshot;
  encounters: readonly ChartEncounterInput[];
  orders: readonly ChartOrderInput[];
  results: readonly ChartResultInput[];
  notes: readonly ChartNoteInput[];
  noteEvents?: readonly ChartNoteEventInput[];
  /** lib/workspace/queries.ts deathsFor, this patient's newest. */
  death: FlowDeath | null;
  /** userId → display name, for authors and asserters. */
  names?: Readonly<Record<string, string>>;
  /** Entered-in-error reasons by source row id (provenance.rowId), decrypted when the reader may
   *  see them. The snapshot carries the voided facts themselves (loadFactSnapshot keepEnteredInError). */
  eieReasons?: Readonly<Record<string, { code: string | null; text: string | null }>>;
  timeZone?: string;
  /** Test seams; production reads the shipped (pending) entries. */
  criticalRefs?: readonly CriticalRef[];
  pregnancyAgeRef?: RefEntry & { data?: PregnancyAgeRange };
}

/* ─── Payload ─────────────────────────────────────────────────────── */

export type Tone = "neutral" | "caution" | "critical";
interface Item {
  id: string;
  restricted: boolean;
}
export type AllergyState =
  | "listed"
  | "no_known_drug_allergies"
  | "unable_to_assess"
  | "not_recorded";
export interface AllergyItem extends Item {
  text: string;
  byNameOnly: boolean;
  hospitalIds: string[];
}
export interface AllergyLine {
  state: AllergyState;
  text: string;
  tone: Tone;
  items: AllergyItem[];
}
export interface ProblemItem extends Item {
  conceptId: string;
  display: string;
  since: string | null;
}
export interface MedicineItem extends Item {
  display: string;
  status: string;
}
export interface EncounterItem extends Item {
  at: string;
  title: string;
  detail: string;
}
export interface ResultItem extends Item {
  conceptId: string;
  display: string;
  at: string;
  value: string;
  /** The laboratory's own flag as words, or null: no range means no flag, never "normal". */
  flag: string | null;
  abnormal: boolean;
  critical: boolean;
}
export interface OrderItem extends Item {
  display: string;
  status: string;
  tone: Tone;
  priority: string | null;
  at: string;
}
export type TimelineKind =
  | "encounter"
  | "note"
  | "result"
  | "order"
  | "procedure"
  | "entered_in_error";
export interface TimelineItem extends Item {
  kind: TimelineKind;
  at: string;
  title: string;
  detail: string;
  /** Entered in error: shown struck through, the reason in `detail`. */
  struck?: boolean;
}
/** A voided fact, kept visible in its section's history (Law 4): struck, with its reason. */
export interface EnteredInErrorItem extends Item {
  section: "problems" | "allergies" | "medicines" | "results" | "other";
  at: string;
  title: string;
  reason: string;
}
export interface FlowCell extends Item {
  date: string;
  at: string;
  value: string;
  flag: string | null;
  critical: boolean;
}
export interface SeriesPoint extends Item {
  at: string;
  value: number;
}
export interface FlowRow {
  conceptId: string;
  display: string;
  unit: string | null;
  cells: FlowCell[];
  /** Canonical numeric values, oldest first, for the sparkline. */
  series: SeriesPoint[];
}
export interface NoteItem extends Item {
  title: string;
  author: string;
  at: string;
  status: string;
  statusText: string;
  struck: boolean;
  eieReason: string | null;
  lateEntry: boolean;
  addenda: NoteItem[];
}
export interface SafetyBar {
  name: string;
  mrn: string;
  ageSex: string;
  allergy: AllergyLine;
  /** Absent unless a pregnancy fact exists or REF-PREG-AGE is signed and applies. */
  pregnancy: (Item & { text: string; tone: Tone }) | null;
  deceased: { text: string; at: string } | null;
  /** Clinical actions launched from the bar; removed for a deceased patient. */
  actionsAllowed: boolean;
  problems: ProblemItem[];
  moreProblems: number;
  criticalUnacknowledged: (Item & { display: string })[];
  criticalText: string | null;
  /** Lock + word: the chart holds content that never leaves clinical views. Reveals nothing. */
  restricted: boolean;
  /** Read first by a screen reader (E.1 ②). */
  accessibleSummary: string;
}
export interface ChartPayload {
  audience: "clinician" | "patient";
  safetyBar: SafetyBar;
  summary: {
    problems: ProblemItem[];
    allergies: AllergyLine;
    medicines: MedicineItem[];
    encounters: EncounterItem[];
    results: ResultItem[];
    pendingOrders: OrderItem[];
  };
  timeline: TimelineItem[];
  flowsheet: { dates: string[]; rows: FlowRow[] };
  notes: NoteItem[];
  /** Newest first. Clinician views only: toPatientFacing empties it. */
  enteredInError: EnteredInErrorItem[];
}

/* ─── Words ───────────────────────────────────────────────────────── */

const TOP_PROBLEMS = 3;
const LAST_ENCOUNTERS = 3;
const RECENT_RESULTS = 10; // ponytail: a fixed cut for the summary card; the Results section shows all

const def = (id: string): ConceptDef | undefined => (CONCEPTS as Record<string, ConceptDef>)[id];
const display = (id: string) => def(id)?.display ?? id;
const humanise = (s: string) => {
  const t = s.replace(/_/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const iso = (d: Date) => d.toISOString();
const effectiveAt = (f: ClinicalFact) => ("at" in f.effective ? f.effective.at : f.effective.start);
const isRestricted = (s: string | undefined) => s === "restricted";
const live = (f: ClinicalFact) => f.status !== "entered_in_error" && f.status !== "cancelled";

function formatters(timeZone: string) {
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  });
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  });
  const day = new Intl.DateTimeFormat("en-CA", { timeZone }); // yyyy-mm-dd
  return {
    date: (d: Date | string) => date.format(new Date(d)),
    time: (d: Date | string) => time.format(new Date(d)),
    day: (d: Date | string) => day.format(new Date(d)),
  };
}
type Fmt = ReturnType<typeof formatters>;

const SEX_WORDS: Record<string, string> = {
  female: "Female",
  f: "Female",
  male: "Male",
  m: "Male",
  intersex: "Intersex",
};
function ageSex(p: ChartPatient): string {
  const age = p.ageYears === null ? "Age not recorded" : `${p.ageYears} y`;
  const sex = (p.sex && SEX_WORDS[p.sex.toLowerCase()]) ?? "Sex not recorded";
  return `${age} · ${sex}`;
}

function valueText(f: ObservationFact): string {
  const v = f.value;
  if (v.type === "quantity") {
    const unit = unitWords(v.unit);
    return `${v.comparator ?? ""}${v.value}${unit ? ` ${unit}` : ""}`;
  }
  if (v.type === "coded") return humanise(v.code);
  return v.value ? "Yes" : "No";
}

/** The fact as lib/emr/results reads a stored value. */
function resultValue(f: ObservationFact): ResultValue {
  const v = f.value;
  const q = v.type === "quantity" ? v : null;
  return {
    conceptId: f.concept,
    valueNum: q ? String(q.value) : null,
    valueComparator: q?.comparator ?? null,
    valueUnit: q?.unit ?? null,
    valueCanonical: q ? String(q.canonical.value) : null,
    context: f.context,
  };
}

/* ─── Allergies ───────────────────────────────────────────────────── */

function allergyRow(f: AllergyFact): AllergyRow {
  return {
    id: f.provenance.rowId,
    logicalId: f.logicalId,
    version: f.provenance.version,
    hospitalId: f.tenantId,
    status: f.status,
    substanceKind: f.substance.kind ?? null,
    substanceCode: f.substance.code ?? null,
    criticality: f.criticality ?? null,
    severity: f.severity ?? null,
    manifestations: f.manifestations,
    clinicalStatus: f.clinicalStatus,
    verification: f.verification,
    effectiveAt: new Date(effectiveAt(f)),
    recordedAt: new Date(f.recordedAt),
    informant: f.informant,
    substanceText: f.substance.text ?? null,
  };
}

function allergyItemText(r: AllergyRow): string {
  const substance =
    r.substanceText?.trim() ||
    (r.substanceCode ? humanise(r.substanceCode) : "Substance not named");
  const bits = [
    r.manifestations.length
      ? r.manifestations.map((m) => humanise(m).toLowerCase()).join(", ")
      : null,
    r.criticality === "high" ? "high" : null,
    r.verification === "confirmed" ? "confirmed" : null,
  ].filter((b): b is string => b !== null);
  return `${substance}${bits.length ? ` — ${bits.join(", ")}` : ""}${r.substanceCode ? "" : " · by name only"}`;
}

const NOT_RECORDED: AllergyLine = {
  state: "not_recorded",
  text: "Allergy status not recorded",
  tone: "caution",
  items: [],
};
const listedLine = (items: AllergyItem[]): AllergyLine =>
  items.length === 0
    ? NOT_RECORDED
    : { state: "listed", text: items.map((i) => i.text).join("; "), tone: "neutral", items };

function allergyLine(snapshot: FactSnapshot, names: Record<string, string>, fmt: Fmt): AllergyLine {
  const facts = snapshot.facts.filter((f): f is AllergyFact => f.kind === "allergy");
  const byRow = new Map(facts.map((f) => [f.provenance.rowId, f]));
  const assertions: AssertionRow[] = (snapshot.allergyAssertions ?? []).map((a) => ({
    id: a.id,
    hospitalId: a.tenantId,
    assertion: a.state,
    assertedByUserId: a.assertedBy,
    asserterCadre: null,
    assertedAt: new Date(a.assertedAt),
    recordedAt: new Date(a.recordedAt),
    status: a.status,
    supersedesId: a.supersedesId ?? null,
  }));
  const status = resolveAllergyStatus(facts.map(allergyRow), assertions);
  switch (status.kind) {
    case "listed":
      return listedLine(
        status.allergies.map((g) => ({
          id: byRow.get(g.allergy.id)!.id,
          // Grouped records of one substance: restricted if any is, so none leaks through a group.
          restricted: [g.allergy, ...g.duplicates].some((r) =>
            isRestricted(byRow.get(r.id)?.sensitivity),
          ),
          text: allergyItemText(g.allergy),
          byNameOnly: !g.coded,
          hospitalIds: g.hospitalIds,
        })),
      );
    case "no_known_drug_allergies":
      return {
        state: status.kind,
        text: `No known drug allergies — confirmed by ${names[status.assertedByUserId] ?? "a clinician"}, ${fmt.date(status.assertedAt)}`,
        tone: "neutral",
        items: [],
      };
    case "unable_to_assess":
      return {
        state: status.kind,
        text: `Unable to assess — recorded ${fmt.time(status.assertedAt)}, ${fmt.date(status.assertedAt)}`,
        tone: "caution",
        items: [],
      };
    case "not_recorded":
      return NOT_RECORDED;
  }
}

/* ─── Pregnancy ───────────────────────────────────────────────────── */

function pregnancyLine(
  input: ChartInput,
  facts: readonly ClinicalFact[],
  fmt: Fmt,
): SafetyBar["pregnancy"] {
  const preg = facts.filter((f): f is PregnancyFact => f.kind === "pregnancy");
  const latest = preg
    .filter((f) => f.concept === "preg.status")
    .sort((a, b) => effectiveAt(b).localeCompare(effectiveAt(a)))[0];
  if (latest) {
    const episode = preg.filter((f) => f.episodeId === latest.episodeId);
    const gestation = episode.find((f) => f.gestation)?.gestation;
    const delivered = episode.find((f) => f.deliveredAt)?.deliveredAt;
    const recorded = fmt.date(effectiveAt(latest));
    const text =
      latest.state === "pregnant"
        ? gestation
          ? // Weeks at the date it was recorded; projecting forward would need an unsigned rule.
            `Pregnant — ${Math.floor(gestation.days / 7)} weeks on ${fmt.date(gestation.asOf)}`
          : `Pregnant — gestation not recorded (${recorded})`
        : latest.state === "postpartum"
          ? `Postpartum${delivered ? ` — delivered ${fmt.date(delivered)}` : ` (recorded ${recorded})`}`
          : latest.state === "not_pregnant"
            ? `Not pregnant (recorded ${recorded})`
            : `Pregnancy status unknown (recorded ${recorded})`;
    return {
      id: latest.id,
      restricted: episode.some((f) => isRestricted(f.sensitivity)),
      text,
      tone: latest.state === "unknown" ? "caution" : "neutral",
    };
  }
  // No record: prompt only when the signed age range says so. Pending → no line at all.
  const ref = input.pregnancyAgeRef ?? REF_PREG_AGE;
  const range = ref.status === "signed" ? ref.data : undefined;
  const demo = facts.find((f) => f.kind === "demographic");
  const female =
    demo?.kind === "demographic"
      ? demo.sexAtBirth === "female"
      : SEX_WORDS[input.patient.sex?.toLowerCase() ?? ""] === "Female";
  const age = input.patient.ageYears;
  if (!range || !female || age === null || age < range.fromYears || age >= range.toYears)
    return null;
  return {
    id: "pregnancy:not_recorded",
    restricted: false,
    text: "Pregnancy status not recorded",
    tone: "caution",
  };
}

/* ─── Build ───────────────────────────────────────────────────────── */

const ACTIVE_CONDITION = new Set(["active", "recurrence", "relapse"]);
const VERIFICATION_RANK: Record<string, number> = {
  confirmed: 0,
  provisional: 1,
  differential: 2,
  unconfirmed: 3,
};
const ACTIVE_MEDICATION = new Set(["active", "on_hold", "intended"]);
/** Concept groups read as laboratory results in the summary card (vitals and exam are not). */
const RESULT_GROUPS = new Set([
  "acid_base",
  "cardiac",
  "chemistry",
  "coagulation",
  "endocrine",
  "glycaemia",
  "haematology",
  "infection",
  "lipids",
  "liver",
  "microbiology",
  "renal",
  "report",
  "urinalysis",
]);
const ABNORMAL = new Set(["L", "H", "LL", "HH", "A"]);

function problems(facts: readonly ClinicalFact[]): ProblemItem[] {
  const conds = facts
    .filter(
      (f): f is ConditionFact =>
        f.kind === "condition" &&
        f.subject === "self" &&
        ACTIVE_CONDITION.has(f.clinicalStatus) &&
        f.verification !== "refuted" &&
        f.verification !== "entered_in_error",
    )
    .sort(
      (a, b) =>
        (VERIFICATION_RANK[a.verification] ?? 9) - (VERIFICATION_RANK[b.verification] ?? 9) ||
        effectiveAt(a).localeCompare(effectiveAt(b)) ||
        a.id.localeCompare(b.id),
    );
  // One chip per concept; a restricted and a standard record never share one.
  const seen = new Set<string>();
  const out: ProblemItem[] = [];
  for (const f of conds) {
    const key = `${f.concept}|${f.sensitivity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const onset = typeof f.onset === "string" ? f.onset : effectiveAt(f);
    out.push({
      id: f.id,
      restricted: isRestricted(f.sensitivity),
      conceptId: f.concept,
      display: display(f.concept),
      since: onset.slice(0, 4),
    });
  }
  return out;
}

function encounterItem(e: ChartEncounterInput, fmt: Fmt): EncounterItem {
  const lifecycle = encounterLifecycle(e);
  let disposition: string | null = null;
  try {
    const d = readDisposition(e.disposition);
    disposition = d ? humanise(d.code ?? d.stored) : null;
  } catch {
    disposition = e.disposition; // an unknown value is shown as stored, never dropped
  }
  const type = e.encounterType === "opd" ? "OPD" : humanise(e.encounterType);
  return {
    id: e.id,
    restricted: isRestricted(e.sensitivity),
    at: iso(e.startedAt),
    title: `${fmt.date(e.startedAt)} · ${type}`,
    detail: [humanise(lifecycle), disposition].filter(Boolean).join(" · "),
  };
}

function orderItem(o: ChartOrderInput): OrderItem {
  const s = o.derivation.status;
  return {
    id: o.derivation.orderId,
    restricted: isRestricted(o.sensitivity),
    display: o.display,
    status: orderStatusText(s, o.kind),
    tone: s.state === "active" && s.rejection ? "caution" : "neutral",
    priority: o.priority,
    at: iso(o.orderedAt),
  };
}

const NOTE_STATUS_TEXT: Record<string, string> = {
  signed: "Signed",
  awaiting_cosign: "Awaiting co-signature",
  cosigned: "Co-signed",
  entered_in_error: "Entered in error",
};
const templateTitle = (id: string, noteType: string) =>
  NOTE_TEMPLATES.templates.find((t) => t.id === id)?.title ?? humanise(noteType);

function notesList(input: ChartInput, names: Record<string, string>): NoteItem[] {
  // Drafts belong to their author's desk, not the chart.
  const signed = input.notes.filter((n) => n.state === "signed");
  const events = input.noteEvents ?? [];
  const build = (
    t: ReturnType<typeof threadNotes<ChartNoteInput>>[number],
    parentRestricted: boolean,
  ): NoteItem => {
    const n = t.note;
    const mine = events.filter((e) => e.noteId === n.id);
    const { status } = noteStatus(n, mine);
    const eie =
      status === "entered_in_error"
        ? mine.filter((e) => e.kind === "entered_in_error").at(-1)
        : undefined;
    const eieReason = eie
      ? eie.reasonText?.trim() || (eie.reasonCode ? humanise(eie.reasonCode) : "reason recorded")
      : null;
    const restricted = parentRestricted || isRestricted(n.sensitivity);
    const at = n.signedAt ?? n.recordedAt;
    const title = n.addendumTo ? "Addendum" : templateTitle(n.templateId, n.noteType);
    return {
      id: n.id,
      restricted,
      title,
      author: `${names[n.authorUserId] ?? "Unknown author"} (${n.authorCadre})`,
      at: iso(at),
      status,
      statusText: `${eieReason ? `Entered in error — ${eieReason}` : (NOTE_STATUS_TEXT[status] ?? humanise(status))}${n.lateEntry ? " · Late entry" : ""}`,
      struck: status === "entered_in_error",
      eieReason,
      lateEntry: n.lateEntry,
      // An addendum under a restricted note is restricted too.
      addenda: t.addenda.map((a) => build(a, restricted)),
    };
  };
  // Newest first at the top level; addenda stay oldest first under their parent.
  return threadNotes([...signed])
    .map((t) => build(t, false))
    .reverse();
}

const EIE_SECTION: Partial<Record<ClinicalFact["kind"], EnteredInErrorItem["section"]>> = {
  condition: "problems",
  allergy: "allergies",
  medication: "medicines",
  observation: "results",
  procedure: "other",
  pregnancy: "other",
};

function eieWords(r: { code: string | null; text: string | null } | undefined): string {
  return r?.text?.trim() || (r?.code ? humanise(r.code) : "Reason not recorded");
}

function enteredInErrorList(input: ChartInput): EnteredInErrorItem[] {
  return input.snapshot.facts
    .filter((f) => f.status === "entered_in_error" && EIE_SECTION[f.kind])
    .map((f) => ({
      id: f.id,
      restricted: isRestricted(f.sensitivity),
      section: EIE_SECTION[f.kind]!,
      at: effectiveAt(f),
      title:
        f.kind === "observation"
          ? `${display(f.concept)} ${valueText(f)}`
          : f.kind === "allergy"
            ? f.substance.text?.trim() ||
              (f.substance.code ? humanise(f.substance.code) : "Substance not named")
            : f.kind === "medication"
              ? f.drug
                ? humanise(f.drug)
                : "Medicine not named"
              : f.kind === "pregnancy"
                ? "Pregnancy record"
                : display(f.concept),
      reason: eieWords(input.eieReasons?.[f.provenance.rowId]),
    }))
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

function flowsheet(
  obs: readonly ObservationFact[],
  input: ChartInput,
  fmt: Fmt,
): ChartPayload["flowsheet"] {
  const rows = new Map<string, FlowRow>();
  for (const f of [...obs].sort(
    (a, b) => effectiveAt(a).localeCompare(effectiveAt(b)) || a.id.localeCompare(b.id),
  )) {
    const at = effectiveAt(f);
    const row =
      rows.get(f.concept) ??
      rows
        .set(f.concept, {
          conceptId: f.concept,
          display: display(f.concept),
          unit: unitWords(def(f.concept)?.canonicalUnit),
          cells: [],
          series: [],
        })
        .get(f.concept)!;
    const rv = resultValue(f);
    const restricted = isRestricted(f.sensitivity);
    row.cells.push({
      id: f.id,
      restricted,
      date: fmt.day(at),
      at,
      value: valueText(f),
      flag: labFlag(rv).text,
      critical: detectCritical(rv, input.criticalRefs).isCritical,
    });
    if (f.value.type === "quantity")
      row.series.push({ id: f.id, restricted, at, value: f.value.canonical.value });
  }
  return flowsheetOf([...rows.values()].sort((a, b) => a.display.localeCompare(b.display)));
}
const flowsheetOf = (rows: FlowRow[]): ChartPayload["flowsheet"] => ({
  dates: [...new Set(rows.flatMap((r) => r.cells.map((c) => c.date)))].sort(),
  rows,
});

export function buildChartPayload(input: ChartInput): ChartPayload {
  const fmt = formatters(input.timeZone ?? DEFAULT_TIME_ZONE);
  const names = input.names ?? {};
  const facts = input.snapshot.facts.filter(live);
  const obs = facts.filter((f): f is ObservationFact => f.kind === "observation");

  const allergy = allergyLine(input.snapshot, names, fmt);
  const problemItems = problems(facts);
  const medicines: MedicineItem[] = facts
    .filter(
      (f): f is MedicationFact =>
        f.kind === "medication" && ACTIVE_MEDICATION.has(f.medicationStatus),
    )
    .sort((a, b) => a.drug.localeCompare(b.drug))
    .map((f) => ({
      id: f.id,
      restricted: isRestricted(f.sensitivity),
      display: f.drug ? humanise(f.drug) : "Medicine not named",
      status: humanise(f.medicationStatus),
    }));

  const encounters = input.encounters
    .filter((e) => e.state !== "entered_in_error")
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .map((e) => encounterItem(e, fmt));
  const enteredInError = enteredInErrorList(input);

  // Recent results: the newest value per concept, critical first, then abnormal, then newest.
  const newest = new Map<string, ObservationFact>();
  for (const f of obs) {
    if (!RESULT_GROUPS.has(def(f.concept)?.group ?? "")) continue;
    const key = `${f.concept}|${f.sensitivity}`;
    const cur = newest.get(key);
    if (!cur || effectiveAt(f) > effectiveAt(cur)) newest.set(key, f);
  }
  const results: ResultItem[] = [...newest.values()]
    .map((f) => {
      const rv = resultValue(f);
      const flag = labFlag(rv);
      return {
        id: f.id,
        restricted: isRestricted(f.sensitivity),
        conceptId: f.concept,
        display: display(f.concept),
        at: effectiveAt(f),
        value: valueText(f),
        flag: flag.text,
        abnormal: flag.flag !== null && ABNORMAL.has(flag.flag),
        critical: detectCritical(rv, input.criticalRefs).isCritical,
      };
    })
    .sort(
      (a, b) =>
        Number(b.critical) - Number(a.critical) ||
        Number(b.abnormal) - Number(a.abnormal) ||
        b.at.localeCompare(a.at) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, RECENT_RESULTS);

  const orders = [...input.orders].sort((a, b) => b.orderedAt.getTime() - a.orderedAt.getTime());
  const pendingOrders = orders
    .filter((o) => o.derivation.open && o.derivation.status.state !== "resulted")
    .map(orderItem);

  const criticalUnacknowledged = input.results
    .filter((r) => r.critical && r.ack.kind !== "acknowledged" && r.ack.kind !== "withdrawn")
    .map((r) => ({ id: r.reportId, restricted: isRestricted(r.sensitivity), display: r.display }));

  const notes = notesList(input, names);

  const timeline: TimelineItem[] = [
    ...encounters.map((e) => ({ ...e, kind: "encounter" as const })),
    // A voided encounter leaves the summary but stays in the Timeline, struck, with its reason.
    ...input.encounters
      .filter((e) => e.state === "entered_in_error")
      .map((e) => ({
        ...encounterItem(e, fmt),
        kind: "encounter" as const,
        detail: `Entered in error — ${eieWords({ code: e.closureReason ?? null, text: null })}`,
        struck: true,
      })),
    ...enteredInError.map((i) => ({
      id: i.id,
      restricted: i.restricted,
      kind: "entered_in_error" as const,
      at: i.at,
      title: i.title,
      detail: `Entered in error — ${i.reason}`,
      struck: true,
    })),
    ...flattenNotes(notes).map((n) => ({
      id: n.id,
      restricted: n.restricted,
      kind: "note" as const,
      at: n.at,
      title: n.title,
      detail: n.statusText,
      ...(n.struck ? { struck: true } : {}),
    })),
    ...input.results.map((r) => ({
      id: r.reportId,
      restricted: isRestricted(r.sensitivity),
      kind: "result" as const,
      at: iso(r.issuedAt),
      title: r.display,
      detail: r.ack.kind === "acknowledged" ? "Acknowledged" : humanise(r.ack.kind),
    })),
    ...orders.map((o) => {
      const item = orderItem(o);
      return {
        id: item.id,
        restricted: item.restricted,
        kind: "order" as const,
        at: item.at,
        title: item.display,
        detail: item.status,
      };
    }),
    ...facts
      .filter((f) => f.kind === "procedure")
      .map((f) => ({
        id: f.id,
        restricted: isRestricted(f.sensitivity),
        kind: "procedure" as const,
        at: effectiveAt(f),
        title: display(f.concept),
        detail: f.kind === "procedure" ? humanise(f.outcome) : "",
      })),
  ].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));

  const deceased = input.death
    ? {
        text: `Died ${fmt.time(new Date(input.death.atMs))}, ${fmt.date(new Date(input.death.atMs))}`,
        at: new Date(input.death.atMs).toISOString(),
      }
    : null;

  const payload: ChartPayload = {
    audience: "clinician",
    safetyBar: finishBar({
      name: input.patient.name,
      mrn: input.patient.mrn,
      ageSex: ageSex(input.patient),
      allergy,
      pregnancy: pregnancyLine(input, facts, fmt),
      deceased,
      actionsAllowed: deceased === null,
      problems: problemItems,
      moreProblems: 0,
      criticalUnacknowledged,
      criticalText: null,
      restricted: false,
      accessibleSummary: "",
    }),
    summary: {
      problems: problemItems,
      allergies: allergy,
      medicines,
      encounters: encounters.slice(0, LAST_ENCOUNTERS),
      results,
      pendingOrders,
    },
    timeline,
    flowsheet: flowsheet(obs, input, fmt),
    notes,
    enteredInError,
  };
  // The marker: any restricted item anywhere in the payload (it reveals nothing itself).
  payload.safetyBar.restricted =
    input.snapshot.facts.some((f) => isRestricted(f.sensitivity)) ||
    JSON.stringify(payload).includes('"restricted":true');
  return payload;
}

function flattenNotes(notes: readonly NoteItem[]): NoteItem[] {
  return notes.flatMap((n) => [n, ...flattenNotes(n.addenda)]);
}

/** The derived bar fields: top problems, counts, and the sentence a screen reader reads first. */
function finishBar(bar: SafetyBar): SafetyBar {
  const n = bar.criticalUnacknowledged.length;
  const criticalText =
    n === 0 ? null : `${n} critical result${n === 1 ? "" : "s"} awaiting acknowledgement`;
  const top = bar.problems.slice(0, TOP_PROBLEMS);
  const sentence = [
    `${bar.name}, ${bar.ageSex.replace(" · ", ", ")}, MRN ${bar.mrn}.`,
    `Allergies: ${bar.allergy.text}.`,
    bar.pregnancy ? `Pregnancy: ${bar.pregnancy.text}.` : null,
    top.length ? `Active problems: ${top.map((p) => p.display).join(", ")}.` : null,
    bar.deceased ? `${bar.deceased.text}.` : null,
    criticalText ? `${criticalText}.` : null,
  ].filter(Boolean);
  return {
    ...bar,
    problems: top,
    moreProblems: Math.max(0, bar.problems.length - TOP_PROBLEMS),
    criticalText,
    accessibleSummary: sentence.join(" "),
  };
}

/* ─── Patient-facing ──────────────────────────────────────────────── */

const keep = <T extends Item>(xs: readonly T[]): T[] => xs.filter((x) => !x.restricted);
/** A patient sees that a note was withdrawn, never why (the reason is clinical record-keeping). */
const keepNotes = (xs: readonly NoteItem[]): NoteItem[] =>
  keep(xs).map((n) => ({
    ...n,
    ...(n.struck
      ? { eieReason: null, statusText: `Entered in error${n.lateEntry ? " · Late entry" : ""}` }
      : {}),
    addenda: keepNotes(n.addenda),
  }));

/** Allergy line without restricted items. Stripping never turns into "no known allergies": a list
 *  emptied by the filter reads "not recorded", the honest word for what this reader can see. */
function patientAllergy(line: AllergyLine): AllergyLine {
  return line.state === "listed" ? listedLine(keep(line.items)) : line;
}

/** Every restricted item removed, and everything derived from them recomputed. */
export function toPatientFacing(p: ChartPayload): ChartPayload {
  const allergies = patientAllergy(p.summary.allergies);
  const problemsKept = keep(p.summary.problems);
  const bar = p.safetyBar;
  return {
    audience: "patient",
    safetyBar: finishBar({
      ...bar,
      allergy: allergies,
      pregnancy: bar.pregnancy && !bar.pregnancy.restricted ? bar.pregnancy : null,
      problems: problemsKept,
      criticalUnacknowledged: keep(bar.criticalUnacknowledged),
      restricted: false,
    }),
    summary: {
      problems: problemsKept,
      allergies,
      medicines: keep(p.summary.medicines),
      encounters: keep(p.summary.encounters),
      results: keep(p.summary.results),
      pendingOrders: keep(p.summary.pendingOrders),
    },
    // Voided items are clinician-only: the patient's view shows the current record.
    timeline: keep(p.timeline).filter((t) => !t.struck),
    flowsheet: flowsheetOf(
      p.flowsheet.rows
        .map((r) => ({ ...r, cells: keep(r.cells), series: keep(r.series) }))
        .filter((r) => r.cells.length > 0),
    ),
    notes: keepNotes(p.notes),
    enteredInError: [],
  };
}
