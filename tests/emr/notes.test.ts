import { createHmac } from "node:crypto";
import type {
  CanonicalNoteInput,
  NoteContent,
  NoteSection,
  SignContext,
  SignRule,
} from "@/lib/emr/notes";
import { describe, expect, it } from "vitest";

import rawTemplates from "@/data/emr/note-templates.v1.json";
import {
  applyNoteEvent,
  canonicalNote,
  getTemplate,
  hmacNote,
  isLateEntry,
  NOTE_TEMPLATES,
  noteBornItems,
  noteHmacInput,
  NoteHmacKeyError,
  noteHmacKeyId,
  noteStatus,
  parseTemplateCatalogue,
  planSign,
  stableStringify,
  threadNotes,
  validateForSigning,
  verifyNoteHmac,
} from "@/lib/emr/notes";
import { EMR_SETTINGS_DEFAULTS } from "@/lib/emr/settings";

const KEY = Buffer.alloc(32, 7).toString("base64");
const KEY2 = Buffer.alloc(32, 9).toString("base64");

/* ─── Fixtures: satisfy a rule, independently of the engine ───────── */

// The form's field names (the referral form's receiving field is receiving_facility).
const FIELD: Record<string, string> = {
  "req.reason": "reason",
  "req.urgency": "urgency",
  "req.receiving": "receiving_facility",
  "req.part1a": "part1a",
  "req.underlying": "underlying",
  "req.text": "text",
};

function satisfy(rule: SignRule): { sections: Record<string, NoteSection>; ctx: SignContext } {
  const sid = rule.section ?? "";
  const kind = rule.itemKinds?.[0] ?? "";
  switch (rule.check) {
    case "section_has_any":
      return {
        sections: {
          [sid]: {
            items: [
              { kind, ...(kind === "diagnosis_deferred" ? { reason: "awaiting mRDT" } : {}) },
            ],
          },
        },
        ctx: {},
      };
    case "section_has_content":
      return { sections: { [sid]: { narrative: "Written." } }, ctx: {} };
    case "any_section_has_content":
      return {
        sections: { [rule.sections![0]!]: { narrative: "Comfortable overnight." } },
        ctx: {},
      };
    case "field_present":
      return { sections: { [sid]: { fields: { [FIELD[rule.id]!]: "filled" } } }, ctx: {} };
    case "item_true":
      return { sections: { [sid]: { items: [{ kind, confirmed: true }] } }, ctx: {} };
    case "allergy_status_recorded":
      return { sections: {}, ctx: { allergyStatus: "no_known_drug_allergies" } };
    case "medicines_reconciled":
      return { sections: {}, ctx: { medicinesReconciled: true } };
  }
}

function build(rules: SignRule[]): { content: NoteContent; ctx: SignContext } {
  const content: NoteContent = { sections: {} };
  let ctx: SignContext = {};
  for (const r of rules) {
    const s = satisfy(r);
    ctx = { ...ctx, ...s.ctx };
    for (const [id, part] of Object.entries(s.sections)) {
      const cur = content.sections[id] ?? {};
      content.sections[id] = {
        narrative: part.narrative ?? cur.narrative,
        items: [...(cur.items ?? []), ...(part.items ?? [])],
        fields: { ...cur.fields, ...part.fields },
      };
    }
  }
  return { content, ctx };
}

const signable = NOTE_TEMPLATES.templates.filter((t) => t.kind !== "module");
const allRules = signable.flatMap((t) =>
  [...t.minimumToSign.required, ...t.minimumToSign.prompted].map((rule) => ({ template: t, rule })),
);

