# ADR 0100 — The patient home: safety, then access, then today

**Status:** Accepted — product-owner and CSO brief (`PROMPT: Patient home /patient (web), redesign`, 2026-09-23),
built the same day on `feat/booking-app`. Gates 0–2 run in one pass at the owner's instruction ("go through all
gates"); the open items below are the owner's to ratify. **Deployed to production** 2026-09-23
(`medsync-cpbsnn875`, aliased to `medsync-six.vercel.app`) from the working tree at the owner's instruction, uncommitted
— the deploy also carried another session's uncommitted sign-in / landing work. The catalog gate stands: production
shows the shortlist until a catalog version is signed (owner ruling, same day).

**Builds on** [ADR 0084](0084-book-or-queue-two-doors-relabelled.md) (the doors, no counts, no clock numerals),
[ADR 0096](0096-symptoms-before-booking.md) (the shortlist), [ADR 0097](0097-secondary-accent-plum.md) (plum = place),
[ADR 0098](0098-symptom-catalog-and-emergency-pathway.md) (the catalog, the watermark, the pill).
**Supersedes in part:** on the web home only, ADR 0098 Appendix A.0's 2×2 amber danger tiles (the catalog page keeps
them); the saturated hero card; the brief's "not on the web home: any queue/ticket state" (gap 5 closed).

## Context

The home had no reading order. Four saturated amber tiles, a teal→plum gradient hero, two quick-action cards and three
empty cards competed with the two doors, which read weaker than the danger tiles. The hero told a new patient their
readings stay "for whenever you or your clinician need it" — a clinician cannot read self-tracking (brief §9). "Log a
reading" appeared twice, the hospital four times, and the web never showed a same-day ticket the phone did.

## Decision

1. **(owner) One order: safety → access → today.** Main column: greeting, "What's wrong?" (or the ADR 0096 shortlist),
   "Get seen". Right column (20rem): "Coming up", today's doses, recent readings. Discovery under the main column,
   only when there is data. Source order is the phone's order, so focus never leaves reading order; "Coming up" is
   rendered twice (phone slot / right column, one always `display: none`) because no single source position gives both.
2. **(CSO) Danger signs as compact rows.** The same four adult signs, order, words and targets, as 48px rows on a
   neutral card with an amber icon, the words, the tier word read aloud, and a chevron — 2 columns wide, 1 on phones.
   Rendered on the server: the 76 KB catalog no longer ships in `/patient`'s client bundle.
