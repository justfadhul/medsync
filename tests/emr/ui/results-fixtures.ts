/**
 * Synthetic payloads for the orders, specimens and results screens (U3): the render tests and the
 * verification agent's scratch harness render these without a database.
 *
 * SYNTHETIC: "Test Patient A/B/C", made-up MRNs and ids; values are illustrative test data, not
 * thresholds. Order states come from the real engine (deriveOrderStatus → orderStatusText), and
 * review values from the real interpretation (interpretResult). The one signed critical
 * reference is TEST-ONLY — it proves the critical style appears only when a signed entry matches.
 * Every shipped REF-CRIT entry is pending_cso, so production shows no critical value today.
 */
import type {
  CollectTarget,
  EncounterOrderRow,
  MenuTest,
  PatientIdentity,
  ReasonOption,
} from "@/components/emr/orders/model";
import type { LabelData } from "@/components/emr/orders/specimen-label";
import type { LabWorkItem } from "@/components/emr/results/lab-worklist-view";
import type {
  EntryComponent,
  ResultEntryData,
  ReviewItem,
  ReviewValue,
} from "@/components/emr/results/model";
import type { CriticalRef } from "@/lib/emr/reference/critical";
import type { ResultValue } from "@/lib/emr/results";

import { deriveOrderStatus, orderStatusText } from "@/lib/emr/orders";
import { interpretResult } from "@/lib/emr/results";

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (iso: string) => new Date(iso);

export const IDENTITY_A: PatientIdentity = {
  name: "Test Patient A",
  mrn: "MRN-2026-90001",
  ageSex: "52 y · Female",
};
export const IDENTITY_B: PatientIdentity = {
  name: "Test Patient B",
  mrn: "MRN-2026-90002",
  ageSex: "34 y · Male",
};
export const IDENTITY_C: PatientIdentity = {
  name: "Test Patient C",
  mrn: "MRN-2026-90003",
  ageSex: "61 y · Female",
};
export const PATIENT = { A: u(1), B: u(2), C: u(3) } as const;

/* ─── The test menu ────────────────────────────────────────────────── */

const test = (n: number, t: Partial<MenuTest> & Pick<MenuTest, "code" | "display">): MenuTest => ({
  id: u(100 + n),
  kind: "lab",
  components: [],
  specimenType: "venous_whole_blood",
  container: "edta",
  fastingRequired: false,
  ionising: false,
  inHouse: true,
  favouriteRank: null,
  availability: "available",
  restricted: false,
  ...t,
});

export const MENU: MenuTest[] = [
  test(1, {
    code: "FBC",
    display: "Full blood count",
    components: ["White cell count", "Haemoglobin", "Platelets", "MCV", "Neutrophils"],
    favouriteRank: 2,
  }),
  test(2, {
    code: "MRDT",
    display: "Malaria rapid diagnostic test (mRDT)",
    components: ["Malaria test"],
    specimenType: "capillary_whole_blood",
    container: "capillary_direct",
    favouriteRank: 1,
  }),
  test(3, {
    code: "FBG",
    display: "Fasting blood glucose",
    components: ["Glucose"],
    specimenType: "venous_plasma",
    container: "fluoride_oxalate",
    fastingRequired: true,
    favouriteRank: 3,
  }),
  test(4, {
    code: "CXR",
    display: "Chest X-ray",
    kind: "imaging",
    specimenType: null,
    container: null,
    ionising: true,
    favouriteRank: 4,
  }),
  test(5, {
    code: "UA",
    display: "Urinalysis (dipstick)",
    components: ["Urine specific gravity", "Urine pH"],
    specimenType: "urine_spot",
    container: null,
  }),
  test(6, {
    code: "HIV",
    display: "HIV rapid test",
    specimenType: "capillary_whole_blood",
    container: "capillary_direct",
    restricted: true,
    availability: "intermittent",
  }),
];
export const MENU_BY_CODE = Object.fromEntries(MENU.map((t) => [t.code, t])) as Record<
  string,
  MenuTest
