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
    already_declined: "You have already declined this request.",
    replay_mismatch: "That key belongs to another action.",
  },
  responsible: "The requesting team stays responsible for the patient.",
  /** The Plan screen (ADR 0537). */
  plan: {
    notNeeded: "Not needed",
    notNeededWhy: "Why no senior review?",
    notNeededHint: "A reason of three words or more; it goes into the note.",
    noTarget: "No review request will be sent: no team is set for this ward or for you.",
    ask: "Ask another team",
    reviewDisplay: (department: string) => `Senior review, ${department}`,
    consultDisplay: (department: string) => `Consult, ${department}`,
  },
  consultDialog: {
    title: "Ask another team",
    draft: "Draft wording, not CSO-signed",
    team: "Team",
    people: "Named people (optional)",
    noStaff: "No one is listed in this team yet.",
    urgency: "Urgency",
    urgencyChips: { urgent_today: "Urgent today", routine: "Routine" },
    help: "Help wanted",
    helpChips: { advice: "Advice only", see_patient: "Please see the patient" },
    problems: "Problems",
    question: "The question",
    phoned: "Already discussed by phone with… (optional)",
    cancel: "Cancel",
    add: "Add to basket",
    why: {
      team: "Choose the team.",
      urgency: "Choose the urgency.",
      help: "Say what help is wanted.",
      problems: "Tick at least one problem.",
      question: "Write the question.",
    },
  },
  unroutedNote: "Reached nobody: phone the team",
  /** The request lists and the workspace lanes (ADR 0537). A restricted request is never named. */
  read: {
    review: "Review",
    consult: (department: string) => `Consult · ${department}`,
    someone: "Someone",
    problem: "Problem",
    restrictedProblem: "A restricted problem: open the chart to see it",
    event: {
      routed: (who: string) => `Sent to ${who}`,
      unrouted: "Reached nobody",
      seen: (who: string) => `Seen by ${who}`,
      accepted: (who: string) => `Accepted by ${who}`,
      declined: (who: string, reason: string) => `Declined by ${who}: ${reason}`,
      redirected: (department: string, reason: string) => `Redirected to ${department}: ${reason}`,
      replied: (who: string) => `Replied by ${who}`,
      closed: (who: string) => `Closed by ${who}`,
      cancelled: (who: string, reason: string) => `Cancelled by ${who}: ${reason}`,
      escalated: (level: number) => `Escalated to level ${level}`,
    },
  },
  /** The notice's body; like the subject, it never names the patient. */
  noticeBody: "Open your requests in MedSync to see it.",
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
