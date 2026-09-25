"use client";

import type { ProviderDetail } from "@/lib/patient/discover";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  ClockIcon,
  StarIcon,
  StethoscopeIcon,
  UsersIcon,
  VideoIcon,
} from "lucide-react";

import { BottomActionBar, BottomActionBarSpacer } from "@/components/responsive/bottom-action-bar";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DateTimeFields } from "./date-time-fields";

/**
 * The provider screen — the person, then when you can see them; the same
 * shape as the phone's `ProviderHero`.
 *
 * A photograph, when there is one, is the reference's photo card; without
 * one the monogram sits beside the name as a disc, and no pale block stands
 * in for a face. Under the name, a row of facts — and only facts the tables
 * hold (ADR 0085 §2): time on MedSync, patients seen, the rating with its
 * count, video visits, continuity. A count of zero is not a fact and is not
 * drawn; there is no strip of "—". Nothing here is an affordance that does
 * nothing: the reference's call and message circles have no transport
 * behind them and are not drawn.
 *
 * The palette is ours (DESIGN-medsync.md): the reference's tinted grounds
 * are `brand-50`, and its photo gradient is a flat tint — decorative grounds
 * are an anti-pattern here.
 *
 * Time is a chip grid, not the reference's tick-mark ruler. A ruler is a
 * slider over discrete values: it loses the 44px target, arrow-key traversal
 * and the announced selected state that a radio group gives for free, on
 * phones that are often shared and often low-end. Same rhythm, same place in
 * the layout, an affordance that survives a screen reader.
 */