describe("template catalogue (note-templates.v1.json)", () => {
  it("parses, and its counts match: 10 templates, 2 modules, 65 sections, 27 required, 4 prompted", () => {
    expect(NOTE_TEMPLATES.counts).toEqual({
      templates: 10,
      modules: 2,
      sections: 65,
      requiredRules: 27,
      promptedRules: 4,
    });
    expect(signable).toHaveLength(10);
    expect(allRules).toHaveLength(31);
  });
  it("every required rule names a real, non-optional section", () => {
    for (const t of signable) {
      for (const r of t.minimumToSign.required) {
        if (!r.section) continue;
        expect(t.sections.find((s) => s.id === r.section)?.optional, `${t.id}/${r.id}`).toBe(false);
      }
    }
  });
  // A loosely typed, mutable copy of the file to break one thing at a time.
  type Loose = {
    templates: {
      sections: { items: { kind: string }[] }[];
      minimumToSign: { required: { section?: string; check: string }[] };
    }[];
    counts: { requiredRules: number };
  };
  const broken = (mutate: (first: Loose["templates"][number], all: Loose) => void) => {
    const bad = structuredClone(rawTemplates) as unknown as Loose;
    mutate(bad.templates[0]!, bad);
    return bad;
  };

  it("a rule on a missing section is refused at load", () => {
    const bad = broken((t) => void (t.minimumToSign.required[0]!.section = "s99"));
    expect(() => parseTemplateCatalogue(bad)).toThrow(/no section s99/);
  });
  it("an undeclared item kind is refused at load", () => {
    const bad = broken((t) => void (t.sections[0]!.items[0]!.kind = "free_for_all"));
    expect(() => parseTemplateCatalogue(bad)).toThrow(/undeclared item kind/);
  });
  it("counts that disagree with the file are refused", () => {
    const bad = broken((_t, all) => void (all.counts.requiredRules = 26));
    expect(() => parseTemplateCatalogue(bad)).toThrow(/counts/);
  });
  it("an unknown check (a rules DSL creeping in) is refused", () => {
    const bad = broken((t) => void (t.minimumToSign.required[0]!.check = "javascript"));
    expect(() => parseTemplateCatalogue(bad)).toThrow();
  });
  it("getTemplate finds by id and refuses an unknown one", () => {
    expect(getTemplate("tpl.progress").noteType).toBe("progress");
    expect(() => getTemplate("tpl.nope")).toThrow();
  });
});

describe("minimum to sign: every rule passes and fails", () => {
  for (const { template, rule } of allRules) {
    const others = [...template.minimumToSign.required, ...template.minimumToSign.prompted].filter(
      (r) => r.id !== rule.id,
    );
    const required = template.minimumToSign.required.includes(rule);

    it(`${template.id} ${rule.id} passes when met`, () => {
      const { content, ctx } = build([...others, rule]);
      expect(validateForSigning(template, content, ctx)).toEqual({
        canSign: true,
        missing: [],
        warnings: [],
      });
    });
    it(`${template.id} ${rule.id} ${required ? "blocks Sign" : "warns only"} when unmet`, () => {
      const { content, ctx } = build(others);
      const v = validateForSigning(template, content, ctx);
      const hit = { id: rule.id, message: rule.message };
      expect(v.canSign).toBe(!required);
      expect(required ? v.missing : v.warnings).toEqual([hit]);
      expect(required ? v.warnings : v.missing).toEqual([]);
    });
  }
});

