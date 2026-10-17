# medsync: a Claude Code mod for this repo

Tested with **Claude Code 2.1.299** on macOS (bash and zsh). The scripts use plain POSIX tools, so they also run in GitHub Codespaces (Linux).

The mod adds three things to a Claude Code session in the MedSync repo:

- **Line checks** that hold a tool call until you decide:
  - the emergency signposting screen
  - patient data
  - destructive commands
  - file locks held by another line
  - git commands while another line holds files

  Other checks log without holding:
  - the CSO queue
  - translation staleness
  - new dependencies and their size

- **A comms console** (the `dashboard` pane) in three columns. **Transmit** is you → Claude: prompt, note or pin, with route › transmit. **Network** is Claude ↔ agents: an orbit of the lead and its subagents. **Receive** is Claude → you: needs you, stream, locks and changed files. Folded rows hold the line checks and tasks, and a status bar sits at the bottom.
- **Routing.** Each turn gets a model and effort. Clinical-safety work goes to the strongest model at high effort, marked `rule`. Small or read-only work goes to the fastest model. Anything the rules don't settle gets one cheap classification (small, medium, large or clinical). Your prompts are otherwise sent as you typed them: there is no prompt reviewer.

It also coordinates **two lines**: two sessions in this folder, A and B. They share a board, take file locks, hold git commands while the other line edits, and send each other messages.

## Start it

```bash
launch-medsync
```

`launch-medsync` lives in `scripts/`. `scripts/install-launcher.sh` links it into `~/.local/bin` and adds that folder to PATH in `~/.zshrc` and `~/.bashrc`, unless PATH already has it. After the first install, open a new terminal.

```
launch-medsync [--line "<label>"] [--worktree] [claude options...]
  --line "<label>"   name this line (letters A, B, … are given in start order)
  --worktree         start this line in its own git worktree: ../<repo>-<label>, branch line/<label>
  --help
```

Any other option passes straight to `claude`, e.g. `launch-medsync --model opus`. The launcher:

1. changes to the MedSync checkout you are standing in, or the main checkout when you are elsewhere, and loads the mod from that checkout (or from the checkout the launcher lives in, when yours has no `tools/medsync-mod`)
2. sets `MEDSYNC_LAUNCH=1`, plus `MEDSYNC_LINE` when you pass `--line`
3. runs `claude --plugin-dir <repo>/tools/medsync-mod`

When `MEDSYNC_LAUNCH=1`, the console opens at session start. Claude Code places an unrequested pane only in a terminal at least 144 columns wide. In a narrower one you get the one-line summary above the prompt, and `/dash` opens the console.

If `claude` is not on PATH, the launcher uses the copy the Claude desktop app keeps. If that copy says your sign-in expired, run `/login` once inside it.

### Inside Claude Code without the launcher

Install the mod once for this repo. Every Claude Code session opened in this folder then loads it: the desktop app's Code tab, `claude` in a terminal, and IDE sessions.

```bash
claude plugin marketplace add "<path to>/tools/medsync-mod" --scope local
```

```bash
claude plugin install medsync@medsync-local --scope local
```

Run both from the checkout you work in. Name the folder that holds the mod: `$PWD/tools/medsync-mod` once the mod is on that checkout's branch, or the worktree that carries `feat/medsync-mod` until then (on the owner's Mac, `~/Desktop/medsync-mod/tools/medsync-mod`). They write to `.claude/settings.local.json`, which is not checked in, so the mod is enabled in this checkout only. The plugin is read from `tools/medsync-mod` itself: after you edit the mod, run `/reload-plugins` (or start a new session), with no reinstall. Without the launcher the console does not open by itself; type `/dash`. In the desktop app, the console opens as a pane beside the conversation.

When both are present, `launch-medsync`'s `--plugin-dir` copy overrides the installed one. Config set in the menu for the installed copy (`medsync@medsync-local`) is separate from the launcher's (`medsync@inline`).

### Two lines

Open a second terminal in this repo and run:

```bash
launch-medsync --line "B"
```

How the two lines coordinate:

- **Registration.** Each session registers as a line and sends a heartbeat every 20 s. A line silent for 2 minutes is marked offline, and its locks are released.
- **Locks.** Editing a file the other line holds stops the call with `<file> is being edited by Line A`. You choose **Wait** (retry when it is released), **Skip** or **Override** (logged).
- **Release.** Locks are released when a turn ends and when the session ends.
- **Git.** While the other line holds any file, `git commit`, `checkout`, `switch`, `rebase`, `merge`, `stash`, `pull`, `reset` and migration commands wait for you to choose **Wait** or **Override**.
- **Shared-file messages.** A turn that changed shared files sends the other line a message naming them: schema, migrations, types, shared Edge Function code, package.json, configs.
- **Shared board.** The task board, CSO queue, translation tracker, stream and traffic are shared. Every item carries a badge in its line's colour: A is teal, B is blue.

