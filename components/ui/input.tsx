import type * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@/lib/utils";

/**
 * MedSync Chroma text field (ADR 0162): 34px, `radius-md`, `input` edge with
 * `shadow-control`; focus is a `ring` border plus a 3px `teal-tint` halo;
 * invalid is a `destructive` border with an `alert-bg` halo.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "border-input bg-card text-foreground text-body-s shadow-control h-[34px] w-full min-w-0 rounded-md border px-2.5",
        "ease-expo-out transition-[border-color,box-shadow] duration-150 outline-none",
        "placeholder:text-ink-400",
        "focus-visible:border-ring focus-visible:shadow-[0_0_0_3px_var(--teal-tint),0_0_0_1px_var(--ring)]",
        "disabled:bg-muted disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:shadow-[0_0_0_3px_var(--alert-bg)]",
        "file:text-foreground file:text-body-s file:inline-flex file:border-0 file:bg-transparent file:font-medium",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
