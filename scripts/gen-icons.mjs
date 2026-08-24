#!/usr/bin/env node
/**
 * Generate the full app icon set + DMG background from the Slash brand
 * (design-system/BRAND.md, "App icon geometry" + "The 16px exception").
 *
 *   node scripts/gen-icons.mjs
 *
 * Writes into src-tauri/icons/:
 *   icon.icns (via iconutil), icon.ico (PNG-compressed entries), icon.png,
 *   32x32.png, 128x128.png, 128x128@2x.png, StoreLogo.png, Square*Logo.png
 * and src-tauri/icons/dmg-background.png (wired up in tauri.conf.json).
 *
 * The tile is the flat amber square with the ink mark — radius zero is the
 * brand; recent macOS masks Dock icons into its own shape by itself.
 * Sizes below 32px use the single-slash variant: at 16px the two slashes
 * and the gap mush into a grey block (BRAND.md).
 *
 * Deterministic geometry, screenshotted by headless Chrome, resampled with
 * sips, assembled with iconutil — macOS only, like the rest of the brand
 * scripts. The DMG background needs network access for JetBrains Mono.
 */
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ICONS = resolve(HERE, "../src-tauri/icons");
const CHROME =
  process.env.CHROME ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

if (!existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME} (override with CHROME env var)`);
  process.exit(1);
}

const AMBER = "#E8A917";
const INK = "#171208";
const CREAM = "#F7F2E6";

// Canonical tile: design-system/assets/lfm-icon.svg geometry, scaled to any
// square. The translate/scale centres the mark exactly — do not eyeball it.
function tileSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="${AMBER}"/>
  <g transform="translate(8 8) scale(0.48)">
    <polygon points="7,92 37,8 59,8 29,92" fill="${INK}"/>
    <polygon points="45,92 75,8 93,8 63,92" fill="${INK}"/>
  </g>
</svg>`;
}

// The 16px exception: single leading slash (design-system/assets/lfm-icon-16.svg)
function slashTileSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16">
  <rect width="16" height="16" fill="${AMBER}"/>
  <polygon points="4,14 8.3,2 11.8,2 7.5,14" fill="${INK}"/>
</svg>`;
}

function shoot(html, w, h, out) {
  const tmpHtml = resolve(tmpdir(), `lfm-icons-${process.pid}-${w}x${h}-${Math.floor(Math.random() * 1e6)}.html`);
  writeFileSync(tmpHtml, html);
  execFileSync(CHROME, [
    "--headless",
    "--disable-gpu",
    "--force-device-scale-factor=1",
    `--window-size=${w},${h}`,
    `--screenshot=${out}`,
    "--hide-scrollbars",
    "--virtual-time-budget=8000",
    // Transparent page background so the PNG carries an alpha channel —
    // Tauri refuses non-RGBA icons at compile time.
    "--default-background-color=00000000",
    `file://${tmpHtml}`,
  ], { stdio: "ignore" });
  unlinkSync(tmpHtml);
}

function page(svg, w, h) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>*{margin:0}html,body{width:${w}px;height:${h}px;overflow:hidden}svg{display:block}</style></head><body>${svg}</body></html>`;
}

function resample(src, size, out) {
  execFileSync("sips", ["-z", String(size), String(size), src, "--out", out], { stdio: "ignore" });
}

const work = resolve(tmpdir(), `lfm-iconset-${process.pid}`);
mkdirSync(work, { recursive: true });

// ── Master renders: full mark at 1024, single slash at 256 ──
const full1024 = resolve(work, "full-1024.png");
const slash256 = resolve(work, "slash-256.png");
shoot(page(tileSvg(1024), 1024, 1024), 1024, 1024, full1024);
shoot(page(slashTileSvg(256), 256, 256), 256, 256, slash256);

// Force the masters to RGBA (Chrome emits RGB when every pixel is opaque;
// Tauri refuses non-RGBA icons at compile time). sips resamples keep alpha.
execFileSync("python3", ["-c", `
from PIL import Image
import sys
for p in sys.argv[1:]:
    Image.open(p).convert("RGBA").save(p)
