import type {
  OrderEventInput,
  OrderInput,
  OrderRecords,
  OrderState,
  ReportInput,
  SpecimenEventInput,
  SpecimenInput,
} from "@/lib/emr/orders";
import type { Ack, ReportStatus } from "@/lib/emr/results";
import { describe, expect, it } from "vitest";

import { deriveOrderStatus, needsFastingChip, orderStatusText } from "@/lib/emr/orders";

/** lib/emr/orders.ts: the derived order lifecycle, legacy mapping, fasting chip, and the
 *  property "nothing ordered disappears" over 400 seeded random histories. */

const t = (min: number) => new Date(Date.UTC(2026, 8, 26, 8, 0) + min * 60_000);
const ORDER: OrderInput = { id: "o1", lifecycle: "events", status: "ordered", kind: "lab" };

const ev = (
  kind: string,
  at: number,
  reasonCode: string | null = null,
  cipher: string | null = null,
): OrderEventInput => ({
  orderId: "o1",
  kind,
  reasonCode,
  reasonCiphertext: cipher,
  recordedAt: t(at),
});
const sp = (id: string, at: number): SpecimenInput => ({ id, orderId: "o1", recordedAt: t(at) });
const se = (
  specimenId: string,
  kind: string,
  at: number,
  reasonCode: string | null = null,
): SpecimenEventInput => ({
  specimenId,
  kind,
  reasonCode,
  recordedAt: t(at),
});
const rp = (
  id: string,
  version: number,
  status: ReportStatus,
  at: number,
  logicalId = "L1",
): ReportInput => ({
  id,
  logicalId,
  version,
  status,
  recordedAt: t(at),
  orderId: "o1",
});
const ak = (reportId: string, action: string, at: number): Ack => ({
  reportId,
  action,
  acknowledgedByUserId: "dr-1",
  forwardedToUserId: action === "forwarded" ? "dr-2" : null,
  recordedAt: t(at),
});
const derive = (r: OrderRecords, order: OrderInput = ORDER) => deriveOrderStatus(order, r);
const PLACED = [ev("placed", 0)];

describe("legacy orders map from their status column", () => {
  const legacy = (status: string) => derive({}, { ...ORDER, lifecycle: "legacy", status });
  it("ordered → active", () =>
    expect(legacy("ordered").status).toEqual({ state: "active", rejection: null }));
  it("collected → collected", () => expect(legacy("collected").status.state).toBe("collected"));
  it("resulted → resulted (legacy)", () =>
    expect(legacy("resulted").status).toMatchObject({
      state: "resulted",
      reportStatus: "legacy",
      review: "legacy",
    }));
  it("cancelled → cancelled, reason not recorded", () => {
    const d = legacy("cancelled");
    expect(d.status).toEqual({ state: "cancelled", via: "legacy", reason: null });
    expect(d.open).toBe(false);
    expect(orderStatusText(d.status, "bloods")).toBe("Cancelled (reason not recorded)");
  });
  it("an unknown status shows as active with an anomaly, never an unknown state", () => {
    const d = legacy("weird");
    expect(d.status.state).toBe("active");
    expect(d.anomalies).toHaveLength(1);
  });
  it("events never drive a legacy order", () => {
    const d = derive({ events: [ev("cancelled", 0, "x")] }, { ...ORDER, lifecycle: "legacy" });
    expect(d.status.state).toBe("active");
  });
});

