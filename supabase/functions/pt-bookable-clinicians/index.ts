/**
 * pt-bookable-clinicians — the days a patient can ask for, at their hospital.
 *
 * Input:
 *   - hospital_id   optional; one hospital, or every active hospital when
 *                   absent (ADR 0086 — a patient may book at any of them)
 *
 * Output: one row per (clinician, hospital, department) pair — EVERY active
 * clinical affiliation, whether or not any day is open (ADR 0086: the list
 * is the roster, and a clinician with nothing open says so on their row) —
 * carrying every open slot keyed by clinic date (ADR 0085 §3: the phone shows
 * a time grid and its count), the clinician's name, cadre, specialty, a
 * signed URL to their photograph when they have one, and their rating summary
 * when anyone has rated them (ADR 0085 §1, §2). Those with a day open come
 * first, soonest first; the rest follow by name.
 *
 * Why a function and not a query: the rows the slot engine needs are not
 * patient-readable, and must not become so. Other patients' `appointments`
 * are PHI; `availability_blocks` says who is on leave; `staff_affiliations`
 * is the roster. RLS is row-level, so no policy can hand a patient "the
 * times, not the people". The web reads them over Drizzle on its own server;
 * this is that server for the phone. The reads and the derivation are the
 * ones in `app/patient/book/page.tsx`, run against the same engine the write
 * path validates with, so what this offers `pt-request-appointment` accepts.
 *
 * Read-only. Nothing is written and nothing is audited.
 */
import type {
  AvailabilityBlockRow,
  BookedAppointmentRow,
  ClinicianSchedulingSettingsRow,
  DepartmentSchedulingPolicyRow,
} from "../_shared/slots.ts";
import { z } from "npm:zod@4.4.3";

import { getCaller, serviceClient } from "../_shared/auth.ts";
import { PATIENT_BOOKING_HORIZON_DAYS } from "../_shared/booking-horizon.ts";
import { preflight } from "../_shared/cors.ts";
import {
  badRequest,
  forbidden,
  methodNotAllowed,
  ok,
  serverError,
  unauthorized,
} from "../_shared/errors.ts";
import { makeLogger } from "../_shared/logger.ts";
import {
  buildSlots,
  DEFAULT_TIME_ZONE,
  LIVE_APPOINTMENT_STATUSES,
  localDateKey,
  resolveSchedulingSettings,
} from "../_shared/slots.ts";

const log = makeLogger("pt-bookable-clinicians");

/**
 * ADR 0084 §8 — how far ahead this LOOKS. The cap on how far ahead a patient
 * may BOOK is `pt-request-appointment`'s and deliberately nowhere else; the
 * two agree so nothing offered here is refused there for its date alone.
 */
const LOOKAHEAD_DAYS = PATIENT_BOOKING_HORIZON_DAYS;

const InputSchema = z.object({
  hospital_id: z.string().uuid().optional(),
});

/** One slot a patient can ask for — the instants the request will carry. */
interface SlotOffer {
  startsAtIso: string;
  endsAtIso: string;
}

interface ClinicianOption {
  userId: string;
  fullName: string;
  hospitalId: string;
  hospitalName: string;
  /** "Senior Consultant", "Specialist Nurse" — the row says what kind of clinician this is. */
  cadre: string;
  /** `cadres.id`, so a screen can resolve THIS clinician's fee rather than a line's range (ADR 0092). */
  cadreId: string | null;
  /** From `staff_affiliations.specialty_id`, or null — the reference's "Cardiology". */
  specialty: string | null;
  departmentId: string;
  departmentName: string;
  /** A signed URL good for an hour, or null when there is no photograph. */
  photoUrl: string | null;
  /** Null until someone has rated this clinician — shown as "No ratings yet". */
  rating: { average: number; count: number } | null;
  /** A video visit is bookable with this clinician (their row, else the department's). */
  allowVirtual: boolean;
  /** PRD §2.7: the caller has an attended visit with this clinician here. */
  seenBefore: boolean;
  /** Distinct patients with an attended visit. The strip shows "—" for zero. */
  patientsSeen: number;
  /** When this affiliation was created — "With us" on the strip. Never a career length. */
  withUsSinceIso: string | null;
  autoConfirm: boolean;
  /** Open slots keyed by clinic date, ascending within a day; days with nothing open absent. */
  slotsByDate: Record<string, SlotOffer[]>;
}

