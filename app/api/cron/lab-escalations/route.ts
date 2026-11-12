import { NextResponse } from "next/server";

import { db } from "@/db";
import { secretMatches } from "@/lib/channels/webhook-auth";
import { env } from "@/lib/env";
import { escalateIpcAlerts } from "@/lib/ipc/store";
import { deliverAfterCommit, runEscalations } from "@/lib/lab/criticals/store";
import { logger } from "@/lib/logger";
import { createAfricasTalkingSender } from "@/lib/notifications/africastalking";
import { enqueueResultsReady, sendResultsReady } from "@/lib/notify/results-ready-store";

export const dynamic = "force-dynamic";

/**
 * The critical-alert escalation run (Lab Phase 1 ES-2, ES-3; ADR 0244; D-LAB1-27). Called every
 * minute by pg_cron through pg_net (POST, migration 0106's private.schedule_lab_escalations), with
 * the CRON_SECRET bearer. Escalates every open alert past its signed time across hospitals, records
 * a heartbeat, delivers after commit. Idempotent: the reads' lazy path may run at the same moment.
 */
async function run(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!env.CRON_SECRET) {
    logger.error("cron.lab-escalations.missing_secret");
    return NextResponse.json(
      { error: "CRON_SECRET not configured on the server." },
      { status: 503 },
    );
  }
  if (!supplied || !secretMatches(supplied, env.CRON_SECRET))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const database = db as unknown as Parameters<typeof runEscalations>[0];
    const { escalated, jobs } = await runEscalations(database, {
      now: new Date(),
      source: "scheduler",
    });
    const { failed } = await deliverAfterCommit(database, jobs);
    // Lab Phase 5 (IC-7): IPC alerts with no action within the window escalate (the same minute's tick).
    const ipcEscalated = await db.transaction((tx) => escalateIpcAlerts(tx as never, new Date()));
    // Lab Phase 5 (PS-6): results-ready SMS, after and apart from every release; a failure here never throws back.
    let resultsReady: unknown = null;
    try {
      const now = new Date();
      const { queued } = await enqueueResultsReady(now);
      const sender = createAfricasTalkingSender();
      resultsReady = { queued, ...(sender ? await sendResultsReady(now, sender) : { sent: 0 }) };
    } catch (e) {
      logger.error("cron.lab-escalations.results_ready_failed", {
        message: e instanceof Error ? e.message : String(e),
      });
    }
    return NextResponse.json({
      escalated,
      delivered: jobs.length - failed,
      failed,
      ipcEscalated,
      resultsReady,
    });
  } catch (e) {
    logger.error("cron.lab-escalations.failed", {
      message: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: "Escalation run failed; the read path still escalates." },
      { status: 500 },
    );
  }
}

export const POST = run;
export const GET = run;
