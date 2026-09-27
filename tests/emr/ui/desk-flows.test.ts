import type { SaveDraft } from "@/components/emr/desk/flows";
import type { NoteContent } from "@/lib/emr/note-rules";
import type { ActionResult } from "@/lib/emr/write/context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addendumFlow,
  closeFlow,
  completeFlow,
  cosignFlow,
  createAutosave,
  createIntentKeys,
  enteredInErrorFlow,
  signFlow,
} from "@/components/emr/desk/flows";
import { setNarrative } from "@/components/emr/desk/model";
import { createWriteQueue } from "@/lib/emr/sync/queue";

/**
 * The desk's flows against a fake clock and mocked server actions: autosave through the EMR write
 * queue (debounce, coalescing, revisions, offline, conflict), then sign, co-sign, addendum,
 * entered in error, complete and close.
 */

const T = "2026-09-20T10:42:00.000Z";
const ok = <D>(data?: D, warnings?: string[]): ActionResult<D> => ({
  ok: true,
  id: "n1",
  serverTime: T,
  ...(data !== undefined ? { data } : {}),
  ...(warnings ? { warnings } : {}),
});
const fail = (error: string, code: "conflict" | "invalid" = "invalid"): ActionResult<never> => ({
  ok: false,
  code,
  error,
});
const text = (s: string): NoteContent => setNarrative({ sections: {} }, "s02", s);

function rig(
  save: SaveDraft,
  initial = { noteId: null as string | null, revision: null as number | null },
) {
  const queue = createWriteQueue({
    now: () => Date.now(),
    newKey: (() => {
      let n = 0;
      return () => `key-${++n}`;
    })(),
  });
  const saved: string[] = [];
  const autosave = createAutosave({
    queue,
    save,
    debounceMs: 1500,
    initial,
    onSaved: (r) => saved.push(r.serverTime),
  });
  return { queue, autosave, saved };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(T));
});
afterEach(() => vi.useRealTimers());

describe("autosave through the write queue (PROMPT §9)", () => {
  it("waits out the debounce and never sends while typing continues", async () => {
    const save = vi.fn<SaveDraft>(async () => ok({ id: "n1", revision: 1 }));
    const { autosave } = rig(save);
    autosave.change(text("F"));
    await vi.advanceTimersByTimeAsync(1000);
    autosave.change(text("Fe"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
    expect(autosave.dirty()).toBe(true);
    await vi.advanceTimersByTimeAsync(600);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].content).toEqual(text("Fe"));
    expect(autosave.dirty()).toBe(false);
  });

  it("chains the note id and revision the server returned into the next save", async () => {
    let rev = 0;
    const save = vi.fn<SaveDraft>(async () => ok({ id: "n1", revision: ++rev }));
    const { autosave, saved } = rig(save);
    autosave.change(text("one"));
    autosave.flush();
    await vi.advanceTimersByTimeAsync(0);
    autosave.change(text("two"));
    autosave.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(save.mock.calls[0]![0]).not.toHaveProperty("noteId");
    expect(save.mock.calls[1]![0]).toMatchObject({ noteId: "n1", revision: 1 });
    expect(autosave.ids()).toEqual({ noteId: "n1", revision: 2 });
    expect(saved).toEqual([T, T]);
  });

  it("offline: nothing is sent, the newest content replaces the unsent older one, and it flushes on reconnect", async () => {
    const save = vi.fn<SaveDraft>(async () => ok({ id: "n1", revision: 1 }));
    const { autosave, queue } = rig(save, { noteId: "n1", revision: 0 });
    queue.setOnline(false);
    autosave.change(text("a"));
    autosave.flush();
    autosave.change(text("ab"));
    autosave.flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(save).not.toHaveBeenCalled();
    expect(queue.getSnapshot()).toHaveLength(1);
    queue.setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].content).toEqual(text("ab"));
    expect(queue.getSnapshot()).toEqual([]);
  });

  it("a dropped connection is retried with backoff and the same client key; nothing is lost", async () => {
    const save = vi
      .fn<SaveDraft>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(ok({ id: "n1", revision: 1 }));
    const { autosave, queue } = rig(save);
    autosave.change(text("kept"));
    autosave.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.getSnapshot()[0]).toMatchObject({ status: "pending", attempts: 1 });
    await vi.advanceTimersByTimeAsync(1100);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0].clientKey).toBe(save.mock.calls[0]![0].clientKey);
    expect(queue.getSnapshot()).toEqual([]);
  });

  it("a conflict (another tab) parks the save and idle() rejects with the server's words", async () => {
    const save = vi.fn<SaveDraft>(async () =>
      fail(
        "This note was changed in another tab or device. Reload to see the latest version.",
        "conflict",
      ),
    );
    const { autosave, queue } = rig(save, { noteId: "n1", revision: 3 });
    autosave.change(text("x"));
    autosave.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.getSnapshot()[0]!.status).toBe("failed");
    await expect(autosave.idle()).rejects.toThrow(/another tab/);
  });

  it("a late reply to a save the queue timed out and resent never rolls the revision back", async () => {
    let late!: (r: ActionResult<{ id: string; revision: number }>) => void;
    let rev = 0;
    const save = vi
      .fn<SaveDraft>()
      .mockImplementationOnce(() => new Promise((res) => (late = res)))
      .mockImplementation(async () => ok({ id: "n1", revision: ++rev }));
    const { autosave } = rig(save, { noteId: "n1", revision: 0 });
    autosave.change(text("a"));
    autosave.flush();
    await vi.advanceTimersByTimeAsync(15_000 + 1_100); // timed out, backed off, resent: rev 1
    autosave.change(text("ab"));
    autosave.flush();
    await vi.advanceTimersByTimeAsync(0); // rev 2
    expect(autosave.ids()).toEqual({ noteId: "n1", revision: 2 });
    late(ok({ id: "n1", revision: 1 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(autosave.ids()).toEqual({ noteId: "n1", revision: 2 });
    autosave.change(text("abc"));
    autosave.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(save.mock.lastCall![0]).toMatchObject({ revision: 2 });
  });

  it("content mirrored on open is not saved until the viewer edits or signs (no stray draft)", async () => {
    const save = vi.fn<SaveDraft>(async () => ok({ id: "n1", revision: 1 }));
    const { autosave } = rig(save);
    autosave.adopt(text("from triage"));
    autosave.flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).not.toHaveBeenCalled();
    expect(autosave.dirty()).toBe(false);
    const r = signFlow({ autosave, sign: async () => ok() });
    await vi.advanceTimersByTimeAsync(0);
    expect((await r).ok).toBe(true);
    expect(save.mock.calls[0]![0].content).toEqual(text("from triage"));
    // Once a draft exists, mirrored content saves like any change.
    autosave.adopt(text("from triage, dx"));
    await vi.advanceTimersByTimeAsync(1500);
    expect(save).toHaveBeenCalledTimes(2);
  });
});

