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
