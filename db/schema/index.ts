/**
 * Drizzle schema barrel. Tables ship in Phase 0.4 (this file); RLS policies
 * in 0.5; audit triggers in 0.6; encryption columns in Phase 1+.
 */

export * from "./_auth";
export * from "./users";
export * from "./hospitals";
export * from "./hospital-departments";
export * from "./user-roles";
export * from "./consent-records";
export * from "./audit-log";
