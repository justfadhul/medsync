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

/** Presses and small state changes: 150 ms on the expo-out curve, none under reduced motion. */
export const PRESS =
  "transition-[scale,background-color,border-color,color,box-shadow] duration-150 ease-expo-out active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100";
