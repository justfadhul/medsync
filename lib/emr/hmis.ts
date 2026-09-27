import type {
  AgeSpan,
  HmisAgeBands,
  HmisAttendanceDefinition,
  HmisCategoryMap,
} from "./reference/hmis";
import type { IdsrClasses, IdsrScreen } from "./reference/idsr";
import type { RefEntry } from "@/lib/resus/reference/ref";

import { DEFAULT_TIME_ZONE } from "@/supabase/functions/_shared/slots";
import { REF_HMIS_AGEBANDS, REF_HMIS_ATTENDANCE, REF_HMIS_MAP } from "./reference/hmis";
import { REF_IDSR_CLASSES, REF_IDSR_SCREEN } from "./reference/idsr";

/**
 * HMIS and IDSR capture (clinical reference [11], D-EMR-10/11). PURE. Every answer comes from a
 * signed reference entry; while an entry is pending the CSO the answer is 'unknown' / null, never a
 * guess. Reports and DHIS2 submission are out of scope: this only captures at the point of care.
 */

/** A reference's data, only once signed. */
export function signedData<T>(ref: RefEntry & { data?: T }): T | null {
  return ref.status === "signed" && ref.data !== undefined ? ref.data : null;
}

/* ─── Calendar helpers (the hospital's local date, as yyyy-mm-dd) ─── */

const localDate = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(at);

function parts(iso: string): [number, number, number] {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
  return [y, m, d];
}

function isoUtc(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}

/** dob + span. Month overflow rolls forward (29 Feb + 1 year = 1 Mar), the conservative reading. */
function addSpan(iso: string, span: AgeSpan): string {
  const [y, m, d] = parts(iso);
  return isoUtc(y + (span.years ?? 0), m + (span.months ?? 0), d + (span.days ?? 0));
}

/* ─── Attendance type ─────────────────────────────────────────────── */

export type AttendanceType = "new" | "re_attendance" | "unknown";

function periodStart(visitDate: string, def: HmisAttendanceDefinition): string {
  const [y, m, d] = parts(visitDate);
  switch (def.period.kind) {
    case "calendar_year":
      return isoUtc(y, 1, 1);
    case "financial_year": {
      const start = def.period.startMonth;
      return isoUtc(m >= start ? y : y - 1, start, 1);
    }
    case "rolling_days":
      return isoUtc(y, m, d - def.period.days);
  }
}

/**
 * New or re-attendance for HMIS 031/105 (REF-HMIS-ATTENDANCE). `priorVisitAts` are the patient's
 * earlier attendances AT THIS FACILITY (the caller scopes them). 'unknown' until the reference is
 * signed; encounters.attendance_type defaults to 'unknown' for the same reason.
 */
export function attendanceType(
  input: { visitAt: Date; priorVisitAts: Date[]; timeZone?: string },
  ref: RefEntry & { data?: HmisAttendanceDefinition } = REF_HMIS_ATTENDANCE,
): AttendanceType {
  const def = signedData(ref);
  if (!def) return "unknown";
  const tz = input.timeZone ?? DEFAULT_TIME_ZONE;
  const visitDate = localDate(input.visitAt, tz);
  const from = periodStart(visitDate, def);
  const earlier = input.priorVisitAts.some(
    (t) => t.getTime() < input.visitAt.getTime() && localDate(t, tz) >= from,
  );
  return earlier ? "re_attendance" : "new";
}

/* ─── Age band ────────────────────────────────────────────────────── */

export type DobPrecision = "day" | "month" | "year";

function bandFor(dob: string, at: string, bands: HmisAgeBands["bands"]) {
  return (
    bands.find((b) => addSpan(dob, b.from) <= at && (!b.to || at < addSpan(dob, b.to))) ?? null
  );
}

/**
 * The HMIS 105 age group at the visit (REF-HMIS-AGEBANDS). An imprecise date of birth is handled
 * conservatively (D-CFC-12): the band is given only when every possible birth date in the stated
 * precision falls in the same band; otherwise null (unknown). null until the reference is signed.
 */
export function ageBand(
  input: { dateOfBirth: string | null; precision?: DobPrecision; visitAt: Date; timeZone?: string },
  ref: RefEntry & { data?: HmisAgeBands } = REF_HMIS_AGEBANDS,
): { id: string; label: string } | null {
  const data = signedData(ref);
  if (!data || !input.dateOfBirth) return null;
  const at = localDate(input.visitAt, input.timeZone ?? DEFAULT_TIME_ZONE);
  const [y, m] = parts(input.dateOfBirth);
  const precision = input.precision ?? "day";
  const earliest =
    precision === "year"
      ? isoUtc(y, 1, 1)
      : precision === "month"
        ? isoUtc(y, m, 1)
        : input.dateOfBirth;
  const latest =
    precision === "year"
      ? isoUtc(y, 12, 31)
      : precision === "month"
        ? isoUtc(y, m + 1, 0)
        : input.dateOfBirth;
  if (latest > at) return null; // born after the visit, or might have been
  const a = bandFor(earliest, at, data.bands);
  const b = bandFor(latest, at, data.bands);
  return a && b && a.id === b.id ? { id: a.id, label: a.label } : null;
}

/* ─── HMIS category and IDSR class ────────────────────────────────── */

/** The HMIS 105 category of the visit's primary diagnosis term (REF-HMIS-MAP). An uncoded term, an
 *  unmapped term or an unsigned map gives null: it is never HMIS-counted by guess. */
export function hmisCategory(
  termId: string | null,
  ref: RefEntry & { data?: HmisCategoryMap } = REF_HMIS_MAP,
): { id: string; label: string } | null {
  const data = signedData(ref);
  if (!data || !termId) return null;
  const id = data.map[termId];
  return data.categories.find((c) => c.id === id) ?? null;
}

export type IdsrClass = IdsrClasses["classes"][number];

/** The IDSR class of a diagnosis term (REF-IDSR-CLASSES), with its signed action text. null until
 *  signed: no notifiable confirm sheet fires on a guess. */
export function idsrClass(
  termId: string | null,
  ref: RefEntry & { data?: IdsrClasses } = REF_IDSR_CLASSES,
): IdsrClass | null {
  const data = signedData(ref);
  if (!data || !termId) return null;
  const id = data.map[termId];
  return data.classes.find((c) => c.id === id) ?? null;
}

/** The exposure tokens the history picker offers (REF-IDSR-SCREEN); none until signed. */
export function idsrExposureTokens(
  ref: RefEntry & { data?: IdsrScreen } = REF_IDSR_SCREEN,
): IdsrScreen["tokens"] {
  return signedData(ref)?.tokens ?? [];
}