describe("minimum to sign: the edges", () => {
  const opd = getTemplate("tpl.clerking.adult_opd");
  const full = () => build([...opd.minimumToSign.required, ...opd.minimumToSign.prompted]);

  it("an empty note lists every required rule, in template order", () => {
    const v = validateForSigning(opd, { sections: {} });
    expect(v.missing.map((m) => m.id)).toEqual(["req.complaint", "req.impression", "req.plan"]);
    expect(v.warnings.map((m) => m.id)).toEqual(["warn.allergy_status", "warn.examination"]);
  });
  it("'diagnosis deferred' counts only with a reason", () => {
    const { content, ctx } = full();
    content.sections.s13 = { items: [{ kind: "diagnosis_deferred", reason: "  " }] };
    expect(validateForSigning(opd, content, ctx).missing.map((m) => m.id)).toEqual([
      "req.impression",
    ]);
    content.sections.s13 = { items: [{ kind: "diagnosis_deferred", reason: "awaiting results" }] };
    expect(validateForSigning(opd, content, ctx).canSign).toBe(true);
  });
  it("a diagnosis satisfies the impression without a deferral", () => {
    const { content, ctx } = full();
    content.sections.s13 = { items: [{ kind: "encounter_diagnosis", termId: "t1" }] };
    expect(validateForSigning(opd, content, ctx).canSign).toBe(true);
  });
  it("an item of the wrong kind in the right section does not count", () => {
    const { content, ctx } = full();
    content.sections.s01 = { items: [{ kind: "finding" }] };
    expect(validateForSigning(opd, content, ctx).missing.map((m) => m.id)).toEqual([
      "req.complaint",
    ]);
  });
  it("'not recorded' allergy status warns; listed, NKDA and unable to assess do not", () => {
    const { content } = full();
    expect(
      validateForSigning(opd, content, { allergyStatus: "not_recorded" }).warnings.map((w) => w.id),
    ).toEqual(["warn.allergy_status"]);
    for (const allergyStatus of [
      "listed",
      "no_known_drug_allergies",
      "unable_to_assess",
    ] as const) {
      expect(validateForSigning(opd, content, { allergyStatus }).warnings).toEqual([]);
    }
  });
  it("whitespace-only narrative and fields are not content", () => {
    const t = getTemplate("tpl.referral");
    const { content, ctx } = build([...t.minimumToSign.required, ...t.minimumToSign.prompted]);
    content.sections.s03 = { narrative: " \n\t " };
    content.sections.s02 = { ...content.sections.s02, fields: { reason: " ", urgency: "urgent" } };
    expect(validateForSigning(t, content, ctx).missing.map((m) => m.id)).toEqual([
      "req.reason",
      "req.summary",
    ]);
  });
  it("time-out must be confirmed true, not merely present", () => {
    const t = getTemplate("tpl.procedure");
    const { content, ctx } = build(t.minimumToSign.required);
    content.sections.s03 = { items: [{ kind: "time_out", confirmed: false }] };
    expect(validateForSigning(t, content, ctx).missing.map((m) => m.id)).toEqual(["req.time_out"]);
  });
});

describe("note-born items (committed as facts at signing)", () => {
  it("lists complaint tokens, findings, exam findings and ROS only; chart actions are not re-committed", () => {
    const content: NoteContent = {
      sections: {
        s14: { items: [{ kind: "order" }, { kind: "follow_up" }] },
        s01: { items: [{ kind: "complaint_token", token: "fever" }, { kind: "visit_reason" }] },
        s11: { items: [{ kind: "exam_finding", concept: "sign.pallor" }, { kind: "vital_signs" }] },
        s07: { items: [{ kind: "allergy_status" }] },
      },
    };
    expect(noteBornItems(content).map((x) => `${x.sectionId}:${x.item.kind}`)).toEqual([
      "s01:complaint_token",
      "s11:exam_finding",
    ]);
  });
});

/* ─── Canonical composition and HMAC ──────────────────────────────── */

const NOTE: CanonicalNoteInput = {
  id: "11111111-1111-4111-8111-111111111111",
  hospitalId: "22222222-2222-4222-8222-222222222222",
  patientUserId: "33333333-3333-4333-8333-333333333333",
  encounterId: "44444444-4444-4444-8444-444444444444",
  noteType: "progress",
  templateId: "tpl.progress",
  templateVersion: "1.0.0",
  authorUserId: "55555555-5555-4555-8555-555555555555",
  authorCadre: "MO",
  addendumTo: null,
  effectiveAt: new Date("2026-09-26T08:00:00.000Z"),
  signedAt: new Date("2026-09-26T10:52:00.000Z"),
  content: { sections: { s03: { narrative: "Improving." }, s04: { narrative: "Continue." } } },
};

