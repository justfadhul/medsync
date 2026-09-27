import type { PillTone } from "@/components/ui/pill";
import type { LucideIcon } from "lucide-react";
import {
  BedIcon,
  BriefcaseIcon,
  CalendarCheckIcon,
  CheckCheckIcon,
  CheckIcon,
  CircleSlashIcon,
  ClockIcon,
  GraduationCapIcon,
  PlaneIcon,
  StethoscopeIcon,
  TagIcon,
  TriangleAlertIcon,
  UserCheckIcon,
  UserXIcon,
  XIcon,
} from "lucide-react";

/**
 * The calendar's one colour map (schedule reskin). Every chip, band, card
 * icon, capacity meter and legend entry reads its colour from here, so the
 * legend cannot drift from what the grid draws.
 *
 * The law: red, amber and green are clinical signals. No kind and no
 * booking status may spend them — a doctor's leave is not a warning and a
 * confirmed booking is not a clinical state. The one exception is an urgent,
 * alert-triggered appointment, which takes the critical pair. Held by
 * tests/scheduling/calendar-tones.test.ts.
 *
 * Hues are the Chroma hue roles (sky / iris / grape) plus the neutral grey
 * ramp; plum is not used (ADR 0097: plum = place). Every class is a token
 * utility — no hex, no Tailwind colour ramps, no `dark:` overrides: the
 * tokens flip with `.dark` themselves.
 */
export type Hue = "sky" | "iris" | "grape" | "neutral" | "hatch";

export interface HueClasses {
  /** Square kind chip: fill, text, edge. */
  chip: string;
  /** Chip icon colour. */
  icon: string;
  /** Background band fill for an availability block. */
  band: string;
  /** Capacity-meter fill. */
  meter: string;
}

/** Unavailable time: thin diagonal rules on the page ground, no tint. */
const HATCH =
  "bg-card bg-[repeating-linear-gradient(135deg,var(--gray-200)_0_1px,transparent_1px_7px)]";

export const HUE: Record<Hue, HueClasses> = {
  sky: {
    chip: "bg-sky-tint text-sky-text border-sky-edge",
    icon: "text-sky-icon",
    band: "bg-sky-tint/70",
    meter: "bg-sky-icon",
  },
  iris: {
    chip: "bg-iris-tint text-iris-text border-iris-edge",
    icon: "text-iris-icon",
    band: "bg-iris-tint/70",
    meter: "bg-iris-icon",
  },
  grape: {
    chip: "bg-grape-tint text-grape-text border-grape-edge",
    icon: "text-grape-icon",
    band: "bg-grape-tint/70",
    meter: "bg-grape-icon",
  },
  neutral: {
    chip: "bg-gray-100 text-gray-700 border-border",
    icon: "text-gray-500",
    band: "bg-gray-100/70",
    meter: "bg-gray-500",
  },
  hatch: {
    chip: "bg-card text-muted-foreground border-border",
    icon: "text-muted-foreground",
    band: HATCH,
    meter: "bg-gray-500",
  },
};

export interface KindTone {
  hue: Hue;
  icon: LucideIcon;
  /** The shared Pill's tone, for the list rows and sheets that show a kind as a Pill. */
  pill: PillTone;
}

/**
 * Availability kinds (AVAILABILITY_KINDS order) plus `session`, the clinic
 * day. Teaching and admin share the neutral grey, and leave and unavailable
 * share the hatch: the icon and the word tell them apart, never the colour
 * alone.
 */
export const KIND_TONE: Record<string, KindTone> = {
  bookable: { hue: "sky", icon: CalendarCheckIcon, pill: "info" },
  teaching: { hue: "neutral", icon: GraduationCapIcon, pill: "neutral" },
  ward_round: { hue: "iris", icon: BedIcon, pill: "notice" },
  admin: { hue: "neutral", icon: BriefcaseIcon, pill: "neutral" },
  leave: { hue: "hatch", icon: PlaneIcon, pill: "neutral" },
  unavailable: { hue: "hatch", icon: CircleSlashIcon, pill: "neutral" },
  custom: { hue: "grape", icon: TagIcon, pill: "custom" },
  session: { hue: "sky", icon: StethoscopeIcon, pill: "info" },
};

export const FALLBACK_KIND_TONE: KindTone = { hue: "neutral", icon: TagIcon, pill: "neutral" };

/** A booking's state, as the round pill on its card says it. */
export type StatusKey =
  | "pending"
  | "confirmed"
  | "arrived"
  | "completed"
  | "cancelled"
  | "missed"
  | "urgent";

export interface StatusTone {
  /** Round pill: fill and text. */
  pill: string;
  /** The status icon's colour where it stands alone (a compact card, a month item). */
  mark: string;
  icon: LucideIcon;
  /** The card is kept but receded: muted fill, dashed edge, title struck through. */
  struck: boolean;
}

const NEUTRAL_PILL = "bg-gray-100 text-gray-700";
const NEUTRAL_MARK = "text-muted-foreground";

export const STATUS_TONE: Record<StatusKey, StatusTone> = {
  pending: {
    pill: "bg-status-pending-bg text-status-pending-fg",
    mark: "text-status-pending-fg",
    icon: ClockIcon,
    struck: false,
  },
  confirmed: { pill: NEUTRAL_PILL, mark: NEUTRAL_MARK, icon: CheckIcon, struck: false },
  arrived: { pill: NEUTRAL_PILL, mark: NEUTRAL_MARK, icon: UserCheckIcon, struck: false },
  completed: { pill: NEUTRAL_PILL, mark: NEUTRAL_MARK, icon: CheckCheckIcon, struck: false },
  cancelled: { pill: NEUTRAL_PILL, mark: NEUTRAL_MARK, icon: XIcon, struck: true },
  missed: { pill: NEUTRAL_PILL, mark: NEUTRAL_MARK, icon: UserXIcon, struck: true },
  urgent: {
    // Chroma (ADR 0162): chip text on the critical tint takes the AA pair.
    pill: "bg-status-critical-bg text-status-critical-fg-aa",
    mark: "text-status-critical-fg-aa",
    icon: TriangleAlertIcon,
    struck: false,
  },
};

/** The legend's word for each pill; a card says the booking's own status word. */
export const STATUS_WORD: Record<StatusKey, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  arrived: "Arrived",
  completed: "Completed",
  cancelled: "Cancelled",
  missed: "Missed",
  urgent: "Urgent",
};

/** Appointment status (the database's word) → the pill's key. */
export const STATUS_KEY: Record<string, StatusKey> = {
  requested: "pending",
  pending_approval: "pending",
  confirmed: "confirmed",
  arrived: "arrived",
  in_progress: "arrived",
  completed: "completed",
  cancelled: "cancelled",
  declined: "cancelled",
  rescheduled: "cancelled",
  void: "cancelled",
  no_show: "missed",
};

/**
 * The pill for one appointment. Urgent wins only while the booking still
 * holds the time: a cancelled urgent booking is a cancelled booking, and a
 * red pill on it would be an alarm about nothing.
 */
export function statusKeyFor(status: string, priority: "routine" | "urgent"): StatusKey {
  const key = STATUS_KEY[status] ?? "pending";
  return priority === "urgent" && !STATUS_TONE[key].struck && key !== "completed" ? "urgent" : key;
}

export function kindTone(kind: string): KindTone {
  return KIND_TONE[kind] ?? FALLBACK_KIND_TONE;
}
