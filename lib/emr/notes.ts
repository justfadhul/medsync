import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NoteContent, NoteItem, SignContext, SignValidation } from "./note-rules";
import type { ClinicalNote, ClinicalNoteEvent } from "@/db/schema/emr";
import { z } from "zod";

import rawTemplates from "@/data/emr/note-templates.v1.json";
import { validateForSigning } from "./note-rules";

/**
 * The note model (PROMPT §5.9, gate-a-proposal §A.4, ADR 0134). PURE apart from node:crypto:
 * templates are data (note-templates.v1.json, CSO-signed D-EMR-15), minimum-to-sign is a closed
 * list of checks (D-NCD-02: no rules DSL), and a signed note is tamper-evident through an
 * HMAC-SHA-256 over one canonical composition, keyed by MEDSYNC_NOTE_HMAC_KEY (E10, O-2).
 */

/* ─── Templates ───────────────────────────────────────────────────── */

const CHECKS = [
  "section_has_any",
  "section_has_content",
  "any_section_has_content",
  "field_present",
  "item_true",
  "allergy_status_recorded",
  "medicines_reconciled",
] as const;

const ruleSchema = z.object({
  id: z.string().regex(/^(req|warn)\./),
  check: z.enum(CHECKS),
  message: z.string().min(1),
  section: z.string().optional(),
  sections: z.array(z.string()).optional(),
  itemKinds: z.array(z.string()).optional(),
  field: z.string().optional(),
});

const sectionSchema = z.object({
  id: z.string(),
  number: z.string(),
  title: z.string(),
  kind: z.enum(["structured", "mixed", "narrative"]),
  items: z.array(z.object({ kind: z.string() }).passthrough()),
  optional: z.boolean(),
});

const templateSchema = z.object({
  id: z.string(),
  version: z.string(),
  noteType: z.string().nullable(),
  kind: z.literal("module").optional(),
  title: z.string(),
  reference: z.string(),
  sections: z.array(sectionSchema).min(1),
  minimumToSign: z.object({ required: z.array(ruleSchema), prompted: z.array(ruleSchema) }),
});

const catalogueSchema = z.object({
  catalogue: z.literal("medsync.emr.note-templates"),
  version: z.string(),
  status: z.literal("cso_signed"),
  itemKinds: z.record(z.string(), z.string()),
  templates: z.array(templateSchema),
  counts: z.object({
    templates: z.number(),
    modules: z.number(),
    sections: z.number(),
    requiredRules: z.number(),
    promptedRules: z.number(),
  }),
});

export type NoteTemplate = z.infer<typeof templateSchema>;
export type SignRule = z.infer<typeof ruleSchema>;
export type NoteTemplateCatalogue = z.infer<typeof catalogueSchema>;

/** Parse and cross-check the catalogue: every rule names a real, non-optional section, every item
 *  kind is declared, and the counts match. Throws on the first defect (a broken file never loads). */
export function parseTemplateCatalogue(raw: unknown): NoteTemplateCatalogue {
  const cat = catalogueSchema.parse(raw);
  const kinds = new Set(Object.keys(cat.itemKinds));
  let modules = 0;
  let sections = 0;
  let required = 0;
  let prompted = 0;
  for (const t of cat.templates) {
    if (t.kind === "module") modules++;
    sections += t.sections.length;
    required += t.minimumToSign.required.length;
    prompted += t.minimumToSign.prompted.length;
    const byId = new Map(t.sections.map((s) => [s.id, s]));
    for (const s of t.sections) {
      for (const item of s.items) {
        if (!kinds.has(item.kind))
          throw new Error(`${t.id}/${s.id}: undeclared item kind ${item.kind}`);
      }
    }
    for (const r of t.minimumToSign.required) {
      for (const sid of r.section ? [r.section] : (r.sections ?? [])) {
        const s = byId.get(sid);
        if (!s) throw new Error(`${t.id}/${r.id}: no section ${sid}`);
        if (s.optional && r.section)
          throw new Error(`${t.id}/${r.id}: required rule on optional ${sid}`);
      }
      for (const k of r.itemKinds ?? []) {
        if (!kinds.has(k)) throw new Error(`${t.id}/${r.id}: undeclared item kind ${k}`);
      }
    }
  }
  const c = cat.counts;
  if (
    c.templates !== cat.templates.length - modules ||
    c.modules !== modules ||
    c.sections !== sections ||
    c.requiredRules !== required ||
    c.promptedRules !== prompted
  ) {
    throw new Error("note-templates counts do not match the file");
  }
  return cat;
}

