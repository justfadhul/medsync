/**
 * Set-up › Going live, Places, Rules and Messages through the server actions and loaders (SETUP-TABS §I) on the demo
 * lane: go-live needs no blockers and both signatures, auto items move with live data and are never ticked, practice
 * leaves nothing behind, the handover rule moves the missed time, cold stock without a fridge shows, a typed reading
 * outside 2–8 °C needs a note and opens an excursion, closing a place with stock is refused, rule changes need two
 * different signers and apply at once, rejecting needs a note, Luganda waits for its check, quiet hours and the budget
 * hold messages, and opt-outs refuse duplicates. Runs with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { DemoLane } from "./_pharmacy-demo";
import type { SmsSender } from "@/lib/notifications/sink";
import type { Exec } from "@/lib/pharmacy/audit/read";
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

const tomorrow = () => new Date(Date.now() + 27 * 3_600_000).toISOString().slice(0, 10);
const hm = (ms: number) => new Date(ms + 3 * 3_600_000).toISOString().slice(11, 16);

describe.skipIf(!laneOn)("Set-up tabs through the actions (0274, §I)", () => {
  let L: DemoLane;
  let db: Exec;
  let chief: PharmacyActor;
  let other: PharmacyActor;
  let ms: PharmacyActor;
  let G: typeof import("@/lib/pharmacy/actions/setup/golive");
  let P: typeof import("@/lib/pharmacy/actions/setup/places");
  let R: typeof import("@/lib/pharmacy/actions/setup/rules");
  let M: typeof import("@/lib/pharmacy/actions/setup/messages");
  let read: typeof import("@/lib/pharmacy/setup/read");
  const ok = async <T>(p: Promise<{ ok: boolean; error?: string; data?: T }>) => {
    const r = await p;
    if (!r.ok) throw new Error(r.error);
    return r.data as T;
  };
  const refusal = async (p: Promise<{ ok: boolean; error?: string }>) => {
    const r = await p;
    return r.ok ? null : (r.error ?? "");
  };
  const sign = async (id: string, who: PharmacyActor, role: "in_charge" | "second") => {
    const med = await import("@/lib/pharmacy/medicines/store");
    const { runPharmacyWrite } = await import("@/lib/pharmacy/write");
    return runPharmacyWrite(med.SignInput, { id, role }, who, med.MED_NEED, med.signRuleProposal);
  };
  const propose = async (group: string, key: string, n: number) => {
    const rules = await import("@/lib/pharmacy/rules/actions");
    return ok(
      rules.proposeRegistryRule(chief, {
        clientKey: randomUUID(),
        group,
        key,
        n,
        newText: null,
        reason: "Test change",
      }),
    );
  };

  beforeAll(async () => {
    L = await demoLane((d) => (held.db = d));
    db = L.lane.db as unknown as Exec;
    const state = await import("@/lib/pharmacy/demo/state");
    G = await import("@/lib/pharmacy/actions/setup/golive");
    P = await import("@/lib/pharmacy/actions/setup/places");
    R = await import("@/lib/pharmacy/actions/setup/rules");
    M = await import("@/lib/pharmacy/actions/setup/messages");
    read = await import("@/lib/pharmacy/setup/read");
    chief = state.chiefActor(L.s, null);
    other = state.pharmacyActor(L.s, L.s.people.pharmacists[1]!, "PHARMACIST", null);
    ms = state.pharmacyActor(L.s, L.s.people.pharmacists[2]!, "PHARMACIST", null);
    await L.pg.query(
      `INSERT INTO public.user_roles (user_id, role, hospital_id) VALUES ($1, 'hospital_admin', $2)`,
      [ms.userId, L.h],
    );
  }, 900_000);

  it("every tab loads", async () => {
    expect(await read.loadGoLive(db, chief, true)).not.toBeNull();
    expect(await read.loadPlaces(db, chief, true)).not.toBeNull();
    expect(await read.loadRulesView(db, chief, true)).not.toBeNull();
    expect(await read.loadMessages(db, chief, true)).not.toBeNull();
  });

  it("§I.2 auto items come from live data and are never ticked by hand", async () => {
    const v = (await read.loadGoLive(db, chief, true))!;
    const prices = v.items.find((i) => i.key === "prices")!;
    expect(prices.prog).not.toBeNull();
    expect(prices.prog![1]).toBeGreaterThan(0);
    expect(await refusal(G.markItem(chief, { key: "prices" }))).toMatch(/automatically/);
    expect(await refusal(G.markItem(other, { key: "dev" }))).toMatch(/in-charge/);
    await ok(G.markItem(chief, { key: "dev" }));
  });

  it("§I.3 a practice day leaves no practice rows and no real stock movement; who trained stays", async () => {
    const moves = async () =>
      Number(
        (await L.pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM pharmacy_stock_movements`))
          .rows[0]!.n,
      );
    const before = await moves();
    expect(await refusal(G.practiceDispense(other, { sample: "Amoxicillin 500 mg" }))).toMatch(
      /practice/i,
    );
    await ok(G.startPractice(chief, {}));
    await ok(G.practiceDispense(other, { sample: "Amoxicillin 500 mg" }));
    expect((await read.loadGoLive(db, other, false))!.practice).toEqual({
      open: true,
      trainedMe: true,
    });
    await ok(G.endPractice(chief, {}));
    const left = await L.pg.query(
      `SELECT 1 FROM pharmacy_practice.dispenses WHERE hospital_id = $1`,
      [L.h],
    );
    expect(left.rows).toHaveLength(0);
    expect(await moves()).toBe(before);
    expect((await read.loadGoLive(db, other, false))!.practice).toEqual({
      open: false,
      trainedMe: true,
    });
  });

  it("§I.1 go-live is refused while anything blocks; one signature alone does not switch on", async () => {
    await ok(G.setGoLiveDate(chief, { date: tomorrow() }));
    expect(await refusal(G.signGoLive(chief, { role: "in_charge" }))).toMatch(/blocks going live/);
    await L.pg
      .query(`CREATE OR REPLACE FUNCTION private.pharmacy_golive_blockers(p_hospital uuid) RETURNS integer
      LANGUAGE sql STABLE AS $$ SELECT 0 $$`);
    expect(await refusal(G.signGoLive(other, { role: "in_charge" }))).toMatch(/in-charge/);
    expect((await ok(G.signGoLive(chief, { role: "in_charge" }))).live).toBe(false);
    expect((await read.loadGoLive(db, chief, true))!.phase).toBe("setup");
    expect(await refusal(G.signGoLive(chief, { role: "ms" }))).toMatch(/superintendent/);
    expect((await ok(G.signGoLive(ms, { role: "ms" }))).live).toBe(true);
    expect((await read.loadGoLive(db, chief, true))!.phase).toBe("parallel");
  });

  it("§I.4 the handover rule's signed number moves the missed time", async () => {
    expect((await read.loadPlaces(db, chief, true))!.rules.missedMin).toBe(30);
    const p = await propose("ho", "missed", 45);
    await ok(sign(p.id, chief, "in_charge")); // ADR 0550: the head signs alone
    expect((await read.loadPlaces(db, chief, true))!.rules.missedMin).toBe(45);
  });

  it("§I.5 cold-chain stock at a place with no fridge shows", async () => {
    // The demo keeps no cold-chain line in stock: mark one stocked product as cold chain.
    await L.pg.query(
      `UPDATE pharmacy_products SET cold_chain = true WHERE id = (
      SELECT b.product_id FROM pharmacy_batches b JOIN pharmacy_stock_movements m ON m.batch_id = b.id
       WHERE b.hospital_id = $1 GROUP BY b.id HAVING sum(m.quantity) > 0 LIMIT 1)`,
      [L.h],
    );
    const v = (await read.loadPlaces(db, chief, true))!;
    const place = v.places.find((p) => p.coldLines.length > 0);
    expect(place).toBeDefined();
    for (const f of v.fridges.filter((x) => x.placeId === place!.id))
      await ok(P.moveFridge(chief, { id: f.id, placeId: null }));
    const after = (await read.loadPlaces(db, chief, true))!;
    expect(after.places.find((p) => p.id === place!.id)!.coldLines.length).toBeGreaterThan(0);
    expect(after.fridges.some((f) => f.placeId === place!.id)).toBe(false);
  });

  it("§I.6 a typed reading outside 2–8 °C needs a note and opens an excursion; one in range closes it", async () => {
    const f = await ok(
      P.addFridge(chief, { code: `T-${Date.now() % 100000}`, kind: "Vaccine fridge" }),
    );
    const now = Date.now();
    const time = hm(now - 2 * 60_000);
    expect(
      await refusal(P.recordReading(other, { fridgeId: f.id, time, temp: 9.4, note: "" })),
    ).toMatch(/say what you did/);
    expect(
      (
        await ok(
          P.recordReading(other, {
            fridgeId: f.id,
            time,
            temp: 9.4,
            note: "Door shut, moved stock",
          }),
        )
      ).excursion,
    ).toBe(true);
    const open = () =>
      L.pg.query(
        `SELECT 1 FROM pharmacy_fridge_excursions WHERE fridge_id = $1 AND ended_at IS NULL`,
        [f.id],
      );
    expect((await open()).rows).toHaveLength(1);
    await ok(
      P.recordReading(other, { fridgeId: f.id, time: hm(now - 60_000), temp: 5.1, note: "" }),
    );
    expect((await open()).rows).toHaveLength(0);
  });

  it("§I.7 closing a place with stock is refused in words; reopening keeps its history", async () => {
    const v = (await read.loadPlaces(db, chief, true))!;
    const full = v.places.find((p) => p.stock.lines > 0 && !p.handoverOpen)!;
    expect(await refusal(P.closePlace(chief, { id: full.id, note: null }))).toMatch(
      new RegExp(`Move or issue out its stock first: ${full.stock.lines} lines`),
    );
    const id = randomUUID();
    await ok(
      P.addPlace(chief, {
        clientKey: id,
        kind: "clinic",
        name: `Test clinic ${Date.now() % 100000}`,
        hours: "day",
        suppliedFrom: null,
        supplierIds: [],
        device: "EPI tablet",
        departmentId: null,
        wardId: null,
      }),
    );
    await ok(P.closePlace(chief, { id, note: "Moved" }));
    const closed = (await read.loadPlaces(db, chief, true))!.places.find((p) => p.id === id)!;
    expect(closed.closed?.note).toBe("Moved");
    await ok(P.reopenPlace(chief, { id, note: null }));
    expect(
      (await read.loadPlaces(db, chief, true))!.places.find((p) => p.id === id)!.closed,
    ).toBeNull();
  });

  it("§I.8 a number outside its range is refused, the proposer never second-signs, and the change applies at once", async () => {
    const rules = await import("@/lib/pharmacy/rules/actions");
    expect(
      await refusal(
        rules.proposeRegistryRule(chief, {
          clientKey: randomUUID(),
          group: "cold",
          key: "expiry_warning",
          n: 400,
          newText: null,
          reason: "x1",
        }),
      ),
    ).toBeTruthy();
    const p = await propose("cold", "expiry_warning", 120);
    expect(await refusal(sign(p.id, chief, "second"))).toBeTruthy();
    expect(await refusal(sign(p.id, other, "second"))).toBeTruthy(); // ADR 0550: no second signer
    await ok(sign(p.id, chief, "in_charge"));
    const g = (await read.loadRulesView(db, chief, true))!.groups.find((x) => x.key === "cold")!;
    expect(g.rules.find((r) => r.key === "expiry_warning")!.n).toBe(120);
  });

  it("§I.9 rejecting needs a note and shows in the history", async () => {
    const p = await propose("cold", "near_limit", 1);
    // ADR 0550: the head of pharmacy, the only signer, is the one who rejects.
    expect(await refusal(R.rejectProposal(other, { id: p.id, note: "Too wide" }))).toBeTruthy();
    expect(await refusal(R.rejectProposal(chief, { id: p.id, note: "" }))).toBeTruthy();
    await ok(R.rejectProposal(chief, { id: p.id, note: "Too wide for vaccines" }));
    const h = (await read.loadRulesView(db, chief, true))!.history;
    expect(h.find((x) => x.kind === "rejected")?.rejectNote).toBe("Too wide for vaccines");
  });

  it("§I.10 Luganda waits for its check, and editing it clears the check", async () => {
    const lg = "Ebigambo ebigezesebwa byokka 0001"; // test-only filler, not Luganda wording
    await ok(M.updateTemplate(chief, { key: "refill_due", timing: "3", en: "", lg }));
    const t = () =>
      read
        .loadMessages(db, chief, true)
        .then((v) => v!.templates.find((x) => x.key === "refill_due")!);
    expect((await t()).lgCheckedAt).toBeNull();
    await ok(M.markLugandaChecked(chief, { key: "refill_due" }));
    expect((await t()).lgCheckedAt).not.toBeNull();
    await ok(M.updateTemplate(chief, { key: "refill_due", timing: "3", en: "", lg: `${lg}2` }));
    expect((await t()).lgCheckedAt).toBeNull();
  });

  it("§I.11 quiet hours hold a message until 07:00; at the budget cap sending stops", async () => {
    const { sendOne } = await import("@/lib/pharmacy/sms/store");
    const { blindIndex, encrypt } = await import("@/lib/encryption");
    const sent: string[] = [];
    const fake: SmsSender = {
      send: async ({ body }) => (sent.push(body), { ok: true, providerMessageId: randomUUID() }),
    };
    const msg = async (phone: string) =>
      (
        await L.pg.query<{ id: string }>(
          `INSERT INTO pharmacy_sms_messages (hospital_id, day, rule, ref_key, recipient, phone_encrypted, phone_hmac, lang, body, status)
           VALUES ($1, current_date, 'refill_due', $2, 'Test', $3, $4, 'en', 'MedSync test reminder. Reply STOP to stop.', 'scheduled') RETURNING id`,
          [L.h, `t:${randomUUID()}`, encrypt(phone), blindIndex(phone)],
        )
      ).rows[0]!.id;
    const row = async (id: string) =>
      (
        await L.pg.query<{ status: string; note: string | null }>(
          `SELECT status, note FROM pharmacy_sms_messages WHERE id = $1`,
          [id],
        )
      ).rows[0]!;
    const m = {
      status: "scheduled" as const,
      phoneEncrypted: encrypt("+256772000001"),
      body: "MedSync test reminder. Reply STOP to stop.",
    };
    const night = new Date(`${new Date().toISOString().slice(0, 10)}T18:30:00Z`); // 21:30 Kampala
    const a = await msg("+256772000001");
    expect(await sendOne(L.lane.db as never, fake, { ...m, id: a }, null, night, 50)).toBe(false);
    expect(await row(a)).toMatchObject({ status: "queued", note: "Quiet hours: goes at 07:00" });
    const day = new Date(`${new Date().toISOString().slice(0, 10)}T08:00:00Z`); // 11:00 Kampala
    await ok(M.setBudget(chief, { ugx: 60 }));
    const b = await msg("+256772000002");
    expect(await sendOne(L.lane.db as never, fake, { ...m, id: b }, null, day, 50)).toBe(true);
    const c = await msg("+256772000003");
    expect(await sendOne(L.lane.db as never, fake, { ...m, id: c }, null, day, 50)).toBe(false);
    expect((await row(c)).status).toBe("queued");
    expect(sent).toHaveLength(1);
  });

  it("§I.12 STOP opts out at once; a desk opt-out refuses duplicates", async () => {
    const { optOutReply } = await import("@/lib/pharmacy/sms/store");
    expect(await optOutReply(L.lane.db as never, "+256772000002")).toBeGreaterThan(0);
    expect(await refusal(M.optOut(chief, { phone: "0772000002", reason: "Wrong number" }))).toMatch(
      /already opted out/,
    );
    await ok(M.optOut(chief, { phone: "0772000009", reason: "Wrong number" }));
    const v = (await read.loadMessages(db, chief, true))!;
    expect(v.optOuts.map((o) => o.reason)).toEqual(
      expect.arrayContaining(["Replied STOP", "Wrong number"]),
    );
  });
});
