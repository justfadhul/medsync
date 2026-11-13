/**
 * Tether landing page (PROMPT-LANDING-TETHER): every string a visitor reads on `/`, except the
 * modes (`modes.ts`), the questions (`faq.ts`) and the links (`links.ts`). Copied word for word
 * from the canvas "Tether Landing Page Prototype" (Main and Mobile boards).
 *
 * A string that differs from the canvas carries a `PROPOSED D-LP-nn` comment with the canvas text;
 * it waits on that GATE A decision (docs/landing/gate-a-proposal.md). Dates are functions of the
 * rolling example visit (D-LP-08), so no fixed date is written here.
 *
 * The CSO signs; Claude never edits the status.
 */
import type { SignedCopy } from "@/content/signed-copy";

export const TETHER_LANDING_COPY_STATUS: SignedCopy = {
  status: "draft",
  signedBy: null,
  signedOn: null,
};

/** The example visit: always six days ahead at 10:40, Africa/Kampala (D-LP-08). */
export const EXAMPLE = {
  patient: "Sarah Namubiru",
  firstName: "Sarah",
  initials: "SN",
  sexAge: "Female · 36 years",
  clinic: "Diabetes Clinic",
  code: "K7M42Q",
  codeSplit: "K7M 42Q",
  fee: "UGX 50,000",
  /** PROPOSED D-LP-04: invented names until each doctor's written consent is on file.
   *  Canvas: Dr. Nayiga Joselyn Mirembe (NM), Dr. Nelson Nuwagira (NN), Dr. Caroline Murizihiwe (CM).
   *  The invented names are for Fadhul to pick; until then the build shows initials only. */
  doctors: [] as readonly { initials: string; name: string }[],
  /** D-LP-04 signed: initials only on the doctor line (canvas avatars). */
  doctorInitials: ["NM", "NN", "CM"],
} as const;

export const NAV = {
  brand: "Tether",
  sectionsLabel: "Sections",
  links: [
    { label: "How it works", href: "#how" },
    { label: "Ways to book", href: "#modes" },
    { label: "Patients and clinics", href: "#who" },
    { label: "Questions", href: "#questions" },
  ],
  signIn: "Sign in",
  book: "Book a visit",
  register: "Register your clinic",
  theme: { light: "Light", dark: "Dark" },
  /** Phone app bar and menu. */
  menu: "Menu",
  close: "Close",
  darkMode: "Dark mode",
} as const;

export const HELP = {
  label: "Help",
  /** §9: Help's accessible name. Canvas phone board: "Emergency help". */
  name: "Help, emergency",
  tooltip: "Only for emergencies",
  /** Phone Help dialog (STOP 0 ruling 1: a centred dialog, not a sheet). */
  title: "Is this an emergency?",
  /** PROPOSED D-LP-06: with the pre-alert flag off. Canvas: "Don't wait for a booking. Go straight to
   *  the nearest hospital's emergency entrance. Tap below on the way and we tell them you're coming." */
  body: "Don't wait for a booking. Go straight to the nearest hospital's emergency entrance.",
  /** Canvas text; shown only while FEATURE_PRE_ALERT is on (D-LP-06). */
  bodyPreAlert:
    "Don't wait for a booking. Go straight to the nearest hospital's emergency entrance. Tap below on the way and we tell them you're coming.",
  preAlert: "Tell the hospital I'm coming",
  /** PROPOSED D-LP-06: the main button when pre-alert is off. Goes to /emergency (STOP 0 ruling 2). */
  open: "Open Help",
  notUrgent: "It's not urgent. Book a visit",
} as const;

