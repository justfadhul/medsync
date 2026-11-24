/**
 * Departments & services hub — ONE pure module, shared by the ha-services-hub Edge Function (Deno),
 * the booking engine's template writers, the app's readers (Node) and the Vitest suite.
 * Self-contained on purpose: no sibling imports, so both runtimes can import it (like slots.ts).
 *
 *   Part 1 — the catalogues (gate-a §4, Appendix A) and the signed level presets (§5)
 *   Part 2 — the engine rules (prompt §6): STR, CAP, AV, DX, PS, CLN skip, legacy import
 */

export type DepartmentKind = "clinical" | "diagnostic" | "support" | "administrative";

export interface CatalogueDepartment {
  code: string;
  label: string;
  kind: DepartmentKind;
  /** Grouping shown in "+ Add departments" (the application form's groups for clinical). */
  group: string;
}

export const DEPARTMENT_KIND_LABEL: Record<DepartmentKind, string> = {
  clinical: "Clinical",
  diagnostic: "Diagnostic",
  support: "Support",
  administrative: "Administrative",
};

export const DEPARTMENT_KINDS: readonly DepartmentKind[] = [
  "clinical",
  "diagnostic",
  "support",
  "administrative",
];

export const CATALOGUE_DEPARTMENTS: readonly CatalogueDepartment[] = [
  { code: "INTERNAL_MEDICINE", label: "Internal Medicine", kind: "clinical", group: "Medicine" },
  { code: "FAMILY_MEDICINE", label: "Family Medicine", kind: "clinical", group: "Medicine" },
  { code: "GENERAL_SURGERY", label: "General Surgery", kind: "clinical", group: "Surgery" },
  { code: "ORTHOPAEDICS", label: "Orthopaedics", kind: "clinical", group: "Surgery" },
  { code: "UROLOGY", label: "Urology", kind: "clinical", group: "Surgery" },
  { code: "NEUROSURGERY", label: "Neurosurgery", kind: "clinical", group: "Surgery" },
  { code: "CARDIOTHORACIC", label: "Cardiothoracic", kind: "clinical", group: "Surgery" },
  { code: "PAEDIATRIC_SURGERY", label: "Paediatric Surgery", kind: "clinical", group: "Surgery" },
  {
    code: "PLASTIC_RECONSTRUCTIVE",
    label: "Plastic / Reconstructive",
    kind: "clinical",
    group: "Surgery",
  },
  { code: "ENT", label: "ENT", kind: "clinical", group: "Surgery" },
  { code: "MAXILLOFACIAL", label: "Maxillofacial", kind: "clinical", group: "Surgery" },
  {
    code: "OBSTETRICS_GYNAECOLOGY",
    label: "Obstetrics & Gynaecology",
    kind: "clinical",
    group: "Women & children",
  },
  {
    code: "PAEDIATRICS_CHILD_HEALTH",
    label: "Paediatrics & Child Health",
    kind: "clinical",
    group: "Women & children",
  },
  { code: "NEONATOLOGY", label: "Neonatology", kind: "clinical", group: "Women & children" },
  { code: "EMERGENCY", label: "Emergency / Casualty", kind: "clinical", group: "Acute & critical" },
  { code: "ANAESTHESIA", label: "Anaesthesia", kind: "clinical", group: "Acute & critical" },
  {
    code: "INTENSIVE_CARE",
    label: "Intensive Care (ICU/HDU)",
    kind: "clinical",
    group: "Acute & critical",
  },
  {
    code: "PSYCHIATRY",
    label: "Psychiatry / Mental Health",
    kind: "clinical",
    group: "Mental & rehab",
  },
  {
    code: "PHYSIOTHERAPY_REHAB",
    label: "Physiotherapy & Rehabilitation",
    kind: "clinical",
    group: "Mental & rehab",
  },
  { code: "PALLIATIVE_CARE", label: "Palliative Care", kind: "clinical", group: "Mental & rehab" },
  { code: "DENTAL_ORAL", label: "Dental / Oral Health", kind: "clinical", group: "Other" },
  { code: "PUBLIC_HEALTH", label: "Public / Community Health", kind: "clinical", group: "Other" },
  { code: "OPHTHALMOLOGY", label: "Ophthalmology", kind: "clinical", group: "Other" },
  // D-SVC-04 additions
  { code: "LABORATORY", label: "Laboratory", kind: "diagnostic", group: "Diagnostic" },
  {
    code: "RADIOLOGY_IMAGING",
    label: "Radiology & imaging",
    kind: "diagnostic",
    group: "Diagnostic",
  },
  { code: "PHARMACY", label: "Pharmacy", kind: "support", group: "Support" },
  {
    code: "NUTRITION_DIETETICS",
    label: "Nutrition & dietetics",
    kind: "support",
    group: "Support",
  },
  { code: "MORTUARY", label: "Mortuary", kind: "support", group: "Support" },
  {
    code: "RECORDS_HEALTH_INFO",
    label: "Records & health information",
    kind: "administrative",
    group: "Administrative",
  },
  {
    code: "RECEPTION_FRONT_DESK",
    label: "Reception & front desk",
    kind: "administrative",
    group: "Administrative",
  },
];

/** INTERNAL_MEDICINE → internal-medicine (the slug every writer already uses). */
export const departmentSlug = (code: string) => code.toLowerCase().replace(/_/g, "-");

export const departmentByCode = (code: string) =>
  CATALOGUE_DEPARTMENTS.find((d) => d.code === code) ?? null;

/* ─── A.2 Clinics (C = confidential by default, D-SVC-08) ───────────── */

export interface CatalogueClinic {
  code: string;
  label: string;
  /** The department it usually hangs under; the admin can pick another. */
  department: string;
  confidential: boolean;
}

