/**
 * Landing v4 "Slim" — every visible string on `/` and `/about`.
 *
 * The copy deck is PROMPT-LANDING-v4-SLIM §2, verbatim; changing it needs
 * Fadhul's approval (founder + Clinical Safety Officer). Components read from
 * here and hold no strings of their own. The clinical strings that need CSO
 * sign-off before production (§6) are marked `CSO`.
 *
 * Section kickers are the section names from the brief's IA table (§1); the
 * only kicker the deck spells out is S2's "Why MedSync exists".
 *
 * Invariants enforced by tests/landing/invariants.test.ts: no dosing, no
 * clinician names in mocks, no named institutions, no internal/stale strings,
 * ≤ 1,300 visible words on `/`.
 */

export interface Cta {
  label: string;
  href: string;
}

/** A heading; `em` (a substring of `text`, ≤ 3 words) renders as the one teal-900 italic accent. */
export interface Heading {
  text: string;
  em?: string;
}

export interface Point {
  title: string;
  body: string;
}

export const SITE = {
  wordmark: "MedSync",
  place: "Kampala, Uganda",
  email: "hello@medsync.health",
} as const;

/** Chrome shared by every product mock. */
export const MOCK = { tag: "Illustrative" } as const;

export const CTA = {
  pilot: { label: "Apply for a hospital pilot", href: "/signup/hospital" },
  clinician: { label: "Join as a clinician", href: "/signup/clinical" },
  patient: { label: "I’m a patient →", href: "/signup/patient" },
  emergency: { label: "Emergency", href: "/emergency" },
} as const satisfies Record<string, Cta>;

export const NAV = {
  links: [
    { label: "Patients", href: "/#patients" },
    { label: "Hospitals", href: "/#hospitals" },
    { label: "Trust", href: "/#trust" },
    { label: "About", href: "/#about" },
  ],
  signIn: { label: "Sign in", href: "/sign-in" },
  apply: { label: "Apply for a pilot", href: "/signup/hospital" },
  menu: { open: "Open menu", close: "Close menu" },
} as const;

// S2 ─────────────────────────────────────────────────────────────────────────
export const GAP = {
  kicker: "Why MedSync exists",
  title: {
    text: "Care stops at the gate. Complications don’t.",
    em: "Complications don’t.",
  } satisfies Heading,
  quote:
    "She had written two months of blood sugar readings in a notebook. Every one was above 11. Nobody saw them until she came back for her second amputation.",
  attribution: "Dr. Usama Fadhul, co-founder",
  points: [
    {
      title: "Readings nobody sees.",
      body: "Home numbers sit in notebooks and device memories until the next crisis.",
    },
    {
      title: "Courses nobody finishes.",
      body: "Patients stop treatment when they feel better, and the hospital never finds out.",
    },
    {
      title: "Specialists who never see each other’s notes.",
      body: "The second doctor starts from the patient’s memory, not the first doctor’s plan.",
    },
  ] satisfies Point[],
} as const;

// S4 ─────────────────────────────────────────────────────────────────────────
export const PATIENTS = {
  kicker: "For patients",
  title: { text: "Your care team, in your pocket.", em: "in your pocket." } satisfies Heading,
  points: [
    {
      title: "Log a reading in seconds.",
      body: "Glucose, blood pressure or a symptom, with your recent trend always visible.",
    },
    {
      title: "Reminders on any phone.",
      body: "App notifications and plain SMS, so a basic handset works too. Reply to confirm.",
    },
    {
      title: "Tell your team something feels off.",
      body: "A person on your care team reviews it and decides whether a call or a visit is needed.",
    },
  ] satisfies Point[],
  /** CSO — required, visible, not a footnote. */
  honesty:
    "Your care team sees your readings once your hospital is on MedSync. MedSync is not an emergency service. If you feel very unwell, use Emergency or go to the nearest health facility.",
} as const;

/** CSO — S4 phone mock labels. No drug names, doses or frequencies. */
export const PHONE_MOCK = {
  aria: "Illustrative patient phone: morning medicine taken, midday medicine due, one medicine paused by the care team, five days on track.",
  today: "Today",
  items: [
    { label: "Morning medicine", state: "taken" },
    { label: "Midday medicine", state: "due" },
  ],
  paused: "One medicine paused by your care team",
  streak: "5 days on track",
  action: "Log a reading",
} as const;

// S5 ─────────────────────────────────────────────────────────────────────────
export const HOSPITALS = {
  kicker: "For hospitals & clinicians",
  title: {
    text: "One record, every shift, every specialty.",
    em: "every specialty.",
  } satisfies Heading,
  points: [
    {
      title: "The record adapts to the ward.",
      body: "Diabetes, cardiac, kidney and respiratory teams each see what matters to them first. Nobody re-enters data.",
    },
    {
      title: "The care team shares one timeline.",
      body: "Nursing observations, pharmacy holds, lab returns and home readings in one place.",
    },
    {
      title: "Run the ward, not the paperwork.",
      body: "Roles, departments, queues and shift handover from one console.",
    },
    {
      title: "Every clinician is verified.",
      body: "Staff accounts are anchored to council registration, not self-declared.",
    },
  ] satisfies Point[],
} as const;