export const HERO = {
  /** The headline reads "Book your {noun} {place}". */
  lead: "Book your",
  lines: [
    { noun: "clinic visit", place: "from home.", emergency: false },
    { noun: "clinic visit", place: "on the road.", emergency: false },
    /** PROPOSED D-LP-01. Canvas: noun "emergency visit", place "on the way." The proposal replaces the
     *  whole line, so it is held as `whole`. */
    {
      noun: "emergency visit",
      place: "on the way.",
      emergency: true,
      whole: "Going to emergency? Tell them on the way.",
    },
  ],
  /** The headline's accessible name. PROPOSED D-LP-01. Canvas: "Book your clinic visit from home or on the
   *  road. In an emergency, tell the hospital you are on the way." */
  label:
    "Book your clinic visit from home or on the road. In an emergency, go straight to the hospital.",
  sub: "See which days your clinic is open, choose one, and we'll text you a code. When you get there, reception already knows you're coming.",
  /** PROPOSED D-LP-06: with pre-alert off. Canvas: "Don't wait for a booking. Go straight to the hospital
   *  and tap Help, and we tell them you're on the way so they're ready when you arrive." */
  subEmergency: "Don't wait for a booking. Go straight to the hospital's emergency entrance.",
  subEmergencyPreAlert:
    "Don't wait for a booking. Go straight to the hospital and tap Help, and we tell them you're on the way so they're ready when you arrive.",
  book: "Book a visit",
  register: "Register your clinic",
  pilot: "In a 30-day pilot with private clinics in Uganda.",
  /** PROPOSED D-LP-07: one line under the hero ticket. Not on the canvas. */
  exampleNote: "This is an example ticket.",
} as const;

export const TICKET = {
  brand: "Tether",
  /** §9 and LP1: the accessible names start with "Example". Canvas front: "Example visit ticket for Sarah
   *  Namubiru, Thursday 19 November at 10:40. Turn the ticket over." */
  frontName: (when: string) =>
    `Example visit ticket for ${EXAMPLE.patient}, ${when}. Turn the ticket over.`,
  backName: "Back of the ticket. Turn it back over.",
  modeName: "Example ticket for the way of booking you picked. Turn the ticket over.",
  /** Visible label on the ticket (D-LP-07, optional). */
  example: "Example",
  status: { ok: "Confirmed", coming: "Coming", cancelled: "Cancelled" },
  date: "Date",
  time: "Time",
  clinic: "Clinic",
  /** PROPOSED D-LP-02: canvas "In line" / "No. 7". */
  line: "In line",
  lineValue: "Place saved",
  doctors: "Doctors in this clinic",
  countdown: {
    label: "Time left until the visit",
    startsIn: "Starts in",
    now: "It is time",
    units: ["d", "h", "m", "s"],
  },
  stub: {
    hint: "Your code · tap to copy",
    copyName: "Copy the code K 7 M 4 2 Q",
    copied: "Copied",
    yourCode: "Your code",
    offline: "Works with no internet",
    tear: "Tear off the stub",
    reattach: "Put the stub back",
  },
  back: {
    deskTitle: "At the desk",
    desk: "Show the code below, or just say the letters. Reception will check you in.",
    where: "Where",
    whereValue: "Room: ask at the desk",
    fee: "Fee",
    feeNote: "Pay at the clinic",
    bring: "Please bring",
    bringItems: ["Your medicines", "Clinic book"],
    cantCome: "Can't come?",
    /** PROPOSED D-LP-05 until inbound SMS is live. Canvas: "Cancel from your visits, or reply CANCEL K7M42Q
     *  to our text." */
    cancel: "Cancel from your visits, or call the clinic.",
    cancelSms: "Cancel from your visits, or reply CANCEL K7M42Q to our text.",
  },
  actions: {
    coming: "I'm coming",
    comingDone: "The clinic expects you",
    /** Phone: canvas Mobile board. */
    comingDoneShort: "Expected",
    cancel: "Cancel",
    again: "Book it again",
    /** Phone: one row of three. */
    againShort: "Book again",
    turn: "Turn it over",
    turnShort: "Turn",
    turnName: "Turn the ticket over",
  },
  /** Phone toasts after each action. */
  toast: {
    coming: "The clinic knows you are coming",
    cancelled: "Visit cancelled. Your place goes to someone else",
  },
} as const;

