import type { FeedbackSection, RespondentSlug } from "@/content/feedback";

import { FEEDBACK_RESPONDENTS, FEEDBACK_SECTIONS, NOT_TRIED } from "@/content/feedback";

export type FeedbackAnswers = Record<string, number | string>;

const QUESTIONS = new Map(FEEDBACK_SECTIONS.flatMap((s) => s.questions).map((q) => [q.id, q]));
const TEXT_MAX = 4000;

/**
 * Trust boundary for the public form: keeps only known question ids with a valid value (a rating
 * 1–5, a listed option, trimmed text ≤ 4,000 chars). Unknown keys and empty answers are dropped.
 * Null when the respondent isn't on the list or nothing was answered.
 */
export function parseFeedback(
  input: unknown,
): { respondent: RespondentSlug; answers: FeedbackAnswers } | null {
  if (typeof input !== "object" || input === null) return null;
  const { respondent, answers } = input as { respondent?: unknown; answers?: unknown };
  const who = FEEDBACK_RESPONDENTS.find((r) => r.slug === respondent);
  if (!who || typeof answers !== "object" || answers === null) return null;

  const out: FeedbackAnswers = {};
  for (const [id, value] of Object.entries(answers)) {
    const q = QUESTIONS.get(id);
    if (!q) continue;
    if (q.kind === "rating") {
      if (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5)
        out[id] = value as number;
    } else if (q.kind === "choice") {
      if (typeof value === "string" && q.options.includes(value)) out[id] = value;
    } else if (typeof value === "string" && value.trim()) {
      out[id] = value.trim().slice(0, TEXT_MAX);
    }
  }
  return Object.keys(out).length ? { respondent: who.slug, answers: out } : null;
}

// ─── Per-section sending (client) ───────────────────────────────────────

export interface Draft {
  respondent: string | null;
  answers: FeedbackAnswers;
  /** Section id → JSON of what was sent, to tell "Sent" from "Changed since sent". */
  sent: Record<string, string>;
}
export type SectionStatus = "sent" | "changed" | "draft" | "empty";

export const notTried = (s: FeedbackSection, a: FeedbackAnswers) =>
  !!s.gated && a[`${s.id}.tried`] === NOT_TRIED;

/** What a section sends: its non-empty answers, or only "tried" when the tester didn't try it. */
export function sectionAnswers(s: FeedbackSection, a: FeedbackAnswers): FeedbackAnswers {
  const out: FeedbackAnswers = {};
  for (const q of notTried(s, a) ? s.questions.slice(0, 1) : s.questions) {
    const v = a[q.id];
    if (v !== undefined && !(typeof v === "string" && !v.trim())) out[q.id] = v;
  }
  return out;
}

export function statusOf(s: FeedbackSection, d: Draft): SectionStatus {
  const now = JSON.stringify(sectionAnswers(s, d.answers));
  if (d.sent[s.id]) return d.sent[s.id] === now ? "sent" : "changed";
  return now === "{}" ? "empty" : "draft";
}
