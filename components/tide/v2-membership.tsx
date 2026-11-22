"use client";

import { useState } from "react";

import { buttonClass } from "@/components/tide/kit";
import { MEMBERSHIP_COPY } from "@/content/patient-app/membership";
import { cn } from "@/lib/utils";

const M = MEMBERSHIP_COPY;

export type Tier = "basic" | "plus_family" | "plus_care" | "family_care";

export const TIER_SURFACE: Record<Tier, string> = {
  basic: "bg-pw-tier-basic text-pw-tier-on-basic",
  plus_family: "bg-pw-tier-plus-family text-pw-tier-on-tier",
  plus_care: "bg-pw-tier-plus-care text-pw-tier-on-tier",
  family_care: "bg-pw-tier-family-care text-pw-tier-on-tier",
};
export const TIER_NAME: Record<Tier, string> = {
  basic: M.tiers.basic,
  plus_family: M.tiers.plusFamily,
  plus_care: M.tiers.plusCare,
  family_care: M.tiers.familyCare,
};

export interface MedicalId {
  /** "54 · F": from the old health card's front (MR1: nothing lost when it went). */
  ageSex?: string | null;
  /** Next of kin on file, in words. */
  nextOfKin?: string | null;
  /** "If found, call …" or "If found, please return to …". */
  ifFound?: string | null;
  emergencyContact: string;
  bloodGroup: string | null;
  allergies: string[];
  conditions: string[];
  hospitalLine: string;
  /** A QR of a short-lived token (S24), drawn by the caller; never PHI. */
  qr: React.ReactNode;
}

/**
 * The Tether membership card (patient app v2 §5.9, M10). Front: tier, name, member number. Back: the medical ID
 * with a QR of a short-lived token; conditions hidden until asked. "Turn over" is a real button, not only a
 * gesture; Reduce Motion swaps faces without the turn. Tier materials are decoration, never a clinical state.
 */
export function MembershipCard({
  tier,
  name,
  memberNo,
  id,
}: {
  tier: Tier;
  name: string;
  memberNo: string;
  id: MedicalId;
}) {
  const [back, setBack] = useState(false);
  const [showConditions, setShowConditions] = useState(false);
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="w-full max-w-[400px] [perspective:1200px]">
        <div
          className={cn(
            "pw-card-turn grid grid-cols-[minmax(0,1fr)]",
            back && "[transform:rotateY(180deg)]",
          )}
        >
          <section
            aria-hidden={back}
            inert={back}
            className={cn(
              "pw-card-face rounded-pw-card shadow-pw-float flex aspect-[1.586] flex-col justify-between p-5 [grid-area:1/1]",
              TIER_SURFACE[tier],
            )}
          >
            <div className="flex items-center justify-between">
              <span className="font-pw text-[20px] font-semibold">Tether</span>
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-[12px] font-semibold",
                  tier === "family_care"
                    ? "text-pw-tier-gold ring-pw-tier-gold ring-1"
                    : "bg-pw-band-glass",
                )}
              >
                {TIER_NAME[tier]}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[19px] font-semibold">{name}</span>
              <span className="font-pw-mono text-[14px] tracking-[0.16em] opacity-90">
                {memberNo}
              </span>
            </div>
          </section>
          <section
            aria-hidden={!back}
            inert={!back}
            className="pw-card-face rounded-pw-card bg-pw-surface text-pw-ink shadow-pw-float flex min-h-full [transform:rotateY(180deg)] gap-4 p-5 [grid-area:1/1]"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-[13px]">
              <span className="text-[15px] font-semibold">{M.card.back.title}</span>
              <span>
                <b>{M.card.back.emergencyContact}:</b> {id.emergencyContact}
              </span>
              <span>
                <b>{M.card.back.bloodGroup}:</b> {id.bloodGroup ?? "—"}
              </span>
              <span>
                <b>{M.card.back.allergies}:</b>{" "}
                {id.allergies.length ? id.allergies.join(", ") : "—"}
              </span>
              {showConditions ? (
                <span>
                  <b>{M.card.back.conditions}:</b> {id.conditions.join(", ") || "—"}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowConditions(true)}
                  className="text-pw-accent-text min-h-11 self-start font-semibold"
                >
                  {M.card.back.showConditions}
                </button>
              )}
              <span>
                <b>{M.card.back.hospitalLine}:</b> {id.hospitalLine}
              </span>
              {id.ageSex ? (
                <span>
                  <b>{M.card.back.ageSex}:</b> {id.ageSex}
                </span>
              ) : null}
              {id.nextOfKin ? (
                <span>
                  <b>{M.card.back.nextOfKin}:</b> {id.nextOfKin}
                </span>
              ) : null}
              {id.ifFound ? <span className="text-pw-ink-2">{id.ifFound}</span> : null}
            </div>
            <div className="flex w-28 shrink-0 flex-col items-center gap-1">
              {id.qr}
              <span className="text-pw-ink-3 text-center text-[11px]">{M.card.back.qrNote}</span>
            </div>
          </section>
        </div>
      </div>
      <button
        type="button"
        aria-pressed={back}
        onClick={() => setBack((b) => !b)}
        className={buttonClass("soft", "m")}
      >
        {back ? M.card.turnBack : M.card.turnOver}
      </button>
    </div>
  );
}

/** One plan to choose (§5.9). Prices come from the server's approved rows (D-MR-10), passed in, never bundled. */
export function TierCard({
  tier,
  monthlyUgx,
  yearlyUgx,
  features,
  current,
  onChoose,
  chooseLabel,
}: {
  tier: Exclude<Tier, "basic">;
  monthlyUgx: number;
  yearlyUgx: number;
  features: string[];
  current: boolean;
  onChoose: () => void;
  /** The button's words; the kit's default is the trial offer. */
  chooseLabel?: string;
}) {
  return (
    <section className="rounded-pw-card bg-pw-surface shadow-pw-card flex flex-col gap-3 p-5">
      <div className={cn("h-2 w-12 rounded-full", TIER_SURFACE[tier])} aria-hidden />
      <h3 className="text-[17px] font-semibold">{TIER_NAME[tier]}</h3>
      <p className="tabular-nums">
        <span className="font-pw text-[26px] font-semibold">
          UGX {monthlyUgx.toLocaleString("en-GB")}
        </span>
        <span className="text-pw-ink-3 text-[13px]"> / {M.plans.monthly.toLowerCase()}</span>
      </p>
      <p className="text-pw-ink-3 text-[13px] tabular-nums">
        {M.plans.yearly}: UGX {yearlyUgx.toLocaleString("en-GB")} · {M.plans.yearlyNote}
      </p>
      <ul className="text-pw-ink-2 flex list-disc flex-col gap-1 pl-5 text-[14px]">
        {features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <p className="text-pw-ink-3 text-[12px]">{M.plans.neverAhead}</p>
      <button
        type="button"
        onClick={onChoose}
        disabled={current}
        className={buttonClass(current ? "soft" : "accent", "m", current)}
      >
        {current ? TIER_NAME[tier] : (chooseLabel ?? M.plans.trial)}
      </button>
    </section>
  );
}
