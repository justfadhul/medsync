"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

/**
 * Server-Action proxies to the GATE F approval Edge Functions.
 *
 * These exist so the admin UI doesn't need a client-side `fetch` with
 * the access token in JS. The Server Action runs server-side, pulls
 * the JWT from the cookie-bound session, and forwards it as a Bearer
 * token to the Edge Function — which then performs its own
 * authentication + authorization with the verified token.
 *
 * Edge Function URL pattern: `<SUPABASE_URL>/functions/v1/<name>`.
 * If the Edge Function is not deployed locally (common in dev), the
 * Action returns a typed error rather than throwing so the admin UI
 * can surface "deploy the Edge Function" guidance to the developer.
 */

const ReviewArgsSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().min(8, "Reason ≥ 8 chars required."),
});

export type ReviewState = {
  ok?: boolean;
  error?: string;
};

async function callEdgeFunction(
  name: string,
  body: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) return { ok: false, error: "Not authenticated." };

  const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${name}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-request-id": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = await res.text();
      try {
        const parsed = JSON.parse(detail) as { error?: string };
        detail = parsed.error ?? detail;
      } catch {
        // body wasn't JSON; use the raw text
      }
      logger.warn(`admin.edge.${name}.failed`, { status: res.status });
      return { ok: false, error: detail || `Edge Function returned ${res.status}.` };
    }
    return { ok: true };
  } catch (e) {
    logger.error(`admin.edge.${name}.network`, { reason: String(e) });
    return {
      ok: false,
      error:
        "Couldn't reach the approval service. If you're in local dev, deploy the Edge Function (supabase functions deploy " +
        name +
        ").",
    };
  }
}

/* ─── Staff affiliations ──────────────────────────────────────────────── */

export async function approveStaffAffiliationAction(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const parsed = ReviewArgsSchema.safeParse({
    id: formData.get("id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors.reason?.[0] ?? "Invalid input." };
  }
  const result = await callEdgeFunction("approve-staff-affiliation", {
    affiliation_id: parsed.data.id,
    reason: parsed.data.reason,
  });
  if (!result.ok) return { error: result.error };
  revalidatePath("/admin");
  return { ok: true };
}

export async function rejectStaffAffiliationAction(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const parsed = ReviewArgsSchema.safeParse({
    id: formData.get("id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors.reason?.[0] ?? "Invalid input." };
  }
  const result = await callEdgeFunction("reject-staff-affiliation", {
    affiliation_id: parsed.data.id,
    reason: parsed.data.reason,
  });
  if (!result.ok) return { error: result.error };
  revalidatePath("/admin");
  return { ok: true };
}

/* ─── Hospital applications ───────────────────────────────────────────── */

export async function approveHospitalApplicationAction(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const parsed = ReviewArgsSchema.safeParse({
    id: formData.get("id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors.reason?.[0] ?? "Invalid input." };
  }
  const result = await callEdgeFunction("approve-hospital-application", {
    application_id: parsed.data.id,
    reason: parsed.data.reason,
  });
  if (!result.ok) return { error: result.error };
  revalidatePath("/admin");
  return { ok: true };
}

export async function rejectHospitalApplicationAction(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const parsed = ReviewArgsSchema.safeParse({
    id: formData.get("id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors.reason?.[0] ?? "Invalid input." };
  }
  const result = await callEdgeFunction("reject-hospital-application", {
    application_id: parsed.data.id,
    reason: parsed.data.reason,
  });
  if (!result.ok) return { error: result.error };
  revalidatePath("/admin");
  return { ok: true };
}
