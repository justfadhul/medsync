/**
 * The words a candidate match is shown with (PRD §2.8): "same phone", "same
 * name and year of birth". Words, never a score — a number invites a clerk
 * to trust the higher one, and a wrong merge is a wrong chart. Pure, no
 * `server-only`: the query layer decrypts, this only compares, and a test
 * can reach it.
 *
 * Nothing here decides. An empty list means "not a candidate"; a non-empty
 * one is shown to a human who confirms or does not. There is no ranking
 * beyond the order the bases are listed in.
 */

export interface IdentityFacts {
  /** Declared or on-file name, any spelling of case and spacing. */
  name: string;
  /** E.164 as stored, e.g. "+256772123456". */
  phone: string;
  /** "YYYY-MM-DD", or null when only an age was declared. */
  dateOfBirth: string | null;
  /** Declared age in years when there is no date of birth. */
  ageYears: number | null;
}

export const BASIS_SAME_PHONE = "same phone";
export const BASIS_SAME_NAME_YEAR = "same name and year of birth";

/** Lower-cased, sorted tokens: "Nakato Sarah" and "Sarah  nakato" are the same person's spelling. */
export function normaliseName(name: string): string {
  return name.toLowerCase().split(/\s+/).filter(Boolean).sort().join(" ");
}

/**
 * The years of birth a set of facts could mean. A date names one; an age
 * names two, because the birthday this year may or may not have passed.
 */
export function birthYears(facts: IdentityFacts, now: Date): number[] {
  if (facts.dateOfBirth) {
    const y = Number(facts.dateOfBirth.slice(0, 4));
    return Number.isFinite(y) ? [y] : [];
  }
  if (facts.ageYears !== null) {
    const y = now.getUTCFullYear() - facts.ageYears;
    return [y, y - 1];
  }
  return [];
}

/**
 * Every basis on which `candidate` might be `declared`. Empty when none —
 * the caller then does not show the candidate at all.
 */
export function matchBasis(
  declared: IdentityFacts,
  candidate: IdentityFacts,
  now: Date = new Date(),
): string[] {
  const basis: string[] = [];
  if (declared.phone && declared.phone === candidate.phone) basis.push(BASIS_SAME_PHONE);
  const a = normaliseName(declared.name);
  const b = normaliseName(candidate.name);
  if (a && a === b) {
    const mine = new Set(birthYears(declared, now));
    if (birthYears(candidate, now).some((y) => mine.has(y))) basis.push(BASIS_SAME_NAME_YEAR);
  }
  return basis;
}

/** "+256 7•• ••• 123" — enough for a clerk to check the last digits with the caller, no more. */
export function maskPhone(e164: string): string {
  const tail = e164.slice(-3);
  return `${e164.slice(0, 5)}•• ••• ${tail}`;
}

/** One row of `desk_patient_candidates()` (migration 0291): ciphertext, as stored. */
export interface DeskCandidateRow {
  patient_user_id: string;
  patient_code: string;
  sex: string;
  date_of_birth: string;
  first_name_encrypted: string;
  surname_encrypted: string;
  phone_encrypted: string;
  phone_hmac: string | null;
}

export interface DeskMatch {
  patientUserId: string;
  patientCode: string;
  displayName: string;
  sex: string;
  dateOfBirth: string;
  basis: string[];
}

/**
 * The desk's duplicate check (ADR 0475): which of this hospital's candidates may be the walk-in at the counter. The
 * phone leg compares blind indexes; only a row written before the index existed has its phone decrypted. A row that
 * cannot be decrypted is skipped, never guessed.
 */
export async function deskMatches(
  declared: { name: string; phone: string; phoneHmac: string; dateOfBirth: string },
  rows: ReadonlyArray<DeskCandidateRow>,
  decrypt: (payload: string) => Promise<string>,
  now: Date = new Date(),
): Promise<DeskMatch[]> {
  const out: DeskMatch[] = [];
  for (const r of rows) {
    let name: string;
    let phone: string;
    try {
      name =
        `${await decrypt(r.first_name_encrypted)} ${await decrypt(r.surname_encrypted)}`.trim();
      phone =
        r.phone_hmac === declared.phoneHmac
          ? declared.phone
          : r.phone_hmac === null
            ? await decrypt(r.phone_encrypted)
            : "";
    } catch {
      continue;
    }
    const basis = matchBasis(
      {
        name: declared.name,
        phone: declared.phone,
        dateOfBirth: declared.dateOfBirth,
        ageYears: null,
      },
      { name, phone, dateOfBirth: r.date_of_birth, ageYears: null },
      now,
    );
    if (basis.length === 0) continue;
    out.push({
      patientUserId: r.patient_user_id,
      patientCode: r.patient_code,
      displayName: name,
      sex: r.sex,
      dateOfBirth: r.date_of_birth,
      basis,
    });
  }
  return out;
}
