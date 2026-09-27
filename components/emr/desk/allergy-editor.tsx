"use client";

import type { AllergyLine } from "@/lib/emr/chart";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { RestrictedMark } from "../chips";
import { withoutNameOnly } from "../format";
import { ChoiceChips, PRESS } from "../orders/choice-chips";
import { StatusWord } from "../status-word";

/**
 * The allergy editor (gate-a E.6), in a sheet. The status first: the listed allergies, or "No
 * known drug allergies" / "Unable to assess" as one-tap assertions. Then add an allergy: the
 * substance is matched against the formulary's own ingredients and classes (one vocabulary); words
 * that match nothing are kept and labelled "Matched by name only — code it for class checks"
 * (amber) — never dropped, because prescribing still checks them by name. Saving an active
 * allergy supersedes "No known drug allergies" on the server.
 */

/** lib/emr/allergy.ts NAME_ONLY_LABEL, repeated so the client does not bundle the formulary behind
 *  it; tests/emr/ui/desk-views.test.ts holds the two equal. */
export const NAME_ONLY_LABEL = "Matched by name only — code it for class checks";

export interface Substance {
  kind: "drug_ingredient" | "drug_class";
  code: string;
  label: string;
}

export interface AllergyDraft {
  text: string;
  category: "medication" | "food" | "environment" | "biologic";
  allergyType: "allergy" | "intolerance";
  manifestations: string[];
  severity: "mild" | "moderate" | "severe" | null;
  criticality: "high" | "low" | "unable_to_assess" | null;
  verification: "confirmed" | "unconfirmed";
  informant: "patient" | "relative" | "record" | "clinician_observed";
}

export const EMPTY_ALLERGY: AllergyDraft = {
  text: "",
  category: "medication",
  allergyType: "allergy",
  manifestations: [],
  severity: null,
  criticality: null,
  verification: "unconfirmed",
  informant: "patient",
};

/** The substance as the server takes it: coded when the words name a formulary item exactly. */
export function substanceOf(text: string, list: readonly Substance[]) {
  const t = text.trim();
  const hit = list.find((s) => s.label.toLowerCase() === t.toLowerCase() || s.code === t);
  return hit ? { kind: hit.kind, code: hit.code } : { kind: "other" as const, text: t };
}

const REACTIONS = [
  ["rash", "Rash"],
  ["urticaria", "Urticaria"],
  ["angioedema", "Angioedema"],
  ["anaphylaxis", "Anaphylaxis"],
  ["bronchospasm", "Bronchospasm"],
  ["sjs_ten", "SJS/TEN"],
  ["other", "Other"],
] as const;

