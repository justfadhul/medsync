/**
 * The note's Plan block, composed by fixed rules (ADR 0184 §6): disposition; monitoring; one
 * numbered line per problem with its tests (priority and frequency, ordered or not yet), care
 * items, prescriptions (override reasons and changes from the regimen) and its note; admission
 * medicines; talked through; follow-up. Pure; the same words on screen and in the signed note.
 */
import type { PlanDraft } from "./draft";
import type { ObsRequirement } from "./observations";
import type { ProblemCard } from "./problems";
import type { PlanRecord } from "./record";

import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { CHART_FREQUENCY_WORD, CHART_NAME } from "@/lib/emr/charts/rules";
import { ORDER_FREQUENCY_WORD, ORDER_PRIORITY_WORD } from "@/lib/emr/orders";
import { EDIT_FIELD_WORD } from "@/lib/prescribing/plan-rx";
import { basketOf } from "./draft";
import { lessOftenThanRequired, OBS_WORD } from "./observations";
import { standing } from "./record";

export const SENIOR_REVIEW_WORD = {
  now: "now",
  within_1h: "within 1 hour",
  routine: "routine",
} as const;

export const DISPOSITION_WORD = {
  admit: "Admit",
  observe_eu: "Observe in EU",
  refer: "Refer",
  discharge: "Discharge",
} as const;

/** Talked through: generic items, draft wording for the CSO (labelled as such on screen). */
export const TALKED_THROUGH = [
  { id: "diagnosis", label: "What we think is wrong" },
  { id: "tests", label: "The tests and why" },
  { id: "treatment", label: "The treatment and its side effects" },
  { id: "next", label: "What happens next" },
  { id: "questions", label: "Questions answered" },
] as const;
export const TALKED_THROUGH_DISCHARGE = [
  { id: "follow_up", label: "Follow-up" },
  { id: "come_back", label: "When to come back" },
] as const;

export const FOLLOW_UP_WHEN = {
  "1w": "1 week",
  "2w": "2 weeks",
  "4w": "4 weeks",
  "3m": "3 months",
  none: "No follow-up needed",
} as const;

const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

function orderWords(o: {
  display: string;
  priority: string | null;
  frequency: string | null;
}): string {
  const bits = [
    o.priority ? ORDER_PRIORITY_WORD[o.priority as keyof typeof ORDER_PRIORITY_WORD] : null,
    o.priority === "routine" && o.frequency
      ? ORDER_FREQUENCY_WORD[o.frequency as keyof typeof ORDER_FREQUENCY_WORD]
      : null,
  ].filter(Boolean);
  return bits.length ? `${o.display} (${bits.join(", ").toLowerCase()})` : o.display;
}

export interface ComposeInput {
  plan: PlanDraft;
  cards: readonly ProblemCard[];
  record: PlanRecord;
  obsRequired: ObsRequirement | null;
  news2Total: number | null;
}

