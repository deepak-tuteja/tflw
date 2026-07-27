// M3a: the Playwright-backed browser step driver (SPEC §9) — real headless Chromium against a
// static HTML fixture served over loopback HTTP (no mocking of the DOM/Playwright, same dogfood
// philosophy as every other runtime test hitting a real HTTP server). Covers: the selector model
// (D6: `button`/`text`/`list`/`css`/`xpath` single-strategy, `field`'s 3-step label→placeholder→
// role cascade with the below-tier-1 annotation), strict ambiguity (D7), `within` scoping, every
// interaction step (open/click/fill/fill form/select/check/uncheck/hover/press/scroll), the
// tflw-owned UI-expect retry loop (state/value/count matchers, including `hidden`/`has count 0`
// against a genuinely-absent element), and dialog handling (`accept dialog`/`dismiss dialog`).
//
// M3b adds: `within frame` (a real cross-origin-free `<iframe>`, traversed via
// `Locator.contentFrame()`), tabs (`switch to new tab`/`switch to tab N`/`close tab` against a
// real `target="_blank"` popup), `download as <name>` (a real `Content-Disposition: attachment`
// response), `drag … to …` (a hand-rolled two-item reorder list with real `dragstart`/`dragover`/
// `drop` listeners — the same "fully known behavior" fixture philosophy as testFlow-tests' webV2),
// `drop file … onto …` (a real dropzone with no `<input type="file">`, fed an actual on-disk file's
// bytes), and `wait until <ui condition>`.

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { BrowserManager, BrowserPageState } from '../src/browser.js';
import { startFixtureServer, testConfig, json, type FixtureServer } from './support.js';
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

  <iframe id="payment-frame" src="/frame" title="payment"></iframe>

  <a href="/tab2" target="_blank">Open in new tab</a>

  <a href="/download">Download report</a>

  <ul id="reorder-list" aria-label="Reorder items">
    <li draggable="true" data-name="First">First item</li>
    <li draggable="true" data-name="Second">Second item</li>
  </ul>
  <p id="order-status">First, Second</p>

  <div id="dropzone">Drop files here</div>
  <p id="dropzone-status">no file</p>

  <button id="fetch-orders" onclick="fetch('/api/orders').then(function () { document.getElementById('fetch-status').textContent = 'done'; })">Fetch orders</button>
  <p id="fetch-status">idle</p>

  <button id="pay" onclick="fetch('/api/payments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount: 10 }) }).then(function (r) { return r.json(); }).then(function (j) { document.getElementById('pay-status').textContent = j.error ? ('error:' + j.error) : ('approved:' + j.approved); })">Pay</button>
  <p id="pay-status">idle</p>

  <script>
    (function () {
      var list = document.getElementById('reorder-list');
      var dragged = null;
      list.addEventListener('dragstart', function (e) { dragged = e.target; });
      list.addEventListener('dragover', function (e) { e.preventDefault(); });
      list.addEventListener('drop', function (e) {
        e.preventDefault();
        var target = e.target.closest('li');
        if (target && dragged && target !== dragged) {
          var draggedNext = dragged.nextSibling;
          var targetNext = target.nextSibling;
          target.parentNode.insertBefore(dragged, targetNext);
          dragged.parentNode.insertBefore(target, draggedNext);
        }
        var names = Array.prototype.map.call(list.querySelectorAll('li'), function (li) { return li.dataset.name; });
        document.getElementById('order-status').textContent = names.join(', ');
      });

      var dz = document.getElementById('dropzone');
      dz.addEventListener('dragover', function (e) { e.preventDefault(); });
      dz.addEventListener('drop', function (e) {
        e.preventDefault();
        var file = e.dataTransfer.files[0];
        document.getElementById('dropzone-status').textContent = file ? file.name : 'no file';
      });
    })();
  </script>
</body>
</html>`;

const FRAME_HTML = `<!doctype html>
<html>
<body>
  <button id="frame-btn">Frame button</button>
  <p id="frame-status">untouched</p>
  <script>
    document.getElementById('frame-btn').addEventListener('click', function () {
      document.getElementById('frame-status').textContent = 'clicked';
    });
  </script>
