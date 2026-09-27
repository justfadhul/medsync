"use client";

import type { Draft, SectionStatus } from "../_lib/parse";
import type { FeedbackQuestion } from "@/content/feedback";
import { useEffect, useRef, useState, useTransition } from "react";
import { CheckIcon } from "lucide-react";

import { SegmentedControl } from "@/components/forms";
import { FormHeader } from "@/components/onboarding/sectioned-form";
import { Button } from "@/components/ui/button";
import {
  FEEDBACK_COPY as C,
  FEEDBACK_RESPONDENTS,
  FEEDBACK_SECTIONS as SECTIONS,
} from "@/content/feedback";
import { cn } from "@/lib/utils";
import { notTried, sectionAnswers, statusOf } from "../_lib/parse";
import { submitFeedback } from "../actions";

const DRAFT_KEY = "medsync:feedback-draft";
const RATINGS = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }));

export function FeedbackForm() {
  const [draft, setDraft] = useState<Draft>({ respondent: null, answers: {}, sent: {} });
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cardRef = useRef<HTMLElement>(null);

  // Per-device draft (a long form on a flaky connection); the server copy is what was sent.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      const saved = raw ? (JSON.parse(raw) as Partial<Draft>) : null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore after hydration
      if (saved) setDraft({ respondent: null, answers: {}, sent: {}, ...saved });
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {}
  }, [draft, loaded]);

  const who = FEEDBACK_RESPONDENTS.find((r) => r.slug === draft.respondent);
  const section = SECTIONS[active]!;
  const statuses = SECTIONS.map((s) => statusOf(s, draft));
  const status = statuses[active]!;
  const off = notTried(section, draft.answers);

  const set = (id: string, value: number | string) =>
    setDraft((d) => ({ ...d, answers: { ...d.answers, [id]: value } }));

  function go(i: number) {
    setError(null);
    setActive(i);
    if ((cardRef.current?.getBoundingClientRect().top ?? 0) < 0)
      cardRef.current?.scrollIntoView({ block: "start" });
  }

  function send() {
    setError(null);
    const answers = sectionAnswers(section, draft.answers);
    startTransition(async () => {
      const res = await submitFeedback({ respondent: draft.respondent, answers });
      if (!res.ok) {
        setError(
          res.error === "rate"
            ? C.errorRate
            : res.error === "invalid"
              ? C.errorEmpty
              : C.errorGeneric,
        );
        return;
      }
      const sent = { ...draft.sent, [section.id]: JSON.stringify(answers) };
      setDraft((d) => ({ ...d, sent }));
      // On to the next section not yet sent, if any.
      const next = SECTIONS.findIndex(
        (s, i) => i > active && statusOf(s, { ...draft, sent }) !== "sent",
      );
      if (next !== -1) go(next);
    });
  }

  if (!who)
    return (
      <div className="flex flex-col gap-8">
        <FormHeader kicker="Tester feedback" title={C.title} lead={C.lead} />
        <section className="border-border bg-card shadow-card rounded-lg border p-5 sm:p-6">
          <h2 className="text-heading-s text-foreground mb-5">{C.whoTitle}</h2>
          <SegmentedControl
            name="respondent"
            ariaLabel={C.whoTitle}
            options={FEEDBACK_RESPONDENTS.map((r) => ({ value: r.slug, label: r.name }))}
            // A different tester on this device starts with nothing marked sent.
            onValueChange={(v) =>
              setDraft((d) => ({ ...d, respondent: v, sent: v === d.respondent ? d.sent : {} }))
            }
            className="sm:flex-col"
          />
        </section>
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-display-s text-foreground">{C.title}</h1>
        <p className="text-body-s text-muted-foreground">
          {C.answeringAs} <span className="text-foreground font-medium">{who.name}</span>.{" "}
          <button
            type="button"
            onClick={() => setDraft((d) => ({ ...d, respondent: null }))}
            className="font-medium text-teal-700 underline underline-offset-4 dark:text-teal-400"
          >
            {C.change}
          </button>
        </p>
        {statuses.every((s) => s === "sent") ? (
          <p role="status" className="text-body-s text-foreground flex items-center gap-2">
            <CheckIcon aria-hidden className="size-4 text-teal-700 dark:text-teal-400" />
            {C.allDone}
          </p>
        ) : null}
      </header>

      <div className="grid gap-4 lg:grid-cols-[224px_1fr] lg:items-start lg:gap-6">
        {/* Section list: a column on desktop, a select on phones. */}
        <nav aria-label={C.sectionsLabel} className="hidden lg:sticky lg:top-6 lg:block">
          <ol className="flex flex-col gap-px">
            {SECTIONS.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-current={i === active ? "step" : undefined}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left transition-colors duration-150",
                    i === active ? "bg-muted" : "hover:bg-muted/60",
                  )}
                >
                  <span className="text-muted-foreground text-body-s w-4 shrink-0 font-mono tabular-nums">
                    {i + 1}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-body-s text-foreground font-medium">{s.title}</span>
                    <StatusLabel status={statuses[i]!} />
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <label className="flex flex-col gap-1 lg:hidden">
          <span className="text-muted-foreground text-caption">{C.sectionsLabel}</span>
          <select
            value={active}
            onChange={(e) => go(Number(e.target.value))}
            className="border-input bg-card text-body-s rounded-sm border px-2.5 py-2"
          >
            {SECTIONS.map((s, i) => (
              <option key={s.id} value={i}>
                {i + 1}. {s.title} ({C.status[statuses[i]!]})
              </option>
            ))}
          </select>
        </label>

        <section
          ref={cardRef}
          aria-labelledby="fb-title"
          className="border-border bg-card shadow-card scroll-mt-4 rounded-lg border"
        >
          <header className="border-border flex flex-col gap-1 border-b px-5 py-4 sm:px-6">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-caption text-muted-foreground font-mono">
                {active + 1} {C.of} {SECTIONS.length}
              </p>
              <StatusLabel status={status} />
            </div>
            <h2 id="fb-title" className="text-heading-s text-foreground">
              {section.title}
            </h2>
            <p className="text-body-s text-muted-foreground">
              {section.intro}
              {section.where ? (
                <span className="text-caption ml-1 font-mono">({section.where})</span>
              ) : null}
            </p>
          </header>

          <form
            key={section.id}
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <div className="divide-border flex flex-col divide-y px-5 sm:px-6">
              {(off ? section.questions.slice(0, 1) : section.questions)
                .filter((q) => q.kind !== "text")
                .map((q) => (
                  <Question key={q.id} q={q} value={draft.answers[q.id]} onChange={set} />
                ))}
              {off ? (
                <p className="text-body-s text-muted-foreground py-4">{C.skipped}</p>
              ) : (
                // Written answers side by side from `sm` up: half the height of a stacked list.
                <div className="grid gap-x-5 py-2 sm:grid-cols-2">
                  {section.questions
                    .filter((q) => q.kind === "text")
                    .map((q) => (
                      <Question key={q.id} q={q} value={draft.answers[q.id]} onChange={set} />
                    ))}
                </div>
              )}
            </div>

            <footer className="border-border bg-muted/30 flex flex-col gap-3 rounded-b-lg border-t px-5 py-4 sm:px-6">
              {error ? (
                <p role="alert" className="text-body-s text-destructive">
                  {error}
                </p>
              ) : status === "sent" ? (
                <p role="status" className="text-body-s text-foreground flex items-center gap-2">
                  <CheckIcon aria-hidden className="size-4 text-teal-700 dark:text-teal-400" />
                  {C.sentNote}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={pending || status === "sent"}>
                  {pending ? C.sending : status === "changed" ? C.resend : C.send}
                </Button>
                <span className="ml-auto flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={active === 0}
                    onClick={() => go(active - 1)}
                  >
                    {C.back}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={active === SECTIONS.length - 1}
                    onClick={() => go(active + 1)}
                  >
                    {C.next}
                  </Button>
                </span>
              </div>
              <p className="text-caption text-muted-foreground">{C.draftNote}</p>
            </footer>
          </form>
        </section>
      </div>
    </div>
  );
}

