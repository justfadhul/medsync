"use client";

import type {
  loadDepartmentsForHospitalAction,
  loadNonClinicalCadresAction,
  loadRolesForCadreAction,
  NonClinicalSignupErrors,
  NonClinicalSignupState,
  submitNonClinicalSignupAction,
} from "./actions";
import type { ComboboxItem } from "@/components/forms";
import { useActionState, useEffect, useState, useTransition } from "react";

import { ConsentCheckbox, Field, FileUpload, PhoneInput } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Non-clinical staff signup form. Mirrors /signup/clinical's intent
 * (per-affiliation, MFA later, pending → admin approval) without the
 * council/licence section. Single-page native form — the clinical
 * form's multi-step + cascading-combobox stack is great but heavier
 * than this surface needs; the server action validates everything
 * regardless.
 *
 * Verification basis = hospital-admin approval as employer attestation
 * (see docs/reception-registration-gate-a-proposal.md). NIN is required
 * (identity); staff number / authorising officer / appointment letter
 * are optional supporting evidence.
 */

interface Props {
  hospitals: ReadonlyArray<{ id: string; name: string }>;
  consent: { version: string; bodySha256: string };
  loadCadres: typeof loadNonClinicalCadresAction;
  loadRoles: typeof loadRolesForCadreAction;
  loadDepartments: typeof loadDepartmentsForHospitalAction;
  submit: typeof submitNonClinicalSignupAction;
}

const SELECT_CLASS =
  "border-input bg-background text-foreground focus-visible:ring-ring/50 disabled:opacity-50 rounded-md border px-3 py-2 text-[13px] outline-none focus-visible:ring-[3px]";

