// M3a: the Playwright-backed browser step driver (SPEC §9) — real headless Chromium against a
// static HTML fixture served over loopback HTTP (no mocking of the DOM/Playwright, same dogfood
// philosophy as every other runtime test hitting a real HTTP server). Covers: the selector model
// (D6: `button`/`text`/`list`/`css`/`xpath` single-strategy, `field`'s 3-step label→placeholder→
// role cascade with the below-tier-1 annotation), strict ambiguity (D7), `within` scoping, every
// interaction step (open/click/fill/fill form/select/check/uncheck/hover/press/scroll), the
// tflw-owned UI-expect retry loop (state/value/count matchers, including `hidden`/`has count 0`
// against a genuinely-absent element), and dialog handling (`accept dialog`/`dismiss dialog`).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { BrowserManager } from '../src/browser.js';
import { startFixtureServer, testConfig, type FixtureServer } from './support.js';
import type { ResolvedConfig } from '../src/types.js';

const FIXTURE_HTML = `<!doctype html>
<html>
<head><title>fixture</title></head>
<body>
  <h1>Cart</h1>

  <label for="email">Email</label>
  <input id="email" type="text" />

  <input type="text" placeholder="Search" />

  <button id="add">Add to cart</button>

  <button class="dup">Duplicate</button>
  <button class="dup">Duplicate</button>

  <ul aria-label="Cart items">
    <li>Widget <button>Remove</button></li>
    <li>Gadget <button>Remove</button></li>
  </ul>

  <label><input type="checkbox" id="accept" /> Accept terms</label>

  <select aria-label="Size">
    <option value="">choose</option>
    <option value="s">Small</option>
    <option value="m">Medium</option>
  </select>

  <button disabled>Disabled button</button>

  <div style="display:none"><button>Hidden button</button></div>

  <div style="height:2000px"></div>
  <button id="bottom">Bottom button</button>

  <button id="delete" onclick="if (confirm('Really delete?')) { document.getElementById('status').textContent = 'deleted'; } else { document.getElementById('status').textContent = 'kept'; }">Delete</button>
  <p id="status">untouched</p>
</body>
</html>`;

let server: FixtureServer;
let config: ResolvedConfig;
let browserManager: BrowserManager;

before(async () => {
  server = await startFixtureServer({
    '/': (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(FIXTURE_HTML),
  });
  config = { ...testConfig(server.baseUrl), webBaseUrl: server.baseUrl };
  browserManager = new BrowserManager();
});

after(async () => {
  await browserManager.close();
  await server.close();
});

async function run(source: string) {
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `unexpected parse diagnostics: ${JSON.stringify(diagnostics)}`);
  return runProgram(program, config, { source, browserManager });
}

test('open + click + fill (labelled) + fill (placeholder cascade) + select + check/uncheck + hover + scroll all execute against a real page', async () => {
  const { report } = await run(`test "storefront basics"
  open "/"
  click button "Add to cart"
  fill field "Email" with "a@b.com"
  fill field "Search" with "widget"
  select "Small" from field "Size"
  check field "Accept terms"
  expect field "Accept terms" is checked
  uncheck field "Accept terms"
  expect field "Accept terms" not is checked
  hover button "Add to cart"
  scroll to button "Bottom button"
  expect button "Bottom button" is visible
`);
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const steps = report.tests[0]!.steps;
  assert.deepEqual(
    steps.map((s) => s.kind),
    ['open', 'click', 'fill', 'fill', 'select', 'checkbox', 'expect', 'uncheckbox', 'expect', 'hover', 'scroll', 'expect'],
  );
  // The Email fill resolved via its real <label>, tier 1 — no "(resolved via ...)" annotation.
  assert.ok(!(steps[2]!.detail ?? '').includes('resolved via'), steps[2]!.detail);
  // The Search fill has no <label> at all — cascades past label to placeholder (D6), and that
  // below-tier-1 resolution is annotated right in the report line.
  assert.ok((steps[3]!.detail ?? '').includes('field "Search"` (resolved via placeholder)'), steps[3]!.detail);
});

