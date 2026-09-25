// The appearance gate (`M213` `S1`, `D1104`).
//
// **THE AUTHORING RULE FOR READS APPLIES HERE TOO**, and is written out once, at the head of
// `ui-page.test.ts` — `M235` `C3`. The short form: this file reads a live, re-rendering page with
// `node:assert`, nothing retries, `count()` and `evaluateAll()` wait for nothing at all, and an
// absence claim over a page that has not painted is a silent pass. Wait for the subject you are
// about to read, or read it through `settle` (`settle.ts`), keeping the wait separate from the
// claim. A read that must stay one-shot says `// one-shot: <reason>` at the site.
// `npm run verify:settled-reads` holds the count and refuses a new one.
//
// WHY THIS FILE EXISTS, IN ONE SENTENCE: every other gate in this repository asserts a selector, an
// attribute, a count or a model value, and `M212` shipped a control **130 px tall in browser-default
// white** with 115 `ui-page` tests green. That is `M209-02`'s own rule — *a gate asserting a class,
// attribute or model value has not asserted what the reader sees* — turned back on the round that
// wrote it, and `§1` of `PLAN_M213_TFLW_UI.md` is the measurement. `S0` repaired the surface with a
// throwaway probe. A repair verified by a probe that is then deleted is a repair with no gate, so
// this is that probe, committed.
//
// `D1104` SPLITS THE CLAIMS BY WHAT IS THEME-DEPENDENT, AND THAT SPLIT IS THE DESIGN OF THIS FILE.
// Box geometry does not vary with the theme — a control 130 px tall is 130 px in all four, because
// the four differ only in token *values* — so geometry and UA chrome are gated **once**, on the
// default. Colour obviously does vary, so palette closure is gated **per theme, all four**.
//
// AND THE THEME IS SWITCHED IN PLACE, NOT NAVIGATED TO. A theme is `data-tflw-theme` on `<html>`
// and nothing else; stamping it needs no reload, which is what makes four themes across seventeen
// page states affordable. Sixty-eight measurement passes, one navigation each for seventeen of
// them. Cost measured at the bottom of this comment's own slice: the whole file runs in about the
// time one `ui-page` navigation loop takes, which is the point — **this gate has to be cheap enough
// to run after every UI edit in the round, or the round goes back to finding its defects in
// screenshots.**
//
// WHAT IT DOES NOT CLAIM. It does not judge taste. It cannot tell you a palette is ugly, that a
// spacing is mean, or that a pane reads badly — those are the user's call on the running app, and
// `D1105` reserves them there deliberately. It asserts things a machine can hold: nothing renders
// in the user agent's own chrome, no control is wildly out of scale with the controls beside it,
// and **every colour on the page comes from the theme**.
//
// `M229` ADDED THREE MORE, AND THE FIRST OF THEM IS WHY THE ROUND EXISTS. The palette claim above
// was green while **241 elements painted text nobody could read**, because every one of them used
// `--muted`, which is a declared token: the gate asserts *provenance* and never *legibility*, and
// a gate that checks where a value came from cannot see that the value is wrong. So:
//
//   §4 **contrast** (`D1249`) — every text clears its WCAG threshold, on four themes.
//   §5 **layout that survives scale** (`D1258`, `D1259`) — two defects invisible on every fixture
//      in this repository and present on the only project with a real file count.
//   §6 **the tip census** (`D1256`) — no control anywhere lacks a tip, resolved the way
//      `Tooltip.tsx` resolves one.
//
// **Legibility is not the taste `D1104` refuses to judge**, and that line is the whole of the
// amendment: it is a ratio between two colours with a threshold published by somebody else. The
// three new sections keep this file's own rule — every claim is followed by an injection that must
// make it fail, and by a denominator, because a census of nothing is green.
//
// `mac-dashboard`'s `tests/budget.mjs` is the sibling precedent for the last one, and the shape it
// contributes is the vacuity control: each of the three claims here is followed by an injection
// that MUST make it fail. A palette gate over a page that paints nothing is green, and so is a
// height gate that found no controls.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, cp, rm, readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright';
import { UiServer } from '../src/ui-server.js';
import { coverageBuildArgs, startUiCoverage, stopUiCoverage } from './ui-coverage.js';
import { parseColor, flatten, effective, threshold } from './contrast.js';
// `M235` `B1` — `settle.ts` was put in its own module so this file could use it too, and `C2` is
// where that stops being a claim about the future.
import { settle, untilMeasurable } from './settle.js';
import { stagedSetup } from '../../../scripts/test-staging.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const uiRoot = join(here, '..', '..', 'ui');
const fixtures = join(uiRoot, 'fixtures');
const cliEntry = join(here, '..', 'src', 'cli.ts');
const tsxLoader = fileURLToPath(import.meta.resolve('tsx'));
// `M239` `A` (`D1276`) — one known token; see `ui-page.test.ts` for the shape.
const TOKEN = 'm239-test-token-0123456789abcdef';
const newPage = async (options?: Parameters<Browser['newPage']>[0]): Promise<Page> => {
  const p = await browser.newPage(options);
  await p.context().addCookies([{ name: 'tflw-ui-token', value: TOKEN, domain: '127.0.0.1', path: '/' }]);
  return p;
};

// ── The browser's globals, declared here and nowhere else ──────────────────────────────────────
//
// `tsconfig.test.json` pins `types: ["node"]` over `lib: ["ES2022"]` with **no DOM**, and that is a
// decision rather than an omission: this package is a command-line tool, and a `document` appearing
// anywhere in `src/` is a defect the compiler should catch on sight. `ui-page.test.ts` obeys it by
// reaching the document only through Playwright's own typed handles (`el.ownerDocument`), and says
// so in place.
//
// This file cannot do that — it walks the whole document, so its callbacks *are* DOM code. Adding
// `dom` to the package's `lib` would buy that at the price of handing every Node file here a
// `document` that does not exist, which is the rule above sold for one test file. So the handful of
// globals these callbacks touch are declared locally instead. The file has imports, so these are
// module-scoped and reach nothing else; they are structural and narrow on purpose, because a
// `declare const document: any` would typecheck the probe's bugs as happily as its correctness.
interface CssLike {
  readonly length: number;
  item(i: number): string;
  getPropertyValue(p: string): string;
  readonly color: string;
  readonly backgroundColor: string;
  readonly borderTopColor: string;
  readonly borderLeftColor: string;
  readonly borderTopStyle: string;
  readonly borderTopWidth: string;
  /** `M215`'s overlay gate: the metrics that decide where a glyph lands, both boxes compared. */
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly fontWeight: string;
  readonly fontStyle: string;
  readonly lineHeight: string;
  readonly paddingLeft: string;
  readonly paddingTop: string;
  readonly borderLeftWidth: string;
  readonly whiteSpace: string;
  readonly letterSpacing: string;
  readonly tabSize: string;
  /** `M229` `A`'s contrast gate: several things here are dimmed with `opacity` rather than with a
   *  quieter token, and a reading that ignored it would grade them at full strength. */
  readonly opacity: string;
  /** `M233` `H`'s mark gate. The wordmark is drawn, not set, so the colour that decides whether it
   *  can be seen is the stroke and not `color` — and reading it off the live page is the point:
   *  `currentColor` and `var(--accent)` (`D1286`) both arrive here already resolved to the theme's
   *  own value, which is the one thing a stylesheet cannot be asked. */
  readonly stroke: string;
}
interface ElLike {
  readonly tagName: string;
  readonly className: unknown;
  readonly attributes: Iterable<{ readonly name: string }>;
  readonly parentElement: ElLike | null;
  readonly type?: string;
  readonly style: Record<string, string>;
  textContent: string | null;
  checkVisibility(): boolean;
  /** `M214`'s overflow gate reads the bottom edge, which is the whole of its second clause. */
  getBoundingClientRect(): { readonly height: number; readonly bottom: number; readonly x: number; readonly y: number; readonly width: number };
  /** …and the two heights that say whether a region is scrolling inside itself. */
  readonly scrollHeight: number;
  readonly clientHeight: number;
  /** `M229` `A` walks for **direct** text, because an ancestor's `color` is not what its child
   *  paints with — a container and the span inside it are two readings, not one. */
  readonly childNodes: ArrayLike<{ readonly nodeType: number; readonly nodeValue: string | null }> & Iterable<{ readonly nodeType: number; readonly nodeValue: string | null }>;
  closest(selector: string): ElLike | null;
  querySelectorAll(selector: string): ArrayLike<ElLike> & Iterable<ElLike>;
  querySelector(selector: string): ElLike | null;
  appendChild(child: ElLike): void;
  remove(): void;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getAttribute(name: string): string | null;
}
declare const document: ElLike & { readonly body: ElLike; readonly documentElement: ElLike; readonly head: ElLike; createElement(tag: string): ElLike };
declare const getComputedStyle: (el: ElLike) => CssLike;
declare const window: { readonly localStorage: { getItem(key: string): string | null }; readonly innerHeight: number };
declare const requestAnimationFrame: (cb: () => void) => void;

let scratch: string;
let baseUrl: string;
let pageUrl: string;
/** The scratch copy of the fixture project — `M214`'s overflow gate writes a file into it. */
let projectRoot: string;
let server: UiServer;
let browser: Browser;
let page: Page;
/** The bundle this file built, read in `after()` by `M234`'s coverage collector. */
let staticDir: string;

/** `Terminal` first because it is the default (`D1107`) — the geometry pass runs on whatever is
 *  first here, and it should be the thing a reader actually gets. */
const THEMES = ['terminal', 'instrument', 'ribbon', 'paper'] as const;
type Theme = (typeof THEMES)[number];

const DOORS = ['api', 'browser', 'load', 'scan'] as const;
/** The tabs that hold controls or state colour. `source` is excluded on purpose: it is one `<pre>`
 *  of the user's own bytes, its colours are the seven syntax tokens, and it carries no control. */
const TABS = ['compose', 'run', 'auth', 'config'] as const;