export const SMS = {
  /** Desktop card heading; the phone notification shows "Tether" and "now". */
  heading: "Text message · now",
  now: "now",
  ok: (date: string, time: string) =>
    `Your visit is booked for ${date} at ${time}. Your code is ${EXAMPLE.code}.`,
  coming: (date: string, time: string) =>
    `Thank you, ${EXAMPLE.firstName}. The clinic expects you on ${date} at ${time}.`,
  cancelled: (date: string) => `Your visit on ${date} is cancelled. You can book again any time.`,
} as const;

/** Revealed word by word with scroll. */
export const STATEMENT =
  "You choose the clinic and the day. We hold your place, text you a code, and tell reception you're coming. On the day, you walk in, show the code and join the line.";

export const STEPS = {
  kicker: "How it works",
  title: "Five steps from booking to being seen",
  /** Phone heading and labels. */
  titleShort: "From booking to being seen",
  listName: "Five steps",
  dotName: "Go to step",
  counter: (n: number) => `Step ${n} of 5`,
  items: [
    {
      title: "Say why, pick a day",
      body: "Choose why you are coming, then a day the clinic is open.",
    },
    { title: "Get your code", body: "Your place is saved and a six-character code comes by text." },
    /** PROPOSED D-LP-05: "reply YES" needs inbound SMS too. Canvas: "The day before, tap I'm coming or
     *  reply YES to the text." Proposed until inbound SMS is live: "The day before, tap I'm coming." */
    { title: "Say you're coming", body: "The day before, tap I'm coming." },
    {
      title: "Check in at the desk",
      body: "Show your code or give your name. Reception sends you on.",
    },
    { title: "Be seen", body: "Wait in the clinic's queue until the clinician calls you in." },
  ],
} as const;

export const MODES_SECTION = {
  kicker: "Ways to book",
  title: "Each clinic chooses how it takes bookings",
  hint: "Swipe the ticket to compare",
  /** Phone hint. */
  hintPhone: "Swipe the ticket, or tap it to turn it over",
  groupName: "Ways to book",
  /** PROPOSED D-LP-02: the honesty sentence under the facts. Not on the canvas. */
  honesty: "We save your place in line. We cannot tell you the hour.",
} as const;

export const DUO = {
  kicker: "Patients and clinics",
  title: "One booking, seen from both sides of the desk",
  /** Phone heading. */
  titleShort: "One booking, both sides of the desk",
  hint: 'Try it. Tap "I\'m coming" on the patient\'s side, then "Check in" on the desk\'s side, and watch each side update the other.',
  hintPhone: "Tap I'm coming as the patient, then switch to reception and check her in.",
  switchName: "Whose screen",
  tabs: { patient: "Patient", reception: "Reception" },
  patient: {
    title: "What the patient sees",
    next: "Your next visit",
    when: (date: string, time: string) => `${date} · ${time}`,
    clinicCode: `${EXAMPLE.clinic} · code`,
    coming: "Thank you. Show your code at the desk when you arrive.",
    checkedIn: "You're checked in. Take a seat until you are called.",
    points: [
      "See the fee before you ask for a day",
      "Cancel it yourself, with no phone call",
      "No smartphone? The clinic can book for you",
    ],
  },
  desk: {
    title: "What reception sees",
    /** Desktop: the decorative label between the two cards (aria-hidden on the canvas). */
    divider: "the desk",
    columns: { time: "Time", patient: "Patient", status: "Status" },
    /** The other rows carry no names (grey bars on the canvas). */
    rows: [
      { time: "09:30", status: "Here" },
      { time: "11:15", status: "Expected" },
      { time: "11:40", status: "Expected" },
    ],
    status: { expected: "Expected", coming: "Coming", here: "Here", checkedIn: "Checked in" },
    checkIn: "Check in",
    reset: "Start again",
    points: [
      "Set your weekly clinic days once",
      "Book for people who phone in",
      "Mark a day late or closed, and patients are told",
    ],
  },
  toast: {
    reception: "Reception now sees: Coming",
    patient: `${EXAMPLE.firstName} now sees: Checked in`,
  },
} as const;

