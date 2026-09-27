/**
 * MedSync Chroma design tokens (ADR 0162), mirrored for React Native.
 *
 * The web app is the source of truth: these values are the Chroma tokens in
 * the `:root` / `.dark` blocks of `app/globals.css`, which `DESIGN-medsync.md`
 * governs. A patient who books on the phone and then opens the web app must
 * not see two different products, so when a token changes there it changes
 * here.
 *
 * This app is the patient's, so its place hue is Chroma's Patients domain:
 * `sky`. Teal stays the one action colour; red, amber and green stay the
 * patient's clinical signals.
 *
 * Mirrored rather than imported because the web tokens are CSS custom
 * properties inside a Tailwind v4 `@theme` block — there is no JS module to
 * import. The one thing that IS shared for real is the slot engine
 * (`supabase/functions/_shared/slots.ts`), which has zero imports precisely
 * so every runtime can consume it.
 *
 * ponytail: hand-mirrored, so it can drift. Ceiling: the first time a colour
 * disagrees between web and phone. Upgrade path: generate this file from the
 * Chroma tokens.json in a prebuild step, as the web's globals.css already is.
 */

import { Platform } from "react-native";

/** Teal — the one action colour, carried unchanged (`DESIGN-medsync.md` § Teal). */
export const brand = {
  50: "#f0fdfa",
  100: "#ccfbf1",
  200: "#99f6e4",
  300: "#5eead4",
  400: "#2dd4bf",
  500: "#14b8a6",
  600: "#0d9488",
  700: "#0f766e",
  800: "#115e59",
  900: "#134e4a",
  950: "#042f2e",
} as const;

/** The teal ramp under the name the brand-moment screens were written to. */
export const mint = brand;

/**
 * Sky — the Patients domain's place hue (ADR 0162). Colour as *place*, never
 * state: an avatar, an icon disc, the current tab. Never a button, a selected
 * control or a status. `skyDark` is the web's `.dark` ramp.
 */
export const sky = {
  50: "#f0f9ff",
  100: "#e0f2fe",
  200: "#bae6fd",
  300: "#7dd3fc",
  400: "#38bdf8",
  500: "#0ea5e9",
  600: "#0284c7",
  700: "#0369a1",
  800: "#075985",
  900: "#0c4a6e",
  950: "#082f49",
} as const;

/** Ink — Chroma's cool neutrals (light). */
export const ink = {
  0: "#ffffff",
  25: "#fbfbfc",
  50: "#f6f7f8",
  100: "#f0f1f3",
  150: "#e9eaed",
  200: "#e3e5e8",
  300: "#d0d3d9",
  400: "#a0a5ae",
  500: "#6c717b",
  600: "#545963",
  700: "#3d4149",
  800: "#272a30",
  900: "#17191d",
  950: "#0f1012",
} as const;

/** Ink in the `.dark` theme — surfaces layer upward from a near-black ground. */
export const inkDark = {
  0: "#16181b",
  25: "#131417",
  50: "#1a1c20",
  100: "#1f2226",
  150: "#262a2f",
  200: "#2c3036",
  300: "#3a3f46",
  400: "#5b616a",
  500: "#8a9099",
  600: "#a9aeb6",
  700: "#c8ccd2",
  800: "#e1e3e7",
  900: "#eef0f2",
  950: "#f7f8f9",
} as const;

/** @deprecated ADR 0162 — the neutral ramp is `ink`. */
export const gray = ink;

/**
 * Clinical status pairs. Deliberately NOT part of the brand ramp — red means a
 * genuine emergency and nothing else, on every MedSync surface.
 */
export const status = {
  stableBg: "#dcfce7",
  stableFg: "#15803d",
  criticalBg: "#fee2e2",
  criticalFg: "#dc2626",
  cautionBg: "#fef3c7",
  cautionFg: "#d97706",
  pendingBg: "#f5f5f5",
  pendingFg: "#525252",
  /** Chip text for critical and caution at AA (ADR 0162). */
  criticalFgAa: "#b91c1c",
  cautionFgAa: "#92400e",
} as const;

/**
 * `#rrggbb` + alpha → `rgba(...)`. The tokens are hex because the web's are;
 * a scrim needs alpha, and hard-coding a second rgba copy of each brand colour
 * is how two palettes start to drift.
 */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/* ─── the two palettes ───────────────────────────────────────────── */

