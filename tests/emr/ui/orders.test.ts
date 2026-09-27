import type { CollectDraft, CollectTarget, OrderDraft } from "@/components/emr/orders/model";
import type { ReactElement } from "react";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  COLLECT_FBC,
  COLLECT_FBG_REJECTED,
  COLLECT_URINE,
  encounterOrders,
  IDENTITY_A,
  LABEL,
  MENU,
  MENU_BY_CODE,
  REASONS,
  rejectedOrderStatusText,
} from "./results-fixtures";

/**
 * Order entry, bedside collection and the label (gate-a E.7, E.8), from the synthetic fixtures:
 * the pure model the islands drive, and the views rendered to static markup. No DOM, no database.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const m = await import("@/components/emr/orders/model");
const { OrderSheetView } = await import("@/components/emr/orders/order-sheet-view");
const { CollectView } = await import("@/components/emr/orders/collect-view");
const { EncounterOrdersView } = await import("@/components/emr/orders/encounter-orders-view");
const { SpecimenLabel, labelName, LABEL_CSS } =
  await import("@/components/emr/orders/specimen-label");

const html = (el: ReactElement) => renderToStaticMarkup(el);
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
const placeButton = (markup: string) =>
  /<button[^>]*>(?:Place order|Place \d+ orders)<\/button>/.exec(markup)?.[0] ?? "";

const toggle = (d: OrderDraft, code: string, reasons = REASONS) =>
  m.draftReducer(d, {
    type: "toggle",
    testId: MENU_BY_CODE[code]!.id,
    clientKey: `key-${code}-000`,
    defaultReasonIds: m.defaultReasonIds(reasons),
  });
const sheet = (draft: OrderDraft, query = "", reasons = REASONS) =>
  html(h(OrderSheetView, { identity: IDENTITY_A, menu: MENU, reasons, draft, query }));

/* ─── The menu ───────────────────────────────────────────────────── */

describe("order entry: the menu", () => {
  it("puts favourites first in their rank; the search narrows the rest", () => {
    const { favourites, rest } = m.menuSections(MENU, "");
    expect(favourites.map((t) => t.code)).toEqual(["MRDT", "FBC", "FBG", "CXR"]);
    expect(rest).toEqual([]);
    expect(m.menuSections(MENU, "urin").rest.map((t) => t.code)).toEqual(["UA"]);
    // A component name finds its panel.
    expect(m.menuSections(MENU, "platel").rest.map((t) => t.code)).toEqual(["FBC"]);
  });

  it("a favourite is a pressed toggle, named in words", () => {
    const markup = sheet(toggle(m.EMPTY_DRAFT, "FBC"));
    expect(markup).toMatch(/aria-pressed="true"[^>]*>.*Full blood count/);
    expect(markup).toMatch(/aria-pressed="false"[^>]*>.*Malaria rapid diagnostic test/);
  });

  it("a panel expands to its components", () => {
    const t = text(sheet(toggle(m.EMPTY_DRAFT, "FBC")));
    expect(t).toMatch(/Includes White cell count Haemoglobin Platelets MCV Neutrophils/);
    expect(text(sheet(m.EMPTY_DRAFT, "blood count"))).toContain("Panel of 5");
  });

  it("names the patient by two identifiers, age and sex", () => {
    const t = text(sheet(m.EMPTY_DRAFT));
    expect(t).toContain("Test Patient A MRN-2026-90001 52 y Female");
  });
});

/* ─── The draft ──────────────────────────────────────────────────── */

