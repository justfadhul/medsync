import type { NoteContent } from "@/lib/emr/note-rules";
import type { WriteQueue } from "@/lib/emr/sync/queue";
import type { ActionResult } from "@/lib/emr/write/context";

/**
 * The desk's flows, framework-free so they are tested with a fake clock and mocked actions
 * (tests/emr/ui/desk-flows.test.ts): autosave through the EMR write queue, sign, co-sign, addendum,
 * entered in error, complete and close. The client island wires these to the server actions and
 * renders their words; nothing here knows React.
 */

/* ─── Autosave ────────────────────────────────────────────────────── */

export interface DraftIds {
  noteId: string | null;
  revision: number | null;
}

export type SaveDraft = (input: {
  clientKey: string;
  noteId?: string;
  revision?: number;
  content: NoteContent;
}) => Promise<ActionResult<{ id: string; revision: number }>>;

export interface Autosave {
  /** Content changed: (re)start the debounce. Typing is never blocked. */
  change: (content: NoteContent) => void;
  /**
   * Content the viewer did not type (mirrored from the record on mount or refresh). Saved like a
   * change once a draft exists; before that it is held until the first edit or signing, so merely
   * opening someone's encounter (a senior reviewing) leaves no draft that only they could sign.
   */
  adopt: (content: NoteContent) => void;
  /** Submit what is waiting now (section change, tab hidden); `held` also sends adopted content (signing). */
  flush: (opts?: { held?: boolean }) => void;
  /** Content changed and not yet submitted. */
  dirty: () => boolean;
  ids: () => DraftIds;
  /** Resolves once nothing is waiting or on its way; rejects with the error if a save parked. */
  idle: () => Promise<void>;
  dispose: () => void;
}

/**
 * Note autosave (PROMPT §9): debounced, coalesced (only the newest unsent content is sent), sent
 * in order through the queue with the revision the server last returned (a different one is a
 * conflict: another tab or device). `onSaved` receives the round trip for the server clock.
 */