export function NonClinicalSignupForm({
  hospitals,
  consent,
  loadCadres,
  loadRoles,
  loadDepartments,
  submit,
}: Props) {
  const [state, formAction, pending] = useActionState<NonClinicalSignupState, FormData>(submit, {});

  const errors: NonClinicalSignupErrors = state.errors ?? {};
  const values = state.values ?? {};

  const [cadres, setCadres] = useState<ReadonlyArray<ComboboxItem>>([]);
  const [roles, setRoles] = useState<ReadonlyArray<ComboboxItem>>([]);
  const [departments, setDepartments] = useState<ReadonlyArray<ComboboxItem>>([]);
  const [, startTransition] = useTransition();

  useEffect(() => {
    void loadCadres().then(setCadres);
  }, [loadCadres]);

  function onCadreChange(cadreId: string) {
    if (!cadreId) {
      setRoles([]);
      return;
    }
    startTransition(async () => {
      const list = await loadRoles(cadreId);
      setRoles(list);
    });
  }

  function onHospitalChange(hospitalId: string) {
    if (!hospitalId) {
      setDepartments([]);
      return;
    }
    startTransition(async () => {
      const list = await loadDepartments(hospitalId);
      setDepartments(list);
    });
  }

  return (
    <form action={formAction} className="flex flex-col gap-8">
      {/* ── Section: Account ──────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <h2 className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">
          Account
        </h2>

        <Field name="full_name" label="Full name" serverError={errors.full_name} required>
          <Input name="full_name" defaultValue={values.full_name} autoComplete="name" required />
        </Field>

        <Field
          name="email"
          label="Work email"
          description="Use your hospital email if you have one — it helps your admin recognise you."
          serverError={errors.email}
          required
        >
          <Input
            name="email"
            type="email"
            defaultValue={values.email}
            autoComplete="email"
            required
          />
        </Field>

        <Field name="phone_e164" label="Phone" serverError={errors.phone_e164} required>
          <PhoneInput name="phone_e164" mobileOnly invalid={!!errors.phone_e164} />
        </Field>

        <Field name="password" label="Password" serverError={errors.password} required>
          <Input
            name="password"
            type="password"
            minLength={8}
            autoComplete="new-password"
            required
          />
        </Field>
      </section>

      {/* ── Section: Identity (replaces council/licence) ──────── */}
      <section className="flex flex-col gap-4">
        <h2 className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">
          Identity
        </h2>
        <p className="text-muted-foreground -mt-2 text-[12px] leading-relaxed">
          Reception staff don&rsquo;t hold a professional council registration. The hospital admin
          who approves your account is verifying that you&rsquo;re genuinely employed. We use your{" "}
          <strong>NIN</strong> for identity; everything else is optional but strengthens trust.
        </p>

        <Field
          name="nin"
          label="National ID (NIN)"
          description="As printed on your national ID. Stored encrypted."
          serverError={errors.nin}
          required
        >
          <Input
            name="nin"
            defaultValue={values.nin}
            autoComplete="off"
            spellCheck={false}
            required
            className="font-mono uppercase"
          />
        </Field>

        <Field
          name="staff_number"
          label="Internal staff number (optional)"
          description="If your hospital has assigned you one."
        >
          <Input name="staff_number" defaultValue={values.staff_number} />
        </Field>

        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
          <Field
            name="authorising_officer_name"
            label="Authorising officer (optional)"
            description="A senior who can vouch for you."
          >
            <Input name="authorising_officer_name" defaultValue={values.authorising_officer_name} />
          </Field>
          <Field
            name="authorising_officer_role"
            label="Their role (optional)"
            description="E.g. Records HOD, Front-Desk Lead."
          >
            <Input name="authorising_officer_role" defaultValue={values.authorising_officer_role} />
          </Field>
        </div>

        <Field
          name="appointment_letter"
          label="Appointment letter (optional)"
          description="PDF or image, ≤ 5MB. Helps your admin approve faster."
        >
          <FileUpload
            name="appointment_letter"
            accept="application/pdf,image/jpeg,image/png"
            maxMb={5}
            hint="PDF, JPG or PNG · max 5MB"
          />
        </Field>
      </section>

      {/* ── Section: Where you work ───────────────────────────── */}
      <section className="flex flex-col gap-4">
        <h2 className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">
          Where you work
        </h2>

        <Field
          name="cadre_id"
          label="Role category"
          description="Reception is the only non-clinical option today."
          serverError={errors.cadre_id}
          required
        >
          <select
            id="cadre_id"
            name="cadre_id"
            required
            defaultValue={values.cadre_id ?? ""}
            onChange={(e) => onCadreChange(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="" disabled>
              {cadres.length === 0 ? "Loading…" : "Choose…"}
            </option>
            {cadres.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>

        <Field name="role_id" label="Role" serverError={errors.role_id} required>
          <select
            id="role_id"
            name="role_id"
            required
            disabled={roles.length === 0}
            defaultValue={values.role_id ?? ""}
            className={SELECT_CLASS}
          >
            <option value="" disabled>
              {roles.length === 0 ? "Pick a role category first" : "Choose…"}
            </option>
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>

        <Field name="hospital_id" label="Hospital" serverError={errors.hospital_id} required>
          <select
            id="hospital_id"
            name="hospital_id"
            required
            defaultValue={values.hospital_id ?? ""}
            onChange={(e) => onHospitalChange(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="" disabled>
              Choose your hospital
            </option>
            {hospitals.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          name="department_id"
          label="Department / unit"
          serverError={errors.department_id}
          required
        >
          <select
            id="department_id"
            name="department_id"
            required
            disabled={departments.length === 0}
            defaultValue={values.department_id ?? ""}
            className={SELECT_CLASS}
          >
            <option value="" disabled>
              {departments.length === 0 ? "Pick a hospital first" : "Choose…"}
            </option>
            {departments.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          name="employment_type"
          label="Employment"
          serverError={errors.employment_type}
          required
        >
          <select
            id="employment_type"
            name="employment_type"
            defaultValue={values.employment_type ?? "full_time"}
            className={SELECT_CLASS}
          >
            <option value="full_time">Full-time</option>
            <option value="visiting">Part-time</option>
            <option value="locum">Locum</option>
          </select>
        </Field>
      </section>

      {/* ── Section: Consent ──────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">
          Consent
        </h2>
        <ConsentCheckbox
          name="data_processing_consent"
          version={consent.version}
          bodySha256={consent.bodySha256}
          label="I agree to MedSync's data-processing terms"
          description="We process the data you've entered to verify your role and provide the workspace."
          invalid={!!errors.data_processing_consent}
          required
        />
        {errors.data_processing_consent ? (
          <p className="text-destructive text-[11.5px]">{errors.data_processing_consent}</p>
        ) : null}
      </section>

      {errors._form ? (
        <p className="text-destructive border-destructive/30 bg-destructive/5 rounded-md border px-3 py-2 text-[12.5px]">
          {errors._form}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating account…" : "Create my account"}
        </Button>
      </div>

      <p className="text-muted-foreground text-[11.5px] leading-relaxed">
        We&rsquo;ll create your account in a <span className="font-mono">pending</span> state. Your
        hospital admin reviews and approves. Once approved you&rsquo;ll sign in to the reception
        workspace.
      </p>
    </form>
  );
}
