/**
 * The desk's "Register a new patient" dialog (ADR 0475). Field labels and the notice are sign-up's own
 * (`content/onboarding.ts` PATIENT and CONSENT). Every line here marked DRAFT is new wording that waits for the
 * owner (CSO) and, for the consent lines, the lawyer (docs/legal/REVIEW.md). Nothing here is legal text.
 */
export const DESK_REGISTER = {
  open: "Register new patient",
  title: "Register a new patient",
  /** DRAFT (owner). */
  lead: "For someone with no MedSync account. They get a patient code at once. They can't sign in with it.",
  sections: { about: "About the patient", place: "Where they live" },
  /** DRAFT (owner). */
  phoneHint: "The patient's own mobile. Reminders go to it.",
  /** DRAFT (owner + lawyer): the desk records an agreement the patient gave in front of it. */
  consentAgree:
    "I read or showed this notice to the patient, and they agreed to it. My name is recorded with their agreement.",
  /** DRAFT (owner + lawyer), DPPA s.8 — sign-up refuses under 18 the same way. */
  under18: "Registering a child is not available yet. A parent or guardian must consent.",
  submit: "Register patient",
  pending: "Checking…",
  cancel: "Cancel",
  /** DRAFT (owner). */
  matchesTitle: (n: number) =>
    n === 1 ? "This may be them, already registered here" : "One of these may be them",
  /** DRAFT (owner). */
  matchesLead:
    "Check with the patient before you register them again. Two records for one person split their history.",
  useThis: "Use this record",
  /** DRAFT (owner). */
  someoneElse: "None of these is them: register new",
  back: "Back to the form",
  registered: (code: string) => `Registered · ${code}`,
  bookFor: "Book a visit for them →",
  confirmNow: "Now confirm the booking above",
} as const;

/** The desk gives a claim code, so the patient can take this record over when they sign up (ADR 0475, 0292). */
export const DESK_CLAIM = {
  open: "Give a sign-up code",
  title: "Give a sign-up code",
  /** DRAFT (owner). */
  lead: "For a patient this desk registered. Check it is them first. The code lets them take this record over when they create an account, so their visits stay in one record.",
  patientCode: "Patient code",
  patientCodeHint: "Like MS-2026-00012.",
  submit: "Give code",
  pending: "Giving…",
  close: "Close",
  /** DRAFT (owner). */
  given: "Write this on the patient's slip, or read it out:",
  /** DRAFT (owner). */
  how: (until: string) =>
    `On MedSync's sign-up page they choose "Use the code they gave you", and enter it with their mobile number. It works once, until ${until}. A new code replaces this one.`,
} as const;

/** The patient's side: /signup/patient/claim. DRAFT (owner) unless it is sign-up's own wording. */
export const PATIENT_CLAIM = {
  kicker: "Patient",
  title: "Take over your clinic record",
  lead: "A clinic registered you at its front desk and gave you a code. Use it here, and your visits stay in one record.",
  sections: { record: "Your clinic record", signin: "Your sign-in" },
  phone: "Mobile number",
  phoneHint: "The number you gave the clinic.",
  code: "Code from the clinic",
  codeHint: "8 letters and numbers, like ABCD-EFGH.",
  submit: "Take over my record",
  pending: "Checking…",
  after:
    "Your name, date of birth and visits come from the clinic's record. You can check them on your profile.",
  noCodeLink: "No code? Create an account without one (a separate record)",
  /** On sign-up, before anything is created. */
  signupLink: "A clinic registered you at its desk? Use the code they gave you",
  errors: {
    wrong_code:
      "That code and mobile number don't match. Check both, or ask the clinic for a new code.",
    expired: "This code has expired. Ask the clinic for a new one.",
    too_many_tries: "Too many wrong tries. Ask the clinic for a new code.",
    already_claimed: "This record already has an account. Sign in instead.",
    later: "Nothing was saved. Come back to this page with a new code from the clinic at any time.",
    emailTaken: "An account already uses this email. Sign in, or use another email.",
    busy: "Too many tries from here. Wait a minute and try again.",
    failed: "We couldn't take over the record. Nothing was changed. Try again.",
  },
} as const;
