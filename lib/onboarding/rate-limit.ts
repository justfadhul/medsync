import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";

// The raw address never leaves this process: it is hashed with a per-process random salt.
const SALT = randomBytes(16).toString("hex");
const windows = new Map<string, { start: number; n: number }>();

/**
 * Fixed-window limiter for the public onboarding actions (search, place, events).
 * ponytail: per serverless instance, in memory — a burst spread across instances gets N× the
 * budget. Good enough for lookups over static data; move to a shared counter if abuse shows up.
 */
export async function allow(bucket: string, max: number, windowMs = 60_000): Promise<boolean> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
  const key = `${bucket}:${createHash("sha256")
    .update(SALT + ip)
    .digest("hex")
    .slice(0, 32)}`;
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start > windowMs) {
    windows.set(key, { start: now, n: 1 });
    if (windows.size > 10_000)
      for (const [k, v] of windows) if (now - v.start > windowMs) windows.delete(k);
    return true;
  }
  w.n += 1;
  return w.n <= max;
}
