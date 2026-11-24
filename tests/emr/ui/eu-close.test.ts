// @vitest-environment jsdom
import type { DeskPayload } from "@/components/emr/desk/model";
import type { PlanDraft } from "@/lib/clerking/plan/draft";
import type { CloseContext } from "@/lib/emr/read/close";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { standardVisitMidway } from "./desk-fixtures";

/** Observe in EU at the close: Send to EU, prefilled from the Plan, gated by words (ADR 0541). */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const { CloseVisitView } = await import("@/components/emr/desk/close-visit");

const EU = "00000000-0000-4000-8000-0000000000e1";
const ENC = "00000000-0000-4000-8000-00000000e001";
const PAT = "00000000-0000-4000-8000-00000000a001";
const ok = <T>(data: T) => ({
  ok: true as const,
  id: "x",
  serverTime: "2026-11-24T08:00:00Z",
  data,
});
const plan: PlanDraft = { disposition: { kind: "observe_eu", ward: "OPD EU", wardId: EU } };

const payload = (
  eu: CloseContext["eu"],
): DeskPayload & { close: NonNullable<DeskPayload["close"]> } => {
  const p = standardVisitMidway();
  return {
    ...p,
    encounter: { ...p.encounter, id: ENC, patientUserId: PAT, open: true, state: "in_progress" },
    close: {
      wards: [],
      bedsLive: true,
      summaryLive: false,
      takeHome: [],
      closed: null,
      summary: null,
      eu,
    },
  };
};
const WARDS = [{ id: EU, name: "OPD EU", where: "Outpatients", counts: null }];

describe("Send to EU at the close", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const sendToEu = vi.fn();
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    sendToEu.mockReset();
    sendToEu.mockResolvedValue(ok({ stayId: "s1", bed: null }));
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });
  const show = (eu: CloseContext["eu"]) =>
    act(async () =>
      root.render(
        h(CloseVisitView, {
          p: payload(eu),
          plan,
          surface: "doctor",
          onChanged() {},
          actions: {
            sendToEu,
            wardBeds: async () => ok({ doc: null, beds: [] }),
          } as never,
        }),
      ),
    );
  const button = (t: string) =>
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === t);

  it("live: Send to EU is disabled with its words; a wait reason enables it and sends", async () => {
    await show({ live: true, wards: WARDS, stay: null });
    const send = button("Send to EU") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(document.body.textContent).toContain(
      "Choose a space, or say why the patient waits for one.",
    );
    const floor = [...document.querySelectorAll("label")].find(
      (l) => l.textContent?.trim() === "On the floor",
    )!;
    await act(async () => (floor.querySelector("input") as HTMLInputElement).click());
    expect((button("Send to EU") as HTMLButtonElement).disabled).toBe(false);
    await act(async () => (button("Send to EU") as HTMLButtonElement).click());
    expect(sendToEu).toHaveBeenCalledTimes(1);
    expect(sendToEu.mock.calls[0]![0]).toMatchObject({
      surface: "doctor",
      patientUserId: PAT,
      encounterId: ENC,
      wardId: EU,
      waitReason: "floor",
    });
  });

  it("not live: the old caution line, no Send to EU", async () => {
    await show({ live: false, wards: [], stay: null });
    expect(button("Send to EU")).toBeUndefined();
    expect(document.body.textContent).toContain(
      "The Plan says Observe in EU: this visit stays open",
    );
  });

  it("a stay already open: its line shows, and Send to EU does not", async () => {
    await show({
      live: true,
      wards: WARDS,
      stay: {
        stayId: "s1",
        wardName: "OPD EU",
        bedLabel: "3",
        status: "in_space",
        arriving: false,
        since: "2026-11-24T07:05:00Z",
        boarding: false,
        admit: null,
      },
    });
    expect(button("Send to EU")).toBeUndefined();
    expect(document.body.textContent).toMatch(/In OPD EU · 3 since \d\d:\d\d/);
  });

  it("with a stay open, Admit is enabled and its footer says Admit and close visit", async () => {
    await show({
      live: true,
      wards: WARDS,
      stay: {
        stayId: "s1",
        wardName: "OPD EU",
        bedLabel: "3",
        status: "in_space",
        arriving: false,
        since: "2026-11-24T07:05:00Z",
        boarding: false,
        admit: null,
      },
    });
    const chip = [...document.querySelectorAll("label")].find((l) =>
      /Admitted/.test(l.textContent ?? ""),
    )!;
    await act(async () => (chip.querySelector("input") as HTMLInputElement).click());
    expect(button("Admit and close visit")).toBeDefined();
  });

  it("boarding: the stay line says Admitted, the ward and how long the patient has waited", async () => {
    await show({
      live: true,
      wards: WARDS,
      stay: {
        stayId: "s1",
        wardName: "OPD EU",
        bedLabel: "3",
        status: "in_space",
        arriving: false,
        since: "2026-11-24T07:05:00Z",
        boarding: true,
        admit: { wardName: "Ward 4", since: "2020-01-01T00:00:00Z" },
      },
    });
    expect(document.body.textContent).toMatch(/Admitted · Ward 4 · waiting \d/);
  });
});