const setup = stagedSetup(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'tflw-ui-appearance-'));
  const viteManifestPath = createRequire(uiRoot).resolve('vite/package.json');
  const viteBin = join(dirname(viteManifestPath), (JSON.parse(await readFile(viteManifestPath, 'utf8')) as { bin: { vite: string } }).bin.vite);
  staticDir = join(scratch, 'ui');
  // `M234`: `...coverageBuildArgs()` is empty unless this run is under `npm run coverage`.
  execFileSync(process.execPath, [viteBin, 'build', '--outDir', staticDir, '--logLevel', 'warn', ...coverageBuildArgs()], { cwd: uiRoot, stdio: 'pipe' });

  const root = join(scratch, 'project');
  projectRoot = root;
  await cp(join(fixtures, 'project'), root, { recursive: true });
  const fixturePort = await new Promise<number>((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
  const configPath = join(root, 'tflw.config');
  const config = await readFile(configPath, 'utf8');
  await writeFile(configPath, config.replaceAll('127.0.0.1:4717', `127.0.0.1:${fixturePort}`));
  await symlink(join(here, '..', '..', '..', 'node_modules'), join(root, 'node_modules'), 'dir');
  // A report, so the Run tab is a report and not an empty pane — which is where `--pass` and
  // `--fail` are actually spent, and therefore where a palette gate over Compose alone would be
  // reading a page with no state colour on it at all.
  await mkdir(join(root, 'report', 'runs'), { recursive: true });
  await cp(join(fixtures, 'reports', 'full'), join(root, 'report', 'runs', 'full'), { recursive: true });

  server = new UiServer({ token: TOKEN, root, cliEntry, execArgv: ['--import', tsxLoader], staticDir });
  const port = await server.listen(0);
  baseUrl = `http://127.0.0.1:${port}`;
  pageUrl = `${baseUrl}/?token=${TOKEN}`;
  browser = await chromium.launch();
  page = await openPage();
  // `M234`. This file's module-scope page only; the two ad-hoc pages below (`:389`, `:1360`) are
  // viewport variants of the same paths and are deliberately not collected.
  await startUiCoverage(page);
});

before(setup.begin);

after(async () => {
  await setup.settled(); // `M237` `A1` — see `scripts/test-staging.mjs`
  // Before the page closes and before `rm(scratch)` takes the bundle with it (`M234`).
  if (page !== undefined) await stopUiCoverage(page, staticDir, 'appearance');
  await page?.close();
  await browser?.close();
  await server?.close();
  if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
});

/**
 * Open a page that can run this file's probes.
 *
 * **`__name is not defined`, and why every `page.evaluate` in this file needs one line of setup.**
 * The suite runs under `tsx`, which transpiles with esbuild's `keepNames` on — so a function
 * assigned to a name (`const triple = (v) => …`) is emitted wrapped in esbuild's `__name` helper,
 * which preserves `fn.name` through minification. That helper lives at the top of the transpiled
 * *module*. Playwright serialises an `evaluate` callback by taking its **source text** and
 * evaluating it in the browser, where the module around it does not exist — so every inner named
 * arrow becomes a `ReferenceError` the moment the callback runs, and it is a runtime error in the
 * browser rather than anything a typecheck or a lint could see.
 *
 * `ui-page.test.ts` never hit this because its callbacks are one-liners with no inner bindings.
 * This file's are real functions, and rewriting them into expressions to dodge a transpiler would
 * be letting the build shape the gate. So the browser is given the identity helper instead — which
 * is exactly what `__name` is when nothing is being minified.
 *
 * It is `addInitScript` with a **string** and not a function, so this one line is not itself
 * subject to the transform it exists to repair.
 */
const openPage = async (): Promise<Page> => {
  const p = await newPage({ viewport: { width: 1440, height: 900 } });
  await p.addInitScript({ content: 'globalThis.__name = globalThis.__name || ((fn) => fn);' });
  return p;
};

/**
 * Put the page on one door's one tab.
 *
 * `reload()` and not a bare `goto`, and `M213-12` is why: these URLs differ only in the hash, so
 * the browser fires `hashchange` rather than navigating and the **previous** state's DOM is still
 * in the document until React commits. A gate that measures then is measuring the page before.
 */
const at = async (door: string, tab: string): Promise<void> => {
  await page.goto(`${pageUrl}#/${door}`);
  await page.reload();
  await page.locator(`[data-doorbar="${door}"]`).waitFor();
  await page.locator(`[data-tab="${tab}"]`).click();
  await page.locator(`[data-tabstrip="${tab}"]`).waitFor();
};

const wear = (theme: Theme): Promise<void> =>
  page.evaluate((t) => {
    document.documentElement.setAttribute('data-tflw-theme', t);
  }, theme);

interface Paint { readonly path: string; readonly prop: string; readonly value: string }
interface Control { readonly path: string; readonly parent: string; readonly h: number; readonly bg: string; readonly border: string }
interface Probe {
  readonly tokens: readonly string[];
  readonly offPalette: readonly Paint[];
  readonly painted: number;
  readonly controls: readonly Control[];
  readonly chrome: readonly Control[];
}

/**
 * One measurement pass over the live document.
 *
 * It judges palette closure **in the page** rather than shipping every painted colour back, because
 * a full pass names four colours on each of a few thousand elements and the interesting answer is
 * the empty set. What comes back is the violations, plus the denominators each claim needs to not
 * be vacuous.
 *
 * **Alpha is deliberately ignored when matching a colour to a token.** Every tint in this
 * stylesheet is `color-mix(in srgb, var(--x) N%, transparent)` or an `rgba()` of a token, and the
 * browser computes both to the token's own RGB triple carrying an alpha. So the triple is the
 * identity of the colour and the alpha is how much of it you are seeing — matching on the triple
 * admits every tint of a token and still refuses a colour the theme never declared.
 */
const probe = (): Promise<Probe> =>
  page.evaluate(() => {
    const doc = document;
    const root = doc.documentElement;

    const triple = (v: string): string | null => {
      const m = /^rgba?\(([^)]+)\)$/.exec(v.trim());
      if (!m) return null;
      const parts = m[1]!.split(',').map((x) => parseFloat(x));
      if (parts.length >= 4 && parts[3] === 0) return 'transparent';
      if (parts.length < 3 || parts.some((x) => Number.isNaN(x))) return null;
      return `${parts[0]},${parts[1]},${parts[2]}`;
    };

    // The theme's own declared colours, read off the element the stylesheet declares them on and
    // normalised through the browser's own parser — so a token written as `#08090b` and a paint
    // computed to `rgb(8, 9, 11)` are the same string here without this file knowing any hex.
    const style = getComputedStyle(root);
    const scratchEl = doc.createElement('span');
    scratchEl.style.display = 'none';
    doc.body.appendChild(scratchEl);
    const tokens = new Set<string>(['transparent']);
    for (let i = 0; i < style.length; i++) {
      const name = style.item(i);
      if (!name.startsWith('--')) continue;
      const raw = style.getPropertyValue(name).trim();
      if (!raw) continue;
      scratchEl.style.color = '';
      scratchEl.style.color = raw;
      if (!scratchEl.style.color) continue; // not a colour — a length, a font stack, a keyword
      const t = triple(getComputedStyle(scratchEl).color);
      if (t) tokens.add(t);
    }
    scratchEl.remove();

    const label = (el: ElLike): string => {
      const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
      const data = [...el.attributes].find((a) => a.name.startsWith('data-') && a.name !== 'data-tflw-theme');
      return `${el.tagName.toLowerCase()}${cls}${data ? `[${data.name}]` : ''}`;
    };

    const offPalette: Paint[] = [];
    let painted = 0;
    const PROPS = ['color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'] as const;
    // **A checkbox is exempt, and the stylesheet's own decision is why.** `styles.css` gives
    // `input[type=checkbox]` and `input[type=radio]` `all: revert`, handing them back to the user
    // agent — *"a native checkbox is a drawing and not a box"*. Reverted means its `color` is the
    // UA's `fieldtext`, which `color-scheme` resolves to pure black on the light theme; asserting
    // that black is a token would be asserting the opposite of the rule that put it there. The
    // theme still reaches the part that matters, through `accent-color: var(--accent)`.
    const reverted = new Set<ElLike>(doc.body.querySelectorAll('input[type=checkbox], input[type=radio]'));
    for (const el of doc.body.querySelectorAll('*')) {
      if (!el.checkVisibility() || reverted.has(el)) continue;
      const cs = getComputedStyle(el);
      for (const prop of PROPS) {
        const value = cs.getPropertyValue(prop);
        const t = triple(value);
        if (t === null || t === 'transparent') continue;
        painted++;
        if (!tokens.has(t) && offPalette.length < 40) offPalette.push({ path: label(el), prop, value });
        else if (!tokens.has(t)) painted--, offPalette.push({ path: '…', prop, value: 'and more' });
      }
    }

    // The geometry population. `textarea` is out because it is sized by rows and is *meant* to be
    // taller than a one-line field; checkboxes and radios are out because `all: revert` hands them
    // back to the user agent as drawings rather than boxes, which is `styles.css`'s own decision
    // and would otherwise drag every median that contains one downwards.
    const controls: Control[] = [];
    const chrome: Control[] = [];
    for (const el of doc.body.querySelectorAll('button, select, input')) {
      if (!el.checkVisibility()) continue;
      const type = el.type;
      const cs = getComputedStyle(el);
      const rec: Control = {
        path: label(el),
        parent: label(el.parentElement ?? el),
        h: Math.round(el.getBoundingClientRect().height * 10) / 10,
        bg: cs.backgroundColor,
        border: `${cs.borderTopStyle} ${cs.borderTopWidth}`,
      };
      // The user agent's own button: a `2px outset` bevel over `rgb(239, 239, 239)`. `§1.1`
      // measured nineteen of these in a dark UI. The bevel is the load-bearing half of the test —
      // `outset` is a border style nothing in this stylesheet ever sets, in any theme.
      if (cs.borderTopStyle === 'outset' || cs.borderTopStyle === 'inset' || rec.bg === 'rgb(239, 239, 239)') chrome.push(rec);
      if (type === 'checkbox' || type === 'radio') continue;
      controls.push(rec);
    }
    return { tokens: [...tokens], offPalette, painted, controls, chrome };
  });

/** Every page state the gate walks: the landing, then each door's four tabs. */
const states: Array<[string, string]> = [['', 'landing'], ...DOORS.flatMap((d) => TABS.map((t): [string, string] => [d, t]))];

const visit = async (door: string, tab: string): Promise<void> => {
  if (tab === 'landing') {
    await page.goto(`${pageUrl}#/`);
    await page.reload();
    await page.locator('.landing-head, [data-doorbar]').first().waitFor();
    return;
  }
  await at(door, tab);
};

// ── 1. The default, which is the one claim about a theme rather than within one ────────────────

test('a page told nothing renders Terminal — the default is the bare `:root` block and no script', async () => {
  // `D1107`. The user judged the four on the real app and chose `Terminal`, and the whole change
  // was two selectors swapping bodies. **That is the claim worth gating**, because the cheap way to
  // move a default is a line of JavaScript that stamps an attribute on load — which works, and
  // reintroduces exactly the flash `index.html`'s pre-paint script exists to prevent, and makes the
  // default a property of the app rather than of the stylesheet.
  //
  // So: no attribute, no stored choice, and the page is nonetheless Terminal.
  const fresh = await openPage();
  try {
    await fresh.goto(`${pageUrl}#/`);
    await fresh.locator('.landing-head, [data-doorbar]').first().waitFor();
    assert.equal(await fresh.evaluate(() => document.documentElement.getAttribute('data-tflw-theme')), null, 'something stamped the attribute on a page that had no choice to restore');
    assert.equal(await fresh.evaluate(() => window.localStorage.getItem('tflw.theme')), null, 'the page wrote a choice nobody made');
    const read = await fresh.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return { bg: getComputedStyle(document.body).backgroundColor, unit: cs.getPropertyValue('--unit').trim(), radius: cs.getPropertyValue('--radius').trim() };
    });
    // Terminal's three most recognisable tokens. `--radius: 0px` is the one no other theme has, so
    // it alone separates this from Instrument; the ground and the unit are here because a gate that
    // rests on one token is a gate one typo away from passing on the wrong theme.
    assert.equal(read.bg, 'rgb(8, 9, 11)', 'the untold page is not on Terminal’s ground');
    assert.equal(read.unit, '7px');
    assert.equal(read.radius, '0px');
  } finally {
    await fresh.close();
  }
});

