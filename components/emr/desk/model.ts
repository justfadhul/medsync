import type { MedicineItem, OrderItem, ProblemItem, SafetyBar, Tone } from "@/lib/emr/chart";
import type { NoteContent, NoteItem, SignRule, SignValidation } from "@/lib/emr/note-rules";

import { validateForSigning } from "@/lib/emr/note-rules";

/**
 * The clerking desk's pure model (UI-BRIEF §3–4, gate-a E.3–E.5, E.11–E.12). No I/O, no React:
 * the payload the loader precomputes, the note-content edits the sections make, the index and its
 * marks, the keyboard map, and the words for save state. The fixture harness and the tests drive
 * all of it without a database or a DOM.
 */

/* ─── Payload ─────────────────────────────────────────────────────── */

export interface DeskSectionDef {
  /** Template section id ("s01") or "ncd" for the NCD module. */
  id: string;
  number: string;
  title: string;
  kind: "structured" | "mixed" | "narrative";
  optional: boolean;
  itemKinds: string[];
}

export interface DeskTemplate {
  id: string;
  version: string;
  title: string;
  sections: DeskSectionDef[];
  minimumToSign: { required: SignRule[]; prompted: SignRule[] };
}

/** A finding token: a symptom_catalog code or a finding concept id (D-CFC-11 [H]). */
export interface FindingToken {
  token: string;
  label: string;
  system?: string | null;
  synonyms?: readonly string[];
}

export interface RosSystem {
  system: string;
  label: string;
  items: FindingToken[];
}

/** One vital sign the desk can record (recordObservations). */
export interface VitalConcept {
  conceptId: string;
  label: string;
  unit: string | null;
  /** Other units the unit table converts from. */
  units: string[];
  /** The concept needs a fasting state (the fasting chip shows). */
  fasting: boolean;
  /** Fixed context the entry adds (a point-of-care glucose is capillary blood). */
  context?: { specimen?: string; pointOfCare?: boolean };
}

export interface ContextVital {
  id: string;
  conceptId: string;
  label: string;
  value: string;
  unit: string | null;
  at: string;
  /** Projected from the triage record: shown, never copied (ᵀ). */
  fromTriage: boolean;
}

export interface TriageContext {
  recordId: string;
  level: number;
  levelWord: string;
  at: string;
  complaint: string | null;
  discriminators: string[];
}

export interface Suggestion {
  /** lib/triage/recommend.ts code ("invx_glucose"); for the resus handover, its proposed order's id. */
  key: string;
  /** Absent: triage. The resus handover's suggestions are proposed orders already on the visit. */
  source?: "resus_handover";
  text: string;
  rationale: string;
  tests: { testId: string; display: string }[];
  state: "open" | "accepted" | "dismissed";
}

export interface DeskOrder {
  id: string;
  display: string;
  statusText: string;
  at: string;
  open: boolean;
}

export interface DeskDiagnosis {
  /** The condition row (current version). */
  id: string;
  display: string;
  code: string | null;
  verification: string;
  rank: string | null;
}

export type ProblemAnswer = "pending" | "confirmed" | "resolved";
export interface CarriedProblem {
  /** conditions.id of the current version. */
  id: string;
  display: string;
  answer: ProblemAnswer;
}

export type MedicineAnswer = "pending" | "continued" | "stopped" | "changed";
export interface CarriedMedicine {
  /** medication_statements.id of the current version. */
  id: string;
  display: string;
  answer: MedicineAnswer;
}

export type NoteStatusWord =
  | "draft"
  | "signed"
  | "awaiting_cosign"
  | "cosigned"
  | "entered_in_error";

export interface DeskNoteRow {
  id: string;
  title: string;
  author: string;
  at: string;
  status: NoteStatusWord;
  statusText: string;
  tone: Tone;
  mine: boolean;
  lateEntry: boolean;
  eieReason: string | null;
  addenda: { id: string; author: string; at: string }[];
  /** The viewer is a senior who is not the author, and a co-signature is open. */
  canCosign: boolean;
  /** Author or supervising senior, and not already in error. */
  canMarkError: boolean;
}

