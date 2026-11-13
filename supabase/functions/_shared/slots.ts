/**
 * Bookable-slot derivation — the single answer to "what is a bookable slot".
 *
 * Pure, and importable from BOTH runtimes on purpose: the Next app takes it
 * as `@/supabase/functions/_shared/slots`, a Deno Edge Function as
 * `./slots.ts`. That is why this file has ZERO imports — not a drizzle type,
 * not a zod schema, not `server-only`. One import and one of the two
 * runtimes stops resolving it, and the moment the read path and the write
 * path stop sharing this code they start disagreeing again, which is the
 * whole defect class this file exists to close.
 *
 * The shape of the problem: `availability_blocks` stores DECLARED TIME —
 * possibly weekly-recurring, possibly spanning midnight — and
 * `appointments` stores what is taken. Neither is a slot list. Settings for
 * how long a slot is live in two more tables with a precedence order
 * (ADR 0029 §2), and the department's opening window lives in a third.
 * This file turns all of that into one ordered list of offerable slots, and
 * — via `checkSlot` — into one yes/no about a single requested slot, using
 * the same arithmetic so the two can never diverge.
 *
 * What it does NOT do:
 *   - Fetch. Every row is passed in; there is no database here.
 *   - Decide WHO is bookable. Cadre, affiliation state and hospital scoping
 *     are query concerns; the caller hands us one clinician's rows.
 *   - Prevent a double-booking race. `appointments_no_double_booking` (a
 *     partial UNIQUE index on live `(clinician_user_id, starts_at)`) is the
 *     backstop. Two patients can pass `checkSlot` on the same slot in the
 *     same millisecond and the loser gets a 23505 — a legitimate, expected
 *     outcome the caller turns into a 409. An engine that pretended
 *     otherwise would be lying. Note what that index canNOT catch, though:
 *     two live appointments that overlap without sharing a start. Nothing
 *     stops a clinician declaring two overlapping `bookable` blocks, so the
 *     offered set itself has to be free of overlaps — see `buildSlots`.
 */

/* ─── row shapes ─────────────────────────────────────────────────── */

/**
 * A `timestamptz`. Drizzle hands the Next app a `Date`; supabase-js hands
 * the Edge Function an ISO string. Both go straight in.
 *
 * The KEYS are not so forgiving: supabase-js returns `starts_at`, and an
 * unmapped row reads as `undefined` here. `toMs` throws on that rather than
 * deriving nothing from it — see the note there for why silence was worse.
 */
export type Instant = Date | string;

/**
 * `availability_blocks`, one clinician's worth at ONE department. Only the
 * columns the derivation reads are named; a caller may pass whole rows.
 *
 * One department because `departmentPolicy` is a single row: a clinician
 * affiliated to two departments has their Outreach blocks judged against
 * Medicine's opening hours if the caller pools them.
 */
export interface AvailabilityBlockRow {
  /** 'bookable' | 'teaching' | 'ward_round' | 'admin' | 'leave' | 'unavailable' | 'custom' */
  kind: string;
  /** 'active' | 'cancelled' */
  state: string;
  startsAt: Instant;
  endsAt: Instant;
  /** 'none' | 'weekly' */
  recurrence: string;
  /** 1-7, 1 = Monday (ISO / Uganda convention, CHECK-enforced in 0028). */
  recurrenceWeekday?: number | null;
  /** Null means open-ended. */
  recurrenceUntil?: Instant | null;
}

/** `appointments` — only what overlap subtraction needs. */
export interface BookedAppointmentRow {
  startsAt: Instant;
  endsAt: Instant;
  /** Optional: rows already filtered by the query may omit it. */
  status?: string | null;
}

/**
 * `clinician_scheduling_settings`. Every column is NOT NULL, so every field
 * here is required: pass the whole row, or pass none of it.
 *
 * Optional fields would make "the caller did not SELECT this column"
 * indistinguishable from "this clinician set no override", and those two
 * want opposite answers — the first is a bug, the second is the fallback
 * below. `pt-request-appointment` selects two of these columns today; when
 * it adopts this engine it needs all four, and a compile error is a better
 * way to learn that than a 15-minute grid nobody configured.
 */
export interface ClinicianSchedulingSettingsRow {
  defaultSlotMinutes: number;
  bufferMinutes: number;
  autoConfirm: boolean;
  allowVirtual: boolean;
}

/** `department_scheduling_policy`. Same rule, same reason. */
export interface DepartmentSchedulingPolicyRow {
  defaultSlotMinutes: number;
  defaultBufferMinutes: number;
  defaultAutoConfirm: boolean;
  allowVirtual: boolean;
  /** `smallint[]`. Empty means closed every day. See `matchesWeekday`. */
  bookableWeekdays: number[];
  /** Minutes from LOCAL midnight. 480 = 08:00 in `timeZone`. */
  bookableStartMinutesLocal: number;
  bookableEndMinutesLocal: number;
}