export function AllergyEditorView({
  line,
  patient,
  substances,
  pending,
  message,
  onAssert,
  onSave,
}: {
  line: AllergyLine;
  patient: { name: string; mrn: string };
  substances: readonly Substance[];
  pending?: boolean;
  message?: { ok: boolean; text: string } | null;
  onAssert?: (a: "no_known_drug_allergies" | "unable_to_assess") => void;
  onSave?: (d: AllergyDraft) => void;
}) {
  const [d, setD] = useState<AllergyDraft>(EMPTY_ALLERGY);
  const put = (patch: Partial<AllergyDraft>) => setD((x) => ({ ...x, ...patch }));
  const coded = d.text.trim() ? "code" in substanceOf(d.text, substances) : true;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-caption text-muted-foreground">
        <span>{patient.name}</span> <span className="font-mono tabular-nums">{patient.mrn}</span>
      </p>
      <section className="flex flex-col gap-3" aria-labelledby="allergy-status">
        <h3 id="allergy-status" className="text-body-s text-foreground font-medium">
          Status
        </h3>
        {line.state === "listed" ? (
          <ul className="flex flex-col gap-1.5">
            {line.items.map((a) => (
              <li
                key={a.id}
                className="text-body-s text-foreground flex flex-wrap items-center gap-2"
              >
                {withoutNameOnly(a.text)}
                {a.byNameOnly ? <StatusWord tone="caution">{NAME_ONLY_LABEL}</StatusWord> : null}
                {a.restricted ? <RestrictedMark /> : null}
              </li>
            ))}
          </ul>
        ) : line.tone === "neutral" ? (
          <p className="text-body-s text-foreground">{line.text}</p>
        ) : (
          <StatusWord tone={line.tone}>{line.text}</StatusWord>
        )}
        {line.state !== "listed" ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              className={PRESS}
              disabled={pending}
              onClick={() => onAssert?.("no_known_drug_allergies")}
            >
              {line.state === "no_known_drug_allergies"
                ? "Re-confirm no known drug allergies"
                : "No known drug allergies"}
            </Button>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => onAssert?.("unable_to_assess")}
            >
              Unable to assess
            </Button>
          </div>
        ) : null}
      </section>

      <form
        className="border-border flex flex-col gap-4 border-t pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (d.text.trim()) onSave?.(d);
        }}
      >
        <h3 className="text-body-s text-foreground font-medium">Add an allergy</h3>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="allergy-substance" className="text-caption text-muted-foreground">
            Substance
          </label>
          <Input
            id="allergy-substance"
            list="allergy-substances"
            value={d.text}
            onChange={(e) => put({ text: e.target.value })}
            autoComplete="off"
          />
          <datalist id="allergy-substances">
            {substances.map((s) => (
              <option key={`${s.kind}:${s.code}`} value={s.label} />
            ))}
          </datalist>
          {!coded ? <StatusWord tone="caution">{NAME_ONLY_LABEL}</StatusWord> : null}
        </div>
        <div className="flex flex-col gap-1">
          <span aria-hidden className="text-caption text-muted-foreground">
            Category
          </span>
          <ChoiceChips
            name="allergy-category"
            label="Category"
            options={[
              { value: "medication", label: "Medication" },
              { value: "food", label: "Food" },
              { value: "environment", label: "Environment" },
              { value: "biologic", label: "Biologic" },
            ]}
            value={d.category}
            onChange={(category) => put({ category })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span aria-hidden className="text-caption text-muted-foreground">
            Type
          </span>
          <ChoiceChips
            name="allergy-type"
            label="Type"
            options={[
              { value: "allergy", label: "Allergy" },
              { value: "intolerance", label: "Intolerance" },
            ]}
            value={d.allergyType}
            onChange={(allergyType) => put({ allergyType })}
          />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-caption text-muted-foreground mb-1">Reaction</legend>
          <div className="flex flex-wrap gap-2">
            {REACTIONS.map(([code, label]) => {
              const on = d.manifestations.includes(code);
              return (
                <label
                  key={code}
                  className={cn(
                    "text-body-s has-[:focus-visible]:shadow-focus inline-flex min-h-11 cursor-pointer items-center rounded-full border px-3 select-none sm:min-h-8",
                    PRESS,
                    on ? "border-teal-600 bg-teal-50 font-medium text-teal-800" : "border-border",
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    onChange={() =>
                      put({
                        manifestations: on
                          ? d.manifestations.filter((m) => m !== code)
                          : [...d.manifestations, code],
                      })
                    }
                  />
                  {label}
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="flex flex-col gap-1">
          <span aria-hidden className="text-caption text-muted-foreground">
            Severity
          </span>
          <ChoiceChips
            name="allergy-severity"
            label="Severity"
            options={[
              { value: "mild", label: "Mild" },
              { value: "moderate", label: "Moderate" },
              { value: "severe", label: "Severe" },
            ]}
            value={d.severity}
            onChange={(severity) => put({ severity })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span aria-hidden className="text-caption text-muted-foreground">
            Criticality
          </span>
          <ChoiceChips
            name="allergy-criticality"
            label="Criticality"
            options={[
              { value: "high", label: "High" },
              { value: "low", label: "Low" },
              { value: "unable_to_assess", label: "Unable to assess" },
            ]}
            value={d.criticality}
            onChange={(criticality) => put({ criticality })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span aria-hidden className="text-caption text-muted-foreground">
            Verification
          </span>
          <ChoiceChips
            name="allergy-verification"
            label="Verification"
            options={[
              { value: "confirmed", label: "Confirmed" },
              { value: "unconfirmed", label: "Unconfirmed" },
            ]}
            value={d.verification}
            onChange={(verification) => put({ verification })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span aria-hidden className="text-caption text-muted-foreground">
            Informant
          </span>
          <ChoiceChips
            name="allergy-informant"
            label="Informant"
            options={[
              { value: "patient", label: "Patient" },
              { value: "relative", label: "Relative" },
              { value: "record", label: "Record" },
              { value: "clinician_observed", label: "Observed" },
            ]}
            value={d.informant}
            onChange={(informant) => put({ informant })}
          />
        </div>
        {message ? (
          message.ok ? (
            <p role="status" className="text-body-s text-foreground">
              {message.text}
            </p>
          ) : (
            <p role="status">
              <StatusWord tone="caution">{message.text}</StatusWord>
            </p>
          )
        ) : null}
        <div>
          <Button type="submit" className={PRESS} disabled={!d.text.trim() || pending}>
            Save allergy
          </Button>
        </div>
      </form>
    </div>
  );
}
