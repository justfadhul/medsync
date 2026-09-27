import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge has no way to know about the MedSync type scale, which lives in
 * the `@theme` block of app/globals.css as `--text-*` tokens rather than in a
 * config file. Without this registration it cannot tell `text-caption` from a
 * text *colour*, files it in the colour group, and silently drops one of the two
 * whenever a size and a colour meet in the same `cn()` call — so
 * `cn("text-caption", "text-white")` would return just `text-white`, leaving the
 * element at the inherited 16px.
 *
 * The names below mirror the MedSync Chroma `--text-*` tokens in app/globals.css
 * exactly (ADR 0162); keep the two lists in step. See DESIGN-medsync.md § Typography.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display-xl",
            "display-l",
            "display-m",
            "display-s",
            "heading-l",
            "heading-m",
            "heading-s",
            "body-l",
            "body-m",
            "body-s",
            "label",
            "caption",
            "overline",
            "stat",
            "vital",
            "mono-s",
            "kbd",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
