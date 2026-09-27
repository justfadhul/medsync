import type { VariantProps } from "class-variance-authority";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * MedSync Chroma button (ADR 0162): 32px default, `label` 13/500, `radius-md`.
 * One teal primary per view; place hues never colour a button; red is the
 * emergency button only.
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap",
    "border border-transparent font-medium [letter-spacing:-0.003em] outline-none select-none",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-100 ease-expo-out",
    "focus-visible:shadow-focus",
    "disabled:pointer-events-none disabled:opacity-45",
    "motion-safe:active:not(:disabled):translate-y-[0.5px]",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[15px]",
  ].join(" "),
  {
    variants: {
      variant: {
        // Light: teal-700 fill (white text 5.5:1); dark: the bright teal with
        // deep-teal text. Both come from the `primary` role token.
        primary:
          "bg-primary text-primary-foreground border-teal-800 shadow-primary hover:bg-primary-hover active:bg-primary-active dark:border-teal-500",
        secondary:
          "bg-secondary text-secondary-foreground border-ink-300 shadow-control hover:bg-ink-50 active:bg-ink-100",
        ghost:
          "bg-transparent text-ink-600 hover:bg-ink-100 hover:text-foreground active:bg-ink-150",
        soft: "bg-teal-tint text-teal-text border-teal-edge hover:border-teal-200",
        /** @deprecated ADR 0162 — the soft teal button is `soft`. */
        brandSoft: "bg-teal-tint text-teal-text border-teal-edge hover:border-teal-200",
        /** @deprecated ADR 0162 — Chroma has no mint CTA; it renders as `primary`. */
        mint: "bg-primary text-primary-foreground border-teal-800 shadow-primary hover:bg-primary-hover active:bg-primary-active dark:border-teal-500",
        // Solid red with white text in BOTH themes: the one red thing stays
        // unmistakable. Tailwind's red ramp does not invert with the theme:
        // white on its 600 step is 4.8:1, on the 700 step 6.5:1.
        emergency: [
          "bg-destructive text-white border-red-700",
          "hover:bg-red-700 active:bg-red-800",
          "dark:bg-red-600 dark:hover:bg-red-700 dark:active:bg-red-800",
        ].join(" "),
        alert:
          "bg-alert-bg border-alert-border text-alert-fg hover:bg-red-50 dark:hover:bg-status-critical-bg/40",
        link: "text-teal-text h-auto border-0 px-0 underline-offset-[3px] hover:underline",
      },
      size: {
        sm: "h-[26px] rounded-sm px-2 text-caption gap-1 [&_svg:not([class*='size-'])]:size-[13px]",
        md: "h-8 rounded-md px-3 text-label",
        lg: "h-10 rounded-md px-4 text-body-m font-medium",
        iconSm: "size-[26px] rounded-sm [&_svg:not([class*='size-'])]:size-[13px]",
        icon: "size-8 rounded-md",
        iconLg: "size-11 rounded-md [&_svg:not([class*='size-'])]:size-5",
      },
    },
    compoundVariants: [{ variant: "link", className: "h-auto px-0" }],
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