export const CATALOGUE_CLINICS: readonly CatalogueClinic[] = [
  // The application form's nine (codes unchanged, 0021 CHECK).
  { code: "diabetes", label: "Diabetes", department: "INTERNAL_MEDICINE", confidential: false },
  {
    code: "hypertension_cardiac",
    label: "Hypertension / cardiac",
    department: "INTERNAL_MEDICINE",
    confidential: false,
  },
  {
    code: "renal_dialysis",
    label: "Renal / dialysis",
    department: "INTERNAL_MEDICINE",
    confidential: false,
  },
  { code: "oncology", label: "Oncology", department: "INTERNAL_MEDICINE", confidential: false },
  { code: "hiv_art", label: "HIV / ART", department: "INTERNAL_MEDICINE", confidential: true },
  { code: "tb", label: "TB", department: "INTERNAL_MEDICINE", confidential: true },
  {
    code: "antenatal_maternal",
    label: "Antenatal / maternal",
    department: "OBSTETRICS_GYNAECOLOGY",
    confidential: false,
  },
  {
    code: "asthma_copd",
    label: "Asthma / COPD",
    department: "INTERNAL_MEDICINE",
    confidential: false,
  },
  { code: "mental_health", label: "Mental health", department: "PSYCHIATRY", confidential: true },
  // Proposed and signed (A.2)
  {
    code: "general_medical_opd",
    label: "General medical outpatients",
    department: "INTERNAL_MEDICINE",
    confidential: false,
  },
  {
    code: "surgical_opd",
    label: "Surgical outpatients",
    department: "GENERAL_SURGERY",
    confidential: false,
  },
  {
    code: "paediatric_opd",
    label: "Paediatric outpatients",
    department: "PAEDIATRICS_CHILD_HEALTH",
    confidential: false,
  },
  {
    code: "sickle_cell",
    label: "Sickle cell",
    department: "INTERNAL_MEDICINE",
    confidential: false,
  },
  {
    code: "epilepsy_neurology",
    label: "Epilepsy / neurology",
    department: "INTERNAL_MEDICINE",
    confidential: false,
  },
  {
    code: "family_planning",
    label: "Family planning",
    department: "OBSTETRICS_GYNAECOLOGY",
    confidential: true,
  },
  {
    code: "srh",
    label: "Sexual & reproductive health",
    department: "OBSTETRICS_GYNAECOLOGY",
    confidential: true,
  },
  {
    code: "immunisation",
    label: "Immunisation / young child",
    department: "PAEDIATRICS_CHILD_HEALTH",
    confidential: false,
  },
  { code: "nutrition", label: "Nutrition", department: "NUTRITION_DIETETICS", confidential: false },
  { code: "eye", label: "Eye", department: "OPHTHALMOLOGY", confidential: false },
  { code: "ent", label: "ENT", department: "ENT", confidential: false },
  { code: "dental", label: "Dental", department: "DENTAL_ORAL", confidential: false },
  { code: "orthopaedic", label: "Orthopaedic", department: "ORTHOPAEDICS", confidential: false },
  { code: "skin", label: "Skin", department: "INTERNAL_MEDICINE", confidential: false },
  {
    code: "physiotherapy",
    label: "Physiotherapy",
    department: "PHYSIOTHERAPY_REHAB",
    confidential: false,
  },
  {
    code: "palliative_care",
    label: "Palliative care",
    department: "PALLIATIVE_CARE",
    confidential: false,
  },
  {
    code: "postnatal",
    label: "Postnatal",
    department: "OBSTETRICS_GYNAECOLOGY",
    confidential: false,
  },
  {
    code: "gynaecology",
    label: "Gynaecology",
    department: "OBSTETRICS_GYNAECOLOGY",
    confidential: false,
  },
];

export const clinicByCode = (code: string) =>
  CATALOGUE_CLINICS.find((c) => c.code === code) ?? null;

/* ─── A.3 Laboratory sections (units of LABORATORY) ─────────────────── */

export const LAB_SECTIONS = [
  { code: "clinical_chemistry", label: "Clinical chemistry" },
  { code: "haematology", label: "Haematology" },
  { code: "microbiology", label: "Microbiology" },
  { code: "parasitology", label: "Parasitology" },
  { code: "serology_immunology", label: "Serology / immunology" },
  { code: "molecular", label: "Molecular (PCR, GeneXpert)" },
  { code: "blood_transfusion", label: "Blood transfusion / blood bank" },
  { code: "histopathology_cytology", label: "Histopathology & cytology" },
] as const;

/* ─── A.4 Imaging & other tests ─────────────────────────────────────── */

export const IMAGING_ITEMS = [
  { code: "xray", label: "X-ray" },
  { code: "ultrasound", label: "Ultrasound" },
  { code: "ct", label: "CT" },
  { code: "mri", label: "MRI" },
  { code: "mammography", label: "Mammography" },
  { code: "fluoroscopy", label: "Fluoroscopy" },
  { code: "ecg", label: "ECG" },
  { code: "echo", label: "Echocardiography" },
  { code: "endoscopy", label: "Endoscopy" },
  { code: "eeg", label: "EEG" },
  { code: "spirometry", label: "Spirometry" },
] as const;

/* ─── A.5 Wards, A.6 availability reasons ───────────────────────────── */

export const WARD_TYPES = [
  { code: "general", label: "General" },
  { code: "hdu", label: "HDU" },
  { code: "icu", label: "ICU" },
  { code: "nicu", label: "NICU" },
  { code: "maternity", label: "Maternity" },
  { code: "labour_suite", label: "Labour suite" },
  { code: "isolation", label: "Isolation" },
  { code: "paediatric", label: "Paediatric" },
  { code: "surgical", label: "Surgical" },
  { code: "emergency_observation", label: "Emergency observation" },
  { code: "private", label: "Private" },
] as const;

export const WARD_SEXES = [
  { code: "female", label: "Female" },
  { code: "male", label: "Male" },
  { code: "mixed", label: "Mixed" },
] as const;

export const WARD_AGE_GROUPS = [
  { code: "adult", label: "Adult" },
  { code: "paediatric", label: "Paediatric" },
  { code: "neonatal", label: "Neonatal" },
  { code: "all", label: "All ages" },
] as const;

export const AVAILABILITY_REASONS = [
  { code: "equipment_down", label: "Equipment down" },
  { code: "stock_out", label: "Reagent or supplies stock-out" },
  { code: "staff", label: "Staff not available" },
  { code: "power_water", label: "Power or water outage" },
  { code: "maintenance", label: "Maintenance or repair" },
  { code: "building_works", label: "Building works" },
  { code: "other", label: "Other" },
] as const;

/* ─── A.7 Capability keys ───────────────────────────────────────────── */

export type CapabilityValueType =
  | { type: "count"; max: number }
  | { type: "yesno" }
  | { type: "choice"; options: readonly { code: string; label: string }[] }
  | { type: "multi"; options: readonly { code: string; label: string }[] }
  | { type: "text"; max: number }
  | { type: "phone" }
  | { type: "pre_alert" }
  | { type: "weekly_hours" };

export interface CapabilityKey {
  key: string;
  label: string;
  /** Emergency & support section [01]–[09] (Hours for opd_hours). */
  section: number;
  routing: boolean;
  /** CAP-2: the emergency pathway's own column(s) on `hospitals` hold the value. */
  pathway?: boolean;
  /** CAP-3: computed from Wards & beds; never typed. */
  derived?: boolean;
  value: CapabilityValueType;
}

export const EMERGENCY_CAPABILITY_OPTIONS = [
  { code: "none", label: "No emergency department" },
  { code: "daytime", label: "Daytime only" },
  { code: "24h", label: "Open 24 hours" },
] as const;

export const CAPABILITY_SECTIONS: Record<number, string> = {
  1: "Emergency department",
  2: "Theatres",
  3: "Critical care",
  4: "Blood",
  5: "Oxygen",
  6: "Pharmacy",
  7: "Dialysis",
  8: "Ambulance",
  9: "Mortuary",
};

