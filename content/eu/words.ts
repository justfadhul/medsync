/**
 * DRAFT wording for the CSO. Every visible string of the emergency-unit (EU) work lives here; nothing is final
 * until the Clinical Safety Officer signs it off.
 */

/** The ward form: an emergency unit sits under an ordinary ward, for display only. */
import { EU_SEND_FROM_VISIT } from "@/supabase/functions/_shared/eu";

export const EU_WARD = {
  attachedTo: "Attached to (for display)",
  noParent: "Not attached",
  sendFromVisit: EU_SEND_FROM_VISIT,
  waitNoteTooLong: "Keep the note under 500 characters.",
} as const;

/** Send to EU: the Plan's "Observe in EU" and the close dialog. */
export const EU_SEND = {
  planChoose: "Emergency unit",
  planNone: "No emergency unit is set up at this hospital yet. The hospital admin sets one up.",
  group: "Emergency unit",
  space: "Space",
  need: "What the patient needs",
  noFreeSpace: "No free space in this unit now.",
  waiting: "Send and wait for a space",
  waitWhy: "Why the patient waits",
  send: "Send to EU",
  sent: "Sent to the EU. The visit stays open.",
  noLayout: "This unit has no published layout, so its spaces can’t be picked here.",
  inSpace: (ward: string, bed: string | null, since: string) =>
    `In ${ward}${bed ? ` · ${bed}` : ""} since ${since}`,
  awaiting: (ward: string) => `Waiting for a space in ${ward}`,
  boarding: (ward: string, waited: string) => `Admitted · ${ward} · waiting ${waited}`,
  closeEnds: "Closing the visit ends the stay in the EU.",
  chooseUnit: "Choose the emergency unit.",
  chooseSpace: "Choose a space, or say why the patient waits for one.",
  sayWhy: "Say why the patient waits.",
} as const;

/** The ward board: an EU space is Arrived and Moved, never Released. */
export const EU_BOARD = {
  arrivedNote:
    "Arrived makes the space Occupied. The patient stays on their visit; nothing opens on an inpatient record.",
  moveSection: "Move the patient",
  move: "Move…",
  moveTitle: (from: string) => `Move the patient out of ${from}`,
  moveSpace: "To a free space",
  noFreeSpace: "No free space in this unit now.",
  moveWait: "Or wait for a space",
  waitWhy: "Why the patient waits",
  waitNote: "Note (optional)",
  moveSpaceAction: (to: string) => `Move to ${to}`,
  moveWaitAction: "Move to the waiting list",
  keep: "Keep them here",
  chooseSpace: "Choose a space, or say why the patient waits for one.",
} as const;

/** The tracking board's status words, Needs attention lines and level words. DRAFT wording for the CSO. */
export const EU_TRACK = {
  waiting: "Waiting for a space",
  arriving: "Arriving",
  inEu: "In EU",
  admitted: (ward: string) => `Admitted · ${ward} · waiting for a ward bed`,
  admissionEnded: "Admission ended · in EU",
  overLimit: (hours: number) => `In the EU over ${hours} h`,
  arrivingLong: "Arriving for over 1 h",
  obsOverdue: "Observations overdue",
  boardingLong: "Waiting for a ward bed over 12 h",
  waitingSpace: "Waiting for a space",
} as const;

/** The patient's urgency in the hospital's own triage words. DRAFT for the CSO; level 5 is never Blue (SATS Blue means dead). */
export const EU_LEVEL_WORDS = {
  sats: ["Red", "Orange", "Yellow", "Green", "Green"],
  etat: ["Emergency", "Priority", "Priority", "Queue", "Queue"],
  own: ["Red", "Orange", "Yellow", "Green", "Green"],
} as const;

/** The EU list on the boards and the doctor's EU view. DRAFT wording for the CSO. */
export const EU_LIST = {
  view: "Board view",
  plan: "Plan",
  list: "List",
  title: "Emergency unit list",
  needsAttention: "Needs attention",
  empty: "Nobody is in this unit now.",
  noSpace: "Waiting for a space",
  overLimit: (hours: number) => `Over ${hours} h`,
  resultsBack: "Results back",
  resus: "Open resus",
  noMrn: "No MRN",
  continuous: "Continuous",
  notSet: "Not set",
  overdue: "overdue",
  none: "None",
  col: {
    space: "Space",
    patient: "Patient",
    level: "Urgency",
    inHospital: "In hospital",
    inEu: "In EU",
    inSpace: "In space",
    boarding: "Boarding",
    clinician: "Responsible clinician",
    nextObs: "Next obs due",
    results: "Results",
    status: "Status",
    resus: "Resus",
  },
  doctor: {
    title: "Emergency unit",
    noUnits: "This hospital has no emergency unit set up.",
    notOnDuty: "The EU list shows to the EU doctor on duty, from the duty rota.",
    units: "Emergency units",
  },
} as const;

/** Triage sends a Level 1–2 patient straight to a free EU resus space (D4). DRAFT wording for the CSO. */
export const EU_RESUS = {
  title: "Send to EU resus",
  chip: (ward: string, space: string) => `${ward} · ${space}`,
  offline: "Needs a connection",
  sent: (ward: string, space: string) => `Sent to EU resus · ${ward} · ${space}.`,
} as const;