describe("order events", () => {
  it("an order with no events yet is active and open", () => {
    expect(derive({})).toMatchObject({ status: { state: "active" }, open: true, anomalies: [] });
  });
  it("proposed (suggested by triage, not accepted)", () => {
    const d = derive({ events: [ev("proposed", 0)] });
    expect(d.status.state).toBe("proposed");
    expect(d.open).toBe(true);
    expect(orderStatusText(d.status, "lab")).toBe("Suggested — not yet accepted");
  });
  it("proposed → placed = active, To collect", () => {
    const d = derive({ events: [ev("proposed", 0), ev("placed", 1)] });
    expect(orderStatusText(d.status, "lab")).toBe("To collect");
  });
  it("a non-lab order reads Ordered", () => {
    expect(orderStatusText(derive({ events: PLACED }).status, "imaging")).toBe("Ordered");
  });
  it("proposed → dismissed with a reason closes it", () => {
    const d = derive({ events: [ev("proposed", 0), ev("dismissed", 1, "not_indicated")] });
    expect(d.status).toEqual({
      state: "cancelled",
      via: "dismissed",
      reason: { code: "not_indicated", hasText: false },
    });
    expect(d.open).toBe(false);
  });
  it("placed → cancelled with a coded reason", () => {
    const d = derive({ events: [...PLACED, ev("cancelled", 1, "duplicate")] });
    expect(d.status).toMatchObject({
      state: "cancelled",
      via: "cancelled",
      reason: { code: "duplicate" },
    });
  });
  it("a cancel with only encrypted text is still a cancel with a reason", () => {
    const d = derive({ events: [...PLACED, ev("cancelled", 1, null, "iv:tag:ct")] });
    expect(d.status).toMatchObject({ state: "cancelled", reason: { code: null, hasText: true } });
  });
  it("a cancel without a reason is not applied: the order stays open", () => {
    const d = derive({ events: [...PLACED, ev("cancelled", 1)] });
    expect(d.status.state).toBe("active");
    expect(d.anomalies[0]).toMatch(/without a reason/);
  });
  it("a dismissal without a reason is not applied", () => {
    expect(derive({ events: [ev("proposed", 0), ev("dismissed", 1)] }).status.state).toBe(
      "proposed",
    );
  });
  it("on hold, with its reason; resumed → active", () => {
    const held = derive({ events: [...PLACED, ev("on_hold", 1, "patient_away")] });
    expect(held.status).toEqual({
      state: "on_hold",
      reason: { code: "patient_away", hasText: false },
    });
    expect(held.open).toBe(true);
    expect(
      derive({ events: [...PLACED, ev("on_hold", 1, "x"), ev("resumed", 2)] }).status.state,
    ).toBe("active");
  });
  it("events that do not fit are listed, not applied", () => {
    const d = derive({ events: [...PLACED, ev("resumed", 1), ev("dismissed", 2, "x")] });
    expect(d.status.state).toBe("active");
    expect(d.anomalies).toHaveLength(2);
  });
  it("a cancelled order stays cancelled", () => {
    const d = derive({ events: [...PLACED, ev("cancelled", 1, "x"), ev("placed", 2)] });
    expect(d.status.state).toBe("cancelled");
  });
  it("recorded time decides, not input order", () => {
    const d = derive({ events: [ev("cancelled", 5, "x"), ev("placed", 1)] });
    expect(d.status.state).toBe("cancelled");
    expect(d.anomalies).toEqual([]);
  });
  it("records of another order are ignored", () => {
    expect(derive({ events: [{ ...ev("cancelled", 1, "x"), orderId: "o2" }] }).status.state).toBe(
      "active",
    );
  });
});

describe("specimens", () => {
  it("collected", () => {
    const d = derive({ events: PLACED, specimens: [sp("s1", 1)] });
    expect(d.status).toEqual({ state: "collected", specimenId: "s1" });
  });
  it("received by the laboratory → in progress", () => {
    const d = derive({
      events: PLACED,
      specimens: [sp("s1", 1)],
      specimenEvents: [se("s1", "received", 2)],
    });
    expect(d.status).toEqual({ state: "in_progress", specimenId: "s1" });
    expect(orderStatusText(d.status, "lab")).toBe("Received by the laboratory");
  });
  it("rejected → to collect again, the reason visible", () => {
    const d = derive({
      events: PLACED,
      specimens: [sp("s1", 1)],
      specimenEvents: [se("s1", "rejected", 2, "haemolysed")],
    });
    expect(d.status).toEqual({
      state: "active",
      rejection: { specimenId: "s1", reasonCode: "haemolysed", at: t(2) },
    });
    expect(orderStatusText(d.status, "lab")).toBe("Rejected: haemolysed — recollect");
  });
  it("reason codes read as words", () => {
    const d = derive({
      events: PLACED,
      specimens: [sp("s1", 1)],
      specimenEvents: [se("s1", "rejected", 2, "unlabelled_or_mislabelled")],
    });
    expect(orderStatusText(d.status, "lab")).toBe(
      "Rejected: unlabelled or mislabelled — recollect",
    );
  });
  it("recollected after a rejection → collected, then in progress", () => {
    const base = { events: PLACED, specimens: [sp("s1", 1), sp("s2", 5)] };
    const rejected = [se("s1", "rejected", 2, "clotted")];
    expect(derive({ ...base, specimenEvents: rejected }).status).toEqual({
      state: "collected",
      specimenId: "s2",
    });
    expect(
      derive({ ...base, specimenEvents: [...rejected, se("s2", "received", 6)] }).status.state,
    ).toBe("in_progress");
  });
  it("the newest specimen by recorded time, whatever the input order", () => {
    const d = derive({
      events: PLACED,
      specimens: [sp("s2", 5), sp("s1", 1)],
      specimenEvents: [se("s1", "rejected", 2, "clotted")],
    });
    expect(d.status).toMatchObject({ specimenId: "s2" });
  });
  it("on hold outranks a collected specimen", () => {
    const d = derive({ events: [...PLACED, ev("on_hold", 3, "x")], specimens: [sp("s1", 1)] });
    expect(d.status.state).toBe("on_hold");
  });
});

