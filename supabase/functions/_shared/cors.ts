/**
 * Shared CORS for MedSync Edge Functions.
 *
 * Browsers won't call our Edge Functions directly in Phase 0 (everything goes
 * via the Next server). But Supabase's Studio + curl examples preflight with
 * OPTIONS, so we accept them. Origins are intentionally locked to MedSync
 * surfaces; widen here when (if) we expose functions to third parties.
 */

const ALLOWED_ORIGINS = new Set<string>(["http://localhost:3000", "https://medsync.health"]);

// Review L-3: no wildcard. Any *.vercel.app site could call with a token it held; the app calls from its server.
function isAllowedOrigin(origin: string | null): boolean {
  return !!origin && ALLOWED_ORIGINS.has(origin);
}

export function corsHeaders(origin: string | null): HeadersInit {
  const allowed = isAllowedOrigin(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin! : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, x-request-id",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function preflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  });
}
