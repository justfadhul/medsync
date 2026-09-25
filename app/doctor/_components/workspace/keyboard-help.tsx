"use client";

import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const KEYS = [
  ["j / k", "Next / previous patient"],
  ["Enter", "Open the patient"],
  ["s", "Their next step"],
  ["t", "Triage"],
  ["a", "Assign"],
  ["/ or ⌘K", "Find a patient"],
  ["1–7, 0", "A lane, or all"],
  ["Esc", "Close the patient"],
] as const;

/** "?" — the board's keys (§5.5). Loaded when asked for. */
export default function KeyboardHelp({ onClose }: { onClose: () => void }) {
  return (
    <Sheet open onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent side="center" widthClassName="sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Keyboard</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <dl className="text-body-s grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            {KEYS.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-[12px]">{k}</dt>
                <dd className="text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
