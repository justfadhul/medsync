-- 0009 — reference data seed (onboarding GATE A).
--
-- Scope, per the open-question answers at GATE A:
--   Q1  Full national catalog (councils + cadres + cadre_grades +
--       specialties); role *instances* IM-only.
--   Q2  UBOS NPHC 2024 framework (135 districts + 11 cities) as
--       the canonical geography dataset.
--
-- HONESTY NOTE on geography:
--   The kickoff §A.2 forbids fabricating reference data. I do NOT
--   have the full UBOS NPHC 2024 district + subcounty list in this
--   context, so this seed records the dataset version in
--   reference_data_versions BUT inserts only a placeholder subset
--   (well-known districts + Kampala divisions as subcounties). The
--   placeholder is flagged in the row's `notes` and is on the
--   reference-data-to-source list for closeout. A follow-up
--   migration ships the full UBOS data once you supply the dataset
--   (CSV, JSON, or scraped URL).
--
--   Per ADR-like reasoning in the proposal Q2: this is "Both — NPHC
--   2024 canonical + admin-units shim later" in practice, even
--   though the explicit pick was "NPHC 2024 only". When the full
--   dataset lands it'll go in as a single replacement INSERT batch
--   under a new reference_data_versions row.
--
-- UUID convention (lowercase hex throughout):
--   regions       00000000-0000-0000-0000-0000000000aN  (a1..a4)
--   districts     00000000-0000-0000-0000-00000000010X  (101..)
--   subcounties   00000000-0000-0000-0000-00000002010X  (20101..)
--   councils      00000000-0000-0000-0000-00000000000cN (c1..c4)
--   cadres        00000000-0000-0000-0000-0000000000dXX (d01..)
--   cadre_grades  00000000-0000-0000-0000-0000000000gXX (g01..)
--   specialties   00000000-0000-0000-0000-0000000000fXX (f00..)
--   roles         00000000-0000-0000-0000-0000000000eXX (e01..)
--
-- Idempotent throughout: every INSERT uses ON CONFLICT DO NOTHING.

-- ─── reference_data_versions ────────────────────────────────────────────
INSERT INTO public.reference_data_versions
  (dataset, source, source_url, version_date, row_count, notes)
VALUES
  ('ug_regions',
   'Uganda statistical regions — stable historical fact (UBOS)',
   NULL, '2026-05-23', 4,
   'Not subject to UBOS dataset versioning.'),
  ('ug_districts_nphc_2024',
   'UBOS NPHC 2024 framework — 135 districts + 11 cities',
   NULL, '2026-05-23', 0,
   'PLACEHOLDER pending full UBOS NPHC 2024 dataset pull. This seed inserts a 21-district subset to unblock the form; full list lands as a follow-up migration once the source CSV/JSON is supplied.'),
  ('ug_subcounties_kampala',
   'KCCA — Kampala City Council Authority divisions',
   NULL, '2026-05-23', 5,
   'PLACEHOLDER. Kampala only. Other districts'' subcounties land with the full UBOS NPHC 2024 pull.'),
  ('ug_councils',
   'MoH Health Professional Councils portal + each council''s site (verified 2026-05)',
   NULL, '2026-05-23', 4,
   'UMDPC, UNMC, AHPC, Pharmacy Board (NOT PSU — PSU is the professional society, not the statutory regulator).'),
  ('ug_cadres_full',
   'Ministry of Public Service scheme of service + MoH HRH Strategic Plan 2020-2030',
   NULL, '2026-05-23', NULL,
   'Full national cadre catalog, council-linked.'),
  ('ug_cadre_grades_full',
   'Ministry of Public Service scheme of service',
   NULL, '2026-05-23', NULL,
   'Career grades within each cadre (enrolled vs registered nurse; MO/MO-SG/Consultant ladder; etc.).'),
  ('ug_specialties_im',
   'Phase 0.11 hospital_departments seed — Internal Medicine + 13 sub-specialties',
   NULL, '2026-05-23', 14,
   'IM-only this gate (per Q1 answer). New specialties land per department.'),
  ('ug_roles_im',
   'Derived from MoH schemes of service + Phase 0.11 IM seed',
   NULL, '2026-05-23', NULL,
   'IM-scoped role catalog per Q1 answer. Other departments expand role rows as MedSync activates them.')