/**
 * The semantic roles a screen is allowed to paint with.
 *
 * Every screen and component reads these through `useTheme()` and NOTHING
 * else: not the ramps above, not a hex literal. The ramps exist so the two
 * palettes below can be written in the design system's own vocabulary, and
 * for the two brand moments (the splash and the sign-in photograph) whose
 * scrims are the brand's colour in either theme. A screen that reaches past
 * the roles for a ramp step has made a theme decision on its own, and it will
 * be the wrong one in the other theme.
 *
 * The roles and both value sets are the web's — `:root` and `.dark` in
 * `app/globals.css`, lifted verbatim — so a patient moving between the phone
 * and the web app sees one product in whichever theme they chose.
 */
/** The tag hues this app paints with: action, Patients, awaiting, neutral. */
export type TagHue = "teal" | "sky" | "iris" | "slate";

export interface Palette {
  scheme: "light" | "dark";

  /** The page ground — `--background`. */
  background: string;
  /** Primary text — `--foreground`. */
  foreground: string;
  /** A raised surface: cards, sheets, the docked footer — `--card`. */
  card: string;
  /** A sunken surface: input wells, quiet chips, disabled fills — `--muted`. */
  muted: string;
  /** Secondary text: eyebrows, metadata, hints — `--muted-foreground`. */
  mutedForeground: string;

  /** The brand action colour: links, icons, the back control, the wordmark — `--primary`. */
  primary: string;
  /** Text on a `primary` fill. */
  primaryForeground: string;
  /** A brand-tinted surface for a selected or emphasised thing — `--accent`. */
  accent: string;
  /**
   * The sky-tinted surface for a *place* — an avatar, an icon disc, the
   * current tab (ADR 0162: this app is the Patients domain). Not for anything
   * selected or anything that means a state; those stay `accent`.
   */
  place: string;
  /** Ink on `place`. */
  placeForeground: string;
  /** Text on `accent`. */
  accentForeground: string;

  /**
   * The one call-to-action per screen — Chroma's teal primary (the old mint
   * fill is retired, ADR 0162). The splash, sign-in and primary door share it.
   */
  cta: string;
  /** Headline text on `cta`. */
  ctaForeground: string;
  /** Body text on `cta`. */
  ctaMuted: string;

  /** Hairlines and outlines — `--border`. */
  border: string;
  /** Focus — `--ring`. */
  ring: string;
  /**
   * The shadow under a floating surface (the tab bar). Always dark: a shadow
   * is an absence of light in either theme, and one derived from the text
   * colour would glow white on a black page.
   */
  shadow: string;

  /**
   * The clinical pairs, retoned for the ground they sit on. Red is still for
   * a genuine emergency only — `critical` is drawn by the Emergency tab and
   * `EmergencyButton` (ADR 0085 §5) and by nothing else.
   */
  /**
   * Square tags with a dot (ADR 0162): workflow states and labels, in cool
   * hues only — never red, amber or green, which belong to the patient.
   */
  tag: Record<TagHue, { bg: string; edge: string; text: string; dot: string }>;
  status: {
    stableBg: string;
    stableFg: string;
    cautionBg: string;
    cautionFg: string;
    criticalBg: string;
    criticalFg: string;
    pendingBg: string;
    pendingFg: string;
    criticalFgAa: string;
    cautionFgAa: string;
  };
}

/** `app/globals.css` `:root` (MedSync Chroma). */
export const light: Palette = {
  scheme: "light",
  background: "#ffffff",
  foreground: ink[900],
  card: ink[0],
  muted: ink[25],
  mutedForeground: ink[500],
  primary: brand[700],
  primaryForeground: "#ffffff",
  accent: brand[50],
  accentForeground: brand[700],
  place: sky[50],
  placeForeground: sky[700],
  cta: brand[700],
  ctaForeground: "#ffffff",
  ctaMuted: brand[100],
  border: ink[200],
  ring: brand[600],
  shadow: withAlpha(ink[900], 0.14),
  tag: {
    teal: { bg: "#f0fdfa", edge: "#ccfbf1", text: "#0f766e", dot: "#0d9488" },
    sky: { bg: "#f0f9ff", edge: "#bae6fd", text: "#0369a1", dot: "#0284c7" },
    iris: { bg: "#eef2ff", edge: "#c7d2fe", text: "#4338ca", dot: "#4f46e5" },
    slate: { bg: "#f0f1f3", edge: "#e3e5e8", text: "#3d4149", dot: "#6c717b" },
  },
  status,
};

