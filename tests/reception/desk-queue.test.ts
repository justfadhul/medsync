/**
 * ADR 0488 / D-RD-28: offline check-ins wait encrypted, replay identity-then-check-in, keep on network failure,
 * and report a refused identity instead of checking the person in.
 */
import "fake-indexeddb/auto";

import type { DeskPort } from "@/components/reception/port";
import type { DeskRow } from "@/lib/reception/desk/model";
import { describe, expect, it, vi } from "vitest";

import { offlineQueue, readQueue } from "@/lib/reception/desk/queue";

const row = (id: string, name: string) => ({ id, name, appointmentId: id }) as DeskRow;

function server(match: Record<string, string>) {
  const checkIn = vi.fn(async (_r: DeskRow, _route: string, _id: string) => ({
    ok: true as const,
  }));
  const port = {
    identityCheck: vi.fn(async (r: DeskRow, _m: string, a: string) => ({
      ok: true as const,
      matched: match[r.id] === a,
      next: null,
    })),
    checkIn,
    undoCheckIn: vi.fn(),
  } as unknown as DeskPort;
  return { port, checkIn };
}

describe("offline check-in queue", () => {
  it("queues offline, then replays identity before check-in", async () => {
    let off = true;
    const { port, checkIn } = server({ a: "1980", b: "1975" });
    const q = offlineQueue(port, () => off);

    for (const [r, yob] of [
      [row("a", "Asha Test"), "1980"],
      [row("b", "Bena Test"), "1999"],
    ] as const) {
      expect(await q.identityCheck(r, "yob", yob)).toMatchObject({ ok: true, matched: true });
      expect(await q.checkIn(r, "triage", `c-${r.id}`)).toEqual({ ok: true });
    }
    expect(checkIn).not.toHaveBeenCalled();
    expect(await readQueue()).toHaveLength(2);

    off = false;
    expect(await q.drain()).toEqual({ sent: 1, refused: ["Bena Test"] });
    expect(checkIn).toHaveBeenCalledTimes(1);
    expect(await readQueue()).toHaveLength(0);
  });

  it("keeps an item when the network is still down", async () => {
    const { port } = server({});
    (port.identityCheck as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new TypeError("fetch"));
    const q = offlineQueue(port, () => true);
    await q.identityCheck(row("c", "Cato Test"), "yob", "1990");
    await q.checkIn(row("c", "Cato Test"), "clinic", "c-c");
    expect(await q.drain()).toEqual({ sent: 0, refused: [] });
    expect(await readQueue()).toHaveLength(1);
  });

  it("S22: three check-ins queue, survive a reload, sync once, no duplicates", async () => {
    await offlineQueue(server({}).port, () => false).drain(); // empty what earlier tests left
    const before = offlineQueue(server({}).port, () => true);
    for (const id of ["e", "f", "g"]) {
      await before.identityCheck(row(id, `${id} Test`), "yob", "1985");
      await before.checkIn(row(id, `${id} Test`), "triage", `c-${id}`);
    }
    // A reload: a new page, a new wrapper, the same IndexedDB.
    const { port, checkIn } = server({ e: "1985", f: "1985", g: "1985" });
    const after = offlineQueue(port, () => false);
    const [a, b] = await Promise.all([after.drain(), after.drain()]);
    expect(a).toEqual({ sent: 3, refused: [] });
    expect(b).toBe(a); // one drain at a time: the second call shares the first
    expect(await after.drain()).toEqual({ sent: 0, refused: [] });
    expect(checkIn.mock.calls.map((c) => c[2])).toEqual(["c-e", "c-f", "c-g"]);
  });

  it("refuses an offline check-in with no identity answer", async () => {
    const q = offlineQueue(server({}).port, () => true);
    expect(await q.checkIn(row("d", "Dido Test"), "triage", "c-d")).toMatchObject({ ok: false });
  });
});