export function ProviderScreen({
  provider,
  /** Rendered when the line charges — resolved server-side (ADR 0092). */
  feeLine,
  feeNotes,
}: {
  provider: ProviderDetail;
  feeLine: string | null;
  feeNotes: ReadonlyArray<string>;
}) {
  const days = useMemo(() => Object.keys(provider.slotsByDate).sort(), [provider.slotsByDate]);
  const [day, setDay] = useState<string | null>(days[0] ?? null);
  const [slot, setSlot] = useState<string | null>(null);

  const initials = initialsOf(provider.fullName);

  const facts: { icon: typeof ClockIcon; text: string }[] = [];
  const years = yearsWithUs(provider.withUsSinceIso);
  if (years) facts.push({ icon: ClockIcon, text: years });
  if (provider.patientsSeen > 0)
    facts.push({ icon: UsersIcon, text: `${compact(provider.patientsSeen)} patients` });
  if (provider.rating)
    facts.push({
      icon: StarIcon,
      text: `${provider.rating.average.toFixed(1)} · ${compact(provider.rating.count)} ${
        provider.rating.count === 1 ? "review" : "reviews"
      }`,
    });
  if (provider.allowVirtual) facts.push({ icon: VideoIcon, text: "Video visits" });
  // PRD §2.7 continuity — the one fact worth more than a star average.
  if (provider.seenBefore) facts.push({ icon: CheckCircleIcon, text: "Seen you before" });

  return (
    <div className="flex flex-col gap-5">
      {/* Two columns on a desk — who they are on the left, when you can see
          them on the right — so the whole choice sits on one screen; one
          column on a phone, where the docked bar carries the button. */}
      <div className="md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-start md:gap-6">
        <div className="flex flex-col gap-4">
          {/* The only way in is the directory, so Back is an honest link — it
              works in a fresh tab, where `router.back()` would leave the site. */}
          <Link
            href="/patient"
            className="text-muted-foreground hover:text-foreground text-body-s duration-fast ease-expo-out -mx-1 -mt-2 -mb-1 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-md px-1 transition-colors"
          >
            <ArrowLeftIcon className="size-3.5" aria-hidden />
            Back
          </Link>

          {/* ── The photograph, only when there is one ─────────────── */}
          {provider.photoUrl ? (
            <div className="bg-brand-50 aspect-[16/10] w-full overflow-hidden rounded-3xl">
              {/* eslint-disable-next-line @next/next/no-img-element -- a signed, expiring Supabase URL */}
              <img
                src={provider.photoUrl}
                alt=""
                className="size-full object-cover"
                decoding="async"
              />
            </div>
          ) : null}

          {/* ── Name and credentials, the monogram beside them ─────── */}
          <header className="flex items-center gap-3">
            {provider.photoUrl ? null : (
              <span
                aria-hidden
                className="bg-plum-50 text-plum-700 text-heading-s grid size-14 shrink-0 place-items-center rounded-full font-mono font-medium"
              >
                {initials ?? <StethoscopeIcon strokeWidth={1.5} className="size-6" />}
              </span>
            )}
            <div className="flex min-w-0 flex-col gap-0.5">
              <h1 className="font-display text-foreground text-heading-l leading-tight font-medium tracking-[-0.015em]">
                {provider.fullName}
              </h1>
              <p className="text-muted-foreground text-body-s">
                {[provider.cadreName, provider.departmentName].filter(Boolean).join(" · ")}
              </p>
            </div>
          </header>

          {/* ── The facts, each drawn only when it is one ─────────── */}
          {facts.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="About this clinician">
              {facts.map(({ icon: Icon, text }) => (
                <li
                  key={text}
                  className="bg-muted border-border text-foreground text-caption inline-flex min-h-[30px] items-center gap-1.5 rounded-full border px-3 font-medium"
                >
                  <Icon className="text-muted-foreground size-3.5" aria-hidden />
                  {text}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          {/* ── When: a week of day pills under a month select, and the day's
              open times as a grid of badges (the owner's pick by screenshot). */}
          <section className="flex flex-col gap-3">
            <h2 className="text-foreground text-body-m font-medium">When</h2>
            {days.length === 0 ? (
              <p className="text-muted-foreground bg-card text-body-s dark:shadow-card rounded-xl p-4 shadow-xs">
                {provider.fullName} has no days open on MedSync yet.
              </p>
            ) : (
              <DateTimeFields
                slotsByDate={provider.slotsByDate}
                day={day}
                slot={slot}
                onDay={(d) => {
                  setDay(d);
                  setSlot(null);
                }}
                onSlot={setSlot}
              />
            )}
          </section>

          {/* ── The fee, stated before the patient commits (ADR 0092) ─ */}
          {feeLine ? (
            <dl className="bg-muted flex flex-col gap-1 rounded-2xl p-4">
              <dt className="text-overline text-muted-foreground uppercase">Fee</dt>
              <dd className="text-foreground text-body-m font-medium">{feeLine}</dd>
              {feeNotes.map((note) => (
                <dd key={note} className="text-muted-foreground text-body-s">
                  {note}
                </dd>
              ))}
            </dl>
          ) : null}

          <div className="hidden md:block">
            {slot ? (
              <Link
                href={`/patient/book?line=${provider.lineId}&clinician=${provider.userId}&slot=${encodeURIComponent(slot)}`}
                className={cn(buttonVariants({ size: "lg" }), "w-full rounded-full")}
              >
                Book this time
              </Link>
            ) : (
              <Button size="lg" disabled className="w-full rounded-full">
                {days.length === 0 ? "No days open" : "Pick a day and time"}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="md:hidden">
        {/* ── Docked CTA — the house sticky bar, which clears the tab bar; a
          `fixed bottom-0` here sat UNDER `MobileTabBar` (z-30) and was
          unreachable on a phone. */}
        <BottomActionBar>
          {slot ? (
            <Link
              href={`/patient/book?line=${provider.lineId}&clinician=${provider.userId}&slot=${encodeURIComponent(slot)}`}
              className={cn(buttonVariants({ size: "lg" }), "w-full rounded-full")}
            >
              Book this time
            </Link>
          ) : (
            <Button size="lg" disabled className="w-full rounded-full">
              {days.length === 0 ? "No days open" : "Pick a day and time"}
            </Button>
          )}
        </BottomActionBar>
      </div>
      <BottomActionBarSpacer />
    </div>
  );
}

/** "New on MedSync" / "3 yrs on MedSync" — time at this hospital, which is all we know. */
function yearsWithUs(iso: string | null): string | null {
  if (!iso) return null;
  const years = Math.floor((Date.now() - new Date(iso).getTime()) / (365.25 * 86_400_000));
  return years < 1 ? "New on MedSync" : `${years} yr${years === 1 ? "" : "s"} on MedSync`;
}

/** 3549 → "3,549". Never rounded, never a "+": the count is exact, so it is shown exactly. */
function compact(n: number): string {
  return n.toLocaleString("en-UG");
}

function initialsOf(name: string): string | null {
  if (name === "Your clinician") return null;
  const letters = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter((c): c is string => !!c && /\p{L}/u.test(c))
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return letters || null;
}
