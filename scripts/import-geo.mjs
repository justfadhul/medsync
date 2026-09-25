/* eslint-disable no-console -- CLI script: console output is the UI. */
// Repeatable import of Uganda's administrative units (Onboarding v2, LOC-10).
//
// Source: OCHA COD-AB Uganda v01 (UBOS boundaries, valid 2020-08-24), CC BY-IGO,
// https://data.humdata.org/dataset/cod-ab-uga — the GeoJSON zip, unzipped.
//   node scripts/import-geo.mjs <dir-with-uga_admin1..4.geojson>
// Writes data/geo/{uganda-admin,uganda-districts,uganda-shapes}.json and prints a report
// (counts per level vs the dataset's stated counts, orphans, duplicates, vintage).
// Deterministic: same input → byte-identical output.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC = process.argv[2];
if (!SRC) throw new Error("usage: node scripts/import-geo.mjs <geojson dir>");
const OUT = new URL("../data/geo/", import.meta.url).pathname;
const EXPECTED = { regions: 4, districts: 135, counties: 203, subcounties: 1520 }; // dataset notes
const TOLERANCE = 0.0005; // degrees (~55 m) — ponytail: Douglas-Peucker per ring, borders may gap by ≤ this
const DECIMALS = 5;

const read = (l) => JSON.parse(readFileSync(join(SRC, `uga_admin${l}.geojson`), "utf8")).features;
const [a1, a2, a3, a4] = [1, 2, 3, 4].map(read);
const round = (n) => Math.round(n * 10 ** DECIMALS) / 10 ** DECIMALS;
const byCode = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

const regions = a1.map((f) => [f.properties.adm1_pcode, f.properties.adm1_name]).sort(byCode);
const districts = a2
  .map((f) => [f.properties.adm2_pcode, f.properties.adm2_name, f.properties.adm1_pcode])
  .sort(byCode);
const counties = a3
  .map((f) => [f.properties.adm3_pcode, f.properties.adm3_name, f.properties.adm2_pcode])
  .sort(byCode);

function simplify(points) {
  // Ramer–Douglas–Peucker on one ring.
  if (points.length <= 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [x1, y1] = points[s];
    const [x2, y2] = points[e];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    let max = 0;
    let at = -1;
    for (let i = s + 1; i < e; i++) {
      // A closed ring starts and ends on the same point: measure from it instead of a zero-length line.
      const d = len
        ? Math.abs(dy * points[i][0] - dx * points[i][1] + x2 * y1 - y2 * x1) / len
        : Math.hypot(points[i][0] - x1, points[i][1] - y1);
      if (d > max) [max, at] = [d, i];
    }
    if (max > TOLERANCE && at > 0) {
      keep[at] = 1;
      stack.push([s, at], [at, e]);
    }
  }
  const out = points.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : points.slice(0, 4);
}

const shapes = {};
const subcounties = a4
  .map((f) => {
    const p = f.properties;
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    // Outer rings only: sub-county holes are other sub-counties, which win on their own polygon.
    const rings = polys.map((poly) => simplify(poly[0]).map(([x, y]) => [round(x), round(y)]));
    let [minX, minY, maxX, maxY] = [180, 90, -180, -90];
    for (const r of rings)
      for (const [x, y] of r) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    shapes[p.adm4_pcode] = { b: [minX, minY, maxX, maxY], r: rings };
    return [p.adm4_pcode, p.adm4_name, p.adm3_pcode];
  })
  .sort(byCode);

// ── Report ────────────────────────────────────────────────────────────────
const report = [];
const counts = { regions, districts, counties, subcounties };
for (const [k, v] of Object.entries(counts))
  report.push(
    `${k}: ${v.length} (dataset states ${EXPECTED[k]})${v.length === EXPECTED[k] ? "" : "  ⚠ MISMATCH"}`,
  );
const codes = (xs) => new Set(xs.map((x) => x[0]));
const orphans = [
  ...districts.filter((d) => !codes(regions).has(d[2])).map((d) => `district ${d[0]} → ${d[2]}`),
  ...counties.filter((c) => !codes(districts).has(c[2])).map((c) => `county ${c[0]} → ${c[2]}`),
  ...subcounties
    .filter((s) => !codes(counties).has(s[2]))
    .map((s) => `subcounty ${s[0]} → ${s[2]}`),
];
report.push(`orphans: ${orphans.length}${orphans.length ? "\n  " + orphans.join("\n  ") : ""}`);
const dup = [];
for (const [k, v] of Object.entries(counts)) if (codes(v).size !== v.length) dup.push(k);
report.push(`duplicate codes: ${dup.length ? dup.join(", ") : "none"}`);
const sameName = {};
for (const s of subcounties) {
  const d = counties.find((c) => c[0] === s[2])[2];
  (sameName[`${d}|${s[1].toLowerCase()}`] ??= []).push(s[0]);
}
const clashes = Object.entries(sameName).filter(([, v]) => v.length > 1);
report.push(
  `same-named sub-counties inside one district: ${clashes.length} (kept; the path tells them apart)`,
);
report.push(`vintage: valid_on ${a2[0].properties.valid_on}, version ${a2[0].properties.version}`);
report.push(
  "cities: the 2020 vintage predates the July 2020 cities — each appears as '<Name> Municipality' (county level) inside its district",
);

const source = {
  dataset: "OCHA COD-AB Uganda (cod-ab-uga) v01 — UBOS boundaries",
  url: "https://data.humdata.org/dataset/cod-ab-uga",
  licence: "CC BY-IGO",
  validOn: a2[0].properties.valid_on,
  retrieved: "2026-09-25",
  tolerance: TOLERANCE,
};
writeFileSync(
  join(OUT, "uganda-admin.json"),
  JSON.stringify({ source, regions, districts, counties, subcounties }),
);
const regionName = Object.fromEntries(regions);
writeFileSync(
  join(OUT, "uganda-districts.json"),
  JSON.stringify(districts.map(([code, name, r]) => [code, name, regionName[r]])),
);
writeFileSync(join(OUT, "uganda-shapes.json"), JSON.stringify(shapes));
console.log(report.join("\n"));