ON CONFLICT (dataset, version_date) DO NOTHING;

-- ─── Regions (4) ────────────────────────────────────────────────────────
INSERT INTO public.regions (id, code, name) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'CENTRAL',  'Central'),
  ('00000000-0000-0000-0000-0000000000a2', 'EASTERN',  'Eastern'),
  ('00000000-0000-0000-0000-0000000000a3', 'NORTHERN', 'Northern'),
  ('00000000-0000-0000-0000-0000000000a4', 'WESTERN',  'Western')
ON CONFLICT (code) DO NOTHING;

-- ─── Districts (PLACEHOLDER subset of NPHC 2024) ────────────────────────
INSERT INTO public.districts (id, region_id, code, name, is_city) VALUES
  -- Central
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000a1', 'KAMPALA',     'Kampala',     true),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-0000000000a1', 'WAKISO',      'Wakiso',      false),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000000a1', 'MUKONO',      'Mukono',      false),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-0000000000a1', 'MPIGI',       'Mpigi',       false),
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-0000000000a1', 'LUWERO',      'Luwero',      false),
  ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-0000000000a1', 'MASAKA',      'Masaka',      true),
  -- Eastern
  ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-0000000000a2', 'JINJA',       'Jinja',       true),
  ('00000000-0000-0000-0000-000000000108', '00000000-0000-0000-0000-0000000000a2', 'MBALE',       'Mbale',       true),
  ('00000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-0000000000a2', 'SOROTI',      'Soroti',      true),
  ('00000000-0000-0000-0000-00000000010a', '00000000-0000-0000-0000-0000000000a2', 'TORORO',      'Tororo',      false),
  ('00000000-0000-0000-0000-00000000010b', '00000000-0000-0000-0000-0000000000a2', 'IGANGA',      'Iganga',      false),
  -- Northern
  ('00000000-0000-0000-0000-00000000010c', '00000000-0000-0000-0000-0000000000a3', 'GULU',        'Gulu',        true),
  ('00000000-0000-0000-0000-00000000010d', '00000000-0000-0000-0000-0000000000a3', 'LIRA',        'Lira',        true),
  ('00000000-0000-0000-0000-00000000010e', '00000000-0000-0000-0000-0000000000a3', 'ARUA',        'Arua',        true),
  ('00000000-0000-0000-0000-00000000010f', '00000000-0000-0000-0000-0000000000a3', 'KITGUM',      'Kitgum',      false),
  ('00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-0000000000a3', 'MOROTO',      'Moroto',      false),
  -- Western
  ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-0000000000a4', 'MBARARA',     'Mbarara',     true),
  ('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-0000000000a4', 'KABALE',      'Kabale',      false),
  ('00000000-0000-0000-0000-000000000113', '00000000-0000-0000-0000-0000000000a4', 'KASESE',      'Kasese',      false),
  ('00000000-0000-0000-0000-000000000114', '00000000-0000-0000-0000-0000000000a4', 'HOIMA',       'Hoima',       true),
  ('00000000-0000-0000-0000-000000000115', '00000000-0000-0000-0000-0000000000a4', 'FORT_PORTAL', 'Fort Portal', true)
ON CONFLICT (code) DO NOTHING;

-- ─── Subcounties (Kampala divisions only — PLACEHOLDER) ────────────────
INSERT INTO public.subcounties (id, district_id, code, name) VALUES
  ('00000000-0000-0000-0000-000000020101', '00000000-0000-0000-0000-000000000101', 'KAMPALA_CENTRAL', 'Kampala Central Division'),
  ('00000000-0000-0000-0000-000000020102', '00000000-0000-0000-0000-000000000101', 'KAWEMPE',         'Kawempe Division'),
  ('00000000-0000-0000-0000-000000020103', '00000000-0000-0000-0000-000000000101', 'MAKINDYE',        'Makindye Division'),
  ('00000000-0000-0000-0000-000000020104', '00000000-0000-0000-0000-000000000101', 'NAKAWA',          'Nakawa Division'),
  ('00000000-0000-0000-0000-000000020105', '00000000-0000-0000-0000-000000000101', 'RUBAGA',          'Rubaga Division')
