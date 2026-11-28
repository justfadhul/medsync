import "server-only";

import type { PharmacyShellPayload } from "../_components/shell";
import type { EmrDb } from "@/lib/emr/db";
import { cookies } from "next/headers";

import { db } from "@/db";
import { overridesOn } from "@/lib/boot-guard";
import { POINT_COOKIE } from "@/lib/pharmacy/actor";
import { demoDataLoaded } from "@/lib/pharmacy/demo";
import { pharmacyTiersFor } from "@/lib/pharmacy/feature";
import { PAGES } from "@/lib/pharmacy/ia";
import { actingPoint, pharmacyPointsFor } from "@/lib/pharmacy/points";
import { pointIsLive } from "@/lib/pharmacy/review/load";
import { requirePharmacyScope } from "@/lib/pharmacy/scope";

/**
 * The shell's payload (rework PRD §3): who, where, which pages the tiers switch on, and the bands. Reads only what
 * the shell draws; each page loads its own data, and the counts come with Today's work list.
 */
export async function shellPayload(): Promise<PharmacyShellPayload | null> {
  const scope = await requirePharmacyScope();
  const tiers = pharmacyTiersFor(scope.hospitalId);
  if (!tiers.core) return null;
  const [points, demo, jar] = await Promise.all([
    pharmacyPointsFor(db as unknown as EmrDb, scope.userId, scope.hospitalId),
    demoDataLoaded(db as unknown as EmrDb, scope.hospitalId),
    cookies(),
  ]);
  const acting = points.length ? actingPoint(points, jar.get(POINT_COOKIE)?.value) : null;
  const name = scope.fullName ?? scope.userEmail ?? scope.cadreName;
  const initials =
    name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "·";
  return {
    hospitalId: scope.hospitalId,
    userId: scope.userId,
    hospitalName: scope.hospitalName,
    userName: name,
    initials,
    pages: PAGES.filter((p) => tiers[p.tier]).map((p) => p.key),
    points: points.map((p) => ({ id: p.id, name: p.name, live: pointIsLive(p) })),
    pointId: acting?.id ?? null,
    overrides: overridesOn(),
    demo,
    counts: {},
  };
}
