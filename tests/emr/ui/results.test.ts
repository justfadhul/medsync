import type {
  AckDraft,
  CommDraft,
  EntryComponent,
  EntryLine,
  EntryState,
  ReviewItem,
} from "@/components/emr/results/model";
import type { ReactElement } from "react";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ENTRY_CXR,
  ENTRY_FBC_LAB,
  ENTRY_FBC_TRANSCRIBED,
  ENTRY_MRDT,
  ENTRY_RELEASED_CRITICAL,
  FBC_COMPONENTS,
  LAB_ITEMS,
  PATIENT,
  reviewItems,
  STAFF,
} from "./results-fixtures";

/**
 * Result entry, review and the critical-call record (gate-a E.9, E.10), from the synthetic
 * fixtures. The unit numbers exercised are the signed D-CFC-14 triggers and the unit table only.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const r = await import("@/components/emr/results/model");
const { ResultEntryView } = await import("@/components/emr/results/result-entry-view");
const { ReviewView } = await import("@/components/emr/results/review-view");
const { CriticalCommView } = await import("@/components/emr/results/critical-comm-view");
const { LabWorklistView } = await import("@/components/emr/results/lab-worklist-view");

const html = (el: ReactElement) => renderToStaticMarkup(el);
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&rsquo;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/\s+/g, " ")
    .trim();
const button = (markup: string, label: string) =>
  new RegExp(`<button[^>]*>${label}</button>`).exec(markup)?.[0] ?? "";
const DISABLED = / disabled=""/;

const [wbc, hb] = FBC_COMPONENTS as [EntryComponent, EntryComponent];
const line = (c: EntryComponent, patch: Partial<EntryLine> = {}): EntryLine => ({
  ...r.emptyLine(c),
  ...patch,
});
const state = (lines: Record<string, EntryLine> = {}, over: Partial<EntryState> = {}) => ({
  lines,
  uncatalogued: [],
  conclusionCode: null,
  conclusionText: "",
  reasonText: "",
  ...over,
});
const entryView = (
  data = ENTRY_FBC_LAB,
  s: EntryState = state(),
  phase: "enter" | "released" | "amend" = "enter",
) => html(h(ResultEntryView, { data, state: s, phase }));

/* ─── Entry ──────────────────────────────────────────────────────── */

