"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { env } from "@/lib/env";
import {
  assertScopeOwnsHospital,
  requireHospitalAdminScope,
  ScopeViolationError,
} from "@/lib/hospital-admin/scope";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

/**
 * Server Actions proxying to the hospital-admin staff Edge Functions.
 *
 * Every action follows the integration contract:
 *   1. Resolve scope server-side (no client-passed hospital_id is trusted).
 *   2. Forward to the Edge Function with the caller's JWT.
 *   3. Revalidate the staff route on success.
 *   4. Return a typed { ok | error } envelope; never throw to the form.
 *
 * The actual mutation + audit + role-check + scope-check all happen
 * inside the Edge Function. These actions exist so the admin UI never
 * does a client-side fetch with the access token in JS — the JWT
 * stays cookie-bound and is forwarded server-side.
 */

const ReasonArgs = z.object({
  affiliation_id: z.string().uuid(),
  reason: z.string().min(8, "Reason ≥ 8 chars required."),
});

const ApproveArgs = ReasonArgs.extend({
  licence_valid_until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the licence date as a full date.")
    .optional(),
});

const NoteArgs = z.object({
  affiliation_id: z.string().uuid(),
  note: z.string().min(8, "Note ≥ 8 chars required."),
});

export type StaffActionState = { ok?: boolean; error?: string };

async function callEdgeFunction(
  name: string,
  body: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await callEdgeFunctionForData<unknown>(name, body);
  if (!result.ok) return result;
  return { ok: true };
}

async function callEdgeFunctionForData<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) return { ok: false, error: "Not authenticated." };

  try {
    const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-request-id": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } | string };
        if (typeof parsed.error === "string") detail = parsed.error;
        else if (parsed.error?.message) detail = parsed.error.message;
      } catch {
        // body wasn't JSON; use raw text
      }
      logger.warn(`hospital-admin.staff.${name}.failed`, { status: res.status });
      return { ok: false, error: detail || `Edge Function returned ${res.status}.` };
    }
    try {
      const parsed = JSON.parse(text) as { data?: T };
      return { ok: true, data: (parsed.data ?? (parsed as unknown)) as T };
    } catch {
      return { ok: true, data: undefined as T };
    }
  } catch (e) {
    logger.error(`hospital-admin.staff.${name}.network`, { reason: String(e) });
    return {
      ok: false,
      error: `Couldn't reach the ${name} service. If you're in local dev, run: npx supabase functions deploy ${name}`,
    };
  }
}

/* ─── Approve / Reject / Request-info ───────────────────────────────── */

export async function approveStaffAffiliationAction(
  _prev: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const parsed = ApproveArgs.safeParse({
    affiliation_id: formData.get("affiliation_id"),
    reason: formData.get("reason"),
    // An empty date input posts "": that means "not recorded".
    licence_valid_until: formData.get("licence_valid_until") || undefined,
  });
  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return { error: fe.reason?.[0] ?? fe.licence_valid_until?.[0] ?? "Invalid input." };
  }

  await guardScope(parsed.data.affiliation_id);

  // The Edge Function holds DOC-1 (no licence, no approval) and records licence_valid_until.
  const result = await callEdgeFunction("approve-staff-affiliation", parsed.data);
  if (!result.ok) return { error: result.error };
  revalidatePath("/hospital-admin/staff");
  revalidatePath("/hospital-admin");
  return { ok: true };
}

export async function rejectStaffAffiliationAction(
  _prev: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const parsed = ReasonArgs.safeParse({
    affiliation_id: formData.get("affiliation_id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors.reason?.[0] ?? "Invalid input." };
  }

  await guardScope(parsed.data.affiliation_id);

  const result = await callEdgeFunction("reject-staff-affiliation", parsed.data);
  if (!result.ok) return { error: result.error };
  revalidatePath("/hospital-admin/staff");
  revalidatePath("/hospital-admin");
  return { ok: true };
}

export async function requestStaffInfoAction(
  _prev: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const parsed = NoteArgs.safeParse({
    affiliation_id: formData.get("affiliation_id"),
    note: formData.get("note"),
  });
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors.note?.[0] ?? "Invalid input." };
  }

  await guardScope(parsed.data.affiliation_id);

  const result = await callEdgeFunction("ha-request-staff-info", parsed.data);
  if (!result.ok) return { error: result.error };
  revalidatePath("/hospital-admin/staff");
  return { ok: true };
}

/* ─── Status transitions (suspend / deactivate / reactivate) ───────── */

const SetStatusArgs = z.object({
  affiliation_id: z.string().uuid(),
  target_state: z.enum(["suspended", "deactivated", "approved"]),
  reason: z.string().min(8, "Reason ≥ 8 chars required."),
});

