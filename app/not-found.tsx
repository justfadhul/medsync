import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon, ArrowUpRightIcon, HouseIcon } from "lucide-react";

import { OnboardingCtaCluster } from "@/components/landing/_cta-cluster";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

/**
 * 404 — page not found.
 *
 * Same editorial-clinical aesthetic as the landing page so visitors who
 * hit a stale link don't feel they've fallen off the site. The three
 * audience doors live here too — a missed link shouldn't be a dead end.
 */
export default function NotFound() {
  return (
    <div className="bg-background relative flex min-h-svh w-full flex-col">
      {/* Atmosphere — softer than the hero, just a tint */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 left-1/2 -z-10 h-[80%] w-[120%] max-w-none -translate-x-1/2 [background:radial-gradient(closest-side,oklch(0.95_0.06_342/0.4),transparent_72%)] dark:[background:radial-gradient(closest-side,oklch(0.45_0.08_342/0.22),transparent_72%)]"
      />

      <main className="mx-auto flex w-full max-w-200 flex-1 flex-col items-center justify-center gap-8 px-6 py-20 text-center">
        <span className="text-muted-foreground inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase">
          <span className="bg-brand-500 size-1 rounded-full" />
          404 &middot; That page doesn&rsquo;t exist
        </span>

        <h1
          className="font-display text-foreground max-w-[22ch] text-[40px] leading-[1.05] tracking-[-0.025em] text-balance sm:text-[64px]"
          style={{ fontWeight: 400 }}
        >
          The record for <span className="text-plum-700 italic">this page</span> is missing.
        </h1>

        <p className="text-muted-foreground text-body-m sm:text-body-l max-w-[58ch] leading-[1.6] text-balance">
          The link you followed points somewhere we haven&rsquo;t built yet &mdash; or somewhere
          we&rsquo;ve since moved. The doors below are the only ones currently open.
        </p>

        <div className="w-full">
          <OnboardingCtaCluster layout="doors" />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
          <Link
            href="/"
            className={cn(
              "border-border text-foreground hover:border-brand-300 hover:bg-brand-50/50 dark:hover:bg-brand-50/10",
              "text-body-s inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5",
              "transition-colors duration-150",
            )}
          >
            <HouseIcon className="size-3.5" strokeWidth={1.75} />
            Back to MedSync home
          </Link>
          <Link
            href="/#faq"
            className="text-muted-foreground hover:text-foreground text-body-s inline-flex items-center gap-1 px-2 py-1.5 transition-colors"
          >
            Or visit the FAQ
            <ArrowUpRightIcon className="size-3" strokeWidth={1.75} />
          </Link>
        </div>

        <p className="text-muted-foreground/60 inline-flex items-center gap-2 pt-6 font-mono text-[10px] tracking-[0.18em] uppercase">
          <ArrowLeftIcon className="size-3" strokeWidth={1.75} />
          MS-404
        </p>
      </main>
    </div>
  );
}