/** An offerable slot. Instants, not strings — formatting is the caller's. */
export interface Slot {
  startsAt: Date;
  endsAt: Date;
}

/**
 * The statuses that occupy a clinician's time. Identical to the predicate on
 * `appointments_no_double_booking`, and exported because three callers were
 * each re-typing this array — which is how one of them ends up a status short.
 */
export const LIVE_APPOINTMENT_STATUSES = [
  "requested",
  "pending_approval",
  "confirmed",
  "arrived",
  "in_progress",
] as const;

/* ─── settings ───────────────────────────────────────────────────── */

export interface EffectiveSchedulingSettings {
  slotMinutes: number;
  bufferMinutes: number;
  autoConfirm: boolean;
  allowVirtual: boolean;
}

/** ADR 0029 §2's last rung: 15-minute slots, no buffer, manual confirm, no virtual. */
export const HARD_DEFAULT_SETTINGS: EffectiveSchedulingSettings = {
  slotMinutes: 15,
  bufferMinutes: 0,
  autoConfirm: false,
  allowVirtual: false,
};

/**
 * ADR 0029 §2: clinician override → department policy → hard default.
 *
 * The chain is per field, but only a MISSING ROW can trigger it: every
 * column in both tables is NOT NULL with a default, so a clinician who
 * toggles `auto_confirm` writes a concrete 15 and 0 alongside it and stops
 * inheriting the department's slot length. That is a schema fact and not an
 * engine one — the ADR's "absent fields" cannot occur until some column is
 * made nullable, and this chain already handles that day. Note the two
 * tables spell the same thing
 * differently (`bufferMinutes` vs `defaultBufferMinutes`, `autoConfirm` vs
 * `defaultAutoConfirm`) — that asymmetry is in the schema, so it is here.
 */
export function resolveSchedulingSettings(
  clinician?: ClinicianSchedulingSettingsRow | null,
  department?: DepartmentSchedulingPolicyRow | null,
): EffectiveSchedulingSettings {
  return {
    slotMinutes:
      clinician?.defaultSlotMinutes ??
      department?.defaultSlotMinutes ??
      HARD_DEFAULT_SETTINGS.slotMinutes,
    bufferMinutes:
      clinician?.bufferMinutes ??
      department?.defaultBufferMinutes ??
      HARD_DEFAULT_SETTINGS.bufferMinutes,
    autoConfirm:
      clinician?.autoConfirm ?? department?.defaultAutoConfirm ?? HARD_DEFAULT_SETTINGS.autoConfirm,
    allowVirtual:
      clinician?.allowVirtual ?? department?.allowVirtual ?? HARD_DEFAULT_SETTINGS.allowVirtual,
  };
}

/* ─── the engine ─────────────────────────────────────────────────── */

/**
 * Every hospital MedSync runs in is in East Africa Time, which is the only
 * reason a constant can stand in for a column.
 *
 * ponytail: nothing stores a zone — there is no `hospitals.time_zone` — so
 * the alternative is this string typed into three call sites, which is the
 * duplication this file exists to end. Ceiling: the first hospital outside
 * EAT. Upgrade path: add the column, select it, pass it; every caller
 * already passes `timeZone` explicitly, so nothing in here moves.
 */
export const DEFAULT_TIME_ZONE = "Africa/Kampala";

export interface SlotContext {
  /** One clinician's `availability_blocks` rows, at one department. Kind/state filtering is ours. */
  blocks: ReadonlyArray<AvailabilityBlockRow>;
  /** That clinician's appointments over the same window. */
  appointments: ReadonlyArray<BookedAppointmentRow>;
  clinicianSettings?: ClinicianSchedulingSettingsRow | null;
  departmentPolicy?: DepartmentSchedulingPolicyRow | null;
  /**
   * IANA zone the department's local window is expressed in
   * ("Africa/Kampala"). Explicit and required: the server may run anywhere,
   * and `bookable_start_minutes_local` is meaningless without knowing whose
   * midnight it counts from. Never inferred from the server clock. An
   * invalid zone throws from `Intl` the first time local time is needed.
   */
  timeZone: string;
  /** No slot at or before this instant is ever offered. */
  now: Date;
}

export interface BuildSlotsInput extends SlotContext {
  /** Inclusive. Slots are emitted when their START lands in [rangeStart, rangeEnd). */
  rangeStart: Date;
  rangeEnd: Date;
}

/**
 * Every slot this clinician can be booked into, ascending, deduplicated.
 *
 * The grid is anchored to each block's OWN start, never to the query range
 * — that is the bug that let three callers disagree. Clamping a block to
 * the day being rendered makes a 22:00→02:00 block offer 22:00/22:15/… to
 * one caller and 00:00/00:15/… to another, for the same block. Walking from
 * the block start and filtering the emitted slots to the range afterwards
 * gives one grid regardless of who asks or how they window it.
 *
 * That anchoring also makes per-day splitting unnecessary: a multi-day block
 * is walked end to end and each slot is judged on its own local weekday and
 * time. (`lib/scheduling/calendar.ts` splits blocks per day, but that is a
 * rendering concern — a time-grid buckets by start-day. Slots don't.)
 */