export const CAPABILITY_KEYS: readonly CapabilityKey[] = [
  {
    key: "emergency_capability",
    label: "Emergency department",
    section: 1,
    routing: true,
    pathway: true,
    value: { type: "choice", options: EMERGENCY_CAPABILITY_OPTIONS },
  },
  {
    key: "triage_system",
    label: "Triage system",
    section: 1,
    routing: false,
    value: {
      type: "choice",
      options: [
        { code: "sats", label: "SATS" },
        { code: "etat", label: "ETAT" },
        { code: "other", label: "Other" },
        { code: "none", label: "None" },
      ],
    },
  },
  {
    key: "eu_stay_limit_hours",
    label: "Emergency unit stay limit (hours)",
    section: 1,
    routing: false,
    value: { type: "count", max: 72 },
  },
  {
    key: "resus_bays",
    label: "Resuscitation bays",
    section: 1,
    routing: true,
    value: { type: "count", max: 50 },
  },
  {
    key: "accepts_pre_alerts",
    label: "Accept ambulance pre-alerts",
    section: 1,
    routing: true,
    pathway: true,
    value: { type: "pre_alert" },
  },
  {
    key: "emergency_sms_number",
    label: "Emergency SMS number",
    section: 1,
    routing: true,
    pathway: true,
    value: { type: "phone" },
  },
  {
    key: "ambulance_line",
    label: "Ambulance line",
    section: 1,
    routing: true,
    pathway: true,
    value: { type: "phone" },
  },
  {
    key: "arrival_directions",
    label: "Directions for arriving ambulances",
    section: 1,
    routing: true,
    pathway: true,
    value: { type: "text", max: 140 },
  },
  {
    key: "theatres_count",
    label: "Theatres",
    section: 2,
    routing: false,
    value: { type: "count", max: 60 },
  },
  {
    key: "emergency_theatre_24h",
    label: "Emergency theatre 24 hours",
    section: 2,
    routing: true,
    value: { type: "yesno" },
  },
  {
    key: "icu_beds",
    label: "ICU beds",
    section: 3,
    routing: true,
    derived: true,
    value: { type: "count", max: 9999 },
  },
  {
    key: "hdu_beds",
    label: "HDU beds",
    section: 3,
    routing: true,
    derived: true,
    value: { type: "count", max: 9999 },
  },
  {
    key: "isolation_beds",
    label: "Isolation beds",
    section: 3,
    routing: false,
    derived: true,
    value: { type: "count", max: 9999 },
  },
  {
    key: "nicu_cots",
    label: "NICU cots",
    section: 3,
    routing: true,
    derived: true,
    value: { type: "count", max: 9999 },
  },
  {
    key: "ventilators_count",
    label: "Ventilators",
    section: 3,
    routing: true,
    value: { type: "count", max: 500 },
  },
  {
    key: "blood_source",
    label: "Blood source",
    section: 4,
    routing: true,
    value: {
      type: "choice",
      options: [
        { code: "onsite", label: "On-site blood bank" },
        { code: "regional", label: "From a regional blood bank" },
        { code: "none", label: "None" },
      ],
    },
  },
  {
    key: "blood_24h",
    label: "Blood available 24 hours",
    section: 4,
    routing: true,
    value: { type: "yesno" },
  },
  {
    key: "oxygen_sources",
    label: "Oxygen sources",
    section: 5,
    routing: true,
    value: {
      type: "multi",
      options: [
        { code: "plant", label: "Plant" },
        { code: "cylinders", label: "Cylinders" },
        { code: "concentrators", label: "Concentrators" },
      ],
    },
  },
  {
    key: "oxygen_piped",
    label: "Oxygen piped to wards",
    section: 5,
    routing: false,
    value: { type: "yesno" },
  },
  {
    key: "oxygen_24h",
    label: "Oxygen 24 hours",
    section: 5,
    routing: true,
    value: { type: "yesno" },
  },
  {
    key: "pharmacy_dispensing_points",
    label: "Dispensing points",
    section: 6,
    routing: false,
    value: { type: "count", max: 50 },
  },
  {
    key: "pharmacy_24h",
    label: "Pharmacy 24 hours",
    section: 6,
    routing: false,
    value: { type: "yesno" },
  },
  {
    key: "dialysis_machines",
    label: "Dialysis machines",
    section: 7,
    routing: false,
    value: { type: "count", max: 200 },
  },
  {
    key: "dialysis_sessions_per_week",
    label: "Dialysis sessions per week",
    section: 7,
    routing: false,
    value: { type: "count", max: 2000 },
  },
  {
    key: "ambulances_count",
    label: "Ambulances",
    section: 8,
    routing: false,
    value: { type: "count", max: 100 },
  },
  {
    key: "ambulance_24h",
    label: "Ambulance 24 hours",
    section: 8,
    routing: true,
    value: { type: "yesno" },
  },
  { key: "mortuary", label: "Mortuary", section: 9, routing: false, value: { type: "yesno" } },
  {
    key: "mortuary_capacity",
    label: "Mortuary capacity",
    section: 9,
    routing: false,
    value: { type: "count", max: 1000 },
  },
  {
    key: "opd_hours",
    label: "Outpatient hours",
    section: 0,
    routing: false,
    value: { type: "weekly_hours" },
  },
];

export const capabilityKey = (key: string) => CAPABILITY_KEYS.find((k) => k.key === key) ?? null;

/* ─── Level presets (§5; E-SVC-05: versioned data, signature stored) ── */

/** `hospitals.level` values (db/schema/hospitals.ts CHECK). */
export type HospitalLevel =
  | "national_referral"
  | "regional"
  | "district"
  | "hc4"
  | "hc3"
  | "private";

export interface PresetItem {
  kind: "department" | "lab_section" | "clinic" | "imaging";
  code: string;
  /** The clause that names it, e.g. "74.2". */
  clause: string;
  /** Printed page (PDF page). */
  page: string;
}

export interface ServicePreset {
  level: Exclude<HospitalLevel, "private">;
  levelLabel: string;
  version: string;
  source: string;
  url: string;
  section: string;
  items: readonly PresetItem[];
  /** PS-1: an unsigned preset is invisible. */
  signedBy: string | null;
  signedAt: string | null;
  signatureBasis: string | null;
}

const SOURCE =
  "Ministry of Health Uganda — Health Sector Service Standards and Service Delivery Standards (2016)";
const URL =
  "https://library.health.go.ug/sites/default/files/resources/Health%20Sector%20Service%20Standards%20&%20Service%20Delivery%20Standards_2016.pdf";
const SIGNATURE = {
  signedBy: "Fadhul (CSO)",
  signedAt: "2026-09-26",
  signatureBasis:
    "Blanket GATE A sign-off, 26 Sep 2026 (docs/hospital-services/gate-a-proposal.md)",
} as const;

const item = (
  kind: PresetItem["kind"],
  code: string,
  clause: string,
  page: string,
): PresetItem => ({
  kind,
  code,
  clause,
  page,
});

