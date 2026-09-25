/* eslint-disable no-console -- CLI script: console output is the UI. */
/**
 * Gate H (ADR 0094, PRD §4.5): the /patient routes are the ones a Ugandan
 * phone loads on mobile data, so they carry a first-load JS ceiling.
 *
 * Reads .next/diagnostics/route-bundle-stats.json — `next build` writes it
 * (next/dist/build/route-bundle-stats.js): per route, the union of every JS
 * chunk its segments load on first paint, shared root chunks included, i.e.
 * the "First Load JS" column of the build summary. Each chunk is gzipped here
 * and summed per route, because bytes on the wire are what the phone pays for.
 *
 * Baseline 2026-09-19 (Turbopack build, 17 patient routes): heaviest 318 kB
 * gz (/patient/profile), lightest 243 kB. 140 kB of every route is ONE shared
 * chunk — react-dom plus the Sentry browser SDK that instrumentation-client.ts
 * imports unconditionally — so that is where a real saving would come from.
 * Ceiling 370 kB ≈ +16%. Raise it only with the reason in the commit message,
 * never to turn a red run green; `npm run analyze` shows what grew.
 *
 * Run after `next build`: npm run budget. Exits 1 with any route over.
 */

import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const CEILING_KB = 370;
/**
 * Tighter per-route ceilings. /patient: the home redesign (2026-09-23) may not
 * grow past the page it replaced — 267.0 kB gz measured on the pre-change tree;
 * the redesign itself measured 253.2 kB (ADR 0100).
 */
const ROUTE_CEILING_KB = { "/patient": 267 };
const PREFIX = "/patient";
const STATS = ".next/diagnostics/route-bundle-stats.json";

if (!existsSync(STATS)) {
  console.error(`${STATS} not found — run \`next build\` first (from the repo root).`);
  process.exit(1);
}

const rows = JSON.parse(readFileSync(STATS, "utf8")).filter(
  (r) => r.route === PREFIX || r.route.startsWith(`${PREFIX}/`),
);
if (rows.length === 0) {
  console.error(`no ${PREFIX} routes in ${STATS} — was the build complete?`);
  process.exit(1);
}

// Chunks are shared across routes; gzip each once.
const gz = new Map();
const gzipKb = (path) => {
  if (!gz.has(path)) gz.set(path, gzipSync(readFileSync(path), { level: 9 }).length / 1024);
  return gz.get(path);
};

let over = 0;
for (const r of rows.sort((a, b) => a.route.localeCompare(b.route))) {
  const kb = r.firstLoadChunkPaths.reduce((sum, p) => sum + gzipKb(p), 0);
  const bad = kb > (ROUTE_CEILING_KB[r.route] ?? CEILING_KB);
  if (bad) over++;
  console.log(`${bad ? "OVER" : "  ok"}  ${kb.toFixed(1).padStart(6)} kB  ${r.route}`);
}
console.log(`\nceiling: ${CEILING_KB} kB gzip first-load JS per route (${rows.length} routes)`);
if (over) {
  console.error(`${over} route(s) over budget`);
  process.exit(1);
}