// ── 2. Geometry and UA chrome: theme-independent, gated once ───────────────────────────────────

test('no control on any door renders in the user agent’s own chrome', async () => {
  // `M213-01`, as a standing claim. `§1.1` measured **19 of 53** — `+ new test`, `+ new file`,
  // `+ request`, `cancel`, and all thirteen `AddClause` options — every one of them the previous
  // milestone's own work, and every one of them silently correct by the stylesheet's rules at the
  // time: appearance was a property of which container a control landed in, so a control placed
  // somewhere new was unstyled by construction.
  const seen: string[] = [];
  let controls = 0;
  for (const [door, tab] of states) {
    await visit(door, tab);
    const r = await probe();
    controls += r.controls.length;
    for (const c of r.chrome) seen.push(`${door || 'landing'}/${tab}: ${c.path} — ${c.bg}, border ${c.border}`);
  }
  // The denominator. A page that renders no controls satisfies the line below perfectly.
  assert.ok(controls > 100, `the gate walked ${controls} controls across ${states.length} page states — it is not reaching the forms`);
  assert.deepEqual(seen, [], `${seen.length} controls compute to browser-default chrome`);
});

test('control: the instrument sees UA chrome when there is some', async () => {
  // Without this the line above is one `querySelectorAll` typo away from being an assertion about
  // an empty array, which is `M168`'s rule and this project's most-repeated finding.
  await visit('api', 'compose');
  const clean = (await probe()).chrome.length;
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.textContent = 'unreachable by the base layer';
    b.setAttribute('style', 'all: revert');
    document.querySelector('.main')?.appendChild(b);
  });
  const withOne = (await probe()).chrome;
  assert.equal(clean, 0);
  assert.equal(withOne.length, 1, 'a control handed back to the user agent did not read as UA chrome');
  assert.match(withOne[0]!.border, /outset/, 'the bevel is what names it, and the instrument did not read one');
});

test('no control is wildly out of scale with the controls beside it', async () => {
  // `M213-02`, as a standing claim, and it is the THIRD recurrence of this exact defect: a
  // single-line `input` measured **130 px** in the `NewThing` dialog, because `.authoring label`
  // (0,1,1) beat `.field` (0,1,0) on `align-items` and `flex-basis` is measured on the container's
  // main axis — so `flex: 1 1 120px`, a width in every row in the stylesheet, was a **height**
  // there. `styles.css` carried two prior comments predicting it by name.
  //
  // **THE CLAIM IS RELATIVE, AND THAT IS THE WHOLE DESIGN.** A pinned pixel height would have to be
  // re-tuned every time a theme's `--unit` moved — all four differ — and would go stale as a
  // feature slice adds a control. *A control is the size of the controls around it* is true in all
  // four themes and stays true as the pane grows, which is what lets this gate survive `S2`–`S6`
  // without being edited. `1.6` is `S0`'s own bar; the worst real group measured **1.41**.
  const BAR = 1.6;
  const worst: Array<{ where: string; ratio: number; detail: string }> = [];
  for (const [door, tab] of states) {
    await visit(door, tab);
    const { controls } = await probe();
    const byParent = new Map<string, Control[]>();
    for (const c of controls) {
      const k = `${c.parent}`;
      byParent.set(k, [...(byParent.get(k) ?? []), c]);
    }
    for (const [parent, group] of byParent) {
      // Three, not two: with two controls the "median" is their mean and every pair of unequal
      // controls produces a ratio, so a two-control group reports noise rather than an outlier.
      if (group.length < 3) continue;
      const hs = group.map((c) => c.h).sort((a, b) => a - b);
      const median = hs[Math.floor(hs.length / 2)]!;
      if (median <= 0) continue;
      const tallest = group.reduce((a, b) => (a.h > b.h ? a : b));
      const ratio = tallest.h / median;
      if (ratio > BAR) worst.push({ where: `${door || 'landing'}/${tab} ${parent}`, ratio: Math.round(ratio * 100) / 100, detail: `${tallest.path} is ${tallest.h}px against a median of ${median}px` });
    }
  }
  assert.deepEqual(worst, [], `${worst.length} control groups have a member more than ${BAR}× its siblings’ median`);
});

test('the dialog that carried the 130px input is measured too — it is not on any tab', async () => {
  // `NewThing` is a modal. It is in no door's tab tree, so every loop above walks straight past the
  // one surface `§1.2` actually measured, and a gate that misses its own founding defect is a gate
  // that would have passed on the day the defect shipped.
  await visit('api', 'compose');
  await page.locator('[data-new-thing-open], [data-new-test], button:has-text("new test")').first().click();
  await page.locator('.new-thing').waitFor();
  const { controls, chrome } = await probe();
  const inDialog = await page.locator('.new-thing input, .new-thing select, .new-thing button').count();
  assert.ok(inDialog >= 3, `the dialog offered ${inDialog} controls — it did not open`);
  assert.deepEqual(chrome, [], 'the dialog renders a control in browser chrome');
  const fields = controls.filter((c) => c.parent.startsWith('label') || c.parent.includes('field'));
  const tall = fields.filter((c) => c.h > 60);
  assert.deepEqual(tall, [], 'a single-line field in this dialog is over 60px tall — the flex-basis collision is back');

  // `M213-03`, in the same breath because it is the same screenshot: the empty preview bar.
  const previewBox = await page.locator('[data-new-preview]').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { text: (el.textContent ?? '').length, h: r.height };
  });
  assert.equal(previewBox.text, 0, 'the preview has content, so this says nothing about the empty case');
  assert.equal(previewBox.h, 0, 'an empty preview still paints a box');
  await page.keyboard.press('Escape');
});

test('control: the instrument sees a control out of scale when there is one', async () => {
  await visit('api', 'compose');
  const inflated = await page.evaluate(() => {
    const groups = new Map<ElLike, ElLike[]>();
    for (const el of document.querySelectorAll('button, select, input')) {
      if (!el.checkVisibility() || !el.parentElement) continue;
      groups.set(el.parentElement, [...(groups.get(el.parentElement) ?? []), el]);
    }
    for (const [, group] of groups) {
      if (group.length < 3) continue;
      group[0]!.style.height = '200px';
      return true;
    }
    return false;
  });
  assert.ok(inflated, 'no group of three controls exists on this pane, so the gate above has nothing to judge');
  const { controls } = await probe();
  const byParent = new Map<string, Control[]>();
  for (const c of controls) byParent.set(c.parent, [...(byParent.get(c.parent) ?? []), c]);
  const ratios = [...byParent.values()]
    .filter((g) => g.length >= 3)
    .map((g) => {
      const hs = g.map((c) => c.h).sort((a, b) => a - b);
      return Math.max(...hs) / hs[Math.floor(hs.length / 2)]!;
    });
  assert.ok(Math.max(...ratios) > 1.6, `the instrument read ${Math.max(...ratios).toFixed(2)} against a control inflated to 200px`);
});

