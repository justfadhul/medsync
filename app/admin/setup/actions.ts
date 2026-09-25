"use server";

import { randomBytes } from "node:crypto";
import type { Desired, StepState } from "./_lib/rules";
import type { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ALL_DEPARTMENT_CODES } from "@/app/signup/hospital/_lib/catalog";
import { CHECKLIST } from "@/content/onboarding-setup";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { authoriseHospitalAdmin, UUID_RE } from "./_lib/auth";
import {
  departmentLabel,
  departmentSlug,
  IM_CODE,
  imParentId,
  planDepartments,
  slugify,
} from "./_lib/rules";

/**
 * Setup-checklist server actions (kickoff §F, GATE D; §5.10).
 *
 * Every action runs `authoriseHospitalAdmin` first: signed in, hospital_admin of the target
 * hospital (a superadmin session is refused, ADR 0018 Q3), hospital in `provisioning`.
 *
 * Submissions only — the page renders read state directly from Drizzle. There is no autosave:
 * each task's Save writes its rows and the next render reflects the change. The profile tasks
 * (services, operating, contacts, location) live in ./checklist-actions.ts.
 */

/** The seeded Internal Medicine specialty (0009); its children are the IM sub-specialties. */
const IM_SPECIALTY_ID = "00000000-0000-0000-0000-000000000f00";

/* ─── Departments and where you'll start ─────────────────────────── */

const ConfirmDepartmentsSchema = z.object({
  hospital_id: z.string().regex(UUID_RE),
  /** Catalogue family codes the admin runs today. */
  departments: z
    .array(z.string().refine((c) => ALL_DEPARTMENT_CODES.includes(c)))
    .min(1, CHECKLIST.departments.required),
  /** IM sub-specialty ids (children of the IM specialty; names are read server-side). */
  subspecialties: z.array(z.string().regex(UUID_RE)).max(30),
  /** Typed "Other" departments, stored as real hospital_departments rows. */
  others: z.array(z.string().trim().min(1).max(120)).max(5),
  start: z.string().optional(),
});

