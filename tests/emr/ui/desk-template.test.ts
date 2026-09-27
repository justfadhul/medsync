import { describe, expect, it } from "vitest";

import { blankNote } from "@/components/emr/desk/model";
import { defaultClerkingId, templateFor } from "@/lib/emr/read/desk";

/**
 * Which clerking form the desk opens (clinical reference §2.1, §2.2): the full clerkship by default,
 * the emergency form only after resus or top-acuity triage (lib/triage: level 1 is the most acute).
 */

const FULL = "tpl.clerking.adult_opd";
const EMERGENCY = "tpl.clerking.emergency";
const none = { templateId: null, resusLinked: false, triageLevel: null };

describe("the default clerking form", () => {
  it("resus-linked: the emergency clerking, whatever the triage level", () => {
    expect(templateFor({ ...none, resusLinked: true }).id).toBe(EMERGENCY);
    expect(templateFor({ ...none, resusLinked: true, triageLevel: 4 }).id).toBe(EMERGENCY);
  });

  it("triaged at the top level (1, red): the emergency clerking", () => {
    expect(templateFor({ ...none, triageLevel: 1 }).id).toBe(EMERGENCY);
  });

  it("an L4 Green patient on an emergency visit: the full clerkship", () => {
    expect(templateFor({ ...none, triageLevel: 4 }).id).toBe(FULL);
    // Level 2 is high risk but not the top level: the rule names one level, it does not guess a cut.
    expect(defaultClerkingId({ resusLinked: false, triageLevel: 2 })).toBe(FULL);
    expect(defaultClerkingId({ resusLinked: false, triageLevel: null })).toBe(FULL);
  });

  it("an explicit encounters.template_id wins over the default", () => {
    expect(templateFor({ ...none, templateId: EMERGENCY, triageLevel: 5 }).id).toBe(EMERGENCY);
    expect(templateFor({ ...none, templateId: "tpl.progress", resusLinked: true }).id).toBe(
      "tpl.progress",
    );
    // An unknown id falls back to the rule.
    expect(templateFor({ ...none, templateId: "tpl.nope", triageLevel: 1 }).id).toBe(EMERGENCY);
  });

  it("the author's own draft wins over everything (reloading never switches the form)", () => {
    const own = { ...none, ownTemplateId: FULL };
    expect(templateFor({ ...own, resusLinked: true }).id).toBe(FULL);
    expect(templateFor({ ...own, templateId: EMERGENCY, chosen: EMERGENCY }).id).toBe(FULL);
  });

  it("the desk switch picks between the two clerking forms only", () => {
    expect(templateFor({ ...none, triageLevel: 1, chosen: FULL }).id).toBe(FULL);
    expect(templateFor({ ...none, chosen: EMERGENCY }).id).toBe(EMERGENCY);
    expect(templateFor({ ...none, chosen: "tpl.progress" }).id).toBe(FULL);
    // A non-clerking explicit template is not switchable.
    expect(templateFor({ ...none, templateId: "tpl.progress", chosen: FULL }).id).toBe(
      "tpl.progress",
    );
  });
});

describe("blankNote: nothing the author wrote", () => {
  it("empty, or only the triage complaint the desk seeded", () => {
    expect(blankNote({ sections: {} })).toBe(true);
    expect(
      blankNote({
        sections: {
          s01: { items: [{ kind: "complaint_token", label: "Fever", source: "triage" }] },
        },
      }),
    ).toBe(true);
  });

  it("anything typed, picked or chosen is content", () => {
    expect(blankNote({ sections: { s02: { narrative: "3 days" } } })).toBe(false);
    expect(
      blankNote({ sections: { s01: { items: [{ kind: "complaint_token", label: "Cough" }] } } }),
    ).toBe(false);
    expect(blankNote({ sections: { s05: { fields: { x: "y" } } } })).toBe(false);
    expect(blankNote({ header: { historian: "patient" }, sections: {} })).toBe(false);
  });
});
