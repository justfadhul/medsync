import { expect, test } from "claude-code/testing";

import { board, cmd, host, press, pressKey, ROOT, seedBoard, startSession } from "./host";

const NOW = 1_700_000_000_000;
const lineA = {
  id: "A",
  label: "Line A",
  sessionId: "session-a",
  status: "busy",
  task: "schema work",
  lastSeen: NOW,
  branch: "main",
};
const withA = (locks: Record<string, unknown> = {}) => ({ lines: { A: lineA }, locks });
const edit = (file: string) =>
  ({ tool: "Edit", file_path: `${ROOT}/${file}`, old_string: "a", new_string: "b" }) as never;
const turn = { turnId: "t1" };
const done = {
  answer: "",
  durationMs: 1,
  isAborted: false,
  turnId: "t1",
  reason: "answer",
} as never;

test("the second session becomes Line B", async ($, on) => {
  const h = host(on);
  seedBoard(h, withA());
  await startSession($);
  expect(Object.keys(board(h).lines).sort()).toEqual(["A", "B"]);
  expect(board(h).lines.B.sessionId).toBe("session-b");
});

test("lock claim: an edit claims the file for this line", async ($, on) => {
  const h = host(on);
  on("tool.call", () => ({ result: {} }));
  await startSession($);
  await $.tool.call(edit("lib/x.ts"));
  expect(board(h).locks["lib/x.ts"]).toMatchObject({ line: "A", agent: "lead" });
});

test("conflict hold: a file Line A holds is held; Skip denies, Override takes it", async ($, on) => {
  const h = host(on);
  on("tool.call", () => ({ result: {} }));
  seedBoard(
    h,
    withA({ "lib/x.ts": { file: "lib/x.ts", line: "A", agent: "lead", since: NOW, waiting: [] } }),
  );
  await startSession($);
  let pending = $.tool.call(edit("lib/x.ts"));
  await press($, h, "Skip");
  const r = await pending;
  expect(r.deny).toContain("lib/x.ts is being edited by Line A");
  expect(board(h).locks["lib/x.ts"].waiting).toEqual(["B"]);
  pending = $.tool.call(edit("lib/x.ts"));
  await press($, h, "Override");
  expect((await pending).deny).toBeUndefined();
  expect(board(h).locks["lib/x.ts"].line).toBe("B");
});

test("a silent line is not a holder", async ($, on) => {
  const h = host(on);
  on("tool.call", () => ({ result: {} }));
  seedBoard(h, {
    lines: { A: { ...lineA, status: "offline" } },
    locks: { "lib/x.ts": { file: "lib/x.ts", line: "A", agent: "lead", since: NOW, waiting: [] } },
  });
  await startSession($, false);
  expect((await $.tool.call(edit("lib/x.ts"))).deny).toBeUndefined();
});

test("release on turn end", async ($, on) => {
  const h = host(on);
  on("tool.call", () => ({ result: {} }));
  await startSession($);
  await $.turn.start({ text: "go", ...turn });
  await $.tool.call(edit("lib/x.ts"));
  expect(Object.keys(board(h).locks)).toEqual(["lib/x.ts"]);
  await $.turn.complete(done);
  expect(board(h).locks).toEqual({});
});

test("git hold: commit waits while the other line holds files", async ($, on) => {
  const h = host(on);
  on("tool.call", () => ({ result: { stdout: "", stderr: "" } }));
  seedBoard(
    h,
    withA({
      "db/schema/a.ts": {
        file: "db/schema/a.ts",
        line: "A",
        agent: "lead",
        since: NOW,
        waiting: [],
      },
    }),
  );
  await startSession($, false);
  const r = await $.tool.call({ tool: "Bash", command: 'git commit -m "wip"' } as never);
  expect(r.deny).toContain("git commit not run while Line A holds files");
  expect(
    (await $.tool.call({ tool: "Bash", command: "git status" } as never)).deny,
  ).toBeUndefined();
});

test("git hold: override runs it", async ($, on) => {
  const h = host(on);
  on("tool.call", () => ({ result: { stdout: "", stderr: "" } }));
  seedBoard(
    h,
    withA({
      "db/schema/a.ts": {
        file: "db/schema/a.ts",
        line: "A",
        agent: "lead",
        since: NOW,
        waiting: [],
      },
    }),
  );
  await startSession($);
  const pending = $.tool.call({ tool: "Bash", command: "git checkout -b x" } as never);
  await press($, h, "Override");
  expect((await pending).deny).toBeUndefined();
});

test("message between lines: shared files changed in a turn are announced; /tell sends one", async ($, on) => {
  const h = host(on);
  on("tool.call", () => ({ result: {} }));
  seedBoard(h, withA());
  await startSession($);
  await $.turn.start({ text: "go", ...turn });
  await $.tool.call(edit("db/schema/patients.ts"));
  await $.turn.complete(done);
  expect(h.sent[0]).toEqual({
    to: "session-a",
    text: expect.stringContaining("db/schema/patients.ts"),
  });
  const out = await cmd($, "tell", "A please rebase");
  expect(out.text).toBe("Sent to Line A.");
  expect(h.sent[1]!.text).toBe("[MedSync Line B] please rebase");
  expect(board(h).traffic.length).toBe(2);
});