const RMNCAH_GH = (p: string, c: { anc: string; fp: string; imm: string; nut: string }) => [
  item("clinic", "antenatal_maternal", c.anc, p),
  item("clinic", "postnatal", c.anc, p),
  item("clinic", "family_planning", c.fp, p),
  item("clinic", "immunisation", c.imm, p),
  item("clinic", "nutrition", c.nut, p),
];

export const SERVICE_PRESETS: readonly ServicePreset[] = [
  {
    level: "hc3",
    levelLabel: "Health Centre III",
    version: "moh-2016.1",
    source: SOURCE,
    url: URL,
    section: "§2.5.3, pp. 21–26 (PDF 28–33)",
    items: [
      ...RMNCAH_GH("22–23 (PDF 29–30)", {
        anc: "29.1, 29.4",
        fp: "29.6",
        imm: "29.8",
        nut: "29.9",
      }),
      item("clinic", "hiv_art", "30.1", "24 (PDF 31)"),
      item("clinic", "tb", "30.2", "24 (PDF 31)"),
    ],
    ...SIGNATURE,
  },
  {
    level: "hc4",
    levelLabel: "Health Centre IV",
    version: "moh-2016.1",
    source: SOURCE,
    url: URL,
    section: "§2.5.4, pp. 27–32 (PDF 34–39)",
    items: [
      item("department", "GENERAL_SURGERY", "52", "31 (PDF 38)"),
      item("department", "DENTAL_ORAL", "53", "32 (PDF 39)"),
      item("department", "PALLIATIVE_CARE", "54", "32 (PDF 39)"),
      item("department", "LABORATORY", "55.1", "32 (PDF 39)"),
      item("department", "MORTUARY", "56", "32 (PDF 39)"),
      ...RMNCAH_GH("28–29 (PDF 35–36)", { anc: "43.1, 43.5", fp: "43.6", imm: "44", nut: "45" }),
      item("clinic", "hiv_art", "46", "30 (PDF 37)"),
      item("clinic", "tb", "46", "30 (PDF 37)"),
      item("clinic", "mental_health", "50", "31 (PDF 38)"),
      item("imaging", "ultrasound", "55.2", "32 (PDF 39)"),
    ],
    ...SIGNATURE,
  },
  {
    level: "district",
    levelLabel: "General Hospital",
    version: "moh-2016.1",
    source: SOURCE,
    url: URL,
    section: "§2.5.5, pp. 33–38 (PDF 40–45)",
    items: [
      item("department", "GENERAL_SURGERY", "70.1", "38 (PDF 45)"),
      item("department", "OBSTETRICS_GYNAECOLOGY", "61.2, 70.2", "34, 38 (PDF 41, 45)"),
      item("department", "EMERGENCY", "66.3–66.4", "37 (PDF 44)"),
      item("department", "PSYCHIATRY", "68, 71", "37–38 (PDF 44–45)"),
      item("department", "DENTAL_ORAL", "72", "38 (PDF 45)"),
      item("department", "PALLIATIVE_CARE", "73", "38 (PDF 45)"),
      item("department", "LABORATORY", "74.1", "38 (PDF 45)"),
      item("department", "RADIOLOGY_IMAGING", "74.2–74.3", "38 (PDF 45)"),
      item("department", "MORTUARY", "75", "38 (PDF 45)"),
      item("department", "NUTRITION_DIETETICS", "63", "35–36 (PDF 42–43)"),
      ...RMNCAH_GH("34–36 (PDF 41–43)", { anc: "61.1, 61.4", fp: "61.5", imm: "62", nut: "63" }),
      item("clinic", "hiv_art", "64.1.1", "36 (PDF 43)"),
      item("clinic", "tb", "64.1.2", "36 (PDF 43)"),
      item("clinic", "mental_health", "68", "37 (PDF 44)"),
      item("clinic", "palliative_care", "73", "38 (PDF 45)"),
      item("imaging", "xray", "74.2", "38 (PDF 45)"),
      item("imaging", "fluoroscopy", "74.2", "38 (PDF 45)"),
      item("imaging", "ultrasound", "74.3", "38 (PDF 45)"),
    ],
    ...SIGNATURE,
  },
  {
    level: "regional",
    levelLabel: "Regional Referral Hospital",
    version: "moh-2016.1",
    source: SOURCE,
    url: URL,
    section: "§2.5.6, pp. 39–43 (PDF 46–50)",
    items: [
      item("department", "INTERNAL_MEDICINE", "82.1", "42 (PDF 49)"),
      item("department", "PAEDIATRICS_CHILD_HEALTH", "82.1", "42 (PDF 49)"),
      item("department", "GENERAL_SURGERY", "83.1", "42 (PDF 49)"),
      item("department", "OBSTETRICS_GYNAECOLOGY", "79.2, 83.2", "40, 42 (PDF 47, 49)"),
      item("department", "ORTHOPAEDICS", "83.3–83.4", "42 (PDF 49)"),
      item("department", "ENT", "83.4", "42 (PDF 49)"),
      item("department", "OPHTHALMOLOGY", "83.4", "42 (PDF 49)"),
      item("department", "PHYSIOTHERAPY_REHAB", "84.3", "42 (PDF 49)"),
      item("department", "DENTAL_ORAL", "86", "42 (PDF 49)"),
      item("department", "PALLIATIVE_CARE", "87", "42 (PDF 49)"),
      item("department", "LABORATORY", "88.1", "43 (PDF 50)"),
      item("department", "RADIOLOGY_IMAGING", "88.2–88.3", "43 (PDF 50)"),
      item("department", "MORTUARY", "89", "43 (PDF 50)"),
      item("department", "NUTRITION_DIETETICS", "81.2", "41 (PDF 48)"),
      item("lab_section", "histopathology_cytology", "88.4", "43 (PDF 50)"),
      ...RMNCAH_GH("39–41 (PDF 46–48)", { anc: "79.1, 79.4", fp: "79.5", imm: "80", nut: "81" }),
      item("clinic", "palliative_care", "87", "42 (PDF 49)"),
      item("imaging", "xray", "88.2", "43 (PDF 50)"),
      item("imaging", "ultrasound", "88.3", "43 (PDF 50)"),
    ],
    ...SIGNATURE,
  },
  {
    level: "national_referral",
    levelLabel: "National Referral Hospital",
    version: "moh-2016.1",
    source: SOURCE,
    url: URL,
    section: "§2.5.7, pp. 44–48 (PDF 51–55)",
    items: [
      item("department", "INTERNAL_MEDICINE", "97.1", "46 (PDF 53)"),
      item("department", "PAEDIATRICS_CHILD_HEALTH", "97.1", "46 (PDF 53)"),
      item("department", "GENERAL_SURGERY", "98.1", "47 (PDF 54)"),
      item("department", "OBSTETRICS_GYNAECOLOGY", "94.2, 98.2", "45, 47 (PDF 52, 54)"),
      item("department", "ORTHOPAEDICS", "98.3", "47 (PDF 54)"),
      item("department", "ENT", "98.4", "47 (PDF 54)"),
      item("department", "OPHTHALMOLOGY", "98.4", "47 (PDF 54)"),
      item("department", "PHYSIOTHERAPY_REHAB", "99.3", "47 (PDF 54)"),
      item("department", "DENTAL_ORAL", "101", "47 (PDF 54)"),
      item("department", "PALLIATIVE_CARE", "102", "47 (PDF 54)"),
      item("department", "LABORATORY", "103.1", "47 (PDF 54)"),
      item("department", "RADIOLOGY_IMAGING", "103.2–103.3", "47 (PDF 54)"),
      item("department", "MORTUARY", "104", "47 (PDF 54)"),
      item("department", "NUTRITION_DIETETICS", "96.3", "46 (PDF 53)"),
      item("lab_section", "histopathology_cytology", "103.4", "47 (PDF 54)"),
      ...RMNCAH_GH("44–46 (PDF 51–53)", { anc: "94.1, 94.4", fp: "94.5", imm: "95", nut: "96" }),
      item("clinic", "oncology", "102.2", "47 (PDF 54)"),
      item("clinic", "palliative_care", "102", "47 (PDF 54)"),
      item("imaging", "xray", "103.2", "47 (PDF 54)"),
      item("imaging", "ultrasound", "103.3", "47 (PDF 54)"),
      item("imaging", "ct", "103.3", "47 (PDF 54)"),
      item("imaging", "mri", "103.3", "47 (PDF 54)"),
    ],
    ...SIGNATURE,
  },
];

