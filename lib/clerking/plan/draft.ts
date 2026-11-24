/**
 * The Plan's draft (ADR 0184 §4): `content.plan` of the clerking v2 note. Where and how closely,
 * the per-problem notes, the basket, what was talked through, follow-up and "plan done". Placed
 * orders and prescriptions live in the record, not here. Validated at the trust boundary like the
 * other v2 steps (`ContentV2Keys`).
 */
import { z } from "zod";

import { ORDER_FREQUENCIES, ORDER_PRIORITIES } from "@/lib/emr/orders";
import { PlanRxReplaces, PlanRxSchema } from "@/lib/prescribing/plan-rx";
import {
  CONSULT_URGENCIES,
  HELP_WANTED,
  REQUEST_KINDS,
  REVIEW_URGENCIES,
} from "@/lib/requests/engine";

const id = z.string().max(80);
const uuid = z.uuid();
const text = (n: number) => z.string().max(n);

export const DISPOSITIONS = ["admit", "observe_eu", "refer", "discharge"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];
export const OBS_FREQUENCIES = ["continuous", "hourly", "4h", "12h"] as const;
export type ObsFrequencyChoice = (typeof OBS_FREQUENCIES)[number];
export const SENIOR_REVIEW = ["now", "within_1h", "routine"] as const;
export type SeniorReview = (typeof SENIOR_REVIEW)[number];

export const PlanOrderLineSchema = z.object({
  clientKey: z.string().trim().min(8).max(120),
  /** The test_catalogue uuid the order names. */
  testId: uuid,
  /** The catalogue's test id (`test.*`), for the chart rules and the words. */
  testKey: id,
  display: text(200),
  priority: z.enum(ORDER_PRIORITIES),
  frequency: z.enum(ORDER_FREQUENCIES).nullable(),
  /** The problems it is for: condition version ids (as `placeOrders` takes them). */
  reasonConditionIds: z.array(uuid).min(1).max(10),
});
export type PlanOrderLine = z.infer<typeof PlanOrderLineSchema>;

export const PlanBasketRxSchema = PlanRxSchema.extend({
  /** The words the dialog showed, for the basket bar and the note before placing. */
  display: text(400),
  drugName: text(160),
  problemLogicalId: uuid.nullable(),
  /** Pharmacy Phase 1 (5.4, H4): this line changes a placed one; placed together, atomically. */
  replaces: PlanRxReplaces.optional(),
});
export type PlanBasketRx = z.infer<typeof PlanBasketRxSchema>;

/** A review or consult in the basket (ADR 0537); the refine mirrors care_requests' CHECKs (0306). */
export const PlanRequestLineSchema = z
  .object({
    clientKey: z.string().trim().min(8).max(120),
    kind: z.enum(REQUEST_KINDS),
    targetDepartmentId: uuid,
    wardId: uuid.nullable(),
    namedUserIds: z.array(uuid).max(5),
    urgency: z.union([z.enum(REVIEW_URGENCIES), z.enum(CONSULT_URGENCIES)]),
    helpWanted: z.enum(HELP_WANTED).nullable(),
    reasonConditionIds: z.array(uuid).max(10),
    question: text(2_000),
    phoned: z.object({ userId: uuid, at: z.iso.datetime({ offset: true }) }).nullable(),
    /** The basket words; never sent to the request table. */
    display: text(300),
  })
  .superRefine((l, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    const urgencies: readonly string[] = l.kind === "review" ? REVIEW_URGENCIES : CONSULT_URGENCIES;
    if (!urgencies.includes(l.urgency)) issue("urgency", "Not an urgency for this kind.");
    if (l.kind === "review" && l.helpWanted !== null)
      issue("helpWanted", "A review takes no help wanted.");
    if (l.kind === "consult") {
      if (l.helpWanted === null) issue("helpWanted", "Say what help is wanted.");
      if (!l.reasonConditionIds.length) issue("reasonConditionIds", "Choose the problem.");
      if (!l.question.trim()) issue("question", "Write the question.");
    }
  });
export type PlanRequestLine = z.infer<typeof PlanRequestLineSchema>;

export const PlanSchema = z.object({
  disposition: z
    .object({
      kind: z.enum(DISPOSITIONS),
      /** Admit: the ward's name (the words; drafts saved before ADR 0197 have only this); Refer: where to. */
      ward: text(120).optional(),
      /** Admit: the ward's id (ADR 0197 §5), what the close admits to. */
      wardId: uuid.optional(),
      referTo: text(200).optional(),
    })
    .optional(),
  observations: z
    .object({
      frequency: z.enum(OBS_FREQUENCIES),
      /** Why less often than NEWS2 calls for; goes into the note. */
      reason: text(500).optional(),
    })
    .optional(),
  seniorReview: z.enum(SENIOR_REVIEW).optional(),
  /** Keyed by condition logical id. */
  problems: z
    .record(
      uuid,
      z.object({
        note: text(4_000).optional(),
        /** Must-not-miss with no test and no treatment: the reason. */
        mnmReason: text(1_000).optional(),
        /** Suggested care ticked (by signed item id; the list is empty until signed). */
        care: z.record(id, z.boolean()).optional(),
        /** Orders already placed for another problem, linked to this one ("Link to this"). */
        linked: z.array(uuid).max(20).optional(),
      }),
    )
    .optional(),
  basket: z
    .object({
      orders: z.array(PlanOrderLineSchema).max(40),
      prescriptions: z.array(PlanBasketRxSchema).max(40),
    })
    .optional(),
  talkedThrough: z.record(id, z.boolean()).optional(),
  followUp: z
    .object({
      when: id.optional(),
      where: text(200).optional(),
      comeBackAdvice: z.boolean().optional(),
    })
    .optional(),
  /** "Measure urine output" on the fluid balance chart. */
  measureUrine: z.boolean().optional(),
  /** Mark plan done: who, when, and the fingerprint of what was done. A change reopens it. */
  done: z.object({ by: text(80), at: text(40), hash: text(40) }).optional(),
  /** The composed Plan block, written at signing. */
  text: text(40_000).optional(),
});
export type PlanDraft = z.infer<typeof PlanSchema>;

export const EMPTY_PLAN: PlanDraft = {};

export const basketOf = (d: PlanDraft) => d.basket ?? { orders: [], prescriptions: [] };
