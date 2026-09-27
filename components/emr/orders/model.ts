/**
 * Order entry and specimen collection, as pure data (PROMPT §5.8; gate-a E.7, E.8). The views
 * render from these shapes and the client islands drive them through the reducer, so the render
 * tests and the scratch harness exercise the same rules the screen enforces. Nothing here imports
 * the concept catalogue: the server has already turned codes into words.
 */

/* ─── Identity (two identifiers, age and sex in words) ─────────────── */

export interface PatientIdentity {
  name: string;
  mrn: string;
  /** "52 y · Female"; each part is set as its own span. */
  ageSex: string;
}

const SEX_WORDS: Record<string, string> = {
  female: "Female",
  f: "Female",
  male: "Male",
  m: "Male",
  intersex: "Intersex",
};
export function ageSexWords(ageYears: number | null, sex: string | null): string {
  const age = ageYears === null ? "Age not recorded" : `${ageYears} y`;
  return `${age} · ${(sex && SEX_WORDS[sex.toLowerCase()]) ?? "Sex not recorded"}`;
}

/* ─── The test menu ────────────────────────────────────────────────── */

export type Priority = "routine" | "urgent" | "immediate";
export const PRIORITIES: readonly { value: Priority; label: string }[] = [
  { value: "routine", label: "Routine" },
  { value: "urgent", label: "Urgent" },
  { value: "immediate", label: "Immediate" },
];
export const PRIORITY_WORD: Record<string, string> = {
  routine: "Routine",
  urgent: "Urgent",
  immediate: "Immediate",
};

/** The test words on a specimen label: a restricted test is printed only when added by hand, like
 *  every other printout (the requisition and label numbers identify it for the laboratory). */
export function labelTestWords(test: string, restricted: boolean, included: boolean): string {
  return restricted && !included ? "Restricted — see requisition" : test;
}

export type Availability = "available" | "intermittent" | "unavailable" | "unknown";

export interface MenuTest {
  id: string;
  code: string;
  display: string;
  kind: string;
  /** Component names; more than one makes it a panel. */
  components: string[];
  specimenType: string | null;
  container: string | null;
  fastingRequired: boolean;
  ionising: boolean;
  inHouse: boolean;
  favouriteRank: number | null;
  availability: Availability;
  restricted: boolean;
}

/** A diagnosis on this encounter, offered as the order's reason. */
export interface ReasonOption {
  id: string;
  display: string;
  primary: boolean;
  restricted: boolean;
}

/** Favourites first (their rank), then the rest by name; the search narrows the rest only. */
export function menuSections(
  menu: readonly MenuTest[],
  query: string,
): { favourites: MenuTest[]; rest: MenuTest[] } {
  const favourites = menu
    .filter((t) => t.favouriteRank !== null)
    .sort((a, b) => a.favouriteRank! - b.favouriteRank!);
  const q = query.trim().toLowerCase();
  const rest = menu
    .filter(
      (t) =>
        q !== "" && [t.display, t.code, ...t.components].some((s) => s.toLowerCase().includes(q)),
    )
    .sort((a, b) => a.display.localeCompare(b.display));
  return { favourites, rest };
}

/** Availability informs, never blocks (HARMONISATION §9): words for the caution chip, or null. */
export function availabilityWords(a: Availability): string | null {
  if (a === "intermittent") return "Intermittent — check with the laboratory";
  if (a === "unavailable") return "Not available here — it can still be ordered";
  return null;
}

/* ─── The order draft ──────────────────────────────────────────────── */

export interface OrderLineDraft {
  testId: string;
  clientKey: string;
  priority: Priority;
  reasonIds: string[];
  reasonText: string;
}
export interface OrderDraft {
  lines: OrderLineDraft[];
}
export const EMPTY_DRAFT: OrderDraft = { lines: [] };

export type DraftAction =
  /** Adds the test (reason pre-filled with the primary diagnosis), or removes it if present. */
  | { type: "toggle"; testId: string; clientKey: string; defaultReasonIds: string[] }
  | { type: "priority"; testId: string; priority: Priority }
  | { type: "reason"; testId: string; reasonId: string }
  | { type: "reasonText"; testId: string; text: string }
  | { type: "clear" };

