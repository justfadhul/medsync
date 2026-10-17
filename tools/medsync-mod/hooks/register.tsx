import type { Agent, Board, Local, Need, Review, Route, View } from "../types";
import type { Actions } from "./console";
import type { EngineInterface, PluginOptions, Register } from "claude-code";
import { atom, read, update } from "claude-code";

import { renderBand, renderPane, summaryLine } from "./console";
import * as g from "./guards";
import { emptyBoard, mutateBoard, readBoard } from "./shared";

type $ = EngineInterface;

const PANE = "dashboard";
const TOOL = "request_from_user";
const LETTERS = "ABCDEFGHJK";

export const boardRef = atom({ plugin: "medsync", key: "board" } as const, emptyBoard());
export const localRef = atom(
  { plugin: "medsync", key: "local" } as const,
  {
    line: "?",
    user: "",
    branch: "",
    surface: "",
    startedAt: 0,
    turn: null,
    turns: 0,
    tests: { passed: 0, failed: 0, isRunning: false, lastFailing: "" },
    lastAction: "",
    files: {},
    agents: [],
    route: null,
    routes: [],
    routeOn: true,
    routeLock: null,
    overrides: [],
    downRouted: 0,
    review: null,
    reviewOn: true,
    threshold: 70,
    hints: [],
    pipeline: { review: "—", route: "—", transmit: "—" },
    usage: { context: null, plan: null },
    checkpoints: [],
  } satisfies Local as Local,
);
export const viewRef = atom(
  { plugin: "medsync", key: "view" } as const,
  {
    view: "both",
    mode: "prompt",
    sendOn: "",
    compose: "",
    selected: "",
    open: {},
  } satisfies View as View,
);

const makeCfg = (options: PluginOptions) => {
  const opt = (k: string, d: string) => String(options[k] ?? d);
  return {
    testCommand: opt("testCommand", "npm run test"),
    threshold: Number(options.reviewThreshold ?? 70),
    reviewOn: options.reviewEnabled !== false,
    routeOn: options.routingEnabled !== false,
    strong: opt("strongModel", "opus"),
    mid: opt("midModel", "sonnet"),
    fast: opt("fastModel", "haiku"),
    emergency: g.list(opt("emergencyPaths", "")),
    copy: g.list(opt("patientCopyPaths", "")),
    i18nDir: opt("i18nDir", "supabase/functions/_shared/symptom-catalog/i18n").replace(/\/$/, ""),
    source: opt("sourceLanguage", "en"),
    languages: g.list(opt("languages", "")),
    clinical: new RegExp(
      opt(
        "clinicalPattern",
        "emergency|triage|dos(e|ing)|mg/kg|prescri|formulary|clinical reasoning|differential|\\bCSO\\b|signpost|resus|red flag",
      ),
      "i",
    ),
    shared: g.list(
      opt(
        "sharedPaths",
        "db/schema/,supabase/migrations/,types/,lib/facts/,package.json,tsconfig.json",
      ),
    ),
    heartbeatMs: Number(options.heartbeatSeconds ?? 20) * 1000,
    offlineMs: Number(options.offlineSeconds ?? 120) * 1000,
    holdMs: Number(options.holdMinutes ?? 10) * 60_000,
    sound: options.soundOnBlocking !== false,
  };
};
let cfg = makeCfg({});
const tierModel = () => ({ strong: cfg.strong, mid: cfg.mid, fast: cfg.fast });
const effortOf = { strong: "high", mid: "medium", fast: "low" } as const;

// Module values: rebuilt at every load (session.start fires again on a reload).
const ctx = {
  root: "",
  dir: "",
  line: "?",
  sessionId: "",
  isInteractive: false,
  surface: "" as string,
  user: "unknown",
};
const decisions = new Map<string, string>();
const bypass = new Set<string>();
const agentRoutes = new Map<string, { model: string; effort: string }>();
const changedThisTurn = new Set<string>();
const permIds = new Set<string>();
let pendingRoute: Route | null = null;
let turnRoute: Route | null = null;
let editTimer: { cancel: () => void } | undefined;

// ── shared and local writes ──────────────────────────────────────────

const shared = async <T,>($: $, change: (b: Board, now: number) => T): Promise<T> => {
  if (!ctx.dir) return change(emptyBoard(), await $.clock.now());
  const { board, value } = await mutateBoard($, ctx.dir, ctx.line, change);
  await update($, boardRef, () => board);
  return value;
};
const local = ($: $, fn: (l: Local) => Local) => update($, localRef, fn);
const stream = ($: $, kind: string, text: string) =>
  shared($, (b, at) => void b.stream.push({ at, line: ctx.line, kind, text: text.slice(0, 200) }));
const counted = ($: $, check: string, kind: string, text: string) =>
  shared($, (b, at) => {
    b.checks[check] = (b.checks[check] ?? 0) + 1;
    b.stream.push({ at, line: ctx.line, kind, text: text.slice(0, 200) });
  });
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const sh = ($: $, cmd: string, timeoutMs = 30_000) =>
  $.process.run(["sh", "-c", cmd], { cwd: ctx.root || undefined, timeoutMs });
const git = async ($: $, args: string) => (await sh($, `git ${args}`)).stdout.trim();
const csoAdd = ($: $, kind: Board["cso"][number]["kind"], file: string, summary: string) =>
  shared($, (b, at) => {
    b.cso.push({
      n: b.csoNext++,
      line: ctx.line,
      at,
      file,
      kind,
      summary,
      by: ctx.user,
      done: false,
    });
    b.checks.cso = (b.checks.cso ?? 0) + 1;
  });

// ── holds: a call waits inside a `$` call (no hook budget) for a press ──

const hold = async (
  $: $,
  signal: AbortSignal,
  need: Pick<Need, "kind" | "what" | "why" | "options">,
): Promise<string | null> => {
  if (!ctx.isInteractive) return null;
  if (ctx.surface !== "terminal" && ctx.surface !== "desktop") {
    try {
      return await $.ui.ask(`${need.what}. ${need.why}`.slice(0, 900) + "?", {
        header: "MedSync",
        options: need.options.slice(0, 4),
      });
    } catch {
      return null;
    }
  }
  const id = Math.random().toString(36).slice(2, 10);
  await shared(
    $,
    (b, at) => void b.needs.push({ id, line: ctx.line, ...need, blocking: true, at }),
  );
  $.ui.toast(`MedSync needs you: ${need.what}`);
  if (cfg.sound) $.audio.play({ asset: "assets/ping.wav" }).catch(() => undefined);
  try {
    const until = (await $.clock.now()) + cfg.holdMs;
    while (!decisions.has(id)) {
      if (signal.aborted || (await $.clock.now()) > until) return null;
      await $.process.run(["sleep", "0.3"]);
    }
    return decisions.get(id) ?? null;
  } finally {
    decisions.delete(id);
    await shared($, (b) => void (b.needs = b.needs.filter((n) => n.id !== id)));
  }
};

// ── locks ────────────────────────────────────────────────────────────

const isLive = (b: Board, line: string) =>
  b.lines[line] !== undefined && b.lines[line]!.status !== "offline";
const owner = (b: Board, file: string) => {
  const l = b.locks[file];
  return l && l.line !== ctx.line && isLive(b, l.line) ? l : undefined;
};
const claim = ($: $, files: string[], agent: string, force = false) =>
  shared($, (b, now) => {
    const blocked: string[] = [];
    for (const file of files) {
      const held = owner(b, file);
      if (held && !force) {
        if (!held.waiting.includes(ctx.line)) held.waiting.push(ctx.line);
        blocked.push(
          `${file} is being edited by ${b.lines[held.line]?.label ?? "Line " + held.line}`,
        );
        continue;
      }
      b.locks[file] = {
        file,
        line: ctx.line,
        agent,
        since: b.locks[file]?.line === ctx.line ? b.locks[file]!.since : now,
        waiting: [],
      };
    }
    return blocked;
  });