describe("chart actions: one client key per intent", () => {
  it("a retry after no reply reuses the key (the server replays it); a reply or a changed entry gets a new one", async () => {
    let n = 0;
    const intents = createIntentKeys(() => `k${++n}`);
    const keys: string[] = [];
    const drop = async (k: string) => {
      keys.push(k);
      throw new Error("network");
    };
    const land = async (k: string) => (keys.push(k), ok());
    await expect(intents.run('vitals:[{"v":"120"}]', drop)).rejects.toThrow();
    await intents.run('vitals:[{"v":"120"}]', land);
    await intents.run('vitals:[{"v":"120"}]', land); // a new reading, taken again
    await expect(intents.run('vitals:[{"v":"121"}]', drop)).rejects.toThrow();
    expect(keys).toEqual(["k1", "k1", "k2", "k3"]);
  });
});

describe("sign (1 tap + confirm)", () => {
  it("flushes the autosave first, then signs the saved revision", async () => {
    const order: string[] = [];
    const save = vi.fn<SaveDraft>(async () => {
      order.push("save");
      return ok({ id: "n1", revision: 5 });
    });
    const { autosave } = rig(save);
    autosave.change(text("final words"));
    const sign = vi.fn(async (i: { noteId: string; revision?: number }) => {
      order.push(`sign:${i.noteId}:${i.revision}`);
      return ok();
    });
    const r = signFlow({ autosave, sign });
    await vi.advanceTimersByTimeAsync(0);
    expect(await r).toEqual({ ok: true, message: "Note signed", warnings: [] });
    expect(order).toEqual(["save", "sign:n1:5"]);
  });

  it("an intern's signature says it awaits co-signature and that orders are not held", async () => {
    const { autosave } = rig(vi.fn<SaveDraft>(), { noteId: "n1", revision: 2 });
    const r = await signFlow({
      autosave,
      sign: async () =>
        ok(undefined, [
          "Signed, awaiting co-signature. Care continues meanwhile.",
          "No examination recorded.",
        ]),
    });
    expect(r).toEqual({
      ok: true,
      message: "Note signed. It awaits co-signature; your orders are not held.",
      warnings: ["No examination recorded."],
    });
  });

  it("refuses with words when nothing is saved yet, or when the save parked", async () => {
    const { autosave } = rig(vi.fn<SaveDraft>());
    expect(await signFlow({ autosave, sign: vi.fn() })).toEqual({
      ok: false,
      message: "Nothing is written yet: add the presenting complaint first.",
    });
    const parked = rig(
      vi.fn<SaveDraft>(async () => fail("Reload.", "conflict")),
      { noteId: "n1", revision: 1 },
    );
    parked.autosave.change(text("x"));
    const sign = vi.fn();
    const r = signFlow({ autosave: parked.autosave, sign });
    await vi.advanceTimersByTimeAsync(0);
    expect((await r).ok).toBe(false);
    expect(sign).not.toHaveBeenCalled();
  });

  it("a server refusal (the key not set) is shown as said; the draft is kept", async () => {
    const { autosave } = rig(vi.fn<SaveDraft>(), { noteId: "n1", revision: 1 });
    const r = await signFlow({
      autosave,
      sign: async () =>
        fail("Notes cannot be signed yet: the signing key is not set. Your draft is kept."),
    });
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/draft is kept/) });
  });
});

