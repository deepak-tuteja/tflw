// M125c — `FU-14` (D248/D269) and `FU-21` ≡ `B4-11` (D253/D266-D268), against real headless
// Chromium. The sibling `locator-diagnosis.test.ts` enumerates the message shapes at the pure
// level; this file proves those shapes are the ones a real page actually produces, and is the only
// level that can observe the two properties that matter most here: that the speculative line
// arrives *during* the wait, and that adding it did not move any deadline.
//
// Every measurement below was taken on the Fedora box before a line of the fix was written
// (`M125c` probe). The numbers in the comments are from that run, not from the plan.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { BrowserManager } from '../src/browser.js';
import { startFixtureServer, testConfig, type FixtureServer } from './support.js';
import type { ResolvedConfig, ResolvedTimeouts } from '../src/types.js';

// Two `Save` buttons the suggestion renderer cannot tell apart, which the DOM can tell apart three
// ways: a `data-testid`, an `id`, and an enclosing labelled section.
const DUP_SAVE_HTML = `<!doctype html>
<html><body>
  <section aria-label="Profile"><button data-testid="save-profile">Save</button></section>
  <section aria-label="Billing"><button id="save-billing">Save</button></section>
</body></html>`;

// Twelve identical controls under distinct headings — the storefront shape `FU-21` was measured
// against — plus one genuinely different near-miss that the un-deduped list could never show.
const MANY_CART_HTML = `<!doctype html>
<html><body>
  <ul>
${Array.from({ length: 12 }, (_, i) => `    <li><h3>Product ${i + 1}</h3><button>Add to cart</button></li>`).join('\n')}
  </ul>
  <button>Add to bag</button>
</body></html>`;

// Two controls with no testid, no id, no aria-label and no titled container: the floor of the
// cascade, where the ordinal is genuinely all there is.
const BARE_DUP_HTML = `<!doctype html>
<html><body><div><button>Go</button></div><div><button>Go</button></div></body></html>`;

// Renders its button 4 s in — after the speculative line, well before the step deadline. The whole
// of D248's promise in one fixture: the app is slow, the step still passes.
const SLOW_HTML = `<!doctype html>
<html><body><script>
  setTimeout(function () {
    var b = document.createElement('button');
    b.textContent = 'Checkout';
    document.body.appendChild(b);
  }, 4000);
</script></body></html>`;

let server: FixtureServer;
let browserManager: BrowserManager;

function configWith(timeouts: Partial<ResolvedTimeouts>): ResolvedConfig {
  return { ...testConfig(server.baseUrl, timeouts), webBaseUrl: server.baseUrl };
}

/** `process.emitWarning`-free sibling of the helper in `typeless-module-warning.test.ts`: the
 * speculative line is written straight to stderr (D269), so observing it means owning the stream
 * for the duration of the run. */
async function captureStderr<T>(fn: () => Promise<T>): Promise<{ result: T; stderr: string }> {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  (process.stderr as { write: unknown }).write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  };
  try {
    const result = await fn();
    return { result, stderr: chunks.join('') };
  } finally {
    (process.stderr as { write: unknown }).write = original;
  }
}

async function run(source: string, config: ResolvedConfig) {
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `unexpected parse diagnostics: ${JSON.stringify(diagnostics)}`);
  return runProgram(program, config, { source, browserManager });
}

