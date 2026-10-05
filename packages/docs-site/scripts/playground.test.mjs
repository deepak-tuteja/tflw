// `M270` (`D-M270-5`) — the Playground as a small editor: a transparent textarea over a layer coloured
// by the language's own classifier, a gutter that marks the lines a diagnostic is on, and a list
// whose codes link to their entries on the Diagnostics page.
//
// The alignment case is the one that matters. A misaligned overlay is the classic failure of this
// technique and is invisible to every test that is not a browser: the text a reader sees is the
// layer, the caret and the selection are the textarea's, and if the two drift by a pixel per line
// the caret sits beside the word it is editing. So it is measured — each line of the layer and the
// gutter against where the textarea lays that line out, and a column against the textarea's own font
// metrics — after typing and after the textarea scrolls sideways, with a control proving the
// measure sees a drift.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DIAGNOSTICS } from '@tflw/lang';
import { chromium } from 'playwright';
import { analyze } from '../src/components/editor/analysis.js';
import { serveDist } from './serve-dist.mjs';

const STARTERS = { api: [], browser: [], load: [], mistakes: ['TF011', 'TF014', 'TF030'] };

const withPage = async (run) => {
  const { server, base } = await serveDist();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.goto(`${base}playground/`, { waitUntil: 'load' });
    await page.locator('#pg-source').waitFor({ state: 'visible' });
    await run(page, base);
  } finally {
    await browser.close();
    server.close();
  }
};

const codes = (page) => page.$$eval('.pg-diagnostics .pg-code', (es) => es.map((e) => e.textContent.trim()).sort());

test('each starter loads and checks to the result it is there to show', async () => {
  await withPage(async (page) => {
    assert.deepEqual(await page.$$eval('[data-starter]', (es) => es.map((e) => e.dataset.starter)), Object.keys(STARTERS));
    for (const [id, expected] of Object.entries(STARTERS)) {
      await page.click(`[data-starter=${id}]`);
      assert.equal(await page.getAttribute(`[data-starter=${id}]`, 'aria-pressed'), 'true', id);
      assert.deepEqual(await codes(page), expected, `${id}: ${expected.length === 0 ? 'clean' : expected.join(', ')}`);
      if (expected.length === 0) assert.ok(await page.isVisible('.pg-ok'), `${id}: says it is clean`);
    }
  });
});

test('a mistake typed into the editor is marked on its line, and underlined where it is', async () => {
  await withPage(async (page) => {
    await page.click('[data-starter=api]');
    assert.equal(await page.locator('.pg-marked').count(), 0, 'the starter is clean');
    await page.locator('#pg-source').press('Control+End');
    await page.keyboard.type('  expect statuss equals 200');
    const line = await page.$eval('#pg-source', (t) => t.value.split('\n').length);
    assert.deepEqual(await codes(page), ['TF013']);
    assert.deepEqual(await page.$$eval('.pg-marked', (es) => es.map((e) => Number(e.dataset.line))), [line]);
    assert.ok(await page.locator(`.pg-line[data-line="${line}"] .pg-flagged`).count() > 0, 'the word is underlined');
  });
});

