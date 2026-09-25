/* eslint-disable no-console -- CLI script: console output is the UI. */
// Repeatable import of the MoH National Health Facility Registry (Onboarding v2, REG-1/2/6).
//
// Source: the registry's public facility list, https://nhfr.health.go.ug/master-facility-list
// (the page's own API: GET /api/v1/facilities/public?page=N&page_size=100).
//   node scripts/import-registry.mjs            # fetch live (politely, 69 pages)
//   node scripts/import-registry.mjs raw.json   # re-run the crosswalk on a saved fetch
// Needs data/geo/uganda-admin.json (scripts/import-geo.mjs) for the district crosswalk.
// Writes data/registry/nhfr-facilities.json and prints a report: counts, mapped levels and
// ownership, and every row whose district or sub-county did not match (reported, not guessed).
import { readFileSync, writeFileSync } from "node:fs";

const API = "https://nhfr.health.go.ug/api/v1/facilities/public";
const OUT = new URL("../data/registry/nhfr-facilities.json", import.meta.url).pathname;
const geo = JSON.parse(
  readFileSync(new URL("../data/geo/uganda-admin.json", import.meta.url), "utf8"),
);

async function fetchAll() {
  const rows = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${API}?page=${page}&page_size=100`, {
      headers: {
        "user-agent": "MedSync registry import (hello@medsync.health)",
        accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`page ${page}: HTTP ${res.status}`);
    const body = await res.json();
    rows.push(...body.data);
    if (page >= body.pagination.total_pages) return rows;
    await new Promise((r) => setTimeout(r, 300));
  }
}
const raw = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], "utf8")) : await fetchAll();

// REG-6: registry vocabularies → the application's catalogues. Anything else is reported.
const LEVEL = {
  "HC II": "hc_ii",
  "HC III": "hc_iii",
  "HC IV": "hc_iv",
  "General Hospital": "general",
  RRH: "regional_referral",
  NRH: "national_referral",
};
const OWNERSHIP = { GOV: "public_moh", PFP: "private", PNFP: "pnfp" };

const norm = (s) =>
  (s ?? "")
    .toLowerCase()
    .replace(/\b(district|sub[\s-]?county|subcounty)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const districtByName = new Map(geo.districts.map(([code, name]) => [norm(name), code]));
// Reviewed spelling variants only (one registry name ↔ one boundary name). Districts created after
// the 2020 boundary vintage (e.g. Terego, from Arua) are NOT aliased: they stay unmatched and reported.
const ALIASES = { sembabule: "ssembabule" };
for (const [from, to] of Object.entries(ALIASES)) districtByName.set(from, districtByName.get(to));
// The registry has the July 2020 cities as districts; the 2020 boundary vintage keeps each as
// "<Name> Municipality" inside its district — so a city maps to the district holding that county.
const cityDistrict = new Map(
  geo.counties
    .filter(([, name]) => name.endsWith(" Municipality"))
    .map(([, name, district]) => [norm(name.replace(/ Municipality$/, "")), district]),
);
const countyDistrict = new Map(geo.counties.map(([code, , district]) => [code, district]));
const subcountyIndex = new Map(); // `${district}|${name}` → code
for (const [code, name, county] of geo.subcounties)
  subcountyIndex.set(`${countyDistrict.get(county)}|${norm(name)}`, code);

const report = {
  rows: raw.length,
  levels: {},
  ownership: {},
  unmatchedDistrict: [],
  unmatchedSubcounty: 0,
};
const facilities = [];
for (const r of raw) {
  const dn = r.district_name ?? "";
  const district = dn.endsWith(" City")
    ? cityDistrict.get(norm(dn.slice(0, -5)))
    : districtByName.get(norm(dn));
  const subcounty = district
    ? subcountyIndex.get(`${district}|${norm(r.subcounty_name)}`)
    : undefined;
  if (!district) report.unmatchedDistrict.push(`${r.nhfr_identifier} ${r.name} — "${dn}"`);
  else if (!subcounty) report.unmatchedSubcounty++;
  const level = LEVEL[r.level_code] ?? null;
  const ownership = OWNERSHIP[r.ownership_code] ?? null;
  report.levels[`${r.level_code} → ${level ?? "UNMAPPED"}`] =
    (report.levels[`${r.level_code} → ${level ?? "UNMAPPED"}`] ?? 0) + 1;
  report.ownership[`${r.ownership_code} → ${ownership ?? "UNMAPPED"}`] =
    (report.ownership[`${r.ownership_code} → ${ownership ?? "UNMAPPED"}`] ?? 0) + 1;
  // Compact row: [code, name, registryLevel, level|null, ownership|null, authority, district pcode|null,
  //               sub-county pcode|null, registry district, registry sub-county]
  facilities.push([
    r.nhfr_identifier,
    r.name.trim(),
    r.level_code,
    level,
    ownership,
    r.authority_name ?? "",
    district ?? null,
    subcounty ?? null,
    dn,
    r.subcounty_name ?? "",
  ]);
}
facilities.sort((a, b) => (a[0] < b[0] ? -1 : 1));
const matched = raw.length - report.unmatchedDistrict.length;
writeFileSync(
  OUT,
  JSON.stringify({
    source: {
      dataset: "MoH National Health Facility Registry — public master facility list",
      url: "https://nhfr.health.go.ug/master-facility-list",
      retrieved: new Date().toISOString().slice(0, 10),
      rows: raw.length,
    },
    facilities,
  }),
);
console.log(`rows: ${raw.length}`);
console.log(`district matched: ${matched} (${((100 * matched) / raw.length).toFixed(2)}%)`);
console.log(
  `sub-county matched: ${matched - report.unmatchedSubcounty} (${((100 * (matched - report.unmatchedSubcounty)) / raw.length).toFixed(1)}%)`,
);
console.log("levels:", report.levels);
console.log("ownership:", report.ownership);
console.log(
  `unmatched districts (${report.unmatchedDistrict.length}):\n  ${report.unmatchedDistrict.join("\n  ")}`,
);
