/* eslint-disable no-console -- a build gate reports to stdout */
/**
 * Production gate for S7 (PROMPT-LANDING-S7-FOUNDERS §4.4), run as `prebuild`.
 * A founder without a portrait shows a "Photo pending" tile — fine in preview,
 * never in production. When VERCEL_ENV is "production" and any founder lacks
 * a portrait, the build stops here and names them. Every other build passes.
 *
 * Imports content/founders.ts itself (Node ≥ 22.18 strips the types; the repo
 * pins Node 24), so it reads exactly what the page renders — no text parsing.
 */
const { FOUNDERS } = await import("../content/founders.ts");

const missing = FOUNDERS.filter((f) => !f.portrait).map((f) => f.displayName);

if (process.env.VERCEL_ENV === "production" && missing.length > 0) {
  console.error(
    `✗ Founder portraits missing: ${missing.join(", ")}.\n` +
      "  Production refuses to ship a “Photo pending” tile. Add the photo to\n" +
      "  assets/founders-src/, a crop box to scripts/portraits/portraits.config.json,\n" +
      "  run `npx tsx scripts/portraits/normalize.ts` and fill `portrait` in content/founders.ts.",
  );
  process.exit(1);
}

console.log(
  missing.length > 0
    ? `Founder portraits: ${missing.length} pending (${missing.join(", ")}) — allowed outside production.`
    : "Founder portraits: all present.",
);
