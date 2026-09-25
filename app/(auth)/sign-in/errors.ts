import { SIGN_IN } from "@/content/auth";

/**
 * The one sign-in failure message. An unknown email and a wrong password read
 * the same, so the form never tells anyone which emails have accounts; only
 * Supabase's rate limit (HTTP 429) gets its own words.
 */
export function signInErrorMessage(error: { status?: number; code?: string } | null): string {
  return error?.status === 429 || error?.code === "over_request_rate_limit"
    ? SIGN_IN.errors.rateLimited
    : SIGN_IN.errors.mismatch;
}

/**
 * A `?redirect=` target, if it stays on this site: a path starting with one "/".
 * Refuses "//evil.example" and "/\evil.example" (browsers read both as another
 * host), and any whitespace: browsers drop tabs and newlines from URLs, so
 * "/\t/evil.example" would become "//evil.example".
 */
export function safeRedirect(path: string | undefined | null): string | null {
  return path && /^\/(?![/\\])\S*$/.test(path) ? path : null;
}