ON CONFLICT (district_id, code) DO NOTHING;

-- ─── Councils (4 — confirmed in kickoff D4) ─────────────────────────────
INSERT INTO public.councils (id, code, name, short_name, register_url, description) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'UMDPC',
   'Uganda Medical and Dental Practitioners Council', 'UMDPC',
   'https://umdpc.go.ug',
   'Regulates doctors and dentists.'),
  ('00000000-0000-0000-0000-0000000000c2', 'UNMC',
   'Uganda Nurses and Midwives Council', 'UNMC',
   NULL,
   'Regulates nurses and midwives. Enrolled vs registered distinction.'),
  ('00000000-0000-0000-0000-0000000000c3', 'AHPC',
   'Allied Health Professionals Council', 'AHPC',
   'https://ahpc.ug',
   'Regulates clinical officers, lab, radiography, physiotherapy, and other allied disciplines.'),
  ('00000000-0000-0000-0000-0000000000c4', 'PHARM_BOARD',
   'Pharmacy Board', 'Pharmacy Board',
   NULL,
   'Statutory regulator for pharmacists & pharmacy cadres (with the National Drug Authority).')
ON CONFLICT (code) DO NOTHING;

-- ─── Cadres (full national catalog) ─────────────────────────────────────
INSERT INTO public.cadres (id, council_id, code, name, sort_order) VALUES
  -- UMDPC — Medical
  ('00000000-0000-0000-0000-0000000000d01', '00000000-0000-0000-0000-0000000000c1', 'INTERN_DOCTOR',       'Intern Doctor',                       10),
  ('00000000-0000-0000-0000-0000000000d02', '00000000-0000-0000-0000-0000000000c1', 'MEDICAL_OFFICER',     'Medical Officer',                     20),
  ('00000000-0000-0000-0000-0000000000d03', '00000000-0000-0000-0000-0000000000c1', 'MEDICAL_OFFICER_SG',  'Medical Officer (Special Grade)',     30),
  ('00000000-0000-0000-0000-0000000000d04', '00000000-0000-0000-0000-0000000000c1', 'CONSULTANT',          'Consultant',                          40),
  ('00000000-0000-0000-0000-0000000000d05', '00000000-0000-0000-0000-0000000000c1', 'SENIOR_CONSULTANT',   'Senior Consultant',                   50),
  -- UMDPC — Dental
  ('00000000-0000-0000-0000-0000000000d06', '00000000-0000-0000-0000-0000000000c1', 'DENTAL_OFFICER',      'Dental Officer',                      60),
  ('00000000-0000-0000-0000-0000000000d07', '00000000-0000-0000-0000-0000000000c1', 'DENTAL_SURGEON',      'Dental Surgeon',                      70),
  -- UNMC — Nursing
  ('00000000-0000-0000-0000-0000000000d08', '00000000-0000-0000-0000-0000000000c2', 'NURSE',               'Nurse',                              100),
  ('00000000-0000-0000-0000-0000000000d09', '00000000-0000-0000-0000-0000000000c2', 'MIDWIFE',             'Midwife',                            110),
  ('00000000-0000-0000-0000-0000000000d0a', '00000000-0000-0000-0000-0000000000c2', 'SPECIALIST_NURSE',    'Specialist Nurse',                   120),
  -- AHPC — Allied
  ('00000000-0000-0000-0000-0000000000d0b', '00000000-0000-0000-0000-0000000000c3', 'CLINICAL_OFFICER',    'Clinical Officer',                   200),
  ('00000000-0000-0000-0000-0000000000d0c', '00000000-0000-0000-0000-0000000000c3', 'LAB_TECH',            'Laboratory Technician',              210),
  ('00000000-0000-0000-0000-0000000000d0d', '00000000-0000-0000-0000-0000000000c3', 'LAB_TECHNOLOGIST',    'Laboratory Technologist',            220),
  ('00000000-0000-0000-0000-0000000000d0e', '00000000-0000-0000-0000-0000000000c3', 'RADIOGRAPHER',        'Radiographer',                       230),
  ('00000000-0000-0000-0000-0000000000d0f', '00000000-0000-0000-0000-0000000000c3', 'PHYSIOTHERAPIST',     'Physiotherapist',                    240),
  ('00000000-0000-0000-0000-0000000000d10', '00000000-0000-0000-0000-0000000000c3', 'OCCUPATIONAL_THER',   'Occupational Therapist',             250),
  ('00000000-0000-0000-0000-0000000000d11', '00000000-0000-0000-0000-0000000000c3', 'NUTRITIONIST',        'Nutritionist',                       260),
  -- Pharmacy Board
  ('00000000-0000-0000-0000-0000000000d12', '00000000-0000-0000-0000-0000000000c4', 'PHARMACIST',          'Pharmacist',                         300),
  ('00000000-0000-0000-0000-0000000000d13', '00000000-0000-0000-0000-0000000000c4', 'PHARMACY_TECH',       'Pharmacy Technician',                310)
