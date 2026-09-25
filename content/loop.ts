import type { Heading } from "@/content/landing";

/**
 * S3 "The loop" — every visible string (PROMPT-LANDING-S3-LOOP §2, verbatim).
 *
 * `LOOP_LOCKED` holds the record fragments Fadhul signs off as CSO (🔒 in the
 * brief), one list per step, in step order. `check: true` marks the three
 * completed-state values that carry a teal check. tests/landing/loop.test.ts
 * snapshots them: any edit fails CI until the snapshot is re-approved.
 */

export const LOOP_LOCKED = [
  [
    { label: "Triage", value: "Recorded" },
    { label: "Record", value: "Opened once" },
  ],
  [
    { label: "Allergy check", value: "No conflict" },
    { label: "Ward stock", value: "Available" },
    { label: "Order", value: "Signed", check: true },
  ],
  [
    { label: "Follow-up", value: "Booked", check: true },
    { label: "Reminders", value: "App and SMS", check: true },
  ],
  [
    { label: "Home readings", value: "On the record" },
    { label: "Review", value: "Starts from them" },
  ],
] as const;

export const LOOP = {
  kicker: "The loop",
  title: {
    text: "One record, from the ward to the kitchen table.",
    em: "kitchen table.",
  } satisfies Heading,
  intro:
    "Every step adds to the same record. Nothing is typed twice, and nothing is lost at the gate.",
  steps: [
    { title: "Admit.", body: "The record opens once, at the gate, for everyone on the case." },
    {
      title: "Treat.",
      body: "Orders are checked against allergies and ward stock before signing.",
    },
    {
      title: "Discharge, don’t disconnect.",
      body: "The plan goes home, and reminders arrive by app or SMS.",
    },
    {
      title: "The next visit.",
      body: "The clinic opens the same record, home readings already on it.",
    },
  ],
  loopLabel: "The same record, every visit.",
  caption: "Illustrative. No real patients.",
  /** sr-only: the drawing is aria-hidden, this sentence tells its story. */
  summary:
    "The same patient record continues through admission, treatment, discharge and the next visit.",
} as const;
