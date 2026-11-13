#!/usr/bin/env node
/**
 * The Tether landing page's browser checks (STOP 0 ruling 5: no Playwright). It drives a Chrome started with
 * --remote-debugging-port over the raw DevTools protocol with Node's own WebSocket, so it adds no dependency.
 *
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9333 \
 *     --user-data-dir=<tmp> about:blank &
 *   node scripts/landing/scenarios.mjs <base> <outDir> <step...>
 *
 * Steps: s1 … s8 shots axe bytes. `base` serves the page at `/` (LANDING_TETHER=1). JSON lines to stdout.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const [BASE, OUT, ...STEPS] = process.argv.slice(2);
const PORT = Number(process.env.CDP_PORT ?? 9333);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = (o) => console.log(JSON.stringify(o));

async function open() {
  const t = await (
    await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })
  ).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    } else listeners.forEach((f) => f(m));
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const js = async (expression) =>
    (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result
      .value;
  const goto = async (url) => {
    const loaded = new Promise((r) =>
      listeners.push((m) => m.method === "Page.loadEventFired" && r()),
    );
    await send("Page.navigate", { url });
    await loaded;
  };
  const view = async (width, theme, height = width < 761 ? 844 : 900) => {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 761,
    });
    await send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: theme }],
    });
  };
  const key = (k, code, keyCode, shift = false) =>
    ["keyDown", "keyUp"].reduce(
      (p, type) =>
        p.then(() =>
          send("Input.dispatchKeyEvent", {
            type,
            key: k,
            code,
            windowsVirtualKeyCode: keyCode,
            modifiers: shift ? 8 : 0,
            // Enter activates a button only when the key event carries its text.
            ...(k === "Enter" && type === "keyDown" ? { text: "\r" } : {}),
          }),
        ),
      Promise.resolve(),
    );
  const click = async (x, y) => {
    for (const type of ["mousePressed", "mouseReleased"])
      await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  };
  const close = async () => {
    ws.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`);
  };
  await send("Page.enable");
  await send("Runtime.enable");
  return { send, js, goto, view, key, click, close, listeners };
}

/** The visible, on-screen control named "Help, emergency", or null. */
const HELP_VISIBLE = `(() => {
  const el = [...document.querySelectorAll('[aria-label="Help, emergency"]')].find((e) => e.checkVisibility({ visibilityProperty: true, opacityProperty: true }));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { tag: el.tagName, onScreen: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth };
})()`;

async function s1() {
  for (const width of [1440, 834, 390])
    for (const theme of ["light", "dark"]) {
      const p = await open();
      await p.view(width, theme);
      await p.goto(BASE + "/");
      await sleep(800);
      const top = await p.js(HELP_VISIBLE);
      await p.js("scrollTo(0, document.documentElement.scrollHeight / 2)");
      await sleep(700);
      const scrolled = await p.js(HELP_VISIBLE);
      report({
        s: "S1",
        width,
        theme,
        top,
        scrolled,
        pass: !!top?.onScreen && !!scrolled?.onScreen,
      });
      await p.close();
    }
}

const MENU = `[...document.querySelectorAll('button[aria-haspopup="dialog"]')].find((b) => b.textContent.trim() === "Menu")`;
const STATE = `(() => { const d = document.querySelector('dialog[open]'); const a = document.activeElement;
  return { open: !!d, inside: !!d && d.contains(a), onMenu: a === ${MENU}, expanded: ${MENU}?.getAttribute('aria-expanded') }; })()`;

