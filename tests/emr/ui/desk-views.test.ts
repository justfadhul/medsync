import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DeskViewProps } from "@/components/emr/desk/desk-view";
import type { DeskPayload } from "@/components/emr/desk/model";
import type { ReactElement } from "react";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { deskValidation } from "@/components/emr/desk/model";
import { NAME_ONLY_LABEL as ENGINE_NAME_ONLY } from "@/lib/emr/allergy";
import { getTemplate } from "@/lib/emr/notes";
import { deskTemplateOf } from "@/lib/emr/read/terms";
import { internAwaitingCosign, standardVisitMidway } from "./desk-fixtures";

/**
 * The clerking desk's views (UI-BRIEF §3–5, gate-a E.3–E.6, E.11–E.12), rendered to static markup
 * from the synthetic desk fixtures — no DOM, no database. What each section shows in each state,
 * the words beside every colour, the place colour on the current section only, and no red.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const { DeskView } = await import("@/components/emr/desk/desk-view");
const { SignCheckView } = await import("@/components/emr/desk/sign");
const { CompleteVisitView } = await import("@/components/emr/desk/complete");
const { AllergyEditorView, NAME_ONLY_LABEL, substanceOf } =
  await import("@/components/emr/desk/allergy-editor");
const { ContextRailView } = await import("@/components/emr/desk/context-rail");
const { VitalsEntryForm } = await import("@/components/emr/desk/sections");
const { formatters } = await import("@/components/emr/format");

const html = (el: ReactElement) => renderToStaticMarkup(el);
const text = (m: string) =>
  m
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
const none = async () => [];
const RED = /status-critical|\bred-\d|\brose-\d|destructive|#DC2626/i;
/** The Input primitive's own invalid state (components/ui) is not the desk painting red. */
const painted = (m: string) => m.replace(/aria-invalid:[^\s"]+/g, "");

function desk(p: DeskPayload, over: Partial<DeskViewProps> = {}) {
  return html(
    h(DeskView, {
      p,
      content: p.draft?.content ?? { sections: {} },
      current: "s01",
      save: { tone: "neutral", text: "Saved 10:42" },
      on: {},
      loaders: { findings: none, terms: none },
      ...over,
    }),
  );
}

describe("phone position", () => {
  it("the top trigger and the bottom bar say one position: the visible sections", async () => {
    const p = standardVisitMidway(); // male: s10 hidden, so s11 is the tenth section shown
    const m = desk(p, { current: "s11" });
    expect(text(m)).not.toContain("11 of 13");
    expect(text(m)).toContain("10 of 13");
    const src = readFileSync(
      resolve(process.cwd(), "app/doctor/encounters/[encounterId]/_desk/desk-client.tsx"),
      "utf8",
    );
    expect(src).toContain("sectionPosition(index, current)");
    expect(src).not.toMatch(/number \?\? ""\} of \$\{index\.length/);
  });
});

describe("the desk, standard visit midway (gate-a E.3)", () => {
  const p = standardVisitMidway();
  const m = desk(p);
  const t = text(m);

  it("three regions: the note's index, the note, the context rail", () => {
    expect(m).toMatch(/<nav aria-label="Note sections"/);
    expect(m).toMatch(/<section id="desk-note" aria-label="Adult outpatient clerking"/);
    expect(m).toMatch(/<aside aria-label="Context"/);
    expect(m).toMatch(/xl:grid-cols-\[18rem_minmax\(0,1fr\)_20rem\]/);
  });

  it("bracket section numbers, in template order, the sequence the template is", () => {
    const numbers = [...m.matchAll(/\[(\d\d)\]/g)].map((x) => x[1]);
    expect(numbers.slice(0, 3)).toEqual(["01", "02", "03"]);
    expect(numbers).toContain("14");
  });

  it("plum marks the current section only (place), with aria-current", () => {
    const current = [...m.matchAll(/<a[^>]*aria-current="page"[^>]*>/g)].map((x) => x[0]);
    expect(current.length).toBeGreaterThan(0);
    for (const a of current) expect(a).toMatch(/bg-plum-50/);
    expect(m).toMatch(
      /data-current="true"[^>]*id="desk-s01"|id="desk-s01"[^>]*data-current="true"/,
    );
    expect((m.match(/bg-plum-50 text-plum-800/g) ?? []).length).toBe(current.length);
  });

  it("complaints are chips with the duration in words and a source mark", () => {
    expect(t).toContain("Fever 3 days");
    expect(t).toContain("Headache 2 days");
  });

  it("findings are tri-state chips whose accessible names say the value in words", () => {
    expect(m).toContain('aria-label="Chills, present"');
    expect(m).toContain('aria-label="Neck stiffness, absent"');
    expect(m).toContain('aria-label="Night sweats, not asked"');
  });

  it("the seven general signs, and triage vitals shown from the record with their source", () => {
    for (const s of [
      "Pallor",
      "Jaundice",
      "Cyanosis",
      "Finger clubbing",
      "Lymphadenopathy",
      "Oedema",
      "Dehydration",
    ])
      expect(m).toContain(`aria-label="${s}, absent"`);
    expect(t).toMatch(/Body temperature 38\.9 °C From triage 11:10/);
    expect(m).toContain("Record vital signs");
  });

  it("the medicine is reconciled in words; allergy status is shown", () => {
    expect(t).toContain("Metformin Continued");
    expect(t).toContain("No known drug allergies");
  });

  it("the impression shows the term, its ICD-11 code, Working and Primary", () => {
    expect(t).toMatch(/Malaria, uncomplicated ICD-11 1F4Z Working Primary/);
  });

  it("the plan: the order with its state in amber words, and the triage suggestion labelled", () => {
    expect(t).toMatch(/Malaria rapid diagnostic test \(mRDT\) To collect/);
    expect(t).toContain("Suggested by triage");
    expect(t).toContain("Suggestions, not orders");
    expect(t).toContain("Order Random blood glucose (laboratory)");
    expect(t).toContain("Dismiss");
  });

  it("Sign note sits beside Required 3/3, with its key; Complete visit beside", () => {
    expect(m).toMatch(/aria-keyshortcuts="Control\+Enter Meta\+Enter"/);
    expect(t).toContain("Required 3/3");
    expect(t).toContain("Complete visit");
    expect(m).not.toMatch(/<button[^>]*disabled=""[^>]*aria-keyshortcuts="Control/);
  });

  it("the save state is a quiet word in a polite live region", () => {
    expect(m).toMatch(/role="status" aria-live="polite"[^>]*><span[^>]*>Saved 10:42/);
  });

  it("paints no red anywhere; the desk's own code has no stagger, transition: all or off-scale text", () => {
    expect(painted(m)).not.toMatch(RED);
    const dir = resolve(process.cwd(), "components/emr/desk");
    const island = resolve(process.cwd(), "app/doctor/encounters/[encounterId]/_desk");
    const files = [
      ...readdirSync(dir).map((f) => join(dir, f)),
      ...readdirSync(island).map((f) => join(island, f)),
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/stagger-children|transition-all|text-\[\d|rgba\(/);
    }
  });

  it("optional prose-only sections collapse to one line when empty", () => {
    expect(t).toMatch(/\[05\] Past surgical history and transfusions Not asked Add/);
  });
});

describe("the desk in other states", () => {
  it("an empty note: Sign disabled, Required 0/3 in amber words, the complaint prompt", () => {
    const p = standardVisitMidway();
    const m = desk(p, { content: { sections: {} } });
    expect(text(m)).toContain("Required 0/3");
    expect(text(m)).toContain("No complaint recorded yet.");
    expect(m).toMatch(/<button[^>]*disabled=""[^>]*aria-keyshortcuts="Control\+Enter/);
  });

  it("offline: the save state turns amber and says the changes are kept", () => {
    const m = desk(standardVisitMidway(), {
      save: { tone: "caution", text: "Offline, changes kept on this page (2 waiting)" },
    });
    expect(m).toMatch(
      /data-tone="caution"[^>]*>.*Offline, changes kept on this page \(2 waiting\)/,
    );
  });

  it("deceased: clinical actions are removed, the note can still be completed and signed", () => {
    const p = standardVisitMidway();
    p.flags.actionsAllowed = false;
    p.safetyBar = {
      ...p.safetyBar,
      actionsAllowed: false,
      deceased: { text: "Died 11:06, 20 Sep 2026", at: "2026-09-20T08:06:00.000Z" },
    };
    const m = desk(p);
    const t = text(m);
    expect(t).toContain("Clinical actions are removed");
    expect(t).not.toContain("Record vital signs");
    expect(t).not.toContain("Order Random blood glucose");
    expect(t).not.toContain("Update allergies");
    expect(t).toContain("Sign note");
  });

  it("an intern's own signed note: read-only, amber 'Awaiting co-signature', no Sign", () => {
    const p = internAwaitingCosign("intern");
    const m = desk(p);
    const t = text(m);
    expect(t).toMatch(/Awaiting co-signature 13:40/);
    expect(m).toMatch(/data-tone="caution"[^>]*>.*Awaiting co-signature/);
    expect(t).not.toContain("Sign note");
    expect(m).not.toContain("<textarea");
    expect(m).toContain('aria-label="Chills, present"');
    expect(m).toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Chills, present"|aria-label="Chills, present"[^>]*disabled=""/,
    );
    expect(t).not.toContain("Co-sign");
  });

  it("a senior sees the intern's note with Co-sign and Add addendum and co-sign", () => {
    const t = text(desk(internAwaitingCosign("senior")));
    expect(t).toContain("Signed notes this visit");
    expect(t).toMatch(/Adult outpatient clerking Dr Test Intern \(INTERN_DOCTOR\)/);
    expect(t).toContain("Co-sign");
    expect(t).toContain("Add addendum and co-sign");
    expect(t).toContain("Entered in error");
  });
});

describe("the desk's slots and templates", () => {
  it("the orders island replaces the desk's own read-only order list in Plan", () => {
    const m = desk(standardVisitMidway(), {
      slots: { orders: h("p", null, "Orders island") },
    });
    expect(text(m)).toContain("Orders island");
    expect(text(m)).not.toContain("Orders this visit");
    expect(text(m)).toContain("Suggested by triage");
  });

  it("the emergency template renders by item kind: prose where the desk has no widget", () => {
    const p = standardVisitMidway();
    p.template = deskTemplateOf(getTemplate("tpl.clerking.emergency"), { sex: "male", ncd: true });
    const m = desk(p, { content: { sections: {} } });
    const t = text(m);
    expect(t).toMatch(/\[01\] Primary survey summary/);
    expect(m).toContain('id="desk-s01-narrative"');
    expect(t).toMatch(/\[NCD\] Diabetes and NCD module/);
    expect(t).toContain("Required 0/3");
  });
});

describe("the clerking form switch", () => {
  const fresh = () => {
    const p = standardVisitMidway();
    p.draft = { noteId: null, revision: null, content: { sections: {} } };
    return p;
  };
  const onTemplate = () => {};

  it("no draft yet and nothing written: Full / Emergency clerking beside the title, no motion", () => {
    const m = desk(fresh(), { content: { sections: {} }, on: { onTemplate } });
    expect(m).toContain('role="radiogroup" aria-label="Clerking form"');
    expect(text(m)).toMatch(/Adult outpatient clerking Full clerking Emergency clerking/);
    expect(m).toContain('checked="" value="tpl.clerking.adult_opd"');
    expect(m).toContain("[&amp;&gt;label]:transition-none");
  });

  it("the seeded triage complaint alone still counts as nothing written", () => {
    const content = {
      sections: { s01: { items: [{ kind: "complaint_token", label: "Fever", source: "triage" }] } },
    };
    expect(desk(fresh(), { content, on: { onTemplate } })).toContain('aria-label="Clerking form"');
  });

  it("hidden once the note has content, once a draft is saved, when signed or not switchable", () => {
    const typed = { sections: { s02: { narrative: "Three days of fever" } } };
    expect(desk(fresh(), { content: typed, on: { onTemplate } })).not.toContain("Clerking form");
    // standardVisitMidway: a saved draft with content.
    expect(desk(standardVisitMidway(), { on: { onTemplate } })).not.toContain("Clerking form");
    expect(desk(internAwaitingCosign("intern"), { on: { onTemplate } })).not.toContain(
      "Clerking form",
    );
    // The client withholds the handler once autosave has created the draft.
    expect(desk(fresh(), { content: { sections: {} } })).not.toContain("Clerking form");
  });
});

describe("sign check (gate-a E.11)", () => {
  it("required met with checks, warnings amber and non-blocking, what commits, the intern notice", () => {
    const p = standardVisitMidway();
    const v = deskValidation(p, { sections: {} });
    const m = html(
      h(SignCheckView, {
        validation: {
          ...v,
          warnings: [{ id: "warn.examination", message: "No examination recorded." }],
        },
        requiredMessages: p.template.minimumToSign.required.map((r) => ({
          id: r.id,
          message: r.message,
        })),
        committed: "5 findings, 7 examination signs",
        mustCosign: true,
      }),
    );
    const t = text(m);
    expect(t).toContain("Add the presenting complaint or the visit reason.");
    expect(t).toContain("Warnings — you can still sign");
    expect(t).toContain("Committed with this note: 5 findings, 7 examination signs.");
    expect(t).toContain("This note will await co-signature by a senior. Your orders are not held.");
    expect(painted(m)).not.toMatch(RED);
  });
});

describe("complete visit (gate-a E.12)", () => {
  const p = standardVisitMidway();
  const m = html(h(CompleteVisitView, { p }));
  const t = text(m);
  it("offers every disposition in words; Died is a plain choice, never red", () => {
    for (const d of [
      "Home",
      "Admitted",
      "Referred out",
      "Transferred",
      "Died",
      "Left before completion",
      "Left against medical advice",
    ])
      expect(t).toContain(d);
    expect(painted(m)).not.toMatch(RED);
    expect(m).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>Complete visit/);
  });
  it("shows the warnings in amber words and does not block on them", () => {
    expect(t).toContain("Before you complete — warnings, not blocks");
    expect(t).toContain("1 order not yet collected: Malaria rapid diagnostic test (mRDT).");
    expect(t).toContain("Pending results move to Results to review.");
  });
  it("links the three printouts and offers closing without completing", () => {
    expect(m).toContain(`href="${p.links.print.summary}"`);
    expect(m).toContain(`href="${p.links.print.referral}"`);
    expect(m).toContain(`href="${p.links.print.labRequest}"`);
    expect(t).toContain("Close without completing");
  });
});

describe("allergy editor (gate-a E.6)", () => {
  const patient = { name: "Test Patient D", mrn: "MRN-2026-90004" };
  it("not recorded is amber words with the two one-tap assertions; two identifiers head it", () => {
    const m = html(
      h(AllergyEditorView, {
        line: {
          state: "not_recorded",
          text: "Allergy status not recorded",
          tone: "caution",
          items: [],
        },
        patient,
        substances: [],
      }),
    );
    const t = text(m);
    expect(t).toContain("Test Patient D MRN-2026-90004");
    expect(m).toMatch(/data-tone="caution"[^>]*>.*Allergy status not recorded/);
    expect(t).toContain("No known drug allergies");
    expect(t).toContain("Unable to assess");
    expect(m).toContain('list="allergy-substances"');
  });
  it("an uncoded substance keeps the engine's words; a formulary name is coded", () => {
    expect(NAME_ONLY_LABEL).toBe(ENGINE_NAME_ONLY);
    const list = standardVisitMidway().substances;
    expect(substanceOf("adrenaline (Epinephrine)", list)).toEqual({
      kind: "drug_ingredient",
      code: "adrenaline",
    });
    expect(substanceOf("Penicillin", list)).toEqual({ kind: "other", text: "Penicillin" });
  });
});

describe("context rail and vitals entry", () => {
  it("triage in words with its time, vitals from triage marked, problems and medicines", () => {
    const p = standardVisitMidway();
    const t = text(html(h(ContextRailView, { p, fmt: formatters(p.timeZone) })));
    expect(t).toMatch(/Triage 11:10 Level 3 Urgent, stable Fever for three days Fever Triage/);
    expect(t).toMatch(/Body temperature 38\.9 °C Triage/);
    expect(t).toContain("1 waiting in the plan");
  });
  it("vitals entry: every concept labelled, units in words, a fasting chip only after a glucose value", () => {
    const p = standardVisitMidway();
    const m = html(h(VitalsEntryForm, { concepts: p.vitalConcepts, onSubmit: () => {} }));
    expect(m).toContain('for="desk-vital-obs.bp_systolic"');
    expect(text(m)).toContain("Blood glucose (point of care)");
    expect(m).toContain("mmHg");
    expect(m).toContain("°F");
    expect(m).not.toContain("fasting state");
    expect(p.vitalConcepts.find((c) => c.conceptId === "obs.glucose")).toMatchObject({
      fasting: true,
      context: { specimen: "capillary_whole_blood", pointOfCare: true },
    });
  });
});

describe("pop-ups (ADR 0161)", () => {
  it("nothing in the EMR slides in from an edge: every pop-up is the centred EmrDialog", () => {
    for (const f of [
      "app/doctor/encounters/[encounterId]/_desk/desk-client.tsx",
      "app/doctor/encounters/[encounterId]/_orders/orders-panel.tsx",
      "app/nurse/patients/[patientId]/_orders/nurse-orders-panel.tsx",
      "components/emr/chart/chart-shell.tsx",
      "components/emr/prescribing/sheet.tsx",
    ]) {
      const src = readFileSync(resolve(process.cwd(), f), "utf8");
      expect(src, f).not.toMatch(/<SheetContent|<Sheet\b|<DialogContent/);
      expect(src, f).toMatch(/<EmrDialog/);
    }
  });
});
