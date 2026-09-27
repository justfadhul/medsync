import type { QueueEntry } from "@/lib/emr/sync/queue";
import type { ActionResult } from "@/lib/emr/write/context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { backoffMs } from "@/app/nurse/resus/[episodeId]/_components/v2/desk-queue-model";
import {
  CLOCK_WARN_MS,
  clockWarning,
  correctedNow,
  initialClock,
  observe,
} from "@/lib/emr/sync/clock";
import {
  attachToWindow,
  bannerText,
  createWriteQueue,
  enqueue,
  guardUnload,
  MAX_ATTEMPTS,
  nextToSend,
  settle,
  toSendOutcome,
  wake,
} from "@/lib/emr/sync/queue";

/**
 * The EMR write queue and server clock (PROMPT §9): order, backoff, offline pause and flush,
 * coalesced autosave, the unload guard, and the round-trip-midpoint offset.
 */

const entry = (clientKey: string, over: Partial<QueueEntry> = {}): QueueEntry => ({
  clientKey,
  label: clientKey,
  coalesceKey: null,
  recordedAt: "2026-09-26T08:00:00.000Z",
  status: "pending",
  attempts: 0,
  error: null,
  notBeforeMs: 0,
  ...over,
});
const ok = (id: string): ActionResult => ({
  ok: true,
  id,
  serverTime: "2026-09-26T08:00:00.000Z",
});
const refused: ActionResult = { ok: false, code: "invalid", error: "Unit required." };

describe("the queue model (pure)", () => {
  it("sends in order, one at a time", () => {
    const q = [entry("a"), entry("b")];
    expect(nextToSend(q, 0, true)?.clientKey).toBe("a");
    expect(nextToSend([entry("a", { status: "sending" }), entry("b")], 0, true)).toBeNull();
  });

  it("offline pauses the queue", () => {
    expect(nextToSend([entry("a")], 0, false)).toBeNull();
  });

  it("a retryable failure backs off 1-2-4-8-10 s, and nothing overtakes it", () => {
    let q = [entry("a"), entry("b")];
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      q = settle(q, "a", { ok: false, error: "x", retry: true }, 1_000);
      waits.push(q[0]!.notBeforeMs - 1_000);
      expect(nextToSend(q, 1_000, true)).toBeNull(); // b waits behind a (order)
    }
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 10_000]);
    expect(waits).toEqual([0, 1, 2, 3, 4].map(backoffMs));
    expect(nextToSend(q, 11_000, true)?.clientKey).toBe("a");
  });

  it("after MAX_ATTEMPTS it parks as failed and the next entry goes", () => {
    let q = [entry("a"), entry("b")];
    for (let i = 0; i < MAX_ATTEMPTS; i++)
      q = settle(q, "a", { ok: false, error: "x", retry: true }, 0);
    expect(q[0]).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(nextToSend(q, 0, true)?.clientKey).toBe("b");
  });

  it("a server refusal is final at once; a save removes the entry", () => {
    const q = settle([entry("a")], "a", toSendOutcome(refused), 0);
    expect(q[0]).toMatchObject({ status: "failed", error: "Unit required.", attempts: 1 });
    expect(settle([entry("a")], "a", toSendOutcome(ok("id-1")), 0)).toEqual([]);
  });

  it("no reply at all is kept and retried", () => {
    expect(toSendOutcome(undefined)).toMatchObject({ ok: false, retry: true });
    expect(toSendOutcome(ok("x"))).toEqual({
      ok: true,
      id: "x",
      serverTime: "2026-09-26T08:00:00.000Z",
      warnings: [],
    });
  });

  it("back online skips the backoff", () => {
    const q = settle([entry("a")], "a", { ok: false, error: "x", retry: true }, 0);
    expect(nextToSend(q, 0, true)).toBeNull();
    expect(nextToSend(wake(q), 0, true)?.clientKey).toBe("a");
  });

  it("autosave coalesces: a newer save replaces an unsent one in place, never one on its way", () => {
    const q = enqueue(
      [entry("n1", { coalesceKey: "note" }), entry("v")],
      entry("n2", { coalesceKey: "note" }),
    );
    expect(q.map((e) => e.clientKey)).toEqual(["n2", "v"]);
    const busy = enqueue(
      [entry("n1", { coalesceKey: "note", status: "sending" })],
      entry("n2", { coalesceKey: "note" }),
    );
    expect(busy.map((e) => e.clientKey)).toEqual(["n1", "n2"]);
  });

  it("the unload guard and the banner", () => {
    expect(guardUnload([])).toBe(false);
    expect(guardUnload([entry("a", { status: "failed" })])).toBe(true);
    expect(bannerText([entry("a"), entry("b")], false)).toBe("Offline, 2 entries waiting");
    expect(bannerText([entry("a")], false)).toBe("Offline, 1 entry waiting");
    expect(bannerText([entry("a")], true)).toBeNull();
    expect(bannerText([entry("a", { status: "failed" })], true)).toBe(
      "1 not saved — retry or discard",
    );
    expect(bannerText([], false)).toBeNull();
  });
});

