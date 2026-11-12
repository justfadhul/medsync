/**
 * Book a visit, Something is wrong, Come today and Ask for a day (PROMPT-PATIENT-WEB-TIDE Step 4). Phone
 * strings are copied word for word from mobile/src (the file is named beside each group); web-only strings
 * are marked "web". Symptom labels, follow-up questions, tier words and the closing sentence are NOT here:
 * they come from the symptom catalogue package (W2). The CSO signs; Claude never edits the status.
 */
import type { SignedCopy } from "@/content/signed-copy";
import type { PatientReasonCode } from "@/supabase/functions/_shared/sessions-sql";

export const BOOK_COPY_STATUS: SignedCopy = {
  status: "draft",
  signedBy: null,
  signedOn: null,
};

/** The planned-care reasons' icons, drawn by the page from Lucide. */
export type ReasonIcon =
  | "replay"
  | "check"
  | "pill"
  | "flask"
  | "heart"
  | "shield"
  | "trend"
  | "building"
  | "send"
  | "plus"
  | "message"
  | "eye";

export interface PlannedReason {
  reason: PatientReasonCode;
  label: string;
  hint: string;
  icon: ReasonIcon;
}

/**
 * mobile/src/features/visits/book-reasons.ts (copied: its file imports an RN icon type). Every Appendix A
 * reason but `new_concern`, which is the other door and goes through the symptom steps first.
 */
export const PLANNED_GROUPS: readonly { title: string; reasons: readonly PlannedReason[] }[] = [
  {
    title: "Your health",
    reasons: [
      {
        reason: "follow_up",
        label: "Check on a condition I have",
        hint: "Diabetes, blood pressure, asthma, HIV, epilepsy, heart or kidney: any condition a clinic follows.",
        icon: "replay",
      },
      {
        reason: "routine",
        label: "Check-up or screening",
        hint: "When nothing is wrong: blood pressure, sugar, eyes, cancer screening.",
        icon: "check",
      },
      {
        reason: "refill",
        label: "Refill my medicines",
        hint: "More of a medicine, or a review of it.",
        icon: "pill",
      },
      {
        reason: "test_results",
        label: "A test or my results",
        hint: "A lab test only, or to go through results with the clinic.",
        icon: "flask",
      },
    ],
  },
  {
    title: "Pregnancy and children",
    reasons: [
      {
        reason: "antenatal",
        label: "Pregnancy check",
        hint: "Antenatal visits while you are pregnant.",
        icon: "heart",
      },
      {
        reason: "immunisation",
        label: "My child's vaccines",
        hint: "A vaccine on the schedule.",
        icon: "shield",
      },
      {
        reason: "child_wellness",
        label: "My child's growth check",
        hint: "Weight, growth and development.",
        icon: "trend",
      },
    ],
  },
  {
    title: "After care",
    reasons: [
      {
        reason: "post_discharge",
        label: "After a hospital stay",
        hint: "A review after you were admitted.",
        icon: "building",
      },
      {
        reason: "specialist_review",
        label: "I was referred",
        hint: "A doctor sent you to a specialist clinic.",
        icon: "send",
      },
      {
        reason: "procedure",
        label: "A procedure or dressing",
        hint: "A planned procedure, or a wound dressing.",
        icon: "plus",
      },
    ],
  },
  {
    title: "Support",
    reasons: [
      {
        reason: "counselling",
        label: "Talk to someone",
        hint: "Counselling or support.",
        icon: "message",
      },
      {
        reason: "second_opinion",
        label: "A second opinion",
        hint: "Another clinician's view.",
        icon: "eye",
      },
    ],
  },
];

