import "server-only";

import admin from "@/data/geo/uganda-admin.json";

/**
 * Location engine (Onboarding v2, ADR 0121). Uganda's administrative units from OCHA COD-AB v01
 * (UBOS boundaries, valid 2020-08-24): region → district → county → sub-county.
 *
 * LOC-1  a place's region is derived from its district, never chosen.
 * LOC-3  a record stores one unit (the lowest chosen); ancestors are derived.
 * LOC-5  search: prefix first, then words across the path, then contains; ties to the higher level.
 * LOC-6  reverse geocoding: bbox prefilter + point-in-polygon; outside Uganda returns nothing.
 * LOC-7  coordinates are never stored or logged here — callers must not log them either.
 */

export type PlaceLevel = "district" | "subcounty";

export interface Place {
  /** UBOS pcode — the one value a form submits. */
  code: string;
  name: string;
  level: PlaceLevel;
  /** "Kawempe Division, Kampala" — the whole place in one line. */
  label: string;
  /** The ancestors shown under a result: "KCCA · Kampala · Central region". */
  path: string;
  county: string | null;
  district: { code: string; name: string };
  region: { code: string; name: string };
}

type Row = [code: string, name: string, parent: string];

const regionByCode = new Map((admin.regions as [string, string][]).map(([c, n]) => [c, n]));
const districtByCode = new Map((admin.districts as Row[]).map((d) => [d[0], d]));
const countyByCode = new Map((admin.counties as Row[]).map((c) => [c[0], c]));

/** Kampala is the capital city, not a district; every other district-level unit here is a district. */
const districtLabel = (name: string) => (name === "Kampala" ? "Kampala" : `${name} District`);

function districtPlace([code, name, region]: Row): Place {
  const regionName = regionByCode.get(region)!;
  return {
    code,
    name: districtLabel(name),
    level: "district",
    label: districtLabel(name),
    path: `${regionName} region`,
    county: null,
    district: { code, name },
    region: { code: region, name: regionName },
  };
}

function subcountyPlace([code, name, countyCode]: Row): Place {
  const county = countyByCode.get(countyCode)!;
  const d = districtPlace(districtByCode.get(county[2])!);
  // A county that just repeats the sub-county or district name adds nothing to the path.
  const showCounty = county[1] !== name && county[1] !== d.district.name;
  return {
    code,
    name,
    level: "subcounty",
    label: `${name}, ${d.district.name}`,
    path: [showCounty ? county[1] : null, d.label, d.path].filter(Boolean).join(" · "),
    county: county[1],
    district: d.district,
    region: d.region,
  };
}

const places = new Map<string, Place>();
for (const d of admin.districts as Row[]) places.set(d[0], districtPlace(d));
for (const s of admin.subcounties as Row[]) places.set(s[0], subcountyPlace(s));

export function getPlace(code: string): Place | null {
  return places.get(code) ?? null;
}

// ── Search ────────────────────────────────────────────────────────────────

export const normalise = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Words people add that the unit names don't carry. */
const FILLER = new Set(["district", "subcounty", "sub", "county", "parish", "village", "uganda"]);
/**
 * The ten cities created on 1 July 2020 (Local Governments (Amendment) Act; Parliament of Uganda, 2019).
 * The 2020 boundary vintage still holds each as "<Name> Municipality", so "Gulu city" searches that.
 */
const CITIES = new Set([
  "arua",
  "fort portal",
  "gulu",
  "hoima",
  "jinja",
  "lira",
  "masaka",
  "mbale",
  "mbarara",
  "soroti",
]);

interface Entry {
  place: Place;
  name: string;
  words: string[];
}
const entries: Entry[] = [...places.values()].map((place) => ({
  place,
  name: normalise(place.level === "district" ? place.district.name : place.name),
  words: normalise(`${place.name} ${place.county ?? ""} ${place.district.name}`).split(" "),
}));