test('a door’s Compose is measured in every theme, because its height is theme-dependent', async () => {
  // **THE CLAIM `ui-page.test.ts` COULD NOT MAKE.** That gate renders the default theme and only
  // the default, so a form that fits one screen under the densest of the four and overflows under
  // the other three is invisible to it — which is exactly what LOAD's form was doing from the day
  // `S0` shipped the themes until `D1107` changed which one is the default and the equality it
  // rested on went red at 904 against 900.
  //
  //     door      Instrument  Terminal  Paper  Ribbon     --unit
  //     BROWSER      900        900      900    900         6 / 7 / 9 / 11
  //     LOAD         900        904      934    963
  //
  // **A RATIO AND NOT A PIXEL COUNT.** Every number above is a function of `--unit`, so pinning any
  // one of them pins a theme; what does not move with the theme is *how many screens this pane
  // asks the reader for*, and that is the quantity `D1086` set a target for. The bar is `1.10`,
  // which the worst theme meets today at **1.07** and which a genuine regression — a control that
  // stopped collapsing, a panel that stopped being conditional — would break immediately.
  //
  // **IT IS 1.0 SINCE `M213` `S6`, AND THE ROUTE THERE IS THE POINT.** This paragraph used to say
  // the bar was *not* 1.0 and why: LOAD's Compose was over one screen in three of four themes
  // (900 / 904 / 934 / 963), the gate was not pretending otherwise, and shaving 63 px off a form
  // `S6` was about to replace would have been work thrown away — `M213-14` carried it in the
  // meantime. `S6` replaced it (`D1103`): the ten-option shape `<select>` and the two-option unit
  // `<select>` became one 4×2 grid, and the `<pre>` preview became the plot. Measured the same
  // way, on the box: **900 / 900 / 900 / 900**. The overflow did not need shaving off; it needed
  // the pane it was in.
  // **TWO BARS, BECAUSE THERE ARE TWO KINDS OF PANE HERE AND ONE BAR WOULD HAVE TO SUIT THE LOOSER
  // OF THEM.** LOAD and SCAN's Compose is a *form* — a fixed set of fields — and a form that does
  // not fit one screen is a form that is too long. API's is a *reader*: `M210` `S1` gave it the
  // open file's outline, so it is as tall as the file has declarations and one screen was never
  // the target. Measured at 1.26–1.44 when this was written and **1.29–1.46** after `M213` `S2`
  // put a response on every request (`D1109` is why that cost one line in a header rather than a
  // block per request).
  //
  // API's `1.50` is `D1086`'s own figure, and what it is NOT is worth saying: `D1086` measures a
  // **13-request** file at 2.67 screens, and this gate's fixture is not that file. So this bar
  // holds the floor against a regression on the fixture the page gate has; it does not close
  // `D1086`, which stays open in `§6` where the round has carried it since `M212`.
  //
  // **BROWSER MOVED FROM THE FORM BAR TO THE READER BAR IN `M213` `S4`, BECAUSE THE PANE CHANGED
  // KIND.** Until that slice its Compose was `BrowserForm` — a fixed set of fields, so the form
  // bar was the right one and it met it. `D1094` retired that form and routed the door through
  // the same pane API uses, which draws the open file's outline; measured the same run, BROWSER
  // is **992 / 974 / 1118 / 1050** across Terminal · Instrument · Ribbon · Paper, and the tallest
  // of those is 1.24 screens. Holding a reader to a form's bar would be holding it to the one
  // property it deliberately no longer has. It keeps API's 1.50, which it clears with room —
  // and that gap is itself worth watching, since the two panes are now one implementation and a
  // regression in it would move both.
  //
  // **API LEFT THIS TABLE IN `M214`, AND THE REASON IS THAT THE BAR AND `D1086` COULD NOT BOTH
  // HOLD.** `D1086` has two halves — *every request in the test is drawn*, defended by the
  // mutation `the-other-requests-are-not-drawn`, and *API Compose fits 1.50 screens*, defended by
  // this table. On the thirteen-request file `D1086` itself measures, the two together demand
  // thirteen requests in 1350 px: **104 px each, assertions included.** No design satisfies that,
  // so the only move left was compression, and four rounds of compression produced a pane its
  // reader could not use. A ceiling and a completeness rule written about the same artefact are
  // one decision taken twice, and this one was taken twice in opposite directions.
  //
  // It is **replaced and not merely deleted** — deleting a ceiling with nothing in its place is how
  // the pane got dense to begin with. The replacement is the test below this one, and it is
  // stronger in the one way that matters: it is checkable on the thirteen-request file, which this
  // bar never was (the fixture's largest test has four requests), and it is a property of the
  // layout rather than a number read off a fixture.
  //
  // **BROWSER STAYS**, because its pane did not change. `D1094` made the two doors one pane and
  // `M214` reverses that for the duration of the round: BROWSER still draws `ComposePane`, still
  // scrolls as one document, and *how many screens does this ask for* is still the right question
  // about it. Removing its bar because API's went would be dropping a live gate for a reason that
  // is not about the thing it gates.
  /* **LOAD LEFT THIS TABLE IN `M224` `D`** (`D1210`), for the same reason API left it in `M214`
     `A1`: it renders `ComposePane` now, which is three regions that each scroll inside themselves,
     and *how many screens does this ask for* is only a question you can ask of a document that
     scrolls as one. Its 1.0 bar would still pass — `main-fill` pins `.main` to the window, so the
     ratio is 1.0 by construction and the gate would be green whatever the pane did. It is
     **replaced and not deleted**: the property test below now runs its three clauses on this door
     as well, which is checkable on the thirteen-request file the bar never was. */
  const BAR: Record<string, number> = { browser: 1.5, scan: 1.1 };
  const over: string[] = [];
  const table: string[] = [];
  for (const door of DOORS) {
    for (const theme of THEMES) {
      await at(door, 'compose');
      await wear(theme);
      // The theme is a stylesheet swap, not a state change, so the next paint is the new geometry.
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      const h = await page.locator('.main').evaluate((el) => el.scrollHeight);
      table.push(`${door}/${theme} ${h}`);
      const bar = BAR[door];
      // API is measured by the test below instead — see the note on `BAR`. It is still *visited*
      // here, so the loop's own denominator keeps counting all four doors and a door that stopped
      // rendering is still caught.
      if (bar !== undefined && h / 900 > bar) over.push(`${door} on ${theme}: ${h}px — ${(h / 900).toFixed(2)} screens, over its ${bar} bar`);
    }
  }
  // The denominator: a pane that failed to render measures nothing and passes a ceiling.
  assert.equal(table.length, DOORS.length * THEMES.length, 'a door/theme pair did not measure');
  assert.ok(await page.locator('.main').evaluate((el) => el.scrollHeight) > 100, 'the instrument is reading an empty pane');
  assert.deepEqual(over, [], `a door’s Compose asks for more screens than its bar\n${table.join('\n')}`);
});

/**
 * **WHAT REPLACES API'S HEIGHT BAR** — `M214` `A1` (`D1110`).
 *
 * The bar asked *how many screens does this pane want*, which is only a question you can ask of a
 * document that scrolls as one. API's Compose is three regions now — the explorer, the test's
 * sequence, and the editor with its response under it — and **each one scrolls inside itself**, so
 * the property worth holding is not a ratio at all: the page has no vertical overflow, at any
 * window height, on any file.
 *
 * **IT IS CHECKED ON A THIRTEEN-REQUEST FILE, WHICH THE BAR NEVER WAS.** `D1086` set its target by
 * measuring a thirteen-request file at 2.67 screens; the fixture project's largest test has four
 * requests, so the bar it produced was held against a file three times smaller than the one that
 * motivated it, and the §6 row carrying `D1086` stayed open for three rounds because of exactly
 * that gap. This gate writes the file it needs.
 *
 * The three clauses, in the order they can fail:
 *
 *  1. the **document** does not scroll — `scrollHeight` is the window's height;
 *  2. every region's bottom edge is on screen;
 *  3. the sequence column's own content really is taller than the column, so clause 1 is the
 *     layout holding and not the file being small enough to fit anyway.
 *
 * Clause 3 is the denominator this file's other gates all carry, and it is what makes this
 * stronger than the bar rather than merely different: a bar passes when the pane renders nothing.
 */
/**
 * Open a file this gate has just **written**, and be sure the pane is showing that file
 * (`M234` `A4`/`A5`, `D1308`).
 *
 * Two gates in this file write a fixture and navigate straight to it, and both assumed the served
 * project's listing had caught up. `M215` `B3` proved it does not always:
 * `{"tab":"true","editor":1,"bodyEdit":0,"ink":0,"rows":9}` — nine rows for a file of two steps, so
 * the route had fallen back and every measurement after it was about a different file.
 *
 * **The reload is the retry, and it is what a single `waitFor` cannot be.** `readProject` runs
 * `discoverTests` fresh and answers `cache-control: no-store`, so the listing a page holds is the
 * one it fetched on load — a page that opened before the write landed will go on showing the
 * fallback for as long as anything waits on it. `A4` asked for the right element and waited 30
 * seconds for it on CI Node 22 rather than loading again, which is the same mistake in a new
 * costume: *waiting longer for a page that will never change its mind*.
 *
 * If six loads is not enough, the failure names what the pane IS showing and what the explorer
 * lists — because this round has now twice repaired a timeout whose message named the wrong thing.
 */
const showWrittenFile = async (url: string, path: string): Promise<void> => {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await page.goto(url);
    await page.reload();
    await page.locator('[data-seq-col]').waitFor();
    if (await page.locator(`[data-compose-file="${path}"]`).count() > 0) return;
    await page.waitForTimeout(500);
  }
  const seen = await page.locator('[data-compose-file]').evaluateAll((els) => els.map((e) => e.getAttribute('data-compose-file')));
  const rows = await page.locator('[data-file-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-file-row')));
  assert.fail(
    `${path} was written before the first of six loads and the pane is still showing ${JSON.stringify(seen)}; ` +
    `the explorer lists ${JSON.stringify(rows)}`,
  );
};

test('no region of the Compose pane overflows the window, on a thirteen-request file, on either door that draws it', async () => {
  // Thirteen requests, each with two assertions and a capture between two of them — the shape the
  // corpus census found (2.49 requests per test, 101 interleaved statements, 81% of bindings read
  // downstream), at the size `D1086` measured.
  const lines: string[] = ['# a file the gate writes, to hold the pane to the size that motivated `D1086`', '', '@api', 'test "thirteen requests"'];
  for (let i = 1; i <= 13; i++) {
    lines.push(`  api GET /items/${i}`);
    // **Two spaces and not four.** An indented line under an `api` step is part of the REQUEST —
    // only `header` and `retry honoring` may sit there (`TF010`) — so a nested `expect` is not an
    // assertion about the response, it is a parse error. The first draft of this fixture wrote
    // four, which made the gate measure a salvage, and the `data-recovered` check beside it is
    // what said so.
    lines.push('  expect status equals 200');
    lines.push('  expect body.name equals "widget"');
    if (i === 3) lines.push('  capture body.name as picked');
  }
  const wide = join(projectRoot, 'tests', 'thirteen.tflw');
  await writeFile(wide, lines.join('\n') + '\n');
  try {
    const over: string[] = [];
    const table: string[] = [];
    /* **Both doors that draw this pane, since `M224` `D`.** The file is functional and that is not
       a problem on LOAD: `D1063` — the door is a count, never a filter — so the explorer lists
       every file behind every door and this one opens there like any other. What is being held is
       the layout, which is `vocabulary.ts`'s to differ about and not `ComposePane`'s. */
    for (const [door, theme] of DOORS.filter((d) => d === 'api' || d === 'load').flatMap((d) => THEMES.map((t) => [d, t] as const))) {
      await showWrittenFile(`${pageUrl}#/${door}/compose/tests/thirteen.tflw`, 'tests/thirteen.tflw');
      // A file the parser only RECOVERED draws fewer rows than it has statements, and a height gate
      // reading a salvage is a height gate reading a smaller file. The first draft of this fixture
      // wrote `expect body.name is not empty`, which is not a matcher this language has.
      // **`data-recovered` and not `data-diagnostics`**: the badge carrying the second is also the
      // WARNING badge, so the first draft of this line read a file that parses perfectly and a
      // missing tag as the same failure. A height gate reading a salvage is a height gate reading a
      // smaller file, which is the thing worth catching.
      /* `M235` `C2` — this is an ABSENCE, and an absence read off an explorer that has not drawn
         the row is a pass for the wrong reason: `count()` waits for nothing, and zero badges on
         zero rows reads exactly like zero badges on a clean file. `showWrittenFile` above returns
         when the *pane* shows the file, which is a different subject from the *row* this claim is
         about. So the row is established first and the badge is then read once. */
      const listed = await settle(
        () => page.locator('[data-file-row="tests/thirteen.tflw"]').count(),
        untilMeasurable('the explorer has drawn the row this claim is about', (n) => n > 0),
        { attempts: 40, delayMs: 50, page },
      );
      assert.ok(listed.value > 0, `the explorer lists the file the gate wrote (${listed.attempts} look(s))`);
      // one-shot: read over the row the wait above established; retrying an absence would only
      // delay a real salvage badge until the budget ran out
      assert.equal(await page.locator('[data-file-row="tests/thirteen.tflw"] [data-recovered]').count(), 0, 'the file the gate wrote does not parse');
      /* `M234` `A` — WAIT FOR THE FOURTEENTH ROW BEFORE MEASURING (`D1308`). `[data-seq-col]`
         above is the column, not its contents: on a slow runner the column is attached while nine
         of the fourteen rows are drawn, and the double `requestAnimationFrame` below settles PAINT
         rather than data, so it cannot help. Node 22 failed exactly this in CI — *"the gate is
         reading 9 sequence rows, not a thirteen-request file"* — on a commit the box ran green.
         A wait on the row that must exist is the retry `querySelectorAll().length` never had, and
         it carries the claim in the selector the way this file's own `data-seq-adds` note asks. */
      // 60s and not the default 30: this replaces an assertion that failed FAST with a wait that
      // fails SLOW, and a CI runner is exactly where the rows are late. The file already buys the
      // same headroom for its slow waits. Measured: on a 12-way-loaded box the fourteenth row
      // takes longer than 30s, which is harsher than any runner but shows the default is the
      // binding constraint rather than the page.
      await page.locator('[data-seq-row]').nth(13).waitFor({ timeout: 60_000 });
      await wear(theme);
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

      const seen = await page.evaluate(() => {
        const box = (sel: string): { bottom: number; scroll: number; client: number } | null => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { bottom: r.bottom, scroll: el.scrollHeight, client: el.clientHeight };
        };
        return {
          page: document.documentElement.scrollHeight,
          window: window.innerHeight,
          rows: document.querySelectorAll('[data-seq-row]').length,
          seq: box('.seq'),
          frame: box('.seq-col'),
          editor: box('.editor'),
          response: box('.responsebox'),
        };
      });

      table.push(`${door}/${theme}: page ${seen.page} / window ${seen.window}, ${seen.rows} rows`);
      // 1 px of slack, and no more: a sub-pixel layout rounds, a region hanging off the bottom does
      // not round to within a pixel of the fold.
      if (seen.page > seen.window + 1) over.push(`${door}/${theme}: the document scrolls — ${seen.page}px in a ${seen.window}px window`);
      for (const [name, r] of [['sequence', seen.frame], ['editor', seen.editor], ['response', seen.response]] as const) {
        if (r === null) {
          over.push(`${door}/${theme}: there is no ${name} region on the page at all`);
          continue;
        }
        if (r.bottom > seen.window + 1) over.push(`${door}/${theme}: the ${name} region ends ${Math.round(r.bottom - seen.window)}px below the fold`);
      }
      // Clause 3 — the denominator. Thirteen requests and the test's own row.
      assert.equal(seen.rows >= 14, true, `the gate is reading ${seen.rows} sequence rows, not a thirteen-request file`);
      assert.equal(seen.seq !== null && seen.seq.scroll > seen.seq.client, true, `${door}/${theme}: the sequence column is not overflowing its own box, so clause 1 proves nothing`);
    }
    assert.deepEqual(over, [], `a region of the Compose pane runs off the window\n${table.join('\n')}`);
  } finally {
    await rm(wide, { force: true });
  }
});

