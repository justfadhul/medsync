/**
 * The profession picker (Onboarding v2, ADR 0123). One option → exactly one
 * (council, cadre, grade | null, generic role) — PRO-1. The council is derived, never chosen;
 * the role is the cadre's generic role and the department comes from the affiliation (PRO-2).
 * Codes match the seed (0009 cadres/grades, 0017 + 0070 generic roles). Client-safe: no imports.
 */

export type CouncilCode = "UMDPC" | "UNMC" | "AHPC" | "PHARM_BOARD";

export const COUNCILS: Record<CouncilCode, { short: string; group: string }> = {
  UMDPC: { short: "UMDPC", group: "Doctors and dentists" },
  UNMC: { short: "UNMC", group: "Nurses and midwives" },
  AHPC: { short: "AHPC", group: "Allied health" },
  PHARM_BOARD: { short: "Pharmacy Board of Uganda", group: "Pharmacy" },
};

export interface Profession {
  id: string;
  label: string;
  council: CouncilCode;
  cadre: string;
  /** Only where the grade changes what the person may do (enrolled vs registered). */
  grade: string | null;
  role: string;
  needsSpecialty?: true;
  helper?: string;
  keywords: string;
}

export const PROFESSIONS: readonly Profession[] = [
  {
    id: "intern-doctor",
    label: "Intern doctor",
    council: "UMDPC",
    cadre: "INTERN_DOCTOR",
    grade: null,
    role: "INTERN_DOCTOR_GENERAL",
    helper: "Interns: your provisional registration number.",
    keywords: "doctor intern",
  },
  {
    id: "medical-officer",
    label: "Medical officer",
    council: "UMDPC",
    cadre: "MEDICAL_OFFICER",
    grade: null,
    role: "MO_GENERAL",
    keywords: "doctor mo physician",
  },
  {
    id: "medical-officer-sg",
    label: "Medical officer (special grade)",
    council: "UMDPC",
    cadre: "MEDICAL_OFFICER_SG",
    grade: null,
    role: "MO_SG_GENERAL",
    keywords: "doctor mosg",
  },
  {
    id: "consultant",
    label: "Consultant",
    council: "UMDPC",
    cadre: "CONSULTANT",
    grade: null,
    role: "CONSULTANT_GENERAL",
    needsSpecialty: true,
    keywords: "doctor specialist physician surgeon",
  },
  {
    id: "senior-consultant",
    label: "Senior consultant",
    council: "UMDPC",
    cadre: "SENIOR_CONSULTANT",
    grade: null,
    role: "SR_CONSULTANT_GENERAL",
    needsSpecialty: true,
    keywords: "doctor specialist physician surgeon",
  },
  {
    id: "dental-officer",
    label: "Dental officer",
    council: "UMDPC",
    cadre: "DENTAL_OFFICER",
    grade: null,
    role: "DENTAL_OFFICER_GENERAL",
    keywords: "dentist dental",
  },
  {
    id: "dental-surgeon",
    label: "Dental surgeon",
    council: "UMDPC",
    cadre: "DENTAL_SURGEON",
    grade: null,
    role: "DENTAL_SURGEON_GENERAL",
    keywords: "dentist dental",
  },
  {
    id: "enrolled-nurse",
    label: "Enrolled nurse",
    council: "UNMC",
    cadre: "NURSE",
    grade: "ENROLLED",
    role: "NURSE_GENERAL",
    keywords: "nurse en",
  },
  {
    id: "registered-nurse",
    label: "Registered nurse",
    council: "UNMC",
    cadre: "NURSE",
    grade: "REGISTERED",
    role: "NURSE_GENERAL",
    keywords: "nurse rn",
  },
  {
    id: "specialist-nurse",
    label: "Specialist nurse",
    council: "UNMC",
    cadre: "SPECIALIST_NURSE",
    grade: null,
    role: "SPECIALIST_NURSE_GENERAL",
    keywords: "nurse specialist",
  },
  {
    id: "enrolled-midwife",
    label: "Enrolled midwife",
    council: "UNMC",
    cadre: "MIDWIFE",
    grade: "ENROLLED",
    role: "MIDWIFE_GENERAL",
    keywords: "midwife",
  },
  {
    id: "registered-midwife",
    label: "Registered midwife",
    council: "UNMC",
    cadre: "MIDWIFE",
    grade: "REGISTERED",
    role: "MIDWIFE_GENERAL",
    keywords: "midwife",
  },
  {
    id: "clinical-officer",
    label: "Clinical officer",
    council: "AHPC",
    cadre: "CLINICAL_OFFICER",
    grade: null,
    role: "CLINICAL_OFFICER_GENERAL",
    keywords: "co clinician",
  },
  {
    id: "lab-technician",
    label: "Laboratory technician",
    council: "AHPC",
    cadre: "LAB_TECH",
    grade: null,
    role: "LAB_TECH_GENERAL",
    keywords: "lab laboratory",
  },
  {
    id: "lab-technologist",
    label: "Laboratory technologist",
    council: "AHPC",
    cadre: "LAB_TECHNOLOGIST",
    grade: null,
    role: "LAB_TECHNOLOGIST_GENERAL",
    keywords: "lab laboratory",
  },
  {
    id: "radiographer",
    label: "Radiographer",
    council: "AHPC",
    cadre: "RADIOGRAPHER",
    grade: null,
    role: "RADIOGRAPHER_GENERAL",
    keywords: "x-ray xray imaging",
  },
  {
    id: "physiotherapist",
    label: "Physiotherapist",
    council: "AHPC",
    cadre: "PHYSIOTHERAPIST",
    grade: null,
    role: "PHYSIOTHERAPIST_GENERAL",
    keywords: "physio",
  },
  {
    id: "occupational-therapist",
    label: "Occupational therapist",
    council: "AHPC",
    cadre: "OCCUPATIONAL_THER",
    grade: null,
    role: "OCC_THERAPIST_GENERAL",
    keywords: "ot",
  },
  {
    id: "nutritionist",
    label: "Nutritionist",
    council: "AHPC",
    cadre: "NUTRITIONIST",
    grade: null,
    role: "NUTRITIONIST_GENERAL",
    keywords: "diet dietitian",
  },
  {
    id: "pharmacist",
    label: "Pharmacist",
    council: "PHARM_BOARD",
    cadre: "PHARMACIST",
    grade: null,
    role: "PHARMACIST_GENERAL",
    keywords: "pharmacy",
  },
  {
    id: "pharmacy-technician",
    label: "Pharmacy technician",
    council: "PHARM_BOARD",
    cadre: "PHARMACY_TECH",
    grade: null,
    role: "PHARMACY_TECH_GENERAL",
    keywords: "pharmacy",
  },
];

export const professionById = (id: string) => PROFESSIONS.find((p) => p.id === id) ?? null;

/** "UNMC registration number" — the label names the derived council (PRO-4). */
export const registrationLabel = (p: Profession) =>
  `${COUNCILS[p.council].short} registration number`;

/** Grades that don't change scope — optional, asked after signup (pending page), not in the form. */
export const PROFILE_GRADES: Record<string, { code: string; label: string }[]> = {
  CLINICAL_OFFICER: [
    { code: "DIPLOMA", label: "Diploma" },
    { code: "DEGREE", label: "Bachelor's" },
  ],
  LAB_TECH: [
    { code: "CERT", label: "Certificate" },
    { code: "DIPLOMA", label: "Diploma" },
  ],
};

/** Non-clinical staff join as one role today; it is shown, not asked (O10). */
export const RECEPTION = {
  cadre: "RECEPTION",
  role: "RECEPTION_OFFICER",
  label: "Reception / Records Officer",
};
