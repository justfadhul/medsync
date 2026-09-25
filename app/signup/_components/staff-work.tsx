"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { useController, useFormContext } from "react-hook-form";

import {
  ChoiceField,
  FieldError,
  fieldId,
  FieldShell,
  inputClass,
  useFieldA11y,
  useFieldError,
} from "@/components/onboarding/fields";
import { ChosenCard, SearchField } from "@/components/onboarding/search-field";
import { STAFF_COMMON } from "@/content/onboarding";
import { STAFF } from "@/content/onboarding-staff";
import { cn } from "@/lib/utils";
import { departmentsAction } from "../_actions/lookup";

/*
 * "Where you work" for both staff forms (§5.4): hospital (searched locally, the list ships with the
 * page), then its departments (loaded on pick; cleared when the hospital changes), then employment.
 * `afterHospital` holds the clinical form's "My hospital isn't on MedSync".
 */

export interface HospitalOption {
  id: string;
  name: string;
}

export const EMPLOYMENT_OPTIONS = Object.entries(STAFF_COMMON.employmentOptions).map(
  ([value, label]) => ({ value, label }),
);

const norm = (s: string) => s.toLowerCase().trim();

export function WorkFields({
  hospitals,
  departmentLabel,
  afterHospital,
  children,
}: {
  hospitals: readonly HospitalOption[];
  departmentLabel: string;
  afterHospital?: ReactNode;
  children?: ReactNode;
}) {
  const { control, setValue } = useFormContext();
  const { field: hospital } = useController({ name: "hospitalId", control });
  const hospitalError = useFieldError("hospitalId");
  const chosen = hospitals.find((h) => h.id === hospital.value) ?? null;
  const id = fieldId("hospitalId");

  const search = useCallback(
    (q: string) => (q ? hospitals.filter((h) => norm(h.name).includes(norm(q))) : [...hospitals]),
    [hospitals],
  );
  const pick = (next: string) => {
    hospital.onChange(next);
    hospital.onBlur();
    setValue("departmentId", "", { shouldValidate: false }); // a department belongs to one hospital
  };

  return (
    <>
      <div className="flex min-w-0 flex-col gap-1.5" data-field="hospitalId">
        <label htmlFor={id} className="text-body-s text-foreground font-medium">
          {STAFF_COMMON.hospital}
        </label>
        {chosen ? (
          <ChosenCard onChange={() => pick("")}>
            <p className="text-body-m text-foreground font-medium">{chosen.name}</p>
          </ChosenCard>
        ) : (
          <SearchField<HospitalOption>
            id={id}
            placeholder={STAFF_COMMON.hospitalPlaceholder}
            search={search}
            minChars={0}
            optionKey={(o) => o.id}
            optionText={(o) => o.name}
            renderOption={(o) => <span className="text-body-m text-foreground">{o.name}</span>}
            onSelect={(o) => pick(o.id)}
            describedBy={hospitalError ? `${id}-error` : undefined}
            invalid={!!hospitalError}
          />
        )}
        <FieldError name="hospitalId" />
        {afterHospital}
      </div>
      <DepartmentField hospitalId={chosen?.id ?? ""} label={departmentLabel} />
      <ChoiceField
        name="employmentType"
        label={STAFF_COMMON.employment}
        options={EMPLOYMENT_OPTIONS}
      />
      {children}
    </>
  );
}

/** A native select whose options follow the chosen hospital; disabled until there is one. */
function DepartmentField({ hospitalId, label }: { hospitalId: string; label: string }) {
  const { control } = useFormContext();
  const { field } = useController({ name: "departmentId", control });
  const a11y = useFieldA11y("departmentId", false);
  const [loaded, setLoaded] = useState<{ for: string; rows: { id: string; name: string }[] }>({
    for: "",
    rows: [],
  });

  useEffect(() => {
    if (!hospitalId) return;
    let live = true;
    void departmentsAction(hospitalId)
      .then((rows) => live && setLoaded({ for: hospitalId, rows }))
      .catch(() => live && setLoaded({ for: hospitalId, rows: [] }));
    return () => {
      live = false;
    };
  }, [hospitalId]);

  const ready = !!hospitalId && loaded.for === hospitalId;
  const rows = ready ? loaded.rows : [];
  const placeholder = !hospitalId
    ? STAFF_COMMON.departmentFirst
    : !ready
      ? STAFF.departmentLoading
      : rows.length
        ? STAFF.departmentPlaceholder
        : STAFF.departmentNone;

  return (
    <FieldShell name="departmentId" label={label}>
      <select
        {...a11y}
        name="departmentId"
        value={ready ? (field.value ?? "") : ""}
        onChange={(e) => field.onChange(e.target.value)}
        onBlur={field.onBlur}
        disabled={!ready || rows.length === 0}
        className={cn(inputClass, "pr-8")}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {rows.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
