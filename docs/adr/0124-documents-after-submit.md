# ADR 0124 — Submit now, documents later; uploads after account creation

**Status:** Accepted — 2026-09-25 (Onboarding v2, D10, E5, E6, DOC-1..4). Build record: `docs/onboarding-v2/STOP-REPORTS.md`.

## Context

Documents rode inside the form post (Vercel caps a function body at 4.5 MB), a failed upload rolled back the whole hospital account, and the clinical licence was optional although it is the trust anchor.

## Decision

1. **Upload path:** files upload **after** the account exists, straight to private storage through a server-minted signed URL in the caller's own folder. The server re-checks the stored object before attaching it (DOC-4). A failed upload leaves a "Still needed" card and never rolls anything back.
2. **Images** are re-encoded on the device (long edge ≤ 1600 px, JPEG), which also strips EXIF and GPS tags. PDFs go as they are.
3. **"Add it later"** is an explicit choice.
4. **DOC-1:** `approve-staff-affiliation` refuses a clinical approval with no licence on file ("Waiting for the licence").
5. **DOC-2:** `hospital_applications.documents_complete` (generated) splits the super-admin queue into Ready for review and Waiting for documents. Government facilities need only the letter.

## Consequences

- The staff and hospital pending pages carry the upload box. They use the v2 layout for every applicant, because the licence guard would otherwise strand flag-off signups.