before(async () => {
  server = await startFixtureServer({
    '/dup-save': (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(DUP_SAVE_HTML),
    '/many-cart': (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(MANY_CART_HTML),
    '/bare-dup': (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(BARE_DUP_HTML),
    '/slow': (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(SLOW_HTML),
  });
  browserManager = new BrowserManager();
});

after(async () => {
  await browserManager.close();
  await server.close();
});

// ---- FU-21: the ambiguity list ---------------------------------------------------------------

test('each ambiguous match carries the first discriminator the page offers (D267)', async () => {
  // Before: two lines, both `1. "Save"` / `2. "Save"`, carrying zero bits for choosing between them.
  const { report } = await run('test "amb"\n  open "/dup-save"\n  click button "Save"\n', configWith({}));
  const error = report.tests[0]!.error ?? '';
  assert.match(error, /matched 2 elements:/);
  assert.match(error, /1\. "Save" — data-testid="save-profile"/);
  assert.match(error, /2\. "Save" — id="save-billing"/);
});

test('with no attribute to use, it falls back to the enclosing container’s heading', async () => {
  const { report } = await run('test "amb"\n  open "/many-cart"\n  click button "Add to cart"\n', configWith({}));
  const error = report.tests[0]!.error ?? '';
  assert.match(error, /matched 12 elements:/);
  assert.match(error, /1\. "Add to cart" — in "Product 1"/);
  assert.match(error, /5\. "Add to cart" — in "Product 5"/);
  // Consistent arithmetic, from one query: 12 matched, 5 shown, 7 elided.
  assert.match(error, /… and 7 more/);
  assert.equal(error.match(/^ {2}\d+\. /gm)?.length, 5);
});

test('when the page offers nothing at all, the ordinal stands alone rather than a css path (M119-01/M120)', async () => {
  const { report } = await run('test "amb"\n  open "/bare-dup"\n  click button "Go"\n', configWith({}));
  const error = report.tests[0]!.error ?? '';
  assert.match(error, /^ {2}1\. "Go"$/m);
  assert.match(error, /^ {2}2\. "Go"$/m);
  assert.doesNotMatch(error, /css "/);
});

// ---- B4-11: the nearest-match list -----------------------------------------------------------

test('byte-identical suggestions collapse to one, and it says why it is not ready to paste (B4-11)', async () => {
  // Measured before the fix: ``- `button "Save"`` printed twice, and pasting it produced
  // ``ambiguous locator `button "Save"` … matched 2 elements`` — a *different* failure, from a
  // list SPEC §9.3 calls ready-to-paste. A short typo like "Sav" does not reach this path at all:
  // Playwright's role-name matching is substring-based, so a truncation is a match, not a miss.
  const { report } = await run('test "typo"\n  open "/dup-save"\n  click button "Saev"\n', configWith({ step: 4000 }));
  const error = report.tests[0]!.error ?? '';
  assert.match(error, /nearest matches on the page:/);
  assert.equal(error.match(/button "Save"/g)?.length, 1, `expected one deduped suggestion, got:\n${error}`);
  assert.match(error, /2 elements render this same locator/);
});

test('deduping frees the slots duplicates used to consume, so a distinct candidate is reachable', async () => {
  // Twelve identical near-misses filled all five slots; `button "Add to bag"` could not be shown
  // no matter how relevant it was. This is the crowding-out half, at the browser level.
  const { report } = await run('test "typo"\n  open "/many-cart"\n  click button "Add to crat"\n', configWith({ step: 4000 }));
  const error = report.tests[0]!.error ?? '';
  assert.match(error, /button "Add to cart"/);
  assert.match(error, /12 elements render this same locator/);
  assert.match(error, /button "Add to bag"/);
});

// ---- FU-14: the speculative line -------------------------------------------------------------

test('a locator still unmatched at 3s says so, naming the closest thing on the page (D248)', async () => {
  const { result, stderr } = await captureStderr(() =>
    run('test "typo"\n  open "/dup-save"\n  click button "Saev"\n', configWith({ step: 8000 })),
  );
  assert.equal(result.report.ok, false);
  assert.match(stderr, /⏳ tflw: still nothing matching `button "Saev"` after 3s/);
  assert.match(stderr, /the closest thing on the page is `button "Save"`/);
  assert.match(stderr, /still waiting, up to 8s/);
  assert.equal(stderr.match(/⏳ tflw:/g)?.length, 1, 'once per step, not once per poll');
});

test('it speaks even when nothing on the page resembles the name — that case is the worst silence, not the least', async () => {
  // The row's own re-measurement: against a page with no near-miss, the 30 s wait is not even paid
  // off with a suggestion at the end. Staying quiet here would leave exactly that case unfixed.
  const { stderr } = await captureStderr(() =>
    run('test "typo"\n  open "/dup-save"\n  click button "Log Inn"\n', configWith({ step: 8000 })),
  );
  assert.match(stderr, /still nothing matching `button "Log Inn"` after 3s/);
  assert.match(stderr, /nothing on the page resembles it yet/);
});

test('a step whose own timeout leaves no room to wait after speaking stays quiet', async () => {
  // At `step: 5000` the line would land a blink before the failure it precedes. The guard is
  // "at least as much waiting left as has already passed", so it disarms.
  const { stderr } = await captureStderr(() =>
    run('test "typo"\n  open "/dup-save"\n  click button "Saev"\n', configWith({ step: 5000 })),
  );
  assert.doesNotMatch(stderr, /⏳ tflw:/);
});

test('the deadline does not move: an app that renders at 4s still passes, having been spoken about at 3s', async () => {
  // The property that rules out the genuine fast-fail option, and the one thing about this change
  // that must never regress — a progress line that quietly became a shorter timeout would turn a
  // slow app's green suite red.
  const { result, stderr } = await captureStderr(() =>
    run('test "slow"\n  open "/slow"\n  click button "Checkout"\n', configWith({ step: 8000 })),
  );
  assert.equal(result.report.ok, true, result.report.tests[0]?.error ?? '');
  assert.match(stderr, /still nothing matching `button "Checkout"` after 3s/);
});
