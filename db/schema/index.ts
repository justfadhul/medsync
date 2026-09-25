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

// ─── Onboarding GATE E (hospital onboarding) ────────────────────────────
export * from "./hospital-applications";

// ─── Onboarding GATE F (approvals + superadmin audit) ───────────────────
export * from "./sa-audit-log";

// ─── Superadmin workspace (migration 0018) ──────────────────────────────
export * from "./sa-pending-approvals";
export * from "./sa-break-glass-grants";
export * from "./sa-notifications";

// ─── Hospital registration upgrade (migrations 0020–0023) ──────────────
export * from "./hospital-dpa-versions";
export * from "./hospital-agreements";
export * from "./hospital-wards";
export * from "./hospital-admin-roster";
export * from "./hospital-staff-invitations";
export * from "./hospital-application-departments";
export * from "./hospital-application-specialties";

// ─── Scheduling, Appointments & Booking (migration 0028) ───────────────
export * from "./scheduling";

// ─── Symptom catalog + Emergency Pathway (migration 0066, ADR 0098) ────
export * from "./emergency";

// ─── Patient self-tracking (migration 0029) ────────────────────────────
export * from "./patient-self-tracking";

// ─── Doctor workspace (migration 0030) ─────────────────────────────────
export * from "./doctor-workspace";

// ─── Nurse workspace (migration 0031) ──────────────────────────────────
export * from "./nurse-workspace";

// ─── Patient entry points (migration 0032) ─────────────────────────────
export * from "./patient-intakes";

// ─── Non-clinical staff identity (migration 0034) ──────────────────────
export * from "./staff-identity-profiles";

// ─── Smart triage engine (migration 0036) ──────────────────────────────
export * from "./triage";

// ─── ABCDE resuscitation surface (migration 0038) ──────────────────────
export * from "./resus";

// ─── Smart prescribing (migration 0039 — GATED, see prescribing.ts) ────
export * from "./prescribing";

// ─── Encounter / EMR engine + clerkship (migration 0040 — GATED) ───────
export * from "./encounter";

// ─── Clinical code reference: ICD-10 + LOINC (migration 0041 — GATED) ───
export * from "./clinical-codes";

// ─── Clerkship symptom-capture engine (migration 0042 — GATED) ─────────
export * from "./symptom-catalog";

// ─── Clerkship history-section pick-lists (migration 0046 — GATED) ──────
export * from "./clerkship-picklist";

// ─── Clerkship working-draft autosave (migration 0048 — GATED) ─────────
export * from "./clerkship-drafts";

// ─── Visit ratings (migration 0056 — GATED, ADR 0085) ───────────────────
export * from "./visit-ratings";

// ─── Capacity model: service lines + sessions (migration 0058 — GATED, ADR 0087)
export * from "./service-lines";
export * from "./provisional-patients";
export * from "./clinic-sessions";

// ─── Notifications + waitlist (migration 0061 — GATED, ADR 0090) ────────
export * from "./notifications";

// ─── Low-bandwidth channels (migration 0062 — GATED, ADR 0091) ──────────
export * from "./channels";
export * from "./onboarding";
