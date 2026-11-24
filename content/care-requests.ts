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
    pharmacy: "The pharmacy cannot be asked for a review or a consult.",
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
  /** The request pages (/doctor/requests, /clinician/requests) and their dialogs (ADR 0537). */
  page: {
    title: "Requests",
    metaTitle: (surface: string) => `Requests · ${surface} · MedSync`,
    overline: "Reviews and consults",
    lead: "Reviews and consults asked of you, of your department, and by you. Nothing is accepted, answered or closed by itself.",
    nav: "Requests",
    sections: {
      asked: "Asked of you",
      department: "For your department",
      sent: "Sent by you",
    },
    empty: {
      asked: "Nothing is asked of you.",
      department: "Nothing is waiting for your department.",
      sent: "You have no open requests.",
    },
    from: (who: string, cadre: string) => `From ${who}, ${cadre}`,
    to: (department: string) => `To ${department}`,
    asked: (ago: string) => `Asked ${ago} ago`,
    hiddenPatient: "Restricted request: patient not shown",
    overdue: "Overdue",
    open: "Open",
    delayed: "Escalations may be delayed. Phone the team for anything urgent.",
    dueBy: (time: string) => `Due by ${time}`,
    overdueBy: (ago: string) => `Overdue by ${ago}`,
  },
  dialog: {
    question: "The question",
    hiddenQuestion: "Restricted: the question shows once you have access to the chart.",
    urgency: "Urgency",
    help: "Help wanted",
    problems: "Problems",
    history: "History",
    ago: (ago: string) => `${ago} ago`,
    openChart: "Open chart",
    note: "Note (optional)",
    working: "Saving…",
    accept: {
      title: "Accept",
      expect: "Expect me in",
      chips: { 15: "15 min", 30: "30 min", 60: "1 h", none: "No time" },
      button: "Accept",
    },
    decline: {
      title: "Decline",
      reason: "Reason",
      button: "Decline",
      why: "Choose a reason to decline.",
    },
    redirect: {
      title: "Redirect",
      team: "To team",
      reason: "Reason",
      button: "Redirect",
      whyTeam: "Choose the team.",
      whyReason: "Choose a reason to redirect.",
    },
    cancel: {
      title: "Cancel the request",
      reason: "Reason",
      button: "Cancel request",
      why: "Choose a reason to cancel.",
    },
    close: {
      title: "Close",
      hint: "The reply is in. Close the request when you are done.",
      button: "Close request",
    },
    reply: {
      title: "Reply",
      hint: "Write the reply as a signed note on this visit.",
      button: "Reply",
    },
  },
  replyDialog: {
    title: "Reply to the request",
    draft: "Draft wording, not CSO-signed",
    findings: "Findings (optional)",
    assessment: "Assessment",
    recommendations: "Recommendations",
    followUp: "Follow-up",
    followUpChips: { again: "I will see the patient again", none: "No follow-up needed" },
    noFollowUpCloses: "No follow-up needed also closes the request.",
    cancel: "Cancel",
    sign: "Sign and send",
    why: {
      assessment: "Write the assessment.",
      recommendations: "Write the recommendations.",
      followUp: "Say whether you will see the patient again.",
    },
  },
  /** The notice's body; like the subject, it never names the patient. */
  noticeBody: "Open your requests in MedSync to see it.",
  /** Draft wording, not CSO-signed: the requester's notice when a request escalates (D7); never the patient. */
  escalatedBody(
    until: "accepted" | "replied",
    minutes: number,
    step: string,
    post: string | null,
  ): string {
    const waited = until === "accepted" ? "Not accepted" : "No reply";
    const asked =
      step === "post" && post
        ? `asked the ${post}`
        : step === "department_head"
          ? "asked the head of department"
          : step === "hospital_contacts"
            ? "asked the hospital contacts"
            : "reached nobody: phone the team";
    return `${waited} after ${minutes} min; ${asked}.`;
  },
  /** Draft wording, not CSO-signed: the nurse in charge's notice at admission; never the patient. */
  wardIncomingBody: "A patient is being admitted to your ward. See the bed board.",
  /** Response times set by the hospital, countersigned by the CSO (D4). Draft wording. */
  times: {
    title: "Response times for requests",
    none: "No response times are signed: requests do not escalate.",
    inForce: "In force",
    source: "D4 defaults, approved by the owner (CSO) on 24 Nov 2026",
    sourceLabel: "Source",
    unit: "min",
    reviewNow: "Review now: accept within",
    review1h: "Review within 1 hour: accept within",
    consultUrgent: "Urgent consult, today: accept within",
    routine: "Routine, either kind: reply within",
    save: "Save draft",
    sign: "Sign for the hospital",
    whyNoSign: "Save the draft first: the signature covers the saved times.",
    saved: "Draft saved. It is not in force until the hospital admin and the CSO have both signed.",
    signed: "Signed. The CSO countersigns next.",
    waitingForCso: "Waiting for the CSO",
    signedByAdmin: "Signed by the hospital admin",
    hospital: "Hospital",
    staff: "Staff",
    version: (n: number) => `version ${n}`,
    metaAdmin: "Response times for requests · Hospital admin · MedSync",
    metaCso: "Request response times · Admin · MedSync",
    changedSince: "These times changed since you saw them. Reload the page and look again.",
    fields: {
      reviewNowAcceptMin: "Review now",
      review1hAcceptMin: "Review within 1 hour",
      consultUrgentAcceptMin: "Urgent consult",
      routineReplyMin: "Routine",
    },
    range: (what: string) => `${what}: whole minutes, 1 to 2880.`,
    sourceShort: "Say where these times come from.",
    failed: "Could not save the response times. Try again.",
    reauth: "Enter your authenticator code to sign.",
    csoTitle: "Request response times",
    csoNone: "No request response times are waiting for the CSO.",
    csoSign: "Countersign as CSO",
    csoSigned: "Signed. These response times are now in force.",
    csoAlone: "You signed as the admin. If no one else can sign as CSO, say why",
    csoOnly: "Only the clinical safety officer signs here.",
  },
  /** The in-app notices list (staff names and places only). */
  notices: {
    title: "Notices",
    dismiss: "Dismiss",
    dismissFailed: "Could not dismiss the notice.",
    invalid: "Invalid input.",
    signIn: "Sign in again.",
  },
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
