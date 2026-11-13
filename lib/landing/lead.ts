/**
 * The clinic sign-up form's input (D-LP-09): one email, trimmed and lower-cased, or null when it is not a
 * full address. `company` is the honeypot: a person never sees the field, so any value means a bot.
 */
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function parseLead(input: {
  email?: unknown;
  company?: unknown;
}): { kind: "ok"; email: string } | { kind: "bad" } | { kind: "bot" } {
  if (typeof input.company === "string" && input.company.trim() !== "") return { kind: "bot" };
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  return email.length <= 254 && EMAIL.test(email) ? { kind: "ok", email } : { kind: "bad" };
}
