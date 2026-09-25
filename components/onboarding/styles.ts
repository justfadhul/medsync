import { cn } from "@/lib/utils";

/*
 * Onboarding v2 kit — the class tokens and ids, with no React or form-library imports, so pages
 * that only need the look (pending pages, the profile) don't load the form engine (Law 10).
 */

export const fieldId = (name: string) => `f-${name}`;

export const inputClass = cn(
  "block h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base text-foreground sm:text-body-m",
  "placeholder:text-muted-foreground/70 outline-none transition-[border-color,box-shadow] duration-150 ease-expo-out",
  "focus-visible:border-teal-500 focus-visible:shadow-[0_0_0_3px_rgba(20,184,166,0.18)]",
  "aria-[invalid=true]:border-amber-600 aria-[invalid=true]:bg-amber-50/50 dark:aria-[invalid=true]:bg-amber-950/20",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

/** Reveal-in-place (≤ 200 ms, instant under reduced motion) for a field that appears after a choice. */
export const revealClass =
  "transition-[opacity,translate] duration-150 ease-expo-out starting:translate-y-1 starting:opacity-0 motion-reduce:transition-none";