</body>
</html>`;

const TAB2_HTML = `<!doctype html>
<html>
<body>
  <h1>Second tab</h1>
</body>
</html>`;

// M3e: a genuinely clean page (proper landmark, labelled input, real axe-core run confirms 0
// violations) and a genuinely broken one (confirmed via a real scan to produce exactly 5
// violations: `image-alt`/`label` at critical, `color-contrast` at serious, `landmark-one-main`/
// `region` at moderate) — real markup, not a mocked scan result, so severity-floor filtering is
// exercised against real axe-core output.
const A11Y_CLEAN_HTML = `<!doctype html>
<html lang="en">
<head><title>Accessible page</title></head>
<body>
  <main>
    <h1>Accessible page</h1>
    <label for="name">Name</label>
    <input id="name" type="text" />
    <button type="button">Submit</button>
  </main>
</body>
</html>`;

const A11Y_BAD_HTML = `<!doctype html>
<html lang="en">
<head><title>Broken page</title></head>
<body>
  <h1>Broken page</h1>
  <img src="/nonexistent.png" />
  <input type="text" />
  <button style="color:#eeeeee;background:#ffffff;">Ghost button</button>
</body>
</html>`;

// A `label`-rule (critical) violation that fixes itself 400ms after load — proves
// `execA11yExpect` re-scans on every poll rather than judging the page once against a stale DOM,
// the same "current state every time" property `execUiExpect` already has for its locator.
const A11Y_DYNAMIC_HTML = `<!doctype html>
<html lang="en">
<head><title>Dynamic page</title></head>
<body>
  <main>
    <h1>Dynamic page</h1>
    <input id="field" type="text" />
  </main>
  <script>
    setTimeout(function () { document.getElementById('field').setAttribute('aria-label', 'Name'); }, 400);
  </script>
</body>
</html>`;

// M3c: served on the *first* request only (a real deterministic "fails once, then passes" fixture
// — same closure-counter technique M2.65's session-retry test used against a real HTTP handler,
// not a mock) — the button `retry`'s two attempts are looking for isn't there until the second
// `open "/flaky"` (a fresh `retry` attempt re-runs the whole test body, including `open`).
let flakyRequests = 0;
const FLAKY_HTML = (label: string) => `<!doctype html><html><body><button>${label}</button></body></html>`;

let server: FixtureServer;
let config: ResolvedConfig;
let browserManager: BrowserManager;

before(async () => {
  server = await startFixtureServer({
    '/': (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(FIXTURE_HTML),
    '/frame': (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(FRAME_HTML),
    '/tab2': (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(TAB2_HTML),
    '/download': (_req, res) =>
      res.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="report.csv"' }).end('a,b\n1,2\n'),
    '/flaky': (_req, res) => {
      flakyRequests++;
      res.writeHead(200, { 'content-type': 'text/html' }).end(FLAKY_HTML(flakyRequests === 1 ? 'Missing Button' : 'Add to cart'));
    },
    // M3d: two real endpoints the fixture page's own buttons call via `fetch` — network
    // observation reads the browser's real traffic, so there must be real traffic to observe.
    '/api/orders': (_req, res) => json(res, 200, { status: 'created', items: [{ id: 1 }] }),
    '/api/payments': (req, res) => json(res, 200, { approved: true, method: req.method }),
    // M3e: real accessible/inaccessible pages for `expect page has no … a11y violations`.
    '/a11y-clean': (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(A11Y_CLEAN_HTML),
    '/a11y-bad': (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(A11Y_BAD_HTML),
    '/a11y-dynamic': (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(A11Y_DYNAMIC_HTML),
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
  within css "ul[aria-label='Cart items'] li:first-child"
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

// ---- M3b: frames / tabs / downloads / drag-drop / wait until <ui> ---------

test('`within frame` traverses into a real `<iframe>`\'s own document via `contentFrame()`', async () => {
  const { report } = await run(`test "frame traversal"
  open "/"
  within frame css "#payment-frame"
    click button "Frame button"
    expect text "clicked" is visible