export const NOTE_TEMPLATES: NoteTemplateCatalogue = parseTemplateCatalogue(rawTemplates);

export function getTemplate(id: string): NoteTemplate {
  const t = NOTE_TEMPLATES.templates.find((x) => x.id === id);
  if (!t) throw new Error(`unknown note template ${id}`);
  return t;
}

/* ─── Draft content and minimum-to-sign ───────────────────────────── */
// Crypto-free, so the clerking desk runs the same check in the browser (lib/emr/note-rules.ts).
export {
  checkRule,
  validateForSigning,
  type NoteContent,
  type NoteItem,
  type NoteSection,
  type SignContext,
  type SignValidation,
} from "./note-rules";
/** Note-born structured items commit as facts at signing (D-EMR-01); everything else was a chart
 *  action that committed at once. */
const NOTE_BORN = new Set(["complaint_token", "finding", "exam_finding", "ros_grid"]);
export function noteBornItems(content: NoteContent): { sectionId: string; item: NoteItem }[] {
  return Object.keys(content.sections)
    .sort()
    .flatMap((sectionId) =>
      (content.sections[sectionId]?.items ?? [])
        .filter((item) => NOTE_BORN.has(item.kind))
        .map((item) => ({ sectionId, item })),
    );
}

/* ─── Canonical composition and HMAC (E10) ────────────────────────── */

/** Key-sorted JSON with no whitespace; arrays keep their order; undefined is dropped; a Date is
 *  its ISO string. Strings are never altered: narrative whitespace is content. */
export function stableStringify(v: unknown): string {
  if (v === null) return "null";
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  switch (typeof v) {
    case "string":
    case "boolean":
      return JSON.stringify(v);
    case "number":
      if (!Number.isFinite(v)) throw new Error("canonical JSON: non-finite number");
      return JSON.stringify(v);
    case "object": {
      if (Array.isArray(v))
        return `[${v.map((x) => (x === undefined ? "null" : stableStringify(x))).join(",")}]`;
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
    }
    default:
      throw new Error(`canonical JSON: unsupported ${typeof v}`);
  }
}

export type CanonicalNoteInput = Pick<
  ClinicalNote,
  | "id"
  | "hospitalId"
  | "patientUserId"
  | "encounterId"
  | "noteType"
  | "templateId"
  | "templateVersion"
  | "authorUserId"
  | "authorCadre"
  | "addendumTo"
  | "effectiveAt"
> & { signedAt: Date; content: NoteContent };

/** Bump only with a migration plan: every stored HMAC is over this version's composition. */
export const NOTE_CANONICAL_VERSION = "medsync.clinical_note.v1";

/** The canonical composition of a signed note: its content, ids, author and times. */
export function canonicalNote(n: CanonicalNoteInput): string {
  return stableStringify({
    v: NOTE_CANONICAL_VERSION,
    noteId: n.id,
    hospitalId: n.hospitalId,
    patientUserId: n.patientUserId,
    encounterId: n.encounterId,
    noteType: n.noteType,
    templateId: n.templateId,
    templateVersion: n.templateVersion,
    authorUserId: n.authorUserId,
    authorCadre: n.authorCadre,
    addendumTo: n.addendumTo,
    effectiveAt: n.effectiveAt,
    signedAt: n.signedAt,
    content: n.content,
  });
}

/** The exact bytes the HMAC covers (UTF-8): the version line, a newline, the canonical JSON. */
export function noteHmacInput(canonical: string): string {
  return `${NOTE_CANONICAL_VERSION}\n${canonical}`;
}

export class NoteHmacKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoteHmacKeyError";
  }
}