/**
 * `app/globals.css` `.dark` (MedSync Chroma). A near-black ground: the brand
 * lives in the text and the accents, where it can be read.
 */
export const dark: Palette = {
  scheme: "dark",
  background: "#0f1012",
  foreground: inkDark[900],
  card: inkDark[0],
  muted: inkDark[25],
  mutedForeground: inkDark[500],
  primary: brand[400],
  primaryForeground: brand[950],
  accent: "#0b2926",
  accentForeground: brand[300],
  place: "#0c2533",
  placeForeground: sky[300],
  // Chroma's dark primary: the bright teal with deep-teal text (7.8:1).
  cta: brand[400],
  ctaForeground: brand[950],
  ctaMuted: brand[900],
  border: inkDark[200],
  ring: brand[400],
  // Deeper, because a soft shadow on near-black is invisible and the bar then
  // has to rely on its hairline alone.
  shadow: withAlpha(ink[950], 0.6),
  tag: {
    teal: { bg: "#0b2926", edge: "#134e4a", text: "#5eead4", dot: "#2dd4bf" },
    sky: { bg: "#0c2533", edge: "#0c4a6e", text: "#7dd3fc", dot: "#38bdf8" },
    iris: { bg: "#1d1f3d", edge: "#312e81", text: "#a5b4fc", dot: "#818cf8" },
    slate: { bg: "#1f2226", edge: "#3a3f46", text: "#c8ccd2", dot: "#8a9099" },
  },
  status: {
    stableBg: "#052e16",
    stableFg: "#4ade80",
    cautionBg: "#451a03",
    cautionFg: "#fcd34d",
    criticalBg: "#450a0a",
    criticalFg: "#fca5a5",
    pendingBg: "#262626",
    pendingFg: "#a3a3a3",
    criticalFgAa: "#fca5a5",
    cautionFgAa: "#fcd34d",
  },
};

/**
 * The splash gradient. The web's `--gradient-hero` runs dark-at-top; the
 * reference composition for this screen runs dark-at-BOTTOM, so the same three
 * stops are ordered the other way. Same hue, same scale, no new colour.
 */
export const splashGradient = [brand[600], brand[800], brand[950]] as const;

/** 4px base grid — `DESIGN-medsync.md` § Spacing. */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
} as const;

/** Radii — `DESIGN-medsync.md` § Borders, radii. `full` is a pill. */
export const radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  "2xl": 24,
  full: 9999,
} as const;

/**
 * Motion. The design system permits exactly one curve and four durations, and
 * bans decorative animation — this is a clinical product, so motion carries
 * meaning or it does not happen.
 *
 * `hold` is not a transition: it is how long the brand moment is allowed to
 * sit before the screen becomes interactive. See `useSplashSequence`.
 */
export const motion = {
  /** cubic-bezier(0.16, 1, 0.3, 1) — the only sanctioned easing. */
  easing: [0.16, 1, 0.3, 1] as const,
  instant: 100,
  fast: 150,
  normal: 250,
  slow: 400,
  /** 40ms between siblings, per the stagger rule. */
  stagger: 40,
} as const;

export const font = {
  /**
   * Bricolage Grotesque at 600 — Chroma's display face (ADR 0162), for screen
   * titles and the brand moments only. Everything else is Geist.
   */
  display: "BricolageGrotesque_600SemiBold",
  /** The wordmark: MedSync in the display face at 600. */
  wordmark: "BricolageGrotesque_600SemiBold",
  /**
   * @deprecated Bricolage has no italic; the emphasised tail is upright and
   * carries its colour instead (ADR 0162).
   */
  displayItalic: "BricolageGrotesque_600SemiBold",
  body: "Geist_400Regular",
  bodyMedium: "Geist_500Medium",
  /** Chroma headings are Geist at 600. */
  bodySemiBold: "Geist_600SemiBold",
  /**
   * The booking code and the position number — the two things a patient
   * reads aloud and shows at a desk (PRD §6.3: big and monospaced). The
   * platform's own mono: no font file, and 0/O, 1/I never share a shape.
   */
  mono: Platform.select({ ios: "Menlo", default: "monospace" }),
} as const;