export const SEARCH_LIMIT = 8;

export function searchPlaces(query: string): Place[] {
  let q = normalise(query);
  for (const city of CITIES)
    q = q.replace(new RegExp(`\\b${city} city\\b`), `${city} municipality`);
  const tokens = q.split(" ").filter((t) => t && !FILLER.has(t));
  if (tokens.join("").length < 2) return [];
  const phrase = tokens.join(" ");

  const scored: { e: Entry; score: number }[] = [];
  for (const e of entries) {
    let score = -1;
    if (e.name.startsWith(phrase)) score = 0;
    else if (e.name.split(" ").some((w) => w.startsWith(phrase))) score = 1;
    else if (tokens.every((t) => e.words.some((w) => w.startsWith(t)))) score = 2;
    else if (e.name.includes(phrase)) score = 3;
    if (score >= 0) scored.push({ e, score });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      (a.e.place.level === b.e.place.level ? 0 : a.e.place.level === "district" ? -1 : 1) ||
      a.e.place.name.localeCompare(b.e.place.name),
  );
  return scored.slice(0, SEARCH_LIMIT).map((s) => s.e.place);
}

// ── Reverse geocoding ─────────────────────────────────────────────────────

type Shapes = Record<string, { b: [number, number, number, number]; r: [number, number][][] }>;
let shapes: Promise<Shapes> | null = null;
// Lazy: 2.8 MB of sub-county outlines load only when someone taps "Use my location".
const loadShapes = () =>
  (shapes ??= import("@/data/geo/uganda-shapes.json").then((m) => m.default as unknown as Shapes));

function inRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToRing(x: number, y: number, ring: [number, number][]): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j]!;
    const [x2, y2] = ring[i]!;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const t =
      dx || dy
        ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
        : 0;
    best = Math.min(best, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)));
  }
  return best;
}

/** Simplified borders can leave slivers between sub-counties; a point that close takes the nearest. */
const GAP_DEGREES = 0.009; // ≈ 1 km

export const ACCURACY = { subcounty: 2_000, district: 20_000 } as const;

export type ResolveResult =
  | { ok: true; place: Place; precision: PlaceLevel }
  | { ok: false; reason: "outside" | "imprecise" };

/** LOC-6. Returns the lowest unit the accuracy allows; nothing outside Uganda or past 20 km. */
export async function resolvePoint(
  lat: number,
  lng: number,
  accuracyM: number,
): Promise<ResolveResult> {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !Number.isFinite(accuracyM) ||
    accuracyM < 0
  )
    return { ok: false, reason: "outside" };
  if (accuracyM > ACCURACY.district) return { ok: false, reason: "imprecise" };
  const all = await loadShapes();
  let hit: string | null = null;
  let near: { code: string; d: number } | null = null;
  for (const [code, s] of Object.entries(all)) {
    const [minX, minY, maxX, maxY] = s.b;
    if (
      lng < minX - GAP_DEGREES ||
      lng > maxX + GAP_DEGREES ||
      lat < minY - GAP_DEGREES ||
      lat > maxY + GAP_DEGREES
    )
      continue;
    if (
      lng >= minX &&
      lng <= maxX &&
      lat >= minY &&
      lat <= maxY &&
      s.r.some((r) => inRing(lng, lat, r))
    ) {
      hit = code;
      break;
    }
    const d = Math.min(...s.r.map((r) => distanceToRing(lng, lat, r)));
    if (d <= GAP_DEGREES && (!near || d < near.d)) near = { code, d };
  }
  const code = hit ?? near?.code;
  if (!code) return { ok: false, reason: "outside" };
  const sub = getPlace(code)!;
  return accuracyM <= ACCURACY.subcounty
    ? { ok: true, place: sub, precision: "subcounty" }
    : { ok: true, place: getPlace(sub.district.code)!, precision: "district" };
}

export const GEO_SOURCE = admin.source;