describe("canonical composition", () => {
  it("is key-sorted JSON with no whitespace", () => {
    expect(stableStringify({ b: 1, a: [2, { d: null, c: "x" }] })).toBe(
      '{"a":[2,{"c":"x","d":null}],"b":1}',
    );
  });
  it("drops undefined properties, keeps null, and writes a Date as ISO", () => {
    expect(stableStringify({ a: undefined, b: null, c: new Date(0) })).toBe(
      '{"b":null,"c":"1970-01-01T00:00:00.000Z"}',
    );
  });
  it("refuses non-finite numbers and functions", () => {
    expect(() => stableStringify({ a: Number.NaN })).toThrow();
    expect(() => stableStringify({ a: Infinity })).toThrow();
    expect(() => stableStringify({ a: () => 1 })).toThrow();
  });
  it("never alters narrative whitespace (it is content)", () => {
    expect(stableStringify({ n: " two  spaces\n" })).toBe('{"n":" two  spaces\\n"}');
    expect(stableStringify({ n: "a" })).not.toBe(stableStringify({ n: "a " }));
  });
  it("the exact composition of a note", () => {
    expect(canonicalNote(NOTE)).toBe(
      '{"addendumTo":null,"authorCadre":"MO","authorUserId":"55555555-5555-4555-8555-555555555555",' +
        '"content":{"sections":{"s03":{"narrative":"Improving."},"s04":{"narrative":"Continue."}}},' +
        '"effectiveAt":"2026-09-26T08:00:00.000Z","encounterId":"44444444-4444-4444-8444-444444444444",' +
        '"hospitalId":"22222222-2222-4222-8222-222222222222","noteId":"11111111-1111-4111-8111-111111111111",' +
        '"noteType":"progress","patientUserId":"33333333-3333-4333-8333-333333333333",' +
        '"signedAt":"2026-09-26T10:52:00.000Z","templateId":"tpl.progress","templateVersion":"1.0.0",' +
        '"v":"medsync.clinical_note.v1"}',
    );
  });
  it.each([
    "id",
    "authorUserId",
    "signedAt",
    "effectiveAt",
    "templateVersion",
    "addendumTo",
  ] as const)("changing %s changes the composition", (field) => {
    const other = { ...NOTE, [field]: field.endsWith("At") ? new Date(1) : "changed" };
    expect(canonicalNote(other)).not.toBe(canonicalNote(NOTE));
  });
});

