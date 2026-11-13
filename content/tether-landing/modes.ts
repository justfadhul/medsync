/**
 * Ways to book: the three modes and the second example ticket (canvas `modes` + `mInfo`). Covered by
 * TETHER_LANDING_COPY_STATUS (copy.ts). The date is the rolling example day (D-LP-08); "Today" stays.
 */
export interface LandingMode {
  /** Segmented control and phone dots. */
  title: string;
  short: string;
  line: string;
  /** Info panel. */
  head: string;
  intro: string;
  facts: readonly (readonly [string, string])[];
  /** The ticket. `waiting`: the pill waits on someone, so it is grey (D-LP-03), not lagoon. */
  status: string;
  waiting?: boolean;
  /** "rolling" = the example visit day; otherwise the literal. */
  date: "rolling" | "Today";
  time: string;
  note: string;
  extra: { label: string; value: string };
  doctor: { label: string; value: "rolling" | "first" | string };
}

export const MODES: readonly LandingMode[] = [
  {
    title: "A place on a clinic day",
    short: "Clinic day",
    line: "Morning or afternoon. The time is when doors open, not your hour.",
    head: "A place on a clinic day",
    intro: "You pick the day and morning or afternoon. The clinic holds a place for you.",
    facts: [
      ["Confirmed", "At once"],
      ["You are seen", "Around your time, in line order"],
      ["Good for", "Reviews, refills and routine visits"],
    ],
    status: "Confirmed",
    date: "rolling",
    time: "09:30",
    note: "Morning clinic. Doors open 08:00.",
    /** PROPOSED D-LP-02: canvas value "No. 7" (and the live "In line now No. N" counter is dropped). */
    extra: { label: "In line", value: "Place saved" },
    doctor: { label: "Doctors in this clinic", value: "rolling" },
  },
  {
    title: "A time with a doctor",
    short: "Doctor's time",
    line: "Pick a time the doctor has opened. Arrive a little early.",
    head: "A time with a doctor",
    intro: "You pick a doctor and one of the times they have opened.",
    facts: [
      ["Confirmed", "When the doctor accepts"],
      ["You are seen", "Around your time. Arrive a little early"],
      ["Good for", "Seeing the same doctor each visit"],
    ],
    status: "Waiting for the doctor",
    waiting: true,
    date: "rolling",
    time: "10:40",
    note: "Arrive a little early.",
    extra: { label: "Fee", value: "UGX 50,000" },
    doctor: { label: "Your doctor", value: "first" },
  },
  {
    title: "Join today's line",
    short: "Today's line",
    line: "For clinics that take walk-ins today. Your place is saved; the hour is not promised.",
    head: "Today's line",
    intro: "For clinics that take walk-ins today. You save a place before you leave home.",
    facts: [
      ["Confirmed", "At once"],
      ["You are seen", "After you show your code at the desk"],
      ["Good for", "When you need to be seen today"],
    ],
    status: "Place saved",
    date: "Today",
    time: "11:15",
    note: "Your place starts when you reach the desk.",
    extra: { label: "In line", value: "Given at the desk" },
    doctor: { label: "Doctor", value: "Any doctor in the clinic" },
  },
];

/** The canvas's live counter ("In line now", "No."), kept only if D-LP-02 signs the example exception. */
export const LINE_COUNTER = { label: "In line now", prefix: "No." } as const;
