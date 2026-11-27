/**
 * The care-request run on the lab's one-minute tick (Task 23): its count is in the JSON, and its failure
 * is logged by name and never fails the lab run.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const runCare = vi.fn();
const logError = vi.fn();

vi.mock("@/db", () => ({ db: { transaction: async (fn: (tx: unknown) => unknown) => fn({}) } }));
vi.mock("@/lib/env", () => ({ env: { CRON_SECRET: "tick-secret" } }));
vi.mock("@/lib/channels/webhook-auth", () => ({
  secretMatches: (a: string, b: string) => a === b,
}));
vi.mock("@/lib/lab/criticals/store", () => ({
  runEscalations: async () => ({ escalated: 2, jobs: [] }),
  deliverAfterCommit: async () => ({ failed: 0 }),
}));
vi.mock("@/lib/ipc/store", () => ({ escalateIpcAlerts: async () => 0 }));
vi.mock("@/lib/notifications/africastalking", () => ({ createAfricasTalkingSender: () => null }));
vi.mock("@/lib/notify/results-ready-store", () => ({
  enqueueResultsReady: async () => ({ queued: 0 }),
  sendResultsReady: async () => ({ sent: 0 }),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: logError, warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/requests/escalation-run", () => ({
  runCareRequestEscalations: runCare,
  errorCode: (e: { code?: string }) => e.code,
}));

const tick = async () => {
  const { POST } = await import("@/app/api/cron/lab-escalations/route");
  const res = await POST(
    new Request("http://x/api/cron/lab-escalations", {
      method: "POST",
      headers: { authorization: "Bearer tick-secret" },
    }),
  );
  return { status: res.status, body: await res.json() };
};

describe("care requests on the lab escalation tick", () => {
  beforeEach(() => {
    runCare.mockReset();
    logError.mockReset();
  });

  it("runs as the scheduler and reports its count", async () => {
    runCare.mockResolvedValue({ escalated: 3 });
    const r = await tick();
    expect(r).toMatchObject({ status: 200, body: { escalated: 2, careRequestsEscalated: 3 } });
    expect(runCare).toHaveBeenCalledWith(expect.anything(), {
      now: expect.any(Date),
      source: "scheduler",
    });
  });

  it("a care-request failure is logged by name and the lab run still succeeds", async () => {
    runCare.mockRejectedValue(Object.assign(new TypeError("patient Jane Doe"), { code: "42P01" }));
    const r = await tick();
    expect(r).toMatchObject({ status: 200, body: { escalated: 2, careRequestsEscalated: null } });
    expect(logError).toHaveBeenCalledWith("cron.lab-escalations.care_requests_failed", {
      reason: "TypeError",
      code: "42P01",
    });
  });
});
