/**
 * The motion vocabulary, in the form a JavaScript animation library needs.
 *
 * The design system names one easing curve and four durations, and the CSS in
 * src/styles/globals.css already carries them as tokens. framer-motion cannot
 * read a CSS variable, so the same values are written once here rather than
 * once in every component that animates.
 *
 * Nothing else is allowed: no spring, no overshoot, no duration off this list.
 * Every use is gated on the reader's reduced-motion preference at its own call
 * site, and the base layer of the stylesheet is the safety net behind that.
 */

/** cubic-bezier(0.16, 1, 0.3, 1), which is var(--ease-expo-out). */
export const EASE_EXPO_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** The four durations the design system names, in milliseconds. */
export const DURATION_MS = {
  fast: 100,
  normal: 150,
  slow: 250,
  reveal: 400,
} as const;

/** The sibling stagger the design system names, in milliseconds. */
export const STAGGER_MS = 40;

/** Milliseconds as the seconds framer-motion takes. */
export function seconds(ms: number): number {
  return ms / 1000;
}