async function s2() {
  const p = await open();
  await p.view(390, "light");
  await p.goto(BASE + "/");
  await sleep(800);
  const openMenu = async () => {
    await p.js(`${MENU}.focus()`);
    await p.key("Enter", "Enter", 13);
    await sleep(500);
    return p.js(STATE);
  };
  const results = {};
  results.opened = await openMenu();
  let trapped = true;
  for (let i = 0; i < 14; i++) {
    await p.key("Tab", "Tab", 9, i % 3 === 2);
    trapped &&= (await p.js(STATE)).inside;
  }
  results.trapped = trapped;
  await p.key("Escape", "Escape", 27);
  await sleep(300);
  results.escape = await p.js(STATE);
  await openMenu();
  await p.click(195, 820); // the scrim, below the panel
  await sleep(300);
  results.scrim = await p.js(STATE);
  await openMenu();
  await p.js(
    `[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.trim() === "Close").click()`,
  );
  await sleep(300);
  results.closeButton = await p.js(STATE);
  const pass =
    results.opened.open &&
    results.opened.inside &&
    results.opened.expanded === "true" &&
    trapped &&
    ["escape", "scrim", "closeButton"].every((k) => !results[k].open && results[k].onMenu);
  report({ s: "S2", ...results, pass });
  await p.close();
}

async function s3() {
  // A cold load in dark with no app JavaScript at all: only the inline theme script can set dark before paint.
  for (const [label, theme, stored] of [
    ["system dark", "dark", null],
    ["stored dark, system light", "light", "dark"],
  ]) {
    const p = await open();
    await p.view(1440, theme);
    await p.goto(BASE + "/emergency"); // same origin, to write the stored choice
    await p.js(
      stored
        ? `localStorage.setItem("medsync-theme", "${stored}")`
        : `localStorage.removeItem("medsync-theme")`,
    );
    await p.send("Network.enable");
    await p.send("Network.setBlockedURLs", { urls: ["*/_next/static/chunks/*.js"] });
    await p.goto(BASE + "/");
    const got = await p.js(
      `({ dark: document.documentElement.classList.contains("dark"), bg: getComputedStyle(document.querySelector("[data-tether]")).backgroundColor })`,
    );
    const { data } = await p.send("Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width: 1440, height: 400, scale: 1 },
    });
    writeFileSync(
      `${OUT}/s3-first-paint-${stored ? "stored" : "system"}.png`,
      Buffer.from(data, "base64"),
    );
    await p.js(`localStorage.removeItem("medsync-theme")`);
    report({ s: "S3", case: label, ...got, pass: got.dark && got.bg === "rgb(11, 17, 32)" });
    await p.close();
  }
}

async function s4() {
  for (const theme of ["light", "dark"]) {
    const p = await open();
    await p.view(390, theme);
    await p.goto(BASE + "/");
    await sleep(600);
    await p.js("scrollTo(0, document.documentElement.scrollHeight)");
    await sleep(700);
    const r = await p.js(`(() => {
      const line = [...document.querySelectorAll("footer p span")].find((s) => s.checkVisibility()).getBoundingClientRect();
      const bar = [...document.querySelectorAll('a[href="#modes"]')].map((a) => a.parentElement).find((e) => getComputedStyle(e).position === "fixed").getBoundingClientRect();
      return { lineBottom: Math.round(line.bottom), barTop: Math.round(bar.top), hscroll: document.documentElement.scrollWidth - innerWidth };
    })()`);
    report({ s: "S4", theme, ...r, pass: r.lineBottom <= r.barTop && r.hscroll === 0 });
    await p.close();
  }
}

async function shots() {
  const states = [
    ["top", async () => {}],
    ["scrolled", async (p) => (await p.js("scrollTo(0, 900)"), sleep(700))],
    ["menu", async (p, w) => w < 761 && (await p.js(`${MENU}.click()`), sleep(700))],
    [
      "help",
      async (p, w) =>
        w < 761 &&
        (await p.js(`document.querySelector('button[aria-label="Help, emergency"]').click()`),
        sleep(1500)),
    ],
  ];
  for (const width of [1440, 834, 390])
    for (const theme of ["light", "dark"])
      for (const [name, act] of states) {
        if ((name === "menu" || name === "help") && width >= 761) continue;
        const p = await open();
        await p.view(width, theme);
        await p.goto(BASE + "/");
        await sleep(800);
        await act(p, width);
        const { data } = await p.send("Page.captureScreenshot", { format: "jpeg", quality: 75 });
        writeFileSync(`${OUT}/${width}-${theme}-${name}.jpg`, Buffer.from(data, "base64"));
        await p.close();
      }
  report({ shots: OUT });
}

