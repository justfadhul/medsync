/**
 * Single source of truth for the public-facing site URL.
 *
 * `medsync.health` is the canonical domain per the landing v4 brief. It must
 * resolve to the Vercel project before production — until it does, canonical
 * and og:url point at a domain that does not serve this build.
 */
export const SITE_URL = "https://medsync.health" as const;
export const SITE_NAME = "MedSync" as const;
export const SITE_TITLE = "MedSync — A digital hospital that doesn't stop at the gate" as const;
export const SITE_DESCRIPTION =
  "MedSync is the hospital operating system for Uganda that follows patients home, so warning signs reach the care team in time." as const;

/**
 * The Open Graph fields every public page shares. A page-level `openGraph`
 * replaces the root's wholesale, so pages spread this and add their own `url`.
 */
export const OPEN_GRAPH = {
  type: "website",
  siteName: SITE_NAME,
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  locale: "en_UG",
} as const;
