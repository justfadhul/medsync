"use client";

import type { ReasonIcon } from "@/content/patient/book";
import type { PatientReasonCode } from "@/supabase/functions/_shared/sessions-sql";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import {
  ActivityIcon,
  Building2Icon,
  CalendarIcon,
  CheckIcon,
  EyeIcon,
  FlaskConicalIcon,
  HeartIcon,
  MessageCircleIcon,
  PillIcon,
  PlusIcon,
  RotateCcwIcon,
  SendIcon,
  ShieldIcon,
  TrendingUpIcon,
} from "lucide-react";

import { buttonClass, Card, ICON } from "@/components/tide/kit";
import { HelpButton } from "@/components/tide/shell";
import { BOOK_COPY as C, PLANNED_GROUPS } from "@/content/patient/book";
import { cn } from "@/lib/utils";

export type Door = "wrong" | "planned";

const REASON_ICON: Record<ReasonIcon, LucideIcon> = {
  replay: RotateCcwIcon,
  check: CheckIcon,
  pill: PillIcon,
  flask: FlaskConicalIcon,
  heart: HeartIcon,
  shield: ShieldIcon,
  trend: TrendingUpIcon,
  building: Building2Icon,
  send: SendIcon,
  plus: PlusIcon,
  message: MessageCircleIcon,
  eye: EyeIcon,
};

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pw-focus";

/** "1 · Who is this visit for?": a numbered question (mobile/src/features/visits/parts.tsx StepTitle). */
export function StepTitle({ n, children }: { n?: number; children: string }) {
  return (
    <h2 className="text-[17px] leading-[22px] font-semibold">
      {n ? <span className="text-pw-ink-3">{`${n} · `}</span> : null}
      {children}
    </h2>
  );
}

/** The honesty sentence (law L8), bold, with what follows it (parts.tsx HonestNote). */
export function HonestNote({ after }: { after?: string }) {
  return (
    <p className="rounded-pw-row bg-pw-info-tint text-pw-ink p-4 text-[17px] leading-[25px]">
      <strong className="font-bold">{C.honest}</strong>
      {after ? ` ${after}` : ""}
    </p>
  );
}

/**
 * "Why are you coming?" (mobile/src/features/visits/why-coming.tsx), shared by Book a visit and Ask for a day.
 * "Something is wrong" shows the symptom catalogue's body areas and opens the steps on the one chosen; "Planned
 * care" lists every other Appendix A reason, grouped. The "Something is wrong" card draws its own red Help, so a
 * page showing it hides the header Help (L6). With the catalogue off (Gate CS unsigned) the door is not shown at
 * all, only the planned list: it would lead nowhere. It comes back by itself once the catalogue is signed.
 */
