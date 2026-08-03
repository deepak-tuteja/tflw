#!/usr/bin/env node
/**
 * The tflw brand mark — single source of truth.
 *
 * Everything visual about the mark lives in the GEOMETRY and PALETTE blocks below. Edit a
 * coordinate or a hex value here, run `node scripts/generate-brand-assets.mjs`, and all seven
 * outputs regenerate together. The alternative — seven hand-exported files — drifts the first
 * time anyone nudges a curve, which is exactly what this script exists to prevent.
 *
 * No new dependency: Playwright is already a repo dependency (browser arc), so the SVG → PNG
 * step renders each mark in a real browser at exact pixel dimensions rather than guessing at a
 * rasterizer's idea of stroke geometry.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS_SITE = resolve(HERE, '..');
const REPO_ROOT = resolve(DOCS_SITE, '..', '..');
const PUBLIC = join(DOCS_SITE, 'public');

/* ------------------------------------------------------------------ palette
   No new colors. These are the exact tokens already in
   .vitepress/theme/custom.css — the mark reads the design system rather than
   introducing a parallel one. */

const PALETTE = {
  light: { ink: '#1d1b16', rail: '#9c5f0c' }, // --vp-c-text-1 / --vp-c-brand-1, light
  dark: { ink: '#f2f0ec', rail: '#f2a93b' }, //  --vp-c-text-1 / --vp-c-brand-1, dark
};

/** The plate under every raster output. --vp-c-bg (dark), the site's documented primary
 *  identity. A transparent PNG favicon goes invisible against a white tab strip, so the
 *  rasters bake a ground even though favicon.svg does not need one. */
const PLATE = '#0a0a0b';

/* ----------------------------------------------------------------- geometry

   THE WORDMARK — "Handoff", viewBox 0 0 53 32
   ascender y=5 · x-height y=13 · baseline y=25.9

   One amber path replaces both crossbars, spans t/f/l, then turns down at x=34.6 — the w's own
   first coordinate — and draws the w's opening stroke before releasing into ink at the vertex.
   That release point is what makes it Handoff rather than Rail: the accent becomes a letterform
   instead of stopping next to one.

   The rail carries 3.0 against the letters' 2.6. It is the hero stroke and it is a single
   unbroken path crossing three uprights; at equal weight it read as one more stem. */

const WORDMARK = {
  viewBox: '0 0 53 32',
  // Optical centring. Ink extremes including round caps run x 2.9 → 48.7, whose midpoint is
  // 25.8 against the box's 26.5 — the mark hangs left. Nudged, not re-coordinated, so the path
  // data above still matches the geometry that was reviewed.
  shift: 'translate(0.7 0)',
  inkWidth: 2.6,
  railWidth: 3.0,
  ink: [
    'M9,5 L9,21.6 C9,24.6 10.9,25.9 13.3,25.9', // t — stem and tail, no crossbar (the rail is it)
    'M20,25.9 L20,10.4 C20,7.1 22.1,5.5 25,6', //  f — stem and hook, likewise
    'M30,5 L30,25.9', //                           l
    'M37.6,25.9 L41,15.2 L44.4,25.9 L47.4,13', //  w — picked up mid-stroke, after the handoff
  ],
  rail: 'M4.4,13 L34.6,13 L37.6,25.9',
};

/*  THE GLYPH — viewBox 0 0 32 32

    The square companion, and the only mark small enough to be a favicon: the t and f from the
    wordmark, refitted square, sharing one merged amber crossbar. Same device as the wordmark's
    rail, same two-tone system, one letter pair instead of four.

    This reverses the first attempt, and the reason is worth keeping. The glyph was originally
    an ABSTRACTION — three uprights crossed by a rail that turned and descended, on the theory
    that a mark which isn't asking to be read as text can't fail at being read as text. Rendered
    at an actual 16px against actual tab-strip colors, every variant of it (2 bars, 3 bars,
    heavier, on a plate, with and without the descending turn) read as a fence or a gate, and
    the descender turned it into a playground slide. The letterforms read better than the
    abstraction of them, because the t's tail and the f's hook are the features doing the
    identifying — strip them and what remains is generic by construction.

    Weights run heavier than the wordmark's (3.0 / 3.4 vs 2.6 / 3.0): a stroke loses
    proportionally more to antialiasing at 16px than at nav size. */

const GLYPH = {
  viewBox: '0 0 32 32',
  inkWidth: 3.0,
  railWidth: 3.4,
  ink: [
    'M10.5,5.4 L10.5,21.6 C10.5,24.7 12.4,26 14.8,26', // t — the tail is half the identification
    'M21.5,26 L21.5,10.4 C21.5,7 23.5,5.4 26.4,5.9', //   f — the hook is the other half
  ],
  // Overhangs both stems, as a crossbar serving two letters has to.
  rail: 'M5.4,13.4 L27,13.4',
};

/* ------------------------------------------------------------------ builders */

const attrs = (o) =>
  Object.entries(o)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');