export interface DeskPayload {
  encounter: {
    id: string;
    patientUserId: string;
    state: string;
    open: boolean;
    typeWord: string;
    startedAt: string;
    triageRecordId: string | null;
  };
  /** Two identifiers for every sheet heading. */
  patient: { name: string; mrn: string; ageSex: string };
  safetyBar: SafetyBar;
  template: DeskTemplate;
  /** The viewer's draft; null once their note is signed. */
  draft: { noteId: string | null; revision: number | null; content: NoteContent } | null;
  /** The viewer's signed note of this template on this visit, read-only. */
  signed: { note: DeskNoteRow; content: NoteContent } | null;
  /** Every signed note of this visit, the viewer's included. */
  notes: DeskNoteRow[];
  ros: RosSystem[];
  generalSigns: FindingToken[];
  vitalConcepts: VitalConcept[];
  context: {
    triage: TriageContext | null;
    vitals: ContextVital[];
    results: { id: string; display: string; value: string; flag: string | null; at: string }[];
    pendingOrders: OrderItem[];
    medicines: MedicineItem[];
    problems: ProblemItem[];
  };
  suggestions: Suggestion[];
  carried: { problems: CarriedProblem[]; medicines: CarriedMedicine[] };
  diagnoses: DeskDiagnosis[];
  orders: DeskOrder[];
  /** The allergy editor's coded substances: the formulary's ingredients and classes. */
  substances: { kind: "drug_ingredient" | "drug_class"; code: string; label: string }[];
  /** Pre-computed completion warnings (lib/emr/encounter completionWarnings), in words. */
  completionWarnings: string[];
  viewer: {
    userId: string;
    cadreWord: string;
    senior: boolean;
    /** The viewer's signed notes await a co-signature (intern, D-EMR-03). */
    mustCosign: boolean;
    canFinalDiagnosis: boolean;
  };
  flags: { ncd: boolean; actionsAllowed: boolean };
  links: {
    chart: string;
    results: string;
    orders: string | null;
    print: { summary: string; referral: string; labRequest: string };
  };
  settings: { autosaveDebounceMs: number; closureReasons: readonly string[] };
  serverTime: string;
  timeZone: string;
}

/* ─── Content edits (immutable) ───────────────────────────────────── */

export const EMPTY_CONTENT: NoteContent = { sections: {} };

const sectionOf = (c: NoteContent, sid: string) => c.sections[sid] ?? {};
const withSection = (c: NoteContent, sid: string, s: NoteContent["sections"][string]) => ({
  ...c,
  sections: { ...c.sections, [sid]: s },
});

export function setNarrative(c: NoteContent, sid: string, text: string): NoteContent {
  return withSection(c, sid, { ...sectionOf(c, sid), narrative: text });
}

export function setField(c: NoteContent, sid: string, field: string, value: string): NoteContent {
  const s = sectionOf(c, sid);
  return withSection(c, sid, { ...s, fields: { ...s.fields, [field]: value } });
}

export function itemsOf(c: NoteContent, sid: string, kind?: string): NoteItem[] {
  const items = sectionOf(c, sid).items ?? [];
  return kind ? items.filter((i) => i.kind === kind) : items;
}

/** Replace the item `match` finds (or append it); `null` removes it. */
export function putItem(
  c: NoteContent,
  sid: string,
  match: (i: NoteItem) => boolean,
  item: NoteItem | null,
): NoteContent {
  const s = sectionOf(c, sid);
  const items = s.items ?? [];
  const at = items.findIndex(match);
  const next =
    item === null
      ? items.filter((i) => !match(i))
      : at >= 0
        ? items.map((i, j) => (j === at ? item : i))
        : [...items, item];
  return withSection(c, sid, { ...s, items: next });
}

export type FindingState = "not_asked" | "present" | "absent";

/** One identity per finding: its token, or the words when it has none. */
const keyOf = (i: { kind?: unknown; token?: unknown; label?: unknown }) =>
  typeof i.token === "string" && i.token ? i.token : `text:${String(i.label ?? "")}`;

/** A finding in a list section (history, s02): not asked leaves no item (CFC C3). */
export function findingState(c: NoteContent, sid: string, t: FindingToken): FindingState {
  const f = itemsOf(c, sid, "finding").find((i) => keyOf(i) === keyOf(t));
  return f?.presence === "present" || f?.presence === "absent" ? f.presence : "not_asked";
}

export function setFinding(
  c: NoteContent,
  sid: string,
  t: FindingToken,
  state: FindingState,
): NoteContent {
  const match = (i: NoteItem) => i.kind === "finding" && keyOf(i) === keyOf(t);
  const prev = itemsOf(c, sid).find(match);
  return putItem(
    c,
    sid,
    match,
    state === "not_asked"
      ? null
      : {
          ...prev,
          kind: "finding",
          ...(t.token ? { token: t.token } : {}),
          label: t.label,
          presence: state,
        },
  );
}