describe("result entry: comparators and units", () => {
  it("keeps a comparator as typed, never dropping it", () => {
    expect(r.checkLine(wbc, line(wbc, { value: "<20" })).error).toBeNull();
    const values = r.toResultValues(
      FBC_COMPONENTS,
      state({ "obs.wbc": line(wbc, { value: "<20" }) }),
    );
    expect(values).toEqual([{ conceptId: "obs.wbc", value: "<20", unit: "10*9/L" }]);
    expect(r.checkLine(wbc, line(wbc, { value: "twelve" })).error).toMatch(/comparator/);
  });

  it("defaults each unit from the test menu, and offers the convertible ones", () => {
    expect(r.emptyLine(hb).unit).toBe("g/dL");
    expect(r.unitOptions(hb)).toEqual(["g/dL", "g/L"]);
    expect(r.unitOptions(wbc)).toEqual(["10*9/L"]);
  });

  it("the unit-mismatch prompt asks and never rejects", () => {
    const asked = r.checkLine(hb, line(hb, { value: "108" }));
    expect(asked.error).toBeNull();
    expect(asked.ask).toEqual({ question: "Is this g/L?", otherUnit: "g/L" });
    const s = state({ "obs.haemoglobin": line(hb, { value: "108" }) });
    expect(r.entryIssues("lab", FBC_COMPONENTS, s)).toEqual([
      "Haemoglobin: Is this g/L? Answer to save.",
    ]);
    const markup = entryView(ENTRY_FBC_LAB, s);
    expect(text(markup)).toMatch(/Is this g\/L\? Keep g\/dL It is g\/L/);
    // Either answer clears it: keep the unit (confirmed), or switch to the other unit.
    expect(r.checkLine(hb, line(hb, { value: "108", unitConfirmed: true })).ask).toBeNull();
    expect(r.checkLine(hb, line(hb, { value: "108", unit: "g/L" })).ask).toBeNull();
    const kept = r.toResultValues(FBC_COMPONENTS, {
      ...s,
      lines: { "obs.haemoglobin": line(hb, { value: "108", unitConfirmed: true }) },
    });
    expect(kept[0]).toMatchObject({ value: "108", unit: "g/dL", unitConfirmed: true });
  });

  it("records the laboratory's own range and flag per result", () => {
    const l = line(wbc, { value: "12.4", low: "4", high: "11", flag: "H" });
    expect(r.toResultValues(FBC_COMPONENTS, state({ "obs.wbc": l }))[0]).toEqual({
      conceptId: "obs.wbc",
      value: "12.4",
      unit: "10*9/L",
      referenceRange: { low: 4, high: 11, unit: "10*9/L" },
      labInterpretation: "H",
    });
    expect(r.checkLine(wbc, line(wbc, { value: "5", low: "11", high: "4" })).error).toMatch(
      /low end is above its high end/,
    );
  });

  it("plausibility shows nothing while no bound is signed; a signed one is said in words", () => {
    expect(r.checkLine(hb, line(hb, { value: "99999", unitConfirmed: true }))).toEqual({
      error: null,
      ask: null,
      unusual: false,
    });
    const signed = {
      ...hb,
      bounds: [
        { ruleId: "TEST-SOFT", bound: "soft" as const, side: "high" as const, limit: 20 },
        { ruleId: "TEST-HARD", bound: "hard" as const, side: "high" as const, limit: 40 },
      ],
    };
    expect(r.checkLine(signed, line(signed, { value: "25" })).unusual).toBe(true);
    expect(r.checkLine(signed, line(signed, { value: "45", unitConfirmed: true })).error).toMatch(
      /not physically possible/,
    );
    // Said in words; the bound itself never reaches the screen.
    const withBounds = { ...ENTRY_FBC_LAB, components: [signed] };
    const t = text(
      entryView(withBounds, state({ "obs.haemoglobin": line(signed, { value: "25" }) })),
    );
    expect(t).toContain("Unusual value — check it before saving");
    expect(t).not.toMatch(/\b20\b|\b40\b/);
    expect(
      text(entryView(ENTRY_FBC_LAB, state({ "obs.haemoglobin": line(hb, { value: "25" }) }))),
    ).not.toContain("Unusual value");
  });

  it("an uncatalogued test is entered as typed and labelled for decision support", () => {
    const s = state({}, { uncatalogued: [{ key: "u1", name: "Widal", value: "1:160", unit: "" }] });
    expect(r.toResultValues(FBC_COMPONENTS, s)).toEqual([
      { conceptId: "obs.uncatalogued", name: "Widal", value: "1:160" },
    ]);
    expect(text(entryView(ENTRY_FBC_LAB, s))).toContain(
      "Uncatalogued — not read by decision support",
    );
    const nameless = state({}, { uncatalogued: [{ key: "u2", name: "", value: "7", unit: "" }] });
    expect(r.entryIssues("lab", FBC_COMPONENTS, nameless)).toContain(
      "An uncatalogued result needs its test name.",
    );
  });
});

describe("result entry: one screen per panel, modes and statuses", () => {
  it("five analytes on one screen, with both identifiers and the requisition", () => {
    const t = text(entryView());
    for (const c of FBC_COMPONENTS) expect(t).toContain(c.display);
    expect(t).toContain("Test Patient A MRN-2026-90001 52 y Female Req R-0001234 Urgent");
  });

  it("the laboratory enters directly: save a preliminary, or release the final", () => {
    const empty = entryView();
    expect(text(empty)).toContain("Entry Direct, laboratory");
    expect(button(empty, "Release final")).toMatch(DISABLED);
    const filled = entryView(ENTRY_FBC_LAB, state({ "obs.wbc": line(wbc, { value: "7.2" }) }));
    expect(button(filled, "Save preliminary")).not.toMatch(DISABLED);
    expect(button(filled, "Release final")).not.toMatch(DISABLED);
  });

  it("a clinician transcribes a paper report, and the screen says so", () => {
    const m = entryView(ENTRY_FBC_TRANSCRIBED, state({ "obs.wbc": line(wbc, { value: "7.2" }) }));
    expect(text(m)).toContain("Entry Transcribed from a paper report");
    expect(button(m, "Save transcribed result")).not.toMatch(DISABLED);
    expect(m).not.toContain("Save preliminary");
  });

  it("a coded result is a choice of its answers", () => {
    const t = text(entryView(ENTRY_MRDT));
    expect(t).toMatch(/Malaria test Positive Negative/);
    expect(
      r.toResultValues(
        ENTRY_MRDT.components,
        state({ "obs.malaria_test": { ...line(ENTRY_MRDT.components[0]!), code: "positive" } }),
      ),
    ).toEqual([{ conceptId: "obs.malaria_test", code: "positive", labInterpretation: undefined }]);
  });

  it("imaging takes a coded conclusion and report text; the final needs the conclusion", () => {
    expect(r.entryIssues("imaging", [], state())).toEqual(["Choose the conclusion."]);
    expect(r.entryIssues("imaging", [], state({}, { conclusionCode: "abnormal" }))).toEqual([]);
    const t = text(entryView(ENTRY_CXR));
    expect(t).toMatch(/Enter report — Chest X-ray/);
    expect(t).toMatch(/Conclusion Normal Abnormal Indeterminate Report text/);
  });

  it("a released result is read, then amended with a reason", () => {
    const released = entryView(
      ENTRY_RELEASED_CRITICAL,
      state(ENTRY_RELEASED_CRITICAL.report!.lines),
      "released",
    );
    expect(text(released)).toContain("Released (final)");
    expect(button(released, "Amend result")).not.toMatch(DISABLED);
    const s = state(ENTRY_RELEASED_CRITICAL.report!.lines);
    expect(r.entryIssues("lab", ENTRY_RELEASED_CRITICAL.components, s, { amending: true })).toEqual(
      ["Say why the result is amended."],
    );
    expect(
      r.entryIssues(
        "lab",
        ENTRY_RELEASED_CRITICAL.components,
        { ...s, reasonText: "Wrong sample" },
        {
          amending: true,
        },
      ),
    ).toEqual([]);
  });

  it("entry never paints a value critical", () => {
    const m = entryView(
      ENTRY_RELEASED_CRITICAL,
      state(ENTRY_RELEASED_CRITICAL.report!.lines),
      "released",
    );
    expect(m).not.toMatch(/status-critical/);
  });
});

