/**
 * "How booked" on the desk's Expected list (ADR 0101 ruling 2), and the order
 * that list keeps. The label is words, never a sort key — the app must not
 * outrank anyone who booked another way (PRD equity rule). Pure and
 * import-free so a test can reach it without the query layer.
 */

/** A booking's channel of record. `origin` is read first: a system-proposed
 * urgent booking is written with channel 'web', and it is not a web booking. */
export function appointmentBookedVia(origin: string, channel: string): string {
  if (origin === "system_urgent") return "Urgent (system)";
  if (origin === "ussd" || channel === "ussd") return "USSD";
  if (origin === "reception" || channel === "desk") return "At the desk";
  if (origin === "clinician" || origin === "nurse") return "By a clinician";
  if (channel === "app") return "Phone app";
  return "Web";
}

/** A ticket with no booking behind it: the patient's own "coming today", a pre-alert, or a walk-in. */
export function intakeBookedVia(declaredByPatient: boolean, entryTypeCode: string): string {
  if (declaredByPatient) return "Same day (patient)";
  if (entryTypeCode === "self_presentation_prealerted") return "Pre-alert";
  return "Walk-in";
}

/**
 * The Expected list's order: when they booked, then id, so the order is total
 * and stable between polls. Nothing else — not the channel, not anything the
 * patient said. ISO-8601 in UTC compares correctly as text.
 */
export function byBookedAt(
  a: { bookedAtIso: string; id: string },
  b: { bookedAtIso: string; id: string },
): number {
  return a.bookedAtIso.localeCompare(b.bookedAtIso) || a.id.localeCompare(b.id);
}
