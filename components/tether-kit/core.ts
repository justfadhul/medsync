/**
 * The Tether kit's shared constants (docs/tether-kit/gate-a-proposal.md, D-TK-02 to D-TK-05). Tokens only: every
 * colour is a `pw-*` utility, generated from mobile/src/theme/tide.ts. Density is read from the nearest
 * `data-density="desk"` ancestor through Tailwind's `in-data-[density=desk]:` variant, so static parts need no
 * context. Parts that portal out of the page take density from `KitRoot` instead. A `Band` re-points the colour
 * tokens for everything inside it (surface.tsx), so controls on navy adapt with no classes of their own.
 */

export type Density = "patient" | "desk";

/** Lucide outline icons at Tide's stroke, hidden from assistive tech: the word beside them carries the meaning. */
export const ICON = { strokeWidth: 1.8, "aria-hidden": true } as const;

/**
 * The one focus ring: 2 px, 2 px gap, in `pw-focus`. A `Band` re-points `pw-focus` to `on-band-accent`, because the
 * page's focus shade is too dark to see on navy (2.3:1 in light; the light ring is 10:1).
 */
export const FOCUS =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pw-focus";

/**
 * Presses on the expo-out curve: in fast (150 ms) and back slower (250 ms), so a tap reads at once and the release
 * settles. A mouse press scales to 0.97; a touch press does not scale, because a scale under a thumb reads as lag
 * while scrolling (after Meta's Astryx). Nothing moves under reduced motion.
 */
export const PRESS = [
  "transition-[scale,background-color,border-color,color,box-shadow] duration-250 ease-expo-out active:duration-150",
  "pointer-fine:active:scale-[0.97] motion-reduce:transition-none motion-reduce:pointer-fine:active:scale-100",
].join(" ");

/**
 * The state layer: one overlay in the control's own text colour, 8% on hover and 14% on press, so every tone and
 * both themes answer a pointer the same way (hover only where a device can hover). The parent must be `relative`
 * and clip its corners with `rounded-*`; the layer inherits them. `before:` is left free for hit areas.
 */
export const STATE = [
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-current after:opacity-0",
  "after:transition-opacity after:duration-250 after:ease-expo-out active:after:duration-150 motion-reduce:after:transition-none",
  "hover:after:opacity-[0.08] active:after:opacity-[0.14]",
].join(" ");

/** A control that cannot act: no press, no state layer, a not-allowed cursor. */
export const INERT =
  "cursor-not-allowed pointer-fine:active:scale-100 after:hidden hover:after:opacity-0";

/**
 * High-contrast (forced colours) mode paints fills away. A transparent border becomes a visible system-coloured
 * edge there, so every control keeps its shape; elsewhere it is invisible and costs nothing.
 */
export const FORCED_EDGE = "border border-transparent";

/**
 * A field's frame (Set 2): the edge, the hover, the focus ring and the invalid, disabled and read-only looks, on
 * a wrapper around the native control so prefixes, units and buttons sit inside the same edge. Focus anywhere
 * inside shows the kit's one ring (2 px, 2 px gap) and a focus-coloured edge. An invalid field doubles its edge in
 * ink without moving (an inset line), never red: the error's icon and word carry the meaning.
 */
export const FIELD_FRAME = [
  "relative flex w-full min-w-0 items-stretch overflow-hidden border border-pw-line-strong bg-pw-surface text-pw-ink",
  "transition-[border-color,box-shadow] duration-150 ease-expo-out motion-reduce:transition-none",
  "pointer-fine:hover:not-focus-within:not-data-[invalid]:border-pw-ink-3",
  "focus-within:border-pw-focus focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-pw-focus",
  "data-[invalid]:border-pw-ink data-[invalid]:shadow-[inset_0_0_0_1px_var(--pw-ink)]",
  "data-[disabled]:cursor-not-allowed data-[disabled]:bg-pw-surface-2 data-[disabled]:text-pw-ink-3 data-[disabled]:pointer-fine:hover:border-pw-line-strong",
  "data-[readonly]:bg-pw-surface-2 data-[readonly]:border-pw-line data-[readonly]:pointer-fine:hover:border-pw-line",
].join(" ");

/**
 * Field sizes: 48 px tall with 17 px type for patients (16 px or more, so a phone never zooms on focus), 40 px with
 * 14 px at the desk. Minimum heights, in rem type, so a larger text setting grows the field instead of clipping it.
 */
export const FIELD_SIZE = [
  "min-h-12 rounded-pw-field text-[1.0625rem]",
  "in-data-[density=desk]:min-h-10 in-data-[density=desk]:rounded-[12px] in-data-[density=desk]:text-sm",
].join(" ");

/** The native control inside a frame: borderless, transparent, the frame does the rest. Autofill keeps the kit's colours. */
export const FIELD_CONTROL = [
  "min-w-0 flex-1 bg-transparent px-4 py-2.5 outline-none placeholder:text-pw-ink-4 disabled:cursor-not-allowed",
  "in-data-[density=desk]:px-3 in-data-[density=desk]:py-2",
  "autofill:shadow-[inset_0_0_0_100px_var(--pw-surface)] autofill:[-webkit-text-fill-color:var(--pw-ink)]",
].join(" ");
