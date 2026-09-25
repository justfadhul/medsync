/* eslint-disable no-console -- CLI script: console output is the UI. */
// Prints the geography data block of an onboarding migration from data/geo/uganda-admin.json
// (scripts/import-geo.mjs). Legacy seed rows (0009) are mapped by exact name, never guessed:
// a name with no single boundary match is retired (hidden from pickers, kept for foreign keys).
//   node scripts/gen-geo-sql.mjs > /tmp/geo.sql
import { readFileSync } from "node:fs";

const geo = JSON.parse(
  readFileSync(new URL("../data/geo/uganda-admin.json", import.meta.url), "utf8"),
);
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const REGION_CODE = Object.fromEntries(
  geo.regions.map(([pcode, name]) => [pcode, name.toUpperCase()]),
);
const districtByName = new Map(geo.districts.map((d) => [d[1], d]));
const countyByCode = new Map(geo.counties.map((c) => [c[0], c]));

// 0009's placeholder districts (code → name) and Kampala's divisions.
const LEGACY_DISTRICTS = {
  KAMPALA: "Kampala",
  WAKISO: "Wakiso",
  MUKONO: "Mukono",
  MPIGI: "Mpigi",
  LUWERO: "Luwero",
  MASAKA: "Masaka",
  JINJA: "Jinja",
  MBALE: "Mbale",
  SOROTI: "Soroti",
  TORORO: "Tororo",
  IGANGA: "Iganga",
  GULU: "Gulu",
  LIRA: "Lira",
  ARUA: "Arua",
  KITGUM: "Kitgum",
  MOROTO: "Moroto",
  MBARARA: "Mbarara",
  KABALE: "Kabale",
  KASESE: "Kasese",
  HOIMA: "Hoima",
  FORT_PORTAL: "Fort Portal",
};
const LEGACY_KAMPALA = {
  KAMPALA_CENTRAL: "Central Division",
  KAWEMPE: "Kawempe Division",
  MAKINDYE: "Makindye Division",
  NAKAWA: "Nakawa Division",
  RUBAGA: "Rubaga Division",
};

const out = [];
const mapped = [];
const retired = [];
for (const [code, name] of Object.entries(LEGACY_DISTRICTS)) {
  const d = districtByName.get(name);
  if (d) mapped.push(`(${q(code)}, ${q(d[0])}, ${q(d[1])}, ${q(REGION_CODE[d[2]])})`);
  else retired.push(code);
}
out.push(
  `-- Legacy districts (0009) → their boundary unit, by exact name: ${mapped.length} mapped, retired: ${retired.join(", ") || "none"}.`,
);
out.push(`UPDATE public.districts d
   SET pcode = v.pcode, name = v.name, region_id = r.id, is_city = (v.pcode = 'UG1008')
  FROM (VALUES
    ${mapped.join(",\n    ")}
  ) AS v(code, pcode, name, region)
  JOIN public.regions r ON r.code = v.region
 WHERE d.code = v.code AND d.pcode IS NULL;`);
if (retired.length)
  out.push(
    `UPDATE public.districts SET retired_at = now() WHERE code IN (${retired.map(q).join(", ")}) AND pcode IS NULL AND retired_at IS NULL;`,
  );

const kampala = geo.districts.find((d) => d[1] === "Kampala")[0];
const kampalaSubs = geo.subcounties.filter((s) => countyByCode.get(s[2])[2] === kampala);
const legacySubs = Object.entries(LEGACY_KAMPALA).map(([code, name]) => {
  const s = kampalaSubs.find((x) => x[1] === name);
  if (!s) throw new Error(`no boundary unit for legacy ${code}`);
  const c = countyByCode.get(s[2]);
  return `(${q(code)}, ${q(s[0])}, ${q(s[1])}, ${q(c[0])}, ${q(c[1])})`;
});
out.push(`-- Legacy Kampala divisions (0009) → boundary units (listed for a human: "Kampala Central Division" is "Central Division").
UPDATE public.subcounties s
   SET pcode = v.pcode, name = v.name, county_pcode = v.county_pcode, county_name = v.county_name
  FROM (VALUES
    ${legacySubs.join(",\n    ")}
  ) AS v(code, pcode, name, county_pcode, county_name)
 WHERE s.code = v.code AND s.pcode IS NULL
   AND s.district_id = (SELECT id FROM public.districts WHERE pcode = 'UG1008');`);

out.push(`-- ${geo.districts.length} districts (COD-AB v01). Rows already mapped above conflict on pcode and are skipped.
INSERT INTO public.districts (region_id, code, name, is_city, pcode)
SELECT r.id, v.pcode, v.name, v.pcode = 'UG1008', v.pcode
  FROM (VALUES
    ${geo.districts.map((d) => `(${q(d[0])}, ${q(d[1])}, ${q(REGION_CODE[d[2]])})`).join(",\n    ")}
  ) AS v(pcode, name, region)
  JOIN public.regions r ON r.code = v.region
ON CONFLICT DO NOTHING;`);

out.push(`-- ${geo.subcounties.length} sub-counties, each with its county.
INSERT INTO public.subcounties (district_id, code, name, pcode, county_pcode, county_name)
SELECT d.id, v.pcode, v.name, v.pcode, v.county_pcode, v.county_name
  FROM (VALUES
    ${geo.subcounties
      .map((s) => {
        const c = countyByCode.get(s[2]);
        return `(${q(s[0])}, ${q(s[1])}, ${q(c[0])}, ${q(c[1])}, ${q(c[2])})`;
      })
      .join(",\n    ")}
  ) AS v(pcode, name, county_pcode, county_name, district_pcode)
  JOIN public.districts d ON d.pcode = v.district_pcode
ON CONFLICT DO NOTHING;`);
console.log(out.join("\n\n"));
