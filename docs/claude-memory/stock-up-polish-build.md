---
name: stock-up-polish-build
description: "29 Oct 2026 stock-up workflow changes (#1–#13) on feat/pharmacy-stock-up-polish in ~/Desktop/medsync-stockup; 7 commits pushed, 3 local; migration 0264 unapplied; owner's no-typing rule"
metadata:
  node_type: memory
  type: project
  originSessionId: 6a920551-0930-4f64-9349-f766725211ef
  modified: 2026-10-29T14:15:21.516Z
---

The owner walked through stocking up in production on 29 Oct 2026, and listed changes #1–#13. They are tracked in the side-session notes `stock-up-changes.md`, under local_86d2ddf2.

**Where the work is:** worktree `~/Desktop/medsync-stockup`, branch `feat/pharmacy-stock-up-polish`, off main c6caef8a.

- Commits up to 71cf667c were pushed (branch only, no PR).
- 3c2c7e9e (#12), dd5c0036 (#1) and fe6f448c (#13) are local only.
- The owner said: "dont push yet, wait for everything to get done".

**Owner rule, 29 Oct:** "hospital stuff [should not] do a lot of typing … everything delivered on a silver plate". MedSync prepares the content and people review and sign it.

**Decisions recorded:**

- ADR 0469: packs open as pre-filled drafts.
- ADR 0470: the controlled-substance list supersedes D-CAT-18 for catalogue medicines.
- The owner chose that lorazepam, buprenorphine, ketamine, tramadol and thiopental are controlled by MedSync policy.

**Open:**

- Apply migration 0264.
- The CSO signs:
  - the substance list;
  - the pack templates;
  - the ~50 STOCK_UP_POLISH draft strings.
- Remifentanil is in the catalogue but not on the list.
- Nothing has been checked in a browser.

**Prod catalogue:** seeded 29 Oct (2,625 proposals) and confirmed by two curators.

**Why:** the next session must not rebuild these items or push before the owner says.
**How to apply:** read `stock-up-changes.md` first. See [[pharmacy-catalogue-build]] and [[medsync-owner-rules]].
