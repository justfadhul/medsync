import type { Agent, Board, Local, View } from "../types";
import type { EngineInterface, RenderElement, RenderInput } from "claude-code";

export type Actions = {
  decide: (id: string, option: string) => Promise<void>;
  view: (patch: Partial<View>) => Promise<unknown>;
  toggle: (key: string) => Promise<void>;
  send: (kind: "main" | "improved" | "mine" | "edit") => Promise<void>;
  removeNote: (id: string) => Promise<void>;
  pause: () => Promise<void>;
  tests: () => Promise<void>;
  diff: () => Promise<void>;
  checkpoint: () => Promise<void>;
  compact: () => Promise<void>;
  override: (model: string, effort: string) => Promise<void>;
  lockSession: () => Promise<void>;
  select: (id: string) => Promise<unknown>;
  message: (id: string) => Promise<void>;
  pauseAgent: (id: string) => Promise<void>;
  logAgent: (id: string) => Promise<void>;
  input: (text: string) => Promise<void>;
};

export type Data = { board: Board; local: Local; view: View; now: number; line: string };

const LINE_COLOR: Record<string, string> = {
  A: "#14b8a6",
  B: "#3b82f6",
  C: "#a855f7",
  D: "#f97316",
};
const STATUS_COLOR = {
  running: "#22c55e",
  waiting: "#f59e0b",
  done: "#22c55e",
  failed: "#ef4444",
  queued: "#9ca3af",
} as const;
const lineColor = (id: string) => LINE_COLOR[id] ?? "claude";

