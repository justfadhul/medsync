import type { SignedCopy } from "@/content/signed-copy";

/**
 * The prescriber's side of a pharmacy query (Pharmacy Phase 1, 5.4, 5.14; gate-a-content.md Part 1
 * B-25, B-26, X-4, X-5 and the 4.2 wireframe). Signed by the CSO on 13 Oct 2026; the screens that show
 * them are behind `pharmacyDispensingLiveFor`, off in production whenever the Phase 1 wording is
 * unsigned (RD-4). B-22..B-27 that the pharmacy also uses live in lib/pharmacy/review/queries.ts.
 */
export const PRESCRIBER_PHARMACY_COPY = {
  status: "signed",
  signedBy: "Fadhul (CSO)",
  signedOn: "2026-10-13",
  /** X-4 */
  chip: "Pharmacy query · waiting {n} min",
  /** X-5 */
  count: "{n} from the pharmacy",
  /** B-26 */
  query: 'From the pharmacy ({cadre}), {time} · {type}. "{proposal}"',
  wholePrescription: "About the whole prescription.",
  patientWaiting: "The patient is waiting at the window.",
  /** B-25 */
  phoneAnswer: "The pharmacy recorded your phone answer at {time}. Not you? Tell us.",
  tellUs: "Tell us",
  yourAnswer: "Your answer",
  keep: "Keep it as written",
  change: "Change the prescription",
  changeLine: "Change this line",
  stop: "Stop this medicine",
  stopAll: "Stop the remaining medicines",
  reason: "Reason",
  reasonText: "Your reason, in words",
  send: "Send answer",
  changesMade: "Changes made",
  changeWhole:
    "Change the lines you choose from their problems below, place them, then confirm Changes made.",
  inBasket: "The new prescription is in the basket. Place it to send the change.",
  callPharmacy: "Call the pharmacy",
  /** RQ-6: a later attempt is shown the first answer and writes nothing. */
  firstAnswer: "Answered by {cadre} at {time}: {answer}.",
  keepUnsigned:
    "The reasons for keeping are not signed at this hospital yet. Call the pharmacy to answer.",
  keepDraft: "Draft reasons, not signed",
  chooseAlternative: "Choose an alternative",
  leaveIt: "Leave it as it is",
  heading: "From the pharmacy",
  earlier: "From an earlier visit",
  announce: "A new query from the pharmacy.",
} as const satisfies SignedCopy & Record<string, string | null>;

export const ANSWER_LABEL = {
  keep: PRESCRIBER_PHARMACY_COPY.keep,
  changed: PRESCRIBER_PHARMACY_COPY.change,
  stopped: PRESCRIBER_PHARMACY_COPY.stop,
} as const;

/**
 * Drafted lists (gate-a-content.md Part 2, 2.6 and 2.11), used only until the hospital's own list is
 * signed in `pharmacy_signed_sets`. Law 8: an unsigned list never acts in production. The keep
 * reasons are recorded with an answer, so outside production the drafted list acts (and the screen
 * says it is a draft); in production with no signed set, Keep is not offered. The type and outcome
 * words only label what the pharmacy recorded.
 */
export interface CodedWord {
  code: string;
  words: string;
}

export const DRAFT_KEEP_REASONS: readonly CodedWord[] = [
  { code: "intended", words: "Intended as written" },
  { code: "senior_advice", words: "A senior or specialist advised it" },
  { code: "discussed", words: "Already discussed with the patient" },
  { code: "other", words: "Other (with text)" },
];

export const DRAFT_QUERY_TYPES: readonly CodedWord[] = [
  { code: "allergy", words: "Allergy" },
  { code: "dose", words: "Dose unclear or unusual" },
  { code: "duplicate", words: "Duplicate" },
  { code: "renal", words: "Renal function" },
  { code: "not_available", words: "Not available, alternative needed" },
  { code: "other", words: "Other" },
];

export const DRAFT_NOT_SUPPLIED_REASONS: readonly CodedWord[] = [
  { code: "out_point", words: "Out of stock at this dispensing point" },
  { code: "out_hospital", words: "Out of stock in the hospital" },
  { code: "expired_only", words: "Expired or damaged stock only" },
  { code: "not_stocked", words: "Not stocked at this hospital" },
  { code: "concern_stands", words: "Query answered; the concern stands" },
  { code: "no_answer", words: "No answer from the prescriber; cannot supply as written" },
  { code: "incomplete", words: "Prescription incomplete or unclear" },
  { code: "other", words: "Other" },
];

/**
 * Why the prescriber stopped a line (drafted here; recorded on `prescription_cancellations`, drives
 * nothing). A change is always recorded as `changed`.
 */
export const STOP_REASONS: readonly CodedWord[] = [
  { code: "pharmacy_concern", words: "The pharmacy's concern is right" },
  { code: "no_longer_needed", words: "No longer needed" },
  { code: "other", words: "Other (with text)" },
];
export const CHANGED_REASON = "changed";

/**
 * The pharmacy hand-off of the one Prescribe (prescribing kit P2 (a), F4), in the prototype's wording.
 * Draft: PRESCRIBE_V2 stays off in production until the CSO signs. `line` is the prescriber's word for
 * each pharmacy line stage or outcome (lib/pharmacy/lines.ts StatusKey); the pharmacy keeps its own
 * signed words for the same stages (Waiting, Queried, Owed, Supplied).
 */
export const PRESCRIBE_HANDOFF_COPY = {
  status: "draft",
  signedBy: null,
  signedOn: null,
  line: {
    new: "Waiting at pharmacy",
    awaiting_cosign: "Waiting for co-sign",
    to_review: "Waiting at pharmacy",
    queried: "Pharmacy asks you",
    ready: "Waiting at pharmacy",
    owed: "Owed, given later",
    buying_outside: "Buying outside",
    supplied: "Handed over",
    cancelled_by_prescriber: "Stopped",
    replaced: "Changed",
    declined: "Not supplied",
    closed: "Closed",
    reviewed: "Reviewed",
  },
  explained: "I checked who they are, and explained how to take each medicine",
  explainedRefused: "Confirm you checked who they are and explained how to take each medicine.",
} as const satisfies SignedCopy & Record<string, unknown>;
