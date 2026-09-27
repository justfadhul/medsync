/**
 * Search for the diagnosis picker and the finding tokens (UI-BRIEF §4, PROMPT §13). PURE and small:
 * the term index is loaded once, lazily, and cached on the client; every keystroke ranks it here,
 * well inside the 150 ms budget, with no dependency (cmdk is not allowed).
 *
 * Ranking, best first: the display starts with the query; a word of the display starts with it; a
 * synonym starts with it; a word of a synonym starts with it; the code starts with it. Every word
 * of a multi-word query must start some word. Ties keep the index order (the loader's order).
 */

/** A diagnosis term as the picker sees it (diagnosis_terms). The clinician picks a term. */
export interface DxTerm {
  id: string;
  display: string;
  synonyms: readonly string[];
  /** ICD-11 MMS code, shown with its verification mark; never picked directly. */
  icd11: string | null;
  /** The code was checked against a WHO mirror (diagnosis_terms.verified_on). */
  verified: boolean;
  chronic: boolean;
  symptomLevel: boolean;
  restricted: boolean;
  /** Only once REF-IDSR-CLASSES is signed (none today). */
  notifiable: boolean;
}

export interface Searchable {
  display?: string;
  label?: string;
  synonyms?: readonly string[];
  icd11?: string | null;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();
const words = (s: string) => norm(s).split(" ").filter(Boolean);

/** Lower is better; null = no match. */
export function score(item: Searchable, query: string): number | null {
  const q = norm(query);
  if (!q) return null;
  const qw = q.split(" ");
  const display = norm(item.display ?? item.label ?? "");
  const synonyms = (item.synonyms ?? []).map(norm);
  const all = [display, ...synonyms].flatMap((s) => s.split(" "));
  if (!qw.every((w) => all.some((x) => x.startsWith(w)))) {
    const code = item.icd11 ? norm(item.icd11) : "";
    return code && code.startsWith(q) ? 4 : null;
  }
  if (display.startsWith(q)) return 0;
  if (words(display).some((w) => w.startsWith(qw[0]!))) return 1;
  if (synonyms.some((s) => s.startsWith(q))) return 2;
  return 3;
}

export function rank<T extends Searchable>(index: readonly T[], query: string, limit = 8): T[] {
  const hits: { item: T; s: number; i: number }[] = [];
  index.forEach((item, i) => {
    const s = score(item, query);
    if (s !== null) hits.push({ item, s, i });
  });
  return hits
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, limit)
    .map((h) => h.item);
}

/**
 * The fewest keystrokes that put `target` under the cursor: some prefix of a word of its display
 * or a synonym, then arrow-downs to reach it. The picker budget is ≤ 4 + Enter for the top 50.
 */
export function keystrokesFor<T extends Searchable>(index: readonly T[], target: T): number {
  let best = Number.POSITIVE_INFINITY;
  const candidates = [target.display ?? target.label ?? "", ...(target.synonyms ?? [])].flatMap(
    words,
  );
  for (const w of candidates) {
    for (let k = 1; k <= Math.min(w.length, 6); k++) {
      const at = rank(index, w.slice(0, k), 10).indexOf(target);
      if (at >= 0) best = Math.min(best, k + at);
    }
  }
  return best;
}
