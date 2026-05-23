/**
 * approve-hospital-application — GATE F.
 *
 * Superadmin-only. On success:
 *   1. Inserts a row into public.hospitals (slug derived from
 *      hospital_name; collisions get a numeric suffix).
 *   2. Sets hospital_applications.approved_hospital_id +
 *      reviewed_by + reviewed_at + state='approved'.
 *   3. Grants the applicant a `hospital_admin` user_role scoped to
 *      the new hospital. The user_roles INSERT cascades into the
 *      audit_log via the trigger.
 *   4. Bumps users.state pending_approval → approved for the
 *      applicant if they're still pending.
 *
 * Steps 1–3 ideally run in a single transaction. supabase-js doesn't
 * expose multi-statement transactions, so we sequence them and roll
 * back a hospital row on later failure by deleting it. This is best-
 * effort; a partial failure leaves audit_log + sa_audit_log entries
 * that pinpoint exactly what happened for manual remediation.
 */

import { z } from "https://esm.sh/zod@4.4.3";

import { getCaller, hasRole, serviceClient } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import {
  badRequest,
  forbidden,
  methodNotAllowed,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "../_shared/errors.ts";
import { makeLogger } from "../_shared/logger.ts";
import { networkContext, recordSaAudit } from "../_shared/sa-audit.ts";

const log = makeLogger("approve-hospital-application");

const InputSchema = z.object({
  application_id: z.string().uuid(),
  reason: z.string().min(8, "Reason ≥ 8 chars required for the approval record."),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const init = { origin, requestId };

  const pre = preflight(request);
  if (pre) return pre;
  if (request.method !== "POST") return methodNotAllowed(init);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Body must be JSON", init);
  }
  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid input", init, parsed.error.flatten());
  }
  const input = parsed.data;

  const caller = await getCaller(request);
  if (!caller) return unauthorized(init);

  const isSuperadmin = await hasRole(caller.id, "superadmin");
  if (!isSuperadmin) return forbidden(init, "superadmin required");

  const sb = serviceClient();
  const { data: app, error: fetchError } = await sb
    .from("hospital_applications")
    .select(
      "id, applicant_user_id, hospital_name, facility_level, district_id, state, approved_hospital_id",
    )
    .eq("id", input.application_id)
    .single();
  if (fetchError || !app) return notFound(init, "application not found");
  if (app.state !== "pending_approval") {
    return badRequest("application is not pending approval", init);
  }

  // Reserve a unique slug.
  const baseSlug = slugify(app.hospital_name) || "hospital";
  let slug = baseSlug;
  let attempt = 0;
  while (attempt < 10) {
    const { data: existing } = await sb
      .from("hospitals")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!existing) break;
    attempt += 1;
    slug = `${baseSlug}-${attempt + 1}`;
  }
  if (attempt >= 10) {
    return serverError("could not allocate a unique slug; pick a different hospital name", init);
  }

  // Insert audit BEFORE the hospital row so failure here aborts the chain.
  const { ipAddress, userAgent } = networkContext(request);
  try {
    await recordSaAudit({
      actorId: caller.id,
      action: "approve_hospital_application",
      targetKind: "hospital_application",
      targetId: app.id,
      reason: input.reason,
      requestId,
      ipAddress,
      userAgent,
      beforeData: { state: app.state, approved_hospital_id: app.approved_hospital_id },
      afterData: { state: "approved", new_hospital_slug: slug },
    });
  } catch (e) {
    log.error("sa_audit failed; aborting approval", { requestId, reason: String(e) });
    return serverError("audit write failed", init);
  }

  // 1. Create the hospital row. `level` accepts the Phase 0 enum
  //    (national_referral / regional / district / hc4 / hc3 / private);
  //    we map facility_level → level conservatively. Anything off-map
  //    becomes 'private' for now — refine when the hospital_level
  //    enum is unified across the two tables (tracked as a follow-up).
  const levelMap: Record<string, string> = {
    hc_ii: "hc3",
    hc_iii: "hc3",
    hc_iv: "hc4",
    general: "district",
    regional_referral: "regional",
    national_referral: "national_referral",
    private: "private",
    other: "private",
  };
  const { data: hospitalRow, error: hospitalError } = await sb
    .from("hospitals")
    .insert({
      name: app.hospital_name,
      slug,
      level: levelMap[app.facility_level] ?? "private",
    })
    .select("id")
    .single();
  if (hospitalError || !hospitalRow) {
    log.error("hospital insert failed", { requestId, reason: hospitalError?.message });
    return serverError("hospital create failed", init);
  }

  // 2. Update the application row.
  const { error: appUpdateError } = await sb
    .from("hospital_applications")
    .update({
      state: "approved",
      approved_hospital_id: hospitalRow.id,
      reviewed_by: caller.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", app.id);
  if (appUpdateError) {
    // Best-effort rollback of the hospital row so we don't leave an
    // orphan facility nobody can claim. The audit row stays — that's
    // intentional, it shows the attempted-then-rolled-back action.
    await sb.from("hospitals").delete().eq("id", hospitalRow.id);
    log.error("application update failed; rolled back hospital", {
      requestId,
      reason: appUpdateError.message,
    });
    return serverError("application update failed", init);
  }

  // 3. Grant the applicant hospital_admin.
  const { error: roleError } = await sb.from("user_roles").insert({
    user_id: app.applicant_user_id,
    role: "hospital_admin",
    hospital_id: hospitalRow.id,
    created_by: caller.id,
  });
  if (roleError && roleError.code !== "23505" /* unique violation = role already held */) {
    log.error("user_role insert failed", { requestId, reason: roleError.message });
    // Don't rollback the hospital — the application is approved; the
    // missing role is recoverable manually and surfaces in the
    // applicant's own dashboard ("you have no admin role yet").
  }

  // 4. Bump user.state.
  const { data: userRow } = await sb
    .from("users")
    .select("state")
    .eq("id", app.applicant_user_id)
    .single();
  if (userRow?.state === "pending_approval") {
    await sb.from("users").update({ state: "approved" }).eq("id", app.applicant_user_id);
  }

  log.info("application approved", {
    requestId,
    application_id: app.id,
    hospital_id: hospitalRow.id,
  });
  return ok(
    {
      application_id: app.id,
      hospital_id: hospitalRow.id,
      hospital_slug: slug,
      state: "approved",
    },
    init,
  );
});
