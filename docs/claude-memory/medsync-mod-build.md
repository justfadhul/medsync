---
name: medsync-mod-build
description: 'Claude Code mod "medsync" (tools/medsync-mod + launch-medsync) lives only on branch feat/medsync-mod; DISABLED 2026-10-17 at the owner''s request'
metadata:
  node_type: memory
  type: project
  originSessionId: a54cfa59-3d6e-423b-836b-0adb17df218a
  modified: 2026-10-17T09:20:14.954Z
---

Built 2026-10-17; the owner then said it "didn't turn out how I wanted" and asked to disable it. State since 2026-10-17:

- Code is kept only on `feat/medsync-mod` (pushed to origin, e2a34ab3; no PR opened, `gh` not installed). Not on main.
- Uninstalled `medsync@medsync-local` and removed the `medsync-local` marketplace; `~/.local/bin/launch-medsync` link removed. The `export PATH="$HOME/.local/bin:$PATH"` lines added to `~/.zshrc` and a new `~/.bashrc` were left (harmless).
- The main folder is back on main.

**Why:** owner disliked the result; the branch keeps the work in case they want parts back.

**How to apply:** don't re-enable or reinstall the mod unless the owner asks. If it is revived: validate/test with `claude plugin validate|test tools/medsync-mod` (the desktop app's CLI is at `~/Library/Application Support/Claude/claude-code/<ver>/<hash>/claude.app/Contents/MacOS/claude`). Engine quirks: helpers that take `$` must be module-level; use one `{ tool: [...] }` matcher instead of two unmatched tool.call hooks; hooks get a 10 s budget, so holds wait inside `$.process.run(['sleep'])`; in tests a fresh `$.ui.mount` abandons a held dispatch (press via `$.ui.render` + `$.ui.press`); `/review` is a built-in.

Later on 2026-10-17 it had been re-installed with project scope (`medsync@medsync-local`, marketplace pointing at ~/Desktop/medsync-mod/tools/medsync-mod); disabled again via `enabledPlugins: false` in ~/Desktop/medsync/.claude/settings.local.json (owner asked to disable /dash).

It still loaded after that, through a symlink in a hot-reload folder (`~/.claude/dev-mods/a54cfa59…/medsync`), which settings do not govern. On 17 Oct 2026 (Lab Phase 4 session) the owner asked again; the link was moved to `~/.claude/dev-mods-disabled/medsync`. To fully disable it, check every place: `enabledPlugins`, `installed_plugins.json`, and any `~/.claude/dev-mods/*/` link.

Related: [[medsync-owner-rules]] [[main-folder-on-main]]
