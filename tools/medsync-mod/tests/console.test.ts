import { expect, test } from "claude-code/testing";

import { host, seedBoard, startSession } from "./host";

const NOW = 1_700_000_000_000;
const PANE = (surface: "terminal" | "desktop") => ({
  plugin: "medsync",
  surface,
  component: "Pane" as const,
  requestId: "dashboard",
  props: {
    title: "MedSync",
    isFocused: true,
    bodyColumns: 160,
    placement: "dock" as const,
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
});

test("the console draws three columns, the orbit and the folded rows on every surface that docks it", async ($, on) => {
  const h = host(on);
  seedBoard(h, {
    lines: {
      A: {
        id: "A",
        label: "Line A",
        sessionId: "session-a",
        status: "busy",
        task: "schema",
        lastSeen: NOW,
        branch: "main",
      },
    },
    tasks: [
      {
        id: "A:1",
        line: "A",
        agent: "lead",
        subject: "Write schema",
        status: "in_progress",
        blockedBy: [],
      },
    ],
    agents: {
      A: [
        {
          id: "ag1",
          name: "schema reviewer",
          model: "sonnet",
          status: "running",
          startedAt: NOW,
          endedAt: 0,
          tools: 3,
          msgs: 1,
          files: [],
          now: "Read",
        },
      ],
    },
    notes: [{ id: "p1", line: "B", from: "A", text: "synthetic data only", pinned: true, at: NOW }],
  });
  await startSession($);
  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount(PANE(surface));
    const texts = (await ui.findAll({ type: "Text" })).map((t) => t.text).join("\n");
    expect(texts).toContain("TRANSMIT");
    expect(texts).toContain("NETWORK");
    expect(texts).toContain("RECEIVE");
    expect(texts).toContain("Needs you (0)");
    expect(await ui.find({ key: "act:pause" })).toBeDefined();
    expect(await ui.find({ key: "fold:checks" })).toBeDefined();
    expect(await ui.find({ key: "note:p1" })).toBeDefined();
    // the other line is one press away
    await ui.press({ key: "other-line" });
    if (surface === "desktop") expect((await ui.findAll({ type: "Svg" })).length).toBe(1);
    else
      expect((await ui.findAll({ type: "Text" })).map((t) => t.text).join("\n")).toContain(
        "schema reviewer",
      );
    await ui.press({ key: "view:both" });
    await ui.press({ key: "fold:tasks" });
    expect((await ui.findAll({ type: "Text" })).map((t) => t.text).join("\n")).toContain(
      "Write schema",
    );
    await ui.press({ key: "fold:tasks" });
    await ui.unmount();
  }
});
