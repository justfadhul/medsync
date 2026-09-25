import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Reference data layer (kickoff GATE A §D).
 *
 * Nine tables — provenance log + 3 geography + 5 clinical catalog.
 *
 * Seeded from authoritative origins, versioned in
 * `reference_data_versions`. Public-read RLS (forms hit these
 * pre-auth). Mutations through migrations only.
 *
 * Form behaviour:
 *   - District = searchable combobox (130+ items)
 *   - Subcounty = cascading combobox filtered by selected district
 *   - Council = select (4 items)
 *   - Cadre = select filtered by selected council
 *   - Role = select filtered by cadre + specialty
 *   - Specialty = self-referential (parent_id for sub-specialties)
 */

// ─── Provenance log ─────────────────────────────────────────────────────

export const referenceDataVersions = pgTable(
  "reference_data_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** e.g. "ug_districts_nphc_2024", "councils", "cadres" */
    dataset: text("dataset").notNull(),
    /** e.g. "UBOS NPHC 2024 framework" */
    source: text("source").notNull(),
    sourceUrl: text("source_url"),
    /** ISO date of the upstream release */
    versionDate: text("version_date").notNull(),
    rowCount: integer("row_count"),
    /** Free-text caveats (placeholders, regulator-name flags). */
    notes: text("notes"),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reference_data_versions_unique").on(t.dataset, t.versionDate),
    index("reference_data_versions_dataset_idx").on(t.dataset),
  ],
);

// ─── Geography (regions → districts → subcounties) ─────────────────────

export const regions = pgTable(
  "regions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("regions_code_unique").on(t.code)],
);

export const districts = pgTable(
  "districts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    regionId: uuid("region_id")
      .notNull()
      .references(() => regions.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** True for the 11 cities elevated to district-equivalent status. */
    isCity: boolean("is_city").notNull().default(false),
    /** UBOS pcode (COD-AB v01, 0070). Null only on retired placeholder rows. */
    pcode: text("pcode"),
    /** Placeholder rows with no single boundary match (0070: Fort Portal) — hidden from pickers. */
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("districts_code_unique").on(t.code),
    uniqueIndex("districts_pcode_key").on(t.pcode),
    index("districts_region_idx").on(t.regionId),
    index("districts_name_idx").on(t.name),
  ],
);

export const subcounties = pgTable(
  "subcounties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    districtId: uuid("district_id")
      .notNull()
      .references(() => districts.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** UBOS pcode and the county it sits in (COD-AB v01, 0070). */
    pcode: text("pcode"),
    countyPcode: text("county_pcode"),
    countyName: text("county_name"),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("subcounties_district_code_unique").on(t.districtId, t.code),
    uniqueIndex("subcounties_pcode_key").on(t.pcode),
    index("subcounties_district_idx").on(t.districtId),
  ],
);

// ─── Clinical catalog (councils → cadres → grades + roles + specialties) ─

export const councils = pgTable(
  "councils",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** e.g. "UMDPC", "UNMC", "AHPC", "PHARM_BOARD" */
    code: text("code").notNull(),
    name: text("name").notNull(),
    shortName: text("short_name").notNull(),
    /** Optional URL to the council's public register / verifier. */
    registerUrl: text("register_url"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("councils_code_unique").on(t.code)],
);

export const cadres = pgTable(
  "cadres",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable since migration 0033 — non-clinical cadres (reception)
    // have no national regulator.
    councilId: uuid("council_id").references(() => councils.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    // is_clinical added in migration 0033. Defaults true for existing
    // 19 clinical cadres; reception cadre is false. The clinical-
    // content RLS policies require cadres.is_clinical = true on the
    // active affiliation, so non-clinical cadres cannot read clinical
    // tables even with a valid hospital affiliation.
    isClinical: boolean("is_clinical").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cadres_code_unique").on(t.code),
    index("cadres_council_idx").on(t.councilId),
  ],
);

export const cadreGrades = pgTable(
  "cadre_grades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cadreId: uuid("cadre_id")
      .notNull()
      .references(() => cadres.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cadre_grades_cadre_code_unique").on(t.cadreId, t.code),
    index("cadre_grades_cadre_idx").on(t.cadreId),
  ],
);

export const specialties = pgTable(
  "specialties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => specialties.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("specialties_code_unique").on(t.code),
    index("specialties_parent_idx").on(t.parentId),
  ],
);

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cadreId: uuid("cadre_id")
      .notNull()
      .references(() => cadres.id, { onDelete: "restrict" }),
    specialtyId: uuid("specialty_id").references(() => specialties.id, {
      onDelete: "set null",
    }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** e.g. "INTERNAL_MEDICINE" — used by the affiliation form to filter by selected hospital department. */
    departmentFamily: text("department_family").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("roles_code_unique").on(t.code),
    index("roles_cadre_idx").on(t.cadreId),
    index("roles_specialty_idx").on(t.specialtyId),
    index("roles_dept_family_idx").on(t.departmentFamily),
  ],
);

// ─── Type exports ──────────────────────────────────────────────────────

export type ReferenceDataVersion = typeof referenceDataVersions.$inferSelect;
export type Region = typeof regions.$inferSelect;
export type District = typeof districts.$inferSelect;
export type Subcounty = typeof subcounties.$inferSelect;
export type Council = typeof councils.$inferSelect;
export type Cadre = typeof cadres.$inferSelect;
export type CadreGrade = typeof cadreGrades.$inferSelect;
export type Specialty = typeof specialties.$inferSelect;
export type Role = typeof roles.$inferSelect;
