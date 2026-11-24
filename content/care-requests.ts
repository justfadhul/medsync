/**
 * Care requests: every visible string for reviews and consults.
 * Draft wording: awaiting CSO sign-off.
 */

export const CARE_REQUEST_COPY = {
  state: {
    unrouted: "Reached nobody",
    sent: "Sent",
    seen: "Seen",
    accepted: "Accepted",
    declined: "Declined",
    replied: "Replied",
    closed: "Closed",
    cancelled: "Cancelled",
  },
  urgency: {
    now: "Now",
    within_1h: "Within 1 hour",
    routine: "Routine",
    urgent_today: "Urgent, today",
  },
  help: {
    advice: "Advice",
    see_patient: "Please see the patient",
  },
  DECLINE_REASONS: {
    not_our_specialty: "Not our specialty",
    needs_other_team: "Needs another team",
    already_seen: "Already seen",
    more_information_needed: "More information needed",
    other: "Other",
  },
  REDIRECT_REASONS: {
    better_placed_team: "Another team is better placed",
    on_call_changed: "The on-call doctor has changed",
    other: "Other",
  },
  CANCEL_REASONS: {
    no_longer_needed: "No longer needed",
    patient_transferred: "Patient transferred",
    patient_died: "Patient died",
    entered_in_error: "Entered in error",
    other: "Other",
  },
  refusal: {
    final: "This request is finished.",
    not_open: "This request is not open to that action now.",
    not_asked: "This request was not asked of you.",
    requester_only: "Only the requesting team can do that.",
    not_declined: "Only a declined request can be redirected.",
    not_accepted: "Accept the request before replying.",
    not_replied: "Close the request after a reply.",
  },
  responsible: "The requesting team stays responsible for the patient.",
  unroutedNote: "Reached nobody: phone the team",
  /** Staff names and places only, never a patient (ADR 0199). */
  noticeSubject(
    kind: "care_request" | "care_request_update" | "ward_incoming",
    place: string,
  ): string {
    const head = {
      care_request: "New request",
      care_request_update: "Request update",
      ward_incoming: "Incoming patient",
    }[kind];
    return `${head} · ${place}`;
  },
} as const;