>;

export const REASONS: ReasonOption[] = [
  { id: u(201), display: "Malaria, uncomplicated", primary: true, restricted: false },
  { id: u(202), display: "Anaemia", primary: false, restricted: false },
];

/* ─── Collection ───────────────────────────────────────────────────── */

export const COLLECT_FBC: CollectTarget = {
  orderId: u(301),
  display: "Full blood count",
  priority: "urgent",
  specimenType: "venous_whole_blood",
  container: "edta",
  needsFasting: false,
  rejection: null,
};
export const COLLECT_FBG_REJECTED: CollectTarget = {
  orderId: u(302),
  display: "Fasting blood glucose",
  priority: "routine",
  specimenType: "venous_plasma",
  container: "fluoride_oxalate",
  needsFasting: true,
  rejection: "Rejected: haemolysed — recollect",
};
export const COLLECT_URINE: CollectTarget = {
  orderId: u(303),
  display: "Urinalysis (dipstick)",
  priority: "routine",
  specimenType: "urine_spot",
  container: null,
  needsFasting: false,
  rejection: null,
};

/** A lab order whose specimen the laboratory rejected, through the real engine. */
export function rejectedOrderStatusText(): string {
  const order = { id: u(302), lifecycle: "events", status: "ordered", kind: "lab" };
  const { status } = deriveOrderStatus(order, {
    events: [
      {
        orderId: u(302),
        kind: "placed",
        reasonCode: null,
        reasonCiphertext: null,
        recordedAt: at("2026-09-26T07:00:00Z"),
      },
    ],
    specimens: [{ id: u(401), orderId: u(302), recordedAt: at("2026-09-26T07:10:00Z") }],
    specimenEvents: [
      {
        specimenId: u(401),
        kind: "rejected",
        reasonCode: "haemolysed",
        recordedAt: at("2026-09-26T07:40:00Z"),
      },
    ],
  });
  return orderStatusText(status, "lab");
}

export function encounterOrders(): EncounterOrderRow[] {
  return [
    {
      id: u(302),
      display: "Fasting blood glucose",
      kind: "lab",
      priority: "routine",
      orderedAtIso: "2026-09-26T07:00:00Z",
      requesterName: "Dr Test Clinician",
      statusText: rejectedOrderStatusText(),
      caution: true,
      restricted: false,
      collect: COLLECT_FBG_REJECTED,
      specimenId: u(401),
      canTranscribe: true,
    },
    {
      id: u(304),
      display: "Full blood count",
      kind: "lab",
      priority: "urgent",
      orderedAtIso: "2026-09-26T07:05:00Z",
      requesterName: "Dr Test Clinician",
      statusText: "Collected",
      caution: false,
      restricted: false,
      collect: null,
      specimenId: u(402),
      canTranscribe: true,
    },
    {
      id: u(305),
      display: "Chest X-ray",
      kind: "imaging",
      priority: "routine",
      orderedAtIso: "2026-09-26T07:06:00Z",
      requesterName: null,
      statusText: "Ordered",
      caution: false,
      restricted: false,
      collect: null,
      specimenId: null,
      canTranscribe: true,
    },
  ];
}

export const LABEL: LabelData = {
  identity: IDENTITY_A,
  dob: "03 Feb 1974",
  test: "Full blood count",
  container: "EDTA",
  collectedAt: "26 Sept 2026 10:44",
  requisitionNo: "R-0001234",
  priority: "Urgent",
  labelNo: null,
};

/* ─── Result entry ─────────────────────────────────────────────────── */

const q = (conceptId: string, display: string, defaultUnit: string | null): EntryComponent => ({
  conceptId,
  display,
  valueType: "quantity",
  answers: [],
  defaultUnit,
  bounds: [],
});

/** Five analytes on one screen (gate-a E.9); units default from the test menu (seed). */
export const FBC_COMPONENTS: EntryComponent[] = [
  q("obs.wbc", "White cell count", "10*9/L"),
  q("obs.haemoglobin", "Haemoglobin", "g/dL"),
  q("obs.platelets", "Platelets", "10*9/L"),
  q("obs.mcv", "MCV", "fL"),
  q("obs.neutrophils_abs", "Neutrophils", "10*9/L"),
];

