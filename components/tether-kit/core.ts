/**
 * The Tether kit's shared constants (docs/tether-kit/gate-a-proposal.md, D-TK-02 to D-TK-05). Tokens only: every
 * colour is a `pw-*` utility, generated from mobile/src/theme/tide.ts. Density is read from the nearest
 * `data-density="desk"` ancestor through Tailwind's `in-data-[density=desk]:` variant, so static parts need no
 * context. Parts that portal out of the page take density from `KitRoot` instead.
 */

export type Density = "patient" | "desk";

/** Lucide outline icons at Tide's stroke, hidden from assistive tech: the word beside them carries the meaning. */
export const ICON = { strokeWidth: 1.8, "aria-hidden": true } as const;

/** The one focus ring: 2 px `pw-focus`, 2 px gap. */
export const FOCUS =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pw-focus";

/**
 * Presses on the expo-out curve: in fast (150 ms) and back slower (250 ms), so a tap reads at once and the release
 * settles. A mouse press scales to 0.97. A touch press darkens instead: a scale under a thumb reads as lag while
 * scrolling (after Meta's Astryx). Nothing moves under reduced motion. References: docs/tether-kit/gate-a-proposal.md.
 */
export const PRESS = [
  "transition-[scale,background-color,border-color,color,box-shadow,filter] duration-250 ease-expo-out active:duration-150",
  "pointer-fine:active:scale-[0.97] pointer-coarse:active:brightness-95",
  "motion-reduce:transition-none motion-reduce:pointer-fine:active:scale-100",
].join(" ");