/** PS-1: only signed presets exist as far as the product is concerned. */
export function signedPresetFor(level: string): ServicePreset | null {
  return SERVICE_PRESETS.find((p) => p.level === level && p.signedBy && p.signedAt) ?? null;
}

/* ═══ Part 2 — engine rules ═══════════════════════════════════════════ */

/* ─── STR-4: archive only what nothing uses ─────────────────────────── */

export interface InUse {
  /** Active or approved staff affiliations. */
  staff: number;
  /** Future sessions that already hold bookings. */
  bookedSessions: number;
  /** Unarchived wards under a department. */
  wards: number;
  /** Unarchived child units. */
  units: number;
  /** Seam: occupied beds arrive with the inpatient module; always 0 today. */
  occupiedBeds: number;
}

export function archiveVerdict(u: InUse): { ok: true } | { ok: false; reason: string } {
  const parts: string[] = [];
  if (u.staff) parts.push(`${u.staff} staff`);
  if (u.bookedSessions)
    parts.push(`${u.bookedSessions} booked session${u.bookedSessions === 1 ? "" : "s"}`);
  if (u.wards) parts.push(`${u.wards} ward${u.wards === 1 ? "" : "s"}`);
  if (u.units) parts.push(`${u.units} unit${u.units === 1 ? "" : "s"}`);
  if (u.occupiedBeds)
    parts.push(`${u.occupiedBeds} occupied bed${u.occupiedBeds === 1 ? "" : "s"}`);
  return parts.length === 0
    ? { ok: true }
    : { ok: false, reason: `In use: ${parts.join(" · ")}. Reassign first.` };
}

/* ─── STR-2: one start department once any department is live ───────── */

export interface DeptState {
  id: string;
  parentId: string | null;
  live: boolean;
  archived: boolean;
  isStart: boolean;
}

/**
 * What changes when `id` goes live or not. Going live with no start department makes it the start
 * (the first live department is where MedSync starts until the admin picks another). Switching off
 * the start department is refused while other live departments exist — choose a new start first.
 */
export function liveChange(
  all: readonly DeptState[],
  id: string,
  live: boolean,
): { ok: true; makeStart: boolean } | { ok: false; reason: string } {
  const d = all.find((x) => x.id === id);
  if (!d) return { ok: false, reason: "Department not found." };
  if (d.archived) return { ok: false, reason: "Unarchive the department first." };
  if (live) {
    const hasStart = all.some((x) => x.isStart);
    return { ok: true, makeStart: !hasStart && d.parentId === null };
  }
  if (d.isStart && all.some((x) => x.id !== id && x.live && !x.archived)) {
    return {
      ok: false,
      reason: "This is where you start with MedSync. Choose another start department first.",
    };
  }
  return { ok: true, makeStart: false };
}

export function startChange(
  all: readonly DeptState[],
  id: string,
): { ok: true } | { ok: false; reason: string } {
  const d = all.find((x) => x.id === id);
  if (!d) return { ok: false, reason: "Department not found." };
  if (d.parentId !== null) return { ok: false, reason: "A unit can't be the start department." };
  if (d.archived)
    return { ok: false, reason: "An archived department can't be the start department." };
  if (!d.live) return { ok: false, reason: "Set the department live on MedSync first." };
  return { ok: true };
}

/* ─── STR-3: heads and in-charges ───────────────────────────────────── */

export const NURSE_CADRE_CODES = ["NURSE", "MIDWIFE", "SPECIALIST_NURSE"] as const;

export interface Affiliation {
  userId: string;
  departmentId: string;
  state: string;
  cadreCode: string | null;
}

const LIVE_STATES = new Set(["active", "approved"]);

/** Heads: approved staff affiliated to that department (or to the parent, for a unit). */
export function headEligible(
  aff: readonly Affiliation[],
  userId: string,
  departmentIds: readonly string[],
): boolean {
  return aff.some(
    (a) =>
      a.userId === userId && LIVE_STATES.has(a.state) && departmentIds.includes(a.departmentId),
  );
}

/** Ward in-charges: approved nursing staff at the hospital. */
export function inChargeEligible(aff: readonly Affiliation[], userId: string): boolean {
  return aff.some(
    (a) =>
      a.userId === userId &&
      LIVE_STATES.has(a.state) &&
      (NURSE_CADRE_CODES as readonly string[]).includes(a.cadreCode ?? ""),
  );
}

/* ─── STR-5: beds ───────────────────────────────────────────────────── */

/**
 * "Generate Bed 1–30": fill the register up to the ward's count. `activeBeds` are the unarchived
 * ones (they use up the count); `allLabels` includes archived beds, whose labels stay taken.
 */
export function bedLabelsToAdd(
  bedCount: number,
  activeBeds: number,
  allLabels: readonly string[],
  prefix = "Bed",
): string[] {
  const have = new Set(allLabels);
  const room = bedCount - activeBeds;
  const out: string[] = [];
  for (let n = 1; out.length < room && n <= bedCount + allLabels.length + 1; n++) {
    const label = `${prefix} ${n}`;
    if (!have.has(label)) out.push(label);
  }
  return out;
}

/* ─── CAP-3: derived capabilities from Wards & beds ─────────────────── */

