import { env } from "@/lib/env";

/**
 * Several accounts signed in to one browser, Google-style. Each account owns
 * a numbered slot: its own Supabase auth cookie, so signing in one never
 * overwrites another. `ms-account` names the slot every tab uses right now.
 *
 * Slot 0 keeps Supabase's default cookie name, so sessions from before this
 * existed stay signed in.
 */
export const ACTIVE_ACCOUNT_COOKIE = "ms-account";
// Four, not five (ADR 0472): five sessions of cookies pass Node's 16 KB request-header limit (HTTP 431).
export const MAX_ACCOUNTS = 4;

export function authCookieName(slot: number): string {
  // Read on call, not at import: the build collects page data with no Supabase env (CI).
  const base = `sb-${new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
  return slot === 0 ? base : `${base}-s${slot}`;
}

export function parseSlot(value: string | undefined | null): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n < MAX_ACCOUNTS ? n : 0;
}

/** Slots that hold a session cookie (whole, or chunked as `<name>.0`). */
export function slotsInUse(cookies: { name: string; value: string }[]): number[] {
  const live = new Set(cookies.filter((c) => c.value).map((c) => c.name));
  const slots: number[] = [];
  for (let s = 0; s < MAX_ACCOUNTS; s++) {
    const name = authCookieName(s);
    if (live.has(name) || live.has(`${name}.0`)) slots.push(s);
  }
  return slots;
}

export const ACTIVE_ACCOUNT_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 400 * 24 * 60 * 60,
} as const;