/** Findings inside one grid item (the review of systems, s03; general signs in s11). */
type GridKind = "ros_grid" | "exam_finding";
type GridEntry = { token: string; label: string; presence: "present" | "absent"; system?: string };

function gridOf(c: NoteContent, sid: string, kind: GridKind): GridEntry[] {
  const g = itemsOf(c, sid, kind)[0];
  return Array.isArray(g?.items) ? (g.items as GridEntry[]) : [];
}

export function gridState(
  c: NoteContent,
  sid: string,
  kind: GridKind,
  token: string,
): FindingState {
  return gridOf(c, sid, kind).find((e) => e.token === token)?.presence ?? "not_asked";
}

export function setGrid(
  c: NoteContent,
  sid: string,
  kind: GridKind,
  changes: { t: FindingToken; state: FindingState }[],
): NoteContent {
  const byToken = new Map(gridOf(c, sid, kind).map((e) => [e.token, e]));
  for (const { t, state } of changes) {
    if (state === "not_asked") byToken.delete(t.token);
    else
      byToken.set(t.token, {
        token: t.token,
        label: t.label,
        presence: state,
        ...(t.system ? { system: t.system } : {}),
      });
  }
  const entries = [...byToken.values()];
  const base = kind === "exam_finding" ? { kind, group: "general" } : { kind };
  return putItem(
    c,
    sid,
    (i) => i.kind === kind,
    entries.length ? { ...base, items: entries } : null,
  );
}

/** "Mark all as absent": an explicit act, one tap per system; asked items keep their answer. */
export function markSystemAbsent(c: NoteContent, sid: string, sys: RosSystem): NoteContent {
  return setGrid(
    c,
    sid,
    "ros_grid",
    sys.items
      .filter((t) => gridState(c, sid, "ros_grid", t.token) === "not_asked")
      .map((t) => ({ t, state: "absent" as const })),
  );
}

export interface ComplaintItem extends NoteItem {
  kind: "complaint_token";
  token?: string;
  label: string;
  durationDays?: number;
  source?: "triage";
}

export function complaints(c: NoteContent, sid: string): ComplaintItem[] {
  return itemsOf(c, sid, "complaint_token") as ComplaintItem[];
}

export function addComplaint(
  c: NoteContent,
  sid: string,
  t: FindingToken,
  durationDays?: number,
): NoteContent {
  // Words typed with no catalogue token stay in the note (charted once catalogued).
  const item: ComplaintItem = {
    kind: "complaint_token",
    ...(t.token ? { token: t.token } : {}),
    label: t.label,
    ...(durationDays !== undefined ? { durationDays } : {}),
  };
  return putItem(c, sid, (i) => i.kind === "complaint_token" && keyOf(i) === keyOf(item), item);
}

/** Duration in days from what was typed ("3", "3d", "2w", "1m"); null when it cannot be read. */
export function parseDuration(raw: string): number | null {
  const m = /^\s*(\d{1,3})\s*(d|days?|w|weeks?|m|months?|y|years?)?\s*$/i.exec(raw);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? "d").charAt(0).toLowerCase();
  return n * ({ d: 1, w: 7, m: 30, y: 365 } as Record<string, number>)[unit]!;
}

