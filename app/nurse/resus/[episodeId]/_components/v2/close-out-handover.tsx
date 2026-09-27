"use client";

import type { CloseOutDraft, StepProps } from "./close-out-model";
import type { MenuTest } from "@/components/emr/orders/model";
import type { SbarDraft } from "@/lib/resus/closeout/handover";
import { useState } from "react";
import { CheckIcon } from "lucide-react";

import { menuSections } from "@/components/emr/orders/model";
import { OUTSTANDING_REASON_MAX, OUTSTANDING_TESTS_MAX } from "@/lib/resus/closeout/handover";
import { LEVELS_OF_CARE } from "@/lib/resus/reference/levels-of-care";
import { cn } from "@/lib/utils";
import { FIELD } from "./after-arrest-shared";
import { Field } from "./close-out-ui";
import { DESTINATION_WORD, hhmm } from "./close-out-words";
import { useDeskCtx } from "./desk-context";

/**
 * Lane U6 — close-out steps 3 (handover) and 4 (sign). The SBAR draft is
 * built from the record (CO-HO-01..03) and stays editable: an edited section
 * is the leader's; the others follow the record as it changes. Outstanding
 * actions are carried forward unless unticked.
 */

const SBAR: { key: keyof SbarDraft; label: string; max: number }[] = [
  { key: "situation", label: "S — Situation", max: 4000 },
  { key: "background", label: "B — Background", max: 4000 },
  { key: "assessment", label: "A — Assessment", max: 6000 },
  { key: "recommendation", label: "R — Recommendation", max: 4000 },
];

export function HandoverStep({
  draft,
  patch,
  facts,
  menu,
}: StepProps & { menu: MenuTest[] | null }) {
  const carried = facts.outstanding.filter((o) => !draft.dropped.includes(o.key));
  const toggle = (key: string) =>
    patch({
      dropped: draft.dropped.includes(key)
        ? draft.dropped.filter((k) => k !== key)
        : [...draft.dropped, key],
    });
  return (
    <>
      <p className="text-body-s text-muted-foreground">
        Drafted from the record — edit before signing. Items the record does not hold read
        &ldquo;not recorded&rdquo;.
      </p>
      {SBAR.map(({ key, label, max }) => {
        const edited = draft.sbarEdits[key] !== undefined;
        return (
          <Field
            key={key}
            id={`co-sbar-${key}`}
            label={label}
            aside={
              edited ? (
                <button
                  type="button"
                  onClick={() => {
                    const next = { ...draft.sbarEdits };
                    delete next[key];
                    patch({ sbarEdits: next });
                  }}
                  className="text-caption min-h-11 px-2 text-teal-700 underline-offset-2 hover:underline"
                >
                  Use the record&rsquo;s draft
                </button>
              ) : null
            }
          >
            <textarea
              id={`co-sbar-${key}`}
              rows={key === "assessment" ? 8 : 4}
              maxLength={max}
              value={draft.sbarEdits[key] ?? facts.sbar[key]}
              onChange={(e) => patch({ sbarEdits: { ...draft.sbarEdits, [key]: e.target.value } })}
              className={cn(FIELD, "font-mono")}
            />
          </Field>
        );
      })}

      <Field id="co-devices" label="Lines, tubes, devices (one per line)">
        <textarea
          id="co-devices"
          rows={3}
          maxLength={1000}
          value={draft.devices ?? facts.devicesDefault.join("\n")}
          onChange={(e) => patch({ devices: e.target.value })}
          className={FIELD}
        />
      </Field>

      {facts.outstanding.length > 0 ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-overline text-muted-foreground mb-1 uppercase">
            Outstanding actions carried forward ({carried.length}/{facts.outstanding.length})
          </legend>
          {facts.outstanding.map((o) => {
            const on = !draft.dropped.includes(o.key);
            return (
              <label
                key={o.key}
                className="text-body-s text-foreground flex min-h-11 cursor-pointer items-center gap-3"
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(o.key)}
                  className="size-4 accent-teal-600"
                />
                {o.label}
              </label>
            );
          })}
        </fieldset>
      ) : null}

      {menu ? (
        <OutstandingTests menu={menu} tests={draft.tests} onChange={(tests) => patch({ tests })} />
      ) : null}

      <Field id="co-escort" label="Escort">
        <input
          id="co-escort"
          maxLength={200}
          value={draft.escort}
          onChange={(e) => patch({ escort: e.target.value })}
          placeholder="Who goes with the patient"
          className={FIELD}
        />
      </Field>
    </>
  );
}

const SHOWN = 8;

/**
 * A5 — optional. Tests from the facility menu (the order sheet's favourites and search) with a
 * short reason each. They reach the receiving clinician's Plan as suggestions, never as orders.
 */