`);
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const steps = report.tests[0]!.steps;
  assert.deepEqual(
    steps.map((s) => s.kind),
    ['open', 'click', 'expect', 'within'],
  );
});

test('tabs: `switch to new tab` catches a real `target="_blank"` popup, `switch to tab N` and `close tab` move between them', async () => {
  const { report } = await run(`test "tabs"
  open "/"
  switch to new tab
    click text "Open in new tab"
  expect text "Second tab" is visible
  switch to tab 1
  expect button "Add to cart" is visible
  switch to tab 2
  close tab
  expect button "Add to cart" is visible
`);
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const steps = report.tests[0]!.steps;
  assert.deepEqual(
    steps.map((s) => s.kind),
    ['open', 'click', 'switchTab', 'expect', 'switchTab', 'expect', 'switchTab', 'closeTab', 'expect'],
  );
});

test('closing the only remaining tab is a runtime error, not a silent no-op', async () => {
  const { report } = await run('test "close last tab"\n  open "/"\n  close tab\n');
  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /only tab open/);
});

test('`switch to tab N` out of range is a clear error', async () => {
  const { report } = await run('test "bad tab index"\n  open "/"\n  switch to tab 2\n');
  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /no tab 2 — 1 tab\(s\) currently open/);
});

test('`download as <name>` captures a real `Content-Disposition: attachment` response\'s suggested filename', async () => {
  const { report } = await run(`test "download"
  open "/"
  download as file
    click text "Download report"
`);
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const steps = report.tests[0]!.steps;
  assert.deepEqual(
    steps.map((s) => s.kind),
    ['open', 'click', 'download'],
  );
  assert.match(steps[2]!.detail ?? '', /file = "report\.csv" \(downloaded\)/);
});

test('`drag … to …` dispatches a real dragstart/dragenter/dragover/drop sequence a hand-rolled reorder list actually listens for', async () => {
  const { report } = await run(`test "drag reorder"
  open "/"
  drag text "First item" to text "Second item"
  expect text "Second, First" is visible
`);
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const steps = report.tests[0]!.steps;
  assert.deepEqual(
    steps.map((s) => s.kind),
    ['open', 'drag', 'expect'],
  );
});

test('`drop file … onto …` builds a real in-page `File` from actual on-disk bytes for a dropzone with no `<input type="file">`', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-dropfile-'));
  try {
    await writeFile(join(dir, 'receipt.txt'), 'hello from disk');
    const { program, diagnostics } = parseSource(`test "drop file"
  open "/"
  drop file "./receipt.txt" onto css "#dropzone"
  expect text "receipt.txt" is visible
`);
    assert.deepEqual(diagnostics, []);
    const { report } = await runProgram(program, config, { source: 'x', browserManager, baseDir: dir });
    assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('`wait until <ui condition>` polls against `timeout wait`, not `timeout expect`, and always hard-fails on exhaustion', async () => {
  const { report } = await run(`test "wait until ui"
  open "/"
  wait until button "Add to cart" is enabled
`);
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  assert.equal(report.tests[0]!.steps[1]!.kind, 'wait');
});

test('`wait until <ui condition>` that never becomes true fails after the wait timeout (not the shorter expect one)', async () => {
  const shortWaitConfig: ResolvedConfig = { ...config, timeouts: { ...config.timeouts, wait: 300 } };
  const { program } = parseSource(`test "never enabled"
  open "/"
  wait until button "Disabled button" is enabled
`);
  const { report } = await runProgram(program, shortWaitConfig, { source: 'x', browserManager });
  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /expected .*to be enabled/);
});

// ---- M3c: screenshot step, failure screenshots, trace-on-failure/retry, engine/viewport --------

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // \x89PNG
const ZIP_MAGIC = Buffer.from('PK'); // every Playwright trace is a real zip archive

test('`screenshot "..."` captures the active page and attaches real PNG bytes to its own step', async () => {
  const { report } = await run(`test "explicit screenshot"
  open "/"
  screenshot "landing page"