export function WhyComing({
  n,
  door,
  onDoor,
  reason,
  onReason,
  areas,
  wrongHref,
}: {
  n?: number;
  door: Door | null;
  onDoor: (door: Door) => void;
  reason: PatientReasonCode | null;
  onReason: (reason: PatientReasonCode) => void;
  /** The catalogue's areas (labels from the package), or null when the catalogue is off (no "wrong" door). */
  areas: { key: string; label: string }[] | null;
  /** The symptom steps, opened on an area or (null) at the start. */
  wrongHref: (area: string | null) => string;
}) {
  const open = areas ? door : "planned";
  return (
    <section className="flex flex-col gap-3">
      <StepTitle n={n}>{C.whyTitle}</StepTitle>
      {areas ? (
        <div role="radiogroup" aria-label={C.whyTitle} className="grid grid-cols-2 gap-3">
          {(
            [
              ["wrong", C.doorWrong, C.doorWrongSub, ActivityIcon],
              ["planned", C.doorPlanned, C.doorPlannedSub, CalendarIcon],
            ] as const
          ).map(([key, label, sub, Icon]) => {
            const on = door === key;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onDoor(key)}
                className={cn(
                  "rounded-pw-card flex min-h-[164px] flex-col justify-between gap-3 p-4 text-left ring-2 ring-inset",
                  "transition-[scale,background-color] duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none",
                  FOCUS,
                  on
                    ? "bg-pw-act text-pw-on-act ring-pw-act shadow-pw-float"
                    : "bg-pw-surface text-pw-ink ring-pw-line",
                )}
              >
                <span className="flex items-start justify-between">
                  <span
                    className={cn(
                      "grid size-11 place-items-center rounded-full",
                      on ? "bg-pw-band-glass text-pw-on-band-accent" : "bg-pw-surface-3",
                    )}
                  >
                    <Icon className="size-5" {...ICON} />
                  </span>
                  {on ? (
                    <span className="bg-pw-on-band-accent text-pw-act grid size-[22px] place-items-center rounded-full">
                      <CheckIcon className="size-[13px]" strokeWidth={3} aria-hidden />
                    </span>
                  ) : null}
                </span>
                <span className="flex flex-col gap-1">
                  <span className="text-[17px] leading-[21px] font-semibold">{label}</span>
                  <span
                    className={cn(
                      "text-[13px] leading-[18px] font-medium",
                      on ? "text-pw-on-band-2" : "text-pw-ink-2",
                    )}
                  >
                    {sub}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {open === "wrong" && areas ? (
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-0.5">
            <p className="text-base leading-5 font-semibold">{C.whereTitle}</p>
            <p className="text-pw-ink-2 text-[15px] leading-[21px]">{C.whereLine}</p>
          </div>
          <ul className="grid grid-cols-2 gap-2">
            {areas.map((a) => (
              <li key={a.key} className="flex">
                <Link
                  href={wrongHref(a.key)}
                  className={cn(
                    "rounded-pw-field bg-pw-surface-2 hover:bg-pw-surface-3 flex min-h-12 flex-1 items-center px-3 py-2 text-[15px] font-semibold",
                    FOCUS,
                  )}
                >
                  {a.label}
                </Link>
              </li>
            ))}
          </ul>
          <Link href={wrongHref(null)} className={buttonClass("soft")}>
            {C.somethingElse}
          </Link>
          <div className="rounded-pw-row bg-pw-surface-2 flex flex-wrap items-center gap-3 p-3">
            <p className="min-w-0 flex-1 text-[15px] leading-[21px] font-medium">{C.veryUnwell}</p>
            <HelpButton />
          </div>
        </Card>
      ) : open === "planned" ? (
        PLANNED_GROUPS.map((g) => (
          <div key={g.title} className="flex flex-col gap-1.5">
            <p className="text-pw-ink-3 pl-1 text-xs font-bold tracking-[0.06em] uppercase">
              {g.title}
            </p>
            <Card className="overflow-hidden p-0">
              <div role="radiogroup" aria-label={g.title} className="divide-pw-line divide-y">
                {g.reasons.map((r) => {
                  const on = reason === r.reason;
                  const Icon = REASON_ICON[r.icon];
                  return (
                    <button
                      key={r.reason}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => onReason(r.reason)}
                      className={cn(
                        "flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-left",
                        FOCUS,
                        "focus-visible:-outline-offset-2",
                        on ? "bg-pw-accent-tint" : "bg-pw-surface hover:bg-pw-surface-2",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-full",
                          on ? "bg-pw-act text-pw-on-band-accent" : "bg-pw-surface-3",
                        )}
                      >
                        <Icon className="size-[18px]" {...ICON} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-base leading-5 font-semibold">{r.label}</span>
                        {on ? (
                          <span className="text-pw-ink-2 text-[13px] leading-[18px] font-medium">
                            {r.hint}
                          </span>
                        ) : null}
                      </span>
                      <span
                        aria-hidden
                        className={cn(
                          "bg-pw-surface size-[22px] shrink-0 rounded-full",
                          on ? "border-pw-act border-[7px]" : "border-pw-line-strong border-2",
                        )}
                      />
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>
        ))
      ) : null}
    </section>
  );
}