export const BOOK_COPY = {
  // mobile/src/features/visits/parts.tsx — law L8, ADR 0084, exactly.
  honest: "We save your place in line. We cannot tell you the hour.",

  // mobile/src/app/(app)/book/index.tsx
  back: "Back",
  overline: "Visits",
  title: "Book a visit",
  me: "Me",
  addSomeone: "Add someone",
  whoTitle: "Who is this visit for?",
  howTitle: "How do you want to come?",
  openNow: "Open now",
  noWalkIns: "No clinic takes walk-ins now",
  today: "Today",
  comeTodayTitle: "Come to the hospital today",
  comeTodayOff: "Coming today is for your own visit for now. Ask for a day for someone else.",
  nextOpenDay: (day: string) => `Next open day: ${day}`,
  pickOpenDay: "Pick an open day",
  askDayTitle: "Ask for a day",
  askDayLine: "Pick an open clinic day. The clinic confirms it.",
  footnote: "Very unwell right now? Do not book. Press the red Help button.",

  // mobile/src/features/visits/why-coming.tsx
  whyTitle: "Why are you coming?",
  doorWrong: "Something is wrong",
  doorWrongSub: "I feel unwell, or something is new or worse",
  doorPlanned: "Planned care",
  doorPlannedSub: "A check, a refill, results, pregnancy, a child",
  whereTitle: "Where do you feel it?",
  whereLine: "Pick an area. We ask a few questions, then suggest the right door.",
  somethingElse: "Something else",
  veryUnwell: "Very unwell right now? Do not book.",

  // mobile/src/features/visits/hospital-picker.tsx
  pickHospitalTitle: "Choose your hospital first",
  pickHospitalLine: "We show its clinics, doctors and open days. You can change it later.",
  hospitalsFailed: "Couldn't load the hospitals. Check your connection.",
  noHospitals: "No hospital is on MedSync yet.",
  hospitalSaveFailed: "Couldn't save your hospital. Try again.",
  chooseHospital: (name: string) => `Choose ${name}`,
  yourHospital: "Your hospital",
  // /patient/hospitals: the first page for a patient with no hospital, and Me's "change hospital".
  hospitalsTitle: "Your hospital",
  welcome: (first: string | null) => (first ? `Welcome, ${first}` : "Welcome"),
  changeHospitalTitle: "Change your hospital",
  changeHospitalLine: "Your visits and records stay with you. Booking uses the hospital you pick.",
  backToMe: "Me",
  tryAgain: "Try again",
} as const;

