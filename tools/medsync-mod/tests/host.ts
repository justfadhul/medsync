import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";
import { mock } from "claude-code/testing";

// A pretend machine beneath the mod: files, the shell commands it runs
// (mkdir/rmdir/mv/sleep/git/npm), and the session calls it makes.

// the test environment has timers; its typings (no DOM) do not name them
declare const setTimeout: (fn: (value?: unknown) => void, ms: number) => unknown;

export const ROOT = "/repo";
export const DIR = `${ROOT}/.git/medsync-mod`;

export type Host = {
  files: Map<string, string>;
  dirs: Set<string>;
  sent: { to: unknown; text: string }[];
  submitted: string[];
  contexts: (readonly string[] | undefined)[];
  toasts: string[];
  commands: string[];
  classify: { label: string };
};

export function host(
  on: On,
  opts: { env?: Record<string, string>; sessionId?: string } = {},
): Host {
  const h: Host = {
    files: new Map(),
    dirs: new Set([DIR]),
    sent: [],
    submitted: [],
    contexts: [],
    toasts: [],
    commands: [],
    classify: { label: "medium" },
  };
  const abs = (p: string) => (p.startsWith("/") ? p : `${ROOT}/${p}`);
  mock.env(on, { MEDSYNC_LAUNCH: "0", ...opts.env });
  mock.store(on);
  mock.clock(on, { now: 1_700_000_000_000 });

  on("process.run", async ($, e) => {
    const [cmd, ...args] = e.argv;
    const ok = (stdout = "") => ({
      value: {
        exitCode: 0,
        stdout,
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    });
    const fail = (stderr = "no") => ({
      value: {
        exitCode: 1,
        stdout: "",
        stderr,
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    });
    if (cmd === "mkdir") {
      const path = args[args.length - 1]!;
      if (args[0] === "-p") return (h.dirs.add(path), ok());
      return h.dirs.has(path) ? fail("exists") : (h.dirs.add(path), ok());
    }
    if (cmd === "rmdir") return (h.dirs.delete(args[0]!), ok());
    if (cmd === "mv") {
      const [from, to] = args.filter((a) => !a.startsWith("-"));
      h.files.set(to!, h.files.get(from!) ?? "");
      h.files.delete(from!);
      return ok();
    }
    if (cmd === "sleep") return (await new Promise((r) => setTimeout(r, 2)), ok());
    if (cmd === "npm") return ok("2400000");
    if (cmd === "sh") {
      const line = args[1] ?? "";
      h.commands.push(line);
      if (line.includes("--show-toplevel")) return ok(ROOT);
      if (line.includes("--git-common-dir")) return ok(`${ROOT}/.git`);
      if (line.includes("config user.name")) return ok("Test User");
      if (line.includes("branch --show-current")) return ok("main");
      if (line.includes("log --oneline HEAD..@{u}")) return ok("abc123 remote work");
      if (line.includes("find")) return ok("dist: 42");
      return ok();
    }
    return ok();
  });
  on("fs.read", ($, e) =>
    h.files.has(abs(e.path)) ? { value: h.files.get(abs(e.path))! } : { deny: "ENOENT" },
  );
  on("fs.write", ($, e) => (h.files.set(abs(e.path), e.text), { value: undefined }));
  on("fs.stat", () => ({ deny: "ENOENT" }));
  on("fs.list", ($, e) => {
    const dir = abs(e.path).replace(/\/$/, "") + "/";
    const names = [...h.files.keys()]
      .filter((f) => f.startsWith(dir) && !f.slice(dir.length).includes("/"))
      .map((f) => f.slice(dir.length));
    return {
      value: names.map((name) => ({
        name,
        kind: "file" as const,
        size: 1,
        mtimeMs: 0,
        isLink: false,
      })),
    };
  });
  on("session.id", () => ({ value: opts.sessionId ?? "session-b" }));
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("session.usage", () => ({
    value: {
      startedAt: 0,
      context: { window: 200000, percent: 12 },
      rateLimits: [{ kind: "five_hour", percentUsed: 30 }],
    },
  }));
  on("session.send", ($, e) => (h.sent.push({ to: e.to, text: e.text }), { isDelivered: true }));
  on(
    "prompt.submit",
    ($, e) => (h.submitted.push(e.text), h.contexts.push(e.context), { text: e.text }),
  );
  on("model.classify", () => ({ value: h.classify.label }));
  on("audio.play", () => ({ value: undefined }));
  on("ui.toast", ($, e) => (h.toasts.push(String(e.text)), { value: undefined }));
  on("ui.panes", () => ({ value: [] }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("command.register", ($, e) => ({ value: { command: e.name } }));
  on("tool.register", ($, e) => ({ value: { tool: e.name } }));
  // the engine's own answers beneath the plugin
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("session.end", ($, e) => ({ sessionId: e.sessionId }));
  on("turn.start", ($, e) => ({ turnId: e.turnId }));
  on("turn.complete", ($, e) => ({ text: e.answer }));
  on("tool.check", () => ({ decision: "allow" as const }));
  on("prompt.edit", ($, e) => ({ text: e.text, cursor: e.cursor }));
  on("session.receive", ($, e) => ({ text: e.text }));
  on("agent.spawn", ($, e) => ({ model: e.model ?? "sonnet", agentId: "agent-1" }));
  on("command.run", () => ({ text: "built-in ran" }));
  return h;
}

/** Writes a board as another line left it. */
export function seedBoard(h: Host, board: Record<string, unknown>) {
  h.files.set(`${DIR}/board.json`, JSON.stringify(board));
}

export function board(h: Host): Record<string, any> {
  return JSON.parse(h.files.get(`${DIR}/board.json`) ?? "{}");
}

export const startSession = (
  $: {
    session: {
      start: (e: { cwd: string; surface: "terminal"; isInteractive: boolean }) => Promise<unknown>;
    };
  },
  isInteractive = true,
) => $.session.start({ cwd: ROOT, surface: "terminal", isInteractive });

export const BAND = {
  plugin: "medsync",
  surface: "terminal" as const,
  component: "AbovePrompt" as const,
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 8,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 8 },
    view: {},
  },
};

const pause = () => new Promise((r) => setTimeout(r, 5));
const drawBand = ($: Engine) =>
  $.ui.render({
    component: "AbovePrompt",
    surface: "terminal",
    requestId: "band",
    props: BAND.props,
  } as never);

/** Presses `option` on the first hold the band shows, once one appears (drawn
 * through the engine: a fresh mount would abandon the held dispatch). */
export async function press($: Engine, h: Host, option: string) {
  for (let i = 0; i < 400; i++) {
    const needs = (board(h).needs ?? []) as { id: string; blocking: boolean; options: string[] }[];
    const need = needs.find((n) => n.blocking && n.options.some((o) => o.includes(option)));
    if (need) {
      await drawBand($);
      await $.ui.press({
        plugin: "medsync",
        key: `bd:${need.id}:${need.options.findIndex((o: string) => o.includes(option))}`,
        requestId: "band",
        surface: "terminal",
      });
      return;
    }
    await pause();
  }
  throw new Error(`no hold offering "${option}" appeared`);
}

/** Presses a band button by key (the held prompt's). */
export async function pressKey($: Engine, key: string) {
  await drawBand($);
  await $.ui.press({ plugin: "medsync", key, requestId: "band", surface: "terminal" });
}

export const cmd = ($: Engine, command: string, args = "") =>
  $.command.run({
    command,
    args,
    origin: { kind: "composer" },
    presentation: { isFullscreen: false, columns: 100 },
  });
