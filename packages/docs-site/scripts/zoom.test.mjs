// The zoom's own controls — `M234` `G` (`D1305`).
//
// **This is a browser gate and it has to be**, which is worth stating because everything else in
// this directory is a node test that reads files. `D1305`'s claim is that a reader can always get
// out of the overlay — a press, `Escape`, or a scroll — and not one of those three is observable
// from the source. Asserting that `theme/index.ts` contains the string `'Escape'` would assert that
// somebody typed it, which is `M164`'s *asserting a function is correct is not asserting anything
// calls it*, and this file exists because that shape has already cost this repository three rounds.
//
// It drives the **built** site rather than a dev server: the listeners are installed by
// `enhanceApp`, which only runs in the client bundle, so a gate against source would be testing a
// file the reader never receives.
import assert from 'node:assert/strict';
import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const DIST = fileURLToPath(new URL('../.vitepress/dist', import.meta.url));
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

/** The built site is written for `base: '/tflw/'`, so it is served from that prefix or nothing resolves. */
const serve = async () => {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/tflw/, '');
    let file = join(DIST, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!existsSync(file) || extname(file) === '') file = join(file, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404).end('not here');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { server, base: `http://127.0.0.1:${server.address().port}/tflw` };
};

const openOnAShot = async (page, base) => {
  await page.goto(`${base}/ui/`);
  const shot = page.locator('.vp-doc img').first();
  await shot.waitFor({ state: 'attached' });
  // **The vacuity control, and it is not decoration.** Every clause below is about what happens
  // when a picture is pressed; on a page with no picture they would all pass over nothing, and the
  // gate would go green the day the shots stop being embedded — which is exactly the day it should
  // go red.
  assert.ok(await page.locator('.vp-doc img').count() > 0, 'no picture on /ui/ — every clause here would pass over nothing');
  await shot.click({ force: true });
  await page.locator('.tflw-zoom').waitFor({ state: 'attached', timeout: 4000 });
  return shot;
};

test('`D1305`: pressing a picture opens it, enlarged, over the page', async () => {
  const { server, base } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const shot = await openOnAShot(page, base);
    assert.equal(await page.locator('.tflw-zoom').count(), 1, 'one overlay');
    assert.equal(await page.locator('.tflw-zoom img').count(), 1, 'carrying one picture');
    // The same picture, not a neighbour: `currentSrc` is what the light/dark pair resolved to.
    const wanted = await shot.evaluate((el) => (el.currentSrc === '' ? el.src : el.currentSrc));
    assert.equal(await page.locator('.tflw-zoom img').getAttribute('src'), wanted, 'it enlarges the picture that was pressed');
    assert.equal(await page.locator('.tflw-zoom').getAttribute('role'), 'dialog');
    await page.close();
  } finally {
    await browser.close();
    server.close();
  }
});

test('`D1305`: all three ways out work — a press, `Escape`, and a scroll', async () => {
  const { server, base } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    // 1. a press anywhere
    await openOnAShot(page, base);
    await page.locator('.tflw-zoom').click({ position: { x: 5, y: 5 } });
    await page.locator('.tflw-zoom').waitFor({ state: 'detached', timeout: 4000 });
    assert.equal(await page.locator('.tflw-zoom').count(), 0, 'a press dismisses it');

    // 2. Escape
    await openOnAShot(page, base);
    await page.keyboard.press('Escape');
    await page.locator('.tflw-zoom').waitFor({ state: 'detached', timeout: 4000 });
    assert.equal(await page.locator('.tflw-zoom').count(), 0, '`Escape` dismisses it');

    // 3. a scroll — and this one is why the page is NOT scroll-locked while the overlay is up.
    //    Locking would remove the gesture that dismisses it, which is a bug only a trackpad finds.
    await openOnAShot(page, base);
    await page.mouse.wheel(0, 400);
    await page.locator('.tflw-zoom').waitFor({ state: 'detached', timeout: 4000 });
    assert.equal(await page.locator('.tflw-zoom').count(), 0, 'a scroll dismisses it');

    await page.close();
  } finally {
    await browser.close();
    server.close();
  }
});

test('`D1305`: only pictures in the document zoom — the logo and the chrome do not', async () => {
  const { server, base } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${base}/ui/`);
    // The control for the control: if the site has no chrome image, this test asserts nothing.
    const chrome = await page.locator('.VPNavBarTitle img, img.logo').count();
    assert.ok(chrome > 0, 'no chrome image on the page — this clause would pass over nothing');
    // **Dispatched, not clicked, and that is the sharper instrument.** The logo ships as a
    // light/dark pair, so one of the two is always `display: none` and Playwright rightly refuses
    // to click it. What is being asserted is that the delegated handler *ignores* the element, not
    // that a pointer can reach it — so the event is sent straight at it, bubbling, which is the
    // hardest version of the question.
    const opened = await page.evaluate(() => {
      const img = document.querySelector('.VPNavBarTitle img, img.logo');
      if (img === null) return 'no chrome image';
      img.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return document.querySelectorAll('.tflw-zoom').length;
    });
    assert.equal(opened, 0, `a bubbling click on the chrome opened ${opened} overlay(s)`);
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.tflw-zoom').count(), 0, 'chrome is not the subject (D1305)');
    await page.close();
  } finally {
    await browser.close();
    server.close();
  }
});
