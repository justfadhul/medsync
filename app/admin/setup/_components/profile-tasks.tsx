"use client";

import type { StepState } from "../_lib/rules";
import { useActionState, useState } from "react";

import {
  BED_CAPACITY_BANDS,
  CONNECTIVITY_CHOICES,
  DIAGNOSTIC_CHOICES,
  EMR_CHOICES,
  POWER_CHOICES,
  SERVICE_OFFERED_CHOICES,
  SPECIALISED_CLINIC_CHOICES,
  STAFF_BANDS,
  SUPPORT_SERVICE_CHOICES,
} from "@/app/signup/hospital/_lib/catalog";
import { CHECKLIST, OPD_BANDS_V2 } from "@/content/onboarding-setup";
import { formatUgPhone } from "@/lib/onboarding/fields";
import { cn } from "@/lib/utils";
import { saveContactsAction, saveOperatingAction, saveServicesAction } from "../checklist-actions";
import { CheckGroup, fieldClass, FormStatus, SaveButton, SelectField, TextField } from "./ui";

/** The application columns the Recommended and Optional tasks edit (§5.10). */
export interface ProfileData {
  servicesOffered: string[];
  specialisedClinics: string[];
  diagnosticServices: string[];
  supportServices: string[];
  hasOnsitePharmacy: boolean | null;
  internetConnectivity: string | null;
  powerBackup: string | null;
  bedCapacityBand: string | null;
  clinicalStaffBand: string | null;
  dailyOpdBand: string | null;
  existingEmr: string | null;
  existingEmrName: string | null;
  mainPhone: string;
  officialEmail: string;
  website: string | null;
  hospitalAka: string | null;
  yearEstablished: number | null;
  physicalAddress: string;
}

const S = CHECKLIST.services;
const O = CHECKLIST.operating;
const C = CHECKLIST.contacts;

export function ServicesTask({ hospitalId, p }: { hospitalId: string; p: ProfileData }) {
  const [state, action, pending] = useActionState<StepState, FormData>(saveServicesAction, {});
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="hospital_id" value={hospitalId} />
      <CheckGroup
        legend={S.offered}
        name="services_offered"
        choices={SERVICE_OFFERED_CHOICES}
        checked={p.servicesOffered}
      />
      <CheckGroup
        legend={S.clinics}
        name="specialised_clinics"
        choices={SPECIALISED_CLINIC_CHOICES}
        checked={p.specialisedClinics}
      />
      <CheckGroup
        legend={S.diagnostics}
        name="diagnostic_services"
        choices={DIAGNOSTIC_CHOICES}
        checked={p.diagnosticServices}
      />
      <CheckGroup
        legend={S.support}
        name="support_services"
        choices={SUPPORT_SERVICE_CHOICES}
        checked={p.supportServices}
      />
      <fieldset className="flex flex-col gap-1">
        <legend className="text-body-s text-foreground mb-1 font-medium">{S.pharmacy}</legend>
        <div className="flex gap-6">
          {(["yes", "no"] as const).map((v) => (
            <label
              key={v}
              className="text-body-s text-foreground/90 flex min-h-11 cursor-pointer items-center gap-2.5"
            >
              <input
                type="radio"
                name="has_onsite_pharmacy"
                value={v}
                defaultChecked={p.hasOnsitePharmacy === (v === "yes")}
                className="size-4 accent-teal-600"
              />
              {CHECKLIST[v]}
            </label>
          ))}
        </div>
      </fieldset>
      <FormStatus state={state} />
      <SaveButton pending={pending} />
    </form>
  );
}

export function OperatingTask({ hospitalId, p }: { hospitalId: string; p: ProfileData }) {
  const [state, action, pending] = useActionState<StepState, FormData>(saveOperatingAction, {});
  const [emr, setEmr] = useState(p.existingEmr ?? "");
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="hospital_id" value={hospitalId} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField
          name="internet_connectivity"
          label={O.internet}
          choices={CONNECTIVITY_CHOICES}
          value={p.internetConnectivity}
        />
        <SelectField
          name="power_backup"
          label={O.power}
          choices={POWER_CHOICES}
          value={p.powerBackup}
        />
        <SelectField
          name="bed_capacity_band"
          label={O.beds}
          choices={BED_CAPACITY_BANDS}
          value={p.bedCapacityBand}
        />
        <SelectField
          name="clinical_staff_band"
          label={O.staff}
          choices={STAFF_BANDS}
          value={p.clinicalStaffBand}
        />
        <SelectField
          name="daily_opd_band"
          label={O.opd}
          choices={OPD_BANDS_V2}
          value={p.dailyOpdBand}
        />
        <SelectField
          name="existing_emr"
          label={O.emr}
          choices={EMR_CHOICES}
          value={emr}
          onChange={setEmr}
        />
        {emr === "existing" ? (
          <TextField
            name="existing_emr_name"
            label={O.emrName}
            defaultValue={p.existingEmrName ?? ""}
            maxLength={120}
            className="ease-expo-out transition-[opacity,translate] duration-150 motion-reduce:transition-none sm:col-start-2 starting:translate-y-1 starting:opacity-0"
          />
        ) : null}
      </div>
      <FormStatus state={state} />
      <SaveButton pending={pending} />
    </form>
  );
}

export function ContactsTask({ hospitalId, p }: { hospitalId: string; p: ProfileData }) {
  const [state, action, pending] = useActionState<StepState, FormData>(saveContactsAction, {});
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="hospital_id" value={hospitalId} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          name="main_phone"
          label={C.phone}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          defaultValue={p.mainPhone ? formatUgPhone(p.mainPhone) : ""}
          maxLength={40}
        />
        <TextField
          name="official_email"
          label={C.email}
          type="email"
          autoComplete="email"
          defaultValue={p.officialEmail}
          maxLength={254}
        />
        <TextField
          name="website"
          label={C.website}
          inputMode="url"
          autoComplete="url"
          defaultValue={p.website ?? ""}
          maxLength={200}
        />
        <TextField
          name="hospital_aka"
          label={C.aka}
          defaultValue={p.hospitalAka ?? ""}
          maxLength={120}
        />
        <TextField
          name="year_established"
          label={C.year}
          inputMode="numeric"
          pattern="[0-9]{4}"
          defaultValue={p.yearEstablished ?? ""}
          maxLength={4}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="setup-physical_address" className="text-body-s text-foreground font-medium">
          {C.landmark}
        </label>
        <textarea
          id="setup-physical_address"
          name="physical_address"
          defaultValue={p.physicalAddress}
          maxLength={300}
          rows={3}
          aria-describedby="setup-physical_address-hint"
          className={cn(fieldClass, "h-auto py-2.5")}
        />
        <p id="setup-physical_address-hint" className="text-body-s text-muted-foreground">
          {C.landmarkHint}
        </p>
      </div>
      <FormStatus state={state} />
      <SaveButton pending={pending} />
    </form>
  );
}