async function axe() {
  const src = readFileSync("node_modules/axe-core/axe.min.js", "utf8");
  for (const width of [1440, 834, 390])
    for (const theme of ["light", "dark"]) {
      const p = await open();
      await p.view(width, theme);
      await p.goto(BASE + "/");
      await sleep(800);
      await p.js(src + ";1");
      const v = JSON.parse(
        await p.js(
          `axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}).then(r=>JSON.stringify(r.violations.map(v=>({id:v.id,impact:v.impact,n:v.nodes.length}))))`,
        ),
      );
      const n = (i) => v.filter((x) => x.impact === i).reduce((a, x) => a + x.n, 0);
      report({
        axe: `${width}-${theme}`,
        critical: n("critical"),
        serious: n("serious"),
        other: v.filter((x) => !["critical", "serious"].includes(x.impact)).map((x) => x.id),
      });
      await p.close();
    }
}

async function bytes() {
  // Transfer sizes for a cold load of `/` (gzip from `next start`), by type, before any interaction.
  const p = await open();
  await p.send("Network.enable");
  await p.send("Network.setCacheDisabled", { cacheDisabled: true });
  await p.view(412, "light");
  const reqs = new Map();
  p.listeners.push((m) => {
    if (m.method === "Network.responseReceived")
      reqs.set(m.params.requestId, { url: m.params.response.url, type: m.params.type, enc: 0 });
    if (m.method === "Network.loadingFinished" && reqs.has(m.params.requestId))
      reqs.get(m.params.requestId).enc = m.params.encodedDataLength;
  });
  await p.goto(BASE + "/");
  await sleep(3000);
  const by = {};
  for (const r of reqs.values()) {
    by[r.type] ??= { n: 0, kb: 0, files: [] };
    by[r.type].n++;
    by[r.type].kb += r.enc / 1024;
    by[r.type].files.push(`${Math.round(r.enc / 1024)} ${r.url.replace(BASE, "").slice(0, 70)}`);
  }
  for (const t of Object.values(by)) t.kb = Math.round(t.kb * 10) / 10;
  report({ bytes: by });
  await p.close();
}

/** A fake clock: 27 Nov 2026 22:30 UTC (28 Nov 01:30 in Kampala), so the visit is Fri 4 Dec at 10:40. */
const FAKE = Date.UTC(2026, 10, 27, 22, 30);
const fakeClock = (p) =>
  p.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `{ const off = ${FAKE} - Date.now(); const n = Date.now.bind(Date); Date.now = () => n() + off; }`,
  });
const TICKET_STATE = `(() => {
  const w = document.querySelector("[data-ticket]");
  const front = w.querySelector('button[aria-label^="Example visit ticket"]');
  const timer = front.querySelector('[role="timer"]');
  const sms = [...document.querySelectorAll('[aria-live="polite"]')].find((e) => e.checkVisibility() && e.querySelector("p"));
  const stamp = front.querySelector("span.absolute");
  return {
    name: front.getAttribute("aria-label"),
    date: [...front.querySelectorAll("span")].find((s) => s.className.includes("text-[32px]"))?.textContent,
    timer: timer.textContent,
    stamp: stamp?.textContent ?? null,
    sms: sms?.querySelector("p").textContent,
    torn: w.hasAttribute("data-torn"),
    flipped: w.querySelector("[data-flipped]") !== null,
    focus: document.activeElement?.getAttribute("aria-label"),
    buttons: [...document.querySelectorAll("section button")].filter((b) => b.checkVisibility() && !b.closest("[data-ticket]")).map((b) => b.innerText.trim()),
  };
})()`;
const clickText = (p, text) =>
  p.js(
    `[...document.querySelectorAll("button")].find((b) => b.checkVisibility() && b.innerText.trim() === ${JSON.stringify(text)}).click()`,
  );

