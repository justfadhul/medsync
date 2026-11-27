/**
 * Step 10 Plan fixtures (ADR 0184): synthetic, for the styleguide screens, Playwright and the
 * render tests. Patient Three-3 is synthetic; every value here is a fixture, never production data.
 */
import type { DeskDiagnosis, DeskPayload } from "@/components/emr/desk/model";
import type { PlanPayload } from "@/lib/clerking/plan/payload";

import { dxTermUuid, TEST_UUIDS } from "@/lib/clerking/impression/load";

export const PLAN_DX: DeskDiagnosis[] = [
  {
    id: "00000000-0000-4000-8000-00000000c001",
    logicalId: "00000000-0000-4000-8000-00000000d001",
    termId: dxTermUuid("dx.sepsis"),
    display: "Sepsis",
    code: null,
    verification: "provisional",
    rank: "primary",
    restricted: false,
    onProblemList: false,
    cosignPending: false,
  },
  {
    id: "00000000-0000-4000-8000-00000000c002",
    logicalId: "00000000-0000-4000-8000-00000000d002",
    termId: dxTermUuid("dx.meningitis_bacterial"),
    display: "Bacterial meningitis",
    code: null,
    verification: "differential",
    rank: "secondary",
    restricted: false,
    onProblemList: false,
    cosignPending: false,
  },
  {
    id: "00000000-0000-4000-8000-00000000c003",
    logicalId: "00000000-0000-4000-8000-00000000d003",
    termId: dxTermUuid("dx.hypothermia_unexplained"),
    display: "Hypothermia, cause not yet known",
    code: null,
    verification: "provisional",
    rank: "secondary",
    restricted: false,
    onProblemList: false,
    cosignPending: false,
  },
];

/** CARE_REQUESTS on (ADR 0537): the departments the Plan can ask, with synthetic staff. */
export const PLAN_REQUESTS: NonNullable<PlanPayload["requests"]> = {
  departments: [
    {
      id: "00000000-0000-4000-8000-0000000000b1",
      name: "Medicine",
      wardIds: ["00000000-0000-4000-8000-0000000000a3"],
      staff: [
        {
          userId: "00000000-0000-4000-8000-0000000000c1",
          name: "Consultant One",
          cadre: "Consultant",
        },
        {
          userId: "00000000-0000-4000-8000-0000000000c2",
          name: "Registrar Two",
          cadre: "Registrar",
        },
      ],
    },
    {
      id: "00000000-0000-4000-8000-0000000000b2",
      name: "Nephrology",
      wardIds: [],
      staff: [
        {
          userId: "00000000-0000-4000-8000-0000000000c3",
          name: "Consultant Three",
          cadre: "Consultant",
        },
      ],
    },
  ],
  ownDepartmentId: "00000000-0000-4000-8000-0000000000b1",
};

export function planFixture(
  variant: { allergy?: boolean; placed?: boolean; requests?: boolean } = {},
): PlanPayload {
  const at = "2026-09-27T20:10:00.000Z";
  return {
    ...(variant.requests ? { requests: PLAN_REQUESTS } : {}),
    prescribing: true,
    wards: [
      { id: "00000000-0000-4000-8000-0000000000a1", name: "HDU", counts: null },
      { id: "00000000-0000-4000-8000-0000000000a2", name: "ICU", counts: null },
      { id: "00000000-0000-4000-8000-0000000000a3", name: "Medical ward", counts: null },
    ],
    intern: false,
    facts: {
      ageYears: 76,
      weight: { kg: 58, at, source: "triage" },
      creatinine: null,
      glucose: { value: 6.2, at },
      conditions: [],
    },
    cosign: { routine: "allowed", controlled: "cosign_required" },
    bloodCulture: variant.placed ? "ordered" : "none",
    kidneyTestOrdered: false,
    monitoring: null,
    record: {
      orders: variant.placed
        ? [
            {
              id: "00000000-0000-4000-8000-00000000e001",
              display: "Blood culture",
              testKey: "test.blood_culture",
              testId: TEST_UUIDS["test.blood_culture"] ?? null,
              priority: "emergency",
              frequency: null,
              reasonConditionIds: [PLAN_DX[0]!.id],
              at,
              statusText: "To collect",
              open: true,
            },
          ]
        : [],
      prescriptions: [],
      medicines: [
        { id: "00000000-0000-4000-8000-00000000f001", display: "Metformin", answer: "pending" },
        { id: "00000000-0000-4000-8000-00000000f002", display: "Amlodipine", answer: "continued" },
      ],
      charts: [],
      requests: [],
    },
  };
}

/** The Plan screens: the v2 desk payload with the visit's problems and the Plan payload. */
export function withPlanFixture(
  p: DeskPayload,
  variant: { allergy?: boolean; placed?: boolean; requests?: boolean } = {},
): DeskPayload {
  const k = p.clerking!;
  return {
    ...p,
    diagnoses: PLAN_DX,
    plan: planFixture(variant),
    clerking: {
      ...k,
      allergies: variant.allergy
        ? {
            status: "listed",
            touchedThisVisit: false,
            items: [
              {
                id: "a-ceph",
                name: "Cephalosporins",
                coded: false,
                reactions: ["rash"],
                severity: null,
                source: null,
                restricted: false,
                addedHere: false,
              },
            ],
          }
        : { status: "no_known_drug_allergies", touchedThisVisit: true, items: [] },
    },
  };
}