`, full1024, slash256]);

const fromFull = (size, out) => resample(full1024, size, out);
const fromSlash = (size, out) => resample(slash256, size, out);

// ── macOS .icns ── 16px slots use the single slash; 32px physical and up,
// the full mark (16@2x is 32 physical pixels).
const iconset = resolve(work, "icon.iconset");
mkdirSync(iconset);
fromSlash(16, resolve(iconset, "icon_16x16.png"));
fromFull(32, resolve(iconset, "icon_16x16@2x.png"));
fromFull(32, resolve(iconset, "icon_32x32.png"));
fromFull(64, resolve(iconset, "icon_32x32@2x.png"));
fromFull(128, resolve(iconset, "icon_128x128.png"));
fromFull(256, resolve(iconset, "icon_128x128@2x.png"));
fromFull(256, resolve(iconset, "icon_256x256.png"));
fromFull(512, resolve(iconset, "icon_256x256@2x.png"));
fromFull(512, resolve(iconset, "icon_512x512.png"));
copyFileSync(full1024, resolve(iconset, "icon_512x512@2x.png"));
execFileSync("iconutil", ["-c", "icns", iconset, "-o", resolve(ICONS, "icon.icns")]);
console.log("wrote icon.icns");

// ── Tauri PNG set ──
copyFileSync(full1024, resolve(ICONS, "icon.png"));
fromFull(32, resolve(ICONS, "32x32.png"));
fromFull(128, resolve(ICONS, "128x128.png"));
fromFull(256, resolve(ICONS, "128x128@2x.png"));

// ── Windows store logos (kept current even though we only ship macOS) ──
for (const size of [30, 44, 71, 89, 107, 142, 150, 284, 310]) {
  fromFull(size, resolve(ICONS, `Square${size}x${size}Logo.png`));
}
fromFull(50, resolve(ICONS, "StoreLogo.png"));
console.log("wrote png set");

// ── icon.ico: PNG-compressed entries (valid since Vista). Below 32px the
// single-slash variant, like the icns. ──
const icoSizes = [
  [16, fromSlashPng(16)],
  [24, fromSlashPng(24)],
  [32, fromFullPng(32)],
  [48, fromFullPng(48)],
  [64, fromFullPng(64)],
  [256, fromFullPng(256)],
];
function fromSlashPng(size) {
  const p = resolve(work, `ico-${size}.png`);
  fromSlash(size, p);
  return readFileSync(p);
}
function fromFullPng(size) {
  const p = resolve(work, `ico-${size}.png`);
  fromFull(size, p);
  return readFileSync(p);
}
{
  const count = icoSizes.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const entries = [];
  const blobs = [];
  let offset = 6 + 16 * count;
  for (const [size, png] of icoSizes) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size === 256 ? 0 : size, 0); // width (0 = 256)
    e.writeUInt8(size === 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
    blobs.push(png);
  }
  writeFileSync(resolve(ICONS, "icon.ico"), Buffer.concat([header, ...entries, ...blobs]));
  console.log("wrote icon.ico");
}

// ── DMG background 660x400: cream ground, lockup, arrow app → Applications.
// Icon positions match bundle.dmg in tauri.conf.json (180,170) → (480,170). ──
{
  const W = 660;
  const H = 400;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@700&display=block" rel="stylesheet"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; }
  body { background: ${CREAM}; position: relative; font-family: 'JetBrains Mono', monospace; }
  /* Lockup per BRAND.md: wordmark 22px -> box 26px, gap 9px */
  #lockup { position: absolute; top: 28px; left: 32px; display: flex; align-items: center; gap: 9px; color: ${INK}; }
  #lockup svg { display: block; margin-left: -1.8px; }
  #lockup span { font-weight: 700; font-size: 22px; letter-spacing: -0.02em; }
</style></head><body>
  <div id="lockup">
    <svg width="26" height="26" viewBox="0 0 100 100" fill="currentColor"><polygon points="7,92 37,8 59,8 29,92"/><polygon points="45,92 75,8 93,8 63,92"/></svg>
    <span>lightning.fm</span>
  </div>
  <svg style="position:absolute;inset:0" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <!-- arrow between the two icon wells at y=170 -->
    <rect x="268" y="166" width="104" height="8" fill="${INK}"/>
    <polygon points="372,152 372,188 404,170" fill="${INK}"/>
  </svg>
</body></html>`;
  shoot(html, W, H, resolve(ICONS, "dmg-background.png"));
  console.log("wrote dmg-background.png");
}

rmSync(work, { recursive: true, force: true });
console.log("done");