export function draftReducer(state: OrderDraft, action: DraftAction): OrderDraft {
  const edit = (testId: string, f: (l: OrderLineDraft) => OrderLineDraft): OrderDraft => ({
    lines: state.lines.map((l) => (l.testId === testId ? f(l) : l)),
  });
  switch (action.type) {
    case "toggle":
      if (state.lines.some((l) => l.testId === action.testId))
        return { lines: state.lines.filter((l) => l.testId !== action.testId) };
      return {
        lines: [
          ...state.lines,
          {
            testId: action.testId,
            clientKey: action.clientKey,
            priority: "routine",
            reasonIds: [...action.defaultReasonIds],
            reasonText: "",
          },
        ],
      };
    case "priority":
      return edit(action.testId, (l) => ({ ...l, priority: action.priority }));
    case "reason":
      return edit(action.testId, (l) => ({
        ...l,
        reasonIds: l.reasonIds.includes(action.reasonId)
          ? l.reasonIds.filter((id) => id !== action.reasonId)
          : [...l.reasonIds, action.reasonId],
      }));
    case "reasonText":
      return edit(action.testId, (l) => ({ ...l, reasonText: action.text }));
    case "clear":
      return EMPTY_DRAFT;
  }
}

/** The primary diagnosis pre-fills the reason: a favourite plus Place order is two taps. */
export const defaultReasonIds = (reasons: readonly ReasonOption[]): string[] =>
  reasons.filter((r) => r.primary).map((r) => r.id);

export const REASON_REQUIRED = "Add a reason: a diagnosis or a short text.";

export function lineIssue(line: OrderLineDraft): string | null {
  return line.reasonIds.length === 0 && line.reasonText.trim() === "" ? REASON_REQUIRED : null;
}

export const draftReady = (d: OrderDraft): boolean =>
  d.lines.length > 0 && d.lines.every((l) => lineIssue(l) === null);

/** The placeOrders payload lines (lib/emr/actions/orders.ts OrderLine). */
export function toOrderLines(d: OrderDraft) {
  return d.lines.map((l) => ({
    clientKey: l.clientKey,
    testId: l.testId,
    priority: l.priority,
    ...(l.reasonIds.length ? { reasonConditionIds: l.reasonIds } : {}),
    ...(l.reasonText.trim() ? { reasonText: l.reasonText.trim() } : {}),
  }));
}

/* ─── Specimens ────────────────────────────────────────────────────── */

const SPECIMEN_WORDS: Record<string, string> = {
  venous_plasma: "Venous plasma",
  venous_serum: "Venous serum",
  venous_whole_blood: "Venous whole blood",
  capillary_whole_blood: "Capillary whole blood",
  arterial_blood: "Arterial blood",
  urine_spot: "Spot urine",
  urine_first_morning: "First-morning urine",
  urine_24h: "24-hour urine",
  interstitial_fluid: "Interstitial fluid",
  sputum: "Sputum",
  unknown: "Specimen not stated",
};
const CONTAINER_WORDS: Record<string, string> = {
  fluoride_oxalate: "Fluoride oxalate",
  serum_plain: "Plain serum tube",
  lithium_heparin: "Lithium heparin",
  edta: "EDTA",
  capillary_direct: "Direct from capillary",
  unknown: "Container not stated",
};
const humanise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
export const specimenWords = (s: string | null) => (s ? (SPECIMEN_WORDS[s] ?? humanise(s)) : null);
export const containerWords = (c: string | null) =>
  c ? (CONTAINER_WORDS[c] ?? humanise(c)) : null;

export type FastingState = "fasting" | "non_fasting" | "unknown";
/** "Not sure" is stored as `unknown` and never read as fasting (CFC C2). */
export const FASTING_OPTIONS: readonly { value: FastingState; label: string }[] = [
  { value: "fasting", label: "Fasting" },
  { value: "non_fasting", label: "Not fasting" },
  { value: "unknown", label: "Not sure" },
];

export interface CollectTarget {
  orderId: string;
  display: string;
  priority: string | null;
  specimenType: string | null;
  container: string | null;
  needsFasting: boolean;
  /** "Rejected: haemolysed — recollect" after a laboratory rejection. */
  rejection: string | null;
}