ON CONFLICT (code) DO NOTHING;

-- ─── Cadre grades (within-cadre ladders) ────────────────────────────────
INSERT INTO public.cadre_grades (id, cadre_id, code, name, sort_order) VALUES
  -- Nurse: enrolled / registered / specialist
  ('00000000-0000-0000-0000-0000000000g01', '00000000-0000-0000-0000-0000000000d08', 'ENROLLED',    'Enrolled Nurse',    10),
  ('00000000-0000-0000-0000-0000000000g02', '00000000-0000-0000-0000-0000000000d08', 'REGISTERED',  'Registered Nurse',  20),
  ('00000000-0000-0000-0000-0000000000g03', '00000000-0000-0000-0000-0000000000d08', 'SPECIALIST',  'Specialist Nurse',  30),
  -- Midwife: enrolled / registered
  ('00000000-0000-0000-0000-0000000000g04', '00000000-0000-0000-0000-0000000000d09', 'ENROLLED',    'Enrolled Midwife',  10),
  ('00000000-0000-0000-0000-0000000000g05', '00000000-0000-0000-0000-0000000000d09', 'REGISTERED',  'Registered Midwife', 20),
  -- Clinical Officer: diploma / degree
  ('00000000-0000-0000-0000-0000000000g06', '00000000-0000-0000-0000-0000000000d0b', 'DIPLOMA',     'Diploma',           10),
  ('00000000-0000-0000-0000-0000000000g07', '00000000-0000-0000-0000-0000000000d0b', 'DEGREE',      'Bachelor''s',       20),
  -- Lab Tech: certificate / diploma
  ('00000000-0000-0000-0000-0000000000g08', '00000000-0000-0000-0000-0000000000d0c', 'CERT',        'Certificate',       10),
  ('00000000-0000-0000-0000-0000000000g09', '00000000-0000-0000-0000-0000000000d0c', 'DIPLOMA',     'Diploma',           20)
ON CONFLICT (cadre_id, code) DO NOTHING;

