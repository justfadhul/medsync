import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree, Geist, Geist_Mono } from "next/font/google";

import { EmergencyPill } from "@/components/emergency/emergency-pill";
import { OPEN_GRAPH, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site-config";
import { Providers, ScrubbedAnalytics } from "./providers";

import "./globals.css";

/**
 * MedSync Chroma type system (ADR 0162):
 *   - Bricolage Grotesque: display face for marketing headlines and workspace
 *     page titles only, on its opsz axis so each size draws correctly.
 *   - Geist: all product UI, headings included.
 *   - Geist Mono: tabular figures for vitals, labs, MRNs, beds and key hints.
 */
const fontDisplay = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-medsync-display",
  axes: ["opsz"],
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

/** Figtree: the lab workspace's text face (ADR 0344, Tide at desk density). Not preloaded: the face is fetched
 *  only where text uses it, which is inside `/lab` (the `lab-tide` scope in globals.css). */
const fontLab = Figtree({
  subsets: ["latin"],
  variable: "--font-medsync-lab",
  display: "swap",
  preload: false,
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
    { media: "(prefers-color-scheme: dark)", color: "#0F1012" },
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
      className={`${fontDisplay.variable} ${fontSans.variable} ${fontMono.variable} ${fontLab.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground flex min-h-full flex-col font-sans">
        <Providers>
          {children}
          {/* ADR 0098 ruling 7 (Law 5): the Emergency pill on every route,
              signed in or out, staff workspaces included. It hides itself
              on /emergency/** and on / and /about, whose header carries
              Emergency (ADR 0099). */}
          <EmergencyPill tide={process.env.TIDE_SURFACES} />
        </Providers>
        <ScrubbedAnalytics />
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
