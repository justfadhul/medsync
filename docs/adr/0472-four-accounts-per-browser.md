# ADR 0472 — Four signed-in accounts per browser, not five

**Status:** Accepted — 2026-11-12 (owner, in chat: "Yes, both"). Supersedes the limit in
[ADR 0280](0280-several-accounts-in-one-browser.md) (slots 0–4, "Five accounts at most"). The rest of ADR 0280 stands.

## Context

The booking dry run (`docs/booking-app-test-walkthrough.md` §13, G3) signed five accounts in to one browser. Each
account's Supabase session cookie is about 3.5 KB; with five, the request's cookies came to about 17.9 KB, past Node's
16 KB request-header limit, and every request was answered **HTTP 431** before the app ran. The browser cannot recover
by itself: no page loads, so no sign-out runs.

Raising the limit (`--max-http-header-size`) was the other option. It would need setting wherever the app runs, and a
proxy in front may keep its own lower limit, so it was not chosen.

## Decision

1. `MAX_ACCOUNTS` is 4 (`lib/supabase/accounts.ts`): slots 0–3. Four sessions stay under 16 KB with room for the
   app's other cookies.
2. Nothing else changes: a fifth sign-in replaces the active account, as ADR 0280 §3 already says when the slots are
   full.

## Consequences

- A browser that already holds an account in slot 4 keeps that cookie until it expires or the site data is cleared;
  the app no longer reads it (`parseSlot` and `slotsInUse` stop at slot 3). A browser already answering 431 needs its
  site data cleared once.
