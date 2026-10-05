// `M270` — the four long pages, read the way a reader reads them: by the rail, by a filter, by a link.
//
// `entries.test.mjs`, `grammar.test.mjs` and `site-markdown.test.mjs` hold what each page renders to.
// What only a browser can say is what the reader then gets: which headings the "On this page" rail
// lists, that the Diagnostics filter narrows the page, that a link into a folded Changelog entry
// opens its fold, and that a flag's name is one line. Like `layout.test.mjs`, this drives the BUILT
// site, because the rail is drawn by `route-data.ts` and the scripts exist only in the client bundle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLI_FLAGS, DIAGNOSTICS } from '@tflw/lang';
import { chromium } from 'playwright';
import { OPEN } from '../src/lib/changelog.mjs';
import { serveDist } from './serve-dist.mjs';

const withBrowser = async (run) => {
  const { server, base } = await serveDist();
  const browser = await chromium.launch();
  try {
    await run(browser, base);
  } finally {
    await browser.close();
    server.close();
  }
};
const open = async (browser, url) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto(url, { waitUntil: 'load' });
  return page;
};
/** The rail as the reader sees it: `[depth, text]`, from the desktop "On this page". */
const rail = (page) =>
  page.$$eval('.right-sidebar-panel starlight-toc a', (as) => as.map((a) => [Number(getComputedStyle(a).getPropertyValue('--depth') || 0), a.textContent.trim()]));

test('the Diagnostics rail is an index: six stages, then every code under its stage', async () => {
  await withBrowser(async (browser, base) => {
    const page = await open(browser, `${base}reference/diagnostics`);
    const items = (await rail(page)).map(([, text]) => text);
    assert.equal(items[0], 'Overview');
    assert.deepEqual(items.filter((t) => !/^TF\d{3}/.test(t)).slice(1), ['Lexer', 'Parser', 'Checker', 'Config', 'Load', 'Runtime']);
    assert.deepEqual(items.filter((t) => /^TF\d{3}/.test(t)).map((t) => t.slice(0, 5)).sort(), DIAGNOSTICS.map((d) => d.code).sort());
  });
});

test('the Diagnostics filter narrows the page to what matches, and says how many', async () => {
  await withBrowser(async (browser, base) => {
    const page = await open(browser, `${base}reference/diagnostics`);
    const shown = () => page.$$eval('h3.tflw-entry', (hs) => hs.filter((h) => h.offsetParent !== null).map((h) => h.id));
    const stages = () => page.$$eval('.sl-markdown-content h2', (hs) => hs.filter((h) => h.offsetParent !== null).map((h) => h.id));
    assert.equal((await shown()).length, DIAGNOSTICS.length, 'every entry, before anything is typed');

    await page.fill('#tflw-filter-input', 'tf041');
    assert.deepEqual(await shown(), ['tf041']);
    assert.deepEqual(await stages(), ['checker'], 'a stage with nothing shown is hidden');
    assert.equal(await page.textContent('.tflw-filter output'), `1 of ${DIAGNOSTICS.length} codes`);

    // Every word must match, in any order, anywhere in the entry — its meaning, its snippet, its message.
    await page.fill('#tflw-filter-input', 'session unknown');
    const both = await shown();
    assert.ok(both.length > 0 && both.length < 10, `${both.length} entries for two words`);
    assert.ok(both.includes('tf028'), `TF028 (an unknown session) is not among ${both.join(' ')}`);

    await page.fill('#tflw-filter-input', 'zzzz-no-such-word');
    assert.deepEqual(await shown(), []);
    assert.deepEqual(await stages(), []);

    await page.fill('#tflw-filter-input', '');
    assert.equal((await shown()).length, DIAGNOSTICS.length, 'clearing the box shows everything again');
  });
});

test('the Changelog rail lists the newest entries, then the two folds', async () => {
  await withBrowser(async (browser, base) => {
    const page = await open(browser, `${base}changelog`);
    const items = (await rail(page)).map(([, text]) => text);
    const record = readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8');
    const newest = [...record.matchAll(/^### (.+)$/gm)].slice(0, OPEN).map((m) => m[1].replace(/`/g, ''));
    assert.deepEqual(items, ['Overview', '[Unreleased]', ...newest, 'Earlier changes', ...items.slice(-1)]);
    assert.match(items.at(-1), /^\[0\.1\.0\]/);
    assert.equal(await page.$$eval('details.tflw-fold', (ds) => ds.filter((d) => d.open).length), 0, 'the folds start closed');
  });
});

test('a link to a folded Changelog entry opens its fold and lands on it', async () => {
  await withBrowser(async (browser, base) => {
    const page = await open(browser, `${base}changelog`);
    const id = await page.$eval('details.tflw-fold h3', (h) => h.id);
    // From another page, the way a link from the docs or a bookmark arrives…
    await page.goto(`${base}changelog#${id}`, { waitUntil: 'load' });
    const landed = () =>
      page.$eval(`[id="${id}"]`, (h) => ({ open: h.closest('details').open, top: Math.round(h.getBoundingClientRect().top), height: innerHeight }));
    let at = await landed();
    assert.ok(at.open && at.top >= 0 && at.top < at.height / 2, `on load: ${JSON.stringify(at)}`);
    // …and from a link on the same page, which changes only the hash.
    await page.goto(`${base}changelog`, { waitUntil: 'load' });
    await page.evaluate((target) => {
      location.hash = target;
    }, id);
    await page.waitForFunction((target) => document.getElementById(target).closest('details').open, id);
    at = await landed();
    assert.ok(at.top >= 0 && at.top < at.height / 2, `on hashchange: ${JSON.stringify(at)}`);
  });
});

test("a flag's name is one line on the CLI page, and every flag is there", async () => {
  await withBrowser(async (browser, base) => {
    const page = await open(browser, `${base}reference/cli`);
    // A definition per flag; `--version, -v` is one flag written as two spans, so each span is checked.
    const flags = await page.$$eval('dl.tflw-flags dt', (dts) => dts.map((dt) => ({ text: dt.textContent, lines: Math.max(...[...dt.querySelectorAll('code')].map((c) => c.getClientRects().length)) })));
    assert.equal(flags.length, CLI_FLAGS.length);
    assert.deepEqual(flags.filter((f) => f.lines !== 1).map((f) => f.text), [], 'a flag broken across lines');
  });
});

test('the Grammar page opens on its glances, with every formal grammar folded', async () => {
  await withBrowser(async (browser, base) => {
    const page = await open(browser, `${base}grammar`);
    const folds = await page.$$eval('details.tflw-formal', (ds) => ds.map((d) => d.open));
    assert.equal(folds.length, 12);
    assert.ok(folds.every((o) => !o), 'a fold starts open');
    assert.equal((await rail(page)).length, 13, 'Overview and the twelve sections, nothing more');
  });
});