/* ─── Review ─────────────────────────────────────────────────────── */

const review = (selected: Set<string> = new Set(), draft: Partial<AckDraft> = {}) =>
  html(
    h(ReviewView, {
      items: r.sortReview(reviewItems()),
      selected,
      draft: { action: "seen", note: "", forwardedToUserId: "", ...draft },
      staff: STAFF,
      timeZone: "Africa/Kampala",
    }),
  );

describe("results to review", () => {
  it("critical first, then amended, then whoever has waited longest", () => {
    expect(r.sortReview(reviewItems()).map((i) => i.test)).toEqual([
      "Urea, electrolytes and creatinine",
      "Creatinine",
      "Chest X-ray",
      "Malaria rapid diagnostic test (mRDT)",
      "Potassium (as shipped: no signed entry)",
    ]);
  });

  it("an amended result says 'Amended — acknowledge again' in amber", () => {
    const m = review();
    expect(m).toMatch(/data-tone="caution"[^>]*>.*?Amended — acknowledge again<\/span>/);
    expect(r.reviewWords({ state: "needs_review" })).toBe("Awaiting acknowledgement");
  });

  it("the critical style appears only when the payload says critical", () => {
    const items = reviewItems();
    const signed = items.find((i) => i.reportId.endsWith("603"))!;
    const shipped = items.find((i) => i.reportId.endsWith("604"))!;
    expect(signed.values[0]!.critical).toBe(true); // a TEST-ONLY signed entry matched
    expect(shipped.values[0]!.critical).toBe(false); // as shipped: nothing is signed
    const one = (item: ReviewItem) =>
      html(
        h(ReviewView, {
          items: [item],
          selected: new Set<string>(),
          draft: { action: "seen", note: "", forwardedToUserId: "" },
          staff: [],
        }),
      );
    expect(one(signed)).toMatch(/status-critical-fg font-mono font-bold/);
    expect(text(one(signed))).toMatch(/7\.1 Critical mmol\/L/);
    // The lab's own HH flag is text beside the value, never the critical style.
    const plain = one(shipped);
    expect(plain).not.toMatch(/status-critical/);
    expect(text(plain)).toContain("Lab flag: critical (high)");
  });

  it("shows the laboratory's flag as text, uncatalogued values labelled, imaging conclusions", () => {
    const t = text(review());
    expect(t).toContain("High (laboratory range)");
    expect(t).toContain("Malaria antigen line (as typed) faint Not read by decision support");
    expect(t).toContain("Conclusion: Abnormal Right lower zone opacity (synthetic).");
  });

  it("every row carries two identifiers with age and sex", () => {
    const m = review();
    const rows = m.split("<li").slice(1);
    expect(rows).toHaveLength(5);
    for (const row of rows)
      expect(text(row)).toMatch(/Test Patient [ABC] MRN-2026-9000\d \d+ y (Female|Male)/);
  });

  it("acknowledges in a batch: one call per patient, the same action for each", () => {
    const items = reviewItems();
    const selected = new Set(items.map((i) => i.reportId));
    const batches = r.ackBatches(
      items,
      selected,
      { action: "acted", note: " called ", forwardedToUserId: "" },
      "k",
    );
    expect(batches.map((b) => b.patientUserId).sort()).toEqual(
      [PATIENT.A, PATIENT.B, PATIENT.C].sort(),
    );
    const a = batches.find((b) => b.patientUserId === PATIENT.A)!;
    expect(a.clientKey).toBe(`k:${PATIENT.A}`);
    expect(a.items).toEqual([
      { reportId: items[2]!.reportId, action: "acted", note: "called" },
      { reportId: items[3]!.reportId, action: "acted", note: "called" },
    ]);
    const fwd = r.ackBatches(
      items,
      new Set([items[0]!.reportId]),
      {
        action: "forwarded",
        note: "",
        forwardedToUserId: STAFF[1]!.userId,
      },
      "k",
    );
    expect(fwd[0]!.items[0]).toEqual({
      reportId: items[0]!.reportId,
      action: "forwarded",
      forwardedToUserId: STAFF[1]!.userId,
    });
  });

  it("the batch button waits for a selection, and a forward for its target", () => {
    expect(r.ackIssues({ action: "seen", note: "", forwardedToUserId: "" }, 0)).toEqual([
      "Select at least one result.",
    ]);
    expect(r.ackIssues({ action: "forwarded", note: "", forwardedToUserId: "" }, 2)).toEqual([
      "Choose who to forward to.",
    ]);
    expect(button(review(), "Acknowledge selected")).toMatch(DISABLED);
    const two = review(
      new Set(
        reviewItems()
          .slice(0, 2)
          .map((i) => i.reportId),
      ),
    );
    expect(button(two, "Acknowledge 2 results")).not.toMatch(DISABLED);
    expect(text(review(new Set(), { action: "forwarded" }))).toContain(
      "Forward to… Dr Test Clinician Dr Test Cover",
    );
  });

  it("an empty list directs rather than sets a mood", () => {
    const m = html(
      h(ReviewView, {
        items: [],
        selected: new Set<string>(),
        draft: { action: "seen", note: "", forwardedToUserId: "" },
        staff: [],
      }),
    );
    expect(text(m)).toContain("No results waiting for your review.");
  });
});