const entry = (over: Partial<ResultEntryData>): ResultEntryData => ({
  orderId: u(304),
  patientUserId: PATIENT.A,
  identity: IDENTITY_A,
  test: "Full blood count",
  kind: "lab",
  requisitionNo: "R-0001234",
  priority: "urgent",
  mode: "direct",
  components: FBC_COMPONENTS,
  report: null,
  communicate: null,
  ...over,
});

export const ENTRY_FBC_LAB = entry({});
export const ENTRY_FBC_TRANSCRIBED = entry({ mode: "transcribed" });
export const ENTRY_MRDT = entry({
  orderId: u(306),
  test: "Malaria rapid diagnostic test (mRDT)",
  components: [
    {
      conceptId: "obs.malaria_test",
      display: "Malaria test",
      valueType: "coded",
      answers: [
        { code: "positive", label: "Positive" },
        { code: "negative", label: "Negative" },
      ],
      defaultUnit: null,
      bounds: [],
    },
  ],
});
export const ENTRY_CXR = entry({
  orderId: u(305),
  test: "Chest X-ray",
  kind: "imaging",
  components: [],
  mode: "transcribed",
});
export const ENTRY_RELEASED_CRITICAL = entry({
  orderId: u(307),
  test: "Urea, electrolytes and creatinine",
  components: [q("obs.potassium", "Potassium", "mmol/L")],
  report: {
    id: u(501),
    status: "final",
    released: true,
    critical: true,
    lines: {
      "obs.potassium": {
        value: "7.1",
        unit: "mmol/L",
        code: "",
        low: "",
        high: "",
        flag: "HH",
        unitConfirmed: true,
      },
    },
    uncatalogued: [],
    conclusionCode: null,
  },
  communicate: {
    reportId: u(501),
    ordererUserId: u(901),
    people: [
      { userId: u(901), name: "Dr Test Clinician" },
      { userId: u(902), name: "Dr Test Cover" },
    ],
  },
});

/* ─── Review ───────────────────────────────────────────────────────── */

/** TEST-ONLY: a signed entry so the critical style has something to show. Never shipped. */
export const TEST_ONLY_CRITICAL: CriticalRef = {
  id: "TEST-ONLY-CRIT-K-U3",
  text: "test only — proves the mechanism",
  value: "6.5",
  source: "TEST",
  url: "test",
  verifiedOn: "2026-09-26",
  confidence: "design",
  status: "signed",
  conceptId: "obs.potassium",
  operator: ">",
};

/** A review value through the real interpretation; `refs` decides what is critical. */
export function reviewValue(
  key: string,
  display: string,
  v: Partial<ResultValue> & { valueNum: string; valueUnit: string },
  refs: readonly CriticalRef[] = [],
): ReviewValue {
  const value: ResultValue = {
    conceptId: null,
    valueComparator: null,
    valueCanonical: v.valueNum,
    context: {},
    ...v,
  };
  const i = interpretResult(value, { criticalRefs: refs });
  return {
    key,
    display,
    valueText: `${value.valueComparator ?? ""}${value.valueNum}`,
    unit: value.valueUnit,
    flagText: i.flag.text,
    critical: i.critical.isCritical,
    uncatalogued: false,
  };
}

