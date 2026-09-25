import { CheckIcon, PauseIcon } from "lucide-react";

import { PHONE_MOCK } from "@/content/landing";
import { IllustrativeTag, MockFigure, StatusChip } from "../primitives";

/**
 * S4 phone mock — the patient's "Today" screen: medicines taken or due, one
 * paused by the care team (neutral, not a warning), a streak, and the log
 * action. Static and decorative; no clock, drug names, doses or dates.
 */
export function PatientPhone() {
  return (
    <MockFigure testId="mock-phone" label={PHONE_MOCK.aria}>
      <div className="border-border bg-card shadow-popover mx-auto w-full max-w-[300px] rounded-[40px] border p-2.5">
        <div className="border-border bg-background overflow-hidden rounded-[32px] border">
          <div className="bg-foreground/90 mx-auto mt-2 h-5 w-24 rounded-full" />
          <div className="flex flex-col gap-4 px-4 pt-5 pb-6">
            <div className="flex items-center justify-between gap-2">
              <span className="font-display text-heading-m text-foreground">
                {PHONE_MOCK.today}
              </span>
              <IllustrativeTag />
            </div>

            <div className="border-border bg-card shadow-card flex flex-col rounded-xl border">
              {PHONE_MOCK.items.map((item) => (
                <div
                  key={item.label}
                  className="border-border flex items-center justify-between gap-3 border-t px-3 py-3 first:border-t-0"
                >
                  <span className="text-body-s text-foreground min-w-0">{item.label}</span>
                  {item.state === "taken" ? (
                    <StatusChip tone="stable">
                      <CheckIcon className="size-3" strokeWidth={1.5} aria-hidden />
                      {item.state}
                    </StatusChip>
                  ) : (
                    <StatusChip tone="pending">{item.state}</StatusChip>
                  )}
                </div>
              ))}
            </div>

            <div className="text-body-s text-muted-foreground flex items-start gap-2">
              <PauseIcon className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} aria-hidden />
              <span className="min-w-0">{PHONE_MOCK.paused}</span>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex gap-1">
                {Array.from({ length: 5 }, (_, i) => (
                  <span key={i} className="h-1.5 flex-1 rounded-full bg-teal-500" />
                ))}
              </div>
              <span className="text-caption text-muted-foreground font-mono">
                {PHONE_MOCK.streak}
              </span>
            </div>

            <span className="dark:bg-primary dark:text-primary-foreground text-body-s block rounded-md bg-teal-700 py-2.5 text-center font-medium text-white">
              {PHONE_MOCK.action}
            </span>
          </div>
        </div>
      </div>
    </MockFigure>
  );
}
