// The built site's layout, on every page it publishes — `M269b`.
//
// `M269` moved the site from VitePress to Starlight and proved the move by *address*: every page and
// every heading id survived (`verify-url-parity.mjs`). Nothing looked at where things land. Four
// defects shipped that way, and each was a rule written for VitePress's layout carried into
// Starlight's:
//
// - the `/ui/` shots broke out 80px each side of the text column, which VitePress centres and
//   Starlight puts one pad short of the "On this page" rail, so they crossed the rail at every width
//   and the sidebar below 1600px;
// - the home hero's dot field runs half a viewport past each edge, which VitePress's hero container
//   clipped and Starlight's does not, so the home page scrolled 540px sideways at every width;
// - every page's canonical link and `og:url` read `…/guide/config.html/`, an address GitHub Pages
//   does not serve (Starlight formats `build.format: 'preserve'` as if it were `'directory'`);
// - the Playground and the editor demos were styled with `--vp-*` variables, which Starlight does not
//   define, so the playground's editor had no surface, no border and no monospace face.
//
// Like `zoom.test.mjs` this drives the **built** site: a layout is not observable from the source.
import assert from 'node:assert/strict';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const RECORD = JSON.parse(readFileSync(new URL('./fixtures/published-urls.json', import.meta.url), 'utf8'));
const SITE = 'https://deepak-tuteja.github.io/tflw/';
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

/** Every published page, as the path a reader types: `guide/config`, `ui/`, `` for the home page. */
const PAGES = Object.keys(RECORD.pages)
  .filter((file) => file !== '404.html')
  .map((file) => file.replace(/index\.html$/, '').replace(/\.html$/, ''));

const serve = async () => {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/tflw/, '');
    let file = join(DIST, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (extname(file) === '' && existsSync(`${file}.html`)) file = `${file}.html`;
    else if (!existsSync(file) || extname(file) === '') file = join(file, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404).end('not here');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { server, base: `http://127.0.0.1:${server.address().port}/tflw/` };
};

/**
 * What a reader would see wrong with the page in front of them: how far it scrolls sideways, and each
 * content block that leaves the screen or lands on the sidebar or the "On this page" rail. Code
 * blocks scroll inside themselves, so a long line is not a collision; the block's own box is what is
 * measured.
 */
const misplaced = () => {
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    const style = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const edge = (selector, side) => {
    const e = [...document.querySelectorAll(selector)].find(visible);
    return e === undefined ? undefined : e.getBoundingClientRect()[side];
  };
  const sidebarRight = edge('.sidebar-pane', 'right');
  const railLeft = edge('.right-sidebar-panel', 'left');
  const out = [];
  const content = document.querySelector('.sl-markdown-content');
  for (const e of content?.querySelectorAll('img, table, .expressive-code, details, aside, iframe, textarea, p, h2, h3') ?? []) {
    if (!visible(e)) continue;
    const r = e.getBoundingClientRect();
    const what = `${e.tagName.toLowerCase()} ${(e.getAttribute('src') ?? e.textContent ?? '').trim().slice(0, 40)}`;
    if (r.left < -1 || r.right > innerWidth + 1) out.push(`off screen: ${what}`);
    else if (sidebarRight !== undefined && r.left < sidebarRight - 1) out.push(`over the sidebar: ${what}`);
    else if (railLeft !== undefined && r.right > railLeft + 1) out.push(`over the rail: ${what}`);
  }
  return { sideways: document.documentElement.scrollWidth - innerWidth, out };
};

const WIDTHS = [390, 1440, 1920];

