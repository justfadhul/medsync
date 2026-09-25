import type {
  Acuity,
  FlowEncounter,
  FlowIdentity,
  FlowInput,
  FlowIntake,
  FlowResus,
  FlowTriage,
} from "@/lib/workspace/flow";

/**
 * Builders for the flow projection's input. Defaults describe a quiet
 * Internal Medicine morning at Test Hospital-1; each test states only the
 * facts it is about.
 */

export const ME = "doc-me";
export const OTHER_DOC = "doc-okello";
export const IM = "dept-im";
export const SURGERY = "dept-surgery";

/** 24 Sep 2026, 11:10 in Kampala (UTC+3). */
export const NOW = Date.parse("2026-09-24T08:10:00Z");
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
/** Local midnight, 24 Sep, Kampala. */
export const DAY_START = Date.parse("2026-09-23T21:00:00Z");

export function identity(code: string, over: Partial<FlowIdentity> = {}): FlowIdentity {
  return { name: `Patient ${code}`, code, ageYears: 40, sex: "male", unknownLabel: null, ...over };
}

export function intake(
  id: string,
  patientId: string | null,
  over: Partial<FlowIntake> = {},
): FlowIntake {
  return {
    id,
    patientId,
    status: "awaiting_triage",
    departmentId: IM,
    appointmentId: null,
    presentAtMs: NOW - 20 * MIN,
    complaint: null,
    entryType: "Walk-in",
    isEmergency: false,
    unknownLabel: null,
    ...over,
  };
}

export function triage(
  id: string,
  intakeId: string | null,
  patientId: string | null,
  level: Acuity,
  over: Partial<FlowTriage> = {},
): FlowTriage {
  return {
    id,
    intakeId,
    patientId,
    level,
    atMs: NOW - 10 * MIN,
    byName: "Nurse A",
    lifeThreat: false,
    why: null,
    hasResus: false,
    ...over,
  };
}

export function encounter(
  id: string,
  patientId: string,
  over: Partial<FlowEncounter> = {},
): FlowEncounter {
  const createdAtMs = over.createdAtMs ?? NOW - 5 * MIN;
  return {
    id,
    patientId,
    clinicianId: ME,
    clinicianName: "Dr Me",
    departmentId: IM,
    state: "planned",
    triageRecordId: null,
    appointmentId: null,
    createdAtMs,
    startedAtMs: createdAtMs,
    endedAtMs: null,
    lastActivityAtMs: createdAtMs,
    ...over,
  };
}

export function resus(
  id: string,
  patientId: string | null,
  over: Partial<FlowResus> = {},
): FlowResus {
  return {
    id,
    patientId,
    section: "active",
    mode: "Survey",
    trigger: "Triage Red",
    startedAtMs: NOW - 12 * MIN,
    lastActivityAtMs: NOW - MIN,
    endedAtMs: null,
    arrestSinceMs: null,
    leader: null,
    idleLabel: null,
    outcome: null,
    worst: null,
    ...over,
  };
}

export function input(over: Partial<FlowInput> = {}): FlowInput {
  return {
    nowMs: NOW,
    dayStartMs: DAY_START,
    timeZone: "Africa/Kampala",
    viewer: { userId: ME, departmentId: IM, scope: "mine", mayAssign: true },
    settings: { encounterIdleMs: 24 * HOUR, l1LookbackMs: 24 * HOUR },
    signedRefs: { waitTargets: [] },
    patients: {},
    intakes: [],
    triages: [],
    encounters: [],
    resus: [],
    deaths: [],
    ...over,
  };
}
