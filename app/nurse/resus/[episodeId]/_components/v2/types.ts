import type { PrescribeAuthority } from "../prescribe-dialog";
import type { MenuTest } from "@/components/emr/orders/model";
import type { ResusPatientView } from "@/lib/resus/board";
import type { BayProfile, CareLevel, CareUnit, EpisodePhase, OutcomeCode } from "@/lib/resus/model";
import type { ResponderEntry, RosterEntry } from "@/lib/resus/record";
import type { TimelineEvent } from "@/lib/resus/types";

/**
 * Resus Desk v2 — the serialisable data the server page hands the client desk
 * (lib/resus/desk-v2-loader.ts builds it). Everything the UI needs; nothing the
 * UI must not see (names only via the audited patient view).
 */

export interface DeskEpisode {
  id: string;
  state: "active" | "concluded" | "cancelled";
  phase: EpisodePhase;
  currentArrestSeq: number;
  triggerKind: string;
  triggerReason: string | null;
  startedAtIso: string;
  endedAtIso: string | null;
  lastActivityAtIso: string | null;
  arrestDetectedAtIso: string | null;
  deathConfirmedAtIso: string | null;
  disposition: string | null;
  outcomeCode: OutcomeCode | null;
  closureKind: "bedside" | "administrative" | null;
  cancelReason: string | null;
  suggestedLevel: CareLevel | null;
  chosenLevel: CareLevel | null;
  destinationUnitId: string | null;
  dispositionDecidedAtIso: string | null;
  bayProfileId: string | null;
  triageRecordId: string | null;
  /** The episode's department (where the patient is) — never the viewer's own. */
  departmentName?: string | null;
}

export interface DeskMe {
  userId: string;
  fullName: string | null;
  cadreCode: string;
  cadreName: string;
  hospitalName: string;
  departmentName: string;
  /** Leader recommended for this cadre (soft; never gates). */
  leaderRecommended: boolean;
  /** Doctor / CO — stop recommended; treatment-limitation allowed (D9, D11). */
  stopRecommended: boolean;
  /** Ward in-charge or consultant — administrative close of idle episodes. */
  canAdminClose: boolean;
  prescribeAuthority: PrescribeAuthority;
}

export interface DeskSettings {
  antiarrhythmic: "amiodarone" | "lidocaine";
  rhythmCheckTone: boolean;
  metronome: boolean;
}

/** One after-death checklist row (resus_after_death_tasks; latest per task wins). */
export interface AfterDeathTaskRow {
  taskId: string;
  state: "done" | "not_applicable" | "pending";
  recordedAtIso: string;
}

/** The saved debrief (resus_debriefs), if any. */
export interface DebriefSeed {
  attendeeCount: number | null;
  wentWell: string;
  toImprove: string;
  actions: string;
  equipmentIssues: string;
  welfareCheckDone: boolean;
  status: "draft" | "submitted";
  /** The saved version (R6): a save names it, so an older one never overwrites a newer. */
  updatedAtIso: string;
}

/**
 * The mutable, non-event parts of the desk — the episode row, the team, the
 * after-close records. Loaded with the page and re-read (fetchDeskSnapshotV2)
 * whenever the record changes, so nothing here goes stale in-session.
 */
export interface DeskSnapshot {
  episode: DeskEpisode;
  roster: RosterEntry[];
  responders: ResponderEntry[];
  afterDeathTasks: AfterDeathTaskRow[];
  debrief: DebriefSeed | null;
  /** Staff who recorded any row (R6): staff names only, no PHI. */
  recorders: { userId: string; fullName: string | null }[];
}

export interface DeskInitialData extends DeskSnapshot {
  patient: ResusPatientView;
  /** The FULL immutable store (superseded rows included — "show history"). */
  events: TimelineEvent[];
  me: DeskMe;
  settings: DeskSettings;
  bayProfiles: BayProfile[];
  careUnits: CareUnit[];
  /**
   * The facility test menu for the close-out's "Outstanding tests" (A5). Null when EMR v1 is off
   * here: nothing would consume them, so the close-out does not ask.
   */
  testMenu: MenuTest[] | null;
  /** Server time at render — the client clock offset starts from it. */
  serverTimeIso: string;
  /** "/nurse/resus" or "/doctor/resus". */
  basePath: string;
}

/** What a queued write reports back. */
export type WriteOutcome =
  /**
   * `warnings`: non-blocking safety messages a fast-path drug returns.
   * `eventIds`: the rows the write created — the entry stays until they reach the record.
   */
  | { ok: true; warnings?: string[]; eventIds?: string[] }
  | { ok: false; error: string; retry: boolean; openDialog?: FastPathDialog; signedOut?: boolean };

export interface FastPathDialog {
  drugId: string;
  recCode: "als_adrenaline" | "als_amiodarone" | "als_lidocaine";
  doseMg: number | null;
  reasons: string[];
}

export type SyncStatus = "pending" | "sending" | "failed";

export interface PendingEntry {
  clientEventId: string;
  label: string;
  status: SyncStatus;
  attempts: number;
  error: string | null;
  /** Provisional rows rendered at once (ids "pending:<clientEventId>"). */
  optimistic: TimelineEvent[];
  queuedAtMs: number;
}
