import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * POST /sign-out — ends THIS device's session and bounces to /sign-in.
 * GET is intentionally not supported (avoids CSRF logout via a link).
 *
 * `scope: "local"`: supabase-js defaults to "global", which revokes every
 * session the user holds — signing out of a shared ward PC used to sign the
 * same clinician out of their phone and every other tab.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL("/sign-in", request.url), { status: 303 });
}