export async function confirmDepartmentsAction(
  _prev: StepState,
  formData: FormData,
): Promise<StepState> {
  const strings = (k: string) =>
    formData.getAll(k).filter((v): v is string => typeof v === "string");
  const parsed = ConfirmDepartmentsSchema.safeParse({
    hospital_id: formData.get("hospital_id"),
    departments: strings("departments"),
    subspecialties: strings("subspecialties"),
    others: strings("others").filter((v) => v.trim() !== ""),
    start: formData.get("start") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? CHECKLIST.saveFailed };
  }
  const input = parsed.data;
  const auth = await authoriseHospitalAdmin(input.hospital_id);
  if ("error" in auth) return { error: auth.error };
  const { service } = auth;
  const hospitalId = input.hospital_id;

  const { data: app } = await service
    .from("hospital_applications")
    .select("id")
    .eq("approved_hospital_id", hospitalId)
    .maybeSingle();
  // The start department lives on the application junction; no application, nothing to store.
  if (app && (!input.start || !input.departments.includes(input.start))) {
    return { error: CHECKLIST.departments.startRequired };
  }

  const top = dedupe([
    ...input.departments.map((code) => ({
      slug: departmentSlug(code),
      name: departmentLabel(code),
    })),
    ...input.others.map((name) => ({ slug: slugify(name), name })),
  ]);
  let subs: Desired[] = [];
  if (input.departments.includes(IM_CODE) && input.subspecialties.length > 0) {
    const { data } = await service
      .from("specialties")
      .select("name")
      .eq("parent_id", IM_SPECIALTY_ID)
      .in("id", input.subspecialties);
    subs = dedupe(
      (data ?? []).map((s: { name: string }) => ({ slug: slugify(s.name), name: s.name })),
    );
  }

  const { data: existing, error: readError } = await service
    .from("hospital_departments")
    .select("id,parent_id,slug")
    .eq("hospital_id", hospitalId);
  if (readError) return { error: CHECKLIST.saveFailed };
  const rows = (existing ?? []).map(
    (r: { id: string; parent_id: string | null; slug: string }) => ({
      id: r.id,
      parentId: r.parent_id,
      slug: r.slug,
    }),
  );
  const plan = planDepartments(rows, top, subs);

  // Deletes first and all at once: a department already in use (FK restrict) fails the whole
  // statement, so nothing half-changes.
  if (plan.deleteIds.length > 0) {
    const { error } = await service
      .from("hospital_departments")
      .delete()
      .eq("hospital_id", hospitalId)
      .in("id", plan.deleteIds);
    if (error) {
      logger.warn("setup.departments.delete_failed", { code: error.code });
      return { error: error.code === "23503" ? CHECKLIST.departments.inUse : CHECKLIST.saveFailed };
    }
  }
  const kept = rows.filter((r) => !plan.deleteIds.includes(r.id));
  if (plan.insertTop.length > 0) {
    const { data, error } = await service
      .from("hospital_departments")
      .insert(plan.insertTop.map((d) => ({ hospital_id: hospitalId, parent_id: null, ...d })))
      .select("id,slug");
    if (error) {
      logger.error("setup.departments.insert_failed", { reason: error.message });
      return { error: CHECKLIST.saveFailed };
    }
    for (const r of data ?? []) kept.push({ id: r.id, parentId: null, slug: r.slug });
  }
  const parentId = imParentId(kept);
  if (plan.insertSubs.length > 0 && parentId) {
    const { error } = await service
      .from("hospital_departments")
      .insert(plan.insertSubs.map((d) => ({ hospital_id: hospitalId, parent_id: parentId, ...d })));
    if (error) {
      logger.error("setup.departments.subs_failed", { reason: error.message });
      return { error: CHECKLIST.saveFailed };
    }
  }

  if (app && input.start) {
    const error = await setStartDepartment(service, app.id as string, input.start);
    if (error) return { error: CHECKLIST.saveFailed };
  }
  revalidatePath("/admin/setup");
  return { ok: true };
}

function dedupe(list: Desired[]): Desired[] {
  const seen = new Set<string>();
  return list.filter((d) => d.slug !== "" && !seen.has(d.slug) && seen.add(d.slug));
}

/** One is_primary row per application (partial unique index): clear, then set or add. */
async function setStartDepartment(
  service: ReturnType<typeof createServiceClient>,
  applicationId: string,
  family: string,
): Promise<string | null> {
  const table = () => service.from("hospital_application_departments");
  const cleared = await table()
    .update({ is_primary: false })
    .eq("application_id", applicationId)
    .eq("is_primary", true)
    .neq("department_family", family);
  if (cleared.error) return cleared.error.message;
  const set = await table()
    .update({ is_primary: true })
    .eq("application_id", applicationId)
    .eq("department_family", family)
    .select("department_family");
  if (set.error) return set.error.message;
  if ((set.data ?? []).length > 0) return null;
  const added = await table().insert({
    application_id: applicationId,
    department_family: family,
    is_primary: true,
  });
  return added.error?.message ?? null;
}

/* ─── Step 2 — Wards & capacity ──────────────────────────────────── */

const AddWardSchema = z.object({
  hospital_id: z.string().regex(UUID_RE),
  name: z.string().min(1, "Name required.").max(120),
  bed_count: z.coerce.number().int().min(0).max(2000),
});