`);
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const step = report.tests[0]!.steps[1]!;
  assert.equal(step.kind, 'screenshot');
  assert.match(step.detail ?? '', /landing page/);
  assert.ok(step.screenshot, 'expected a screenshot asset on the step');
  assert.ok(Buffer.from(step.screenshot!.base64, 'base64').subarray(0, 4).equals(PNG_MAGIC));
});

test('a failing UI step automatically attaches a failure screenshot, without masking the real error', async () => {
  const shortWaitConfig: ResolvedConfig = { ...config, timeouts: { ...config.timeouts, wait: 300 } };
  const { program } = parseSource(`test "never enabled, screenshot on failure"
  open "/"
  wait until button "Disabled button" is enabled
`);
  const { report } = await runProgram(program, shortWaitConfig, { source: 'x', browserManager });
  assert.equal(report.ok, false);
  const failedStep = report.tests[0]!.steps.at(-1)!;
  assert.equal(failedStep.ok, false);
  assert.ok(failedStep.screenshot, 'expected a best-effort failure screenshot');
  assert.ok(Buffer.from(failedStep.screenshot!.base64, 'base64').subarray(0, 4).equals(PNG_MAGIC));
});

test('a clean, single-attempt passing test never captures a trace', async () => {
  const { report } = await run(`test "clean pass"
  open "/"
  click button "Add to cart"
`);
  assert.equal(report.ok, true);
  assert.equal(report.tests[0]!.trace, undefined);
});

test('a failing test captures a real Playwright trace archive', async () => {
  const shortWaitConfig: ResolvedConfig = { ...config, timeouts: { ...config.timeouts, wait: 300 } };
  const { program } = parseSource(`test "fails with trace"
  open "/"
  wait until button "Disabled button" is enabled
`);
  const { report } = await runProgram(program, shortWaitConfig, { source: 'x', browserManager });
  assert.equal(report.ok, false);
  assert.ok(report.tests[0]!.trace, 'expected a trace on the failing attempt');
  assert.ok(Buffer.from(report.tests[0]!.trace!.base64, 'base64').subarray(0, 2).equals(ZIP_MAGIC));
});

test('a `retry` test that fails then passes captures a trace on both attempts (D12: failure + every retry)', async () => {
  flakyRequests = 0; // this test owns `/flaky`'s request count — reset so no other test can skew it
  // Short `step` timeout: attempt 1's click genuinely never finds "Add to cart" (not ambiguity, a
  // real absence) — `resolveLocator` polls for the full `timeout step` budget before giving up.
  const shortStepConfig: ResolvedConfig = { ...config, timeouts: { ...config.timeouts, step: 300 } };
  const source = `test "flaky then ok" retry 1
  open "/flaky"
  click button "Add to cart"
`;
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);
  const { report } = await runProgram(program, shortStepConfig, { source, browserManager });
  const result = report.tests[0]!;
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.flaky, true);
  assert.equal(result.attempts?.length, 2);
  assert.equal(result.attempts![0]!.ok, false); // attempt 1: "Missing Button", no match yet
  assert.ok(result.attempts![0]!.trace, 'expected a trace on the failing first attempt');
  assert.ok(result.attempts![1]!.ok); // attempt 2: "Add to cart" now present
  assert.ok(result.attempts![1]!.trace, 'expected a trace on the retry attempt, even though it passed');
  // The kept (final) `TestResult.trace` mirrors the last attempt's, same as `steps` already does.
  assert.equal(result.trace?.base64, result.attempts![1]!.trace?.base64);
});

test('engine selection: a `BrowserManager({ engine: "firefox" })` runs real Firefox end-to-end', async () => {
  const firefoxManager = new BrowserManager({ engine: 'firefox' });
  try {
    const { program, diagnostics } = parseSource(`test "firefox smoke"
  open "/"
  click button "Add to cart"
`);
    assert.deepEqual(diagnostics, []);
    const { report } = await runProgram(program, config, { source: 'x', browserManager: firefoxManager });
    assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
    assert.equal(report.browserEngine, 'firefox');
  } finally {
    await firefoxManager.close();
  }
});

test('`RunReport.browserEngine` defaults to chromium for the shared test manager', async () => {
  const { report } = await run(`test "engine default"
  open "/"
