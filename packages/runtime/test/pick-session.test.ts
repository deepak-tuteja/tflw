// M5: `tflw pick <url>` (SPEC §12) — `wirePickSession`'s click-capture + verified-resolution logic
// against a real (headless) Chromium page. Headless is deliberate and sufficient here: DOM events,
// `addInitScript`, and `page.exposeFunction` behave identically headed or headless — only
// `startPickSession` (untested here) actually requires a real visible window, and CI runners have
// no display server to render one against (see `browser.ts`'s own comment on `wirePickSession`).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserManager, wirePickSession, type PickedLocator } from '../src/browser.js';
import { startFixtureServer, type FixtureServer } from './support.js';

const PICK_HTML = `<!doctype html>
<html><body>
  <button id="checkout-btn">Add to Cart</button>
  <button class="icon-btn"><svg width="16" height="16"></svg></button>
  <label for="em">Email Address</label>
  <input id="em" type="text" />
  <ul aria-label="Cart items"><li>Widget</li></ul>
  <p id="leaf">Order confirmed</p>
  <a href="/elsewhere">Go elsewhere</a>
</body></html>`;

// M42 (testFlow-tests webV2 dogfooding): a custom element can define its own `value` property of
// any type — this one's is a number, like the real `<star-rating>` shadow-DOM widget that surfaced
// the bug. No shadow DOM needed to reproduce it; the crash is purely about `el.value`'s runtime
// type, not about shadow-root retargeting.
const NUMERIC_VALUE_HTML = `<!doctype html>
<html><body>
  <numeric-value-widget id="widget"></numeric-value-widget>
  <script>
    class NumericValueWidget extends HTMLElement {
      get value() { return 0; }
      connectedCallback() {
        this.style.display = 'inline-block';
        this.style.width = '40px';
        this.style.height = '40px';
      }
    }
    customElements.define('numeric-value-widget', NumericValueWidget);
  </script>
</body></html>`;

let server: FixtureServer;
let browserManager: BrowserManager;

before(async () => {
  server = await startFixtureServer({
    '/pick': (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(PICK_HTML),
    '/elsewhere': (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><html><body>elsewhere</body></html>'),
    '/numeric-value': (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(NUMERIC_VALUE_HTML),
  });
  browserManager = new BrowserManager(); // headless — see file header
});

after(async () => {
  await browserManager.close();
  await server.close();
});

async function withPickedPage(
  run: (pick: (selector: string) => Promise<void>, picks: PickedLocator[]) => Promise<void>,
  path = '/pick',
): Promise<void> {
  const browser = await browserManager.getBrowser();
  const page = await browser.newPage();
  const picks: PickedLocator[] = [];
  let closedCount = 0;
  await wirePickSession(
    page,
    (p) => picks.push(p),
    () => {
      closedCount++;
    },
  );
  await page.goto(`${server.baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
  const pick = async (selector: string): Promise<void> => {
    const before = picks.length;
    await page.locator(selector).click({ force: true });
    // The report round-trips through `page.exposeFunction`, which is async — give it a moment.
    for (let i = 0; i < 50 && picks.length === before; i++) await new Promise((r) => setTimeout(r, 20));
  };
  await run(pick, picks);
  await page.close();
  assert.equal(closedCount, 1, 'onClosed should fire exactly once when the page closes');
}

test('clicking a named button resolves to its exact `button "…"` locator', async () => {
  await withPickedPage(async (pick, picks) => {
    await pick('#checkout-btn');
    assert.equal(picks.length, 1);
    assert.deepEqual(picks[0], { syntax: 'button "Add to Cart"', via: 'button' });
  });
});

test('clicking a labelled field resolves to its exact `field "…"` locator', async () => {
  await withPickedPage(async (pick, picks) => {
    await pick('#em');
    assert.equal(picks.length, 1);
    assert.deepEqual(picks[0], { syntax: 'field "Email Address"', via: 'field' });
  });
});

test('clicking a leaf text node resolves to a `text "…"` locator', async () => {
  await withPickedPage(async (pick, picks) => {
    await pick('#leaf');
    assert.equal(picks.length, 1);
    assert.deepEqual(picks[0], { syntax: 'text "Order confirmed"', via: 'text' });
  });
});

test('clicking an icon-only button with no accessible name falls back to a generated css selector', async () => {
  await withPickedPage(async (pick, picks) => {
    await pick('.icon-btn');
    assert.equal(picks.length, 1);
    assert.equal(picks[0]!.via, 'css');
    assert.match(picks[0]!.syntax, /^css "/);
  });
});

test('clicking a link never navigates the page (picking is inert) — the same page, still on /pick, is what gets picked', async () => {
  await withPickedPage(async (pick, picks) => {
    await pick('a');
    assert.equal(picks.length, 1);
    assert.equal(picks[0]!.via, 'text');
    assert.equal(picks[0]!.syntax, 'text "Go elsewhere"');
  });
});

test('clicking a custom element whose own `value` property is a number (not a string) still resolves — falls back to a generated css selector, doesn’t crash the click listener', async () => {
  await withPickedPage(
    async (pick, picks) => {
      await pick('#widget');
      assert.equal(picks.length, 1, 'the click listener must still report — a wrong-typed `value` must not throw and silently swallow the pick');
      assert.equal(picks[0]!.via, 'css');
      assert.match(picks[0]!.syntax, /^css "/);
    },
    '/numeric-value',
  );
});

test('onClosed fires once when the picked page is closed', async () => {
  await withPickedPage(async () => {
    // withPickedPage's own teardown (page.close()) plus its own assertion covers this — an empty
    // body here still exercises the full open→close lifecycle with zero picks made.
  });
});