/** The values the specimens CHECKs take (0071; lib/emr/write/specimens.ts), offered only when the
 *  test menu leaves the specimen or container unnamed. */
export const SPECIMEN_OPTIONS: readonly { value: string; label: string }[] = [
  "venous_whole_blood",
  "venous_plasma",
  "venous_serum",
  "capillary_whole_blood",
  "arterial_blood",
  "urine_spot",
  "urine_first_morning",
  "urine_24h",
].map((value) => ({ value, label: SPECIMEN_WORDS[value]! }));
export const CONTAINER_OPTIONS: readonly { value: string; label: string }[] = [
  "edta",
  "fluoride_oxalate",
  "serum_plain",
  "lithium_heparin",
  "capillary_direct",
  "unknown",
].map((value) => ({ value, label: CONTAINER_WORDS[value]! }));

export interface CollectDraft {
  identifiersConfirmed: boolean;
  /** Chosen at the bedside only when the test menu names none. */
  specimenType: string | null;
  container: string | null;
  fastingState: FastingState | null;
  /** Hours since food or drink, as typed; optional. */
  fastingHours: string;
  /** `datetime-local` value in the hospital's zone; empty = now. */
  collectedAt: string;
}
export const EMPTY_COLLECT: CollectDraft = {
  identifiersConfirmed: false,
  specimenType: null,
  container: null,
  fastingState: null,
  fastingHours: "",
  collectedAt: "",
};

export const IDENTIFIERS_REQUIRED = "Confirm the name and MRN with the patient.";
export const FASTING_REQUIRED = "Record the fasting state: fasting, not fasting or not sure.";

export function collectIssues(t: CollectTarget, d: CollectDraft): string[] {
  const out: string[] = [];
  if (!d.identifiersConfirmed) out.push(IDENTIFIERS_REQUIRED);
  if (t.needsFasting && !d.fastingState) out.push(FASTING_REQUIRED);
  if (d.fastingHours.trim() !== "") {
    const h = Number(d.fastingHours);
    if (!Number.isFinite(h) || h < 0) out.push("Hours since food must be a number of hours.");
  }
  if (!(t.specimenType ?? d.specimenType)) out.push("Choose the specimen.");
  if (!(t.container ?? d.container)) out.push("Choose the container.");
  return out;
}

/** `datetime-local` in the hospital's zone → an instant. Kampala has no DST, so a fixed offset
 *  is exact; ponytail: pass the zone's offset from the server if a DST zone is ever served. */
export function localToIso(local: string, offset = "+03:00"): string | undefined {
  if (!local) return undefined;
  const d = new Date(`${local.length === 16 ? `${local}:00` : local}${offset}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** The collectSpecimen payload (lib/emr/actions/orders.ts CollectSpecimen). */
export function toCollectInput(t: CollectTarget, d: CollectDraft, clientKey: string) {
  const at = localToIso(d.collectedAt);
  return {
    orderId: t.orderId,
    identifiersConfirmed: d.identifiersConfirmed,
    ...(!t.specimenType && d.specimenType ? { specimenType: d.specimenType } : {}),
    ...(!t.container && d.container ? { container: d.container } : {}),
    ...(d.fastingState ? { fastingState: d.fastingState } : {}),
    ...(d.fastingState === "fasting" && d.fastingHours.trim() !== ""
      ? { fastingHours: Number(d.fastingHours) }
      : {}),
    ...(at ? { collectedAt: at } : {}),
    clientKey,
  };
}

/* ─── The encounter's order list ───────────────────────────────────── */

export interface EncounterOrderRow {
  id: string;
  display: string;
  kind: string;
  priority: string | null;
  orderedAtIso: string;
  requesterName: string | null;
  statusText: string;
  /** Amber words: rejected, preliminary, awaiting acknowledgement, amended. */
  caution: boolean;
  restricted: boolean;
  /** Present when the order is waiting for a specimen at the bedside. */
  collect: CollectTarget | null;
  /** The newest specimen, for its label. */
  specimenId: string | null;
  /** A paper report or imaging report can be transcribed now. */
  canTranscribe: boolean;
}