describe("results and acknowledgement", () => {
  const base = {
    events: PLACED,
    specimens: [sp("s1", 1)],
    specimenEvents: [se("s1", "received", 2)],
  };
  it("preliminary → resulted, not released", () => {
    const d = derive({ ...base, reports: [rp("r1", 1, "preliminary", 3)] });
    expect(d.status).toEqual({
      state: "resulted",
      reportId: "r1",
      reportStatus: "preliminary",
      review: "not_released",
    });
    expect(orderStatusText(d.status, "lab")).toBe("Preliminary result");
  });
  it("final → resulted, needs review", () => {
    const d = derive({
      ...base,
      reports: [rp("r1", 1, "preliminary", 3), rp("r2", 2, "final", 4)],
    });
    expect(d.status).toMatchObject({
      reportId: "r2",
      reportStatus: "final",
      review: "needs_review",
    });
    expect(orderStatusText(d.status, "lab")).toBe("Result available — awaiting acknowledgement");
  });
  it("acknowledged closes it", () => {
    const d = derive({ ...base, reports: [rp("r1", 1, "final", 3)], acks: [ak("r1", "acted", 4)] });
    expect(d.status).toEqual({ state: "acknowledged", reportId: "r1", action: "acted" });
    expect(d.open).toBe(false);
    expect(orderStatusText(d.status, "lab")).toBe("Acknowledged (acted)");
  });
  it("forwarded is a handover, not a closure: the order stays open", () => {
    const d = derive({
      ...base,
      reports: [rp("r1", 1, "final", 3)],
      acks: [ak("r1", "forwarded", 4)],
    });
    expect(d.status).toMatchObject({ state: "resulted", review: "forwarded" });
    expect(d.open).toBe(true);
    expect(orderStatusText(d.status, "lab")).toBe("Forwarded — awaiting acknowledgement");
    expect(
      derive({
        ...base,
        reports: [rp("r1", 1, "final", 3)],
        acks: [ak("r1", "forwarded", 4), ak("r1", "seen", 5)],
      }).status.state,
    ).toBe("acknowledged");
  });
  it("an amendment after acknowledgement re-opens it for re-acknowledgement", () => {
    const reports = [rp("r1", 1, "final", 3), rp("r2", 2, "amended", 9)];
    const d = derive({ ...base, reports, acks: [ak("r1", "seen", 4)] });
    expect(d.status).toMatchObject({ state: "resulted", reportId: "r2", review: "needs_re_ack" });
    expect(d.open).toBe(true);
    expect(orderStatusText(d.status, "lab")).toBe("Amended — acknowledge again");
    expect(
      derive({ ...base, reports, acks: [ak("r1", "seen", 4), ak("r2", "seen", 10)] }).status.state,
    ).toBe("acknowledged");
  });
  it("a report entered in error falls back to the specimen state", () => {
    const d = derive({
      ...base,
      reports: [rp("r1", 1, "final", 3), rp("r2", 2, "entered_in_error", 4)],
    });
    expect(d.status.state).toBe("in_progress");
  });
  it("a cancelled report with no specimen → active", () => {
    expect(derive({ events: PLACED, reports: [rp("r1", 1, "cancelled", 3)] }).status.state).toBe(
      "active",
    );
  });
  it("a result after a cancel is shown, never hidden", () => {
    const d = derive({
      events: [...PLACED, ev("cancelled", 1, "x")],
      reports: [rp("r1", 1, "final", 3)],
    });
    expect(d.status.state).toBe("resulted");
    expect(d.anomalies[0]).toMatch(/result present/);
  });
  it("one unacknowledged report keeps the order open", () => {
    const reports = [rp("a1", 1, "final", 3, "A"), rp("b1", 1, "final", 4, "B")];
    const one = derive({ ...base, reports, acks: [ak("a1", "seen", 5)] });
    expect(one.status).toMatchObject({ state: "resulted", reportId: "b1", review: "needs_review" });
    const both = derive({ ...base, reports, acks: [ak("a1", "seen", 5), ak("b1", "seen", 6)] });
    expect(both.status.state).toBe("acknowledged");
  });
});

describe("fasting chip", () => {
  const test = (fastingRequired: boolean, components: string[]) => ({
    fastingRequired,
    components,
  });
  it("the order requires fasting", () =>
    expect(needsFastingChip({ fastingRequired: true }, null)).toBe(true));
  it("the test menu requires fasting", () =>
    expect(needsFastingChip({ fastingRequired: null }, test(true, ["obs.chol_total"]))).toBe(true));
  it("a component needs fastingState as context (glucose, C-peptide)", () => {
    expect(needsFastingChip({ fastingRequired: false }, test(false, ["obs.glucose"]))).toBe(true);
    expect(
      needsFastingChip({ fastingRequired: null }, test(false, ["obs.wbc", "obs.c_peptide"])),
    ).toBe(true);
  });
  it("a full blood count needs no chip", () =>
    expect(
      needsFastingChip(
        { fastingRequired: false },
        test(false, ["obs.wbc", "obs.haemoglobin", "obs.platelets"]),
      ),
    ).toBe(false));
  it("an unknown component, or no test, needs no chip", () => {
    expect(needsFastingChip({ fastingRequired: null }, test(false, ["obs.nope"]))).toBe(false);
    expect(needsFastingChip({ fastingRequired: null }, null)).toBe(false);
  });
});

