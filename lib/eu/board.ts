/**
 * The EU tracking rows (ADR 0541): status words, next obs due and the "Needs attention" list. Pure: `nowMs` is
 * passed in; the clocks and the limit rule are `lib/eu/clock`. Over the limit only flags (D2).
 */
import type { ObsFrequencyChoice } from "@/lib/clerking/plan/draft";
import type { WaitReason } from "@/lib/emr/closure";
import type { AcuityLevel } from "@/lib/triage/types";

import { EU_TRACK } from "@/content/eu/words";
import { type EuClocks, euClocks, overLimit } from "./clock";

export const EU_ARRIVING_ATTENTION_MS = 3_600_000;
export const EU_BOARDING_ATTENTION_MS = 12 * 3_600_000;

/** The Plan's own choices; continuous is on a monitor, so it has no due time. */
export const OBS_INTERVAL_MS: Record<ObsFrequencyChoice, number | null> = {
  continuous: null,
  hourly: 3_600_000,
  "4h": 4 * 3_600_000,
  "12h": 12 * 3_600_000,
};

export type AttentionCode =
  | "over_limit"
  | "arriving_long"
  | "obs_overdue"
  | "boarding_long"
  | "waiting_space";

export interface EuStayInput {
  stayId: string;
  patientUserId: string;
  wardId: string;
  status: "awaiting_space" | "in_space";
  decidedAt: string;
  hospitalArrivedAt: string | null;
  spaceStartedAt: string | null;
  arriving: boolean;
  bedLabel: string | null;
  level: AcuityLevel | null;
  obsFrequency: ObsFrequencyChoice | null;
  lastObsAt: string | null;
  resultsReady: boolean;
  admission: {
    wardName: string;
    decidedAt: string;
    status: "awaiting_bed" | "bed_allocated" | "cancelled";
  } | null;
  resusEpisodeId: string | null;
  waitReason: WaitReason | null;
  name: string | null;
  mrn: string | null;
}

export interface EuTrackingRow extends EuStayInput {
  clocks: EuClocks;
  statusWord: string;
  overLimit: boolean;
  nextObsDueAt: string | null;
  attention: AttentionCode[];
}

function statusWord(s: EuStayInput): string {
  if (s.status === "awaiting_space") return EU_TRACK.waiting;
  if (s.admission?.status === "cancelled") return EU_TRACK.admissionEnded;
  if (s.admission) return EU_TRACK.admitted(s.admission.wardName);
  return s.arriving ? EU_TRACK.arriving : EU_TRACK.inEu;
}

export function euTracking(
  stays: EuStayInput[],
  nowMs: number,
  limitHours: number,
): { rows: EuTrackingRow[]; needsAttention: { stayId: string; code: AttentionCode; words: string }[] } {
  const words = (c: AttentionCode): string =>
    ({
      over_limit: EU_TRACK.overLimit(limitHours),
      arriving_long: EU_TRACK.arrivingLong,
      obs_overdue: EU_TRACK.obsOverdue,
      boarding_long: EU_TRACK.boardingLong,
      waiting_space: EU_TRACK.waitingSpace,
    })[c];

  const rows = stays.map((s): EuTrackingRow => {
    const boarding = s.admission && s.admission.status !== "cancelled" ? s.admission : null;
    const clocks = euClocks({
      nowMs,
      hospitalArrivedAt: s.hospitalArrivedAt,
      decidedAt: s.decidedAt,
      spaceStartedAt: s.spaceStartedAt,
      admissionDecidedAt: boarding?.decidedAt ?? null,
    });
    const every = s.obsFrequency ? OBS_INTERVAL_MS[s.obsFrequency] : null;
    const due = every === null ? null : Date.parse(s.lastObsAt ?? s.decidedAt) + every;
    const attention: AttentionCode[] = [];
    if (overLimit(clocks.inEuMs, limitHours)) attention.push("over_limit");
    if (s.arriving && (clocks.inSpaceMs ?? 0) > EU_ARRIVING_ATTENTION_MS) attention.push("arriving_long");
    if (due !== null && nowMs > due) attention.push("obs_overdue");
    if ((clocks.boardingMs ?? 0) > EU_BOARDING_ATTENTION_MS) attention.push("boarding_long");
    if (s.status === "awaiting_space") attention.push("waiting_space");
    return {
      ...s,
      clocks,
      statusWord: statusWord(s),
      overLimit: attention.includes("over_limit"),
      nextObsDueAt: due === null ? null : new Date(due).toISOString(),
      attention,
    };
  });

  rows.sort(
    (a, b) =>
      Number(b.status === "awaiting_space") - Number(a.status === "awaiting_space") ||
      Date.parse(a.decidedAt) - Date.parse(b.decidedAt),
  );
  return {
    rows,
    needsAttention: rows.flatMap((r) =>
      r.attention.map((code) => ({ stayId: r.stayId, code, words: words(code) })),
    ),
  };
}