export function buildSlots(input: BuildSlotsInput): Slot[] {
  const settings = resolveSchedulingSettings(input.clinicianSettings, input.departmentPolicy);
  const slotMs = settings.slotMinutes * 60_000;
  // The buffer is turnaround BETWEEN patients, so it is part of the step and
  // never a tail guard: the last slot in a block ends flush with the block.
  // Requiring trailing buffer would shorten every block by the buffer and
  // quietly drop a slot.
  const stepMs = slotMs + settings.bufferMinutes * 60_000;
  // A step shorter than a slot makes a block's own grid overlap itself; a
  // zero-or-negative one is an infinite loop holding a request handler open.
  // The CHECKs say 5..240 and 0..60, but this file trusts its inputs no
  // further than it has to.
  if (slotMs <= 0 || stepMs < slotMs) return [];

  const rangeStartMs = input.rangeStart.getTime();
  const rangeEndMs = input.rangeEnd.getTime();
  const nowMs = input.now.getTime();
  // An unparseable range would leave the weekly walk below with no bound.
  if (!Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs)) return [];

  const taken: Interval[] = toIntervals(
    input.appointments.filter(
      (a) =>
        a.status == null || (LIVE_APPOINTMENT_STATUSES as readonly string[]).includes(a.status),
    ),
  );

  // Declared leave subtracts exactly like a booked appointment: both mean
  // "this clinician is not available then". Expanded over the same window so
  // a weekly leave cancels the weekly bookable block it overlaps.
  taken.push(
    ...expandBlocks(input.blocks, rangeStartMs, rangeEndMs, input.timeZone, BLOCKING_KINDS),
  );

  const byStart = new Map<number, Slot>();
  const windows = expandBlocks(
    input.blocks,
    rangeStartMs,
    rangeEndMs,
    input.timeZone,
    BOOKABLE_KINDS,
  );

  for (const window of windows) {
    for (let startMs = window.startMs; startMs + slotMs <= window.endMs; startMs += stepMs) {
      // A slot that has already begun cannot be booked, even though it has
      // not finished. Stricter than the client derivation this replaces
      // (which allowed a slot until its end) and honest about what booking
      // means.
      //
      // ponytail: `now` is the only lead time, so a patient can take the
      // 09:00 slot at 08:59:30 and a clinician gets no notice. Upgrade path
      // is a `min_notice_minutes` on department_scheduling_policy flowing
      // through `resolveSchedulingSettings` — this comparison becomes
      // `startMs <= nowMs + noticeMs` and nothing else in the file moves.
      if (startMs <= nowMs) continue;
      if (startMs < rangeStartMs || startMs >= rangeEndMs) continue;
      if (byStart.has(startMs)) continue;

      const endMs = startMs + slotMs;
      // Nothing stops a clinician declaring two overlapping `bookable`
      // blocks, and two grids anchored to two different starts never collide
      // on `byStart` — so without this the engine offers 09:00-09:15 AND
      // 09:05-09:20, `checkSlot` accepts both, both INSERT, and the unique
      // index (which keys on `starts_at`) sees nothing wrong. The clinician
      // is double-booked with no race involved.
      //
      // The earlier-starting window owns the time. That is a rule about the
      // WINDOWS rather than about which slots happened to be emitted first,
      // so it cannot depend on block order or on how narrowly the caller
      // windowed the query — and any window that can suppress a slot must
      // overlap it, so it was expanded too. Both properties are what keep
      // `buildSlots` and `checkSlot` answering the same question.
      if (windows.some((o) => o.startMs < window.startMs && o.startMs < endMs && o.endMs > startMs))
        continue;

      if (!withinDepartmentWindow(startMs, settings.slotMinutes, input)) continue;
      if (taken.some((t) => startMs < t.endMs && endMs > t.startMs)) continue;

      byStart.set(startMs, { startsAt: new Date(startMs), endsAt: new Date(endMs) });
    }
  }

  return [...byStart.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export interface CheckSlotInput extends SlotContext {
  startsAt: Date;
  endsAt: Date;
}

/**
 * The write path's question: is this exact (startsAt, endsAt) a slot this
 * engine would have offered? Returns null when it is, otherwise the reason,
 * phrased for the patient who will read it.
 *
 * It answers by RE-DERIVING the range the slot occupies and looking for an
 * exact start match — deliberately, and this is the important design call in
 * the file. A separate "is it on the grid" predicate would be a second
 * implementation of the same arithmetic, and a second implementation is
 * precisely how `pt-request-appointment` came to accept any slot merely
 * CONTAINED by a bookable block: off-grid, outside the department's opening
 * hours, on a weekly block the read path never even expanded. Re-deriving is
 * a handful of slots' work and cannot drift from what was offered, because
 * it IS what was offered.
 *
 * The range is the slot itself; `expandBlocks` back-pads its recurrence
 * cursor by each block's duration, so a block that started the previous
 * evening still produces the occurrence covering a 00:30 slot.
 */
export function checkSlot(input: CheckSlotInput): string | null {
  const settings = resolveSchedulingSettings(input.clinicianSettings, input.departmentPolicy);
  const startMs = input.startsAt.getTime();
  const requestedMinutes = (input.endsAt.getTime() - startMs) / 60_000;

  // Checked before the derivation purely so the message can name the number.
  // The derivation would reject an off-length slot anyway.
  if (requestedMinutes !== settings.slotMinutes) {
    return `Appointments with this clinician are ${settings.slotMinutes} minutes long.`;
  }
  if (startMs <= input.now.getTime()) {
    return "That time has already passed — pick a later slot.";
  }

  const offered = buildSlots({ ...input, rangeStart: input.startsAt, rangeEnd: input.endsAt });
  if (offered.some((s) => s.startsAt.getTime() === startMs)) return null;
  return "That time isn't one of this clinician's bookable slots — refresh and pick again.";
}

/* ─── blocks → windows ───────────────────────────────────────────── */

interface Interval {
  startMs: number;
  endMs: number;
}

const DAY_MS = 86_400_000;

/**
 * Kinds that make a clinician unavailable, subtracted from the bookable
 * windows exactly like a live appointment is.
 *
 * This started as a documented shortcut — `leave` did not subtract, on the
 * grounds that it matched every surface's existing behaviour and that manual
 * confirm would put a human in front of any collision. Both halves expired:
 * `auto_confirm` is a per-clinician knob that the department-policy editor now
 * exposes, so with it on a patient books straight into declared leave with
 * nobody in the loop; and `pt-request-appointment` already fetches every kind
 * *because* it documents this suppression as happening. A comment asserting
 * behaviour the engine did not implement is worse than the gap it described.
 *
 * `teaching` / `ward_round` / `admin` / `custom` are NOT here: they are a
 * clinician's own commitments (`custom` is one they named themselves, ADR
 * 0095), and a hospital that wants them to block bookable time can say so by
 * declaring `unavailable` over them. Only an explicit "I am not here"
 * subtracts.
 */
const BLOCKING_KINDS: ReadonlySet<string> = new Set(["leave", "unavailable"]);
const BOOKABLE_KINDS: ReadonlySet<string> = new Set(["bookable"]);

/**
 * Every concrete time window a clinician has declared as bookable inside
 * [rangeStartMs, rangeEndMs), with weekly templates expanded.
 *
 * The expansion is `lib/scheduling/calendar.ts`'s, moved here (it was the
 * only place in the codebase that did it, which is why a weekly "every
 * Tuesday 09:00-13:00" was visible on the clinician's own calendar and
 * bookable by nobody). Two things changed in the move and both were forced:
 *
 *   1. Dates resolve in `timeZone`, not in the server's local zone. The
 *      calendar's `getHours()`/`setHours()` read whatever the host clock
 *      says, which puts a Kampala clinic's 09:00 block at 09:00 UTC on a
 *      UTC server.
 *   2. The cursor starts a block-duration BEFORE the range instead of at
 *      it, so an occurrence that begins before the range and runs into it
 *      is still produced. Without that, a Tuesday 22:00→Wednesday 02:00
 *      block vanishes from any Wednesday-only query — including the
 *      single-slot range `checkSlot` uses.
 *
 * `recurrence_weekday` is 1-7 with 1 = Monday. The calendar converts it to
 * JS's 0-6 with `rw % 7`; here the cursor speaks ISO weekdays throughout, so
 * the conversion lands once, in the other direction, in `isoWeekday()`.
 */
function expandBlocks(
  blocks: ReadonlyArray<AvailabilityBlockRow>,
  rangeStartMs: number,
  rangeEndMs: number,
  timeZone: string,
  kinds: ReadonlySet<string>,
): Interval[] {
  const windows: Interval[] = [];

  for (const block of blocks) {
    // The engine filters rather than trusting the query to have done it:
    // this is the definition of "bookable", so it lives in one place. The
    // same walk expands the blocking kinds, so a weekly leave recurs exactly
    // like the weekly bookable block it cancels.
    if (!kinds.has(block.kind) || block.state !== "active") continue;

    const startMs = toMs(block.startsAt, "availability_blocks.startsAt");
    const endMs = toMs(block.endsAt, "availability_blocks.endsAt");
    const durationMs = endMs - startMs;
    // The DB CHECKs `ends_at > starts_at`; a row that disagrees is a typo,
    // not a window.
    if (durationMs <= 0) continue;

    if (block.recurrence !== "weekly" || !block.recurrenceWeekday) {
      if (endMs > rangeStartMs && startMs < rangeEndMs) windows.push({ startMs, endMs });
      continue;
    }

    // Time-of-day comes from the template; the date walks week by week.
    const template = localParts(startMs, timeZone);
    const untilMs = block.recurrenceUntil
      ? toMs(block.recurrenceUntil, "availability_blocks.recurrenceUntil")
      : Number.POSITIVE_INFINITY;

    // Civil dates as UTC-midnight epoch ms: a pure day counter, no zone in
    // it, so stepping by 7 days can never drift across a DST boundary the
    // way adding 7×24h to an instant would.
    let civil = civilMidnight(localParts(Math.max(startMs, rangeStartMs - durationMs), timeZone));
    civil += ((block.recurrenceWeekday - isoWeekday(civil) + 7) % 7) * DAY_MS;

    // No occurrence cap. The walk always terminates — occurrences only move
    // forward and `rangeEndMs` is finite — and a cap here does not prevent
    // anything, it just answers a wide query by silently dropping its last
    // weeks. `+ template.seconds` because a one-off block keeps its seconds
    // and a weekly one must not quietly lose them.
    for (; ; civil += 7 * DAY_MS) {
      const day = new Date(civil);
      const occStartMs =
        instantAtLocal(
          day.getUTCFullYear(),
          day.getUTCMonth() + 1,
          day.getUTCDate(),
          template.minutesOfDay,
          timeZone,
        ) +
        template.seconds * 1000;
      if (occStartMs >= untilMs || occStartMs >= rangeEndMs) break;
      // `recurrence_until` is an instant, not a date, so it also truncates
      // the occurrence it lands inside: a series ending Tuesday 10:00 does
      // not go on offering Tuesday 12:45. Clamped to `untilMs` only, never
      // to `rangeEndMs` — clamping to the query range is what makes one
      // block answer differently to two callers.
      const occEndMs = Math.min(occStartMs + durationMs, untilMs);
      if (occEndMs > rangeStartMs) windows.push({ startMs: occStartMs, endMs: occEndMs });
    }
  }

  return windows;
}

/* ─── the department's opening hours ─────────────────────────────── */

/**
 * Defect 4: `bookable_weekdays` / `bookable_start_minutes_local` /
 * `bookable_end_minutes_local` were read by the walk-in heuristic and by
 * nothing in booking, so a clinician's stray Sunday-21:00 block was offered
 * by a Mon-Fri 08:00-17:00 department.
 *
 * No policy row means no restriction, not "closed" — the same rule
 * `pt-declare-intake` and `/patient/queue` already apply, and the only safe
 * one while most departments have no policy row at all.
 *
 * The WHOLE slot must fit the window. A 15-minute slot starting 16:55
 * against a 17:00 close would run past closing, so it is not offered; a slot
 * ending exactly at 17:00 is entirely inside [08:00, 17:00) and is.
 */
function withinDepartmentWindow(
  startMs: number,
  slotMinutes: number,
  ctx: Pick<SlotContext, "departmentPolicy" | "timeZone">,
): boolean {
  const policy = ctx.departmentPolicy;
  if (!policy) return true;

  const local = localParts(startMs, ctx.timeZone);

  // An empty array is closed every day, not open every day. The column is
  // NOT NULL DEFAULT '{1,2,3,4,5}', so emptying it is a deliberate act, and
  // reading it as "no restriction" answers the exact opposite of the ask.
  if (!matchesWeekday(policy.bookableWeekdays, isoWeekday(civilMidnight(local)))) return false;

  // Seconds are carried rather than rounded away: `ha-set-clinician-availability`
  // accepts any ISO instant, so a block really can start at 16:45:30, and a
  // window compared in whole minutes offers a slot that ends half a minute
  // after the department closed.
  const startSecondOfDay = local.minutesOfDay * 60 + local.seconds;
  if (startSecondOfDay < policy.bookableStartMinutesLocal * 60) return false;
  // Deliberately derived by addition rather than by re-reading the end
  // instant's local time: a slot crossing local midnight then scores past
  // 1440 and fails any window, which is the right answer, where re-reading
  // would wrap it to a small number and let it through.
  if (startSecondOfDay + slotMinutes * 60 > policy.bookableEndMinutesLocal * 60) return false;
  return true;
}

/**
 * `bookable_weekdays` carries no CHECK constraint and its two existing
 * readers compare it against JS `getDay()` (0 = Sunday) while its sibling
 * `recurrence_weekday` is ISO (7 = Sunday). The conventions agree on every
 * value from Monday to Saturday and differ on exactly one day, so accepting
 * both 0 and 7 for Sunday is not a fudge — it is correct under either
 * reading, with nothing left ambiguous. An empty list matches nothing,
 * which is what an empty list means.
 */
function matchesWeekday(weekdays: ReadonlyArray<number>, iso: number): boolean {
  return weekdays.some((w) => Number(w) === iso || (iso === 7 && Number(w) === 0));
}

/**
 * The hospital's own weekday and wall-clock minute for an instant — what the
 * walk-in readers need to compare against `bookable_weekdays` and
 * `bookable_start/end_minutes_local`.
 *
 * ISO, 1 = Monday … 7 = Sunday, so it lines up with the column's CHECK
 * (migration 0052) and with `recurrence_weekday` one table over.
 *
 * Exported because `department_scheduling_policy` has readers outside slot
 * derivation — `app/patient/queue/page.tsx` and `pt-declare-intake` gate the
 * SAME-DAY door on the SAME columns — and both were reading the SERVER's
 * clock: `getDay()` / `getHours()`. On a UTC host that is a different weekday
 * for the first three hours of every East African day, and a walk-in window
 * displaced by three hours on all of them. Nothing here may consult the
 * server clock; the zone is passed in, as it is everywhere else in this file.
 */
export function localWeekdayAndMinutes(
  instant: Instant,
  timeZone: string,
): { isoWeekday: number; minutesOfDay: number } {
  const local = localParts(toMs(instant, "instant"), timeZone);
  return { isoWeekday: isoWeekday(civilMidnight(local)), minutesOfDay: local.minutesOfDay };
}

/**
 * "2026-09-15" — the civil date of `instant` in `timeZone`. Every patient
 * surface groups a clinic's open sessions by this key, so it lives with the
 * engine: a phone keying on its own zone and a server keying on the clinic's
 * is a day chip that lands on the wrong day for three hours every night.
 */
export function localDateKey(instant: Instant, timeZone: string): string {
  const p = localParts(toMs(instant, "instant"), timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export type DaySession = "morning" | "afternoon";

/**
 * ADR 0084 §10 — the day-part a patient is told instead of a clock numeral,
 * split at local noon. Shared for the same reason as the key above: the
 * server groups offers into sessions and the phone labels the one the patient
 * chose, and both must call the same instant by the same word.
 *
 * ponytail: two words, because those are the two the ADR ratified. An evening
 * list reads "afternoon". Upgrade path: a third word, once one is.
 */
export function localSession(instant: Instant, timeZone: string): DaySession {
  return localWeekdayAndMinutes(instant, timeZone).minutesOfDay < 12 * 60 ? "morning" : "afternoon";
}

/**
 * Local midnight of the civil day containing `instant`, as an instant.
 *
 * Every "today" boundary in the product goes through here: `setUTCHours(0)`
 * puts a Kampala clinic's day boundary at 03:00 EAT, and `setHours(0)` puts
 * it wherever the host happens to be. At 00:30 EAT on the 16th (21:30Z on
 * the 15th) the answer is 21:00Z on the 15th — the 16th's midnight in
 * Kampala — not 00:00Z on the 15th. DST-safe through `instantAtLocal`.
 */
export function startOfLocalDay(instant: Instant, timeZone: string): Date {
  const p = localParts(toMs(instant, "instant"), timeZone);
  return new Date(instantAtLocal(p.year, p.month, p.day, 0, timeZone));
}

/** The start of the NEXT civil day — the exclusive end of `instant`'s day. */
export function endOfLocalDay(instant: Instant, timeZone: string): Date {
  const p = localParts(toMs(instant, "instant"), timeZone);
  const next = new Date(civilMidnight(p) + DAY_MS);
  return new Date(
    instantAtLocal(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, timeZone),
  );
}

/* ─── session templates → clinic sessions ────────────────────────── */

/** A `session_templates` row (migration 0058), camelCased. Dates are `YYYY-MM-DD`. */
export interface SessionTemplateRow {
  /** ISO 1 = Monday … 7 = Sunday. */
  weekday: number;
  /** Minutes past local midnight in the hospital's zone. */
  startMinutesLocal: number;
  durationMinutes: number;
  validFrom: string;
  validUntil: string | null;
  /** CLN-3 (0080): every N weeks, counted from the first occurrence on/after validFrom. Default 1. */
  repeatEveryWeeks?: number;
  /** CLN-3 (0080): only the nth such weekday of the month (1–5), or −1 for the last. */
  nthWeekday?: number | null;
}

/** "YYYY-MM-DD" for a UTC-midnight civil day counter. */
function civilYmd(civil: number): string {
  return new Date(civil).toISOString().slice(0, 10);
}

/**
 * Every occurrence of a template's weekday inside [rangeStart, rangeEnd) ∩
 * [validFrom, validUntil], at `startMinutesLocal` in `timeZone`. Ascending.
 * Pure — the Edge Function that writes a template and the nightly cron both
 * call this, which is what makes their `clinic_sessions` rows identical.
 *
 * Same arithmetic as `expandBlocks`: the civil date walks as a UTC-midnight
 * day counter (no zone in it, so stepping 7 days never drifts across a DST
 * shift), and each occurrence resolves through `instantAtLocal`. Never the
 * host clock. `validFrom` / `validUntil` are civil DATES, inclusive on both
 * ends, so a template valid until Tuesday still produces that Tuesday.
 */
export function expandSessionTemplate(
  t: SessionTemplateRow,
  rangeStart: Instant,
  rangeEnd: Instant,
  timeZone: string,
  /** CLN-4 (0080): civil days to leave out — public holidays, closures. */
  skip?: (ymd: string) => boolean,
): { startsAt: Date; endsAt: Date }[] {
  const out: { startsAt: Date; endsAt: Date }[] = [];
  if (t.weekday < 1 || t.weekday > 7 || t.durationMinutes <= 0) return out;

  const rangeStartMs = toMs(rangeStart, "rangeStart");
  const rangeEndMs = toMs(rangeEnd, "rangeEnd");
  const durationMs = t.durationMinutes * 60_000;

  // The earliest civil day that can matter: the later of validFrom and the
  // day an occurrence would have to start on to still overlap the range.
  const fromMs = civilDate(t.validFrom, "validFrom");
  const untilMs = t.validUntil ? civilDate(t.validUntil, "validUntil") : Number.POSITIVE_INFINITY;
  let civil = Math.max(fromMs, civilMidnight(localParts(rangeStartMs - durationMs, timeZone)));
  civil += ((t.weekday - isoWeekday(civil) + 7) % 7) * DAY_MS;
  // The first occurrence on/after validFrom anchors "every N weeks".
  const every = Math.max(1, Math.trunc(t.repeatEveryWeeks ?? 1));
  const anchor = fromMs + ((t.weekday - isoWeekday(fromMs) + 7) % 7) * DAY_MS;
  const nth = t.nthWeekday ?? null;

  for (; civil <= untilMs; civil += 7 * DAY_MS) {
    const day = new Date(civil);
    if (every > 1 && Math.round((civil - anchor) / (7 * DAY_MS)) % every !== 0) continue;
    if (nth !== null && !isNthWeekday(day, nth)) continue;
    if (skip?.(civilYmd(civil))) continue;
    const startMs = instantAtLocal(
      day.getUTCFullYear(),
      day.getUTCMonth() + 1,
      day.getUTCDate(),
      t.startMinutesLocal,
      timeZone,
    );
    if (startMs >= rangeEndMs) break;
    const endMs = startMs + durationMs;
    if (endMs > rangeStartMs) out.push({ startsAt: new Date(startMs), endsAt: new Date(endMs) });
  }
  return out;
}

/** Is this civil day the nth (1–5) of its weekday in its month, or the last (−1)? */
function isNthWeekday(day: Date, nth: number): boolean {
  const date = day.getUTCDate();
  if (nth === -1) {
    const daysInMonth = new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0),
    ).getUTCDate();
    return date + 7 > daysInMonth;
  }
  return Math.ceil(date / 7) === nth;
}

/** "2026-09-15" → that civil date as a UTC-midnight day counter. Throws on anything else. */
function civilDate(value: string, field: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw new TypeError(`slots: ${field} must be YYYY-MM-DD (got ${JSON.stringify(value)})`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/* ─── time, in a named zone ──────────────────────────────────────── */

interface LocalParts {
  year: number;
  month: number;
  day: number;
  minutesOfDay: number;
  seconds: number;
}

// `Intl.DateTimeFormat` construction costs far more than a format call, and
// this runs once per candidate slot. A Map keyed by zone, nothing cleverer.
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = FORMATTERS.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    FORMATTERS.set(timeZone, formatter);
  }
  return formatter;
}

/** An instant, as it reads on a wall clock in `timeZone`. */
function localParts(instantMs: number, timeZone: string): LocalParts {
  const bag: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(instantMs))) {
    bag[part.type] = part.value;
  }
  // `hour12: false` renders midnight as "24" on some ICU builds and "00" on
  // others. One modulo makes both agree.
  const hour = Number(bag.hour) % 24;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    minutesOfDay: hour * 60 + Number(bag.minute),
    seconds: Number(bag.second),
  };
}

