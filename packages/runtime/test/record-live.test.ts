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
  <button type="button" id="plain">Plain</button>
</form>`;

/**
 * **The catalog, twelve rows deep** — `M219-03`'s own shape (`D1266`).
 *
 * The structure is what matters and it is the measured one: the nearest ancestor that narrows
 * `button "Add to cart"` to one is the unnamed `div`, and the nearest one that narrows it *and*
 * carries a name of its own is the `li` above that. The `ul` around them all is back to twelve.
 */
const CATALOG = `<!doctype html><meta charset="utf-8"><title>c</title>
<ul class="product-grid">
${Array.from({ length: 12 }, (_, i) => `  <li class="product-row" aria-label="Product ${i + 1}">
    <h3>Item ${i + 1}</h3>
    <div class="product-row-actions"><button>Add to cart</button></div>
  </li>`).join('\n')}
</ul>
<button id="checkout">Checkout</button>`;

/** An order page whose receipt link genuinely opens a second browser tab — the sibling's own case,
 *  and what `M219-04` was found against. */
const ORDER = `<!doctype html><meta charset="utf-8"><title>o</title>
<a id="receipt" href="/receipt" target="_blank">View receipt</a>
<button id="track">Track parcel</button>`;

const RECEIPT = `<!doctype html><meta charset="utf-8"><title>r</title>
<button id="print">Print receipt</button>`;

let server: Server;
let base: string;
let browser: Browser;

before(async () => {
  server = createServer((req, res) => {
    const body = req.url?.startsWith('/catalog') ? CATALOG : req.url?.startsWith('/order') ? ORDER : req.url?.startsWith('/receipt') ? RECEIPT : PAGE;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
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
const recorded = async (drive: (page: Page) => Promise<void>, at = ''): Promise<readonly RecordedAction[]> => {
  const page = await browser.newPage();
  const out: RecordedAction[] = [];
  /* **Snapshotted before the teardown**, because tearing down closes tabs and a closing tab is
     itself a gesture this recorder now writes down (`M219-04`). A gate that read `out` after the
     `finally` would be reading the harness. */
  let taken: readonly RecordedAction[] = [];
  try {
    await wireRecordSession(page, (a) => out.push(a), () => undefined);
    await page.goto(`${base}${at}`);
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
    taken = [...out];
  } finally {
    await page.context().close();
  }
  // The `open` for the first navigation is the session's own preamble, not a gesture under test.
  return taken.filter((a) => a.kind !== 'open');
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

/* ── `M231` — a recording is either what the user did, or it is evidence of nothing ─────────────
 *
 * Four rows, one file, one subject. Each gate below is about exactly one of them, which is the
 * arc's §6 independence clause: a mutation of one repair reddens its own gate and no other.
 */

test('`M231` `A`: an implicit form submit records no click, and keyboard activation still does (`M220-01`, `D1267`)', async () => {
  /**
   * **The row, and the reason it was filed rather than repaired in `M220`.** Pressing `Enter` in a
   * text field submits the form, and the browser reaches the submit button by dispatching a
   * `click` at it — so the recording held a click nobody made and a replay submitted twice.
   *
   * `detail === 0` marks a click no pointer made. It also marks *keyboard activation of a focused
   * button*, which is a real gesture, so it cannot discriminate alone — which is precisely why
   * `M220` measured instead of guessing. `document.activeElement === event.target` separates them:
   * on the implicit submit focus is still on the field, and on the keyboard activation it is on
   * the button being activated.
   *
   * **The control is the second half and carries the whole claim** — every assertion in the first
   * half is an absence, and an absence is also what a recorder that stopped recording clicks
   * produces.
   */
  const submitted = await recorded(async (page) => {
    /* `focus`, not `click` — a click here would be a real gesture and correctly recorded, and the
       assertion below is about the clicks the recorder INVENTS. */
    await page.focus('#email');
    await page.keyboard.type('admin');
    await page.keyboard.press('Enter');
  });
  assert.deepEqual(
    submitted.filter((a) => a.kind === 'click'),
    [],
    `the submit button was never clicked — a replay of this would submit twice:\n${JSON.stringify(submitted, null, 1)}`,
  );
  assert.deepEqual(submitted.filter((a) => a.kind === 'press').map((a) => a.value), ['Enter'], 'and the keystroke that DID happen is still written');

  const activated = await recorded(async (page) => {
    await page.focus('#plain');
    await page.keyboard.press('Space');
  });
  assert.deepEqual(
    activated.filter((a) => a.kind === 'click').map((a) => a.locator),
    ['button "Plain"'],
    `Space on a focused button is a gesture and reaches detail === 0 too — dropping every such click loses it:\n${JSON.stringify(activated, null, 1)}`,
  );
});

test('`M231` `B`: an ambiguous name is scoped by a `within`, not surrendered to a css path (`M219-03`, `D1266`)', async () => {
  /**
   * Twelve `Add to cart` buttons, and before this the recorder wrote a `css` path naming the
   * element the mouse was over — which pins the test to the row that product happened to be in.
   *
   * The rule is the nearest disambiguating ancestor **the language can name**, and the two halves
   * of that came apart when measured: `+1 div.product-row-actions` narrows to one and has no name,
   * `+2 li[aria-label="Product 2"]` narrows to one and has one, `+3 ul.product-grid` is back to
   * twelve. Taking the merely-nearest would emit the structural path this exists to stop writing.
   */
  const out = await recorded(async (page) => {
    await page.locator('li[aria-label="Product 2"] button').click();
  }, 'catalog');
  const clicks = out.filter((a) => a.kind === 'click');
  assert.equal(clicks.length, 1, `one click:\n${JSON.stringify(out, null, 1)}`);
  assert.equal(clicks[0]!.locator, 'button "Add to cart"', 'the element keeps the name a person would have written');
  assert.equal(clicks[0]!.within, 'css "[aria-label=\\"Product 2\\"]"', 'and the row that makes it unambiguous is named by its own label, never by its position');

  /* **The control.** An unambiguous name needs no scope, and a recorder that wrapped everything
     would pass the assertion above while making every ordinary line worse. */
  const plain = await recorded(async (page) => {
    await page.click('#checkout');
  }, 'catalog');
  const only = plain.filter((a) => a.kind === 'click');
  assert.equal(only.length, 1, `one click:\n${JSON.stringify(plain, null, 1)}`);
  assert.equal(only[0]!.locator, 'button "Checkout"');
  assert.equal(only[0]!.within, undefined, 'a name that stands alone is not scoped');
});

test('`M231` `C`: a second tab is recorded — the click becomes the block, and going back earns a switch (`M219-04`, `D1268`)', async () => {
  /**
   * **The hole, measured before the repair:** `wireRecordSession` wired exactly one `Page`, so one
   * click in tab 1 gave 2 actions, two clicks in tab 2 gave still 2, and one click back in tab 1
   * gave 3. A recording with a hole never looks broken.
   *
   * The click that opens the tab is written as the `switch to new tab` **block** that wraps it,
   * because the runtime has to be listening for the context's `page` event before the trigger
   * runs. That is affordable for a measured reason: the capture listener runs in the capture
   * phase, so Node hears about the click before the browser follows the link, and the popup then
   * arrives while the locator is still resolving.
   */
  const out = await recorded(async (page) => {
    const [opened] = await Promise.all([page.context().waitForEvent('page'), page.click('#receipt')]);
    await opened.waitForLoadState('domcontentloaded');
    await opened.click('#print');
    await page.bringToFront();
    await page.click('#track');
  }, 'order');

  const shape = out.map((a) => [a.kind, a.locator, a.value, a.opensNewTab ?? false] as const);
  assert.deepEqual(
    shape,
    [
      ['click', 'text "View receipt"', null, true],
      ['click', 'button "Print receipt"', null, false],
      ['switch', null, '1', false],
      ['click', 'button "Track parcel"', null, false],
    ],
    `the tab that opened is recorded, and so is the way back to the one that opened it:\n${JSON.stringify(out, null, 1)}`,
  );
});
