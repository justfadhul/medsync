import type { VariantProps } from "class-variance-authority";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap",
    "font-medium [letter-spacing:-0.01em] outline-none select-none",
    "transition-all duration-150 ease-expo-out",
    "focus-visible:shadow-focus",
    "disabled:pointer-events-none disabled:opacity-50",
    "active:not(:disabled):translate-y-px",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        // White on teal-600 is 3.7:1 (fails AA for button text); teal-700 is
        // 5.5:1 (landing v4, ADR 0099). Dark keeps the token pair (bright
        // teal-500 fill, deep-teal text) because the teal scale inverts there.
        primary: [
          "bg-teal-700 text-white hover:bg-teal-800 active:bg-teal-900",
          "dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary-hover dark:active:bg-primary-active",
        ].join(" "),
        secondary:
          "bg-secondary text-secondary-foreground border border-gray-200 dark:border-gray-300 hover:bg-muted hover:border-gray-300 active:bg-gray-150",
        ghost:
          "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground active:bg-gray-150",
        brandSoft:
          "bg-accent text-accent-foreground border border-brand-100 hover:bg-brand-100/70 hover:border-brand-200 dark:hover:bg-brand-100/40",
        // The reference palette's signature call to action: mint fill carrying
        // deep-teal text, rather than a filled brand button. Both scales flip
        // in dark mode, so the pairing holds without a dark: override.
        mint: "bg-mint-300 text-brand-900 hover:bg-mint-200 active:bg-mint-400 dark:bg-mint-700 dark:text-brand-100 dark:hover:bg-mint-800",
        // Solid red with white text in BOTH themes: the one red thing stays
        // unmistakable. The old dark pair (burgundy, pink text) vanished on a
        // critical-tinted surface, and the catalog's interrupt sheet is exactly
        // that burgundy. Tailwind's red ramp does not invert with the theme:
        // white on its 600 step is 4.8:1, on the 700 step 6.5:1.
        emergency: [
          "bg-destructive text-white",
          "hover:bg-red-700 active:bg-red-800",
          "dark:bg-red-600 dark:hover:bg-red-700 dark:active:bg-red-800",
        ].join(" "),
        alert:
          "bg-alert-bg border border-alert-border text-alert-fg hover:bg-red-50 dark:hover:bg-status-critical-bg/40",
        link: "text-primary underline-offset-4 hover:underline px-0",
      },
      size: {
        sm: "px-2.5 py-[5px] text-caption rounded-sm gap-1.5 [&_svg:not([class*='size-'])]:size-3",
        md: "px-[18px] py-2 text-body-s rounded-md",
        lg: "px-6 py-[11px] text-body-m rounded-md",
        iconSm: "size-7 rounded-sm [&_svg:not([class*='size-'])]:size-3.5",
        icon: "size-9 rounded-md",
        iconLg: "size-11 rounded-md [&_svg:not([class*='size-'])]:size-5",
      },
    },
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
