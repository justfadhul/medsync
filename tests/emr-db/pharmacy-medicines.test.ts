/**
 * Set-up › Medicines (MEDICINES-TAB.md; migration 0270) on the demo lane: the identity index in the database, a
 * local line, the national controlled lock (acceptance 5), a rule applied only by two different people (6), a bulk
 * top-up level writing one history line per line marked bulk (9), a top-up request and its Undo (4), and the
 * loader reading it all back. Runs with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { DemoLane } from "./_pharmacy-demo";
import type * as MedicinesStore from "@/lib/pharmacy/medicines/store";
import type { PharmacyActor } from "@/lib/pharmacy/write";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { laneOn } from "./_pglite";
import { demoLane } from "./_pharmacy-demo";

vi.mock("server-only", () => ({}));
const held = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({
  get db() {
    return held.db;
  },
}));

describe.skipIf(!laneOn)("Set-up › Medicines (0270)", () => {
  let L: DemoLane;
  let chief: PharmacyActor;
  let second: PharmacyActor;
  let M: typeof MedicinesStore;
  let run: (
    who: PharmacyActor,
    schema: unknown,
    fn: unknown,
    raw: Record<string, unknown>,
  ) => Promise<{ id: string } & Record<string, unknown>>;
  const rows = async <T>(q: string, p: unknown[] = []) => (await L.pg.query<T>(q, p)).rows;
  const local = (generic: string, strength: string, form: string) => ({
    clientKey: randomUUID(),
    generic,
    strength,
    form,
    route: null,
    unit: "tablet",
    cls: null,
    packs: [10],
    reason: "donation",
  });

  beforeAll(async () => {
    L = await demoLane((db) => (held.db = db));
    const state = await import("@/lib/pharmacy/demo/state");
    M = await import("@/lib/pharmacy/medicines/store");
    chief = state.chiefActor(L.s, null);
    second = state.pharmacyActor(L.s, L.s.people.pharmacists[0]!, "PHARMACIST", null);
    run = (who, schema, fn, raw) =>
      state.write(L.s, who, schema as never, M.MED_NEED, fn as never, raw) as never;
  }, 900_000);

  it("a local line is added once; the same identity again is refused, and the index holds in the database", async () => {
    const a = local("Testamol", "500 mg", "tablet");
    await run(chief, M.LocalInput, M.addLocalLine, a);
    const [p] = await rows<{ hand_added: boolean; local_reason: string; item_kind: string }>(
      `SELECT hand_added, local_reason, item_kind FROM pharmacy_products WHERE id = $1`,
      [a.clientKey],
    );
    expect(p).toEqual({ hand_added: true, local_reason: "donation", item_kind: "local_medicine" });
    await expect(
      run(chief, M.LocalInput, M.addLocalLine, local("testamol", "500 MG", "Tablet")),
    ).rejects.toThrow(/conflict/);
    // Past the app's pre-check, the unique index refuses it.
    await expect(
      L.pg.query(
        `INSERT INTO pharmacy_products (hospital_id, medicine_id, name, issue_unit, item_kind, generic, strength, form,
           hand_added, local_reason, created_by)
         SELECT hospital_id, medicine_id || 'x', name, issue_unit, item_kind, 'TESTAMOL', strength, form, true,
           'donation', created_by FROM pharmacy_products WHERE id = $1`,
        [a.clientKey],
      ),
    ).rejects.toThrow(/pp_line_identity|duplicate/);
  });

  it("acceptance 5: a line on the national controlled list cannot be unticked", async () => {
    const m = local("Morphine", "10 mg", "injection");
    await run(chief, M.LocalInput, M.addLocalLine, m);
    const [p] = await rows<{ controlled_class: string | null }>(
      `SELECT controlled_class FROM pharmacy_products WHERE id = $1`,
      [m.clientKey],
    );
    expect(p!.controlled_class).toBe("controlled");
    const save = {
      id: m.clientKey,
      fromDate: new Date(L.s.now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10),
      ven: "V",
      cls: null,
      flags: {
        controlled: false,
        high: false,
        cold: false,
        freeze: false,
        cyto: false,
        sterile: false,
        kit: false,
      },
      packs: [10],
      loose: false,
      free: false,
      prices: {},
      levels: {},
      brands: [],
    };
    await expect(run(chief, M.SaveLineInput, M.saveLine, save)).rejects.toThrow(/national/i);
  });

  it("acceptance 6: a rule changes only after two different people sign", async () => {
    const pr = await run(chief, M.ProposeInput, M.proposeRuleChange, {
      group: "all",
      key: "0",
      productId: null,
      newText: "Check the label twice before it leaves the counter.",
      reason: "Ward audit",
    });
    const text = async () =>
      (
        await rows<{ text: string }>(
          `SELECT text FROM pharmacy_rules WHERE hospital_id = $1 AND rule_group = 'all' AND key = '0'`,
          [L.h],
        )
      )[0]?.text;
    // ADR 0550: nobody signs as a second signer; the head of pharmacy's signature applies the change.
    await expect(
      run(second, M.SignInput, M.signRuleProposal, { id: pr.id, role: "second" }),
    ).rejects.toThrow();
    expect(await text()).toBeUndefined();
    const first = await run(chief, M.SignInput, M.signRuleProposal, {
      id: pr.id,
      role: "in_charge",
    });
    expect(first.applied).toBe(true);
    expect(await text()).toBe("Check the label twice before it leaves the counter.");
    // Straight to the table, without the signatures, the trigger refuses it.
    await expect(
      L.pg.query(
        `INSERT INTO pharmacy_rules (hospital_id, rule_group, key, text) VALUES ($1, 'all', '9', 'x')`,
        [L.h],
      ),
    ).rejects.toThrow(/two signatures/);
  });

  it("acceptance 9: a bulk top-up level on 3 lines writes 3 history lines marked bulk, by the actor", async () => {
    const ids = (
      await rows<{ id: string }>(
        `SELECT id FROM pharmacy_products WHERE hospital_id = $1 AND active ORDER BY name LIMIT 3`,
        [L.h],
      )
    ).map((r) => r.id);
    const [place] = await rows<{ id: string }>(
      `SELECT id FROM pharmacy_locations WHERE hospital_id = $1 AND kind <> 'store' AND switched_off_at IS NULL
       ORDER BY name LIMIT 1`,
      [L.h],
    );
    await run(chief, M.BulkLevelInput, M.bulkSetLevel, { ids, placeId: place!.id, level: 200 });
    const h = await rows<{ bulk: boolean; actor_id: string }>(
      `SELECT bulk, actor_id FROM pharmacy_line_history WHERE product_id = ANY($1::uuid[]) AND area = 'levels'`,
      [ids],
    );
    expect(h).toHaveLength(3);
    expect(h.every((r) => r.bulk && r.actor_id === chief.userId)).toBe(true);
  });

  it("acceptance 4: a top-up request creates an issue request; Undo withdraws it", async () => {
    // The demo has no main store; requests are issued from one.
    await L.pg.query(
      `INSERT INTO pharmacy_locations (hospital_id, kind, name, live_at, department_id)
       SELECT $1, 'store', 'Main store', now(), id FROM hospital_departments WHERE hospital_id = $1 LIMIT 1`,
      [L.h],
    );
    const [line] = await rows<{ id: string }>(
      `SELECT id FROM pharmacy_products WHERE hospital_id = $1 AND active ORDER BY name LIMIT 1`,
      [L.h],
    );
    const [place] = await rows<{ id: string }>(
      `SELECT id FROM pharmacy_locations WHERE hospital_id = $1 AND kind <> 'store' AND switched_off_at IS NULL
       ORDER BY name LIMIT 1`,
      [L.h],
    );
    const key = randomUUID();
    const r = await run(chief, M.TopUpInput, M.requestTopUps, {
      items: [{ clientKey: key, lineId: line!.id, placeId: place!.id, qty: 140 }],
    });
    expect(r.requests).toBe(1);
    const state = async () =>
      (
        await rows<{ state: string }>(`SELECT state FROM pharmacy_requisitions WHERE id = $1`, [
          key,
        ])
      )[0]?.state;
    expect(await state()).toBe("raised");
    await run(chief, M.UndoTopUpInput, M.undoTopUp, { id: key, kind: "request" });
    expect(await state()).toBe("withdrawn");
  });

  it("form and route change from the table; a duplicate is refused; a national form turns Controlled on", async () => {
    const a = local("Cellamol", "5 mg", "Tablet");
    const b = local("Cellamol", "5 mg", "Capsule");
    await run(chief, M.LocalInput, M.addLocalLine, a);
    await run(chief, M.LocalInput, M.addLocalLine, b);
    await expect(
      run(chief, M.LineCellInput, M.setLineCell, { id: b.clientKey, form: "tablet" }),
    ).rejects.toThrow(/Already stocked/);
    await run(chief, M.LineCellInput, M.setLineCell, { id: b.clientKey, route: "Oral" });
    const m = local("Morphine", "30 mg", "Tablet");
    await run(chief, M.LocalInput, M.addLocalLine, m);
    await run(chief, M.LineCellInput, M.setLineCell, { id: m.clientKey, form: "Injection" });
    const got = await rows<{ form: string; route: string | null; controlled_class: string | null }>(
      `SELECT form, route, controlled_class FROM pharmacy_products WHERE id = ANY($1::uuid[]) ORDER BY name, form`,
      [[b.clientKey, m.clientKey]],
    );
    expect(got.map((g) => [g.form, g.route, g.controlled_class])).toEqual([
      ["Capsule", "Oral", null],
      ["Injection", null, "controlled"],
    ]);
    const h = await rows<{ area: string }>(
      `SELECT area FROM pharmacy_line_history WHERE product_id = ANY($1::uuid[]) AND area IN ('form', 'route')`,
      [[b.clientKey, m.clientKey]],
    );
    expect(h.map((x) => x.area).sort()).toEqual(["form", "route"]);
  });

  it("a batch's expiry is corrected from Set-up with a reason; a controlled batch is refused", async () => {
    const pick = (controlled: boolean) =>
      rows<{ id: string; expiry: string }>(
        `SELECT b.id, b.expiry::text AS expiry FROM pharmacy_batches b JOIN pharmacy_products p ON p.id = b.product_id
          WHERE b.hospital_id = $1 AND (p.controlled_class IS NOT NULL) = $2 ORDER BY b.batch_number LIMIT 1`,
        [L.h, controlled],
      );
    const [b] = await pick(false);
    const next = new Date(Date.parse(b!.expiry) + 30 * 86_400_000).toISOString().slice(0, 10);
    await run(chief, M.ExpiryFixInput, M.correctExpiry, {
      clientKey: randomUUID(),
      batchId: b!.id,
      expiry: next,
      reason: "Typed wrong at receiving",
    });
    const [after] = await rows<{ expiry: string }>(
      `SELECT expiry::text AS expiry FROM pharmacy_batches WHERE id = $1`,
      [b!.id],
    );
    expect(after!.expiry).toBe(next);
    const c = await rows<{ old_expiry: string; reason: string }>(
      `SELECT old_expiry::text AS old_expiry, reason FROM pharmacy_batch_corrections WHERE batch_id = $1`,
      [b!.id],
    );
    expect(c).toEqual([{ old_expiry: b!.expiry, reason: "Typed wrong at receiving" }]);
    const [cd] = await pick(true);
    if (cd)
      await expect(
        run(chief, M.ExpiryFixInput, M.correctExpiry, {
          clientKey: randomUUID(),
          batchId: cd.id,
          expiry: next,
          reason: "Typed wrong",
        }),
      ).rejects.toThrow(/witness/);
  });

  it("the loader reads the lines, the applied rule and the local line back", async () => {
    const { loadMedicinesMaster } = await import("@/lib/pharmacy/medicines/read");
    const data = await loadMedicinesMaster(chief, true, L.s.db as never);
    if (!data.ok) throw new Error("migration");
    expect(data.lines.some((l) => l.generic === "Testamol" && l.local)).toBe(true);
    expect(data.rules.some((r) => r.group === "all" && r.key === "0")).toBe(true);
  });

  it("H6 Section C items show only after the switch; a supply takes its type and level from EMHSLU", async () => {
    const { catalogueItems } = M;
    const list = () => L.s.db.transaction((tx) => catalogueItems({ tx, actor: chief } as never));
    const before = await list();
    expect(before.some((i) => i.section === "C")).toBe(false);
    expect(before.some((i) => i.section === "B")).toBe(true);
    expect(before.some((i) => i.section === "D" && i.itemType === "lab_supply")).toBe(true);
    const c = (
      await rows<{ id: string }>(
        `SELECT id FROM public.cat_supply_items WHERE section = 'C' LIMIT 1`,
      )
    )[0]!.id;
    const refused = await run(chief, M.CatalogueAddInput, M.addLinesFromCatalogue, { ids: [c] });
    expect(refused.added).toBe(0);
    await run(chief, M.SectionCInput, M.setSectionC, { on: true });
    expect((await list()).some((i) => i.section === "C")).toBe(true);
    const added = await run(chief, M.CatalogueAddInput, M.addLinesFromCatalogue, { ids: [c] });
    expect(added.added).toBe(1);
    const again = await run(chief, M.CatalogueAddInput, M.addLinesFromCatalogue, { ids: [c] });
    expect((again.refused as string[])[0]).toBeTruthy();
    const [p] = await rows<{ item_type: string; level_of_care: string }>(
      `SELECT item_type, level_of_care FROM public.pharmacy_products WHERE supply_item_id = $1`,
      [c],
    );
    expect(p!.item_type).toBe("health_supply");
    expect(p!.level_of_care).toBeTruthy();
    await run(chief, M.SectionCInput, M.setSectionC, { on: false });
    expect((await list()).some((i) => i.section === "C")).toBe(false);
  });

  it("a supply reads back with its type, group, sale and flags, and never needs a price", async () => {
    const { qcChecks, lineMetrics } = await import("@/lib/pharmacy/derive/medicines");
    const b = (
      await rows<{ id: string }>(
        `SELECT id FROM public.cat_supply_items WHERE section = 'B' AND sterile LIMIT 1`,
      )
    )[0]!.id;
    await run(chief, M.CatalogueAddInput, M.addLinesFromCatalogue, { ids: [b] });
    const { loadMedicinesMaster } = await import("@/lib/pharmacy/medicines/read");
    const data = await loadMedicinesMaster(chief, true, L.s.db as never);
    if (!data.ok) throw new Error("migration");
    const l = data.lines.find((x) => x.itemType === "health_supply" && x.flags.sterile)!;
    expect(l.group).toMatch(/^EMHSLU 2023 · from /);
    expect(l.sale).toBe("supply");
    const ctx = {
      places: data.places,
      lines: data.lines,
      cashPayerId: data.cashPayerId,
      namedLasa: [],
    };
    const q = qcChecks(
      l,
      lineMetrics(l, data.places, data.cashPayerId),
      ctx,
      new Map(),
      (r) => r ?? "",
    );
    expect(q.find((x) => x.k === "Missing details")?.t ?? "").not.toMatch(/price/i);
  });
});
