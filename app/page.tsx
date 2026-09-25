import type { Metadata } from "next";

import { Faq } from "@/components/landing/faq";
import { Founders } from "@/components/landing/founders/founders";
import { Gap } from "@/components/landing/gap";
import { Hero } from "@/components/landing/hero/hero";
import { Hospitals } from "@/components/landing/hospitals";
import { Loop } from "@/components/landing/loop/loop";
import { Patients } from "@/components/landing/patients";
import { LANDING_FOCUS } from "@/components/landing/primitives";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteNav } from "@/components/landing/site-nav";
import { Trust } from "@/components/landing/trust/trust";
import { OPEN_GRAPH } from "@/lib/site-config";
import { cn } from "@/lib/utils";

/**
 * Landing v4 "Slim" (ADR 0099): eight sections, nothing else. Every string
 * lives in content/landing.ts; every mock renders once; the sticky header
 * carries Emergency on every breakpoint. tests/landing/invariants.test.ts
 * holds the page to the brief (section count, word budget, no dosing, …).
 */
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { ...OPEN_GRAPH, url: "/" },
};

export default function HomePage() {
  return (
    <div className={cn("bg-background flex min-h-svh flex-col", LANDING_FOCUS)}>
      <SiteNav />
      <main className="flex-1">
        <Hero />
        <Gap />
        <Loop />
        <Patients />
        <Hospitals />
        <Trust />
        <Founders />
        <Faq />
      </main>
      <SiteFooter />
    </div>
  );
}
