import type { Metadata } from "next";

import { Chrome } from "@/components/landing/tether/chrome";
import { Coming } from "@/components/landing/tether/coming";
import { Duo } from "@/components/landing/tether/duo";
import { Footer } from "@/components/landing/tether/footer";
import { Hero } from "@/components/landing/tether/hero";
import { Modes } from "@/components/landing/tether/modes";
import { Questions } from "@/components/landing/tether/questions";
import { Statement } from "@/components/landing/tether/statement";
import { Steps } from "@/components/landing/tether/steps";
import { META } from "@/content/tether-landing/copy";
import { preAlertLive } from "@/lib/emergency/feature";
import { renderedAt } from "@/lib/landing/example-visit";

/**
 * The Tether landing page (ADR 0477), served at `/` while LANDING_TETHER is on. Every string comes from
 * content/tether-landing; every example says so (ADR 0479).
 */
export const metadata: Metadata = {
  title: { absolute: META.title },
  description: META.description,
  alternates: { canonical: "/" },
  openGraph: { title: META.title, description: META.description, url: "/" },
  twitter: { card: "summary_large_image", title: META.title, description: META.description },
};

/** The example visit is six days ahead of the server's clock at first paint (D-LP-08); refreshed hourly. */
export const revalidate = 3600;

export default function TetherLandingPage() {
  const preAlert = preAlertLive();
  const now = renderedAt();
  return (
    <div id="top">
      <Chrome preAlert={preAlert} />
      <main>
        <Hero preAlert={preAlert} now={now} />
        <Statement />
        <Steps />
        <Modes now={now} />
        <Duo now={now} />
        <Coming />
        <Questions preAlert={preAlert} />
      </main>
      <Footer />
    </div>
  );
}
