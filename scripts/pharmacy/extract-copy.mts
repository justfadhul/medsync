/* eslint-disable no-console */
/**
 * Every Phase 1 pharmacy string, as JSON, for a CSO sign-off portal (docs/pharmacy/HANDOFF.md).
 * Strings are taken as they are; for a function, its first template literal, with ${x} shown as {x}.
 * Prints [{ id, group, file, key, text, patient }] to stdout. Run from the repo root, with a stub for
 * `server-only` on NODE_PATH:
 *
 *   mkdir -p /tmp/stubs/server-only && echo "" > /tmp/stubs/server-only/index.js
 *   NODE_PATH=/tmp/stubs SKIP_ENV_VALIDATION=1 NEXT_PUBLIC_SUPABASE_URL=https://fixture.supabase.co \
 *     npx tsx scripts/pharmacy/extract-copy.mts > strings.json
 *
 * A function holding a ternary shows only its first branch: split such variants into separate strings
 * before a sign-off, so the signer sees each one.
 */
import { resolve } from "node:path";

const files: Record<string, string> = {
  "content/pharmacy-review.ts": "Review, queries and outcomes",
  "content/pharmacy-supply.ts": "Hand-over and supply",
  "content/pharmacy-stock.ts": "Stock",
  "content/pharmacy-controlled.ts": "Controlled drugs",
  "content/pharmacy-golive.ts": "Downtime, the log and going live",
  "content/pharmacy-prescriber.ts": "The prescriber's screens",
  "content/pharmacy-catalogue.ts": "The national list (new, 13 Oct)",
  "lib/pharmacy/supply/handover.ts": "Hand-over and supply",
  "lib/pharmacy/supply/identity.ts": "Hand-over and supply",
  "lib/pharmacy/review/queries.ts": "Review, queries and outcomes",
  "lib/pharmacy/controlled.ts": "Controlled drugs",
  "lib/pharmacy/downtime.ts": "Downtime, the log and going live",
  "lib/pharmacy/print/slip.ts": "Paper: slip, label, register, log",
  "lib/pharmacy/print/label.ts": "Paper: slip, label, register, log",
  "lib/pharmacy/print/register.ts": "Paper: slip, label, register, log",
  "lib/pharmacy/print/dispensing-log.ts": "Paper: slip, label, register, log",
  "lib/pharmacy/messages.ts": "What the patient reads",
  "lib/pharmacy/patient-list.ts": "What the patient reads",
};
const SKIP = new Set(["status", "signedBy", "signedOn"]);
const out: {
  id: string;
  group: string;
  file: string;
  key: string;
  text: string;
  patient: boolean;
}[] = [];
const tmpl = (fn: { toString(): string }) => {
  const src = fn.toString();
  const m = src.match(/`([\s\S]*?)`/) ?? src.match(/"([^"]*)"/);
  return m?.[1] !== undefined
    ? m[1].replace(/\$\{([^}]*)\}/g, (_, x) => `{${String(x).trim().replace(/^.*\./, "")}}`)
    : null;
};
function walk(v: unknown, path: string[], file: string, group: string, patient: boolean) {
  if (typeof v === "string") {
    if (!v.trim() || /^[a-z0-9_.-]+$/.test(v)) return;
    out.push({
      id: `${file}#${path.join(".")}`,
      group,
      file,
      key: path.join("."),
      text: v,
      patient,
    });
  } else if (typeof v === "function") {
    const t = tmpl(v);
    if (t && t.trim() && !/^[a-z0-9_.-]+$/.test(t))
      out.push({
        id: `${file}#${path.join(".")}`,
        group,
        file,
        key: path.join("."),
        text: t,
        patient,
      });
  } else if (Array.isArray(v))
    v.forEach((x, i) => walk(x, [...path, String(i)], file, group, patient));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v))
      if (!SKIP.has(k)) walk(x, [...path, k], file, group, patient);
}
for (const [file, group] of Object.entries(files)) {
  const mod = await import(resolve(process.cwd(), file));
  for (const [name, v] of Object.entries(mod)) {
    if (
      !/[A-Z_]{3,}/.test(name) ||
      !/COPY|REASONS|CODES|ROUTES|POINTS|SAID|LABEL|^REVIEW$|^SUPPLY$|^STOCK$|^GOLIVE$|PAGE|ENTRY|UI|FROM|^NATIONAL_LIST$/.test(
        name,
      )
    )
      continue;
    const patient = /PATIENT|MESSAGE/.test(name);
    walk(v, [name], file, patient ? "What the patient reads" : group, patient);
  }
}
const seen = new Set<string>();
const uniq = out.filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));
console.log(JSON.stringify(uniq));
