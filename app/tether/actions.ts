"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";

import { parseLead } from "@/lib/landing/lead";
import { logger } from "@/lib/logger";
import { allow } from "@/lib/onboarding/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * "Register your clinic" (D-LP-09): validate, then store one row with the service role. A bot (honeypot)
 * or a sixth try in an hour is refused silently: it sees the same success, and nothing is stored.
 * The email never goes to a log or an analytics event.
 */
export async function registerClinic(input: {
  email: string;
  company: string;
}): Promise<{ ok: true } | { ok: false; error: "bad" | "failed" }> {
  const lead = parseLead(input);
  if (lead.kind === "bad") return { ok: false, error: "bad" };
  if (lead.kind === "bot" || !(await allow("clinic-leads", 5, 3_600_000))) return { ok: true };
  const ua = (await headers()).get("user-agent");
  const { error } = await createServiceClient()
    .from("clinic_leads")
    .insert({
      email: lead.email,
      source: "landing",
      user_agent_hash: ua ? createHash("sha256").update(ua).digest("hex") : null,
    });
  if (error) {
    logger.error("clinic_leads.insert_failed", { code: error.code });
    return { ok: false, error: "failed" };
  }
  return { ok: true };
}
