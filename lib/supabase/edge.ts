import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

/**
 * The one caller for Supabase Edge Functions invoked from a Server
 * Action. Attaches the caller's JWT, stamps `x-request-id` (support
 * correlates the Next log line with the function's log line by it),
 * and flattens the `{ error: string | { message } }` envelope into a
 * single staff-facing string.
 *
 * `logPrefix` is the surface doing the calling — "nurse",
 * "clinician.schedule" — so log keys stay `<prefix>.<function>.failed`
 * / `.network`, unchanged per surface.
 *
 * The parsed response envelope comes back as `data`; callers that only
 * need success ignore it. Scope checks, zod parsing, revalidation and
 * audit reasons stay in the action files — this only does transport.
 */
export async function callEdge<T = unknown>(
  name: string,
  body: Record<string, unknown>,
  logPrefix: string,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) return { ok: false, error: "Not authenticated." };
  const r = await post<T>(name, body, logPrefix, token);
  // The staff contract is the flat shape; the status and code are E2's.
  return r.ok ? r : { ok: false, error: r.error };
}

export type EdgeFailure = {
  ok: false;
  error: string;
  /** HTTP status, or 0 when the function was unreachable. */
  status: number;
  /** The envelope's `error.code` when it carried one (`call_only`, `rate_limited`, …). */
  code: string | null;
};

/**
 * The same transport for the functions whose CALLER IS OPTIONAL (ADR 0098:
 * the Emergency Pathway — a bystander must be able to act). A signed-in
 * session's JWT is forwarded when there is one; otherwise the anon key
 * carries the request past the gateway and the function sees no caller.
 * Keeps the status and error code, because E2 branches on 403 `call_only`
 * and 429 `rate_limited` to keep the call buttons up.
 */
export async function callEdgePublic<T = unknown>(
  name: string,
  body: Record<string, unknown>,
  logPrefix: string,
): Promise<{ ok: true; data: T } | EdgeFailure> {
  const supabase = await createClient();
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return post<T>(name, body, logPrefix, token);
}

async function post<T>(
  name: string,
  body: Record<string, unknown>,
  logPrefix: string,
  token: string,
): Promise<{ ok: true; data: T } | EdgeFailure> {
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
      // A gateway error page (Cloudflare 520, 502) is HTML: staff never see markup.
      let detail = text.trimStart().startsWith("<") ? "" : text;
      let code: string | null = null;
      try {
        const parsed = JSON.parse(text) as {
          error?: string | { message?: string; code?: string };
        };
        if (typeof parsed.error === "string") detail = parsed.error;
        else if (parsed.error?.message) detail = parsed.error.message;
        if (typeof parsed.error === "object" && parsed.error?.code) code = parsed.error.code;
      } catch {
        /* keep raw */
      }
      logger.warn(`${logPrefix}.${name}.failed`, { status: res.status });
      return {
        ok: false,
        error: detail || `Edge Function returned ${res.status}.`,
        status: res.status,
        code,
      };
    }
    try {
      return { ok: true, data: JSON.parse(text) as T };
    } catch {
      // 2xx with an empty or non-JSON body: the write landed. Never
      // report that as a failure — a clinician retrying an audited
      // write that already succeeded is the worse outcome.
      return { ok: true, data: undefined as T };
    }
  } catch (e) {
    logger.error(`${logPrefix}.${name}.network`, { reason: String(e) });
    return { ok: false, error: `Couldn't reach ${name}.`, status: 0, code: null };
  }
}