/** CSO — the S5 "above target" row. Beds and roles only; no people, dates or labs. */
export const WARD_MOCK = {
  aria: "Illustrative ward console with specialty tabs for diabetes, cardiac, kidney and respiratory teams, and a patient list where one home reading above target is routed to the on-call doctor.",
  title: "Medical ward",
  tabs: ["Diabetes", "Cardiac", "Kidney", "Respiratory"],
  columns: ["Patient", "Latest", "With"],
  rows: [
    {
      who: "Bed 4",
      latest: "Reviewed on the round",
      with: "Ward doctor",
      chip: { label: "Stable", tone: "stable" },
    },
    {
      who: "Home",
      latest: "Fasting glucose",
      reading: "14.2 mmol/L",
      with: "On-call doctor",
      chip: { label: "Above target", tone: "caution" },
    },
    {
      who: "Bed 9",
      latest: "Pharmacy hold",
      with: "Pharmacist",
      chip: { label: "Pending", tone: "pending" },
    },
    {
      who: "Bed 12",
      latest: "Observations",
      with: "Ward nurse",
      chip: { label: "Due", tone: "pending" },
    },
  ],
} as const;

// S8 ─────────────────────────────────────────────────────────────────────────
/**
 * S8 FAQ (PROMPT-LANDING-S8 §1). Two answers are derived, not written:
 * "Is MedSync live?" follows lib/legal.ts `signupsOpen`, and "Is patient data
 * safe?" names only the trust claims whose status is "built"
 * (components/landing/faq.tsx builds both; tests/landing/faq.test.ts holds them).
 */
export const FAQ = {
  kicker: "FAQ",
  title: { text: "Questions we keep getting asked.", em: "asked." } satisfies Heading,
  contact: {
    lead: "Another question?",
    label: `Email ${SITE.email}`,
    href: `mailto:${SITE.email}`,
  },
  live: {
    q: "Is MedSync live?",
    open: "Not yet generally available. Founding hospital pilots are open for 2026, and clinicians and patients can register now.",
    closed:
      "Not yet generally available. Founding hospital pilots are open for 2026. Registration opens once our privacy notice is published; until then, email hello@medsync.health.",
  },
  items: [
    {
      q: "Who is it for?",
      a: "Hospitals first, up to national-referral scale. Then their clinicians, then their patients through home monitoring and SMS reminders.",
    },
    {
      q: "What does a pilot cost?",
      a: "Founding pilots pay no licence fee, only running costs such as SMS. In return we ask for regular clinician feedback. Pricing after the pilot is agreed in a conversation.",
    },
  ],
  safe: {
    q: "Is patient data safe?",
    /** Ends the generated answer; "Trust section" links to #trust. */
    ending: {
      before: "See exactly what is built and what is still being built in the",
      link: "Trust section",
      after: ".",
      href: "/#trust",
    },
  },
  next: {
    q: "What’s next?",
    a: "Deeper chronic-care tools and regional referral hospitals. Anything clinical, such as decision support, goes through ethics review and validation before a patient sees it.",
  },
} as const;

/** S8 closing band — the page's one dark moment (teal-900, full bleed). */
export const FINAL_CTA = {
  title: { text: "The patients are waiting.", em: "are waiting." } satisfies Heading,
  /** D3: Fadhul confirms "A founder reads every application" is true, or it goes. */
  sub: "Founding hospital pilots are open for 2026. A founder reads every application.",
} as const;

export const FOOTER = {
  description: "The hospital operating system that follows patients home.",
  columns: [
    {
      label: "Product",
      links: [
        { label: "Patients", href: "/#patients" },
        { label: "Hospitals", href: "/#hospitals" },
        { label: "Trust", href: "/#trust" },
      ],
    },
    {
      label: "Company",
      links: [
        { label: "About", href: "/#about" },
        { label: "Founders’ stories", href: "/about" },
        { label: "FAQ", href: "/#faq" },
      ],
    },
    {
      label: "Account",
      links: [
        { label: "Sign in", href: "/sign-in" },
        { label: "Get started", href: "/get-started" },
      ],
    },
  ],
  /** Until lib/legal.ts says both pages are published: plain text, never a link to a missing page. */
  legalPending: "Privacy and terms: in legal review",
  privacy: { label: "Privacy", href: "/privacy" },
  terms: { label: "Terms", href: "/terms" },
  /** Followed by lib/legal.ts `legalEntityName` (D2). */
  copyright: "© 2026",
  illustrative: "Sample data on this site is illustrative. No real patients.",
} as const;

/** /signup/* in production while sign-ups are closed (S8 D1, lib/legal.ts). */
export const SIGNUP_HOLD = {
  title: "Registration opens once our privacy notice is published.",
  /** Followed by the mailto link and a full stop. */
  lead: "For pilots, email",
} as const;
