import type { PatientIdentity } from "../orders/model";

import { acceptedUnits, mismatchPrompt, parseComparator, toCanonical } from "@/lib/units";

/**
 * Result entry, review and the critical-call record, as pure data (PROMPT §5.8; gate-a E.9,
 * E.10). The server turns codes into words and resolves which reference entries are signed; the
 * client checks what is typed against those. Numbers here are only the signed ones: the unit
 * table and the D-CFC-14 mismatch triggers (lib/units). Plausibility bounds arrive from the
 * server only once signed — none are — so the mechanism runs and shows nothing.
 */

export type { PatientIdentity };

/* ─── Entry ────────────────────────────────────────────────────────── */

export type LabFlag = "L" | "H" | "LL" | "HH" | "N" | "A";
export const LAB_FLAGS: readonly { value: LabFlag | ""; label: string }[] = [
  { value: "", label: "No flag" },
  { value: "L", label: "L — low" },
  { value: "H", label: "H — high" },
  { value: "LL", label: "LL — critical low" },
  { value: "HH", label: "HH — critical high" },
  { value: "N", label: "N — normal" },
  { value: "A", label: "A — abnormal" },
];

/** A signed plausibility bound in the concept's canonical unit (lib/emr/reference/plausibility). */
export interface SignedBound {
  ruleId: string;
  bound: "soft" | "hard";
  side: "low" | "high";
  limit: number;
}

export interface EntryComponent {
  conceptId: string;
  display: string;
  valueType: "quantity" | "coded" | "ordinal";
  /** Coded answers, as codes and words. */
  answers: readonly { code: string; label: string }[];
  /** From the test menu, else the concept's canonical unit. */
  defaultUnit: string | null;
  /** Signed plausibility bounds only; empty while pending. */
  bounds: readonly SignedBound[];
}

export interface EntryLine {
  value: string;
  unit: string;
  code: string;
  low: string;
  high: string;
  flag: LabFlag | "";
  /** "Keep g/dL" was chosen for the mismatch question. */
  unitConfirmed: boolean;
}
export const emptyLine = (c: EntryComponent): EntryLine => ({
  value: "",
  unit: c.defaultUnit ?? "",
  code: "",
  low: "",
  high: "",
  flag: "",
  unitConfirmed: false,
});

/** Uncatalogued: name, value and unit as typed; never read by decision support (CFC C2). */
export interface UncataloguedLine {
  key: string;
  name: string;
  value: string;
  unit: string;
  /** The saved observation this line re-enters (amendment), so it is not carried forward twice. */
  replaces?: string;
}

/** Units a value may be entered in: the default first, then the convertible ones. */
export function unitOptions(c: EntryComponent): string[] {
  const all = [c.defaultUnit, ...acceptedUnits(c.conceptId)].filter((u): u is string => !!u);
  return [...new Set(all)];
}

export interface LineCheck {
  /** Blocks saving: not a number, a range that runs backwards, an impossible value. */
  error: string | null;
  /** The D-CFC-14 question ("Is this g/L?"), and the other unit to switch to. Asks, never blocks
   *  once answered. */
  ask: { question: string; otherUnit: string | null } | null;
  /** A signed soft bound was crossed: said in words, no number. */
  unusual: boolean;
}

const OK: LineCheck = { error: null, ask: null, unusual: false };
const num = (s: string): number | null => {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

export function checkLine(c: EntryComponent, l: EntryLine): LineCheck {
  if (c.valueType !== "quantity") return OK;
  if (l.value.trim() === "") return OK;
  const parsed = parseComparator(l.value);
  if ("error" in parsed)
    return { ...OK, error: "Enter a number; a comparator such as < or > is allowed." };
  const low = num(l.low);
  const high = num(l.high);
  if (Number.isNaN(low) || Number.isNaN(high))
    return { ...OK, error: "The laboratory range takes numbers." };
  if (low !== null && high !== null && low > high)
    return { ...OK, error: "The range's low end is above its high end." };
  const unit = l.unit || c.defaultUnit || "";
  const prompt = mismatchPrompt(c.conceptId, parsed.value, unit);
  const ask =
    prompt && !l.unitConfirmed
      ? {
          question: prompt.ask,
          otherUnit: unitOptions(c).find((u) => u !== unit) ?? null,
        }
      : null;
  // Plausibility runs on the canonical value, against signed bounds only.
  let unusual = false;
  if (c.bounds.length) {
    const canon = toCanonical(c.conceptId, parsed.value, unit);
    const v = "error" in canon ? parsed.value : canon.value;
    for (const b of c.bounds) {
      const outside = b.side === "low" ? v < b.limit : v > b.limit;
      if (!outside) continue;
      if (b.bound === "hard")
        return { error: "This value is not physically possible — check it.", ask, unusual };
      unusual = true;
    }
  }
  return { error: null, ask, unusual };
}

const filled = (c: EntryComponent, l: EntryLine | undefined) =>
  !!l && (c.valueType === "quantity" ? l.value.trim() !== "" : l.code !== "");

export type ConclusionCode = "normal" | "abnormal" | "indeterminate";
export const CONCLUSIONS: readonly { value: ConclusionCode; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "abnormal", label: "Abnormal" },
  { value: "indeterminate", label: "Indeterminate" },
];