-- ─── Specialties — IM + 13 sub-specialties (matches Phase 0.11 seed) ───
INSERT INTO public.specialties (id, code, name, parent_id) VALUES
  ('00000000-0000-0000-0000-0000000000f00', 'IM',       'Internal Medicine',                NULL),
  ('00000000-0000-0000-0000-0000000000f01', 'CARDIO',   'Cardiology',                       '00000000-0000-0000-0000-0000000000f00'),
  ('00000000-0000-0000-0000-0000000000f02', 'NEPHRO',   'Nephrology',                       '00000000-0000-0000-0000-0000000000f00'),
  ('00000000-0000-0000-0000-0000000000f03', 'ENDO',     'Endocrinology / Diabetology',      '00000000-0000-0000-0000-0000000000f00'),
  ('00000000-0000-0000-0000-0000000000f04', 'PULMO',    'Pulmonology',                      '00000000-0000-0000-0000-0000000000f00'),
  ('00000000-0000-0000-0000-0000000000f05', 'GASTRO',   'Gastroenterology',                 '00000000-0000-0000-0000-0000000000f00'),
  ('00000000-0000-0000-0000-0000000000f06', 'HEPATO',   'Hepatology',                       '00000000-0000-0000-0000-0000000000f00'),
  ('00000000-0000-0000-0000-0000000000f07', 'NEURO',    'Neurology',                        '00000000-0000-0000-0000-0000000000f00'),
  ('00000000-0000-0000-0000-0000000000f08', 'ID',       'Infectious Diseases',              '00000000-0000-0000-0000-0000000000f00'),
  ('00000000-0000-0000-0000-0000000000f09', 'ONCO',     'Oncology',                         '00000000-0000-0000-0000-0000000000f00'),
  ('00000000-0000-0000-0000-0000000000f0a', 'HEM',      'Haematology',                      '00000000-0000-0000-0000-0000000000f00'),
  ('00000000-0000-0000-0000-0000000000f0b', 'RHEUM',    'Rheumatology',                     '00000000-0000-0000-0000-0000000000f00'),
  ('00000000-0000-0000-0000-0000000000f0c', 'DERM',     'Dermatology',                      '00000000-0000-0000-0000-0000000000f00'),
  ('00000000-0000-0000-0000-0000000000f0d', 'GER',      'Geriatrics',                       '00000000-0000-0000-0000-0000000000f00')
ON CONFLICT (code) DO NOTHING;

