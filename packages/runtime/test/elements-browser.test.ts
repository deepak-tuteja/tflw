// `M247` `D` (`D1356`) — `element` names drive a real page. Headless Chromium against a loopback
// server, as `browser-steps.test.ts` does: a pass means the declared selector found the node, not
// that a name was looked up.
//
// Three resolutions are covered, because they are three code paths: a file's own element, an
// element declared in an imported file, and an imported *action* whose body uses an element from
// its own file (resolved against that file, not the caller's). The last test is the refusal a run
// gives when nobody ran `tflw check`.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { BrowserManager } from '../src/browser.js';
import { startFixtureServer, testConfig, type FixtureServer } from './support.js';
import { asEntry } from './__helpers__/entry.js';
import { stagedSetup } from '../../../scripts/test-staging.mjs';

const PAGE = `<!doctype html><html><head><title>cart</title></head><body>
  <span data-test="cart-count">0</span>
  <button onclick="const b=document.querySelector('[data-test=cart-count]'); b.textContent=String(Number(b.textContent)+1)">Add to cart</button>
</body></html>`;

let server: FixtureServer;
let browserManager: BrowserManager;
let dir: string;

const setup = stagedSetup(async () => {
  server = await startFixtureServer({ '/': (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE) });
  browserManager = new BrowserManager();
  dir = await mkdtemp(join(tmpdir(), 'tflw-elements-'));
  await writeFile(
    join(dir, 'shared.tflw'),
    ['element cartBadge = css "[data-test=cart-count]"', 'element addButton = button "Add to cart"', '', 'action add one()', '  click addButton', ''].join('\n'),
    'utf8',
  );
});

before(setup.begin);

after(async () => {
  await setup.settled(); // `M237` `A1` — see `scripts/test-staging.mjs`
  await browserManager?.close();
  await server?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function run(source: string) {
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], JSON.stringify(diagnostics));
  return runProgram(program, { ...testConfig(server.baseUrl), webBaseUrl: server.baseUrl }, { source, browserManager, baseDir: dir });
}

test('a file\'s own element drives a click and an assertion', async () => {
  const { report } = await run(
    ['element badge = css "[data-test=cart-count]"', 'element add = button "Add to cart"', '', 'test "own"', '  open "/"', '  click add', '  expect badge has count 1', '  within badge', '    expect text "1" is visible', ''].join('\n'),
  );
  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  const steps = asEntry(report.tests[0], 'functional').steps;
  assert.match(steps[1]!.detail ?? '', /button "Add to cart"/, 'the trace names the declared locator, not the alias');
});

test('an imported element resolves, and an imported action resolves its elements against its own file', async () => {
  const { report } = await run(['import "./shared.tflw"', '', 'test "imported"', '  open "/"', '  add one()', '  add one()', '  within cartBadge', '    expect text "2" is visible', ''].join('\n'));
  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
});

test('an unknown name fails the step with the checker\'s sentence', async () => {
  const { report } = await run(['test "unknown"', '  open "/"', '  click nowhere', ''].join('\n'));
  assert.equal(report.ok, false);
  assert.match(asEntry(report.tests[0], 'functional').error ?? '', /unknown element `nowhere` — declare it once with `element nowhere = css "…"`/);
});
