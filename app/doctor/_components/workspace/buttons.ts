import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The workspace's two button styles: teal for the next step, outline for the rest (≥ 44 px). */
export const PRIMARY_BUTTON = cn(
  buttonVariants({ variant: "primary", size: "md" }),
  "tap min-h-11 shrink-0 gap-1.5",
);
export const SECONDARY_BUTTON = cn(
  buttonVariants({ variant: "secondary", size: "md" }),
  "tap min-h-11 shrink-0",
);
