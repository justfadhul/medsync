import type { ChartContext } from "./parts";
import type { ChartPayload, EnteredInErrorItem } from "@/lib/emr/chart";
import Link from "next/link";

import { RestrictedMark } from "../chips";
import { EmptyState } from "../empty-state";
import { withoutNameOnly } from "../format";
import { StatusWord } from "../status-word";
import { EnteredInErrorList, SectionHeading, SubHeading } from "./parts";

/**
 * Problems and allergies. Every active problem (the bar shows three). The allergy record states one
 * of its four things in words; an uncoded allergen carries the name-only label in full here.
 */
export function ProblemsAllergiesView({
  problems,
  allergies,
  ctx,
  headingId,
  enteredInError = [],
}: {
  problems: ChartPayload["summary"]["problems"];
  allergies: ChartPayload["summary"]["allergies"];
  ctx: ChartContext;
  headingId?: string;
  enteredInError?: readonly EnteredInErrorItem[];
}) {
  const voided = (s: EnteredInErrorItem["section"]) => (
    <EnteredInErrorList
      items={enteredInError.filter((i) => i.section === s)}
      timeZone={ctx.timeZone}
    />
  );
  const record = ctx.links.allergies
    ? {
        label: allergies.state === "listed" ? "Edit allergies" : "Record allergies",
        href: ctx.links.allergies,
      }
    : null;
  return (
    <div className="flex flex-col gap-6">
      <SectionHeading id={headingId}>Problems and allergies</SectionHeading>
      <section className="flex flex-col gap-2">
        <SubHeading>Active problems</SubHeading>
        {problems.length === 0 ? (
          <EmptyState
            action={
              ctx.links.desk ? { label: "Open the clerking desk", href: ctx.links.desk } : null
            }
          >
            No active problems recorded.
          </EmptyState>
        ) : (
          <ul className="flex flex-col">
            {problems.map((p) => (
              <li
                key={p.id}
                className="border-border/60 text-body-s flex items-baseline justify-between gap-4 border-b py-2 last:border-0"
              >
                <span className="inline-flex flex-wrap items-center gap-2">
                  <span className="text-foreground">{p.display}</span>
                  {p.restricted ? <RestrictedMark /> : null}
                </span>
                {p.since ? (
                  <span className="text-muted-foreground font-mono tabular-nums">
                    <span className="sr-only">Since </span>
                    {p.since}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {voided("problems")}
      </section>
      <section className="flex flex-col gap-2">
        <SubHeading>Allergies</SubHeading>
        {allergies.state === "listed" ? (
          <>
            <ul className="flex flex-col">
              {allergies.items.map((a) => (
                <li
                  key={a.id}
                  className="border-border/60 text-body-s flex flex-wrap items-center gap-2 border-b py-2 last:border-0"
                >
                  <span className="text-foreground">{withoutNameOnly(a.text)}</span>
                  {a.byNameOnly ? (
                    <StatusWord tone="caution">
                      Matched by name only — code it for class checks
                    </StatusWord>
                  ) : null}
                  {a.restricted ? <RestrictedMark /> : null}
                </li>
              ))}
            </ul>
            {record ? (
              <Link
                href={record.href}
                className="text-body-s tap inline-flex min-h-11 w-fit items-center rounded-sm font-medium text-teal-700 underline-offset-4 hover:underline sm:min-h-0"
              >
                {record.label}
              </Link>
            ) : null}
          </>
        ) : allergies.tone === "neutral" ? (
          <EmptyState action={record ? { ...record, label: "Re-confirm" } : null}>
            {allergies.text}
          </EmptyState>
        ) : (
          <EmptyState action={record}>
            <StatusWord tone={allergies.tone}>{allergies.text}</StatusWord>
          </EmptyState>
        )}
        {voided("allergies")}
      </section>
    </div>
  );
}
