import type { EmergencySheetContact } from "@/lib/emergency/queries";
import { Building2Icon, PhoneIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { telHref } from "../_lib/client";
import { KIND_LABEL } from "../_lib/sheet";
import { CallLink } from "./call-link";

/**
 * E1 — the numbers half of the Emergency page (PRD MS-PRD-SYM-001 §8.2; ADR
 * 0098 rulings 7–8). One of the two web files besides the pill that paint
 * red: the header's primary call (the other is E2's Send). Every number is
 * a bare `tel:` anchor (works offline, one tap), labelled by kind, and every
 * one came from data — the file never names a digit string. With nothing
 * verified the primary is the destination alone: never a fabricated number.
 */
export interface EmergencySheetProps {
  primary: EmergencySheetContact | null;
  secondaries: EmergencySheetContact[];
  /** Unverified rows, non-production only — rendered under the Unsigned watermark. */
  drafts: EmergencySheetContact[];
}

export function EmergencySheet({ primary, secondaries, drafts }: EmergencySheetProps) {
  return (
    <section aria-labelledby="emergency-heading" className="flex flex-col gap-4 sm:gap-5">
      <header className="flex flex-col gap-2">
        <h1 id="emergency-heading" className="font-display text-display-s text-foreground">
          Get help now
        </h1>
        <p className="text-foreground text-body-m">
          If the person is not breathing or can&rsquo;t be woken, call now.
        </p>
      </header>

      {primary ? (
        <CallLink
          href={telHref(primary.number)}
          contactId={primary.id}
          className={cn(
            buttonVariants({ variant: "emergency", size: "lg" }),
            "min-h-16 w-full flex-col gap-0.5 rounded-xl py-3 whitespace-normal",
          )}
        >
          <span className="text-body-l inline-flex items-center gap-2">
            <PhoneIcon aria-hidden className="size-5" />
            Call {KIND_LABEL[primary.kind]}
          </span>
          <span className="text-body-s font-normal opacity-90">
            <span className="tabular font-mono">{primary.number}</span> · {primary.label}
          </span>
        </CallLink>
      ) : (
        <div
          role="status"
          className="bg-status-critical-bg text-status-critical-fg flex items-start gap-3 rounded-xl p-4"
        >
          <Building2Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div className="flex flex-col gap-1">
            <p className="text-body-l font-medium">Go to the nearest emergency unit</p>
            <p className="text-body-s">
              No verified emergency number is available here yet. They see the sickest people first.
            </p>
          </div>
        </div>
      )}

      {secondaries.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Other numbers">
          {secondaries.map((c) => (
            <li key={c.id}>
              <CallLink
                href={telHref(c.number)}
                contactId={c.id}
                className={cn(
                  buttonVariants({ variant: "secondary", size: "lg" }),
                  "min-h-12 w-full justify-between rounded-xl whitespace-normal",
                )}
              >
                <span className="inline-flex items-center gap-2 text-left">
                  <PhoneIcon aria-hidden className="size-4" />
                  {KIND_LABEL[c.kind]}
                  <span className="text-muted-foreground text-body-s font-normal">{c.label}</span>
                </span>
                <span className="tabular font-mono">{c.number}</span>
              </CallLink>
            </li>
          ))}
        </ul>
      ) : null}

      {drafts.length > 0 ? <DraftStrip contacts={drafts} /> : null}
    </section>
  );
}

/** Gate CS: unverified numbers show in non-production only, and say so. */
function DraftStrip({ contacts }: { contacts: EmergencySheetContact[] }) {
  return (
    <section
      aria-label="Unsigned clinical content"
      className="border-border flex flex-col gap-2 rounded-xl border border-dashed p-3"
    >
      <p className="text-muted-foreground text-caption font-mono tracking-[0.16em] uppercase">
        Unsigned clinical content — not yet verified
      </p>
      <ul className="flex flex-col gap-1">
        {contacts.map((c) => (
          <li key={c.id}>
            <CallLink
              href={telHref(c.number)}
              contactId={c.id}
              className={cn(
                buttonVariants({ variant: "ghost", size: "md" }),
                "w-full justify-between whitespace-normal",
              )}
            >
              <span className="text-left">
                {KIND_LABEL[c.kind]} · {c.label}
              </span>
              <span className="tabular font-mono">{c.number}</span>
            </CallLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** PRD §5.6 — the two draft first-aid cards, behind FEATURE_FIRST_AID_CARDS, watermarked. */
export const FIRST_AID_CARDS: readonly string[] = [
  "Press firmly on bleeding with a clean cloth",
  "Note the time the weakness started",
];

export function FirstAidCards() {
  return (
    <section
      aria-label="First aid — unsigned clinical content"
      className="border-border flex flex-col gap-2 rounded-xl border border-dashed p-3"
    >
      <p className="text-muted-foreground text-caption font-mono tracking-[0.16em] uppercase">
        Unsigned clinical content — first aid
      </p>
      <ul className="flex flex-col gap-2">
        {FIRST_AID_CARDS.map((card) => (
          <li key={card} className="bg-card text-foreground text-body-m rounded-lg p-3 shadow-xs">
            {card}
          </li>
        ))}
      </ul>
    </section>
  );
}
