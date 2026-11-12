import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { ncdDemoLoad } from "@/db/schema/ncd-registry";
import { secretMatches } from "@/lib/channels/webhook-auth";
import { resolveContext } from "@/lib/ncdreg/context";
import { continueLoad } from "@/lib/ncdreg/demo/service";
import { ncdRegistryLiveFor } from "@/lib/ncdreg/scope";

/**
 * §10.2: a demo load (either mode) continues here in resumable chunks (the repository's background
 * mechanism is Vercel Cron with CRON_SECRET). Each run writes for about 40 seconds and stops; the
 * administration card also continues the load while it is open. Not yet scheduled in vercel.json.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (
    !secretMatches(req.headers.get("authorization") ?? "", secret ? `Bearer ${secret}` : undefined)
  )
    return new NextResponse("Unauthorized", { status: 401 });
  const loads = await db.select().from(ncdDemoLoad).where(eq(ncdDemoLoad.status, "loading"));
  const out = [];
  for (const l of loads) {
    if (!ncdRegistryLiveFor(l.facilityId)) continue;
    const ctx = await resolveContext({
      userId: l.startedBy,
      facilityId: l.facilityId,
      principal: "user",
    });
    out.push({ load: l.id, ...(await continueLoad(ctx, 40_000)) });
  }
  return NextResponse.json({ ok: true, loads: out });
}
