"use server";

import { z } from "zod";

import { logger } from "@/lib/logger";
import { allow } from "@/lib/onboarding/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * EV-1/EV-2: the onboarding funnel. PII-free by schema — form, event, section, field key, an error
 * code, elapsed ms and a random per-tab id. No values, names, contacts, IDs, coordinates or IPs.
 * Rate-limited; never throws (a lost event must never break a signup).
 */
const Event = z.object({
  form: z.enum(["patient", "clinical", "non_clinical", "hospital"]),
  event: z.enum(["start", "section_complete", "submit_attempt", "submit_ok", "field_error"]),
  section: z
    .string()
    .regex(/^[a-z_]{1,32}$/)
    .optional(),
  fieldKey: z
    .string()
    .regex(/^[A-Za-z]{1,40}$/)
    .optional(),
  errorCode: z
    .string()
    .regex(/^[a-z0-9_]{1,40}$/)
    .optional(),
  elapsedMs: z.number().int().min(0).max(86_400_000).optional(),
  tabId: z.uuid(),
});

export async function recordOnboardingEvent(input: unknown): Promise<void> {
  const parsed = Event.safeParse(input);
  if (!parsed.success || !(await allow("events", 120))) return;
  const e = parsed.data;
  const { error } = await createServiceClient()
    .from("onboarding_events")
    .insert({
      form: e.form,
      event: e.event,
      section: e.section ?? null,
      field_key: e.fieldKey ?? null,
      error_code: e.errorCode ?? null,
      elapsed_ms: e.elapsedMs ?? null,
      tab_id: e.tabId,
    });
  if (error) logger.warn("onboarding.event.insert_failed", { code: error.code });
}
