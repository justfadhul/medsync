import type { ReactNode } from "react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * The console's editors open as one wide, centred dialog — a landscape card
 * with its sections side by side — rather than a drawer sliding in from the
 * edge. Header / scrolling body / footer are the Sheet's own pieces (the same
 * dialog primitive underneath), so an editor is unchanged inside; only the
 * body lays its fieldsets out in columns.
 */
export function EditorDialog({
  open,
  onOpenChange,
  width = "wide",
  trigger,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `wide` seats three columns; `medium` two. */
  width?: "wide" | "medium";
  /** A `DialogTrigger`, so the opener carries the dialog's ARIA and gets focus back on close. */
  trigger?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger}
      <DialogContent
        showCloseButton={false}
        className={cn(
          // The editor is one flex column: header, a body that scrolls, footer.
          "flex max-h-[88svh] flex-col gap-0 overflow-hidden p-0",
          width === "wide" ? "sm:max-w-5xl" : "sm:max-w-3xl",
          className,
        )}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}
