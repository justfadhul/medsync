/* eslint-disable no-console -- a CLI pipeline reports to stdout */
/**
 * Founder portrait pipeline (PROMPT-LANDING-S7-FOUNDERS §3).
 *
 *   npx tsx scripts/portraits/normalize.ts
 *
 * Reads the originals in assets/founders-src/ (never publicly served) and the
 * crop boxes in portraits.config.json, and writes:
 *   public/founders/{slug}.jpg          exactly 1200 × 1500, sRGB, q82, no metadata
 *   artifacts/founders-contact-sheet.png original | normalised, with guides
 * and prints each portrait's `blurDataURL` for content/founders.ts.
 *
 * Crop and resize only: no colour filters, no background removal. sharp drops
 * all metadata (EXIF, GPS, ICC) unless told otherwise — never call
 * withMetadata(); these are photos of people. If `{slug}-cutout.png` is ever
 * supplied, it is flattened onto the portrait backdrop before cropping.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const W = 1200;
const H = 1500;
const SRC_DIR = "assets/founders-src";
/** The portrait backdrop token, bg-gray-100 (light). Only used for cutouts. */
const BACKDROP = "#f5f5f5";

interface Entry {
  slug: string;
  src: string;
  box: { left: number; top: number; width: number; height: number };
  /** Measured source y of the top of the head, the chin and the eye-line. */
  landmarks: { headTop: number; chin: number; eye: number };
  note: string;
}

const { portraits } = JSON.parse(
  readFileSync("scripts/portraits/portraits.config.json", "utf8"),
) as {
  portraits: Entry[];
};

const pct = (y: number, e: Entry) => ((y - e.box.top) / e.box.height) * 100;

async function normalise(e: Entry) {
  const src = `${SRC_DIR}/${e.src}`;
  const { width = 0, height = 0 } = await sharp(src).metadata();
  const { left, top, width: bw, height: bh } = e.box;
  if (bw * 5 !== bh * 4) throw new Error(`${e.slug}: box is not 4:5`);
  if (left < 0 || top < 0 || left + bw > width || top + bh > height) {
    throw new Error(`${e.slug}: box leaves the ${width}×${height} image`);
  }

  const cutout = `${SRC_DIR}/${e.slug}-cutout.png`;
  const input = existsSync(cutout) ? sharp(cutout).flatten({ background: BACKDROP }) : sharp(src);
  const jpg = await input
    .extract(e.box)
    .resize(W, H, { kernel: "lanczos3" })
    .toColourspace("srgb")
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  await writeFile(`public/founders/${e.slug}.jpg`, jpg);

  const blur = await sharp(jpg).resize(8, 10).webp({ quality: 40 }).toBuffer();
  return {
    e,
    src,
    width,
    height,
    jpg,
    blurDataURL: `data:image/webp;base64,${blur.toString("base64")}`,
  };
}

type Done = Awaited<ReturnType<typeof normalise>>;

const ROW_H = 480;
const RIGHT_W = (ROW_H * 4) / 5;
const LABEL_H = 40;
const PAD = 24;

/** One row: the original with its crop box, then the result with the framing guides. */
async function row(d: Done, leftW: number) {
  const { e } = d;
  const s = ROW_H / d.height;
  const ow = Math.round(d.width * s);
  const original = await sharp(d.src).resize(ow, ROW_H).toBuffer();
  const box = `<svg xmlns="http://www.w3.org/2000/svg" width="${ow}" height="${ROW_H}"><rect x="${e.box.left * s}" y="${e.box.top * s}" width="${e.box.width * s}" height="${e.box.height * s}" fill="none" stroke="#00e5ff" stroke-width="2"/></svg>`;

  const y = (p: number) => (p / 100) * ROW_H;
  const head = pct(e.landmarks.chin, e) - pct(e.landmarks.headTop, e);
  const line = (at: number, colour: string, label: string, dash = "") =>
    `<line x1="0" x2="${RIGHT_W}" y1="${y(at)}" y2="${y(at)}" stroke="${colour}" stroke-width="2" stroke-dasharray="${dash}"/>` +
    `<text x="6" y="${y(at) - 5}" font-family="sans-serif" font-size="13" fill="${colour}" stroke="#000" stroke-width="0.3">${label}</text>`;
  const guides =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${RIGHT_W}" height="${ROW_H}">` +
    line(pct(e.landmarks.headTop, e), "#00e5ff", `top of head · head ${head.toFixed(1)}%`) +
    line(pct(e.landmarks.chin, e), "#00e5ff", "chin") +
    line(38, "#ffd400", `eye-line 38% (actual ${pct(e.landmarks.eye, e).toFixed(1)}%)`, "8 6") +
    `</svg>`;
  const normalised = await sharp(d.jpg).resize(RIGHT_W, ROW_H).toBuffer();

  const label =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${leftW + PAD + RIGHT_W}" height="${LABEL_H}">` +
    `<text x="0" y="16" font-family="sans-serif" font-size="15" font-weight="bold" fill="#171717">${e.slug} — box ${e.box.left},${e.box.top} ${e.box.width}×${e.box.height} (${(W / e.box.width).toFixed(2)}× upscale)</text>` +
    `<text x="0" y="34" font-family="sans-serif" font-size="12" fill="#404040">${e.note}</text></svg>`;

  return [
    { input: Buffer.from(label), left: 0, top: 0 },
    { input: original, left: 0, top: LABEL_H },
    { input: Buffer.from(box), left: 0, top: LABEL_H },
    { input: normalised, left: leftW + PAD, top: LABEL_H },
    { input: Buffer.from(guides), left: leftW + PAD, top: LABEL_H },
  ];
}

async function main() {
  await mkdir("public/founders", { recursive: true });
  await mkdir("artifacts", { recursive: true });
  const done = await Promise.all(portraits.map(normalise));

  const leftW = Math.max(...done.map((d) => Math.round((d.width * ROW_H) / d.height)));
  const rowH = LABEL_H + ROW_H + PAD;
  const layers = (await Promise.all(done.map((d) => row(d, leftW)))).flatMap((r, i) =>
    r.map((l) => ({ ...l, left: l.left + PAD, top: l.top + PAD + i * rowH })),
  );
  await sharp({
    create: {
      width: PAD * 3 + leftW + RIGHT_W,
      height: PAD + done.length * rowH,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite(layers)
    .png()
    .toFile("artifacts/founders-contact-sheet.png");

  for (const { e, jpg, blurDataURL } of done) {
    const head = pct(e.landmarks.chin, e) - pct(e.landmarks.headTop, e);
    console.log(
      `${e.slug}: box ${e.box.left},${e.box.top} ${e.box.width}×${e.box.height} · ` +
        `${(W / e.box.width).toFixed(2)}× upscale · head ${head.toFixed(1)}% · ` +
        `eye ${pct(e.landmarks.eye, e).toFixed(1)}% · ${jpg.length} B\n  blurDataURL: "${blurDataURL}"`,
    );
  }
  console.log("contact sheet: artifacts/founders-contact-sheet.png");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