export function OutstandingTests({
  menu,
  tests,
  onChange,
}: {
  menu: MenuTest[];
  tests: CloseOutDraft["tests"];
  onChange: (tests: CloseOutDraft["tests"]) => void;
}) {
  const [query, setQuery] = useState("");
  const byId = new Map(menu.map((t) => [t.id, t]));
  const chosen = new Set(tests.map((t) => t.testId));
  const { favourites, rest } = menuSections(menu, query);
  const offer = (query.trim() ? rest : favourites).filter((t) => !chosen.has(t.id)).slice(0, SHOWN);
  const full = tests.length >= OUTSTANDING_TESTS_MAX;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-overline text-muted-foreground mb-1 uppercase">
        Outstanding tests (optional)
      </legend>
      <p className="text-body-s text-muted-foreground">
        Suggested to the receiving clinician, who accepts or dismisses each. Nothing is ordered
        here.
      </p>
      {tests.length ? (
        <ul className="divide-border flex flex-col divide-y" aria-label="Outstanding tests chosen">
          {tests.map((t, i) => {
            const name = byId.get(t.testId)?.display ?? "Test no longer on the menu";
            return (
              <li key={t.testId} className="flex flex-wrap items-center gap-2 py-2">
                <span className="text-body-s text-foreground min-w-0 flex-1">{name}</span>
                <input
                  aria-label={`Reason for ${name} (optional)`}
                  maxLength={OUTSTANDING_REASON_MAX}
                  value={t.reason}
                  placeholder="Reason (optional)"
                  onChange={(e) =>
                    onChange(tests.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)))
                  }
                  className={cn(FIELD, "sm:max-w-[18rem]")}
                />
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() => onChange(tests.filter((_, j) => j !== i))}
                  className="text-caption min-h-11 px-2 text-teal-700 underline-offset-2 hover:underline"
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <input
        type="search"
        aria-label="Find a test"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a test"
        className={FIELD}
      />
      {full ? (
        <p className="text-body-s text-muted-foreground">{`Up to ${OUTSTANDING_TESTS_MAX} tests.`}</p>
      ) : offer.length ? (
        <ul
          className="flex flex-wrap gap-2"
          aria-label={query.trim() ? "Matching tests" : "Favourites"}
        >
          {offer.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onChange([...tests, { testId: t.id, reason: "" }])}
                className="tap text-body-s border-border text-foreground hover:bg-muted focus-visible:shadow-focus inline-flex min-h-11 items-center rounded-md border px-3 outline-none"
              >
                {`Add ${t.display}`}
              </button>
            </li>
          ))}
        </ul>
      ) : query.trim() ? (
        <p className="text-body-s text-muted-foreground">No test on the menu matches.</p>
      ) : null}
    </fieldset>
  );
}

export function SignStep({
  draft,
  patch,
  facts,
  receivingUnit,
}: StepProps & { receivingUnit: string }) {
  const d = useDeskCtx();
  const me = d.initial.me;
  // The roster's leader, not whoever signs (a scribe may end the resus).
  const leader = d.store.roster.find((r) => r.role === "leader");
  const rows: [string, string][] = [
    [
      "Leader",
      leader
        ? `${leader.fullName ?? "Name not recorded"}${leader.userId === me.userId ? " (you)" : ""}`
        : "Not set",
    ],
    ["Signed by", `${me.fullName ?? "You"} (${me.cadreName})`],
    [
      "Destination",
      `${draft.destination ? (DESTINATION_WORD[draft.destination] ?? draft.destination) : "—"}${facts.unit ? ` — ${facts.unit.name}` : ""}`,
    ],
    [
      "Level of care",
      `chosen ${facts.chosen ? LEVELS_OF_CARE[facts.chosen].label : "none"} · suggested ${facts.suggestion.level ? LEVELS_OF_CARE[facts.suggestion.level].label : "none"}`,
    ],
    ["Handover time", hhmm(d.store.nowMs())],
  ];
  return (
    <>
      <dl className="border-border divide-border flex flex-col divide-y rounded-lg border">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 px-4 py-3 sm:grid-cols-[9rem_1fr]">
            <dt className="text-overline text-muted-foreground uppercase">{k}</dt>
            <dd className="text-body-s text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
      <Field id="co-receiving-unit" label="Receiving unit">
        <input
          id="co-receiving-unit"
          maxLength={120}
          value={receivingUnit}
          onChange={(e) => patch({ receivingUnit: e.target.value })}
          className={FIELD}
        />
      </Field>
      <Field id="co-receiving-cadre" label="Receiving clinician (name, cadre)">
        <input
          id="co-receiving-cadre"
          maxLength={60}
          value={draft.receivingCadre}
          onChange={(e) => patch({ receivingCadre: e.target.value })}
          className={FIELD}
        />
      </Field>
      <p className="text-body-s text-muted-foreground flex items-start gap-2">
        <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-teal-700" />
        Ending signs the handover into the record. The record then becomes read-only.
      </p>
    </>
  );
}