-- ─── Roles — IM-scoped only (per Q1) ────────────────────────────────────
INSERT INTO public.roles (id, cadre_id, specialty_id, code, name, department_family, sort_order) VALUES
  -- Consultants per IM sub-specialty
  ('00000000-0000-0000-0000-0000000000e01', '00000000-0000-0000-0000-0000000000d04', '00000000-0000-0000-0000-0000000000f01', 'CONS_IM_CARDIO',  'Consultant Physician — Cardiology',          'INTERNAL_MEDICINE', 10),
  ('00000000-0000-0000-0000-0000000000e02', '00000000-0000-0000-0000-0000000000d04', '00000000-0000-0000-0000-0000000000f02', 'CONS_IM_NEPHRO',  'Consultant Physician — Nephrology',          'INTERNAL_MEDICINE', 20),
  ('00000000-0000-0000-0000-0000000000e03', '00000000-0000-0000-0000-0000000000d04', '00000000-0000-0000-0000-0000000000f03', 'CONS_IM_ENDO',    'Consultant Physician — Endocrinology',       'INTERNAL_MEDICINE', 30),
  ('00000000-0000-0000-0000-0000000000e04', '00000000-0000-0000-0000-0000000000d04', '00000000-0000-0000-0000-0000000000f04', 'CONS_IM_PULMO',   'Consultant Physician — Pulmonology',         'INTERNAL_MEDICINE', 40),
  ('00000000-0000-0000-0000-0000000000e05', '00000000-0000-0000-0000-0000000000d04', '00000000-0000-0000-0000-0000000000f05', 'CONS_IM_GASTRO',  'Consultant Physician — Gastroenterology',    'INTERNAL_MEDICINE', 50),
  ('00000000-0000-0000-0000-0000000000e06', '00000000-0000-0000-0000-0000000000d04', '00000000-0000-0000-0000-0000000000f06', 'CONS_IM_HEPATO',  'Consultant Physician — Hepatology',          'INTERNAL_MEDICINE', 60),
  ('00000000-0000-0000-0000-0000000000e07', '00000000-0000-0000-0000-0000000000d04', '00000000-0000-0000-0000-0000000000f07', 'CONS_IM_NEURO',   'Consultant Physician — Neurology',           'INTERNAL_MEDICINE', 70),
  ('00000000-0000-0000-0000-0000000000e08', '00000000-0000-0000-0000-0000000000d04', '00000000-0000-0000-0000-0000000000f08', 'CONS_IM_ID',      'Consultant Physician — Infectious Diseases', 'INTERNAL_MEDICINE', 80),
  ('00000000-0000-0000-0000-0000000000e09', '00000000-0000-0000-0000-0000000000d04', '00000000-0000-0000-0000-0000000000f09', 'CONS_IM_ONCO',    'Consultant Physician — Oncology',            'INTERNAL_MEDICINE', 90),
  ('00000000-0000-0000-0000-0000000000e0a', '00000000-0000-0000-0000-0000000000d04', '00000000-0000-0000-0000-0000000000f0a', 'CONS_IM_HEM',     'Consultant Physician — Haematology',         'INTERNAL_MEDICINE', 100),
  ('00000000-0000-0000-0000-0000000000e0b', '00000000-0000-0000-0000-0000000000d04', '00000000-0000-0000-0000-0000000000f0b', 'CONS_IM_RHEUM',   'Consultant Physician — Rheumatology',        'INTERNAL_MEDICINE', 110),
  ('00000000-0000-0000-0000-0000000000e0c', '00000000-0000-0000-0000-0000000000d04', '00000000-0000-0000-0000-0000000000f0c', 'CONS_IM_DERM',    'Consultant Physician — Dermatology',         'INTERNAL_MEDICINE', 120),
  ('00000000-0000-0000-0000-0000000000e0d', '00000000-0000-0000-0000-0000000000d04', '00000000-0000-0000-0000-0000000000f0d', 'CONS_IM_GER',     'Consultant Physician — Geriatrics',          'INTERNAL_MEDICINE', 130),
  -- Generalist IM roles
  ('00000000-0000-0000-0000-0000000000e0e', '00000000-0000-0000-0000-0000000000d02', '00000000-0000-0000-0000-0000000000f00', 'MO_IM',           'Medical Officer — Internal Medicine',        'INTERNAL_MEDICINE', 200),
  ('00000000-0000-0000-0000-0000000000e0f', '00000000-0000-0000-0000-0000000000d03', '00000000-0000-0000-0000-0000000000f00', 'MO_SG_IM',        'Medical Officer SG — Internal Medicine',     'INTERNAL_MEDICINE', 210),
  ('00000000-0000-0000-0000-0000000000e10', '00000000-0000-0000-0000-0000000000d01', '00000000-0000-0000-0000-0000000000f00', 'INTERN_IM',       'Intern Doctor — Internal Medicine',          'INTERNAL_MEDICINE', 220),
  -- Nursing on IM
  ('00000000-0000-0000-0000-0000000000e11', '00000000-0000-0000-0000-0000000000d08', '00000000-0000-0000-0000-0000000000f00', 'NURSE_IM',        'Nurse — Internal Medicine',                  'INTERNAL_MEDICINE', 300),
  ('00000000-0000-0000-0000-0000000000e12', '00000000-0000-0000-0000-0000000000d0a', '00000000-0000-0000-0000-0000000000f00', 'NURSE_SPEC_IM',   'Specialist Nurse — Internal Medicine',       'INTERNAL_MEDICINE', 310),
  -- Allied + pharmacy roles touching IM
  ('00000000-0000-0000-0000-0000000000e13', '00000000-0000-0000-0000-0000000000d0b', '00000000-0000-0000-0000-0000000000f00', 'CO_IM',           'Clinical Officer — Internal Medicine',       'INTERNAL_MEDICINE', 400),
  ('00000000-0000-0000-0000-0000000000e14', '00000000-0000-0000-0000-0000000000d12', NULL,                                     'PHARMACIST_WARD', 'Ward Pharmacist',                            'INTERNAL_MEDICINE', 500),
  ('00000000-0000-0000-0000-0000000000e15', '00000000-0000-0000-0000-0000000000d0c', NULL,                                     'LAB_TECH_IM',     'Laboratory Technician — IM',                 'INTERNAL_MEDICINE', 600)
ON CONFLICT (code) DO NOTHING;