export const WRONG_COPY = {
  // mobile/src/app/(app)/symptoms.tsx
  title: "Something is wrong",
  overline: "Book a visit",
  loading: "Loading the questions",
  off: "This is not available yet. You can still book a visit or come to the hospital today.",
  keptTryAgain: (error: string) => `${error} Your choices are kept. Try again.`,
  chooseHospitalFirst: "Choose your hospital on the home screen first.",
  chosen: (n: number, many: boolean) => `${n} chosen${many ? ", from more than one area" : ""}`,
  tapWhatFits: "Tap what fits, or write it in your words.",
  continue: "Continue",
  seeWhatToDo: "See what to do",
  getHelpNow: "Get help now",
  bookInstead: "Book a visit instead",
  joinTodaysLine: "Join today's line",
  comeToday: "Come to the hospital today",
  askDayInstead: "Ask for a day instead",
  askDay: "Ask for a day",
  comeTodayInstead: "Come today instead",
  inYourWords: (words: string) => `In your words: ${words}`,
  started: (when: string) => `Started: ${when}`,
  startWith: (clinic: string) => `Start with ${clinic}.`,
  earliestToday: (hospital: string) => `The earliest place today at ${hospital}.`,
  yourHospital: "your hospital",
  placeToday: "You have a place today",
  done: "Done",
  // mobile/src/components/patient/booking-done.tsx (its "Position N" line is not copied: law L8).
  timeYours: "This time is yours",
  timeAsked: "We asked the clinic for this time",
  bookingCode: "Booking code",
  showAtDesk: "Show this at the desk.",
  answerInVisits: "You will find the answer under Visits.",
  serviceLine: {
    general: "the general clinic",
    cardiology: "the heart clinic",
    diabetes_ncd: "the diabetes and pressure clinic",
    renal: "the kidney clinic",
    eye: "the eye clinic",
    ent: "the ear, nose and throat clinic",
    maternity: "the maternity clinic",
    paediatrics: "the children's clinic",
    mental_health: "the mental health clinic",
    surgery: "the surgical clinic",
    dermatology: "the skin clinic",
    orthopaedics: "the bones and joints clinic",
    tb: "the TB clinic",
  },

  // mobile/src/features/symptoms/steps.tsx
  step: (n: number, words: string) => `Step ${n} of 3 · ${words}`,
  stepWords: ["What you feel", "A few questions", "What to do"] as const,
  fitsTitle: "What fits how you feel?",
  fitsLine: "Tap all that fit. None fit? Say it in your words at the bottom.",
  /** web: the chip rows' accessible names. */
  whoLabel: "Who it is for",
  areaLabel: "Where you feel it",
  whoMe: "Me",
  whoChild: "A child",
  whoOther: "Someone else",
  noteLabel: "Not here? Say it in your words",
  noteOptional: "Optional",
  notePlaceholder: "For example: a cough that keeps me up at night",
  quickTitle: "A few quick questions",
  forAll: "For all of it",
  whenStarted: "When did it start?",
  resultU: [
    "Come to the hospital today",
    "This should be seen today. We save your place in line, and the clinic sees what you told us.",
  ] as const,
  resultR: [
    "Book a visit",
    "A clinic should see this, but it can wait for a day that suits you.",
  ] as const,
  toldTitle: "What the clinic will see",
  change: "Change",

  // mobile/src/features/symptoms/danger.tsx
  anyNow: "Any of these, right now?",
  calmTitle: "You don’t have to go through this alone.",
  calmLine: "Talking to someone now can help. These people are there to listen.",
  someoneToTalk: "Someone to talk to",
  notNow: "This is not happening now",
  dangerTitle: "This needs help now. Do not wait for a booking.",
  becauseYouChose: (label: string) =>
    `Because you chose: ${label}. Call, or go to the nearest hospital.`,
  call: (hospital: string) => `Call ${hospital}`,
  theHospital: "the hospital",
  callLabel: (hospital: string, phone: string) => `Call ${hospital} on ${phone}`,
  dangerResultTitle: "This needs help now",
  dangerResultLine: "Do not wait for a booking. Call or go to the nearest emergency unit.",
  dangerBecause: (labels: string[]) => ` Because you chose: ${labels.join(" · ")}.`,
  /** web (D-PW-03): a computer cannot dial, so the number shows to dial from any phone. */
  dialFromPhone: (phone: string) => `On a computer, dial ${phone} from any phone.`,
} as const;

export const TODAY_COPY = {
  // mobile/src/app/(app)/book/today.tsx
  back: "Book a visit",
  title: "Join today's line",
  overline: (day: string) => `Today · ${day}`,
  loadFailed: "Couldn't load the clinics. Check your connection and try again.",
  savedOverline: "Your place is saved",
  inLineTitle: "You are in today's line",
  todaysClinic: "Today's clinic",
  inTheLine: "In the line",
  checkAgain: "Check again",
  done: "Done",
  removed: "We removed your place. Nothing is saved for you today.",
  clinicsOpen: "Clinics open now",
  noClinic: "No clinic takes walk-ins right now. You can ask for a day instead.",
  openNow: "Open now",
  clinicOpenLabel: (name: string) => `${name}, open now`,
  honestAfter: "Sicker people are seen first. Any doctor in the clinic may see you.",
  payment: "Payment",
  momoTitle: "Mobile Money now",
  momoLine: "MTN or Airtel · skip the cash line",
  deskTitle: "Pay at the desk",
  deskLine: "Cash or card before you are seen",
  /** web: the phone says "this phone"; a computer gets no prompt. */
  momoPrompt: "A prompt comes to your phone. Enter your PIN to pay.",
  demoPayment: "Demo payment: no money moves, and your ticket says so.",
  feeSet: "Fee set by the hospital.",
  bring: "Please bring",
  bringItems: ["Your medicines", "Clinic book"] as const,
  pay: (fee: string) => `Pay ${fee} and save my place`,
  save: "Save my place",
  cannotCome: "Cannot come today? Ask for a day",
  showCode: "Show your code at the desk when you arrive. Your place in line starts then.",
  giveUp: "Give up my place",
  /** Ticket details (mobile/src/app/(app)/book/today.tsx Held). */
  clinic: "Clinic",
  room: "Room",
  askAtDesk: "Ask at the desk",
  date: "Date",
  joined: (day: string, clock: string) => `${day} · joined ${clock}`,
  patient: "Patient",
  time: "Time",
  notPromised: "Not promised",
  code: "Your code",
  /** web: the phone keeps the ticket on the device; the web keeps nothing (W3), so it reads it again. */
  reread: "Check again to see where your place stands.",
  placeSaved: "Place saved",
  stage: {
    declared: "Place saved",
    arrived: "In the line",
    awaiting_triage: "In the line",
    triaged: "Seen by the nurse",
  } as Record<string, string>,
} as const;