export function createAutosave(opts: {
  queue: WriteQueue;
  save: SaveDraft;
  debounceMs: number;
  initial: DraftIds;
  onSaved?: (r: { serverTime: string; t0: number; t1: number }) => void;
  onChange?: () => void;
}): Autosave {
  let ids: DraftIds = { ...opts.initial };
  let pending: NoteContent | null = null;
  let held: NoteContent | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (o?: { held?: boolean }) => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (o?.held) {
      pending ??= held;
      held = null;
    }
    if (!pending) return;
    const content = pending;
    pending = null;
    opts.queue.submit({
      label: "Note",
      coalesceKey: "note-draft",
      run: async ({ clientKey }) => {
        const r = await opts.save({
          clientKey,
          ...(ids.noteId ? { noteId: ids.noteId } : {}),
          ...(ids.revision !== null ? { revision: ids.revision } : {}),
          content,
        });
        // Monotonic: a late reply to a save the queue already timed out and resent must not roll
        // the revision back (every later save would then be refused as another tab's change).
        if (
          r.ok &&
          r.data &&
          (r.data.id !== ids.noteId || ids.revision === null || r.data.revision > ids.revision)
        )
          ids = { noteId: r.data.id, revision: r.data.revision };
        return r;
      },
      onSaved: (r) => opts.onSaved?.(r),
    });
    opts.onChange?.();
  };

  const change = (content: NoteContent) => {
    held = null;
    pending = content;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, opts.debounceMs);
    opts.onChange?.();
  };

  return {
    change,
    adopt(content) {
      // A draft exists, or the viewer's first edit is already on its way: save as usual.
      if (ids.noteId || pending) change(content);
      else held = content;
    },
    flush,
    dirty: () => pending !== null,
    ids: () => ids,
    idle() {
      return new Promise<void>((resolve, reject) => {
        const check = () => {
          const q = opts.queue.getSnapshot();
          const failed = q.find((e) => e.status === "failed");
          if (failed) {
            stop();
            reject(new Error(failed.error ?? "The note did not save."));
          } else if (q.length === 0 && pending === null) {
            stop();
            resolve();
          }
        };
        const stop = opts.queue.subscribe(check);
        check();
      });
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/* ─── Chart actions: one client key per intent ────────────────────── */

/** A chart action that threw (no reply): the server may have committed it. */
export const UNKNOWN_OUTCOME =
  "No response, so it may already be recorded. Try again: the same entry is never recorded twice.";

/**
 * Chart actions (vitals, diagnosis, problem, medicine, allergy, suggestion) commit at once, outside
 * the queue. The client key belongs to the intent, not the attempt: an attempt that got no reply
 * keeps its key, so tapping again with the same entry is a replay the server recognises, never a
 * second row. Any reply (saved or refused) closes the intent; a changed entry is a new intent.
 */
export function createIntentKeys(newKey: () => string) {
  const open = new Map<string, string>();
  return {
    async run<T>(intent: string, act: (clientKey: string) => Promise<T>): Promise<T> {
      const key = open.get(intent) ?? newKey();
      open.set(intent, key);
      const r = await act(key); // thrown: the key stays for the retry
      open.delete(intent);
      return r;
    },
  };
}

/* ─── Outcomes in words ───────────────────────────────────────────── */

export type FlowOutcome =
  | { ok: true; message: string; warnings: string[] }
  | { ok: false; message: string };

const done = (r: ActionResult<unknown>, message: string): FlowOutcome =>
  r.ok ? { ok: true, message, warnings: r.warnings ?? [] } : { ok: false, message: r.error };

const refuse = (message: string): FlowOutcome => ({ ok: false, message });

/* ─── Sign (1 tap + confirm; Ctrl/Cmd+Enter) ──────────────────────── */

export async function signFlow(deps: {
  autosave: Pick<Autosave, "flush" | "idle" | "ids">;
  sign: (input: { noteId: string; revision?: number }) => Promise<ActionResult<unknown>>;
}): Promise<FlowOutcome> {
  deps.autosave.flush({ held: true });
  try {
    await deps.autosave.idle();
  } catch (e) {
    return refuse(`The note is not saved yet, so it cannot be signed: ${(e as Error).message}`);
  }
  const { noteId, revision } = deps.autosave.ids();
  if (!noteId) return refuse("Nothing is written yet: add the presenting complaint first.");
  const r = await deps.sign({ noteId, ...(revision !== null ? { revision } : {}) });
  if (!r.ok) return refuse(r.error);
  const awaiting = (r.warnings ?? []).some((w) => w.includes("awaiting co-signature"));
  return {
    ok: true,
    message: awaiting
      ? "Note signed. It awaits co-signature; your orders are not held."
      : "Note signed",
    warnings: (r.warnings ?? []).filter((w) => !w.includes("awaiting co-signature")),
  };
}

/* ─── Co-sign, addendum, entered in error ─────────────────────────── */

export async function cosignFlow(
  cosign: () => Promise<ActionResult<unknown>>,
): Promise<FlowOutcome> {
  return done(await cosign(), "Note co-signed");
}

export async function addendumFlow(
  add: (input: { text: string; reason: string }) => Promise<ActionResult<unknown>>,
  input: { text: string; reason: string },
): Promise<FlowOutcome> {
  const text = input.text.trim();
  const reason = input.reason.trim();
  if (!text) return refuse("Write the addendum.");
  if (!reason) return refuse("Say why the addendum is added.");
  return done(await add({ text, reason }), "Addendum added");
}

export async function enteredInErrorFlow(
  mark: (input: { reasonCode: string; reasonText?: string }) => Promise<ActionResult<unknown>>,
  input: { reasonCode: string | null; reasonText: string },
): Promise<FlowOutcome> {
  if (!input.reasonCode) return refuse("Choose why the note is entered in error.");
  const text = input.reasonText.trim();
  if (input.reasonCode === "other" && !text) return refuse("Describe the reason.");
  return done(
    await mark({ reasonCode: input.reasonCode, ...(text ? { reasonText: text } : {}) }),
    "Marked entered in error",
  );
}

/* ─── Complete, close ─────────────────────────────────────────────── */

export type FollowUpChoice = "none" | "as_needed" | "review_date";

export async function completeFlow(
  complete: (input: {
    disposition: string;
    followUp?: { kind: "none" } | { kind: "as_needed" } | { kind: "review_date"; date: string };
  }) => Promise<ActionResult<unknown>>,
  input: { disposition: string | null; followUp: FollowUpChoice | null; reviewDate: string },
): Promise<FlowOutcome> {
  if (!input.disposition) return refuse("Choose a disposition to complete the visit.");
  if (input.followUp === "review_date" && !/^\d{4}-\d{2}-\d{2}$/.test(input.reviewDate))
    return refuse("Choose the review date.");
  const followUp =
    input.followUp === "review_date"
      ? { kind: "review_date" as const, date: input.reviewDate }
      : input.followUp
        ? { kind: input.followUp }
        : undefined;
  return done(
    await complete({ disposition: input.disposition, ...(followUp ? { followUp } : {}) }),
    "Visit completed",
  );
}

export async function closeFlow(
  close: (input: { reason: string; note?: string }) => Promise<ActionResult<unknown>>,
  input: { reason: string | null; note: string },
): Promise<FlowOutcome> {
  if (!input.reason) return refuse("Choose why the encounter is closed.");
  const note = input.note.trim();
  if (input.reason === "other" && !note) return refuse("Describe the reason.");
  return done(await close({ reason: input.reason, ...(note ? { note } : {}) }), "Encounter closed");
}
