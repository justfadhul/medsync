import "server-only";

import { createHash } from "node:crypto";

import common from "@/data/passwords/common.json";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/** A result every v2 signup action returns (the page renders it; never throws for user errors). */
export type SignupResult =
  | { ok: true; next: string; uploads: string[] }
  | { ok: false; fieldErrors?: Record<string, string>; formError?: string };

const blocked = new Set(common.words);

/** D14: 12–72 bytes (schema) + the common-password list (server-only: the list stays off the page). */
export function passwordProblem(password: string, email: string): string | null {
  const p = password.toLowerCase();
  if (blocked.has(p)) return "That password is on a list of common passwords. Choose another.";
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && p.includes(local))
    return "Don't use your email address in your password.";
  return null;
}

const hashKey = (key: string) => createHash("sha256").update(`onboarding:${key}`).digest("hex");

/**
 * Creates the login account, idempotently. The submit key's hash rides in user_metadata: a retry
 * after a lost response finds the account it already made and signs back in, instead of
 * "email already in use" (§5.1). No table (gate-a-proposal §6.8).
 */
export async function createAccount(args: {
  email: string;
  password: string;
  fullName: string;
  key: string;
}): Promise<{ userId: string; replay: boolean } | { error: string }> {
  const supabase = await createClient();
  const keyHash = hashKey(args.key);
  const { data, error } = await supabase.auth.signUp({
    email: args.email,
    password: args.password,
    options: { data: { full_name: args.fullName, onboarding_key: keyHash } },
  });
  if (!error && data.user) return { userId: data.user.id, replay: false };

  if (error && /already (been )?registered|already exists/i.test(error.message)) {
    const service = createServiceClient();
    const { data: row } = await service
      .from("users")
      .select("id")
      .eq("email", args.email)
      .maybeSingle();
    if (row?.id) {
      const { data: existing } = await service.auth.admin.getUserById(row.id);
      if (existing.user?.user_metadata?.onboarding_key === keyHash) {
        // Same submit, retried: restore the session the lost response would have set.
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: args.email,
          password: args.password,
        });
        if (!signInError) return { userId: row.id, replay: true };
      }
    }
    return { error: "An account with this email already exists. Sign in instead." };
  }
  if (error && /rate limit/i.test(error.message))
    return { error: "Too many sign-ups from here just now. Try again in a few minutes." };
  return { error: "We couldn't create your account. Try again." };
}

/** Best effort: a failed signup must not leave a stranded login account behind. */
export async function removeAccount(userId: string): Promise<void> {
  await createServiceClient()
    .auth.admin.deleteUser(userId)
    .catch(() => undefined);
}

/** The live data-processing notice, checked against the text the page showed (hash). */
export async function consentMatches(version: string, sha: string): Promise<boolean> {
  const { data } = await createServiceClient()
    .from("consent_versions")
    .select("body_sha256")
    .eq("consent_type", "data_processing")
    .eq("version", version)
    .maybeSingle();
  return !!data && data.body_sha256.toLowerCase() === sha.toLowerCase();
}

export async function recordConsent(userId: string, version: string, sha: string): Promise<void> {
  // The row is the legal proof (DPPA 2019) — the caller logs a failure; it never blocks the account.
  const { error } = await createServiceClient().from("consent_records").insert({
    user_id: userId,
    consent_type: "data_processing",
    version,
    consent_text_sha256: sha,
    accepted_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

/** pcode → database ids (after migration 0070). Null when the place is unknown. */
export async function placeIds(districtPcode: string, subcountyPcode: string | null) {
  const service = createServiceClient();
  const { data: d } = await service
    .from("districts")
    .select("id")
    .eq("pcode", districtPcode)
    .maybeSingle();
  if (!d) return null;
  if (!subcountyPcode) return { districtId: d.id as string, subcountyId: null };
  const { data: s } = await service
    .from("subcounties")
    .select("id")
    .eq("pcode", subcountyPcode)
    .maybeSingle();
  return s ? { districtId: d.id as string, subcountyId: s.id as string } : null;
}
