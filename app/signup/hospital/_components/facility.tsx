"use client";

import type { RegistryOption } from "@/lib/onboarding/types";
import { useState } from "react";
import { useFormContext } from "react-hook-form";

import { searchRegistryAction } from "@/app/signup/_actions/lookup";
import {
  ChoiceField,
  fieldId,
  FieldShell,
  inputClass,
  revealClass,
  SelectField,
  TextField,
  useFieldA11y,
  useFieldError,
  useFieldValue,
} from "@/components/onboarding/fields";
import { LocationField } from "@/components/onboarding/location-field";
import { ChosenCard, SearchField } from "@/components/onboarding/search-field";
import { HOSPITAL } from "@/content/onboarding";
import {
  FACILITY_LEVEL_LABELS,
  HOSPITAL_FORM,
  OWNERSHIP_LABELS,
} from "@/content/onboarding-hospital";
import { cn } from "@/lib/utils";

/*
 * [01] Your facility (§5.3, REG-3/5): find it on the MoH registry — the server copies its facts —
 * or enter it by hand. The pick itself rides in the form as `registryPick` (display only; the
 * schema strips it) so a restored draft can show its card again.
 */

const LEVELS = Object.entries(FACILITY_LEVEL_LABELS).map(([value, label]) => ({ value, label }));
const OWNERS = Object.entries(OWNERSHIP_LABELS).map(([value, label]) => ({ value, label }));
const link =
  "text-body-s self-start font-medium text-teal-700 underline underline-offset-4 dark:text-teal-400";

export function FacilityFields({ bureaus }: { bureaus: readonly string[] }) {
  const { setValue } = useFormContext();
  const source = useFieldValue<"registry" | "manual" | undefined>("facilitySource");
  const pick = useFieldValue<RegistryOption | undefined>("registryPick");
  const ownership = useFieldValue<string | undefined>("ownership");
  const note = useFieldValue<string | undefined>("correctionNote");
  const [noteOpen, setNoteOpen] = useState(false);
  const error = useFieldError("registryCode");
  const id = fieldId("registryCode");

  const choose = (o: RegistryOption) => {
    setValue("registryPick", o);
    setValue("ownership", o.ownership, { shouldDirty: true });
    setValue("registryCode", o.code, { shouldDirty: true, shouldValidate: true });
  };
  const clear = () => {
    setValue("registryPick", undefined);
    setValue("ownership", undefined);
    setValue("correctionNote", undefined);
    setValue("registryCode", undefined, { shouldDirty: true });
    setNoteOpen(false);
  };
  const toManual = () => {
    setValue("facilitySource", "manual", { shouldDirty: true });
    setValue("ownership", undefined);
  };
  const toRegistry = () => {
    setValue("facilitySource", "registry", { shouldDirty: true });
    setValue("ownership", pick?.ownership);
  };

  if (source === "manual")
    return (
      <div className={cn("flex flex-col gap-5", revealClass)}>
        <TextField
          name="facilityName"
          label={HOSPITAL.facilityName}
          autoCapitalize="words"
          maxLength={160}
        />
        <SelectField name="facilityLevel" label={HOSPITAL.facilityLevel} options={LEVELS} />
        <ChoiceField name="ownership" label={HOSPITAL.ownership} options={OWNERS} />
        {ownership === "pnfp" ? (
          <div className={revealClass}>
            <SelectField
              name="bureau"
              label={HOSPITAL.bureau}
              options={[...bureaus, HOSPITAL_FORM.bureauOther].map((b) => ({
                value: b,
                label: b,
              }))}
            />
          </div>
        ) : null}
        <LocationField name="place" label={HOSPITAL.where} />
        <button type="button" className={link} onClick={toRegistry}>
          {HOSPITAL.useRegistry}
        </button>
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      {pick ? (
        <ChosenCard
          onChange={clear}
          changeLabel={HOSPITAL.notThisOne}
          extra={
            noteOpen || note ? (
              <CorrectionNote />
            ) : (
              <button type="button" className={link} onClick={() => setNoteOpen(true)}>
                {HOSPITAL.somethingWrong}
              </button>
            )
          }
        >
          <p className="text-body-m text-foreground font-medium">{pick.name}</p>
          <p className="text-body-s text-muted-foreground">
            {pick.levelLabel} · {OWNERSHIP_LABELS[pick.ownership]}
          </p>
          <p className="text-body-s text-muted-foreground">
            {pick.where} · <span className="font-mono">{HOSPITAL.registryCode(pick.code)}</span>
          </p>
        </ChosenCard>
      ) : (
        <FieldShell name="registryCode" label={HOSPITAL.findLabel}>
          <SearchField<RegistryOption>
            id={id}
            placeholder={HOSPITAL.findPlaceholder}
            search={searchRegistryAction}
            minChars={2}
            optionKey={(o) => o.code}
            optionText={(o) => `${o.name}, ${o.levelLabel}, ${o.where}`}
            renderOption={(o) => (
              <span className="flex flex-col">
                <span className="text-body-m text-foreground">{o.name}</span>
                <span className="text-body-s text-muted-foreground">
                  {o.levelLabel} · {OWNERSHIP_LABELS[o.ownership]} · {o.where}
                </span>
              </span>
            )}
            onSelect={choose}
            invalid={!!error}
            describedBy={error ? `${id}-error` : undefined}
          />
        </FieldShell>
      )}
      {pick ? null : (
        <button type="button" className={link} onClick={toManual}>
          {HOSPITAL.enterYourself}
        </button>
      )}
    </div>
  );
}

function CorrectionNote() {
  const { register } = useFormContext();
  const a11y = useFieldA11y("correctionNote", true);
  return (
    <div className={revealClass}>
      <FieldShell
        name="correctionNote"
        label={HOSPITAL.correctionLabel}
        hint={HOSPITAL_FORM.correctionHint}
      >
        <textarea
          {...register("correctionNote")}
          {...a11y}
          rows={3}
          maxLength={300}
          className={cn(inputClass, "h-auto py-2.5")}
        />
      </FieldShell>
    </div>
  );
}
