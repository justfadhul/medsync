/**
 * Visits on the web (the owner's three-page redesign, 22 Nov 2026). Only the words this page adds; everything
 * else is the phone's own (content/patient/visits, content/patient-app/visit). No clinical wording here. The
 * CSO signs; Claude never edits the status.
 */
import type { SignedCopy } from "@/content/signed-copy";

export const VISITS_WEB_COPY_STATUS: SignedCopy = {
  status: "draft",
  signedBy: null,
  signedOn: null,
};

export const VISITS_WEB_COPY = {
  title: "Visits",
  you: "You",
  comingUp: "Coming up",
  past: "Past visits",
  nothingBooked: "Nothing booked",
  nothingLine: "Ask for a day, or come today and we save your place in line.",
  clinicOpen: "Clinic open",
  yourVisit: "Your visit",
  prevMonth: "Previous month",
  nextMonth: "Next month",
  open: "Open",
  line: (n: number) => (n === 1 ? "1 visit coming up" : `${n} visits coming up`),
  dayAria: (day: string, mine: boolean, open: boolean) =>
    `${day}${mine ? ", your visit" : open ? ", clinic open" : ""}`,
} as const;
