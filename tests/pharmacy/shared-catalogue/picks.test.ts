import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PickLike } from "@/lib/pharmacy/shared-catalogue/picks";
import { describe, expect, it } from "vitest";

import { pickKey, setPick, togglePick } from "@/lib/pharmacy/shared-catalogue/picks";

const pack = (medicine: string, packId: string | null): PickLike => ({
  kind: "pack",
  medicine: { id: medicine },
  pack: { packId },
});
const product = (productId: string): PickLike => ({ kind: "product", productId });

describe("ticking several picks (owner item 9)", () => {
  it("one tick per medicine: a second pack replaces the first, in place", () => {
    const t = setPick(setPick([pack("amox", "p1")], product("x")), pack("amox", "p2"));
    expect(t.map(pickKey)).toEqual(["medicine:amox", "product:x"]);
    expect(t[0]).toEqual(pack("amox", "p2"));
  });

  it("toggling the same pick unticks it; another pack of that medicine swaps", () => {
    let t = togglePick([], pack("amox", "p1"));
    t = togglePick(t, pack("amox", "p2"));
    expect(t).toEqual([pack("amox", "p2")]);
    expect(togglePick(t, pack("amox", "p2"))).toEqual([]);
    expect(togglePick(togglePick([], product("x")), product("x"))).toEqual([]);
  });

  it("the loose pack (no pack id) is a pick of its own", () => {
    const t = togglePick([pack("ors", null)], pack("ors", null));
    expect(t).toEqual([]);
  });
});

describe("multi mode is opt-in", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(n) ? [p] : [];
    });

  it("only the delivery's scan and Set-up › Medicines pass onPickMany to the picker", () => {
    const users = files("app").filter((f) => /<CataloguePicker\b/.test(readFileSync(f, "utf8")));
    expect(users.length).toBeGreaterThan(1);
    const multi = users.filter((f) => /onPickMany=/.test(readFileSync(f, "utf8")));
    expect(multi).toEqual([
      "app/pharmacy/setup/_components/add-from-catalogue.tsx",
      "app/pharmacy/store/deliveries/_components/delivery-scan.tsx",
    ]);
  });
});