describe("the queue runner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-09-26T08:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  let n = 0;
  const keys = () => `k${++n}`;

  it("flushes queued entries in order on reconnect, each with its own client key", async () => {
    const sent: string[] = [];
    const q = createWriteQueue({ now: Date.now, online: false, newKey: keys });
    for (const label of ["bp", "pulse", "temp"])
      q.submit({
        label,
        run: async ({ clientKey }) => {
          sent.push(`${label}:${clientKey}`);
          return ok(clientKey);
        },
      });
    await vi.runAllTimersAsync();
    expect(sent).toEqual([]);
    expect(q.getSnapshot().map((e) => e.status)).toEqual(["pending", "pending", "pending"]);
    q.setOnline(true);
    await vi.runAllTimersAsync();
    expect(sent.map((s) => s.split(":")[0])).toEqual(["bp", "pulse", "temp"]);
    expect(q.getSnapshot()).toEqual([]);
  });

  it("retries a thrown write with the SAME client key after its backoff, then saves", async () => {
    const tries: string[] = [];
    let fail = 2;
    const q = createWriteQueue({ now: Date.now, newKey: keys });
    const saved = vi.fn();
    q.submit({
      label: "allergy",
      run: async ({ clientKey }) => {
        tries.push(clientKey);
        if (fail-- > 0) throw new Error("fetch failed");
        return ok("row");
      },
      onSaved: saved,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(tries).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(tries).toHaveLength(1); // still in its 1 s backoff
    await vi.advanceTimersByTimeAsync(1);
    expect(tries).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(tries).toHaveLength(3);
    expect(new Set(tries).size).toBe(1);
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ id: "row", warnings: [] }));
    expect(q.getSnapshot()).toEqual([]);
  });

  it("a write that never answers times out into a retry instead of holding the queue", async () => {
    let calls = 0;
    const q = createWriteQueue({ now: Date.now, newKey: keys, timeoutMs: 5_000 });
    q.submit({
      label: "slow",
      run: () => (++calls === 1 ? new Promise<ActionResult>(() => {}) : Promise.resolve(ok("x"))),
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(q.getSnapshot()[0]).toMatchObject({ status: "pending", attempts: 1 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(2);
    expect(q.getSnapshot()).toEqual([]);
  });

  it("a refusal parks with onFailed; Retry resends it; Discard drops it", async () => {
    const onFailed = vi.fn();
    let answer: ActionResult = refused;
    const q = createWriteQueue({ now: Date.now, newKey: keys });
    const key = q.submit({ label: "x", run: async () => answer, onFailed });
    await vi.advanceTimersByTimeAsync(0);
    expect(onFailed).toHaveBeenCalledWith("Unit required.");
    expect(q.getSnapshot()[0]?.status).toBe("failed");
    answer = ok("y");
    q.retry(key);
    await vi.advanceTimersByTimeAsync(0);
    expect(q.getSnapshot()).toEqual([]);

    answer = refused;
    const k2 = q.submit({ label: "z", run: async () => answer });
    await vi.advanceTimersByTimeAsync(0);
    expect(q.discard(k2)).toBe(true);
    expect(q.getSnapshot()).toEqual([]);
  });

  it("recordedAt is set once, at submit, from the corrected clock", async () => {
    const seen: string[] = [];
    const q = createWriteQueue({ now: () => Date.now() + 90_000, online: false, newKey: keys });
    q.submit({
      label: "obs",
      run: async ({ recordedAt }) => {
        seen.push(recordedAt);
        return ok("x");
      },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    q.setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual(["2026-09-26T08:01:30.000Z"]);
  });

  it("autosave while one save is on its way: sent after it, and older unsent drafts are dropped", async () => {
    const sent: string[] = [];
    let release: (() => void) | undefined;
    const q = createWriteQueue({ now: Date.now, newKey: keys });
    const save = (text: string) =>
      q.submit({
        label: "draft",
        coalesceKey: "note:1",
        run: () =>
          new Promise<ActionResult>((resolve) => {
            sent.push(text);
            if (text === "a") release = () => resolve(ok("n"));
            else resolve(ok("n"));
          }),
      });
    save("a");
    await vi.advanceTimersByTimeAsync(0);
    save("ab");
    save("abc");
    expect(q.getSnapshot().map((e) => e.status)).toEqual(["sending", "pending"]);
    release!();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual(["a", "abc"]);
  });

  it("the window wiring: offline/online drive it, beforeunload asks while anything is unsaved", async () => {
    const win = Object.assign(new EventTarget(), { navigator: { onLine: false } });
    const q = createWriteQueue({ now: Date.now, newKey: keys });
    const detach = attachToWindow(q, win as unknown as Parameters<typeof attachToWindow>[1]);
    const run = vi.fn(async () => ok("x"));
    q.submit({ label: "x", run });
    await vi.advanceTimersByTimeAsync(0);
    expect(run).not.toHaveBeenCalled();

    const unload = new Event("beforeunload", { cancelable: true });
    win.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    win.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledOnce();
    const after = new Event("beforeunload", { cancelable: true });
    win.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
    detach();
  });
});

describe("the server clock", () => {
  it("offset from the round-trip midpoint", () => {
    const c = observe(
      initialClock("2026-09-26T08:00:00.000Z", Date.parse("2026-09-26T08:00:00Z")),
      {
        t0: 1_000,
        t1: 1_400,
        serverTime: new Date(1_200 + 45_000).toISOString(),
      },
    );
    expect(c).toEqual({ offsetMs: 45_000, bestRttMs: 400 });
    expect(correctedNow(c, 10_000)).toBe(55_000);
    expect(clockWarning(c)).toBe(true);
  });

  it("the page's render time seeds it; any real sample replaces it", () => {
    const c = initialClock("2026-09-26T08:00:10.000Z", Date.parse("2026-09-26T08:00:00Z"));
    expect(c.offsetMs).toBe(10_000);
    expect(clockWarning(c)).toBe(false);
    expect(
      observe(c, { t0: 0, t1: 5_000, serverTime: new Date(2_500).toISOString() }).offsetMs,
    ).toBe(0);
  });

  it("a slow sample (past 2 s and twice the best) is ignored; a malformed one too", () => {
    const fast = observe(initialClock(new Date(0).toISOString(), 0), {
      t0: 0,
      t1: 300,
      serverTime: new Date(150 + 1_000).toISOString(),
    });
    const slow = observe(fast, { t0: 0, t1: 2_500, serverTime: new Date(99_999).toISOString() });
    expect(slow).toEqual(fast);
    expect(observe(fast, { t0: 0, t1: 100, serverTime: "not a time" })).toEqual(fast);
    expect(observe(fast, { t0: 10, t1: 5, serverTime: new Date(0).toISOString() })).toEqual(fast);
  });

  it("warns only past 30 s either way", () => {
    expect(clockWarning({ offsetMs: CLOCK_WARN_MS, bestRttMs: 1 })).toBe(false);
    expect(clockWarning({ offsetMs: -CLOCK_WARN_MS - 1, bestRttMs: 1 })).toBe(true);
  });
});
