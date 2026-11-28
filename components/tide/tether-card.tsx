"use client";

import type { Tier } from "@/components/tide/v2-membership";
import type { ReactNode } from "react";
import { useState } from "react";
import { RotateCcwIcon } from "lucide-react";

import { ICON } from "@/components/tide/kit";
import { TIER_NAME, TIER_SURFACE } from "@/components/tide/v2-membership";
import { MEMBERSHIP_COPY } from "@/content/patient-app/membership";
import { cn } from "@/lib/utils";

const M = MEMBERSHIP_COPY;

/** What the one card on Me shows (the phone's `tether-card.tsx`, same fields and words). */
export interface TetherCardData {
  holder: string;
  /** Spaced code, or "Given at your first visit". */
  number: string;
  facility: string | null;
  age: string | null;
  sex: string | null;
  /** Null when the holder keeps them off the card (the default, PRD Q6). */
  conditions: string | null;
  allergies: string;
  /** "On file at …" or "None given"; null: unknown. */
  nextOfKin: string | null;
  ifFound: string;
}

/**
 * The one card on Me (the phone's TetherCard, owner, 18 Nov 2026): the membership card and the health card as
 * one card with two sides. Front: the plan's material, the number large for the desk, the name, the home
 * hospital, age and sex. Back: the Medical ID (allergies, conditions only when shown, next of kin, who to call
 * if found, the short-lived code). Click anywhere to turn; "Turn over" is written on the card. Under Reduce
 * Motion the faces cross-fade. The material follows the plan (M10: decorative, never a clinical state).
 */
export function TetherCard({
  data,
  tier,
  qr,
}: {
  data: TetherCardData;
  tier: Tier | null;
  qr: ReactNode | null;
}) {
  const [back, setBack] = useState(false);
  const surface = tier ? TIER_SURFACE[tier] : "bg-pw-band text-pw-on-band";
  const hasNumber = /\d/.test(data.number);
  const about = [data.age, data.sex].filter(Boolean).join(" · ");
  const face =
    "pw-card-face rounded-pw-card shadow-pw-float absolute inset-0 overflow-hidden transition-[transform,opacity] duration-[450ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:duration-150";
  const hint = (label: string, cls: string) => (
    <span
      className={cn(
        "inline-flex h-[30px] shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold",
        cls,
      )}
    >
      <RotateCcwIcon className="size-3.5" {...ICON} />
      {label}
    </span>
  );
  const row = (k: string, v: string) => (
    <div className="flex justify-between gap-2.5 text-[12px]">
      <span className="text-pw-ink-3 font-medium">{k}</span>
      <span className="truncate text-right font-bold">{v}</span>
    </div>
  );

  return (
    <button
      type="button"
      onClick={() => setBack((b) => !b)}
      aria-label={
        back
          ? `Tether card, ${M.card.back.title}. ${M.card.turnBack}`
          : `Tether card, front. ${M.card.turnOver}`
      }
      aria-expanded={back}
      className="focus-visible:outline-pw-focus relative block aspect-[1.586] w-full max-w-[420px] text-left [perspective:1100px] focus-visible:outline-2 focus-visible:outline-offset-4"
    >
      <span
        aria-hidden={back}
        className={cn(
          face,
          surface,
          "flex flex-col justify-between p-5",
          back
            ? "[transform:rotateY(180deg)] motion-reduce:[transform:none] motion-reduce:opacity-0"
            : "",
        )}
      >
        {/* Two soft discs in the card's own ink: depth without a second colour. */}
        <svg
          aria-hidden
          viewBox="0 0 350 222"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 size-full"
        >
          <circle cx={330} cy={-10} r={120} fill="currentColor" fillOpacity={0.06} />
          <circle cx={300} cy={236} r={92} fill="currentColor" fillOpacity={0.07} />
        </svg>
        <span className="relative flex items-center justify-between">
          <span className="text-[20px] font-bold tracking-[-0.03em]">Tether</span>
          {tier ? (
            <span
              className={cn(
                "rounded-full px-3 py-1 text-[13px] font-semibold",
                tier === "family_care"
                  ? "text-pw-tier-gold ring-pw-tier-gold ring-1"
                  : "bg-current/12",
              )}
            >
              {TIER_NAME[tier]}
            </span>
          ) : null}
        </span>
        <span className="relative flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold tracking-[0.1em] uppercase">
            {M.card.member}
          </span>
          <span
            className={
              hasNumber
                ? "font-pw-mono truncate text-[22px] font-semibold tracking-[0.12em]"
                : "text-[15px] font-semibold"
            }
          >
            {data.number}
          </span>
        </span>
        <span className="relative flex items-end justify-between gap-2.5">
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[19px] font-semibold">{data.holder}</span>
            <span className="truncate text-[14px] opacity-85">
              {[data.facility ?? "No home facility yet", about].filter(Boolean).join(" · ")}
            </span>
          </span>
          {hint(M.card.turnOver, "bg-current/12")}
        </span>
      </span>

      <span
        aria-hidden={!back}
        className={cn(
          face,
          "bg-pw-surface text-pw-ink ring-pw-line flex flex-col gap-1.5 px-4 py-3 ring-1 ring-inset",
          back
            ? ""
            : "[transform:rotateY(-180deg)] motion-reduce:[transform:none] motion-reduce:opacity-0",
        )}
      >
        <span className="flex gap-3">
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex items-center justify-between gap-2">
              <span className="text-[15px] font-semibold">{M.card.back.title}</span>
              {hint(M.card.turnBack, "bg-pw-surface-2 text-pw-ink-2")}
            </span>
            <span
              className={
                hasNumber
                  ? "font-pw-mono truncate text-[18px] font-semibold tracking-[0.12em]"
                  : "text-pw-ink-2 text-[14px] font-semibold"
              }
            >
              {data.number}
            </span>
          </span>
          {qr ? <span className="shrink-0 self-start">{qr}</span> : null}
        </span>
        {qr ? (
          <span className="text-pw-ink-3 text-right text-[10px]">{M.card.back.qrNote}</span>
        ) : null}
        <span className="flex flex-col gap-1">
          {row(M.card.back.allergies, data.allergies)}
          {row(M.card.back.conditions, data.conditions ?? "Hidden by the card holder")}
          {data.nextOfKin ? row(M.card.back.nextOfKin, data.nextOfKin) : null}
        </span>
        <span className="flex-1" />
        <span className="line-clamp-2 text-[12px] font-semibold">{data.ifFound}</span>
        <span className="text-pw-ink-3 truncate text-[11px]">
          Written by the card holder · not confirmed by a clinician
        </span>
      </span>
    </button>
  );
}
