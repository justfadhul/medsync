/**
 * A record the desk registered (ADR 0475): an auth user with no credential, `app_metadata.desk_registered`, and an
 * undeliverable address. It gets a credential only by being taken over with a claim code (migration 0292's guard on
 * auth.users refuses any other change); password reset refuses it before asking Supabase.
 */
export function isDeskRecord(user: {
  email?: string | null;
  app_metadata?: Record<string, unknown>;
}): boolean {
  return (
    user.app_metadata?.desk_registered === true ||
    (user.email ?? "").toLowerCase().endsWith("@patients.medsync.invalid")
  );
}

/**
 * The claim code the desk gives a walk-in it registered (ADR 0475, migration 0292). With it, and their phone, the
 * person takes the desk's record over at sign-up. No imports: the Edge Function (Deno) and the app share it.
 *
 * Eight characters from 31 that cannot be misread (no I, L, O, 0 or 1), about 40 bits, shown as ABCD-EFGH. The
 * database keeps only its blind index (`blindIndex(claimCodeIndexInput(code))`, the phone's HMAC with a label of its
 * own); five wrong tries spend it and it expires after 30 days, so a short code is enough.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LENGTH = 8;

export function newClaimCode(): string {
  let code = "";
  while (code.length < LENGTH) {
    // 248 = 8 × 31: dropping bytes above it keeps every character equally likely.
    for (const b of crypto.getRandomValues(new Uint8Array(LENGTH * 2)))
      if (b < 248 && code.length < LENGTH) code += ALPHABET[b % ALPHABET.length];
  }
  return code;
}

/** What the person typed, as stored: case, spaces and dashes do not matter. Null if it cannot be a code. */
export function normalizeClaimCode(typed: string): string | null {
  const code = typed.toUpperCase().replace(/[\s-]/g, "");
  return code.length === LENGTH && [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}

export const formatClaimCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** The blind index input: labelled, so a code's index can never equal a phone's. */
export const claimCodeIndexInput = (code: string) => `desk-claim:${code}`;
