import { describe, expect, it } from "vitest";

import { DESK } from "@/content/reception/desk";
import { bookingRow, deskSessions, sexOf } from "@/lib/reception/desk/map";

const booking = (over: Partial<Parameters<typeof bookingRow>[0]> = {}) =>
  bookingRow({
    id: "a1",
    status: "confirmed",
    startsAtIso: "2026-11-13T05:00:00Z",
    arrivalWindowStartIso: "2026-11-13T06:00:00Z",
    hereSinceIso: null,
    seen: false,
    departmentId: "d1",
    clinicianName: null,
    patientCode: "TH-000001",
    bookingCode: "K7M42Q",
    confirmedByPatient: true,
    identity: { displayName: null, ageYears: null, sex: null, complaint: null, photoUrl: null },
    provisional: null,
    ...over,
  });

describe("desk map", () => {
  it("maps booking statuses to desk stages and drops cancelled ones", () => {
    expect(booking()?.stage).toBe("expected");
    expect(booking()?.go).toEqual({ st: "coming" });
    expect(booking({ status: "arrived" })?.stage).toBe("here");
    expect(booking({ status: "no_show" })?.stage).toBe("notseen");
    expect(booking({ status: "arrived", seen: true })?.stage).toBe("done");
    expect(booking({ status: "cancelled" })).toBeNull();
  });

  it("never invents a name, sex or age", () => {
    const r = booking()!;
    expect(r.name).toBe(DESK.row.noName);
    expect(r.sex).toBe("?");
    expect(r.age).toBeNull();
    expect(r.time).toBe("09:00"); // the arrival window, in Kampala
    expect(sexOf("female")).toBe("F");
  });

  it("keeps one session per clinic per day", () => {
    const s = {
      departmentId: "d1",
      startsAt: new Date("2026-11-13T05:00:00Z"),
      endsAt: new Date("2026-11-13T09:00:00Z"),
      capacityTotal: 20,
      bookedCount: 4,
      delayMinutes: 0,
      clinician: null,
    };
    const out = deskSessions([
      { id: "s1", ...s },
      { id: "s2", ...s },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: "2026-11-13|d1", sessionId: "s1", st: 8, en: 12 });
  });
});
