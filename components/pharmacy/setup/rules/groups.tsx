"use client";

import type { RuleGroupRow, RuleRow, RulesView } from "@/lib/pharmacy/setup/types";
import Link from "next/link";
import { useState } from "react";

import { signGroupAction } from "@/app/pharmacy/setup/setup-actions";
import { linkBtn } from "@/components/pharmacy/medicines/shared";
import { Chip, useAct } from "@/components/pharmacy/roster/swaps";
import { LabButton } from "@/components/tide/work/button";
import { Pill } from "@/components/tide/work/kit";
import { day, RULES_TAB as R, SHOWS_ON_HREF } from "@/content/pharmacy-setup-rules";
import { ruleText } from "@/lib/pharmacy/derive/setup/rules";
import { cn } from "@/lib/utils";
import { AddRule } from "./add-rule";
import { ChangeRule } from "./change";

const card = "bg-card shadow-tide-card rounded-tide-card min-w-0";
const ROW = "md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_6rem] md:gap-x-3";

/** C3: the group list on the left, the chosen group's rules on the right; stacks below 900 px. */
export function Groups({
  view,
  nav,
  cur,
  q,
  onPick,
  toast,
}: {
  view: RulesView;
  nav: RuleGroupRow[];
  cur: RuleGroupRow;
  q: string;
  onPick: (key: string) => void;
  toast: (m: string) => void;
}) {
  const [edit, setEdit] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const full = (k: string) => view.groups.find((g) => g.key === k);
  return (
    <div className="grid items-start gap-4 min-[900px]:grid-cols-[260px_minmax(0,1fr)]">
      <nav aria-label={R.groupsAria} className={cn(card, "flex flex-col gap-0.5 p-2.5")}>
        {nav.map((g) => {
          const on = g.key === cur.key;
          const np = view.proposals.filter((p) => p.group === g.key).length;
          const flag = !g.signed ? R.notSigned : np ? R.nWaiting(np) : null;
          return (
            <button
              key={g.key}
              type="button"
              aria-current={on || undefined}
              onClick={() => (onPick(g.key), setEdit(null), setAdding(null))}
              className={cn(
                "focus-visible:shadow-focus ease-expo-out flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left transition-colors duration-150 outline-none",
                on ? "bg-tide-lagoon-tint" : "hover:bg-ink-50",
              )}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-body-s text-foreground font-semibold">{g.title}</span>
                <span className="text-ink-600 text-[11px] leading-[14px]">
                  {g.showsOn.join(" · ")}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-caption text-ink-600 tabular-nums">
                  {full(g.key)?.rules.length ?? g.rules.length}
                </span>
                {flag ? (
                  <Chip tone="amber" small>
                    {flag}
                  </Chip>
                ) : null}
              </span>
            </button>
          );
        })}
      </nav>

      <section aria-label={cur.title} className={cn(card, "flex flex-col gap-3 p-4")}>
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-heading-m text-foreground">{cur.title}</h2>
            <span className="text-caption text-ink-600 flex flex-wrap items-center gap-1.5">
              {R.showsOn}
              {cur.showsOn.map((w) => (
                <Link
                  key={w}
                  href={SHOWS_ON_HREF[w] ?? "/pharmacy/setup"}
                  className="bg-tide-sunken text-foreground focus-visible:shadow-focus inline-flex h-[22px] items-center rounded-full px-2 text-[12px] font-semibold outline-none hover:underline"
                >
                  {w}
                </Link>
              ))}
            </span>
          </div>
          <Chip tone={cur.signed ? "green" : "amber"}>{cur.signed ? R.signed : R.notSigned}</Chip>
        </div>

        {!cur.signed ? <UnsignedBanner g={cur} view={view} toast={toast} /> : null}

        <div>
          <div
            aria-hidden
            className={cn(
              ROW,
              "text-ink-600 hidden px-2 py-2 text-[12px] font-semibold tracking-[0.04em] uppercase md:grid",
            )}
          >
            <span>{R.cols.rule}</span>
            <span>{R.cols.says}</span>
            <span>{R.cols.applies}</span>
            <span />
          </div>
          <ul className="divide-border border-border flex flex-col divide-y border-t">
            {cur.rules.map((r) => {
              const id = `${cur.key}:${r.key}`;
              return (
                <li key={r.key}>
                  <Line
                    g={cur}
                    r={r}
                    canChange={view.can.propose && !r.pendingId && edit !== id}
                    onChange={() => (setEdit(id), setAdding(null))}
                  />
                  {edit === id ? (
                    <ChangeRule g={cur} r={r} toast={toast} onClose={() => setEdit(null)} />
                  ) : null}
                </li>
              );
            })}
          </ul>
          {!cur.rules.length ? (
            <p className="text-body-s text-ink-600 border-border border-t px-2 py-3">
              {R.noMatch(q)}
            </p>
          ) : null}
        </div>

        {adding === cur.key ? (
          <AddRule g={cur} toast={toast} onClose={() => setAdding(null)} />
        ) : view.can.propose && !q ? (
          <button
            type="button"
            className={cn(linkBtn, "w-fit")}
            onClick={() => (setAdding(cur.key), setEdit(null))}
          >
            {R.add}
          </button>
        ) : null}
      </section>
    </div>
  );
}

