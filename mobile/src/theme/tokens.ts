/**
 * MedSync design tokens, mirrored for React Native.
 *
 * The web app is the source of truth: these values are lifted verbatim from
 * the `:root` block of `app/globals.css`, which `DESIGN-medsync.md` governs.
 * A patient who books on the phone and then opens the web app must not see
 * two different products, so when a token changes there it changes here.
 *
 * Mirrored rather than imported because the web tokens are CSS custom
 * properties inside a Tailwind v4 `@theme` block — there is no JS module to
 * import. The one thing that IS shared for real is the slot engine
 * (`supabase/functions/_shared/slots.ts`), which has zero imports precisely
 * so every runtime can consume it.
 *
 * ponytail: hand-mirrored, so it can drift. Ceiling: the first time a colour
 * disagrees between web and phone. Upgrade path: generate this file from
 * globals.css in a prebuild step — worth it only once a second designer is
 * editing the palette.
 */

import { Platform } from "react-native";

/** Teal. The brand hue — `DESIGN-medsync.md` § Primary Teal; anchor teal-600. */
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

/**
 * The accent and the signature call-to-action fill — the brand ramp under the
 * name the screens were written to.
 */
export const mint = brand;

/**
 * Plum. The second hue (ADR 0097) — `DESIGN-medsync.md` § Secondary Plum.
 * Colour as *place*, never state: where you are, who this is. Never a button,
 * a selected control or a status. `plumDark` is the web's `.dark` ramp, where
 * 50 is the deep end and 600 the bright anchor.
 */
export const plum = {
  50: "#fdf3f9",
  100: "#fee4f3",
  200: "#fecbe9",
  300: "#fea2dc",
  400: "#ea7bc4",
  500: "#c953a3",
  600: "#9f2f7e",
  700: "#87236a",
  800: "#6a1952",
  900: "#4e113c",
  950: "#321227",
} as const;

export const plumDark = {
  50: "#321227",
  100: "#4a173a",
  200: "#671e51",
  300: "#862e6b",
  400: "#a94088",
  500: "#cb58a6",
  600: "#ed85c8",
  700: "#fda8dd",
  800: "#ffcdeb",
  900: "#fde7f4",
  950: "#fdf3f9",
} as const;

export const gray = {
  50: "#fafafa",
  100: "#f5f5f5",
  150: "#efefef",
  200: "#e5e5e5",
  300: "#d4d4d4",
  400: "#a3a3a3",
  500: "#737373",
  600: "#525252",
  700: "#404040",
  800: "#262626",
  900: "#171717",
  950: "#0a0a0a",
} as const;

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
   * The plum-tinted surface for a *place* — an avatar, an icon disc, the
   * current tab, the current step (ADR 0097). Not for anything selected or
   * anything that means a state; those stay `accent`.
   */
  place: string;
  /** Ink on `place`. */
  placeForeground: string;
  /** Text on `accent`. */
  accentForeground: string;

  /**
   * The signature call-to-action — the mint fill the splash, sign-in and
   * primary door share. There is exactly one per screen.
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
  status: {
    stableBg: string;
    stableFg: string;
    cautionBg: string;
    cautionFg: string;
    criticalBg: string;
    criticalFg: string;
    pendingBg: string;
    pendingFg: string;
  };
}

/** `app/globals.css` `:root`. */
export const light: Palette = {
  scheme: "light",
  background: "#ffffff",
  foreground: gray[900],
  card: "#ffffff",
  muted: gray[50],
  mutedForeground: gray[500],
  primary: brand[600],
  primaryForeground: "#ffffff",
  accent: brand[50],
  accentForeground: brand[600],
  place: plum[50],
  placeForeground: plum[800],
  cta: mint[300],
  ctaForeground: brand[950],
  ctaMuted: brand[900],
  border: gray[200],
  ring: brand[500],
  shadow: withAlpha(gray[900], 0.14),
  status,
};

/**
 * `app/globals.css` `.dark`. A near-black ground, not a teal one: the
 * brand lives in the text and the accents, where it can be read, rather than
 * behind everything, where it can only be endured.
 */
export const dark: Palette = {
  scheme: "dark",
  background: "#0a0a0a",
  foreground: "#e5e5e5",
  card: "#171717",
  muted: "#111111",
  mutedForeground: "#a3a3a3",
  primary: brand[400],
  primaryForeground: brand[950],
  accent: brand[950],
  accentForeground: brand[300],
  place: plumDark[50],
  placeForeground: plumDark[800],
  // teal-400 rather than the web's darkened gradient: a filled control on a
  // near-black ground wants the accent bright enough to be the brightest thing
  // on the screen, and its text dark enough to read on it (7.8:1).
  cta: mint[400],
  ctaForeground: mint[950],
  ctaMuted: mint[900],
  border: "#262626",
  ring: brand[400],
  // Deeper, because a soft shadow on near-black is invisible and the bar then
  // has to rely on its hairline alone.
  shadow: withAlpha(gray[950], 0.6),
  status: {
    stableBg: "#052e16",
    stableFg: "#4ade80",
    cautionBg: "#451a03",
    cautionFg: "#fcd34d",
    criticalBg: "#450a0a",
    criticalFg: "#fca5a5",
    pendingBg: "#262626",
    pendingFg: "#a3a3a3",
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

/** Radii — `DESIGN-medsync.md` § Border radii. `full` is a pill. */
export const radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  "2xl": 20,
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
  display: "Fraunces_500Medium",
  /**
   * The wordmark cut. Lighter than `display` on purpose: Fraunces at 500
   * carries a lot of weight at display sizes, and a logotype wants to read as
   * drawn rather than as a bold heading. DESIGN-medsync's weight-500 rule
   * governs HEADINGS; this is a mark.
   */
  wordmark: "Fraunces_400Regular",
  displayItalic: "Fraunces_400Regular_Italic",
  body: "Geist_400Regular",
  bodyMedium: "Geist_500Medium",
  /**
   * The booking code and the position number — the two things a patient
   * reads aloud and shows at a desk (PRD §6.3: big and monospaced). The
   * platform's own mono: no font file, and 0/O, 1/I never share a shape.
   */
  mono: Platform.select({ ios: "Menlo", default: "monospace" }),
} as const;
