"use client";

import type {
  ClinicalSignupErrors,
  ClinicalSignupState,
  loadCadreGradesForCadreAction,
  loadCadresForCouncilAction,
  loadDepartmentsForHospitalAction,
  loadRolesForCadreAction,
  submitClinicalSignupAction,
} from "../actions";
import type { ComboboxItem, MultiStepStep } from "@/components/forms";
import { useActionState, useEffect, useState } from "react";
import { TriangleAlertIcon } from "lucide-react";

import {
  AvatarUpload,
  CascadingCombobox,
  Combobox,
  ConsentCheckbox,
  Field,
  FileUpload,
  MultiStepForm,
  PasswordInput,
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
  // state.values intentionally unused — user input persists across
  // action error re-renders via native DOM / base-ui internal state.

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
              aria-invalid={!!errors.full_name || undefined}
            />
          </Field>
          <Field name="email" label="Email" required serverError={errors.email}>
            <Input
              type="email"
              name="email"
              autoComplete="email"
              aria-invalid={!!errors.email || undefined}
            />
          </Field>
          <Field name="phone_e164" label="Mobile phone" required serverError={errors.phone_e164}>
            <PhoneInput name="phone_e164" invalid={!!errors.phone_e164} mobileOnly />
          </Field>
          <Field
            name="photo"
            label="Photo (optional)"
            description="Shown to patients who can book you and to colleagues."
          >
            <AvatarUpload name="photo" />
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
            parentInvalid={!!errors.council_id}
            childName="cadre_id"
            childLabel="Cadre"
            childPlaceholder="Search cadres…"
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
          {/* CadreSubscriber observes the hidden cadre_id input via
              MutationObserver — it bootstraps from whatever value is
              already in the DOM, so no defaultValue prop needed. */}
          <CadreSubscriber onCadreChange={setCadreId} />

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
              aria-invalid={!!errors.registration_number || undefined}
            />
          </Field>

          <Field
            name="registration_expiry"
            label="Practising certificate expiry (optional)"
            description="If your practising certificate has an expiry, we'll prompt you to re-upload before it lapses."
            serverError={errors.registration_expiry}
          >
            <Input name="registration_expiry" type="date" />
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
            parentInvalid={!!errors.hospital_id}
            childName="department_id"
            childLabel="Department"
            childPlaceholder="Search departments…"
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
              defaultValue={"full_time"}
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
            <PasswordInput
              name="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={72}
              aria-invalid={!!errors.password || undefined}
            />
          </Field>

          <details className="border-border bg-card rounded-md border p-4 text-[12.5px]">
            <summary className="text-foreground hover:text-brand-700 dark:hover:text-brand-300 cursor-pointer font-medium transition-colors duration-150">
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
              className="scale-in flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] leading-snug text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-200"
            >
              <TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" strokeWidth={2} />
              <span>{errors._form}</span>
            </p>
          ) : null}

          <Button type="submit" variant="primary" size="lg" disabled={isPending} className="tap">
            {isPending ? (
              <>
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-full border-2 border-current/30 border-t-current motion-safe:animate-spin"
                />
                Submitting for review…
              </>
            ) : (
              "Submit for review"
            )}
          </Button>
        </>
      ),
    },
  ];

  return (
    <form
      action={formAction}
      className={cn(
        "reveal-up mx-auto flex w-full max-w-3xl flex-col gap-7 px-5 py-12 sm:px-8 sm:py-16",
      )}
      noValidate
    >
      {/* No manual encType — React Server Actions auto-set multipart
       * encoding when a file input is present. Setting it explicitly
       * conflicted with React's wire format and produced empty FormData. */}
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
function CadreSubscriber({ onCadreChange }: { onCadreChange: (id: string | null) => void }) {
  useEffect(() => {
    const node = document.querySelector<HTMLInputElement>('input[name="cadre_id"]');
    if (!node) return;
    const observer = new MutationObserver(() => {
      onCadreChange(node.value || null);
    });
    observer.observe(node, { attributes: true, attributeFilter: ["value"] });
    // Initial sync in case the node carried a value at mount (e.g. the
    // base-ui Combobox already had a selection from a prior submission).
    onCadreChange(node.value || null);
    return () => observer.disconnect();
  }, [onCadreChange]);
  return null;
}