/**
 * **The control the gate above needs: its instrument can read an overflow at all.**
 *
 * Clause 1 is `documentElement.scrollHeight <= innerHeight`, and *the page does not scroll* is also
 * what a page that rendered nothing would report. So this puts something tall on the page and reads
 * the same number — which is the shape every control in this file takes, and the reason the four
 * appearance gates each have one.
 *
 * It is an injected element rather than a stylesheet that un-constrains the pane, and the first
 * draft was the latter: three rules lifting `overflow`, `display` and `height` off six selectors,
 * measured at **7 px** of overflow. That is not the instrument failing — it is a fair reading of a
 * pane whose editor region shrinks to its content the moment it stops being a grid row, so the
 * un-constrained document was barely taller than the constrained one. A control whose own premise
 * has to be argued for is not a control.
 */
test('control: the instrument sees the document overflow when there is some', async () => {
  await at('api', 'compose');
  const before = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  assert.ok(before <= 1, `the page already overflows by ${before}px before the control did anything`);
  const after = await page.evaluate(() => {
    const tall = document.createElement('div');
    tall.setAttribute('style', 'height: 2400px');
    document.body.appendChild(tall);
    return document.documentElement.scrollHeight - window.innerHeight;
  });
  assert.ok(after > 2000, `the instrument read ${after}px of overflow against a 2400px element on the page`);
  await page.reload();
});

// ── 3. Palette closure: theme-dependent, gated on all four ─────────────────────────────────────

test('every colour painted on every door comes from the theme, in all four themes', async () => {
  // `§1.5`'s finding was that the palette in actual use was **five greys and one blue**, with
  // `--pass`, `--fail` and `--warn` declared and spent zero times — a token set that described the
  // page less well than the page described itself. This is the other half of that: a colour that is
  // *not* a token is a decision taken in one rule, invisible to the theme, and wrong in at least
  // one of the four by construction. `S1` found two of them — the modal scrim and the mat under a
  // screenshot — both written as literals, both now tokens.
  //
  // **ALPHA IS IGNORED AND THE COMMENT ON `probe` SAYS WHY**: every tint here is the token's own
  // triple carrying an alpha, so the triple is the identity and matching on it admits `color-mix`
  // without admitting anything the theme never declared.
  const bad: string[] = [];
  let painted = 0;
  for (const [door, tab] of states) {
    await visit(door, tab);
    for (const theme of THEMES) {
      await wear(theme);
      const r = await probe();
      painted += r.painted;
      for (const p of r.offPalette) bad.push(`${theme} ${door || 'landing'}/${tab}: ${p.path} { ${p.prop}: ${p.value} }`);
    }
  }
  assert.ok(painted > 4000, `the gate read ${painted} painted colours — it is not walking the page`);
  assert.deepEqual(bad.slice(0, 25), [], `${bad.length} painted colours are not in the theme’s token set`);
});

test('`M215` `B3`: the coloured copy and the field under it are one box, in all four themes', async () => {
  /**
   * **The one way an overlay editor fails, asserted rather than reviewed.**
   *
   * A `<textarea>` cannot be coloured, so the colour is a `<pre>` and the text on top is
   * transparent — and the classic failure of that arrangement is the two boxes disagreeing about
   * where a character sits, which shows up as a caret drifting away from the glyph it is in front
   * of. Every metric that can cause it is compared here: the rectangle first, then the text
   * metrics, then the one that is easy to miss.
   *
   * **`.t-kw` is bold in all four themes** (`--kw-weight` is 600 or 700 everywhere), and a JSON
   * body's `true`/`false`/`null` are painted `kw` by `jsonview`'s second rule — so without the
   * rule that neutralises weight in the ink, those characters are wider in the copy than under the
   * caret and every glyph after them on that line is misplaced. Four themes and not one, because
   * that hazard is a theme token: a single-theme gate would have been green on whichever theme it
   * happened to render.
   */
  const file = join(projectRoot, 'tests', 'jsonbody.tflw');
  await writeFile(file, ['test "a body to paint"', '  api POST /orders body { ok: true, who: null, qty: 3 }', '  expect status equals 201', ''].join('\n'));
  try {
    for (const theme of THEMES) {
      await showWrittenFile(`${pageUrl}#/api/compose/tests/jsonbody.tflw`, 'tests/jsonbody.tflw');
      /* `M234` `A` — the ROW, not the column (`D1308`). Same hazard as the thirteen-request gate
         above: `[data-seq-col]` is attached before its rows are, so the pick below could land
         mid-redraw, the selection not take, and the body tab never appear — which surfaces 100
         lines later as `waitFor: Timeout 30000ms exceeded` on `[data-body-ink]`, blaming the
         editor for something the sequence column did. Reproduced on a 12-way-loaded box; never
         seen in CI, so this is the hazard applied at the next site rather than a fix for an
         observed CI failure. */
      await page.locator('[data-seq-row="request"]').first().waitFor();
      await wear(theme);
      await page.locator('[data-seq-row="request"] [data-seq-pick]').first().click();
      await page.locator('[data-editor-tab="body"]').click();
      /* `M234` `A2` — 60s, and say what was on the page if it still is not there (`D1308`).
         The default 30 timed out here on CI Node 22 and on a 12-way-loaded box, while an
         unloaded box renders it every time — the same shape as the fourteenth-row wait above,
         where the default was the binding constraint rather than the page. If 60 is not the
         answer either, the message below is: this gate cannot presently tell a body editor that
         never opened from one that opened without ink, and guessing between them from a bare
         `TimeoutError` is what this round has already got wrong twice. */
      await page.locator('[data-body-ink]').waitFor({ timeout: 60_000 }).catch(async () => {
        const state = await page.evaluate(() => ({
          tab: document.querySelector('[data-editor-tab="body"]')?.getAttribute('aria-selected') ?? null,
          editor: document.querySelectorAll('[data-editor]').length,
          bodyEdit: document.querySelectorAll('[data-body-edit-text]').length,
          ink: document.querySelectorAll('[data-body-ink]').length,
          rows: document.querySelectorAll('[data-seq-row]').length,
        }));
        assert.fail(`[data-body-ink] never appeared on ${theme} — ${JSON.stringify(state)}`);
      });
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

      const fit = await page.evaluate(() => {
        const ink = document.querySelector('[data-body-ink]')!;
        const edit = document.querySelector('[data-body-edit-text]')!;
        const a = ink.getBoundingClientRect();
        const b = edit.getBoundingClientRect();
        const ia = getComputedStyle(ink);
        const ib = getComputedStyle(edit);
        const kw = ink.querySelector('.t-kw');
        return {
          box: [Math.round(a.x - b.x), Math.round(a.y - b.y), Math.round(a.width - b.width), Math.round(a.height - b.height)],
          differs: (['fontFamily', 'fontSize', 'lineHeight', 'paddingLeft', 'paddingTop', 'borderLeftWidth', 'whiteSpace', 'letterSpacing', 'tabSize'] as const)
            .filter((k) => ia[k] !== ib[k]),
          text: ink.textContent,
          value: (edit as unknown as { value: string }).value,
          kwText: kw === null ? null : kw.textContent,
          kwWeight: kw === null ? null : getComputedStyle(kw).fontWeight,
          kwStyle: kw === null ? null : getComputedStyle(kw).fontStyle,
          inkWeight: ia.fontWeight,
          inkStyle: ia.fontStyle,
        };
      });
      assert.deepEqual(fit.box, [0, 0, 0, 0], `${theme}: the coloured copy and the field are not the same rectangle`);
      assert.deepEqual(fit.differs, [], `${theme}: the two boxes disagree about a metric that decides where a glyph lands`);
      // The trailing newline is the copy's alone — it is what keeps a caret on the last line
      // inside the box — and it is the only difference the two are allowed.
      assert.equal(fit.text, `${fit.value}\n`, `${theme}: the copy and the field are not the same bytes`);
      assert.equal(fit.kwText, 'true', `${theme}: the literal is not painted as one`);
      assert.equal(fit.kwWeight, fit.inkWeight, `${theme}: a bold run in the copy shifts every glyph after it`);
      assert.equal(fit.kwStyle, fit.inkStyle, `${theme}: an italic run does the same`);
    }
  } finally {
    await rm(file, { force: true });
  }
});

