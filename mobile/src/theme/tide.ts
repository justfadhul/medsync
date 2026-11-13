import type { TextStyle } from "react-native";

/**
 * MedSync Tide — the patient phone's design language (Tide v1 PRD, ADR 0340).
 *
 * Tide replaces the mirrored Chroma palette on the phone. The clinical status
 * pairs are the same values Chroma carries, so a reading that is "above your
 * target" looks the same on both. Everything else is Tide's own: a soft grey
 * ground, navy ink, white cards, pill controls, one lagoon accent.
 *
 * Screens read the roles below through `useTide()` and nothing else. No hex
 * literal outside `src/theme/` (lint rule `medsync/no-raw-colour`), and the
 * emergency reds only on the Help, SOS and danger surfaces (red-scan test).
 *
 * Light and dark values are the PRD's (owner decision D4, 17 Oct 2026), which
 * are also the `D*` prototype boards. Help, SOS and the danger interrupt stay
 * light in dark mode (law L11) through `<ForcedScheme scheme="light">`.
 */

export interface TideAreas {
  readings: string;
  medicines: string;
  visits: string;
  team: string;
  me: string;
}

/** A tinted fill and the text that reads on it. */
export interface TidePair {
  tint: string;
  text: string;
}

export interface Tide {
  scheme: "light" | "dark";

  /** Page ground. */
  bg: string;
  /** Cards, rows, fields. */
  surface: string;
  /** Soft fields, tracks, the quiet half of a segment. */
  surface2: string;
  /** Pressed and sunken fills, skeletons. */
  surface3: string;
  /** Floating things: the nav pill, sheets, toasts. */
  surfaceRaised: string;
  /** Hairlines, rings around cards and unselected chips. */
  line: string;
  /** Edges of outline buttons and fields. */
  lineStrong: string;

  ink: string;
  ink2: string;
  ink3: string;
  /** Placeholder text and disabled ink. */
  ink4: string;

  /** Navy surface: header bands, tickets, the health card, the done cascade step. */
  band: string;
  onBand: string;
  onBand2: string;
  /** A glassy disc or pill on navy: icon discs, "Now · 13:00" on teal. */
  bandGlass: string;
  /** Lagoon as text on navy: "Undo" on a toast, "Today" on the date tile. */
  onBandAccent: string;

  /** The primary pill: navy by day, near-white by night. */
  primary: string;
  onPrimary: string;
  /** A disabled primary fill, and the label on it. */
  primaryOff: string;
  onPrimaryOff: string;

  /** Lagoon, the one action colour: the plus, the Now card, selected segments. */
  accent: string;
  accentPressed: string;
  /** Text and icons on an accent fill. Navy on lagoon, never white. */
  onAccent: string;
  /** Lagoon as text: links, "See all", "Change". */
  accentText: string;
  accentTint: string;
  /** The step after now in the day cascade (foam). */
  accentSoft: string;
  focus: string;

  /** The day cascade, earliest first. Flat tones, white text. The fourth tone is the web landing page's last
   *  step before lagoon (D-LP-14); the phone's cascade uses the first three. */
  cascade: readonly [string, string, string, string];

  /** Place dots and icons. Never a fill behind text, never a button. */
  area: TideAreas;
  /** "Where you are" avatars and the visits place. */
  place: TidePair;
  info: TidePair;

  /** Clinical signals only (laws L3, L4). Always paired with words. */
  stable: TidePair;
  caution: TidePair;
  critical: TidePair;
  pending: TidePair;

  /** The Help button and "Get help now". The one red fill. */
  emergency: string;
  /** The deeper red of the Help band. */
  emergencyBand: string;
  onEmergency: string;

  /** Behind a sheet. */
  scrim: string;
  shadow: {
    card: string;
    float: string;
    accent: string;
    emergency: string;
    /** Under the pill drawings on medicine cards. */
    drawing: string;
  };
  /** The score line across a drawn tablet. */
  tabletLine: string;
  /** The mood faces: fixed illustrations, the same in both themes. */
  mood: {
    good: string;
    okay: string;
    low: string;
    ink: string;
    tongue: string;
    cheek: string;
    tear: string;
  };
}