export function composePlanLines(i: ComposeInput): string[] {
  const { plan, cards, record } = i;
  const lines: string[] = [];
  const d = plan.disposition;
  if (d) {
    const where =
      d.kind === "admit" && d.ward
        ? `Admit to ${d.ward}`
        : d.kind === "refer" && d.referTo
          ? `Refer to ${d.referTo}`
          : DISPOSITION_WORD[d.kind];
    lines.push(sentence(where));
  }

  const monitoring: string[] = [];
  if (plan.observations) {
    const obs = plan.observations;
    let s = `Observations ${OBS_WORD[obs.frequency].toLowerCase()}`;
    if (i.news2Total != null) s += ` (NEWS2 ${i.news2Total})`;
    if (lessOftenThanRequired(obs.frequency, i.obsRequired) && obs.reason?.trim())
      s += `, less often than NEWS2 calls for: ${obs.reason.trim()}`;
    monitoring.push(s);
  }
  for (const c of record.charts) {
    if (c.kind === "observations" || c.kind === "mar") continue;
    let s = `${CHART_NAME[c.kind].toLowerCase()} chart`;
    if (c.frequency) s += ` ${CHART_FREQUENCY_WORD[c.frequency].toLowerCase()}`;
    if (c.kind === "fluid_balance")
      s +=
        c.measureUrine || plan.measureUrine
          ? ", urine output measured"
          : ", urine output not measured";
    monitoring.push(s);
  }
  const basket = basketOf(plan);
  const word = (u: string) =>
    (CARE_REQUEST_COPY.urgency[u as keyof typeof CARE_REQUEST_COPY.urgency] ?? u).toLowerCase();
  const review = record.requests.findLast((r) => r.kind === "review");
  if (review)
    monitoring.push(`senior review requested from ${review.targetWords}, ${word(review.urgency)}`);
  else if (plan.seniorReview)
    monitoring.push(
      `senior review ${SENIOR_REVIEW_WORD[plan.seniorReview]}${
        basket.requests.some((r) => r.kind === "review") ? " (not yet sent)" : ""
      }`,
    );
  else if (plan.seniorReviewNotNeeded?.trim())
    monitoring.push(`no senior review needed: ${plan.seniorReviewNotNeeded.trim()}`);
  if (monitoring.length)
    lines.push(sentence(monitoring[0]!.charAt(0).toUpperCase() + monitoring.join("; ").slice(1)));

  cards.forEach((c, n) => {
    const parts: string[] = [];
    const linked = new Set(plan.problems?.[c.logicalId]?.linked ?? []);
    const ordered = record.orders.filter(
      (o) => o.reasonConditionIds.includes(c.versionId) || linked.has(o.id),
    );
    const notYet = basket.orders.filter((o) => o.reasonConditionIds.includes(c.versionId));
    if (ordered.length) parts.push(`ordered ${ordered.map(orderWords).join(", ")}`);
    if (notYet.length) parts.push(`not yet ordered ${notYet.map(orderWords).join(", ")}`);
    const rx = record.prescriptions.filter((r) => standing(r) && r.conditionId === c.versionId);
    for (const r of rx) {
      const extra = [
        ...r.answered.map((a) => a.charAt(0).toLowerCase() + a.slice(1)),
        ...(r.edits.length
          ? [
              `changed from default: ${r.edits
                .map((e) => `${EDIT_FIELD_WORD[e.field].toLowerCase()} ${e.from} → ${e.to}`)
                .join(", ")}`,
            ]
          : []),
        r.awaitingCosign ? "awaiting senior co-sign" : null,
      ].filter(Boolean);
      parts.push(`${r.display}${extra.length ? ` (${extra.join("; ")})` : ""}`);
    }
    const pendingRx = basket.prescriptions.filter((r) => r.conditionId === c.versionId);
    for (const r of pendingRx) parts.push(`not yet prescribed ${r.display}`);
    const p = plan.problems?.[c.logicalId];
    if (c.mustNotMiss && !ordered.length && !rx.length && p?.mnmReason?.trim())
      parts.push(`no test or treatment: ${p.mnmReason.trim()}`);
    if (p?.note?.trim()) parts.push(p.note.trim());
    lines.push(
      sentence(`${n + 1}. ${c.display}: ${parts.length ? parts.join("; ") : "no plan recorded"}`),
    );
  });

  for (const r of record.requests)
    if (r.kind === "consult")
      lines.push(
        `Consult requested from ${r.targetWords} (${r.helpWanted ? `${CARE_REQUEST_COPY.help[r.helpWanted].toLowerCase()}, ` : ""}${word(r.urgency)}).`,
      );

  const meds = record.medicines.filter((m) => m.answer !== "pending");
  if (meds.length)
    lines.push(
      sentence(
        `Medicines on admission: ${meds
          .map((m) => `${m.display} ${m.answer}${m.reason ? ` (${m.reason})` : ""}`)
          .join("; ")}`,
      ),
    );

  const talked = [...TALKED_THROUGH, ...TALKED_THROUGH_DISCHARGE].filter(
    (t) => plan.talkedThrough?.[t.id],
  );
  if (talked.length)
    lines.push(sentence(`Talked through: ${talked.map((t) => t.label.toLowerCase()).join(", ")}`));

  if (d?.kind === "discharge" && plan.followUp?.when) {
    const f = plan.followUp;
    const when = FOLLOW_UP_WHEN[f.when as keyof typeof FOLLOW_UP_WHEN] ?? f.when;
    lines.push(
      sentence(
        `Follow-up: ${when}${f.where ? `, ${f.where}` : ""}${f.comeBackAdvice ? "; when-to-come-back advice given" : ""}`,
      ),
    );
  }
  return lines;
}

export const composePlanText = (i: ComposeInput) => composePlanLines(i).join("\n");
