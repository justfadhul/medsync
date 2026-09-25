/**
 * Field rules shared by the v2 forms (client) and their actions (server). Client-safe, no imports.
 */

// ── Phone (§5.12): accept 0772…, 772…, +256…, 256…, spaces, dashes. Normalise to E.164. ──

/** The existing server rule: mobile +2567XXXXXXXX, or a landline +256[2-4|8|9]XXXXXXX(X). */
export const PHONE_E164_UG = /^\+2567\d{8}$|^\+256[23489]\d{7,8}$/;

export function normalizeUgPhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, "").replace(/^\+/, "");
  const national = digits.startsWith("256") ? digits.slice(3) : digits.replace(/^0/, "");
  const e164 = `+256${national}`;
  return /^\d+$/.test(national) && PHONE_E164_UG.test(e164) ? e164 : null;
}
export const isUgMobile = (e164: string) => /^\+2567\d{8}$/.test(e164);

/** "0772 123 456" for display, from E.164. */
export function formatUgPhone(e164: string): string {
  const n = e164.replace(/^\+256/, "0");
  return n.length === 10 ? `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}` : n;
}

// ── NIN (§5.12): a soft check — a warning, never a block. ──

export const normalizeNin = (nin: string) => nin.replace(/\s+/g, "").toUpperCase();
/** Uganda NINs are 14 characters; citizens' start CM (male) or CF (female). */
export function ninWarning(nin: string): string | null {
  const n = normalizeNin(nin);
  if (!n) return null;
  if (n.length !== 14)
    return "A National ID number is usually 14 characters. Check it matches your card.";
  if (!/^C[MF]/.test(n))
    return "Citizens' numbers usually start with CM or CF. Check it matches your card.";
  return null;
}
/** The hard rule stays as today: 8–16 letters or digits. */
export const NIN_RE = /^[A-Z0-9]{8,16}$/;

// ── Date of birth (three boxes) and the under-18 guard (DPPA s.8). ──

export function isoFromParts(day: string, month: string, year: string): string | null {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y) || year.length !== 4)
    return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return null;
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Age in whole years on `today` (defaults to now) for an ISO date. */
export function ageOn(iso: string, today = new Date()): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d))
    age -= 1;
  return age;
}
export const ADULT_AGE = 18;
/** The code a date of birth under 18 fails with; the page shows the guard, not a field error. */
export const UNDER_18 = "under_18";

// ── Email (§5.12): "Did you mean …?" for common typos, from a local list. ──

const DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "go.ug",
  "ac.ug",
  "co.ug",
];

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

/** Suggests the full corrected address, or null. Suffix domains (go.ug…) only fix the ending. */
export function emailSuggestion(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (
    !domain ||
    DOMAINS.includes(domain) ||
    DOMAINS.some((d) => d.length <= 5 && domain.endsWith(`.${d}`))
  )
    return null;
  for (const d of DOMAINS) {
    if (d.length <= 5) {
      // go.ug / ac.ug / co.ug are endings: "mulago.go.uh" → "mulago.go.ug".
      const tail = domain.slice(-d.length);
      if (domain.length > d.length + 1 && distance(tail, d) === 1)
        return `${local}@${domain.slice(0, -d.length)}${d}`;
    } else if (distance(domain, d) <= 2) return `${local}@${d}`;
  }
  return null;
}

/** Mail providers anyone can sign up to — a hospital applying from one is flagged, not refused. */
export const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "zoho.com",
]);
export const emailDomain = (email: string) => email.split("@").at(-1)?.toLowerCase() ?? "";

// ── Password (D14): 12–72 on every form; bytes, not characters, because bcrypt stops at 72. ──

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX_BYTES = 72;
export const passwordBytes = (p: string) => new TextEncoder().encode(p).length;
