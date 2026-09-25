import type { Heading } from "@/content/landing";

/**
 * S1 Hero — every visible string (PROMPT-LANDING-S1-HERO §3, verbatim).
 *
 * `HERO_LOCKED` holds the clinical strings Fadhul signs off as CSO (🔒 in the
 * brief). tests/landing/hero.test.ts snapshots them: any edit fails CI until
 * the snapshot is re-approved. The rest may change with an ordinary review.
 */

export const HERO_LOCKED = {
  phone: {
    reading: "Fasting glucose",
    value: "14.2",
    unit: "mmol/L",
    time: "06:12",
    /** Owner's call (2026-09-23): the reading itself says it is abnormal — amber + this word. */
    flag: "Above target",
  },
  hospital: {
    label: "At the hospital · Care team",
    patient: "Amina N. · home readings",
    pattern: "3 of the last 5 fasting readings above target",
    acknowledged: "Acknowledged by the on-call doctor · 07:40",
    booked: "Review booked · today 14:00",
  },
  reply: {
    lead: "Your care team saw your readings.",
    detail: "Review booked today at 14:00.",
  },
} as const;

export const HERO = {
  kicker: "Founding hospital pilots open · Uganda 2026",
  /** Below 640px, where the full kicker would wrap. */
  kickerShort: "Pilots open · Uganda 2026",
  title: {
    text: "A digital hospital that doesn’t stop at the gate.",
    em: "at the gate.",
  } satisfies Heading,
  sub: "MedSync runs the ward and follows the patient home, so worrying readings reach the care team, not a notebook.",
  beats: ["① Logged at home", "② Seen at the hospital", "③ Answered at home"],
  caption: "Illustrative. No real patients.",
  /** The figure's internals are aria-hidden; this sentence tells the story. */
  description:
    "Illustration: a patient logs a fasting glucose of 14.2 millimoles per litre at home. The hospital care team sees it is the third of the last five readings above target, acknowledges it and books a review for today. The patient receives a message confirming the review.",
  /**
   * The phone's 7-point sparkline (mmol/L). Only the last value is printed; the
   * shaded band is the target range, unlabelled. Points above it are amber.
   */
  sparkline: [8.6, 9.1, 12.1, 9.4, 13.1, 9.8, 14.2],
  target: { low: 4, high: 10 },
} as const;
