import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Vercel Analytics is loaded via @vercel/analytics in app/layout.tsx (0.8).
  experimental: {
    serverActions: {
      // Default is 1 MB. Registration posts an optional photo (≤ 8 MB raw,
      // ADR 0085 §1) and the hospital form two licence documents.
      bodySizeLimit: "10mb",
    },
  },
  images: { formats: ["image/avif", "image/webp"] },
  // Landing v4 route audit: one route family. The old /onboarding/* doors
  // became /signup/*; keep the old links (and search results) working.
  async redirects() {
    return ["patient", "clinical", "hospital"].map((door) => ({
      source: `/onboarding/${door}`,
      destination: `/signup/${door}`,
      permanent: true,
    }));
  },
};

/**
 * Gate H (ADR 0094, PRD §4.5): `npm run analyze` writes .next/analyze/*.html
 * treemaps. The plugin is webpack-only, so that script passes `--webpack`;
 * a normal (Turbopack) build never sees it. The size gate itself is
 * `npm run budget` (scripts/check-budget.mjs) — the analyzer is for finding
 * WHAT grew, not for deciding whether it may.
 */
const withAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === "true" });

/**
 * Wrap with Sentry only if a DSN is present — keeps local dev builds clean
 * for anyone working without a Sentry project.
 */
export default process.env.SENTRY_DSN
  ? withSentryConfig(withAnalyzer(nextConfig), {
      silent: !process.env.CI,
      // Org/project come from env so we don't hard-code Usama's account here.
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // Source maps: upload on prod build, skip in dev.
      sourcemaps: { disable: process.env.NODE_ENV !== "production" },
      // Don't auto-instrument Vercel Cron Monitors — we don't use them yet.
      automaticVercelMonitors: false,
      // Tunnel Sentry events through a Next route to bypass ad-blockers.
      tunnelRoute: "/monitoring",
    })
  : withAnalyzer(nextConfig);
