import "server-only";

/**
 * Reception workspace feature registry. Mirrors the doctor + nurse
 * registries — same shape, smaller (deliberately thin workspace).
 */

export type ReceptionIconKey =
  | "overview"
  | "incoming"
  | "expected"
  | "intake"
  | "book"
  | "bookings"
  | "find"
  | "flow"
  | "labPayments";

export type ReceptionFeatureSlug =
  | ""
  | "incoming"
  | "expected"
  | "intake"
  | "book"
  | "bookings"
  | "find"
  | "flow"
  | "lab-payments";

export interface ReceptionFeatureArea {
  slug: ReceptionFeatureSlug;
  label: string;
  hint: string;
  iconKey: ReceptionIconKey;
  placeholder: boolean;
}

export const RECEPTION_FEATURE_AREAS: ReadonlyArray<ReceptionFeatureArea> = [
  {
    slug: "",
    label: "Today",
    hint: "Front-desk overview — expected, arrived, waiting, no-show",
    iconKey: "overview",
    placeholder: false,
  },
  {
    slug: "incoming",
    label: "Incoming",
    hint: "Pre-alerts — patients on their way",
    iconKey: "incoming",
    placeholder: false,
  },
  {
    slug: "expected",
    label: "Expected",
    hint: "Booked patients + declared arrivals — check them in",
    iconKey: "expected",
    placeholder: false,
  },
  {
    slug: "intake",
    label: "Register",
    hint: "Walk-in / referral / emergency intake",
    iconKey: "intake",
    placeholder: false,
  },
  {
    slug: "book",
    label: "Book",
    hint: "Book a visit on behalf of a caller",
    iconKey: "book",
    placeholder: false,
  },
  {
    slug: "bookings",
    label: "Bookings",
    hint: "Cancel or move a booking — by booking code or patient code",
    iconKey: "bookings",
    placeholder: false,
  },
  {
    slug: "find",
    label: "Find",
    hint: "By name on today's board, or by patient code",
    iconKey: "find",
    placeholder: false,
  },
  {
    slug: "flow",
    label: "Flow",
    hint: "Operational status board — who's where today",
    iconKey: "flow",
    placeholder: false,
  },
  {
    // Lab Phase 2 §5.3: shown only where labPayment is on (the shell filters it).
    slug: "lab-payments",
    label: "Lab payments",
    hint: "Lab orders awaiting payment — record paid, insured or waived",
    iconKey: "labPayments",
    placeholder: false,
  },
];

export function receptionFeaturePath(slug: ReceptionFeatureSlug): string {
  return slug === "" ? "/reception" : `/reception/${slug}`;
}