test("every code in the list links to that code's entry on the Diagnostics page", async () => {
  await withPage(async (page, base) => {
    await page.click('[data-starter=mistakes]');
    const hrefs = await page.$$eval('.pg-diagnostics a.pg-code, .pg-scope a', (es) => es.map((e) => e.getAttribute('href')));
    assert.ok(hrefs.length > 30, `only ${hrefs.length} links`);
    await page.goto(`${base}reference/diagnostics`, { waitUntil: 'load' });
    const ids = new Set(await page.$$eval('[id]', (es) => es.map((e) => e.id)));
    for (const href of hrefs) {
      assert.match(href, /^\/tflw\/reference\/diagnostics#tf\d{3}$/);
      assert.ok(ids.has(href.split('#')[1]), `${href} lands on nothing`);
    }
  });
});

/**
 * Where each line of the layer and the gutter sits against where the textarea lays it out, and where
 * one column sits against the textarea's font: every offset over half a pixel, as a sentence.
 */
const drift = () => {
  const ta = document.querySelector('#pg-source');
  const s = getComputedStyle(ta);
  const rect = ta.getBoundingClientRect();
  const lh = parseFloat(s.lineHeight);
  const top = rect.top + parseFloat(s.borderTopWidth) + parseFloat(s.paddingTop) - ta.scrollTop;
  const left = rect.left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft) - ta.scrollLeft;
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${s.fontSize} ${s.fontFamily}`;
  const out = [];
  const lines = ta.value.split('\n');
  lines.forEach((text, i) => {
    const want = top + i * lh;
    const layer = document.querySelector(`.pg-line[data-line="${i + 1}"]`).getBoundingClientRect().top;
    const gutter = document.querySelector(`.pg-num[data-line="${i + 1}"]`).getBoundingClientRect().top;
    if (Math.abs(layer - want) > 0.5) out.push(`line ${i + 1}: layer ${(layer - want).toFixed(1)}px off`);
    if (Math.abs(gutter - want) > 0.5) out.push(`line ${i + 1}: gutter ${(gutter - want).toFixed(1)}px off`);
  });
  // A column: the 30th character of the longest line, read off the layer's own text.
  const longest = lines.reduce((a, b, i) => (b.length > lines[a].length ? i : a), 0);
  const node = document.createTreeWalker(document.querySelector(`.pg-line[data-line="${longest + 1}"]`), NodeFilter.SHOW_TEXT);
  let column = 30;
  for (let n = node.nextNode(); n; n = node.nextNode()) {
    if (column < n.length) {
      const range = document.createRange();
      range.setStart(n, column);
      range.setEnd(n, column + 1);
      const got = range.getBoundingClientRect().left;
      const want = left + ctx.measureText(lines[longest].slice(0, 30)).width;
      if (Math.abs(got - want) > 0.5) out.push(`column 30 of line ${longest + 1}: ${(got - want).toFixed(1)}px off`);
      break;
    }
    column -= n.length;
  }
  return out;
};

test('the coloured layer and the gutter stay on the textarea, after typing and after scrolling sideways', async () => {
  await withPage(async (page) => {
    await page.click('[data-starter=browser]');
    assert.deepEqual(await page.evaluate(drift), [], 'as loaded');
    await page.locator('#pg-source').press('Control+End');
    await page.keyboard.type(`  fill field "Notes" with "${'a long note that runs past the edge of the editor '.repeat(4)}"\n  click button "Save"`);
    assert.deepEqual(await page.evaluate(drift), [], 'after typing');
    const scrolled = await page.$eval('#pg-source', (t) => {
      t.scrollLeft = 240;
      t.dispatchEvent(new Event('scroll'));
      return t.scrollLeft;
    });
    assert.ok(scrolled > 100, `the long line did not make the editor scroll (${scrolled}px)`);
    assert.deepEqual(await page.evaluate(drift), [], 'after scrolling sideways');
  });
});

test('the alignment measure sees a drift: a layer one pixel taller per line is reported', async () => {
  // The control for the case above. A measure that compared the layer with itself would pass every
  // editor; this changes the layer and not the textarea and expects to be told.
  await withPage(async (page) => {
    await page.click('[data-starter=api]');
    await page.addStyleTag({ content: '.pg-layer .pg-line { min-height: 0; line-height: calc(1.6em + 1px) !important; }' });
    const found = await page.evaluate(drift);
    assert.ok(found.some((f) => /^line \d+: layer/.test(f)), JSON.stringify(found));
  });
});

// ---- what the page says it does not check -------------------------------------------------------

/** A probe as the file it is checked as. */
const asFile = (p) => (p.wrap === 'step' ? `test "example"\n${p.source.map((l) => `  ${l}`).join('\n')}\n` : `${p.source.join('\n')}\n`);

test('the codes the page says it cannot show are exactly the ones it cannot, and it shows the rest', async () => {
  const project = DIAGNOSTICS.filter((d) => d.probes?.length && d.probes.every((p) => p.wrap === 'config' || p.needs !== undefined)).map((d) => d.code);
  const run = DIAGNOSTICS.filter((d) => !d.probes?.length).map((d) => d.code);
  assert.ok(project.length > 10 && run.length > 0, 'the derivation found nothing to exclude');
  // Every other code is reported here, for its own probe, by the same function the page calls.
  for (const d of DIAGNOSTICS) {
    if (project.includes(d.code) || run.includes(d.code)) continue;
    const probe = d.probes.find((p) => p.wrap !== 'config' && p.needs === undefined);
    assert.ok(analyze(asFile(probe)).diagnostics.some((x) => x.code === d.code), `${d.code} is not reported by the Playground, and the page does not say so`);
  }
  await withPage(async (page) => {
    const listed = await page.$$eval('.pg-scope a', (es) => es.map((e) => e.textContent.trim()));
    assert.deepEqual(listed, [...project, ...run]);
  });
});
