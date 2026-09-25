import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site-config";

// Public pages only. /get-started (older status copy), /sign-up (invited staff)
// and /styleguide (a design reference with clinical sample data) stay out.
const PAGES: Array<[path: string, priority: number]> = [
  ["/", 1],
  ["/signup/hospital", 0.9],
  ["/about", 0.8],
  ["/signup/clinical", 0.8],
  ["/signup/patient", 0.8],
  ["/sign-in", 0.4],
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return PAGES.map(([path, priority]) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority,
  }));
}
