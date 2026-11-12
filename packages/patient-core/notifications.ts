/**
 * A notification's words come from its kind, never from the row (a row stores
 * no text, PHI rule). Pure: shared by the phone and the web.
 */

/** The icon names these words use; each is a name in the phone's Tide icon set. */
export type NotifIcon = "calendar" | "clock" | "users" | "wallet" | "message" | "bell";
export type NotifType = "care" | "visit" | "med";

export interface KindWords {
  title: string;
  line: string;
  icon: NotifIcon;
  type: NotifType;
  /** The button inside the row, when the message asks for something. */
  act?: string;
}

/**
 * Titles are the web's push titles (`composeDispatchPush`, lib/notifications/dispatches.ts);
 * the lines say what to do next, with no name or value in them.
 */
export const KIND_WORDS: Record<string, KindWords> = {
  booking_receipt: {
    title: "Your visit is booked",
    line: "Open it to see the day and your code.",
    icon: "calendar",
    type: "visit",
  },
  confirmation_request: {
    title: "Are you coming tomorrow?",
    line: "Confirm you are coming, or free the place.",
    icon: "calendar",
    type: "visit",
    act: "Open visit",
  },
  reminder: {
    title: "A reminder about your visit",
    line: "Open it to see the day and time.",
    icon: "clock",
    type: "visit",
  },
  arrival_window: {
    title: "Your arrival window today",
    line: "Open it to see when to arrive.",
    icon: "clock",
    type: "visit",
    act: "Open visit",
  },
  window_shifted: {
    title: "Your arrival window has moved",
    line: "The clinic is running late. Open it to see the new window.",
    icon: "clock",
    type: "visit",
    act: "Open visit",
  },
  waitlist_offer: {
    title: "A place has opened",
    line: "Open your visits to take it before the offer closes.",
    icon: "calendar",
    type: "visit",
    act: "See the offer",
  },
  session_cancelled: {
    title: "Clinic day cancelled",
    line: "We are sorry. Open it to choose another day.",
    icon: "calendar",
    type: "visit",
    act: "Choose a day",
  },
  visit_cancelled: {
    title: "Visit cancelled",
    line: "The clinic cancelled this visit. We are sorry. Book another day when you are ready.",
    icon: "calendar",
    type: "visit",
  },
  unconfirmed_release: {
    title: "Your place was released",
    line: "It was not confirmed. If you still need a visit, book again.",
    icon: "calendar",
    type: "visit",
    act: "Book a visit",
  },
  position_called: {
    title: "The clinic is calling you",
    line: "Open your ticket.",
    icon: "users",
    type: "visit",
    act: "Open ticket",
  },
  payment: {
    title: "About a payment",
    line: "Open MedSync for details.",
    icon: "wallet",
    type: "care",
  },
  sms_reply: {
    title: "We answered your text message",
    line: "Sent by SMS to your phone.",
    icon: "message",
    type: "care",
  },
};

export const FALLBACK: KindWords = {
  title: "An update about your visit",
  line: "Open MedSync for details.",
  icon: "bell",
  type: "care",
};

/** Where a row goes, as a key the app maps to its own route. */
export type NotifTargetKey = "book" | "ticket" | "visit" | "visits";
export type NotifTarget = { key: Exclude<NotifTargetKey, "visit"> } | { key: "visit"; id: string };

/** Its appointment, the visits list for a waitlist, the ticket when called, else nowhere. */
export function notifTarget(row: {
  kind: string;
  related_kind: string;
  related_id: string;
}): NotifTarget | undefined {
  if (row.kind === "unconfirmed_release") return { key: "book" };
  if (row.kind === "position_called") return { key: "ticket" };
  if (row.related_kind === "appointment") return { key: "visit", id: row.related_id };
  if (row.related_kind === "waitlist_entry" || row.related_kind === "clinic_session")
    return { key: "visits" };
  return undefined;
}
