/**
 * Questions: ten, emergency first, five topics (canvas `qAll`). Own copy status so the "Is Tether
 * live?" answer can change alone (D-LP-11). The CSO signs; Claude never edits the status.
 */
import type { SignedCopy } from "@/content/signed-copy";

export const TETHER_FAQ_COPY_STATUS: SignedCopy = {
  status: "draft",
  signedBy: null,
  signedOn: null,
};

export const FAQ_TOPICS = ["All", "Booking", "On the day", "Changes", "Cost"] as const;
export type FaqTopic = Exclude<(typeof FAQ_TOPICS)[number], "All">;

export interface FaqItem {
  topic: FaqTopic;
  q: string;
  a: string;
  /** Red and open by default (LP4: the emergency answer may use red). */
  emergency?: true;
  /** The canvas wording, kept while a decision changes `a`. */
  canvas?: string;
}

export const FAQ: readonly FaqItem[] = [
  {
    topic: "On the day",
    q: "What if it is an emergency?",
    /** PROPOSED D-LP-06: with the pre-alert flag off, the last sentence goes. */
    a: "Don't wait for a booking. Go straight to the hospital's emergency entrance.",
    canvas:
      "Don't wait for a booking. Go straight to the hospital's emergency entrance. If you can, tap Help on the way and we tell the hospital you are coming.",
    emergency: true,
  },
  {
    topic: "Booking",
    q: "How do I book a visit?",
    a: "Choose your clinic, say why you are coming, and pick a day. We text you a code to show at the desk.",
  },
  {
    topic: "Booking",
    q: "Can I book for someone else?",
    a: "Yes, for another adult at home. They get their own code.",
  },
  {
    topic: "Booking",
    q: "What if I have no smartphone?",
    a: "Call the clinic. Reception can book for you, read your code out, and check you in by name when you arrive.",
  },
  {
    topic: "On the day",
    q: "What do I do when I arrive?",
    a: "Go to reception and show your code, or just give your name. They check you in and send you to triage or to the clinic.",
  },
  {
    topic: "On the day",
    q: "Will I be seen at my time?",
    a: "Arrive a little early. The clinic sees people in line order and sicker patients first, so you may be called a little after your time.",
  },
  {
    topic: "Changes",
    q: "What if I cannot come?",
    /** PROPOSED D-LP-05 until inbound SMS is live. */
    a: "Cancel from your visits with a short reason, or call the clinic. Your place goes to someone else.",
    canvas:
      "Cancel from your visits with a short reason, or reply CANCEL with your code to our text. Your place goes to someone else.",
  },
  {
    topic: "Changes",
    q: "What if the clinic cancels my day?",
    a: "We tell you straight away and offer the next open day in one tap.",
  },
  {
    topic: "Cost",
    q: "What does it cost?",
    a: "Tether takes no money from patients. Each clinic sets its own fee, shown before you ask for a day, and you pay the clinic.",
  },
  {
    topic: "Cost",
    q: "Is Tether live?",
    /** D-LP-11: true only while the pilot runs. */
    a: "Tether is in a 30-day pilot with private clinics in Uganda, on the web. If your clinic is taking part, you can book today.",
  },
];