export function reviewItems(): ReviewItem[] {
  const k = reviewValue(
    "k",
    "Potassium",
    {
      conceptId: "obs.potassium",
      valueNum: "7.1",
      valueUnit: "mmol/L",
      context: { labInterpretation: "HH" },
    },
    [TEST_ONLY_CRITICAL],
  );
  const kShipped = reviewValue("k2", "Potassium", {
    conceptId: "obs.potassium",
    valueNum: "7.1",
    valueUnit: "mmol/L",
    context: { labInterpretation: "HH" },
  });
  const creat = reviewValue("cr", "Creatinine", {
    conceptId: "obs.creatinine",
    valueNum: "148",
    valueUnit: "umol/L",
    context: { referenceRange: { low: 45, high: 90, unit: "umol/L", source: "lab" } },
  });
  return [
    {
      reportId: u(601),
      patientUserId: PATIENT.C,
      identity: IDENTITY_C,
      test: "Creatinine",
      releasedAtIso: "2026-09-26T08:02:00Z",
      state: "needs_re_ack",
      critical: false,
      restricted: false,
      values: [creat],
      conclusion: null,
      encounterId: u(701),
    },
    {
      reportId: u(602),
      patientUserId: PATIENT.B,
      identity: IDENTITY_B,
      test: "Malaria rapid diagnostic test (mRDT)",
      releasedAtIso: "2026-09-26T07:20:00Z",
      state: "needs_review",
      critical: false,
      restricted: false,
      values: [
        {
          key: "m",
          display: "Malaria test",
          valueText: "Positive",
          unit: null,
          flagText: "Lab flag: abnormal",
          critical: false,
          uncatalogued: false,
        },
        {
          key: "x",
          display: "Malaria antigen line (as typed)",
          valueText: "faint",
          unit: null,
          flagText: null,
          critical: false,
          uncatalogued: true,
        },
      ],
      conclusion: null,
      encounterId: u(702),
    },
    {
      reportId: u(603),
      patientUserId: PATIENT.A,
      identity: IDENTITY_A,
      test: "Urea, electrolytes and creatinine",
      releasedAtIso: "2026-09-26T07:31:00Z",
      state: "needs_review",
      critical: k.critical,
      restricted: false,
      values: [k],
      conclusion: null,
      encounterId: u(703),
    },
    {
      reportId: u(604),
      patientUserId: PATIENT.A,
      identity: IDENTITY_A,
      test: "Potassium (as shipped: no signed entry)",
      releasedAtIso: "2026-09-26T07:40:00Z",
      state: "needs_review",
      critical: kShipped.critical,
      restricted: false,
      values: [kShipped],
      conclusion: null,
      encounterId: u(703),
    },
    {
      reportId: u(605),
      patientUserId: PATIENT.B,
      identity: IDENTITY_B,
      test: "Chest X-ray",
      releasedAtIso: "2026-09-26T06:50:00Z",
      state: "needs_review",
      critical: false,
      restricted: false,
      values: [],
      conclusion: { code: "abnormal", text: "Right lower zone opacity (synthetic)." },
      encounterId: u(702),
    },
  ];
}

export const STAFF = [
  { userId: u(901), name: "Dr Test Clinician" },
  { userId: u(902), name: "Dr Test Cover" },
];

/* ─── The lab worklist ─────────────────────────────────────────────── */

export const LAB_ITEMS: LabWorkItem[] = [
  {
    orderId: u(304),
    patientUserId: PATIENT.A,
    identity: IDENTITY_A,
    test: "Full blood count",
    priority: "urgent",
    restricted: false,
    orderedAtIso: "2026-09-26T07:05:00Z",
    stage: "awaiting_receipt",
    statusText: "Collected",
    specimenId: u(402),
    reportId: null,
  },
  {
    orderId: u(306),
    patientUserId: PATIENT.B,
    identity: IDENTITY_B,
    test: "Malaria rapid diagnostic test (mRDT)",
    priority: "routine",
    restricted: false,
    orderedAtIso: "2026-09-26T06:40:00Z",
    stage: "preliminary",
    statusText: "Preliminary result",
    specimenId: u(403),
    reportId: u(502),
  },
];

export const REJECTION_REASONS = [
  { value: "haemolysed", label: "Haemolysed" },
  { value: "clotted", label: "Clotted" },
  { value: "insufficient", label: "Insufficient" },
  { value: "unlabelled_or_mislabelled", label: "Unlabelled or mislabelled" },
  { value: "wrong_container", label: "Wrong container" },
  { value: "delayed", label: "Delayed" },
];