const release = ($: $) =>
  shared($, (b) => {
    for (const [file, l] of Object.entries(b.locks)) {
      if (l.line === ctx.line) delete b.locks[file];
      else l.waiting = l.waiting.filter((w) => w !== ctx.line);
    }
  });
const otherHolds = (b: Board) =>
  Object.values(b.locks).filter((l) => l.line !== ctx.line && isLive(b, l.line));

/** Waits (in sleeps that cost no budget) until `isClear` reads true on the board. */
const waitFor = async ($: $, signal: AbortSignal, isClear: (b: Board) => boolean) => {
  const until = (await $.clock.now()) + cfg.holdMs;
  while ((await $.clock.now()) < until && !signal.aborted) {
    if (isClear(await readBoard($, ctx.dir))) return true;
    await $.process.run(["sleep", "2"]);
  }
  return false;
};

const lockOrHold = async (
  $: $,
  signal: AbortSignal,
  files: string[],
  agent: string,
): Promise<string | null> => {
  if (!files.length) return null;
  const blocked = await claim($, files, agent);
  if (!blocked.length) return null;
  await counted($, "coordination", "lock", blocked.join("; "));
  const pick = await hold($, signal, {
    kind: "lock",
    what: blocked[0]!,
    why: "Wait until it is released, skip this edit, or override the lock",
    options: ["Wait", "Skip", "Override"],
  });
  if (pick === "Override") {
    await claim($, files, agent, true);
    await stream($, "override", `${ctx.user} overrode the lock on ${files.join(", ")}`);
    return null;
  }
  if (pick === "Wait" && (await waitFor($, signal, (b) => files.every((f) => !owner(b, f))))) {
    return (await claim($, files, agent)).length
      ? "MedSync: the file was claimed again by the other line."
      : null;
  }
  return `MedSync: ${blocked[0]}. The edit was ${pick === "Skip" ? "skipped by the user" : "not made"}; leave this file and carry on with other work.`;
};

// ── lines ────────────────────────────────────────────────────────────

const beat = async ($: $) => {
  const branch = await git($, "branch --show-current").catch(() => "");
  await shared($, (b, now) => {
    const me = b.lines[ctx.line];
    if (me)
      Object.assign(me, {
        lastSeen: now,
        branch,
        status: me.status === "offline" ? "online" : me.status,
      });
    for (const l of Object.values(b.lines))
      if (l.id !== ctx.line && l.status !== "offline" && now - l.lastSeen > cfg.offlineMs) {
        l.status = "offline";
        for (const [f, lock] of Object.entries(b.locks)) if (lock.line === l.id) delete b.locks[f];
        b.stream.push({
          at: now,
          line: l.id,
          kind: "line",
          text: `${l.label} went silent; its locks were released`,
        });
      }
  });
  const usage = await $.session.usage().catch(() => undefined);
  if (usage)
    await local($, (l) => ({
      ...l,
      branch,
      usage: {
        context: usage.context.percent ?? null,
        plan: usage.rateLimits.find((r) => r.kind === "five_hour")?.percentUsed ?? null,
      },
    }));
};

const others = (b: Board) =>
  Object.values(b.lines).filter((l) => l.id !== ctx.line && l.status !== "offline");
const lineByKey = (b: Board, key: string) =>
  Object.values(b.lines).find(
    (l) => l.id.toLowerCase() === key.toLowerCase() || l.label.toLowerCase() === key.toLowerCase(),
  );

const tellLine = async ($: $, to: string, text: string) => {
  const b = await readBoard($, ctx.dir);
  const target = lineByKey(b, to);
  if (!target || target.id === ctx.line) return `No other line called ${to}.`;
  const sent = await $.session.send({
    to: { sessionId: target.sessionId },
    text: `[MedSync ${b.lines[ctx.line]?.label ?? ctx.line}] ${text}`,
  });
  await shared(
    $,
    (bb, at) =>
      void bb.traffic.push({ at, from: ctx.line, to: target.id, text: text.slice(0, 160) }),
  );
  return sent.isDelivered
    ? `Sent to ${target.label}.`
    : `Not delivered to ${target.label}: ${sent.reason}`;
};

// ── review and routing ───────────────────────────────────────────────

type Verdict = {
  score: number;
  checklist: Record<string, boolean | null>;
  issues: string[];
  questions: string[];
  improved: string;
  route?: {
    size?: string;
    risk?: string;
    depth?: string;
    scope?: string;
    reason?: string;
    confidence?: number;
  };
};

const assess = async ($: $, text: string): Promise<Verdict | null> => {
  const l = await read($, localRef);
  const b = await read($, boardRef);
  const facts = [
    `branch: ${l.branch || "unknown"}`,
    `files changed this session: ${Object.keys(l.files).slice(0, 12).join(", ") || "none"}`,
    `open tasks: ${
      b.tasks
        .filter((t) => t.status !== "completed")
        .map((t) => t.subject)
        .slice(0, 8)
        .join("; ") || "none"
    }`,
    `last failing test: ${l.tests.lastFailing || "none"}`,
    "MedSync defaults: low-end Android phones, poor networks, synthetic data only, CSO sign-off for patient-facing copy",
  ].join("\n");
  const reply = await $.model.complete({
    model: cfg.fast,
    maxTokens: 1200,
    timeoutMs: 20_000,
    system: [
      {
        cache: true,
        text:
          "You review a developer prompt to Claude Code for MedSync (Next.js 16, Supabase, Drizzle, Expo mobile). Reply with ONLY JSON: " +
          '{"score":0-100,"checklist":{"goal":bool,"area":bool,"done":bool,"symptom":bool|null,"constraints":bool,"noPhi":bool},' +
          '"issues":[string],"questions":[string],"improved":string,' +
          '"route":{"size":"small|medium|large","risk":"low|medium|high","depth":"low|medium|high","scope":"narrow|medium|wide","reason":string,"confidence":0-1}}. ' +
          "symptom is null unless the prompt reports a bug. Score clarity: goal, files/area, definition of done, symptom for bugs, constraints, no patient data. " +
          'In "improved" keep every word of the original and wrap each addition in [+ ... ]. Fill gaps only from FACTS; never invent file names; ' +
          'where a fact is missing, put a question in "questions" instead.',
      },
    ],
    prompt: `FACTS\n${facts}\n\nPROMPT\n${text}`,
  });
  if (!reply.isAnswered) return null;
  try {
    return JSON.parse(
      reply.text.slice(reply.text.indexOf("{"), reply.text.lastIndexOf("}") + 1),
    ) as Verdict;
  } catch {
    return null;
  }
};

const tierFromSignals = (r: NonNullable<Verdict["route"]>): "strong" | "mid" | "fast" => {
  const v = (s?: string) =>
    s === "high" || s === "large" || s === "wide" ? 2 : s === "medium" ? 1 : 0;
  const score = v(r.risk) * 2 + v(r.depth) * 2 + v(r.size) + v(r.scope);
  return score >= 7 ? "strong" : score >= 3 ? "mid" : "fast";
};

const decide = async ($: $, text: string, verdict: Verdict | null): Promise<Route> => {
  const l = await read($, localRef);
  const fast = g.fastRoute(text, cfg.clinical);
  const base = { text: text.slice(0, 80), signals: [] as string[] };
  if (fast?.tier === "strong")
    return {
      ...base,
      model: cfg.strong,
      effort: "high",
      reason: fast.reason,
      source: "rule",
      confidence: 1,
    };
  if (l.routeLock)
    return {
      ...base,
      ...l.routeLock,
      reason: "Locked for this session",
      source: "lock",
      confidence: 1,
    };
  const w = g.words(text);
  const remembered = l.overrides.find((o) => g.similar(o.words, w) >= 0.5);
  if (remembered)
    return {
      ...base,
      model: remembered.model,
      effort: remembered.effort,
      reason: "Your override for a similar prompt",
      source: "override",
      confidence: 0.8,
    };
  if (fast)
    return {
      ...base,
      model: cfg.fast,
      effort: "low",
      reason: fast.reason,
      source: "rule",
      confidence: 0.9,
    };
  const r = verdict?.route;
  if (r) {
    const tier = tierFromSignals(r);
    return {
      text: base.text,
      model: tierModel()[tier],
      effort: effortOf[tier],
      reason: r.reason ?? `${tier} task`,
      source: "model",
      confidence: r.confidence ?? 0.6,
      signals: [`size ${r.size}`, `risk ${r.risk}`, `depth ${r.depth}`, `scope ${r.scope}`],
    };
  }
  return {
    ...base,
    model: cfg.mid,
    effort: "medium",
    reason: "No signal; middle model",
    source: "default",
    confidence: 0.3,
  };
};