export const tideLight: Tide = {
  scheme: "light",
  bg: "#f6f7f9",
  surface: "#ffffff",
  surface2: "#f3f4f7",
  surface3: "#eef0f4",
  surfaceRaised: "#ffffff",
  line: "#dde1ea",
  lineStrong: "#c5cbd8",
  ink: "#1b2540",
  ink2: "#4a5574",
  ink3: "#5f6987",
  ink4: "#8a93ab",
  band: "#1b2540",
  onBand: "#ffffff",
  onBand2: "#e8ecf3",
  onBandAccent: "#5eead4",
  bandGlass: "rgba(255, 255, 255, 0.14)",
  primary: "#1b2540",
  onPrimary: "#ffffff",
  primaryOff: "#c5cbd8",
  onPrimaryOff: "#ffffff",
  accent: "#2dd4bf",
  accentPressed: "#14b8a6",
  onAccent: "#1b2540",
  accentText: "#0f766e",
  accentTint: "#ccfbf1",
  accentSoft: "#a7f3e4",
  focus: "#0d9488",
  cascade: ["#1b2540", "#2f4a6d", "#296a89", "#1f9a9c"],
  area: {
    readings: "#0284c7",
    medicines: "#7c3aed",
    visits: "#a21caf",
    team: "#4f46e5",
    me: "#64748b",
  },
  place: { tint: "#fdf3f9", text: "#87236a" },
  info: { tint: "#eef2ff", text: "#4338ca" },
  stable: { tint: "#dcfce7", text: "#15803d" },
  caution: { tint: "#fef3c7", text: "#92400e" },
  critical: { tint: "#fee2e2", text: "#b91c1c" },
  pending: { tint: "#eef0f4", text: "#4a5574" },
  emergency: "#dc2626",
  emergencyBand: "#b91c1c",
  onEmergency: "#ffffff",
  scrim: "rgba(27, 37, 64, 0.28)",
  shadow: {
    card: "0px 1px 2px rgba(27, 37, 64, 0.06), 0px 10px 24px -14px rgba(27, 37, 64, 0.22)",
    float: "0px 2px 6px rgba(27, 37, 64, 0.08), 0px 16px 28px -12px rgba(27, 37, 64, 0.18)",
    accent: "0px 8px 22px -6px rgba(45, 212, 191, 0.65)",
    emergency: "0px 6px 16px -6px rgba(220, 38, 38, 0.6)",
    drawing: "inset 0px -3px 0px rgba(0, 0, 0, 0.12), 0px 6px 12px -6px rgba(0, 0, 0, 0.35)",
  },
  tabletLine: "rgba(0, 0, 0, 0.15)",
  mood: {
    good: "#99f6e4",
    okay: "#38bdf8",
    low: "#4338ca",
    ink: "#1b2540",
    tongue: "#5eead4",
    cheek: "#ffffff",
    tear: "#c7d2fe",
  },
};

export const tideDark: Tide = {
  scheme: "dark",
  bg: "#0b1120",
  surface: "#151d30",
  surface2: "#1c2539",
  surface3: "#222c42",
  surfaceRaised: "#2f3d5f",
  line: "#2c3650",
  lineStrong: "#3a4562",
  ink: "#e8ecf3",
  ink2: "#a9b2c7",
  ink3: "#8f99b3",
  ink4: "#6f7a96",
  band: "#24314f",
  onBand: "#ffffff",
  onBand2: "#e8ecf3",
  onBandAccent: "#5eead4",
  bandGlass: "rgba(255, 255, 255, 0.14)",
  primary: "#e8ecf3",
  onPrimary: "#0b1120",
  primaryOff: "#3a4562",
  onPrimaryOff: "#a9b2c7",
  accent: "#2dd4bf",
  accentPressed: "#5eead4",
  onAccent: "#1b2540",
  accentText: "#5eead4",
  accentTint: "rgba(45, 212, 191, 0.16)",
  accentSoft: "#a7f3e4",
  focus: "#5eead4",
  cascade: ["#24314f", "#2f4a6d", "#296a89", "#1f9a9c"],
  area: {
    readings: "#7dd3fc",
    medicines: "#a78bfa",
    visits: "#e879f9",
    team: "#a5b4fc",
    me: "#94a3b8",
  },
  place: { tint: "rgba(192, 38, 211, 0.16)", text: "#f0abfc" },
  info: { tint: "rgba(99, 102, 241, 0.16)", text: "#a5b4fc" },
  stable: { tint: "rgba(34, 197, 94, 0.16)", text: "#4ade80" },
  caution: { tint: "rgba(245, 158, 11, 0.18)", text: "#fbbf24" },
  critical: { tint: "rgba(220, 38, 38, 0.16)", text: "#fca5a5" },
  pending: { tint: "#222c42", text: "#a9b2c7" },
  emergency: "#dc2626",
  emergencyBand: "#b91c1c",
  onEmergency: "#ffffff",
  scrim: "rgba(0, 0, 0, 0.45)",
  shadow: {
    card: "0px 1px 2px rgba(0, 0, 0, 0.10), 0px 10px 24px -14px rgba(0, 0, 0, 0.35)",
    float: "0px 2px 6px rgba(0, 0, 0, 0.4), 0px 16px 26px -12px rgba(0, 0, 0, 0.45)",
    accent: "0px 8px 22px -6px rgba(45, 212, 191, 0.65)",
    emergency: "0px 6px 16px -6px rgba(220, 38, 38, 0.6)",
    drawing: "inset 0px -3px 0px rgba(0, 0, 0, 0.12), 0px 6px 12px -6px rgba(0, 0, 0, 0.35)",
  },
  tabletLine: "rgba(0, 0, 0, 0.15)",
  mood: {
    good: "#99f6e4",
    okay: "#38bdf8",
    low: "#4338ca",
    ink: "#1b2540",
    tongue: "#5eead4",
    cheek: "#ffffff",
    tear: "#c7d2fe",
  },
};

