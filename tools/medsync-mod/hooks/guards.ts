// Pure checks: no `$`, so the tests and the hooks share one source.

export type Finding = { line: string; why: string };

export const list = (csv: string): string[] =>
  csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const rel = (path: string, root: string): string =>
  path.startsWith(root + "/") ? path.slice(root.length + 1) : path.replace(/^\.\//, "");

/** `path` (absolute or repo-relative) starts with one of the repo-relative prefixes. */
export const under = (path: string, root: string, prefixes: readonly string[]): boolean =>
  prefixes.some((p) => rel(path, root).startsWith(p));

/** Lines of `after` that `before` does not hold (a cheap added-lines diff). */
export const addedLines = (before: string, after: string): string[] => {
  const had = new Set(before.split("\n").map((l) => l.trim()));
  return after.split("\n").filter((l) => l.trim() !== "" && !had.has(l.trim()));
};

// ── Emergency screen: signposting only ────────────────────────────────────

const SYMPTOMS =
  /\b(chest pain|bleed(ing)?|breath(ing|less)?|short of breath|unconscious|faint(ing)?|fever|convuls(ion|ions|ing)|seizures?|fits?|vomit(ing)?|headache|dizz(y|iness)|swelling|rash|cough(ing)?|diarrh(o)?ea|abdominal pain|stomach pain|confus(ed|ion)|weakness|numbness|palpitations?|blurred vision|stiff neck|jaundice|dehydrat(ed|ion))\b/i;
const SEVERITY =
  /\b(severe(ly)?|mild(ly)?|moderate(ly)?|worst|serious(ly)?|critical(ly)?|life[- ]threatening|how bad|rate your|scale of|on a scale|intensity)\b/i;
// a question in visible copy: words ending in "?" — not `?.`, `??` or a ` ? ` ternary
const QUESTION = /[A-Za-z][A-Za-z ,'’-]{2,}\?(?![.?])(?=\s*(["'`<]|$|\s[A-Z]))/;

export const scanEmergency = (lines: readonly string[]): Finding[] =>
  lines.flatMap((line) => {
    const why = [
      QUESTION.test(line) && "question",
      SYMPTOMS.test(line) && `symptom: ${line.match(SYMPTOMS)?.[0]}`,
      SEVERITY.test(line) && `severity: ${line.match(SEVERITY)?.[0]}`,
    ].filter(Boolean);
    return why.length ? [{ line: line.trim().slice(0, 160), why: why.join(", ") }] : [];
  });

// ── Patient data ─────────────────────────────────────────────────────────

export const SYNTHETIC = {
  phone: "+256 700 000 001",
  nin: "CM0000TEST0001",
  name: "Test Patient",
  dob: "2000-01-01",
} as const;

const PHONE = /(?<![\d+])(?:\+?256[\s-]?|0)7\d{2}[\s-]?\d{3}[\s-]?\d{3}(?!\d)/g;
const NIN = /\bC[MF][A-Z0-9]{12}\b/g;
const NAME = /\b[A-Z][a-z]{2,} [A-Z][a-z]{2,}\b/;
const DATE = /\b(?:\d{1,2}[/.-]\d{1,2}[/.-](?:19|20)\d{2}|(?:19|20)\d{2}-\d{2}-\d{2})\b/;
const DOB_WORD = /\b(dob|d\.o\.b|date of birth|born on|born)\b/i;

// clearly synthetic: all zeros after the prefix, or the TEST/SYNTH markers
const isSyntheticPhone = (raw: string) =>
  /^(?:\+?256[\s-]?|0)7(?:0{2}[\s-]?0{3}[\s-]?\d{3}|\d{2}[\s-]?0{3}[\s-]?0{3})$/.test(
    raw.replace(/\s+/g, " ").trim(),
  );
const isSyntheticNin = (raw: string) => /TEST|SYNTH|0{8}/.test(raw);

export const findPhi = (text: string): Finding[] => {
  const found: Finding[] = [];
  for (const m of text.matchAll(PHONE))
    if (!isSyntheticPhone(m[0])) found.push({ line: m[0], why: "Ugandan phone number" });
  for (const m of text.matchAll(NIN))
    if (!isSyntheticNin(m[0])) found.push({ line: m[0], why: "NIN" });
  // a name and a date of birth within one line
  for (const line of text.split("\n")) {
    const name = line.match(NAME)?.[0];
    const date = line.match(DATE)?.[0];
    if (
      name &&
      date &&
      name !== SYNTHETIC.name &&
      date !== SYNTHETIC.dob &&
      (DOB_WORD.test(line) || line.length < 120)
    )
      found.push({ line: `${name} … ${date}`, why: "name with date of birth" });
  }
  return found;
};

export const synthesize = (text: string): string =>
  text
    .replace(PHONE, (m) => (isSyntheticPhone(m) ? m : SYNTHETIC.phone))
    .replace(NIN, (m) => (isSyntheticNin(m) ? m : SYNTHETIC.nin))
    .split("\n")
    .map((line) => {
      const name = line.match(NAME)?.[0];
      const date = line.match(DATE)?.[0];
      return name && date ? line.replace(name, SYNTHETIC.name).replace(date, SYNTHETIC.dob) : line;
    })
    .join("\n");

// ── Shell commands ───────────────────────────────────────────────────────

export const destructive = (cmd: string): string | null => {
  if (
    /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-r\s+-f|-f\s+-r|--recursive\s+--force|--force\s+--recursive)\b/.test(
      cmd,
    )
  )
    return "rm -rf";
  if (
    /\b(drop\s+(table|database|schema|view|index|type|function)|truncate(\s+table)?\s+\w)/i.test(
      cmd,
    )
  )
    return "DROP/TRUNCATE";
  if (
    /\b(supabase\s+db\s+reset|drizzle-kit\s+drop|db:reset|migrate(:|\s+)reset|prisma\s+migrate\s+reset)\b/.test(
      cmd,
    )
  )
    return "migration reset";
  if (/\bgit\s+push\b.*(\s--force(-with-lease)?\b|\s-f\b|\s\+\S)/.test(cmd))
    return "git push --force";
  return null;
};

export const rmTargets = (cmd: string): string[] =>
  (cmd.match(/\brm\s+((?:-\S+\s+)*)([^;&|]+)/)?.[2] ?? "")
    .trim()
    .split(/\s+/)
    .filter((t) => t && !t.startsWith("-"));

/** A git or migration command that must wait while the other line holds files. */
export const gitOp = (cmd: string): string | null =>
  cmd.match(/\bgit\s+(commit|checkout|switch|rebase|merge|stash|pull|reset|cherry-pick)\b/)?.[0] ??
  cmd.match(
    /\b(npm run db:[\w:-]+|drizzle-kit\s+(migrate|push|generate)|supabase\s+(db|migration)\s+\w+)/,
  )?.[0] ??
  null;

// ponytail: shell parsing by regex catches the common writers (>, >>, tee, sed -i, mv, cp, touch, rm); a full shell parser if lines collide through odd commands
export const bashWriteTargets = (cmd: string): string[] => {
  const out = new Set<string>();
  for (const m of cmd.matchAll(/(?<![0-9&])>{1,2}\s*([^\s;&|<>]+)/g))
    if (!m[1]!.startsWith("/dev/")) out.add(m[1]!);
  for (const m of cmd.matchAll(/\btee\s+(?:-a\s+)?([^\s;&|]+)/g)) out.add(m[1]!);
  for (const m of cmd.matchAll(
    /\bsed\s+-i\S*(?:\s+(?:''|""))?\s+(?:'[^']*'|"[^"]*"|\S+)\s+([^\s;&|]+)/g,
  ))
    out.add(m[1]!);
  for (const m of cmd.matchAll(/\b(?:mv|cp)\s+(?:-\S+\s+)*\S+\s+([^\s;&|]+)/g)) out.add(m[1]!);
  for (const m of cmd.matchAll(/\btouch\s+([^;&|]+)/g))
    m[1]!
      .trim()
      .split(/\s+/)
      .forEach((t) => out.add(t));
  return [...out].filter((t) => !t.startsWith("-") && !t.startsWith("$"));
};

export const installedPackages = (cmd: string): string[] => {
  const m = cmd.match(
    /\b(?:npm\s+(?:install|i|add)|yarn\s+add|pnpm\s+(?:add|install)|bun\s+add|npx\s+expo\s+install)\s+([^;&|]+)/,
  );
  return m
    ? m[1]!
        .trim()
        .split(/\s+/)
        .filter((t) => t && !t.startsWith("-"))
    : [];
};

export const depsAdded = (before: string, after: string): string[] => {
  const deps = (text: string): Set<string> => {
    try {
      const pkg = JSON.parse(text) as Record<string, Record<string, string> | undefined>;
      return new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ]);
    } catch {
      return new Set();
    }
  };
  const had = deps(before);
  return [...deps(after)].filter((d) => !had.has(d));
};

/** Keys of a flat JSON catalogue whose value is new or changed. */
export const changedKeys = (before: string, after: string): string[] => {
  const parse = (t: string): Record<string, unknown> => {
    try {
      return JSON.parse(t) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  const a = parse(before);
  const b = parse(after);
  return Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
};

// ── Prompt review and routing rules ──────────────────────────────────────

export const ruleHints = (text: string): string[] => {
  const hints: string[] = [];
  if (text.trim().length < 12) return hints;
  if (
    !/[\w-]+\/[\w./-]+|\.\w{2,4}\b|\b(screen|page|component|route|table|migration|test)s?\b/i.test(
      text,
    )
  )
    hints.push("Name the file, screen or area");
  if (!/\b(done when|so that|until|should|must|expect|passes|green|acceptance)\b/i.test(text))
    hints.push("Say what done looks like");
  if (
    /\b(fix|bug|broken|crash|fails?|error)\b/i.test(text) &&
    !/\b(shows?|returns?|throws?|instead|expected|actual|when i|steps?)\b/i.test(text)
  )
    hints.push("Describe the symptom: what happens vs what you expect");
  if (findPhi(text).length) hints.push("Patient data detected: use synthetic data");
  return hints;
};

export const words = (text: string): string[] => [
  ...new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3),
  ),
];

export const similar = (a: readonly string[], b: readonly string[]): number => {
  const sb = new Set(b);
  const both = a.filter((w) => sb.has(w)).length;
  return both / Math.max(1, new Set([...a, ...b]).size);
};

export type Fast = { tier: "strong" | "fast"; effort: "high" | "low"; reason: string };

export const fastRoute = (text: string, clinical: RegExp): Fast | null => {
  const hit = text.match(clinical)?.[0];
  if (hit) return { tier: "strong", effort: "high", reason: `Clinical safety: "${hit}"` };
  const writes =
    /\b(fix|implement|build|add|create|change|refactor|write|migrate|delete|remove|rename|update|edit)\b/i.test(
      text,
    );
  if (
    !writes &&
    /^\s*(what|where|why|how|which|who|explain|show|list|find|describe|summari[sz]e|read|check|is|are|does|can)\b/i.test(
      text,
    )
  )
    return { tier: "fast", effort: "low", reason: "Read-only question" };
  if (text.length < 80 && /\b(typo|bump|tweak|rename|comment|small)\b/i.test(text))
    return { tier: "fast", effort: "low", reason: "Small change" };
  return null;
};
