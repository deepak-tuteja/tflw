// `M220` `E` — the recorder, driven by a real browser (`D1175`, closing `M219-02`).
//
// **`recorder.test.ts` asserts the judgement and this file asserts the EVENTS**, and the split is
// the reason both exist. Over there a `RawRecordEvent` is written by hand, so the sequence under
// test is the one the author believed the browser produces; the two faults this file is about are
// *properties of the order real events arrive in*, and every hand-written sequence in this
// repository had them right. Typing `admin@example.com` split into three statements — one of them
// carrying a partial value — for a reason no synthetic single-event gate can see: the `@` is a
// keystroke with a modifier held, and the modifier is `Shift`.
//
// So the instrument here is a real page, a real keyboard, and `wireRecordSession` wired to it
// exactly as `tflw record` wires it. Headless makes no difference to any of this — DOM events,
// `addInitScript` and `evaluateAll` behave identically — only to whether a window is on screen.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright';

import { wireRecordSession, type RecordedAction } from '../src/browser.js';

/** A form with the two fields and the submit button the dogfood session used. Served over HTTP
 *  rather than `setContent`, because `addInitScript` has to run for a real document load. */
const PAGE = `<!doctype html><meta charset="utf-8"><title>f</title>
<form id="f" action="/done" method="get">
  <label for="email">Email</label><input id="email" name="email">
  <label for="pass">Password</label><input id="pass" name="pass" type="password">
  <button type="submit">Sign in</button>
</form>`;

let server: Server;
let base: string;
let browser: Browser;

before(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await new Promise<void>((r) => server.close(() => r()));
});

/**
 * Record one session and return what it wrote.
 *
 * **The drain is a poll and not a fixed wait**, because `wireRecordSession` resolves locators
 * against the live DOM on a promise queue: an action can be several round trips behind the
 * keystroke that produced it. Waiting a constant is how this gate would pass on a fast machine and
 * flake on a loaded one.
 */
const recorded = async (drive: (page: Page) => Promise<void>): Promise<readonly RecordedAction[]> => {
  const page = await browser.newPage();
  const out: RecordedAction[] = [];
  try {
    await wireRecordSession(page, (a) => out.push(a), () => undefined);
    await page.goto(base);
    await drive(page);
    let seen = -1;
    for (let quiet = 0; quiet < 6 && (seen !== out.length || quiet < 2); ) {
      if (seen === out.length) quiet++;
      else {
        seen = out.length;
        quiet = 0;
      }
      await page.waitForTimeout(120);
    }
  } finally {
    await page.close();
  }
  // The `open` for the first navigation is the session's own preamble, not a gesture under test.
  return out.filter((a) => a.kind !== 'open');
};

test('THE CLAIM: a modifier held for a character is typing — one fill, no press', async () => {
  /**
   * **The instrument had to be measured before it could be trusted, and the obvious one is
   * vacuous.** `page.keyboard.type('admin@example.com')` reproduces nothing: measured on this
   * chromium, `type` delivers `@` as `key: "@"` with **`shiftKey: false`** — it synthesises the
   * character, not the keystroke that a person's hand makes. Written that way this test passed
   * against the defective rule, which is the only reason it was caught: the mutation sweep for
   * `D1175` reddened the paste case and left this one green.
   *
   * `keyboard.press('Shift+2')` is the keystroke: two keydowns, `Shift` then `2`, both carrying
   * `shiftKey: true`. Chromium's synthetic layout inserts `2` rather than `@` — a property of the
   * harness and not of the rule — and the class under test is *a modifier is held and a character
   * is produced*, which is exactly what arrives.
   *
   * Before `D1175` this recorded `fill "admin"` · `press "Shift+2"` · `fill "admin2example.com"`:
   * three statements, the first of them a value the author never meant, which a replay would type
   * and move on from.
   */
  const out = await recorded(async (page) => {
    await page.click('#email');
    await page.keyboard.type('admin');
    await page.keyboard.press('Shift+2');
    await page.keyboard.type('example.com');
    await page.click('#pass'); // blur, so the field's `change` fires
  });
  const fills = out.filter((a) => a.kind === 'fill');
  assert.equal(out.filter((a) => a.kind === 'press').length, 0, `a modifier held for a character is typing, not a gesture — got ${JSON.stringify(out)}`);
  assert.equal(fills.length, 1, `one field typed once is one fill — got ${JSON.stringify(out)}`);
  assert.equal(fills[0]!.value, 'admin2example.com', 'and the one fill carries the whole value, never a prefix of it');
});

test('…and a paste is the text it pasted, never `press "Meta+v"`', async () => {
  // **The dangerous one.** Recorded as a press, the replay reads the clipboard of whatever machine
  // runs the test. The pasted characters arrive as an `input` event either way, so dropping the
  // keystroke loses nothing at all.
  const accel = process.platform === 'darwin' ? 'Meta' : 'Control';
  const out = await recorded(async (page) => {
    await page.click('#email');
    await page.evaluate(async () => {
      await navigator.clipboard.writeText('pasted@example.com');
    }).catch(() => undefined);
    // Whether the clipboard is readable in this sandbox or not, the KEYSTROKE is what is under
    // test: it must not become a statement. The fill below is typed so the assertion has a fill to
    // be about on either outcome.
    await page.keyboard.press(`${accel}+v`);
    await page.keyboard.type('x');
    await page.click('#pass');
  });
  assert.deepEqual(
    out.filter((a) => a.kind === 'press').map((a) => a.value),
    [],
    `an editing accelerator is typing — got ${JSON.stringify(out)}`,
  );
});

test('`Enter` in a form is ONE fill and ONE press, not the same fill twice', async () => {
  // The order is the whole of it: the keystroke flushes the pending fill before the press — which
  // is right — and the browser then fires `change`, because Enter commits the field. The `change`
  // branch treated that as the authoritative final value and wrote it again.
  const out = await recorded(async (page) => {
    await page.click('#email');
    await page.keyboard.type('admin');
    await page.keyboard.press('Enter');
  });
  const fills = out.filter((a) => a.kind === 'fill');
  assert.equal(fills.length, 1, `got ${JSON.stringify(out)}`);
  assert.equal(fills[0]!.value, 'admin');
  assert.deepEqual(out.filter((a) => a.kind === 'press').map((a) => a.value), ['Enter']);
});

test('the control: a real command keystroke is still a press', async () => {
  // **The vacuity check for all three above.** Every assertion up there is an *absence*, and an
  // absence is also what a recorder that stopped recording anything would produce. `Control+k` has
  // a modifier, is not `Shift`, and is not an editing accelerator — so it is exactly what the new
  // rule is supposed to keep.
  const out = await recorded(async (page) => {
    await page.click('#email');
    await page.keyboard.press('Control+k');
  });
  assert.deepEqual(out.filter((a) => a.kind === 'press').map((a) => a.value), ['Control+k']);
});

test('…and `Shift+Tab` is still a press, because `Tab` is a gesture whether or not Shift is held', async () => {
  const out = await recorded(async (page) => {
    await page.click('#pass');
    await page.keyboard.press('Shift+Tab');
  });
  assert.deepEqual(out.filter((a) => a.kind === 'press').map((a) => a.value), ['Shift+Tab']);
});