async function s5() {
  const p = await open();
  await fakeClock(p);
  await p.view(1440, "light");
  await p.goto(BASE + "/");
  await sleep(1200);
  const a = await p.js(TICKET_STATE);
  await sleep(2100);
  const b = await p.js(TICKET_STATE);
  report({
    s: "S5",
    date: a.date,
    name: a.name,
    t0: a.timer,
    t2: b.timer,
    pass:
      a.date === "Fri 4 Dec" &&
      a.name.includes("Friday 4 December at 10:40") &&
      a.timer.includes("6d") &&
      a.timer !== b.timer,
  });
  await p.close();
}

async function s6() {
  const p = await open();
  await fakeClock(p);
  await p.view(1440, "light");
  await p.goto(BASE + "/");
  await sleep(1000);
  const ok = await p.js(TICKET_STATE);
  await clickText(p, "I'm coming");
  await sleep(600);
  const coming = await p.js(TICKET_STATE);
  await clickText(p, "Cancel");
  await sleep(600);
  const cancelled = await p.js(TICKET_STATE);
  await clickText(p, "Book it again");
  await sleep(600);
  const again = await p.js(TICKET_STATE);
  const pass =
    ok.stamp === null &&
    ok.sms === "Your visit is booked for Fri 4 Dec at 10:40. Your code is K7M42Q." &&
    coming.stamp === "Coming" &&
    coming.sms === "Thank you, Sarah. The clinic expects you on Fri 4 Dec at 10:40." &&
    cancelled.stamp === "Cancelled" &&
    cancelled.buttons.includes("Book it again") &&
    cancelled.sms === "Your visit on Fri 4 Dec is cancelled. You can book again any time." &&
    again.stamp === null;
  report({
    s: "S6",
    ok: ok.sms,
    coming: [coming.stamp, coming.sms],
    cancelled: [cancelled.stamp, cancelled.sms, cancelled.buttons],
    pass,
  });
  await p.close();
}

