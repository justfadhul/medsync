"use client";

import type {
  ClinicalSignupErrors,
  ClinicalSignupState,
  loadCadreGradesForCadreAction,
  loadCadresForCouncilAction,
  loadDepartmentsForHospitalAction,
  loadRolesForCadreAction,
  submitClinicalSignupAction,
} from "./actions";
import type { ComboboxItem, MultiStepStep } from "@/components/forms";
import { useActionState, useEffect, useState } from "react";

import {
  CascadingCombobox,
  Combobox,
  ConsentCheckbox,
  Field,
  FileUpload,
  MultiStepForm,
  PhoneInput,
  SegmentedControl,
} from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * GATE D — clinical staff signup form (Client Component).
 *
 * Four steps:
 *   1. Identity (full name / email / phone)
 *   2. Professional (council → cadre + cadre_grade + role + reg
 *      number + licence upload)
 *   3. Affiliation (hospital → department + employment_type)
 *   4. Account + consent
 *
 * Cadre/Role/Grade fall out of the council pick. Department falls out
 * of the hospital pick. CascadingCombobox handles the parent-clears-
 * child invariant; the standalone Comboboxes for grade + role read the
 * current cadre value from React state so we can re-load them
 * whenever the user changes their cadre upstream.
 */
export interface ClinicalSignupFormProps {
  councils: ReadonlyArray<ComboboxItem>;
  hospitals: ReadonlyArray<ComboboxItem>;
  consent: {
    version: string;
    bodySha256: string;
    body: string;
    effectiveDate: string;
  };
  loadCadres: typeof loadCadresForCouncilAction;
  loadCadreGrades: typeof loadCadreGradesForCadreAction;
  loadRoles: typeof loadRolesForCadreAction;
  loadDepartments: typeof loadDepartmentsForHospitalAction;
  submit: typeof submitClinicalSignupAction;
}

const EMPLOYMENT_TYPE_OPTIONS = [
  { value: "full_time", label: "Full-time" },
  { value: "visiting", label: "Visiting" },
  { value: "locum", label: "Locum" },
];