export interface WardForCapability {
  wardType: string | null;
  bedCount: number;
  archived: boolean;
}

export function derivedCapabilities(wards: readonly WardForCapability[]) {
  const sum = (t: string) =>
    wards.filter((w) => !w.archived && w.wardType === t).reduce((n, w) => n + w.bedCount, 0);
  return {
    icu_beds: sum("icu"),
    hdu_beds: sum("hdu"),
    isolation_beds: sum("isolation"),
    nicu_cots: sum("nicu"),
    total_beds: wards.filter((w) => !w.archived).reduce((n, w) => n + w.bedCount, 0),
  };
}

/* ─── DP-2: pharmacy capabilities derived from dispensing points ────── */

/** Typed until a hospital has a dispensing point; worked out from the points after (ADR 0236). */
export const PHARMACY_DERIVED_KEYS: readonly string[] = [
  "pharmacy_dispensing_points",
  "pharmacy_24h",
];

export interface PointForCapability {
  serviceHours: string | null;
  archived: boolean;
}

/**
 * The two pharmacy values from the hospital's dispensing points, or null when it has none (the typed
 * values stand). Open 24 hours: a point whose hub hours read exactly "24 hours"; any other text is
 * not counted as 24 hours, so a guess never says the pharmacy is always open.
 */
export function derivedPharmacy(
  points: readonly PointForCapability[],
): { pharmacy_dispensing_points: number; pharmacy_24h: boolean } | null {
  const live = points.filter((p) => !p.archived);
  if (!live.length) return null;
  return {
    pharmacy_dispensing_points: live.length,
    pharmacy_24h: live.some((p) => p.serviceHours?.trim().toLowerCase() === "24 hours"),
  };
}

/* ─── CAP-1: typed values ───────────────────────────────────────────── */

/** Mirrors the emergency pathway's CHECKs (0066 §6): a mobile, or a landline (+256 2/3/4/8/9…). */
const UG_MOBILE_OR_LINE = /^\+2567\d{8}$|^\+256[23489]\d{7,8}$/;

/** Normalises 0772…, 772…, +256…, 256… to E.164; null when it isn't a Ugandan number. */
export function toUgE164(raw: string): string | null {
  const digits = raw.replace(/[\s()-]/g, "");
  let d = digits;
  if (d.startsWith("+256")) d = d.slice(4);
  else if (d.startsWith("256")) d = d.slice(3);
  else if (d.startsWith("0")) d = d.slice(1);
  if (!/^\d{8,9}$/.test(d)) return null;
  const e164 = `+256${d}`;
  return UG_MOBILE_OR_LINE.test(e164) ? e164 : null;
}

export type CapabilityValue = unknown;

/** Validates and normalises a value for its key. Returns the value to store or an error. */
export function checkCapabilityValue(
  key: string,
  value: unknown,
): { ok: true; value: CapabilityValue } | { ok: false; error: string } {
  const k = capabilityKey(key);
  if (!k) return { ok: false, error: `Unknown capability: ${key}` };
  if (k.derived) return { ok: false, error: `${k.label} is counted from Wards & beds.` };
  if (value === null) return { ok: true, value: null }; // cleared
  const t = k.value;
  switch (t.type) {
    case "count":
      return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= t.max
        ? { ok: true, value }
        : { ok: false, error: `${k.label}: a whole number from 0 to ${t.max}.` };
    case "yesno":
      return typeof value === "boolean"
        ? { ok: true, value }
        : { ok: false, error: `${k.label}: yes or no.` };
    case "choice":
      return typeof value === "string" && t.options.some((o) => o.code === value)
        ? { ok: true, value }
        : { ok: false, error: `${k.label}: choose one of the options.` };
    case "multi":
      return Array.isArray(value) &&
        value.every((v) => typeof v === "string" && t.options.some((o) => o.code === v))
        ? { ok: true, value: [...new Set(value as string[])] }
        : { ok: false, error: `${k.label}: choose from the options.` };
    case "text": {
      if (typeof value !== "string") return { ok: false, error: `${k.label}: text.` };
      const s = value.trim();
      return s.length <= t.max
        ? { ok: true, value: s || null }
        : { ok: false, error: `${k.label}: ${t.max} characters at most (it goes out by SMS).` };
    }
    case "phone": {
      if (typeof value !== "string") return { ok: false, error: `${k.label}: a phone number.` };
      if (!value.trim()) return { ok: true, value: null };
      // The ambulance line may be toll-free, as the pathway allows.
      if (k.key === "ambulance_line" && /^0800\d{6}$/.test(value.replace(/\s/g, ""))) {
        return { ok: true, value: value.replace(/\s/g, "") };
      }
      const e = toUgE164(value);
      return e
        ? { ok: true, value: e }
        : { ok: false, error: `${k.label}: a Ugandan number, like 0772 123 456.` };
    }
    case "pre_alert": {
      const v = value as { enabled?: unknown; owner?: unknown };
      if (typeof v !== "object" || typeof v.enabled !== "boolean") {
        return { ok: false, error: "Pre-alerts: on or off." };
      }
      const owner = typeof v.owner === "string" ? v.owner.trim() : "";
      if (v.enabled && !owner) {
        return {
          ok: false,
          error:
            "Name who owns the Incoming board each shift — a board nobody owns is a board nobody watches.",
        };
      }
      if (owner.length > 240) return { ok: false, error: "Board owner: 240 characters at most." };
      return { ok: true, value: { enabled: v.enabled, owner: owner || null } };
    }
    case "weekly_hours": {
      // { "1": [{"from":"08:00","to":"17:00"}], … } — ISO weekday → intervals.
      if (typeof value !== "object" || Array.isArray(value))
        return { ok: false, error: "Hours: by weekday." };
      const out: Record<string, { from: string; to: string }[]> = {};
      for (const [day, spans] of Object.entries(value as Record<string, unknown>)) {
        if (!/^[1-7]$/.test(day) || !Array.isArray(spans))
          return { ok: false, error: "Hours: by weekday." };
        const list: { from: string; to: string }[] = [];
        for (const s of spans) {
          const f = (s as { from?: string }).from ?? "";
          const to = (s as { to?: string }).to ?? "";
          if (
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(f) ||
            !/^([01]\d|2[0-4]):[0-5]\d$/.test(to) ||
            to <= f
          ) {
            return {
              ok: false,
              error: "Hours: times like 08:00 to 17:00, the end after the start.",
            };
          }
          list.push({ from: f, to });
        }
        if (list.length) out[day] = list;
      }
      return { ok: true, value: out };
    }
  }
}

/* ─── CAP-5: four-eyes ──────────────────────────────────────────────── */

export interface CapabilityRow {
  key: string;
  value: unknown;
  authoredBy: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  pendingValue: unknown;
  pendingBy: string | null;
  pendingAt: string | null;
}

export type SetOutcome =
  | { kind: "direct"; value: unknown } // not routing-relevant: takes effect now
  | { kind: "pending"; value: unknown }; // routing-relevant: waits for a second person