async function s7() {
  const p = await open();
  await p.send("Browser.grantPermissions", {
    origin: BASE,
    permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
  });
  await p.view(1440, "light");
  await p.goto(BASE + "/");
  await sleep(1500);
  const box = await p.js(
    `(() => { const r = document.querySelector('button[aria-label="Copy the code K 7 M 4 2 Q"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  await p.click(box.x, box.y);
  await sleep(300);
  const label = await p.js(
    `document.querySelector('button[aria-label="Copy the code K 7 M 4 2 Q"]').textContent`,
  );
  const clip = await p.js(`navigator.clipboard.readText()`);
  await p.js(`navigator.clipboard.writeText("x")`);
  await sleep(1800);
  const drag = async (dy) => {
    await p.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: box.x,
      y: box.y,
      button: "left",
      clickCount: 1,
    });
    for (let i = 1; i <= 8; i++)
      await p.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: box.x,
        y: box.y + (dy * i) / 8,
        button: "left",
        buttons: 1,
      });
    await p.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: box.x,
      y: box.y + dy,
      button: "left",
      clickCount: 1,
    });
    await sleep(800);
    return p.js(TICKET_STATE);
  };
  const tornState = await drag(80);
  const afterTear = await p.js(`navigator.clipboard.readText()`);
  const backState = await drag(-40);
  const afterBack = await p.js(`navigator.clipboard.readText()`);
  await p.js(`document.querySelector('button[aria-label^="Example visit ticket"]').focus()`);
  await p.key("Enter", "Enter", 13);
  await sleep(500);
  const entered = await p.js(TICKET_STATE);
  await p.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: " ",
    code: "Space",
    windowsVirtualKeyCode: 32,
    text: " ",
  });
  await p.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: " ",
    code: "Space",
    windowsVirtualKeyCode: 32,
  });
  await sleep(500);
  const spaced = await p.js(TICKET_STATE);
  const pass =
    label.includes("Copied") &&
    clip === "K7M42Q" &&
    tornState.torn &&
    afterTear === "x" &&
    !backState.torn &&
    afterBack === "x" &&
    entered.flipped &&
    entered.focus?.startsWith("Back of the ticket") &&
    !spaced.flipped &&
    spaced.focus?.startsWith("Example visit ticket");
  report({
    s: "S7",
    label,
    clip,
    torn: tornState.torn,
    afterTear,
    reattached: !backState.torn,
    afterBack,
    enter: [entered.flipped, entered.focus],
    space: [spaced.flipped, spaced.focus],
    pass,
  });
  await p.close();
}

const HEADLINE = `[...document.querySelector("h1").children].at(-1).textContent`;
async function s8() {
  const p = await open();
  await p.view(1440, "light");
  await p.goto(BASE + "/");
  const seen = [];
  for (const t of [300, 3500, 3200, 3200, 3200, 3200]) {
    await sleep(t);
    seen.push(await p.js(HEADLINE));
  }
  const lcp = await p.js(
    `new Promise((r) => new PerformanceObserver((l) => { const e = l.getEntries().at(-1); r({ tag: e.element?.tagName, inH1: !!e.element?.closest("h1"), size: e.size, text: e.element?.textContent.slice(0, 40), cls: String(e.element?.className).slice(0, 60) }); }).observe({ type: "largest-contentful-paint", buffered: true }))`,
  );
  await p.close();
  const q = await open();
  await q.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await q.view(1440, "light");
  await q.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await q.goto(BASE + "/");
  await sleep(7000);
  const reduced = await q.js(HEADLINE);
  await q.close();
  const once =
    seen[0].includes("from home") &&
    seen[1].includes("on the road") &&
    seen[2].includes("Going to emergency") &&
    seen[3].includes("from home") &&
    seen.slice(4).every((x) => x === seen[3]);
  report({ s: "S8", seen, reduced, lcp, pass: once && reduced.includes("from home") && lcp.inH1 });
}

async function s9() {
  for (const width of [1440, 834, 390]) {
    const p = await open();
    await p.view(width, "light");
    await p.goto(BASE + "/");
    await sleep(600);
    const at = async (y) => {
      await p.js(
        `(() => { const s = document.querySelector("p[style*='--n']").closest("section"); scrollTo(0, s.offsetTop - innerHeight * ${y}); })()`,
      );
      await sleep(400);
      return p.js(
        `Math.min(...[...document.querySelectorAll("p[style*='--n'] span")].map((s) => +getComputedStyle(s).opacity))`,
      );
    };
    const entering = await at(0.8);
    const end = await at(0);
    report({ s: "S9", width, entering, end, pass: entering < 1 && end === 1 });
    await p.close();
  }
}

async function s10() {
  const p = await open();
  await p.view(390, "light");
  await p.goto(BASE + "/");
  await sleep(600);
  const st = `(() => { const c = document.querySelector('#how span.tabular-nums').innerText; const d = [...document.querySelectorAll('[aria-label="Go to step"] button')].findIndex((b) => b.getAttribute("aria-pressed") === "true"); return { counter: c, dot: d }; })()`;
  await p.js(`document.querySelector("#how").scrollIntoView()`);
  const list = `document.querySelector('ol[aria-label="Five steps"]')`;
  await p.js(`${list}.scrollTo({ left: ${list}.children[1].offsetLeft - 20 })`);
  await sleep(500);
  const swiped = await p.js(st);
  await p.js(`document.querySelectorAll('[aria-label="Go to step"] button')[3].click()`);
  await sleep(900);
  const dotted = await p.js(st);
  await p.js(`${list}.focus()`);
  await p.key("ArrowRight", "ArrowRight", 39);
  await sleep(900);
  const keyed = await p.js(st);
  const snap = await p.js(`getComputedStyle(${list}).scrollSnapType`);
  report({
    s: "S10",
    snap,
    swiped,
    dotted,
    keyed,
    pass:
      snap.includes("mandatory") &&
      swiped.counter.startsWith("2") &&
      swiped.dot === 1 &&
      dotted.counter.startsWith("4") &&
      dotted.dot === 3 &&
      keyed.counter.startsWith("5"),
  });
  await p.close();
}

const MODE = `(() => { const s = document.querySelector("#modes"); const t = s.querySelector("[data-ticket]");
  return { pressed: [...s.querySelectorAll('[role="group"] button[aria-pressed="true"]')].map((b) => b.getAttribute("aria-label")),
    pill: t.querySelector("b + span, span.rounded-full")?.innerText, fact: [...s.querySelectorAll("dd")].filter((d) => d.checkVisibility())[0]?.innerText,
    flipped: !!t.querySelector("[data-flipped]") }; })()`;
async function s11() {
  const p = await open();
  await p.view(1440, "light");
  await p.goto(BASE + "/");
  await sleep(600);
  await p.js(`document.querySelector('#modes [aria-label="A time with a doctor"]').click()`);
  await sleep(500);
  const seg = await p.js(MODE);
  await p.close();
  const q = await open();
  await q.view(390, "light");
  await q.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await q.goto(BASE + "/");
  await sleep(600);
  await q.js(`document.querySelector("#modes [data-ticket]").scrollIntoView({ block: "center" })`);
  await sleep(400);
  const r = await q.js(
    `(() => { const b = document.querySelector("#modes [data-ticket] button").getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + 80 }; })()`,
  );
  const swipe = async (dx) => {
    await q.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: r.x, y: r.y }],
    });
    for (let i = 1; i <= 6; i++)
      await q.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: r.x + (dx * i) / 6, y: r.y }],
      });
    await q.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(700);
    return q.js(MODE);
  };
  const swiped = await swipe(-120);
  await q.js(
    `document.querySelectorAll('#modes [aria-label="Ways to book"]')[1].querySelectorAll("button")[2].click()`,
  );
  await sleep(500);
  const dotted = await q.js(MODE);
  report({
    s: "S11",
    seg,
    swiped,
    dotted,
    pass:
      seg.pressed[0] === "A time with a doctor" &&
      seg.fact === "When the doctor accepts" &&
      swiped.pressed[0] === "A time with a doctor" &&
      !swiped.flipped &&
      dotted.pressed[0] === "Join today's line" &&
      dotted.fact === "At once",
  });
  await q.close();
}

const DUO_STATE = `(() => { const s = document.querySelector("#who");
  return { chip: [...s.querySelectorAll("em")].map((e) => e.innerText)[1], pill: [...s.querySelectorAll("span.rounded-full")].map((e) => e.innerText).find((t) => /Confirmed|Coming|Checked in/.test(t)),
    flash: [...s.querySelectorAll("div")].some((d) => getComputedStyle(d).animationName.includes("flash")),
    badge: [...s.querySelectorAll('[role="group"] button')].filter((b) => b.querySelector("span")).map((b) => b.firstChild.textContent),
    toast: document.querySelector('[role="status"]')?.innerText ?? null }; })()`;
const clickIn = (p, root, text) =>
  p.js(
    `[...document.querySelectorAll("${root} button")].find((b) => b.checkVisibility() && b.innerText.trim() === ${JSON.stringify(text)}).click()`,
  );
async function s12() {
  const p = await open();
  await p.view(1440, "light");
  await p.goto(BASE + "/");
  await sleep(600);
  await clickIn(p, "#who", "I'm coming");
  await sleep(200);
  const coming = await p.js(DUO_STATE);
  await clickIn(p, "#who", "Check in");
  await sleep(200);
  const here = await p.js(DUO_STATE);
  await clickIn(p, "#who", "Start again");
  await sleep(200);
  const reset = await p.js(DUO_STATE);
  report({
    s: "S12",
    coming,
    here,
    reset,
    pass:
      coming.chip === "Coming" &&
      coming.flash &&
      here.chip === "Here" &&
      here.pill === "Checked in" &&
      reset.chip === "Expected" &&
      reset.pill === "Confirmed",
  });
  await p.close();
}
async function s13() {
  const p = await open();
  await p.view(390, "light");
  await p.goto(BASE + "/");
  await sleep(600);
  await clickIn(p, "#who", "I'm coming");
  await sleep(300);
  const a = await p.js(DUO_STATE);
  await clickIn(p, "#who", "Reception");
  await sleep(200);
  const b = await p.js(DUO_STATE);
  await clickIn(p, "#who", "Check in");
  await sleep(300);
  const c = await p.js(DUO_STATE);
  report({
    s: "S13",
    a,
    b,
    c,
    pass:
      a.badge[0] === "Reception" &&
      a.toast === "Reception now sees: Coming" &&
      b.badge.length === 0 &&
      b.chip === "Coming" &&
      c.badge[0] === "Patient" &&
      c.toast === "Sarah now sees: Checked in",
  });
  await p.close();
}

async function s14() {
  const p = await open();
  await p.view(1440, "light");
  await p.goto(BASE + "/");
  await sleep(600);
  const qs = () =>
    p.js(
      `[...document.querySelectorAll('#questions button[aria-pressed]')].filter((b) => b.checkVisibility() && !b.closest('[role="group"]')).map((b) => b.innerText.trim())`,
    );
  const type = async (t) => {
    await p.js(
      `(() => { const i = document.querySelector('#questions input[type="search"]'); i.focus(); i.select(); })()`,
    );
    await p.send("Input.insertText", { text: t });
    await sleep(300);
  };
  const all = await qs();
  await type("fee");
  const fee = await qs();
  await type("");
  await p.js(
    `(() => { const i = document.querySelector('#questions input[type="search"]'); i.focus(); i.select(); document.execCommand("delete"); })()`,
  );
  await clickIn(p, "#questions", "Cost");
  await sleep(300);
  const cost = await qs();
  await clickIn(p, "#questions", "All");
  await type("zzzz");
  const none = await p.js(
    `document.querySelector('#questions a[href^="mailto:"]')?.closest("p").innerText ?? null`,
  );
  await p.close();
  const q = await open();
  await q.view(390, "light");
  await q.goto(BASE + "/");
  await sleep(600);
  const acc = () =>
    q.js(
      `[...document.querySelectorAll('#questions button[aria-expanded]')].filter((b) => b.checkVisibility()).map((b) => b.getAttribute("aria-expanded"))`,
    );
  const first = await acc();
  await q.js(
    `[...document.querySelectorAll('#questions button[aria-expanded]')].filter((b) => b.checkVisibility())[2].click()`,
  );
  await sleep(300);
  const second = await acc();
  await q.close();
  report({
    s: "S14",
    all: all.length,
    firstQ: all[0],
    fee,
    cost,
    none: none?.slice(0, 40),
    phoneOpen: [
      first.indexOf("true"),
      second.filter((x) => x === "true").length,
      second.indexOf("true"),
    ],
    pass:
      all.length === 10 &&
      all[0] === "What if it is an emergency?" &&
      fee.length > 0 &&
      fee.length < 10 &&
      cost.length > 0 &&
      cost.length < 10 &&
      !!none &&
      first.indexOf("true") === 0 &&
      second.filter((x) => x === "true").length === 1 &&
      second.indexOf("true") === 2,
  });
}

async function s16() {
  const p = await open();
  await p.view(1440, "light");
  await p.goto(BASE + "/");
  await sleep(600);
  const send = async (email, company = "") => {
    await p.js(
      `(() => { const i = document.querySelector("#join-email"); i.focus(); i.select(); document.execCommand("delete"); document.querySelector("#join-company").value = ${JSON.stringify(company)}; })()`,
    );
    await p.send("Input.insertText", { text: email });
    await p.js(`document.querySelector("#join-email").form.requestSubmit()`);
    await sleep(1500);
    return p.js(`document.querySelector("#join-msg").innerText`);
  };
  const bad = await send("name@clinic");
  const bot = await send("bot@clinic.com", "Acme");
  report({
    s: "S16",
    bad,
    bot,
    pass:
      bad === "Please enter a full email address, like name@clinic.com." &&
      bot === "Thank you. We will email you about setting up your clinic.",
    note: "a stored row needs migration 0293 applied by the owner",
  });
  await p.close();
}

for (const s of STEPS)
  await { s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s16, shots, axe, bytes }[
    s
  ]();
process.exit(0);