/** How far `timeZone` is ahead of UTC at this instant, in ms. */
function offsetMs(instantMs: number, timeZone: string): number {
  const p = localParts(instantMs, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, 0, p.minutesOfDay, p.seconds) - instantMs;
}

/**
 * The instant at which `minutesOfDay` on the civil date (year, month, day)
 * occurs in `timeZone` — the inverse of `localParts`.
 *
 * Two passes: the first reads the offset at the wall-clock instant
 * misinterpreted as UTC, which is the wrong instant by up to a day and
 * therefore the wrong offset on the days a zone shifts; re-reading at the
 * corrected instant pins it.
 *
 * When the two passes disagree, the wall time is either skipped (spring
 * forward) or doubled (autumn), and it is the SECOND that must be discarded:
 * trusting it puts a 02:30 clinic at 01:30 — an hour before the clinician
 * declared it, which is the one answer no calendar gives. Keeping the first
 * shifts a skipped time forward, as RFC 5545 does, and takes the earlier of
 * an ambiguous pair. East Africa Time never shifts, so the two always agree
 * there and this costs a hospital in Kampala nothing.
 */
function instantAtLocal(
  year: number,
  month: number,
  day: number,
  minutesOfDay: number,
  timeZone: string,
): number {
  const wall = Date.UTC(year, month - 1, day, 0, minutesOfDay);
  const first = wall - offsetMs(wall, timeZone);
  const second = wall - offsetMs(first, timeZone);
  return offsetMs(second, timeZone) === offsetMs(first, timeZone) ? second : first;
}

