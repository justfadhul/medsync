"use server";

import type { StepState } from "./_lib/rules";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

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
import { SETUP } from "@/content/onboarding";
import { CHECKLIST, OPD_BANDS_V2 } from "@/content/onboarding-setup";
import { db } from "@/db";
import { hospitalApplications } from "@/db/schema/hospital-applications";
import { districts } from "@/db/schema/reference-data";
import { resolvePoint } from "@/lib/geo";
import { logger } from "@/lib/logger";
import { normalizeUgPhone } from "@/lib/onboarding/fields";
import { authoriseHospitalAdmin, UUID_RE } from "./_lib/auth";
import { facilityPointVerdict, MAX_FACILITY_ACCURACY_M } from "./_lib/rules";

/**
 * Setup checklist — the Recommended and Optional tasks (§5.10). The profile tasks write the
 * hospital's own application row (approved_hospital_id = hospital); the location task writes
 * facility_locations. Both with the service client, after authoriseHospitalAdmin. Facility
 * coordinates are not personal data (Law 6): stored, but still never logged.
 */

type Codes = ReadonlyArray<{ code: string }>;
const has = (list: Codes) => {
  const set = new Set(list.map((c) => c.code));
  return (v: string) => set.has(v);
};
const many = (list: Codes) => z.array(z.string().refine(has(list))).max(list.length);
/** One band or blank (blank clears it). */
const one = (list: Codes) =>
  z
    .string()
    .refine((v) => v === "" || has(list)(v))
    .transform((v) => v || null);

async function writeApplication(
  hospitalId: string,
  patch: Record<string, unknown>,
): Promise<StepState> {
  const auth = await authoriseHospitalAdmin(hospitalId);
  if ("error" in auth) return { error: auth.error };
  const { data, error } = await auth.service
    .from("hospital_applications")
    .update(patch)
    .eq("approved_hospital_id", hospitalId)
    .select("id");
  if (error) {
    logger.error("setup.application_update.failed", { code: error.code });
    return { error: CHECKLIST.saveFailed };
  }
  if (!data?.length) return { error: CHECKLIST.noApplication };
  revalidatePath("/admin/setup");
  return { ok: true };
}

const all = (fd: FormData, k: string) =>
  fd.getAll(k).filter((v): v is string => typeof v === "string");
const text = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

/* ─── Emergency and services ─────────────────────────────────────── */

const ServicesSchema = z.object({
  hospital_id: z.string().regex(UUID_RE),
  services_offered: many(SERVICE_OFFERED_CHOICES),
  specialised_clinics: many(SPECIALISED_CLINIC_CHOICES),
  diagnostic_services: many(DIAGNOSTIC_CHOICES),
  support_services: many(SUPPORT_SERVICE_CHOICES),
  has_onsite_pharmacy: z.enum(["yes", "no", ""]),
});

export async function saveServicesAction(_prev: StepState, fd: FormData): Promise<StepState> {
  const parsed = ServicesSchema.safeParse({
    hospital_id: fd.get("hospital_id"),
    services_offered: all(fd, "services_offered"),
    specialised_clinics: all(fd, "specialised_clinics"),
    diagnostic_services: all(fd, "diagnostic_services"),
    support_services: all(fd, "support_services"),
    has_onsite_pharmacy: text(fd, "has_onsite_pharmacy"),
  });
  if (!parsed.success) return { error: CHECKLIST.saveFailed };
  const { hospital_id, has_onsite_pharmacy, ...lists } = parsed.data;
  return writeApplication(hospital_id, {
    ...lists,
    has_onsite_pharmacy: has_onsite_pharmacy === "" ? null : has_onsite_pharmacy === "yes",
  });
}

/* ─── Operating profile ──────────────────────────────────────────── */

const OperatingSchema = z.object({
  hospital_id: z.string().regex(UUID_RE),
  internet_connectivity: one(CONNECTIVITY_CHOICES),
  power_backup: one(POWER_CHOICES),
  bed_capacity_band: one(BED_CAPACITY_BANDS),
  clinical_staff_band: one(STAFF_BANDS),
  daily_opd_band: one(OPD_BANDS_V2),
  existing_emr: one(EMR_CHOICES),
  existing_emr_name: z.string().trim().max(120),
});