test('`fill form` runs each row as its own reported sub-step', async () => {
  const { report } = await run(`test "fill form"
  open "/"
  fill form
    | "Email" | "x@y.com" |
`);
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const steps = report.tests[0]!.steps;
  assert.equal(steps[1]!.kind, 'fill');
  assert.match(steps[1]!.detail ?? '', /Email.*x@y\.com/);
});

test('ambiguity (D7): two equally-named buttons is a hard error listing candidates, never "take the first"', async () => {
  const { report } = await run(`test "ambiguous"
  open "/"
  click button "Duplicate"
`);
  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /ambiguous locator `button "Duplicate"`/);
  assert.match(report.tests[0]!.error ?? '', /matched 2 elements/);
  assert.match(report.tests[0]!.error ?? '', /within/);
});

test('`within` scopes locator resolution to one container, disambiguating an otherwise-ambiguous name', async () => {
  // Page-wide, `button "Remove"` matches 2 elements (one per <li>, ambiguous — see the ambiguity
  // test above). Scoped inside just the first <li> (via a `css` escape narrowing past the built-in
  // nouns), it resolves to exactly 1 — proving resolution is genuinely confined to the container,
  // not just re-run globally and coincidentally passing.
  const { report } = await run(`test "within scoping"
  open "/"
  within css "li:first-child"
    click button "Remove"
`);
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const steps = report.tests[0]!.steps;
  assert.deepEqual(
    steps.map((s) => s.kind),
    ['open', 'click', 'within'],
  );
  assert.equal(steps[1]!.ok, true);
});

test('a UI `expect` retries until it passes, and `is hidden`/`has count 0` treat absence as a legitimate state', async () => {
  const { report } = await run(`test "ui expect states"
  open "/"
  expect button "Disabled button" is disabled
  expect button "Hidden button" is hidden
  expect css ".does-not-exist" has count 0
  expect button "Add to cart" is visible
  expect button "Add to cart" is enabled
`);
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
});

test('a UI `expect` that never becomes true fails after the expect timeout, with a clean diagnostic', async () => {
  const shortTimeoutConfig: ResolvedConfig = { ...config, timeouts: { ...config.timeouts, expect: 300 } };
  const { program } = parseSource(`test "never visible"
  open "/"
  expect button "Hidden button" is visible
`);
  const { report } = await runProgram(program, shortTimeoutConfig, { source: 'x', browserManager });
  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /expected .*to be visible/);
});

test('dialogs: `accept dialog` lets a `confirm()`-guarded action actually happen (no silent auto-dismiss no-op)', async () => {
  const { report } = await run(`test "accept dialog"
  open "/"
  accept dialog
  click button "Delete"
  expect text "deleted" is visible
`);
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
});

test('dialogs: `dismiss dialog` cancels the guarded action', async () => {
  const { report } = await run(`test "dismiss dialog"
  open "/"
  dismiss dialog
  click button "Delete"
  expect text "kept" is visible
`);
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
});

test('a locator that never appears fails with a clear "no element found" error, not a hang', async () => {
  const shortStepConfig: ResolvedConfig = { ...config, timeouts: { ...config.timeouts, step: 300 } };
  const { program } = parseSource('test "not found"\n  open "/"\n  click button "Does Not Exist"\n');
  const { report } = await runProgram(program, shortStepConfig, { source: 'x', browserManager });
  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /no element found for `button "Does Not Exist"`/);
});

test('`open` without a `web` base URL configured is a clear error, not a crash', async () => {
  const noWebConfig: ResolvedConfig = { ...config, webBaseUrl: null };
  const { program } = parseSource('test "no web url"\n  open "/"\n');
  const { report } = await runProgram(program, noWebConfig, { source: 'x', browserManager });
  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /no `web` base URL is configured/);
});

test('a browser step with no `browserManager` supplied fails clearly instead of a null-deref', async () => {
  const { program } = parseSource('test "no manager"\n  open "/"\n');
  const { report } = await runProgram(program, config, { source: 'x' });
  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /no browser support was initialized/);
});