describe("co-sign, addendum, entered in error", () => {
  it("co-sign repeats the verb", async () => {
    expect(await cosignFlow(async () => ok())).toMatchObject({
      ok: true,
      message: "Note co-signed",
    });
    expect(
      await cosignFlow(async () => fail("Cannot co-sign: the author cannot co-sign.")),
    ).toEqual({
      ok: false,
      message: "Cannot co-sign: the author cannot co-sign.",
    });
  });
  it("an addendum needs its text and its reason", async () => {
    const add = vi.fn(async () => ok());
    expect((await addendumFlow(add, { text: " ", reason: "late result" })).ok).toBe(false);
    expect((await addendumFlow(add, { text: "Result reviewed", reason: "" })).ok).toBe(false);
    expect(add).not.toHaveBeenCalled();
    expect(
      await addendumFlow(add, { text: " Result reviewed ", reason: "late result" }),
    ).toMatchObject({
      ok: true,
      message: "Addendum added",
    });
    expect(add).toHaveBeenCalledWith({ text: "Result reviewed", reason: "late result" });
  });
  it("entered in error needs a reason chip, and words for Other", async () => {
    const mark = vi.fn(async () => ok());
    expect((await enteredInErrorFlow(mark, { reasonCode: null, reasonText: "" })).ok).toBe(false);
    expect((await enteredInErrorFlow(mark, { reasonCode: "other", reasonText: " " })).ok).toBe(
      false,
    );
    expect(
      await enteredInErrorFlow(mark, { reasonCode: "wrong_patient", reasonText: "" }),
    ).toMatchObject({
      ok: true,
      message: "Marked entered in error",
    });
    expect(mark).toHaveBeenCalledWith({ reasonCode: "wrong_patient" });
  });
});

describe("complete visit and administrative closure (PROMPT §5.10)", () => {
  it("a disposition is required; nothing is sent without one", async () => {
    const complete = vi.fn(async () => ok());
    const r = await completeFlow(complete, { disposition: null, followUp: null, reviewDate: "" });
    expect(r).toEqual({ ok: false, message: "Choose a disposition to complete the visit." });
    expect(complete).not.toHaveBeenCalled();
  });
  it("home, follow-up as needed; the warnings come back and do not block", async () => {
    const complete = vi.fn(async () => ok(undefined, ["1 order not yet collected."]));
    const r = await completeFlow(complete, {
      disposition: "home",
      followUp: "as_needed",
      reviewDate: "",
    });
    expect(complete).toHaveBeenCalledWith({ disposition: "home", followUp: { kind: "as_needed" } });
    expect(r).toEqual({
      ok: true,
      message: "Visit completed",
      warnings: ["1 order not yet collected."],
    });
  });
  it("a review date must be a date", async () => {
    const complete = vi.fn(async () => ok());
    expect(
      (
        await completeFlow(complete, {
          disposition: "home",
          followUp: "review_date",
          reviewDate: "",
        })
      ).ok,
    ).toBe(false);
    await completeFlow(complete, {
      disposition: "died",
      followUp: "review_date",
      reviewDate: "2026-10-03",
    });
    expect(complete).toHaveBeenCalledWith({
      disposition: "died",
      followUp: { kind: "review_date", date: "2026-10-03" },
    });
  });
  it("closing without completing needs a reason, and words for Other", async () => {
    const close = vi.fn(async () => ok());
    expect((await closeFlow(close, { reason: null, note: "" })).ok).toBe(false);
    expect((await closeFlow(close, { reason: "other", note: "" })).ok).toBe(false);
    expect(await closeFlow(close, { reason: "duplicate_encounter", note: "" })).toMatchObject({
      ok: true,
      message: "Encounter closed",
    });
    expect(close).toHaveBeenCalledWith({ reason: "duplicate_encounter" });
  });
});