test('control: the instrument sees a colour the theme never declared', async () => {
  await visit('api', 'compose');
  assert.equal((await probe()).offPalette.length, 0);
  await page.evaluate(() => {
    const d = document.createElement('div');
    // Deliberately not near anything: a colour no theme in this file could round to.
    d.setAttribute('style', 'color: rgb(1, 2, 3); background: rgb(250, 0, 250)');
    d.textContent = 'off-palette';
    document.querySelector('.main')?.appendChild(d);
  });
  const off = (await probe()).offPalette;
  // **The set, not the count.** The first draft asserted `2` — one `color` and one
  // `background-color` — and read **6**, because an element that sets neither `border-color` nor a
  // border style still computes four border colours, and they default to `currentColor`: the
  // injected `rgb(1, 2, 3)` therefore lands five times. The instrument was right and the control's
  // arithmetic was wrong, which is worth leaving written down — a control that fails is only
  // evidence once you know which of the two it convicted.
  assert.deepEqual([...new Set(off.map((p) => p.value))].sort(), ['rgb(1, 2, 3)', 'rgb(250, 0, 250)'], 'the instrument did not see both injected colours');
  assert.ok(off.every((p) => p.path.startsWith('div')), 'the injection reddened something other than itself');
});

test('the state tokens are spent, not merely declared — the Run tab paints pass and fail', async () => {
  // The positive half of `§1.5`. Closure says nothing arrived from outside the theme; it does not
  // say the theme's own vocabulary is used, and a page painting five greys out of a forty-token set
  // satisfies it perfectly. `--pass` and `--fail` are the two the plan measured at **zero uses**.
  //
  // The Run tab and not Compose, deliberately and with the gap named: Compose shows no run state at
  // all today, which is `M213-06`'s family and what `S2` exists to fix. When `S2` lands, this test
  // gains Compose and the pane it describes stops being a claim about a report.
  await visit('api', 'run');
  for (const theme of THEMES) {
    await wear(theme);
    const spent = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const want = ['--pass', '--fail'].map((n) => {
        const scratchEl = document.createElement('span');
        scratchEl.style.color = cs.getPropertyValue(n).trim();
        document.body.appendChild(scratchEl);
        const v = getComputedStyle(scratchEl).color;
        scratchEl.remove();
        return v;
      });
      const found = new Set<string>();
      for (const el of document.body.querySelectorAll('*')) {
        if (!el.checkVisibility()) continue;
        const s = getComputedStyle(el);
        for (const v of [s.color, s.backgroundColor, s.borderTopColor, s.borderLeftColor]) {
          const i = want.indexOf(v);
          if (i !== -1) found.add(['--pass', '--fail'][i]!);
        }
      }
      return [...found].sort();
    });
    assert.deepEqual(spent, ['--fail', '--pass'], `${theme} declares the state hues and the report does not paint them`);
  }
});

// ── 4. Contrast: the claim `D1104` does not make, and the page was failing ─────────────────────
//
// **THE FINDING THAT PUT THIS SECTION HERE.** Section 3 above reads four thousand painted colours
// across four themes and seventeen page states and asserts every one of them is in the theme's
// token set. It was green — and on the default theme, **241 elements were painting text nobody
// could read**. Every one of them is `--muted`, which *is* a declared token, so palette closure is
// satisfied exactly. The gate asserts **provenance**; it never asserts **legibility**, and a gate
// that checks where a value came from cannot see that the value is wrong.
//
// That is this repository's most-repeated shape, arriving here for the fourth time in one arc:
// `M223` `F` (*a door-keyed rule is green under every mutation that makes it construct-keyed*),
// `M227` `A` (*a rule keyed on one of three tenants is keyed on nothing*), `M228` `F1` (*a rule
// keyed on a proxy breaks the day the proxy gains a second member*).
//
// **WHY THIS IS NOT THE TASTE `D1104` REFUSES TO JUDGE.** Its own docblock says what it will not
// claim — *"It cannot tell you a palette is ugly, that a spacing is mean, or that a pane reads
// badly"* — and `D1105` reserves all three for the user on the running app. Legibility is not in
// that set. It is a ratio between two colours with a threshold published by someone else, and the
// page either clears it or does not. `D1249` amends `D1104` on exactly that line and nowhere else.
//
// **THE ARITHMETIC IS IN NODE, DELIBERATELY** (`contrast.ts`, unit-tested in `contrast.test.ts`).
// The probe below returns CSS strings and does no colour maths at all, because the maths is what
// the review got wrong: its parser read `color(srgb 0.68 …)` as an 8-bit triple and reported 1.05:1
// for text at 9.68:1. Splitting them is what lets the risky half be tested against pairs whose
// answers come from outside this repository.

/** One distinct way text is painted on this page, with a count and an example. */
interface Ink {
  readonly path: string;
  readonly sample: string;
  readonly color: string;
  /** `background-color` from the element outward, **nearest first** — `flatten` composites it. */
  readonly ground: readonly string[];
  readonly opacity: number;
  readonly size: number;
  readonly weight: number;
  readonly count: number;
}
interface InkProbe {
  readonly inks: readonly Ink[];
  /** Every element carrying direct text, counted before any exemption — the denominator. */
  readonly texts: number;
  /** Those skipped as inactive, reported so the exemption can never quietly become the page. */
  readonly inactive: number;
}

/**
 * Every distinct (ink, ground, size, weight) on the page, with one example element each.
 *
 * **Distinct and not per-element, for a reason that is about the failure message rather than the
 * cost.** A page has hundreds of text nodes and a handful of ways of painting them; reporting the
 * elements would print `--muted` two hundred and forty-one times and bury the two syntax tokens
 * beside it. Reporting the *ways* prints six rows, each saying how many elements it covers.
 *
 * **What is exempt, and it is one thing.** An inactive control — `:disabled`, inside a disabled
 * fieldset, or `aria-disabled="true"` — which is WCAG 1.4.3's own carve-out for inactive user
 * interface components. Nothing else. In particular a thing merely *dimmed* with `opacity` is
 * judged, with its opacity applied: this stylesheet dims a locked step, an unmatched file row and a
 * withheld finding that way, and each of those is text a reader is expected to read.
 *
 * **What it cannot see, said out loud rather than discovered as a gap.** Generated content — a
 * `::before` is not a text node, so the source view's line-number gutter is outside this walk;
 * `placeholder`, which is an attribute and absent in every state that has a value anyway; and text
 * over something that is not its own ancestor, since the ground is read by walking up. The first of
 * those is why `.source-text [data-source-line]::before` lost its `opacity` in this slice rather
 * than being gated.
 */
const inkProbe = (): Promise<InkProbe> =>
  page.evaluate(() => {
    const doc = document;
    const label = (el: ElLike): string => {
      const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
      const data = [...el.attributes].find((a) => a.name.startsWith('data-') && a.name !== 'data-tflw-theme');
      return `${el.tagName.toLowerCase()}${cls}${data ? `[${data.name}]` : ''}`;
    };

    const seen = new Map<string, { rec: Ink; n: number }>();
    let texts = 0;
    let inactive = 0;
    for (const el of doc.body.querySelectorAll('*')) {
      if (!el.checkVisibility()) continue;
      let text = '';
      for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue !== null) text += n.nodeValue;
      if (text.trim() === '') continue;
      texts++;
      if (el.closest('[disabled], [aria-disabled="true"]') !== null) {
        inactive++;
        continue;
      }
      const cs = getComputedStyle(el);
      // The ground and the opacity stack, in one walk outward. Opacity multiplies because nesting
      // two half-opaque boxes gives a quarter; the ground stops being collected the moment an
      // ancestor is opaque, which this file cannot decide — so everything is collected and `flatten`
      // decides in Node, where the parser lives.
      const ground: string[] = [];
      let opacity = 1;
      for (let a: ElLike | null = el; a !== null; a = a.parentElement) {
        const acs = a === el ? cs : getComputedStyle(a);
        ground.push(acs.backgroundColor);
        const o = parseFloat(acs.getPropertyValue('opacity'));
        if (!Number.isNaN(o)) opacity *= o;
      }
      const rec: Ink = {
        path: label(el),
        sample: text.trim().replace(/\s+/g, ' ').slice(0, 44),
        color: cs.color,
        ground,
        opacity: Math.round(opacity * 1000) / 1000,
        size: parseFloat(cs.fontSize),
        weight: parseFloat(cs.fontWeight),
        count: 1,
      };
      const key = `${rec.color}|${ground.join('>')}|${rec.opacity}|${rec.size}|${rec.weight}`;
      const hit = seen.get(key);
      if (hit === undefined) seen.set(key, { rec, n: 1 });
      else hit.n++;
    }
    return { inks: [...seen.values()].map((v) => ({ ...v.rec, count: v.n })), texts, inactive };
  });

interface Unreadable {
  readonly where: string;
  readonly path: string;
  readonly sample: string;
  readonly ratio: number;
  readonly bar: number;
  readonly count: number;
}

/** Judge one `inkProbe` reading. Every colour string goes through `contrast.ts` and nothing else. */
const unreadable = (where: string, r: InkProbe): { readonly bad: Unreadable[]; readonly judged: number; readonly noGround: string[] } => {
  const bad: Unreadable[] = [];
  const noGround: string[] = [];
  let judged = 0;
  for (const ink of r.inks) {
    const fg = parseColor(ink.color);
    // **Transparent ink is not a defect and this is the one place it occurs**: `M215`'s overlay
    // editor paints the colour in a `<pre>` and makes the `<textarea>` on top of it invisible, so
    // the field's own value is text nobody is meant to see. It is gated as a pair of boxes by the
    // `B3` test above; judging its contrast would be judging a design decision as a failure.
    if (fg === null || fg.a === 0) continue;
    const bg = flatten(ink.ground);
    if (bg === null) {
      noGround.push(`${where}: ${ink.path} — the walk to an opaque ground ended at ${ink.ground[ink.ground.length - 1]}`);
      continue;
    }
    judged++;
    const ratio = effective(fg, bg, ink.opacity);
    const bar = threshold(ink.size, ink.weight);
    if (ratio + 1e-9 < bar) bad.push({ where, path: ink.path, sample: ink.sample, ratio: Math.round(ratio * 100) / 100, bar, count: ink.count });
  }
  return { bad, judged, noGround };
};

const say = (u: Unreadable): string => `${u.where}: ${u.path} ${u.ratio}:1 < ${u.bar} (×${u.count}) — “${u.sample}”`;

test('every text on every door, in every theme, clears its contrast threshold', async () => {
  // `D1249`. The mutation that proves this gate is one theme's `--muted` put back to `#6e7681`,
  // and the test below makes it — on Terminal alone, which is also what proves the walk is
  // per-theme rather than reading the default four times.
  const bad: Unreadable[] = [];
  const noGround: string[] = [];
  let judged = 0;
  let texts = 0;
  let inactive = 0;
  for (const [door, tab] of states) {
    await visit(door, tab);
    for (const theme of THEMES) {
      await wear(theme);
      const r = await inkProbe();
      texts += r.texts;
      inactive += r.inactive;
      const v = unreadable(`${theme} ${door || 'landing'}/${tab}`, r);
      judged += v.judged;
      bad.push(...v.bad);
      noGround.push(...v.noGround);
    }
  }
  // The denominators, both of them. A walk that found no text satisfies the line below perfectly,
  // and an exemption that swallowed the page satisfies it just as well — `M228` `F`'s carry is that
  // a gate can be vacuous because the page has nothing to read.
  assert.ok(judged > 2000, `the gate judged ${judged} readings across ${states.length} states × ${THEMES.length} themes — it is not walking the page`);
  assert.ok(inactive < texts / 10, `${inactive} of ${texts} text elements were exempted as inactive — the carve-out has become the page`);
  assert.deepEqual(noGround, [], 'a reading never reached an opaque ground, so its ratio would have been invented');
  // Sorted worst-first: with one token wrong this prints the token, not the first element the walk
  // happened to reach.
  bad.sort((a, b) => a.ratio - b.ratio);
  assert.deepEqual(bad.slice(0, 12).map(say), [], `${bad.length} distinct ways of painting text render below their threshold`);
});