`);
  assert.equal(report.browserEngine, 'chromium');
});

test('`viewport` config sizes every new browser context', async () => {
  const viewportManager = new BrowserManager({ viewport: { width: 500, height: 400 } });
  try {
    const page = await new BrowserPageState().ensurePage(viewportManager);
    assert.deepEqual(page.viewportSize(), { width: 500, height: 400 });
  } finally {
    await viewportManager.close();
  }
});

// ---- M3d: network observation + `stub` -------------------------------------

test('`expect request to "..." was made` passes once a real `fetch` the page issued completes', async () => {
  const { report } = await run(`test "network observed"
  open "/"
  click button "Fetch orders"
  expect request to "/api/orders" was made
`);
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
});

test('`expect request to "..." was made` fails (after the expect timeout) when no matching request ever happens', async () => {
  const shortExpectConfig: ResolvedConfig = { ...config, timeouts: { ...config.timeouts, expect: 300 } };
  const { program } = parseSource(`test "no fetch"
  open "/"
  expect request to "/api/orders" was made
`);
  const { report } = await runProgram(program, shortExpectConfig, { source: 'x', browserManager });
  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /expected request to "\/api\/orders" to have been made/);
});

test('`expect request to "..." not was made` passes when nothing matching ever fires', async () => {
  const { report } = await run(`test "not made"
  open "/"
  expect request to "/api/nonexistent" not was made
`);
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
});

test('`with method "..."` narrows the match — a GET-only expect against a POST-only endpoint fails', async () => {
  const shortExpectConfig: ResolvedConfig = { ...config, timeouts: { ...config.timeouts, expect: 300 } };
  const { program } = parseSource(`test "method mismatch"
  open "/"
  click button "Pay"
  expect request to "/api/payments" with method "GET" was made
`);
  const { report } = await runProgram(program, shortExpectConfig, { source: 'x', browserManager });
  assert.equal(report.ok, false, JSON.stringify(report.tests[0], null, 2));
});

test('`with method "..."` matches the real method the browser actually sent', async () => {
  const { report } = await run(`test "method match"
  open "/"
  click button "Pay"
  expect request to "/api/payments" with method "POST" was made
`);
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
});

test('`status`/`header`/`body[...]`/`body text` `of request to "..."` read the matched request\'s real response', async () => {
  const { report } = await run(`test "of request subjects"
  open "/"
  click button "Fetch orders"
  expect status of request to "/api/orders" equals 200
  expect header "content-type" of request to "/api/orders" contains "json"
  expect body.status of request to "/api/orders" equals "created"
  expect body.items[0].id of request to "/api/orders" equals 1
  expect body text of request to "/api/orders" contains "created"
`);
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
});

test('an `of request to "..."` subject with no matching request yet fails cleanly, not a crash', async () => {
  const shortExpectConfig: ResolvedConfig = { ...config, timeouts: { ...config.timeouts, expect: 300 } };
  const { program } = parseSource(`test "of request, no match"
  open "/"
  expect status of request to "/api/orders" equals 200
`);
  const { report } = await runProgram(program, shortExpectConfig, { source: 'x', browserManager });
  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /no matching request has been observed yet/);
});

test('`stub` replaces the real response — the page sees the stubbed body, and the real server never receives the request', async () => {
  // `server` is shared across every test in this file (`before`/`after` are file-scoped) — other
  // tests hit `/api/payments` for real, so `received` accumulates across the whole run; a
  // before/after *count* is the only reliable way to prove this specific request never landed.
  const before = server.received.get('/api/payments')?.length ?? 0;
  const { report } = await run(`test "stub replaces response"
  open "/"
  stub POST "/api/payments" respond status 500 body { error: "boom" }
  click button "Pay"
  expect text "error:boom" is visible
  expect status of request to "/api/payments" equals 500