export interface EntryState {
  lines: Record<string, EntryLine>;
  uncatalogued: UncataloguedLine[];
  conclusionCode: ConclusionCode | null;
  conclusionText: string;
  /** Amendments only. */
  reasonText: string;
}

/** Why the entry cannot be saved yet, in words; empty = ready. */
export function entryIssues(
  kind: string,
  components: readonly EntryComponent[],
  s: EntryState,
  opts: { amending?: boolean; final?: boolean } = {},
): string[] {
  const out: string[] = [];
  const report = kind === "imaging" || kind === "ecg";
  const anyValue =
    components.some((c) => filled(c, s.lines[c.conceptId])) ||
    s.uncatalogued.some((u) => u.name.trim() && u.value.trim());
  if (report) {
    if (opts.final !== false && !s.conclusionCode) out.push("Choose the conclusion.");
  } else if (!anyValue) out.push("Enter at least one result.");
  for (const c of components) {
    const l = s.lines[c.conceptId];
    if (!l) continue;
    const check = checkLine(c, l);
    if (check.error) out.push(`${c.display}: ${check.error}`);
    else if (check.ask) out.push(`${c.display}: ${check.ask.question} Answer to save.`);
  }
  for (const u of s.uncatalogued)
    if (u.value.trim() && !u.name.trim()) out.push("An uncatalogued result needs its test name.");
  if (opts.amending && s.reasonText.trim().length < 3) out.push("Say why the result is amended.");
  return out;
}

/** The enterResults / amendResults `values` (lib/emr/actions/results.ts Value). */
export function toResultValues(components: readonly EntryComponent[], s: EntryState) {
  const out: Record<string, unknown>[] = [];
  for (const c of components) {
    const l = s.lines[c.conceptId];
    if (!filled(c, l)) continue;
    const flag = l!.flag || undefined;
    if (c.valueType !== "quantity") {
      out.push({ conceptId: c.conceptId, code: l!.code, labInterpretation: flag });
      continue;
    }
    const unit = l!.unit || c.defaultUnit || undefined;
    const low = num(l!.low);
    const high = num(l!.high);
    out.push({
      conceptId: c.conceptId,
      value: l!.value.trim(),
      unit,
      ...(l!.unitConfirmed ? { unitConfirmed: true } : {}),
      ...((low !== null || high !== null) && unit
        ? {
            referenceRange: {
              ...(low !== null ? { low } : {}),
              ...(high !== null ? { high } : {}),
              unit,
            },
          }
        : {}),
      ...(flag ? { labInterpretation: flag } : {}),
    });
  }
  for (const u of s.uncatalogued) {
    if (!u.name.trim() || !u.value.trim()) continue;
    out.push({
      conceptId: "obs.uncatalogued",
      name: u.name.trim(),
      value: u.value.trim(),
      ...(u.unit.trim() ? { unit: u.unit.trim() } : {}),
      ...(u.replaces ? { replaces: u.replaces } : {}),
    });
  }
  return out;
}

export interface ResultEntryData {
  orderId: string;
  patientUserId: string;
  identity: PatientIdentity;
  test: string;
  kind: string;
  requisitionNo: string | null;
  priority: string | null;
  /** Direct (laboratory staff at the bench) or transcribed (a clinician copying a paper report);
   *  the server decides it from the cadre, so the screen states it rather than asking. */
  mode: "direct" | "transcribed";
  components: EntryComponent[];
  /** The current report version, when one exists. */
  report: {
    id: string;
    status: string;
    released: boolean;
    critical: boolean;
    lines: Record<string, EntryLine>;
    uncatalogued: UncataloguedLine[];
    conclusionCode: ConclusionCode | null;
  } | null;
  /** Where the lab records a critical-result call (a released critical result only). */
  communicate: CommTarget | null;
}

