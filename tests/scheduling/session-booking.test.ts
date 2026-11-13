import { describe, expect, it } from "vitest";

import {
  arrivalWindow,
  BOOKING_CODE_ALPHABET,
  BOOKING_CODE_NEW_ALPHABET,
  bookingCode,
  normalizeBookingCode,
} from "@/supabase/functions/_shared/slots";

/** Gate C helpers (ADR 0088). Pure, so no DB. */

describe("bookingCode", () => {
  it("is six characters from the unambiguous alphabet", () => {
    expect(BOOKING_CODE_ALPHABET).toHaveLength(32);
    for (const c of "0O1I") expect(BOOKING_CODE_ALPHABET).not.toContain(c);
    const code = bookingCode(Math.random);
    expect(code).toHaveLength(6);
    for (const c of code) expect(BOOKING_CODE_ALPHABET).toContain(c);
  });

  it("makes new codes without L (D-RD-10); old codes with L stay accepted", () => {
    expect(BOOKING_CODE_NEW_ALPHABET).toHaveLength(31);
    for (const c of "0O1IL") expect(BOOKING_CODE_NEW_ALPHABET).not.toContain(c);
    for (let i = 0; i < 200; i++) expect(bookingCode(Math.random)).not.toMatch(/[0O1IL]/);
    expect(BOOKING_CODE_ALPHABET).toContain("L");
  });

  it("looks a code up ignoring case, spaces and dashes", () => {
    expect(normalizeBookingCode(" k7m-42q ")).toBe("K7M42Q");
    expect(normalizeBookingCode("K7M 42Q")).toBe("K7M42Q");
  });

  it("is a pure function of the injected random source", () => {
    const seq = [0, 0.5, 0.999, 1 / 31, 30 / 31, 0.25];
    const source = () => {
      let i = 0;
      return () => seq[i++ % seq.length] as number;
    };
    expect(bookingCode(source())).toBe("AS9B9H");
    expect(bookingCode(source())).toBe(bookingCode(source()));
  });
});

describe("arrivalWindow", () => {
  // 08:00-12:00 EAT, 36 bookable places → a 400/6-minute pace... use a round
  // one: 4 hours / 8 places = 30-minute windows.
  const session = {
    sessionStartsAt: "2026-09-22T05:00:00Z",
    sessionEndsAt: "2026-09-22T09:00:00Z",
    capacityBooked: 8,
    overbookingFactor: 1,
  };
  const at = (iso: string) => new Date(iso).getTime();

  it("position 1 starts at the session start and spans two paces", () => {
    const w = arrivalWindow({ ...session, position: 1 });
    expect(w.start.toISOString()).toBe("2026-09-22T05:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-09-22T06:00:00.000Z");
  });

  it("a middle position is centred on position × pace, half a pace early", () => {
    const w = arrivalWindow({ ...session, position: 4 });
    // pace 30 min; centre = start + 3 × 30 = 06:30Z; window 06:15Z-07:15Z
    expect(w.start.toISOString()).toBe("2026-09-22T06:15:00.000Z");
    expect(w.end.toISOString()).toBe("2026-09-22T07:15:00.000Z");
  });

  it("is monotonic in position and never past the session end", () => {
    let prev = arrivalWindow({ ...session, position: 1 });
    for (let p = 2; p <= 12; p++) {
      const w = arrivalWindow({ ...session, position: p });
      expect(w.start.getTime()).toBeGreaterThanOrEqual(prev.start.getTime());
      expect(w.end.getTime()).toBeGreaterThanOrEqual(prev.end.getTime());
      expect(w.end.getTime()).toBeLessThanOrEqual(at(session.sessionEndsAt));
      expect(w.start.getTime()).toBeLessThanOrEqual(w.end.getTime());
      prev = w;
    }
  });

  it("overbooking widens the pace count and narrows each window", () => {
    const plain = arrivalWindow({ ...session, position: 2 });
    const over = arrivalWindow({ ...session, overbookingFactor: 1.5, position: 2 });
    expect(over.end.getTime() - over.start.getTime()).toBeLessThan(
      plain.end.getTime() - plain.start.getTime(),
    );
  });

  it("accepts Date instants as well as ISO strings", () => {
    const w = arrivalWindow({
      ...session,
      sessionStartsAt: new Date(session.sessionStartsAt),
      sessionEndsAt: new Date(session.sessionEndsAt),
      position: 1,
    });
    expect(w.start.toISOString()).toBe("2026-09-22T05:00:00.000Z");
  });
});
