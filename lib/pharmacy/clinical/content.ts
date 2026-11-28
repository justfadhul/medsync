import { z } from "zod";

/**
 * Pharmacy Phase 3: signed clinical content (CC-1 to CC-5). Pure: the shapes of each pack's payload, which entries
 * act, the signing rule, and the candidate import as a plan of drafts. No value here is a clinical figure: every
 * level, window and pair is typed by a person and signed (Law 6).
 */

export const PACKS = [
  "interaction_pair",
  "alert_levels",
  "lookback_windows",
  "query_codes_added",
  "check_worth_signing",
  "pcne_map",
  "aware_pack",
  "review_settings",
  "reaction_timelines",
  "reconciliation_rules",
] as const;
export type Pack = (typeof PACKS)[number];

/** MR-3: the discrepancy rules of 5.7, R1 to R14. */
export const RULES = [
  "R1",
  "R2",
  "R3",
  "R4",
  "R5",
  "R6",
  "R7",
  "R8",
  "R9",
  "R10",
  "R11",
  "R12",
  "R13",
  "R14",
] as const;
export type Rule = (typeof RULES)[number];

export const SEVERITIES = ["contraindicated", "serious", "monitor"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const LEVELS = ["stop", "check", "note", "hidden"] as const;
export type Level = (typeof LEVELS)[number];
const medicineId = z.string().regex(/^[a-z0-9_]{2,80}$/);
const days = z.number().int().min(0).max(3650);
const levelsBySeverity = z.object({
  contraindicated: z.enum(LEVELS),
  serious: z.enum(LEVELS),
  monitor: z.enum(LEVELS),
});

export const PAYLOADS = {
  interaction_pair: z.object({
    a: medicineId,
    b: medicineId,
    severity: z.enum(SEVERITIES),
    effect: z.string().trim().min(3).max(1000),
    management: z.string().trim().min(3).max(1000),
    /** IX-4a: given together as a regimen; never above Note in the dialog. */
    byDesign: z.boolean(),
    /** IX-8: a restricted class the pair names, if any. */
    restricted: z.enum(["hiv", "tb", "srh"]).nullable(),
    /** D-PH3-04: applies to every form unless a route is named. */
    route: z.string().trim().max(40).nullable(),
  }),
  alert_levels: z.object({
    dialog: levelsBySeverity,
    review: levelsBySeverity,
    suppressionDays: days,
  }),
  lookback_windows: z.object({
    chartedHours: z
      .number()
      .int()
      .min(0)
      .max(24 * 30),
    suppliedDays: days,
    suppliedDaysByMedicine: z.record(medicineId, days),
  }),
  query_codes_added: z.object({
    codes: z.array(
      z.object({
        code: z.string().regex(/^[a-z_]{2,60}$/),
        words: z.string().trim().min(2).max(80),
      }),
    ),
  }),
  check_worth_signing: z.object({ minimum: z.number().int().min(1).max(100000) }),
  pcne_map: z.object({
    /** D-PH3-19: the PCNE Board's written permission; the pack cannot be signed without it. */
    permissionRef: z.string().trim().min(3).max(200),
    version: z.string().trim().min(1).max(20),
    map: z.record(
      z.string(),
      z.object({ problem: z.string().max(10), intervention: z.string().max(10) }),
    ),
  }),
  /** AM-0, D-PH3-06: one signed edition; key "medicine" or "medicine:route"; unmatched listed, never guessed. */
  aware_pack: z.object({
    edition: z.string().trim().min(3).max(200),
    tags: z.record(
      z.string().regex(/^[a-z0-9_]{2,80}(:[a-z_]{2,20})?$/),
      z.enum(["Access", "Watch", "Reserve", "unknown"]),
    ),
    unmatched: z.array(z.string().max(120)),
  }),
  /** D-PH3-07: interval per group, typed by the AMS chair; none proposed. */
  review_settings: z.object({
    intervalDays: z.object({
      Access: z.number().int().min(1).max(60).optional(),
      Watch: z.number().int().min(1).max(60).optional(),
      Reserve: z.number().int().min(1).max(60).optional(),
    }),
    noCultureWindowHours: z
      .number()
      .int()
      .min(0)
      .max(24 * 14),
  }),
  /** D-PH3-22: the due-by display only. */
  reaction_timelines: z.object({
    seriousHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 30),
    otherDays: z.number().int().min(1).max(365),
  }),
  /** MR-3: which discrepancy rules are on, and the reasons a pharmacist may give to explain one. */
  reconciliation_rules: z.object({
    on: z.array(z.enum(RULES)).max(RULES.length),
    explainReasons: z.array(z.string().trim().min(2).max(160)).min(1).max(30),
  }),
} satisfies Record<Pack, z.ZodType>;