/* ─── The critical call and the bench ─────────────────────────────── */

describe("critical communication and the lab worklist", () => {
  it("records who was told, how, and read-back; the orderer comes first; no clock is shown", () => {
    const draft: CommDraft = { toUserId: "", role: "orderer", method: null, readBack: null };
    expect(r.commIssues(draft)).toEqual([
      "Choose who was told.",
      "Choose how they were told.",
      "Say whether it was read back.",
    ]);
    expect(
      r.commIssues({ ...draft, toUserId: STAFF[0]!.userId, method: "phone", readBack: "yes" }),
    ).toEqual([]);
    const m = html(
      h(CriticalCommView, {
        identity: ENTRY_RELEASED_CRITICAL.identity,
        test: ENTRY_RELEASED_CRITICAL.test,
        target: ENTRY_RELEASED_CRITICAL.communicate!,
        draft,
      }),
    );
    const t = text(m);
    expect(t).toContain("Dr Test Clinician (orderer)");
    expect(t).toMatch(/Orderer Covering In-charge/);
    expect(t).toMatch(/In app Phone In person/);
    expect(t).toContain("none is set yet");
    expect(t).toContain("Test Patient A MRN-2026-90001");
    expect(button(m, "Save call record")).toMatch(DISABLED);
  });

  it("the worklist names each patient by two identifiers and hands each row its actions", () => {
    const m = html(
      h(LabWorklistView, {
        items: LAB_ITEMS,
        timeZone: "Africa/Kampala",
        actions: (i) => h("span", { "data-action": i.orderId }, i.stage),
      }),
    );
    const rows = m.split("<li").slice(1);
    expect(rows).toHaveLength(2);
    expect(text(rows[0]!)).toMatch(
      /Test Patient A MRN-2026-90001 52 y Female Full blood count Urgent/,
    );
    expect(text(rows[1]!)).toContain("Test Patient B MRN-2026-90002");
    expect(m).toMatch(/data-tone="caution"[^>]*>.*?Preliminary result/);
    expect(m).toContain('data-action="');
  });
});
