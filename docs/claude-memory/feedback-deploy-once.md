---
name: feedback-deploy-once
description: Work locally; no Vercel deploy per small change — vercel.json git.deploymentEnabled=false; one deploy when the work is done
metadata:
  node_type: memory
  type: feedback
  originSessionId: 1ca875d6-2fbd-4f0a-bec4-2c16af100a54
  modified: 2026-11-01T10:22:41.984Z
---

Owner ruling (1 Nov 2026): build and check everything locally, then deploy once when the work is done. No deploy per small change or per pushed branch.

`vercel.json` has `"git": { "deploymentEnabled": false }` (commit on feat/pharmacy-add-from-catalogue), so pushes and merges do not build. Deploy by hand: Vercel dashboard → Create Deployment (branch main), or `npx vercel --prod`.

Hosting moved: the fadhulusama Vercel account is paused; a GitHub collaborator forked justfadhul/medsync and deploys the fork from their own Vercel account. Env for import was written to `~/Desktop/medsync/.env.vercel-import` (gitignored, secrets; delete after use).

**Why:** per-change deploys used up the Vercel usage on the old account.

**How to apply:**

- Verify on the local server (`npx next dev --webpack -p 3109` from the main folder with the pharmacy flags), not on Vercel.
- Never offer or trigger a deploy mid-task; at the end, say "ready to deploy" once.
- Pushing branches is fine; it no longer builds.
- Owner asked (1 Nov 2026): in the main medsync tab, keep a background loop pushing committed work in EVERY medsync worktree (all sessions under the medsync project) to GitHub (never main, never deploy). Deploy to Vercel ONLY when the owner gives the word. If the loop isn't running in a new session, restart it.

Related: [[medsync-owner-rules]], [[feedback-cso-signoff-in-chat]].