const syncAgents = async ($: $) => {
  const agents = (await read($, localRef)).agents;
  await shared($, (b) => void (b.agents[ctx.line] = agents));
};

const chip = (r: Route) => `${r.model}·${r.effort} ${r.source}`;

// ── actions the console's buttons call ───────────────────────────────

const actions = ($: $): Actions => ({
  decide: async (id, option) => {
    decisions.set(id, option);
    // a need nobody waits on (a request that did not block) leaves at once
    await shared($, (b) => void (b.needs = b.needs.filter((n) => n.id !== id || n.blocking)));
  },
  view: (patch) => update($, viewRef, (v) => ({ ...v, ...patch })),
  toggle: async (key) => {
    const v = await update($, viewRef, (x) => ({ ...x, open: { ...x.open, [key]: !x.open[key] } }));
    await $.store.set("open", v.open);
  },
  send: async (kind) => {
    const v = await read($, viewRef);
    const l = await read($, localRef);
    const target = v.sendOn && v.sendOn !== ctx.line ? v.sendOn : ctx.line;
    const text =
      kind === "improved"
        ? clean(l.review?.improved ?? "")
        : kind === "mine"
          ? (l.review?.original ?? "")
          : v.compose.trim();
    if (kind === "edit")
      return void $.prompt.fill({ text: clean(l.review?.improved ?? ""), mode: "replace" });
    if (!text) return;
    if (v.mode !== "prompt" && kind === "main") {
      await shared(
        $,
        (bb, at) =>
          void bb.notes.push({
            id: Math.random().toString(36).slice(2, 8),
            line: target,
            from: ctx.line,
            text,
            pinned: v.mode === "pin",
            at,
          }),
      );
      await update($, viewRef, (x) => ({ ...x, compose: "" }));
      return;
    }
    if (target !== ctx.line) {
      const out = await tellLine($, target, text);
      await local($, (x) => ({ ...x, lastAction: out }));
    } else {
      if (kind !== "main") bypass.add(text);
      await local($, (x) => ({ ...x, review: null }));
      await $.prompt.submit({ text, asUser: true });
    }
    await update($, viewRef, (x) => ({ ...x, compose: "" }));
  },
  removeNote: (id) => shared($, (b) => void (b.notes = b.notes.filter((n) => n.id !== id))),
  pause: async () => {
    const l = await read($, localRef);
    if (l.turn) await $.turn.abort({ turnId: l.turn.id });
    await local($, (x) => ({ ...x, lastAction: l.turn ? "Paused the turn" : "No turn running" }));
  },
  tests: () => runTests($),
  diff: async () => void (await $.command.run({ command: "diff" })),
  checkpoint: async () => {
    const l = await read($, localRef);
    const sha = (await git($, "stash create")) || (await git($, "rev-parse HEAD"));
    const name = `cp-${l.turns}`;
    await local($, (x) => ({
      ...x,
      checkpoints: [...x.checkpoints, { name, turn: l.turns, sha }].slice(-20),
      lastAction: `Checkpoint ${name} (${sha.slice(0, 7)})`,
    }));
    await stream(
      $,
      "checkpoint",
      `${name} at turn ${l.turns}: restore with git stash apply ${sha.slice(0, 12)}`,
    );
  },
  compact: async () => {
    const r = await $.session.compact().catch((err: unknown) => ({ skip: String(err) }));
    await local($, (x) => ({
      ...x,
      lastAction: "skip" in r && r.skip ? `Compact skipped: ${r.skip}` : "Compacted",
    }));
  },
  override: async (model, effort) => {
    // never mid-turn (prompt caching): it applies from the next prompt, and to similar ones after
    const l = await read($, localRef);
    if (!l.route) return;
    const route: Route = { ...l.route, model, effort, source: "override", reason: "Your override" };
    await local($, (x) => ({
      ...x,
      route,
      overrides: [...x.overrides, { words: g.words(route.text), model, effort }].slice(-30),
      lastAction: `Next turn: ${model}·${effort}`,
    }));
  },
  lockSession: async () => {
    const l = await read($, localRef);
    await local($, (x) => ({
      ...x,
      routeLock: x.routeLock
        ? null
        : l.route
          ? { model: l.route.model, effort: l.route.effort }
          : null,
    }));
  },
  select: (id) => update($, viewRef, (v) => ({ ...v, selected: v.selected === id ? "" : id })),
  message: async (id) => {
    const v = await read($, viewRef);
    if (!v.compose.trim())
      return void local($, (x) => ({
        ...x,
        lastAction: "Type the message in the compose box first",
      }));
    await $.session.send({ to: { agentId: id }, text: v.compose.trim() });
    await shared(
      $,
      (b, at) =>
        void b.traffic.push({
          at,
          from: "you",
          to: id.slice(0, 6),
          text: v.compose.trim().slice(0, 120),
        }),
    );
    await update($, viewRef, (x) => ({ ...x, compose: "" }));
  },
  pauseAgent: async (id) => {
    await $.session.send({
      to: { agentId: id },
      text: "Pause after your current step and wait for a message from the lead.",
    });
    await local($, (x) => ({ ...x, lastAction: "Asked the agent to pause" }));
  },
  logAgent: async (id) => {
    const a = (await read($, localRef)).agents.find((x) => x.id === id);
    if (a)
      $.ui.log(
        `${a.name} (${a.model}): ${a.status}, ${a.tools} tool calls, now: ${a.now || "—"}, files: ${a.files.join(", ") || "none"}`,
      );
  },
  input: async (text) => {
    await update($, viewRef, (v) => ({ ...v, compose: text }));
    await local($, (x) => ({ ...x, hints: g.ruleHints(text) }));
  },
});

const clean = (improved: string) => improved.replace(/\[\+\s*([\s\S]*?)\s*\]/g, "$1");

const runTests = async ($: $) => {
  await local($, (l) => ({
    ...l,
    tests: { ...l.tests, isRunning: true },
    lastAction: "Running tests…",
  }));
  const r = await sh($, cfg.testCommand, 600_000).catch((err: unknown) => ({
    exitCode: 1,
    stdout: String(err),
    stderr: "",
  }));
  await recordTests($, r.stdout + r.stderr, r.exitCode);
};
const recordTests = async ($: $, out: string, exitCode: number) => {
  const m = out.match(/Tests\s+(?:(\d+) failed\s*\|\s*)?(?:\d+ skipped\s*\|\s*)?(\d+) passed/);
  const failing = out.match(/^\s*(?:FAIL|×|✗)\s+(.+)$/m)?.[1]?.trim() ?? "";
  await local($, (l) => ({
    ...l,
    tests: {
      passed: Number(m?.[2] ?? 0),
      failed: Number(m?.[1] ?? (exitCode ? 1 : 0)),
      isRunning: false,
      lastFailing: failing || (exitCode ? l.tests.lastFailing : ""),
    },
    lastAction: m
      ? `Tests: ${m[2]} passed${m[1] ? `, ${m[1]} failed` : ""}`
      : `Tests exited ${exitCode}`,
  }));
};

