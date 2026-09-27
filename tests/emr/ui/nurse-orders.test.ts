// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EncounterOrderRow } from "@/components/emr/orders/model";
import type { ReactElement } from "react";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adultOpdFever, deceasedEmergency } from "./fixtures";
import { COLLECT_FBC, encounterOrders, IDENTITY_A, PATIENT } from "./results-fixtures";

/**
 * The nurse chart's orders panel (STOP 5–6 open item): the visit's orders with specimen
 * collection and the label, never ordering or transcription (D-EMR-16); mounted only inside the
 * EMR v1 gate, so the flag-off page is the pre-EMR page.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push() {} }) }));
const collectSpecimen = vi.fn();
vi.mock("@/lib/emr/actions/orders", () => ({ collectSpecimen }));

const { NurseOrdersPanel, nurseLabelHref } =
  await import("@/app/nurse/patients/[patientId]/_orders/nurse-orders-panel");
const { ChartView } = await import("@/components/emr/chart/chart-view");
const { COLLECTING_CADRES, NURSE_CADRES, ORDERING_CADRES } = await import("@/lib/emr/write/orders");

const ENC = "00000000-0000-4000-8000-00000000e001";
const toCollect: EncounterOrderRow = {
  id: COLLECT_FBC.orderId,
  display: COLLECT_FBC.display,
  kind: "lab",
  priority: "urgent",
  orderedAtIso: "2026-09-26T07:10:00Z",
  requesterName: "Dr Test Clinician",
  statusText: "To collect",
  caution: false,
  restricted: false,
  collect: COLLECT_FBC,
  specimenId: null,
  canTranscribe: true,
};
const orders = [toCollect, ...encounterOrders()];
const panel = () =>
  h(NurseOrdersPanel, {
    encounterId: ENC,
    patientUserId: PATIENT.A,
    identity: IDENTITY_A,
    orders,
    timeZone: "Africa/Kampala",
    collectorName: "Nurse Test",
  });
const html = (el: ReactElement) => renderToStaticMarkup(el);
const buttons = (m: string) => [...m.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((x) => x[1]);

describe("nurse orders panel: what the nurse sees", () => {
  it("offers collection and the label, never ordering or transcription", () => {
    const m = html(panel());
    const b = buttons(m);
    expect(b.filter((x) => x === "Collect specimen")).toHaveLength(2); // FBC to collect + FBG recollect
    expect(b).not.toContain("Order a test");
    expect(b).not.toContain("Enter paper result");
    expect(b).not.toContain("Enter report");
    // The collected FBC's label, on the nurse's own route (a /doctor link would not open for her).
    expect(m).toContain(
      `href="${nurseLabelHref(PATIENT.A, ENC, encounterOrders()[1]!.specimenId!)}"`,
    );
    expect(m).not.toContain("/doctor/");
  });

  it("the label route carries the visit in its path (the print form's GET keeps it)", () => {
    expect(nurseLabelHref("p", "e", "s")).toBe("/nurse/patients/p/label/e/s");
  });
});

describe("nurse orders panel: collecting", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    collectSpecimen.mockReset();
    refresh.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  const click = (el: Element | null | undefined) => act(async () => (el as HTMLElement).click());
  const byText = (text: string) =>
    [...document.querySelectorAll("button, a")].find((e) => e.textContent?.trim() === text);

  it("saves as the nurse surface, one key per intent: a failed save retries with the same key", async () => {
    await act(async () => root.render(panel()));
    await click(byText("Collect specimen"));
    const confirm = document.querySelector<HTMLInputElement>('input[type="checkbox"][required]');
    expect(confirm).toBeTruthy();
    await click(confirm);

    collectSpecimen.mockRejectedValueOnce(new Error("offline"));
    collectSpecimen.mockResolvedValueOnce({ ok: true, id: "spec-1" });
    await click(byText("Save and print label"));
    expect(document.body.textContent).toContain("may already be recorded");
    await click(byText("Save and print label"));

    expect(collectSpecimen).toHaveBeenCalledTimes(2);
    const [first, second] = collectSpecimen.mock.calls.map((c) => c[0]);
    expect(first).toMatchObject({
      surface: "nurse",
      patientUserId: PATIENT.A,
      orderId: COLLECT_FBC.orderId,
      identifiersConfirmed: true,
    });
    expect(second.clientKey).toBe(first.clientKey);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The sheet now offers the new specimen's label on the nurse route.
    const labels = [...document.querySelectorAll("a")]
      .filter((a) => a.textContent?.trim() === "Print label")
      .map((a) => a.getAttribute("href"));
    expect(labels).toContain(nurseLabelHref(PATIENT.A, ENC, "spec-1"));
  });

  it("a refused save says why and prints no label", async () => {
    await act(async () => root.render(panel()));
    await click(byText("Collect specimen"));
    await click(document.querySelector('input[type="checkbox"][required]'));
    collectSpecimen.mockResolvedValueOnce({
      ok: false,
      error: "Your cadre may not collect specimens.",
    });
    await click(byText("Save and print label"));
    expect(document.body.textContent).toContain("Your cadre may not collect specimens.");
    expect(byText("Save and print label")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("nurse orders: the permission matrix it relies on (D-EMR-16)", () => {
  it("every nurse cadre may collect and none may order", () => {
    for (const c of NURSE_CADRES) {
      expect(COLLECTING_CADRES).toContain(c);
      expect(ORDERING_CADRES).not.toContain(c);
    }
  });
});

describe("the chart's orders slot", () => {
  const slot = h("p", { "data-testid": "nurse-orders" }, "SLOT");
  it("shows the panel under Orders", () => {
    const m = html(
      h(ChartView, { payload: adultOpdFever().payload, section: "orders", ordersPanel: slot }),
    );
    expect(m).toContain("SLOT");
  });
  it("withholds it after a recorded death, with the other clinical actions", () => {
    const m = html(
      h(ChartView, { payload: deceasedEmergency().payload, section: "orders", ordersPanel: slot }),
    );
    expect(m).not.toContain("SLOT");
  });
  it("without a slot the chart renders as before (the doctor chart passes none)", () => {
    const m = html(h(ChartView, { payload: adultOpdFever().payload, section: "orders" }));
    expect(m).not.toContain("SLOT");
    expect(m).toContain("Orders");
  });
});

describe("flag off: the nurse page is the pre-EMR page", () => {
  const src = readFileSync(
    resolve(process.cwd(), "app/nurse/patients/[patientId]/page.tsx"),
    "utf8",
  );
  it("NurseOrders is mounted only inside the emrV1LiveFor early return", () => {
    const body = src.replace(/^import[\s\S]*?;$/gm, "");
    const start = body.indexOf("if (emrV1LiveFor(");
    expect(start).toBeGreaterThan(-1);
    let i = body.indexOf("{", body.indexOf("))", start));
    for (let depth = 0; i < body.length; i++) {
      if (body[i] === "{") depth++;
      else if (body[i] === "}" && --depth === 0) break;
    }
    const gate = body.slice(start, i + 1);
    const outside = body.slice(0, start) + body.slice(i + 1);
    expect(gate).toContain("<NurseOrders");
    for (const id of ["NurseOrders", "EmrChart", "loadChart"]) expect(outside).not.toContain(id);
  });
});
