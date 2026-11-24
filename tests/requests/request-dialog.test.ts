// @vitest-environment jsdom
import type { RequestDetail } from "@/lib/emr/read/requests";
import type { RequestAct } from "@/lib/requests/engine";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The request dialog (ADR 0537): it says the requesting team stays responsible, shows only the
 * actions the engine allows this viewer, a Decline waits for its reason in words, and opening it
 * records Seen once. Synthetic request only.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
const markRequestSeen = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/emr/actions/requests", () => ({
  markRequestSeen,
  acceptRequestAction: vi.fn(async () => ({ ok: true })),
  declineRequestAction: vi.fn(async () => ({ ok: true })),
  redirectRequestAction: vi.fn(async () => ({ ok: true })),
  cancelRequestAction: vi.fn(async () => ({ ok: true })),
  closeRequestAction: vi.fn(async () => ({ ok: true })),
  replyToRequestAction: vi.fn(async () => ({ ok: true })),
}));
const { RequestDialog } = await import("@/components/requests/request-dialog");

const NO = "This request is not open to that action now.";
function detail(allowed: RequestAct[]): RequestDetail {
  const all: RequestAct[] = ["seen", "accept", "decline", "redirect", "reply", "close", "cancel"];
  return {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "consult",
    urgency: "urgent_today",
    helpWanted: "advice",
    stateWord: "Sent",
    overdue: false,
    dueWords: null,
    patientUserId: "22222222-2222-4222-8222-222222222222",
    encounterId: "33333333-3333-4333-8333-333333333333",
    patientName: "Test Patient",
    mrn: "TEST-001",
    wardName: "Ward A",
    departmentId: "44444444-4444-4444-8444-444444444444",
    departmentName: "Cardiology",
    requesterName: "Dr Requester",
    requesterCadre: "Medical officer",
    questionFirstLine: "Synthetic question",
    askedAtMs: 0,
    mine: true,
    claimed: false,
    restricted: false,
    chart: true,
    question: "Synthetic question",
    problems: ["Problem one"],
    history: [{ atMs: 0, words: "Sent to Dr Recipient" }],
    canAct: Object.fromEntries(all.map((a) => [a, allowed.includes(a) ? true : NO])) as Record<
      RequestAct,
      true | string
    >,
    canOpenChart: true,
  };
}

let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  markRequestSeen.mockClear();
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

const mount = async (d: RequestDetail, departments?: { id: string; name: string }[]) => {
  await act(async () => {
    root.render(
      h(RequestDialog, { detail: d, surface: "doctor", now: 60_000, departments, onClose() {} }),
    );
  });
};
const buttons = (name: string) =>
  [...document.querySelectorAll("button")].filter((b) => b.textContent?.trim() === name);

describe("request dialog", () => {
  it("the dialog says who is responsible", async () => {
    await mount(detail(["seen", "accept", "decline"]));
    expect(document.body.textContent).toContain(
      "The requesting team stays responsible for the patient.",
    );
  });

  it("actions follow canAct", async () => {
    await mount(detail(["accept"]));
    expect(buttons("Accept")).toHaveLength(1);
    expect(buttons("Reply")).toHaveLength(0);
    expect(buttons("Decline")).toHaveLength(0);
    expect(buttons("Cancel request")).toHaveLength(0);
  });

  it("decline needs a reason", async () => {
    await mount(detail(["accept", "decline"]));
    const decline = buttons("Decline")[0] as HTMLButtonElement;
    expect(decline.disabled).toBe(true);
    expect(document.body.textContent).toContain("Choose a reason to decline.");
    const chip = buttons("Not our specialty")[0] as HTMLButtonElement;
    await act(async () => chip.click());
    expect((buttons("Decline")[0] as HTMLButtonElement).disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Choose a reason to decline.");
  });

  it("seen is recorded on open", async () => {
    await mount(detail(["seen", "accept", "decline"]));
    expect(markRequestSeen).toHaveBeenCalledTimes(1);
    expect(markRequestSeen).toHaveBeenCalledWith({
      surface: "doctor",
      requestId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("redirect leaves out the current team by id, not by name", async () => {
    const current = "44444444-4444-4444-8444-444444444444";
    const twin = "55555555-5555-4555-8555-555555555555";
    await mount(detail(["redirect"]), [
      { id: current, name: "Cardiology" },
      { id: twin, name: "Cardiology" },
    ]);
    const values = [...document.querySelectorAll("option")].map((o) => o.value);
    expect(values).toContain(twin);
    expect(values).not.toContain(current);
  });
});
