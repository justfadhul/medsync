import type { SignedCopy } from "@/content/signed-copy";

/**
 * Pharmacy workspace copy (Pharmacy Phase 0, gate-a-proposal §5.7 / prompt Appendix B). Every
 * visible string on /pharmacy lives here. The notice and the cautions are clinical-safety wording:
 * each carries a status, and `pharmacyWorkspaceLiveFor` keeps the workspace off in production while
 * any is `draft` (CS-5). To sign, the CSO sets status "signed" with signedBy and signedOn.
 */

/**
 * Signed by the CSO on 11 Oct 2026 through the sign-off portal
 * (https://claude.ai/artifact/PrEYQNLnd2Ng7zaq58Rtj6), each string exactly as written here. Any change
 * to a string below returns it to `draft` until it is signed again.
 */
const SIGNED: SignedCopy = { status: "signed", signedBy: "Fadhul (CSO)", signedOn: "2026-10-11" };

/** "What the pharmacy is not doing" (§5.6, D-PH0-07). {signed} and {total} come from data (CS-3). */
export const PHARMACY_NOTICE = {
  ...SIGNED,
  lead: "MedSync does not record dispensing yet.",
  bodyCounts:
    "Dispense from the signed prescription as you do today. MedSync does not check drug interactions at this hospital, and {signed} of the {total} medicines on its list have a signed dose reference. Check each prescription yourself.",
  bodyNoCounts:
    "Dispense from the signed prescription as you do today. MedSync does not check drug interactions at this hospital, and its dose references are still being signed. Check each prescription yourself.",
};

export const COSIGN_CAUTION = {
  ...SIGNED,
  text: "Not yet co-signed. A senior has not signed this prescription.",
};

/** D-PH0-19: a medicine stopped at a home discharge. */
export const NOT_CONTINUED_CAUTION = { ...SIGNED, text: "Not continued at home" };

export const OVERRIDE_CAUTION = {
  ...SIGNED,
  lead: "{check} stop, overridden by the prescriber.",
  body: 'Reasons given: "{reasons}".',
};

export const EMERGENCY_NOTICE = {
  ...SIGNED,
  text: "Cart restocking is not recorded in MedSync yet. Use this list beside the cart's own checklist when you restock.",
};

/** Every string CS-5 requires signed before production. */
export const PHARMACY_SIGNED_COPY: readonly SignedCopy[] = [
  PHARMACY_NOTICE,
  COSIGN_CAUTION,
  NOT_CONTINUED_CAUTION,
  OVERRIDE_CAUTION,
  EMERGENCY_NOTICE,
];

