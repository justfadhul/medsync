import type { Metadata } from "next";
import Link from "next/link";
import { asc } from "drizzle-orm";

import { FEEDBACK_RESPONDENTS, FEEDBACK_SECTIONS } from "@/content/feedback";
import { db } from "@/db";
import { testerFeedback } from "@/db/schema/tester-feedback";
import { logger } from "@/lib/logger";

export const metadata: Metadata = {
  title: "Tester feedback · Superadmin · MedSync",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Kampala",
});

/**
 * Responses to `/feedback`. Testers send one section at a time (and may resend it); each
 * question shows the tester's latest answer to it, so one section's send never blanks another. Every row stays in `tester_feedback`. Superadmin-only via the layout.
 */
export default async function FeedbackAdminPage() {
  let rows: (typeof testerFeedback.$inferSelect)[] | null = null;
  try {
    rows = await db.select().from(testerFeedback).orderBy(asc(testerFeedback.createdAt));
  } catch (e) {
    logger.error("feedback.read_failed", { reason: (e as Error).message });
  }

  const byPerson = new Map<
    string,
    { answers: Record<string, number | string>; n: number; last: Date }
  >();
  for (const r of rows ?? []) {
    const p = byPerson.get(r.respondent) ?? { answers: {}, n: 0, last: r.createdAt };
    Object.assign(p.answers, r.answers);
    p.n += 1;
    p.last = r.createdAt;
    byPerson.set(r.respondent, p);
  }
  const people = FEEDBACK_RESPONDENTS.filter((r) => byPerson.has(r.slug));

  return (
    <div className="flex flex-col">
      <header className="border-border border-b px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-1">
          <h1 className="font-display text-display-s text-foreground">Tester feedback</h1>
          <p className="text-muted-foreground text-[13.5px]">
            From the public form at{" "}
            <Link
              href="/feedback"
              className="text-teal-700 underline underline-offset-4 dark:text-teal-400"
            >
              /feedback
            </Link>
            . Each cell is that tester&apos;s latest answer; ratings are 1 (worst) to 5 (best).
          </p>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8">
        {rows === null ? (
          <p className="text-body-s text-muted-foreground">
            Couldn&apos;t read responses. Has migration 0081_tester_feedback been applied?
          </p>
        ) : null}

        <section
          aria-label="Who has responded"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          {FEEDBACK_RESPONDENTS.map((r) => {
            const p = byPerson.get(r.slug);
            return (
              <div key={r.slug} className="border-border bg-card shadow-card rounded-lg border p-4">
                <p className="text-body-s text-foreground font-medium">{r.name}</p>
                <p className="text-caption text-muted-foreground mt-1">
                  {p
                    ? `${p.n} send${p.n > 1 ? "s" : ""} · last ${dateFmt.format(p.last)}`
                    : "Nothing sent yet"}
                </p>
                {p ? (
                  <p className="text-caption text-muted-foreground mt-1">
                    {FEEDBACK_SECTIONS.filter((s) =>
                      Object.keys(p.answers).some((k) => k.startsWith(`${s.id}.`)),
                    )
                      .map((s) => s.title)
                      .join(" · ")}
                  </p>
                ) : null}
              </div>
            );
          })}
        </section>

        {people.length > 0
          ? FEEDBACK_SECTIONS.map((s) => {
              const closed = s.questions.filter((q) => q.kind !== "text");
              const open = s.questions.filter((q) => q.kind === "text");
              return (
                <section
                  key={s.id}
                  aria-labelledby={`fa-${s.id}`}
                  className="border-border bg-card shadow-card rounded-lg border p-5 sm:p-6"
                >
                  <h2 id={`fa-${s.id}`} className="text-heading-s text-foreground mb-4">
                    {s.title}
                  </h2>

                  <div className="overflow-x-auto">
                    <table className="text-body-s w-full min-w-[640px] border-collapse">
                      <thead>
                        <tr className="text-caption text-muted-foreground border-border border-b text-left">
                          <th className="py-2 pr-4 font-medium">Question</th>
                          {people.map((p) => (
                            <th key={p.slug} className="px-2 py-2 font-medium">
                              {p.name.replace(/^Dr\. /, "")}
                            </th>
                          ))}
                          <th className="px-2 py-2 font-medium">Average</th>
                        </tr>
                      </thead>
                      <tbody>
                        {closed.map((q) => {
                          const vals = people.map((p) => byPerson.get(p.slug)!.answers[q.id]);
                          const nums = vals.filter((v): v is number => typeof v === "number");
                          return (
                            <tr key={q.id} className="border-border border-b last:border-0">
                              <td className="text-foreground py-2 pr-4">{q.label}</td>
                              {vals.map((v, i) => (
                                <td key={people[i]!.slug} className="px-2 py-2 tabular-nums">
                                  {v ?? <span className="text-muted-foreground">—</span>}
                                </td>
                              ))}
                              <td className="text-foreground px-2 py-2 font-medium tabular-nums">
                                {nums.length
                                  ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1)
                                  : ""}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {open.map((q) => {
                    const said = people.flatMap((p) => {
                      const v = byPerson.get(p.slug)!.answers[q.id];
                      return typeof v === "string" ? [{ who: p.name, v }] : [];
                    });
                    if (!said.length) return null;
                    return (
                      <div key={q.id} className="mt-5">
                        <h3 className="text-body-s text-foreground mb-2 font-medium">{q.label}</h3>
                        <ul className="flex flex-col gap-2">
                          {said.map((a) => (
                            <li
                              key={a.who}
                              className="text-body-s bg-muted/50 rounded-md px-3 py-2"
                            >
                              <span className="text-muted-foreground text-caption block">
                                {a.who}
                              </span>
                              <span className="whitespace-pre-wrap">{a.v}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </section>
              );
            })
          : null}
      </div>
    </div>
  );
}