export async function addWardAction(_prev: StepState, formData: FormData): Promise<StepState> {
  const parsed = AddWardSchema.safeParse({
    hospital_id: formData.get("hospital_id"),
    name: formData.get("name"),
    bed_count: formData.get("bed_count"),
  });
  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return { error: fe.name?.[0] ?? fe.bed_count?.[0] ?? "Invalid input." };
  }
  const auth = await authoriseHospitalAdmin(parsed.data.hospital_id);
  if ("error" in auth) return { error: auth.error };

  const slug = parsed.data.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  const { error } = await auth.service.from("hospital_wards").insert({
    hospital_id: parsed.data.hospital_id,
    name: parsed.data.name,
    slug: `${slug}-${Date.now().toString(36).slice(-4)}`,
    bed_count: parsed.data.bed_count,
  });
  if (error) {
    logger.error("setup.add_ward.failed", { reason: error.message });
    return { error: "Could not save the ward." };
  }
  revalidatePath("/admin/setup");
  return { ok: true };
}

const RemoveWardSchema = z.object({
  hospital_id: z.string().regex(UUID_RE),
  ward_id: z.string().regex(UUID_RE),
});

export async function removeWardAction(_prev: StepState, formData: FormData): Promise<StepState> {
  const parsed = RemoveWardSchema.safeParse({
    hospital_id: formData.get("hospital_id"),
    ward_id: formData.get("ward_id"),
  });
  if (!parsed.success) return { error: "Invalid input." };
  const auth = await authoriseHospitalAdmin(parsed.data.hospital_id);
  if ("error" in auth) return { error: auth.error };

  const { error } = await auth.service
    .from("hospital_wards")
    .delete()
    .eq("id", parsed.data.ward_id)
    .eq("hospital_id", parsed.data.hospital_id);
  if (error) return { error: "Could not remove the ward." };
  revalidatePath("/admin/setup");
  return { ok: true };
}

/* ─── Step 3 — Backup admin designation ──────────────────────────── */

const AddBackupAdminSchema = z.object({
  hospital_id: z.string().regex(UUID_RE),
  email: z.string().email("Valid email required."),
});

export async function inviteBackupAdminAction(
  _prev: StepState,
  formData: FormData,
): Promise<StepState> {
  const parsed = AddBackupAdminSchema.safeParse({
    hospital_id: formData.get("hospital_id"),
    email: formData.get("email"),
  });
  if (!parsed.success)
    return { error: parsed.error.flatten().fieldErrors.email?.[0] ?? "Invalid email." };
  const auth = await authoriseHospitalAdmin(parsed.data.hospital_id);
  if ("error" in auth) return { error: auth.error };

  // The plaintext token is shown once, here, for the admin to pass on themselves; only its hash
  // is stored. Claiming it (accept-hospital-admin-invitation: same email + MFA) makes them the
  // backup, because the hospital already has a primary.
  const token = randomBytes(32).toString("base64url");
  const { error } = await auth.service.from("hospital_staff_invitations").insert({
    hospital_id: parsed.data.hospital_id,
    invited_email: parsed.data.email.toLowerCase(),
    invitation_token_hash: await sha256Hex(token),
    invited_by: auth.userId,
    source: "individual",
  });
  if (error) {
    logger.error("setup.invite_backup.failed", { reason: error.message });
    return { error: "Could not create the invitation." };
  }
  revalidatePath("/admin/setup");
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "https://medsync-six.vercel.app";
  return { ok: true, link: `${origin}/admin/claim-invitation?token=${encodeURIComponent(token)}` };
}

/* ─── Step 4 — Staff invitation (individual; bulk stubbed) ───────── */

const InviteStaffSchema = z.object({
  hospital_id: z.string().regex(UUID_RE),
  email: z.string().email(),
  role_id: z.string().regex(UUID_RE).optional(),
});

export async function inviteStaffAction(_prev: StepState, formData: FormData): Promise<StepState> {
  const parsed = InviteStaffSchema.safeParse({
    hospital_id: formData.get("hospital_id"),
    email: formData.get("email"),
    role_id: formData.get("role_id") || undefined,
  });
  if (!parsed.success) return { error: "Valid email required." };
  const auth = await authoriseHospitalAdmin(parsed.data.hospital_id);
  if ("error" in auth) return { error: auth.error };

  const tokenHash = await sha256Hex(crypto.randomUUID() + parsed.data.email);
  const { error } = await auth.service.from("hospital_staff_invitations").insert({
    hospital_id: parsed.data.hospital_id,
    invited_email: parsed.data.email.toLowerCase(),
    invited_role_id: parsed.data.role_id ?? null,
    invitation_token_hash: tokenHash,
    invited_by: auth.userId,
    source: "individual",
  });
  if (error) {
    return { error: "Could not create the invitation." };
  }
  revalidatePath("/admin/setup");
  return { ok: true };
}