3. **(owner) The doors are button-cards.** Primary filled teal (the button's own colours), secondary outlined, 3fr/2fr,
   ≥ 72px, ratified words untouched. The split follows the doors' own slot (`@container` + `@xl:`), so the primary
   hospital card on `/patient/hospitals` stacks them instead of squeezing the words into a 56px column.
4. **(owner) "Coming up" on the web.** Today's live ticket, in the queue page's words ("You are already at the hospital
   today." / "Open this for the latest."), never a position or "ahead of you"; else the next visit with the old hero's
   fields as neutral word chips and the visits page's own verbs ("I have arrived" on the day, "Confirm I'm coming"
   within 24 h); else the existing empty line. Visits are read from the start of the clinic's day, because a clinic-day
   booking starts with its session, before the patient's arrival window. `canArrive`, `INTAKE_TITLE` and
   `fetchLiveIntakeToday` (newest first) now live in `lib/patient/appointments.ts`, shared with the visits and queue pages.
5. **(owner) Removed:** the "MedSync · Your space" eyebrow, the hero (file deleted — and with it the only copy of the
   clinician sentence in web or phone code), "Quick actions" and both cards, "Upcoming visits"/"View all".
6. **(owner) No new strings.** Every visible string is reused byte-for-byte; `tests/patient/home-invariants.test.ts`
   holds the ledger. "Get seen" and "Coming up" come from the phone; "Only you can see this." is the second sentence
   of `/patient/track/log`'s description.
7. **Colour roles on the home.** Teal only on things to press; plum only on places (active nav, avatars, the header's
   hospital dot — now plum), each marked `data-place`; amber only as an icon or a dashed rule (the watermark on the home
   is ink on a dashed amber rule — amber-on-amber was 2.9:1); red only on the pill, which is now solid red with white
   text in dark too (4.77:1; 4.83:1 light). No gradients. Provider cards: plum face ground, outlined ink star, neutral
   "Seen you before". The patient tab bar is opaque (its idle labels failed AA over scrolled content).

## Addendum (same day, owner): the catalog follows the theme

- `/patient/symptoms` and its emergency interrupt drop `medsync-forced-light` (superseding PRD Law 3 for the catalog, as
  `aa1fe46` did for `/emergency`); the page's wrapper went with it. A selected danger tile's icon takes the tile's ink
  in dark (amber on the near-white fill was 1.14:1); the catalog's teal text links move to `teal-700` (3.74 → 5.5:1).
- The `emergency` button variant is solid red with white text in both themes (it was burgundy with pink text in dark,
  which vanished on the interrupt's critical-tinted sheet). The pill's own override is gone; every emergency button —
  pill, interrupt, `/emergency` — carries it. Rendered in both themes at 1440 and 390: axe clean in dark; light keeps
  the critical pair's 3.95:1 on small text (the "Emergency" badges, the interrupt kicker) — a token-level decision.
- The mobile catalog and emergency screens are still forced light.

## Verification (Gate 2)

A throwaway copy of the tree, built with fixtures in place of every data read (zero database connections), measured in
headless Chrome over CDP — ruling 11 keeps Playwright/Lighthouse out of the repo, so CI holds the source-level half.

|                                              | Before                     | After                                        |
| -------------------------------------------- | -------------------------- | -------------------------------------------- |
| First-load JS `/patient` (gzip)              | 267.0 kB                   | 253.2 kB (cap now 267 in `check-budget.mjs`) |
| Doors' bottom at 1440×900 (catalog on / off) | 568 / 472                  | 575 / 498 — in view, both themes             |
| Symptom action at 390×844 (on / off)         | 517 / 407                  | 597 / 386 — in view                          |
| Blocks above the fold at 1440                | 7–8                        | 6                                            |
| axe, light / dark                            | contrast + region / region | none / none                                  |
| Lighthouse mobile ×3 median (perf / a11y)    | 0.86 / 0.96                | 0.86 / 1.00                                  |
| CLS                                          | 0                          | 0                                            |
| Pill over content at page end, 390           | yes                        | no                                           |

## Open items (owner)

- **The pill at rest on a phone.** At the top of a long page it floats over whatever sits 650–700px down (the end of a
  door's title in some states): its 8.5rem offset clears a booking action bar the home does not have. The brief kept
  its position; moving it on pages without that bar is a one-line change if wanted.
- **"Position" on the home.** Discovery's clinic cards say "Clinic day — you get a position and a time to arrive by"
  (ADR 0087 copy). It names the mode, not a place in a queue; the runtime check flags the word.
- **Two §9 lines outside `/patient`:** `content/auth.ts:98` (get-started patient door, "Your care team sees them once
  your hospital is on MedSync.") and the CSO-marked `content/landing.ts:107` ("Your care team sees your readings once
  your hospital is on MedSync.") — both need ratified replacements.
- Status tone `admitted` is teal wherever Pills show it (the visits page); the done-chips of the shared visit actions
  are teal-tinted. The home avoids both; the visits page is out of this brief's scope.
- `CHANGELOG.md` entry pending: the file carries another session's uncommitted hunk.

## Deploy

Production: `npx vercel deploy --prod` of the whole working tree after typecheck, lint and the suite passed (one
unrelated failure: the styleguide's plum swatch carries an `aria-label` on a `<span>`). The previous production build
(`medsync-5fumfw98u`, 11:17) is the rollback target. A branch preview is still not possible: Preview holds
`DATABASE_URL`/`DATABASE_DIRECT_URL` only for `feat/ncd-diabetes`; adding them for this branch was refused as a
secret-store write and is the owner's to run (`npx vercel env add DATABASE_URL preview feat/booking-app`, the same for
`DATABASE_DIRECT_URL`, and `FEATURE_SYMPTOM_CATALOG` with `--value 1`).