describe("order entry: reason required, two taps for a favourite", () => {
  it("a favourite arrives with the primary diagnosis as its reason: tap it, then Place order", () => {
    const d = toggle(m.EMPTY_DRAFT, "MRDT"); // tap 1
    expect(d.lines[0]!.reasonIds).toEqual([REASONS[0]!.id]);
    expect(m.draftReady(d)).toBe(true);
    expect(placeButton(sheet(d))).not.toMatch(/ disabled=""/); // tap 2 is live
    expect(m.toOrderLines(d)).toEqual([
      {
        clientKey: "key-MRDT-000",
        testId: MENU_BY_CODE.MRDT!.id,
        priority: "routine",
        reasonConditionIds: [REASONS[0]!.id],
      },
    ]);
  });

  it("with no diagnosis on the visit, a reason is required before placing", () => {
    const d = toggle(m.EMPTY_DRAFT, "FBC", []);
    expect(m.lineIssue(d.lines[0]!)).toBe(m.REASON_REQUIRED);
    expect(m.draftReady(d)).toBe(false);
    const markup = sheet(d, "", []);
    expect(placeButton(markup)).toMatch(/ disabled=""/);
    expect(text(markup)).toContain(m.REASON_REQUIRED);
    expect(markup).toMatch(/status-caution/);
  });

  it("a short text is a reason; it is trimmed and sent alone", () => {
    let d = toggle(m.EMPTY_DRAFT, "FBC", []);
    d = m.draftReducer(d, { type: "reasonText", testId: d.lines[0]!.testId, text: "  pallor  " });
    expect(m.draftReady(d)).toBe(true);
    expect(m.toOrderLines(d)[0]).toEqual({
      clientKey: "key-FBC-000",
      testId: MENU_BY_CODE.FBC!.id,
      priority: "routine",
      reasonText: "pallor",
    });
  });

  it("unticking the only diagnosis brings the requirement back", () => {
    let d = toggle(m.EMPTY_DRAFT, "MRDT");
    d = m.draftReducer(d, { type: "reason", testId: d.lines[0]!.testId, reasonId: REASONS[0]!.id });
    expect(m.draftReady(d)).toBe(false);
  });

  it("priority is routine, urgent or immediate; a second tap on a test removes it", () => {
    let d = toggle(m.EMPTY_DRAFT, "FBC");
    d = m.draftReducer(d, { type: "priority", testId: d.lines[0]!.testId, priority: "immediate" });
    expect(d.lines[0]!.priority).toBe("immediate");
    expect(text(sheet(d))).toMatch(/Routine Urgent Immediate/);
    expect(toggle(d, "FBC").lines).toEqual([]);
    expect(placeButton(sheet(m.EMPTY_DRAFT))).toMatch(/ disabled=""/);
  });

  it("the fasting marker comes from the test menu", () => {
    expect(text(sheet(toggle(m.EMPTY_DRAFT, "FBG")))).toContain(
      "Fasting sample required (test menu)",
    );
    expect(text(sheet(toggle(m.EMPTY_DRAFT, "FBC")))).toContain("Not required (test menu)");
  });

  it("availability and ionising imaging are amber words that never block", () => {
    const hiv = toggle(m.EMPTY_DRAFT, "HIV");
    const t = text(sheet(hiv));
    expect(t).toContain("Intermittent — check with the laboratory");
    expect(t).toContain("Restricted");
    expect(placeButton(sheet(hiv))).not.toMatch(/ disabled=""/);
    const cxr = text(sheet(toggle(m.EMPTY_DRAFT, "CXR")));
    expect(cxr).toContain("Uses ionising radiation — check pregnancy status before ordering");
  });
});

/* ─── Collection ─────────────────────────────────────────────────── */

const collect = (target: CollectTarget, draft: Partial<CollectDraft> = {}) =>
  html(
    h(CollectView, {
      identity: IDENTITY_A,
      target,
      draft: { ...m.EMPTY_COLLECT, ...draft },
      collectorName: "Sr Test Nurse",
    }),
  );
const saveButton = (markup: string) =>
  /<button[^>]*>Save and print label<\/button>/.exec(markup)?.[0] ?? "";

