import type { Engine } from "claude-code/testing";
import { expect, test } from "claude-code/testing";

import { BAND, board, cmd, host, press, pressKey, ROOT, seedBoard, startSession } from "./host";

const OPTIONS = {
  emergencyPaths: "app/emergency/,mobile/src/app/emergency.tsx",
  patientCopyPaths: "app/patient/,content/",
  i18nDir: "i18n",
  languages: "",
};

const edit = ($: Engine, file: string, before: string, after: string) =>
  $.tool.call({
    tool: "Edit",
    file_path: `${ROOT}/${file}`,
    old_string: before,
    new_string: after,
  } as never);

test("emergency screen: cancel, rewrite and override", { options: OPTIONS }, async ($, on) => {
  const h = host(on);
  on("tool.call", () => ({ result: { structuredPatch: [{ lines: ["+x"] }] } }));
  await startSession($);
  const line = "<Text>Are you bleeding heavily?</Text>";

  let pending = edit($, "app/emergency/page.tsx", "a", line);
  await press($, h, "Cancel");
  expect((await pending).deny).toContain("cancelled");

  pending = edit($, "app/emergency/page.tsx", "a", line);
  await press($, h, "Rewrite");
  expect((await pending).deny).toContain("signposting only");

  pending = edit($, "app/emergency/page.tsx", "a", line);
  await press($, h, "Override");
  expect((await pending).deny).toBeUndefined();

  const cso = await cmd($, "cso");
  expect(cso.text).toContain("override");
  expect(cso.text).toContain("Test User");
});

test("emergency screen: signposting passes", { options: OPTIONS }, async ($, on) => {
  const h = host(on);
  on("tool.call", () => ({ result: {} }));
  await startSession($);
  const ran = await edit(
    $,
    "app/emergency/page.tsx",
    "a",
    "<Text>Call 112 or go to the nearest hospital now.</Text>",
  );
  expect(ran.deny).toBeUndefined();
});

test(
  "patient data in an edit is held (denied with synthetic data when no one can answer)",
  { options: OPTIONS },
  async ($, on) => {
    const h = host(on);
    on("tool.call", () => ({ result: {} }));
    await startSession($, false);
    const ran = await edit($, "tests/fixtures/p.ts", "", "phone: '+256 772 123 456'");
    expect(ran.deny).toContain("+256 700 000 001");
  },
);

test(
  "patient data: interactive hold offers synthetic data",
  { options: OPTIONS },
  async ($, on) => {
    const h = host(on);
    on("tool.call", () => ({ result: {} }));
    await startSession($);
    const pending = edit($, "lib/x.ts", "", "Sarah Namubiru DOB 12/03/1990");
    await press($, h, "Use synthetic");
    expect((await pending).deny).toContain("Test Patient");
  },
);

test("destructive command: preview, cancel, proceed", { options: OPTIONS }, async ($, on) => {
  const h = host(on);
  on("tool.call", () => ({ result: { stdout: "", stderr: "" } }));
  await startSession($);
  let pending = $.tool.call({ tool: "Bash", command: "rm -rf dist" } as never);
  await press($, h, "Cancel");
  const denied = await pending;
  expect(denied.deny).toContain("dist: 42");
  pending = $.tool.call({ tool: "Bash", command: "rm -rf dist" } as never);
  await press($, h, "Proceed");
  expect((await pending).deny).toBeUndefined();
});

test("bandwidth: a new dependency is noted with its size", { options: OPTIONS }, async ($, on) => {
  const h = host(on);
  on("tool.call", () => ({ result: { stdout: "", stderr: "" } }));
  await startSession($);
  await $.tool.call({ tool: "Bash", command: "npm install lodash" } as never);
  expect(h.toasts.find((t) => t.includes("lodash"))).toContain("2.4 MB");
  expect(board(h).checks.bandwidth).toBe(1);
});

test(
  "CSO queue: patient copy is logged, listed, cleared and exported",
  { options: OPTIONS },
  async ($, on) => {
    const h = host(on);
    on("tool.call", () => ({
      result: { structuredPatch: [{ lines: ["+Book a visit", "-Book"] }] },
    }));
    await startSession($);
    await $.tool.call({
      tool: "Write",
      file_path: `${ROOT}/app/patient/page.tsx`,
      content: "Book a visit",
    } as never);
    await edit($, "lib/not-copy.ts", "a", "b");
    let out = await cmd($, "cso");
    expect(out.text).toContain("1 open");
    expect(out.text).toContain("app/patient/page.tsx");
    expect(out.text).not.toContain("not-copy");
    out = await cmd($, "cso", "export");
    expect(h.files.get(`${ROOT}/CSO_REVIEW.md`)).toContain("app/patient/page.tsx");
    out = await cmd($, "cso", "done 1");
    expect(out.text).toContain("cleared");
    expect((await cmd($, "cso")).text).toContain("empty");
  },
);

test(
  "translations: an English change marks other languages stale",
  { options: OPTIONS },
  async ($, on) => {
    const h = host(on);
    h.files.set(`${ROOT}/i18n/en.json`, '{"a":"Get help now","b":"Book"}');
    h.files.set(`${ROOT}/i18n/lg.json`, '{"a":"Funa obuyambi","b":"Kola"}');
    on("tool.call", ($, e) => {
      if (e.tool === "Edit")
        h.files.set(`${ROOT}/i18n/en.json`, '{"a":"Get help right now","b":"Book","c":"New"}');
      return { result: {} };
    });
    await startSession($);
    await edit($, "i18n/en.json", '"a":"Get help now"', '"a":"Get help right now"');
    const b = board(h);
    expect(Object.keys(b.stale).sort()).toEqual(["a", "c"]);
    expect(b.stale.a.langs).toEqual(["lg"]);
    const out = (await cmd($, "translations")).text ?? "";
    expect(out).toContain("a → lg");
    expect(out).toContain("lg: 1 missing (c)");
    expect(out).toContain("not clinically reviewed");
    // the English change is patient-facing copy too
    expect((await cmd($, "cso")).text).toContain("i18n");
  },
);