function StatusLabel({ status }: { status: SectionStatus }) {
  return (
    <span
      className={cn(
        "text-caption inline-flex items-center gap-1",
        status === "sent" ? "text-teal-700 dark:text-teal-400" : "text-muted-foreground",
      )}
    >
      {status === "sent" ? <CheckIcon aria-hidden className="size-3" strokeWidth={2.5} /> : null}
      {C.status[status]}
    </span>
  );
}

/** One row per question: label on the left, the control on the right from `sm` up. */
function Question({
  q,
  value,
  onChange,
}: {
  q: FeedbackQuestion;
  value: number | string | undefined;
  onChange: (id: string, value: number | string) => void;
}) {
  if (q.kind === "text")
    return (
      <div className="flex flex-col gap-1.5 py-2">
        <label htmlFor={q.id} className="text-body-s text-foreground font-medium">
          {q.label}
        </label>
        <textarea
          id={q.id}
          rows={2}
          maxLength={4000}
          placeholder={q.hint}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(q.id, e.target.value)}
          className={cn(
            "border-input bg-card text-foreground text-body-s w-full resize-y rounded-sm border px-2.5 py-2 outline-none",
            "ease-expo-out transition-all duration-150 placeholder:text-gray-400",
            "focus-visible:border-ring focus-visible:shadow-[0_0_0_3px_var(--teal-tint),0_0_0_1px_var(--ring)]",
          )}
        />
      </div>
    );

  const rating = q.kind === "rating";
  return (
    <div className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="flex flex-col gap-0.5">
        <p className="text-body-s text-foreground font-medium">{q.label}</p>
        {rating ? (
          <p className="text-caption text-muted-foreground">
            1 = {q.low} · 5 = {q.high}
          </p>
        ) : null}
      </div>
      <SegmentedControl
        name={q.id}
        ariaLabel={q.label}
        stackOnMobile={false}
        options={rating ? RATINGS : q.options.map((o) => ({ value: o, label: o }))}
        value={value === undefined ? "" : String(value)}
        onValueChange={(v) => onChange(q.id, rating ? Number(v) : v)}
        className={cn(
          "shrink-0 [&_label]:py-1.5 [&_label]:text-center",
          // A clearer chosen state than the shared control's tint: this form is mostly ratings.
          "[&_label:has(:checked)]:border-teal-700 [&_label:has(:checked)]:bg-teal-700 [&_label:has(:checked)]:text-white",
          "dark:[&_label:has(:checked)]:border-primary dark:[&_label:has(:checked)]:bg-primary dark:[&_label:has(:checked)]:text-primary-foreground",
          rating ? "sm:w-56" : "sm:w-auto sm:max-w-[55%] sm:justify-end",
        )}
      />
    </div>
  );
}
