import type { Metadata } from "next";

import {
  AdaptiveModel,
  AnnouncementBar,
  CtaBandMid,
  Ecosystem,
  Enrichment,
  Faq,
  FinalCta,
  FloatingQuote,
  Footer,
  FoundingStory,
  Hero,
  Nav,
  PatientCard,
  PatientChapter,
  PlatformShowcase,
  SubBanner,
  TrustGovernance,
  TrustStrip,
  UgandaCapabilities,
  Vision,
  Voices,
} from "@/components/landing";
import { HeroSurfaces } from "@/components/landing/_hero-surfaces";

/**
 * Landing v1 — the original landing-page composition, preserved for
 * side-by-side comparison against the navigability refactor at `/`.
 *
 * Imports the same components as `app/page.tsx` (no forks, no
 * divergence). The git tag `landing-v1-fallback` at commit `2ec89f1`
 * also pins the source state if a full revert is ever needed.
 *
 * noindex so the legacy URL doesn't dilute search.
 */
export const metadata: Metadata = {
  title: "MedSync — Landing v1 (legacy)",
  robots: { index: false, follow: false },
};

export default function LandingV1Page() {
  return (
    <div className="bg-background flex min-h-svh flex-col">
      <AnnouncementBar />
      <Nav />
      <main className="flex-1">
        <FloatingQuote />
        <SubBanner />
        <Hero />
        <HeroSurfaces />
        <TrustStrip />

        <PlatformShowcase />
        <PatientChapter />
        <CtaBandMid />

        <AdaptiveModel />
        <Voices />

        <Enrichment />
        <PatientCard />
        <Ecosystem />

        <UgandaCapabilities />
        <TrustGovernance />

        <FoundingStory />
        <Vision />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
