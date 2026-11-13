// Generates the patient-web token block from mobile/src/theme/tide.ts values (one source: the phone).
import fs from "fs";

const src = fs.readFileSync(process.argv[2], "utf8");
const grab = (name) => {
  const s = src.indexOf(`export const ${name}: Tide = {`);
  const e = src.indexOf("\n};", s);
  return src.slice(s, e);
};
const val = (blk, path) => {
  // path like "bg" or "area.readings" or "cascade.0"
  const [a, b] = path.split(".");
  if (!b) return blk.match(new RegExp(`\\n  ${a}: "([^"]+)"`))[1];
  if (a === "cascade")
    return blk
      .match(/cascade: \[([^\]]+)\]/)[1]
      .split(",")
      .map((x) => x.trim().replace(/"/g, ""))[+b];
  const inner = blk.match(new RegExp(`\\n  ${a}: \\{([\\s\\S]*?)\\}`))[1];
  return inner.match(new RegExp(`${b}: "([^"]+)"`))[1];
};
const map = {
  bg: "bg",
  surface: "surface",
  "surface-2": "surface2",
  "surface-3": "surface3",
  raised: "surfaceRaised",
  line: "line",
  "line-strong": "lineStrong",
  ink: "ink",
  "ink-2": "ink2",
  "ink-3": "ink3",
  "ink-4": "ink4",
  band: "band",
  "on-band": "onBand",
  "on-band-2": "onBand2",
  "on-band-accent": "onBandAccent",
  "band-glass": "bandGlass",
  act: "primary",
  "on-act": "onPrimary",
  "act-off": "primaryOff",
  "on-act-off": "onPrimaryOff",
  accent: "accent",
  "accent-pressed": "accentPressed",
  "on-accent": "onAccent",
  "accent-text": "accentText",
  "accent-tint": "accentTint",
  "accent-soft": "accentSoft",
  focus: "focus",
  "cascade-1": "cascade.0",
  "cascade-2": "cascade.1",
  "cascade-3": "cascade.2",
  "cascade-4": "cascade.3",
  "area-readings": "area.readings",
  "area-medicines": "area.medicines",
  "area-visits": "area.visits",
  "area-team": "area.team",
  "area-me": "area.me",
  "place-tint": "place.tint",
  "place-text": "place.text",
  "info-tint": "info.tint",
  "info-text": "info.text",
  "stable-tint": "stable.tint",
  "stable-text": "stable.text",
  "caution-tint": "caution.tint",
  "caution-text": "caution.text",
  "critical-tint": "critical.tint",
  "critical-text": "critical.text",
  "pending-tint": "pending.tint",
  "pending-text": "pending.text",
  emergency: "emergency",
  "emergency-band": "emergencyBand",
  "on-emergency": "onEmergency",
  scrim: "scrim",
};
const shadows = {
  card: "shadow.card",
  float: "shadow.float",
  accent: "shadow.accent",
  emergency: "shadow.emergency",
};
const block = (blk) =>
  [
    ...Object.entries(map).map(([k, p]) => `  --pw-${k}: ${val(blk, p)};`),
    ...Object.entries(shadows).map(
      ([k, p]) =>
        `  --pw-shadow-${k}: ${val(blk, p)
          .replace(/\b0px/g, "0")
          .replace(/(\.\d*?)0+\b/g, "$1")};`,
    ),
  ].join("\n");
const L = grab("tideLight"),
  D = grab("tideDark");
const theme = [
  ...Object.keys(map).map((k) => `  --color-pw-${k}: var(--pw-${k});`),
  ...Object.keys(shadows).map((k) => `  --shadow-pw-${k}: var(--pw-shadow-${k});`),
  "  --radius-pw-field: 16px;",
  "  --radius-pw-row: 18px;",
  "  --radius-pw-card: 22px;",
  "  --radius-pw-cascade: 28px;",
  "  --radius-pw-sheet: 32px;",
  "  --font-pw: var(--font-patient-web), ui-sans-serif, system-ui, sans-serif;",
  "  --font-pw-mono: var(--font-medsync-mono), ui-monospace, monospace;",
].join("\n");
process.stdout.write(`
/* ─── Patient web · Tide (PROMPT-PATIENT-WEB-TIDE §4–5, ADRs 0415–0421) ───────────────────────────────
   Generated from the phone's mobile/src/theme/tide.ts by scripts/patient-web/gen-tokens.mjs; change values
   there, not here. Scoped to pages that render \`data-pw\` (dialogs portal to <body> and still inherit them).
   \`--pw-act\` / \`--pw-on-act\` are the main-button pair (D-PW-01: navy as the phone ships). Help, the
   symptom steps and the danger interrupt render \`data-pw-light\` and keep the light values in dark (L11). */
@theme inline {
${theme}
}
:root:has([data-pw]),
:root.dark:has([data-pw-light]) {
${block(L)}
}
:root.dark:has([data-pw]):not(:has([data-pw-light])) {
${block(D)}
}
`);