describe("HMAC (E10)", () => {
  it("the exact input string: version line, newline, canonical JSON", () => {
    expect(noteHmacInput('{"a":1}')).toBe('medsync.clinical_note.v1\n{"a":1}');
  });
  it("is HMAC-SHA-256 over those UTF-8 bytes with the decoded key", () => {
    const c = canonicalNote({
      ...NOTE,
      content: { sections: { s03: { narrative: "Omusujja — ✓" } } },
    });
    const want = createHmac("sha256", Buffer.from(KEY, "base64"))
      .update(Buffer.from(`medsync.clinical_note.v1\n${c}`, "utf8"))
      .digest("hex");
    expect(hmacNote(c, KEY)).toBe(want);
    expect(hmacNote(c, KEY)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("a golden vector pins the composition (changing it breaks every stored HMAC)", () => {
    expect(hmacNote(canonicalNote(NOTE), KEY)).toBe(GOLDEN);
  });
  it("a missing key is an explicit error the caller shows", () => {
    for (const k of [undefined, "", "   "]) {
      expect(() => hmacNote("{}", k)).toThrow(NoteHmacKeyError);
      expect(() => hmacNote("{}", k)).toThrow(/MEDSYNC_NOTE_HMAC_KEY is not set/);
    }
  });
  it("a short or non-base64 key is refused", () => {
    expect(() => hmacNote("{}", Buffer.alloc(16).toString("base64"))).toThrow(/at least 32 bytes/);
    expect(() => hmacNote("{}", "not base64 at all!!".repeat(4))).toThrow(NoteHmacKeyError);
  });
  it("different keys give different HMACs and different key ids", () => {
    const c = canonicalNote(NOTE);
    expect(hmacNote(c, KEY)).not.toBe(hmacNote(c, KEY2));
    expect(noteHmacKeyId(KEY)).not.toBe(noteHmacKeyId(KEY2));
    expect(noteHmacKeyId(KEY)).toMatch(/^[0-9a-f]{16}$/);
  });
  it("verify: true for the stored HMAC, false after any change", () => {
    const c = canonicalNote(NOTE);
    const h = hmacNote(c, KEY);
    expect(verifyNoteHmac(c, h, KEY)).toBe(true);
    expect(verifyNoteHmac(c.replace("Improving", "Worsening"), h, KEY)).toBe(false);
    expect(verifyNoteHmac(c, h, KEY2)).toBe(false);
    expect(verifyNoteHmac(c, "zz", KEY)).toBe(false);
  });
});

// HMAC of NOTE under KEY; see the golden-vector test.
const GOLDEN = "35eba9d6b5a2a460ea10ac09c4726a006062f56a6aceebff8e513d8b20b63c6c";

/* ─── Property: a signed note never changes when re-composed ──────── */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = ["a", "Z", " ", "\n", "\t", "é", "—", "✓", '"', "\\", "0", "{", "}"];
function randomValue(rnd: () => number, depth: number): unknown {
  const pick = Math.floor(rnd() * (depth > 2 ? 4 : 6));
  const str = () =>
    Array.from(
      { length: Math.floor(rnd() * 12) },
      () => ALPHABET[Math.floor(rnd() * ALPHABET.length)],
    ).join("");
  switch (pick) {
    case 0:
      return str();
    case 1:
      return Math.round((rnd() - 0.5) * 1e6) / 100;
    case 2:
      return rnd() < 0.5;
    case 3:
      return null;
    case 4:
      return Array.from({ length: Math.floor(rnd() * 4) }, () => randomValue(rnd, depth + 1));
    default: {
      const o: Record<string, unknown> = {};
      for (let i = Math.floor(rnd() * 5); i > 0; i--)
        o[`k${Math.floor(rnd() * 20)}${str().slice(0, 2)}`] = randomValue(rnd, depth + 1);
      return o;
    }
  }
}

/** The same object with every object's keys inserted in a shuffled order. */
function shuffleKeys(v: unknown, rnd: () => number): unknown {
  if (Array.isArray(v)) return v.map((x) => shuffleKeys(x, rnd));
  if (v === null || typeof v !== "object") return v;
  const entries = Object.entries(v).sort(() => rnd() - 0.5);
  return Object.fromEntries(entries.map(([k, x]) => [k, shuffleKeys(x, rnd)]));
}

describe("property: canonical content and HMAC never change when re-composed (200 seeds)", () => {
  for (let seed = 1; seed <= 200; seed++) {
    it(`seed ${seed}`, () => {
      const rnd = mulberry32(seed);
      const sections: Record<string, NoteSection> = {};
      for (let i = 0; i < 1 + Math.floor(rnd() * 5); i++) {
        sections[`s0${i}`] = {
          narrative: String(randomValue(rnd, 3) ?? ""),
          items: [{ kind: "finding", payload: randomValue(rnd, 0) }],
          fields: { f: rnd() < 0.5 ? "x" : undefined },
        };
      }
      const note: CanonicalNoteInput = {
        ...NOTE,
        content: { header: { extra: randomValue(rnd, 0) }, sections },
        signedAt: new Date(Date.UTC(2026, 8, 26) + Math.floor(rnd() * 1e9)),
      };
      const canonical = canonicalNote(note);
      const hmac = hmacNote(canonical, KEY);

      // Stored (encrypted JSON) and read back, keys in another order: the same bytes, the same HMAC.
      const stored = JSON.parse(JSON.stringify(note.content)) as NoteContent;
      const reread = { ...note, content: shuffleKeys(stored, rnd) as NoteContent };
      expect(canonicalNote(reread)).toBe(canonical);
      expect(hmacNote(canonicalNote(reread), KEY)).toBe(hmac);
      // Re-composing is deterministic and verifies.
      expect(canonicalNote(note)).toBe(canonical);
      expect(verifyNoteHmac(canonical, hmac, KEY)).toBe(true);
      // Any edit to the content is detected.
      const edited = {
        ...note,
        content: { ...note.content, sections: { ...sections, s99: { narrative: "x" } } },
      };
      expect(hmacNote(canonicalNote(edited), KEY)).not.toBe(hmac);
    });
  }
});

/* ─── Late entry ──────────────────────────────────────────────────── */

describe("late entry (hospital setting, default 24 h)", () => {
  const W = EMR_SETTINGS_DEFAULTS.lateEntryWindowMs;
  const eff = new Date("2026-09-26T08:00:00Z");
  it("exactly at the window is on time; one millisecond past is late", () => {
    expect(isLateEntry(eff, new Date(eff.getTime() + W), W)).toBe(false);
    expect(isLateEntry(eff, new Date(eff.getTime() + W + 1), W)).toBe(true);
  });
  it("signing before the effective time is never late", () => {
    expect(isLateEntry(eff, new Date(eff.getTime() - 1), W)).toBe(false);
  });
  it("a hospital's shorter window applies", () => {
    expect(isLateEntry(eff, new Date(eff.getTime() + 61_000), 60_000)).toBe(true);
  });
});

/* ─── Sign plan ───────────────────────────────────────────────────── */

describe("planSign", () => {
  const draft = { ...NOTE, state: "draft" };
  const { signedAt: _drop, ...unsigned } = draft;
  void _drop;
  const input = {
    signedAt: NOTE.signedAt,
    key: KEY,
    lateEntryWindowMs: EMR_SETTINGS_DEFAULTS.lateEntryWindowMs,
  };

  it("returns the canonical form, HMAC, key id and late flag when the minimum is met", () => {
    const p = planSign(unsigned, input);
    expect(p).toMatchObject({
      ok: true,
      canonical: canonicalNote(NOTE),
      hmacKeyId: noteHmacKeyId(KEY),
      lateEntry: false,
    });
    expect(p.ok && p.contentHmac).toBe(hmacNote(canonicalNote(NOTE), KEY));
  });
  it("returns what is missing, and computes no HMAC", () => {
    const p = planSign({ ...unsigned, content: { sections: {} } }, { ...input, key: undefined });
    expect(p).toEqual({
      ok: false,
      missing: [
        { id: "req.assessment", message: "Add the assessment." },
        { id: "req.plan", message: "Add the plan." },
      ],
      warnings: [],
    });
  });
  it("a missing key on a signable note throws the explicit key error", () => {
    expect(() => planSign(unsigned, { ...input, key: undefined })).toThrow(NoteHmacKeyError);
  });
  it("flags a late entry", () => {
    const late = new Date(NOTE.effectiveAt.getTime() + 2 * 86_400_000);
    expect(planSign(unsigned, { ...input, signedAt: late })).toMatchObject({
      ok: true,
      lateEntry: true,
    });
  });
  it("a signed note cannot be signed again", () => {
    expect(() => planSign({ ...unsigned, state: "signed" }, input)).toThrow();
  });
});

/* ─── Note state (clinical_note_events) ───────────────────────────── */

describe("note state rules", () => {
  const AUTHOR = "author";
  const ctx = { authorUserId: AUTHOR, openCosignRequestId: "req-1" };
  const ev = (kind: string, actorUserId = "senior", cosignRequestId: string | null = "req-1") => ({
    kind,
    actorUserId,
    cosignRequestId,
  });

  it("a draft takes no events", () => {
    for (const k of ["cosign_requested", "cosigned", "addendum_added", "entered_in_error"]) {
      expect(applyNoteEvent("draft", ev(k), ctx).ok).toBe(false);
    }
  });
  it("signed → awaiting co-sign → co-signed", () => {
    expect(applyNoteEvent("signed", ev("cosign_requested"), ctx)).toEqual({
      ok: true,
      next: "awaiting_cosign",
    });
    expect(applyNoteEvent("awaiting_cosign", ev("cosigned"), ctx)).toEqual({
      ok: true,
      next: "cosigned",
    });
  });
  it("co-sign without a request, twice, by the author, or against another request is refused", () => {
    expect(applyNoteEvent("signed", ev("cosigned"), ctx).ok).toBe(false);
    expect(applyNoteEvent("cosigned", ev("cosigned"), ctx).ok).toBe(false);
    expect(applyNoteEvent("awaiting_cosign", ev("cosign_requested"), ctx).ok).toBe(false);
    expect(applyNoteEvent("awaiting_cosign", ev("cosigned", AUTHOR), ctx)).toEqual({
      ok: false,
      reason: "the author cannot co-sign",
    });
    expect(applyNoteEvent("awaiting_cosign", ev("cosigned", "senior", "req-2"), ctx).ok).toBe(
      false,
    );
  });
  it("addenda attach to any signed status and leave it alone", () => {
    for (const s of ["signed", "awaiting_cosign", "cosigned"] as const) {
      expect(applyNoteEvent(s, ev("addendum_added"), ctx)).toEqual({ ok: true, next: s });
    }
  });
  it("entered in error from any signed status, and it is terminal", () => {
    for (const s of ["signed", "awaiting_cosign", "cosigned"] as const) {
      expect(applyNoteEvent(s, ev("entered_in_error"), ctx)).toEqual({
        ok: true,
        next: "entered_in_error",
      });
    }
    for (const k of ["cosign_requested", "cosigned", "addendum_added", "entered_in_error"]) {
      expect(applyNoteEvent("entered_in_error", ev(k), ctx).ok).toBe(false);
    }
  });
  it("noteStatus folds the events in time order and reports refused ones", () => {
    const t = (m: number) => new Date(Date.UTC(2026, 8, 26, 10, m));
    const events = [
      {
        id: "e3",
        kind: "cosigned",
        actorUserId: "senior",
        cosignRequestId: "req-1",
        recordedAt: t(3),
      },
      {
        id: "e1",
        kind: "cosign_requested",
        actorUserId: AUTHOR,
        cosignRequestId: "req-1",
        recordedAt: t(1),
      },
      {
        id: "e2",
        kind: "addendum_added",
        actorUserId: AUTHOR,
        cosignRequestId: null,
        recordedAt: t(2),
      },
    ];
    expect(noteStatus({ state: "signed", authorUserId: AUTHOR }, events)).toEqual({
      status: "cosigned",
      rejectedEventIds: [],
    });
    const bad = [
      { id: "x", kind: "cosigned", actorUserId: "senior", cosignRequestId: "r", recordedAt: t(0) },
    ];
    expect(noteStatus({ state: "signed", authorUserId: AUTHOR }, bad)).toEqual({
      status: "signed",
      rejectedEventIds: ["x"],
    });
    expect(noteStatus({ state: "draft", authorUserId: AUTHOR }, []).status).toBe("draft");
  });
});

/* ─── Addendum threading ──────────────────────────────────────────── */

describe("addendum threading", () => {
  const t = (h: number) => new Date(Date.UTC(2026, 8, 26, h));
  const n = (id: string, addendumTo: string | null, h: number, signed = true) => ({
    id,
    addendumTo,
    signedAt: signed ? t(h) : null,
    recordedAt: t(h),
  });

  it("parents in time order with their addenda ordered under them", () => {
    const threads = threadNotes([
      n("a2", "p1", 14),
      n("p2", null, 9),
      n("a1", "p1", 12),
      n("p1", null, 8),
    ]);
    expect(threads.map((x) => [x.note.id, x.addenda.map((a) => a.note.id)])).toEqual([
      ["p1", ["a1", "a2"]],
      ["p2", []],
    ]);
  });
  it("an addendum to an addendum nests", () => {
    const [root] = threadNotes([n("p", null, 1), n("a", "p", 2), n("aa", "a", 3)]);
    expect(root?.addenda[0]?.addenda[0]?.note.id).toBe("aa");
  });
  it("an addendum whose parent is not visible is shown as its own root, never hidden", () => {
    expect(threadNotes([n("a", "missing", 2)]).map((x) => x.note.id)).toEqual(["a"]);
  });
  it("ties break by id; an unsigned note orders by its recorded time", () => {
    const threads = threadNotes([n("b", null, 5), n("a", null, 5), n("d", null, 1, false)]);
    expect(threads.map((x) => x.note.id)).toEqual(["d", "a", "b"]);
  });
});