describe("specimen collection", () => {
  it("requires the two identifiers to be confirmed with the patient", () => {
    expect(m.collectIssues(COLLECT_FBC, m.EMPTY_COLLECT)).toEqual([m.IDENTIFIERS_REQUIRED]);
    const markup = collect(COLLECT_FBC);
    expect(markup).toMatch(/type="checkbox" required=""/);
    expect(text(markup)).toContain("Name and MRN confirmed with the patient (required)");
    expect(text(markup)).toContain("Test Patient A MRN-2026-90001 52 y Female");
    expect(saveButton(markup)).toMatch(/ disabled=""/);
    expect(saveButton(collect(COLLECT_FBC, { identifiersConfirmed: true }))).not.toMatch(
      / disabled=""/,
    );
  });

  it("asks for the fasting chip only when the test needs it; Not sure is stored as unknown", () => {
    expect(text(collect(COLLECT_FBC))).not.toContain("Not fasting");
    const fbg = { identifiersConfirmed: true };
    expect(m.collectIssues(COLLECT_FBG_REJECTED, { ...m.EMPTY_COLLECT, ...fbg })).toEqual([
      m.FASTING_REQUIRED,
    ]);
    expect(text(collect(COLLECT_FBG_REJECTED, fbg))).toMatch(/Fasting Not fasting Not sure/);
    const input = m.toCollectInput(
      COLLECT_FBG_REJECTED,
      { ...m.EMPTY_COLLECT, ...fbg, fastingState: "unknown", fastingHours: "10" },
      "ck-000001",
    );
    expect(input).toMatchObject({ fastingState: "unknown", identifiersConfirmed: true });
    expect(input).not.toHaveProperty("fastingHours"); // hours only travel with "Fasting"
  });

  it("shows the rejection reason and records the collection time in the hospital's zone", () => {
    expect(text(collect(COLLECT_FBG_REJECTED))).toContain("Rejected: haemolysed — recollect");
    const input = m.toCollectInput(
      COLLECT_FBC,
      { ...m.EMPTY_COLLECT, identifiersConfirmed: true, collectedAt: "2026-09-26T10:44" },
      "ck-000002",
    );
    expect(input.collectedAt).toBe("2026-09-26T07:44:00.000Z");
    expect(text(collect(COLLECT_FBC))).toContain("by Sr Test Nurse");
  });

  it("offers a container only when the test menu names none", () => {
    expect(text(collect(COLLECT_FBC))).not.toContain("Lithium heparin");
    const urine = collect(COLLECT_URINE, { identifiersConfirmed: true });
    expect(text(urine)).toContain("Lithium heparin");
    expect(saveButton(urine)).toMatch(/ disabled=""/);
    const d = { ...m.EMPTY_COLLECT, identifiersConfirmed: true, container: "unknown" };
    expect(m.collectIssues(COLLECT_URINE, d)).toEqual([]);
    expect(m.toCollectInput(COLLECT_URINE, d, "ck-000003")).toMatchObject({ container: "unknown" });
  });
});

/* ─── Rejection back on the ward, and the label ──────────────────── */

describe("rejection and labels", () => {
  it("a rejected specimen returns the order to To collect with the reason, in amber", () => {
    expect(rejectedOrderStatusText()).toBe("Rejected: haemolysed — recollect");
    const markup = html(
      h(EncounterOrdersView, {
        identity: IDENTITY_A,
        orders: encounterOrders(),
        labelHref: (id: string) => `/label/${id}`,
        onCollect: () => {},
        onTranscribe: () => {},
      }),
    );
    expect(markup).toMatch(/data-tone="caution"[^>]*>.*?Rejected: haemolysed — recollect<\/span>/);
    // The rejected order offers collection again; the collected one offers its label.
    expect(text(markup)).toMatch(/Fasting blood glucose .*Collect specimen/);
    expect(markup).toContain(`href="/label/`);
    expect(text(markup)).toContain("Enter report"); // imaging: transcribe the report
  });

  it("the label carries two identifiers, age and sex, the test, container and time", () => {
    const t = text(html(h(SpecimenLabel, { data: LABEL })));
    expect(t).toContain("A, Test Patient"); // surname first, in capitals
    expect(labelName("Amina Nakato")).toBe("NAKATO, Amina");
    for (const s of ["MRN-2026-90001", "52 y", "Female", "Full blood count", "EDTA", "10:44"])
      expect(t).toContain(s);
    expect(t).toContain("Req R-0001234");
    expect(LABEL_CSS).toMatch(/@page \{ size: 60mm 30mm/);
  });

  it("no order or collection view paints red", () => {
    const all = [
      sheet(toggle(toggle(m.EMPTY_DRAFT, "HIV"), "CXR")),
      collect(COLLECT_FBG_REJECTED),
      html(h(EncounterOrdersView, { identity: IDENTITY_A, orders: encounterOrders() })),
    ].join("");
    expect(all).not.toMatch(/status-critical|red-\d|rose-\d/);
  });
});
