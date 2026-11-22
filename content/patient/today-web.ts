/**
 * Today on the web (the owner's three-page redesign, 22 Nov 2026). Only the words this page adds; everything else
 * is the phone's own (content/patient, content/patient-app). No clinical wording here. The CSO signs; Claude never
 * edits the status.
 */
import type { SignedCopy } from "@/content/signed-copy";

export const TODAY_WEB_COPY_STATUS: SignedCopy = {
  status: "draft",
  signedBy: null,
  signedOn: null,
};

export const TODAY_WEB_COPY = {
  greeting: { morning: "Good morning", afternoon: "Good afternoon", evening: "Good evening" },
  yourHospital: "Your hospital",
  change: "Change",
  bookFor: "You book for",
  addSomeone: "Add someone",
  me: "Your own visit",
  nextOpen: "Next open:",
  clinicConfirms: "the clinic confirms",
  walkInsOpen: (n: number) => (n === 1 ? "Open now · 1 clinic takes walk-ins" : `Open now · ${n} clinics take walk-ins`),
  help: "Help",
  when: "When?",
  whichClinic: "Which clinic?",
  moreReasons: "More reasons",
  fewerReasons: "Fewer reasons",
  askThisDay: "Ask for this day",
  previewTicket: "Preview ticket",
  previewTitle: "Your ticket, if the clinic confirms",
  otherDays: "Other days",
  lastVisit: "Last visit",
  nextOpenFor: "Next open day",
  how: ["You ask for a day", "The clinic confirms", "Show your code at the desk"],
  seenInTurn: "Seen in turn, no hour promised",
  yourHealth: "Your health",
  onlyYouShort: "Only you see what you log",
  logLine: "Blood pressure, sugar or weight",
  log: "Log",
  bookedTitle: "Waiting for the clinic",
  seeInVisits: "See it in Visits",
  glance: {
    nextVisit: "Next visit",
    noVisit: "No visit booked",
    bookOne: "Book one below",
    labs: "Lab tests",
    labsLine: (ready: number, waiting: number) =>
      `${ready} ready · ${waiting} waiting`,
    bloodPressure: "Blood pressure",
    noReading: "No reading yet",
  },
  readings: "Readings",
  logReading: "Log a reading",
  onlyYou: "Only you see what you log here.",
  medicines: "Medicines",
  labTests: "Lab tests",
  labsWaiting: "Waiting for results",
  labsReady: "Ready",
  labsLater: "Results show here after your clinician reviews them.",
  openRecords: "Open your visit records",
  careTeam: "Your care team",
  visits: "Visits",
  seeAll: "See all",
  bookVisit: "Book a visit",
  carePlan: "Your care plan",
  carePlanLine: "Written by your care team",
  myCare: "My care",
  messages: "Messages",
} as const;