test('no page scrolls sideways, and nothing in a page lands on the sidebar or the rail', async () => {
  const { server, base } = await serve();
  const browser = await chromium.launch();
  try {
    const problems = [];
    for (const width of WIDTHS) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: 'dark' });
      for (const path of PAGES) {
        await page.goto(base + path, { waitUntil: 'load' });
        const { sideways, out } = await page.evaluate(misplaced);
        if (sideways > 0) problems.push(`${width}px /${path}: scrolls ${sideways}px sideways`);
        for (const o of out) problems.push(`${width}px /${path}: ${o}`);
      }
      await page.close();
    }
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test('the measure sees a collision: the VitePress breakout, put back on /ui/, is caught at 1440', async () => {
  // The vacuity control for the sweep above. A detector that never fires passes every page, so
  // this restores the exact rule `M269` carried over and asserts the detector names the shot.
  const { server, base } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    await page.goto(`${base}ui/`, { waitUntil: 'load' });
    assert.deepEqual((await page.evaluate(misplaced)).out, [], 'the shipped rule is clean');
    await page.addStyleTag({ content: '.ui-shots .sl-markdown-content img { width: calc(100% + 160px) !important; max-width: none; margin-inline-start: -80px !important; }' });
    const { out } = await page.evaluate(misplaced);
    assert.ok(out.some((o) => o.startsWith('over the sidebar: img')), `the old breakout went unseen: ${JSON.stringify(out)}`);
  } finally {
    await browser.close();
    server.close();
  }
});

test('a /ui/ shot still breaks out of the text column where the pane has room, and only there', async () => {
  const { server, base } = await serve();
  const browser = await chromium.launch();
  try {
    const widths = {};
    for (const width of [1440, 1920]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: 'dark' });
      await page.goto(`${base}ui/`, { waitUntil: 'load' });
      widths[width] = await page.evaluate(() => {
        const shot = [...document.querySelectorAll('.sl-markdown-content img')].find((e) => e.getBoundingClientRect().width > 0);
        return { shot: shot.getBoundingClientRect().width, column: document.querySelector('.sl-markdown-content').getBoundingClientRect().width };
      });
      await page.close();
    }
    // `D1292`: the shots are cut at 1060-1440 css and land in a narrower column, so the room the
    // pane has is spent on them. At 1920 that is the whole 160px; at 1440 the pane has almost none.
    assert.equal(Math.round(widths[1920].shot - widths[1920].column), 160, `1920: ${JSON.stringify(widths[1920])}`);
    assert.ok(widths[1440].shot - widths[1440].column < 40, `1440: ${JSON.stringify(widths[1440])}`);
  } finally {
    await browser.close();
    server.close();
  }
});

test("every page's canonical link and og:url is the address the page is served at", () => {
  const html = (dir) => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '_astro' || name === 'pagefind' ? [] : html(path);
    return name.endsWith('.html') && name !== '404.html' ? [path] : [];
  });
  const files = html(DIST);
  assert.equal(files.length, PAGES.length, 'every published page, and only those');
  for (const file of files) {
    const path = relative(DIST, file).split(sep).join('/').replace(/index\.html$/, '').replace(/\.html$/, '');
    const source = readFileSync(file, 'utf8');
    const canonical = source.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
    const ogUrl = source.match(/<meta property="og:url" content="([^"]*)"/)?.[1];
    assert.equal(canonical, SITE + path, `${path}: canonical`);
    assert.equal(ogUrl, SITE + path, `${path}: og:url`);
  }
});

test('nothing on the site is styled with a VitePress variable, and the playground editor can be seen', async () => {
  const leftovers = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(html|css|js)$/.test(name) && readFileSync(path, 'utf8').includes('var(--vp-')) leftovers.push(relative(DIST, path));
    }
  };
  walk(DIST);
  assert.deepEqual(leftovers, [], 'Starlight defines no --vp-* variable, so each of these resolves to nothing');

  const { server, base } = await serve();
  const browser = await chromium.launch();
  try {
    for (const scheme of ['dark', 'light']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
      await page.goto(`${base}playground/`, { waitUntil: 'load' });
      const editor = page.locator('.sl-markdown-content textarea');
      await editor.waitFor({ state: 'visible' });
      const look = await editor.evaluate((e) => {
        const s = getComputedStyle(e);
        return { font: s.fontFamily, border: s.borderTopWidth, ground: s.backgroundColor, page: getComputedStyle(document.body).backgroundColor };
      });
      assert.match(look.font, /mono/i, `${scheme}: the editor is set in a monospace face`);
      assert.notEqual(look.border, '0px', `${scheme}: the editor has an edge`);
      assert.notEqual(look.ground, look.page, `${scheme}: the editor has its own ground`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
});