// ── §4b THE MARK (`M233` `H`, `D1290`) ────────────────────────────────────────────────────────
//
// **This exists because §4 above stopped being able to see the wordmark, and would have stayed
// green about it.** `inkProbe` walks elements carrying a direct text node — both places the page
// prints `tflw` were text nodes, so both were judged in all four themes, and `Wordmark` deleted
// them. An `<svg>` has no text node: the denominator `texts` drops by two, nothing is reported,
// and the largest mark on the landing becomes the one element whose legibility nothing checks.
// A gate whose subject walks out from under it is `M228`'s *rule keyed on a proxy* and `M223`'s
// *a threshold about the page's height is not a claim about the element*, one family down.
//
// **The bar is 3:1 and that is argued, not inherited.** WCAG 1.4.3 governs text; a stroked
// graphic is 1.4.11 Non-text Contrast, whose bar is 3. `threshold()` already returns 3 for large
// text and 4.5 for body, so the number is one this file's own arithmetic uses — what changes is
// which rule the subject falls under, and a 40px-tall stroke is on the far side of that line by
// any reading. Measured headroom on the shipped tokens is 5.31:1 at the narrowest.
//
// Ink and rail are judged SEPARATELY rather than as one mark. They are different colours by
// construction (`D1286`: ink is `currentColor`, the rail is `var(--accent)`), they come from
// different tokens, and a theme can break one without touching the other — the doorbar's ink is
// `--muted` while its rail is the same `--accent` as the hero's, so the two sites do not even
// share a failure mode.

interface Stroke {
  readonly where: string;
  readonly which: string;
  readonly stroke: string;
  readonly ground: readonly string[];
  readonly opacity: number;
}

/** Every painted stroke of every wordmark on the page, with the ground each sits on. */
const markProbe = (where: string): Promise<readonly Stroke[]> =>
  page.evaluate((w) => {
    const out: Array<{ where: string; which: string; stroke: string; ground: string[]; opacity: number }> = [];
    for (const svg of document.body.querySelectorAll('svg[aria-label="tflw"]')) {
      if (!svg.checkVisibility()) continue;
      // The ground is read from the SVG outward, exactly as `inkProbe` reads it for text: an SVG
      // paints nothing of its own (`fill="none"`), so the first opaque ancestor is what the
      // strokes actually sit on. `flatten` composites in Node.
      const ground: string[] = [];
      let opacity = 1;
      for (let a: ElLike | null = svg; a !== null; a = a.parentElement) {
        const cs = getComputedStyle(a);
        ground.push(cs.backgroundColor);
        const o = parseFloat(cs.getPropertyValue('opacity'));
        if (!Number.isNaN(o)) opacity *= o;
      }
      const site = svg.closest('.doorbar-home') !== null ? 'doorbar' : svg.closest('.landing-head') !== null ? 'hero' : 'elsewhere';
      for (const path of svg.querySelectorAll('path')) {
        const cs = getComputedStyle(path);
        // `stroke` is resolved by the browser, so `currentColor` arrives as the inherited colour
        // and `var(--accent)` as the theme's value — which is the whole point of reading the live
        // page rather than the stylesheet.
        out.push({ where: `${w} ${site}`, which: cs.stroke === getComputedStyle(path.parentElement!).stroke ? 'ink' : 'rail', stroke: cs.stroke, ground: [...ground], opacity });
      }
    }
    return out;
  }, where);

test('the wordmark clears the non-text contrast bar, in every theme, in both places it appears', async () => {
  const bad: string[] = [];
  let judged = 0;
  let narrowest = { what: '', ratio: Infinity };
  // The landing carries the hero; any door carries the doorbar. Both, per theme, because the
  // doorbar's ink is `--muted` and the hero's is `--fg` — one reading cannot stand for the other.
  for (const [door, tab] of [['', 'landing'], ['api', 'compose']] as Array<[string, string]>) {
    await visit(door, tab);
    for (const theme of THEMES) {
      await wear(theme);
      const strokes = await markProbe(`${theme} ${door || 'landing'}`);
      // Five strokes a mark, always: four ink and one rail. Asserted per site rather than in total,
      // because a component that rendered an empty `<svg>` would otherwise be caught only by the
      // aggregate below — and the aggregate is exactly the number a vacuous probe gets right.
      assert.equal(strokes.length, 5, `${theme} ${door || 'landing'}: expected one 5-stroke mark, saw ${strokes.length} strokes`);
      for (const st of strokes) {
        const fg = parseColor(st.stroke);
        assert.notEqual(fg, null, `${st.where}: the ${st.which} stroke did not parse — ${st.stroke}`);
        const bg = flatten(st.ground);
        assert.notEqual(bg, null, `${st.where}: the ${st.which} stroke never reached an opaque ground`);
        judged++;
        const ratio = effective(fg!, bg!, st.opacity);
        if (ratio < narrowest.ratio) narrowest = { what: `${st.where} ${st.which}`, ratio };
        // 1.4.11, not 1.4.3 — see the note above this test.
        if (ratio + 1e-9 < 3) bad.push(`${st.where}: ${st.which} ${Math.round(ratio * 100) / 100}:1 < 3`);
      }
    }
  }
  // 2 sites × 4 themes × 5 strokes. Spelled out so a walk that silently visited one state is a
  // failure here rather than a smaller green number.
  assert.equal(judged, 40, `the gate judged ${judged} strokes, not 40 — it is not walking both sites in every theme`);
  assert.deepEqual([...new Set(bad)], [], `the mark is under the 3:1 non-text bar somewhere (narrowest overall: ${narrowest.what} at ${Math.round(narrowest.ratio * 100) / 100}:1)`);
});

test('control: the mark probe convicts a stroke it cannot see', async () => {
  // The negative control the claim needs. Painting the rail a hair off its own ground is the
  // mutation a token edit would actually make — `--accent` is one line in `styles.css`, and the
  // failure it would cause is a rail that is present, correctly shaped, and invisible.
  await visit('', 'landing');
  await wear('terminal');
  assert.deepEqual((await markProbe('clean')).filter((s) => effective(parseColor(s.stroke)!, flatten(s.ground)!, s.opacity) < 3), []);
  await page.evaluate(() => {
    // `--bg` on Terminal is #08090b; #0e1013 is a hair off it, which is 1.09:1.
    document.querySelector('.landing-head svg[aria-label="tflw"] path:last-of-type')!.setAttribute('stroke', '#0e1013');
  });
  const after = await markProbe('injected');
  const convicted = after.filter((s) => effective(parseColor(s.stroke)!, flatten(s.ground)!, s.opacity) < 3);
  assert.equal(convicted.length, 1, `the probe convicted ${convicted.length} strokes — it should see exactly the injected one`);
  // …and it judged the other four rather than skipping them, which a count alone cannot show.
  assert.equal(after.length, 5, 'the injection reduced what the probe could see');
});

test('control: the instrument sees text it cannot read, and reads the large-text bar', async () => {
  // Two injections, because the claim has two halves and a single control would only prove one.
  await visit('api', 'compose');
  assert.deepEqual(unreadable('clean', await inkProbe()).bad, []);
  await page.evaluate(() => {
    const main = document.querySelector('.main')!;
    // 1. Unreadable at any size: a grey a hair off the ground it sits on.
    const dim = document.createElement('p');
    dim.setAttribute('style', 'color: #23262b; background: #1b1f24; font-size: 13px');
    dim.textContent = 'nobody can read this';
    main.appendChild(dim);
    // 2. The same ratio at 30px, which the 3:1 bar admits — so a gate applying 4.5 to everything
    //    would convict this one too, and a gate applying 3 to everything would acquit the first.
    const big = document.createElement('p');
    big.setAttribute('style', 'color: #6f7782; background: #1b1f24; font-size: 30px; opacity: 1');
    big.textContent = 'large and legal';
    main.appendChild(big);
  });
  const v = unreadable('injected', await inkProbe());
  assert.equal(v.bad.length, 1, `the instrument convicted ${v.bad.length} readings — it should see exactly the small one`);
  assert.equal(v.bad[0]!.sample, 'nobody can read this');
  assert.equal(v.bad[0]!.bar, 4.5);
  // …and the large one was judged rather than skipped, which is the half a count cannot show.
  assert.ok(v.judged >= 2, 'the large-text injection was never judged at all');
});

test('control: an `opacity` dim is a reading, and a disabled control is exempt', async () => {
  // The two halves of the exemption rule, each injected so neither can drift into the other. The
  // first is the one that matters: `styles.css` dims a locked step, an unmatched file row and a
  // withheld finding with `opacity` rather than with a quieter token, and a gate blind to that
  // would grade all three at full strength.
  await visit('api', 'compose');
  await page.evaluate(() => {
    const main = document.querySelector('.main')!;
    const faded = document.createElement('p');
    // Legible at full strength on this ground; not at a fifth of it.
    faded.setAttribute('style', 'color: #c9d1d9; background: #08090b; opacity: 0.2; font-size: 13px');
    faded.textContent = 'dimmed by opacity';
    main.appendChild(faded);
    const off = document.createElement('button');
    off.setAttribute('style', 'color: #23262b; background: #1b1f24; font-size: 13px');
    off.setAttribute('disabled', '');
    off.textContent = 'inactive and exempt';
    main.appendChild(off);
  });
  const r = await inkProbe();
  const v = unreadable('injected', r);
  assert.deepEqual(v.bad.map((u) => u.sample), ['dimmed by opacity'], 'the opacity dim and the disabled control were not told apart');
  assert.equal(r.inactive, 1, 'the disabled control was not counted as exempted — it was never seen');
});

// ── 5. Layout that survives scale — `M229` `G` ────────────────────────────────────────────────
//
// **BOTH DEFECTS HERE ARE INVISIBLE ON EVERY FIXTURE IN THIS REPOSITORY, AND THAT IS THE POINT.**
// The landing drew its four doors as 3 + 1 at every width a laptop has, and the explorer's `+ new
// file` sat 1504 px below the fold — on `testFlow-tests`, and nowhere else, because every project
// here has five files. A gate that measures the default fixture would be green on both. So the
// first claim is taken at three widths and the second on a project this test builds to have a real
// file count, which is the only part of the finding that can be reproduced without a sibling
// checkout.
//
// `M229` `G` departs from `PLAN_M229_UI_REVIEW.md` on exactly that point. The plan says *"the
// second gate must run against `testFlow-tests`, not a fixture"*; a suite that reads a sibling
// working copy cannot run on CI, on the box, or on a fresh clone, and the property under test is
// **file count**, not that repository. A hundred generated files reproduce it and couple the suite
// to nothing.