export function ClinicalSignupForm({
  councils,
  hospitals,
  consent,
  loadCadres,
  loadCadreGrades,
  loadRoles,
  loadDepartments,
  submit,
}: ClinicalSignupFormProps) {
  const [state, formAction, isPending] = useActionState<ClinicalSignupState, FormData>(submit, {});

  const [cadreId, setCadreId] = useState<string | null>(null);
  const [loadedCadreGrades, setLoadedCadreGrades] = useState<ComboboxItem[]>([]);
  const [loadedRoles, setLoadedRoles] = useState<ComboboxItem[]>([]);

  useEffect(() => {
    if (!cadreId) return;
    let cancelled = false;
    Promise.all([loadCadreGrades(cadreId), loadRoles(cadreId)]).then(([grades, r]) => {
      if (cancelled) return;
      setLoadedCadreGrades(grades);
      setLoadedRoles(r);
    });
    return () => {
      cancelled = true;
    };
  }, [cadreId, loadCadreGrades, loadRoles]);

  // Derive empty when cadre is cleared instead of setState in the effect
  // (lint rejects synchronous setState in useEffect).
  const cadreGrades = cadreId ? loadedCadreGrades : [];
  const roles = cadreId ? loadedRoles : [];

  const errors: ClinicalSignupErrors = state.errors ?? {};
  const v = state.values ?? {};

  const steps: MultiStepStep[] = [
    {
      key: "identity",
      label: "About you",
      heading: "Tell us who you are",
      intro: "We'll use these details to contact you about your verification.",
      render: () => (
        <>
          <Field name="full_name" label="Full name" required serverError={errors.full_name}>
            <Input
              name="full_name"
              autoComplete="name"
              defaultValue={v.full_name ?? ""}
              aria-invalid={!!errors.full_name || undefined}
            />
          </Field>
          <Field name="email" label="Email" required serverError={errors.email}>
            <Input
              type="email"
              name="email"
              autoComplete="email"
              defaultValue={v.email ?? ""}
              aria-invalid={!!errors.email || undefined}
            />
          </Field>
          <Field name="phone_e164" label="Mobile phone" required serverError={errors.phone_e164}>
            <PhoneInput
              name="phone_e164"
              defaultValue={v.phone_e164}
              invalid={!!errors.phone_e164}
              mobileOnly
            />
          </Field>
        </>
      ),
    },
    {
      key: "professional",
      label: "Professional",
      heading: "Your council registration",
      intro:
        "We verify your registration number against the relevant council before granting clinical access. Your licence document is stored privately and only shared with your hospital admin and our verification team.",
      render: () => (
        <>
          <CascadingCombobox
            parentName="council_id"
            parentLabel="Regulatory council"
            parentItems={councils}
            parentPlaceholder="Search councils…"
            parentDefaultValue={v.council_id}
            parentInvalid={!!errors.council_id}
            childName="cadre_id"
            childLabel="Cadre"
            childPlaceholder="Search cadres…"
            childDefaultValue={v.cadre_id}
            childInvalid={!!errors.cadre_id}
            loadChildren={loadCadres}
            onParentChange={() => setCadreId(null)}
          />

          {/*
           * Cadre-dependent comboboxes. Because they depend on a child
           * value of the CascadingCombobox above (not its parent), we
           * track cadre selection in React state with a hidden Combobox
           * subscriber. Simpler than threading another cascade level.
           */}
          <CadreSubscriber onCadreChange={setCadreId} defaultValue={v.cadre_id ?? null} />

          <Field name="cadre_grade_id" label="Cadre grade (optional)">
            <Combobox
              name="cadre_grade_id"
              items={cadreGrades}
              placeholder={
                !cadreId
                  ? "Pick a cadre first"
                  : cadreGrades.length === 0
                    ? "Loading…"
                    : "Search grades…"
              }
              defaultValue={v.cadre_grade_id}
              disabled={!cadreId}
            />
          </Field>

          <Field name="role_id" label="Role" required serverError={errors.role_id}>
            <Combobox
              name="role_id"
              items={roles}
              placeholder={
                !cadreId ? "Pick a cadre first" : roles.length === 0 ? "Loading…" : "Search roles…"
              }
              defaultValue={v.role_id}
              disabled={!cadreId}
              invalid={!!errors.role_id}
            />
          </Field>

          <Field
            name="registration_number"
            label="Registration number"
            description="As printed on your practising certificate."
            required
            serverError={errors.registration_number}
          >
            <Input
              name="registration_number"
              autoComplete="off"
              defaultValue={v.registration_number ?? ""}
              aria-invalid={!!errors.registration_number || undefined}
            />
          </Field>

          <Field
            name="registration_expiry"
            label="Practising certificate expiry (optional)"
            description="If your practising certificate has an expiry, we'll prompt you to re-upload before it lapses."
            serverError={errors.registration_expiry}
          >
            <Input
              name="registration_expiry"
              type="date"
              defaultValue={v.registration_expiry ?? ""}
            />
          </Field>

          <Field
            name="licence_document"
            label="Practising licence (PDF or photo)"
            description="≤ 5 MB. Stored privately. Re-validated server-side."
          >
            <FileUpload
              name="licence_document"
              accept="application/pdf,image/jpeg,image/png"
              maxMb={5}
              capture="environment"
              hint="PDF, JPG or PNG · max 5MB"
            />
          </Field>
        </>
      ),
    },
    {
      key: "affiliation",
      label: "Affiliation",
      heading: "Where you'll work",
      intro:
        "Your hospital admin will get an approval request as soon as you submit. You won't have clinical access until they approve.",
      render: () => (
        <>
          <CascadingCombobox
            parentName="hospital_id"
            parentLabel="Hospital"
            parentItems={hospitals}
            parentPlaceholder="Search hospitals…"
            parentDefaultValue={v.hospital_id}
            parentInvalid={!!errors.hospital_id}
            childName="department_id"
            childLabel="Department"
            childPlaceholder="Search departments…"
            childDefaultValue={v.department_id}
            childInvalid={!!errors.department_id}
            loadChildren={loadDepartments}
          />

          <Field
            name="employment_type"
            label="Employment type"
            required
            serverError={errors.employment_type}
          >
            <SegmentedControl
              name="employment_type"
              ariaLabel="Employment type"
              defaultValue={typeof v.employment_type === "string" ? v.employment_type : "full_time"}
              options={EMPLOYMENT_TYPE_OPTIONS}
              invalid={!!errors.employment_type}
            />
          </Field>
        </>
      ),
    },
    {
      key: "account",
      label: "Account",
      heading: "Set up your account",
      intro: "MFA enrollment is required before you can access clinical surfaces.",
      render: () => (
        <>
          <Field
            name="password"
            label="Password"
            description="At least 12 characters."
            required
            serverError={errors.password}
          >
            <Input
              type="password"
              name="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={72}
              aria-invalid={!!errors.password || undefined}
            />
          </Field>

          <details className="border-border bg-card rounded-md border p-4 text-[12.5px]">
            <summary className="text-foreground cursor-pointer font-medium">
              Read the consent text (v{consent.version}, effective {consent.effectiveDate})
            </summary>
            <p className="text-muted-foreground mt-3 leading-snug whitespace-pre-line">
              {consent.body}
            </p>
          </details>

          <ConsentCheckbox
            name="data_processing_consent"
            required
            invalid={!!errors.data_processing_consent}
            version={consent.version}
            bodySha256={consent.bodySha256}
            label="I agree to MedSync's data-processing notice"
            description={`v${consent.version} · effective ${consent.effectiveDate}.`}
          />

          {errors._form ? (
            <p
              role="alert"
              className="text-destructive border-destructive bg-alert-bg rounded-sm border px-3 py-2 text-[12.5px]"
            >
              {errors._form}
            </p>
          ) : null}

          <Button type="submit" variant="primary" size="lg" disabled={isPending}>
            {isPending ? "Submitting for review…" : "Submit for review"}
          </Button>
        </>
      ),
    },
  ];

  return (
    <form
      action={formAction}
      className={cn("mx-auto flex w-full max-w-3xl flex-col gap-7 px-5 py-12 sm:px-8 sm:py-16")}
      noValidate
      encType="multipart/form-data"
    >
      <MultiStepForm flowLabel="Clinical staff signup" steps={steps} />
    </form>
  );
}

/**
 * Watches the `cadre_id` form input (rendered by the CascadingCombobox
 * above) and propagates its current value to the parent component via
 * a callback, so the cadre-dependent Comboboxes can re-load. Uses a
 * MutationObserver on the hidden input that base-ui Combobox creates
 * (its `value` attribute reflects the selected item's stringified
 * value).
 */
function CadreSubscriber({
  onCadreChange,
  defaultValue,
}: {
  onCadreChange: (id: string | null) => void;
  defaultValue: string | null;
}) {
  useEffect(() => {
    if (defaultValue) onCadreChange(defaultValue);
    const node = document.querySelector<HTMLInputElement>('input[name="cadre_id"]');
    if (!node) return;
    const observer = new MutationObserver(() => {
      onCadreChange(node.value || null);
    });
    observer.observe(node, { attributes: true, attributeFilter: ["value"] });
    // Initial sync in case the node carried a value at mount.
    onCadreChange(node.value || null);
    return () => observer.disconnect();
  }, [onCadreChange, defaultValue]);
  return null;
}