export const MODE_WORDS = {
  direct: "Direct, laboratory",
  transcribed: "Transcribed from a paper report",
} as const;

/* ─── Review and acknowledgement ───────────────────────────────────── */

export interface ReviewValue {
  key: string;
  display: string;
  valueText: string;
  unit: string | null;
  /** The laboratory's own flag, as text ("Lab flag: high"); never a colour on its own. */
  flagText: string | null;
  /** MedSync-critical: a signed REF-CRIT entry matched. None is signed today. */
  critical: boolean;
  uncatalogued: boolean;
}

export interface ReviewItem {
  reportId: string;
  patientUserId: string;
  identity: PatientIdentity;
  test: string;
  releasedAtIso: string;
  state: "needs_review" | "needs_re_ack";
  critical: boolean;
  restricted: boolean;
  values: ReviewValue[];
  conclusion: { code: string; text: string | null } | null;
  encounterId: string | null;
}

export const reviewWords = (i: Pick<ReviewItem, "state">): string =>
  i.state === "needs_re_ack" ? "Amended — acknowledge again" : "Awaiting acknowledgement";

/** Critical first, then amended ones, then whoever has waited longest. */
export function sortReview<
  T extends Pick<ReviewItem, "state" | "releasedAtIso"> & { critical: boolean },
>(items: readonly T[]): T[] {
  const rank = (i: T) => (i.critical ? 0 : i.state === "needs_re_ack" ? 1 : 2);
  return [...items].sort(
    (a, b) => rank(a) - rank(b) || Date.parse(a.releasedAtIso) - Date.parse(b.releasedAtIso),
  );
}

export type AckAction = "seen" | "acted" | "forwarded";
export const ACK_ACTIONS: readonly { value: AckAction; label: string }[] = [
  { value: "seen", label: "Seen" },
  { value: "acted", label: "Acted" },
  { value: "forwarded", label: "Forward" },
];

export interface AckDraft {
  action: AckAction;
  note: string;
  forwardedToUserId: string;
}

export function ackIssues(d: AckDraft, selected: number): string[] {
  const out: string[] = [];
  if (selected === 0) out.push("Select at least one result.");
  if (d.action === "forwarded" && !d.forwardedToUserId) out.push("Choose who to forward to.");
  return out;
}

/** One acknowledgeResults call per patient (the action takes one patient), same action for all. */
export function ackBatches(
  items: readonly Pick<ReviewItem, "reportId" | "patientUserId">[],
  selected: ReadonlySet<string>,
  d: AckDraft,
  keyPrefix: string,
) {
  const byPatient = new Map<string, string[]>();
  for (const i of items)
    if (selected.has(i.reportId))
      byPatient.set(i.patientUserId, [...(byPatient.get(i.patientUserId) ?? []), i.reportId]);
  const note = d.note.trim();
  return [...byPatient].map(([patientUserId, reportIds]) => ({
    patientUserId,
    clientKey: `${keyPrefix}:${patientUserId}`,
    items: reportIds.map((reportId) => ({
      reportId,
      action: d.action,
      ...(d.action === "forwarded" ? { forwardedToUserId: d.forwardedToUserId } : {}),
      ...(note ? { note } : {}),
    })),
  }));
}

/* ─── Critical-result call (the laboratory's record) ───────────────── */

export interface StaffOption {
  userId: string;
  name: string;
}
export interface CommTarget {
  reportId: string;
  /** The orderer first; then other clinicians here. */
  people: StaffOption[];
  ordererUserId: string | null;
}
export type CommRole = "orderer" | "covering_clinician" | "in_charge";
export type CommMethod = "in_app" | "phone" | "in_person";
export const COMM_ROLES: readonly { value: CommRole; label: string }[] = [
  { value: "orderer", label: "Orderer" },
  { value: "covering_clinician", label: "Covering" },
  { value: "in_charge", label: "In-charge" },
];
export const COMM_METHODS: readonly { value: CommMethod; label: string }[] = [
  { value: "in_app", label: "In app" },
  { value: "phone", label: "Phone" },
  { value: "in_person", label: "In person" },
];
export interface CommDraft {
  toUserId: string;
  role: CommRole;
  method: CommMethod | null;
  readBack: "yes" | "no" | null;
}
export function commIssues(d: CommDraft): string[] {
  const out: string[] = [];
  if (!d.toUserId) out.push("Choose who was told.");
  if (!d.method) out.push("Choose how they were told.");
  if (!d.readBack) out.push("Say whether it was read back.");
  return out;
}
