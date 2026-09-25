import "server-only";

import registry from "@/data/registry/nhfr-facilities.json";
import { getPlace, normalise } from "@/lib/geo";

/**
 * Facility registry (Onboarding v2, ADR 0122) — the MoH National Health Facility Registry's public
 * list, imported by scripts/import-registry.mjs. Read-only reference data that ships with the
 * server (REG-1): clients search it; the server copies a pick's facts (REG-3).
 */

export type FacilityLevel =
  | "hc_ii"
  | "hc_iii"
  | "hc_iv"
  | "general"
  | "regional_referral"
  | "national_referral"
  | "private"
  | "other";
export type Ownership = "public_moh" | "private" | "pnfp" | "private_clinic";

type Raw = [
  code: string,
  name: string,
  registryLevel: string,
  level: FacilityLevel | null,
  ownership: Ownership | null,
  authority: string,
  district: string | null,
  subcounty: string | null,
  registryDistrict: string,
  registrySubcounty: string,
];

export interface RegistryFacility {
  code: string;
  name: string;
  /** As the registry writes it: "HC IV", "RRH", "Clinic"… */
  registryLevel: string;
  level: FacilityLevel;
  ownership: Ownership;
  /** The registry's authority — for PNFP facilities, the bureau (UCMB, UPMB, UMMB…). */
  authority: string;
  /** Lowest place the crosswalk reached (sub-county, else district); null when unmatched. */
  placeCode: string | null;
  /** "Kawempe Division, Kampala · Central region", or the registry's own district when unmatched. */
  where: string;
}

const LEVEL_WORDS: Record<string, string> = {
  "HC II": "Health Centre II",
  "HC III": "Health Centre III",
  "HC IV": "Health Centre IV",
  "General Hospital": "General hospital",
  RRH: "Regional referral hospital",
  NRH: "National referral hospital",
  Clinic: "Clinic",
};
export const registryLevelLabel = (l: string) => LEVEL_WORDS[l] ?? l;

function toFacility(r: Raw): RegistryFacility {
  const place = getPlace(r[7] ?? r[6] ?? "");
  // REG-6: the catalogue has no clinic level — a PFP clinic is "Private hospital / clinic", any other "Other".
  const ownership = r[4] ?? "private";
  const level = r[3] ?? (ownership === "private" ? "private" : "other");
  return {
    code: r[0],
    name: r[1],
    registryLevel: r[2],
    level,
    ownership,
    authority: r[5],
    placeCode: place?.code ?? null,
    where: place ? `${place.label} · ${place.region.name} region` : r[8],
  };
}

const facilities = (registry.facilities as Raw[]).map(toFacility);
const byCode = new Map(facilities.map((f) => [f.code, f]));
const index = facilities.map((f) => ({ f, key: normalise(f.name) }));

export function getRegistryFacility(code: string): RegistryFacility | null {
  return byCode.get(code) ?? null;
}

const HOSPITAL_FIRST: Record<string, number> = {
  NRH: 0,
  RRH: 1,
  "General Hospital": 2,
  "HC IV": 3,
};

export function searchRegistry(query: string, limit = 8): RegistryFacility[] {
  const q = normalise(query);
  if (q.length < 2) return [];
  const tokens = q.split(" ");
  const hits: { f: RegistryFacility; score: number }[] = [];
  for (const { f, key } of index) {
    let score = -1;
    if (key.startsWith(q)) score = 0;
    else if (tokens.every((t) => key.split(" ").some((w) => w.startsWith(t)))) score = 1;
    else if (key.includes(q)) score = 2;
    if (score >= 0) hits.push({ f, score });
  }
  hits.sort(
    (a, b) =>
      a.score - b.score ||
      (HOSPITAL_FIRST[a.f.registryLevel] ?? 9) - (HOSPITAL_FIRST[b.f.registryLevel] ?? 9) ||
      a.f.name.localeCompare(b.f.name),
  );
  return hits.slice(0, limit).map((h) => h.f);
}

/** PNFP bureaus as the registry itself records them (for the manual path's bureau question). */
export const PNFP_BUREAUS = [
  ...new Set((registry.facilities as Raw[]).filter((r) => r[4] === "pnfp").map((r) => r[5])),
]
  .filter((a) => a && a !== "Private Authority")
  .sort();

export const REGISTRY_SOURCE = registry.source;
