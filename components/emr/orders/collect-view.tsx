import type { CollectDraft, CollectTarget, FastingState, PatientIdentity } from "./model";
import type { ReactNode } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusWord } from "../status-word";
import { ChoiceChips } from "./choice-chips";
import {
  collectIssues,
  CONTAINER_OPTIONS,
  containerWords,
  FASTING_OPTIONS,
  PRIORITY_WORD,
  SPECIMEN_OPTIONS,
  specimenWords,
} from "./model";

/**
 * Specimen collection at the bedside (gate-a E.8). The two identifiers are read back to the
 * patient and confirmed with a required check; the fasting chip appears only when the test or a
 * component needs it, with no definition text while REF-DM-FASTING-DEF is unsigned; the specimen
 * and container come from the test menu; the collector is whoever is signed in.
 */
export function CollectView({
  identity,
  target,
  draft,
  collectorName,
  pending = false,
  message = null,
  labelHref = null,
  onConfirm,
  onFasting,
  onFastingHours,
  onCollectedAt,
  onSpecimen,
  onContainer,
  onSave,
}: {
  identity: PatientIdentity;
  target: CollectTarget;
  draft: CollectDraft;
  collectorName: string | null;
  pending?: boolean;
  message?: { ok: boolean; text: string } | null;
  /** Set once the specimen is saved: the label to print. */
  labelHref?: string | null;
  onConfirm?: (v: boolean) => void;
  onFasting?: (v: FastingState) => void;
  onFastingHours?: (v: string) => void;
  onCollectedAt?: (v: string) => void;
  onSpecimen?: (v: string) => void;
  onContainer?: (v: string) => void;
  onSave?: () => void;
}) {
  const issues = collectIssues(target, draft);
  // The identifier check leads the form, so its absence is said by the checkbox, not repeated.
  const shown = issues.filter((i) => draft.identifiersConfirmed || !i.startsWith("Confirm the"));
  const specimen = [specimenWords(target.specimenType), containerWords(target.container)].filter(
    Boolean,
  );
  return (
    <div className="flex flex-col gap-5">
      <p className="text-body-s flex flex-wrap items-center gap-x-3">
        <span className="font-medium">{target.display}</span>
        {target.priority ? <span>{PRIORITY_WORD[target.priority] ?? target.priority}</span> : null}
        {target.rejection ? <StatusWord tone="caution">{target.rejection}</StatusWord> : null}
      </p>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-body-s text-muted-foreground mb-1">Confirm with the patient</legend>
        <p className="text-body-m flex flex-wrap gap-x-4">
          <span className="font-medium">{identity.name}</span>
          <span className="font-mono tabular-nums">{identity.mrn}</span>
          {identity.ageSex.split(" · ").map((p) => (
            <span key={p}>{p}</span>
          ))}
        </p>
        <label className="text-body-s has-[:focus-visible]:shadow-focus inline-flex min-h-11 items-center gap-3 rounded-md sm:min-h-9">
          <input
            type="checkbox"
            required
            checked={draft.identifiersConfirmed}
            onChange={(e) => onConfirm?.(e.target.checked)}
            className="size-5 accent-teal-600"
          />
          Name and MRN confirmed with the patient (required)
        </label>
      </fieldset>

      <Field label="Specimen">
        <div className="flex flex-col gap-2">
          {specimen.length ? (
            <span className="flex flex-wrap gap-x-3">
              {specimen.map((s) => (
                <span key={s}>{s}</span>
              ))}
              <span className="text-muted-foreground">(test menu)</span>
            </span>
          ) : null}
          {target.specimenType ? null : (
            <ChoiceChips
              name={`specimen-${target.orderId}`}
              label="Specimen"
              options={SPECIMEN_OPTIONS}
              value={draft.specimenType}
              onChange={onSpecimen}
            />
          )}
          {target.container ? null : (
            <ChoiceChips
              name={`container-${target.orderId}`}
              label="Container"
              options={CONTAINER_OPTIONS}
              value={draft.container}
              onChange={onContainer}
            />
          )}
        </div>
      </Field>

      {target.needsFasting ? (
        <Field label="Fasting">
          <div className="flex flex-col gap-2">
            <ChoiceChips
              name={`fasting-${target.orderId}`}
              label="Fasting state"
              options={FASTING_OPTIONS}
              value={draft.fastingState}
              onChange={onFasting}
            />
            {draft.fastingState === "fasting" ? (
              <label className="text-body-s flex flex-wrap items-center gap-2">
                Hours since food or drink
                <Input
                  inputMode="decimal"
                  value={draft.fastingHours}
                  onChange={(e) => onFastingHours?.(e.target.value)}
                  className="min-h-11 w-24 font-mono tabular-nums sm:min-h-9"
                />
              </label>
            ) : null}
          </div>
        </Field>
      ) : null}

      <Field label="Collected">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <label className="sr-only" htmlFor={`collected-${target.orderId}`}>
            Collection time (empty is now)
          </label>
          <Input
            id={`collected-${target.orderId}`}
            type="datetime-local"
            value={draft.collectedAt}
            onChange={(e) => onCollectedAt?.(e.target.value)}
            className="min-h-11 w-auto font-mono tabular-nums sm:min-h-9"
          />
          {draft.collectedAt ? null : <span className="text-muted-foreground">Now</span>}
          <span>by {collectorName ?? "you"}</span>
        </div>
      </Field>

      {shown.length ? (
        <ul className="flex flex-col gap-1">
          {shown.map((i) => (
            <li key={i}>
              <StatusWord tone="caution">{i}</StatusWord>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {labelHref ? (
          <Link
            href={labelHref}
            className="tap inline-flex min-h-11 items-center font-medium text-teal-700 underline-offset-4 hover:underline sm:min-h-0"
          >
            Print label
          </Link>
        ) : (
          <Button
            type="button"
            onClick={onSave}
            disabled={pending || issues.length > 0}
            className="min-h-11 sm:min-h-9"
          >
            {pending ? "Saving…" : "Save and print label"}
          </Button>
        )}
        <span role="status" aria-live="polite" className="text-body-s">
          {message ? (
            message.ok ? (
              message.text
            ) : (
              <StatusWord tone="caution">{message.text}</StatusWord>
            )
          ) : null}
        </span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="text-body-s grid gap-x-4 gap-y-1 sm:grid-cols-[6rem_1fr] sm:items-start">
      <span className="text-muted-foreground sm:pt-1.5">{label}</span>
      <div>{children}</div>
    </div>
  );
}