export const DAY_COPY = {
  // mobile/src/app/(app)/book/day.tsx
  back: "Book a visit",
  title: "Ask for a day",
  askDoctor: (name: string) => `Ask ${name} for a day`,
  loading: "Loading the clinic days",
  failedTitle: "We couldn't load the open days",
  /** web: "Your phone may be offline" reads "You may be offline". */
  failedLine: "You may be offline, or the clinic list is busy. Nothing was booked.",
  backToDoctors: "Back to doctors",
  tryAgain: "Try again",
  theClinic: "The clinic",
  optional: "Optional",
  /** web: the payment radios' accessible name. */
  payLabel: "How to pay",
  backToBook: "Back to Book a visit",
  noDaysTitle: "No open days in the next two months",
  noDaysDoctor: (name: string) =>
    `${name} has no open time on MedSync yet. Try another doctor, or come back later.`,
  noDays: "No clinic day for this kind of visit is open on MedSync yet. Come back later.",
  chooseTime: (day: string) => `Choose a time on ${day}`,
  timesOn: (day: string) => `Times on ${day}`,
  arriveEarly: "Please arrive a little early. The doctor may see you later than this time.",
  partTitle: "Morning or afternoon?",
  partWords: { Morning: "Morning", Afternoon: "Afternoon" } as const,
  noClinic: "No clinic",
  full: "Full",
  open: "Open",
  doors: (at: string) => `Doors ${at}`,
  doorsOpenLabel: (part: string, at: string | null) =>
    `${part}, ${at ? `doors open ${at}` : "open"}`,
  partOffLabel: (part: string, any: boolean) => `${part}, ${any ? "full" : "no clinic"}`,
  partNote:
    "The time is when doors open, not your hour. You are seen in the order people arrive with a code.",
  whoTitle: "Who do you want to see?",
  anyDoctor: "Any doctor",
  noteLabel: "Anything the doctor should know?",
  notePlaceholder: "Anything else, in your own words",
  momo: ["Pay now · Mobile Money", "Your day is held once paid"] as const,
  later: ["Pay later", "Here before the day, or at the desk"] as const,
  demoPayment: "Demo payment: no money moves, and your ticket says so.",
  chooseTimeBtn: "Choose a time",
  chooseDayBtn: "Choose a day",
  payAsk: (fee: string, when: string) => `Pay ${fee} · ${when}`,
  ask: (when: string) => `Ask for ${when}`,
  confirmLine: "The clinic confirms it. You will see the answer in Visits.",
  /** web: every disabled button says why (DESIGN-medsync rule 3). */
  noSessionReason: "Choose an open day above first.",

  // mobile/src/features/visits/calendar.tsx
  prevMonth: "Previous month",
  nextMonth: "Next month",
  weekdays: ["M", "T", "W", "T", "F", "S", "S"] as const,
  dayLabel: (day: string, today: boolean, state: "open" | "closed" | "out") =>
    [
      day,
      today ? "today" : null,
      state === "open" ? "open" : state === "closed" ? "no open times" : "cannot be booked",
    ]
      .filter(Boolean)
      .join(", "),
  legend: "Open days are bold with a dot",

  // mobile/src/features/visits/time-wheel.tsx
  visitIn: "Your visit is in",
  visitInLabel: (spoken: string, when: string) => `Your visit is in ${spoken}, ${when}`,
  at: (day: string, clock: string) => `${day} at ${clock}`,

  // mobile/src/features/visits/attachments.tsx
  voiceNote: "Voice note",
  stop: "Stop",
  addPhoto: "Add photo",
  camera: "Camera",
  recording: "Recording. Tap Stop when you are done.",
  /** web: browsers have no on-device writer; the note is kept as sound. */
  voiceHint: "A voice note is kept as sound for the clinic.",
  maxVoice: (n: number) => `Up to ${n} voice notes.`,
  maxMedia: (n: number) => `Up to ${n} photos or videos.`,
  didntRecord: "The voice note didn't record. Try again.",
  badType: "One file is a type we can't send. Try a photo or video.",
  removePhoto: "Remove photo",
  removeVideo: "Remove video",
  removeVoice: "Remove voice note",
  video: "Video",
  /** web: a browser that refuses the microphone. */
  noMic: "Allow the microphone in your browser to record one here.",

  // Sent (mobile/src/app/(app)/book/day.tsx Sent)
  sentOverline: "Request sent",
  codeLabel: "Your code",
  clinicLabel: "Clinic",
  roomLabel: "Room",
  timeLabel: "Time",
  patientLabel: "Patient",
  notPromised: "Not promised",
  waitingTitle: "Waiting for the clinic",
  confirmedTitle: "Your day is confirmed",
  waitingStatus: "Waiting for the clinic to confirm",
  confirmed: "Confirmed",
  see: "See",
  asked: "Asked",
  timeEarly: (clock: string) => `${clock} · arrive a little early`,
  unsent: (n: number) =>
    `${n === 1 ? "One file" : `${n} files`} you added did not send. Your request is made; show ${n === 1 ? "it" : "them"} at the desk.`,
  nextTitle: "What happens next",
  steps: [
    "You asked",
    "The clinic confirms it",
    "A reminder the day before",
    "Show your code at the desk",
  ] as const,
  notYet: (s: string) => `${s} · not yet`,
  honestAfter: "Your code works at the desk even with no internet.",
  changeDay: "Change day",
  seeWeek: "See my week",
  sessionLine: (part: string, doors: string | null) => (doors ? `${part} · doors ${doors}` : part),

  // web: the waiting list (app/patient/book/_components/waitlist-join.tsx's door, pt-join-waitlist).
  waitlistAsk: "Tell me if a place opens",
  waitlistDone: "We will tell you if a place opens.",
} as const;

/** The ticket's payment strip (mobile/src/components/tide/ticket.tsx), shared by both sent states. */
export const PAY_COPY = {
  paid: (money: string) => `Paid · ${money}`,
  demoPaid: "Demo payment · no money moved",
  momoPaid: "Mobile Money · receipt sent by SMS",
  owed: (money: string) => `Not paid · ${money}`,
  owedQueue: "Pay before you are seen, here or at the desk",
  owedDay: "Pay before the day, or at the desk",
  free: "No fee",
  freeLine: "This visit is free at this hospital",
  payNow: "Pay now",
  queueTicket: "Queue ticket",
  visitTicket: "Visit ticket",
  /** mobile/src/data/visits.ts payments: with mobilePayments on there is still no integration. */
  notConnected: "Mobile Money is not connected yet. Pay at the desk.",
  noFee: "This visit has no fee.",
} as const;