/** MEDSYNC_NOTE_HMAC_KEY: 32+ random bytes, base64 (O-2). Missing or malformed is an explicit
 *  error the caller shows ("notes cannot be signed until the key is set"), never a silent skip. */
function keyBytes(key: string | undefined): Buffer {
  const k = key?.trim();
  if (!k) throw new NoteHmacKeyError("MEDSYNC_NOTE_HMAC_KEY is not set: notes cannot be signed.");
  const bytes = /^[A-Za-z0-9+/]+={0,2}$/.test(k) ? Buffer.from(k, "base64") : Buffer.alloc(0);
  if (bytes.length < 32) {
    throw new NoteHmacKeyError("MEDSYNC_NOTE_HMAC_KEY must be at least 32 bytes, base64-encoded.");
  }
  return bytes;
}

/** HMAC-SHA-256 (hex) over noteHmacInput(canonical). */
export function hmacNote(canonical: string, key: string | undefined): string {
  return createHmac("sha256", keyBytes(key)).update(noteHmacInput(canonical), "utf8").digest("hex");
}

/** hmac_key_id: names the key without revealing it, so a rotated key can still verify old notes. */
export function noteHmacKeyId(key: string | undefined): string {
  return createHash("sha256").update(keyBytes(key)).digest("hex").slice(0, 16);
}

