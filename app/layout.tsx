import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";

import { EmergencyPill } from "@/components/emergency/emergency-pill";
import { OPEN_GRAPH, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site-config";
import { Providers } from "./providers";

import "./globals.css";

/**
 * Editorial-clinical type system:
 *   - Fraunces: serif display for headlines + pull quotes. Calligraphic
 *     warmth keeps a healthcare site from reading cold; opsz=144 lets the
 *     hero H1 use the optical-size axis so the giant size reads correctly.
 *   - Geist Sans: body. Modern, clinical, optimized for data-dense UIs.
 *   - Geist Mono: tabular figures for labs, dosing, vitals, IDs.
 */
const fontDisplay = Fraunces({
  subsets: ["latin"],
  variable: "--font-medsync-display",
  axes: ["opsz", "SOFT", "WONK"],
  display: "swap",
});
const fontSans = Geist({
  subsets: ["latin"],
  variable: "--font-medsync-sans",
  display: "swap",
});
const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-medsync-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: "%s · MedSync",
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: "Usama Fadhul" }],
  creator: "MedSync founding team",
  publisher: "MedSync",
  category: "health",
  keywords: [
    "hospital operating system",
    "EHR",
    "Uganda",
    "clinical workflow",
    "patient record",
    "digital health Africa",
    "MedSync",
  ],
  formatDetection: { telephone: false, email: false, address: false },
  // No root canonical: every page inherited "/" — "/" and "/about" set their own (landing v4).
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  // No root og:url either (it stamped "/" on every route); "/" and "/about" set theirs.
  openGraph: OPEN_GRAPH,
  // Title, description and image come from og:* (X falls back to them).
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0A0A" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

const ORGANIZATION_JSONLD = {
  "@context": "https://schema.org",
  "@type": "MedicalOrganization",
  name: "MedSync",
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  founder: { "@type": "Person", name: "Usama Fadhul" },
  areaServed: { "@type": "Country", name: "Uganda" },
  knowsAbout: [
    "Hospital operating system",
    "Electronic health records",
    "Care coordination",
    "Home patient monitoring",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fontDisplay.variable} ${fontSans.variable} ${fontMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground flex min-h-full flex-col font-sans">
        <Providers>
          {children}
          {/* ADR 0098 ruling 7 (Law 5): the Emergency pill on every route,
              signed in or out, staff workspaces included. It hides itself
              on /emergency/** and on / and /about, whose header carries
              Emergency (ADR 0099). */}
          <EmergencyPill />
        </Providers>
        <Analytics />
        <script
          type="application/ld+json"
          // schema.org JSON-LD — payload is a literal object we control,
          // no user input is ever interpolated.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSONLD) }}
        />
      </body>
    </html>
  );
}