/** AM-0 import: exact match on the generic name to the hospital's list; everything else is listed as unmatched. */
export function planAware(
  rows: readonly { inn: string; aware: string }[],
  medicines: readonly { id: string; generic: string }[],
  edition: string,
): Payload<"aware_pack"> {
  const byName = new Map(medicines.map((m) => [m.generic.trim().toLowerCase(), m.id]));
  const tags: Record<string, "Access" | "Watch" | "Reserve" | "unknown"> = {};
  const unmatched: string[] = [];
  for (const r of rows) {
    const id = byName.get(r.inn.trim().toLowerCase());
    const g = r.aware as "Access" | "Watch" | "Reserve";
    if (id && ["Access", "Watch", "Reserve"].includes(g)) tags[id] = g;
    else unmatched.push(r.inn);
  }
  return { edition, tags, unmatched: unmatched.slice(0, 1000) };
}
export type Payload<P extends Pack> = z.infer<(typeof PAYLOADS)[P]>;

export type Status = "draft" | "reviewer_signed" | "in_force" | "withdrawn";
export interface Entry<P extends Pack = Pack> {
  id: string;
  pack: P;
  key: string;
  version: number;
  payload: Payload<P>;
  source: string | null;
  status: Status;
  blocked: "not_matched" | "waits_for_class_map" | null;
  authorUserId: string;
}

/** CC-1, Law 3: only entries in force act. */
export const inForce = <P extends Pack>(entries: readonly Entry<P>[]): Entry<P>[] =>
  entries.filter((e) => e.status === "in_force");

/** CC-2 and 5.2: why an entry cannot be sent for signing, or null. */
export function cannotSend(
  e: Pick<Entry, "pack" | "source" | "blocked" | "payload">,
): string | null {
  if (e.blocked === "not_matched") return "not_matched";
  if (e.blocked === "waits_for_class_map") return "waits_for_class_map";
  if (e.pack === "interaction_pair" && !e.source?.trim()) return "no_source";
  if (e.pack === "pcne_map" && !(e.payload as Payload<"pcne_map">).permissionRef)
    return "no_permission";
  return null;
}

/**
 * CC-2: may this person sign now? The author is never the only signer where another eligible signer exists; where
 * none exists, a recorded exception lets one signature put the entry in force (D-PH3-26).
 */
export function signRefusal(input: {
  authorUserId: string;
  signerUserId: string;
  alreadySigned: readonly string[];
  otherEligibleSigners: number;
  exception: string | null;
  /** The signer is the head of pharmacy (`pharmacy.manage`): they sign alone, their own entries too (ADR 0550). */
  head?: boolean;
}): string | null {
  if (input.alreadySigned.includes(input.signerUserId)) return "already_signed";
  if (input.head) return null;
  const others = input.otherEligibleSigners > 0;
  if (input.signerUserId === input.authorUserId && others && input.alreadySigned.length === 0)
    return "author_first";
  if (!others && !input.exception) return "exception_needed";
  return null;
}

/** After a signature: in force with two signers, or one with an exception; else reviewer-signed. */
export const statusAfterSigning = (signers: number, exception: boolean): Status =>
  signers >= 2 || (signers === 1 && exception) ? "in_force" : "reviewer_signed";

export interface Candidate {
  id: string;
  a: string;
  b: string;
  aClass: string | null;
  bClass: string | null;
  severity: string;
  effect: string;
  management: string;
  sources: { id: string; where: string }[];
}

/**
 * CC-3: the import as a plan. Exact match on the generic name (case and spacing only); a class waits for the signed
 * drug-class map (CC-5); an unknown medicine is "not matched". Candidates already imported are skipped.
 */
export function planImport(
  candidates: readonly Candidate[],
  medicines: readonly { id: string; generic: string }[],
  sourceTitles: Record<string, string>,
  already: ReadonlySet<string>,
) {
  const byName = new Map(medicines.map((m) => [m.generic.trim().toLowerCase(), m.id]));
  const drafts = [];
  const counts = { matched: 0, not_matched: 0, waits_for_class_map: 0, skipped: 0 };
  for (const c of candidates) {
    if (already.has(c.id)) {
      counts.skipped++;
      continue;
    }
    const a = byName.get(c.a?.trim().toLowerCase() ?? "");
    const b = byName.get(c.b?.trim().toLowerCase() ?? "");
    const blocked: Entry["blocked"] =
      c.aClass || c.bClass ? "waits_for_class_map" : a && b ? null : "not_matched";
    counts[blocked ?? "matched"]++;
    // No default severity (Law 6): a candidate with an unknown one stops the import.
    if (!(SEVERITIES as readonly string[]).includes(c.severity))
      throw new Error(`Candidate ${c.id} has an unknown severity "${c.severity}".`);
    const severity = c.severity as Severity;
    drafts.push({
      candidateId: c.id,
      key: [c.a, c.b].sort().join("+"),
      blocked,
      source: c.sources
        .map((s) => `${sourceTitles[s.id] ?? s.id}, ${s.where}`)
        .join("; ")
        .slice(0, 1000),
      payload: {
        a: a ?? "unmatched",
        b: b ?? "unmatched",
        severity,
        effect: c.effect.slice(0, 1000),
        management: c.management.slice(0, 1000),
        byDesign: false,
        restricted: null,
        route: null,
      } satisfies Payload<"interaction_pair">,
    });
  }
  return { drafts, counts };
}
