// The appearance gate (`M213` `S1`, `D1104`).
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
// `D1105` reserves them there deliberately. It asserts three things a machine can hold: nothing
// renders in the user agent's own chrome, no control is wildly out of scale with the controls
// beside it, and **every colour on the page comes from the theme**.
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

const here = dirname(fileURLToPath(import.meta.url));
const uiRoot = join(here, '..', '..', 'ui');
const fixtures = join(uiRoot, 'fixtures');
const cliEntry = join(here, '..', 'src', 'cli.ts');
const tsxLoader = fileURLToPath(import.meta.resolve('tsx'));

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
  querySelectorAll(selector: string): ArrayLike<ElLike> & Iterable<ElLike>;
  querySelector(selector: string): ElLike | null;
  appendChild(child: ElLike): void;
  remove(): void;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
}
declare const document: ElLike & { readonly body: ElLike; readonly documentElement: ElLike; readonly head: ElLike; createElement(tag: string): ElLike };
declare const getComputedStyle: (el: ElLike) => CssLike;
declare const window: { readonly localStorage: { getItem(key: string): string | null }; readonly innerHeight: number };
declare const requestAnimationFrame: (cb: () => void) => void;

let scratch: string;
let baseUrl: string;
/** The scratch copy of the fixture project — `M214`'s overflow gate writes a file into it. */
let projectRoot: string;
let server: UiServer;
let browser: Browser;
let page: Page;

/** `Terminal` first because it is the default (`D1107`) — the geometry pass runs on whatever is
 *  first here, and it should be the thing a reader actually gets. */
const THEMES = ['terminal', 'instrument', 'ribbon', 'paper'] as const;
type Theme = (typeof THEMES)[number];

const DOORS = ['api', 'browser', 'load', 'scan'] as const;
/** The tabs that hold controls or state colour. `source` is excluded on purpose: it is one `<pre>`
 *  of the user's own bytes, its colours are the seven syntax tokens, and it carries no control. */
const TABS = ['compose', 'run', 'auth', 'config'] as const;

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'tflw-ui-appearance-'));
  const viteManifestPath = createRequire(uiRoot).resolve('vite/package.json');
  const viteBin = join(dirname(viteManifestPath), (JSON.parse(await readFile(viteManifestPath, 'utf8')) as { bin: { vite: string } }).bin.vite);
  const staticDir = join(scratch, 'ui');
  execFileSync(process.execPath, [viteBin, 'build', '--outDir', staticDir, '--logLevel', 'warn'], { cwd: uiRoot, stdio: 'pipe' });

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

  server = new UiServer({ root, cliEntry, execArgv: ['--import', tsxLoader], staticDir });
  const port = await server.listen(0);
  baseUrl = `http://127.0.0.1:${port}`;
  browser = await chromium.launch();
  page = await openPage();
});

after(async () => {
  await page?.close();
  await browser?.close();
  await server?.close();
  await rm(scratch, { recursive: true, force: true });
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
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
  await page.goto(`${baseUrl}#/${door}`);
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
    await page.goto(`${baseUrl}#/`);
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
    await fresh.goto(`${baseUrl}#/`);
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
      await page.goto(`${baseUrl}#/${door}/compose/tests/thirteen.tflw`);
      await page.reload();
      await page.locator('[data-seq-col]').waitFor();
      // A file the parser only RECOVERED draws fewer rows than it has statements, and a height gate
      // reading a salvage is a height gate reading a smaller file. The first draft of this fixture
      // wrote `expect body.name is not empty`, which is not a matcher this language has.
      // **`data-recovered` and not `data-diagnostics`**: the badge carrying the second is also the
      // WARNING badge, so the first draft of this line read a file that parses perfectly and a
      // missing tag as the same failure. A height gate reading a salvage is a height gate reading a
      // smaller file, which is the thing worth catching.
      assert.equal(await page.locator('[data-file-row="tests/thirteen.tflw"] [data-recovered]').count(), 0, 'the file the gate wrote does not parse');
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
      await page.goto(`${baseUrl}#/api/compose/tests/jsonbody.tflw`);
      await page.reload();
      await page.locator('[data-seq-col]').waitFor();
      await wear(theme);
      await page.locator('[data-seq-row="request"] [data-seq-pick]').first().click();
      await page.locator('[data-editor-tab="body"]').click();
      await page.locator('[data-body-ink]').waitFor();
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
