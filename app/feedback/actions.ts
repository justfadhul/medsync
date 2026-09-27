"use server";

import { logger } from "@/lib/logger";
import { allow } from "@/lib/onboarding/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { parseFeedback } from "./_lib/parse";

/** Public, one section per call: validated against content/feedback.ts, rate-limited, written with the service role. */
export async function submitFeedback(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: "invalid" | "rate" | "failed" }> {
  if (!(await allow("feedback", 30, 10 * 60_000))) return { ok: false, error: "rate" };
  const parsed = parseFeedback(input);
  if (!parsed) return { ok: false, error: "invalid" };
  const { error } = await createServiceClient().from("tester_feedback").insert(parsed);
  if (error) {
    logger.error("feedback.insert_failed", { reason: error.message });
    return { ok: false, error: "failed" };
  }
  return { ok: true };
}