function Line({
  g,
  r,
  canChange,
  onChange,
}: {
  g: RuleGroupRow;
  r: RuleRow;
  canChange: boolean;
  onChange: () => void;
}) {
  const last = g.signatures
    .map((s) => s.at)
    .sort()
    .at(-1);
  const source = r.changedAt
    ? (r.isNew ? R.source.added : R.source.changed)(day(r.changedAt))
    : r.source === "signed" && last
      ? R.source.signed(
          day(last),
          g.signatures.map((s) => s.byName),
        )
      : R.source.default;
  return (
    <div
      className={cn(
        ROW,
        "hover:bg-ink-50 flex flex-col gap-1 rounded-xl px-2 py-2.5 md:items-center",
      )}
    >
      <span className="flex flex-col gap-0.5">
        <b className="text-body-s text-foreground font-semibold">{r.name}</b>
        <span className="text-ink-600 text-[11px] leading-[14px]">{source}</span>
      </span>
      <span className="text-body-s text-foreground flex flex-wrap items-center gap-1.5">
        <span>{r.text}</span>
        {r.param && r.n !== null ? (
          <Pill tone="lagoon" className="h-5 px-2 tabular-nums">
            {ruleText({ text: "{n}", param: r.param }, r.n)}
          </Pill>
        ) : null}
        {r.pendingId ? (
          <Pill tone="caution" className="h-5 px-2">
            {R.changeWaiting}
          </Pill>
        ) : null}
      </span>
      <span className="text-caption text-ink-700">{r.appliesTo}</span>
      <span className="md:text-right">
        {canChange ? (
          <LabButton size="sm" aria-label={R.changeAria(r.name)} onClick={onChange}>
            {R.change}
          </LabButton>
        ) : null}
      </span>
    </div>
  );
}

/** "Not signed yet" with the two group signatures. */
function UnsignedBanner({
  g,
  view,
  toast,
}: {
  g: RuleGroupRow;
  view: RulesView;
  toast: (m: string) => void;
}) {
  const [pending, run] = useAct(toast);
  const has = (role: "in_charge" | "second") => g.signatures.some((s) => s.role === role);
  const sign = (role: "in_charge" | "second") =>
    run(
      () => signGroupAction({ group: g.key, role }),
      // ADR 0550: the head's signature signs the group.
      () => (role === "in_charge" ? R.groupSigned(g.title) : R.groupSignedSecond),
    );
  const btn = (role: "in_charge" | "second") =>
    has(role) ? (
      <Chip key={role} tone="grey">
        {role === "in_charge" ? R.inChargeSigned : R.secondSigned}
      </Chip>
    ) : (role === "in_charge" ? view.can.signInCharge : view.can.signSecond) ? (
      <LabButton key={role} size="sm" busy={pending} onClick={() => sign(role)}>
        {role === "in_charge" ? R.signInCharge : R.signSecond}
      </LabButton>
    ) : null;
  return (
    <div className="bg-status-caution-bg text-status-caution-fg-aa rounded-tide-tile flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3.5 py-3">
      <span className="text-body-s font-semibold">{R.unsignedBanner}</span>
      <span className="flex flex-wrap gap-1.5">
        {btn("in_charge")}
        {btn("second")}
      </span>
    </div>
  );
}
