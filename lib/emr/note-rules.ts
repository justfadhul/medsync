/**
 * The note's minimum-to-sign check (clinical reference 2.11), split out of notes.ts with no crypto
 * and no zod so the clerking desk runs the very same check in the browser as the server runs at
 * signing. notes.ts re-exports everything here; the server stays the authority.
 */

export type SignCheck =
  | "section_has_any"
  | "section_has_content"
  | "any_section_has_content"
  | "field_present"
  | "item_true"
  | "allergy_status_recorded"
  | "medicines_reconciled";

/** Structurally the zod-parsed rule of note-templates.v1.json (notes.ts SignRule). */
export interface SignRule {
  id: string;
  check: SignCheck;
  message: string;
  section?: string;
  sections?: string[];
  itemKinds?: string[];
  field?: string;
}

/* ─── Draft content (the decrypted content_ciphertext) ────────────── */

export interface NoteItem {
  kind: string;
  /** item_true (time-out confirmed). */
  confirmed?: boolean;
  /** diagnosis_deferred needs one to count. */
  reason?: string;
  [key: string]: unknown;
}

export interface NoteSection {
  narrative?: string;
  items?: NoteItem[];
  fields?: Record<string, string | null | undefined>;
}

export interface NoteContent {
  header?: Record<string, unknown>;
  sections: Record<string, NoteSection>;
}

export interface SignContext {
  /** From lib/emr/allergy.ts resolveAllergyStatus(...).kind. */
  allergyStatus?: "listed" | "no_known_drug_allergies" | "unable_to_assess" | "not_recorded";
  /** Every current medication statement has a reconciliation this encounter. */
  medicinesReconciled?: boolean;
}

const filled = (v: unknown): boolean => typeof v === "string" && v.trim().length > 0;

/** An item counts when it is really there: a deferred diagnosis only with its reason. */
function itemCounts(item: NoteItem): boolean {
  return item.kind !== "diagnosis_deferred" || filled(item.reason);
}

function sectionHasContent(s: NoteSection | undefined): boolean {
  if (!s) return false;
  return (
    filled(s.narrative) ||
    (s.items ?? []).some(itemCounts) ||
    Object.values(s.fields ?? {}).some(filled)
  );
}

/** field_present names its field by rule id (req.reason → reason), except where the form's
 *  field name differs. */
const RULE_FIELD: Record<string, string> = { "req.receiving": "receiving_facility" };
function fieldOf(rule: SignRule): string {
  return rule.field ?? RULE_FIELD[rule.id] ?? rule.id.slice(rule.id.indexOf(".") + 1);
}

export function checkRule(rule: SignRule, content: NoteContent, ctx: SignContext): boolean {
  const section = rule.section ? content.sections[rule.section] : undefined;
  const kinds = new Set(rule.itemKinds ?? []);
  switch (rule.check) {
    case "section_has_any":
      return (section?.items ?? []).some((i) => kinds.has(i.kind) && itemCounts(i));
    case "section_has_content":
      return sectionHasContent(section);
    case "any_section_has_content":
      return (rule.sections ?? []).some((id) => sectionHasContent(content.sections[id]));
    case "field_present":
      return filled(section?.fields?.[fieldOf(rule)]);
    case "item_true":
      return (section?.items ?? []).some((i) => kinds.has(i.kind) && i.confirmed === true);
    case "allergy_status_recorded":
      return !!ctx.allergyStatus && ctx.allergyStatus !== "not_recorded";
    case "medicines_reconciled":
      return ctx.medicinesReconciled === true;
  }
}

export interface SignValidation {
  canSign: boolean;
  /** Required rules not met: Sign stays disabled. */
  missing: { id: string; message: string }[];
  /** Prompted rules not met: shown, never blocking. */
  warnings: { id: string; message: string }[];
}

/** Minimum to sign (clinical reference 2.11). Signing never blocks care; this only gates Sign. */
export function validateForSigning(
  template: { minimumToSign: { required: SignRule[]; prompted: SignRule[] } },
  content: NoteContent,
  ctx: SignContext = {},
): SignValidation {
  const unmet = (rules: SignRule[]) =>
    rules.filter((r) => !checkRule(r, content, ctx)).map((r) => ({ id: r.id, message: r.message }));
  const missing = unmet(template.minimumToSign.required);
  return {
    canSign: missing.length === 0,
    missing,
    warnings: unmet(template.minimumToSign.prompted),
  };
}