/* ─── Step 6 — Go live (calls sa-activate-hospital Edge Function) ──── */

const FinaliseSchema = z.object({
  hospital_id: z.string().regex(UUID_RE),
});

export async function finaliseSetupAction(
  _prev: StepState,
  formData: FormData,
): Promise<StepState> {
  const parsed = FinaliseSchema.safeParse({
    hospital_id: formData.get("hospital_id"),
  });
  if (!parsed.success) return { error: "Invalid input." };
  const auth = await authoriseHospitalAdmin(parsed.data.hospital_id);
  if ("error" in auth) return { error: auth.error };

  // Needed to go live (kickoff §F6, D17): departments with a start department, at least one
  // ward, the primary admin and a backup admin on the roster. The Edge Function checks the DPA.
  const hospitalId = parsed.data.hospital_id;
  const [{ count: deptCount }, { count: wardCount }, { data: roster }, { data: app }] =
    await Promise.all([
      auth.service
        .from("hospital_departments")
        .select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId),
      auth.service
        .from("hospital_wards")
        .select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId),
      auth.service
        .from("hospital_admin_roster")
        .select("designation")
        .eq("hospital_id", hospitalId)
        .is("succeeded_at", null),
      auth.service
        .from("hospital_applications")
        .select("id, hospital_application_departments(is_primary)")
        .eq("approved_hospital_id", hospitalId)
        .maybeSingle(),
    ]);
  const designations = new Set((roster ?? []).map((r: { designation: string }) => r.designation));
  const junction = (app?.hospital_application_departments ?? []) as { is_primary: boolean }[];
  if ((deptCount ?? 0) === 0) return { error: "Confirm at least one department first." };
  if (app && !junction.some((d) => d.is_primary)) {
    return { error: CHECKLIST.departments.startRequired };
  }
  if ((wardCount ?? 0) === 0) return { error: "Add at least one ward first." };
  if (!designations.has("primary")) {
    return { error: "A primary admin must be on the roster (set automatically at approval)." };
  }
  if (!designations.has("backup")) return { error: CHECKLIST.goLive.needsBackup };

  // Activation goes through the existing Edge Function so the agreement
  // gate fires + the audit row is recorded. The setup wizard's job is
  // to gate the call on prerequisites; the Edge Function owns the
  // state flip + agreement check.
  const supabase = await createClient();
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) return { error: "Not authenticated." };

  try {
    const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/sa-activate-hospital`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-request-id": crypto.randomUUID(),
      },
      body: JSON.stringify({
        hospital_id: parsed.data.hospital_id,
        reason: "Setup wizard completed by hospital admin.",
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      logger.warn("setup.activate.failed", { status: res.status, text: text.slice(0, 200) });
      // The Edge Function gates by superadmin role today; this call may
      // 403 if the hospital_admin isn't also a superadmin. Surface a
      // clear message so the operator knows to ask a superadmin to
      // complete the activation step until we add a hospital_admin
      // self-activation path (GATE F polish).
      return {
        error:
          "Could not activate. Ask a platform superadmin to call sa-activate-hospital for this hospital — the agreement-gate check will run, and the activation will succeed if everything is in order.",
      };
    }
  } catch (e) {
    logger.error("setup.activate.network", { reason: String(e) });
    return { error: "Network error reaching the activation service." };
  }

  revalidatePath("/admin/setup");
  revalidatePath("/admin");
  redirect("/admin?welcomed=hospital-active");
}

/* ─── Small helpers ──────────────────────────────────────────────── */

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
