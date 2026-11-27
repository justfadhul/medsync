import type { EuStayInput } from "@/lib/eu/board";
import { describe, expect, it } from "vitest";

import { euTracking } from "@/lib/eu/board";

const NOW = Date.parse("2026-11-24T12:00:00Z");
const H = 3_600_000;
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const stay = (o: Partial<EuStayInput> = {}): EuStayInput => ({
  stayId: "s1",
  patientUserId: "p1",
  wardId: "w1",
  status: "in_space",
  decidedAt: iso(-2 * H),
  hospitalArrivedAt: null,
  spaceStartedAt: iso(-H),
  arriving: false,
  bedLabel: "R1",
  level: 2,
  obsFrequency: null,
  lastObsAt: null,
  resultsReady: false,
  admission: null,
  resusEpisodeId: null,
  waitReason: null,
  name: null,
  mrn: null,
  ...o,
});
const codes = (s: EuStayInput) => euTracking([s], NOW, 24).needsAttention.map((a) => a.code);

describe("EU tracking rows", () => {
  it("over the limit is a flag, never a move: listed with words", () => {
    const { rows, needsAttention } = euTracking([stay({ decidedAt: iso(-25 * H) })], NOW, 24);
    expect(rows[0]!.overLimit).toBe(true);
    expect(needsAttention).toContainEqual({
      stayId: "s1",
      code: "over_limit",
      words: "In the EU over 24 h",
    });
  });
  it("Arriving over 1 h, boarding over 12 h, obs overdue, waiting for a space", () => {
    const arr = (ms: number) => stay({ arriving: true, spaceStartedAt: iso(-ms) });
    expect(codes(arr(H))).not.toContain("arriving_long");
    expect(codes(arr(H + 60_000))).toContain("arriving_long");
    const board = (ms: number) =>
      stay({ admission: { wardName: "M3", decidedAt: iso(-ms), status: "awaiting_bed" } });
    expect(codes(board(12 * H))).not.toContain("boarding_long");
    expect(codes(board(12 * H + 60_000))).toContain("boarding_long");
    expect(codes(stay({ obsFrequency: "hourly", lastObsAt: iso(-H - 60_000) }))).toContain(
      "obs_overdue",
    );
    expect(codes(stay({ obsFrequency: "hourly", lastObsAt: iso(-H) }))).not.toContain(
      "obs_overdue",
    );
    expect(
      codes(stay({ status: "awaiting_space", spaceStartedAt: null, waitReason: "floor" })),
    ).toContain("waiting_space");
  });
  it("hourly obs: due an hour after the last; continuous has no due time", () => {
    const last = iso(-30 * 60_000);
    expect(
      euTracking([stay({ obsFrequency: "hourly", lastObsAt: last })], NOW, 24).rows[0]!
        .nextObsDueAt,
    ).toBe(iso(30 * 60_000));
    expect(
      euTracking([stay({ obsFrequency: "continuous" })], NOW, 24).rows[0]!.nextObsDueAt,
    ).toBeNull();
    // never observed: counted from the decision
    expect(euTracking([stay({ obsFrequency: "4h" })], NOW, 24).rows[0]!.nextObsDueAt).toBe(
      iso(-2 * H + 4 * H),
    );
  });
  it("status words", () => {
    const w = (s: EuStayInput) => euTracking([s], NOW, 24).rows[0]!.statusWord;
    expect(w(stay({ status: "awaiting_space", spaceStartedAt: null }))).toBe("Waiting for a space");
    expect(w(stay({ arriving: true }))).toBe("Arriving");
    expect(w(stay())).toBe("In EU");
    expect(
      w(stay({ admission: { wardName: "M3", decidedAt: iso(-H), status: "awaiting_bed" } })),
    ).toBe("Admitted · M3 · waiting for a ward bed");
    expect(
      w(stay({ admission: { wardName: "M3", decidedAt: iso(-H), status: "cancelled" } })),
    ).toBe("Admission ended · in EU");
  });
  it("sorts waiting for a space first, then by decision time", () => {
    const rows = euTracking(
      [
        stay({ stayId: "a", decidedAt: iso(-3 * H) }),
        stay({ stayId: "b", status: "awaiting_space", spaceStartedAt: null, decidedAt: iso(-H) }),
        stay({ stayId: "c", decidedAt: iso(-4 * H) }),
      ],
      NOW,
      24,
    ).rows.map((r) => r.stayId);
    expect(rows).toEqual(["b", "c", "a"]);
  });
});