/** A civil date as UTC-midnight epoch ms — a day counter, not an instant. */
function civilMidnight(p: LocalParts): number {
  return Date.UTC(p.year, p.month - 1, p.day);
}

/** 1 = Monday … 7 = Sunday, from a civil-date counter. */
function isoWeekday(civilMs: number): number {
  return new Date(civilMs).getUTCDay() || 7;
}

/* ─── odds and ends ──────────────────────────────────────────────── */

/**
 * A `timestamptz` from either runtime, as epoch ms.
 *
 * Throws rather than skipping, because every way this fails is a caller bug
 * whose silent form is dangerous. The one that will actually happen:
 * supabase-js returns `starts_at`, `serviceClient()` is un-generic so those
 * rows are `any` and typecheck fine, and `row.startsAt` is `undefined`.
 * Skipped, that is an Edge Function offering no slots at all — or, on the
 * appointments side, one whose `taken` list is empty and which therefore
 * accepts a booking on top of an existing appointment. Neither logs a thing.
 *
 * A string carrying no offset is read as UTC and never as the host's zone:
 * this file must never consult the server clock.
 */
function toMs(value: Instant, field: string): number {
  const ms =
    value instanceof Date ? value.getTime() : new Date(withZone(String(value ?? ""))).getTime();
  if (!Number.isFinite(ms)) {
    throw new TypeError(
      `slots: ${field} is not a timestamp (got ${JSON.stringify(value)}). Rows are camelCase ` +
        `here — map supabase-js's snake_case columns before passing them in.`,
    );
  }
  return ms;
}

