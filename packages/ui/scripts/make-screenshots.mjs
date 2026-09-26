// The docs site's pictures of the page (`M233` `A`, `D1281`/`D1282`).
//
// Cut from the **fixture corpus the page gate already grades** and never from a hand-run project,
// so every number in a picture is one the checked-in `results.json` holds, and a reader can re-cut
// the whole set from the checkout. `D1281` refuses the dogfood for a reason worth restating here:
// the dogfood's pictures would show real scale (84 files, 326 tests) and also the sibling's test
// names and this box's hostnames, and **nobody could reproduce them** — which is exactly the
// artefact the staleness gate exists to refuse.
//
// Writes `packages/docs-site/public/page/<view>-<theme>.png` and a `manifest.json` naming the input
// hash the shots were cut from. `docs-site/scripts/verify-page-screenshots.test.mjs` refuses a
// manifest whose hash has moved.
//
//   node --import tsx packages/ui/scripts/make-screenshots.mjs
//
// TWO THEMES, NOT ONE (`D1282`). `M192` U8 framed this as *the page is dark-only*; `M229` `A`
// re-solved four themes and one of them is light. The site follows the reader's appearance, so a
// single dark set would be wrong for half the readers — and shooting both documents the theme
// switcher by showing it, which no sentence does as well.
//
// THE THEME IS SET BEFORE THE FIRST PAINT, not after mount. `index.html` carries four lines of
// inline script that read `localStorage` before the body exists (`ThemePick.tsx`'s docblock says
// why), so this seeds storage in an init script rather than setting the attribute afterwards. The
// difference is visible in a picture: setting it after mount catches the default for one frame.
//
// `__name` IS NOT A SUPERSTITION. tsx's name-preservation transform rewrites nested function
// declarations into references to a `__name` helper that does not exist inside an evaluated page
// context. Every probe in this repository that forgot it died on `__name is not defined`, and
// `ui-appearance.test.ts`'s own `openPage` carries the same line.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, cp, open, readFile, mkdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { DEFAULT_VIEWPORT, VIEWS, DOCS_PAGE_DIR, DOOR_FILES, MANIFEST, REPO, SHOTS, THEMES, UI_ROOT, screenshotInputs, screenshotInputsHash, viewOf, viewportFor } from './screenshot-inputs.mjs';

// 1440x900 is the width every appearance gate measures at, so a picture and a gate describe the
// same layout. `deviceScaleFactor: 2` because this page is dense text: at 1x the docs site scales
// a 1440px shot into a ~700px column and the type stops being readable, which makes the picture
// decorative. The cost is measured and printed at the end rather than assumed.
// `M234` `E` — the window is per view now (`D1304`, `viewportFor`), and this is the one every view
// is shot in unless it names its own. It stays 1440 wide for the reason above: that is the width
// every appearance gate measures at.
// `M239` `A` (`D1316`) — the server takes a known token; the page URL carries it, the cookie covers the trace viewer.
const TOKEN = 'm239-test-token-0123456789abcdef';
const VIEWPORT = DEFAULT_VIEWPORT;
const SCALE = 2;

/**
 * A PNG's real size, read back off the file that was just written — `M234` `E` (`D1306` as amended).
 *
 * **Not `boundingBox()`, and the difference is the whole reason this function exists.** `cut()`
 * trims every shot to its last painting element and clamps it to the window, so the element's box
 * is an upper bound on the picture and frequently not the picture: `compose-load` measured 705 css
 * tall as an element and was written 425 tall as a file. A dimension taken from the page would be
 * wrong for exactly the shots the trim is doing its job on.
 *
 * It is also the **first observed fact in this manifest**. Everything else in it is declared —
 * `shots` is `VIEWS × THEMES`, and the docs gate asserts that array against the same constant it
 * was built from, which compares a declaration with itself. These sixteen numbers come off disk.
 */
