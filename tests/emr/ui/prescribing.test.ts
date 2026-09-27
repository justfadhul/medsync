import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PrescribeDraft, PrescribeSheetPatient } from "@/components/emr/prescribing/model";
import type { EmergencyDrug } from "@/lib/prescribing/reference/emergency-drug-catalog";
import type { ReactElement } from "react";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PAEDIATRIC_AGE_THRESHOLD } from "@/lib/prescribing/engine";
import { EMERGENCY_DRUGS as CATALOG } from "@/lib/prescribing/reference/emergency-drug-catalog";

/**
 * Prescribing from the encounter (PROMPT Phase 7): the sheet's pure model and views rendered to
 * static markup (no DOM, no database), and the EMR_PRESCRIBING gate on the desk mount, the action
 * and the printout.
 */

const held = vi.hoisted(() => ({ actorCalls: 0, writerCalls: 0 }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {} }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/emr/actor", () => ({
  requireEmrActor: async () => {
    held.actorCalls++;
    return {
      userId: "u-1",
      fullName: null,
      hospitalId: "h-1",
      departmentId: null,
      affiliationId: "a-1",
      cadreCode: "MEDICAL_OFFICER",
      isClinical: true,
      surface: "doctor",
    };
  },
}));
vi.mock("@/lib/emr/db", () => ({
  asClinicalWriter: async () => {
    held.writerCalls++;
    throw new Error("no database in this test");
  },
  asClinicalReader: async () => {
    held.writerCalls++;
    throw new Error("no database in this test");
  },
}));

const m = await import("@/components/emr/prescribing/model");
const { PrescriptionsView } = await import("@/components/emr/prescribing/views");
const { PrescribeSheetView } = await import("@/components/emr/prescribing/sheet");

const html = (el: ReactElement) => renderToStaticMarkup(el);
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const EMERGENCY_DRUGS: readonly EmergencyDrug[] = CATALOG;
const refMg = (d: EmergencyDrug) => d.unitDoseMg ?? d.doseRangeMg?.low;
const ORAL = EMERGENCY_DRUGS.find(
  (d) => d.adult?.route.includes("oral") && refMg(d) != null && !d.controlled && !d.lookAlikeGuard,
)!;
const FREE_TEXT = EMERGENCY_DRUGS.find((d) => !d.recordOnly && !m.mgChecked(d))!;
const WEIGHT_BASED = EMERGENCY_DRUGS.find(
  (d) => d.adult && d.paediatric.weightBased && d.unitDoseMg != null,
)!;
const ADULT: PrescribeSheetPatient = {
  ageYears: 40,
  weightKg: null,
  allergies: [],
  conditions: [],
  allergyStatus: "no_known_drug_allergies",
};
const complete = (o: Partial<PrescribeDraft> = {}): PrescribeDraft => ({
  ...m.emptyDraft("key-00000001"),
  drugId: ORAL.id,
  doseMg: String(refMg(ORAL)),
  route: "oral",
  concentration: "Tablets",
  frequency: "Once daily",
  duration: "5 days",
  ...o,
});
const sheet = (draft: PrescribeDraft, patient = ADULT, query = "") =>
  html(h(PrescribeSheetView, { patient, draft, query }));
const button = (markup: string) => /<button[^>]*>Prescribe<\/button>/.exec(markup)?.[0] ?? "";

describe("the formulary", () => {
  it("is lib/prescribing's, without the record-only entries; search narrows it", () => {
    expect(m.FORMULARY.length).toBe(EMERGENCY_DRUGS.filter((d) => !d.recordOnly).length);
    expect(m.FORMULARY.some((d) => d.recordOnly)).toBe(false);
    expect(m.searchFormulary(ORAL.name.slice(0, 5)).map((d) => d.id)).toContain(ORAL.id);
    expect(m.searchFormulary("zzzz")).toEqual([]);
  });

  it("never suggests a dose: a picked medicine shows no catalog dose and an empty dose field", () => {
    for (const d of m.FORMULARY) {
      const draft = { ...m.emptyDraft("key-00000001"), drugId: d.id };
      const markup = sheet(draft);
      // The engine's own warnings (a look-alike strength) may name a strength; nothing else may.
      let t = text(markup);
      for (const f of m.draftFlags(d, ADULT, draft)) t = t.replace(text(f.message), "");
      if (d.adult) expect(t).not.toContain(d.adult.dose);
      expect(markup).toMatch(/id="rx-dose(Mg)?"[^>]*value=""/);
    }
  });
});