export const PHARMACY = {
  place: "Pharmacy",
  nav: {
    label: "Pharmacy",
    queue: "Queue",
    emergency: "Emergency doses",
    queueCount: (n: number) => `${n} written today`,
    dosesCount: (n: number) => `${n} in the last 7 days`,
  },
  lane: { window: "For the window", ward: "On the wards", open: "Visit open", all: "All" },
  laneInFooter: {
    window: "for the window",
    ward: "on the wards",
    open: "with the visit still open",
    all: "in all lanes",
  },
  rowState: {
    all: "All states",
    prescribed: "Prescribed",
    awaiting_cosign: "Awaiting co-sign",
    not_continued: "Not continued at home",
    cancelled: "Cancelled",
  },
  period: { today: "Today", yesterday: "Yesterday", "7d": "Last 7 days", "30d": "Last 30 days" },
  periodInFooter: { today: "today", yesterday: "yesterday", "7d": "in the last 7 days" },
  state: {
    prescribed: "Prescribed",
    awaitingCosign: "Awaiting co-sign",
    cancelledRow: "Cancelled {time}",
    cancelledView: "Cancelled {time} by {cadre}",
    cancelledViewNoCadre: "Cancelled {time}",
    changed: "Changed {time}",
  },
  override: { answered: '{check}: answered "{answer}".' },
  notChecked: 'Drug interactions. · Stock. The prescriber saw "Pharmacy not linked yet".',
  view: {
    title: "Prescription",
    medicines: (n: number) => `${n} ${n === 1 ? "medicine" : "medicines"}`,
    written: "Written",
    directions: "Directions",
    method: "Method",
    prn: "When needed",
    yes: "Yes",
    purpose: "Purpose",
    volume: "Volume (mL)",
    over: "Over (minutes)",
    controlled: "Controlled drug",
    duration: "Duration",
    quantity: "Quantity",
    instructions: "Instructions",
    forProblem: "For",
    doseSource: "Dose source",
    fromRegimen: "From a signed regimen",
    typed: "Typed by the prescriber",
    changedFrom: "Changed from",
    cancelledSr: "Cancelled:",
    prescriber: "Prescriber",
    writtenBy: "Written by",
    cosignature: "Co-signature",
    cosignNone: "Not needed for this prescription",
    cosignAwaiting: "Awaiting a senior",
    cosignSigned: (cadre: string | null) => `Signed${cadre ? ` by ${cadre}` : ""}`,
    printed: "Printed",
    printedNotRecorded: "Not recorded in MedSync",
    checked: "What MedSync checked at prescribing",
    checkedNone: "No check needed an answer.",
    level: { stop: "Stop", check: "Check" },
    answered: "Answered",
    notCheckedTitle: "Not checked",
    weight: "Weight",
    creatinine: "Creatinine",
    allergies: "Allergies",
    noneKnown: "No known drug allergies",
    unable: "Could not be assessed",
    notRecorded: "Not recorded",
    back: "Back to the queue",
    footer: "Read-only. To change this prescription, speak to the prescriber.",
    groupedByTime:
      "Grouped by time: written before MedSync recorded which medicines were placed together.",
  },
  queue: {
    title: "Prescriptions written today",
    titleFor: {
      today: "Prescriptions written today",
      yesterday: "Prescriptions written yesterday",
      "7d": "Prescriptions written in the last 7 days",
    },
    updated: "Updated",
    refresh: "Refresh",
    refreshed: (n: number) => `Updated. ${n} ${n === 1 ? "prescription" : "prescriptions"}.`,
    laneLabel: "Lane",
    stateLabel: "State",
    fromLabel: "Ward or clinic",
    allPlaces: "All wards and clinics",
    periodLabel: "Period",
    columns: {
      patient: "Patient",
      medicines: "Medicines",
      from: "From",
      state: "State",
      checks: "Checks at prescribing",
      written: "Written",
      action: "Open",
    },
    open: "Open",
    noFlags: "No flags",
    notRecorded: "Not recorded",
    more: (n: number) => `+${n}`,
    groupedByTime: "Grouped by time",
    showAll: "Show all",
    footer:
      "{n} of {N} prescriptions written {period}, {lane}. Oldest first. This list is read-only: a prescription stays here until the end of the day.",
    oneLane:
      "MedSync cannot yet tell window prescriptions from ward prescriptions at this hospital, so all are shown together.",
    emptyLane: "Nothing {lane} yet today. {n} {other lane}.",
    otherLanes: "in other lanes",
    emptyAll: "No prescriptions have been written today.",
  },
  find: {
    title: "Prescriptions for this patient",
    lede: "Prescriptions at this hospital in the last 30 days, newest first.",
    submit: "Find",
    close: "Close",
    label: "Find by patient number",
    none: "No prescription with that number at this hospital.",
  },
  emergency: {
    title: "Emergency doses",
    lede: "Doses given on the resus desk, as recorded there.",
    allCarts: "All carts",
    noCart: "No cart",
    cartLabel: "Cart",
    columns: {
      given: "Given",
      patient: "Patient",
      medicine: "Medicine",
      amount: "Amount, as recorded",
      cart: "Cart",
      givenBy: "Given by",
      episode: "Episode",
    },
    witness: (who: string) => `Controlled: witnessed by ${who}`,
    witnessNone: "Controlled: no witness recorded",
    witnessTypedLine: "Controlled: witness named at the bedside",
    periodInFooter: { today: "today", "7d": "in the last 7 days", "30d": "in the last 30 days" },
    notRecorded: "Not recorded",
    episode: (when: string) => `Resus ${when}`,
    empty: "No emergency doses were recorded in this period.",
    footer: (n: number, period: string) =>
      `${n} ${n === 1 ? "dose" : "doses"} ${period}, newest first. Read-only. A dose with no cart recorded appears under "No cart".`,
    unidentified: "Unidentified patient",
    witnessTyped: "Witness named at the bedside",
  },
  points: {
    note: "A dispensing point names where pharmacy staff work and which prescriptions their queue shows first. It holds no stock and records no dispensing yet.",
  },
  refused: {
    title: "No access",
    body: "You do not have access to the pharmacy workspace. Ask your hospital admin.",
  },
} as const;
