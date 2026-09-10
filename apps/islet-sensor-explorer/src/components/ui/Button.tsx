import type { ButtonHTMLAttributes } from "react";
import { forwardRef } from "react";

import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "teal-soft" | "alert";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/**
 * Red belongs to the insulin path and to the invalid state, and to nothing
 * else. The alert variant is held here for those two uses only.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary: "bg-card border border-gray-200 text-gray-900 hover:bg-gray-50 hover:border-gray-300",
  ghost: "text-gray-500 hover:bg-gray-100 hover:text-gray-900",
  "teal-soft": "bg-teal-50 border border-teal-100 text-teal-700 hover:border-teal-200",
  alert: "bg-alert-bg border border-alert-border text-alert-fg",
};

/**
 * Sizes come straight from DESIGN-medsync.md: small 5px by 10px at 11px,
 * medium 8px by 18px at 13px, large 11px by 24px at 15px. Each padding is
 * written on the 4px spacing scale (1.25 units is 5px, 4.5 units is 18px,
 * 2.75 units is 11px), so no arbitrary value is needed.
 */
const SIZES: Record<ButtonSize, string> = {
  sm: "gap-1.5 rounded-sm px-2.5 py-1.25 text-caption",
  md: "gap-2 rounded-md px-4.5 py-2 text-body-s",
  lg: "gap-2 rounded-md px-6 py-2.75 text-body-m",
};

/** The MedSync button: weight 500, 150ms transition, teal focus ring. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", type = "button", className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        // The design system sets one letter-spacing for every button size and
        // has no token for it, so -0.01em is written out. It sets --tw-tracking,
        // which the text-* size utilities read, so it holds at every size.
        "tap inline-flex items-center justify-center font-medium tracking-[-0.01em]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
});