const bar = (pct: number, cells = 5) => {
  const on = Math.round((Math.max(0, Math.min(100, pct)) / 100) * cells);
  return "▰".repeat(on) + "▱".repeat(cells - on);
};
const mins = (ms: number) =>
  ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))}s` : `${Math.round(ms / 60_000)}m`;
const initials = (name: string) =>
  name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const taskCounts = (b: Board, line?: string) => {
  const ts = b.tasks.filter((t) => !line || t.line === line);
  return {
    done: ts.filter((t) => t.status === "completed").length,
    doing: ts.filter((t) => t.status === "in_progress").length,
    total: ts.length,
  };
};
const agentPct = (b: Board, line: string, a: Agent) => {
  const mine = b.tasks.filter((t) => t.line === line && (t.agent === a.name || t.agent === a.id));
  if (mine.length)
    return Math.round((mine.filter((t) => t.status === "completed").length / mine.length) * 100);
  return a.status === "done" ? 100 : a.status === "queued" ? 0 : 50;
};

export const summaryLine = (l: Local, b: Board) => {
  const t = taskCounts(b);
  const needs = b.needs.filter((n) => n.line === l.line).length;
  const running = l.agents.filter((a) => a.status === "running" || a.status === "queued").length;
  return `Line ${l.line} · ${running} agent${running === 1 ? "" : "s"} · tasks ${t.done}/${t.total} · needs ${needs}${l.route ? ` · ${l.route.model}·${l.route.effort}` : ""}`;
};

// ── the orbit (desktop SVG) ───────────────────────────────────────────

const orbitSvg = (b: Board, line: string, agents: Agent[], selected: string) => {
  const W = 320;
  const c = W / 2;
  const ring = (cx: number, cy: number, r: number, pct: number, color: string) => {
    const len = 2 * Math.PI * r;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#9ca3af33" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="3" stroke-dasharray="${(len * pct) / 100} ${len}" transform="rotate(-90 ${cx} ${cy})"/>`;
  };
  const lead = taskCounts(b, line);
  const leadPct = lead.total ? Math.round((lead.done / lead.total) * 100) : 0;
  const pos = agents.map((a, i) => {
    const angle = (i / Math.max(1, agents.length)) * 2 * Math.PI - Math.PI / 2;
    return { a, x: c + Math.cos(angle) * 112, y: c + Math.sin(angle) * 112 };
  });
  const links = pos
    .map(({ a, x, y }) => {
      const live = a.status === "running";
      const anim = live
        ? `<animate attributeName="stroke-dashoffset" from="12" to="0" dur="0.8s" repeatCount="indefinite"/>`
        : "";
      return `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" stroke="${live ? lineColor(line) : "#9ca3af"}" stroke-width="1.5" ${live ? 'stroke-dasharray="6 6"' : ""}>${anim}</line><text x="${(c + x) / 2}" y="${(c + y) / 2 - 4}" font-size="10" fill="#6b7280" text-anchor="middle">⇄${a.tools + a.msgs}</text>`;
    })
    .join("");
  const waits = b.tasks
    .filter((t) => t.line === line && t.blockedBy.length)
    .flatMap((t) =>
      t.blockedBy.map((id) => {
        const from = pos.find((p) => p.a.name === t.agent || p.a.id === t.agent);
        const blocker = b.tasks.find((x) => x.id === id);
        const to =
          blocker && pos.find((p) => p.a.name === blocker.agent || p.a.id === blocker.agent);
        return from && to && from !== to
          ? `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#arrow)"/>`
          : "";
      }),
    )
    .join("");
  const nodes = pos
    .map(({ a, x, y }) => {
      const pct = agentPct(b, line, a);
      const queued = a.status === "queued";
      const dot = STATUS_COLOR[a.status];
      const pulse =
        a.status === "running"
          ? `<animate attributeName="opacity" values="1;0.3;1" dur="1.4s" repeatCount="indefinite"/>`
          : "";
      return `<g opacity="${queued ? 0.45 : 1}"><circle cx="${x}" cy="${y}" r="17" fill="${a.id === selected ? "#9ca3af33" : "#9ca3af14"}" stroke="#9ca3af" ${queued ? 'stroke-dasharray="3 3"' : 'stroke-opacity="0.4"'}/>${queued ? "" : ring(x, y, 21, pct, dot)}<text x="${x}" y="${y + 4}" font-size="11" font-weight="600" text-anchor="middle" fill="#6b7280">${esc(initials(a.name))}</text><circle cx="${x + 14}" cy="${y - 14}" r="4" fill="${dot}">${pulse}</circle><text x="${x}" y="${y + 34}" font-size="9" text-anchor="middle" fill="#6b7280">${esc(a.name.slice(0, 16))} · ${esc(a.model.slice(0, 10))} · ${pct}%</text></g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}" width="${W}" height="${W}" font-family="system-ui, sans-serif"><defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#f59e0b"/></marker></defs><circle cx="${c}" cy="${c}" r="112" fill="none" stroke="#9ca3af33" stroke-dasharray="2 4"/>${links}${waits}<circle cx="${c}" cy="${c}" r="26" fill="${lineColor(line)}22" stroke="${lineColor(line)}"/>${ring(c, c, 31, leadPct, lineColor(line))}<text x="${c}" y="${c + 4}" font-size="12" font-weight="700" text-anchor="middle" fill="${lineColor(line)}">${esc(line)}</text><text x="${c}" y="${c + 48}" font-size="9" text-anchor="middle" fill="#6b7280">lead · ${leadPct}%</text>${nodes}</svg>`;
};

// ── the pane ──────────────────────────────────────────────────────────

export function renderPane(
  $: EngineInterface,
  e: RenderInput<"Pane">,
  d: Data,
  a: Actions,
): RenderElement {
  const els = $.ui.resolve(e);
  const { Box, Text, Button } = els;
  const Input = "Input" in els ? els.Input : undefined;
  const Svg = e.surface === "desktop" && "Svg" in els ? els.Svg : undefined;
  const { board: b, local: l, view: v, now } = d;
  const wide = e.props.bodyColumns >= 120;
  const lines = Object.values(b.lines).filter((x) => x.status !== "offline");
  const shownLine = v.view !== "both" && b.lines[v.view] ? v.view : d.line;
  const inView = (line: string) => v.view === "both" || v.view === line;
  const badge = (line: string) => (
    <Text color={lineColor(line)} bold>
      {line}
    </Text>
  );
  const head = (label: string) => (
    <Text bold dimColor>
      {label}
    </Text>
  );
  const fold = (key: string, title: string, summary: string, body: () => RenderElement) => (
    <Box flexDirection="column">
      <Button key={`fold:${key}`} plain onPress={() => void a.toggle(key)}>
        {v.open[key] ? "▾ " : "▸ "}
        {title} <Text dimColor>{summary}</Text>
      </Button>
      {v.open[key] ? body() : null}
    </Box>
  );
  const t = taskCounts(b);
  const myNeeds = b.needs.filter((n) => inView(n.line));

  // top bar
  const top = (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Text bold>MedSync</Text>
        <Text dimColor>⎇ {l.branch || "—"}</Text>
        {["both", ...lines.map((x) => x.id)].map((id) => (
          <Button
            key={`view:${id}`}
            plain
            variant={v.view === id ? "primary" : undefined}
            onPress={() => void a.view({ view: id })}
          >
            {v.view === id ? `[${id === "both" ? "Both" : id}]` : id === "both" ? "Both" : id}
          </Button>
        ))}
        <Text dimColor>
          ctx {bar(l.usage.context ?? 0)} {l.usage.context ?? "—"}% · plan {bar(l.usage.plan ?? 0)}{" "}
          {l.usage.plan ?? "—"}% · tasks {t.done}/{t.total} · tests{" "}
          {l.tests.isRunning
            ? "…"
            : `${l.tests.passed}✓${l.tests.failed ? ` ${l.tests.failed}✗` : ""}`}{" "}
          · turn {l.turns}
          {l.turn ? ` (${mins(now - l.turn.startedAt)})` : ""} · {mins(now - (l.startedAt || now))}
        </Text>
      </Box>
      <Box flexDirection="row" columnGap={1}>
        <Button key="act:pause" label="Pause" onPress={() => void a.pause()} />
        <Button key="act:tests" label="Tests" onPress={() => void a.tests()} />
        <Button key="act:diff" label="Diff" onPress={() => void a.diff()} />
        <Button key="act:checkpoint" label="Checkpoint" onPress={() => void a.checkpoint()} />
        <Button key="act:compact" label="Compact" onPress={() => void a.compact()} />
      </Box>
    </Box>
  );

  // column 1: transmit
  const review = l.review;
  const isHeld = !!review?.isHeld;
  const transmit = (
    <Box flexDirection="column" flexGrow={1} minWidth={30}>
      {head("TRANSMIT  you → Claude")}
      <Box flexDirection="row" columnGap={1}>
        {(["prompt", "note", "pin"] as const).map((m) => (
          <Button
            key={`mode:${m}`}
            plain
            variant={v.mode === m ? "primary" : undefined}
            onPress={() => void a.view({ mode: m })}
          >
            {v.mode === m
              ? `[${m[0]!.toUpperCase() + m.slice(1)}]`
              : m[0]!.toUpperCase() + m.slice(1)}
          </Button>
        ))}
        <Text dimColor>send on</Text>
        {lines.map((x) => (
          <Button
            key={`on:${x.id}`}
            plain
            variant={(v.sendOn || d.line) === x.id ? "primary" : undefined}
            onPress={() => void a.view({ sendOn: x.id })}
          >
            {(v.sendOn || d.line) === x.id ? `[${x.id}]` : x.id}
          </Button>
        ))}
      </Box>
      {Input ? (
        <Input
          key="compose"
          placeholder={
            v.mode === "prompt"
              ? "Prompt Claude…"
              : v.mode === "note"
                ? "Note for the next turn…"
                : "Pin to every turn…"
          }
          value={v.compose}
          submitLabel={isHeld ? "Send improved" : "Send"}
          onInput={(text) => void a.input(text)}
          onSubmit={() => void a.send(isHeld ? "improved" : "main")}
        />
      ) : null}
      <Text>
        <Text dimColor>review</Text> {l.pipeline.review} <Text dimColor>› route</Text>{" "}
        {l.pipeline.route} <Text dimColor>› transmit</Text> {l.pipeline.transmit}
      </Text>
      {l.hints.map((h, i) => (
        <Text key={`hint${i}`} color="warning">
          · {h}
        </Text>
      ))}
      <Box flexDirection="row" columnGap={1}>
        {isHeld ? (
          <Box flexDirection="row" columnGap={1}>
            <Button
              key="send:improved"
              variant="primary"
              label="Send improved"
              onPress={() => void a.send("improved")}
            />
            {review!.phi.length ? (
              <Text dimColor>[ Send mine: patient data ]</Text>
            ) : (
              <Button key="send:mine" label="Send mine" onPress={() => void a.send("mine")} />
            )}
            <Button key="send:edit" label="Edit improved" onPress={() => void a.send("edit")} />
          </Box>
        ) : (
          <Button
            key="send:main"
            variant="primary"
            label={v.mode === "prompt" ? "Send" : v.mode === "note" ? "Queue note" : "Pin"}
            onPress={() => void a.send("main")}
          />
        )}
      </Box>
      {fold(
        "review",
        "Review",
        review ? `${review.score}/100${review.isHeld ? " held" : ""}` : "nothing held",
        () => (
          <Box flexDirection="column" paddingLeft={2}>
            {review ? (
              <Box flexDirection="column">
                {review.checklist.map((c) => (
                  <Text key={`ck:${c.label}`}>
                    {c.ok ? "✓" : "✗"} {c.label}
                  </Text>
                ))}
                {review.issues.map((x, i) => (
                  <Text key={`is${i}`} color="warning">
                    ! {x}
                  </Text>
                ))}
                {review.questions.map((x, i) => (
                  <Text key={`q${i}`} dimColor>
                    ? {x}
                  </Text>
                ))}
                <Text>Improved (additions in [+ ]):</Text>
                <Text color="suggestion">{review.improved}</Text>
              </Box>
            ) : (
              <Text dimColor>Prompts at or over {l.threshold} pass unchanged.</Text>
            )}
          </Box>
        ),
      )}
      {fold(
        "routing",
        "Routing",
        l.routeOn
          ? l.route
            ? `${l.route.model}·${l.route.effort} ${l.route.source}`
            : "no decision yet"
          : "off",
        () => (
          <Box flexDirection="column" paddingLeft={2}>
            {l.route ? (
              <Box flexDirection="column">
                <Text>
                  {l.route.model} · {l.route.effort}{" "}
                  <Text dimColor>
                    ({l.route.source}, {Math.round(l.route.confidence * 100)}%)
                  </Text>
                </Text>
                <Text dimColor>{l.route.reason}</Text>
                {l.route.signals.length ? (
                  <Text dimColor>{l.route.signals.join(" · ")}</Text>
                ) : null}
                <Box flexDirection="row" columnGap={1} flexWrap="wrap">
                  {[
                    ["fable", "high"],
                    ["opus", "high"],
                    ["sonnet", "medium"],
                    ["haiku", "low"],
                  ].map(([m, ef]) => (
                    <Button key={`ov:${m}`} plain onPress={() => void a.override(m!, ef!)}>
                      {m}·{ef}
                    </Button>
                  ))}
                  {(["low", "medium", "high", "xhigh"] as const).map((ef) => (
                    <Button
                      key={`ef:${ef}`}
                      plain
                      onPress={() => void a.override(l.route!.model, ef)}
                    >
                      {ef}
                    </Button>
                  ))}
                  <Button
                    key="ov:lock"
                    plain
                    variant={l.routeLock ? "primary" : undefined}
                    onPress={() => void a.lockSession()}
                  >
                    {l.routeLock ? "[locked for session]" : "lock for session"}
                  </Button>
                </Box>
              </Box>
            ) : null}
            {l.routes.slice(0, 5).map((r, i) => (
              <Text key={`rt${i}`} dimColor>
                {r.model}·{r.effort} {r.source} — {r.text}
              </Text>
            ))}
            <Text dimColor>
              Saved: {l.downRouted} turn(s) ran on the fast model instead of the session model
              (rough).
            </Text>
          </Box>
        ),
      )}
      {head("On the line")}
      {b.notes.filter((n) => inView(n.line)).length === 0 ? (
        <Text dimColor>No notes or pins.</Text>
      ) : null}
      {b.notes
        .filter((n) => inView(n.line))
        .map((n) => (
          <Box key={`note:${n.id}`} flexDirection="row" columnGap={1}>
            {badge(n.line)}
            <Text>{n.pinned ? "📌" : "✉"}</Text>
            <Text wrap="truncate">{n.text}</Text>
            <Button key={`rm:${n.id}`} plain onPress={() => void a.removeNote(n.id)}>
              ✕
            </Button>
          </Box>
        ))}
    </Box>
  );

  // column 2: network
  const agentsOf = (line: string): Agent[] => (line === d.line ? l.agents : (b.agents[line] ?? []));
  const agents = agentsOf(shownLine);
  const sel = agents.find((x) => x.id === v.selected);
  const other = lines.find((x) => x.id !== shownLine);
  const network = (
    <Box flexDirection="column" flexGrow={1} minWidth={30}>
      {head(`NETWORK  Claude ↔ agents · Line ${shownLine}`)}
      {Svg ? (
        <Svg
          source={orbitSvg(b, shownLine, agents, v.selected)}
          alt={`Line ${shownLine}: lead and ${agents.length} agents`}
          width={300}
          height={300}
          isInteractive
        />
      ) : (
        <Box flexDirection="column">
          <Text color={lineColor(shownLine)} bold>
            ◉ {shownLine} lead{" "}
            {bar(
              taskCounts(b, shownLine).total
                ? (taskCounts(b, shownLine).done / taskCounts(b, shownLine).total) * 100
                : 0,
            )}
          </Text>
          {agents.map((x, i) => (
            <Text key={`ag:${x.id}`} dimColor={x.status === "queued"}>
              {i === agents.length - 1 ? "└" : "├"}⇄{x.tools + x.msgs}─ {initials(x.name)}{" "}
              {x.name.slice(0, 18)} <Text color={STATUS_COLOR[x.status]}>●</Text> {x.status}{" "}
              {x.model.slice(0, 10)} {bar(agentPct(b, shownLine, x), 4)}
            </Text>
          ))}
        </Box>
      )}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {agents.map((x) => (
          <Button
            key={`sel:${x.id}`}
            plain
            variant={x.id === v.selected ? "primary" : undefined}
            onPress={() => void a.select(x.id)}
          >
            {initials(x.name)} <Text dimColor>{x.name.slice(0, 14)}</Text>
          </Button>
        ))}
      </Box>
      {other ? (
        <Button key="other-line" plain onPress={() => void a.view({ view: other.id })}>
          <Text color={lineColor(other.id)}>●</Text> {other.label} · {other.status} ·{" "}
          {agentsOf(other.id).filter((x) => x.status === "running").length} agents
          {other.task ? ` · ${other.task.slice(0, 30)}` : ""}
        </Button>
      ) : (
        <Text dimColor>No other line. Open a second terminal: launch-medsync --line "B"</Text>
      )}
      {sel ? (
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Text>
            <Text color={STATUS_COLOR[sel.status]}>●</Text> {sel.name} · {sel.status} · {sel.model}{" "}
            · {agentPct(b, shownLine, sel)}%
          </Text>
          <Text dimColor>
            now {sel.now || "—"} · {sel.tools} tool calls ·{" "}
            {mins((sel.endedAt || now) - sel.startedAt)} · files {sel.files.join(", ") || "—"}
          </Text>
          {b.tasks
            .filter((x) => x.agent === sel.name && x.blockedBy.length)
            .map((x) => (
              <Text key={`blk:${x.id}`} color="warning">
                blocked on {x.blockedBy.join(", ")}
              </Text>
            ))}
          {shownLine === d.line ? (
            <Box flexDirection="row" columnGap={1}>
              <Button key="ag:msg" label="Message" onPress={() => void a.message(sel.id)} />
              <Button key="ag:pause" label="Pause" onPress={() => void a.pauseAgent(sel.id)} />
              <Button key="ag:log" label="Log" onPress={() => void a.logAgent(sel.id)} />
            </Box>
          ) : null}
        </Box>
      ) : null}
      {head("Traffic")}
      {b.traffic.length === 0 ? <Text dimColor>Quiet.</Text> : null}
      {b.traffic
        .slice(-5)
        .reverse()
        .map((x, i) => (
          <Text key={`tr${i}`} wrap="truncate">
            <Text dimColor>
              {x.from}→{x.to}
            </Text>{" "}
            {x.text}
          </Text>
        ))}
    </Box>
  );

  // column 3: receive
  const files = Object.entries(l.files);
  const receive = (
    <Box flexDirection="column" flexGrow={1} minWidth={30}>
      {head("RECEIVE  Claude → you")}
      <Text bold color={myNeeds.length ? "warning" : undefined}>
        Needs you ({myNeeds.length})
      </Text>
      {myNeeds.map((n, i) => (
        <Box key={`need:${n.id}`} flexDirection="column">
          <Text>
            {badge(n.line)} {i + 1}. {n.what}
          </Text>
          <Text dimColor wrap="truncate">
            {n.why}
          </Text>
          {n.options.length && n.line === d.line ? (
            <Box flexDirection="row" columnGap={1} flexWrap="wrap">
              {n.options.map((o, j) => (
                <Button
                  key={`do:${n.id}:${j}`}
                  hotkey={j === 0 && i < 9 ? String(i + 1) : undefined}
                  onPress={() => void a.decide(n.id, o)}
                >
                  {o}
                </Button>
              ))}
            </Box>
          ) : (
            <Text dimColor>
              {n.line === d.line ? "Answer in the dialog" : `Waiting on Line ${n.line}`}
            </Text>
          )}
        </Box>
      ))}
      {head("Stream")}
      {b.stream
        .filter((x) => inView(x.line))
        .slice(-8)
        .reverse()
        .map((x, i) => (
          <Text key={`st${i}`} wrap="truncate">
            {badge(x.line)} <Text dimColor>{x.kind}</Text> {x.text}
          </Text>
        ))}
      {head("Locks")}
      {Object.values(b.locks).length === 0 ? <Text dimColor>None.</Text> : null}
      {Object.values(b.locks).map((k) => (
        <Text key={`lk:${k.file}`} wrap="truncate">
          {badge(k.line)} {k.file}{" "}
          <Text dimColor>
            {k.agent}
            {k.waiting.length ? ` · waiting: ${k.waiting.join(", ")}` : ""}
          </Text>
        </Text>
      ))}
      {head(`Files changed (${files.length})`)}
      {files.slice(-8).map(([f, c]) => (
        <Button key={`f:${f}`} plain onPress={() => void a.diff()}>
          {f} <Text color="diffAdded">+{c.add}</Text> <Text color="diffRemoved">−{c.del}</Text>
        </Button>
      ))}
    </Box>
  );

  // folded rows
  const ck = b.checks;
  const stale = Object.keys(b.stale).length;
  const csoOpen = b.cso.filter((x) => !x.done).length;
  const locks = Object.values(b.locks);
  const waiting = locks.filter((k) => k.waiting.length).length;
  const checks = fold(
    "checks",
    "Line checks",
    `${(ck.emergency ?? 0) + (ck.phi ?? 0) + (ck.destructive ?? 0) + (ck.coordination ?? 0)} holds · CSO ${csoOpen} open · ${stale} stale`,
    () => (
      <Box flexDirection="column" paddingLeft={2}>
        <Text>Emergency screen: {ck.emergency ?? 0} held</Text>
        <Text>
          CSO queue: {csoOpen} open of {b.cso.length} (/cso)
        </Text>
        <Text>Translations: {stale} stale keys, not clinically reviewed (/translations)</Text>
        <Text>Patient data: {ck.phi ?? 0} held</Text>
        <Text>Destructive commands: {ck.destructive ?? 0} held</Text>
        <Text>Bandwidth: {ck.bandwidth ?? 0} new dependencies noted</Text>
        <Text>
          Line coordination: {locks.length} locks · {waiting} waiting · {ck.coordination ?? 0} holds
          (locks and git)
        </Text>
      </Box>
    ),
  );
  const owner = (x: Board["tasks"][number]) => `${x.line}·${x.agent.slice(0, 10)}`;
  const taskList = (status: string, label: string) => {
    const ts = b.tasks.filter((x) => x.status === status && inView(x.line));
    return (
      <Box flexDirection="column">
        <Text dimColor>
          {label} ({ts.length})
        </Text>
        {ts.slice(0, 8).map((x) => (
          <Text key={`tk:${x.id}`} wrap="truncate">
            {badge(x.line)} {x.subject} <Text dimColor>{owner(x)}</Text>
          </Text>
        ))}
      </Box>
    );
  };
  const tasks = fold(
    "tasks",
    "Tasks",
    `${t.done} done · ${t.doing} doing · ${t.total - t.done - t.doing} to do`,
    () => (
      <Box flexDirection="column" paddingLeft={2}>
        {taskList("completed", "Done")}
        {taskList("in_progress", "Doing")}
        {taskList("pending", "To do")}
      </Box>
    ),
  );

  const status = (
    <Text dimColor wrap="truncate">
      ⎇ {l.branch || "—"} ·{" "}
      {lines.map((x) => (
        <Text key={`sb:${x.id}`} color={lineColor(x.id)}>
          {x.id}
          {x.status === "busy" ? "◉" : "●"}{" "}
        </Text>
      ))}
      · {l.agents.filter((x) => x.status === "running").length} agents · tasks {t.done}/{t.total} ·{" "}
      {l.route ? `${l.route.model}·${l.route.effort}` : "no route"} · {l.lastAction || "ready"}
    </Text>
  );

  return (
    <Box flexDirection="column" rowGap={1}>
      {top}
      <Box flexDirection={wide ? "row" : "column"} columnGap={2} rowGap={1}>
        {transmit}
        {network}
        {receive}
      </Box>
      {checks}
      {tasks}
      {status}
    </Box>
  );
}

// ── the band above the prompt: summary, holds, held review ────────────

export function renderBand(
  $: EngineInterface,
  e: RenderInput<"AbovePrompt">,
  d: Data,
  a: Actions,
  isPaneShown: boolean,
): RenderElement | null {
  const { Box, Text, Button } = $.ui.resolve(e);
  const { board: b, local: l } = d;
  const needs = b.needs.filter((n) => n.line === d.line && n.options.length);
  const review = l.review?.isHeld ? l.review : null;
  if (isPaneShown && !needs.length && !review) return null;
  const rows: RenderElement[] = [];
  if (!isPaneShown)
    rows.push(
      <Text
        key="sum"
        dimColor
        wrap="truncate"
      >{`MedSync · ${summaryLine(l, b)}${l.hints.length ? ` · ${l.hints[0]}` : ""}`}</Text>,
    );
  for (const [i, n] of needs.slice(0, 2).entries())
    rows.push(
      <Box key={`bn:${n.id}`} flexDirection="row" columnGap={1} flexWrap="wrap">
        <Text color="warning" wrap="truncate">
          {n.what}
        </Text>
        {n.options.map((o, j) => (
          <Button
            key={`bd:${n.id}:${j}`}
            hotkey={String(i * 4 + j + 1)}
            onPress={() => void a.decide(n.id, o)}
          >
            {o}
          </Button>
        ))}
      </Box>,
    );
  if (review)
    rows.push(
      <Box key="rv" flexDirection="row" columnGap={1} flexWrap="wrap">
        <Text color="warning">
          {review.phi.length
            ? `Held: ${review.phi.join(", ")}`
            : `Review ${review.score}/100: ${review.issues[0] ?? "needs detail"}`}
        </Text>
        <Button
          key="rv:improved"
          variant="primary"
          label="Send improved"
          onPress={() => void a.send("improved")}
        />
        {review.phi.length ? null : (
          <Button key="rv:mine" label="Send mine" onPress={() => void a.send("mine")} />
        )}
        <Button key="rv:edit" label="Edit improved" onPress={() => void a.send("edit")} />
      </Box>,
    );
  return <Box flexDirection="column">{rows.slice(0, Math.max(1, e.props.maxRows))}</Box>;
}
