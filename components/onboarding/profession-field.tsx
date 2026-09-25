"use client";

import type { Profession } from "@/lib/onboarding/profession";
import { useCallback } from "react";
import { useController, useFormContext } from "react-hook-form";

import { CLINICAL } from "@/content/onboarding";
import { COUNCILS, professionById, PROFESSIONS } from "@/lib/onboarding/profession";
import { FieldError, fieldId, useFieldError } from "./fields";
import { ChosenCard, SearchField } from "./search-field";

/**
 * One grouped, searchable profession list (§5.6, ADR 0123). The council is shown, never chosen;
 * there is no grade or role picker (O11). Options carry keywords ("doctor", "MO", "physio").
 */
const norm = (s: string) => s.toLowerCase();
export function ProfessionField({ name = "profession" }: { name?: string }) {
  const { control } = useFormContext();
  const { field } = useController({ name, control });
  const error = useFieldError(name);
  const chosen = professionById(field.value ?? "");
  const id = fieldId(name);
  const search = useCallback((q: string) => {
    const t = norm(q).trim();
    return t
      ? PROFESSIONS.filter(
          (p) =>
            norm(`${p.label} ${p.keywords}`)
              .split(/\s+/)
              .some((w) => w.startsWith(t)) || norm(p.label).includes(t),
        )
      : [...PROFESSIONS];
  }, []);
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-field={name}>
      <label htmlFor={id} className="text-body-s text-foreground font-medium">
        {CLINICAL.profession}
      </label>
      {chosen ? (
        <ChosenCard onChange={() => field.onChange("")}>
          <p className="text-body-m text-foreground font-medium">{chosen.label}</p>
        </ChosenCard>
      ) : (
        <SearchField<Profession>
          id={id}
          placeholder={CLINICAL.professionPlaceholder}
          search={search}
          minChars={0}
          optionKey={(o) => o.id}
          optionText={(o) => `${o.label}, ${COUNCILS[o.council].group}`}
          group={(o) => `${COUNCILS[o.council].group} · ${COUNCILS[o.council].short}`}
          renderOption={(o) => <span className="text-body-m text-foreground">{o.label}</span>}
          onSelect={(o) => {
            field.onChange(o.id);
            field.onBlur();
          }}
          describedBy={error ? `${id}-error` : undefined}
          invalid={!!error}
        />
      )}
      {chosen ? (
        <p className="text-body-s text-muted-foreground">
          {CLINICAL.registeredWith(COUNCILS[chosen.council].short)}
        </p>
      ) : null}
      <FieldError name={name} />
    </div>
  );
}