/** How long a signed photograph URL lives. A screen is open for minutes, not days. */
const PHOTO_URL_TTL_SECONDS = 3600;

/** The engine's row shapes, plus the ids used to group them by clinician. */
type BlockRow = AvailabilityBlockRow & {
  clinician_user_id: string;
  hospital_id: string;
  department_id: string | null;
};
type ApptRow = BookedAppointmentRow & { clinician_user_id: string };
type SettingsRow = ClinicianSchedulingSettingsRow & {
  clinician_user_id: string;
  hospital_id: string;
};
type PolicyRow = DepartmentSchedulingPolicyRow & { department_id: string };

interface AffiliationRow {
  user_id: string;
  hospital_id: string;
  department_id: string;
  hospitals: { name: string } | null;
  hospital_departments: { name: string } | null;
  specialties: { name: string } | null;
  cadres: { name: string; is_clinical: boolean } | null;
  cadre_id: string | null;
  created_at: string;
}

/** Settings are per (clinician, hospital); a clinician at two hospitals has two rows. */
const settingsKey = (clinician: string, hospital: string) => `${clinician}:${hospital}`;

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const init = { origin, requestId };

  const pre = preflight(request);
  if (pre) return pre;
  if (request.method !== "POST") return methodNotAllowed(init);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Body must be JSON", init);
  }
  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid input", init, parsed.error.flatten());
  const input = parsed.data;

  const caller = await getCaller(request);
  if (!caller) return unauthorized(init);

  const sb = serviceClient();

  // 1. A patient. Which hospital is no longer a boundary (ADR 0086): the
  //    same caller may book at any active one, so the check is only that
  //    this is a patient surface.
  const { data: patient, error: patientError } = await sb
    .from("patient_profiles")
    .select("id")
    .eq("id", caller.id)
    .maybeSingle();
  if (patientError) return serverError(patientError.message, init);
  if (!patient) return forbidden(init, "only patients can see bookable days through this surface");

  // 2. Active CLINICAL affiliations at active hospitals — the bookable set.
  //    The cadres join is what keeps reception, lab and pharmacy staff out
  //    of a patient's clinician list (same filter as app/patient/book/page.tsx);
  //    the hospitals join keeps a suspended tenant's roster off it.
  //
  //    ponytail: with no hospital_id this is every clinician on the platform
  //    and fourteen days of every one of their grids. Ceiling: a national
  //    roster. Upgrade path: page by hospital, which the phone already groups
  //    by — nothing else here moves.
  let affQuery = sb
    .from("staff_affiliations")
    // `user_id` references auth.users, so `public.users` cannot be embedded
    // through it; names come from their own read below.
    .select(
      "user_id, hospital_id, department_id, cadre_id, created_at, hospitals!inner(name, state), " +
        "hospital_departments(name), specialties(name), cadres!inner(name, is_clinical)",
    )
    .in("state", ["active", "approved"])
    .eq("cadres.is_clinical", true)
    .eq("hospitals.state", "active");
  if (input.hospital_id) affQuery = affQuery.eq("hospital_id", input.hospital_id);
  const { data: affData, error: affError } = await affQuery;
  if (affError) return serverError(affError.message, init);

  const affiliations = (affData ?? []) as unknown as AffiliationRow[];
  if (affiliations.length === 0) return ok([], init);

  const clinicianIds = [...new Set(affiliations.map((a) => a.user_id))];
  const hospitalIds = [...new Set(affiliations.map((a) => a.hospital_id))];
  const departmentIds = [...new Set(affiliations.map((a) => a.department_id))];
  const now = new Date();
  const until = new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000);
  const nowIso = now.toISOString();
  const untilIso = until.toISOString();

  // 3-8. Independent of each other, all scoped by step 2's ids. Columns are
  //      aliased to the camelCase the engine reads — an unmapped row is
  //      `undefined` there, which it throws on rather than deriving nothing.
  const [blocksRes, apptsRes, settingsRes, policyRes, namesRes, ratingsRes, seenRes] =
    await Promise.all([
      sb
        .from("availability_blocks")
        // NO kind filter: "bookable" is the engine's definition, and it needs
        // the blocking kinds too — a `leave` row that never reaches the engine
        // cannot cancel the bookable block it overlaps, so the phone offers a
        // slot inside declared leave and the write path refuses it forever.
        .select(
          "clinician_user_id, hospital_id, department_id, kind, state, startsAt:starts_at, " +
            "endsAt:ends_at, recurrence, recurrenceWeekday:recurrence_weekday, " +
            "recurrenceUntil:recurrence_until",
        )
        .in("hospital_id", hospitalIds)
        .eq("state", "active")
        .in("clinician_user_id", clinicianIds)
        // A weekly block's own `starts_at` is the template — often months back.
        // Window it on the recurrence too, or the series never reaches the engine.
        .or(
          `and(ends_at.gte."${nowIso}",starts_at.lt."${untilIso}"),` +
            `and(recurrence.eq.weekly,or(recurrence_until.is.null,recurrence_until.gte."${nowIso}"))`,
        ),
      sb
        .from("appointments")
        // NOT scoped to the hospital, and that is the point: the write path
        // subtracts a clinician's live appointments everywhere, because a
        // clinician booked at their other hospital is still one person.
        .select("clinician_user_id, startsAt:starts_at, endsAt:ends_at")
        .in("clinician_user_id", clinicianIds)
        .in("status", [...LIVE_APPOINTMENT_STATUSES])
        .gte("ends_at", nowIso)
        .lt("starts_at", untilIso),
      sb
        .from("clinician_scheduling_settings")
        // All four columns. The engine's settings type has no optional fields
        // on purpose: "not selected" and "no override" want opposite answers.
        .select(
          "clinician_user_id, hospital_id, defaultSlotMinutes:default_slot_minutes, " +
            "bufferMinutes:buffer_minutes, autoConfirm:auto_confirm, allowVirtual:allow_virtual",
        )
        .in("hospital_id", hospitalIds)
        .in("clinician_user_id", clinicianIds),
      sb
        .from("department_scheduling_policy")
        .select(
          "department_id, defaultSlotMinutes:default_slot_minutes, " +
            "defaultBufferMinutes:default_buffer_minutes, defaultAutoConfirm:default_auto_confirm, " +
            "allowVirtual:allow_virtual, bookableWeekdays:bookable_weekdays, " +
            "bookableStartMinutesLocal:bookable_start_minutes_local, " +
            "bookableEndMinutesLocal:bookable_end_minutes_local",
        )
        .in("department_id", departmentIds),
      // The name the patient will see, and the photograph if there is one.
      sb.from("users").select("id, full_name, avatar_path").in("id", clinicianIds),
      // Real ratings only (ADR 0085 §2); absent rows mean "No ratings yet".
      sb
        .from("clinician_rating_summary")
        .select("clinician_user_id, average, count")
        .in("clinician_user_id", clinicianIds),
      // Patients actually seen — the one "experience" number the tables hold.
      // Attended statuses only (the set `pt-rate-visit` accepts): a booking
      // that never happened is not a patient seen. Counted here, service-side,
      // because RLS rightly hides other patients' rows from the phone.
      sb
        .from("appointments")
        .select("clinician_user_id, hospital_id, department_id, patient_user_id")
        .in("clinician_user_id", clinicianIds)
        .in("status", ["arrived", "in_progress", "completed"])
        .not("patient_user_id", "is", null),
    ]);
  // Fail closed on all six: an unread block list offers nothing, an unread
  // appointment list offers a taken slot, and an unread settings row has the
  // engine on its 15-minute default while the write path reads the real 30 —
  // every offer then refused with "appointments with this clinician are 30
  // minutes long".
  for (const res of [blocksRes, apptsRes, settingsRes, policyRes, namesRes, ratingsRes]) {
    if (res.error) return serverError(res.error.message, init);
  }
  // Distinct patients per clinician. A failed read is a "—" on the strip,
  // never a failed screen — a count is a convenience, the grid is the screen.
  // Keyed the way the web keys them (lib/patient/discover.ts), so the same
  // clinician shows the same numbers on both surfaces: patients seen at THIS
  // hospital; continuity (PRD §2.7) with THIS patient in THIS department.
  const patientsSeenBy = new Map<string, Set<string>>();
  const seenBy = new Map<string, Set<string>>();
  for (const r of (seenRes.data ?? []) as {
    clinician_user_id: string;
    hospital_id: string;
    department_id: string;
    patient_user_id: string;
  }[]) {
    const byHospital = `${r.clinician_user_id}:${r.hospital_id}`;
    const seen = patientsSeenBy.get(byHospital) ?? new Set<string>();
    seen.add(r.patient_user_id);
    patientsSeenBy.set(byHospital, seen);
    const byDept = `${r.clinician_user_id}:${r.hospital_id}:${r.department_id}`;
    const who = seenBy.get(byDept) ?? new Set<string>();
    who.add(r.patient_user_id);
    seenBy.set(byDept, who);
  }

  const blocks = (blocksRes.data ?? []) as unknown as BlockRow[];
  const appts = (apptsRes.data ?? []) as unknown as ApptRow[];
  const settingsByClinician = new Map(
    ((settingsRes.data ?? []) as unknown as SettingsRow[]).map((s) => [
      settingsKey(s.clinician_user_id, s.hospital_id),
      s,
    ]),
  );
  const policyByDepartment = new Map(
    ((policyRes.data ?? []) as unknown as PolicyRow[]).map((p) => [p.department_id, p]),
  );
  const users = (namesRes.data ?? []) as {
    id: string;
    full_name: string | null;
    avatar_path: string | null;
  }[];
  const userById = new Map(users.map((u) => [u.id, u]));
  const ratingByClinician = new Map(
    (
      (ratingsRes.data ?? []) as { clinician_user_id: string; average: number; count: number }[]
    ).map((r) => [r.clinician_user_id, { average: Number(r.average), count: r.count }]),
  );

  // One signing call for every photograph, not one per clinician. A failed
  // signing is a missing photo, not a failed screen.
  const photoPaths = users.map((u) => u.avatar_path).filter((p): p is string => !!p);
  const photoUrlByPath = new Map<string, string>();
  if (photoPaths.length > 0) {
    const { data: signed, error: signError } = await sb.storage
      .from("avatars")
      .createSignedUrls(photoPaths, PHOTO_URL_TTL_SECONDS);
    if (signError) {
      log.warn("photo signing failed", { requestId, reason: signError.message });
    } else {
      for (const item of signed ?? []) {
        if (item.path && item.signedUrl) photoUrlByPath.set(item.path, item.signedUrl);
      }
    }
  }

  // 8. Derive. One row per (clinician, department) pair, each judged against
  //    its own department's policy.
  // "With us" is the clinician's earliest active affiliation at the hospital,
  // whichever row the patient opened — the same rule the web applies, so the
  // two strips never disagree about one person.
  const withUsSince = new Map<string, string>();
  for (const a of affiliations) {
    const k = `${a.user_id}:${a.hospital_id}`;
    const prev = withUsSince.get(k);
    if (!prev || a.created_at < prev) withUsSince.set(k, a.created_at);
  }

  const options: ClinicianOption[] = affiliations.map((a) => {
    const clinicianSettings =
      settingsByClinician.get(settingsKey(a.user_id, a.hospital_id)) ?? null;
    const departmentPolicy = policyByDepartment.get(a.department_id) ?? null;

    const slots = buildSlots({
      // A block naming another department belongs to that department's hours;
      // one naming none is this clinician's general bookable time.
      blocks: blocks.filter(
        (b) =>
          b.clinician_user_id === a.user_id &&
          b.hospital_id === a.hospital_id &&
          (b.department_id === null || b.department_id === a.department_id),
      ),
      // Appointments are NOT split by department or hospital: a clinician
      // booked in Medicine — or at their other hospital — is unavailable here.
      appointments: appts.filter((p) => p.clinician_user_id === a.user_id),
      clinicianSettings,
      departmentPolicy,
      timeZone: DEFAULT_TIME_ZONE,
      now,
      rangeStart: now,
      rangeEnd: until,
    });

    // `buildSlots` returns ascending, so each day's list is already in order
    // and its length is the day's slot count (ADR 0085 §3).
    const slotsByDate: Record<string, SlotOffer[]> = {};
    for (const slot of slots) {
      (slotsByDate[localDateKey(slot.startsAt, DEFAULT_TIME_ZONE)] ??= []).push({
        startsAtIso: slot.startsAt.toISOString(),
        endsAtIso: slot.endsAt.toISOString(),
      });
    }

    const user = userById.get(a.user_id);
    return {
      userId: a.user_id,
      fullName: user?.full_name?.trim() || "Your clinician",
      hospitalId: a.hospital_id,
      hospitalName: a.hospitals?.name ?? "Your hospital",
      cadre: a.cadres?.name ?? "Clinician",
      cadreId: a.cadre_id ?? null,
      specialty: a.specialties?.name ?? null,
      departmentId: a.department_id,
      departmentName: a.hospital_departments?.name ?? "Outpatients",
      photoUrl: (user?.avatar_path && photoUrlByPath.get(user.avatar_path)) || null,
      rating: ratingByClinician.get(a.user_id) ?? null,
      // The resolved chain, exactly as `_shared/book.ts` picks the initial
      // status (ADR 0476): promise "confirmed" only where the write confirms.
      autoConfirm: resolveSchedulingSettings(clinicianSettings, departmentPolicy).autoConfirm,
      // A video visit is a real affordance only where it is allowed — the
      // clinician's own row, else the department's policy, else no.
      allowVirtual: clinicianSettings?.allowVirtual ?? departmentPolicy?.allowVirtual ?? false,
      // PRD §2.7 continuity: the caller has an attended visit with this
      // clinician in this department. The one badge that outranks a rating.
      seenBefore:
        seenBy.get(`${a.user_id}:${a.hospital_id}:${a.department_id}`)?.has(caller.id) ?? false,
      patientsSeen: patientsSeenBy.get(`${a.user_id}:${a.hospital_id}`)?.size ?? 0,
      withUsSinceIso: withUsSince.get(`${a.user_id}:${a.hospital_id}`) ?? null,
      slotsByDate,
    };
  });

  // Everyone reaches the screen. Those with a day to offer first, soonest
  // first — a reload lands on the same person — then the rest by name, so a
  // clinician with nothing open is still findable and their row says so.
  const open = options.sort((a, b) => {
    const da = firstOpenDay(a);
    const db = firstOpenDay(b);
    if (da && db) return da.localeCompare(db);
    if (da || db) return da ? -1 : 1;
    return a.fullName.localeCompare(b.fullName);
  });

  log.info("bookable clinicians served", {
    requestId,
    hospital_id: input.hospital_id ?? "all",
    clinicians: open.length,
  });
  return ok(open, init);
});

function firstOpenDay(option: ClinicianOption): string {
  return Object.keys(option.slotsByDate).sort()[0] ?? "";
}
