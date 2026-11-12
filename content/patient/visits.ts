/**
 * This week (/patient/visits), One visit (/patient/visits/[id]) and the visit ticket (PROMPT-PATIENT-WEB-TIDE
 * Step 4). Phone strings are copied word for word from mobile/src (the file is named beside each group);
 * web-only strings are marked "web". The CSO signs; Claude never edits the status.
 */
import type { SignedCopy } from "@/content/signed-copy";

export const VISITS_COPY_STATUS: SignedCopy = {
  status: "draft",
  signedBy: null,
  signedOn: null,
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const VISITS_COPY = {
  /** web: the page header (the phone's screen has only the pill). */
  overline: "Visits",
  title: "This week",

  // mobile/src/app/(app)/(tabs)/visits.tsx
  next: (when: string) => `Next · ${when}`,
  noVisit: "No visit booked",
  bookVisit: "Book a visit",
  nextLabel: (day: string, title: string, status: string) =>
    `Next: your visit on ${day}, ${title}, ${status}`,
  noVisitLabel: "No visit booked. Book a visit",
  failed: "Couldn't load your visits. Check your connection.",
  tryAgain: "Try again",
  loading: "Loading your visits",
  calendar: "Your calendar",
  prevMonth: "Previous month",
  nextMonth: "Next month",
  weekdays: ["M", "T", "W", "T", "F", "S", "S"],
  today: "Today",
  todayWord: "today",
  clinicOpen: "Clinic open",
  clinicOpenWord: "clinic open",
  yourVisit: "Your visit",
  yourVisitWord: "your visit",
  pastDay: "Past day",
  closedDay: "Nothing planned. The clinic is closed.",
  nothingPlanned: "Nothing planned.",
  placesLeft: "Places left. Book to save one.",
  openDayTitle: (day: string) => `${day} · Clinic open`,
  visitDayTitle: (day: string) => `${day} · Your visit`,
  open: "Open",
  book: "Book",
  weekRange: (from: string, to: string, month: string) => `${from} to ${to} ${month}`,
  weekAhead: "Your week ahead",
  noVisitsYet: "No visits yet. When you book one, it shows here.",
  nothingThisWeek: "Nothing planned this week.",
  more: (n: number) => `${n} more this week`,
  less: "Show less",
  medicines: "Your medicines",
  medsWords: (taken: number, total: number) =>
    `${taken} of ${total} ${plural(total, "medicine", "medicines")} taken today`,
  visit: "Visit",
  visitFor: (member: string) => `Visit · for ${member}`,
  directions: "Directions",

  // mobile/src/features/visits/waitlist-card.tsx
  offerOpened: "A place has opened",
  inLine: "In line",
  forMember: (member: string) => `For ${member} · `,
  offerLine: (day: string, until: string) =>
    `${day}. This offer stays open until ${until}. The place is not held for you until you take it.`,
  waitingLine: (from: string, to: string | null) =>
    `We will tell you when a place opens${to ? ` between ${from} and ${to}` : ` from ${from}`}. Being in line does not hold a place.`,
  takePlace: "Take this place",
  leaveList: "Leave the list",

  // mobile/src/app/(app)/visits/[id].tsx
  back: "Visits",
  yourVisitTitle: "Your visit",
  loadingVisit: "Loading this visit",
  visitFailed: "Couldn't load this visit. Check your connection and try again.",
  visitMissing: "This visit isn't in your list. Go back and open it again.",
  bandFor: (member: string) => `Visit for ${member}`,
  bandDept: (dept: string) => `Visit · ${dept}`,
  code: (code: string) => `code ${code}`,
  slotNote: "Please arrive a little early. The doctor may see you later than your time.",
  honest: "We save your place in line. We cannot tell you the hour.",
  yourClinician: "Your clinician",
  message: "Message your care team",
  imHere: "I'm here",
  imComing: "I'm coming",
  moveIt: "Move it",
  cancel: "Cancel",
  hereDone: "The clinic knows you are here.",
  comingDone: "Thank you. The clinic expects you.",
  movedDone: "Your visit has moved.",
  cancelledDone: "Your visit is cancelled.",
  /** web: the clinic cancelled the day (Gate E, PRD §3.2.6); the next day is one tap away. */
  rebook: (day: string) => `Book ${day}`,
  rebookHint: "Same clinic, same reason. You get a new code and place in line.",
  rebookDone: "Booked. You will find it in your visits.",
  chooseAnotherDay: "Choose another day",
  householdLine: (member: string) =>
    `You booked this for ${member}. It can be moved or cancelled at the desk.`,
  gettingThere: "Getting there",
  showCode: (code: string) => `Show code ${code} at the desk when you arrive.`,
  showNumber: "Show your MedSync number at the desk when you arrive.",
  noPin: (hospital: string) =>
    `${hospital} has not put its place on the map yet. Your map app can search for it.`,
  directionsInMaps: "Directions in Maps",
  moveTitle: "Pick another day and time",
  moveLoading: "Finding the days the clinic has open",
  moveNone: "No other day is open with this clinician on MedSync yet.",
  moveFailed: "Couldn't load the days the clinic has open.",
  moveSubmit: "Move my visit",
  keepIt: "Keep it",
  cancelTitle: "Cancel this visit?",
  cancelBody: "The clinic can give your place to someone else. Moving it keeps you in the line.",
  cancelSubmit: "Cancel this visit",
  reasonLabel: "Why? The clinic reads this.",
  reasonPlaceholder: "For example, I cannot travel that day",
  // mobile/src/lib/booking.ts (cancelAppointment / rescheduleAppointment)
  reasonShort: (n: number) => `Say a little more about why — at least ${n} characters.`,
  /** web: the controls' reasons when they are off (every disabled Button says why). */
  primaryOff: "The clinic asks the day before. You can say you are coming then.",
  moveOff: "This visit can't be moved here. Ask at the desk.",
  cancelOff: "This visit can't be cancelled now.",
  pickDay: "Pick a day first.",
  /** web: the move dialog's two choices. */
  moveDays: "Days the clinic has open",
  moveTimes: (day: string) => `Times on ${day}`,

  // mobile/src/components/tide/ticket.tsx
  ticket: {
    brand: "MedSync",
    visitTicket: "Visit ticket",
    day: "Day",
    time: "Time",
    clinic: "Clinic",
    see: "See",
    arriveEarly: (clock: string) => `${clock} · arrive a little early`,
    notPromised: "Not promised",
    paid: "Paid",
    paidTitle: (money: string) => `Paid · ${money}`,
    paidLine: "Mobile Money · receipt sent by SMS",
    owedTitle: (money: string) => `Not paid · ${money}`,
    owedLine: "Pay before the day, or at the desk",
    freeTitle: "No fee",
    freeLine: "This visit is free at this hospital",
    showAtDesk: "Show at the desk · works with no internet",
    atHospital: "AT THE HOSPITAL",
    yourCode: "YOUR CODE",
    offline: "Works with no internet",
    steps: (slot: boolean) => [
      "Go to the reception desk when you arrive.",
      "Show this code, or tell them the letters.",
      slot
        ? "Arrive a little early. The doctor may see you later than your time."
        : "You are seen in the order people arrive with a code.",
    ],
    tapFront: "Tap the ticket to turn it over",
    tapBack: "Tap the ticket to see the front",
    askDesk: "Ask at the desk",
    /** web: the button's name reads both faces (prompt §9). */
    label: (when: string, time: string, code: string, back: boolean) =>
      `Visit ticket, ${when}, ${time}. Code ${code}. ${back ? "Showing the back" : "Showing the front"}. Turn over`,
  },
} as const;
