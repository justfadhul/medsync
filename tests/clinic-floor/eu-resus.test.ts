/**
 * D4: triage on the floor sends a Level 1–2 patient straight to a free EU resus space. The action calls
 * ha-eu-stay's send_to_eu_resus only for Level 1–2 with a space chosen; a refusal comes back as words beside the
 * saved triage. The Send to tab offers the spaces at Level 1–2 only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const H = "11111111-1111-4111-8111-111111111111";
const INTAKE = "22222222-2222-4222-8222-222222222222";
const BED = "33333333-3333-4333-8333-333333333333";
const REC = "44444444-4444-4444-8444-444444444444";

const callEdge = vi.fn();
const submitTriageAction = vi.fn();
const chain: Record<string, unknown> = {};
Object.assign(chain, {
  select: () => chain,
  eq: () => chain,
  maybeSingle: async () => ({ data: { hospital_id: H } }),
  upsert: async () => ({ error: null }),
});

vi.mock("@/lib/supabase/edge", () => ({ callEdge }));
vi.mock("@/app/nurse/triage/actions", () => ({ submitTriageAction }));
vi.mock("@/lib/triage/scope", () => ({
  requireTriageScope: async () => ({ hospitalId: H, userId: "nurse", departmentId: "d" }),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from: () => chain }) }));
vi.mock("@/lib/triage/notify", () => ({ notifyTriageOutcome: async () => undefined }));

const { triageOnFloorAction } = await import("@/app/clinic/actions");
const { euResusChoices } = await import("@/lib/clinic-floor/triage-view");
const { EU_RESUS } = await import("@/content/eu/words");

const form = (euBedId: string | null) => {
  const fd = new FormData();
  fd.set("payload", "{}");
  fd.set(
    "floor",
    JSON.stringify({
      clientId: crypto.randomUUID(),
      intakeId: INTAKE,
      recheck: false,
      departmentId: null,
      doctorUserId: null,
      note: null,
      euBedId,
    }),
  );
  return fd;
};

beforeEach(() => {
  callEdge.mockReset().mockResolvedValue({ ok: true, data: {} });
  submitTriageAction.mockReset();
});

describe("triageOnFloorAction — Send to EU resus", () => {
  it("Level 2 with a space: the Edge op, after the saved triage", async () => {
    submitTriageAction.mockResolvedValue({ ok: true, triageRecordId: REC, assignedLevel: 2 });
    const res = await triageOnFloorAction({}, form(BED));
    expect(res).toMatchObject({ ok: true, triageRecordId: REC });
    expect(res.error).toBeUndefined();
    expect(callEdge).toHaveBeenCalledWith(
      "ha-eu-stay",
      expect.objectContaining({
        op: "send_to_eu_resus",
        hospital_id: H,
        intake_id: INTAKE,
        bed_id: BED,
      }),
      "clinic_floor.eu_resus",
    );
    expect(callEdge.mock.calls[0]![1]).not.toHaveProperty("actor");
  });

  it("Level 3 with a space, or Level 2 without one: no Edge call", async () => {
    submitTriageAction.mockResolvedValue({ ok: true, triageRecordId: REC, assignedLevel: 3 });
    await triageOnFloorAction({}, form(BED));
    submitTriageAction.mockResolvedValue({ ok: true, triageRecordId: REC, assignedLevel: 2 });
    await triageOnFloorAction({}, form(null));
    expect(callEdge).not.toHaveBeenCalled();
  });

  it("a refused send keeps the saved triage and says why", async () => {
    submitTriageAction.mockResolvedValue({ ok: true, triageRecordId: REC, assignedLevel: 1 });
    callEdge.mockResolvedValue({ ok: false, error: "Choose a resus space." });
    expect(await triageOnFloorAction({}, form(BED))).toMatchObject({
      ok: true,
      triageRecordId: REC,
      error: "Choose a resus space.",
    });
  });

  it("a triage that did not save sends nothing", async () => {
    submitTriageAction.mockResolvedValue({ error: "Not authorised to triage." });
    await triageOnFloorAction({}, form(BED));
    expect(callEdge).not.toHaveBeenCalled();
  });
});

describe("the Send to tab's EU resus spaces", () => {
  const spaces = [{ bedId: BED, label: "R1", wardName: "EU" }];
  it("are offered at Level 1 and 2 only", () => {
    expect(euResusChoices(1, spaces)).toEqual(spaces);
    expect(euResusChoices(2, spaces)).toEqual(spaces);
    for (const l of [3, 4, 5, null] as const) expect(euResusChoices(l, spaces)).toEqual([]);
  });
  it("read ward · space, and say why they are off offline", () => {
    expect(EU_RESUS.chip("EU", "R1")).toBe("EU · R1");
    expect(EU_RESUS.title).toBe("Send to EU resus");
    expect(EU_RESUS.offline).toBe("Needs a connection");
  });
});
