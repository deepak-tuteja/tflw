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
import { mkdtemp, cp, readFile, mkdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { DOCS_PAGE_DIR, DOOR_FILES, MANIFEST, REPO, SHOTS, THEMES, UI_ROOT, screenshotInputs, screenshotInputsHash } from './screenshot-inputs.mjs';

// 1440x900 is the width every appearance gate measures at, so a picture and a gate describe the
// same layout. `deviceScaleFactor: 2` because this page is dense text: at 1x the docs site scales
// a 1440px shot into a ~700px column and the type stops being readable, which makes the picture
// decorative. The cost is measured and printed at the end rather than assumed.
const VIEWPORT = { width: 1440, height: 900 };
const SCALE = 2;

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

  const root = join(scratch, 'project');
  await cp(join(UI_ROOT, 'fixtures', 'project'), root, { recursive: true });
  await symlink(join(REPO, 'node_modules'), join(root, 'node_modules'), 'dir');
  for (const env of ['full', 'headers']) {
    await mkdir(join(root, 'report', 'runs'), { recursive: true });
    await cp(join(UI_ROOT, 'fixtures', 'reports', env), join(root, 'report', 'runs', env), { recursive: true });
  }

  // The server is the CLI's own, from source under tsx — the same one `tflw ui` runs.
  const { UiServer } = await import(join(REPO, 'packages', 'cli', 'src', 'ui-server.ts'));
  server = new UiServer({
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
  const PREFERRED = ['tests/orders.tflw', 'tests/catalog.tflw', 'tests/shop.tflw'];

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
    // **Take the pointer out of the picture first.** Every shot here is reached by clicking
    // something, and a click leaves the pointer hovering whatever it hit — so the first `spine`
    // cut carried a tooltip standing open over the file list, covering two of the five filenames
    // the picture exists to show. Nothing in the run reports that; it is only visible by looking.
    //
    // The corner, and then a beat for the tooltip's own exit. A screenshot is of a page at rest,
    // and a page with a pointer parked on it is not at rest.
    await page.mouse.move(VIEWPORT.width - 2, VIEWPORT.height - 2);
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
      width: Math.min(box.width, VIEWPORT.width - Math.max(0, box.x)),
      height: Math.min(box.height, VIEWPORT.height - Math.max(0, box.y)),
    };
    await page.screenshot({ path: join(DOCS_PAGE_DIR, name), clip });
    return name;
  };

  for (const [theme] of THEMES) {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
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
      await page.goto(`${base}#/${door}`);
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
    await page.goto(`${base}#/`);
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
    for (const [door, candidates] of DOOR_FILES) {
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
    }

    await page.close();
    console.log(`  ${theme}: 8 views, spine on ${shown}, compose on ${opened.join(' ')}`);
  }

  await writeFile(
    MANIFEST,
    JSON.stringify(
      {
        inputs: screenshotInputsHash(),
        inputCount: screenshotInputs().length,
        shots: SHOTS,
        viewport: VIEWPORT,
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