export const COMING = {
  kicker: "Coming after booking",
  title: "Booking is where we start.",
  body: "Tether is being built to stay with you after the visit. These are next, and they are not live yet.",
  /** Phone body. */
  bodyPhone: "These are next. They are not live yet.",
  soon: "Soon",
  /** PROPOSED D-LP-10: hidden until its target says Tether. */
  future: "See the future of Tether",
  items: [
    {
      title: "Readings from home",
      body: "Log your blood pressure and sugar at home, where your care team can see them.",
      bodyPhone: "Log your blood pressure and sugar where your care team can see them.",
    },
    {
      title: "Medicine reminders",
      body: "A nudge when a dose is due, and a record of what you took.",
    },
    {
      title: "Lab results and refills",
      body: "Results on your phone, and medicines without the pharmacy queue.",
    },
  ],
} as const;

export const QUESTIONS_SECTION = {
  kicker: "Questions",
  title: "Ask before you book",
  searchLabel: "Search the questions",
  placeholder: "Type a word, like fee or cancel",
  placeholderPhone: "Search, like fee or cancel",
  topicsName: "Topics",
  noneBefore: "Nothing matches that yet. Try another word, or write to",
  noneAfter: "and we will answer you.",
} as const;

export const FOOTER = {
  closing: "Book the visit. Keep the day.",
  book: "Book a visit",
  join: {
    title: "Want your clinic on Tether?",
    /** Phone card. */
    titlePhone: "Run a clinic?",
    bodyPhone: "Leave your email and we will set your clinic up.",
    label: "Your email",
    fieldName: "Enter your email",
    placeholderPhone: "you@clinic.com",
    submit: "Register your clinic",
    bad: "Please enter a full email address, like name@clinic.com.",
    /** PROPOSED D-LP-09 (brief §5.5). Canvas: "Thank you. This is a prototype, so nothing has been sent
     *  yet. The live site will pass {email} to the Tether team." */
    done: "Thank you. We will email you about setting up your clinic.",
    /** PROPOSED D-LP-09: the purpose notice (DPPA 2019). Not on the canvas. */
    notice: "We use this email only to contact you about Tether.",
    /** PROPOSED (Step 6): when the store fails. Not on the canvas. */
    failed: "We could not send that. Please try again, or write to us.",
    /** The honeypot field's label; hidden from people (D-LP-09). */
    honeypot: "Company",
  },
  contact: "Contact",
  place: "Kampala, Uganda",
  /** `href: null` is hidden (D-LP-10: the future link). "In an emergency" goes to Help (STOP 0 ruling 2). */
  columns: [
    {
      title: "Tether",
      links: [
        { label: "How it works", href: "#how" },
        { label: "Ways to book", href: "#modes" },
        { label: "Patients and clinics", href: "#who" },
        { label: "The future of Tether", href: null },
      ],
    },
    {
      title: "Help",
      links: [
        { label: "Questions", href: "#questions" },
        { label: "In an emergency", href: "/emergency" },
      ],
    },
    {
      title: "Get started",
      links: [
        { label: "Book a visit", href: "#modes" },
        { label: "Register your clinic", href: "#join" },
        { label: "Sign in", href: "/sign-in" },
      ],
    },
  ],
  /** Open under D-LP-10 (the registered company name). Canvas text, unchanged. */
  copyright: "© 2026 MedSync · Kampala, Uganda",
  copyrightPhone: "© 2026 MedSync · Privacy and terms: in legal review",
  legal: "Privacy and terms: in legal review",
} as const;

/** PROPOSED (brief §5.7): the title is the brief's; the description is mine, built from canvas lines. */
export const META = {
  title: "Tether: book your clinic visit",
  description:
    "Book a visit at your clinic, get a code by text, and show it at the desk. In a 30-day pilot with private clinics in Uganda.",
} as const;