describe("the prescribe sheet: checks from lib/prescribing", () => {
  it("is ready once dose, route, frequency and duration are written", () => {
    expect(m.draftIssue(ORAL, m.emptyDraft("k"), [])).toBe("Write the dose.");
    expect(m.draftIssue(ORAL, complete({ route: "" }), [])).toBe("Choose the route.");
    expect(m.draftIssue(ORAL, complete({ frequency: " " }), [])).toBe("Say how often.");
    expect(m.draftIssue(ORAL, complete({ duration: "" }), [])).toBe("Say for how long.");
    const d = complete();
    expect(m.draftFlags(ORAL, ADULT, d)).toEqual([]);
    expect(m.draftIssue(ORAL, d, [])).toBeNull();
    expect(button(sheet(d))).not.toMatch(/ disabled=""/);
  });

  it("asks the dose as text for an entry the engine holds no mg reference for", () => {
    expect(sheet({ ...complete(), drugId: FREE_TEXT.id })).toContain('id="rx-dose"');
    expect(sheet(complete())).toContain('id="rx-doseMg"');
  });

  it("an allergy on the record fires a check: amber words and a reason, never red or silent", () => {
    const patient = { ...ADULT, allergies: [ORAL.name] };
    const d = complete();
    const flags = m.draftFlags(ORAL, patient, d);
    expect(flags.map((f) => f.code)).toContain("allergy");
    expect(m.draftIssue(ORAL, d, flags)).toBe("Record your reason to prescribe.");
    const markup = sheet(d, patient);
    expect(text(markup)).toMatch(/Documented allergy/);
    expect(markup).toContain('id="rx-confirmReason"');
    expect(markup).toContain("bg-status-caution-bg");
    expect(markup).not.toMatch(/status-critical|text-red-|bg-red-|rose-/);
    expect(button(markup)).toMatch(/ disabled=""/);
    expect(m.draftIssue(ORAL, { ...d, confirmReason: "Benefit outweighs risk" }, flags)).toBeNull();
  });

  it("an unknown allergy status is amber words, never the NKDA sentence", () => {
    const nkda = text(sheet(complete()));
    expect(nkda).toContain("The allergy record lists no allergy to check against.");
    for (const [allergyStatus, words] of [
      ["not_recorded", "Allergy status not recorded — check before prescribing"],
      ["unable_to_assess", "Allergy status: unable to assess — check before prescribing"],
    ] as const) {
      const markup = sheet(complete(), { ...ADULT, allergyStatus });
      expect(text(markup)).toContain(words);
      expect(text(markup)).not.toContain("lists no allergy");
      expect(markup).toContain("bg-status-caution-bg");
    }
  });

  it("a block the engine lets no one override stays a block, reason or not", () => {
    const child = { ...ADULT, ageYears: Math.floor(PAEDIATRIC_AGE_THRESHOLD / 2) };
    const d = complete({
      drugId: WEIGHT_BASED.id,
      doseMg: String(WEIGHT_BASED.unitDoseMg),
      route: WEIGHT_BASED.adult!.route[0]!,
      confirmReason: "Reason given",
    });
    const flags = m.draftFlags(WEIGHT_BASED, child, d);
    expect(flags.some((f) => !f.overrideable)).toBe(true);
    expect(m.draftIssue(WEIGHT_BASED, d, flags)).toMatch(/weight is required/);
  });

  it("builds the action's request from the draft", () => {
    expect(
      m.toRequest(complete({ instructions: " With food " }), {
        surface: "doctor",
        patientUserId: "p",
        encounterId: "e",
      }),
    ).toMatchObject({
      clientKey: "key-00000001",
      drugId: ORAL.id,
      doseMg: refMg(ORAL),
      dose: undefined,
      route: "oral",
      instructions: "With food",
      confirmReason: undefined,
    });
  });
});

