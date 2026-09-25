import { NextResponse } from "next/server";

import { PREVIEW_COOKIE } from "@/lib/onboarding/feature";

/**
 * /signup/preview turns Onboarding v2 on for this browser only; /signup/preview?off turns it off.
 * The old forms stay everyone else's default until ONBOARDING_V2=1 (D18).
 */
export function GET(request: Request) {
  const url = new URL(request.url);
  const off = url.searchParams.has("off");
  const res = NextResponse.redirect(new URL("/get-started", url));
  res.cookies.set(PREVIEW_COOKIE, off ? "" : "1", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    maxAge: off ? 0 : 60 * 60 * 24 * 30,
  });
  return res;
}