/** 4pt grid. Screen gutter is `space[5]`. */
export const tSpace = {
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  2.5: 10,
  3: 12,
  3.5: 14,
  4: 16,
  4.5: 18,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
} as const;

export const tRadius = {
  sm: 10,
  md: 14,
  field: 16,
  row: 18,
  card: 20,
  cardLg: 22,
  panel: 24,
  xl: 28,
  sheet: 32,
  pill: 999,
} as const;

/** Each day-cascade card slides this far under the one before (> radius.xl). */
export const CASCADE_OVERLAP = 32;
/** The smallest thing a thumb may hit (law L13). */
export const TOUCH_MIN = 44;
export const BUTTON_H = 52;

export const tFont = {
  regular: "Figtree_400Regular",
  medium: "Figtree_500Medium",
  semibold: "Figtree_600SemiBold",
  bold: "Figtree_700Bold",
  extrabold: "Figtree_800ExtraBold",
  mono: "GeistMono_500Medium",
  monoSemibold: "GeistMono_600SemiBold",
  monoBold: "GeistMono_700Bold",
} as const;

/**
 * The type scale. Letter-spacing is in points (React Native has no `em`),
 * worked out from the prototype's em values at each size.
 */
export const tType = {
  display: { fontFamily: tFont.medium, fontSize: 32, lineHeight: 36, letterSpacing: -0.96 },
  displayL: { fontFamily: tFont.medium, fontSize: 34, lineHeight: 38, letterSpacing: -1.02 },
  title: { fontFamily: tFont.semibold, fontSize: 24, lineHeight: 30, letterSpacing: -0.48 },
  section: { fontFamily: tFont.semibold, fontSize: 20, lineHeight: 26, letterSpacing: -0.3 },
  heading: { fontFamily: tFont.semibold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: tFont.regular, fontSize: 17, lineHeight: 25 },
  bodyM: { fontFamily: tFont.medium, fontSize: 15, lineHeight: 21 },
  bodyS: { fontFamily: tFont.medium, fontSize: 13, lineHeight: 18 },
  label: { fontFamily: tFont.semibold, fontSize: 16, lineHeight: 20 },
  labelS: { fontFamily: tFont.semibold, fontSize: 14, lineHeight: 18 },
  caption: { fontFamily: tFont.semibold, fontSize: 12, lineHeight: 16 },
  micro: { fontFamily: tFont.medium, fontSize: 11, lineHeight: 14 },
  overline: {
    fontFamily: tFont.semibold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.72,
    textTransform: "uppercase",
  },
  numeral: {
    fontFamily: tFont.semibold,
    fontSize: 30,
    lineHeight: 32,
    letterSpacing: -0.6,
    fontVariant: ["tabular-nums"],
  },
  code: { fontFamily: tFont.monoSemibold, fontSize: 20, lineHeight: 26, letterSpacing: 3.6 },
} satisfies Record<string, TextStyle>;

/** WCAG relative-luminance contrast between two `#rrggbb` colours. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