export function setOutcome(key: CapabilityKey, value: unknown): SetOutcome {
  return key.routing ? { kind: "pending", value } : { kind: "direct", value };
}

export function verifyVerdict(
  row: CapabilityRow | null,
  callerId: string,
): { ok: true } | { ok: false; reason: string } {
  if (!row || !row.pendingAt) return { ok: false, reason: "Nothing is waiting to be verified." };
  if (row.pendingBy === callerId) {
    return { ok: false, reason: "You made this change, so another admin has to verify it." };
  }
  return { ok: true };
}

/** What the profile says about a routing key right now. */
export type VerificationState = "verified" | "unverified" | "change_pending";

export function verificationState(row: CapabilityRow | null): VerificationState {
  if (row?.pendingAt) return "change_pending";
  return row?.verifiedAt ? "verified" : "unverified";
}

/* ─── AV-1, AV-2: availability projection ───────────────────────────── */

export interface AvailabilityEvent {
  problemId: string;
  subjectKind: string;
  subjectRef: string;
  subjectLabel: string;
  event: "reported" | "updated" | "resolved" | "confirmed";
  state: "unavailable" | "limited" | null;
  reason: string | null;
  note: string | null;
  expectedBackAt: string | null;
  actorUserId: string | null;
  at: string;
}

export interface OpenProblem {
  problemId: string;
  subjectKind: string;
  subjectRef: string;
  subjectLabel: string;
  state: "unavailable" | "limited";
  /** AV-2: past the expected-back time with no word since. Never silently "available". */
  unconfirmed: boolean;
  reason: string | null;
  note: string | null;
  since: string;
  expectedBackAt: string | null;
  lastConfirmedAt: string;
  reportedBy: string | null;
}

/** Pure projection: every problem's latest word, with resolved ones dropped. */
export function projectAvailability(
  events: readonly AvailabilityEvent[],
  now: Date,
): OpenProblem[] {
  const byProblem = new Map<string, AvailabilityEvent[]>();
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    const list = byProblem.get(e.problemId) ?? [];
    list.push(e);
    byProblem.set(e.problemId, list);
  }
  const out: OpenProblem[] = [];
  for (const list of byProblem.values()) {
    const first = list[0];
    const last = list[list.length - 1];
    if (!first || !last || last.event === "resolved") continue;
    const latestState = [...list].reverse().find((e) => e.state);
    // A confirmation may carry a new expected-back date; a bare one keeps the last.
    const latestExpected =
      [...list].reverse().find((e) => e.event !== "confirmed" || e.expectedBackAt)
        ?.expectedBackAt ?? null;
    const lastWord = last.at;
    const unconfirmed =
      latestExpected !== null &&
      Date.parse(latestExpected) <= now.getTime() &&
      Date.parse(lastWord) < Date.parse(latestExpected);
    const latestReason = [...list].reverse().find((e) => e.reason);
    out.push({
      problemId: first.problemId,
      subjectKind: first.subjectKind,
      subjectRef: first.subjectRef,
      subjectLabel: first.subjectLabel,
      state: latestState?.state ?? "unavailable",
      unconfirmed,
      reason: latestReason?.reason ?? null,
      note: [...list].reverse().find((e) => e.note)?.note ?? null,
      since: first.at,
      expectedBackAt: latestExpected,
      lastConfirmedAt: lastWord,
      reportedBy: first.actorUserId,
    });
  }
  return out.sort((a, b) => a.since.localeCompare(b.since));
}

export const availabilityReasonLabel = (code: string | null) =>
  AVAILABILITY_REASONS.find((r) => r.code === code)?.label ?? "Other";

/* ─── DX-4: the ordering contract (informs, never blocks) ───────────── */

export interface Offering {
  kind: "lab" | "imaging";
  code: string;
  provision: "in_house" | "referred" | "not_offered";
  hours: "24h" | "scheduled" | null;
  hoursNote: string | null;
  statedTat: string | null;
  referredTo: string | null;
  confirmedAt: string | null;
}

export interface OrderingAvailability {
  code: string;
  where: "in_house" | "referred" | "not_offered" | "unknown";
  hours: string | null;
  statedTurnaround: string | null;
  referredTo: string | null;
  availability: {
    state: "unavailable" | "limited" | "unconfirmed";
    since: string;
    lastConfirmedAt: string;
  } | null;
}

export function orderingAvailability(
  code: string,
  offering: Offering | null,
  open: readonly OpenProblem[],
): OrderingAvailability {
  const confirmed = offering && offering.confirmedAt ? offering : null;
  const problem = open.find(
    (p) => (p.subjectKind === "test" || p.subjectKind === "imaging") && p.subjectRef === code,
  );
  return {
    code,
    where: confirmed ? confirmed.provision : "unknown",
    hours: confirmed ? (confirmed.hours === "24h" ? "24 h" : confirmed.hoursNote) : null,
    statedTurnaround: confirmed?.statedTat ?? null,
    referredTo: confirmed?.referredTo ?? null,
    availability: problem
      ? {
          state: problem.unconfirmed ? "unconfirmed" : problem.state,
          since: problem.since,
          lastConfirmedAt: problem.lastConfirmedAt,
        }
      : null,
  };
}

/* ─── PS-2: applying a preset only adds, as Planned ─────────────────── */

export interface ExistingSetup {
  departmentCodes: ReadonlySet<string>;
  labSectionCodes: ReadonlySet<string>;
  clinicCodes: ReadonlySet<string>;
  imagingCodes: ReadonlySet<string>;
}

export interface PresetPlan {
  add: { kind: "department" | "lab_section" | "clinic" | "imaging"; code: string; label: string }[];
  skip: { kind: string; code: string; label: string; why: string }[];
}

