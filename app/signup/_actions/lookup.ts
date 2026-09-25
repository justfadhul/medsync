"use server";

import type { Place } from "@/lib/geo";
import type { PlaceOption, RegistryOption, ResolvedPlace } from "@/lib/onboarding/types";
import { z } from "zod";

import { getPlace, resolvePoint, searchPlaces } from "@/lib/geo";
import { allow } from "@/lib/onboarding/rate-limit";
import { listDepartments } from "@/lib/reference-data";
import { registryLevelLabel, searchRegistry } from "@/lib/registry";

/*
 * Public lookups for the v2 forms. Rate-limited; nothing here writes or logs what was asked.
 * LOC-7: resolvePlaceAction's coordinates are used once to find an area and dropped — never
 * stored, never logged, never sent anywhere (no third-party geocoder).
 */

const toOption = (p: Place): PlaceOption => ({
  code: p.code,
  name: p.name,
  label: p.label,
  path: p.path,
  level: p.level,
  region: p.region.name,
});

export async function searchPlacesAction(query: unknown): Promise<PlaceOption[]> {
  if (typeof query !== "string" || query.length > 80 || !(await allow("places", 90))) return [];
  return searchPlaces(query).map(toOption);
}

export async function getPlaceAction(code: unknown): Promise<PlaceOption | null> {
  if (typeof code !== "string" || code.length > 12) return null;
  const p = getPlace(code);
  return p ? toOption(p) : null;
}

const Point = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  accuracyM: z.number().finite().min(0).max(1e7),
});

export async function resolvePlaceAction(point: unknown): Promise<ResolvedPlace> {
  if (!(await allow("resolve", 20))) return { ok: false, reason: "busy" };
  const parsed = Point.safeParse(point);
  if (!parsed.success) return { ok: false, reason: "outside" };
  try {
    const r = await resolvePoint(parsed.data.lat, parsed.data.lng, parsed.data.accuracyM);
    return r.ok ? { ok: true, place: toOption(r.place), precision: r.precision } : r;
  } catch {
    // Deliberately silent: an error report would carry the arguments (LOC-7).
    return { ok: false, reason: "outside" };
  }
}

export async function searchRegistryAction(query: unknown): Promise<RegistryOption[]> {
  if (typeof query !== "string" || query.length > 80 || !(await allow("registry", 90))) return [];
  return searchRegistry(query).map((f) => ({
    code: f.code,
    name: f.name,
    levelLabel: registryLevelLabel(f.registryLevel),
    ownership: f.ownership,
    authority: f.authority,
    where: f.where,
    region: f.placeCode ? (getPlace(f.placeCode)?.region.name ?? null) : null,
    placeCode: f.placeCode,
  }));
}

const Uuid = z.string().regex(/^[0-9a-f-]{36}$/i);

export async function departmentsAction(
  hospitalId: unknown,
): Promise<{ id: string; name: string }[]> {
  const parsed = Uuid.safeParse(hospitalId);
  if (!parsed.success || !(await allow("departments", 60))) return [];
  const rows = await listDepartments({ hospitalId: parsed.data });
  return rows.map((d) => ({ id: d.id, name: d.name }));
}