/** "2026-09-15T06:00:00" → "…Z". Anything already carrying a zone is untouched. */
function withZone(iso: string): string {
  const trimmed = iso.trim();
  return /(?:Z|[+-]\d{2}:?\d{2}|[+-]\d{2})$/i.test(trimmed) ? trimmed : `${trimmed}Z`;
}

function toIntervals(rows: ReadonlyArray<BookedAppointmentRow>): Interval[] {
  return rows.map((row) => ({
    startMs: toMs(row.startsAt, "appointments.startsAt"),
    endMs: toMs(row.endsAt, "appointments.endsAt"),
  }));
}

/* ─── session bookings: code and arrival window (Gate C, ADR 0088) ── */

/**
 * The booking-code alphabet a code may contain: 32 characters, no 0/O/1/I — the code is read
 * aloud to a relative and typed by a receptionist (proposal §5.6). Codes made before the reception
 * desk (ADR 0485, D-RD-10/25) may contain L and stay valid.
 */
export const BOOKING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** New codes also drop L (D-RD-10): 31 characters, hard to mishear as 1 or I. */
export const BOOKING_CODE_NEW_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const BOOKING_CODE_LENGTH = 6;

/** A typed or scanned code as stored: upper case, spaces and dashes gone. */
export function normalizeBookingCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, "");
}

