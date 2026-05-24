import {
  AdaptiveModel,
  AnnouncementBar,
  CtaBandMid,
  Ecosystem,
  Faq,
  FinalCta,
  Footer,
  FoundingStory,
  Hero,
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
import { V2BackToTop } from "@/components/landing/v2-back-to-top";
import { V2Hospitals } from "@/components/landing/v2-hospitals";
import { V2ScrollProgress } from "@/components/landing/v2-scroll-progress";
import { V2SiteNav } from "@/components/landing/v2-site-nav";

/**
 * Landing — navigability refactor (v2).
 *
 * Same design system as before; restructured architecture. The page
 * now reads as a small number of clearly-titled, distinct sections —
 * each answering ONE question, in a logical narrative:
 *
 *   1. Hero            — what MedSync is, plus the three audience doors.
 *   2. The gap         — what we kept seeing on the wards.
 *   3. The closed loop — the single core concept; this is the page's
 *                        centre of gravity. Absorbs the four old
 *                        "record / loop / sources" sections.
 *   4. For patients    — the patient-app experience.
 *   5. For hospitals   — care-team coordination + specialty adaptation,
 *                        condensed into one stop with sub-points.
 *   6. Trust + Uganda  — built for the realities of Ugandan care, and
 *                        the honest engineering claims behind it.
 *   7. About           — three cofounders + horizons, merged.
 *   8. Get started     — FAQ + final CTA.
 *
 * Wayfinding (the navigability fix):
 *   - V2SiteNav: sticky condensed header with scroll-spy.
 *   - V2ScrollProgress: thin top-edge progress bar.
 *   - V2BackToTop: appears after the first viewport.
 *   - data-section-anchor on each section → scroll-margin clears the
 *     sticky nav so anchor jumps land on the title (see globals.css).
 *
 * The legacy composition is still reachable at `/v1` (see
 * `app/v1/page.tsx`), and the git tag `landing-v1-fallback` pins the
 * source state at the previous commit if a full revert is ever needed.
 */
export default function HomePage() {
  return (
    <div className="bg-background flex min-h-svh flex-col">
      <V2ScrollProgress />
      <AnnouncementBar />
      <V2SiteNav />
      <main className="flex-1">
        {/* 1 — Hero. SubBanner + Hero + HeroSurfaces + TrustStrip read
            as a single visual unit, not four stacked stops. */}
        <section id="hero" data-section-anchor>
          <SubBanner />
          <Hero />
          <HeroSurfaces />
          <TrustStrip />
        </section>

        {/* 2 — The gap. The three founder voices + matching answer
            surfaces. Previously this was the standalone Voices section
            buried deeper in the page; promoting it to "what we kept
            seeing" gives the visitor the *problem* before the *fix*. */}
        <section id="problem" data-section-anchor>
          <Voices />
        </section>

        {/* 3 — The closed loop. This is the page's centre of gravity.
            Four previously-separate sections (PlatformShowcase scroll-pin,
            AdaptiveModel specialty tabs, PatientCard full record, and the
            Ecosystem integration chips) now read as one connected story
            under a single nav stop. Each surface carries its own header
            internally, but they share the #loop anchor for wayfinding. */}
        <section id="loop" data-section-anchor>
          <PlatformShowcase />
          <AdaptiveModel />
          <PatientCard />
          <Ecosystem />
        </section>

        {/* Mid-page conversion break. NOT a nav stop — just a thin
            transition surface between the dense Loop section and the
            audience-specific sections that follow. */}
        <CtaBandMid />

        {/* 4 — For patients. */}
        <section id="patients" data-section-anchor>
          <PatientChapter />
        </section>

        {/* 5 — For care teams & hospitals. New condensed composition
            (V2Hospitals) — reuses the existing ClinicianHomeMock plus
            three sub-points distilled from the old AdaptiveModel insight
            and the clinician-flavoured loop scenes. No new mock work. */}
        <section id="hospitals" data-section-anchor>
          <V2Hospitals />
        </section>

        {/* 6 — Built for Uganda + Trust. Both answer the same "can we
            rely on this?" question — UgandaCapabilities is the context;
            TrustGovernance is the engineering posture. One stop. */}
        <section id="trust" data-section-anchor>
          <UgandaCapabilities />
          <TrustGovernance />
        </section>

        {/* 7 — About. Founder stories at the top (the strongest
            credibility moment), the Now/Soon/Later horizons below. */}
        <section id="about" data-section-anchor>
          <FoundingStory />
          <Vision />
        </section>

        {/* 8 — Get started. FAQ collapsed by default, final CTA closes. */}
        <section id="get-started" data-section-anchor>
          <Faq />
          <FinalCta />
        </section>
      </main>
      <Footer />
      <V2BackToTop />
    </div>
  );
}