/* ─── Property: nothing ordered disappears ─────────────────────────── */

/** Seeded (mulberry32), so a failure names its seed and replays exactly. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const EVENT_KINDS = ["proposed", "placed", "dismissed", "cancelled", "on_hold", "resumed"];
const STATUSES: ReportStatus[] = [
  "preliminary",
  "final",
  "amended",
  "corrected",
  "cancelled",
  "entered_in_error",
];
const OPEN_STATES: OrderState[] = [
  "proposed",
  "active",
  "on_hold",
  "collected",
  "in_progress",
  "resulted",
];

function history(seed: number): OrderRecords {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  // Distinct recorded times, handed out in random order, so input order never equals time order.
  const slots = Array.from({ length: 40 }, (_, i) => i).sort(() => rnd() - 0.5);
  let next = 0;
  const at = () => slots[next++]!;
  const events = Array.from({ length: Math.floor(rnd() * 6) }, () =>
    ev(pick(EVENT_KINDS), at(), rnd() < 0.7 ? "r" : null, rnd() < 0.2 ? "iv:tag:ct" : null),
  );
  const specimens = Array.from({ length: Math.floor(rnd() * 3) }, (_, i) => sp(`s${i}`, at()));
  const specimenEvents = specimens.flatMap((s) =>
    rnd() < 0.6
      ? [rnd() < 0.5 ? se(s.id, "received", at()) : se(s.id, "rejected", at(), "haemolysed")]
      : [],
  );
  const reports: ReportInput[] = [];
  for (let c = 0; c < Math.floor(rnd() * 3); c++)
    for (let ver = 1; ver <= 1 + Math.floor(rnd() * 3); ver++)
      reports.push(rp(`L${c}v${ver}`, ver, pick(STATUSES), at(), `L${c}`));
  const acks = reports.flatMap((r) =>
    rnd() < 0.4 ? [ak(r.id, pick(["seen", "acted", "forwarded"]), at())] : [],
  );
  return { events, specimens, specimenEvents, reports, acks };
}

const shuffled = (r: OrderRecords, seed: number): OrderRecords => {
  const rnd = mulberry32(seed * 7919);
  const mix = <T>(xs: readonly T[] = []) => [...xs].sort(() => rnd() - 0.5);
  return {
    events: mix(r.events),
    specimens: mix(r.specimens),
    specimenEvents: mix(r.specimenEvents),
    reports: mix(r.reports),
    acks: mix(r.acks),
  };
};

describe("property: nothing ordered disappears (400 seeds)", () => {
  const seen = new Set<OrderState>();
  for (let seed = 1; seed <= 400; seed++) {
    it(`seed ${seed}`, () => {
      const records = history(seed);
      const d = deriveOrderStatus(ORDER, records);
      const s = d.status;
      seen.add(s.state);

      // Ends acknowledged, cancelled with a reason, or visibly open — never anything else.
      if (d.open) expect(OPEN_STATES).toContain(s.state);
      else if (s.state === "cancelled") {
        expect(s.reason).not.toBeNull();
        expect(s.reason!.code !== null || s.reason!.hasText).toBe(true);
      } else expect(s.state).toBe("acknowledged");
      expect(orderStatusText(s, "lab").length).toBeGreaterThan(0);

      // A live result is never hidden, whatever happened to the order.
      const live = new Map<string, ReportInput>();
      for (const r of records.reports ?? []) {
        const cur = live.get(r.logicalId);
        if (
          !cur ||
          r.version > cur.version ||
          (r.version === cur.version && r.recordedAt > cur.recordedAt)
        )
          live.set(r.logicalId, r);
      }
      if (
        [...live.values()].some((r) => r.status !== "cancelled" && r.status !== "entered_in_error")
      )
        expect(["resulted", "acknowledged"]).toContain(s.state);

      // Recorded time, not input order, decides.
      expect(deriveOrderStatus(ORDER, shuffled(records, seed))).toEqual(d);
      expect(d.anomalies.length).toBeLessThanOrEqual((records.events?.length ?? 0) + 1);
    });
  }
  it("the generator reaches every state", () => {
    expect([...seen].sort()).toEqual(
      [
        "acknowledged",
        "active",
        "cancelled",
        "collected",
        "in_progress",
        "on_hold",
        "proposed",
        "resulted",
      ].sort(),
    );
  });
});
