import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";
import { hospitals } from "./hospitals";

/**
 * Onboarding v2 (0070). facility_locations — set from the hospital's setup checklist (facility
 * coordinates are not personal data). onboarding_events — the PII-free funnel (EV-1..3).
 * Both RLS-first: select policies only; writes go through server actions with the service role.
 */
export const facilityLocations = pgTable(
  "facility_locations",
  {
    hospitalId: uuid("hospital_id")
      .primaryKey()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    accuracyM: integer("accuracy_m"),
    source: text("source").notNull(),
    capturedBy: uuid("captured_by").references(() => authUsers.id, { onDelete: "set null" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedBy: uuid("confirmed_by").references(() => authUsers.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [
    check("facility_locations_lat_check", sql`${t.lat} BETWEEN -2 AND 5`),
    check("facility_locations_lng_check", sql`${t.lng} BETWEEN 29 AND 36`),
    check("facility_locations_source_check", sql`${t.source} IN ('registry','device')`),
  ],
);

export const onboardingEvents = pgTable(
  "onboarding_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    form: text("form").notNull(),
    event: text("event").notNull(),
    section: text("section"),
    fieldKey: text("field_key"),
    errorCode: text("error_code"),
    elapsedMs: integer("elapsed_ms"),
    tabId: uuid("tab_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("onboarding_events_form_created_idx").on(t.form, t.createdAt)],
);

export type FacilityLocation = typeof facilityLocations.$inferSelect;
export type OnboardingEventRow = typeof onboardingEvents.$inferSelect;