const languages = async ($: $) => {
  const files = await $.fs.list(`${ctx.root}/${cfg.i18nDir}`).catch(() => []);
  const found = files
    .filter((f) => f.name.endsWith(".json") && f.name !== `${cfg.source}.json`)
    .map((f) => f.name.slice(0, -5));
  return [...new Set([...found, ...cfg.languages])];
};

const previewDanger = async ($: $, kind: string, cmd: string) => {
  if (kind === "rm -rf") {
    const targets = g.rmTargets(cmd).slice(0, 6);
    const counts = await sh(
      $,
      targets.map((t) => `printf '%s: ' ${q(t)}; find ${q(t)} 2>/dev/null | wc -l`).join("; "),
    ).catch(() => undefined);
    return counts ? counts.stdout.trim().replace(/\n/g, ", ") + " paths" : targets.join(", ");
  }
  if (kind === "git push --force") {
    const lost = await git($, "log --oneline HEAD..@{u}").catch(() => "");
    return lost
      ? `drops remote commits: ${lost.split("\n").slice(0, 5).join("; ")}`
      : "no remote commits would be dropped";
  }
  return kind === "migration reset"
    ? "every table and its data in that database"
    : `statement: ${cmd.match(/(drop|truncate)[^;]*/i)?.[0] ?? cmd}`;
};

const noteDeps = async ($: $, pkgs: string[]) => {
  for (const pkg of pkgs.slice(0, 4)) {
    const r = await $.process
      .run(["npm", "view", pkg.replace(/@[^@/]*$/, "") || pkg, "dist.unpackedSize"], {
        timeoutMs: 8_000,
      })
      .catch(() => undefined);
    const bytes = Number(r?.stdout.trim());
    const size = bytes
      ? `~${bytes > 1e6 ? (bytes / 1e6).toFixed(1) + " MB" : Math.round(bytes / 1e3) + " kB"} unpacked`
      : "size unknown";
    await counted($, "bandwidth", "deps", `New dependency ${pkg}: ${size}`);
    $.ui.toast(`New dependency ${pkg}: ${size} (low-end phones, poor networks)`);
  }
};

