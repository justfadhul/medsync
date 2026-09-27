# ADR 0132 — The encryption boundary and the note HMAC key (E4, E10)

**Status:** Accepted — 2026-09-26. GATE A E4, E10, D-CFC-04.

## Context

Encrypting every column blocks the sweeps and trends the engines need. `clinical_documentation.section_data` and `clerkship_drafts.payload` were plaintext (R8). The only HMAC in the repo, `blindIndex`, is derived from the PHI key (STOP 0, Q11).

## Decision

1. **The boundary.** Structured coded values (concept ids, quantities, units, codes, statuses) are plaintext, protected by RLS (ADR 0131) and at-rest encryption. Identifiers, narrative, free text and uncoded allergen text are encrypted with `lib/encryption.ts` (AES-256-GCM, ADR 0008) in `*_ciphertext` columns.
2. **Note content** (`clinical_notes`) is encrypted. **NCD drafts** are now written as `{ "enc": "<ciphertext>" }` and `lib/ncd/draft.ts` reads both shapes; the old plaintext drafts stay until O-5.
3. **Signed notes carry an HMAC-SHA-256** (`lib/emr/notes.ts`) over one canonical composition, keyed by the new env var `MEDSYNC_NOTE_HMAC_KEY`: at least 32 random bytes, base64 (O-2). Verification is constant-time.
4. **The key is required, never skipped.** A missing or malformed key throws `NoteHmacKeyError`; the sign action answers code `config` with "Notes cannot be signed yet: the signing key (MEDSYNC_NOTE_HMAC_KEY) is not set on this deployment. Your draft is kept."
5. **As built, `hmac_key_id` is a fingerprint**, not the literal `'v1'` of the draft: the first 16 hex characters of SHA-256 over the key bytes. It names the key without revealing it.

## Consequences

- Sweep indexes on coded values work. Vercel holds two keys (the PHI key and the note key).
- A property test holds a signed note's canonical form and HMAC fixed across 200 seeds.
- **Rotation is designed, not built.** The app reads one key. Rotating means: keep the old key available for verification, sign new notes with the new one, and verify old notes by the fingerprint they carry; notes are never re-signed. Only one env var exists today, so verifying old notes after a rotation needs that second slot first.
- `clinical_documentation` stays plaintext: it is append-only legacy (recorded, R8).
- Printouts leave encrypted narrative fields as write-in lines (STOP 5–6).
- **Not built:** the O-5 re-encryption script for old NCD drafts, and the encrypted version 2 of backfilled allergies (ADR 0135). Both are to be written; `docs/emr/OWNER-RUNBOOK.md` describes them.

## Alternatives considered

- **Encrypt every clinical column** — breaks sweeps, trends and indexes; rejected at E4.
- **Reuse `blindIndex` or the PHI key for note integrity** — one leaked key would then break both confidentiality and integrity, and rotating one would rotate the other.
