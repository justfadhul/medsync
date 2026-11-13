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
export * from "./patient-places";
export * from "./appointment-attachments";
export * from "./patient-self-tracking";

// ─── Doctor workspace (migration 0030) ─────────────────────────────────
export * from "./doctor-workspace";

// ─── Nurse workspace (migration 0031) ──────────────────────────────────
export * from "./nurse-workspace";

// ─── Patient entry points (migration 0032) ─────────────────────────────
export * from "./patient-intakes";
export * from "./reception-desk";

// ─── Non-clinical staff identity (migration 0034) ──────────────────────
export * from "./staff-identity-profiles";

// ─── Smart triage engine (migration 0036) ──────────────────────────────
export * from "./triage";

// ─── ABCDE resuscitation surface (migration 0038) ──────────────────────
export * from "./resus";

// ─── Smart prescribing (migration 0039 — GATED, see prescribing.ts) ────
export * from "./prescribing";
// ─── Quick protocols (migration 0282 — GATED, prescribing kit P3) ────
export * from "./protocols";

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

// ─── Departments & services hub (migration 0080 — GATED, ADRs 0150–0160) ─
export * from "./services-hub";

// ─── Tester feedback (/feedback, migration 0081) ─────────────────────────
export * from "./tester-feedback";

// ─── EMR record spine (migration 0071 — GATED, HARMONISATION §3) ────────
export * from "./emr";

// ─── Clerking desk v2 (migration 0076 — GATED) ──────────────────────────
export * from "./clerking";

// ─── Monitoring charts opened by the plan (migration 0089 — GATED, ADR 0189)
export * from "./monitoring";

// ─── The ward builder and the live bed board (migration 0090 — GATED, ADRs 0191–0196)
export * from "./ward-builder";

// ─── Closing the encounter: admissions and the patient's copy (migration 0091 — GATED, ADRs 0197–0203)
export * from "./admissions";

// ─── NCDSync, the hospital NCD registry (migration 0093 — GATED, ADRs 0209–0214)
export * from "./ncd-registry";

// ─── Pharmacy Phase 0: dispensing points (migration 0121 — GATED, ADR 0236) ───
export * from "./pharmacy";
// ─── Lab Phase 1, the safety floor (migrations 0102–0105 — GATED, ADRs 0239–0250)
export * from "./lab-safety";
export * from "./lab-catalogue";
export * from "./lab-quality";
// ─── Lab Phase 4: connect outward (migrations 0150–0153 — GATED, ADRs 0312–0326) ───
export * from "./lab-exchange";
export * from "./lab-phase5";
// ─── Pharmacy Phase 1: dispensing with stock (migrations 0122–0135 — GATED, ADRs 0260–0279)
export * from "./pharmacy-dispensing";
export * from "./pharmacy-stores";
export { pharmacyLoanClosures } from "./pharmacy-stores-0182";
export * from "./pharmacy-stores-0184";
export * from "./pharmacy-clinical";
export * from "./pharmacy-network";
export * from "./pharmacy-demo";
export * from "./pharmacy-catalogue";
export * from "./pharmacy-prices";
export * from "./pharmacy-rework";
export * from "./pharmacy-rework-controls";
export * from "./pharmacy-rework-patients";
export * from "./pharmacy-rework-records";
export * from "./pharmacy-store";
export * from "./pharmacy-imports";
export * from "./pharmacy-distribution";