const open = (viewBox, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${extra ? ' ' + extra : ''}>`;

/** The wordmark in one fixed color pair — VitePress swaps two files rather than switching one,
 *  because its light/dark toggle is a manual class flip that a media query inside the SVG
 *  cannot see. */
function wordmarkSvg({ ink, rail }) {
  const strokes = attrs({ fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  return [
    open(WORDMARK.viewBox, 'role="img" aria-label="tflw"'),
    `<g ${strokes} transform="${WORDMARK.shift}">`,
    `<g stroke="${ink}" stroke-width="${WORDMARK.inkWidth}">`,
    ...WORDMARK.ink.map((d) => `<path d="${d}"/>`),
    `</g>`,
    `<path d="${WORDMARK.rail}" stroke="${rail}" stroke-width="${WORDMARK.railWidth}"/>`,
    `</g>`,
    `</svg>`,
  ].join('\n');
}

/** Glyph body, given explicit colors. Shared by every raster output. */
function glyphBody({ ink, rail }, transform = '') {
  const strokes = attrs({ fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  return [
    `<g ${strokes}${transform ? ` transform="${transform}"` : ''}>`,
    `<g stroke="${ink}" stroke-width="${GLYPH.inkWidth}">`,
    ...GLYPH.ink.map((d) => `<path d="${d}"/>`),
    `</g>`,
    `<path d="${GLYPH.rail}" stroke="${rail}" stroke-width="${GLYPH.railWidth}"/>`,
    `</g>`,
  ].join('\n');
}

/** favicon.svg — one transparent file serving both OS themes. A browser tab cannot see the
 *  site's own light/dark toggle, only the OS preference, so an embedded media query is the
 *  correct mechanism here even though themeConfig.logo needs two files. */
function faviconSvg() {
  return [
    open(GLYPH.viewBox, 'role="img" aria-label="tflw"'),
    `<style>`,
    `.ink{stroke:${PALETTE.light.ink}}.rail{stroke:${PALETTE.light.rail}}`,
    `@media (prefers-color-scheme:dark){.ink{stroke:${PALETTE.dark.ink}}.rail{stroke:${PALETTE.dark.rail}}}`,
    `</style>`,
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">`,
    `<g class="ink" stroke-width="${GLYPH.inkWidth}">`,
    ...GLYPH.ink.map((d) => `<path d="${d}"/>`),
    `</g>`,
    `<path class="rail" d="${GLYPH.rail}" stroke-width="${GLYPH.railWidth}"/>`,
    `</g>`,
    `</svg>`,
  ].join('\n');
}

/** Glyph on a baked plate, for rasterizing. `radius` is in viewBox units; `inset` shrinks the
 *  mark inside the plate (iOS crops to its own squircle, so its icon needs the breathing room
 *  a browser tab does not). */
function platedGlyphSvg({ radius = 6, inset = 1 } = {}) {
  const t =
    inset === 1 ? '' : `translate(${(32 * (1 - inset)) / 2} ${(32 * (1 - inset)) / 2}) scale(${inset})`;
  return [
    open(GLYPH.viewBox),
    `<rect x="0" y="0" width="32" height="32"${radius ? ` rx="${radius}"` : ''} fill="${PLATE}"/>`,
    glyphBody(PALETTE.dark, t),
    `</svg>`,
  ].join('\n');
}

/* ------------------------------------------------------------------ raster */

async function rasterize(browser, svg, size, outPath) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  const sized = svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent">${sized}</body>`,
  );
  const buf = await page.screenshot({
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  });
  await writeFile(outPath, buf);
  await page.close();
  return buf;
}

/** Decode the bytes rather than trusting that the screenshot call returned — the same
 *  "verify the artifact, not the step" precedent as testFlow-tests' verify-screenshot-step.mjs.
 *  Reads the PNG signature and the IHDR width/height, no dependency needed. */
function assertPng(buf, size, label) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error(`${label}: not a PNG (bad signature)`);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (w !== size || h !== size) throw new Error(`${label}: expected ${size}×${size}, got ${w}×${h}`);
  if (buf.length < 200) throw new Error(`${label}: suspiciously small (${buf.length} bytes)`);
  return `${w}×${h}, ${buf.length} bytes`;
}

/* ------------------------------------------------------------------ main */

async function main() {
  await mkdir(PUBLIC, { recursive: true });
  const written = [];

  const vectors = [
    [join(PUBLIC, 'favicon.svg'), faviconSvg()],
    [join(PUBLIC, 'logo-light.svg'), wordmarkSvg(PALETTE.light)],
    [join(PUBLIC, 'logo-dark.svg'), wordmarkSvg(PALETTE.dark)],
  ];

  for (const [path, svg] of vectors) {
    if (!svg.trim()) throw new Error(`${path}: empty SVG`);
    await writeFile(path, svg + '\n', 'utf8');
    written.push([path, `${svg.length} bytes`]);
  }

  const browser = await chromium.launch();
  try {
    const tab = platedGlyphSvg({ radius: 6 });
    // iOS applies its own squircle mask; pre-rounding double-masks, and a full-bleed mark gets
    // its corners clipped. Square plate, mark inset to 74%.
    const ios = platedGlyphSvg({ radius: 0, inset: 0.74 });

    const rasters = [
      [join(PUBLIC, 'favicon-16.png'), tab, 16],
      [join(PUBLIC, 'favicon-32.png'), tab, 32],
      [join(PUBLIC, 'apple-touch-icon.png'), ios, 180],
      [join(REPO_ROOT, 'packages', 'vscode', 'icon.png'), platedGlyphSvg({ radius: 24 }), 128],
    ];

    for (const [path, svg, size] of rasters) {
      const buf = await rasterize(browser, svg, size, path);
      written.push([path, assertPng(buf, size, relative(REPO_ROOT, path))]);
    }
  } finally {
    await browser.close();
  }

  console.log('tflw brand mark — regenerated\n');
  for (const [path, detail] of written) {
    console.log(`  ${relative(REPO_ROOT, path).padEnd(44)} ${detail}`);
  }
  console.log(`\n${written.length} files written.`);
}

main().catch((err) => {
  console.error(`\ngenerate-brand-assets failed: ${err.message}\n`);
  process.exitCode = 1;
});