/** Constant-time check of a stored HMAC against a re-composition. */
export function verifyNoteHmac(canonical: string, hmac: string, key: string | undefined): boolean {
  const a = Buffer.from(hmacNote(canonical, key), "hex");
  const b = Buffer.from(hmac, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ─── Late entry ──────────────────────────────────────────────────── */

/** Late when signed more than the hospital's window after the effective time (the boundary
 *  itself is on time). */
export function isLateEntry(effectiveAt: Date, signedAt: Date, windowMs: number): boolean {
  return signedAt.getTime() - effectiveAt.getTime() > windowMs;
}

/* ─── Signing plan ────────────────────────────────────────────────── */

export type SignPlan =
  | { ok: false; missing: SignValidation["missing"]; warnings: SignValidation["warnings"] }
  | {
      ok: true;
      canonical: string;
      contentHmac: string;
      hmacKeyId: string;
      lateEntry: boolean;
      warnings: SignValidation["warnings"];
      noteBorn: { sectionId: string; item: NoteItem }[];
    };

/** Everything the signing transaction writes, decided in one place. Throws NoteHmacKeyError when
 *  the key is missing (the caller shows it). */
export function planSign(
  note: Omit<CanonicalNoteInput, "signedAt"> & { state: string },
  input: { signedAt: Date; key: string | undefined; lateEntryWindowMs: number; ctx?: SignContext },
): SignPlan {
  if (note.state !== "draft") throw new Error("only a draft can be signed");
  const v = validateForSigning(getTemplate(note.templateId), note.content, input.ctx);
  if (!v.canSign) return { ok: false, missing: v.missing, warnings: v.warnings };
  const canonical = canonicalNote({ ...note, signedAt: input.signedAt });
  return {
    ok: true,
    canonical,
    contentHmac: hmacNote(canonical, input.key),
    hmacKeyId: noteHmacKeyId(input.key),
    lateEntry: isLateEntry(note.effectiveAt, input.signedAt, input.lateEntryWindowMs),
    warnings: v.warnings,
    noteBorn: noteBornItems(note.content),
  };
}

/* ─── Note state (clinical_note_events) ───────────────────────────── */

export type NoteStatus = "draft" | "signed" | "awaiting_cosign" | "cosigned" | "entered_in_error";
export type NoteEventKind = "cosign_requested" | "cosigned" | "addendum_added" | "entered_in_error";

type NoteEventRow = Pick<
  ClinicalNoteEvent,
  "id" | "kind" | "actorUserId" | "cosignRequestId" | "recordedAt"
>;

export type NoteEventCheck = { ok: true; next: NoteStatus } | { ok: false; reason: string };

/**
 * draft → signed → (cosign_requested → awaiting_cosign → cosigned) ; any signed status →
 * entered_in_error (terminal). Addenda attach to any signed, not-in-error note and leave its
 * status alone. A draft has no events (it is signed, or it stays a draft). A co-signer is never the
 * author, and co-signs the open request.
 */
export function applyNoteEvent(
  status: NoteStatus,
  event: Pick<NoteEventRow, "kind" | "actorUserId" | "cosignRequestId">,
  ctx: { authorUserId: string; openCosignRequestId?: string | null },
): NoteEventCheck {
  if (status === "draft") return { ok: false, reason: "a draft has no events; sign it first" };
  if (status === "entered_in_error") return { ok: false, reason: "the note was entered in error" };
  switch (event.kind) {
    case "cosign_requested":
      return status === "signed"
        ? { ok: true, next: "awaiting_cosign" }
        : { ok: false, reason: `co-sign cannot be requested on a ${status} note` };
    case "cosigned":
      if (status !== "awaiting_cosign")
        return { ok: false, reason: "no co-signature was requested" };
      if (event.actorUserId === ctx.authorUserId)
        return { ok: false, reason: "the author cannot co-sign" };
      if (event.cosignRequestId !== ctx.openCosignRequestId) {
        return { ok: false, reason: "co-signature does not answer the open request" };
      }
      return { ok: true, next: "cosigned" };
    case "addendum_added":
      return { ok: true, next: status };
    case "entered_in_error":
      return { ok: true, next: "entered_in_error" };
    default:
      return { ok: false, reason: `unknown event ${event.kind}` };
  }
}

/** The current status: the events folded in time order. An event the rules refuse is reported
 *  (the database should never hold one) and does not move the status. */
export function noteStatus(
  note: Pick<ClinicalNote, "state" | "authorUserId">,
  events: NoteEventRow[],
): { status: NoteStatus; rejectedEventIds: string[] } {
  let status: NoteStatus = note.state === "signed" ? "signed" : "draft";
  let openCosignRequestId: string | null = null;
  const rejectedEventIds: string[] = [];
  const ordered = [...events].sort(
    (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime() || a.id.localeCompare(b.id),
  );
  for (const e of ordered) {
    const r = applyNoteEvent(status, e, { authorUserId: note.authorUserId, openCosignRequestId });
    if (!r.ok) {
      rejectedEventIds.push(e.id);
      continue;
    }
    if (e.kind === "cosign_requested") openCosignRequestId = e.cosignRequestId;
    status = r.next;
  }
  return { status, rejectedEventIds };
}

/* ─── Addendum threading ──────────────────────────────────────────── */

type ThreadNote = Pick<ClinicalNote, "id" | "addendumTo" | "signedAt" | "recordedAt">;
export interface NoteThread<N extends ThreadNote> {
  note: N;
  addenda: NoteThread<N>[];
}

const noteTime = (n: ThreadNote) => (n.signedAt ?? n.recordedAt).getTime();
const byTime = (a: ThreadNote, b: ThreadNote) =>
  noteTime(a) - noteTime(b) || a.id.localeCompare(b.id);

/** Parents with their addenda threaded under them, oldest first at every level. An addendum whose
 *  parent is not in the list (not visible to this reader) shows as its own root, never hidden. */
export function threadNotes<N extends ThreadNote>(notes: N[]): NoteThread<N>[] {
  const ids = new Set(notes.map((n) => n.id));
  const children = new Map<string, N[]>();
  const roots: N[] = [];
  for (const n of notes) {
    if (n.addendumTo && ids.has(n.addendumTo) && n.addendumTo !== n.id) {
      children.set(n.addendumTo, [...(children.get(n.addendumTo) ?? []), n]);
    } else {
      roots.push(n);
    }
  }
  const build = (n: N, seen: Set<string>): NoteThread<N> => {
    const next = new Set(seen).add(n.id);
    return {
      note: n,
      addenda: (children.get(n.id) ?? [])
        .filter((c) => !next.has(c.id))
        .sort(byTime)
        .map((c) => build(c, next)),
    };
  };
  return roots.sort(byTime).map((r) => build(r, new Set()));
}
