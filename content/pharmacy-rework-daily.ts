import type { SignedCopy } from "@/content/signed-copy";

/**
 * The reworked pharmacy's daily work, in its own words (docs/pharmacy/rework/PRD.md §6.1, §6.2, §6.4): Today, the
 * checks panel at Dispense, Medicines and the Store's count and order. Draft until the Clinical Safety Officer and a
 * registered pharmacist outside the build sign it.
 */
export const PHARMACY_REWORK_DAILY_COPY: SignedCopy = {
  status: "draft",
  signedBy: null,
  signedOn: null,
};

export const RX_CHECKS = {
  title: "Checks before hand-over",
  lead: "What the prescriber was warned about. Answer each one on a line you are giving.",
  none: "No checks were raised when this was prescribed.",
  level: { stop: "Stop", check: "Check" },
  prescriberSaid: "Prescriber saw it and answered: {answer}",
  answers: {
    checked: "Checked, give it",
    prescriber_confirmed: "Prescriber confirmed",
    query: "Talk to the prescriber",
  },
  answered: {
    checked: "Checked: {reason}",
    prescriber_confirmed: "Prescriber confirmed",
    query: "Held for the prescriber",
  },
  reasons: [
    "Dose checked against the reference",
    "Benefit outweighs the risk",
    "Counselled the patient",
    "Already discussed on the ward round",
  ],
  stopOnly: "A stop is given only when the prescriber confirms.",
  queryNext: "The line is held. Send the query from the line's own menu so the prescriber sees it.",
  blocked: "{n} checks on lines you are giving are not answered yet.",
  refused: {
    notHere: "That line is not at your hospital.",
    noFlag: "That check is not on this line.",
    stopNeedsPrescriber: "A stop is given only when the prescriber confirms.",
    why: "Choose why it is safe to give.",
    open: "Answer the checks first: {titles}.",
  },
} as const;

export const COUNT = {
  start: "Start a count",
  startTitle: "Start a count",
  where: "Where are you counting?",
  whole: "Everything at this place",
  label: "{place}, {date}",
  open: "Counts in progress",
  none: "No count is running. Start one for a shelf of medicines or the whole place; it saves as you type.",
  status: {
    counting: "Counting",
    approval: "Waiting for approval",
    done: "Approved",
    cancelled: "Cancelled",
  },
  continue: "Continue",
  review: "Review",
  progress: "{done} of {total} lines counted",
  packs: "Packs of {n}",
  loose: "Loose {unit}",
  expires: "Expires {date}",
  saved: "Saved",
  diffsTitle: "Differences from the record",
  diffsLead: "Every line is counted. Choose why each one differs.",
  diff: "Counted {counted}, record says {recorded}",
  reasons: {
    damaged: "Damaged",
    expired: "Expired",
    broken_in_transit: "Broken in transit",
    given_not_recorded: "Given but not recorded",
    miscounted_last_time: "Miscounted last time",
    found_other_shelf: "Found on another shelf",
    received_not_recorded: "Received but not recorded",
    other: "Other",
  },
  send: "Send for approval",
  sendBlocked: "{n} lines left to count",
  explainBlocked: "{n} differences need a reason",
  waiting: "Sent for approval. The in-charge approves it; the record changes only then.",
  approve: "Approve and post the differences",
  sendBack: "Send back to recount",
  approved: "Approved. The record now matches the count.",
  back: "All counts",
} as const;

export const STORE = {} as const;

export const TODAY = {
  yourWork: "Your work",
  inOrder: "{n} for you, in the order to do it",
  nextUp: "Next up",
  showAll: "Show all {n}",
  showFewer: "Show fewer",
  others: "{n} for other roles on shift",
  othersTitle: "For other roles on shift",
  nothing: "Nothing waits for you now. New work appears here as it arrives.",
  late: "Late",
  roles: { pharmacist: "Pharmacist on duty", storekeeper: "Store", incharge: "In-charge" },
  count: {
    run: "Continue the count: {label}",
    runMeta: "Saved as you go",
    approve: "Approve the count: {label}",
    approveMeta: "Sent for approval; the record changes only when you approve",
    continue: "Continue",
    review: "Review",
  },
} as const;