## Commands

| Command                                              | What it does                                                                                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/dash`                                              | Open or close the comms console                                                                                                                                                            |
| `/cso`                                               | List open CSO items. `/cso done <n>` clears item n. `/cso export` writes `CSO_REVIEW.md` at the repo root                                                                                  |
| `/translations`                                      | Stale keys (an English string changed) and missing keys per language, marked as not clinically reviewed                                                                                    |
| `/route`                                             | Show the last decision. `/route off`, `/route on`, `/route lock <model> <effort>`                                                                                                          |
| `/line`                                              | List lines and their locks. `/line name <label>` renames this line. `/line worktree` moves this line into a git worktree. `/line merge` writes that worktree's diff for you to `git apply` |
| `/tell <A\|B> <message>`                             | Send a message to the other line                                                                                                                                                           |

The mod also gives Claude a tool, `request_from_user` (what, why, blocking). Its requests appear under **Needs you**.

## Line checks

| Check            | What sets it off                                                                                                                            | What happens                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Emergency screen | Edit or Write to the signposting screens (`emergencyPaths`) whose added lines hold a question, a symptom list or a severity word            | Held. **Cancel**, **Rewrite as signposting only** (Claude is told to rewrite) or **Override** (logged to the CSO queue with your git name and date) |
| CSO queue        | Any successful change to patient-facing copy (`patientCopyPaths`) or to the English catalogue, plus clinical prompts and every override     | Logged                                                                                                                                              |
| Translations     | A key changed in `<i18nDir>/en.json`                                                                                                        | Marked stale in every other `<lang>.json`, plus any extra `languages`. Editing a language file clears its stale keys                                |
| Patient data     | Ugandan phone numbers (+2567…, 07…), NINs (CM/CF and 12 characters), or a name with a date of birth in an edit, a shell command or a prompt | Held. A clearly synthetic replacement is offered. A held prompt cannot be sent as written; **Send synthetic** or **Edit synthetic** releases it                                                           |
| Destructive      | `rm -rf`, `DROP`/`TRUNCATE`, migration resets, `git push --force`                                                                           | Held with a preview of what would change (file counts, remote commits dropped). **Proceed** or **Cancel**                                           |
| Bandwidth        | `npm install <pkg>` and similar, or new packages in a package.json                                                                          | A note with the package's approximate unpacked size, from `npm view`                                                                                |

Holds wait up to `holdMinutes` (10 by default). Press a button in the console's **Needs you** or in the band above the prompt. The first button of each item has a number hotkey. A new blocking item brings a toast and a chime.

## Configuration

Every path, pattern and threshold is a `userConfig` field: test command, models per tier, emergency and patient-copy paths, i18n folder and languages, clinical pattern, shared paths, heartbeat and offline times, hold timeout and sound. Set them in Claude Code's config menu, or under `pluginConfigs.medsync` in settings.

## Where things live

- **This session's values** live in `$.state`. They survive a hot reload of the mod.
- **Your folded rows and `/line worktree` records** persist in `$.store`.
- **The board both lines share** is `.git/medsync-mod/board.json`, in the git common directory, so worktrees share it too. `$.store` is a per-user JSON file with no compare-and-set, so it cannot make two sessions' simultaneous lock writes safe. Every change to the board runs under an atomic `mkdir` mutex and is moved into place with `mv`.

## Where nothing is drawn

In the VS Code chat panel and under `claude -p`, nothing is drawn. Each turn ends with a one-line summary instead.

The line checks, routing and locks keep working there. A hold can't be answered without a drawing: in VS Code it uses Claude Code's own question dialog. Under `-p`, held calls are denied, and a held prompt prints its synthetic version.

## Turning it off

```bash
claude --safe-mode
```

That turns it off for one run. If you installed it, plain `claude` still loads it; to stop that:

```bash
claude plugin disable medsync@medsync-local --scope local
```

## Developing it

```bash
claude plugin validate tools/medsync-mod
claude plugin test tools/medsync-mod
```

There are 28 tests. They cover each line check, the CSO queue, translations, tasks, Needs you, notes, routing rules, the patient-data hold on prompts (and that a prompt makes no model review call), the console on terminal and desktop, and two lines: lock claim, conflict hold, release on turn end, git hold and a message between lines.

The repo's own `tsc` and ESLint skip this folder. The engine type-checks the mod with the types it writes into `.claude-plugin/types/` when it loads the mod.
