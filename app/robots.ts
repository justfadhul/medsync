import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site-config";

const BASE = SITE_URL;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Admin, MFA, and internal routes shouldn't be indexed.
        disallow: [
          "/admin",
          "/api/",
          "/sign-in/mfa",
          "/onboarding/mfa-setup",
          "/monitoring",
          // The design reference shows clinical sample data (doses, vitals); not for search.
          "/styleguide",
        ],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