export async function setStaffStatusAction(
  _prev: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const parsed = SetStatusArgs.safeParse({
    affiliation_id: formData.get("affiliation_id"),
    target_state: formData.get("target_state"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return { error: fe.reason?.[0] ?? fe.target_state?.[0] ?? "Invalid input." };
  }
  await guardScope(parsed.data.affiliation_id);
  const result = await callEdgeFunction("ha-set-staff-status", parsed.data);
  if (!result.ok) return { error: result.error };
  revalidatePath("/hospital-admin/staff");
  return { ok: true };
}

/* ─── MFA reset ─────────────────────────────────────────────────────── */

const MfaResetArgs = z.object({
  affiliation_id: z.string().uuid(),
  reason: z.string().min(8, "Reason ≥ 8 chars required."),
});

export async function resetStaffMfaAction(
  _prev: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const parsed = MfaResetArgs.safeParse({
    affiliation_id: formData.get("affiliation_id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors.reason?.[0] ?? "Invalid input." };
  }
  await guardScope(parsed.data.affiliation_id);
  const result = await callEdgeFunction("ha-reset-staff-mfa", parsed.data);
  if (!result.ok) return { error: result.error };
  revalidatePath("/hospital-admin/staff");
  return { ok: true };
}

/* ─── Role / department assignment ──────────────────────────────────── */

const AssignRoleArgs = z.object({
  affiliation_id: z.string().uuid(),
  new_role_id: z.string().uuid("Pick a role from the list."),
  new_department_id: z.string().uuid("Pick a department from the list."),
  reason: z.string().min(8, "Reason ≥ 8 chars required."),
});

export async function assignStaffRoleAction(
  _prev: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const parsed = AssignRoleArgs.safeParse({
    affiliation_id: formData.get("affiliation_id"),
    new_role_id: formData.get("new_role_id"),
    new_department_id: formData.get("new_department_id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return {
      error: fe.reason?.[0] ?? fe.new_role_id?.[0] ?? fe.new_department_id?.[0] ?? "Invalid input.",
    };
  }
  await guardScope(parsed.data.affiliation_id);
  const result = await callEdgeFunction("ha-assign-staff-role", parsed.data);
  if (!result.ok) return { error: result.error };
  revalidatePath("/hospital-admin/staff");
  return { ok: true };
}

/* ─── Invitations ──────────────────────────────────────────────────── */

const InviteArgs = z.object({
  reason: z.string().min(8, "Reason ≥ 8 chars required."),
  /** One email per line; empty lines + duplicates dropped. */
  emails_blob: z.string().min(1, "At least one email required."),
});

export interface IssuedInvitation {
  id: string;
  email: string;
  claim_token: string;
  claim_url: string;
  expires_at: string;
}

export type InviteStaffState =
  | { ok?: false; error?: string }
  | { ok: true; invitations: ReadonlyArray<IssuedInvitation>; source: "individual" | "bulk" };

export async function inviteStaffAction(
  _prev: InviteStaffState,
  formData: FormData,
): Promise<InviteStaffState> {
  const parsed = InviteArgs.safeParse({
    reason: formData.get("reason"),
    emails_blob: formData.get("emails_blob"),
  });
  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return { error: fe.reason?.[0] ?? fe.emails_blob?.[0] ?? "Invalid input." };
  }

  // Parse the blob: one email per line, trim, dedupe, drop blanks.
  const seen = new Set<string>();
  const invites: Array<{ email: string }> = [];
  for (const line of parsed.data.emails_blob.split(/\r?\n/)) {
    const email = line.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { error: `'${email}' isn't a valid email — fix or remove the line and try again.` };
    }
    seen.add(email);
    invites.push({ email });
  }
  if (invites.length === 0) return { error: "At least one email required." };
  if (invites.length > 100) return { error: "Cap is 100 invitees per send. Split the list." };

  const scope = await requireHospitalAdminScope();
  const result = await callEdgeFunctionForData<{
    invitations: IssuedInvitation[];
    source: "individual" | "bulk";
  }>("ha-invite-staff", {
    hospital_id: scope.hospitalId,
    invites,
    reason: parsed.data.reason,
  });
  if (!result.ok) return { error: result.error };

  revalidatePath("/hospital-admin/staff");
  return { ok: true, invitations: result.data.invitations, source: result.data.source };
}

const RevokeArgs = z.object({
  invitation_id: z.string().uuid(),
  reason: z.string().min(8, "Reason ≥ 8 chars required."),
});

export async function revokeStaffInvitationAction(
  _prev: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const parsed = RevokeArgs.safeParse({
    invitation_id: formData.get("invitation_id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors.reason?.[0] ?? "Invalid input." };
  }

  const scope = await requireHospitalAdminScope();
  // The Edge Function does the cross-tenant safety check, but we
  // pre-check here too so a misbehaving client gets a clean error.
  const supabase = await createClient();
  const { data: inv } = await supabase
    .from("hospital_staff_invitations")
    .select("hospital_id")
    .eq("id", parsed.data.invitation_id)
    .maybeSingle();
  if (!inv) {
    throw new ScopeViolationError("Invitation does not exist for this admin's scope.");
  }
  assertScopeOwnsHospital(scope, inv.hospital_id as string);

  const result = await callEdgeFunction("ha-revoke-staff-invitation", parsed.data);
  if (!result.ok) return { error: result.error };
  revalidatePath("/hospital-admin/staff");
  return { ok: true };
}

/* ─── Per-affiliation safety net ───────────────────────────────────── */

/**
 * Before forwarding to the Edge Function, confirm that the targeted
 * affiliation actually belongs to the current admin's hospital.
 *
 * The Edge Function ALSO does this (defence in depth), but doing it
 * here means a misbehaving client gets a clean 403 from us instead of
 * a "service returned an error" round-trip. Throws ScopeViolationError
 * — Next swallows it and returns to the form with a generic message,
 * so we don't leak the existence of the targeted row.
 */
async function guardScope(affiliationId: string): Promise<void> {
  const scope = await requireHospitalAdminScope();
  const supabase = await createClient();
  const { data: aff } = await supabase
    .from("staff_affiliations")
    .select("hospital_id")
    .eq("id", affiliationId)
    .maybeSingle();
  if (!aff) {
    throw new ScopeViolationError("Affiliation does not exist for this admin's scope.");
  }
  assertScopeOwnsHospital(scope, aff.hospital_id as string);
}