/**
 * A 6-character booking code. `random` is injected (a `[0, 1)` source) so a
 * test can pin the output; the writer passes a crypto-backed one. Uniqueness
 * per hospital is the INDEX's job — the writer retries on 23505.
 */
export function bookingCode(random: () => number): string {
  let out = "";
  for (let i = 0; i < BOOKING_CODE_LENGTH; i++) {
    const idx = Math.min(
      BOOKING_CODE_NEW_ALPHABET.length - 1,
      Math.max(0, Math.floor(random() * BOOKING_CODE_NEW_ALPHABET.length)),
    );
    out += BOOKING_CODE_NEW_ALPHABET[idx];
  }
  return out;
}

/**
 * The arrival window a session position is told (ruling C10: a RANGE with a
 * stated basis, never a point estimate). Basis = position × pace, where the
 * pace is the session length divided by the bookable places.
 *
 *   len   = session length / ceil(capacityBooked × overbooking)
 *   start = sessionStart + (position − 1) × len − len / 2, floored at sessionStart
 *   end   = start + 2 × len, capped at sessionEnd
 *
 * Derived ONCE at confirmation and stored on the appointment so the SMS the
 * patient holds never changes (proposal §5.6). Pure; no clock.
 */
export function arrivalWindow(args: {
  sessionStartsAt: Instant;
  sessionEndsAt: Instant;
  capacityBooked: number;
  overbookingFactor: number;
  position: number;
}): { start: Date; end: Date } {
  const startMs = toMs(args.sessionStartsAt, "sessionStartsAt");
  const endMs = toMs(args.sessionEndsAt, "sessionEndsAt");
  const places = Math.max(1, Math.ceil(args.capacityBooked * args.overbookingFactor));
  const len = Math.max(0, endMs - startMs) / places;
  const position = Math.max(1, Math.floor(args.position));

  const start = Math.min(endMs, Math.max(startMs, startMs + (position - 1) * len - len / 2));
  const end = Math.min(endMs, start + 2 * len);
  return { start: new Date(start), end: new Date(end) };
}