test(
  "tasks: TaskCreate and TaskUpdate land on the shared board",
  { options: OPTIONS },
  async ($, on) => {
    const h = host(on);
    on("tool.call", ($, e) =>
      e.tool === "TaskCreate"
        ? { result: { task: { id: "1", subject: "Write tests" } } }
        : { result: { success: true } },
    );
    await startSession($);
    await $.tool.call({ tool: "TaskCreate", subject: "Write tests", description: "x" } as never);
    expect(board(h).tasks).toEqual([
      {
        id: "A:1",
        line: "A",
        agent: "lead",
        subject: "Write tests",
        status: "pending",
        blockedBy: [],
      },
    ]);
    await $.tool.call({ tool: "TaskUpdate", taskId: "1", status: "completed" } as never);
    expect(board(h).tasks[0].status).toBe("completed");
  },
);

test("needs you: request_from_user, queued and blocking", { options: OPTIONS }, async ($, on) => {
  const h = host(on);
  on("tool.call", () => ({ result: {} }));
  await startSession($);
  const tool = "mcp__medsync__request_from_user";
  const queued = await $.tool.call({
    tool,
    what: "Sign-off from the CSO",
    why: "copy change",
    blocking: false,
  } as never);
  expect(String(queued.result)).toContain("Queued");
  expect(board(h).needs[0].what).toBe("Sign-off from the CSO");
  const pending = $.tool.call({
    tool,
    what: "Enter the Supabase key",
    why: "deploy",
    blocking: true,
  } as never);
  await press($, h, "Done");
  expect(String((await pending).result)).toContain("The user answered: Done");
});

test(
  "notes: a queued note rides the next prompt once; a pin rides every prompt",
  { options: OPTIONS },
  async ($, on) => {
    const h = host(on);
    seedBoard(h, {
      notes: [
        { id: "n1", line: "A", from: "A", text: "use the v2 desk", pinned: false, at: 0 },
        { id: "p1", line: "A", from: "B", text: "synthetic data only", pinned: true, at: 0 },
      ],
    });
    await startSession($);
    await cmd($, "route", "off");
    await $.prompt.submit({
      text: "Refactor lib/wards/editor.ts so undo works",
      origin: { kind: "composer" },
      wait: false,
    } as never);
    await $.prompt.submit({
      text: "Refactor lib/wards/history.ts too",
      origin: { kind: "composer" },
      wait: false,
    } as never);
    expect(h.contexts[0]).toEqual([
      "MedSync note: use the v2 desk",
      "MedSync pinned note from Line B: synthetic data only",
    ]);
    expect(h.contexts[1]).toEqual(["MedSync pinned note from Line B: synthetic data only"]);
  },
);

test(
  "routing: clinical prompts go to the strongest model by rule; read-only to the fastest",
  { options: { ...OPTIONS, strongModel: "opus" } },
  async ($, on) => {
    const h = host(on);
    await startSession($);
    const submit = (text: string) =>
      $.prompt.submit({ text, origin: { kind: "composer" }, wait: false } as never);
    await submit("Update the paracetamol mg/kg dosing table in lib/prescribing");
    let out = (await cmd($, "route")).text ?? "";
    expect(out).toContain("opus · high (rule");
    await submit("what does proxy.ts do?");
    out = (await cmd($, "route")).text ?? "";
    expect(out).toContain("haiku · low (rule");
    await submit("Build the ward export with tests");
    out = (await cmd($, "route")).text ?? "";
    expect(out).toContain("(model");
    await cmd($, "route", "lock sonnet medium");
    await submit("Build the ward export with tests");
    expect((await cmd($, "route")).text).toContain("sonnet · medium (lock");
    // clinical prompts are queued for the CSO
    expect((await cmd($, "cso")).text).toContain("clinical-prompt");
  },
);

test(
  "patient data in a prompt: dropped, and Send synthetic sends the synthetic version",
  { options: OPTIONS },
  async ($, on) => {
    const h = host(on);
    await startSession($);
    const r = await $.prompt.submit({
      text: "Add a test patient with phone 0772123456 to the seed",
      origin: { kind: "composer" },
      wait: false,
    } as never);
    expect(r.drop).toContain("patient data");
    const ui = await $.ui.mount(BAND);
    const labels = (await ui.findAll({ type: "Button" })).map(
      (b) => b.text || String(b.props.label),
    );
    expect(labels).toEqual(["Send synthetic", "Edit synthetic"]);
    await ui.unmount();
    await pressKey($, "held:synthetic");
    expect(h.submitted.at(-1)).toBe("Add a test patient with phone +256 700 000 001 to the seed");
  },
);

test("an ordinary prompt passes unchanged, with no model review", { options: OPTIONS }, async ($, on) => {
  const h = host(on);
  on("model.complete", () => {
    throw new Error("no completion is made for a prompt");
  });
  await startSession($);
  const r = await $.prompt.submit({ text: "fix it", origin: { kind: "composer" }, wait: false } as never);
  expect(r.drop).toBeUndefined();
  expect(h.submitted).toEqual(["fix it"]);
});