export const register: Register = (on, options) => {
  cfg = makeCfg(options);
  // ── session ──────────────────────────────────────────────────────────

  on("session.start", async ($, e, next) => {
    ctx.isInteractive = e.isInteractive;
    ctx.surface = e.surface ?? "";
    ctx.root = (await git($, "rev-parse --show-toplevel").catch(() => "")) || e.cwd;
    const common = await git($, "rev-parse --path-format=absolute --git-common-dir").catch(
      () => "",
    );
    ctx.dir = `${common || ctx.root + "/.git"}/medsync-mod`;
    await $.process.run(["mkdir", "-p", ctx.dir]);
    ctx.user = (await git($, "config user.name").catch(() => "")) || "unknown";
    ctx.sessionId = await $.session.id();
    const label = (await $.env.get("MEDSYNC_LINE")) ?? "";
    const branch = await git($, "branch --show-current").catch(() => "");
    ctx.line = await shared($, (b, now) => {
      const mine = Object.values(b.lines).find((l) => l.sessionId === ctx.sessionId);
      const id =
        mine?.id ??
        [...LETTERS].find(
          (c) =>
            !b.lines[c] ||
            b.lines[c]!.status === "offline" ||
            now - b.lines[c]!.lastSeen > cfg.offlineMs,
        ) ??
        "Z";
      b.lines[id] = {
        id,
        label: label || mine?.label || `Line ${id}`,
        sessionId: ctx.sessionId,
        status: "online",
        task: "",
        lastSeen: now,
        branch,
      };
      b.stream.push({ at: now, line: id, kind: "line", text: `${b.lines[id]!.label} joined` });
      return id;
    });
    const open = ((await $.store.get("open")) ?? {}) as Record<string, boolean>;
    const now = await $.clock.now();
    await update($, viewRef, (v) => ({ ...v, open, sendOn: ctx.line }));
    await local($, (l) => ({
      ...l,
      line: ctx.line,
      user: ctx.user,
      branch,
      surface: ctx.surface,
      startedAt: l.startedAt || now,
      reviewOn: l.startedAt ? l.reviewOn : cfg.reviewOn,
      routeOn: l.startedAt ? l.routeOn : cfg.routeOn,
      threshold: l.startedAt ? l.threshold : cfg.threshold,
    }));

    for (const c of [
      { name: "dash", description: "Toggle the MedSync comms console" },
      {
        name: "cso",
        description: "CSO review queue: /cso, /cso done <n>, /cso export",
        argumentHint: "[done <n> | export]",
      },
      {
        name: "translations",
        description: "Stale and missing translation keys (not clinically reviewed)",
      },
      {
        name: "route",
        description: "Model routing: /route, /route off | on | lock <model> <effort>",
        argumentHint: "[off | on | lock <model> <effort>]",
      },
      {
        name: "line",
        description: "Lines in this folder: /line, /line name <label>, /line worktree, /line merge",
        argumentHint: "[name <label> | worktree | merge]",
      },
      {
        name: "tell",
        description: "Message another line: /tell <A|B> <message>",
        argumentHint: "<line> <message>",
      },
    ])
      await $.command.register(c);
    await $.tool.register({
      name: TOOL,
      isDeferred: false,
      description:
        "Ask the MedSync user for something only they can give (a decision, a credential they must enter themselves, a sign-off). " +
        'It appears under "Needs you" in their console. With blocking true the call waits for their answer; otherwise it returns at once.',
      inputSchema: {
        type: "object",
        properties: {
          what: { type: "string", description: "What you need, in one line" },
          why: { type: "string", description: "Why you need it" },
          blocking: { type: "boolean", description: "Wait for the answer before continuing" },
        },
        required: ["what", "why", "blocking"],
      },
    });

    $.clock.every(cfg.heartbeatMs, () => void beat($).catch(() => undefined));
    void beat($).catch(() => undefined);
    if ((await $.env.get("MEDSYNC_LAUNCH")) === "1" && e.isInteractive)
      void $.ui.open({ id: PANE, title: "MedSync" });
    return next(e);
  });

  on("session.end", async ($, e, next) => {
    await release($).catch(() => undefined);
    await shared($, (b, now) => {
      const me = b.lines[ctx.line];
      if (me && me.sessionId === ctx.sessionId)
        Object.assign(me, { status: "offline", lastSeen: now });
      b.needs = b.needs.filter((n) => n.line !== ctx.line);
    }).catch(() => undefined);
    return next(e);
  });

  on("session.receive", async ($, e, next) => {
    if (
      (e.origin.kind === "peer" || e.origin.kind === "coordinator") &&
      "plugin" in e.origin &&
      e.origin.plugin === $.plugin.name
    ) {
      const from = e.text.match(/\[MedSync ([^\]]+)\]/)?.[1] ?? "other line";
      await shared(
        $,
        (b, at) => void b.traffic.push({ at, from, to: ctx.line, text: e.text.slice(0, 160) }),
      );
    }
    return next(e);
  });

  on("session.send", async ($, e, next) => {
    const sent = await next(e);
    if (e.origin.kind !== "plugin")
      await shared(
        $,
        (b, at) =>
          void b.traffic.push({
            at,
            from: e.agentId?.slice(0, 6) ?? "lead",
            to: e.to.slice(0, 20),
            text: e.text.slice(0, 120),
          }),
      );
    return sent;
  });

  // ── turns ────────────────────────────────────────────────────────────

  on("turn.start", async ($, e, next) => {
    if (!e.agentId) {
      turnRoute = pendingRoute;
      pendingRoute = null;
      changedThisTurn.clear();
      const now = await $.clock.now();
      await local($, (l) => ({
        ...l,
        turns: l.turns + 1,
        turn: { id: e.turnId, n: l.turns + 1, startedAt: now },
      }));
      await shared($, (b) => {
        const me = b.lines[ctx.line];
        if (me) Object.assign(me, { status: "busy", task: e.text.slice(0, 80) });
      });
    }
    return next(e);
  });

  on("turn.step", async function* ($, e, next) {
    const l = await read($, localRef);
    const r = e.agentId ? agentRoutes.get(e.agentId) : turnRoute;
    if (!r || !l.routeOn) return yield* next(e);
    const effort = r.model === cfg.fast ? {} : { effort: r.effort as "low" | "medium" | "high" };
    return yield* next({ ...e, model: r.model, ...effort });
  });

  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    if (e.agentId) {
      const now = await $.clock.now();
      await local($, (l) => ({
        ...l,
        agents: l.agents.map((a) =>
          a.id === e.agentId
            ? { ...a, status: e.reason === "answer" ? "done" : "failed", endedAt: now }
            : a,
        ),
      }));
      const a = (await read($, localRef)).agents.find((x) => x.id === e.agentId);
      if (a) await stream($, "agent", `${a.name} ${a.status}`);
      await syncAgents($);
      return result;
    }
    await release($);
    await shared($, (b) => {
      const me = b.lines[ctx.line];
      if (me) Object.assign(me, { status: "online", task: "" });
    });
    turnRoute = null;
    await local($, (l) => ({ ...l, turn: null }));
    const touched = [...changedThisTurn].filter((f) => g.under(f, ctx.root, cfg.shared));
    if (touched.length) {
      const b = await readBoard($, ctx.dir);
      for (const other of others(b))
        await tellLine(
          $,
          other.id,
          `changed shared files: ${touched.join(", ")}. Re-read them before you edit anything that depends on them.`,
        ).catch(() => undefined);
    }
    await beat($).catch(() => undefined);
    if (ctx.surface === "vscode" || !ctx.isInteractive)
      return {
        ...result,
        text: `MedSync · ${summaryLine(await read($, localRef), await read($, boardRef))}`,
      };
    return result;
  });

  // ── prompts: review › route › transmit ───────────────────────────────

  on("prompt.edit", async ($, e, next) => {
    editTimer?.cancel();
    const text = e.text;
    editTimer = $.clock.after(
      800,
      () => void local($, (l) => ({ ...l, hints: g.ruleHints(text) })),
    );
    return next(e);
  });

  on("prompt.submit", async ($, e, next) => {
    const text = e.text.trim();
    const ours = e.origin.kind === "plugin" && e.origin.name === $.plugin.name;
    if (e.command || e.isMeta || !text || text.startsWith("!") || text.startsWith("/"))
      return next(e);
    if (!ours && e.origin.kind !== "composer") return next(e);
    const l = await read($, localRef);
    const skipReview = bypass.delete(text) || !l.reviewOn;
    const phi = g.findPhi(text);
    if (phi.length) {
      const review: Review = {
        original: text,
        score: 0,
        checklist: [{ label: "No patient data", ok: false }],
        issues: phi.map((p) => `${p.why}: ${p.line}`),
        questions: [],
        improved: g.synthesize(text),
        phi: phi.map((p) => p.why),
        isHeld: true,
      };
      await local($, (x) => ({
        ...x,
        review,
        pipeline: { review: "PHI held", route: "—", transmit: "held" },
      }));
      await counted($, "phi", "guard", `Prompt held: ${review.phi.join(", ")}`);
      $.ui.toast("MedSync held your prompt: real-looking patient data");
      return {
        drop: ctx.isInteractive
          ? "MedSync held this prompt: it holds real-looking patient data. Send the synthetic version from the MedSync console."
          : `MedSync held this prompt: real-looking patient data. Synthetic version:\n${review.improved}`,
      };
    }
    const fast = g.fastRoute(text, cfg.clinical);
    const needsModel = !skipReview || (l.routeOn && !fast && !l.routeLock);
    const verdict = needsModel ? await assess($, text) : null;
    if (!skipReview && verdict && verdict.score < l.threshold) {
      const c = verdict.checklist;
      const review: Review = {
        original: text,
        score: verdict.score,
        checklist: [
          { label: "Goal", ok: !!c.goal },
          { label: "Files / area", ok: !!c.area },
          { label: "Definition of done", ok: !!c.done },
          ...(c.symptom === null || c.symptom === undefined
            ? []
            : [{ label: "Symptom", ok: !!c.symptom }]),
          { label: "Constraints", ok: !!c.constraints },
          { label: "No patient data", ok: true },
        ],
        issues: verdict.issues ?? [],
        questions: verdict.questions ?? [],
        improved: verdict.improved || text,
        phi: [],
        isHeld: true,
      };
      await local($, (x) => ({
        ...x,
        review,
        pipeline: { review: `held ${verdict.score}`, route: "—", transmit: "held" },
      }));
      await stream($, "review", `Prompt held at ${verdict.score}/100`);
      return {
        drop: ctx.isInteractive
          ? `MedSync review: ${verdict.score}/100, under ${l.threshold}. The improved prompt is in the MedSync console (Send improved / Send mine / Edit improved).`
          : `MedSync review: ${verdict.score}/100, under ${l.threshold}. Re-run with the improved prompt (or /review off):\n${clean(review.improved)}`,
      };
    }
    const route = await decide($, text, verdict);
    const routed = l.routeOn ? route : null;
    pendingRoute = routed;
    const sessionModel = await $.session.model().catch(() => "");
    const cheaper = routed && routed.model === cfg.fast && !sessionModel.includes(cfg.fast);
    await local($, (x) => ({
      ...x,
      route,
      routes: [route, ...x.routes].slice(0, 12),
      downRouted: x.downRouted + (cheaper ? 1 : 0),
      review: null,
      pipeline: {
        review: skipReview ? "skipped" : `pass ${verdict?.score ?? "—"}`,
        route: l.routeOn ? chip(route) : "off",
        transmit: "sent",
      },
    }));
    if (l.routeOn) await stream($, "route", `${chip(route)}: ${route.reason}`);
    if (route.source === "rule" && route.model === cfg.strong)
      await csoAdd($, "clinical-prompt", "(prompt)", text.slice(0, 160));
    const notes = await shared($, (b) => {
      const mine = b.notes.filter((n) => n.line === ctx.line);
      b.notes = b.notes.filter((n) => n.line !== ctx.line || n.pinned);
      return mine;
    });
    const context = notes.map(
      (n) =>
        `MedSync ${n.pinned ? "pinned note" : "note"}${n.from !== ctx.line ? ` from Line ${n.from}` : ""}: ${n.text}`,
    );
    return next(context.length ? { ...e, context: [...(e.context ?? []), ...context] } : e);
  });

  // ── tool calls: line checks ──────────────────────────────────────────

  on("tool.call", { tool: ["Edit", "Write", "NotebookEdit", "Bash"] }, async ($, e, next) => {
    const agent = e.agentId ?? "lead";
    if (e.tool === "Edit" || e.tool === "Write" || e.tool === "NotebookEdit") {
      const path = e.tool === "NotebookEdit" ? e.notebook_path : e.file_path;
      const file = g.rel(path, ctx.root);
      const before = await $.fs.read(path).catch(() => "");
      const after =
        e.tool === "Write" ? e.content : e.tool === "Edit" ? e.new_string : e.new_source;
      const added = g.addedLines(e.tool === "Edit" ? e.old_string : before, after);

      const phi = g.findPhi(added.join("\n"));
      if (phi.length) {
        await counted(
          $,
          "phi",
          "guard",
          `Patient data in ${file}: ${phi.map((p) => p.why).join(", ")}`,
        );
        const pick = await hold($, next.signal, {
          kind: "guard",
          what: `Patient data in ${file}`,
          why: phi.map((p) => `${p.why}: ${p.line}`).join("; "),
          options: ["Use synthetic data", "Cancel", "Override (logged)"],
        });
        if (pick === "Override (logged)")
          await csoAdd($, "phi-override", file, `Patient-data override by ${ctx.user}`);
        else
          return {
            deny: `MedSync: real-looking patient data in ${file} (${phi.map((p) => p.line).join(", ")}). ${pick === "Cancel" ? "The user cancelled this edit." : `Use clearly synthetic data instead, e.g. phone ${g.SYNTHETIC.phone}, NIN ${g.SYNTHETIC.nin}, "${g.SYNTHETIC.name}", DOB ${g.SYNTHETIC.dob}.`}`,
          };
      }

      if (g.under(path, ctx.root, cfg.emergency)) {
        const found = g.scanEmergency(added);
        if (found.length) {
          await counted(
            $,
            "emergency",
            "guard",
            `Emergency screen ${file}: ${found.length} line(s)`,
          );
          const pick = await hold($, next.signal, {
            kind: "guard",
            what: `Emergency screen ${file}: not signposting only`,
            why: found.map((f) => `"${f.line}" (${f.why})`).join("; "),
            options: ["Cancel", "Rewrite as signposting only", "Override (log to CSO)"],
          });
          if (pick === "Override (log to CSO)")
            await csoAdd(
              $,
              "override",
              file,
              `Emergency-screen override by ${ctx.user}: ${found.map((f) => f.line).join(" | ")}`.slice(
                0,
                300,
              ),
            );
          else
            return {
              deny:
                pick === "Rewrite as signposting only"
                  ? `MedSync: the emergency screen is signposting only (where to go, whom to call). Rewrite without questions, symptom lists or severity words, then try again. Lines: ${found.map((f) => `"${f.line}" (${f.why})`).join("; ")}`
                  : "MedSync: the user cancelled this edit to the emergency screen.",
            };
        }
      }

      const lockDeny = await lockOrHold($, next.signal, [file], agent);
      if (lockDeny) return { deny: lockDeny };

      const ran = await next(e);
      if (ran.deny !== undefined || ran.isError) return ran;
      changedThisTurn.add(file);
      const patch =
        (ran.result as { structuredPatch?: { lines: string[] }[] } | undefined)?.structuredPatch ??
        [];
      const add =
        patch.flatMap((h) => h.lines).filter((x) => x.startsWith("+")).length || added.length;
      const del = patch.flatMap((h) => h.lines).filter((x) => x.startsWith("-")).length;
      await local($, (l) => ({
        ...l,
        files: {
          ...l.files,
          [file]: { add: (l.files[file]?.add ?? 0) + add, del: (l.files[file]?.del ?? 0) + del },
        },
      }));
      await stream($, "edit", `${e.tool} ${file} +${add} −${del}`);

      const catalogue = `${cfg.i18nDir}/${cfg.source}.json`;
      if (file === catalogue || g.under(path, ctx.root, cfg.copy))
        await csoAdd($, file === catalogue ? "i18n" : "copy", file, `+${add} −${del} lines`);
      if (file.startsWith(cfg.i18nDir + "/") && file.endsWith(".json")) {
        const now = await $.fs.read(path).catch(() => "");
        const keys = g.changedKeys(before, now);
        if (keys.length && file === catalogue) {
          const langs = await languages($);
          await shared($, (b, at) => {
            for (const key of keys) b.stale[key] = { key, langs, at, line: ctx.line };
            b.checks.translations = (b.checks.translations ?? 0) + keys.length;
          });
          if (langs.length)
            await stream($, "i18n", `${keys.length} key(s) stale in ${langs.join(", ")}`);
        } else if (keys.length) {
          const lang = file.slice(cfg.i18nDir.length + 1, -5);
          await shared($, (b) => {
            for (const key of keys) {
              const s = b.stale[key];
              if (s) s.langs = s.langs.filter((x) => x !== lang);
              if (s && !s.langs.length) delete b.stale[key];
            }
          });
        }
      }
      if (file.endsWith("package.json")) {
        const deps = g.depsAdded(before, await $.fs.read(path).catch(() => ""));
        if (deps.length) await noteDeps($, deps);
      }
      return ran;
    }

    if (e.tool === "Bash") {
      const cmd = e.command;
      const phi = g.findPhi(cmd);
      if (phi.length) {
        await counted(
          $,
          "phi",
          "guard",
          `Patient data in a shell command: ${phi.map((p) => p.why).join(", ")}`,
        );
        const pick = await hold($, next.signal, {
          kind: "guard",
          what: "Patient data in a shell command",
          why: phi.map((p) => `${p.why}: ${p.line}`).join("; "),
          options: ["Use synthetic data", "Cancel"],
        });
        return {
          deny: `MedSync: real-looking patient data in the command. ${pick === "Cancel" ? "Cancelled by the user." : `Use synthetic data (${g.SYNTHETIC.phone}, ${g.SYNTHETIC.nin}).`}`,
        };
      }
      const danger = g.destructive(cmd);
      if (danger) {
        await counted($, "destructive", "guard", `${danger}: ${cmd.slice(0, 120)}`);
        const preview = await previewDanger($, danger, cmd);
        const pick = await hold($, next.signal, {
          kind: "guard",
          what: `Destructive command (${danger})`,
          why: `${cmd.slice(0, 200)} → ${preview}`,
          options: ["Proceed", "Cancel"],
        });
        if (pick !== "Proceed")
          return {
            deny: `MedSync: ${danger} was not run (${pick === "Cancel" ? "cancelled by the user" : "no answer"}). Would change: ${preview}`,
          };
        await stream($, "override", `${ctx.user} allowed ${danger}`);
      }
      const op = g.gitOp(cmd);
      if (op) {
        const held = otherHolds(await readBoard($, ctx.dir));
        if (held.length) {
          const who = [...new Set(held.map((h) => h.line))].map((x) => `Line ${x}`).join(", ");
          await counted(
            $,
            "coordination",
            "git",
            `${op} held: ${who} holds ${held.length} file(s)`,
          );
          const pick = await hold($, next.signal, {
            kind: "git",
            what: `${op} held while ${who} is editing`,
            why: `${who} holds ${held
              .map((h) => h.file)
              .slice(0, 4)
              .join(", ")}`,
            options: ["Wait", "Override"],
          });
          if (pick === "Wait") {
            if (!(await waitFor($, next.signal, (b) => otherHolds(b).length === 0)))
              return { deny: `MedSync: ${op} waited; the other line still holds files.` };
          } else if (pick !== "Override")
            return { deny: `MedSync: ${op} not run while ${who} holds files.` };
          else await stream($, "override", `${ctx.user} ran ${op} over the other line's locks`);
        }
      }
      const lockDeny = await lockOrHold(
        $,
        next.signal,
        g.bashWriteTargets(cmd).map((f) => g.rel(f, ctx.root)),
        agent,
      );
      if (lockDeny) return { deny: lockDeny };
      const ran = await next(e);
      const pkgs = g.installedPackages(cmd);
      if (pkgs.length && ran.deny === undefined) await noteDeps($, pkgs);
      const testCmd = cfg.testCommand.replace(/^npm run /, "");
      if (
        ran.deny === undefined &&
        (cmd.includes(cfg.testCommand) ||
          /\bvitest\b/.test(cmd) ||
          cmd.includes(`npm run ${testCmd}`))
      ) {
        const out = (ran.result as { stdout?: string; stderr?: string } | undefined) ?? {};
        await recordTests($, `${out.stdout ?? ""}${out.stderr ?? ""}`, ran.isError ? 1 : 0);
      }
      return ran;
    }
    return next(e);
  }).catch(($, e, next) =>
    next.called
      ? next(e)
      : {
          deny: `MedSync: a line check failed (${next.error.kind}). Retry, or start claude --safe-mode to bypass the mod.`,
        },
  );

  // ── tool calls: tasks, agents, needs, the request tool ───────────────

  on("tool.call", async ($, e, next) => {
    const name = String(e.tool);
    if (name === `mcp__${$.plugin.name}__${TOOL}`) {
      const args = e as unknown as { what?: string; why?: string; blocking?: boolean };
      const what = String(args.what ?? "Input needed");
      const why = String(args.why ?? "");
      if (!args.blocking) {
        await shared(
          $,
          (b, at) =>
            void b.needs.push({
              id: Math.random().toString(36).slice(2, 10),
              line: ctx.line,
              kind: "request",
              what,
              why,
              blocking: false,
              options: ["Done", "Dismiss"],
              at,
            }),
        );
        return {
          result: 'Queued under "Needs you" in the MedSync console. Continue with other work.',
        };
      }
      const pick = await hold($, next.signal, {
        kind: "request",
        what,
        why,
        options: ["Done", "Not now"],
      });
      const reply = (await read($, viewRef)).compose.trim();
      return {
        result: pick
          ? `The user answered: ${pick}${reply ? `. Their note: ${reply}` : ""}`
          : "No answer from the user (not interactive or timed out).",
      };
    }

    if (
      !(name === "AskUserQuestion" || name === "TaskCreate" || name === "TaskUpdate" || e.agentId)
    ) {
      const ran = await next(e);
      // a permission dialog for this call has been answered once the call returns
      if (permIds.delete(e.tool_use_id))
        await shared(
          $,
          (b) => void (b.needs = b.needs.filter((n) => n.id !== `perm:${e.tool_use_id}`)),
        );
      return ran;
    }

    if (e.agentId)
      await local($, (l) => ({
        ...l,
        agents: l.agents.map((a) =>
          a.id === e.agentId
            ? {
                ...a,
                tools: a.tools + 1,
                now: name,
                files:
                  "file_path" in e && typeof e.file_path === "string"
                    ? [...new Set([...a.files, g.rel(e.file_path, ctx.root)])].slice(-8)
                    : a.files,
              }
            : a,
        ),
      }));

    if (e.tool === "AskUserQuestion") {
      const id = `ask:${e.tool_use_id}`;
      await shared(
        $,
        (b, at) =>
          void b.needs.push({
            id,
            line: ctx.line,
            kind: "ask",
            what: e.questions[0]?.question ?? "Claude has a question",
            why: "Answer in the dialog",
            blocking: true,
            options: [],
            at,
          }),
      );
      $.ui.toast("Claude has a question for you");
      if (cfg.sound) $.audio.play({ asset: "assets/ping.wav" }).catch(() => undefined);
      try {
        return await next(e);
      } finally {
        await shared($, (b) => void (b.needs = b.needs.filter((n) => n.id !== id)));
      }
    }

    const ran = await next(e);
    if (ran.deny !== undefined || ran.isError) return ran;
    if (e.tool === "TaskCreate") {
      const id =
        (ran.result as { task?: { id?: string } } | undefined)?.task?.id ??
        String(Math.random()).slice(2, 6);
      await shared($, (b, at) => {
        b.tasks.push({
          id: `${ctx.line}:${id}`,
          line: ctx.line,
          agent: e.agentId ?? "lead",
          subject: e.subject,
          status: "pending",
          blockedBy: [],
        });
        b.stream.push({ at, line: ctx.line, kind: "task", text: `+ ${e.subject}` });
      });
    } else if (e.tool === "TaskUpdate") {
      await shared($, (b, at) => {
        const key = `${ctx.line}:${e.taskId}`;
        const t = b.tasks.find((x) => x.id === key);
        if (!t) return;
        if (e.status === "deleted") b.tasks = b.tasks.filter((x) => x !== t);
        else if (e.status) t.status = e.status;
        if (e.subject) t.subject = e.subject;
        if (e.owner) t.agent = e.owner;
        if (e.addBlockedBy)
          t.blockedBy = [
            ...new Set([...t.blockedBy, ...e.addBlockedBy.map((x) => `${ctx.line}:${x}`)]),
          ];
        b.stream.push({
          at,
          line: ctx.line,
          kind: "task",
          text: `${e.status ?? "updated"}: ${t.subject}`,
        });
      });
    }
    return ran;
  });

  on("tool.check", async ($, e, next) => {
    const verdict = await next(e);
    if (verdict.decision === "ask" && e.tool_use_id) {
      const id = `perm:${e.tool_use_id}`;
      await shared($, (b, at) => {
        if (!b.needs.some((n) => n.id === id))
          b.needs.push({
            id,
            line: ctx.line,
            kind: "permission",
            what: `Allow ${e.tool}?`,
            why: verdict.reason ?? "Answer in the permission dialog",
            blocking: true,
            options: [],
            at,
          });
      });
      permIds.add(e.tool_use_id);
    }
    return verdict;
  });

  on("agent.spawn", async ($, e, next) => {
    const l = await read($, localRef);
    let model = e.model;
    let effort = "medium";
    if (l.routeOn) {
      const fast = g.fastRoute(e.prompt, cfg.clinical);
      const label = fast
        ? null
        : await $.model
            .classify(e.prompt.slice(0, 4000), ["small", "medium", "large", "clinical"], {
              model: cfg.fast,
            })
            .catch(() => undefined);
      const tier =
        fast?.tier ??
        (label === "clinical" || label === "large"
          ? "strong"
          : label === "small"
            ? "fast"
            : label === "medium"
              ? "mid"
              : null);
      if (tier) {
        model = tierModel()[tier];
        effort = effortOf[tier];
      }
    }
    const now = await $.clock.now();
    const temp = `q:${e.tool_use_id}`;
    const agent: Agent = {
      id: temp,
      name: e.name ?? e.description,
      model: model ?? e.parentModel,
      status: "queued",
      startedAt: now,
      endedAt: 0,
      tools: 0,
      msgs: 0,
      files: [],
      now: "",
    };
    await local($, (x) => ({
      ...x,
      agents: [
        ...x.agents.filter((a) => a.status !== "done" || now - a.endedAt < 600_000),
        agent,
      ].slice(-12),
    }));
    const r = await next(model && model !== e.model ? { ...e, model } : e);
    const id = r.agentId ?? r.teammateId;
    if (id && model) agentRoutes.set(id, { model, effort });
    await local($, (x) => ({
      ...x,
      agents: x.agents.map((a) =>
        a.id === temp
          ? {
              ...a,
              id: id ?? temp,
              model: r.model ?? a.model,
              status: r.deny ? "failed" : "running",
            }
          : a,
      ),
    }));
    await stream($, "agent", `${agent.name} on ${r.model ?? model ?? "?"}`);
    await syncAgents($);
    return r;
  });

  // ── commands ─────────────────────────────────────────────────────────

  on("command.run", { command: "dash" }, async ($) => {
    const isUp = (await $.ui.panes()).some((p) => p.id === PANE);
    if (isUp) {
      await $.ui.close({ id: PANE });
      return { text: "Console closed." };
    }
    const opened = await $.ui.open({ id: PANE, title: "MedSync" });
    return {
      text: opened.isPlaced
        ? "Console opened."
        : `Console waiting: ${opened.reason}. The summary stays above the prompt.`,
    };
  });

  on("command.run", { command: "cso" }, async ($, e) => {
    const [verb, arg] = e.args.trim().split(/\s+/);
    if (verb === "done") {
      const n = Number(arg);
      const ok = await shared($, (b) => {
        const item = b.cso.find((x) => x.n === n);
        if (item) item.done = true;
        return !!item;
      });
      return { text: ok ? `CSO item ${n} cleared.` : `No CSO item ${n}.` };
    }
    const b = await readBoard($, ctx.dir);
    const row = (x: Board["cso"][number]) =>
      `${x.n}. [${x.line}] ${new Date(x.at).toISOString().slice(0, 16).replace("T", " ")} ${x.kind} ${x.file}: ${x.summary} (${x.by})`;
    if (verb === "export") {
      const open = b.cso.filter((x) => !x.done);
      const done = b.cso.filter((x) => x.done);
      const md = [
        "# CSO review queue",
        "",
        `Exported ${new Date().toISOString().slice(0, 10)} by ${ctx.user}. Patient-facing copy changes, i18n catalogue changes, clinical prompts and guard overrides awaiting the Clinical Safety Officer.`,
        "",
        `## Open (${open.length})`,
        "",
        ...open.map((x) => `- ${row(x)}`),
        "",
        `## Cleared (${done.length})`,
        "",
        ...done.map((x) => `- ${row(x)}`),
        "",
      ].join("\n");
      await $.fs.write(`${ctx.root}/CSO_REVIEW.md`, md);
      return { text: `Wrote CSO_REVIEW.md (${open.length} open, ${done.length} cleared).` };
    }
    const open = b.cso.filter((x) => !x.done);
    return {
      text: open.length
        ? `CSO queue (${open.length} open):\n${open.map(row).join("\n")}\n\n/cso done <n> clears one; /cso export writes CSO_REVIEW.md.`
        : "CSO queue is empty.",
    };
  });

  on("command.run", { command: "translations" }, async ($) => {
    const b = await readBoard($, ctx.dir);
    const langs = await languages($);
    const src = g.changedKeys(
      "{}",
      await $.fs.read(`${ctx.root}/${cfg.i18nDir}/${cfg.source}.json`).catch(() => "{}"),
    );
    const missing: string[] = [];
    for (const lang of langs) {
      const have = g.changedKeys(
        "{}",
        await $.fs.read(`${ctx.root}/${cfg.i18nDir}/${lang}.json`).catch(() => "{}"),
      );
      const gap = src.filter((k) => !have.includes(k));
      if (gap.length)
        missing.push(
          `${lang}: ${gap.length} missing (${gap.slice(0, 8).join(", ")}${gap.length > 8 ? ", …" : ""})`,
        );
    }
    const stale = Object.values(b.stale);
    return {
      text: [
        `Catalogue: ${cfg.i18nDir}/${cfg.source}.json (${src.length} keys). Languages: ${langs.join(", ") || `none besides ${cfg.source}; set "languages" in the plugin config`}.`,
        stale.length
          ? `Stale (${stale.length}):\n${stale.map((s) => `  ${s.key} → ${s.langs.join(", ") || "—"} [Line ${s.line}]`).join("\n")}`
          : "Stale: none.",
        missing.length ? `Missing:\n  ${missing.join("\n  ")}` : "Missing: none.",
        "These translations are not clinically reviewed.",
      ].join("\n"),
    };
  });

  on("command.run", { command: "route" }, async ($, e) => {
    const [verb, model, effort] = e.args.trim().split(/\s+/);
    if (verb === "off" || verb === "on") {
      await local($, (l) => ({ ...l, routeOn: verb === "on" }));
      return { text: `Routing ${verb}.` };
    }
    if (verb === "lock") {
      const models = [cfg.strong, cfg.mid, cfg.fast, "fable", "opus", "sonnet", "haiku"];
      const efforts = ["low", "medium", "high", "xhigh", "max"];
      if (!model || !models.includes(model) || !effort || !efforts.includes(effort))
        return {
          text: `Usage: /route lock <${[...new Set(models)].join("|")}> <${efforts.join("|")}>`,
        };
      await local($, (l) => ({ ...l, routeLock: { model, effort } }));
      return { text: `Routing locked to ${model} at ${effort} for this session.` };
    }
    const l = await read($, localRef);
    const r = l.route;
    return {
      text: r
        ? `Last: ${r.model} · ${r.effort} (${r.source}, confidence ${Math.round(r.confidence * 100)}%): ${r.reason}${r.signals.length ? ` [${r.signals.join(", ")}]` : ""}. Routing ${l.routeOn ? "on" : "off"}${l.routeLock ? `, locked to ${l.routeLock.model}·${l.routeLock.effort}` : ""}.`
        : `No routing decision yet. Routing ${l.routeOn ? "on" : "off"}.`,
    };
  });

  // /review is a built-in (pull-request review): answer only our forms, pass the rest on.
  on("command.run", { command: "review" }, async ($, e, next) => {
    const [verb, n] = e.args.trim().split(/\s+/);
    if (verb === "off" || verb === "on") {
      await local($, (l) => ({ ...l, reviewOn: verb === "on" }));
      return { text: `Prompt review ${verb}.` };
    }
    if (verb === "threshold" && Number.isFinite(Number(n))) {
      const t = Math.max(0, Math.min(100, Number(n)));
      await local($, (l) => ({ ...l, threshold: t }));
      return { text: `Prompt review threshold: ${t}.` };
    }
    return next(e);
  }).catch(($, e, next) => next(e));

  on("command.run", { command: "line" }, async ($, e) => {
    const [verb, ...rest] = e.args.trim().split(/\s+/);
    if (verb === "name" && rest.length) {
      const label = rest.join(" ").slice(0, 24);
      await shared($, (b) => void (b.lines[ctx.line] && (b.lines[ctx.line]!.label = label)));
      return { text: `This line is now "${label}".` };
    }
    if (verb === "worktree") {
      const base = await git($, "branch --show-current");
      const path = `${ctx.root}-line-${ctx.line.toLowerCase()}`;
      const branch = `line/${ctx.line.toLowerCase()}-${Date.now().toString(36)}`;
      const r = await sh($, `git worktree add ${q(path)} -b ${branch}`);
      if (r.exitCode !== 0) return { text: `git worktree add failed: ${r.stderr.trim()}` };
      await $.store.set(`worktree:${ctx.line}`, { path, branch, base });
      await $.prompt.submit({
        text: `Call EnterWorktree with path ${path} and continue this line's work there (branch ${branch}, from ${base}).`,
      });
      return {
        text: `Created ${path} on ${branch}. Claude will switch into it. When done, /line merge writes a diff to apply on ${base}.`,
      };
    }
    if (verb === "merge") {
      const wt = (await $.store.get(`worktree:${ctx.line}`)) as
        | { path: string; branch: string; base: string }
        | undefined;
      if (!wt) return { text: "This line has no worktree. Start one with /line worktree." };
      const r = await sh(
        $,
        `git -C ${q(wt.path)} add -A -N . && git -C ${q(wt.path)} diff ${wt.base}`,
      );
      const out = `${ctx.dir}/line-${ctx.line}.diff`;
      await $.fs.write(out, r.stdout);
      return {
        text: `Diff of ${wt.branch} against ${wt.base}: ${out} (${r.stdout.split("\n").length} lines). Apply in the main checkout with: git apply ${out}`,
      };
    }
    const b = await readBoard($, ctx.dir);
    const lines = Object.values(b.lines).map((l) => {
      const locks = Object.values(b.locks).filter((x) => x.line === l.id);
      return `${l.id === ctx.line ? "▶" : " "} ${l.id} "${l.label}" ${l.status}${l.branch ? ` on ${l.branch}` : ""}${l.task ? ` — ${l.task}` : ""}${
        locks.length
          ? ` · ${locks.length} lock(s): ${locks
              .map((x) => x.file)
              .slice(0, 3)
              .join(", ")}`
          : ""
      }`;
    });
    return {
      text: `${lines.join("\n") || "No lines."}\n\n/line name <label> · /line worktree · /line merge`,
    };
  });

  on("command.run", { command: "tell" }, async ($, e) => {
    const m = e.args.trim().match(/^(\S+)\s+([\s\S]+)$/);
    if (!m) return { text: "Usage: /tell <A|B> <message>" };
    return { text: await tellLine($, m[1]!, m[2]!) };
  });

  // ── drawing ──────────────────────────────────────────────────────────

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const data = {
      board: await read($, boardRef),
      local: await read($, localRef),
      view: await read($, viewRef),
      now: Date.now(),
      line: ctx.line,
    };
    return renderPane($, e, data, actions($));
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e);
    const data = {
      board: await read($, boardRef),
      local: await read($, localRef),
      view: await read($, viewRef),
      now: Date.now(),
      line: ctx.line,
    };
    const isPaneShown = (await $.ui.panes()).some((p) => p.id === PANE && p.isPlaced);
    const tree = renderBand($, e, data, actions($), isPaneShown);
    return tree ?? next(e);
  });
};
