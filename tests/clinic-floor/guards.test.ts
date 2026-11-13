/**
 * Clinic floor guards (prompt Step 8): S10 no vital-sign threshold outside the engine; S3 the waiting-room screen
 * gets codes and rooms only; S5 shortcuts pause while typing and in dialogs; copy lives in content, never in the
 * components; red only for emergencies; S27 offline triage waits sealed and replays.
 */
import "fake-indexeddb/auto";

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FloorPort } from "@/components/clinic-floor/port";
import { describe, expect, it, vi } from "vitest";

import { floorKey, toVisit } from "@/components/clinic-floor/shared";
import { busyMorning } from "@/lib/clinic-floor/fixture";
import { doctorStates, projectFloor, screenFeed } from "@/lib/clinic-floor/model";
import { floorOffline } from "@/lib/clinic-floor/queue";

const DIR = "components/clinic-floor";
const src = readdirSync(DIR)
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => [f, readFileSync(join(DIR, f), "utf8")] as const);

describe("clinic floor guards", () => {
  it("S10: no vital-sign number is compared outside the engine", () => {
    const vital =
      /(spo2|pulse|systolic|diastolic|respiratory|temperature|glucose|\brr\b|\btemp\b|\bsys\b|\bdia\b)\w*[^;\n]{0,24}[<>]=?\s*\d/i;
    for (const [f, s] of src) expect(vital.test(s), f).toBe(false);
  });

  it("S3: the screen feed carries booking codes, rooms and call times only", () => {
    const d = busyMorning();
    const rows = projectFloor(d.people.map(toVisit), d.events);
    const feed = screenFeed(rows, doctorStates(d.events));
    const items = [...feed.now, ...feed.recent];
    expect(items.length).toBeGreaterThan(0);
    for (const x of items) expect(Object.keys(x).sort()).toEqual(["calledAt", "code", "room"]);
    const names = d.people.map((p) => p.name);
    expect(names.some((n) => JSON.stringify(feed).includes(n))).toBe(false);
  });

  it("S5: shortcuts pause in a text box, with a modifier, and (but ? and Esc) in a dialog", () => {
    const input = { tagName: "INPUT" } as unknown as EventTarget;
    expect(floorKey({ key: "n", target: input }, false)).toBeNull();
    expect(floorKey({ key: "n", metaKey: true }, false)).toBeNull();
    expect(floorKey({ key: "n" }, true)).toBeNull();
    expect(floorKey({ key: "?" }, true)).toBe("?");
    expect(floorKey({ key: "Escape", target: input }, true)).toBe("escape");
    expect(floorKey({ key: "N" }, false)).toBe("n");
    expect(floorKey({ key: "x" }, false)).toBeNull();
  });

  it("copy lives in content: no English sentence is typed into a component", () => {
    const jsxText = />\s*[A-Z][a-z]+(?: [a-z]+){2,}[.!?]?\s*</;
    for (const [f, s] of src) expect(jsxText.test(s), f).toBe(false);
  });

  it("red is for emergencies only: the red button class appears only on Emergency and resus", () => {
    for (const [f, s] of src) {
      for (const m of s.matchAll(/c\("btn"(?:, "sm")?, "r"\)[^>]*>\s*\{([^}]+)\}/g))
        expect(/emergency|openResus|go|openDesk/i.test(m[1]!), `${f}: ${m[1]}`).toBe(true);
    }
  });

  it("S27: offline, a triage waits sealed and replays once back online; calls refuse with a word", async () => {
    let off = true;
    const triage = vi.fn(async () => ({ ok: true }));
    const port = { record: vi.fn(), triage, followUp: vi.fn() } as unknown as FloorPort;
    const q = floorOffline(port, () => off);
    expect(await q.triage({ a: 1 }, { b: 2 })).toEqual({ ok: true });
    expect(triage).not.toHaveBeenCalled();
    const call = await q.record({ clientId: crypto.randomUUID(), kind: "call" });
    expect(call.ok).toBe(false);
    off = false;
    expect(await q.drain()).toBe(1);
    expect(triage).toHaveBeenCalledWith({ a: 1 }, { b: 2 });
    expect(await q.drain()).toBe(0);
  });
});