export function durationWords(days: number | undefined): string | null {
  if (days === undefined) return null;
  if (days % 365 === 0 && days >= 365) return `${days / 365} ${days === 365 ? "year" : "years"}`;
  if (days % 30 === 0 && days >= 30) return `${days / 30} ${days === 30 ? "month" : "months"}`;
  if (days % 7 === 0 && days >= 7) return `${days / 7} ${days === 7 ? "week" : "weeks"}`;
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * What the draft starts with (PROMPT §5.12): the triage complaint as a complaint item with its
 * source mark, zero taps. Vital signs are not copied — the loader shows them from the record.
 */
export function initialContent(
  template: Pick<DeskTemplate, "sections">,
  triageComplaint: string | null | undefined,
): NoteContent {
  const text = triageComplaint?.trim();
  const sid = sectionWith(template, "complaint_token");
  if (!text || !sid) return { sections: {} };
  return {
    sections: { [sid]: { items: [{ kind: "complaint_token", label: text, source: "triage" }] } },
  };
}

/** The two clerking forms the desk switches between (clinical reference §2.1, §2.2). */
export const CLERKING_FORMS = [
  { value: "tpl.clerking.adult_opd", label: "Full clerking" },
  { value: "tpl.clerking.emergency", label: "Emergency clerking" },
] as const;

/** Nothing the author wrote yet: at most what the desk seeded (the triage complaint). */
export function blankNote(c: NoteContent): boolean {
  if (Object.values(c.header ?? {}).some((v) => v !== null && v !== undefined && v !== ""))
    return false;
  return Object.values(c.sections).every(
    (s) =>
      !s.narrative?.trim() &&
      Object.values(s.fields ?? {}).every((v) => !v?.trim()) &&
      (s.items ?? []).every((i) => i.kind === "complaint_token" && i.source === "triage"),
  );
}

/** The first section whose items include `kind` ("exam_finding:general" names a group). */
export function sectionWith(t: Pick<DeskTemplate, "sections">, kind: string): string | null {
  return t.sections.find((s) => s.itemKinds.includes(kind))?.id ?? null;
}

/** A carried problem's "still true?" answer, as the note records it. */
export function problemAnswer(c: NoteContent, sid: string, conditionId: string): ProblemAnswer {
  const i = itemsOf(c, sid, "problem_list").find((x) => x.conditionId === conditionId);
  return i?.answer === "confirmed" || i?.answer === "resolved" ? i.answer : "pending";
}

export function answerProblem(
  c: NoteContent,
  sid: string,
  p: { id: string; display: string },
  answer: Exclude<ProblemAnswer, "pending">,
  reasonCode?: string,
): NoteContent {
  return putItem(c, sid, (i) => i.kind === "problem_list" && i.conditionId === p.id, {
    kind: "problem_list",
    conditionId: p.id,
    display: p.display,
    answer,
    ...(reasonCode ? { reasonCode } : {}),
  });
}

/**
 * What the chart already holds for this visit, mirrored into the note so the note says what was
 * done: diagnoses (Impression) and orders (Plan). Chart actions committed at once (D-EMR-01); the
 * mirror only adds, never removes, and leaves the content untouched when nothing is new.
 */
export function syncRecorded(c: NoteContent, p: DeskPayload): NoteContent {
  let next = c;
  const dx = sectionWith(p.template, "encounter_diagnosis");
  if (dx)
    for (const d of p.diagnoses)
      if (!itemsOf(next, dx, "encounter_diagnosis").some((i) => i.conditionId === d.id))
        next = putItem(next, dx, () => false, {
          kind: "encounter_diagnosis",
          conditionId: d.id,
          display: d.display,
          code: d.code,
          verification: d.verification,
          rank: d.rank,
        });
  const plan = sectionWith(p.template, "order");
  if (plan)
    for (const o of p.orders)
      if (!itemsOf(next, plan, "order").some((i) => i.orderId === o.id))
        next = putItem(next, plan, () => false, {
          kind: "order",
          orderId: o.id,
          display: o.display,
        });
  return next;
}

/* ─── Signing ─────────────────────────────────────────────────────── */

export function deskValidation(p: DeskPayload, content: NoteContent): SignValidation {
  return validateForSigning(p.template, content, {
    allergyStatus: p.safetyBar.allergy.state,
    medicinesReconciled: p.carried.medicines.every((m) => m.answer !== "pending"),
  });
}

/** What signing commits as facts (D-EMR-01), in words: "3 findings, 7 examination signs". */
export function committedWords(c: NoteContent): string | null {
  let findings = 0;
  let signs = 0;
  let typed = 0;
  for (const s of Object.values(c.sections))
    for (const i of s.items ?? []) {
      if (i.kind === "complaint_token" || i.kind === "finding") {
        if (typeof i.token === "string" && i.token) findings++;
        else typed++;
      } else if (i.kind === "ros_grid" || i.kind === "exam_finding") {
        const n = Array.isArray(i.items) ? i.items.length : 0;
        if (i.kind === "ros_grid") findings += n;
        else signs += n;
      }
    }
  const parts = [
    findings ? `${findings} ${findings === 1 ? "finding" : "findings"}` : null,
    signs ? `${signs} examination ${signs === 1 ? "sign" : "signs"}` : null,
    typed ? `${typed} as typed (kept in the note, not charted)` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** "Required 2/3": how many required rules are met. */
export function requiredCount(p: DeskPayload, v: SignValidation): { met: number; of: number } {
  const of = p.template.minimumToSign.required.length;
  return { met: of - v.missing.length, of };
}

/* ─── The section index ───────────────────────────────────────────── */

export interface DeskIndexEntry {
  id: string;
  number: string;
  title: string;
  required: boolean;
  /** Something is recorded here. */
  done: boolean;
  /** Amber words shown beside it ("Not recorded"), or null. */
  caution: string | null;
}

const REQUIRED_SECTIONS = (t: DeskTemplate) =>
  new Set(t.minimumToSign.required.flatMap((r) => (r.section ? [r.section] : (r.sections ?? []))));

export function hasContent(c: NoteContent, sid: string): boolean {
  const s = c.sections[sid];
  if (!s) return false;
  return (
    !!s.narrative?.trim() ||
    (s.items ?? []).length > 0 ||
    Object.values(s.fields ?? {}).some((v) => !!v?.trim())
  );
}

export function deskIndex(p: DeskPayload, content: NoteContent): DeskIndexEntry[] {
  const required = REQUIRED_SECTIONS(p.template);
  return p.template.sections.map((s) => {
    const allergy = s.itemKinds.includes("allergy_status");
    const medicines = s.itemKinds.includes("medication_reconciliation");
    const caution =
      allergy && p.safetyBar.allergy.state === "not_recorded"
        ? "Not recorded"
        : allergy && p.safetyBar.allergy.state === "unable_to_assess"
          ? "Unable to assess"
          : medicines && p.carried.medicines.some((m) => m.answer === "pending")
            ? "Not reconciled"
            : null;
    const done =
      hasContent(content, s.id) ||
      (allergy && p.safetyBar.allergy.state !== "not_recorded") ||
      (medicines && p.carried.medicines.length > 0 && caution === null);
    return {
      id: s.id,
      number: s.number,
      title: s.title,
      required: required.has(s.id),
      done,
      caution,
    };
  });
}

/** "02 of 13": the phone's one position, counted over the visible sections. The template's
 *  numbers skip hidden ones (the obstetric history) and the NCD module has none. */
export function sectionPosition(index: readonly DeskIndexEntry[], current: string): string {
  const at = Math.max(
    0,
    index.findIndex((e) => e.id === current),
  );
  return `${String(at + 1).padStart(2, "0")} of ${index.length}`;
}

/* ─── Keyboard (UI-BRIEF §4) ──────────────────────────────────────── */

export interface KeyInput {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  /** Focus is in a text field (input, textarea, contenteditable). */
  inField: boolean;
  /** The caret sits at the start of an empty line of a textarea. */
  atEmptyLineStart?: boolean;
}

export type DeskKeyAction =
  | { type: "section"; index: number }
  | { type: "insert" }
  | { type: "sign" }
  | { type: "help" };

/**
 * One key → one desk action, or null (let it through). Every shortcut is off inside a text field
 * except the sign chord and `/` at the start of an empty line. None of them animates (the caller
 * switches instantly).
 */
export function deskKey(e: KeyInput, at: { current: number; count: number }): DeskKeyAction | null {
  const mod = !!(e.ctrlKey || e.metaKey);
  if (e.key === "Enter" && mod && !e.altKey) return { type: "sign" };
  if (e.altKey || mod) return null;
  if (e.key === "/" && (!e.inField || e.atEmptyLineStart)) return { type: "insert" };
  if (e.inField) return null;
  if (e.key === "?") return { type: "help" };
  if (e.key === "j" || e.key === "k") {
    const index = Math.min(at.count - 1, Math.max(0, at.current + (e.key === "j" ? 1 : -1)));
    return index === at.current ? null : { type: "section", index };
  }
  return null;
}

/** Caret at the start of an empty line: what `/` needs inside a textarea. */
export function atEmptyLineStart(value: string, caret: number): boolean {
  const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
  const lineEnd = value.indexOf("\n", caret);
  return caret === lineStart && value.slice(lineStart, lineEnd < 0 ? undefined : lineEnd) === "";
}

/** The insert menu: each entry jumps to the section holding that kind and focuses its entry. */
export const INSERT_TARGETS = [
  { id: "vital", label: "Vital sign", kind: "vital_signs", focus: "desk-vitals" },
  { id: "finding", label: "Finding", kind: "finding", focus: "desk-finding-search" },
  { id: "diagnosis", label: "Diagnosis", kind: "encounter_diagnosis", focus: "desk-dx-input" },
  { id: "order", label: "Order", kind: "order", focus: "desk-order" },
  { id: "medicine", label: "Medicine", kind: "medication_reconciliation", focus: "desk-medicines" },
] as const;

export const KEY_HELP: readonly [string, string][] = [
  ["/", "Insert a vital sign, finding, diagnosis, order or medicine"],
  ["j / k", "Next or previous section"],
  ["Ctrl or ⌘ + Enter", "Sign note"],
  ["?", "Show these keys"],
  ["Space", "Change the focused finding: not asked, present, absent"],
];

/* ─── Save state words (no motion: a text swap in a polite region) ── */

export interface SaveState {
  online: boolean;
  /** Entries not yet saved (the queue). */
  waiting: number;
  failed: string | null;
  /** Last save, as the server's clock read it. */
  savedAt: string | null;
  /** Content changed since the last submit (the debounce is running). */
  dirty: boolean;
}

export function saveWords(
  s: SaveState,
  time: (iso: string) => string,
): { tone: "neutral" | "caution"; text: string } {
  if (!s.online)
    return {
      tone: "caution",
      text: `Offline, changes kept on this page${s.waiting ? ` (${s.waiting} waiting)` : ""}`,
    };
  if (s.failed) return { tone: "caution", text: `Not saved: ${s.failed}` };
  if (s.waiting > 0 || s.dirty) return { tone: "neutral", text: "Saving" };
  if (s.savedAt) return { tone: "neutral", text: `Saved ${time(s.savedAt)}` };
  return { tone: "neutral", text: "Not saved yet" };
}

/* ─── Words ───────────────────────────────────────────────────────── */

export { unitWords } from "@/lib/emr/unit-words";

export const DISPOSITION_WORDS: Record<string, string> = {
  home: "Home",
  admitted: "Admitted",
  referred_out: "Referred out",
  transferred: "Transferred",
  died: "Died",
  left_before_completion: "Left before completion",
  left_against_advice: "Left against medical advice",
};

export const CLOSURE_WORDS: Record<string, string> = {
  left_before_seen: "Left before seen",
  duplicate_encounter: "Duplicate encounter",
  documented_elsewhere: "Documented elsewhere",
  opened_in_error: "Opened in error",
  other: "Other",
};

export const VERIFICATION_WORDS: Record<string, string> = {
  provisional: "Working",
  confirmed: "Final",
  differential: "Differential",
  refuted: "Refuted",
};

export const EIE_REASONS: readonly { code: string; label: string }[] = [
  { code: "wrong_patient", label: "Wrong patient" },
  { code: "wrong_encounter", label: "Wrong visit" },
  { code: "duplicate", label: "Duplicate" },
  { code: "other", label: "Other" },
];

export const STOP_REASONS: readonly { code: string; label: string }[] = [
  { code: "not_taking", label: "Not taking it" },
  { code: "side_effect", label: "Side effect" },
  { code: "course_completed", label: "Course completed" },
  { code: "other", label: "Other" },
];

export const RESOLVE_REASONS: readonly { code: string; label: string }[] = [
  { code: "resolved", label: "Resolved" },
  { code: "not_present", label: "No longer present" },
  { code: "recorded_in_error", label: "Recorded in error" },
];

/** The text of a note section, read-only (the signed view and printouts use their own). */
export function itemWords(i: NoteItem): string | null {
  const label =
    typeof i.label === "string" ? i.label : typeof i.display === "string" ? i.display : null;
  switch (i.kind) {
    case "complaint_token": {
      const d = durationWords(typeof i.durationDays === "number" ? i.durationDays : undefined);
      return label ? (d ? `${label}, ${d}` : label) : null;
    }
    case "finding":
      return label ? `${label}, ${i.presence === "absent" ? "absent" : "present"}` : null;
    case "ros_grid":
    case "exam_finding": {
      const entries = Array.isArray(i.items) ? (i.items as GridEntry[]) : [];
      return entries.length ? entries.map((e) => `${e.label}, ${e.presence}`).join("; ") : null;
    }
    case "diagnosis_deferred":
      return typeof i.reason === "string"
        ? `Diagnosis deferred: ${i.reason}`
        : "Diagnosis deferred";
    case "plan_statement":
      return typeof i.text === "string" ? i.text : null;
    case "tasks":
      return i.notRecorded === true
        ? "Outstanding tasks not recorded at handover"
        : typeof i.text === "string"
          ? i.text
          : null;
    default:
      return label;
  }
}
