import "server-only";

import { NEW_PASSWORD } from "@/content/auth";
import { passwordProblem } from "@/lib/onboarding/account";
import { passwordField } from "@/lib/onboarding/schemas";
import { authCookieName, MAX_ACCOUNTS } from "@/lib/supabase/accounts";

/**
 * Password reset, the steps that decide something. The pages and actions beside this file only
 * wire them to Supabase:
 *
 *   /forgot-password          ask for a link (Supabase Auth `resetPasswordForEmail`)
 *   /forgot-password/confirm  the email link lands here; "Continue" opens an aal1 session for the
 *                             account (a button, not the GET: mail scanners open links before people do)
 *   /sign-in/mfa              staff with an authenticator pass it first (aal2), as at sign-in
 *   /forgot-password/new      choose the password; then every session ends and the user signs in
 *
 * The link's session is an ordinary aal1 session: proxy.ts and the 0288 `mfa_gate` treat it as they
 * treat a password-only sign-in, so the reset never stands in for the authentication code.
 */
export const RESET_PATH = "/forgot-password";
export const CONFIRM_PATH = "/forgot-password/confirm";
export const NEW_PATH = "/forgot-password/new";
export const EXPIRED_PATH = `${RESET_PATH}?link=expired`;
export const MFA_PATH = `/sign-in/mfa?redirect=${encodeURIComponent(NEW_PATH)}`;
export const SIGN_IN_AFTER = "/sign-in?reset=1";

/**
 * What the email link carries. A token hash works on any device, but needs the recovery email
 * template to link to /forgot-password/confirm?token_hash=…&type=recovery. Supabase's default
 * template sends a PKCE code instead, which works only in the browser that asked for the link.
 */
export type LinkProof = { tokenHash: string } | { code: string } | null;

export function linkProof(get: (name: string) => unknown): LinkProof {
  const read = (name: string) => {
    const v = get(name);
    return typeof v === "string" && v ? v : null;
  };
  const tokenHash = read("token_hash");
  if (tokenHash && read("type") === "recovery") return { tokenHash };
  const code = read("code");
  return code ? { code } : null;
}

/** The account slot whose PKCE verifier the reset request left in this browser, if any. */
export function verifierSlot(cookies: { name: string }[]): number | null {
  const names = new Set(cookies.map((c) => c.name));
  for (let s = 0; s < MAX_ACCOUNTS; s++) {
    const name = `${authCookieName(s)}-code-verifier`;
    if (names.has(name) || names.has(`${name}.0`)) return s;
  }
  return null;
}

/** An account with an authenticator passes it before choosing a password (Supabase refuses below aal2). */
export function needsMfa(
  aal: { currentLevel: string | null; nextLevel: string | null } | null | undefined,
): boolean {
  return aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2";
}

export type NewPasswordErrors = Partial<Record<"password" | "confirm" | "_form", string>>;

/** The sign-up rules (12–72 bytes, not common, not the email), then the two must match. */
export function newPasswordProblem(
  password: string,
  confirm: string,
  email: string,
): NewPasswordErrors | null {
  const parsed = passwordField.safeParse(password);
  const problem = parsed.success
    ? passwordProblem(password, email)
    : (parsed.error.issues[0]?.message ?? NEW_PASSWORD.errors.weak);
  if (problem) return { password: problem };
  if (password !== confirm) return { confirm: NEW_PASSWORD.errors.mismatch };
  return null;
}

/** Supabase's refusal of `updateUser({ password })`, in the page's words. */
export function updateRefusal(code: string | undefined): NewPasswordErrors {
  if (code === "same_password") return { password: NEW_PASSWORD.errors.same };
  if (code === "weak_password") return { password: NEW_PASSWORD.errors.weak };
  return { _form: NEW_PASSWORD.errors.failed };
}