test('the landing holds every door in one row, at every width a reader has', async () => {
  // `D1258`. Three widths and not one: `auto-fit` collapses tracks by available space, so a single
  // measurement says nothing about whether the measure or the viewport decided the answer. The
  // mutation is `max-width: 880px` back on `.landing`, which reddens all three.
  const wide = await openPage();
  try {
    for (const width of [1280, 1440, 1680]) {
      await wide.setViewportSize({ width, height: 900 });
      await wide.goto(`${pageUrl}#/`);
      await wide.reload();
      await wide.locator('[data-doors]').waitFor();
      const seen = await wide.evaluate(() => {
        const cards = [...document.querySelectorAll('[data-doors] .door')];
        return {
          doors: cards.length,
          rows: [...new Set(cards.map((c) => Math.round(c.getBoundingClientRect().y)))].length,
          heights: [...new Set(cards.map((c) => Math.round(c.getBoundingClientRect().height)))],
        };
      });
      // The denominator, and it is a live one: `DOORS` is four today and this line is what makes a
      // fifth reopen `D1258` rather than wrap in silence.
      assert.equal(seen.doors, DOORS.length, `${width}: the landing drew ${seen.doors} doors`);
      assert.equal(seen.rows, 1, `${width}: the four doors occupy ${seen.rows} rows`);
      // The tell the review actually saw first — a wrapped card is a different height from its
      // peers, because it is alone on its own track.
      assert.equal(seen.heights.length, 1, `${width}: the door cards are ${seen.heights.join('/')}px — they are not peers`);
    }
  } finally {
    await wide.close();
  }
});

test('the explorer’s create keeps its place on a project with a real file count', async () => {
  // `D1259`. The files are written and removed here rather than shipped as a fixture, because a
  // hundred committed `.tflw` files would be read by `verify:corpora`, the printer's own corpus
  // gate and the checker's coverage census — three instruments this claim has nothing to do with.
  const dir = join(projectRoot, 'bulk');
  await mkdir(dir, { recursive: true });
  const body = (n: number): string => `@api\ntest "generated ${n}"\n  api GET /thing/${n}\n  expect status equals 200\n`;
  await Promise.all(Array.from({ length: 100 }, (_, i) => writeFile(join(dir, `bulk-${String(i).padStart(3, '0')}.tflw`), body(i))));
  try {
    await at('api', 'compose');
    await page.locator('[data-explorer-new]').waitFor();
    const read = await page.evaluate(() => {
      const el = document.querySelector('[data-explorer-new]')!;
      const list = document.querySelector('[data-files]')!;
      const side = el.parentElement!;
      const r = el.getBoundingClientRect();
      return {
        files: Number(list.getAttribute('data-files')),
        bottom: Math.round(r.bottom),
        top: Math.round(r.y),
        viewport: window.innerHeight,
        scrolls: side.scrollHeight > side.clientHeight,
      };
    });
    // **The denominators first, and there are two.** A project that is not big enough to scroll
    // satisfies the claim below for the wrong reason — which is exactly how this defect survived
    // every fixture in the repository.
    assert.ok(read.files >= 100, `the explorer listed ${read.files} files — the project is not big enough to state anything`);
    assert.ok(read.scrolls, 'the sidebar is not scrolling, so nothing here is about reachability');
    assert.ok(read.top >= 0 && read.bottom <= read.viewport, `\`+ new file\` sits at ${read.top}–${read.bottom} in a ${read.viewport}px viewport`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── 6. The census: every control says what it does — `M229` `F` (`D1256`) ─────────────────────
//
// `M225` closed this for one block by hand — the workload editor, 25 controls, 0 `data-tip` and 16
// native `title`s — and `M228` `F2` found the same shape again in the region-2 nav. Two independent
// sightings of one defect is what makes a census worth running instead of a third fix.
//
// **THE RESOLUTION RULE IS THE PRODUCT'S OWN, AND GETTING IT WRONG IS THIS ROUND'S OWN MISTAKE,
// TWICE.** The review first reported the run strip's `env`/`workers`/`headed` as untipped, and then
// the theme select — and all four are tipped, by a wrapping `<label>` and by `div.theme-pick`.
// `Tooltip.tsx` resolves a tip with `el.closest('[data-tip], [data-tip-derived]')`, so that is the
// question asked here, spelled the same way. A census with its own idea of what counts as tipped
// would be a second implementation of one picture (`D1094`) and would have produced exactly the two
// false findings that cost the review an hour.

test('no control on any door or tab lacks a tip', async () => {
  const bare: string[] = [];
  let controls = 0;
  let derived = 0;
  let selfSaid = 0;
  let band = 0;
  /**
   * **The census has to reach the forms, and `states` alone does not.** A door's Compose opens with
   * no declaration selected, so the test band — which holds two of the review's findings — is not
   * drawn at all; and the Config tab renders `data-api-config="loading"` for a beat, which is a
   * panel with no editor in it. `M228` `F`'s carry is exactly this: *a gate can be vacuous because
   * the page has nothing to read*, and its own `no untipped tabs` returned `[]` from a pane that
   * drew no nav. So each state waits for the thing it is about, and every door gets a second visit
   * at a declaration address.
   */
  const READY: Readonly<Record<string, string>> = {
    landing: '[data-doors]',
    compose: '[data-seq-col]',
    run: '[data-runs]',
    auth: '[data-api-auth]',
    config: '[data-api-config="saved"], [data-api-config="unsaved"]',
  };
  const walk: Array<[string, string, string | null]> = [
    ...states.map(([d, t]): [string, string, string | null] => [d, t, null]),
    ...DOORS.map((d): [string, string, string | null] => [d, 'compose', 'tests/catalog.tflw/L2']),
  ];
  for (const [door, tab, at] of walk) {
    if (at === null) await visit(door, tab);
    else {
      await page.goto(`${pageUrl}#/${door}/compose/${at}`);
      await page.reload();
    }
    await page.locator(READY[tab]!).first().waitFor();
    const r = await page.evaluate(() => {
      // `Tooltip.tsx`'s own selector, copied as a string on purpose: if it changes there, this
      // reads the old one and the mismatch is the thing worth finding.
      const ASKS = '[data-tip], [data-tip-derived]';
      // **The one exemption, and it is a whole class rather than a list of names.** A landing door
      // is a card: its label, blurb and count are printed on it as text a reader is already looking
      // at, so a tooltip there would be the control's own words said back to it — which is the
      // fifteen echoes `M216` `B1` measured and `D1127` removed. Counted rather than skipped, so
      // the carve-out cannot quietly become the page. (It named a fourth line, `like`, until
      // `M233` §7 removed that copy; the exemption is the card, not the line count.)
      const SELF_SAID = '.door';
      const out: string[] = [];
      let n = 0;
      let d = 0;
      let said = 0;
      for (const el of document.body.querySelectorAll('button, select, input, textarea')) {
        if (!el.checkVisibility()) continue;
        n++;
        if (el.closest(SELF_SAID) !== null) {
          said++;
          continue;
        }
        const asks = el.closest(ASKS);
        if (asks === null) {
          const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
          const data = [...el.attributes].find((a) => a.name.startsWith('data-'));
          const label = el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 24);
          out.push(`${el.tagName.toLowerCase()}${cls}${data ? `[${data.name}]` : ''} — \u201c${label}\u201d`);
        } else if (asks.getAttribute('data-tip') === null) d++;
      }
      // The two controls `R1` found, named so the walk can prove it reached them: they are drawn
      // only when a declaration is selected, and `states` never selects one.
      const band = document.body.querySelectorAll('[data-band-name], [data-band-tags-edit]').length;
      return { out, n, d, said, band };
    });
    controls += r.n;
    derived += r.d;
    selfSaid += r.said;
    band += r.band;
    for (const b of r.out) bare.push(`${door || 'landing'}/${tab}: ${b}`);
  }
  // **Three denominators, and each one closes a way this claim could be green on nothing.** *No
  // untipped control* is satisfied perfectly by a page that drew none; a page where every tip
  // resolved through `data-tip-derived` would carry truncation tooltips and no sentences; and an
  // exemption that grew would empty the census without anyone noticing.
  assert.ok(controls > 300, `the census saw ${controls} controls across ${walk.length} page states — it is not reaching the forms`);
  assert.ok(derived > 0, 'no tip on the whole page is derived, so `D1127`\u2019s mechanism is not being exercised');
  assert.equal(selfSaid, DOORS.length, `${selfSaid} controls were exempted as self-describing — that is meant to be the four landing doors and nothing else`);
  assert.ok(band >= DOORS.length, `the census never reached the test band (${band} sightings) — the two fields \`R1\` found are drawn only at a declaration address`);
  assert.deepEqual([...new Set(bare)].slice(0, 30), [], `${new Set(bare).size} distinct controls carry no tip`);
});

test('control: the census names the control a mutation strips', async () => {
  // **A 200-row failure teaches nothing**, so the claim above is only useful if the message points
  // at the thing. The mutation is the one the plan specified — a wrapping `<label>`'s tip removed —
  // and it is made on the live page rather than in the source, because what is being checked is the
  // *resolution rule*: `env` is tipped by its label and not by itself, which is the reading the
  // review got wrong twice.
  await visit('api', 'compose');
  const untipped = async (): Promise<string[]> =>
    page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.body.querySelectorAll('button, select, input, textarea')) {
        if (!el.checkVisibility() || el.closest('.door') !== null) continue;
        if (el.closest('[data-tip], [data-tip-derived]') === null) {
          const data = [...el.attributes].find((a) => a.name.startsWith('data-'));
          out.push(`${el.tagName.toLowerCase()}${data ? `[${data.name}]` : ''}`);
        }
      }
      return out;
    });
  assert.deepEqual(await untipped(), []);
  await page.evaluate(() => {
    document.querySelector('[data-env-select]')!.closest('[data-tip]')!.setAttribute('data-tip', '');
  });
  // `setAttribute` to the empty string, not `removeAttribute`: an empty `data-tip` still MATCHES
  // `[data-tip]`, so this is the harder mutation — it proves the census resolves a tip rather than
  // merely finding the attribute.
  assert.deepEqual(await untipped(), [], 'an empty `data-tip` is still an attribute, and the census is about the attribute');
  await page.evaluate(() => {
    document.querySelector('[data-env-select]')!.closest('[data-tip]')!.removeAttribute('data-tip');
  });
  assert.deepEqual(await untipped(), ['select[data-env-select]'], 'the census did not name the control whose label lost its tip');
});
