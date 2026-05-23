import "server-only";

import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

/**
 * Roles whose holders are REQUIRED to enrol TOTP MFA and pass an AAL2
 * challenge on every fresh session. Patients are optional (per kickoff).
 */
export const MFA_REQUIRED_ROLES = new Set<string>([
  "clinician",
  "nurse",
  "pharmacist",
  "lab_tech",
  "hospital_admin",
  "superadmin",
]);

export interface AuthState {
  user: User | null;
  /** All role rows for the user (empty if none assigned yet). */
  roles: string[];
  /** True if the user holds any role in MFA_REQUIRED_ROLES. */
  mfaRequired: boolean;
  /** Current Authenticator Assurance Level from Supabase. */
  aal: "aal1" | "aal2" | null;
  /** nextLevel from Supabase — "aal2" means the user has MFA enrolled. */
  nextAal: "aal1" | "aal2" | null;
}

/**
 * Single source of truth for "who is the user and what do they need to do
 * next". Used by proxy.ts and any Server Component that needs auth state.
 *
 * Always calls `getUser()` (server-validates the JWT). NEVER call
 * `getSession()` — its cookie value is forgeable.
 */
export async function getAuthState(): Promise<AuthState> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return { user: null, roles: [], mfaRequired: false, aal: null, nextAal: null };
  }

  const [rolesResult, aalResult] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);

  const roles = (rolesResult.data ?? []).map((r: { role: string }) => r.role);
  const mfaRequired = roles.some((r) => MFA_REQUIRED_ROLES.has(r));

  return {
    user,
    roles,
    mfaRequired,
    aal: (aalResult.data?.currentLevel as "aal1" | "aal2" | null) ?? null,
    nextAal: (aalResult.data?.nextLevel as "aal1" | "aal2" | null) ?? null,
  };
}