describe("the visit's prescriptions", () => {
  const identity = { name: "Test Patient", mrn: "MRN-1" };
  it("lists each as written, says what awaits co-sign, and links the printout", () => {
    const markup = html(
      h(PrescriptionsView, {
        identity,
        printHref: "/print",
        onPrescribe: () => undefined,
        items: [
          {
            id: "rx-1",
            drugName: ORAL.name,
            dose: "As written",
            route: "oral",
            frequency: "Once daily",
            duration: "5 days",
            quantity: null,
            instructions: null,
            awaitingCosign: true,
            cosignWithheld: false,
            restricted: false,
          },
        ],
      }),
    );
    const t = text(markup);
    expect(t).toContain(`${ORAL.name} As written By mouth Once daily 5 days`);
    expect(t).toContain("Awaiting senior co-sign");
    expect(t).toContain("Print prescription");
    expect(markup).not.toMatch(/status-critical|text-red-|bg-red-/);
  });

  it("says a prescription the senior did not co-sign is not valid", () => {
    const t = text(
      html(
        h(PrescriptionsView, {
          identity,
          printHref: "/print",
          items: [
            {
              id: "rx-1",
              drugName: ORAL.name,
              dose: "As written",
              route: "oral",
              frequency: "Once daily",
              duration: "5 days",
              quantity: null,
              instructions: null,
              awaitingCosign: false,
              cosignWithheld: true,
              restricted: false,
            },
          ],
        }),
      ),
    );
    expect(t).toContain("Not co-signed by a senior — not valid");
    expect(t).not.toContain("Awaiting senior co-sign");
  });

  it("says when nothing is prescribed, with no print link", () => {
    const t = text(html(h(PrescriptionsView, { identity, items: [], printHref: "/print" })));
    expect(t).toContain("Nothing prescribed in this visit.");
    expect(t).not.toContain("Print prescription");
  });
});

describe("EMR_PRESCRIBING off: no route, no action, no desk section", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    held.actorCalls = 0;
    held.writerCalls = 0;
  });
  const on = () => {
    process.env.ENCOUNTER_ENGINE_LIVE = "1";
    process.env.EMR_V1 = "1";
  };

  it("the flag needs EMR_PRESCRIBING=1 and EMR v1 for the hospital", async () => {
    const { emrPrescribingLive } = await import("@/lib/emr/feature");
    on();
    delete process.env.EMR_PRESCRIBING;
    expect(emrPrescribingLive("h-1")).toBe(false);
    process.env.EMR_PRESCRIBING = "1";
    expect(emrPrescribingLive("h-1")).toBe(true);
    process.env.EMR_V1 = "h-2";
    expect(emrPrescribingLive("h-1")).toBe(false);
  });

  it("the action refuses before any scope or database work", async () => {
    on();
    delete process.env.EMR_PRESCRIBING;
    const { prescribe } = await import("@/lib/emr/actions/prescriptions");
    expect(await prescribe({})).toMatchObject({ ok: false, code: "config" });
    expect(held.actorCalls + held.writerCalls).toBe(0);
  });

  it("the desk section renders nothing and reads nothing", async () => {
    on();
    delete process.env.EMR_PRESCRIBING;
    const { EncounterPrescriptions } =
      await import("@/components/emr/prescribing/encounter-prescriptions");
    expect(
      await EncounterPrescriptions({ encounterId: "e-1", identity: { name: "", mrn: "" } }),
    ).toBeNull();
    expect(held.writerCalls).toBe(0);
  });

  it("the printout is not found", async () => {
    on();
    process.env.SKIP_ENV_VALIDATION = "1"; // the page's import graph validates the app env
    delete process.env.EMR_PRESCRIBING;
    const page = (await import("@/app/doctor/encounters/[encounterId]/print/prescription/page"))
      .default;
    await expect(
      page({
        params: Promise.resolve({ encounterId: "e-1" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(held.writerCalls).toBe(0);
  });

  it("the desk mounts the section inside the orders slot only", () => {
    const src = readFileSync(
      resolve(process.cwd(), "app/doctor/encounters/[encounterId]/_desk/desk-page.tsx"),
      "utf8",
    );
    expect(src.match(/<EncounterPrescriptions/g)).toHaveLength(1);
    const slot = src.slice(src.indexOf("orders={"), src.indexOf("rail={"));
    expect(slot).toContain("<EncounterPrescriptions");
  });
});
