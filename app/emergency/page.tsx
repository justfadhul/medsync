import type { EItem, Tile } from "./_components/pre-alert-form";
import type { CatalogItem } from "@/supabase/functions/_shared/symptom-catalog/types";
import type { Metadata } from "next";
import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";
import { firstAidCardsLive, preAlertLive } from "@/lib/emergency/feature";
import { cn } from "@/lib/utils";
import { CATALOG } from "@/supabase/functions/_shared/symptom-catalog/catalog.v0.1";
import {
  dangerSigns,
  t,
  visibleItems,
} from "@/supabase/functions/_shared/symptom-catalog/classify";
import { CloseLink } from "./_components/close-link";
import { EmergencySheet, FirstAidCards } from "./_components/emergency-sheet";
import { PreAlertForm } from "./_components/pre-alert-form";
import { loadEmergencyContext, splitContacts } from "./_lib/sheet";

export const metadata: Metadata = {
  title: "Emergency — get help now",
  robots: { index: false, follow: false },
};

/**
 * THE Emergency page (PRD MS-PRD-SYM-001 §8.2–§8.3; ADR 0098 ruling 7):
 * E1 and E2 together — the numbers first, the pre-alert beside them. Public,
 * signed in or out, one tap from the pill and two to a call; with pre-alerts
 * on, Send is one tap once a hospital is chosen. Follows the site theme
 * (owner decision 2026-09-23, superseding PRD Law 3's forced light), with
 * its own toggle beside Close. Reads the session only to name the
 * patient's own hospital — never redirects.
 *
 * Wide screens: two columns, the numbers pinned on the left while the form
 * scrolls on the right — the call button never leaves the screen. Narrow:
 * one column, numbers on top. With FEATURE_PRE_ALERT off the page is the
 * numbers alone in a single column (production today).
 *
 * `?items=` (the catalog's interrupt, the crisis page) pre-ticks danger
 * signs; `?submission=` links the catalog report to the alert.
 */
type Search = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const list = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);

/** The adult danger-sign strip (Appendix A.0) plus the next emergency items in catalog order. */
function tiles(): Tile[] {
  const strip = dangerSigns(CATALOG, "adult");
  const seen = new Set(strip.map((i) => i.key));
  const more = visibleItems(CATALOG, "adult").filter((i) => i.tier === "E" && !seen.has(i.key));
  return [...strip, ...more].slice(0, 8).map((i) => ({
    key: i.key,
    label: t(CATALOG, i.labelKey),
    icon: i.icon,
  }));
}

/** Every emergency item as a small label map — the client bundle never carries the package. */
function emergencyItems(): EItem[] {
  return (CATALOG.items as CatalogItem[])
    .filter((i) => i.tier === "E")
    .map((i) => ({
      key: i.key,
      label: t(CATALOG, i.labelKey),
      stroke: i.flags?.includes("stroke_time") ?? false,
      isolation: i.flags?.includes("isolation") ?? false,
    }));
}

export default async function EmergencyPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [sp, ctx] = await Promise.all([searchParams, loadEmergencyContext()]);
  const submissionId = first(sp.submission);
  const items = list(sp.items);
  const { primary, secondaries, drafts } = splitContacts(ctx.sheet.contacts);
  const preAlert = preAlertLive();

  const numbers = (
    <div className="flex flex-col gap-5 sm:gap-6">
      <EmergencySheet
        primary={primary}
        secondaries={secondaries}
        drafts={ctx.drafts ? drafts : []}
      />
      {firstAidCardsLive() ? <FirstAidCards /> : null}
      <nav aria-label="Other help" className="flex flex-col gap-1">
        <Link
          href="/emergency/crisis"
          className="text-primary text-body-s inline-flex min-h-11 items-center underline-offset-4 hover:underline"
        >
          Thinking of ending your life or harming yourself?
        </Link>
        <Link
          href="/emergency/sexual-violence"
          className="text-primary text-body-s inline-flex min-h-11 items-center underline-offset-4 hover:underline"
        >
          After sexual violence
        </Link>
      </nav>
    </div>
  );

  return (
    <div className="bg-background text-foreground min-h-svh">
      <main
        className={cn(
          "mx-auto flex w-full flex-col gap-4 px-4 py-4 sm:gap-6 sm:px-6 sm:py-6",
          preAlert ? "max-w-5xl lg:py-10" : "max-w-xl",
        )}
      >
        <nav aria-label="Leave" className="flex items-center justify-end gap-3">
          <ThemeToggle className="size-9" />
          <CloseLink className="text-muted-foreground hover:text-foreground text-body-s inline-flex min-h-11 items-center underline-offset-4 hover:underline" />
        </nav>

        {preAlert ? (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-14">
            <div className="lg:sticky lg:top-10 lg:self-start">{numbers}</div>
            <section
              id="tell"
              aria-labelledby="tell-heading"
              className="border-border flex flex-col gap-5 border-t pt-6 sm:gap-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-14"
            >
              <header className="flex flex-col gap-2">
                <p className="text-muted-foreground text-overline font-mono uppercase">
                  While you travel
                </p>
                <h2 id="tell-heading" className="text-foreground text-heading-m tracking-[-0.01em]">
                  Tell a hospital I&rsquo;m coming
                </h2>
                <p className="text-muted-foreground text-body-m">
                  The hospital prepares before you arrive. Calling is always faster if you can.
                </p>
              </header>
              <PreAlertForm
                facilities={ctx.sheet.facilities}
                ownHospitalId={ctx.hospitalId}
                signedIn={ctx.signedIn}
                eItems={emergencyItems()}
                tiles={tiles()}
                initialItems={items}
                submissionId={submissionId}
              />
            </section>
          </div>
        ) : (
          numbers
        )}
      </main>
    </div>
  );
}