const pngSize = async (path) => {
  const head = Buffer.alloc(24);
  const fh = await open(path, 'r');
  try {
    const { bytesRead } = await fh.read(head, 0, 24, 0);
    if (bytesRead < 24) throw new Error(`${path}: ${bytesRead} bytes — not a PNG header`);
  } finally {
    await fh.close();
  }
  if (head.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${path}: no PNG signature — the shot did not write`);
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
};

/** Every shot's observed size, in file order, filled by `cut()`. */
const SIZES = new Map();

const scratch = await mkdtemp(join(tmpdir(), 'tflw-page-shots-'));
let browser;
let server;
try {
  // The bundle, built from the checked-out page with the ui's own vite (the page gate's recipe) —
  // not the root's VitePress-pinned one.
  const viteManifestPath = createRequire(UI_ROOT).resolve('vite/package.json');
  const viteBin = join(dirname(viteManifestPath), JSON.parse(await readFile(viteManifestPath, 'utf8')).bin.vite);
  const staticDir = join(scratch, 'ui');
  execFileSync(process.execPath, [viteBin, 'build', '--outDir', staticDir, '--logLevel', 'warn'], { cwd: UI_ROOT, stdio: 'pipe' });

  /* `M234` `D` — **the pictures are of the runnable example now, not of the page gate's fixture.**
     `D1297`: there is one runnable example and it is the one the docs photograph. `fixtures/project`
     stays exactly where it is as the corpus for `ui-page.test.ts`'s 203 tests; it is simply no
     longer what a reader of the docs is looking at.

     **One env, and that is a decision** (`M234` §3.1 `D-3`). The fixture declares `env full default`
     and `env headers`; the example declares `env local default`, one line. A second env in the
     example would exist only to make the new screenshot resemble the old screenshot — the
     corpus-shaped-by-the-picture mistake `D1303` already refused once, arriving from the other
     direction. `D1299` makes this example's job *printable coverage*, and an env is not a printable
     construct.

     `report/runs/<name>` rather than a flat `report/`: `tflw run` writes the report flat and has no
     `runs/` in its output at all — `runs/` is the page's own run history, which is what the `run`
     view is a picture of. `make-example-report.mjs` produces the committed copy (`D1302`). */
  const root = join(scratch, 'project');
  await cp(join(REPO, 'examples', 'storefront'), root, { recursive: true });
  await rm(join(root, 'report'), { recursive: true, force: true });
  await symlink(join(REPO, 'node_modules'), join(root, 'node_modules'), 'dir');
  for (const env of ['local']) {
    await mkdir(join(root, 'report', 'runs'), { recursive: true });
    await cp(join(UI_ROOT, 'fixtures', 'example-reports', env), join(root, 'report', 'runs', env), { recursive: true });
  }

  // The server is the CLI's own, from source under tsx — the same one `tflw ui` runs.
  const { UiServer } = await import(join(REPO, 'packages', 'cli', 'src', 'ui-server.ts'));
  server = new UiServer({
    token: TOKEN,
    root,
    cliEntry: join(REPO, 'packages', 'cli', 'src', 'cli.ts'),
    execArgv: ['--import', fileURLToPath(import.meta.resolve('tsx'))],
    staticDir,
  });
  const port = await server.listen(0);
  const base = `http://127.0.0.1:${port}`;
  await mkdir(DOCS_PAGE_DIR, { recursive: true });
  browser = await chromium.launch();

  /** The file the shell shots open. Preference order, so a fixture rename degrades to a neighbour
   *  rather than to a crash — and the chosen one is printed, because a picture of a different file
   *  is a picture of a different thing. */
  /* `M234` `D-1`. `catalogue.tflw` leads because the spine shot is of the shell — explorer,
     doorbar and tab strip at once — and a file carrying **two** lenses (`api,browser`) is the one
     that makes the doorbar's per-door counts mean something in the same picture. */
  const PREFERRED = ['tests/catalogue.tflw', 'tests/receipt.tflw', 'tests/shelf.tflw'];

  /**
   * One shot, cropped to the thing its caption names (`M233` `I`, `D1292`).
   *
   * **There is no whole-window option any more, and that is the decision.** VitePress's content
   * column is 688px at a 1440px window and 624px at 1280; a 1440px shot therefore lands at 43-48%,
   * so the UI's 13px body text arrives at 5.6-6.2px and the picture becomes decoration with a file
   * size. Cropping is what buys the scale back, and every view names a selector so that the crop
   * is a stated claim about what the picture is of rather than a framing accident.
   *
   * The generator already knew this: the landing was cropped on its first cut because a
   * full-viewport shot of it was "two thirds empty black … worse on a docs page that scales it
   * into a narrow column". That reasoning was written once and applied to one of five views. This
   * finishes applying it.
   */
  const cut = async (page, name, target) => {
    if (typeof target !== 'string' || target.length === 0) throw new Error(`${name}: every view names a selector (D1292) — got ${JSON.stringify(target)}`);
    /* **The window is asserted here and set by the caller, and that order is deliberate** —
       `M234` `E`. Setting it inside `cut` would be tidier and would break `browser-menu`:
       `ContextMenu.tsx:199` closes on `resize` and the add-step dialog is opened by a gesture, so
       a resize taken *after* the gesture can dismiss the very thing being photographed. That is
       `M234` `A4`'s finding, which cost this repository three guesses, arriving one layer up. So
       the caller sizes the window before it gestures, and this refuses a shot taken at the wrong
       one — which is the half a comment cannot enforce. */
    const want = viewportFor(viewOf(name));
    const have = page.viewportSize();
    if (have === null || have.width !== want.width || have.height !== want.height) {
      throw new Error(`${name}: shot at ${have?.width}x${have?.height}, but this view is ${want.width}x${want.height} (D1304)`);
    }
    // **Take the pointer out of the picture first.** Every shot here is reached by clicking
    // something, and a click leaves the pointer hovering whatever it hit — so the first `spine`
    // cut carried a tooltip standing open over the file list, covering two of the five filenames
    // the picture exists to show. Nothing in the run reports that; it is only visible by looking.
    //
    // The corner, and then a beat for the tooltip's own exit. A screenshot is of a page at rest,
    // and a page with a pointer parked on it is not at rest.
    await page.mouse.move(want.width - 2, want.height - 2);
    await page.waitForTimeout(250);
    const openTips = await page.locator('.tooltip, [role="tooltip"], [data-tooltip-open]').count();
    if (openTips > 0) throw new Error(`${name}: ${openTips} tooltip(s) still open with the pointer in the corner — the shot would carry one`);
    const box = await page.locator(target).boundingBox();
    if (box === null) throw new Error(`${name}: ${target} matched nothing with a box`);
    // **And trimmed to the last thing that paints.** Cropping to the named element is not enough:
    // `[data-compose-pane]` is 705 css tall because the window is 900, and on a short test its
    // content stops less than halfway down — the first cut of `compose-load` was 45% empty black
    // below the plan panel. That is the landing shot's own finding ("two thirds empty black")
    // recurring one layer in, and the repair has to be the same one: the picture ends where the
    // drawing ends.
    //
    // *What paints* is read the way `ui-appearance.test.ts` reads ink — an element carrying a
    // direct text node, or a replaced element that draws by being there. A spacer with a height
    // and nothing in it is not a thing a caption can be about, and it is exactly what a naive
    // `scrollHeight` would keep.
    const ink = await page.evaluate(([sel, top]) => {
      const root = document.querySelector(sel);
      if (root === null) return null;
      const DRAWS = new Set(['SVG', 'IMG', 'CANVAS', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'HR']);
      let bottom = top;
      for (const el of root.querySelectorAll('*')) {
        const paints = DRAWS.has(el.tagName.toUpperCase()) || [...el.childNodes].some((n) => n.nodeType === 3 && (n.nodeValue ?? '').trim() !== '');
        if (!paints || !el.checkVisibility()) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) bottom = Math.max(bottom, r.bottom);
      }
      return bottom;
    }, [target, box.y]);
    // 16px of air under the last glyph, so the crop reads as a framed picture rather than as a
    // cut. Never taller than the element itself, and never shorter than the doorbar's own 35px.
    if (ink !== null && ink > box.y) box.height = Math.min(box.height, Math.max(ink - box.y + 16, 35));
    // **Bounded by the window, and that is the second half of the rule.** A locator screenshot
    // captures the element's FULL height including whatever it scrolls, and the run pane scrolls:
    // the first cut of `run` came out 1060 x 6002 css — a picture six windows tall, of a surface
    // no reader has ever seen all of at once. So the crop is the named region *as far as the
    // window shows it*, which is also the only framing a caption about a screen can honestly make.
    const clip = {
      x: Math.max(0, box.x),
      y: Math.max(0, box.y),
      width: Math.min(box.width, want.width - Math.max(0, box.x)),
      height: Math.min(box.height, want.height - Math.max(0, box.y)),
    };
    const file = join(DOCS_PAGE_DIR, name);
    await page.screenshot({ path: file, clip });
    SIZES.set(name, await pngSize(file));
    return name;
  };

  for (const [theme] of THEMES) {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
    await page.context().addCookies([{ name: 'tflw-ui-token', value: TOKEN, domain: '127.0.0.1', path: '/' }]);
    // Both init scripts run before any document script: the `__name` guard for tsx's transform,
    // and the theme, which `index.html` reads pre-paint.
    await page.addInitScript({ content: 'globalThis.__name = globalThis.__name || ((fn) => fn);' });
    await page.addInitScript(([key, value]) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // a page that cannot remember still renders; the attribute below is what paints
      }
      document.documentElement.setAttribute('data-tflw-theme', value);
    }, ['tflw.theme', theme]);

    // `reload()` after a hash-only change, and `M213-12` is why: these URLs differ only in the
    // fragment, so the browser fires `hashchange` rather than navigating and the *previous*
    // state's DOM is still in the document until React commits. A shot taken then is a shot of
    // the page before.
    const at = async (door, tab) => {
      await page.goto(`${base}/?token=${TOKEN}#/${door}`);
      await page.reload();
      await page.locator(`[data-doorbar="${door}"]`).waitFor();
      await page.locator(`[data-tab="${tab}"]`).click();
      await page.locator(`[data-tabstrip="${tab}"]`).waitFor();
    };
    const openFile = async () => {
      for (const path of PREFERRED) {
        const row = page.locator(`[data-file="${path}"]`);
        if ((await row.count()) > 0) {
          await row.click();
          return path;
        }
      }
      throw new Error(`none of ${PREFERRED.join(', ')} is in the fixture project — the shell shots have no file to open`);
    };

    // 1. The landing: four doors, each counted against a real project.
    //
    // Cropped to `[data-landing]` rather than shot whole, and the first cut is why: the landing's
    // content ends 430px down a 900px viewport, so the full-viewport shot was **two thirds empty
    // black** — a picture that spends most of its area saying nothing, and worse on a docs page
    // that scales it into a narrow column. The other four views fill their frame and are shot
    // whole. This was found by looking at the output, which no assertion in the gate could have
    // told us: a mostly-empty PNG is a valid PNG of the right size with the right hash.
    await page.goto(`${base}/?token=${TOKEN}#/`);
    await page.reload();
    await page.locator('[data-doors]').waitFor();
    await cut(page, `landing-${theme}.png`, '[data-landing]');

    // 2. The spine: explorer, doorbar and tab strip at once, with a file open on Source — the
    //    file itself, which is what makes the other four tabs legible as stages of one thing.
    //
    // `.app` and not the viewport, and the difference is not cosmetic: the shell IS what this
    // caption names, so the crop is the claim. A viewport shot would additionally carry whatever
    // the window happened to be, which is the framing accident `D1292` refuses.
    await at('api', 'source');
    const shown = await openFile();
    await page.locator('[data-tabstrip="source"]').waitFor();
    await cut(page, `spine-${theme}.png`, '.app');

    // 3. The doorbar alone: the four doors and what each counts in this project.
    await cut(page, `doors-${theme}.png`, '[data-doorbar]');

    // 4. A run, read in place — still with the API door's file open, because a run is read beside
    //    the source that produced it and that is the whole of the claim.
    await page.locator('[data-tab="run"]').click();
    await page.locator('[data-tabstrip="run"]').waitFor();
    await cut(page, `run-${theme}.png`, '[data-door-run-tab]');

    // 5-8. Compose, once per door, each on a file that belongs behind it (`D1294` as amended).
    //
    // NOT four pictures of the same surface. `D1044` grants a door no panels, so all four of these
    // open on an identical 1072 x 705 pane — what differs is the file, and the panels its
    // constructs earned. Measured on this fixture: `load.tflw` brings the plan panel,
    // `security.tflw` brings the targets block, and `orders.tflw`/`shop.tflw` bring neither. Two
    // of the four therefore look alike on purpose, and the section says so rather than cropping
    // until they look different.
    const opened = [];
    let menu = '?';
    let kinds = [];
    for (const [door, candidates] of DOOR_FILES) {
      // `M234` `E` — the window first, then the navigation. Every Compose view is 1440x560
      // (`D1304`): the pane's `+` gestures are pinned to its bottom edge, so the ink-trim cannot
      // close the ~300px of empty pane a 900px window leaves under a short test.
      await page.setViewportSize(viewportFor(`compose-${door}`));
      await at(door, 'compose');
      let chose = null;
      for (const path of candidates) {
        const row = page.locator(`[data-file="${path}"]`);
        if ((await row.count()) > 0) {
          await row.click();
          chose = path;
          break;
        }
      }
      if (chose === null) throw new Error(`the ${door} door lists none of ${candidates.join(', ')} — its Compose shot has no file to open`);
      await page.locator('[data-tabstrip="compose"]').waitFor();
      await page.locator('[data-compose-pane]').waitFor();
      await cut(page, `compose-${door}-${theme}.png`, '[data-compose-pane]');
      opened.push(`${door}:${chose.replace(/^tests\//, '')}`);

      /* **9. `+ step…`, and it is shot HERE because this is the only door that has it** —
         `M234` `E`, `D1303`/`D1164`.

         `ui/browser.md` says "all twenty-two kinds the language has" are editable, and the picture
         under that sentence has been of a test using three. `D1303` settled where the missing
         evidence lives: not in a taller file, because a file covering all 22 is ~23 rows and
         `ui-appearance.test.ts:732` needs a thirteen-request file to already overflow the sequence
         column — so the corpus cannot carry the claim and this dialog can. It enumerates the
         vocabulary as a list, which is the shape a claim about a vocabulary wants.

         The window is sized BEFORE the gesture that opens it, never after — see `cut`'s own note. */
      if (door === 'browser') {
        await page.setViewportSize(viewportFor('browser-menu'));
        await page.locator('[data-seq-add="step"]').first().click();
        await page.locator('[data-add-step]').waitFor();
        // The count is the claim, so it is read rather than assumed: a dialog that silently offered
        // fewer would still photograph as a full-looking list.
        const offered = await page.locator('[data-add-step-count]').getAttribute('data-add-step-count');
        if (offered === null || Number(offered) < 20) {
          throw new Error(`browser-menu: \`+ step…\` offers ${offered} kinds — the picture is the completeness claim (D1303)`);
        }
        // The kinds themselves, printed once. `F` has to write a sentence about this list and the
        // page's current one says "twenty-two" beside a dialog that offers 23 — so the list is
        // reported rather than counted from memory.
        kinds = await page.locator('[data-add-step-kind]').evaluateAll((els) => els.map((e) => e.getAttribute('data-add-step-kind')).sort());
        await cut(page, `browser-menu-${theme}.png`, '[data-add-step]');
        await page.locator('[data-add-step-cancel]').click();
        await page.locator('[data-add-step]').waitFor({ state: 'detached' });
        menu = offered;
      }
    }

    await page.close();
    console.log(`  ${theme}: ${VIEWS.length} views, spine on ${shown}, compose on ${opened.join(' ')}, + step… offered ${menu}`);
    if (theme === THEMES[0][0]) console.log(`  + step… kinds (${kinds.length}): ${kinds.join(' ')}`);
  }

  await writeFile(
    MANIFEST,
    JSON.stringify(
      {
        inputs: screenshotInputsHash(),
        inputCount: screenshotInputs().length,
        /* `M234` `E` (`D1306` as amended) — **each shot now carries the size it was written at**,
           read back off the file rather than taken from the page. `G`'s markdown-it rule stamps
           `width`/`height` from these so the `/ui/` section stops reflowing as it loads; divide by
           `deviceScaleFactor` for css pixels. A shot the manifest does not name must fail the build
           loudly, which is only possible because this list is now the one place both halves meet. */
        shots: SHOTS.map((name) => {
          const size = SIZES.get(name);
          if (size === undefined) throw new Error(`${name} is declared in SHOTS and was never cut — the manifest would name a picture nobody took`);
          return { name, ...size };
        }),
        viewport: VIEWPORT,
        viewports: Object.fromEntries(VIEWS.map((v) => [v, viewportFor(v)])),
        deviceScaleFactor: SCALE,
        cutAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );

  let bytes = 0;
  for (const name of SHOTS) bytes += (await stat(join(DOCS_PAGE_DIR, name))).size;
  console.log(`${SHOTS.length} shots → ${DOCS_PAGE_DIR}`);
  console.log(`${(bytes / 1024).toFixed(0)} KiB total, ${(bytes / SHOTS.length / 1024).toFixed(0)} KiB a shot at ${SCALE}x`);
} finally {
  if (browser !== undefined) await browser.close();
  if (server !== undefined) await server.close();
  await rm(scratch, { recursive: true, force: true });
}