export async function saveOperatingAction(_prev: StepState, fd: FormData): Promise<StepState> {
  const parsed = OperatingSchema.safeParse(
    Object.fromEntries(Object.keys(OperatingSchema.shape).map((k) => [k, text(fd, k)])),
  );
  if (!parsed.success) return { error: CHECKLIST.saveFailed };
  const { hospital_id, existing_emr_name, ...bands } = parsed.data;
  return writeApplication(hospital_id, {
    ...bands,
    existing_emr_name: bands.existing_emr === "existing" ? existing_emr_name || null : null,
  });
}

/* ─── Contact details, website, landmark (optional) ──────────────── */

export async function saveContactsAction(_prev: StepState, fd: FormData): Promise<StepState> {
  const hospitalId = text(fd, "hospital_id");
  const t = (k: string, max: number) => text(fd, k).trim().slice(0, max);
  const C = CHECKLIST.contacts;

  const rawPhone = t("main_phone", 40);
  const phone = rawPhone ? normalizeUgPhone(rawPhone) : "";
  if (phone === null) return { error: C.phoneInvalid };

  const email = t("official_email", 254).toLowerCase();
  if (email && !z.email().safeParse(email).success) return { error: C.emailInvalid };

  let website = t("website", 200);
  if (website) {
    if (!/^https?:\/\//i.test(website)) website = `https://${website}`;
    const host = URL.canParse(website) ? new URL(website).hostname : "";
    if (!host.includes(".")) return { error: C.websiteInvalid };
  }

  const yearText = t("year_established", 4);
  const maxYear = new Date().getFullYear();
  const year = yearText ? Number(yearText) : null;
  if (year !== null && !(Number.isInteger(year) && year >= 1900 && year <= maxYear)) {
    return { error: C.yearInvalid(maxYear) };
  }

  // physical_address is NOT NULL (derived from the place at application): blank keeps it.
  const landmark = t("physical_address", 300);
  return writeApplication(hospitalId, {
    main_phone: phone,
    official_email: email,
    website: website || null,
    hospital_aka: t("hospital_aka", 120) || null,
    year_established: year,
    ...(landmark ? { physical_address: landmark } : {}),
  });
}

/* ─── Facility location ──────────────────────────────────────────── */

const LocationSchema = z.object({
  hospitalId: z.string().regex(UUID_RE),
  lat: z.number(),
  lng: z.number(),
  accuracyM: z.number().min(0),
});

export async function setFacilityLocationAction(input: {
  hospitalId: string;
  lat: number;
  lng: number;
  accuracyM: number;
}): Promise<StepState & { accuracyM?: number }> {
  const parsed = LocationSchema.safeParse(input);
  if (!parsed.success) return { error: SETUP.locationOutside };
  const { hospitalId, lat, lng, accuracyM } = parsed.data;
  const auth = await authoriseHospitalAdmin(hospitalId);
  if ("error" in auth) return { error: auth.error };
  // Cheap check first: an imprecise point never needs the shapes file.
  if (accuracyM > MAX_FACILITY_ACCURACY_M) return { error: SETUP.locationImprecise };

  const [app] = await db
    .select({ pcode: districts.pcode })
    .from(hospitalApplications)
    .innerJoin(districts, eq(districts.id, hospitalApplications.districtId))
    .where(eq(hospitalApplications.approvedHospitalId, hospitalId))
    .limit(1);
  const resolved = await resolvePoint(lat, lng, accuracyM);
  const verdict = facilityPointVerdict(
    accuracyM,
    resolved.ok ? resolved.place.district.code : null,
    app?.pcode ?? null,
  );
  if (verdict === "imprecise") return { error: SETUP.locationImprecise };
  if (verdict === "outside") return { error: SETUP.locationOutside };

  const now = new Date().toISOString();
  const rounded = Math.round(accuracyM);
  const { error } = await auth.service.from("facility_locations").upsert(
    {
      hospital_id: hospitalId,
      lat,
      lng,
      accuracy_m: rounded,
      source: "device",
      captured_by: auth.userId,
      captured_at: now,
      confirmed_by: auth.userId,
      confirmed_at: now,
    },
    { onConflict: "hospital_id" },
  );
  if (error) {
    logger.error("setup.facility_location.failed", { code: error.code });
    return { error: CHECKLIST.saveFailed };
  }
  revalidatePath("/admin/setup");
  return { ok: true, accuracyM: rounded };
}
