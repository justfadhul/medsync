import type { ActionResult } from "@/lib/emr/write/context";

// The resus desk's own backoff (1-2-4-8-10 s) and write timeout: one feel for both desks.
import {
  backoffMs,
  WRITE_TIMEOUT_MS,
} from "@/app/nurse/resus/[episodeId]/_components/v2/desk-queue-model";

/*
 * The EMR write queue (PROMPT §9), modelled on the resus v2 desk queue
 * (desk-queue-model.ts + use-desk-queue.ts), not forked from it: those are typed
 * to the resus timeline, this carries EMR structured entries and note autosaves.
 *
 * - An entry renders at once as pending; it is sent in order, one at a time.
 * - A retryable failure waits out its backoff; after MAX_ATTEMPTS it parks as
 *   failed (Retry / Discard) instead of spinning silently.
 * - Offline, nothing is sent; back online, backoff is skipped and the queue flushes.
 * - The server is idempotent on the client key, so a resend never doubles a row.
 * - Note autosave passes a `coalesceKey`: a newer save replaces an unsent older
 *   one (latest content wins; each save carries its own client key).
 *
 * The first half is pure (tested in tests/emr/sync.test.ts); `createWriteQueue`
 * runs it, framework-free, so a page wraps it with useSyncExternalStore.
 */

export type EntryStatus = "pending" | "sending" | "failed";

export interface QueueEntry {
  clientKey: string;
  label: string;
  coalesceKey: string | null;
  /** The server-anchored time the entry was made (effective times use the corrected clock). */
  recordedAt: string;
  status: EntryStatus;
  attempts: number;
  error: string | null;
  /** Device time before which a retry is not sent (its backoff). */
  notBeforeMs: number;
}

export type SendOutcome =
  | { ok: true; id: string; serverTime: string; warnings: string[] }
  | { ok: false; error: string; retry: boolean };

/** About a minute at the 10 s backoff cap, as the resus desk. */
export const MAX_ATTEMPTS = 6;
export { WRITE_TIMEOUT_MS };

const NO_CONNECTION = "No connection — the entry is kept and will retry.";
const TIMED_OUT = "No response — the entry is kept and will retry.";

/**
 * An EMR ActionResult as a queue outcome. A refusal the server gave (invalid, forbidden,
 * conflict, not found, config) is final — resending the same entry cannot change it. Anything
 * else (a thrown action, a dropped connection, a malformed reply) is kept and retried.
 */
export function toSendOutcome(r: ActionResult<unknown> | null | undefined): SendOutcome {
  if (r?.ok === true)
    return { ok: true, id: r.id, serverTime: r.serverTime, warnings: r.warnings ?? [] };
  if (r?.ok === false) return { ok: false, error: r.error, retry: false };
  return { ok: false, error: NO_CONNECTION, retry: true };
}

/** Add an entry; one with the same coalesceKey that is still unsent is replaced in place. */
export function enqueue(q: readonly QueueEntry[], e: QueueEntry): QueueEntry[] {
  if (e.coalesceKey) {
    const i = q.findIndex((x) => x.coalesceKey === e.coalesceKey && x.status !== "sending");
    if (i >= 0) return q.map((x, j) => (j === i ? e : x));
  }
  return [...q, e];
}

/** The next entry to send: the first pending one, once its backoff is over — none while one is on
 *  its way (strict order) or while offline. Parked (failed) entries wait for Retry or Discard. */
export function nextToSend(
  q: readonly QueueEntry[],
  nowMs: number,
  online: boolean,
): QueueEntry | null {
  if (!online || q.some((e) => e.status === "sending")) return null;
  const head = q.find((e) => e.status === "pending");
  return head && head.notBeforeMs <= nowMs ? head : null;
}

/** Apply what the server said about one entry. */
export function settle(
  q: readonly QueueEntry[],
  clientKey: string,
  outcome: SendOutcome,
  nowMs: number,
): QueueEntry[] {
  if (outcome.ok) return q.filter((e) => e.clientKey !== clientKey);
  return q.map((e) => {
    if (e.clientKey !== clientKey) return e;
    const attempts = e.attempts + 1;
    const again = outcome.retry && attempts < MAX_ATTEMPTS;
    return {
      ...e,
      attempts,
      error: outcome.error,
      status: again ? "pending" : "failed",
      notBeforeMs: again ? nowMs + backoffMs(attempts - 1) : e.notBeforeMs,
    };
  });
}

export const mark = (q: readonly QueueEntry[], clientKey: string, p: Partial<QueueEntry>) =>
  q.map((e) => (e.clientKey === clientKey ? { ...e, ...p } : e));

/** Back online (or Retry): send now, skipping any backoff. */
export const wake = (q: readonly QueueEntry[]) =>
  q.map((e) => (e.status === "pending" ? { ...e, notBeforeMs: 0 } : e));

/** Anything not yet saved (pending, on its way, or parked) keeps the tab from closing silently. */
export const guardUnload = (q: readonly QueueEntry[]) => q.length > 0;

/** The amber banner: "Offline, N entries waiting" (PROMPT §9); null when there is nothing to say. */
export function bannerText(q: readonly QueueEntry[], online: boolean): string | null {
  const n = q.length;
  if (n === 0) return null;
  const entries = `${n} ${n === 1 ? "entry" : "entries"}`;
  if (!online) return `Offline, ${entries} waiting`;
  const failed = q.filter((e) => e.status === "failed").length;
  return failed > 0 ? `${failed} not saved — retry or discard` : null;
}

