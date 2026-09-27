import type {
  CloseOutDraft,
  CloseOutFacts,
} from "@/app/nurse/resus/[episodeId]/_components/v2/close-out-model";
import type { DeskPayload } from "@/components/emr/desk/model";
import type { MenuTest } from "@/components/emr/orders/model";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { initialDraft } from "@/app/nurse/resus/[episodeId]/_components/v2/use-close-out";
import { outstandingTestsOf } from "@/lib/resus/closeout/handover";
import { standardVisitMidway } from "../../../emr/ui/desk-fixtures";

/**
 * A5 — the close-out's optional "Outstanding tests" (PROMPT §5.12): the stored-payload reader, the
 * picker on the handover step (shown only with a test menu, i.e. under EMR v1), and the desk Plan's
 * "Suggested by the resus handover" group. Static markup; no DOM, no database.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const { HandoverStep } =
  await import("@/app/nurse/resus/[episodeId]/_components/v2/close-out-handover");
const { DeskView } = await import("@/components/emr/desk/desk-view");

const text = (m: string) =>
  m
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&rsquo;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
const RED = /status-critical|\bred-\d|\brose-\d|destructive|#DC2626/i;

const A = "85bce91e-1271-53d4-a176-bc4a95172f45";
const B = "0f3fe0a8-5ada-56d2-a9dc-d1314609d1b4";
const C = "6b303538-8f18-5044-8131-66a1db67bc3e";

const menuTest = (id: string, display: string, favouriteRank: number | null): MenuTest => ({
  id,
  code: `test.${display.toLowerCase()}`,
  display,
  kind: "lab",
  components: [],
  specimenType: null,
  container: null,
  fastingRequired: false,
  ionising: false,
  inHouse: true,
  favouriteRank,
  availability: "unknown",
  restricted: false,
});
const MENU = [menuTest(A, "Troponin", 1), menuTest(B, "Lactate", 2), menuTest(C, "Ferritin", null)];

const facts = {
  outstanding: [],
  devicesDefault: [],
  sbar: { situation: "", background: "", assessment: "", recommendation: "" },
} as unknown as CloseOutFacts;

function step(tests: CloseOutDraft["tests"], menu: MenuTest[] | null) {
  const draft = { ...initialDraft(null), tests };
  return renderToStaticMarkup(h(HandoverStep, { draft, patch: () => {}, facts, menu }));
}

describe("outstandingTestsOf — the stored handover payload", () => {
  it("an older event (no list), a missing payload and a non-list carry none", () => {
    expect(outstandingTestsOf({ sbar: {} })).toEqual([]);
    expect(outstandingTestsOf(null)).toEqual([]);
    expect(outstandingTestsOf({ outstandingTests: "troponin" })).toEqual([]);
  });

  it("keeps ids and trimmed reasons; drops malformed and repeated entries; caps the list", () => {
    expect(
      outstandingTestsOf({
        outstandingTests: [
          { testId: A, reason: "  why  " },
          { testId: B, reason: "   " },
          { testId: A, reason: "repeat" },
          { testId: "troponin" },
          null,
          { testId: C, reason: 7 },
        ],
      }),
    ).toEqual([
      { testId: A, reason: "why" },
      { testId: B, reason: null },
      { testId: C, reason: null },
    ]);
    const many = Array.from({ length: 30 }, () => ({ testId: crypto.randomUUID() }));
    expect(outstandingTestsOf({ outstandingTests: many })).toHaveLength(20);
    expect(
      outstandingTestsOf({ outstandingTests: [{ testId: A, reason: "x".repeat(500) }] })[0]!.reason,
    ).toHaveLength(200);
  });
});

describe("the handover step's Outstanding tests", () => {
  it("absent without a test menu (EMR v1 off): the step looks as before", () => {
    const m = step([], null);
    expect(text(m)).not.toContain("Outstanding tests");
    expect(m).not.toContain('aria-label="Find a test"');
  });

  it("optional: offered from the favourites, and says nothing is ordered here", () => {
    const t = text(step([], MENU));
    expect(t).toContain("Outstanding tests (optional)");
    expect(t).toContain("Nothing is ordered here.");
    expect(t).toContain("Add Troponin");
    expect(t).toContain("Add Lactate");
    // Not a favourite: found by search only.
    expect(t).not.toContain("Add Ferritin");
  });

  it("a chosen test shows with its reason field and Remove, and is not offered again", () => {
    const m = step([{ testId: A, reason: "Chest pain" }], MENU);
    const t = text(m);
    expect(t).toContain("Troponin");
    expect(t).not.toContain("Add Troponin");
    expect(m).toMatch(
      /aria-label="Reason for Troponin \(optional\)"[^>]*maxLength="200"[^>]*value="Chest pain"/,
    );
    expect(m).toContain('aria-label="Remove Troponin"');
    expect(m).not.toMatch(RED);
  });

  it("a chosen test no longer on the menu still reads as a word", () => {
    expect(text(step([{ testId: C, reason: "" }], [MENU[0]!]))).toContain(
      "Test no longer on the menu",
    );
  });
});

describe("the desk Plan: the resus handover's suggestions", () => {
  function plan(p: DeskPayload) {
    return text(
      renderToStaticMarkup(
        h(DeskView, {
          p,
          content: p.draft?.content ?? { sections: {} },
          current: "s01",
          save: { tone: "neutral", text: "Saved 10:42" },
          on: {},
          loaders: { findings: async () => [], terms: async () => [] },
        }),
      ),
    );
  }
  const base = standardVisitMidway();
  const resus = (state: "open" | "accepted" | "dismissed") => ({
    ...base,
    suggestions: [
      ...base.suggestions,
      {
        key: crypto.randomUUID(),
        source: "resus_handover" as const,
        text: "Troponin",
        rationale: "Chest pain before the arrest",
        tests: [{ testId: A, display: "Troponin" }],
        state,
      },
    ],
  });

  it("its own group beside triage's, with accept and dismiss", () => {
    const t = plan(resus("open"));
    expect(t).toContain("Suggested by triage");
    expect(t).toContain("Suggested by the resus handover");
    expect(t).toMatch(
      /Suggested by the resus handover Suggestions, not orders.*Troponin Chest pain before the arrest Order Troponin Dismiss/,
    );
  });

  it("decided: the word, no buttons; no resus group when there is none", () => {
    expect(plan(resus("dismissed"))).toMatch(/Chest pain before the arrest Dismissed/);
    expect(plan(resus("accepted"))).toMatch(/Chest pain before the arrest Ordered/);
    expect(plan(base)).not.toContain("Suggested by the resus handover");
  });
});