export function planPreset(preset: ServicePreset, have: ExistingSetup): PresetPlan {
  const plan: PresetPlan = { add: [], skip: [] };
  const seen = new Set<string>();
  const needsLab = preset.items.some((i) => i.kind === "lab_section");
  for (const i of preset.items) {
    const key = `${i.kind}:${i.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = labelFor(i.kind, i.code);
    const existing =
      i.kind === "department"
        ? have.departmentCodes
        : i.kind === "lab_section"
          ? have.labSectionCodes
          : i.kind === "clinic"
            ? have.clinicCodes
            : have.imagingCodes;
    if (existing.has(i.code))
      plan.skip.push({ kind: i.kind, code: i.code, label, why: "Already set up" });
    else plan.add.push({ kind: i.kind, code: i.code, label });
  }
  // A lab section needs the Laboratory department; the preset lists it, but guard the order anyway.
  if (
    needsLab &&
    !have.departmentCodes.has("LABORATORY") &&
    !plan.add.some((a) => a.code === "LABORATORY")
  ) {
    plan.add.unshift({ kind: "department", code: "LABORATORY", label: "Laboratory" });
  }
  return plan;
}

export function labelFor(kind: string, code: string): string {
  if (kind === "department") return departmentByCode(code)?.label ?? code;
  if (kind === "lab_section") return LAB_SECTIONS.find((s) => s.code === code)?.label ?? code;
  if (kind === "clinic") return CATALOGUE_CLINICS.find((c) => c.code === code)?.label ?? code;
  if (kind === "imaging") return IMAGING_ITEMS.find((c) => c.code === code)?.label ?? code;
  return code;
}

/* ─── PS-3: standards comparison ────────────────────────────────────── */

export interface Comparison {
  kind: "department" | "clinic" | "imaging" | "lab_section";
  inPreset: number;
  offered: number;
  gaps: { code: string; label: string; clause: string }[];
}

export function compareToPreset(preset: ServicePreset, have: ExistingSetup): Comparison[] {
  const kinds = ["department", "clinic", "imaging", "lab_section"] as const;
  return kinds
    .map((kind) => {
      const items = [
        ...new Map(preset.items.filter((i) => i.kind === kind).map((i) => [i.code, i])).values(),
      ];
      const set =
        kind === "department"
          ? have.departmentCodes
          : kind === "clinic"
            ? have.clinicCodes
            : kind === "imaging"
              ? have.imagingCodes
              : have.labSectionCodes;
      const gaps = items.filter((i) => !set.has(i.code));
      return {
        kind,
        inPreset: items.length,
        offered: items.length - gaps.length,
        gaps: gaps.map((g) => ({ code: g.code, label: labelFor(kind, g.code), clause: g.clause })),
      };
    })
    .filter((c) => c.inPreset > 0);
}

/* ─── Appendix B (corrected): the one-time legacy import ────────────── */

export interface LegacyApplication {
  specialisedClinics: readonly string[];
  specialisedClinicsOther: readonly string[];
  diagnosticServices: readonly string[];
  supportServices: readonly string[];
  servicesOffered: readonly string[];
  hasOnsitePharmacy: boolean | null;
}

export interface LegacyPlan {
  departments: string[];
  labSections: string[];
  clinics: string[];
  customClinics: string[];
  imaging: string[];
  capabilities: { key: string; value: unknown }[];
  notes: string[];
}

const LEGACY_LAB: Record<string, string> = {
  lab_chem: "clinical_chemistry",
  lab_haem: "haematology",
  lab_micro: "microbiology",
  lab_histo: "histopathology_cytology",
};
const LEGACY_IMAGING: Record<string, string> = {
  img_xray: "xray",
  img_ultrasound: "ultrasound",
  img_ct: "ct",
  img_mri: "mri",
  img_mammography: "mammography",
  ecg: "ecg",
  echo: "echo",
  endoscopy: "endoscopy",
};

export function planLegacyImport(app: LegacyApplication): LegacyPlan {
  const p: LegacyPlan = {
    departments: [],
    labSections: [],
    clinics: [],
    customClinics: [],
    imaging: [],
    capabilities: [],
    notes: [],
  };
  const addDept = (c: string) => {
    if (!p.departments.includes(c)) p.departments.push(c);
  };
  for (const c of app.specialisedClinics)
    if (CATALOGUE_CLINICS.some((x) => x.code === c)) p.clinics.push(c);
  for (const c of app.specialisedClinicsOther)
    if (c.trim()) p.customClinics.push(c.trim().slice(0, 120));
  for (const d of app.diagnosticServices) {
    if (LEGACY_LAB[d]) {
      addDept("LABORATORY");
      p.labSections.push(LEGACY_LAB[d]);
    } else if (LEGACY_IMAGING[d]) {
      p.imaging.push(LEGACY_IMAGING[d]);
    }
  }
  if (p.imaging.some((c) => ["xray", "ultrasound", "ct", "mri", "mammography"].includes(c))) {
    addDept("RADIOLOGY_IMAGING");
  }
  for (const s of app.supportServices) {
    if (s === "pharmacy") addDept("PHARMACY");
    else if (s === "blood_bank") p.capabilities.push({ key: "blood_source", value: "onsite" });
    else if (s === "mortuary") {
      addDept("MORTUARY");
      p.capabilities.push({ key: "mortuary", value: true });
    } else if (s === "operating_theatres")
      p.notes.push("Operating theatres: count not given — add it in Emergency & support.");
    else if (s === "ambulance")
      p.notes.push("Ambulance: vehicles not given — add them in Emergency & support.");
  }
  if (app.hasOnsitePharmacy) addDept("PHARMACY");
  for (const s of app.servicesOffered) {
    if (s === "emergency_24_7") p.capabilities.push({ key: "emergency_capability", value: "24h" });
    else if (s === "opd") p.notes.push("Outpatients: set the days and hours in Hours & places.");
    else if (s === "inpatient") p.notes.push("Inpatient care: add your wards in Wards & beds.");
    else if (s === "day_care" || s === "referral")
      p.notes.push(`${s === "day_care" ? "Day-care" : "Referral"}: noted.`);
  }
  return p;
}

/* ─── CLN-3, CLN-4: which civil days a clinic day skips ─────────────── */

export interface ClosureWindow {
  scope: "hospital" | "department" | "ward" | "clinic";
  departmentId: string | null;
  serviceLineId: string | null;
  startsOn: string; // YYYY-MM-DD
  endsOn: string;
}

/**
 * The `skip` hook for expandSessionTemplate: public holidays unless the clinic runs on them;
 * closures always (hospital-wide, the clinic's department or unit, or the clinic itself).
 */
export function skipDayFor(opts: {
  holidays: readonly string[];
  closures: readonly ClosureWindow[];
  runsOnHolidays: boolean;
  departmentIds: readonly string[];
  serviceLineId: string;
}): (ymd: string) => boolean {
  const holidays = new Set(opts.holidays);
  const relevant = opts.closures.filter(
    (c) =>
      c.scope === "hospital" ||
      (c.scope === "department" &&
        c.departmentId !== null &&
        opts.departmentIds.includes(c.departmentId)) ||
      (c.scope === "clinic" && c.serviceLineId === opts.serviceLineId),
  );
  return (ymd) =>
    relevant.some((c) => c.startsOn <= ymd && ymd <= c.endsOn) ||
    (!opts.runsOnHolidays && holidays.has(ymd));
}

/* ─── Catalogue guards used by the function ─────────────────────────── */

export const isDepartmentCode = (c: string) => CATALOGUE_DEPARTMENTS.some((d) => d.code === c);
export const isClinicCode = (c: string) => CATALOGUE_CLINICS.some((d) => d.code === c);
export const isLabSection = (c: string) => LAB_SECTIONS.some((d) => d.code === c);
export const isImagingCode = (c: string) => IMAGING_ITEMS.some((d) => d.code === c);
export const routingKeys = () => CAPABILITY_KEYS.filter((k) => k.routing).map((k) => k.key);
