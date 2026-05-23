/**
 * Drizzle schema barrel.
 *
 * Phase 0: foundation tables + RLS + audit infrastructure.
 * Phase 1 onboarding (GATE A+): consent_versions, reference data
 * layer, signup_drafts. Per-gate domain tables (clinician_profiles,
 * staff_affiliations, patient_profiles, queue_tickets, hospital_leads,
 * hospital_applications, sa_audit_log) ship with their gates.
 */

// ─── Phase 0 ────────────────────────────────────────────────────────────
export * from "./_auth";
export * from "./users";
export * from "./hospitals";
export * from "./hospital-departments";
export * from "./user-roles";
export * from "./consent-records";
export * from "./audit-log";

// ─── Onboarding GATE A ──────────────────────────────────────────────────
export * from "./consent-versions";
export * from "./reference-data";
export * from "./signup-drafts";

// ─── Onboarding GATE C (patient signup) ─────────────────────────────────
export * from "./patient-profiles";

// ─── Onboarding GATE D (clinical staff signup) ──────────────────────────
export * from "./clinician-profiles";