/* ─── The runner ──────────────────────────────────────────────────── */

export interface WriteSpec<T = unknown> {
  label: string;
  coalesceKey?: string;
  /** `recordedAt` is the server-anchored time set once at submit: pass it to the action. */
  run: (ctx: { clientKey: string; recordedAt: string }) => Promise<ActionResult<T>>;
  /** Saved. `t0`/`t1` bracket the round trip, so the server clock can take a sample. */
  onSaved?: (r: {
    id: string;
    serverTime: string;
    warnings: string[];
    t0: number;
    t1: number;
  }) => void;
  onFailed?: (error: string) => void;
}

export interface WriteQueue {
  submit: (spec: WriteSpec) => string;
  retry: (clientKey: string) => void;
  /** False while the entry is on its way: it may already be saved. */
  discard: (clientKey: string) => boolean;
  setOnline: (online: boolean) => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => readonly QueueEntry[];
}

export function createWriteQueue(opts: {
  /** The corrected (server-anchored) clock, for `recordedAt`. */
  now: () => number;
  online?: boolean;
  newKey?: () => string;
  timeoutMs?: number;
}): WriteQueue {
  let entries: readonly QueueEntry[] = [];
  let online = opts.online ?? true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const specs = new Map<string, WriteSpec>();
  const listeners = new Set<() => void>();
  const newKey = opts.newKey ?? (() => crypto.randomUUID());
  const timeoutMs = opts.timeoutMs ?? WRITE_TIMEOUT_MS;

  const set = (next: readonly QueueEntry[]) => {
    entries = next;
    for (const l of listeners) l();
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const head = entries.find((e) => e.status === "pending");
    if (!online || !head || entries.some((e) => e.status === "sending")) return;
    timer = setTimeout(() => void flush(), Math.max(0, head.notBeforeMs - Date.now()));
  };

  async function flush(): Promise<void> {
    const next = nextToSend(entries, Date.now(), online);
    if (!next) return schedule();
    const spec = specs.get(next.clientKey)!;
    set(mark(entries, next.clientKey, { status: "sending" }));
    const t0 = Date.now();
    let outcome: SendOutcome;
    try {
      let t: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<SendOutcome>((resolve) => {
        t = setTimeout(() => resolve({ ok: false, error: TIMED_OUT, retry: true }), timeoutMs);
      });
      outcome = await Promise.race([
        spec.run({ clientKey: next.clientKey, recordedAt: next.recordedAt }).then(toSendOutcome),
        timeout,
      ]).finally(() => clearTimeout(t));
    } catch {
      outcome = toSendOutcome(null);
    }
    const t1 = Date.now();
    set(settle(entries, next.clientKey, outcome, t1));
    if (outcome.ok) {
      specs.delete(next.clientKey);
      spec.onSaved?.({ ...outcome, t0, t1 });
    } else if (!entries.some((e) => e.clientKey === next.clientKey && e.status === "pending")) {
      spec.onFailed?.(outcome.error);
    }
    return flush();
  }

  return {
    submit(spec) {
      const clientKey = newKey();
      const replaced = spec.coalesceKey
        ? entries.find((e) => e.coalesceKey === spec.coalesceKey && e.status !== "sending")
        : undefined;
      if (replaced) specs.delete(replaced.clientKey);
      specs.set(clientKey, spec);
      set(
        enqueue(entries, {
          clientKey,
          label: spec.label,
          coalesceKey: spec.coalesceKey ?? null,
          recordedAt: new Date(opts.now()).toISOString(),
          status: "pending",
          attempts: 0,
          error: null,
          notBeforeMs: 0,
        }),
      );
      void flush();
      return clientKey;
    },
    retry(clientKey) {
      set(
        entries.map((e) =>
          e.clientKey === clientKey && e.status === "failed"
            ? { ...e, status: "pending" as const, attempts: 0, error: null, notBeforeMs: 0 }
            : e,
        ),
      );
      void flush();
    },
    discard(clientKey) {
      const e = entries.find((x) => x.clientKey === clientKey);
      if (!e || e.status === "sending") return false;
      specs.delete(clientKey);
      set(entries.filter((x) => x.clientKey !== clientKey));
      schedule();
      return true;
    },
    setOnline(next) {
      online = next;
      if (online) {
        set(wake(entries));
        void flush();
      } else schedule();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => entries,
  };
}

/**
 * Wire a queue to the browser: online/offline drive it, and `beforeunload` asks before a tab
 * with unsaved entries closes. Returns the detach function (a page's effect cleanup).
 */
export function attachToWindow(
  queue: WriteQueue,
  win: Pick<Window, "addEventListener" | "removeEventListener"> & {
    navigator: { onLine: boolean };
  },
): () => void {
  const online = () => queue.setOnline(true);
  const offline = () => queue.setOnline(false);
  const unload = (e: Event) => {
    if (!guardUnload(queue.getSnapshot())) return;
    e.preventDefault();
    // Older browsers read returnValue.
    (e as BeforeUnloadEvent).returnValue = "";
  };
  queue.setOnline(win.navigator.onLine);
  win.addEventListener("online", online);
  win.addEventListener("offline", offline);
  win.addEventListener("beforeunload", unload);
  return () => {
    win.removeEventListener("online", online);
    win.removeEventListener("offline", offline);
    win.removeEventListener("beforeunload", unload);
  };
}