`);
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  assert.equal(server.received.get('/api/payments')?.length ?? 0, before, 'the real backend must never see a fully-stubbed request');
});

test('`stub`\'s method filter falls through to the real network on a mismatch', async () => {
  const before = server.received.get('/api/payments')?.length ?? 0;
  const { report } = await run(`test "stub method mismatch falls through"
  open "/"
  stub GET "/api/payments" respond status 404
  click button "Pay"
  expect text "approved:true" is visible
`);
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  assert.equal(server.received.get('/api/payments')?.length ?? 0, before + 1, 'a POST should still reach the real backend past a GET-only stub');
});

test('`stub` with no `body` clause responds with just the status code', async () => {
  const { report } = await run(`test "stub no body"
  open "/"
  stub GET "/api/orders" respond status 503
  click button "Fetch orders"
  expect status of request to "/api/orders" equals 503
`);
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
});

// ---- M3e: `expect page has no [<severity>] a11y violations` (axe-core) -----

test('`expect page has no a11y violations` passes against a real, genuinely accessible page', async () => {
  const { report } = await run(`test "a11y clean"
  open "/a11y-clean"
  expect page has no a11y violations
`);
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
});

test('`expect page has no a11y violations` fails against a real broken page, listing real axe-core findings', async () => {
  const shortExpectConfig: ResolvedConfig = { ...config, timeouts: { ...config.timeouts, expect: 300 } };
  const { program } = parseSource(`test "a11y bad"
  open "/a11y-bad"
  expect page has no a11y violations
`);
  const { report } = await runProgram(program, shortExpectConfig, { source: 'x', browserManager });
  assert.equal(report.ok, false);
  const error = report.tests[0]!.error ?? '';
  assert.match(error, /expected page to have no a11y violations, but found 5/);
  assert.match(error, /image-alt/);
  assert.match(error, /\[critical\]/);
});

test('a `<severity>` floor counts that severity and everything worse, not an exact match', async () => {
  const shortExpectConfig: ResolvedConfig = { ...config, timeouts: { ...config.timeouts, expect: 300 } };
  // `/a11y-bad` has 2 critical (image-alt, label), 1 serious (color-contrast), 2 moderate
  // (landmark-one-main, region) — a `serious` floor must also catch the 2 critical ones (3 total),
  // never just the exact-`serious` one, so a worse violation can't quietly slip under the bar.
  const { program } = parseSource(`test "a11y severity floor"
  open "/a11y-bad"
  expect page has no serious a11y violations
`);
  const { report } = await runProgram(program, shortExpectConfig, { source: 'x', browserManager });
  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /found 3/);
});

test('a `critical` floor correctly fails against a page that really does have critical violations', async () => {
  const shortExpectConfig: ResolvedConfig = { ...config, timeouts: { ...config.timeouts, expect: 300 } };
  // Sanity check the floor isn't accidentally inverted (i.e. it would wrongly pass here if
  // `critical` were somehow treated as "exclude critical" instead of "include only critical+").
  const { program } = parseSource(`test "critical floor, real critical violations"
  open "/a11y-bad"
  expect page has no critical a11y violations
`);
  const { report } = await runProgram(program, shortExpectConfig, { source: 'x', browserManager });
  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /found 2/);
});

test('negation: `not has no … violations` passes when the page genuinely has that severity', async () => {
  const { report } = await run(`test "a11y negated"
  open "/a11y-bad"
  expect page not has no critical a11y violations
`);
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
});

test('negation fails cleanly when no violation of that severity exists', async () => {
  const shortExpectConfig: ResolvedConfig = { ...config, timeouts: { ...config.timeouts, expect: 300 } };
  const { program } = parseSource(`test "a11y negated, none to find"
  open "/a11y-clean"
  expect page not has no a11y violations
`);
  const { report } = await runProgram(program, shortExpectConfig, { source: 'x', browserManager });
  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /expected page to have at least one a11y violation, but found none/);
});

test('the a11y expect retries and re-scans, passing once a violation genuinely fixes itself mid-poll', async () => {
  const { report } = await run(`test "a11y self-heals"
  open "/a11y-dynamic"
  expect page has no critical a11y violations
`);
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
});
