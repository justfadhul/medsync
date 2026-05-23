/**
 * Typed reference-data loaders for onboarding forms.
 *
 * Hits the public ref tables (regions, districts, subcounties,
 * councils, cadres, cadre_grades, specialties, roles) which carry
 * public-read RLS policies (migration 0008) — so they work from
 * both anon (signup pages before login) and authenticated contexts.
 *
 * Each loader returns a stable, sorted list ready to drop into a
 * Combobox / CascadingCombobox. Cascading filters (district →
 * subcounty, council → cadres, cadre → roles, etc.) are passed as
 * optional args.
 *
 * Uses the shared singleton db client at `@/db` so we don't fan
 * out connections per helper.
 */

import "server-only";

import type {
  Cadre,
  CadreGrade,
  Council,
  District,
  Region,
  Role,
  Specialty,
  Subcounty,
} from "@/db/schema/reference-data";
import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  cadreGrades,
  cadres,
  councils,
  districts,
  regions,
  roles,
  specialties,
  subcounties,
} from "@/db/schema/reference-data";

// ─── Geography ─────────────────────────────────────────────────────────

export async function listRegions(): Promise<Region[]> {
  return db.select().from(regions).orderBy(asc(regions.name));
}

export async function listDistricts(opts?: { regionId?: string }): Promise<District[]> {
  const q = db.select().from(districts).orderBy(asc(districts.name));
  if (opts?.regionId) {
    return q.where(eq(districts.regionId, opts.regionId));
  }
  return q;
}

export async function listSubcounties(opts: { districtId: string }): Promise<Subcounty[]> {
  return db
    .select()
    .from(subcounties)
    .where(eq(subcounties.districtId, opts.districtId))
    .orderBy(asc(subcounties.name));
}

// ─── Clinical catalog ──────────────────────────────────────────────────

export async function listCouncils(): Promise<Council[]> {
  return db.select().from(councils).orderBy(asc(councils.name));
}

export async function listCadres(opts?: { councilId?: string }): Promise<Cadre[]> {
  const q = db.select().from(cadres).orderBy(asc(cadres.sortOrder), asc(cadres.name));
  if (opts?.councilId) {
    return q.where(eq(cadres.councilId, opts.councilId));
  }
  return q;
}

export async function listCadreGrades(opts: { cadreId: string }): Promise<CadreGrade[]> {
  return db
    .select()
    .from(cadreGrades)
    .where(eq(cadreGrades.cadreId, opts.cadreId))
    .orderBy(asc(cadreGrades.sortOrder), asc(cadreGrades.name));
}

/**
 * Specialties. By default returns only top-level rows
 * (`parent_id IS NULL`). Pass `parentId` to fetch sub-specialties of
 * a given parent; pass `null` explicitly to force the top-level
 * filter; omit `parentId` entirely to fetch all.
 */
export async function listSpecialties(opts?: { parentId?: string | null }): Promise<Specialty[]> {
  const q = db.select().from(specialties).orderBy(asc(specialties.name));
  if (opts && opts.parentId !== undefined) {
    return q.where(
      opts.parentId === null
        ? isNull(specialties.parentId)
        : eq(specialties.parentId, opts.parentId),
    );
  }
  return q;
}

export async function listRoles(opts?: {
  cadreId?: string;
  specialtyId?: string;
  departmentFamily?: string;
}): Promise<Role[]> {
  const wheres = [];
  if (opts?.cadreId) wheres.push(eq(roles.cadreId, opts.cadreId));
  if (opts?.specialtyId) wheres.push(eq(roles.specialtyId, opts.specialtyId));
  if (opts?.departmentFamily) wheres.push(eq(roles.departmentFamily, opts.departmentFamily));

  const q = db.select().from(roles).orderBy(asc(roles.sortOrder), asc(roles.name));

  if (wheres.length === 0) return q;
  return q.where(wheres.length === 1 ? wheres[0]! : and(...wheres));
}
