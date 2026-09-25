import { DEPARTMENT_GROUPS } from "@/app/signup/hospital/_lib/catalog";

/*
 * Setup checklist rules (§5.10) — pure, so tests/onboarding-v2/setup.test.ts can hold them.
 * No DB, no React: the page derives state from rows, the actions write rows.
 */

/** What every checklist action returns to its form. */
export type StepState = { ok?: true; error?: string; link?: string };

/** Mirror of `slugify` in supabase/functions/approve-hospital-application (don't drift). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Mirror of `departmentSlug` in approve-hospital-application: INTERNAL_MEDICINE → internal-medicine. */
export const departmentSlug = (code: string) => code.toLowerCase().replace(/_/g, "-");

/** The old wizard wrote internal_medicine; read it as the same department as internal-medicine. */
export const normaliseSlug = (slug: string) => slug.replace(/_/g, "-");

export const CATALOG = DEPARTMENT_GROUPS.flatMap((g) => g.items);
export const IM_CODE = "INTERNAL_MEDICINE";
const IM_SLUG = departmentSlug(IM_CODE);
const LABEL = new Map(CATALOG.map((d) => [d.code, d.label]));
const CODE_BY_SLUG = new Map(CATALOG.map((d) => [departmentSlug(d.code), d.code]));

export const departmentLabel = (code: string) => LABEL.get(code) ?? code;
export const catalogCodeForSlug = (slug: string) => CODE_BY_SLUG.get(normaliseSlug(slug)) ?? null;

/** "Where you'll start" offers only the ticked departments, in catalogue order. */
export function startChoices(ticked: Iterable<string>) {
  const set = new Set(ticked);
  return CATALOG.filter((d) => set.has(d.code));
}

/* ─── Departments: what to insert and delete for one save ───────────── */

export interface DepartmentRow {
  id: string;
  parentId: string | null;
  slug: string;
}
export interface Desired {
  slug: string;
  name: string;
}

/**
 * Diff the hospital's rows against the form. Top-level rows match on the normalised slug; IM
 * sub-specialties are the children of any Internal Medicine row. Rows under other parents are left
 * alone. Deleting Internal Medicine takes its children with it (FK cascade).
 */
export function planDepartments(
  existing: ReadonlyArray<DepartmentRow>,
  top: ReadonlyArray<Desired>,
  subs: ReadonlyArray<Desired>,
) {
  const topRows = existing.filter((r) => r.parentId === null);
  const imIds = new Set(topRows.filter((r) => normaliseSlug(r.slug) === IM_SLUG).map((r) => r.id));
  const children = existing.filter((r) => r.parentId !== null && imIds.has(r.parentId));

  const haveTop = new Set(topRows.map((r) => normaliseSlug(r.slug)));
  const wantTop = new Set(top.map((d) => d.slug));
  const haveSub = new Set(children.map((r) => r.slug));
  const wantSub = new Set(subs.map((d) => d.slug));

  return {
    insertTop: top.filter((d) => !haveTop.has(d.slug)),
    insertSubs: subs.filter((d) => !haveSub.has(d.slug)),
    deleteIds: [
      ...topRows.filter((r) => !wantTop.has(normaliseSlug(r.slug))).map((r) => r.id),
      ...children.filter((r) => !wantSub.has(r.slug)).map((r) => r.id),
    ],
  };
}

/** The Internal Medicine row sub-specialties hang off (the hyphenated one when a legacy twin exists). */
export function imParentId(rows: ReadonlyArray<DepartmentRow>): string | null {
  const im = rows.filter((r) => r.parentId === null && normaliseSlug(r.slug) === IM_SLUG);
  return (im.find((r) => r.slug === IM_SLUG) ?? im[0])?.id ?? null;
}

/* ─── Needed to go live (D17) ───────────────────────────────────────── */

export interface NeededFacts {
  departments: number;
  /** A start department is chosen among the confirmed ones (or can't be stored: no application). */
  startChosen: boolean;
  backup: boolean;
  wards: number;
}

export function neededTasks(f: NeededFacts) {
  return {
    departments: f.departments > 0 && f.startChosen,
    backup: f.backup,
    wards: f.wards > 0,
  };
}

export const countDone = (tasks: Record<string, boolean>) =>
  Object.values(tasks).filter(Boolean).length;

/* ─── Facility location ─────────────────────────────────────────────── */

export const MAX_FACILITY_ACCURACY_M = 200;

/**
 * A device point is kept only when it is precise (≤ 200 m) and inside the facility's district.
 * `resolvedDistrict` is lib/geo's resolvePoint(...).place.district.code (null when it found none).
 */
export function facilityPointVerdict(
  accuracyM: number,
  resolvedDistrict: string | null,
  facilityDistrict: string | null,
): "ok" | "imprecise" | "outside" {
  if (!(accuracyM >= 0 && accuracyM <= MAX_FACILITY_ACCURACY_M)) return "imprecise";
  if (!resolvedDistrict || !facilityDistrict || resolvedDistrict !== facilityDistrict) {
    return "outside";
  }
  return "ok";
}
