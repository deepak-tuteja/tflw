// The page gate (`M192` U2, `D988`): the built page, served by `UiServer` over the fixture
// project, read by a real browser, and every rendered value asserted against `results.json`
// read from disk — the report directory is the oracle, never a number written in this file.
// The corpus under `packages/ui/fixtures/reports/` is what `tflw run` wrote over
// `packages/ui/fixtures/project/` (`scripts/make-fixtures.mjs`), one directory per evidence
// level. The last test runs the project from the page against the fixture server and grades
// the page against the directory that run wrote.
//
// ## The authoring rule for reads — `M235` `C3`
//
// **This file reads a page that is still moving, and nothing here retries.** It is `node:test` plus
// the `playwright` library, not `@playwright/test`, so there is no auto-retrying assertion: a
// resolved Playwright read answers against one frame and `node:assert` judges that frame. Twelve
// tests have been red in CI for exactly that reason and no other.
//
// **A read is settled when its subject has been waited on since the last action that could change
// it — and a `waitFor` settles *presence*, not *value*.** An `await page.locator(X).waitFor()`
// establishes that `X` is on the page and nothing about what `X` says; the next `click`, `fill`,
// `goto` or `setViewportSize` spends even that. Anything else is a single sample.
//
// Four things make that sharper than it sounds, and all four have cost a run here:
//
//   - **`count()`, `evaluateAll()` and `allTextContents()` wait for nothing at all.** They answer
//     against whatever matches at that instant, so an empty DOM returns `0` or `[]` immediately.
//     Six of the twelve failed in 38-359 ms; nothing was slow.
//   - **`page.url()` is synchronous**, and the router writes the address on a later effect than the
//     gesture that caused it. The worst site in the census, 10 of 56 sweep runs, was this.
//   - **An absence is the dangerous shape.** `count() === 0`, `deepEqual(xs, [])` — a page that has
//     not painted satisfies every one of them. That failure is a silent pass, not a red run, which
//     is why four of `C2`'s repairs were emptiness claims that first establish their population.
//   - **A `waitFor` on the very subject you are about to read is not enough when the element was
//     already there.** `waitFor` waits for a *state* — attached, visible, hidden — so it returns on
//     the first tick against an element that already holds that state, still carrying whatever it
//     held before. `E`'s sweep found this at 3 of 56 on a `textContent()` written directly under a
//     `waitFor()` on its own subject: the pane was on screen the whole time, drawing the file the
//     page had just left. After a `goto` or `reload` the document is new and the wait is sound;
//     after an in-page gesture it is not. The gate calls this class `ATTACH-ONLY`, and it was the
//     one shape the gate itself had been calling clean.
//
// **So: wait for the thing you are about to read, or read it through `settle`.** Reach for
// `untilMeasurable` and keep the wait separate from the claim — wait for *a* verdict, assert
// *two*; wait for *a* query in the address, assert *the* query. A predicate that is the assertion
// is `M141`'s defect and a gate that can no longer fail. `untilEqual` is for a value genuinely
// converging on a total this test already knows, and stays honest only because the budget is
// bounded. See `settle.ts`.
//
// **A read that must stay one-shot says so**, on its own line or in the comment block above it:
//
//     // one-shot: it reports what was on the page when the assertion failed
//
// The reason is required and is read by a person, not a parser. Failure-path diagnostics, a
// baseline captured *before* a gesture, and a claim whose population a helper on the line above has
// already established are the three that have earned it so far.
//
// `npm run verify:settled-reads` is the ratchet: it holds the at-risk set at the number recorded in
// `scripts/settled-reads-baseline.json` and refuses a new one. `npm run report:settled-reads` lists
// them worst-first. Neither is a defect list — most of these reads will never lose the race — but
// the ones that do have never yet been found by reading.

import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, cp, rm, readFile, writeFile, mkdir, symlink, utimes, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright';
import { UiServer, SCRATCH_PATH } from '../src/ui-server.js';
import { coverageBuildArgs, startUiCoverage, stopUiCoverage } from './ui-coverage.js';
import { settle, untilEqual, untilMeasurable } from './settle.js';
import { checkProgram, parseSource, print, STEP_LENS } from '@tflw/lang';
import { roundDurationMs, type LoadMetrics, type RunReport, type StepResult, type TestResult, type WorkloadTestResult } from '@tflw/runtime';
import { describeWorkload, formatThresholdActual, formatThresholdTarget, remediationFor } from '@tflw/reporter';
import { findingsSummaryLine, sortFindings, WITHHELD_LABEL, SCAN_KIND_LABEL } from '@tflw/runtime';
import { stagedSetup } from '../../../scripts/test-staging.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const uiRoot = join(here, '..', '..', 'ui');
const fixtures = join(uiRoot, 'fixtures');
const cliEntry = join(here, '..', 'src', 'cli.ts');
const tsxLoader = fileURLToPath(import.meta.resolve('tsx'));

// `M239` `A` (`D1276`) — every server here takes one known token, so a URL can be built before the
// server is; `api` sends it the way the page does, and `newPage` plants the cookie the browser
// spends on the navigational surfaces (report files, the trace viewer's assets).
const TOKEN = 'm239-test-token-0123456789abcdef';
const api = (url: string, init: RequestInit = {}): Promise<Response> => fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${TOKEN}` } });
const newPage = async (options?: Parameters<Browser['newPage']>[0]): Promise<Page> => {
  const p = await browser.newPage(options);
  await p.context().addCookies([{ name: 'tflw-ui-token', value: TOKEN, domain: '127.0.0.1', path: '/' }]);
  // `M239` `C` (`D1278`) — every frame records what its `Content-Security-Policy` refused, so a
  // policy that broke the page or the trace viewer is a red assertion and not a blank pane.
  // As a string: this file keeps the browser's globals out of its type space on purpose (see the
  // `declare const` note beside `ui-appearance.test.ts`), so the reads below go through an element.
  await p.addInitScript({ content: "window.__cspViolations = []; document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(e.violatedDirective + ' ' + e.blockedURI + ' ' + (e.sourceFile || '') + ':' + (e.lineNumber || 0)));" });
  return p;
};
const cspViolations = (p: Page): Promise<string[]> => p.locator('html').evaluate((el) => (el.ownerDocument.defaultView as unknown as { __cspViolations: string[] }).__cspViolations);

let scratch: string;
let root: string;
/** The fixture server's port for this process — a free one, written into the scratch copy of
 * `tflw.config` in place of the file's 4717. Two page gates on one host (`M194`'s parallel sweep)
 * cannot both hold 4717; the recorded trace in `reports/full` still says 4717 and that is history. */
let fixturePort: number;
let server: UiServer;
let baseUrl: string;
/** `${baseUrl}/?token=…` — what a `goto` opens (`M239` `A`, `D1276`): the page needs the token on
 *  its own URL, and a `goto` differing only in the hash stays a same-document navigation. */
let pageUrl: string;

let browser: Browser;
let page: Page;
const oracle: Record<string, RunReport> = {};

/**
 * Move the API door's strip to a tab (`M205` §2) and wait for it to be the one showing.
 *
 * Every read of the preview below goes through this now, and that is the strip doing its job in
 * the tests as well as on the page: *what this file is about to be* stopped being a panel stapled
 * under the form and became **Source**, one of the file's three stages — so a test that wants the
 * bytes has to say where it is looking, exactly as a reader does.
 */
/** Wait for the stub to report its pid. The file appears when the child starts, which is after
 *  the page has already drawn the picking pane — so this is a wait and not an assertion. */
const waitForPidFile = async (file: string, timeoutMs = 5000): Promise<number> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const pid = Number(await readFile(file, 'utf8'));
      if (Number.isInteger(pid) && pid > 0) return pid;
    } catch {
      // not written yet
    }
    if (Date.now() > deadline) throw new Error(`the pick stub never reported a pid within ${timeoutMs}ms — it was not spawned`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

/** Wait for a pid to leave the process table. `process.kill(pid, 0)` is a liveness probe: it
 *  throws `ESRCH` once the process is gone and returns silently while it lives. Polled rather than
 *  read once, because the page closes the stream and the child dies on the server's own schedule —
 *  asserting immediately would be a race, which is `M205-08`'s shape. */
const waitForExit = async (pid: number, timeoutMs = 5000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    if (Date.now() > deadline) throw new Error(`pid ${pid} is still alive ${timeoutMs}ms after the door changed — the pick session was orphaned`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

const openTab = async (tab: 'compose' | 'source' | 'run' | 'auth' | 'config'): Promise<void> => {
  await page.locator(`[data-tab="${tab}"]`).click();
  await page.locator(`[data-tabstrip="${tab}"]`).waitFor();
};

/**
 * What is selected inside the Config tab's textarea — how `S5b` checks that an `[edit]` link
 * landed on the block it named.
 *
 * **It casts through `unknown` rather than naming `HTMLTextAreaElement`, and that is not
 * squeamishness.** This package's `tsconfig.test.json` carries `types: ["node"]` and no DOM lib,
 * so `HTMLTextAreaElement`, `document` and `HTMLElement` are not names here — and `tsx` strips
 * types without checking them, so the first draft of this helper passed the whole suite and
 * failed `tsc`. That is `S1`'s finding, arriving a second time in the same file.
 */
const selectedText = (p: Page, selector: string): Promise<string> =>
  p.locator(selector).evaluate((el) => {
    const area = el as unknown as { value: string; selectionStart: number; selectionEnd: number };
    return area.value.slice(area.selectionStart, area.selectionEnd);
  });

/** `html.ts`'s `pretty`, restated: what the page shows for a JSON body. */
const pretty = (text: string): string => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};

const setup = stagedSetup(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'tflw-ui-page-'));
  // The bundle, built here rather than taken from `dist/ui` so this file grades the checked-out
  // page whatever was last built. The ui's own vite, not the root's (VitePress pins a vite 5).
  const viteManifestPath = createRequire(uiRoot).resolve('vite/package.json');
  const viteBin = join(dirname(viteManifestPath), (JSON.parse(await readFile(viteManifestPath, 'utf8')) as { bin: { vite: string } }).bin.vite);
  const staticDir = join(scratch, 'ui');
  // `M234`: `...coverageBuildArgs()` is empty unless this run is under `npm run coverage`.
  execFileSync(process.execPath, [viteBin, 'build', '--outDir', staticDir, '--logLevel', 'warn', ...coverageBuildArgs()], { cwd: uiRoot, stdio: 'pipe' });

  root = join(scratch, 'project');
  await cp(join(fixtures, 'project'), root, { recursive: true });
  // `M238-03` — the port is chosen **below every ephemeral range**, not by `listen(0)`. The number is
  // written into the config once and then bound and released by a dozen tests across the whole file,
  // so it sits free for minutes at a time. A port from `listen(0)` comes out of the kernel's ephemeral
  // range (Linux 32768-60999, macOS 49152-65535), the same pool every other process's implicit binds
  // and outbound connections draw from, and on `fedora-box`'s 8-tree sweep one of them took
  // `127.0.0.1:41181` between two tests (`EADDRINUSE`, 1 of 296). Below the range the kernel never
  // hands a port out by itself, so only an explicit bind can collide, and the probe skips any port
  // already held when the file starts.
  fixturePort = await (async () => {
    for (let attempt = 0; attempt < 32; attempt++) {
      const candidate = 20_000 + Math.floor(Math.random() * 12_000);
      const free = await new Promise<boolean>((resolve) => {
        const probe = createNetServer();
        probe.once('error', () => resolve(false));
        probe.listen(candidate, '127.0.0.1', () => probe.close(() => resolve(true)));
      });
      if (free) return candidate;
    }
    throw new Error('no free port in 20000-31999 after 32 tries');
  })();
  const configPath = join(root, 'tflw.config');
  const config = await readFile(configPath, 'utf8');
  assert.ok(config.includes('127.0.0.1:4717'), 'the fixture config names the default port');
  await writeFile(configPath, config.replaceAll('127.0.0.1:4717', `127.0.0.1:${fixturePort}`));
  // A project with `playwright` installed, as one that wrote a trace is: this repository's
  // `node_modules`, linked in, is what `traceViewerDir` resolves through (U3).
  await symlink(join(here, '..', '..', '..', 'node_modules'), join(root, 'node_modules'), 'dir');
  for (const env of ['full', 'headers']) {
    await mkdir(join(root, 'report', 'runs'), { recursive: true });
    await cp(join(fixtures, 'reports', env), join(root, 'report', 'runs', env), { recursive: true });
    oracle[env] = JSON.parse(await readFile(join(fixtures, 'reports', env, 'results.json'), 'utf8')) as RunReport;
  }
  /**
   * **`full` is made the newest, deliberately** — `M213` `S2`.
   *
   * `ReportEntry.at` is `results.json`'s mtime, and Compose reads *the last run that touched this
   * file* (`D1099`). Two directories copied microseconds apart have an ordering nobody chose, so
   * *which report the pane is showing* was a coin toss between two runs that differ in exactly the
   * thing the tests below read: `headers` records no response bodies. A gate whose oracle depends
   * on a filesystem timestamp race is a gate that passes on ordering, which is the defect `M213`
   * has now filed twice. One `utimes` removes it.
   */
  const now = new Date();
  await utimes(join(root, 'report', 'runs', 'full', 'results.json'), now, now);

  server = new UiServer({ token: TOKEN, root, cliEntry, execArgv: ['--import', tsxLoader], staticDir });
  const port = await server.listen(0);
  baseUrl = `http://127.0.0.1:${port}`;
  pageUrl = `${baseUrl}/?token=${TOKEN}`;
  browser = await chromium.launch();
  page = await newPage();
  // `M234`. Inert unless this run is under `npm run coverage`; see `./ui-coverage.ts` for why the
  // 203 tests below counted toward nothing until now.
  await startUiCoverage(page);
});

before(setup.begin);

after(async () => {
  await setup.settled(); // `M237` `A1` — see `scripts/test-staging.mjs`
  // Before `browser.close()` (the page is the source) and before `rm(scratch)` (the bundle is read
  // out of it and copied somewhere that outlives this process). `M234`.
  if (page !== undefined) await stopUiCoverage(page, join(scratch, 'ui'), 'page');
  await browser?.close();
  await server?.close();
  /* `M235` `A1b`, **AMENDED BY `M237` `A1` — THE DIAGNOSIS IN THIS BLOCK WAS WRONG, AND THE
     REPAIR IT ARGUED FOR MADE THIS FILE THE QUIETEST FAILURE IN THE CENSUS.**

     WHAT IT SAID. A `--test-name-pattern` that matches nothing selects zero tests, so "`before()`
     is never run, and `after()` runs anyway" — and the repair was therefore to guard each teardown
     call against a binding `before()` had not assigned, the way the three lines above already did.
     How the shape is reached is still right and still worth the 52 minutes it cost: `M227` `A` is
     named ``​`M227` `A`: the report's charts…`` and the pattern `M227. .A: the report` misses the
     backtick between the `A` and the colon.

     WHAT IS ACTUALLY TRUE, measured 2026-09-24 on the box at Node v22.22.0 and reproduced on
     Node v26.7.0, with a probe whose `before()` sleeps 1200 ms and then opens a listening socket:
     `before()` IS run. `node:test` simply does not await it before running `after()` when nothing
     is selected —

         B start -> A ran, server is UNDEFINED -> A done -> B end, listening -> hangs

     WHAT THAT COST HERE. The guard turns every teardown call into a silent no-op, and `before()`
     then carries on and opens the browser, the server and the scratch tree with the only code that
     would ever have closed them already finished. In the 265-file census this file is the single
     entry that hangs with NO `hookFailed` and a 15-byte log reading `TAP version 13` and nothing
     else. A loud failure naming a path argument became a silent one naming nothing, for eight days,
     inside the repair.

     THE REPAIR IS THE `setup.settled()` ON THE FIRST LINE OF THIS HOOK; the mechanism is written
     once, in `scripts/test-staging.mjs`. The guards below stay, for the case they were always
     right about: a `before()` that genuinely THREW partway leaves bindings unassigned, and an
     `undefined.close()` there buries the setup's own diagnosis under a second failure naming an
     argument. `M108` removed `--test-force-exit` on purpose and this round does not put it back —
     a leaked ref'd handle hanging is honest; what was wrong is that the handles were opened for a
     run with zero tests in it.

     `scripts/verify-zero-match.mjs` is why a twelfth file cannot arrive here unnoticed. */
  if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
});

/**
 * The door every pre-`M200` test enters by (`D1042`). The landing is the root now, so a test that
 * wants the shell has to say which door it came through — and API is the one the fixture project
 * is mostly behind (8 of its 13 entries). The report and run panes are not door-specific: a
 * report holds whatever ran, and the door narrows only the project pane (`D1044`).
 *
 * **`M205` S5 moved where they are drawn, not who they belong to.** The API door's strip puts the
 * runs in its **Run** tab; the other three doors keep them under their form until the strip is
 * grilled against BROWSER, LOAD and SCANS. So a test whose subject is a report enters at
 * `#/api/run` — which is a stronger address than the old one, because it asserts that the report
 * renders inside the tab as well as that it renders.
 */
/* `openLegacyForm` went with the form it opened (`M212` `S4b`, `D1088`). `M210` `S1` added it
   because `D1082` kept `M200` `A1-4`'s write path behind a disclosure while Compose learned to
   read; the docblock ended *`S2`–`S5` dissolve the form, and this helper goes with the last of
   it*, which is what happened, two rounds later than that sentence expected. */

/** `Grip`'s `STAGE.fallback` — `.stage-frame`'s own floor since `M221`, which is what makes
 *  `Home` a restoration rather than a new number. Stated here rather than imported so the gate
 *  fails when the two drift apart instead of following them. */
const STAGE_FALLBACK = 620;

const API_DOOR = '#/api';
const API_RUN = '#/api/run';

/** The functional entries of a report — the workload kind carries metrics, not steps (U4). */
const functional = (report: RunReport): TestResult[] => report.tests.filter((t): t is TestResult => t.kind === 'functional');

async function openReport(id: string): Promise<void> {
  await page.goto(`${pageUrl}${API_RUN}`);
  await page.locator(`[data-report-row="${id}"]`).click();
  await page.locator(`[data-report="${id}"]`).waitFor();
}

test('the sidebar is the project as a tree: every file the server read, a leaf name per row, and this door as a count', async () => {
  await page.goto(`${pageUrl}${API_DOOR}`);
  await page.reload();
  await page.locator('[data-files]').waitFor();
  const project = (await (await api(`${baseUrl}/api/project`)).json()) as { files: { path: string; tests: { name: string; line: number; tags: string[]; lenses: string[] }[]; crawls: { lenses: string[] }[] }[]; envs: { name: string; isDefault: boolean }[] };
  assert.ok(project.files.length >= 2, 'the fixture project has two files');
  // `D1062` — EVERY `.tflw` file, tests or not. The list used to drop a file with nothing
  // declared in it at all, which is defensible for a list of tests and is a lie in a file tree.
  assert.equal(await page.locator('[data-files]').getAttribute('data-files'), String(project.files.length));
  assert.equal(await page.locator('[data-file]').count(), project.files.length);
  // The dimmed colour is the stylesheet's own `--muted`, read off the page: a hex written here
  // would be a second account of a token and would pass while the two drifted apart.
  const muted = await page.locator('[data-files]').evaluate((el) => {
    const doc = el.ownerDocument;
    const probe = doc.createElement('span');
    probe.style.color = 'var(--muted)';
    doc.body.append(probe);
    const c = doc.defaultView!.getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  for (const f of project.files) {
    const row = page.locator(`[data-file="${f.path}"]`);
    assert.equal(await row.count(), 1, `file ${f.path} listed once`);
    // `D1061` — a row is a file, named by its LEAF. The 55-character path repeated under every
    // folder it shares is what made 378 of the sibling's 389 rows wrap.
    assert.equal(await row.locator('.file-row > code').textContent(), f.path.split('/').pop());
    // `D1063` + `D1068` — the door is a count and the count has three states.
    const behind = f.tests.filter((t) => t.lenses.includes('api')).length + f.crawls.filter((c) => c.lenses.includes('api')).length;
    const total = f.tests.length + f.crawls.length;
    const count = row.locator('[data-door-count]');
    assert.equal(await count.getAttribute('data-door-count'), String(behind));
    assert.equal(await count.getAttribute('data-door-count-state'), total === 0 ? 'fragment' : behind === 0 ? 'none' : 'some');
    assert.equal(await count.textContent(), total === 0 ? '—' : String(behind));
    // Dimmed for `0`, NOT dimmed for `—`: *has tests, none here* and *declares nothing by nature*
    // are different facts, and without the second the six most-depended-on files in the sibling
    // would have been greyed out on every screen forever.
    //
    // **Read off the rendered colour, not off the class** (`M209-02`). The first draft asserted the
    // class, and `.file-row` is a `<button>` whose `color: inherit` beat the global `.muted` rule
    // at equal specificity — so every one of these rows was classed correctly and drawn identically,
    // and the gate said so for two slices. The class is the label; the colour is the artifact.
    const paint = await row.locator('.file-row').evaluate((el) => {
      const cs = el.ownerDocument.defaultView!.getComputedStyle(el);
      return { row: cs.color, name: el.ownerDocument.defaultView!.getComputedStyle(el.querySelector('code')!).color };
    });
    const shouldDim = total > 0 && behind === 0;
    assert.equal(paint.row === muted, shouldDim, `${f.path} is painted ${paint.row} and should${shouldDim ? '' : ' not'} be dimmed`);
    assert.equal(paint.name === muted, shouldDim, `${f.path}'s NAME follows it — dimming the count alone says nothing about the file`);
  }
  // The folders are nodes, not prefixes on every row.
  const dirs = new Set(project.files.flatMap((f) => f.path.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))));
  assert.equal(await page.locator('[data-dir]').count(), dirs.size, 'one node per directory');
  for (const d of dirs) {
    const node = page.locator(`[data-dir="${d}"]`);
    assert.equal(await node.getAttribute('data-dir-files'), String(project.files.filter((f) => f.path.startsWith(`${d}/`)).length));
  }

  const options = await page.locator('[data-env-select] option').allTextContents();
  assert.deepEqual(
    options,
    project.envs.map((e) => `${e.name}${e.isDefault ? ' (default)' : ''}`),
  );
  // The counts line is the door's own arithmetic since `A0-3`, and it states BOTH halves: what
  // is behind this door and what is behind another. A pane that silently listed ten of twelve
  // tests is how someone concludes the tool lost their tests.
  const counts = await page.locator('[data-project-counts]').textContent();
  const behindApi = project.files.reduce((n, f) => n + f.tests.filter((t) => t.lenses.includes('api')).length, 0);
  const elsewhere = project.files.reduce((n, f) => n + f.tests.length, 0) - behindApi;
  assert.equal(counts, `${project.files.length} files · ${behindApi} behind API · ${elsewhere} behind another door`);
  assert.ok(elsewhere > 0, 'the fixture must hold a test behind some other door, or the clause above is never rendered');
  // `M209` `S5` folded the tag cloud into the search box (`M205` Q12) — U7's fold existed because
  // the sibling's 84 chips pushed every file below the first screen, and a control that has to be
  // folded to be usable is the wrong control. The tags are the box's completions now, and the
  // project's own — not this door's, because search is over the project and the door is a count.
  const allTags = new Set(project.files.flatMap((f) => f.tests.flatMap((t) => t.tags)));
  assert.equal(await page.locator('[data-tags-fold]').count(), 0, 'the cloud is gone');
  assert.equal(await page.locator('[data-search]').count(), 1);
  assert.equal(await page.locator('#tflw-tags option').count(), allTags.size, 'every tag in the project is a completion');
  assert.equal(await page.locator('[data-search-hint]').getAttribute('data-search-kind'), 'none');
  assert.match((await page.locator('[data-search-hint]').textContent())!, new RegExp(`^${allTags.size} tags? in this project`));
  // U7: the tab has the docs site's mark, and the page's own load logs no 404 for it.
  const icon = await api(`${baseUrl}/favicon.svg`);
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get('content-type'), 'image/svg+xml');
});

test('the run list is the report directories, each row carrying its own results.json counts', async () => {
  await page.goto(`${pageUrl}${API_RUN}`);
  for (const id of ['full', 'headers']) {
    const row = page.locator(`[data-report-row="${id}"]`);
    await row.waitFor();
    assert.equal(await row.getAttribute('data-ok'), String(oracle[id]!.ok));
    assert.equal((await row.locator('[data-row-counts]').textContent())?.trim(), `${oracle[id]!.passed}/${oracle[id]!.total}`);
  }
});

test('the functional view renders every test, step, detail, status and body the report holds', async () => {
  const report = oracle.full!;
  await openReport('full');
  const head = page.locator('[data-summary]');
  assert.equal(await head.locator('[data-verdict]').textContent(), report.ok ? 'PASS' : 'FAIL');
  assert.equal(await head.locator('[data-counts]').textContent(), `${report.total} tests · ${report.passed} passed · ${report.failed} failed`);
  assert.equal(await head.locator('[data-env]').textContent(), report.env);
  assert.equal(await page.locator('[data-evidence-level]').count(), 0, 'a full report states no evidence caveat');

  assert.equal(await page.locator('[data-test]').count(), report.tests.length);
  let assertionsSeen = 0;
  let bodiesSeen = 0;
  for (const entry of report.tests) {
    if (entry.kind !== 'functional') continue; // the workload kind has its own tests below (U4)
    const t = entry;
    const section = page.locator(`[data-test][data-name="${t.name}"]`);
    assert.equal(await section.count(), 1, `${t.name} rendered once`);
    assert.equal(await section.getAttribute('data-ok'), String(t.ok));
    assert.equal(await section.locator('[data-test-name]').textContent(), t.name);
    // The final steps are the section's own list; prior attempts are folded under it.
    const steps = section.locator(':scope > .steps > [data-step]');
    assert.equal(await steps.count(), t.steps.length, `${t.name}: ${t.steps.length} steps`);
    for (let i = 0; i < t.steps.length; i++) {
      const s: StepResult = t.steps[i]!;
      const row = steps.nth(i);
      assert.equal(await row.getAttribute('data-line'), String(s.line));
      assert.equal(await row.getAttribute('data-ok'), String(s.ok));
      assert.equal(await row.locator('[data-source]').textContent(), s.source);
      if (s.detail) {
        assert.equal(await row.locator('[data-detail]').textContent(), s.detail);
        if (s.kind === 'expect' || s.kind === 'check') assertionsSeen += 1;
      }
      if (s.request && s.response) {
        assert.equal(await row.locator('[data-status]').textContent(), `← ${s.response.status} ${s.response.statusText} · ${Math.round(s.response.durationMs)} ms`);
        assert.equal(await row.locator('[data-body]').textContent(), pretty(s.response.bodyText));
        bodiesSeen += 1;
      }
    }
    if (t.attempts) {
      assert.equal(await section.locator('[data-attempt]').count(), t.attempts.length - 1, `${t.name}: prior attempts folded`);
      assert.equal(await section.locator('[data-attempts]').getAttribute('data-attempts'), String(t.attempts.length));
      assert.equal(await section.locator('[data-flaky]').count(), t.flaky ? 1 : 0);
    }
  }
  // Non-vacuity: the corpus carries a failed assertion with its got/expected, and bodies.
  const failedAssertion = functional(report).flatMap((t) => t.steps).find((s) => !s.ok && s.kind === 'expect');
  assert.ok(failedAssertion?.detail?.includes(', but got '), 'the corpus has a failed assertion in the runtime\'s words');
  assert.ok(assertionsSeen >= 10 && bodiesSeen >= 5, `saw ${assertionsSeen} assertions and ${bodiesSeen} bodies`);
  assert.ok(functional(report).some((t) => t.attempts), 'the corpus has a retried test');
});

test('at `evidence headers only` the page states the level and shows the marker the report holds, never a body', async () => {
  const report = oracle.headers!;
  await openReport('headers');
  const level = page.locator('[data-evidence-level]');
  assert.equal(await level.count(), 1, 'the level is stated once');
  assert.equal(await level.getAttribute('data-evidence-level'), report.evidenceLevel);
  const bodies = await page.locator('[data-body]').allTextContents();
  // In the page's order: a test's prior attempts are folded above its final steps.
  const held = functional(report)
    .flatMap((t) => [...(t.attempts ?? []).slice(0, -1).flatMap((a) => a.steps), ...t.steps])
    .filter((s) => s.response)
    .map((s) => s.response!.bodyText);
  assert.ok(held.length > 0 && held.every((b) => b === '[omitted by evidence level]'), 'the corpus is a headers-only run');
  assert.deepEqual(bodies, held);
  // Headers are still there — the level withholds bodies, not headers.
  assert.ok((await page.locator('[data-response] [data-headers]').count()) > 0);
});

test('WebUI at `evidence full`: the screenshot a step took, the failure shot, and the trace handed to Playwright\'s viewer', async () => {
  const report = oracle.full!;
  await openReport('full');
  const shots = functional(report).flatMap((t) => t.steps.filter((s) => s.screenshot).map((s) => ({ test: t.name, step: s })));
  assert.ok(shots.length >= 2 && shots.some((x) => x.step.ok) && shots.some((x) => !x.step.ok), 'the corpus has an explicit screenshot and a failure-first one');
  for (const { test: name, step } of shots) {
    const row = page.locator(`[data-test][data-name="${name}"] [data-step][data-line="${step.line}"]`);
    const img = row.locator('[data-screenshot]');
    assert.equal(await img.count(), 1, `${name} line ${step.line}: one screenshot`);
    assert.equal(await img.getAttribute('src'), `data:image/png;base64,${step.screenshot!.base64}`);
    // Folded under a passing step, open under a failed one — the HTML report's rule.
    assert.equal(await row.locator('details.evidence').evaluate((el) => (el as { open: boolean }).open), !step.ok);
    // Decodable, not just present: the report's bytes are a PNG of the fixture viewport. Through
    // a fresh `Image` rather than the rendered one, which is `loading="lazy"` inside a closed
    // `<details>` and so never loads — its `decode()` hangs there rather than rejecting.
    // (`Image` is the browser's; this file type-checks under `node` only, hence the cast.)
    const size = await img.evaluate(
      (el) =>
        new Promise<number[]>((resolve, reject) => {
          const probe = new (globalThis as unknown as { Image: new () => { onload: () => void; onerror: () => void; src: string; naturalWidth: number; naturalHeight: number } }).Image();
          probe.onload = () => resolve([probe.naturalWidth, probe.naturalHeight]);
          probe.onerror = () => reject(new Error('the screenshot did not decode'));
          probe.src = el.getAttribute('src')!;
        }),
    );
    assert.deepEqual(size, [640, 400], 'the fixture viewport');
  }
  const traced = functional(report).filter((t) => t.trace);
  assert.equal(traced.length, 1, 'the failed browser test kept its trace; the passing one did not');
  const section = page.locator(`[data-test][data-name="${traced[0]!.name}"]`);
  const line = section.locator('[data-trace]');
  await line.waitFor();
  const path = (await line.getAttribute('data-trace'))!;
  assert.match(path, /^assets\/traces\/[0-9a-f]{16}\.zip$/);
  // The link resolves to the archive the reporter wrote — the page's hash is the reporter's.
  const zip = await api(`${baseUrl}${await line.locator('[data-trace-download]').getAttribute('href')}`);
  assert.equal(zip.status, 200);
  // `results.json` carries the archive's PATH and not its bytes (`TraceAsset`: `base64` is present
  // everywhere except `results.json`). This read `trace.base64` for as long as the corpus was the
  // one `M192` wrote, before the contract split the two — `M240-02`. The size the server serves is
  // the size of the file the reporter wrote, read off disk.
  assert.equal(traced[0]!.trace!.base64, undefined, 'the report holds a path, not bytes');
  assert.equal(Number(zip.headers.get('content-length')), (await stat(join(root, 'report', 'runs', 'full', traced[0]!.trace!.path!))).size);
  assert.equal(await line.locator('code').textContent(), `npx playwright show-trace ${path}`);
  /**
   * ***open trace* opens the viewer IN THIS PAGE** — `M220` `C` (`D1179`).
   *
   * This used to read an `<a>`'s `href` and open the viewer in a second browser page, which is
   * what the control did: it answered the question by leaving the application. That was the right
   * shape while a trace was a failure artefact you took away to study, and `D1170` has just made
   * a kept trace the ordinary outcome of pressing ▶. So the control is a button, the viewer is an
   * iframe in the Run pane — **same-origin, which is exactly what `M220` §2.1 measured an iframe
   * of the application *under test* is not** — and this asserts the frame, not a link.
   *
   * The fixture corpus is deliberately **not** regenerated for this round, so its `results.json`
   * still carries `trace.base64` rather than `D1171`'s `trace.path`. That makes this gate the
   * cover for `TraceLink`'s legacy branch — a report written before `M220`, whose bytes are
   * hashed to recover the archive's name — and the live `--trace` run in `examples/storefront`
   * is where the new shape is read.
   */
  assert.equal(await line.locator('[data-open-trace]').evaluate((el) => el.tagName), 'BUTTON', 'the control opens the viewer here, it does not link away');
  // `M239` `C` — what the viewer and the page said while the frame filled, so a viewer that does
  // not render fails with its own words rather than with a bare timeout.
  const said: string[] = [];
  const onConsole = (m: { type(): string; text(): string }): void => { said.push(`${m.type()}: ${m.text()}`); };
  const onPageError = (e: Error): void => { said.push(`pageerror: ${e.message}`); };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  await line.locator('[data-open-trace]').click();
  const frame = page.locator('[data-trace-frame]');
  await frame.waitFor();
  const src = (await frame.getAttribute('src'))!;
  assert.match(src, /^\/trace\/index\.html\?trace=/);
  // The archive the viewer is pointed at is the one the reporter wrote, named **absolutely** —
  // the viewer's own service worker fetches it, and a relative path would resolve against
  // `/trace/` rather than against this page.
  const pointedAt = decodeURIComponent(src.slice(src.indexOf('trace=') + 'trace='.length));
  assert.match(pointedAt, /^https?:\/\//, 'the viewer is handed an absolute URL');
  assert.ok(pointedAt.endsWith(`/api/reports/full/${path}`), `the viewer is pointed at the archive the reporter wrote — got ${pointedAt}`);
  assert.equal((await api(pointedAt)).status, 200, 'and that URL serves');
  // The trace's own content, rendered by the viewer inside the pane: the page the test opened.
  const viewerViolations = async (): Promise<string[]> => {
    const f = page.frame({ url: /\/trace\/index\.html/ });
    if (!f) return ['(no viewer frame in the page)'];
    // one-shot: the list the viewer's init script keeps, read after the frame wait — a refusal
    // during the render this test waited for is already in it, and this is not a DOM read.
    return f.locator('html').evaluate((el) => (el.ownerDocument.defaultView as unknown as { __cspViolations?: string[] }).__cspViolations ?? []).catch((e: Error) => [`(unreadable: ${e.message})`]);
  };
  try {
    await page.frameLocator('[data-trace-frame]').getByText('127.0.0.1:4717', { exact: false }).first().waitFor({ timeout: 60_000 });
  } catch (e) {
    throw new Error(`the viewer did not render the trace — console: ${JSON.stringify(said)}; viewer CSP violations: ${JSON.stringify(await viewerViolations())}; page CSP violations: ${JSON.stringify(await cspViolations(page))}`, { cause: e });
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
  // `M239` `C` (`D1278`) — the viewer runs under the narrower policy `/trace/` serves, and it
  // rendered a snapshot through its service worker without that policy refusing anything.
  // one-shot: the frame wait directly above is the render whose fetches the policy would have
  // refused — the service worker's, the snapshot's — so an empty list read after it is a claim
  // about a drawn viewer, not about one that has not painted yet.
  assert.deepEqual(await viewerViolations(), [], 'the trace viewer\'s policy refused something it needs');
  // one-shot: the same wait, read from the page's side — a refusal on the page while the frame
  // filled would already be in the list the init script keeps.
  assert.deepEqual(await cspViolations(page), [], 'the page\'s policy refused something it needs');
  // …and back, because a pane you cannot leave is a tab with extra steps.
  await page.locator('[data-trace-close]').click();
  await page.locator('[data-report]').first().waitFor();
  assert.equal(await page.locator('[data-trace-frame]').count(), 0);
  assert.equal(await page.locator('[data-evidence-withheld]').count(), 0);
});

test('`M239` `C`: every door draws under the page\'s Content-Security-Policy with nothing refused — the nonce reached the theme script', async () => {
  for (const door of ['api', 'browser', 'load', 'scan'] as const) {
    await page.goto(`${pageUrl}#/${door}`);
    await page.reload();
    await page.locator(`[data-doorbar="${door}"]`).waitFor();
    // one-shot: the doorbar wait above is the door having drawn under the policy, and a refusal
    // while it drew is already in the list the init script keeps — this reads the list, not the DOM.
    assert.deepEqual(await cspViolations(page), [], `on the ${door} door`);
  }
  // The inline theme script ran, which under `script-src 'self' 'nonce-…'` it can only have done
  // with the nonce: it is the one thing in the page that writes `data-tflw-theme` before React.
  // one-shot: a write, not a read — `evaluate` on the root is the way to reach `localStorage`
  // without the DOM lib, and the value it returns is discarded.
  await page.locator('html').evaluate((el) => el.ownerDocument.defaultView!.localStorage.setItem('tflw.theme', 'paper'));
  await page.reload();
  // Wait for *a* theme on the root, assert *the* theme: the attribute is the inline script's only
  // write, so its presence after a reload is that script having run at all.
  const themed = page.locator('html[data-tflw-theme]');
  await themed.waitFor();
  assert.equal(await themed.getAttribute('data-tflw-theme'), 'paper');
  // one-shot: the theme wait above is the inline script having run under the policy; a nonce that
  // did not reach it would be a violation already in the list, not one still to come.
  assert.deepEqual(await cspViolations(page), []);
  // one-shot: the same write, undone.
  await page.locator('html').evaluate((el) => el.ownerDocument.defaultView!.localStorage.removeItem('tflw.theme'));
  // one-shot: the control — a header on a fresh response, which no page event can settle and
  // which the server computes the same way for every page load.
  const res = await api(`${baseUrl}/?token=${TOKEN}`);
  assert.match(res.headers.get('content-security-policy') ?? '', /script-src 'self' 'nonce-/);
});

test('WebUI at `evidence headers only`: no screenshot, no trace, and the sentence saying why, under every browser test', async () => {
  const report = oracle.headers!;
  await openReport('headers');
  assert.equal(await page.locator('[data-screenshot]').count(), 0);
  assert.equal(await page.locator('[data-trace]').count(), 0);
  const browserTests = functional(report).filter((t) => t.steps.some((s) => s.kind === 'open'));
  assert.equal(browserTests.length, 2, 'the corpus has two browser tests');
  assert.ok(browserTests.every((t) => !t.trace && t.steps.every((s) => !s.screenshot)), 'the run withheld them (FS-01)');
  const withheld = page.locator('[data-evidence-withheld]');
  assert.equal(await withheld.count(), browserTests.length);
  for (const t of browserTests) {
    const p = page.locator(`[data-test][data-name="${t.name}"] [data-evidence-withheld]`);
    assert.equal(await p.getAttribute('data-evidence-withheld'), report.evidenceLevel);
  }
  // The `screenshot` step itself says it was not captured — the runtime's words, shown as its detail.
  const shotStep = browserTests[0]!.steps.find((s) => s.kind === 'screenshot')!;
  assert.match(shotStep.detail ?? '', /not captured \(evidence level\)/);
  assert.equal(await page.locator(`[data-test][data-name="${browserTests[0]!.name}"] [data-step][data-line="${shotStep.line}"] [data-detail]`).textContent(), shotStep.detail);
});

// ---- U4: the workload kind -----------------------------------------------------------------

const workloads = (report: RunReport): WorkloadTestResult[] => report.tests.filter((t): t is WorkloadTestResult => t.kind === 'workload');
/** The page's units, restated: `D809`'s rounding then ` ms`; a rate as the console prints it. */
const dur = (n: number): string => `${roundDurationMs(n)} ms`;
const pct = (f: number): string => `${(f * 100).toFixed(2)}%`;
/** Every `[data-stat]` row the page shows, read from the oracle the same way. */
const STATS: Record<string, (m: LoadMetrics) => string> = {
  iterations: (m) => String(m.iterations),
  failures: (m) => String(m.failures),
  errorRate: (m) => pct(m.errorRate),
  assertions: (m) => (m.assertions === null ? '—' : String(m.assertions)),
  min: (m) => dur(m.durations.min),
  avg: (m) => dur(m.durations.avg),
  max: (m) => dur(m.durations.max),
  p50: (m) => dur(m.durations.p50),
  p90: (m) => dur(m.durations.p90),
  p95: (m) => dur(m.durations.p95),
  p99: (m) => dur(m.durations.p99),
  'successful.iterations': (m) => String(m.successful.iterations),
  'successful.p50': (m) => dur(m.successful.durations.p50),
  'successful.p95': (m) => dur(m.successful.durations.p95),
  'successful.p99': (m) => dur(m.successful.durations.p99),
};

/** uPlot's legend under the cursor: `{ label: value }`, read from the DOM the reader sees. */
async function legendAt(chart: ReturnType<Page['locator']>, fraction: number): Promise<Record<string, string>> {
  await chart.scrollIntoViewIfNeeded();
  const box = (await chart.locator('.u-over').boundingBox())!;
  // One pixel inside either edge, so the cursor snaps to the first or last point, never off-plot.
  const px = Math.min(Math.max(box.width * fraction, 1), box.width - 1);
  await page.mouse.move(box.x + px, box.y + box.height / 2);
  const rows = await chart.locator('.u-legend .u-series').all();
  const out: Record<string, string> = {};
  for (const r of rows) out[(await r.locator('.u-label').textContent())!.trim()] = (await r.locator('.u-value').textContent())!.trim();
  return out;
}

/** How many of a canvas's pixels are painted — a chart that drew nothing has none. */
async function paintedPixels(chart: ReturnType<Page['locator']>): Promise<number> {
  // Typed loosely: the cli's typecheck has no DOM lib, and this runs in the browser.
  return chart.locator('canvas').evaluate((c) => {
    const canvas = c as unknown as { width: number; height: number; getContext(k: '2d'): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } };
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) n += 1;
    return n;
  });
}

test('the workload view: the shape, every stat, every threshold and every endpoint the report holds, in the report\'s words', async () => {
  const report = oracle.full!;
  const loads = workloads(report);
  assert.ok(loads.length >= 2, 'the corpus has two workload tests');
  assert.ok(loads.some((t) => t.ok) && loads.some((t) => !t.ok), 'one passes its thresholds and one breaches');
  await openReport('full');
  assert.equal(await page.locator('[data-test][data-kind="workload"]').count(), loads.length);
  for (const t of loads) {
    const section = page.locator(`[data-test][data-kind="workload"][data-name="${t.name}"]`);
    assert.equal(await section.getAttribute('data-ok'), String(t.ok));
    assert.equal((await section.locator('[data-workload-shape]').textContent())?.trim(), describeWorkload(t.workload));
    assert.equal(await section.locator('[data-compared-with]').count(), 0, 'nothing is compared until asked');
    for (const [key, read] of Object.entries(STATS)) {
      assert.equal((await section.locator(`[data-stat="${key}"] [data-value]`).textContent())?.trim(), read(t.metrics), `${t.name}: ${key}`);
    }
    assert.equal(await section.locator('[data-stat] [data-other]').count(), 0);
    const rows = section.locator('[data-threshold]');
    assert.equal(await rows.count(), t.thresholds.length);
    for (let i = 0; i < t.thresholds.length; i++) {
      const th = t.thresholds[i]!;
      const row = rows.nth(i);
      assert.equal(await row.getAttribute('data-ok'), String(th.ok));
      assert.equal(await row.getAttribute('data-label'), th.label);
      assert.equal((await row.locator('[data-target]').textContent())?.trim(), `${th.op === 'lessThan' ? '<' : '>'} ${formatThresholdTarget(th)}`);
      assert.equal((await row.locator('[data-actual]').textContent())?.trim(), `actual: ${formatThresholdActual(th)}`);
    }
    // The endpoint table — one row per identity, the endpoint's own numbers.
    const endpoints = section.locator('[data-endpoint]');
    assert.equal(await endpoints.count(), t.endpoints.length);
    for (const e of t.endpoints) {
      const row = section.locator(`[data-endpoint="${e.identity}"]`);
      assert.equal((await row.locator('[data-col="iterations"]').textContent())?.trim(), String(e.metrics.iterations));
      assert.equal((await row.locator('[data-col="failures"]').textContent())?.trim(), String(e.metrics.failures));
      assert.equal((await row.locator('[data-col="errorRate"]').textContent())?.trim(), pct(e.metrics.errorRate));
      for (const k of ['p50', 'p95', 'p99', 'max'] as const) assert.equal((await row.locator(`[data-col="${k}"]`).textContent())?.trim(), dur(e.metrics.durations[k]));
    }
    assert.equal(await section.locator('[data-col="otherP95"]').count(), 0);
  }
  // Non-vacuity: a breached threshold is drawn as one, an error-rate actual carries its unit —
  // and the successful-only population differs from the whole one somewhere, or the rows that
  // read `metrics.successful` would pass reading `metrics.durations` (U7: they did, until the
  // fixture's failing call became its slow one).
  assert.ok(loads.some((t) => t.metrics.successful.durations.p95 !== t.metrics.durations.p95 || t.metrics.successful.durations.p99 !== t.metrics.durations.p99), 'a workload whose successful-only percentiles differ from the whole population\'s');
  assert.ok((await page.locator('[data-threshold][data-ok="false"]').count()) >= 1);
  assert.ok((await page.locator('[data-threshold] [data-actual]').allTextContents()).some((s) => s.includes('%')));
  // Sorting the endpoint table: by p95 ascending, then descending, is the oracle's order.
  const multi = loads.find((t) => t.endpoints.length > 1)!;
  const section = page.locator(`[data-test][data-kind="workload"][data-name="${multi.name}"]`);
  const byP95 = [...multi.endpoints].sort((a, b) => a.metrics.durations.p95 - b.metrics.durations.p95).map((e) => e.identity);
  assert.notDeepEqual(byP95, [...byP95].reverse(), 'the endpoints differ in p95, so the sort is observable');
  const p95Header = section.locator('[data-endpoints] th', { hasText: /^p95/ });
  await p95Header.click();
  assert.equal(await p95Header.getAttribute('data-sort'), 'asc');
  assert.deepEqual(await section.locator('[data-endpoint]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-endpoint'))), byP95);
  await p95Header.click();
  assert.equal(await p95Header.getAttribute('data-sort'), 'desc');
  assert.deepEqual(await section.locator('[data-endpoint]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-endpoint'))), [...byP95].reverse());
});

/**
 * The report's chart heights, read once they are LAID OUT — `M234-06`'s shape, fifth site.
 *
 * `getBoundingClientRect()` through `evaluateAll` resolves against whatever the DOM holds on one
 * tick and retries nothing, so a canvas that is mounted but not yet sized measures **0**. CI Node 22
 * failed here in 103 ms with `actual [0]` against `expected [180]` — four charts found and every
 * one of them zero, which is not a wrong height, it is no height yet.
 *
 * **The retry is on "not measurable", never on "measured wrong", and that distinction is what keeps
 * the assertion falsifiable.** Retrying until the heights equal 180 would make this gate
 * unable to fail — the exact defect `M141` is named for. So the loop waits only while a chart is
 * missing or reads 0, and a chart that settles at 200 is returned immediately and fails the caller's
 * assertion; a chart genuinely stuck at 0 exhausts the budget and fails with the same message it
 * always did. Same rule as `openMenuAndBox`, where a mis-placed menu is never retried and a vanished
 * one is.
 *
 * `M235` `B1` — the loop now lives in `settle.ts` and the rule above has a name, `untilMeasurable`.
 * Nothing about this site changed: same predicate, same budget of 50 x 100 ms, same last-seen value
 * handed back for the caller's assertion to judge.
 */
const laidOutChartHeights = async (min: number): Promise<number[]> => {
  const outcome = await settle(
    () => page
      .locator('[data-chart] canvas')
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height))),
    untilMeasurable(`${min} chart(s) mounted and sized`, (h) => h.length >= min && !h.includes(0)),
    { attempts: 50, delayMs: 100, page },
  );
  return outcome.value;
};

// **The report's charts keep their constant height** — `M227` `A` (`D1230`).
//
// `height="fill"` is the plan panel's alone, and this is the gate that says so. The four charts
// here live in a *scrolling report*, where "fill the region" has no meaning: there is no region,
// there is a column of sections as long as the run was. A constant is the right contract for
// them and the wrong one for a sized, resizable footer, which is the whole of `D1230`.
//
// It is taken on the shared report fixture rather than on a run, because a chart's height is a
// property of how it was mounted and not of what it plotted.
test('`M227` `A`: the report\'s charts are 180 px, and none of them opted into filling a region (`D1230`)', async () => {
  await openReport('full');
  const heights = await laidOutChartHeights(4);
  assert.ok(heights.length >= 4, `the report drew charts to measure (${heights.length})`);
  assert.deepEqual([...new Set(heights)].sort(), [180], `every report chart keeps the constant: ${[...new Set(heights)].join(', ')}`);
  // one-shot: `laidOutChartHeights` two lines up has already waited for every chart to mount and
  // size, so this absence is asserted about a page that is known to have painted its charts — the
  // classifier cannot see that, because the wait happens inside a module-scope helper
  assert.equal(await page.locator('[data-chart-fill]').count(), 0, 'and none of them carries the fill contract');
});

test('the charts are the report\'s timeline and histogram: painted, one point per second, and the legend reads the report\'s numbers under the cursor', async () => {
  const report = oracle.full!;
  const loads = workloads(report);
  await openReport('full');
  const long = loads.find((t) => t.metrics.timeline.length >= 3)!;
  const short = loads.find((t) => t.metrics.timeline.length === 1)!;
  assert.ok(long && short, 'the corpus has a multi-second run and a one-second run');
  for (const t of loads) {
    const section = page.locator(`[data-test][data-kind="workload"][data-name="${t.name}"]`);
    const n = t.metrics.timeline.length;
    for (const id of ['latency', 'throughput', 'errors']) {
      const chart = section.locator(`[data-chart="${id}"]`);
      assert.equal(await chart.getAttribute('data-points'), String(n), `${t.name}: ${id} has one point per second`);
      assert.ok((await paintedPixels(chart)) > 0, `${t.name}: ${id} painted something`);
    }
    assert.equal(await section.locator('[data-chart="latency"]').getAttribute('data-series'), '3');
    assert.equal(await section.locator('[data-chart="histogram"]').getAttribute('data-points'), String(t.metrics.histogram.length));
    // The legend under the cursor at the first and the last second is that second's own figures.
    for (const [k, fraction] of [[0, 0], [n - 1, 1]] as const) {
      const p = t.metrics.timeline[k]!;
      const latency = await legendAt(section.locator('[data-chart="latency"]'), fraction);
      assert.deepEqual(latency, { at: `${p.offsetSeconds}s`, p50: dur(p.p50), p95: dur(p.p95), p99: dur(p.p99) }, `${t.name}: latency at ${p.offsetSeconds}s`);
      const throughput = await legendAt(section.locator('[data-chart="throughput"]'), fraction);
      assert.deepEqual(throughput, { at: `${p.offsetSeconds}s`, 'requests/s': String(p.rps) });
      const errors = await legendAt(section.locator('[data-chart="errors"]'), fraction);
      assert.deepEqual(errors, { at: `${p.offsetSeconds}s`, 'error rate': `${Number((p.errorRate * 100).toFixed(2))}%` });
    }
    // The histogram: the first bucket's own value and count.
    const first = t.metrics.histogram[0]!;
    const last = t.metrics.histogram[t.metrics.histogram.length - 1]!;
    assert.deepEqual(await legendAt(section.locator('[data-chart="histogram"]'), 0), { bucket: dur(first.value), iterations: String(first.count) });
    assert.deepEqual(await legendAt(section.locator('[data-chart="histogram"]'), 1), { bucket: dur(last.value), iterations: String(last.count) });
  }
  // Non-vacuity: the multi-second run's p95 varies across its seconds, so the two reads differ
  // by the report and not by the cursor.
  const p95s = long.metrics.timeline.map((p) => dur(p.p95));
  assert.ok(new Set(p95s).size > 1 || new Set(long.metrics.timeline.map((p) => String(p.rps))).size > 1, 'the run is not flat');
  assert.ok((await page.locator('[data-threshold][data-ok="false"]').count()) >= 1);
  assert.ok(short.metrics.errorRate > 0, 'the one-second run has an error rate to plot');
});

test('two report directories side by side: the compared run\'s figures in every table, its series dashed on every chart, and nothing once unpicked', async () => {
  const a = oracle.full!;
  const b = oracle.headers!;
  await openReport('full');
  await page.locator('[data-compare]').selectOption('headers');
  await page.locator('[data-compared-with="headers"]').first().waitFor();
  const loadsA = workloads(a);
  assert.equal(await page.locator('[data-compared-with="headers"]').count(), loadsA.length);
  let deltasSeen = 0;
  for (const t of loadsA) {
    const o = workloads(b).find((x) => x.name === t.name)!;
    assert.ok(o, `${t.name} is in both runs`);
    const section = page.locator(`[data-test][data-kind="workload"][data-name="${t.name}"]`);
    for (const [key, read] of Object.entries(STATS)) {
      const row = section.locator(`[data-stat="${key}"]`);
      assert.equal((await row.locator('[data-value]').textContent())?.trim(), read(t.metrics), `${key}: this run`);
      assert.equal((await row.locator('[data-other]').textContent())?.trim(), read(o.metrics), `${key}: the compared run`);
      const delta = (await row.locator('[data-delta]').textContent())!.trim();
      assert.match(delta, /^[+−±]/, `${key}: a signed difference`);
      if (!delta.startsWith('±')) deltasSeen += 1;
    }
    // A duration difference is the two stated figures' difference, rounded the way they are.
    const min = t.metrics.durations.min - o.metrics.durations.min;
    assert.equal((await section.locator('[data-stat="min"] [data-delta]').textContent())?.trim(), `${min > 0 ? '+' : min < 0 ? '−' : '±'}${roundDurationMs(Math.abs(min))} ms`);
    const rows = section.locator('[data-threshold]');
    for (let i = 0; i < t.thresholds.length; i++) {
      const th = t.thresholds[i]!;
      const ot = o.thresholds.find((x) => x.label === th.label && x.op === th.op && x.target === th.target)!;
      assert.equal((await rows.nth(i).locator('[data-actual-other]').textContent())?.trim(), formatThresholdActual(ot));
    }
    for (const e of t.endpoints) {
      const oe = o.endpoints.find((x) => x.identity === e.identity)!;
      const row = section.locator(`[data-endpoint="${e.identity}"]`);
      assert.equal((await row.locator('[data-col="otherP95"]').textContent())?.trim(), dur(oe.metrics.durations.p95));
      assert.equal((await row.locator('[data-col="otherErrorRate"]').textContent())?.trim(), pct(oe.metrics.errorRate));
    }
    // Every chart carries both runs; under the cursor the dashed series reads the other report.
    assert.equal(await section.locator('[data-chart="latency"]').getAttribute('data-series'), '6');
    assert.equal(await section.locator('[data-chart="throughput"]').getAttribute('data-series'), '2');
    const union = [...new Set([...t.metrics.timeline, ...o.metrics.timeline].map((p) => p.offsetSeconds))].sort((x, y) => x - y);
    assert.equal(await section.locator('[data-chart="latency"]').getAttribute('data-points'), String(union.length));
    const at = union[union.length - 1]!;
    const pa = t.metrics.timeline.find((p) => p.offsetSeconds === at);
    const pb = o.metrics.timeline.find((p) => p.offsetSeconds === at);
    const legend = await legendAt(section.locator('[data-chart="latency"]'), 1);
    assert.equal(legend.at, `${at}s`);
    assert.equal(legend.p95, pa ? dur(pa.p95) : '–');
    assert.equal(legend['p95 (compared)'], pb ? dur(pb.p95) : '–');
  }
  assert.ok(deltasSeen > 0, 'the two runs differ somewhere, so a difference was actually shown');
  // Unpicked: back to one run, and a different selection starts with none.
  await page.locator('[data-compare]').selectOption('');
  await page.locator('[data-compared-with]').first().waitFor({ state: 'detached' });
  assert.equal(await page.locator('[data-stat] [data-other]').count(), 0);
  await page.locator('[data-compare]').selectOption('headers');
  await page.locator('[data-compared-with="headers"]').first().waitFor();
  await openReport('headers');
  assert.equal(await page.locator('[data-compared-with]').count(), 0, 'a comparison does not follow the selection');
  assert.equal(await page.locator('[data-compare]').inputValue(), '');
});

// ---- U5: the security kind -----------------------------------------------------------------

test('the findings block: every finding the report holds, grouped by rule in the report\'s order, with its site, its words, its fingerprint, the gate\'s verdict and the KB\'s fix; and the rule census', async () => {
  for (const id of ['full', 'headers']) {
    const report = oracle[id]!;
    const findings = report.findings ?? [];
    assert.ok(findings.length >= 2, `${id}: the corpus holds findings`);
    await openReport(id);
    const block = page.locator('[data-findings]');
    assert.equal(await block.getAttribute('data-findings-count'), String(findings.length));
    assert.equal((await block.locator('[data-findings-summary]').textContent())?.trim(), findingsSummaryLine(findings));
    for (const t of report.authorizedTargets ?? []) {
      assert.equal((await block.locator(`[data-authorized-target="${t.target}"]`).textContent())?.trim(), `ℹ authorized target ${t.target} — ${t.reason}`);
    }
    const cov = report.scanBlindSpot?.coverage;
    if (cov && cov.apiSteps > 0) assert.equal(await block.locator('[data-authz-coverage]').getAttribute('data-authz-coverage'), `${cov.withOwner}/${cov.apiSteps}`);
    // U7: declines are folded under one line naming their count (89 on the security dogfood); the
    // fixture raises none, so only the absent branch is graded here — the fold's threshold is §10's.
    const declines = report.scanBlindSpot?.declines ?? [];
    assert.equal(await block.locator('[data-declines-fold]').count(), declines.length > 0 ? 1 : 0);
    assert.equal(await block.locator('[data-scan-decline]').count(), declines.length);
    // Grouped by rule, worst first, and inside a group the report's own order.
    const sorted = sortFindings(findings);
    const rules = [...new Set(sorted.map((f) => f.rule))];
    assert.deepEqual(await block.locator('[data-rule]').evaluateAll((els) => els.map((e) => e.getAttribute('data-rule'))), rules);
    for (const rule of rules) {
      const group = block.locator(`[data-rule="${rule}"]`);
      const inRule = sorted.filter((f) => f.rule === rule);
      assert.equal(await group.getAttribute('data-rule-count'), String(inRule.length));
      assert.equal(await group.getAttribute('data-severity'), inRule[0]!.severity);
      const rows = group.locator('[data-finding]');
      // `M211-01` — **one row per distinct finding**, not per judgement. This gate read
      // `inRule.length` until `M211` `S6`, which was right only because neither fixture holds a
      // duplicate: the claim passed by accident rather than because it was true. It is stated
      // against the same rule the page uses now, so a fixture that grows a duplicate moves both
      // together; the row count under a rule whose findings differ is still one each, which is what
      // these two corpora are.
      const distinct = new Set(inRule.map((f) => JSON.stringify(Object.keys(f).sort().map((k) => [k, (f as unknown as Record<string, unknown>)[k]]))));
      assert.equal(await rows.count(), distinct.size);
      assert.equal(distinct.size, inRule.length, `${id}/${rule}: this corpus has no identical findings, so the mapping is still one to one`);
      for (let i = 0; i < inRule.length; i++) {
        const f = inRule[i]!;
        const row = rows.nth(i);
        assert.equal(await row.getAttribute('data-finding'), f.fingerprint);
        assert.equal(await row.getAttribute('data-endpoint'), f.endpoint);
        assert.equal(await row.getAttribute('data-withheld'), f.withheld ?? null);
        assert.equal(await row.getAttribute('data-in-compared'), null, 'nothing is compared until asked');
        assert.equal((await row.locator('[data-finding-description]').textContent())?.trim(), f.description);
        assert.equal((await row.locator('[data-finding-detail]').textContent())?.trim(), f.detail);
        assert.equal((await row.locator('[data-fingerprint]').textContent())?.trim(), f.fingerprint);
        assert.equal(await row.locator('[data-finding-source]').getAttribute('data-finding-source'), `${f.file}:${f.line}`);
        if (f.withheld) assert.equal((await row.locator('[data-withheld-label]').textContent())?.trim(), WITHHELD_LABEL[f.withheld]);
        else assert.equal(await row.locator('[data-withheld-label]').count(), 0);
        // The KB's fix for this rule, folded, its CWE and its references — from the same entries
        // `report.html` and the SARIF render.
        const kb = remediationFor(f.rule)!;
        assert.ok(kb, `${f.rule} has a KB entry`);
        const fix = row.locator('[data-fix]');
        assert.equal(await fix.evaluate((e) => (e as unknown as { open: boolean }).open), false);
        assert.equal((await fix.locator('.fix-title').textContent())?.trim(), kb.title);
        assert.equal(await fix.locator('[data-cwe]').getAttribute('data-cwe'), String(kb.cwe));
        assert.deepEqual(await fix.locator('a').evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute('href')])), kb.refs.map((r) => [r.label, r.url]));
      }
    }
    // The census: which rules applied and which stood down, with the reasons.
    for (const c of report.scanCoverage ?? []) {
      const census = block.locator(`[data-scan-census="${c.scan}"]`);
      assert.equal((await census.locator('h4').textContent())?.trim(), SCAN_KIND_LABEL[c.scan]);
      assert.deepEqual(await census.locator('[data-applied-rule]').evaluateAll((els) => els.map((e) => e.getAttribute('data-applied-rule'))), c.applied);
      for (const n of c.notApplicable) assert.equal((await census.locator(`[data-na-rule="${n.rule}"]`).textContent())?.trim(), `${n.rule} — ${n.because.join('; ')}`);
      assert.equal(await census.locator('[data-na-rule]').count(), c.notApplicable.length);
    }
  }
  // Non-vacuity: the two corpora hold the same finding once gating and once withheld by the
  // baseline, so both verdict renderings were asserted above.
  const full = oracle.full!.findings!;
  const headers = oracle.headers!.findings!;
  assert.ok(full.some((f) => !f.withheld) && headers.some((f) => f.withheld === 'baseline'), 'gating in full, known/accepted in headers');
  assert.ok(full.some((f) => f.severity === 'critical'), 'a critical finding, so the worst-first order is observable');
});

test('two runs\' findings side by side: the same finding\'s verdict in the other run, and the other run\'s findings this one lacks', async () => {
  const a = oracle.full!.findings!;
  const b = oracle.headers!.findings!;
  await openReport('full');
  await page.locator('[data-compare]').selectOption('headers');
  await page.locator('[data-findings-compared="headers"]').waitFor();
  let differs = 0;
  for (const f of a) {
    const row = page.locator(`[data-finding="${f.fingerprint}"]`);
    const o = b.find((x) => x.fingerprint === f.fingerprint);
    const same = o !== undefined && (o.withheld ?? null) === (f.withheld ?? null);
    assert.equal(await row.getAttribute('data-in-compared'), o ? (same ? 'same' : 'differs') : 'absent');
    const badge = (await row.locator('[data-since="headers"]').textContent())?.trim();
    if (!o) assert.equal(badge, 'not in headers');
    else if (same) assert.equal(badge, 'also in headers');
    else {
      assert.equal(badge, `${o.withheld ? WITHHELD_LABEL[o.withheld] : 'gating'} in headers`);
      differs += 1;
    }
  }
  assert.equal(differs, 1, 'exactly one finding the baseline withholds in headers and not in full');
  assert.equal(await page.locator('[data-findings-gone]').count(), 0, 'headers has nothing full lacks');
  await page.locator('[data-compare]').selectOption('');
  await page.locator('[data-findings-compared]').waitFor({ state: 'detached' });
  assert.equal(await page.locator('[data-in-compared]').count(), 0);
});

test('a run from the page: the live pane fills from the stream, and the kept directory is what the page then shows', async () => {
  const fixtureServer = (await import(pathToFileURL(join(root, 'server.mjs')).href)) as { startFixtureServer: (port: number) => Promise<Server> };
  const target = await fixtureServer.startFixtureServer(fixturePort);
  try {
    await page.goto(`${pageUrl}${API_RUN}`);
    // `S5`: narrowing by tag is typed now, and it passes `--tag` exactly as the chip did.
    await page.locator('[data-search]').fill('@catalog');
    await page.locator('[data-run]').click();
    await page.locator('[data-live]').waitFor();
    // The page selects the kept report when the server says the run ended.
    const kept = page.locator('[data-report]:not([data-report="full"]):not([data-report="headers"])');
    await kept.waitFor({ timeout: 60_000 });
    const id = (await kept.getAttribute('data-report'))!;
    const written = JSON.parse(await readFile(join(root, 'report', 'runs', id, 'results.json'), 'utf8')) as RunReport;
    assert.equal(await page.locator('[data-summary] [data-counts]').textContent(), `${written.total} tests · ${written.passed} passed · ${written.failed} failed`);
    assert.equal(await page.locator('[data-test]').count(), written.tests.length);
    // What was asked is what ran: `@catalog` is three of the five tests, and the argv says so.
    const runs = (await (await api(`${baseUrl}/api/runs`)).json()) as { argv: string[]; status: string; exitCode: number | null; kept: string }[];
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0]!.argv.slice(-2), ['--tag', 'catalog']);
    assert.equal(runs[0]!.status, 'done');
    assert.equal(runs[0]!.kept, `report/runs/${id}`);
    assert.equal(written.total, 3);
    // U7: exit 0/1 is the report's own verdict, so no note about the process appears.
    assert.ok(runs[0]!.exitCode === (written.ok ? 0 : 1));
    assert.equal(await page.locator('[data-run-exit]').count(), 0);
    assert.ok(written.tests.every((t) => t.file === 'tests/catalog.tflw'));
    // And the run list gained the row, with the run's own counts.
    const row = page.locator(`[data-report-row="${id}"]`);
    assert.equal((await row.locator('[data-row-counts]').textContent())?.trim(), `${written.passed}/${written.total}`);
    // A `@catalog` run asserts nothing about security, so it holds no findings and no block —
    // and compared with `full`, every finding there is absent here, listed as what full has that
    // this run does not (U5's absent branch, which the two corpora alone cannot show).
    assert.equal(written.findings, undefined);
    assert.equal(await page.locator('[data-finding]').count(), 0);
    if ((await page.locator('[data-findings]').count()) > 0) assert.match((await page.locator('[data-findings-summary]').textContent())!, /^no findings/);
    await openReport('full');
    await page.locator('[data-compare]').selectOption(id);
    await page.locator(`[data-findings-compared="${id}"]`).waitFor();
    assert.equal(await page.locator('[data-in-compared="absent"]').count(), oracle.full!.findings!.length);
    assert.equal((await page.locator('[data-since]').first().textContent())?.trim(), `not in ${id}`);
    await openReport(id);
    assert.equal(await page.locator('[data-finding]').count(), 0);
    await page.locator('[data-compare]').selectOption('full');
    await page.locator('[data-findings-gone]').waitFor();
    assert.equal(await page.locator('[data-findings-gone]').getAttribute('data-findings-gone'), String(oracle.full!.findings!.length));
    assert.deepEqual(await page.locator('[data-finding-gone]').evaluateAll((els) => els.map((e) => e.getAttribute('data-finding-gone'))), sortFindings(oracle.full!.findings!).map((f) => f.fingerprint));
  } finally {
    target.close();
  }
});

test('a run cancelled from the page: its kept directory says so above the report, with the exit the process ended with', async () => {
  const fixtureServer = (await import(pathToFileURL(join(root, 'server.mjs')).href)) as { startFixtureServer: (port: number) => Promise<Server> };
  const target = await fixtureServer.startFixtureServer(fixturePort);
  try {
    await page.goto(`${pageUrl}${API_RUN}`);
    const before = new Set(await page.locator('[data-report-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-report-row'))));
    await page.locator('[data-search]').fill('@load');
    await page.locator('[data-run]').click();
    // Cancel once the workload is under way — before that `tflw run` has no graceful abort and
    // dies with no report (`cli.ts`: the handler is installed only for a run with a workload).
    await page.locator('[data-live] [data-test]').first().waitFor({ timeout: 60_000 });
    await page.locator('[data-cancel]').click();
    const kept = page.locator('[data-report]');
    await kept.waitFor({ timeout: 60_000 });
    const id = (await kept.getAttribute('data-report'))!;
    assert.ok(!before.has(id), 'a new directory was kept');
    const written = JSON.parse(await readFile(join(root, 'report', 'runs', id, 'results.json'), 'utf8')) as RunReport;
    assert.equal(written.aborted, true, 'the report says aborted — the runtime\'s own fact');
    const runs = (await (await api(`${baseUrl}/api/runs`)).json()) as { status: string; exitCode: number | null; kept: string }[];
    const run = runs.find((r) => r.kept === `report/runs/${id}`)!;
    assert.equal(run.status, 'cancelled');
    // U7's rule: the exit is the page's fact, not the report's, whenever the report's verdict does
    // not already say it — a cancel is the page's own gesture and 130 is what it produced.
    const note = page.locator('[data-run-exit]');
    await note.waitFor();
    assert.equal(await note.getAttribute('data-run-exit'), String(run.exitCode));
    assert.equal(await note.getAttribute('data-run-status'), 'cancelled');
    assert.match((await note.textContent())!, /cancelled from this page/);
    assert.match((await note.textContent())!, new RegExp(`exit ${run.exitCode}`));
    // Selecting a directory the page did not run — the corpus — shows no note.
    await openReport('full');
    assert.equal(await page.locator('[data-run-exit]').count(), 0);
  } finally {
    target.close();
  }
});

test('a run that could not start: the live pane keeps its exit and stderr, drawn as the failure it is, and nothing is kept', async () => {
  await page.goto(`${pageUrl}${API_RUN}`);
  // `--workers 0` — `tflw run` refuses it (usage, exit 2) before any report is written.
  const before = (await (await api(`${baseUrl}/api/runs`)).json()) as { id: string }[];
  await page.locator('[data-workers]').fill('0');
  await page.locator('[data-run]').click();
  const pane = page.locator('[data-live]');
  await pane.locator('[data-stderr]').waitFor({ timeout: 60_000 });
  const runs = (await (await api(`${baseUrl}/api/runs`)).json()) as { id: string; status: string; exitCode: number | null; kept: string | null }[];
  const run = runs.find((r) => !before.some((b) => b.id === r.id))!;
  assert.equal(run.kept, null);
  assert.equal(run.status, 'done');
  assert.notEqual(run.exitCode, 0);
  const verdict = pane.locator('.verdict');
  assert.equal((await verdict.textContent())?.trim(), `exit ${run.exitCode}`);
  // U7: the dogfood's security page drew a green `exit 2` — the colour keyed on failed tests, of
  // which a run that never started has none.
  assert.match((await verdict.getAttribute('class'))!, /\bfail\b/);
  assert.match((await pane.locator('[data-stderr]').textContent())!, /positive integer/);
  // And the run keeps a row of its own: no directory to stand for it, so it would otherwise
  // vanish from the list the moment anything else is selected.
  //
  // **Waited for, not read.** This test asks `/api/runs` directly and then asserts what the page
  // says, and those two learn the run ended by different routes: the server knows when the child
  // exits, the page hears `event: end` on its stream and only then re-reads the list. So the test
  // can be a round trip ahead of the page, and reading the attribute instantly is a race that
  // passes almost always — 5 of 5 runs of this test alone, and one failure in a full-file run
  // (`running !== done`, 2026-09-17). The claim is unchanged; it now waits for the page to have
  // heard, which is the thing it meant to assert all along.
  const row = page.locator(`[data-run-row="${run.id}"][data-status="done"]`);
  await row.waitFor();
  assert.equal(await row.getAttribute('data-exit'), String(run.exitCode));
  assert.match((await row.textContent())!, new RegExp(`exit ${run.exitCode} · no report`));
  await openReport('full');
  assert.equal(await page.locator(`[data-run-row="${run.id}"]`).count(), 1, 'the row survives a selection elsewhere');
  await page.locator(`[data-run-row="${run.id}"]`).click();
  await page.locator(`[data-live="${run.id}"] [data-stderr]`).waitFor({ timeout: 30_000 });
  await page.locator('[data-workers]').fill('');
});

// ---------------------------------------------------------------------------
// `M209` `S2` — Source gains a test index (`D1067`).
//
// The sidebar's test rows carry three facts the file's own bytes do not: the `crawl` and
// `workload` badges, and *this test is behind another door too*. `S3` takes those rows out of the
// sidebar to make it a file tree, so the index is built FIRST and graded against the rows it will
// replace — the comparison below is sidebar-against-index on the live page, not index-against a
// number written here.
// ---------------------------------------------------------------------------

interface DeclRow { name: string | null; line: string | null; lenses: string | null; badges: string[]; tags: string[] }

/** The projection whole — `projectView()` below carries only what its own section needs, and the
 *  index is graded on lines, tags and the workload flag as well as on names. */
interface FullProject {
  /** `M240` `A` — the landing memory is keyed by a hash of this. */
  root: string;
  files: { path: string; errors: number; tests: { name: string; line: number; tags: string[]; workload: boolean; lenses: string[] }[]; crawls: { name: string; line: number; lenses: string[] }[] }[];
  /** `M221` `B` — the basename ▶ writes beside whichever file it plays (`D1184`). */
  playScratch: string;
}
const fullProject = async (): Promise<FullProject> => (await (await api(`${baseUrl}/api/project`)).json()) as FullProject;

/** The door labels, restated — the cli typecheck has no jsx, so `doors.ts` is not importable here.
 *  `DoorBar`'s own gate reads the same four out of the page, so a drift between these and the
 *  product reddens there. */
const DOOR_LABELS: Record<string, string> = { api: 'API', browser: 'BROWSER', load: 'LOAD', scan: 'SCANS' };

const readDecls = (p: Page, selector: string): Promise<DeclRow[]> =>
  p.locator(selector).evaluateAll((els) =>
    els.map((e) => ({
      name: e.getAttribute('data-project-test') ?? e.getAttribute('data-project-crawl') ?? e.getAttribute('data-source-test'),
      line: e.getAttribute('data-line'),
      lenses: e.getAttribute('data-test-lenses'),
      badges: [...e.querySelectorAll('.badge')].map((b) => b.textContent!.trim()).sort(),
      tags: [...e.querySelectorAll('.tag')].map((b) => b.textContent!.trim()).sort(),
    })),
  );

test("Source indexes every declaration the server read, with the badges the sidebar used to carry", async () => {
  // **This gate was written against the sidebar and is graded against the projection.** `S2` built
  // the index while the test rows were still in the tree, and compared the two rows directly —
  // which is the only moment that comparison can be made. `S3` took the rows out, so a gate still
  // reading `[data-project-test]` would have gone on passing over an empty set, which is `M209`'s
  // own subject: a check that reconciles a thing against itself. The oracle is `/api/project`, the
  // same derivation the sidebar was rendering.
  const view = await fullProject();
  for (const f of view.files) {
    await page.goto(`${pageUrl}#/api/source/${f.path}`);
    // **A WAIT IS ONLY SAFE WHEN ITS SELECTOR NAMES WHAT THE NAVIGATION ASKED FOR** (`M213-12`).
    // These five `goto`s differ only in the HASH, so the browser fires `hashchange` rather than
    // navigating, and until React commits that render the **previous** file's `[data-test-index]`
    // is still in the DOM — a generic selector cannot tell one render from the next. This loop went
    // red in 16 ms with *the catalog holds under a fixed amount of work at line 1*, which is the
    // previous file's index being graded against this file's oracle; the red is the harmless half,
    // because the same window can also hand back a match and be believed.
    //
    // Three loops in this file wait on a selector that DOES name the subject —
    // `[data-source-test="<name>"]`, `[data-request-line="<line>"]` — and they are safe by
    // construction. Where the page offers no such selector, as here, a reload makes the DOM this
    // file's by construction; it is the file's own idiom at 32 other sites.
    await page.reload();
    await page.locator('[data-test-index]').waitFor();
    const inIndex = await readDecls(page, '[data-source-test]');
    assert.equal(await page.locator('[data-test-index]').getAttribute('data-test-index'), String(f.tests.length + f.crawls.length), `${f.path}: every declaration is indexed, not only this door's`);
    if (f.tests.length + f.crawls.length === 0) {
      assert.equal(await page.locator('[data-test-index-empty]').count(), 1, `${f.path}: a fragment says what it is`);
      continue;
    }
    for (const t of f.tests) {
      const row = inIndex.find((r) => r.name === t.name && r.line === String(t.line));
      assert.ok(row, `${f.path}: ${t.name} at line ${t.line} is in the index`);
      assert.deepEqual(row.tags, [...t.tags].map((x) => `@${x}`).sort(), `${f.path}: ${t.name} carries its tags`);
      assert.equal(row.lenses, t.lenses.join(' '), `${f.path}: ${t.name} carries its whole derivation`);
      // The three DERIVED facts, which live nowhere else on the page: `workload`, `crawl`, and
      // every other door this test is behind.
      const expected = [...(t.workload ? ['workload'] : []), ...t.lenses.filter((l) => l !== 'api').map((l) => DOOR_LABELS[l]!)].sort();
      assert.deepEqual(row.badges, expected, `${f.path}: ${t.name} carries its derived badges`);
    }
    for (const c of f.crawls) {
      const row = inIndex.find((r) => r.name === c.name && r.line === String(c.line));
      assert.ok(row, `${f.path}: crawl ${c.name} is in the index`);
      assert.deepEqual(row.badges, ['crawl', ...c.lenses.filter((l) => l !== 'api').map((l) => DOOR_LABELS[l]!)].sort());
    }
  }
});

test('the index is not door-filtered: a test behind another door is listed where it lives, and says which door that is', async () => {
  const view = await fullProject();
  // A file holding a test the API door does not carry — LOAD's workload is the one in the fixture.
  const elsewhere = view.files
    .flatMap((f) => f.tests.map((t) => ({ path: f.path, ...t })))
    .find((t) => !t.lenses.includes('api') && t.lenses.length > 0);
  assert.ok(elsewhere, 'the fixture holds a test behind some door other than API');
  await page.goto(`${pageUrl}#/api/source/${elsewhere.path}`);
  const row = page.locator(`[data-source-test="${elsewhere.name}"]`);
  await row.waitFor();
  assert.equal(await row.getAttribute('data-test-here'), 'no', 'the row says this door is not one of its own');
  const also = await row.locator('[data-also]').evaluateAll((els) => els.map((e) => e.getAttribute('data-also')!).sort());
  assert.deepEqual(also, [...elsewhere.lenses].sort(), 'and names every door it is behind');
  // The sidebar cannot say this: it lists the file with a count and never the test.
  await page.goto(`${pageUrl}${API_DOOR}`);
  await page.locator('[data-files]').waitFor();
  assert.equal(await page.locator(`[data-project-test="${elsewhere.name}"]`).count(), 0);
});

// `M211` `S6` (`M211-01`) — a report with tens of thousands of identical findings, on a project of
// its own, because neither shared fixture holds a duplicate at all.
//
// The subject is the shape the storefront example produced by following its own documented
// instruction: a scan assertion inside a workload judged one endpoint 29,381 times and recorded
// 29,381 rows that were **byte-identical** — 29,381 `<li>`, 29,381 `[accept]` buttons all staging
// the same single baseline entry, and a pane 3,455,656 px tall. `M211` `S1` bounded the example's
// own workload; this gate is the other half, because the page must survive anyone else writing it.
//
// 400 rather than 29,381: the claim is the *rule*, and the cost of the fixture is not evidence for
// it. A count high enough that the unfixed page is visibly broken is enough.
test('a report holding the same finding many times renders one row saying how many, and one accept button', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m211-dupes-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    // Derived from a real report rather than invented, so every field the row renders is one the
    // runtime actually writes.
    const source = oracle['full']!;
    const one = (source.findings ?? []).find((f) => f.fingerprint !== undefined)!;
    const COPIES = 400;
    const differs = { ...one, detail: `${one.detail} (a second site, so this one must NOT merge)` };
    const findings = [...Array.from({ length: COPIES }, () => ({ ...one })), differs];
    await mkdir(join(dir, 'report', 'runs', 'dupes'), { recursive: true });
    await writeFile(join(dir, 'report', 'runs', 'dupes', 'results.json'), JSON.stringify({ ...source, findings }));
    // The control: the same report with the duplicates removed. The claim is that the pane does
    // not grow with the number of judgements, and the only honest instrument for that is the same
    // page rendered both ways — an absolute pixel bound would be a number invented here, and the
    // first draft of this gate used one (`< 6000`) that failed at 6132 px because this fixture's
    // pane is ~6,000 px before a single finding is drawn.
    await mkdir(join(dir, 'report', 'runs', 'plain'), { recursive: true });
    await writeFile(join(dir, 'report', 'runs', 'plain', 'results.json'), JSON.stringify({ ...source, findings: [one, differs] }));
    const port = await ui.listen(0);

    await fresh.goto(`http://127.0.0.1:${port}/?token=${TOKEN}${API_RUN}`);
    await fresh.locator('[data-report-row="dupes"]').click();
    await fresh.locator('[data-report="dupes"]').waitFor();

    const group = fresh.locator(`[data-rule="${one.rule}"]`);
    // The heading counts JUDGEMENTS, because that is what the run did and what `results.json` holds.
    assert.equal(await group.getAttribute('data-rule-count'), String(COPIES + 1));
    assert.equal(await group.getAttribute('data-rule-distinct'), '2');
    // The list counts DISTINCT findings.
    const rows = group.locator('[data-finding]');
    assert.equal(await rows.count(), 2, 'the 400 identical rows are one row; the one that differs is its own');
    assert.equal(await rows.nth(0).getAttribute('data-occurrences'), String(COPIES));
    assert.equal(await rows.nth(1).getAttribute('data-occurrences'), '1');
    assert.equal((await rows.nth(0).locator('[data-finding-times]').textContent())?.replace(/\s+/g, ' ').trim(), `× ${COPIES}`);
    // The ordinary case is untouched: a row standing for one judgement says nothing extra.
    assert.equal(await rows.nth(1).locator('[data-finding-times]').count(), 0);
    // The accept buttons follow the ROWS, so they follow the distinct findings: 401 judgements
    // offered 401 buttons before this slice, every one staging the same single baseline entry —
    // `M208` `S3` added that control per row and made the defect worse without knowing it.
    //
    // **Two, not one, and the difference is the residual stated rather than hidden.** These two
    // rows differ in `detail` and therefore share a fingerprint, because the fingerprint excludes
    // `detail` by design; a baseline entry is keyed on the fingerprint, so both buttons stage the
    // same entry. That is the honest outcome of collapsing on the whole row: it never merges
    // different evidence, and the price is that one weakness can still show two accept buttons.
    // Asserted so the day it changes, something says so.
    const accepts = fresh.locator('[data-accept-finding]');
    assert.equal(await accepts.count(), 2, 'one per distinct row, not one per judgement');
    assert.deepEqual(await accepts.evaluateAll((els) => els.map((e) => e.getAttribute('data-accept-finding'))), [one.fingerprint, one.fingerprint]);
    // And the pane costs the same as if the duplicates had never been written. The unfixed page
    // measured 3,455,656 px on 29,381 rows — ~118 px each — so 401 rows would have been ~47,000.
    const tall = await fresh.locator('.main').evaluate((el) => el.scrollHeight);
    await fresh.goto(`http://127.0.0.1:${port}/?token=${TOKEN}${API_RUN}`);
    await fresh.locator('[data-report-row="plain"]').click();
    await fresh.locator('[data-report="plain"]').waitFor();
    const control = await fresh.locator('.main').evaluate((el) => el.scrollHeight);
    assert.equal(tall, control, `401 judgements cost what 2 do: ${tall}px vs ${control}px`);
  } finally {
    await fresh.close();
    await new Promise<void>((r) => ui.server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});

// `M211` `S2` (`M202-01`/`M202-02`) — a file that does not parse says so, and the landing stops
// counting it. On a project of its own, because the shared fixture parses.
//
// **`PLAN_M202_IMPORTERS.md` §2 Fork A's gate is amended here, and the amendment is gated rather
// than only written down.** Fork A asked the disclosure to fire *"at every [break] where recovery
// lost a test"* and, as the mutation that matters, **not** for breaks that recovered fully. That is
// unsatisfiable: measured over nine break shapes on a 12-test corpus file, the lossy ones (an
// unterminated `{`, `[` or nested object — 1 of 12 recovered) and the lossless ones (a truncated
// step, a stray `}`, an unknown keyword, a bare `expect`, a stray `test` — 12 of 12) agree on error
// count, on span width and on whether they reach EOF. The view has no ground truth for what the
// file would have held. So the disclosure keys on **having an error**, and the wording is what
// carries the honesty: *recovered*, never *incomplete*. The case Fork A wanted excluded is asserted
// here as included, on purpose.
test('a file that does not parse is badged as recovered, and the landing stops counting it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m211-broken-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    const body = (n: number, tag = '@api'): string =>
      Array.from({ length: n }, (_, i) => [tag, `test "case ${i}"`, `  api GET /c/${i}`, '  expect status equals 200', ''].join('\n')).join('\n');
    await writeFile(join(dir, 'healthy.tflw'), body(3));
    // Lossy: an unterminated object swallows the rest of the file. Measured on the real corpus at
    // 1 of 12 recovered.
    await writeFile(join(dir, 'lossy.tflw'), `@api\ntest "first"\n  api GET /x body {\n  expect status equals 200\n\n${body(3)}`);
    // Lossless: an unknown step keyword. The parser recovers every test; the badge still fires, and
    // that is Fork A's negative control inverted by measurement.
    await writeFile(join(dir, 'lossless.tflw'), `@api\ntest "first"\n  apX GET /x\n  expect status equals 200\n\n${body(2)}`);
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;

    // The server's own answer first — the page is graded against this, never against a literal.
    const project = (await (await api(`${base}/api/project`)).json()) as {
      files: { path: string; tests: unknown[]; diagnostics: number; errors: number; warnings: number }[];
    };
    const byPath = new Map(project.files.map((f) => [f.path, f]));
    const healthy = byPath.get('healthy.tflw')!;
    const lossy = byPath.get('lossy.tflw')!;
    const lossless = byPath.get('lossless.tflw')!;
    assert.equal(healthy.errors, 0);
    assert.ok(lossy.errors > 0 && lossless.errors > 0, 'both broken files carry an error');
    // The measurement this gate exists for: recovery loses tests in one and not the other, and
    // nothing in the diagnostics distinguishes them.
    assert.ok(lossy.tests.length < healthy.tests.length, `the unterminated object lost tests: ${lossy.tests.length}`);
    assert.equal(lossless.tests.length, 3, 'the unknown keyword lost none — 3 recovered of 3');
    // `M202-02` is latent and stays latent: nothing here produces a warning without an error.
    assert.equal(project.files.filter((f) => f.warnings > 0 && f.errors === 0).length, 0);

    await fresh.goto(`${base}${API_DOOR}`);
    await fresh.locator('[data-files]').waitFor();
    for (const [path, f] of [['lossy.tflw', lossy], ['lossless.tflw', lossless]] as const) {
      const badge = fresh.locator(`[data-file-row="${path}"] [data-recovered]`);
      assert.equal(await badge.getAttribute('data-recovered'), String(f.errors), `${path}: the badge counts errors`);
      assert.match((await badge.textContent())!, /does not parse .* recovered/, `${path}: it says what the list under it is`);
    }
    assert.equal(await fresh.locator('[data-file-row="healthy.tflw"] [data-recovered]').count(), 0, 'a file that parses carries no badge');

    // The landing: the counts leave the two out, and the page says so rather than folding a
    // salvaged number into a total it presents as the project's.
    await fresh.goto(`${base}/`);
    await fresh.locator('[data-landing]').waitFor();
    assert.equal(await fresh.locator('[data-unparsed]').getAttribute('data-unparsed'), '2');
    assert.match((await fresh.locator('[data-unparsed]').textContent())!, /not counted/);
    // The door counts only the file that parses: 3 `@api` tests, not 3 + 1 + 3.
    assert.equal(await fresh.locator('[data-door="api"]').getAttribute('data-door-count'), '3');
  } finally {
    await fresh.close();
    await new Promise<void>((r) => ui.server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});

// The scroll half of `D1067`, on a project of its own.
//
// The shared fixture's longest file is 23 lines, and `scrollIntoView({block: 'center'})` cannot
// centre a line the page has no room to scroll past — so on that fixture the gate is satisfied by
// any scroll at all. Measured: a row pointing **three lines off** left the target on screen and the
// first draft of this test passed. A file long enough to have a middle is the instrument.
test('an index row scrolls the text to its own line, and puts that line in the middle', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-s2-scroll-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 900, height: 300 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    const body: string[] = [];
    for (let i = 0; i < 24; i++) body.push('@api', `test "case ${i}"`, `  api GET /c/${i}`, '  expect status equals 200', '');
    await writeFile(join(dir, 'long.tflw'), body.join('\n'));
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;

    await fresh.goto(`${base}/?token=${TOKEN}#/api/source/long.tflw`);
    await fresh.locator('[data-test-index]').waitFor();
    const decl = fresh.locator('[data-source-test="case 12"]');
    const declLine = Number(await decl.getAttribute('data-line'));
    const text = (await fresh.locator('[data-preview]').textContent())!;
    const lines = text.split('\n');
    // **The anchor is the declaration's FIRST line, which is its tag line when it carries tags** —
    // `@api` sits above `test "…"`, because the node's span starts at its tags. That is the number
    // the sidebar has always shown; asserted rather than assumed, since the first draft of this
    // gate expected the `test` keyword and found the tags.
    const keywordAt = lines.findIndex((l) => l.startsWith('test "case 12"'));
    assert.ok(keywordAt >= 0);
    assert.ok(declLine === keywordAt || declLine === keywordAt + 1, `line ${declLine} begins the declaration (the keyword is at ${keywordAt + 1})`);
    const anchor = fresh.locator(`[data-preview] [data-source-line="${declLine}"]`);
    assert.equal((await anchor.textContent())!.replace(/\n$/, ''), lines[declLine - 1], 'the anchor holds the file\'s own line');

    // **The `<pre>` is the scroll container, not the page** — `.preview` is `max-height: 40vh;
    // overflow: auto`, so the line is centred in the text box and the box itself barely moves.
    // The first draft measured against the viewport's middle and was off by exactly the distance
    // between the two centres; it is the text box that has to be asked.
    const boxBefore = (await fresh.locator('[data-preview]').boundingBox())!;
    const before = (await anchor.boundingBox())!;
    assert.ok(before.y > boxBefore.y + boxBefore.height, `the declaration starts below the visible text (y ${before.y}, box ends ${boxBefore.y + boxBefore.height})`);
    await decl.locator(`[data-source-goto="${declLine}"]`).click();
    // Both boxes are re-read AFTER the press: the index above the text is 24 rows tall, so the
    // press scrolls the panel as well as the text and a box measured first is a box that moved.
    const box = (await fresh.locator('[data-preview]').boundingBox())!;
    const after = (await anchor.boundingBox())!;
    // Centred, within one line of the middle — the tolerance is the height of the thing being
    // positioned, so a row pointing one line off is the smallest error this can still see.
    const middle = box.y + box.height / 2;
    assert.ok(Math.abs(after.y + after.height / 2 - middle) <= after.height, `line ${declLine} is centred in the text box (y ${after.y}, middle ${middle})`);
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// `M209` `S3` — the tree. `D1061` a row is a file, `D1062` every file, `D1063` the door is a
// count, `D1068` three states, `D1066` expansion is inferred and is not in the address.
// ---------------------------------------------------------------------------

/** The tree's shape as one string per row: what is a folder, what is a file, and in what order. */
const treeShape = (p: Page): Promise<string[]> =>
  p.locator('[data-files] [data-dir], [data-files] [data-file]').evaluateAll((els) =>
    els.map((e) => (e.hasAttribute('data-dir') ? `dir:${e.getAttribute('data-dir')}` : `file:${e.getAttribute('data-file')}`)),
  );

test('the tree is byte-identical behind all four doors — the door is a count and narrows nothing', async () => {
  const shapes: Record<string, string[]> = {};
  for (const door of ['api', 'browser', 'load', 'scan']) {
    await page.goto(`${pageUrl}#/${door}`);
    // `[data-doorbar]` carries the door, so this wait names its own subject (`M213-12`); waiting on
    // `[data-files]` would have been satisfied by the previous door's render, and this test's whole
    // claim is that the four trees are equal — the one claim a stale read makes trivially true.
    await page.locator(`[data-doorbar="${door}"]`).waitFor();
    shapes[door] = await treeShape(page);
  }
  assert.ok(shapes.api!.length > 0);
  for (const door of ['browser', 'load', 'scan']) {
    assert.deepEqual(shapes[door], shapes.api, `the tree behind ${door} is the tree behind API`);
  }
  // And the claim is exercised rather than merely stated: behind every door at least one file
  // counts nothing, which is exactly where the old pane dropped a row.
  const view = await fullProject();
  for (const door of ['api', 'browser', 'load', 'scan']) {
    const silent = view.files.filter((f) => f.tests.length + f.crawls.length > 0 && ![...f.tests, ...f.crawls].some((t) => t.lenses.includes(door)));
    assert.ok(silent.length > 0, `the fixture has a file with nothing behind ${door}, or this gate proves nothing there`);
    await page.goto(`${pageUrl}#/${door}`);
    await page.locator(`[data-doorbar="${door}"]`).waitFor();
    for (const f of silent) {
      assert.equal(await page.locator(`[data-file="${f.path}"] [data-door-count]`).getAttribute('data-door-count-state'), 'none', `${f.path} is listed behind ${door}, counting nothing`);
    }
  }
});

test('a fragment file is in the tree, reads `—`, and is not dimmed', async () => {
  // `D1068`. The shared fixture declares a test in every file, so this needs a project of its own:
  // without the third state, `D1062` and `D1063` together would grey out the six most-depended-on
  // files in the sibling on every screen forever, and a gate with no fragment to look at would
  // never say so.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-s3-fragment-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage();
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    await mkdir(join(dir, 'shared'), { recursive: true });
    // A fragment: an action and nothing else. Every project that shares a login has one.
    await writeFile(join(dir, 'shared', 'root.tflw'), ['action "the root" do', '  api GET /', '  expect status equals 200', ''].join('\n'));
    // A file with tests, none of them behind BROWSER — the `0` state, which IS dimmed.
    await writeFile(join(dir, 'api.tflw'), ['@api', 'test "the catalogue answers"', '  api GET /catalog', '  expect status equals 200', ''].join('\n'));
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;

    await fresh.goto(`${base}/?token=${TOKEN}#/browser`);
    await fresh.locator('[data-files]').waitFor();
    assert.equal(await fresh.locator('[data-file]').count(), 2, 'the fragment is listed at all — it was in no list before this slice');

    const fragment = fresh.locator('[data-file="shared/root.tflw"]');
    const fCount = fragment.locator('[data-door-count]');
    assert.equal(await fCount.getAttribute('data-door-count-state'), 'fragment');
    assert.equal(await fCount.textContent(), '—');
    assert.doesNotMatch((await fragment.locator('.file-row').getAttribute('class'))!, /\bmuted\b/, 'a fragment declares nothing by nature and is not dimmed for it');

    const withTests = fresh.locator('[data-file="api.tflw"]');
    const wCount = withTests.locator('[data-door-count]');
    assert.equal(await wCount.getAttribute('data-door-count-state'), 'none');
    assert.equal(await wCount.textContent(), '0');
    assert.match((await withTests.locator('.file-row').getAttribute('class'))!, /\bmuted\b/, 'has tests, none behind this door — dimmed');

    // And on the door it IS behind, the same row counts.
    await fresh.goto(`${base}/?token=${TOKEN}#/api`);
    await fresh.locator('[data-files]').waitFor();
    assert.equal(await fresh.locator('[data-file="api.tflw"] [data-door-count]').textContent(), '1');
    assert.equal(await fresh.locator('[data-file="shared/root.tflw"] [data-door-count]').textContent(), '—', 'the fragment reads the same behind every door');

    // The fragment is now openable, which is the capability `D1062` is for: it was in no list, so
    // it could not be read in Source or edited anywhere.
    await fresh.goto(`${base}/?token=${TOKEN}#/api/source/shared/root.tflw`);
    await fresh.locator('[data-test-index-empty]').waitFor();
    assert.match((await fresh.locator('[data-preview]').textContent())!, /action "the root" do/);
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a long name at depth is one line and an ellipsis, with the whole path in reach', async () => {
  // `M209` §4's open item, measured rather than assumed. At 1440x900 the 320 px column leaves
  // 238 px at depth 3, and **16 of the sibling's 84 leaf names are 27-32 characters** — they
  // wrapped to two lines and the tree came out 2,554 px against a ~1,850 px forecast. A tree row
  // does not wrap; the fixture's names are all short, so the instrument is a project with a name
  // long enough to make the claim falsifiable.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-s3-long-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    const deep = 'tests/api/identity/session-refresh-and-oauth2-and-then-some.tflw';
    await mkdir(join(dir, 'tests', 'api', 'identity'), { recursive: true });
    await writeFile(join(dir, deep), ['@api', 'test "it answers"', '  api GET /x', '  expect status equals 200', ''].join('\n'));
    const port = await ui.listen(0);
    await fresh.goto(`http://127.0.0.1:${port}/?token=${TOKEN}#/api`);
    await fresh.locator('[data-files]').waitFor();

    const row = fresh.locator(`[data-file="${deep}"] .file-row`);
    const box = (await row.boundingBox())!;
    const lineHeight = Number(await row.evaluate((el) => parseFloat(el.ownerDocument.defaultView!.getComputedStyle(el).lineHeight)));
    assert.ok(box.height <= lineHeight + 8, `the row is one line (${box.height} against a ${lineHeight} line)`);
    // Truncated, not shortened: the element is narrower than the text it holds.
    // `.file-row > code`, as the tree test reads it: since `M240` `A` the landed file is marked
    // open and draws its outline under the row, whose names are `<code>` too.
    const code = fresh.locator(`[data-file="${deep}"] .file-row > code`);
    const { client, scroll } = await code.evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
    assert.ok(scroll > client, `the name is clipped rather than fitting (${scroll} into ${client})`);
    // And nothing is lost: the whole path is on the row and in the address. It is `data-tip` and
    // no longer `title` since `M216` `B3` — the hover is presented by the page now, and this row is
    // one of the few where the hover is AUTHORED rather than derived, because the row shows a leaf
    // name and the thing worth reading is the path it sits at, which is more than the ellipsis took.
    assert.equal(await row.getAttribute('data-tip'), deep);
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a folder collapses, and the address reopens it (`D1066` — expansion is inferred, never in the URL)', async () => {
  await page.goto(`${pageUrl}${API_DOOR}`);
  await page.reload();
  await page.locator('[data-files]').waitFor();
  const view = await fullProject();
  const nested = view.files.find((f) => f.path.includes('/'))!;
  const folder = nested.path.split('/')[0]!;

  assert.equal(await page.locator(`[data-dir-toggle="${folder}"]`).getAttribute('aria-expanded'), 'true', 'the tree opens whole — 84 rows is two screens, not a problem to fold away');
  await page.locator(`[data-dir-toggle="${folder}"]`).click();
  assert.equal(await page.locator(`[data-dir-toggle="${folder}"]`).getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator(`[data-file="${nested.path}"]`).count(), 0, 'a collapsed folder holds its files');
  // Collapsing is not in the address — that is the whole of `D1066`'s second half.
  assert.equal(new URL(page.url()).hash, API_DOOR);

  // And an address naming a file inside it wins: a link that cannot show what it names is broken.
  await page.goto(`${pageUrl}#/api/source/${nested.path}`);
  await page.locator(`[data-file="${nested.path}"]`).waitFor();
  assert.equal(await page.locator(`[data-dir-toggle="${folder}"]`).getAttribute('aria-expanded'), 'true');
});

// ---------------------------------------------------------------------------
// `M209` `S1` — the run strip: `env`, `workers` and the button that starts a run moved out of the
// sidebar and above the tabs (`M205` Q12, cut into a slice at last by `M209` §0).
//
// The claim is not *the controls exist* — they existed before, in the one pane that could not
// afford them. It is that they are reachable from **every** tab and **every** door, and that the
// sidebar no longer assembles a command, which is what frees it to become a file tree.
// ---------------------------------------------------------------------------

// **RESTATED BY `M229` `B` (`D1250`) RATHER THAN PATCHED, BECAUSE THAT ROUND MADE IT FALSE AS
// WRITTEN.** `workers` is no longer on every strip unconditionally — it is drawn when the run the
// button describes would reach a workload. This test still passes and its claim is unchanged,
// because nothing here narrows anything and `fixtures/project` holds `tests/load.tflw`; that
// dependency was silent, so it is asserted below rather than relied on. What the test is about is
// **reachability from every tab and every door**, which `D1250` does not touch — the strip is one
// strip and the sidebar assembles nothing, whatever the strip happens to be carrying.
test('the run strip carries env, workers and the button on all five tabs of all four doors, and the sidebar carries none of them', async () => {
  const doors = ['api', 'browser', 'load', 'scan'];
  const tabs = ['compose', 'source', 'run', 'auth', 'config'];
  for (const door of doors) {
    for (const tab of tabs) {
      const where = `#/${door}/${tab}`;
      await page.goto(`${baseUrl}${where}`);
      await page.locator(`[data-tabstrip="${tab}"]`).waitFor();
      const strip = page.locator('[data-runstrip]');
      await strip.waitFor();
      for (const control of ['[data-env-select]', '[data-workers]', '[data-run]']) {
        assert.equal(await strip.locator(control).count(), 1, `${control} is on ${where}`);
      }
      // ABOVE the tabs, which is the half of Q12 that a presence check cannot see. Read off
      // rectangles rather than off the DOM order: `PLAN_M23`'s carry is that a layout claim is
      // only a layout claim when something with a position answers it.
      const stripBox = (await strip.boundingBox())!;
      const tabsBox = (await page.locator(`[data-tabstrip="${tab}"]`).boundingBox())!;
      assert.ok(stripBox.y + stripBox.height <= tabsBox.y, `the strip sits above the tabs on ${where} (${stripBox.y} + ${stripBox.height} vs ${tabsBox.y})`);
      // And the sidebar has dropped the second job entirely.
      assert.equal(await page.locator('.sidebar-col [data-env-select], .sidebar-col [data-workers], .sidebar-col [data-run], .sidebar-col [data-cancel]').count(), 0, `the sidebar assembles no command on ${where}`);
    }
  }
});

// `M229` `B` (`D1250`) — a run-strip flag is earned by what the run holds, not granted by the door.
// This closes `M216-01` and the unfiled twin beside it.
test('`workers` and `headed` are drawn for the run the button describes, and the door is not what decides', async () => {
  // **The narrowing that no door-keyed rule survives is the third case.** A reader standing behind
  // the API door who selects the load file is about to run a workload — `run all` and a selection
  // alike ignore the door — so `--workers` is theirs. `PLAN_M229_UI_REVIEW.md` specified this as two
  // booleans on `VOCABULARY` read off the door, which would have hidden the flag that governs the
  // tests actually about to run; the plan is amended in place with the measurement.
  const read = async (hash: string): Promise<{ workers: number; headed: number; label: string }> => {
    await page.goto(`${baseUrl}${hash}`);
    await page.reload();
    await page.locator('[data-runstrip] [data-run]').waitFor();
    return {
      workers: await page.locator('[data-runstrip] [data-workers]').count(),
      headed: await page.locator('[data-runstrip] [data-headed]').count(),
      label: (await page.locator('[data-runstrip] [data-run]').textContent()) ?? '',
    };
  };

  // Unnarrowed: the fixture holds an `api`, a `browser` and a `load` file, so both are drawn — and
  // this is the reading that makes the three below mean something rather than being three empties.
  const all = await read('#/api/compose');
  assert.deepEqual([all.workers, all.headed, all.label], [1, 1, 'run all'], 'the unnarrowed run reaches every lens the fixture holds');

  // One API file: neither flag has a subject, so `D1082` removes both.
  const api = await read('#/api/compose?files=tests/catalog.tflw');
  assert.deepEqual([api.workers, api.headed], [0, 0], 'a run of one API file offers a workload flag and a browser flag');

  // **The load file, ON THE API DOOR.** A door-keyed rule is green on every case above and red
  // here, which is the whole of why this one is in the list.
  const load = await read('#/api/compose?files=tests/load.tflw');
  assert.deepEqual([load.workers, load.headed], [1, 0], '`--workers` did not follow the workload across the door');

  // …and its mirror, so the two are not one flag: the browser file on the LOAD door.
  const browser = await read('#/load/compose?files=tests/shop.tflw');
  assert.deepEqual([browser.workers, browser.headed], [0, 1], '`--headed` did not follow the browser across the door');
});

test("the narrowing is the explorer's gesture and the strip reads it back — one request across two panes", async () => {
  // **Reloaded, not merely navigated to.** `goto` to a URL that differs only in its fragment is a
  // fragment navigation and not a load, so the page keeps whatever React state the previous test
  // left behind — which here was a tag chip another test selected and never cleared. The first
  // draft of this test read `/^run all/`, which matches `run all · @load` perfectly well, and so
  // it passed on the wrong page. The assertion is an equality now for the same reason.
  await page.goto(`${pageUrl}${API_DOOR}`);
  await page.reload();
  await page.locator('[data-files]').waitFor();
  const run = page.locator('[data-runstrip] [data-run]');
  assert.equal(await run.textContent(), 'run all', 'nothing narrowed');
  const first = (await page.locator('[data-file-row]').first().getAttribute('data-file-row'))!;
  await page.locator(`[data-file-row="${first}"]`).click();
  assert.equal(await run.textContent(), 'run selection · 1 file', 'a file picked in the explorer reaches the button in the strip');
  // The strip survives the tab it was not mounted under: the request is the shell's, not a form's.
  await openTab('config');
  assert.equal(await page.locator('[data-runstrip] [data-run]').textContent(), 'run selection · 1 file');
  assert.equal(await page.locator('[data-runstrip] [data-run]').getAttribute('data-run-narrowing'), 'selection');
});

// ---------------------------------------------------------------------------
// `M209` `S5` — search. `D1064` (two kinds of query, and the page says which), `D1065` (names and
// tags now; endpoints deferred with a condition), `D1066`'s query half.
// ---------------------------------------------------------------------------

test('a tag query runs the tests carrying the tag, not the tests in the files carrying it', async () => {
  // **`D1064`'s whole case, graded against the run's own report.** On the sibling `@crud` is 59
  // tests in 16 files and those files hold 97, so a tree filtered to files and run whole would run
  // 38 tests nobody asked for. The fixture has the same shape in miniature, and the gate refuses to
  // run if it does not — a tag whose tests are ALL the tests in their files proves nothing here.
  const view = await fullProject();
  const tagged = (tag: string) => view.files.flatMap((f) => f.tests).filter((t) => t.tags.includes(tag));
  const inFilesOf = (tag: string) => view.files.filter((f) => f.tests.some((t) => t.tags.includes(tag))).flatMap((f) => f.tests);
  const tag = [...new Set(view.files.flatMap((f) => f.tests.flatMap((t) => t.tags)))].find((t) => tagged(t).length < inFilesOf(t).length);
  assert.ok(tag, 'the fixture holds a tag carried by fewer tests than the files carrying it hold');
  const expected = tagged(tag).map((t) => t.name).sort();
  assert.ok(expected.length < inFilesOf(tag).length, `${expected.length} tests against ${inFilesOf(tag).length} in the same files`);

  const fixtureServer = (await import(pathToFileURL(join(root, 'server.mjs')).href)) as { startFixtureServer: (port: number) => Promise<Server> };
  const target = await fixtureServer.startFixtureServer(fixturePort);
  try {
    await page.goto(`${pageUrl}${API_RUN}`);
    await page.reload();
    await page.locator('[data-search]').fill(`@${tag}`);
    assert.equal(await page.locator('[data-run]').getAttribute('data-run-narrowing'), 'tag');
    assert.equal(await page.locator('[data-run]').textContent(), `run @${tag}`);
    // one-shot: it is the baseline — the set of runs that existed *before* the click — so asking
    // again would not settle it, it would change what the comparison below means
    const before = new Set(((await (await api(`${baseUrl}/api/runs`)).json()) as { id: string }[]).map((r) => r.id));
    await page.locator('[data-run]').click();
    // The run is identified through `/api/runs` rather than by whatever `[data-report]` happens to
    // be selected: this file runs the project several times, so *the report that is not one of the
    // two fixtures* stopped being a unique description some tests ago.
    // Waited for at the server, not at the page: when a run ends the page swaps the live pane for
    // the report it kept, so every DOM landmark this could watch is one the page is in the middle
    // of replacing.
    /* `M235` `C2`'s first conversion, and it arrived here rather than in its own slice because
       `M234` `H`'s close-out tripped over it — `the run kept a directory`, on a run whose status
       had already reached `done`.

       **The loop below waited on `status` and then read `kept` one line later.** That is this
       suite's standing defect exactly (`M235` §4): a read after a wait does not retry, so the
       server marking a run finished a tick before it has named the directory reads as a null. The
       eleven-test census was measured by `A3`'s sweep; this is a twelfth, found by a different
       instrument, which is the argument for `C1`'s classifier rather than for more sweeping.

       The predicate is `untilMeasurable` and the two clauses are one fact: **a run in progress has
       no final state to read.** Its final state is `done` *and* a directory it kept. A run that
       never finishes, or finishes having kept nothing, spends the budget and fails the assertions
       below with the message it always had — which is what keeps this falsifiable. */
    const finished = await settle(
      async () => {
        const runs = (await (await api(`${baseUrl}/api/runs`)).json()) as { id: string; status: string; kept: string | null }[];
        return runs.find((r) => !before.has(r.id));
      },
      untilMeasurable(
        'the run has finished and named the directory it kept',
        (r) => r?.status === 'done' && typeof r.kept === 'string' && r.kept !== '',
      ),
      { attempts: 120, delayMs: 500, page },
    );
    const mine = finished.value;
    assert.equal(mine?.status, 'done', `the run finished (${finished.attempts} look(s))`);
    assert.ok(mine?.kept, `the run kept a directory (${finished.attempts} look(s), status ${mine?.status})`);
    const written = JSON.parse(await readFile(join(root, mine.kept, 'results.json'), 'utf8')) as RunReport;
    assert.deepEqual(written.tests.map((t) => t.name).sort(), expected, 'the run is the tag, not the files');
  } finally {
    target.close();
    await page.locator('[data-search]').fill('');
  }
});

test('the box says which of the two things a query is doing', async () => {
  await page.goto(`${pageUrl}${API_DOOR}`);
  await page.reload();
  await page.locator('[data-files]').waitFor();
  const view = await fullProject();
  const hint = page.locator('[data-search-hint]');
  const run = page.locator('[data-run]');

  // Nothing typed: the project's tags, offered.
  assert.equal(await hint.getAttribute('data-search-kind'), 'none');
  assert.equal(await page.locator('[data-file-row][data-match="all"]').count(), view.files.length, 'a query that narrows nothing is not a query that matches nothing');

  // A TAG query — narrows the tree and the run, and says what flag it will pass.
  const tag = [...new Set(view.files.flatMap((f) => f.tests.flatMap((t) => t.tags)))].sort()[0]!;
  const filesWithTag = view.files.filter((f) => f.tests.some((t) => t.tags.includes(tag)));
  const testsWithTag = view.files.flatMap((f) => f.tests).filter((t) => t.tags.includes(tag));
  await page.locator('[data-search]').fill(`@${tag}`);
  assert.equal(await hint.getAttribute('data-search-kind'), 'tag');
  assert.equal(await hint.textContent(), `${filesWithTag.length} file${filesWithTag.length === 1 ? '' : 's'} · runs --tag ${tag}: ${testsWithTag.length} test${testsWithTag.length === 1 ? '' : 's'}`);
  assert.equal(await page.locator('[data-file-row][data-match="yes"]').count(), filesWithTag.length);
  // Dimmed, not hidden (`D1063` a second time): every file is still on the screen.
  assert.equal(await page.locator('[data-file-row]').count(), view.files.length);
  // And **dimmed on the screen, not merely in a class** (`M209-02`). Search's dim is its own rule
  // because it is its own fact: *not what you searched for* is not *nothing behind this door*, and
  // a row absent from both questions should read as dim twice.
  const opacityOf = (sel: string) => page.locator(sel).first().evaluate((el) => Number(el.ownerDocument.defaultView!.getComputedStyle(el).opacity));
  assert.equal(await opacityOf('[data-file-row][data-match="yes"]'), 1, 'a match is at full strength');
  assert.ok((await opacityOf('[data-file-row][data-match="no"]')) < 0.6, 'and everything else is visibly not');

  // A TEXT query — narrows the tree only, and says so, because no flag matches a name.
  const named = view.files.find((f) => f.tests.length > 0)!.tests[0]!.name;
  const word = named.split(' ').find((w) => w.length > 5)!;
  const matching = view.files.filter((f) => f.path.toLowerCase().includes(word.toLowerCase()) || f.tests.some((t) => t.name.toLowerCase().includes(word.toLowerCase())) || f.crawls.some((c) => c.name.toLowerCase().includes(word.toLowerCase())));
  await page.locator('[data-search]').fill(word);
  assert.equal(await hint.getAttribute('data-search-kind'), 'text');
  assert.equal(await hint.textContent(), `${matching.length} file${matching.length === 1 ? '' : 's'} match — a name has no flag, so this runs whole files`);
  assert.equal(await run.getAttribute('data-run-narrowing'), 'text');
  assert.equal(await run.textContent(), `run ${matching.length} matching file${matching.length === 1 ? '' : 's'}`);

  // A tag nobody carries: said out loud, and there is nothing to press. A search box that quietly
  // ran the whole suite is the failure this refuses.
  await page.locator('[data-search]').fill('@zzzznosuchtag');
  assert.equal(await hint.textContent(), 'no tag starts with @zzzznosuchtag — nothing to run');
  assert.equal(await run.textContent(), 'nothing matches @zzzznosuchtag');
  assert.equal(await run.isDisabled(), true);
  await page.locator('[data-search]').fill('');
});

test('a tag query matches by prefix and expands to the project’s own tags — `--tag a,b` is OR', async () => {
  await page.goto(`${pageUrl}${API_DOOR}`);
  await page.reload();
  await page.locator('[data-files]').waitFor();
  const view = await fullProject();
  const tags = [...new Set(view.files.flatMap((f) => f.tests.flatMap((t) => t.tags)))].sort();
  // A prefix two of the fixture's tags share, found rather than assumed.
  const prefix = tags.map((t) => t.slice(0, 1)).find((p) => tags.filter((t) => t.startsWith(p)).length > 1);
  assert.ok(prefix, 'the fixture has two tags sharing a first letter');
  const expanded = tags.filter((t) => t.startsWith(prefix));
  await page.locator('[data-search]').fill(`@${prefix}`);
  // Every tag it passes exists in the project, which is what keeps the request legal: `--tag nope`
  // is an error in the CLI, so expanding against the project's own tags is not a convenience.
  assert.equal(await page.locator('[data-run]').textContent(), `run ${expanded.map((t) => `@${t}`).join(' ')}`);
  assert.match((await page.locator('[data-search-hint]').textContent())!, new RegExp(`runs --tag ${expanded.join(',')}:`));
  await page.locator('[data-search]').fill('');
});

test('the query is in the address, and a reload reproduces it and the button', async () => {
  await page.goto(`${pageUrl}${API_DOOR}`);
  await page.reload();
  await page.locator('[data-files]').waitFor();
  const view = await fullProject();
  const tag = [...new Set(view.files.flatMap((f) => f.tests.flatMap((t) => t.tags)))].sort()[0]!;
  await page.locator('[data-search]').fill(`@${tag}`);
  // `M235` `C2` — the census's worst site, 10 of 56 sweep runs. `fill()` resolves when the input's
  // value is set; the router writes the query into the hash on a *later* effect, so reading
  // `page.url()` on the next line samples an address that does not carry the query yet. It is not
  // even a read after a wait — there is no wait here to accuse, only the assumption that the
  // address is a synchronous consequence of typing.
  //
  // The predicate is *a* query and the assertion is *the* query, which is `M141`'s rule made
  // concrete: a router that wrote `q=wrong` satisfies the wait on the first look and fails the
  // assertion exactly as a single read would have.
  const addressed = await settle(
    async () => page.url(),
    untilMeasurable('the router has written a query into the address', (u) => /[?&]q=/.test(new URL(u).hash)),
    { attempts: 60, delayMs: 50, page },
  );
  const link = addressed.value;
  assert.match(
    new URL(link).hash,
    new RegExp(`[?&]q=%40${tag}`),
    `the address carries the query that was typed (${addressed.attempts} look(s), hash ${new URL(link).hash})`,
  );

  const fresh = await newPage();
  try {
    await fresh.goto(link);
    await fresh.locator('[data-files]').waitFor();
    assert.equal(await fresh.locator('[data-search]').inputValue(), `@${tag}`);
    assert.equal(await fresh.locator('[data-run]').textContent(), `run @${tag}`);
  } finally {
    await fresh.close();
  }

  // The selection and the query ride together, and neither moves the file the tabs face.
  const first = (await page.locator('[data-file-row]').first().getAttribute('data-file-row'))!;
  await page.locator(`[data-file-row="${first}"]`).click();
  // Same shape, same reason: the click writes the selection into the address on a later effect.
  const selected = await settle(
    async () => page.url(),
    untilMeasurable('the selection has reached the address', (u) => /[?&]files=/.test(new URL(u).hash)),
    { attempts: 60, delayMs: 50, page },
  );
  assert.match(
    new URL(selected.value).hash,
    /\?files=[^&]+&q=/,
    `the selection and the query ride together (${selected.attempts} look(s), hash ${new URL(selected.value).hash})`,
  );
  assert.equal(await page.locator('[data-run]').getAttribute('data-run-narrowing'), 'selection', 'an explicit selection outranks a query');
  await page.locator('[data-search]').fill('');
});

// ---------------------------------------------------------------------------
// `M209` `S4` — open and select. `M205` Q7 (the explorer names the file), Q13 (selection replaces
// the checkboxes), Q13a (click opens AND selects; cmd/shift extend without moving the subject),
// `D1066` (the selection is in the address), `D1069` (a folder means its files).
//
// Driven by a REAL browser with real pointer events, which is why this gate lives here and not in
// a jsdom suite: `PLAN_SELECT`'s carry is that a synthetic `click` without the `pointerdown` a
// mouse sends first hides exactly this class of defect, and 620 unit tests could not see it.
// ---------------------------------------------------------------------------

/** What the explorer says is selected, in tree order. */
const selectedFiles = (p: Page): Promise<string[]> =>
  p.locator('[data-file-row][data-selected="yes"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-file-row')!));

test('a click opens and selects; cmd extends by one and shift by a range, and neither moves the subject', async () => {
  await page.goto(`${pageUrl}${API_DOOR}`);
  await page.reload();
  await page.locator('[data-files]').waitFor();
  const rows = await page.locator('[data-file-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-file-row')!));
  assert.ok(rows.length >= 4, 'the fixture has enough files to range over');

  // 1. A plain click is the whole gesture (`Q13a`): the tabs face it and it is the selection.
  await page.locator(`[data-file-row="${rows[0]}"]`).click();
  assert.deepEqual(await selectedFiles(page), [rows[0]]);
  assert.equal(await page.locator(`[data-file-row="${rows[0]}"]`).getAttribute('data-open'), 'yes');
  assert.ok(new URL(page.url()).hash.startsWith(`#/api/compose/${rows[0]}?`), `the address names the file it opened (${new URL(page.url()).hash})`);

  // 2. `cmd` extends by one and DOES NOT move the subject — the half a checkbox could never have
  //    said, and the half a click that also opened would have broken.
  await page.locator(`[data-file-row="${rows[2]}"]`).click({ modifiers: ['ControlOrMeta'] });
  assert.deepEqual(await selectedFiles(page), [rows[0], rows[2]]);
  assert.equal(await page.locator(`[data-file-row="${rows[0]}"]`).getAttribute('data-open'), 'yes', 'the tabs still face the file they were facing');
  assert.equal(await page.locator(`[data-file-row="${rows[2]}"]`).getAttribute('data-open'), 'no');

  // 3. `cmd` again takes it back out — one gesture, both directions.
  await page.locator(`[data-file-row="${rows[2]}"]`).click({ modifiers: ['ControlOrMeta'] });
  assert.deepEqual(await selectedFiles(page), [rows[0]]);

  // 4. `shift` is a range in TREE order, and the order is the tree's rather than the clicking's.
  await page.locator(`[data-file-row="${rows[0]}"]`).click();
  await page.locator(`[data-file-row="${rows[3]}"]`).click({ modifiers: ['Shift'] });
  assert.deepEqual(await selectedFiles(page), rows.slice(0, 4));
  assert.equal(await page.locator(`[data-file-row="${rows[0]}"]`).getAttribute('data-open'), 'yes', 'a range does not move the subject either');
  assert.equal(await page.locator('[data-runstrip] [data-run]').textContent(), 'run selection · 4 files');

  // 5. And a plain click collapses it back to one — the gesture that starts over.
  await page.locator(`[data-file-row="${rows[1]}"]`).click();
  assert.deepEqual(await selectedFiles(page), [rows[1]]);
});

test('the selection is in the address, and a reload reproduces it and the button', async () => {
  await page.goto(`${pageUrl}${API_DOOR}`);
  await page.reload();
  await page.locator('[data-files]').waitFor();
  const rows = await page.locator('[data-file-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-file-row')!));
  await page.locator(`[data-file-row="${rows[0]}"]`).click();
  await page.locator(`[data-file-row="${rows[2]}"]`).click({ modifiers: ['ControlOrMeta'] });
  const link = page.url();
  assert.match(new URL(link).hash, /\?files=/);

  // `D1066`'s whole point: a link reproduces a run, and a reload never silently empties the button.
  const fresh = await newPage();
  try {
    await fresh.goto(link);
    await fresh.locator('[data-files]').waitFor();
    assert.deepEqual(await selectedFiles(fresh), [rows[0], rows[2]]);
    assert.equal(await fresh.locator('[data-runstrip] [data-run]').textContent(), 'run selection · 2 files');
  } finally {
    await fresh.close();
  }

  // Expansion is NOT in it (`D1066`) — folding a folder leaves the address alone.
  const folder = (await page.locator('[data-dir-toggle]').first().getAttribute('data-dir-toggle'))!;
  await page.locator(`[data-dir-toggle="${folder}"]`).click();
  assert.equal(page.url(), link, 'a disclosure click is not a change to what runs');
  await page.locator(`[data-dir-toggle="${folder}"]`).click();

  // And an address with nothing selected is byte-identical to every link written before `S4`.
  await page.goto(`${pageUrl}#/api/compose/${rows[0]}`);
  await page.locator('[data-files]').waitFor();
  assert.deepEqual(await selectedFiles(page), []);
  assert.equal(await page.locator('[data-runstrip] [data-run]').textContent(), 'run all');
});

test('a folder means its files (`D1069`) — plain click folds, cmd-click selects what is under it', async () => {
  await page.goto(`${pageUrl}${API_DOOR}`);
  await page.reload();
  await page.locator('[data-files]').waitFor();
  const view = await fullProject();
  const folder = (await page.locator('[data-dir-toggle]').first().getAttribute('data-dir-toggle'))!;
  const under = view.files.filter((f) => f.path.startsWith(`${folder}/`)).map((f) => f.path);
  assert.ok(under.length > 1, 'the folder holds more than one file, or this proves nothing');

  await page.locator(`[data-dir-toggle="${folder}"]`).click({ modifiers: ['ControlOrMeta'] });
  assert.deepEqual([...(await selectedFiles(page))].sort(), [...under].sort(), 'the files, expanded by the page — `tflw run` refuses a directory');
  assert.equal(await page.locator(`[data-dir-toggle="${folder}"]`).getAttribute('aria-expanded'), 'true', 'and selecting is not folding');
  // The request carries files and never the folder.
  assert.match(new URL(page.url()).hash, /\?files=/);
  assert.doesNotMatch(new URL(page.url()).hash, new RegExp(`files=${folder}(,|$)`));

  await page.locator(`[data-dir-toggle="${folder}"]`).click({ modifiers: ['ControlOrMeta'] });
  assert.deepEqual(await selectedFiles(page), [], 'and it takes them back out again');
});

// ---------------------------------------------------------------------------
// `M213` `S2` — the response, at two scopes, and the tick that turns it into an assertion
// (`D1099`, `D1100`, `D1093`, `D1108`).
//
// **THE FIXTURE IS THE ORACLE AND IT IS NOT A CONTRIVANCE.** `packages/ui/fixtures/reports/full`
// is what `tflw run` actually wrote over `packages/ui/fixtures/project`, so the report's
// `StepResult.line` and `StepResult.source` are the real file's, and the join under test is the
// join the app will do on a user's project. Nothing here writes a report by hand.
// ---------------------------------------------------------------------------

/** Open `tests/catalog.tflw` in API Compose, pointed at the request on `line`. */
/**
 * The bytes a door is holding, read from **Source** — `M213` `S6`.
 *
 * `D1052`'s claim is *what is shown is what is written*, and until this slice each form showed its
 * own `<pre>` of the pending text. `S6` replaced LOAD's with the plot (`D1103`), because this
 * door's question is not *what will be written* — Source has answered that for every door since
 * `M210` — but **what shape of work is that**. So the claim survives with one subject instead of
 * four, which is stronger: the bytes are shown in the one place every door shows them.
 */
const pendingBytes = async (p: Page): Promise<string> => {
  await p.locator('[data-tab="source"]').click();
  await p.locator('[data-tabstrip="source"]').waitFor();
  const text = (await p.locator('[data-preview]').textContent()) ?? '';
  await p.locator('[data-tab="compose"]').click();
  await p.locator('[data-tabstrip="compose"]').waitFor();
  return text;
};

const composeAt = async (file: string, line: number): Promise<void> => {
  await page.goto(`${pageUrl}#/api/compose/${file}/L${line}`);
  await page.reload();
  await page.locator('[data-doorbar="api"]').waitFor();
  await page.locator(`[data-seq-open="${line}"]`).waitFor();
};

/**
 * …and then wait for the **last run** to arrive, which is a second thing (`D1099`).
 *
 * The pane renders the file as soon as the file is read; the report is a separate fetch, so a
 * `count()` taken the moment the request card exists reads a pane that has not been told anything
 * yet. `count()` does not retry — that is the whole of this helper. It was a genuine flake in
 * `S2`'s own gate, passing on ordering rather than on behaviour, and it surfaced when `S4` changed
 * what ran before it.
 */
const composeRan = async (file: string, line: number): Promise<void> => {
  await composeAt(file, line);
  await page.locator(`[data-seq-open="${line}"] [data-compose-response]`).waitFor();
};

/**
 * **The report the pane is ACTUALLY reading for this file** — `D1099`'s own rule, resolved the
 * same way the page resolves it: the newest run on disk whose `results.json` lists the file.
 *
 * `M234` `A` (`D1308`), and this is a defect in the gate rather than a flake. This file's very
 * first line says *"the report directory is the oracle, never a number written in this file"* —
 * and the test below was reading `oracle.full`, the COMMITTED fixture, while the pane had long
 * since moved on. `before()` stamps `full` newest with one `utimes` precisely so *which report the
 * pane shows* is not a filesystem race; what nobody noticed is that an earlier test **runs the
 * project for real** (`--tag @catalog`, and it keeps its directory), which makes that live run
 * newer than the stamp. From that test onward the pane draws the live run's verdicts for
 * `catalog.tflw` and the gate compares them against frozen ones.
 *
 * It passed for as long as it has because the two agree on an idle machine: `expect status equals
 * 200` is recorded at **0 ms** in the fixture and also takes 0 ms live. Under load it takes 1, and
 * the gate reports `'1' !== '0'` — which is what Node 22 did in CI, and what a 12-way-loaded box
 * reproduces exactly: **fails in the whole file, passes in isolation under the same load.**
 *
 * So the oracle is not pinned to a directory name — it is asked for, by the same rule the page
 * uses. A number written in this file was never the alternative.
 */
const reportShowing = async (file: string): Promise<RunReport> => {
  const runs = join(root, 'report', 'runs');
  let best: { at: number; report: RunReport } | null = null;
  for (const id of await readdir(runs)) {
    const results = join(runs, id, 'results.json');
    let at: number;
    try {
      at = (await stat(results)).mtimeMs;
    } catch {
      continue; // a run that kept no report — `--workers 0` leaves a row and no directory.
    }
    const report = JSON.parse(await readFile(results, 'utf8')) as RunReport;
    if (!report.tests.some((t) => t.file === file)) continue;
    if (best === null || at > best.at) best = { at, report };
  }
  assert.ok(best !== null, `no report on disk holds ${file} — the pane could not be showing one either`);
  return best.report;
};

test('`M213` `S2`: a file that has run shows its last response on every request, with no run and no press (`D1099`)', async () => {
  await composeRan('tests/catalog.tflw', 3);
  // The selected request's own response — the disclosure, closed, carrying the three facts.
  const chip = page.locator('[data-seq-open="3"] [data-compose-response]');
  assert.equal(await chip.count(), 1, 'the response is there before anything was pressed');
  assert.equal(await chip.getAttribute('data-compose-response-scope'), 'run', 'and it says it came from the last run, not from a send');
  assert.equal(await chip.locator('[data-compose-response-status]').textContent(), '200');
  assert.match((await chip.locator('[data-compose-response-when]').textContent())!, /from the last run/);
  // **`M214` `A5` (`D1116`) REPLACED `D1109`'s DISCLOSURE, AND THIS IS THE ASSERTION THAT FLIPPED.**
  // The chip was closed at rest because a response drawn open on every request is what put the old
  // pane over its height bar — a bar `M214` retired, because the thing it was holding (*every
  // request drawn* AND *1.50 screens*) could not both be true on the file `D1086` measures. The
  // response now has a **region**, under the editor behind a draggable divider, and it is open:
  // ticking a value writes into the Assert tab directly above it, which is the whole reason the two
  // are in one column. What `D1109` was right about is kept above — the scope is still said.
  assert.equal(
    await page.locator('[data-seq-open="3"] [data-compose-response-panel]').evaluate((el) => el.checkVisibility()),
    true,
    'the response is drawn, in its own region, with nothing to press first',
  );
  // …and it is under the editor rather than inside it, which is what the divider divides.
  const order = await page.locator('[data-seq-open="3"]').evaluate((col) => {
    const editor = col.querySelector('.editor')!.getBoundingClientRect();
    const response = col.querySelector('.responsebox')!.getBoundingClientRect();
    return { editorBottom: Math.round(editor.bottom), responseTop: Math.round(response.top), split: col.querySelectorAll('[data-compose-split]').length };
  });
  assert.equal(order.split, 1, 'there is exactly one divider between them');
  assert.ok(order.responseTop >= order.editorBottom - 1, `the response is below the editor — editor ends ${order.editorBottom}, response starts ${order.responseTop}`);

  // And the OTHER request in the same test — the one nothing is pointed at — carries its status
  // too. That is the half a send could never give you.
  assert.equal(await page.locator('[data-seq-request="8"] [data-seq-status]').textContent(), '200');
});

test('`M213` `S2`: every verdict the report holds is beside the statement it is about, with its own duration (`D1093`)', async () => {
  await composeRan('tests/catalog.tflw', 3);
  const marks = page.locator('[data-seq-open="3"] [data-verdict]');
  /* `M235` `C2` — the wait is for *a* verdict and the claim is for *two*, which is `M141`'s split:
     no verdicts at all is a pane that has not painted its grades, and that is unreadable rather
     than a small number. A page that settles on one verdict returns on the first look and fails
     the assertion, exactly as a single read would have. */
  const graded = await settle(
    () => marks.count(),
    untilMeasurable('the graded verdicts have painted', (n) => n > 0),
    { attempts: 40, delayMs: 50, page },
  );
  assert.ok(graded.value >= 2, `the request on line 3 has assertions and the run graded them (${graded.value} after ${graded.attempts} look(s))`);
  // The report's own sentence, not a second one written by the page — and the report the PANE is
  // reading, not the one this file copied in (`M234` `A`, `D1308`; see `reportShowing` above).
  const report = await reportShowing('tests/catalog.tflw');
  const step = report.tests
    .filter((t): t is Extract<typeof t, { kind: 'functional' }> => t.kind === 'functional')
    .find((t) => t.file === 'tests/catalog.tflw')!
    .steps.find((x) => x.line === 4)!;
  /* `M234` `A` — ONE READ OF ONE ELEMENT (`D1308`). The two facts below were two round trips
     through `marks.first()`, and a locator re-resolves on every use: the pane redraws, the second
     `first()` is a different mark from the first, and the sentence then describes line 4's step
     while the duration comes off another one. That is not a hypothetical — Node 22 failed here
     with `'1' !== '0'` under a message quoting a row whose text had just matched, which is only
     possible if the two reads saw two elements. The oracle is the committed `results.json` both
     the page and this file read, so the two can never legitimately disagree. */
  const mark = await marks.first().evaluate((el) => ({
    text: el.textContent ?? '',
    ms: el.querySelector('[data-verdict-ms]')?.getAttribute('data-verdict-ms') ?? null,
  }));
  assert.ok(mark.text.includes(step.detail!), `the row says what the run said — ${JSON.stringify(step.detail)} in ${JSON.stringify(mark.text)}`);
  // Read off the attribute rather than out of the sentence: a substring match on a number is a
  // match on any row whose text happens to contain it.
  assert.equal(
    mark.ms,
    String(step.durationMs),
    `and how long it took, which \`StepResult\` has carried all along — row read ${JSON.stringify(mark.text)}`,
  );
});

test('`M213` `S2`: typing into an assertion drops ITS verdict and leaves every other one standing (`D1108`)', async () => {
  await composeRan('tests/catalog.tflw', 3);
  const before = await page.locator('[data-seq-open="3"] [data-verdict]').count();
  assert.ok(before >= 2);

  // Edit the FIRST assertion's operand. Its own mark must go; the one under it must not.
  const operand = page.locator('[data-seq-open="3"] [data-expect-operand]').first();
  await operand.fill('204');
  await page.locator('[data-compose-dirty]').waitFor();
  const after = await page.locator('[data-seq-open="3"] [data-verdict]').count();
  assert.equal(after, before - 1, 'exactly one mark went — the row that was typed into');

  // And the request itself is untouched, so the response it fetched is still evidence about it.
  assert.equal(await page.locator('[data-seq-open="3"] [data-compose-response]').count(), 1);
});

test('`M213` `S2`: one tick writes a path assertion, under the request it is about (`D1100`)', async () => {
  await composeRan('tests/catalog.tflw', 8);
  await page.locator('[data-seq-open="8"] [data-compose-response]').click();
  const panel = page.locator('[data-seq-open="8"] [data-compose-response-panel]');
  /* `price` rather than `name`, deliberately: the fixture already asserts `body.name` on this
     request, so ticking it would write a line the file already has and the test could not tell a
     correct insertion from no insertion at all. `expect body.price equals 12` occurs nowhere in
     this file — the other `price` assertion in it reads `10`, on a different item. */
  const tick = panel.locator('[data-tick="price"]');
  assert.equal(await tick.count(), 1, 'every scalar in the response is a path you can point at');
  await tick.check();
  assert.equal(await panel.locator('[data-compose-verify-preview]').textContent(), 'expect body.price equals 12');
  await panel.locator('[data-compose-verify]').click();

  // It landed under the request it was ticked on, and the file says so.
  await page.locator('[data-tab="source"]').click();
  await page.locator('[data-tabstrip="source"]').waitFor();
  const text = (await page.locator('[data-preview]').textContent())!;
  const lines = text.split('\n').map((l) => l.trim());
  const at = lines.indexOf('expect body.price equals 12');
  assert.ok(at > 0, `the assertion is in the buffer:\n${text}`);
  /* **AND IT IS AT THE FOOT OF *THIS* REQUEST, NOT AT THE FOOT OF THE TEST** — which here are the
     same line, because the ticked request is the test's last. So the claim that separates
     `stepsAfter` from `steps` is made by the line above it: the run of statements that already
     read this response, and not `log "first item is {firstId}"`, which is what appending would
     have put it under if the anchor had been the body rather than the request. */
  assert.equal(lines[at - 1], 'expect body.name equals "widget"', 'under the statements that already read this request');
});

test('`M213` `S2`: several ticks write ONE `matches subset`, and a subset ignores what was not ticked', async () => {
  await composeRan('tests/catalog.tflw', 8);
  await page.locator('[data-seq-open="8"] [data-compose-response]').click();
  const panel = page.locator('[data-seq-open="8"] [data-compose-response-panel]');
  const paths = await panel.locator('[data-tick]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tick')));
  assert.ok(paths.length >= 2, `the fixture response has several fields: ${paths.join(', ')}`);
  for (const p of paths.slice(0, 2)) await panel.locator(`[data-tick="${p}"]`).check();
  const preview = (await panel.locator('[data-compose-verify-preview]').textContent())!;
  assert.match(preview, /^expect body matches subset \{/, 'two ticks are one subset, never two assertions');
  for (const p of paths.slice(0, 2)) assert.ok(preview.includes(p!.split('.').pop()!), `${p} is in the subset`);
  // The third field is not — which is the property that makes this safe to generate: a test
  // written this way does not break when the API gains a field.
  if (paths.length > 2) assert.ok(!preview.includes(`"${paths[2]}"`), 'what was not ticked is not asserted');
});

// ---------------------------------------------------------------------------
// `M213` `S3` — the chaining core (`D1102`): *sign in → capture the token → authed call → assert*.
//
// **WHAT `D1102` NAMED AND WHAT IS ACTUALLY BUILDABLE ARE NOT THE SAME LIST, AND `§1.7` IS WHERE
// THAT IS RECORDED** (`M213-20`). `header` and `csrf` are **session-body** statements:
// `parser.ts:1833` dispatches them from `parseSessionBlock` alone and `parseStep` never offers
// either, so neither can appear in a test body at all. `header`'s other form — a clause on one
// `api` step — has been authorable since `M212` `S3`. So the three this slice adds are `capture`,
// `let` and `wait until api`, and the chain closes with the request-header clause that already
// existed.
// ---------------------------------------------------------------------------

test('`M213` `S3`: a ticked value becomes a `capture`, bound by the name the response already gives it', async () => {
  await composeRan('tests/catalog.tflw', 8);
  await page.locator('[data-seq-open="8"] [data-compose-response]').click();
  const panel = page.locator('[data-seq-open="8"] [data-compose-response-panel]');
  await panel.locator('[data-tick="id"]').check();
  await panel.locator('[data-compose-capture]').click();

  await page.locator('[data-tab="source"]').click();
  await page.locator('[data-tabstrip="source"]').waitFor();
  const lines = (await page.locator('[data-preview]').textContent())!.split('\n').map((l) => l.trim());
  const at = lines.indexOf('capture body.id as id');
  assert.ok(at > 0, `the capture is in the buffer:\n${lines.join('\n')}`);
  // Under the request it was read out of — `body` means the last response, so a capture below a
  // later request binds out of a different one.
  assert.equal(lines[at - 1], 'expect body.name equals "widget"');
});

test('`M213` `S3`: several ticks are several captures in ONE edit — a capture binds one name to one value', async () => {
  await composeRan('tests/catalog.tflw', 8);
  await page.locator('[data-seq-open="8"] [data-compose-response]').click();
  const panel = page.locator('[data-seq-open="8"] [data-compose-response-panel]');
  await panel.locator('[data-tick="id"]').check();
  await panel.locator('[data-tick="price"]').check();
  // The button says what it will bind, before it binds it — the same rule the verify preview follows.
  assert.match((await panel.locator('[data-compose-capture]').textContent())!, /id, price/);
  await panel.locator('[data-compose-capture]').click();

  await page.locator('[data-tab="source"]').click();
  await page.locator('[data-tabstrip="source"]').waitFor();
  const lines = (await page.locator('[data-preview]').textContent())!.split('\n').map((l) => l.trim());
  assert.ok(lines.includes('capture body.id as id'));
  assert.ok(lines.includes('capture body.price as price'));
  assert.equal(lines.indexOf('capture body.price as price'), lines.indexOf('capture body.id as id') + 1, 'in the order they were ticked, adjacent');
});

test('`M213` `S3`: `+ let` writes a binding at the TOP of the body, where the requests that read it can', async () => {
  await composeAt('tests/catalog.tflw', 3);
  await page.locator('[data-seq-add="let"]').first().click();
  await page.locator('[data-tab="source"]').click();
  await page.locator('[data-tabstrip="source"]').waitFor();
  const lines = (await page.locator('[data-preview]').textContent())!.split('\n').map((l) => l.trim());
  const at = lines.findIndex((l) => l.startsWith('let value ='));
  assert.ok(at > 0, `the binding is in the buffer:\n${lines.join('\n')}`);
  assert.match(lines[at - 1]!, /^test "lists the catalog/, 'directly under the declaration, above every request');
});

test('`M213` `S3`: `+ wait until` writes a poll with an assertion in it — the block, not a bare request', async () => {
  await composeAt('tests/catalog.tflw', 3);
  await page.locator('[data-seq-add="wait"]').first().click();
  await page.locator('[data-tab="source"]').click();
  await page.locator('[data-tabstrip="source"]').waitFor();
  const text = (await page.locator('[data-preview]').textContent())!;
  assert.match(text, /^ {2}wait until api GET \/$/m);
  // **The assertion is what makes it a poll rather than a sleep**, and the builder refuses one
  // without it — so a default carrying none would be a button that writes nothing.
  assert.match(text, /^ {4}expect status equals 200$/m);
});

/* **The send scope is asserted where `M210` `S6` already asserts it**, at the foot of this file,
   and not here — because a send is a *run*, and a run from this shared fixture writes a report
   into the shared project. The first draft of this section pressed `send` on the fixture and
   reddened a LOAD test 180 tests later, whose own subject is the height of a Run pane showing
   whatever report the project last kept. `S6`'s test builds its own project in a temp directory
   for exactly that reason; the scope claim was added to it rather than duplicated here. */

test('Compose has no `file` control on any door — the explorer names the file (`M205` Q7)', async () => {
  for (const [door, attr] of [['api', 'data-api-file'], ['browser', 'data-browser-file'], ['load', 'data-load-file'], ['scan', 'data-scan-file']]) {
    await page.goto(`${pageUrl}#/${door}`);
    await page.locator(`[data-doorbar="${door}"]`).waitFor();
    assert.equal(await page.locator(`[${attr}]`).count(), 0, `${door}'s Compose no longer states the file a second time`);
  }
  // And the one control that does name it still works: a click in the explorer opens the file, and
  // the pane's own head says which file it is about. `M212` `S4b` retired the form whose write
  // button used to carry that name, so the claim is read off the head — which is where it has to
  // be true anyway, since the write button only exists while there is something to write.
  const view = await fullProject();
  const target = view.files.find((f) => f.tests.length > 0)!.path;
  await page.goto(`${pageUrl}#/api`);
  await page.locator('[data-files]').waitFor();
  await page.locator(`[data-file-row="${target}"]`).click();
  await page.locator('[data-compose-summary]').waitFor();
  assert.equal(await page.locator('[data-compose-file]').first().textContent(), target);
});

// ---------------------------------------------------------------------------
// `M200` `A0-3` — the shell: four doors, a lens derived from constructs, a switcher.
// Graded against `GET /api/project`, which carries the derivation the server computed with
// `@tflw/lang`'s own function — never against a number written in this file.
// ---------------------------------------------------------------------------

/** The project as the server derived it, used as this section's oracle. */
async function projectView(): Promise<{ files: { path: string; tests: { name: string; lenses: string[] }[]; crawls: { name: string; lenses: string[] }[] }[] }> {
  return (await (await api(`${baseUrl}/api/project`)).json()) as never;
}

test('the landing is four doors, each counting what is actually behind it', async () => {
  await page.goto(pageUrl);
  await page.locator('[data-landing]').waitFor();
  const view = await projectView();
  const expected: Record<string, number> = { api: 0, browser: 0, load: 0, scan: 0 };
  for (const f of view.files) {
    for (const t of f.tests) for (const l of t.lenses) expected[l] = (expected[l] ?? 0) + 1;
    for (const c of f.crawls) for (const l of c.lenses) expected[l] = (expected[l] ?? 0) + 1;
  }
  assert.deepEqual((await page.locator('[data-door]').evaluateAll((els) => els.map((e) => e.getAttribute('data-door')))), ['api', 'browser', 'load', 'scan']);
  for (const [id, n] of Object.entries(expected)) {
    assert.equal(await page.locator(`[data-door="${id}"]`).getAttribute('data-door-count'), String(n), `the ${id} door's count`);
  }
  // The fixture exercises all four derivations, which is what makes the assertion above mean
  // something: three doors with a zero would pass a count that was always zero.
  // Read through a helper rather than as properties: `expected` is a `Record<string, number>` and
  // `noUncheckedIndexedAccess` types every lookup on one as possibly `undefined`, which is right —
  // the keys come from lens derivation, not from a closed union.
  const seen = (door: string): number => expected[door] ?? 0;
  assert.ok(
    seen('api') > 0 && seen('browser') > 0 && seen('load') > 0 && seen('scan') > 0,
    `the fixture must exercise every door: ${JSON.stringify(expected)}`,
  );
});

test('a door opens the project, and the URL is the only place the choice lives', async () => {
  await page.goto(pageUrl);
  await page.locator('[data-door="load"]').click();
  await page.locator('[data-files]').waitFor();
  assert.equal(new URL(page.url()).hash, '#/load');
  assert.equal(await page.locator('[data-doorbar]').getAttribute('data-doorbar'), 'load');

  // The back button works, because the hash is the state.
  await page.goBack();
  await page.locator('[data-landing]').waitFor();

  // And a pasted link opens where it says, with nothing remembered from the visit above.
  await page.goto(`${pageUrl}#/scan`);
  await page.locator('[data-files]').waitFor();
  assert.equal(await page.locator('[data-doorbar]').getAttribute('data-doorbar'), 'scan');
});

test('the door narrows the count and never the test — a test behind two doors is listed in its file under both', async () => {
  const view = await projectView();
  const multi = view.files.flatMap((f) => f.tests.map((t) => ({ path: f.path, ...t }))).filter((t) => t.lenses.length > 1);
  assert.ok(multi.length > 0, 'the fixture must hold a multi-lens test — D1043’s whole case');

  // **The instrument moved with `M209` `S3`.** A test row is in Source's index now, not in the
  // sidebar, because the sidebar's rows are files. The claim is unchanged: a test behind three
  // doors is reachable behind all three, carrying its whole derivation and naming the others.
  for (const test_ of multi) {
    for (const lens of test_.lenses) {
      await page.goto(`${pageUrl}#/${lens}/source/${test_.path}`);
      const item = page.locator(`[data-source-test="${test_.name}"]`);
      await item.waitFor();
      assert.equal(await item.getAttribute('data-test-lenses'), test_.lenses.join(' '), `${test_.name} carries its whole derivation behind ${lens}`);
      assert.equal(await item.getAttribute('data-test-here'), 'yes');
      for (const other of test_.lenses.filter((l) => l !== lens)) {
        assert.equal(await item.locator(`[data-also="${other}"]`).count(), 1, `${test_.name} names its ${other} door while in ${lens}`);
      }
      // And the file's own row counts it behind this door — the door's only mark on the tree.
      const row = page.locator(`[data-file="${test_.path}"] [data-door-count]`);
      assert.equal(await row.getAttribute('data-door-count-state'), 'some');
      assert.ok(Number(await row.getAttribute('data-door-count')) >= 1);
    }
  }
});

test('the derivation is about constructs, not tags — the page shows it where the tag disagrees', async () => {
  // `security.tflw`'s tests carry `@security` AND an `api` step, so they are behind API as well.
  // `shop.tflw`'s carry no such tag and are behind BROWSER. If the page were reading tags, the
  // first would count zero behind API and the second zero behind BROWSER.
  const view = await fullProject();
  const tagged = view.files.find((f) => f.path.endsWith('security.tflw'));
  assert.ok(tagged, 'the fixture has security.tflw');
  await page.goto(`${pageUrl}#/api/source/${tagged.path}`);
  await page.locator('[data-test-index]').waitFor();
  for (const t of tagged.tests) {
    const row = page.locator(`[data-source-test="${t.name}"]`);
    assert.equal(await row.count(), 1, `${t.name} is indexed`);
    assert.equal(await row.getAttribute('data-test-here'), 'yes', `${t.name} is behind API because it makes a request, whatever its tag says`);
  }
  const count = page.locator(`[data-file="${tagged.path}"] [data-door-count]`);
  assert.equal(await count.getAttribute('data-door-count'), String(tagged.tests.length), 'and the tree counts every one of them behind API');
});

test('the switcher moves between doors without leaving the project', async () => {
  await page.goto(`${pageUrl}#/api`);
  await page.locator('[data-doorbar]').waitFor();
  const view = await projectView();
  const browserOnly = view.files.find((f) => f.tests.length > 0 && f.tests.every((t) => t.lenses.includes('browser') && !t.lenses.includes('api')));
  assert.ok(browserOnly, 'the fixture has a file whose tests are all browser-only');
  // `D1063` — the file is STILL THERE behind API, dimmed and counting zero. Hiding it is what the
  // sidebar used to do, and a project pane that empties as you change doors is how someone
  // concludes the tool lost their tests.
  const count = page.locator(`[data-file="${browserOnly.path}"] [data-door-count]`);
  assert.equal(await count.getAttribute('data-door-count-state'), 'none', 'listed behind API, counting nothing');

  await page.locator('[data-door-tab="browser"]').click();
  await page.locator(`[data-file="${browserOnly.path}"] [data-door-count][data-door-count-state="some"]`).waitFor();
  assert.equal(new URL(page.url()).hash, '#/browser');

  // And back to the landing, by the one control that says so.
  await page.locator('[data-door-home]').click();
  await page.locator('[data-landing]').waitFor();
});

// ---------------------------------------------------------------------------
// `M240` `A` — where a door lands (`D1290`, closing `M239-09`).
//
// The fixture gained two files for this block and nothing else: `tests/actions/aaa-shared.tflw`,
// an action-only file that SORTS FIRST so `files[0]` is a wrong answer on every door, and
// `tests/hooks/hook-first.tflw`, whose first declaration is a hook. Graded against `/api/project`'s
// own derivation: the expected landing is computed here from the wire, by a rule written out in
// full, never by calling the page's function — which would be the page grading itself.
// ---------------------------------------------------------------------------

/** The file `D1290`'s rule lands on, computed independently of `landingRule.ts`: the most tests
 *  and crawls behind the door, ties to the path that sorts first, files with errors left out. */
const ruleLanding = (view: Awaited<ReturnType<typeof fullProject>>, door: string): string | null => {
  let best: string | null = null;
  let most = 0;
  for (const f of [...view.files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    if (f.errors > 0) continue;
    const n = f.tests.filter((t) => t.lenses.includes(door)).length + f.crawls.filter((c) => c.lenses.includes(door)).length;
    if (n > most) { most = n; best = f.path; }
  }
  return best;
};

/** The shape of a landing memory key (`landingRule.ts`): the project named by an eight-hex hash of
 *  its root, then the door. Restated as a pattern rather than imported — the cli test program's
 *  `rootDir` stops at this package, the same reason `DOOR_LABELS` is restated above — and read off
 *  the page's own storage, so the hash itself is never computed twice. */
const LANDING_KEY = String.raw`^tflw\.ui\.[0-9a-f]{8}\.lastFile\.(api|browser|load|scan)$`;

/** Every landing key the page holds, as the page holds them. */
const landingKeysOnPage = (p: Page): Promise<string[]> =>
  p.locator('html').evaluate((el, re) => {
    const ls = el.ownerDocument.defaultView!.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k !== null && new RegExp(re).test(k)) keys.push(k); }
    return keys.sort();
  }, LANDING_KEY);

/** Forget every landing this browser holds, so the next door opens by the rule and not by what the
 *  previous test left behind (`M240` plan §5.2). One context serves the whole file, so any test
 *  that asserts a landing goes through this first. */
const freshLanding = async (p: Page): Promise<void> => {
  const keys = await landingKeysOnPage(p);
  await p.locator('html').evaluate((el, ks) => { for (const k of ks) el.ownerDocument.defaultView!.localStorage.removeItem(k); }, keys);
};

/** The file the explorer marks open — the pane's subject, since `M240` `A` passes the drawn path
 *  and not the address's. Read after a `reload`, so the document is new and the wait is sound. */
const landedFile = async (p: Page): Promise<string | null> => {
  await p.reload();
  await p.locator('[data-files]').waitFor();
  await p.locator('[data-file-row][data-open="yes"]').waitFor();
  return p.locator('[data-file-row][data-open="yes"]').getAttribute('data-file-row');
};

test('`M240` `A`: a first visit lands each door on the file with the most of its kind of work, never on the first path', async () => {
  const view = await fullProject();
  const first = [...view.files].sort((a, b) => (a.path < b.path ? -1 : 1))[0]!;
  assert.equal(first.tests.length + first.crawls.length, 0, `the fixture's first file (${first.path}) must hold nothing, or the old rule is not wrong here`);
  for (const door of ['api', 'browser', 'load', 'scan']) {
    const expected = ruleLanding(view, door);
    assert.ok(expected !== null, `the fixture has something behind ${door}`);
    await freshLanding(page);
    await page.goto(`${pageUrl}#/${door}`);
    const landed = await landedFile(page);
    assert.equal(landed, expected, `${door} lands on the file with the most behind it`);
    assert.notEqual(landed, first.path, `${door} does not land on the file that merely sorts first`);
    // The address stays what was typed — a landing is what is drawn, not a correction of the
    // address (`D1252`: an address may be less specific than what is drawn, never different).
    assert.equal(new URL(page.url()).hash, `#/${door}`); // one-shot: the address is this test's own goto, and a reload has completed since; a rewrite here would be the defect
    // And the pane is about the same file the explorer marks — one subject, read two ways.
    const drawn = await settle(
      () => page.locator('[data-compose-file]').first().getAttribute('data-compose-file'),
      untilMeasurable('the pane names a file', (v) => v !== null),
      { attempts: 40, delayMs: 50, page },
    );
    assert.equal(drawn.value, expected);
  }
});

test('`M240` `A`: a door remembers the file you were on, per door and per project, and forgets one the project no longer has', async () => {
  const view = await fullProject();
  const rule = ruleLanding(view, 'api')!;
  const other = view.files.find((f) => f.path !== rule && f.tests.some((t) => t.lenses.includes('api')))!.path;
  await freshLanding(page);
  await page.goto(`${pageUrl}#/api`);
  await page.locator('[data-files]').waitFor();
  await page.locator(`[data-file-row="${other}"]`).click();
  await page.locator(`[data-file-row="${other}"][data-open="yes"]`).waitFor();
  // A reload of the bare door hash lands where the reader was, not where the rule says.
  await page.goto(`${pageUrl}#/api`);
  assert.equal(await landedFile(page), other, 'the memory survives a reload');
  // The memory is the door's: BROWSER has not been visited, so it lands by the rule.
  await page.goto(`${pageUrl}#/browser`);
  assert.equal(await landedFile(page), ruleLanding(view, 'browser'), 'another door has its own memory');
  await page.goto(`${pageUrl}#/api`);
  assert.equal(await landedFile(page), other, 'and coming back finds the first one intact');
  // The key names the project by a hash of its root and the door — two doors visited, two keys,
  // and nothing else of this shape on the page.
  // Written by an effect after the paint `landedFile` waited for, so the read settles on the count.
  const keysSeen = await settle(() => landingKeysOnPage(page), untilMeasurable('two doors visited, two keys written', (v: string[]) => v.length >= 2), { attempts: 40, delayMs: 50, page });
  const keys = keysSeen.value;
  assert.equal(keys.length, 2, `one key per door visited: ${keys.join(' ')}`);
  const key = keys.find((k) => k.endsWith('.lastFile.api'))!;
  assert.ok(key !== undefined && keys.some((k) => k.endsWith('.lastFile.browser')));
  const held = await settle(
    () => page.locator('html').evaluate((el, k) => el.ownerDocument.defaultView!.localStorage.getItem(k), key),
    untilMeasurable('the api door has written its memory', (v) => v !== null),
    { attempts: 40, delayMs: 50, page },
  );
  assert.equal(held.value, other);
  // A remembered file the project no longer has falls through to the rule rather than to nothing.
  await page.locator('html').evaluate((el, k) => el.ownerDocument.defaultView!.localStorage.setItem(k, 'tests/renamed-away.tflw'), key); // one-shot: a write, not a read
  await page.goto(`${pageUrl}#/api`);
  assert.equal(await landedFile(page), rule, 'a stale memory is not a landing');
  // A fresh context — the four keys gone — is the rule again, which is the control for the
  // assertions above: without it, "remembered" and "rule" could be the same file by coincidence.
  assert.notEqual(other, rule);
  await freshLanding(page);
  await page.goto(`${pageUrl}#/api`);
  assert.equal(await landedFile(page), rule);
});

test('`M240` `A` (`M239-09`): a file whose first declaration is a hook lands on its first test, and a line naming the hook still reaches it', async () => {
  const view = await fullProject();
  const hooked = view.files.find((f) => f.path.endsWith('hook-first.tflw'))!;
  const text = await readFile(join(root, hooked.path), 'utf8');
  const hookLine = text.split('\n').findIndex((l) => l === 'before') + 1;
  const testLine = text.split('\n').findIndex((l) => l.startsWith('test ')) + 1;
  assert.ok(hookLine > 0 && testLine > hookLine, 'the fixture declares its hook before its test');
  /** The declaration the pane resolved, once it has resolved one: kind and line off the summary. */
  const resolved = async (): Promise<{ kind: string | null; line: string | null }> => {
    await page.locator('[data-compose-summary]').waitFor();
    const got = await settle(
      () => page.locator('[data-compose-summary]').evaluate((el) => ({ kind: el.getAttribute('data-compose-decl-kind'), line: el.getAttribute('data-compose-decl-line') })),
      untilMeasurable('the pane has resolved a declaration', (v) => v.kind !== null),
      { attempts: 40, delayMs: 50, page },
    );
    return got.value;
  };
  await page.goto(`${pageUrl}#/api/compose/${hooked.path}`);
  await page.reload();
  const landed = await resolved();
  assert.equal(landed.kind, 'test', 'the landing declaration is the test, not the hook that sorts before it');
  assert.equal(landed.line, String(testLine));
  // The hook is still reachable — a line that names it lands on it, as every `L<n>` does.
  await page.goto(`${pageUrl}#/api/compose/${hooked.path}/L${hookLine}`);
  await page.reload();
  const named = await resolved();
  assert.equal(named.kind, 'hook');
  assert.equal(named.line, String(hookLine));
});

test('`M240` `A`: a door with nothing behind it says so and offers a file, instead of drawing whichever file sorted first', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-empty-door-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage();
  try {
    const base = `http://127.0.0.1:${await ui.listen(0)}`;
    await fresh.goto(`${base}/?token=${TOKEN}`);
    await fresh.locator('[data-landing]').waitFor();
    const decided = await settle(
      () => fresh.locator('[data-door="load"] [data-door-state]').getAttribute('data-door-state'),
      untilMeasurable('the landing has finished asking whether this is a project', (v) => v !== null && v !== 'asking'),
      { attempts: 40, delayMs: 50, page: fresh },
    );
    assert.equal(decided.value, 'create');
    // `tflw init --load` writes one file with one workload test: LOAD has something, BROWSER has nothing.
    await fresh.locator('[data-door="load"]').click();
    await fresh.locator('[data-files]').waitFor();
    await fresh.locator('[data-file-row][data-open="yes"]').waitFor();
    assert.equal(await fresh.locator('[data-empty-door]').count(), 0, 'LOAD landed on its own scaffold'); // one-shot: population established by the open row above
    await fresh.goto(`${base}/?token=${TOKEN}#/browser`);
    await fresh.locator('[data-empty-door="browser"]').waitFor();
    assert.equal(await fresh.locator('[data-compose-file]').count(), 0, 'no file is drawn under a door that has none'); // one-shot: the empty door's presence is established above
    assert.equal(await fresh.locator('[data-file-row][data-open="yes"]').count(), 0, 'and the explorer marks none open'); // one-shot: same
    // The one gesture that changes the answer opens the create dialog, which scaffolds for this door.
    await fresh.locator('[data-empty-door-new]').click();
    await fresh.locator('[data-new-thing="file"]').waitFor();
    // The explorer is still beside it: the files the scaffold wrote are a click away, and clicking
    // one draws it — under this door, which has nothing behind it, because the reader named it.
    await fresh.locator('[data-new-cancel]').click();
    await fresh.locator('[data-file-row]').first().waitFor();
    const first = await fresh.locator('[data-file-row]').first().getAttribute('data-file-row'); // one-shot: the scaffold's files were listed at `[data-files]` above and nothing since has changed the tree
    await fresh.locator(`[data-file-row="${first}"]`).click();
    await fresh.locator(`[data-compose-file="${first}"]`).waitFor();
    assert.equal(await fresh.locator('[data-empty-door]').count(), 0); // one-shot: the pane's presence is established above
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('`M240` `F` (`M239-04`): the new-step dialog refuses an empty field, and writes nothing until it is filled', async () => {
  const view = await fullProject();
  const target = view.files.find((f) => f.path.endsWith('shop.tflw'))!.path;
  const before = await readFile(join(root, target), 'utf8');
  await page.goto(`${pageUrl}#/browser/compose/${target}`);
  await page.reload();
  await page.locator('[data-seq-add="step"]').first().waitFor();
  await page.locator('[data-seq-add="step"]').first().click();
  await page.locator('[data-add-step]').waitFor();
  await page.locator('[data-add-step-kind="HoverStmt"]').click();
  // The default is empty, so the build refuses: the button is disabled and the reason is under
  // the preview — `change me` used to build, preview, and land in the file.
  await page.locator('[data-add-step-problem]').waitFor();
  await page.locator('[data-add-step-go][disabled]').waitFor();
  // one-shot, the three reads below: the dialog was opened by this test's own click and its
  // initial state — the refusal, the empty field, the placeholder — is what `[data-add-step-go][disabled]`
  // above has established is on screen; nothing on the page changes it until the fill further down.
  assert.notEqual(((await page.locator('[data-add-step-problem]').textContent()) ?? '').trim(), '', 'the refusal says nothing'); // one-shot: see above
  const field = page.locator('[data-add-step] [data-locator-value]');
  assert.equal(await field.inputValue(), '', 'the field holds a placeholder value rather than being empty'); // one-shot: see above
  assert.notEqual(await field.getAttribute('placeholder'), null, 'and the input carries no placeholder to say what goes there'); // one-shot: see above
  // Filling it is what enables the button, and the bytes are still untouched until it is pressed.
  await page.locator('[data-add-step] [data-locator-value]').fill('Menu');
  await page.locator('[data-add-step-go]:not([disabled])').waitFor();
  assert.equal(await readFile(join(root, target), 'utf8'), before, 'the file changed before anything was accepted');
  await page.locator('[data-add-step-cancel]').click();
  await page.locator('[data-add-step]').waitFor({ state: 'detached' });
  assert.equal(await readFile(join(root, target), 'utf8'), before, 'cancel wrote something');
});

test('`M240` `F` (`M239-05`): a run chip is relative, its tip is the absolute form with the zone, and the report head spells the same instant', async () => {
  await page.goto(`${pageUrl}${API_RUN}`);
  await page.reload();
  await page.locator('[data-report-row="full"] [data-run-when]').waitFor();
  const chip = page.locator('[data-report-row="full"] [data-run-when]');
  // The row's instant is the directory's own `at` (this suite touches `results.json` at setup, so
  // it is not the oracle's `startedAt`); the claim is about the spelling, not about which instant.
  const iso = (await chip.getAttribute('data-run-when'))!;
  assert.ok(!Number.isNaN(Date.parse(iso)), `the chip carries no parseable instant: ${iso}`);
  assert.match((await chip.textContent()) ?? '', /^\d+[smhd] ago$/, 'the chip is not a relative time');
  // The tip is the same instant, spelled `YYYY-MM-DD HH:mm:ss ±HH:MM` in the browser's zone: the
  // clock is re-derived here from the same ISO stamp, so the assertion is about the rule and not
  // about where the box happens to be.
  const tip = (await chip.getAttribute('data-tip'))!;
  assert.match(tip, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}$/, `the tip is ${tip}`);
  // No named inner function inside the callback: `tsx` wraps one in a `__name` helper that does
  // not exist in the page, and the evaluate dies with `__name is not defined`.
  const spelled = (s: string): Promise<string> => page.locator('html').evaluate((_el, iso) => { // one-shot: a computation over an ISO string in the browser's zone — nothing on the page is read
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value])) as Record<string, string>;
    return `${p['year']}-${p['month']}-${p['day']} ${p['hour']}:${p['minute']}:${p['second']} ${(p['timeZoneName'] ?? '').replace(/^GMT/, '') || '+00:00'}`;
  }, s);
  assert.equal(tip, await spelled(iso));
  // And the report's own head spells ITS instant — `startedAt` — the same way: two places, one
  // rule, no `7:56:44 PM`.
  await page.locator('[data-report-row="full"]').click();
  await page.locator('[data-report="full"]').waitFor();
  const head = (await page.locator('[data-report="full"] .report-head').first().textContent()) ?? ''; // one-shot: the report's presence is established by the wait above and its head is part of that render
  const headExpected = await spelled(oracle['full']!.startedAt);
  assert.ok(head.includes(headExpected), `the report head (${head.trim().slice(0, 120)}) does not carry ${headExpected}`);
  assert.doesNotMatch(head, /\d\/\d+\/\d{4}, |[AP]M\b/, 'the head still spells the locale form');
});

test('`M240` `F` (`M239-06`): two failures are two notices, top-right; one closes on its ✕ and the other after ten seconds; a route change clears neither', async () => {
  // Two report directories that exist when the list is read and are gone when they are opened —
  // the shape `M235` measured: a read that fails after a healthy state.
  const dirs = ['gone-a', 'gone-b'].map((id) => join(root, 'report', 'runs', id));
  for (const d of dirs) {
    await mkdir(d, { recursive: true });
    await writeFile(join(d, 'results.json'), JSON.stringify(oracle['full']));
  }
  const fresh = await newPage();
  try {
    await fresh.clock.install();
    await fresh.goto(`${pageUrl}${API_RUN}`);
    await fresh.locator('[data-report-row="gone-b"]').waitFor();
    for (const d of dirs) await rm(d, { recursive: true, force: true });
    await fresh.locator('[data-report-row="gone-a"]').click();
    await fresh.locator('[data-notice]').first().waitFor();
    await fresh.locator('[data-report-row="gone-b"]').click();
    await fresh.locator('[data-notices="2"]').waitFor();
    // Neither overwrote the other, and the layer is the page's, not the run pane's.
    assert.equal(await fresh.locator('[data-notice]').count(), 2); // one-shot: `[data-notices="2"]` above has established the population
    assert.equal(await fresh.locator('[data-runs] [data-notice], .runpane [data-notice]').count(), 0, 'a notice is drawn inside the run pane'); // one-shot: same population
    // A route change clears nothing: a notice is about what happened, not where you are.
    await fresh.goto(`${pageUrl}#/api/compose`);
    await fresh.locator('[data-compose-bar]').waitFor();
    await fresh.locator('[data-notices="2"]').waitFor();
    // ✕ closes one, and only that one.
    await fresh.locator('[data-notice]').first().locator('[data-notice-close]').click();
    await fresh.locator('[data-notices="1"]').waitFor();
    // The other goes on its own at ten seconds — not before.
    await fresh.clock.fastForward(9_000);
    await fresh.locator('[data-notices="1"]').waitFor();
    await fresh.clock.fastForward(1_500);
    await fresh.locator('[data-notices]').waitFor({ state: 'detached' });
  } finally {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
    await fresh.close();
  }
});

test('`M240` `F` (`M239-07`): a dirty draft asks before the page unloads, and a clean page does not', async () => {
  // Dispatched by the test rather than through `page.close()`: Playwright runs no `beforeunload`
  // on close unless asked, and the claim is about the listener, which `defaultPrevented` reads.
  const asks = (): Promise<boolean> => page.locator('html').evaluate((el) => { // one-shot: dispatches this test's own event and reads its `defaultPrevented` — no page state is sampled
    const e = new (el.ownerDocument.defaultView as unknown as { Event: new (t: string, i: { cancelable: boolean }) => Event }).Event('beforeunload', { cancelable: true });
    el.ownerDocument.defaultView!.dispatchEvent(e);
    return e.defaultPrevented;
  });
  const view = await fullProject();
  const target = view.files.find((f) => f.path.endsWith('shop.tflw'))!.path;
  await page.goto(`${pageUrl}#/browser/compose/${target}`);
  await page.reload();
  await page.locator('[data-seq-add="click"]').first().waitFor();
  assert.equal(await asks(), false, 'a clean page asked'); // one-shot: dispatched by this test against a page it has just loaded; nothing is read off the DOM
  await page.locator('[data-seq-add="click"]').first().click();
  await page.locator('[data-compose-dirty]').waitFor();
  const dirty = await settle(asks, untilMeasurable('the listener is attached', (v) => v === true), { attempts: 40, delayMs: 50, page });
  assert.equal(dirty.value, true, 'a dirty draft did not ask');
  await page.locator('[data-compose-discard]').click();
  await page.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
  const clean = await settle(asks, untilMeasurable('the listener is gone', (v) => v === false), { attempts: 40, delayMs: 50, page });
  assert.equal(clean.value, false, 'a discarded draft still asks');
});

test('`M240` `F` (`M239-08`): a run started outside the page is followed without a click, and one that ends while another tab is open is announced', async () => {
  // The page learns of a run it did not start from its five-second list poll, so the claim is
  // *a run that is running when the list is re-read is followed*. The poll is a timer, and the
  // test owns the clock: it advances five seconds itself, right after the run starts, rather than
  // racing a real interval against a run that may be over in one poll window. The load file is
  // API-only — a browser run in this harness ends inside a second — and runs for several seconds.
  const view = await fullProject();
  const target = view.files.find((f) => f.path.endsWith('load.tflw'))!.path;
  const start = async (): Promise<string> => {
    const res = await api(`${baseUrl}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: [target] }) }); // one-shot: a write, not a read
    assert.equal(res.status, 202, `POST /api/run answered ${res.status}`);
    return ((await res.json()) as { id: string }).id;
  };
  const stateOf = async (id: string): Promise<string | null> => ((await (await api(`${baseUrl}/api/runs`)).json()) as { id: string; status: string }[]).find((r) => r.id === id)?.status ?? null; // one-shot: read through `settle` by `ended`, and as a precondition straight after this test's own POST
  const ended = (id: string): Promise<void> => settle(() => stateOf(id), untilMeasurable('the run has left the running state', (v) => v !== null && v !== 'running'), { attempts: 240, delayMs: 250, page }).then(() => undefined);

  await page.goto(`${pageUrl}${API_RUN}`);
  await page.clock.install();
  await page.reload();
  await page.locator('[data-report-row="full"]').waitFor();
  try {
    // 1. On the Run tab, looking at a report: the next list read finds the run running, and the
    //    pane follows it — no click.
    const first = await start();
    assert.equal(await stateOf(first), 'running', 'the run must still be running when the list is re-read, or there is nothing to follow');
    await page.clock.runFor(5_000);
    const followed = await settle(() => page.locator(`[data-live="${first}"]`).count(), untilMeasurable('the pane draws the run', (n) => n > 0), { attempts: 40, delayMs: 250, page });
    assert.ok(followed.value > 0, 'the list was re-read while the run was running, and the pane did not follow it');
    await ended(first);

    // 2. On Compose: a followed run's end is a notice naming the verdict, because the Run tab is
    //    not the one open to say it.
    await page.goto(`${pageUrl}#/api/compose/${target}`);
    await page.locator('[data-compose-bar]').waitFor();
    const second = await start();
    assert.equal(await stateOf(second), 'running');
    await page.clock.runFor(5_000);
    const announced = await settle(
      () => page.locator('[data-notice][data-notice-tone="info"]').first().textContent().catch(() => null),
      untilMeasurable('the end notice is up', (v) => v !== null && v !== ''),
      { attempts: 240, delayMs: 250, page },
    );
    assert.match(announced.value ?? '', /^the run (passed|failed)/, `the notice reads ${announced.value}`);
    await ended(second);
  } finally {
    // The fake clock would otherwise hold every later test's timers still.
    await page.clock.setSystemTime(Date.now());
    await page.reload();
  }
});

test('`M240` `F` (`M239-10`): the door bar names which tflw this is, and links the docs in a new tab', async () => {
  const view = (await (await api(`${baseUrl}/api/project`)).json()) as { version: { version: string; source: string } }; // one-shot: the build stamp is a constant of this process, read once as the oracle for the corner
  assert.match(view.version.version, /^\d+\.\d+\.\d+/, `the wire carries no version: ${JSON.stringify(view.version)}`);
  assert.equal(view.version.source, 'dev', 'this suite runs the source under tsx, and the stamp must say so rather than invent provenance');
  await page.goto(`${pageUrl}#/api`);
  await page.reload();
  await page.locator('[data-doorbar] [data-version]').waitFor();
  const corner = page.locator('[data-doorbar] [data-version]');
  assert.equal(await corner.getAttribute('data-version'), view.version.version);
  assert.equal(((await corner.textContent()) ?? '').trim(), `tflw ${view.version.version}`);
  assert.equal(await corner.getAttribute('href'), 'https://deepak-tuteja.github.io/tflw/');
  assert.equal(await corner.getAttribute('target'), '_blank');
  assert.equal(await corner.getAttribute('rel'), 'noreferrer', 'the docs link leaks the page’s address');
  // On every door — it is the bar's, not a door's.
  for (const door of ['browser', 'load', 'scan']) {
    await page.goto(`${pageUrl}#/${door}`);
    await page.locator(`[data-doorbar="${door}"] [data-version="${view.version.version}"]`).waitFor();
  }
});

test('`M240` `F` (`M239-01`): `send all` on a hook counts and lists the hook’s requests once — head, button and list agree', async () => {
  const view = await fullProject();
  const hooked = view.files.find((f) => f.path.endsWith('hook-first.tflw'))!;
  const text = await readFile(join(root, hooked.path), 'utf8');
  const hookLine = text.split('\n').findIndex((l) => l === 'before') + 1;
  const testLine = text.split('\n').findIndex((l) => l.startsWith('test ')) + 1;
  const hookRequests = text.split('\n').slice(hookLine, testLine - 1).filter((l) => /^\s+api /.test(l)).length;
  assert.equal(hookRequests, 2, 'the fixture’s hook carries two requests');
  await page.goto(`${pageUrl}#/api/compose/${hooked.path}/L${hookLine}`);
  await page.reload();
  await page.locator('[data-compose-summary][data-compose-decl-kind="hook"]').waitFor();
  await page.locator('[data-compose-send="all"]').waitFor();
  await page.locator('[data-prefix]').waitFor();
  const head = (await page.locator('[data-compose-summary]').textContent()) ?? ''; // one-shot: the summary was waited for by kind above, on a page loaded by this test's own reload
  assert.match(head, /\b2 requests\b/, `the head reads ${head}`);
  const button = (await page.locator('[data-compose-send="all"]').textContent()) ?? ''; // one-shot: waited for above, same page load
  assert.match(button, /\b2\b/, `the button reads ${button} — the old rule said 4`);
  assert.equal(await page.locator('[data-prefix]').getAttribute('data-prefix'), '2', 'the list under the button is not the head’s set'); // one-shot: waited for above
  // Each listed once, each naming the hook it belongs to (`where`), and nothing listed twice.
  assert.deepEqual(await page.locator('[data-prefix-request]').allTextContents().then((xs) => xs.map((x) => x.replace(/\s+/g, ' ').trim().replace(/\s*before each$/, ''))), ['GET /items', 'GET /items/1']); // one-shot: population established by `[data-prefix="2"]` above
});

test('`M240` `F` (`M239-11`): with no remembered width, the sequence column is as wide as the file needs; a remembered 220 still clips', async () => {
  // A file with one row longer than the 300 px the column used to open at, written into the
  // served project for this test and removed after it.
  const long = 'tests/zz-long-row.tflw';
  // Longer than 300 px of 12 px mono and shorter than the 60 %-of-pane cap the fit stops at.
  await writeFile(join(root, long), 'test "a long path"\n  api GET /a/path/past/three/hundred/px/of/column\n  expect status equals 200\n');
  const clipped = (): Promise<number> => page.locator('.seq-col .seq-text').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth).length); // one-shot: read only through `settle` below, at both widths
  try {
    await page.locator('html').evaluate((el) => el.ownerDocument.defaultView!.localStorage.removeItem('tflw.compose.width')); // one-shot: a write, not a read
    await page.goto(`${pageUrl}#/api/compose/${long}`);
    await page.reload();
    await page.locator('.seq-col .seq-text').first().waitFor();
    const width = await settle(() => page.locator('[data-compose-footer]').evaluate((el) => (el as unknown as { style: { getPropertyValue: (n: string) => string } }).style.getPropertyValue('--seq-w')), untilMeasurable('the column has a fitted width', (v) => v !== '' && v !== '300px'), { attempts: 40, delayMs: 50, page });
    assert.notEqual(width.value, '300px', 'the column opened at the builder’s 300 px');
    const fitted = await settle(clipped, untilMeasurable('the rows have laid out', (n) => n === 0), { attempts: 40, delayMs: 50, page });
    assert.equal(fitted.value, 0, `${fitted.value} row(s) still ellipsised at the fitted default (${width.value})`);
    // The negative control: the same file under a remembered 220 clips, so the measurement above
    // is of the width and not of a row that fits anything.
    await page.locator('html').evaluate((el) => el.ownerDocument.defaultView!.localStorage.setItem('tflw.compose.width', '220')); // one-shot: a write
    await page.reload();
    await page.locator('.seq-col .seq-text').first().waitFor();
    const narrow = await settle(clipped, untilMeasurable('the rows have laid out at 220', (n) => n > 0), { attempts: 40, delayMs: 50, page });
    assert.ok(narrow.value > 0, 'a 220 px column did not clip the long row, so the instrument sees nothing');
  } finally {
    await page.locator('html').evaluate((el) => el.ownerDocument.defaultView!.localStorage.removeItem('tflw.compose.width')); // one-shot: a write
    await rm(join(root, long), { force: true });
  }
});

test('`M240` `B` (`D1291`): over a directory with no tflw.config the landing names the directory and the tflw, shows no absolute path, and no route fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-unconfigured-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage();
  const failed: string[] = [];
  fresh.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); }); // one-shot: a response's own URL inside its event, not a page read
  try {
    const base = `http://127.0.0.1:${await ui.listen(0)}`;
    await fresh.goto(`${base}/?token=${TOKEN}`);
    await fresh.locator('[data-landing-unconfigured]').waitFor();
    assert.equal(await fresh.locator('[data-landing-unconfigured]').getAttribute('data-landing-unconfigured'), basename(dir));
    const version = (await (await api(`${base}/api/project`)).json()) as { version: { version: string } }; // one-shot: the build stamp is a constant of this process
    await fresh.locator('[data-landing-unconfigured] [data-version]').waitFor();
    assert.equal(await fresh.locator('[data-landing-unconfigured] [data-version]').getAttribute('data-version'), version.version.version); // one-shot: waited for just above, on a page this test loaded and has not touched since
    const decided = await settle(
      () => fresh.locator('[data-door="api"] [data-door-state]').getAttribute('data-door-state'),
      untilMeasurable('the landing has finished asking', (v) => v !== null && v !== 'asking'),
      { attempts: 40, delayMs: 50, page: fresh },
    );
    assert.equal(decided.value, 'create');
    const text = (await fresh.locator('body').textContent()) ?? ''; // one-shot: read after the door has decided, the last thing the landing waits on
    assert.doesNotMatch(text, /\/(tmp|private|home|Users)\//, 'the page shows an absolute path');
    assert.ok(text.includes(basename(dir)), 'the page does not say which directory it is over');
    assert.deepEqual(failed, [], 'a route failed while the landing drew'); // one-shot: the responses recorded up to this point
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

/** What has focus, named by the first `data-*` this suite addresses controls by — or its tag. */
const FOCUS_NAMES = ['data-file-row', 'data-dir-toggle', 'data-door-tab', 'data-door-home', 'data-version', 'data-legend-open', 'data-tab', 'data-search', 'data-compose-new-file', 'data-legend', 'data-locator-value'];
const focusedOn = (p: Page): Promise<string> =>
  p.locator('html').evaluate((el, names) => {
    const a = el.ownerDocument.activeElement as unknown as { getAttribute(n: string): string | null; hasAttribute(n: string): boolean; tagName: string } | null;
    if (a === null) return '';
    // React spells a boolean `data-*` as `"true"`; the name alone is the fact for those.
    for (const n of names) if (a.hasAttribute(n)) { const v = a.getAttribute(n) ?? ''; return `${n}=${v === 'true' ? '' : v}`; }
    return a.tagName.toLowerCase();
  }, FOCUS_NAMES);
const focusSettles = (p: Page, what: string, ok: (v: string) => boolean) => settle(() => focusedOn(p), untilMeasurable(what, ok), { attempts: 40, delayMs: 25, page: p });

test('`M240` `C` (`D1292`): the explorer, the door bar and the tab strip are one Tab stop each, and arrows walk inside them', async () => {
  const view = await fullProject();
  const open = ruleLanding(view, 'api')!;
  await page.goto(`${pageUrl}#/api`);
  await freshLanding(page);
  await page.reload();
  await page.locator(`[data-file-row="${open}"][data-open="yes"]`).waitFor();
  // Each strip offers exactly one stop: its current control.
  for (const strip of ['.files.tree', '[data-doorbar]', '[data-tabstrip]']) {
    const stops = await settle(
      () => page.locator(strip).first().evaluate((el) => [...el.querySelectorAll('button, a')].filter((b) => (b as unknown as { tabIndex: number }).tabIndex === 0).length),
      untilMeasurable(`${strip} has roved`, (n) => n === 1),
      { attempts: 40, delayMs: 25, page },
    );
    assert.equal(stops.value, 1, `${strip} offers ${stops.value} Tab stops`);
  }
  // Search → Tab lands on the open file, not on the first row and not on a row's own `+`.
  await page.locator('[data-search]').focus();
  const start = await focusSettles(page, 'search has focus', (v) => v === 'data-search=');
  assert.equal(start.value, 'data-search=', 'the walk starts at search');
  await page.keyboard.press('Tab');
  assert.equal((await focusSettles(page, 'Tab reached the open file', (v) => v === `data-file-row=${open}`)).value, `data-file-row=${open}`);
  // ↓ walks inside; Tab leaves the whole list in one press.
  await page.keyboard.press('ArrowDown');
  const moved = await focusSettles(page, '↓ moved inside the tree', (v) => v !== `data-file-row=${open}`);
  assert.notEqual(moved.value, `data-file-row=${open}`, '↓ did not move');
  await page.keyboard.press('Tab');
  const left = await focusSettles(page, 'Tab left the tree', (v) => !v.startsWith('data-file-row') && !v.startsWith('data-dir-toggle'));
  assert.ok(!left.value.startsWith('data-file-row') && !left.value.startsWith('data-dir-toggle'), `Tab stayed in the tree: ${left.value}`);
  // The door bar: Tab lands on the door you are in, → moves to the next, and wraps from the last.
  await page.locator('[data-door-tab="api"]').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal((await focusSettles(page, '→ moved', (v) => v === 'data-door-tab=browser')).value, 'data-door-tab=browser');
  await page.keyboard.press('End');
  const end = await focusSettles(page, 'End reached the last', (v) => v === 'data-legend-open=');
  assert.equal(end.value, 'data-legend-open=', 'the strip ends at `?`');
  await page.keyboard.press('ArrowRight');
  assert.equal((await focusSettles(page, 'wrapped to home', (v) => v === 'data-door-home=')).value, 'data-door-home=');
  // The tab strip: ← from Compose wraps to the last tab.
  await page.locator('[data-tab="compose"]').focus();
  await page.keyboard.press('ArrowRight');
  const next = await focusSettles(page, '→ moved in the tab strip', (v) => v.startsWith('data-tab=') && v !== 'data-tab=compose');
  assert.notEqual(next.value, 'data-tab=compose');
});

test('`M240` `C` (`D1292`): `?` opens the legend of the keys the page answers, Escape closes it, and `/` and ⌘P reach search and the list', async () => {
  await page.goto(`${pageUrl}#/api`);
  await page.reload();
  await page.locator('[data-doorbar] [data-legend-open]').waitFor();
  await page.locator('[data-door-tab="api"]').focus();
  await page.keyboard.press('Shift+?');
  await page.locator('[data-legend]').waitFor();
  assert.equal(await page.locator('[data-legend-keys]').getAttribute('data-legend-keys'), '6'); // one-shot: the legend is drawn whole in one render, waited for above
  assert.deepEqual(await page.locator('[data-legend-key]').evaluateAll((els) => els.map((e) => e.getAttribute('data-legend-key'))), ['save', 'run-file', 'run-selection', 'open-file', 'search', 'legend']); // one-shot: population established by `[data-legend-keys="6"]` above
  await page.keyboard.press('Escape');
  await page.locator('[data-legend]').waitFor({ state: 'detached' });
  // The door bar's `?` is the same dialog.
  await page.locator('[data-legend-open]').click();
  await page.locator('[data-legend]').waitFor();
  await page.locator('[data-legend-close]').click();
  await page.locator('[data-legend]').waitFor({ state: 'detached' });
  // `/` focuses the search box and types nothing into it.
  await page.locator('[data-door-tab="api"]').focus();
  await page.keyboard.press('/');
  assert.equal((await focusSettles(page, '`/` reached search', (v) => v === 'data-search=')).value, 'data-search=');
  assert.equal(await page.locator('[data-search]').inputValue(), '', 'the `/` was typed into the box'); // one-shot: the key has been handled, since focus moved in response to it
  // …and `?` inside the box is a character, not the legend.
  await page.keyboard.press('Shift+?');
  await settle(() => page.locator('[data-search]').inputValue(), untilEqual('?'), { attempts: 40, delayMs: 25, page });
  assert.equal(await page.locator('[data-legend]').count(), 0, 'the legend opened over a field'); // one-shot: the character has landed, so the key has been fully handled
  await page.locator('[data-search]').fill('');
  // ⌘P / Ctrl+P reaches the file list, outside a field.
  await page.locator('[data-door-tab="api"]').focus();
  await page.keyboard.press('ControlOrMeta+p');
  const tree = await focusSettles(page, '⌘P reached the list', (v) => v.startsWith('data-file-row') || v.startsWith('data-dir-toggle'));
  assert.ok(tree.value.startsWith('data-file-row') || tree.value.startsWith('data-dir-toggle'), `⌘P focused ${tree.value}`);
});

test('`M240` `C` (`D1292`): ⌘S writes a dirty draft from inside a field, and ⌘↩ runs the open file', async () => {
  const view = await fullProject();
  const target = view.files.find((f) => f.path.endsWith('shop.tflw'))!.path;
  const before = await readFile(join(root, target), 'utf8');
  try {
    await page.goto(`${pageUrl}#/browser/compose/${target}`);
    await page.reload();
    await page.locator('[data-seq-add="click"]').first().click();
    await page.locator('[data-script="click"]').waitFor();
    const row = page.locator('[data-script="click"]');
    await row.locator('[data-locator-kind]').selectOption('text');
    await row.locator('[data-locator-value]').fill('Saved by key');
    await page.locator('[data-compose-dirty]').waitFor();
    await row.locator('[data-locator-value]').focus();
    await page.keyboard.press('ControlOrMeta+s');
    await page.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
    assert.match(await readFile(join(root, target), 'utf8'), /click text "Saved by key"/, '⌘S did not write the file');
  } finally {
    await writeFile(join(root, target), before, 'utf8');
  }
  // ⌘↩ sends the open file, whole, through the page's one run funnel. The request is caught and
  // refused at the route, so the claim is what the page asked for and no run is started.
  const asked: string[] = [];
  await page.route('**/api/run', async (route) => {
    if (route.request().method() === 'POST') asked.push(route.request().postData() ?? '');
    await route.abort().catch(() => {});
  });
  try {
    await page.goto(`${pageUrl}#/api/compose/${ruleLanding(view, 'api')!}`);
    await page.reload();
    await page.locator('[data-compose-pane]').waitFor();
    await page.locator('[data-door-tab="api"]').focus();
    await page.keyboard.press('ControlOrMeta+Enter');
    const sent = await settle(async () => asked.length, untilMeasurable('the run was asked for', (n) => n > 0), { attempts: 40, delayMs: 50, page });
    assert.equal(sent.value, 1, 'one key, one run');
    assert.deepEqual((JSON.parse(asked[0]!) as { files?: string[] }).files, [ruleLanding(view, 'api')!]);
  } finally {
    await page.unroute('**/api/run');
  }
});

// ---------------------------------------------------------------------------
// `M224` — the LOAD door stops being a form and starts being a door (`D1205`–`D1214`).
//
// What these replace is `M200` `A0-4`'s block, which drove `LoadForm`: a staging form with a
// `<select>` asking **which test to attach this workload to**, the shape `M213-08` took off API
// and `M213` `S4` took off BROWSER. Measured before this round, on this door:
// `.seq-col` 0, `.seq-row` 0, editor 0, `.split` 0 — and `#/load/compose/<file>/L10` and
// `…/L61` rendered a **byte-identical** form, so the address's line segment named a declaration
// the pane never looked at.
//
// The claims survive; their subject moved. A workload is an ordinary clause now (`D1205`), so
// what used to be *pick a test and tick a box* is the band's own row, and what used to be *the
// form's preview* is the file.
// ---------------------------------------------------------------------------

/** Open a declaration on a door, by the address the sidebar writes. */
const declAt = async (door: 'api' | 'browser' | 'load', file: string, line: number): Promise<void> => {
  await page.goto(`${pageUrl}#/${door}/compose/${file}/L${line}`);
  await page.reload();
  await page.locator(`[data-doorbar="${door}"]`).waitFor();
  await page.locator('[data-band-facts]').waitFor();
};

/** Which line each test of a file starts on, read off the project the server publishes rather
 *  than counted here — a fixture that grows a comment must not move a gate. */
const declLines = async (file: string): Promise<number[]> => {
  const view = (await (await api(`${baseUrl}/api/project`)).json()) as { files: { path: string; tests: { line: number }[] }[] };
  return view.files.find((f) => f.path === file)!.tests.map((t) => t.line);
};

// GATE 11 + 12 — **the door renders the standard pane, and the address's line means something.**
// Both halves in one test because either alone is satisfiable by the old form: `LoadForm` also
// "rendered" at both addresses, identically.
// **Mutation: keep `LoadForm` in the dispatch → `data-load-form` comes back and both panes draw.**
test('`M224` `D`: the LOAD door draws the Compose sequence, and its address selects a declaration', async () => {
  const lines = await declLines('tests/load.tflw');
  assert.ok(lines.length >= 2, 'the fixture needs two workload tests for the address half of this');

  await declAt('load', 'tests/load.tflw', lines[0]!);
  assert.equal(await page.locator('[data-load-form]').count(), 0, '`LoadForm` is still in the dispatch');
  assert.equal(await page.locator('.seq-col').count(), 1, 'no sequence column');
  assert.ok((await page.locator('.seq-row').count()) > 0, 'no sequence rows');
  assert.equal(await page.locator('.split').count(), 1, 'no divider between the editor and the response');

  // **The line segment selects the declaration**, which is the half the old form ignored outright.
  const first = await page.locator('[data-band-line]').first().getAttribute('data-band-line');
  await declAt('load', 'tests/load.tflw', lines[1]!);
  const second = await page.locator('[data-band-line]').first().getAttribute('data-band-line');
  assert.equal(first, String(lines[0]));
  assert.equal(second, String(lines[1]), 'L10 and L61 still render alike — the pane does not follow the address');
});

// GATE 10 — **`main-fill` reaches this door**, and the claim is **parity with the door the pane
// was built for** rather than a pixel constant. `M223` `A` fixed the predicate by listing the two
// doors that render `ComposeDoor`, which put the same fact in two places and cost LOAD **190 px**
// the moment it became the third; `D1210` reads `VOCABULARY[door].adds.length > 0` instead.
//
// **The plan said "within 20 px of the window" and that is the wrong instrument**, amended here:
// the pane's own bottom sits above the write bar on *every* door — measured 799 against a 900 px
// window on API and on LOAD alike — so a constant would have been asserting something about the
// bar. Parity cannot be satisfied by a number nobody chose.
// **Mutation: restore the two-door predicate → LOAD's `main` loses `main-fill` and the bottoms part.**
test('`M224` `D`: LOAD lays out like the door the pane was built for, to the pixel', async () => {
  const sized = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    const read = async (door: 'api' | 'load', file: string, line: number): Promise<Record<string, unknown>> => {
      await sized.goto(`${pageUrl}#/${door}/compose/${file}/L${line}`);
      await sized.reload();
      await sized.locator('[data-band-facts]').waitFor();
      /* A **locator** evaluate rather than a page one: `types: ["node"]` and no DOM lib, so
         `document` is not a name in this package — `S1`'s finding, and `M222-01`'s. */
      return await sized.locator('.main').evaluate((main) => {
        const doc = main.ownerDocument;
        const pane = doc.querySelector('.compose-pane');
        return {
          fill: main.className,
          main: Math.round(main.getBoundingClientRect().bottom),
          pane: pane === null ? null : Math.round(pane.getBoundingClientRect().bottom),
          overflow: doc.documentElement.scrollHeight - doc.documentElement.clientHeight,
        };
      });
    };
    const apiLines = await declLines('tests/catalog.tflw');
    const loadLines = await declLines('tests/load.tflw');
    const api = await read('api', 'tests/catalog.tflw', apiLines[0]!);
    const load = await read('load', 'tests/load.tflw', loadLines[0]!);
    assert.equal(load.fill, 'main main-fill', 'the LOAD door lays out by content again');
    assert.deepEqual(load, api, 'LOAD stopped measuring what API measures');
    assert.equal(load.overflow, 0, 'the page scrolls as one document');
  } finally {
    await sized.close();
  }
});

// GATE 5 + 7 — **the workload is a control, and it is one wherever `TF033` allows it.**
//
// Before this round the band drew a `LOAD` badge linked to `#/load` with the tip *"a workload is
// the LOAD door's to shape"*; followed live, that door listed all three of the example's workload
// tests as *(already a workload test)* with the arming checkbox **disabled**, and the `+ workload`
// menu entry drew a row whose `querySelectorAll('button,select,input,a')` was `[]`. A door-granted
// panel failed in **both** directions at once, which is `D1044`'s argument by demonstration.
// **Mutation: make the row live on all four doors → the BROWSER assertion fails.**
test('`M224` `B`: the workload is an ordinary clause — live on API, LOAD and SCANS, absent on BROWSER', async () => {
  const lines = await declLines('tests/load.tflw');
  for (const door of ['api', 'load'] as const) {
    await declAt(door, 'tests/load.tflw', lines[0]!);
    assert.equal(await page.locator('[data-band-workload-edit]').count(), 1, `${door} draws no workload control`);
    assert.equal(await page.locator('[data-band-workload-door]').count(), 0, `${door} still links to the LOAD door instead of editing`);
    assert.equal(await page.locator('[data-shape-cell]').count(), 8, 'the shape grid is four profiles by two units');
  }
  // **`TF033` is the reason BROWSER has none**, not a door rule: a workload may not sit beside a
  // browser step, so there is no browser test the clause could be true about.
  await declAt('browser', 'tests/load.tflw', lines[0]!);
  assert.equal(await page.locator('[data-band-workload-edit]').count(), 0, 'BROWSER offers a control for a clause it can never carry');
});

// GATE 6 — **editing the shape rewrites the file through the printer.** One click on a cell is
// both choices, which is what `D1103`'s grid is for and what a ten-option `<select>` prevented.
// **Mutation: write the line as a template string → the bytes differ on a `step` shape.**
test('`M224` `B`: one click on the grid rewrites the workload line, and the bytes are the printer’s', async () => {
  const lines = await declLines('tests/load.tflw');
  await declAt('load', 'tests/load.tflw', lines[0]!);
  assert.equal(await page.locator('[data-band-workload]').getAttribute('data-band-workload'), 'SharedIterationsWorkload');

  await page.locator('[data-shape-cell="hold:rps"]').click();
  await page.locator('[data-band-workload="HoldRpsWorkload"]').waitFor();
  const editor = page.locator('[data-band-workload-edit]');
  assert.equal(await editor.getAttribute('data-band-workload-edit'), 'hold');
  assert.equal(await editor.getAttribute('data-band-workload-unit'), 'rps');

  // The pending bytes are the file, not a rendering of it — the same claim the old form's preview
  // carried, now made about a splice into a file the author already has.
  const preview = await pendingBytes(page);
  assert.match(preview, /\n {2}hold \d+ rps for [\d.]+s\n/, preview);
  assert.ok(!preview.includes('run 120 iterations across 4 users'), 'the old line survived the edit');
  // Every other line of the test is untouched: this is a splice, not a reprint (`D1046`).
  assert.ok(preview.includes('  api GET /search?q=g as "search"'), preview);
  assert.ok(preview.includes('  threshold p95 duration for "search" is less than 500ms'), preview);
});

// GATE 7 — **the gesture that did not exist in either direction.** `+ workload` writes `D1213`'s
// own first line; `✕` takes it off and **leaves the thresholds**, which is legal (`D1044`) and is
// what keeps the test on the door it was removed from. And `TF033` still refuses the other order.
// **Mutation: return the old refusal for `workload` → the removal is refused.**
test('`M224` `B`: a workload can be written onto a test and taken off it again', async () => {
  const target = 'tests/catalog.tflw';
  const lines = await declLines(target);
  await declAt('api', target, lines[0]!);
  assert.equal(await page.locator('[data-band-workload]').count(), 0, 'this fixture test must start functional');

  const open = async (): Promise<void> => {
    await page.locator('.band-add details').evaluate((d) => { (d as unknown as { open: boolean }).open = true; });
  };
  await open();
  await page.locator('.band-add li', { hasText: 'workload' }).locator('button').first().click();
  await page.locator('[data-band-workload="RampUsersWorkload"]').waitFor();
  const written = await pendingBytes(page);
  assert.match(written, /\n {2}ramp to 5 users over 2s\n/, written);

  await open();
  await page.locator('[data-add-remove="workload"]').click();
  await page.locator('[data-band-workload]').waitFor({ state: 'detached' });
  const after = await pendingBytes(page);
  assert.ok(!after.includes('ramp to 5 users'), after);

  // The other order is still refused, and the sentence names the rule and where to go.
  await declAt('api', 'tests/load.tflw', (await declLines('tests/load.tflw'))[1]!);
  const removes = await page.locator('[data-threshold-remove]').count();
  for (let i = removes - 1; i >= 0; i -= 1) {
    await page.locator(`[data-threshold-remove="${i}"]`).click();
    await page.waitForTimeout(150);
  }
  assert.equal(await page.locator('[data-threshold-remove]').count(), 1, 'the last threshold of a workload test came off');
  assert.match((await page.locator('[data-threshold-refusal]').textContent()) ?? '', /TF033/);
});

// GATE 8 + 9 — **region 2's segment follows the construct, and the gate is taken on API.**
//
// `M223` `F`'s lesson, written into the gate before it could bite: a segment asserted only on the
// LOAD door would be green under every mutation that made it door-granted, because on that door
// the door and the construct agree. On API they do not, so this is the only place the claim is
// falsifiable. **Mutation: gate the segment on `door === 'load'` → it is absent where the
// construct earned it.**
test('`M224` `C`: a workload-bearing test earns a plan panel — on the API door', async () => {
  const loadLines = await declLines('tests/load.tflw');
  await declAt('api', 'tests/load.tflw', loadLines[0]!);
  assert.equal(await page.locator('[data-compose-region2-tab]').count(), 2, 'the plan/response segment is not on API');
  assert.equal(await page.locator('[data-compose-region2]').getAttribute('data-compose-region2'), 'plan');

  // …and it is absent on a functional test, on the same door. A segment that is always there is
  // not following anything.
  const catalog = await declLines('tests/catalog.tflw');
  await declAt('api', 'tests/catalog.tflw', catalog[0]!);
  assert.equal(await page.locator('[data-compose-region2-tab]').count(), 0, 'a functional test earned a plan panel');
});

// GATE 9 — **the achieved curve is drawn only when the two series mean the same thing.**
// `TimelinePoint` records `count`, `rps` and the duration percentiles — **arrivals**, never
// concurrency — so an `rps` plan and the run's achieved `rps` answer a question together while a
// `users` plan is a number of loops in flight. The pane says so in a sentence rather than drawing
// the line. **Mutation: drop `overlayIsComparable` → a `users` plan draws an `rps` curve.**
test('`M224` `C`: the plan is painted, and the overlay appears only where the units agree', async () => {
  const lines = await declLines('tests/load.tflw');
  await declAt('load', 'tests/load.tflw', lines[0]!);

  // The fixture's first test is an iteration shape, which has no clock at all and says so rather
  // than drawing a line to an invented right-hand edge.
  assert.equal(await page.locator('[data-compose-plan]').getAttribute('data-compose-plan'), 'no-clock');
  await page.locator('[data-load-plot-none]').waitFor();

  // A `hold users` has one, asserted on the canvas rather than on its presence — an empty chart
  // element is exactly what a broken series produces.
  await page.locator('[data-shape-cell="hold:users"]').click();
  const plot = page.locator('[data-load-plot]');
  await plot.waitFor();
  assert.ok(await paintedPixels(page.locator('[data-chart="planned"]')) > 0, 'the planned curve is drawn, not merely mounted');
  assert.equal(await plot.getAttribute('data-load-plot-overlay'), 'no');
  assert.equal(await page.locator('[data-load-plot-why]').getAttribute('data-load-plot-why'), 'not-comparable');

  // An `rps` plan does, and this fixture has run `tests/load.tflw` — so the two curves meet.
  await page.locator('[data-shape-cell="hold:rps"]').click();
  await page.locator('[data-load-plot-overlay="yes"]').waitFor();
  assert.equal(await page.locator('[data-load-plot-why]').count(), 0, 'nothing to explain when the overlay is there');
  const legend = await legendAt(page.locator('[data-chart="planned"]'), 0.5);
  assert.ok('planned rps' in legend, `the plan is a named series: ${JSON.stringify(legend)}`);
  assert.ok('achieved rps' in legend, `and the run is beside it: ${JSON.stringify(legend)}`);
});

// GATE 13 — **▶ states its cost, which is what keeps it from looking like `send`.** `D1168` warned
// in its own docblock that *"offering both on one door would be two gestures that look alike and
// mean different things"*; on LOAD they mean things that are very different, so the one that costs
// says so. `no clock` is the honest answer for the two iteration shapes — **29 of the corpus's 85
// workload lines** — not a missing feature.
// **Mutation: sum the stages for every shape → an iterations test claims a duration.**
test('`M224` `E`: ▶ on a workload names its duration, or says it has no clock', async () => {
  const lines = await declLines('tests/load.tflw');
  await declAt('load', 'tests/load.tflw', lines[0]!);
  const play = page.locator('[data-seq-play="test"]').first();
  assert.equal(await play.getAttribute('data-seq-play-price'), 'no clock', 'an iterations shape claimed a duration');

  await page.locator('[data-shape-cell="ramp:users"]').click();
  await page.locator('[data-band-workload="RampUsersWorkload"]').waitFor();
  assert.match((await play.getAttribute('data-seq-play-price')) ?? '', /^~[\d.]+s$/);

  // `send` is on this door too and carries no price — one gesture is priced and one is not, which
  // is the difference a reader can see before pressing rather than after.
  await page.locator('[data-compose-region2-tab="response"]').click();
  await page.locator('[data-seq-request]').first().click();
  /* **`M225` `A` split the press in two** (`D1215`), so the claim names the form rather than
     counting buttons: `send this` is the one this round's ▶ is being contrasted with, and the
     `send all` beside it on a multi-request test is priced exactly the same way — not at all. */
  assert.equal(await page.locator('[data-compose-send="this"]').count(), 1, 'the LOAD door does not send');
  assert.equal(await page.locator('[data-compose-send="this"]').getAttribute('data-seq-play-price'), null);

  /* And a functional test's ▶ has no price at all, because there is nothing to price.

     **It is taken on BROWSER and not on API**, which the first draft got wrong and the run caught:
     API's `vocabulary.ts` row says `plays: false`, so there is no ▶ on that door to read a missing
     price off. A control that waits 30 s for a control that cannot exist is not a control. */
  const shop = await declLines('tests/shop.tflw');
  await declAt('browser', 'tests/shop.tflw', shop[0]!);
  const functional = page.locator('[data-seq-play="test"]').first();
  await functional.waitFor();
  assert.equal(await functional.getAttribute('data-seq-play-price'), null);
});

// GATE 17 — **`hidden` means hidden** (`D1214`). `.shape-grid` shipped with
// `hidden={mode === 'existing' && !alsoWorkload}` and was fully visible and interactive: measured
// live, **29 controls** in a block declaring itself absent, about twenty of them unable to write
// anything because the checkbox that would arm them was disabled. The attribute lost on
// specificity to `.shape-grid { display: grid }`, and the stylesheet had no `[hidden]` rule.
// **Mutation: remove the `[hidden]` rule → the probe element is visible.**
test('`M224` `G`: an element with `hidden` computes `display: none`, even against its own class', async () => {
  const lines = await declLines('tests/load.tflw');
  await declAt('load', 'tests/load.tflw', lines[0]!);
  // Nothing on the live page carries the attribute any more — the clause is rendered when it is
  // open and not rendered when it is not, which is `D1214`'s own point one level up. So the rule
  // is asserted where it is stated: on an element given the class that used to outrank it.
  /* **NO NAMED FUNCTION INSIDE THIS CALLBACK** — `M222-01`, the third time in this file. `tsx`
     compiles with `--keepNames`, which wraps a `const`-bound arrow in a `__name(...)` call; that
     helper is defined in the test process and **not** in the browser the callback is serialised
     into, so the first draft of this gate failed with `ReferenceError: __name is not defined` on
     *unmutated* code — and the mutation sweep dutifully reported it RED, which is a gate passing
     its own control for the wrong reason. The two readings are written out instead. */
  const shown = await page.locator('body').evaluate((body) => {
    const doc = body.ownerDocument;
    const view = doc.defaultView!;

    const byClassProbe = doc.createElement('div');
    byClassProbe.hidden = true;
    byClassProbe.className = 'shape-grid';
    body.append(byClassProbe);
    const byClass = view.getComputedStyle(byClassProbe).display;
    byClassProbe.remove();

    const byStyleProbe = doc.createElement('div');
    byStyleProbe.hidden = true;
    byStyleProbe.setAttribute('style', 'display: grid');
    body.append(byStyleProbe);
    const byStyle = view.getComputedStyle(byStyleProbe).display;
    byStyleProbe.remove();

    return { byClass, byStyle };
  });
  assert.equal(shown.byClass, 'none', '`hidden` still loses to a class that sets `display`');
  /* **And the second reading is what `!important` is for**, which the mutation sweep had to say
     before this line existed. `[hidden]` and `.shape-grid` are the *same* specificity and `[hidden]`
     is later in the file, so the class case is won by source order alone and dropping `!important`
     left the gate green — a control that graded its own subject as not load-bearing. An **inline**
     `display` beats every selector, which is the case the rule is actually written against: `D1214`
     says the attribute is the page's way of saying *not now* and a component's own `display` must
     not outrank it, and a component that sets one inline is the form that argument takes. */
  assert.equal(shown.byStyle, 'none', '`hidden` loses to an inline `display` — the rule needs its `!important`');
  // And the live page has none that render — the measurement that found the rule missing.
  const live = await page.locator('body').evaluate((body) => {
    const view = body.ownerDocument.defaultView!;
    let n = 0;
    for (const el of body.ownerDocument.querySelectorAll('[hidden]')) if (view.getComputedStyle(el).display !== 'none') n += 1;
    return n;
  });
  assert.equal(live, 0);
});

// ---------------------------------------------------------------------------
// `M200` `A3-5` — the BROWSER door. Two tests: the door writing a whole test with a `within`
// around it, and the door adding steps to a test that already opened a page. The split matters
// because the second deliberately writes NO `open` — a browser test navigates once.
// ---------------------------------------------------------------------------

test('the BROWSER door has the same five tabs, and its run pane is only reachable through Run', async () => {
  // `M206` `S2b`. The strip propagates unchanged — the tab set is universal (`Q1`). It said *"on a
  // door whose Compose is a different form entirely"* until `M213` `S4`, which is exactly what
  // stopped being true: `BrowserForm` is retired and this door's Compose is the same pane API's
  // is, reading one row of `vocabulary.ts` (`D1094`).
  await page.goto(`${pageUrl}#/browser`);
  await page.reload();
  await page.locator('[data-door-form="browser"]').waitFor();
  assert.equal(await page.locator('[data-tabstrip]').getAttribute('data-tabstrip'), 'compose', 'a pre-strip BROWSER link stopped opening the door');

  for (const tab of ['source', 'run', 'auth', 'config'] as const) {
    await openTab(tab);
    assert.equal(new URL(page.url()).hash, `#/browser/${tab}`, `${tab} is not an address on this door`);
    assert.equal(await page.locator('[data-doorbar]').getAttribute('data-doorbar'), 'browser', 'a tab unseated the door');
  }
  await openTab('compose');
  assert.equal(new URL(page.url()).hash, '#/browser', 'the default tab stopped writing the bare door hash');

  // THE RUN PANE MOVED. Until this slice `App` rendered it inline under every door but API
  // (`{door === 'api' ? null : runPane}`), so BROWSER showed the form and the whole run list
  // stacked beneath it. It now lives in Run and nowhere else — asserted as an ABSENCE on Compose
  // and a PRESENCE on Run, because either half alone passes against a pane that was simply
  // deleted.
  assert.equal(await page.locator('.main > .runs').count(), 0, 'the run pane is still inline under the BROWSER form');
  await openTab('run');
  await page.locator('[data-door-run-tab="browser"]').waitFor();
  assert.ok((await page.locator('[data-door-run-tab="browser"] .runs').count()) > 0, 'Run does not hold the run pane it was given');

  // **THE STATE CLAIM MOVED WITH THE FORM, AND IT IS NOW ABOUT THE BUFFER** (`M213` `S4`). It used
  // to be *a typed test name survives an unmount*, which was a claim about `BrowserForm`'s own
  // `useState`. There is no name field any more — the explorer names the file and the file names
  // its tests — so what has to survive a trip to Source is the same thing API's Compose survives
  // with: the pending buffer (`D1079`), which lives above every panel in the shell.
  await openTab('compose');
  const target = (await fullProject()).files.find((f) => f.tests.length > 0)!.path;
  await page.locator(`[data-file-row="${target}"]`).click();
  await page.locator('[data-compose-summary]').waitFor();
  await openTab('source');
  assert.equal(await page.locator('[data-compose-summary]').count(), 0, 'Compose did not unmount, so surviving it proves nothing');
  await openTab('compose');
  assert.equal(await page.locator('[data-compose-file]').first().textContent(), target, 'the door came back pointed at the same file');
});

test('the LOAD door has the same five tabs, and its run pane is only reachable through Run', async () => {
  // `M207` `S1`. The third door to take the strip, and the one the measurement said needed it
  // most: LOAD was **the only door over one screen** (1003 px · 1.11 against 900 px flat on the
  // other three), because its form is twice BROWSER's and the run list sat under all of it.
  //
  // The address already parsed before this slice — `#/load/auth/tests/load.tflw` resolved through
  // `doorFromHash`, `tabFromHash` and `fileFromHash` and the hash stuck — and the page rendered no
  // strip at all. So this door had addressable tabs no gesture could reach, which is what the
  // first loop below is actually pinning.
  await page.goto(`${pageUrl}#/load`);
  await page.reload();
  await page.locator('[data-compose-pane]').waitFor();
  assert.equal(await page.locator('[data-tabstrip]').getAttribute('data-tabstrip'), 'compose', 'a pre-strip LOAD link stopped opening the door');

  for (const tab of ['source', 'run', 'auth', 'config'] as const) {
    await openTab(tab);
    assert.equal(new URL(page.url()).hash, `#/load/${tab}`, `${tab} is not an address on this door`);
    assert.equal(await page.locator('[data-doorbar]').getAttribute('data-doorbar'), 'load', 'a tab unseated the door');
  }
  await openTab('compose');
  assert.equal(new URL(page.url()).hash, '#/load', 'the default tab stopped writing the bare door hash');

  // THE RUN PANE MOVED, asserted as an ABSENCE on Compose and a PRESENCE on Run — `S2b`'s finding
  // carried forward, because either half alone passes against a pane that was simply deleted.
  assert.equal(await page.locator('.main > .runs').count(), 0, 'the run pane is still inline under the LOAD form');
  await openTab('run');
  await page.locator('[data-door-run-tab="load"]').waitFor();
  assert.ok((await page.locator('[data-door-run-tab="load"] .runs').count()) > 0, 'Run does not hold the run pane it was given');

  /* **THE STATE CLAIM MOVED WITH THE PANE, AND IS NOW A WEAKER CLAIM HONESTLY STATED** — `M224`
     `D`. It used to type into two `LoadForm` fields, leave the tab and find them still typed: the
     values were `useState` above the panels, so Compose genuinely unmounted and they survived.
     `ComposeDoor` holds no such fields. What it holds is the **draft**, which is a different and
     better thing to assert, because it is the bytes rather than a form's memory of them — and it
     is already pinned by the API door's own dirty-buffer gates. So the surviving half here is the
     unmount control, kept because without it the claim above proves nothing: Compose has to
     actually go away for *Run does not hold it* to mean anything. */
  await openTab('source');
  assert.equal(await page.locator('[data-compose-pane]').count(), 0, 'Compose did not unmount, so surviving it proves nothing');
  await openTab('compose');
  await page.locator('[data-compose-pane]').waitFor();
});

test('LOAD now measures what a door with a strip measures — tab for tab, against the two that have one', async () => {
  // `M207` §1's facts table, re-read as a gate rather than quoted — and the claim is **parity with
  // the doors that already adopted the strip**, not a constant. At 1440x900 LOAD was the only door
  // over one screen (1003 px · 1.11 against 900 px flat), because its form is twice BROWSER's and
  // the run list sat under all of it unconditionally.
  //
  // **THE PLAN'S GATE LINE SAID "`main` ONE SCREEN ON EACH" AND THAT IS FALSE, ON EVERY DOOR,
  // SINCE THE STRIP EXISTED.** Measured here across all three: Compose, Source, Auth and Config are
  // 900 px flat, and **Run is 3451 px on API, on BROWSER and on LOAD alike** — API's shipped in
  // `M205` and BROWSER's in `M206`, so this is neither new nor LOAD's. A report is charts, a
  // histogram, an endpoint table and a step list; it is long because of what it is, and you are on
  // the Run tab because you asked to read one. That is chosen scrolling, which is the thing the
  // strip converted the old unconditional stacking INTO.
  //
  // So the assertion is that LOAD's five numbers equal the other two doors' five numbers. It is
  // stronger than the constant it replaces — it cannot go stale when a fixture report grows, and it
  // reddens the moment this door stops matching the pattern it was built to join — and it is the
  // only form of the claim that is true.
  //
  // **IT READS `scrollHeight`, AND THE FIRST DRAFT READ `boundingBox()` AND WAS VACUOUS.** `.main`
  // is `overflow: auto` inside a `height: 100%` grid, so its BOX is the scroll port and is the
  // viewport height on every page this app can render — that reading would have been 900 against
  // §1's own 4,118-screen case. It was caught by the mutation and not by reading the stylesheet:
  // restoring LOAD's inline run pane left the box version green while the strip test beside it went
  // red.
  const sized = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    const read = async (door: 'api' | 'browser' | 'load'): Promise<Record<string, number>> => {
      await sized.goto(`${pageUrl}#/${door}`);
      await sized.reload();
      await sized.locator('[data-doorbar]').waitFor();
      const out: Record<string, number> = {};
      for (const tab of ['compose', 'source', 'run', 'auth', 'config'] as const) {
        await sized.locator(`[data-tab="${tab}"]`).click();
        await sized.locator(`[data-tabstrip="${tab}"]`).waitFor();
        out[tab] = await sized.locator('.main').evaluate((el) => el.scrollHeight);
      }
      return out;
    };

    const api = await read('api');
    const browserDoor = await read('browser');
    const load = await read('load');
    // **Compose is excluded from the parity, and `D1042` is why — it was always allowed to differ.**
    // *"The door decides what the 'new test' surface is, and nothing else"* has been the rule since
    // `M200` `A0-3`; all four doors merely happened to carry forms of the same height, so a parity
    // over all five tabs was true without being a claim about anything. `M210` `S1` gives API a
    // Compose that **reads the open file** and leaves the other three doors' forms alone by decision
    // (§5), so the numbers part company here first. Asserting they still match would be asserting
    // the round did not happen.
    const shared = (m: Record<string, number>): Record<string, number> => ({ source: m.source!, run: m.run!, auth: m.auth!, config: m.config! });
    assert.deepEqual(shared(load), shared(api), 'LOAD does not measure what API measures on the tabs the shell builds once');
    assert.deepEqual(shared(load), shared(browserDoor), 'LOAD does not measure what BROWSER measures on the tabs the shell builds once');
    // **THIS LINE USED TO SAY THE TWO DOORS' COMPOSE IS EQUAL, AND THAT WAS A COINCIDENCE THE WAY
    // THE FIVE-TAB PARITY ABOVE WAS A COINCIDENCE.** `M213` `S1` changed the default theme from
    // `Instrument` to `Terminal` (`D1107`) and this went red at **904 against 900** — so the round
    // measured the same two doors in all four themes on the box, which is the measurement that
    // should have been taken when the themes landed:
    //
    //     door      Instrument  Terminal  Paper  Ribbon
    //     BROWSER      900        900      900    900
    //     LOAD         900        904      934    963
    //
    // BROWSER has slack. **LOAD's form sat at exactly one screen under the densest of the four
    // themes and is over it under the other three** — by 4 px, 34 px and 63 px — because `--unit`
    // runs 6 px, 7 px, 9 px, 11 px and this is the tallest form in the app. So the equality was
    // true of one theme and had been false of three since the day `S0` shipped them, with nothing
    // able to say so: `ui-page` renders the default and only the default.
    //
    // The claim that survives is the one that is about the shell. How far over LOAD is gets
    // measured **per theme, in the appearance gate**, where a theme-dependent number belongs —
    // `ui-page.test.ts` has no business pinning one. `M213-14`; `S6` rebuilds this pane (`D1103`)
    // and is where it comes back under the line.
    //
    // **AND THE OTHER HALF OF THE COMPARISON IS GONE, BECAUSE `M213` `S4` RETIRED THE FORM IT WAS
    // ABOUT.** The line above this one read `browserDoor.compose === 900` — *"BROWSER's form is
    // still the one-screen form"* — and `D1094` is precisely the decision that it is not a form
    // any more: BROWSER's Compose is the same reader API's is, so it is as tall as the file has
    // declarations. Measured the same run: **1094 px on the default theme**, 1118 at the loosest.
    // Restating the old equality would be asserting the slice did not happen, and holding a reader
    // to a form's bar is holding it to the one property it deliberately no longer has.
    //
    // What replaces it is the claim `S4` actually makes — **the two doors are one implementation**
    // — and the way to state that here is that they move together: both are readers of the same
    // file, so either both fit a screen or neither does, and a change that made one a form again
    // would break this without needing a number.
    //
    // **AND `M219` `A` MOVED BOTH OF THEM, WHICH IS WHY THIS LINE CHANGED AGAIN** (`D1160`). The
    // assertion here read `browserDoor.compose > 900` — *"BROWSER's Compose reads the file now, so
    // it is taller than the form it replaced"* — which was true of the pane `M213` `S4` gave it
    // and is false of the pane it has now: `M214` replaced a document as tall as its file with
    // **three regions that each scroll inside themselves** (`D1110`), and `M219` deleted the fork
    // that kept BROWSER on the old one. So the two doors do not merely *move together*; they are
    // the same component with a different vocabulary table, and the equality below says so
    // directly. It is the strongest form of `D1160` this gate can state, and a fork coming back
    // reddens it without a number to keep current.
    assert.ok(browserDoor.compose! <= 900, `BROWSER runs the same three regions API does, so the shell does not scroll (${browserDoor.compose} px)`);
    assert.equal(
      browserDoor.compose,
      api.compose,
      `one pane, two doors (\`D1160\`) — API measures ${api.compose} px and BROWSER ${browserDoor.compose}`,
    );
    /**
     * **And LOAD's half is now the same equality, which is what `M224` `D` did to it** (`D1210`).
     *
     * It read `load.compose < browserDoor.compose` — *"LOAD is still the form"* — until `M219` `A`
     * made that a true consequence of nothing (**API 900, BROWSER 900, LOAD 900, SCANS 900**, so
     * neither `<` nor `>` held). It was then asserted structurally, *LOAD draws its own form and
     * none of the pane's rows*, with a note saying `D1103`'s `S6` is where that changes — and it
     * is `M224` that changed it: the same component, a third vocabulary row, no `LoadForm` at all.
     *
     * So the structural assertion inverts rather than disappearing. It has to be the **rows** and
     * not the height, for the same reason the equality above is: four doors at 900 px satisfy any
     * height claim you write.
     */
    await sized.goto(`${pageUrl}#/load`);
    await sized.reload();
    await sized.locator('[data-compose-pane]').waitFor();
    /* `M235-09` — **the wait above WAS satisfied by the pane saying it is NOT ready.** The reading
       branch rendered `data-compose-pane="reading"`, so `[data-compose-pane]` matched it, and the
       `count()` underneath answered `0` against a pane that had drawn nothing yet. That was always
       true; `M235-07`'s `ownOutline` widened the window it fires in, and the next sweep reddened it
       at 1 of 56 — which is the repair working as an instrument even as it made this site
       marginally more likely. **Repaired at the marker in `M236` `C`** (`D-M236-3`): the placeholder
       is `[data-compose-placeholder]` now and the wait above is correct as written. The `settle`
       below stays, because it is this site's own measured reproduction and removing the belt that
       caught the defect is how a round loses the evidence it was opened by.
       The rows are established first and the absence is read after, because an absence over a set
       that has not painted passes for the wrong reason — the same ordering `C2` applied to four
       emptiness claims. */
    const rows = await settle(
      () => sized.locator('[data-seq-row]').count(),
      untilMeasurable('the pane has drawn the file it is reading', (n) => n > 0),
      { attempts: 40, delayMs: 50, page: sized },
    );
    assert.ok(rows.value > 0, `LOAD draws none of the pane’s rows (${rows.attempts} look(s))`);
    // one-shot: the rows above establish that the pane is drawn, so this absence is a claim about
    // the door rather than about a pane still reading
    assert.equal(await sized.locator('[data-load-form]').count(), 0, 'LOAD still draws its own form');

    // And the shape of those numbers, stated rather than left implicit — otherwise three doors
    // that had all regressed identically would satisfy the parity above.
    // `compose` leaves this loop for the reason above: it is the door's own surface and it is
    // theme-dependent. The three the shell builds are not, and are still pinned.
    for (const tab of ['source', 'auth', 'config'] as const) {
      assert.equal(load[tab], 900, `LOAD's ${tab} is ${load[tab]} px, not the one screen every door's ${tab} is`);
    }
    // **API's Compose went the other way in `M214`, and that is the round's whole shape** (`D1110`).
    // It was the tallest pane here — a document that drew a file's outline plus one request and was
    // as tall as the file — and it is now three regions that each scroll inside themselves, so the
    // shell does not scroll at all. *Taller than a screen* has stopped being true of it and
    // `<= 900` is the claim that replaced it: the pane fills the window and does not exceed it.
    //
    // How far it fits is checked where a theme-dependent number belongs — `ui-appearance.test.ts`
    // writes a thirteen-request file and holds every region's bottom edge to the fold, in all four
    // themes, which is the property the 1.50-screen bar could never state.
    assert.ok(api.compose! <= 900, `API's Compose is three regions that scroll inside themselves, so the shell does not scroll (${api.compose} px)`);
    assert.ok(load.run! > 900, 'Run fits in a screen, so this fixture has no report and the parity above is between three empty panes');

    // The control this gate needs to mean anything: the instrument can read an overflow at all.
    // Without it `=== 900` is one CSS change away from being the same vacuous assertion the
    // bounding-box reading was, and nothing would say so.
    // The probe is made through `el.ownerDocument` rather than the `document` global: this file is
    // typechecked under `types: ["node"]` with no DOM lib, so the global does not exist for `tsc`
    // even though it exists in the browser this callback is serialised into. `el` is typed by
    // Playwright, so reaching the document through it costs nothing and compiles.
    /* **AND IT HAS TO BE TAKEN OFF Compose SINCE `M224` `D`.** `main-fill` (`D1193`) makes `.main`
       a grid that claims the window and does not grow, so a 4000 px probe appended to it on the
       Compose tab measures **900** — the control would have reported the instrument blind when
       what it had actually found is the layout working. Taken on Source, where `.main` is the
       ordinary scrolling column the parity numbers above are read from. */
    await sized.goto(`${pageUrl}#/load/source`);
    await sized.locator('[data-tabstrip="source"]').waitFor();
    const overflowed = await sized.locator('.main').evaluate((el) => {
      const probe = el.ownerDocument.createElement('div');
      probe.style.height = '4000px';
      el.appendChild(probe);
      const measured = el.scrollHeight;
      probe.remove();
      return measured;
    });
    assert.ok(overflowed > 900, `the instrument cannot see an overflow — it read ${overflowed} px against 4000 px of injected content`);
  } finally {
    await sized.close();
  }
});

test('SCANS adopts the strip, and with it no door renders its runs inline any more', async () => {
  // `M207` `S2`, the last door. The tab set is universal (`M206` `Q1`), so the first loop is the
  // same five at the same addresses for the fourth time — and the claim worth making here is the
  // one that only becomes true at this slice: `App.tsx`'s conditional between the two placements
  // is **gone** rather than narrowed. `M205` `S5a` gave API a Run tab and left the other three
  // stacking the run list under their form; `S2b` took BROWSER, `S1` took LOAD, and this takes the
  // last one.
  await page.goto(`${pageUrl}#/scan`);
  await page.reload();
  /* `M228` `B` (`D1237`) — this waited on `[data-scan-form]`, and there is no scan form any more.
     The door draws the standard pane like the other three, so the wait is the pane's own grid. */
  await page.locator('.compose-pane-grid').waitFor();
  assert.equal(await page.locator('[data-tabstrip]').getAttribute('data-tabstrip'), 'compose', 'a pre-strip SCANS link stopped opening the door');

  for (const tab of ['source', 'run', 'auth', 'config'] as const) {
    await openTab(tab);
    assert.equal(new URL(page.url()).hash, `#/scan/${tab}`, `${tab} is not an address on this door`);
    assert.equal(await page.locator('[data-doorbar]').getAttribute('data-doorbar'), 'scan', 'a tab unseated the door');
  }
  await openTab('compose');
  assert.equal(new URL(page.url()).hash, '#/scan', 'the default tab stopped writing the bare door hash');

  assert.equal(await page.locator('.main > .runs').count(), 0, 'the run pane is still inline under the SCANS door');
  await openTab('run');
  await page.locator('[data-door-run-tab="scan"]').waitFor();
  assert.ok((await page.locator('[data-door-run-tab="scan"] .runs').count()) > 0, 'Run does not hold the run pane it was given');

  // **THE UNIVERSAL CLAIM, WHICH NO EARLIER SLICE COULD MAKE.** Every door, not this one: after
  // `S2` the inline placement does not exist for any value of `door`, so it is checked by walking
  // all four rather than by trusting that three previous gates still hold. A conditional narrowed
  // to a door that no longer needs it would pass every per-door test above and fail this.
  for (const door of ['api', 'browser', 'load', 'scan'] as const) {
    await page.goto(`${pageUrl}#/${door}`);
    await page.reload();
    await page.locator('[data-doorbar]').waitFor();
    assert.equal(await page.locator('.main > .runs').count(), 0, `${door} still renders its runs inline`);
  }

  /* **The state claim this test used to make is gone with the form it was about** — `M228` `B`
     (`D1237`). It drove `data-scan-mode` / `data-scan-name` / `data-scan-family` across a tab
     unmount, and those three controls were `ScanForm`'s: the `<select>` asking which test to
     append to, the name of a test it would create, and the family it would write. The pane the
     door draws now has no such fields, and the equivalent claim — the editor's own tab selection
     is held ABOVE the pane so a glance at Source does not lose a half-typed header — is `M205`
     `S5a`'s rule and is gated on the pane itself rather than per door.

     Deleted rather than re-pointed, because a re-pointed version would be a fifth copy of a claim
     three doors already make about one component. */
});

test('SCANS’ Compose predicts and Auth enumerates — one tflw.config, two claims, neither listed twice', async () => {
  // `M207` `Q1`. Both surfaces describe `authorized target` out of one file, one tab apart, and the
  // temptation was to deduplicate them. They are not the same claim: **Auth answers *what is in
  // force*, Compose answers *what your next write will hit*** — a prediction about an assertion
  // that does not exist yet, which Auth cannot make because Auth is not where you are writing.
  //
  // So Compose keeps the forward-looking sentence and gains a LINK, and Auth stays the only place
  // that enumerates. The gate is therefore two-sided: the link works, and Compose does **not**
  // list a target. A gate that only clicked the link would pass against a Compose that had grown
  // its own copy of the list beside it.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-scan-unauth-'));
  const fresh = await newPage();
  try {
    execFileSync(process.execPath, ['--import', tsxLoader, cliEntry, 'init', '--scan'], { cwd: dir, stdio: 'pipe' });
    const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
    try {
      const base = `http://127.0.0.1:${await ui.listen(0)}`;
      await fresh.goto(`${base}/?token=${TOKEN}#/scan/compose/scan.tflw`);
      await fresh.locator('[data-compose-scan-unauthorized]').waitFor();

      // `tflw init --scan` leaves the line commented out on purpose (`D291`), so this project is
      // the unauthorized state — which is the only state the notice renders in today, and the
      // reason `S5` exists at all.
      const notice = (await fresh.locator('[data-compose-scan-unauthorized]').textContent()) ?? '';
      assert.match(notice, /TF060/, 'the notice stopped naming what the write will get');

      /* **COMPOSE DOES NOT ENUMERATE, AND `M228` `A` NEARLY BROKE THIS.** `D1239` was scoped as
         *the targets in force with their reasons* — an inventory, which is precisely what `Q1`
         reserves to Auth. The panel shows the other axis instead: one row per origin a scan in
         this env can REACH, and whether a declaration covers it. So the two assertions here are
         now a pair rather than one, because this gate could have gone on passing against a second
         copy of Auth's list spelled with different attributes. */
      assert.equal(await fresh.locator('[data-compose-scan] [data-auth-targets]').count(), 0, 'Compose grew its own copy of the target list');
      assert.equal(
        await fresh.locator('[data-compose-scan] [data-auth-target]').count(),
        0,
        'Compose is listing target DECLARATIONS, which is what Auth is for — it may only say what a scan here reaches',
      );
      assert.ok(
        (await fresh.locator('[data-compose-scan-reach-url]').count()) > 0,
        'and it does say that much — a panel naming no origin at all predicts nothing',
      );

      // The link goes to Auth — the address, not just the panel, because the tab living in the URL
      // and nowhere else is `D1045` and is what makes this shareable rather than a callback.
      await fresh.locator('[data-compose-scan-auth-link]').click();
      await fresh.locator('[data-tabstrip="auth"]').waitFor();
      assert.equal(new URL(fresh.url()).hash, '#/scan/auth/scan.tflw', 'the link did not put the tab in the address');
      await fresh.locator('[data-auth-targets]').waitFor();
    } finally {
      await ui.close();
    }
  } finally {
    await fresh.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('an unsaved tflw.config edit survives a door change, because a project fact is not one door’s', async () => {
  // `M206` `S2a`'s consequence, observable only now that a second door has a strip — which is why
  // it is gated here rather than claimed in the slice that caused it.
  //
  // `S5a` held the config editor's state in `ApiForm`. That was the right height while one door
  // had a strip and wrong the moment a second did: a copy per door is four editors over one
  // project file, disagreeing about what is unsaved. The state is the shell's now, so walking away
  // to a different KIND OF WORK no longer throws away an edit you have not saved — the same
  // argument the tab case already won.
  await page.goto(`${pageUrl}#/browser/config`);
  await page.reload();
  await page.locator('[data-api-config-text]').waitFor();
  const original = await page.locator('[data-api-config-text]').inputValue();
  await page.locator('[data-api-config-text]').fill(`${original}\n# an edit nobody saved\n`);
  await page.locator('[data-tab-mark="config"]').waitFor();

  // Leave by the DOOR, not by the tab — the whole point of this gate.
  await page.locator('[data-door-tab="api"]').click();
  await page.locator('[data-door-form="api"]').waitFor();
  await page.locator('[data-door-tab="browser"]').click();
  await page.locator('[data-door-form="browser"]').waitFor();
  await openTab('config');
  assert.match(await page.locator('[data-api-config-text]').inputValue(), /an edit nobody saved/, 'a door change threw away an unsaved config edit');

  // Put it back, so this test leaves the project as it found it for whatever runs next.
  await page.locator('[data-api-config-text]').fill(original);
});

test('Config shows the documents this project declares, addressed by `@env`', async () => {
  // `M208` `S2` (`Q2`). The Config tab was already the one tab whose subject is not the addressed
  // file — it renders `tflw.config` while the hash names the `.tflw` — and that is the strip's rule's
  // second clause working, not an exception to it. What there was no pattern for is *which* project
  // document Config shows, because until `M208` there was only ever one. `@env` is that pattern.
  //
  // The fixture declares `baseline "./security-baseline.json"` on `env headers` and on no other
  // block, which is deliberate and measured: `full` and `headers` exist to hold the SAME finding
  // once gating and once known/accepted, so a `defaults` line would baseline it in both and delete
  // the contrast a dozen assertions above read as their oracle.
  await page.goto(`${pageUrl}#/scan/config`);
  await page.reload();
  await page.locator('[data-api-config-text]').waitFor();

  // Two entries: `tflw.config` and the one declared baseline. Not three — `defaults` and `env full`
  // declare none, and a switcher that listed every block would be listing documents that do not
  // exist.
  const picks = page.locator('[data-config-doc]');
  assert.deepEqual(await picks.evaluateAll((els) => els.map((e) => e.getAttribute('data-config-doc'))), ['config', 'headers']);
  assert.equal(await page.locator('[data-api-config]').getAttribute('data-config-showing'), 'config', 'it opens on tflw.config, which is every pre-M208 address');
  assert.match(await page.locator('[data-api-config-text]').inputValue(), /authorized target/, 'and that is really the config');

  // Clicking the baseline changes the document AND the address, because `D1045` says the choice
  // lives in the URL and nowhere else — so this is linkable and the back button walks out of it.
  await picks.nth(1).click();
  await page.locator('[data-api-config][data-config-showing="headers"]').waitFor();
  assert.equal(new URL(page.url()).hash, '#/scan/config/@headers');
  const doc = JSON.parse(await page.locator('[data-api-config-text]').inputValue()) as { version: number; accepted: { fingerprint: string }[] };
  assert.equal(doc.version, 1);
  assert.deepEqual(doc.accepted.map((a) => a.fingerprint), ['d1a3ef65f88fb550'], 'the document the headers corpus is actually graded against');

  // The address is the state, so a reload lands back on the same document with nothing remembered
  // anywhere. That is the claim `D1045` makes and the one a click alone cannot prove.
  await page.reload();
  await page.locator('[data-api-config][data-config-showing="headers"]').waitFor();
  assert.match(await page.locator('[data-api-config-text]').inputValue(), /d1a3ef65f88fb550/);

  // Back out, and `tflw.config` is what Config shows again — the default being the ABSENCE of the
  // segment is what keeps every link written before `M208` meaning what it meant.
  await page.goBack();
  await page.locator('[data-api-config][data-config-showing="config"]').waitFor();
  assert.match(await page.locator('[data-api-config-text]').inputValue(), /authorized target/);
});

test('an unsaved edit in one document survives a trip to another, and the mark says so', async () => {
  // The per-document state, which is the half of `S2` that is not the address. `S5a` found that the
  // strip unmounts panels, so an edit held below this shell is an edit a glance throws away; `S2a`
  // moved it up one level for the config. A second document makes the same mistake available one
  // level in — an author who types into a baseline, looks at `tflw.config` and comes back must
  // still have their edit, and the mark must keep saying so while they are away.
  await page.goto(`${pageUrl}#/scan/config/@headers`);
  await page.reload();
  await page.locator('[data-api-config][data-config-showing="headers"]').waitFor();
  const original = await page.locator('[data-api-config-text]').inputValue();
  await page.locator('[data-api-config-text]').fill(original.replace('"accepted"', '"accepted" '));
  await page.locator('[data-tab-mark="config"]').waitFor();

  // Away to the other document, and back.
  await page.locator('[data-config-doc="config"]').click();
  await page.locator('[data-api-config][data-config-showing="config"]').waitFor();
  assert.equal(await page.locator('[data-tab-mark="config"]').count(), 1, 'the mark went quiet while the edited document was not the one on screen');
  await page.locator('[data-config-doc="headers"]').click();
  await page.locator('[data-api-config][data-config-showing="headers"]').waitFor();
  assert.match(await page.locator('[data-api-config-text]').inputValue(), /"accepted" /, 'a document change threw away an unsaved edit');

  // Put it back, so this test leaves the project as it found it.
  await page.locator('[data-api-config-text]').fill(original);
  await page.locator('[data-tab-mark="config"]').waitFor({ state: 'detached' });
});

test('[accept] stages a finding into the baseline and opens it — and writes nothing until you save', async () => {
  // `M208` `S3` (`Q1`). `M206` `Q6` refused a bare `[accept]` **button** on `M205`'s one-editor
  // finding, and that refusal left the feature with no page affordance at all — which collides with
  // `D387`'s own adoptability argument, since a page that shows you a 16-character fingerprint and
  // asks you to copy it is exactly the hand-transcription `--baseline-write` exists to prevent.
  //
  // So `[accept]` is `[edit]`'s shape: it stages the entry into the editor and navigates there,
  // unsaved. **The negative control is the whole row** — an author who accepts and then walks away
  // must have changed nothing on disk, because the affirmation is theirs to make (`D291`).
  const docPath = join(root, 'security-baseline.json');
  const onDisk = await readFile(docPath, 'utf8');
  const before = JSON.parse(onDisk) as { accepted: { fingerprint: string }[] };
  assert.deepEqual(before.accepted.map((a) => a.fingerprint), ['d1a3ef65f88fb550'], 'the fixture starts with one accepted finding');

  await openReport('headers');
  // Offered on the finding that is gating, and NOT on the one the baseline already withholds —
  // accepting what is already accepted is a button with nothing behind it.
  assert.equal(await page.locator('[data-accept-finding="f9ea851f1285230b"]').count(), 1);
  assert.equal(await page.locator('[data-accept-finding="d1a3ef65f88fb550"]').count(), 0, 'already known/accepted');

  await page.locator('[data-accept-finding="f9ea851f1285230b"]').click();

  // It lands in the right document, at the entry — not near it. The document is `@headers` because
  // that is the block declaring the baseline this run graded against; the server resolved that, so
  // the page is not deriving the `defaults` fallback a second time.
  await page.locator('[data-api-config][data-config-showing="headers"]').waitFor();
  assert.match(new URL(page.url()).hash, /^#\/api\/config\/@headers\/L\d+$/);
  const staged = await page.locator('[data-api-config-text]').inputValue();
  assert.deepEqual(
    (JSON.parse(staged) as { accepted: { fingerprint: string }[] }).accepted.map((a) => a.fingerprint),
    ['d1a3ef65f88fb550', 'f9ea851f1285230b'],
    'the existing entry survives and the new one is last',
  );
  assert.match(await selectedText(page, '[data-api-config-text]'), /f9ea851f1285230b/, 'the address must land on the entry it staged');

  // THE NEGATIVE CONTROL. Nothing on disk, before or after walking away — and the staged edit is
  // still there when you come back, because an unsaved edit is the shell's state (`S2`).
  assert.equal(await readFile(docPath, 'utf8'), onDisk, '[accept] wrote to disk');
  await openTab('run');
  await openTab('config');
  assert.equal(await readFile(docPath, 'utf8'), onDisk, 'a trip through another tab wrote to disk');
  assert.match(await page.locator('[data-api-config-text]').inputValue(), /f9ea851f1285230b/, 'the staged entry was thrown away');

  // And saving is what writes it — the other half of the control, without which the two rows above
  // would pass on a page that can never write anything.
  await page.locator('[data-api-config-save]').click();
  await page.locator('[data-api-config-saved]').waitFor();
  assert.deepEqual(
    (JSON.parse(await readFile(docPath, 'utf8')) as { accepted: { fingerprint: string }[] }).accepted.map((a) => a.fingerprint),
    ['d1a3ef65f88fb550', 'f9ea851f1285230b'],
  );

  // Put the project back as it was found, through the page, so the etag this page holds stays true.
  await page.locator('[data-api-config-text]').fill(onDisk);
  await page.locator('[data-api-config-save]').click();
  await page.locator('[data-api-config-saved]').waitFor();
  assert.equal(await readFile(docPath, 'utf8'), onDisk);
});

test('[accept] under an env with no baseline says what to declare, rather than failing quietly', async () => {
  // `env full` declares none and neither does `defaults`, so a `full` run grades against nothing.
  // The button is still offered and the click is still useful: it lands on Config with the
  // server's own sentence about what is missing. A page that hid the affordance would leave the
  // commonest state — a project that has not adopted triage — with no route into adopting it.
  await openReport('full');
  await page.locator('[data-accept-finding="d1a3ef65f88fb550"]').click();
  await page.locator('[data-api-config-problem]').waitFor();
  const said = (await page.locator('[data-api-config-problem]').textContent()) ?? '';
  assert.match(said, /no `baseline` is declared for env `full`/);
  assert.match(said, /declare one in tflw\.config/);
  // And it landed on `tflw.config` itself, which is where that declaration goes.
  assert.equal(await page.locator('[data-api-config]').getAttribute('data-config-showing'), 'config');
});

test('`M213` `S4`: the BROWSER door composes — `+ open`, `+ click`, and the rows are the file’s own', async () => {
  // **THIS IS WHAT `BrowserForm` WAS, AND THE DIFFERENCE IS THE SUBJECT** (`D1094`, `M213-08`).
  // The retired form asked *which test do you want to append to* through a `<select>`, with the
  // file as an argument; this pane draws the file and you point at a declaration. Same three
  // actions — `click`, `fill`, `expect` — reached the way every other door reaches its own.
  await page.goto(`${pageUrl}#/browser`);
  await page.reload();
  await page.locator('[data-door-form="browser"]').waitFor();

  /* **`shop.tflw`, and the reason is a checker rule rather than a preference.** The first draft
     used `tests/orders.tflw`, which carries a workload-bearing test — and `TF033` refuses browser
     steps inside one (`D19`). So the gesture wrote a statement the pane was happy to build and
     `tflw check` correctly rejected, which is the gate doing its job: a door's vocabulary table
     says what this pane can *construct*, and it is not and should not be a second copy of the
     checker's rules about where a construct may stand. */
  const target = 'tests/shop.tflw';
  await page.locator(`[data-file-row="${target}"]`).click();
  await page.locator('[data-compose-summary]').waitFor();
  const before = await readFile(join(root, target), 'utf8');

  /* **THE TWO DOORS RUN ONE PANE FROM `M219` `A`** (`D1160`), and this is where that is held.
     Measured when the round was scoped: **30 data-attributes existed on the API door and not on
     BROWSER, and 32 the other way** — the request-grouped sequence, the editor column, `send`, the
     response box and both of `M217`/`M218`'s additions were all API-only, and this gate was green
     throughout. The three below are the ones that separated the panes, asserted in both
     directions so the fork coming back reddens this rather than passing quietly. */
  /* `M234` `A` — THE WAIT IS THE ASSERTION (`D1308`). These were a wait followed by three
     unprotected `count()` reads, and the hazard is written down twelve lines below this very
     block: *"`count()` and `evaluateAll` do not retry, and the foot is redrawn whenever the
     address moves"*. Waiting for one row and then counting rows is the case that note calls out
     by name — *the button that was waited for is not the list that is then read* — so a redraw
     between the two reads zero and reports this door as having no sequence column at all. Node 24
     failed exactly that in CI on a commit the box ran 203/203. */
  await page.locator('[data-seq-row]').first().waitFor()
    .catch(() => assert.fail('the sequence column is this door’s too'));
  await page.locator('[data-editor]').first().waitFor()
    .catch(() => assert.fail('and so is the editor beside it'));
  /* The absence claim keeps its `count()`, and the two waits above are what make it mean anything:
     a non-retrying count of zero read before the pane has drawn is a FALSE PASS — the same race in
     the direction that says nothing rather than the direction that fails. */
  // one-shot: the two waits directly above are what make this absence mean anything, and the
  // comment over them is the argument — a retry here would weaken a claim that is already sound
  assert.equal(await page.locator('[data-body-rows]').count(), 0, 'the pane `M214` left behind is gone from every door, not narrowed');

  /**
   * The vocabulary is the door's, read off the table and not off this file.
   *
   * **Read as ONE attribute, through a retrying wait, and both halves of that cost a run.**
   * `count()` and `evaluateAll` do not retry, and the foot is redrawn whenever the address moves —
   * so a snapshot of the six buttons taken between two commits reads **zero of them** and reports
   * an empty list as a disagreement with the table. Waiting for one button first does not fix it:
   * the button that was waited for is not the list that is then read. `data-seq-adds` is the list
   * as one string, which is why the pane carries it — and putting the value in the SELECTOR makes
   * the wait itself the retry, without reaching for Playwright's `expect` in a file that asserts
   * with `node:assert`.
   */
  const WANT = 'open,click,fill,let,step,record';
  /* The selector carries the value, so the wait IS the assertion and retries like every other
     `waitFor` on this page. The `getAttribute` under it is for the message a failure needs. */
  await page.locator(`[data-seq-foot][data-seq-adds="${WANT}"]`).waitFor().catch(() => undefined);
  assert.equal(await page.locator('[data-seq-foot]').getAttribute('data-seq-adds'), WANT, 'the foot draws the door’s vocabulary, in the table’s order');
  // one-shot: the `data-seq-adds` wait above has already drawn the foot, so this absence is read
  // off a foot that is known to be painted — the same argument as the `[data-body-rows]` claim
  assert.equal(await page.locator('[data-seq-add="request"]').count(), 0, '`+ request` is API’s word, not this door’s');

  /* **The gesture lands ON the statement it wrote** — `D1136`, which this door needed only from
     `M219` `A`: the pane it used to draw made every row a live form, so a statement spliced at the
     foot was editable where it landed. This one draws one editor, for whatever the address names,
     so a `+ click` that moved nothing would put a `change me` fourteen rows down a list nobody is
     pointing at — `M217` `§2.1`'s finding, inherited by the gesture that never needed the fix. */
  await page.locator('[data-seq-add="click"]').first().click();
  await page.locator('[data-script="click"]').waitFor();
  assert.equal(await page.locator('[data-editor-statement]').getAttribute('data-editor-statement'), 'ClickStmt');

  /* **The placeholder reads as unfinished, and that is a decision the builder forced.** A blank
     locator is refused outright (*"a `button` locator needs something to match"*), so the choice
     was never *blank or plausible* — it was *plausible or obviously unfinished*, and a default
     reading `"Buy"` is a test that looks written and asserts about an element nobody chose. */
  const row = page.locator('[data-script="click"]');
  assert.equal(await row.locator('[data-locator-value]').inputValue(), 'change me');
  // The row is a real editor over the statement the gesture just wrote, so filling it edits the
  // file rather than a form's private state.
  await row.locator('[data-locator-kind]').selectOption('text');
  await row.locator('[data-locator-value]').fill('Add to cart');

  await page.locator('[data-tab="source"]').click();
  await page.locator('[data-tabstrip="source"]').waitFor();
  const text = (await page.locator('[data-preview]').textContent())!;
  assert.match(text, /^ {2}click text "Add to cart"$/m);

  // And `tflw check` reads what Compose is holding — the claim that makes the pane worth anything
  // (`D1052`). Written first, because the buffer is not the file until it is (`D1079`).
  await page.locator('[data-tab="compose"]').click();
  await page.locator('[data-tabstrip="compose"]').waitFor();
  await page.locator('[data-compose-write]').click();
  await page.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
  const after = await readFile(join(root, target), 'utf8');
  assert.match(after, /click text "Add to cart"/);
  const check = execFileSync(process.execPath, ['--import', tsxLoader, cliEntry, 'check'], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  assert.ok(!/error/i.test(check), check);

  await writeFile(join(root, target), before, 'utf8');
});

test('`M221` `A`+`B`: the stage is under the columns with room for the viewer, and ▶ no longer refuses an unsaved buffer', async () => {
  /**
   * **THE STAGE** — `M221` `A` (`D1181`), which amends `D1179`.
   *
   * `M220` put the viewer in the Run tab and argued the placement from one number: the viewer
   * compresses to a floor of **606 px** and the editor column is 460–860 px depending on where
   * `COMPOSE`'s grip has been dragged. That is true of the column and false of the region under
   * it — measured on the live page at 1440x900, `main` is 1114 px and `elementFromPoint` below the
   * columns returned `main` itself, i.e. nothing was there. So the width claim is the one this
   * gate holds, because it is the claim the placement was overturned on.
   */
  await page.goto(`${pageUrl}#/browser`);
  await page.reload();
  await page.locator('[data-door-form="browser"]').waitFor();
  const target = 'tests/shop.tflw';
  await page.locator(`[data-file-row="${target}"]`).click();
  await page.locator('[data-compose-summary]').waitFor();
  const before = await readFile(join(root, target), 'utf8');
  try {
    const stage = page.locator('[data-stage]');
    await stage.waitFor();
    assert.equal(await stage.getAttribute('data-stage'), 'empty', 'nothing has been played, so there is no trace to draw');
    /* `D1187` — the region says which of its states it is in rather than being absent. A stage
       that rendered `null` before the first play would grow the page by 700 px on the press. */
    assert.equal(await page.locator('[data-stage-hint]').count(), 1, 'the stage is drawn dead');
    assert.match((await page.locator('[data-stage-hint]').textContent())!, /press ▶/, 'the hint does not say what would fill it');
    assert.equal(await page.locator('[data-stage-frame]').count(), 0, 'a frame with no trace behind it');

    /**
     * **`M223` `A` gates 1 and 2 (`D1193`, `D1194`) — the stage is a LINE before a run, and the
     * page ends where the window does.**
     *
     * `M221` gave this region a height of its own so a 620 px viewer would not be squeezed into
     * what was left over, and that is still true the moment there is a viewer. What it also did,
     * invisibly, was spend **183 px** on a dashed box around a sentence while the authoring
     * columns above it had 239 px to share and **278 px of the window below it went to nobody**
     * (measured, 1440x900, `PLAN_M223` §1.1). Both numbers are asserted here rather than the
     * layout that produces them: a region sized by its content, and a page that ends at the fold.
     *
     * The mutation for gate 2 is restoring `.stage-hint`'s padded, bordered block — the height
     * goes back over 100. The mutation for gate 1 is giving the stage a fixed height again, or
     * taking `main-fill` back to `door === 'api'`: the gap returns to 278.
     */
    /* **It reads the BAR, and the first draft read the whole region and was wrong for a reason
       worth keeping.** This fixture's project does not `.gitignore` its play scratch, so the stage
       is also carrying `D1076`'s *▶ writes `.play.tflw` beside the test* sentence — a paragraph
       this round did not touch and has no business gating. Measuring the section measured that
       too (73 px), which is a true number about something else. The claim `D1194` actually makes
       is that the hint is a MEMBER OF THE BAR rather than a block under it, so the reading is the
       bar's own height and the hint's own rectangle sitting inside it. */
    const rest = await page.locator('[data-stage]').evaluate((el) => {
      const bar = el.querySelector('.stage-bar')!.getBoundingClientRect();
      const hint = el.querySelector('[data-stage-hint]')!.getBoundingClientRect();
      return {
        bar: bar.height,
        inBar: hint.top >= bar.top - 1 && hint.bottom <= bar.bottom + 1,
        below: el.ownerDocument.documentElement.clientHeight - el.getBoundingClientRect().bottom,
        frame: el.querySelector('[data-stage-frame]') !== null,
      };
    });
    assert.equal(rest.frame, false, 'this reading is only about the state with nothing played');
    assert.equal(rest.inBar, true, 'the hint is drawn below the bar rather than in it — `.stage-hint`’s block is back');
    assert.ok(rest.bar <= 24, `the stage bar is ${Math.round(rest.bar)}px before a run — it is meant to be one line, not a region`);
    assert.ok(rest.below < 24, `${Math.round(rest.below)}px of the window below the stage belongs to nobody — the columns are meant to claim it`);

    /**
     * The measurement the amendment rests on. `606` is the viewer's own floor, measured in `M220`.
     *
     * **BOTH RECTANGLES COME OUT OF ONE `evaluate`, and that is not tidiness.** The first draft
     * took two `boundingBox()` calls and read *stage y 242, foot y 469* — a later sibling above
     * its own predecessor, which no layout can produce. The two calls are two round trips and
     * therefore two moments, and the sequence column is still growing as the outline arrives
     * between them: the stage's y was stale by the height the column had yet to gain. It passed
     * when the test ran alone, because alone the page had settled first — which is the worst
     * shape a gate can have, since the green run is the one that tells you nothing.
     *
     * So the wait is for a row of the sequence to exist (the thing whose arrival moves everything
     * below it), and the measurement is one synchronous pass over both elements.
     */
    /* **THE PANE COMES BACK BLANK AFTER IT HAS ALREADY DRAWN, SO A `waitFor` IS NOT ENOUGH.**
       `M221` waited on `[data-seq-row]` — the element whose arrival moves everything below it —
       and that is a proxy that *disappears again*. Measured over the whole file rather than this
       test alone: `{stage y 241.9, foot null, editor null, rows 0}`, with `[data-compose-pane]`
       and `[data-compose-state]` present and `[data-compose-summary]`/`[data-seq]` gone — the
       pane back in its placeholder **after** the summary this test already waited for had
       rendered. Clicking the file row appends `?files=tests/shop.tflw` to the hash a beat later,
       the file-read effect runs a second time, and the pane blanks for that fetch. Waiting on
       `[data-seq-foot]` and `[data-editor]` first does not help: they are true, then false.

       So the wait is on **the measurement itself being coherent**, which is the only condition
       that cannot be true one moment and false the next in a way this gate cares about. Bounded,
       and the last reading is what the refusal prints — a timeout here is a real failure with its
       own diagnosis rather than a hang.

       The callback going INTO the page stays anonymous and binds no arrow to a variable
       (`M222-01`): tsx's keep-names transform wraps any function expression with an inferred name
       in a call to `__name`, which exists in the test process and not in the browser. `read`
       below is Node-side and therefore free of it, and `root.ownerDocument` carries the DOM types
       `tsconfig.test.json` does not have (`types: ["node"]`, no DOM lib — the same reason the two
       focus checks in this file ask a `:focus` locator instead of `document.activeElement`).

       Still ONE round trip per reading, which is the point `M221` established: `boundingBox()`
       twice is two moments, and a sequence column still gaining height between them is what made
       this gate read a stage 227 px above its own predecessor and pass when run alone. */
    const read = () =>
      page.locator('body').evaluate((root) => {
        const [stage, foot, editor] = ['[data-stage]', '[data-seq-foot]', '[data-editor]'].map((sel) => {
          const el = root.querySelector(sel);
          if (el === null) return null;
          const b = el.getBoundingClientRect();
          return { x: b.x, y: b.y, w: b.width, h: b.height };
        });
        return {
          stage: stage ?? null,
          foot: foot ?? null,
          editor: editor ?? null,
          at: {
            hash: root.ownerDocument.location.hash,
            rows: root.querySelectorAll('[data-seq-row]').length,
            state: root.querySelector('[data-compose-summary]') === null ? 'placeholder' : 'drawn',
          },
        };
      });
    let geom = await read();
    for (let i = 0; i < 50 && (geom.stage === null || geom.foot === null || geom.editor === null); i++) {
      await page.waitForTimeout(100);
      geom = await read();
    }
    const { stage: stageBox, foot: footBox, editor: editorBox } = geom;
    assert.ok(stageBox !== null && footBox !== null, `the stage or the sequence foot is not on the page at all — ${JSON.stringify(geom)}`);
    assert.ok(stageBox.w >= 606, `the stage is ${Math.round(stageBox.w)} px — below the trace viewer's 606 px floor, which is the number D1179 refused this placement on`);
    // …and it is BELOW both columns, not beside them, which is what buys that width.
    assert.ok(stageBox.y >= footBox.y, `the stage is not under the sequence column — ${JSON.stringify(geom)}`);
    // The claim `D1181` is actually made of: wider than the editor column it was refused from.
    assert.ok(editorBox !== null && stageBox.w > editorBox.w, `the stage (${Math.round(stageBox.w)}) is no wider than the editor column (${Math.round(editorBox?.w ?? 0)}), so it buys nothing`);

    /**
     * **▶ RUNS THE BUFFER** — `M221` `B` (`D1183`), overturning `D1177`.
     *
     * `D1177` held ▶ while the pane was dirty and said *write this file first — a play runs what
     * is on disk*. The premise was right and the wrong half was kept: a pane is dirty from the
     * first step you add, which is most of the time anyone wants to press this. The gate is the
     * held attribute, asserted **after** an edit — before the edit it would pass against the old
     * rule too, which is exactly the vacuity `M220`'s gate 6 shipped with.
     */
    const play = page.locator('[data-seq-play="test"]').first();
    await play.waitFor();
    assert.equal(await play.getAttribute('data-seq-play-held'), null, 'held at rest, before anything was even typed');

    await page.locator('[data-seq-add="click"]').first().click();
    await page.locator('[data-script="click"]').waitFor();
    await page.locator('[data-compose-dirty]').waitFor();
    assert.equal(await page.locator('[data-seq-play="test"]').first().getAttribute('data-seq-play-held'), null, '▶ still refuses an unsaved buffer — D1177 was not actually lifted');
    assert.equal(await page.locator('[data-seq-play="test"]').first().isDisabled(), false);
    /* And the reason it may: the scratch it will write is named, beside the file. */
    assert.equal((await fullProject()).playScratch, '.play.tflw');
  } finally {
    await writeFile(join(root, target), before, 'utf8');
  }
});

test('`M213` `S4`: adding a gesture to a test that already opened a page writes no second `open`', async () => {
  // A browser test navigates once — 270 `open`s across 244 browser tests — so adding steps to an
  // existing one must NOT re-open. A second `open` would reload the page out from under whatever
  // the test had already set up, and it would still parse, check and run: a defect no gate but
  // this one can see.
  //
  // **`BrowserForm` answered this with a mode select and the author's memory; the pane answers it
  // by not having the question.** `+ click` and `+ fill` write one statement each, at the foot;
  // `+ open` is a separate gesture that goes to the top, and nothing bundles them.
  await page.goto(`${pageUrl}#/browser`);
  await page.reload();
  await page.locator('[data-door-form="browser"]').waitFor();

  const target = 'tests/shop.tflw';
  await page.locator(`[data-file-row="${target}"]`).click();
  await page.locator('[data-compose-summary]').waitFor();
  const before = await readFile(join(root, target), 'utf8');
  const openedBefore = (before.match(/^\s*open /gm) ?? []).length;
  assert.ok(openedBefore > 0, 'the fixture must already open a page, or the claim below is vacuous');

  await page.locator('[data-seq-add="fill"]').first().click();
  // One editor, for whatever the address names — and `D1136` has just pointed it at the new row.
  await page.locator('[data-script="fill"]').waitFor();
  const row = page.locator('[data-script="fill"]');
  await row.locator('[data-locator-value]').fill('Coupon');
  await row.locator('[data-fill-value]').fill('"SAVE10"');

  await page.locator('[data-tab="source"]').click();
  await page.locator('[data-tabstrip="source"]').waitFor();
  const text = (await page.locator('[data-preview]').textContent())!;
  assert.match(text, /fill field "Coupon" with "SAVE10"/);
  assert.equal((text.match(/^\s*open /gm) ?? []).length, openedBefore, 'adding a gesture must not add an `open`');

  await writeFile(join(root, target), before, 'utf8');
});

/**
 * **The session fold** — `M219` `B` (`D1160`, `D1161`).
 *
 * `groupBody` folded a body by **request** and a browser test frequently has none. Measured over
 * the two corpora when this round was scoped: 338 declarations carry a browser step, **161 have no
 * `api` request at all**, and in the 177 mixed ones **1455 of 1927 browser steps (75.5%) were
 * drawn as attachments to an `api` request** — a `click` rendered as a reader of a login response.
 *
 * Its own project because the claim needs **two files**: `D1161` says a session can start at a
 * `call`, and whether an action opens a page is a fact the project index computes, from a file the
 * call is not written in.
 */
test('`M219` `B`: an `open` starts a session, and so does a `call` the project index says opens a page', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m219-fold-'));
  const fresh = await newPage();
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local\n  web "http://localhost:3000"\n  api "http://127.0.0.1:1"\n', 'utf8');
    // The actions live in another file, reached by `use` — which is the case a per-file answer
    // gets wrong and the whole reason `opensPage` is computed on the server.
    await writeFile(
      join(dir, 'actions.tflw'),
      'action signIn(email)\n  open "/login"\n  fill field "Email" with {email}\n\naction seed()\n  api POST /seed\n  expect status equals 200\n',
      'utf8',
    );
    await writeFile(
      join(dir, 'web.tflw'),
      [
        'use "./actions.tflw"',
        '',
        'test "mixed"',
        '  api POST /login',
        '  expect status equals 200',
        '  open "/account"',
        '  click button "Buy"',
        '  expect text "Ok" is visible',
        '',
        'test "two pages"',
        '  open "/one"',
        '  click button "A"',
        '  open "/two"',
        '  click button "B"',
        '',
        'test "through a call"',
        '  seed()',
        '  signIn("a@b.c")',
        '  click button "Go"',
        '',
      ].join('\n'),
      'utf8',
    );
    const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
    try {
      const base = `http://127.0.0.1:${await ui.listen(0)}`;
      await fresh.goto(`${base}/?token=${TOKEN}#/browser/compose/web.tflw/L3`);
      await fresh.locator('[data-seq-rows]').waitFor();

      /** Every sequence row, with the depth the fold drew it at. */
      const rows = async (): Promise<{ kind: string | null; line: string | null; depth: number }[]> =>
        fresh.locator('.seq-col .seq-row').evaluateAll((els) =>
          els.map((e) => {
            let depth = 0;
            for (let n = e.parentElement; n !== null; n = n.parentElement) if (n.classList.contains('seq')) depth += 1;
            return { kind: e.getAttribute('data-seq-row'), line: e.getAttribute('data-seq-line'), depth };
          }),
        );

      // **The setup phase keeps grouping by request**, which is `D1138`'s model untouched: the
      // `expect` reads the response and is drawn under the request. The `click` is not.
      const mixed = await rows();
      assert.deepEqual(
        mixed.map((r) => `${r.kind}@${r.depth}`),
        ['test@1', 'request@1', 'ExpectStmt@2', 'session@1', 'ClickStmt@2', 'ExpectStmt@2'],
        `the fold on a mixed test:\n${JSON.stringify(mixed, null, 1)}`,
      );
      assert.equal(await fresh.locator('[data-seq-sessions]').getAttribute('data-seq-sessions'), '1');

      /**
       * **`M223` `F` — the gutter's accent is the selection's alone, and the head says what it
       * is** (`D1200`, `D1201`).
       *
       * Scoped from a screenshot and the question under it — *why does `open` appear different
       * from the other steps?* Three things differ and they have one cause, this fold: the head's
       * keyword is accent, its group draws a rail, and it is offered no `⤹` because an `open`
       * **is** the page. Two of those are the decision working. The third was that the rail and
       * `.seq-row.on`'s mark sit **4.9 px apart in an 18 px gutter and are both accent-hued**, so
       * they read as one stripe that changes brightness rather than two devices.
       *
       * It is asserted here rather than in a project of its own because the claim needs exactly
       * what this fixture already stands up — a session with a row selected inside it — and a
       * second fixture for one CSS value is the shape this file keeps removing. `contrast` and
       * `chroma` are this module's own, defined together further down.
       */
      await fresh.locator('[data-seq-pick="7"]').click();
      await fresh.locator('.seq-row.on').waitFor();
      const paint = await fresh.locator('body').evaluate((root) => {
        const view = root.ownerDocument.defaultView!;
        const group = root.querySelector('.seq-group.session')!;
        const rail = view.getComputedStyle(group.querySelector(':scope > .seq')!);
        return {
          rail: rail.borderLeftColor,
          width: rail.borderLeftWidth,
          ground: view.getComputedStyle(root.querySelector('.seq-col')!).backgroundColor,
          mark: view.getComputedStyle(root.querySelector('.seq-row.on')!).boxShadow,
          head: group.querySelector(':scope > .seq-row .seq-kind')!.getAttribute('data-tip'),
          plain: root.querySelector('[data-seq-row="ClickStmt"] .seq-kind')!.getAttribute('data-tip'),
        };
      });
      /* **This one is FIRST and the order is load-bearing** — found by the sweep, which reddened it
         through the ratio below instead. The ratio is expressed against the mark, so a mutation
         that makes the mark neutral shrinks the ceiling and trips the ratio first; the control
         would then never fire on its own and would be an instrument nothing could exercise. */
      assert.ok(chroma(paint.mark) > 0.2, `the selection's own mark is still the accent: ${paint.mark}`);
      assert.ok(
        chroma(paint.rail) <= chroma(paint.mark) / 4,
        `the session rail is ${paint.rail} (chroma ${chroma(paint.rail).toFixed(3)}) beside a selection mark of ${paint.mark} (${chroma(paint.mark).toFixed(3)}) — two accent bars 4.9 px apart read as one`,
      );
      /* **The control, and the pair is the point.** The cheapest way to satisfy the assertion above
         on its own is `var(--line)`, which measures 1.20:1 on this ground — removing the collision
         by deleting one of the two things colliding. Each of these two is the other's mutation. */
      assert.ok(
        contrast(paint.rail, paint.ground) >= 2.5,
        `the rail reads ${contrast(paint.rail, paint.ground).toFixed(2)}:1 on the sequence column — hue-neutral is not the same as gone`,
      );
      assert.equal(paint.width, '1px', 'the rail is still a hairline and not a band');
      assert.ok(
        (paint.head ?? '').includes('this page'),
        `the session head's keyword says what the group is, which is the question the picture asked: ${paint.head}`,
      );
      assert.equal(paint.plain, null, 'an ordinary row’s keyword carries no authored tip — `D1127` keeps a row\'s hover derived');

      // **A second `open` ends the first session** — it is a new page, and what follows is against
      // it. The mutation this pins is *a second `open` extends the first*.
      await fresh.goto(`${base}/?token=${TOKEN}#/browser/compose/web.tflw/L10`);
      await fresh.locator('[data-seq-sessions]').waitFor();
      assert.equal(await fresh.locator('[data-seq-sessions]').getAttribute('data-seq-sessions'), '2');

      /**
       * **`D1161`, and both directions of it.** `seed()` is api-only and starts nothing;
       * `signIn()` opens a page and starts a session, so the `click` under it belongs to the page
       * rather than to the seeding call above it.
       *
       * This is the assertion the measured alternative would pass **by luck**: *any `call` starts
       * a session* is right in all 167 calls inside browser-bearing tests, because 18 of the
       * corpus's 22 declared actions are api-only and are simply never called from a browser test.
       * `seed()` here is the seeding helper that breaks it.
       */
      await fresh.goto(`${base}/?token=${TOKEN}#/browser/compose/web.tflw/L16`);
      await fresh.locator('[data-seq-sessions]').waitFor();
      const called = await rows();
      assert.deepEqual(
        called.map((r) => `${r.kind}@${r.depth}`),
        ['test@1', 'CallStmt@1', 'session@1', 'ClickStmt@2'],
        `an api-only call is a row and not a session:\n${JSON.stringify(called, null, 1)}`,
      );
      assert.equal(await fresh.locator('[data-seq-sessions]').getAttribute('data-seq-sessions'), '1');
      assert.equal(
        await fresh.locator('[data-seq-row][data-seq-row="session"]').getAttribute('data-stmt'),
        'CallStmt',
        'the session’s head is the `call` itself — an ordinary statement, still selectable and still editable',
      );
      // And the api-only call is **still drawn**, which is the degradation `D1161` promises: a
      // row that opens no session is a row, not an omission.
      assert.equal(await fresh.locator('[data-seq-row="CallStmt"]').count(), 1);
    } finally {
      await ui.close();
    }
  } finally {
    await fresh.close();
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * **`within` as a qualifier** — `M219` `D` (`D1163`).
 *
 * The language calls it a block and the corpus writes it as a scope on a single gesture: it is the
 * **third-commonest browser construct** (433) and **397 of its 405 blocks wrap exactly one
 * statement**. Before this round `outline.ts` never walked a block's body at all, so **430
 * statements corpus-wide were not rows** — one unaddressable row whose text happened to contain
 * the gesture inside it.
 *
 * Both arms are asserted, because the row's picture depends on what it holds and that is the cost
 * of the decision.
 */
test('`M219` `D`: one statement in a `within` is one row carrying both; more than one is a group', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m219-within-'));
  const fresh = await newPage();
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local\n  web "http://localhost:3000"\n  api "http://127.0.0.1:1"\n', 'utf8');
    await writeFile(
      join(dir, 'web.tflw'),
      [
        'test "one"',
        '  open "/cart"',
        '  within list "Backordered items"',
        '    click button "Remove"',
        '',
        'test "more"',
        '  open "/cart"',
        '  within list "Saved"',
        '    click button "Remove"',
        '    click button "Undo"',
        '',
      ].join('\n'),
      'utf8',
    );
    const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
    try {
      const base = `http://127.0.0.1:${await ui.listen(0)}`;
      await fresh.goto(`${base}/?token=${TOKEN}#/browser/compose/web.tflw/L1`);
      await fresh.locator('[data-seq-rows]').waitFor();

      // **THE QUALIFIER ARM.** One row, carrying the scope as a chip and the gesture as the text.
      const one = fresh.locator('.seq-col .seq-row[data-stmt="WithinBlock"]');
      assert.equal(await one.count(), 1);
      assert.equal(await one.locator('[data-seq-scope-of]').textContent(), 'within list "Backordered items"');
      assert.equal((await one.locator('.seq-text').textContent())?.trim(), 'button "Remove"');
      assert.equal(await fresh.locator('.seq-col [data-seq-scope]').count(), 0, 'one statement is not a group');
      // And the `⤺` is there, because the scope can come off and leave the gesture — offered only
      // on a block holding one, which `replaceInSource` is the reason for: it replaces one step
      // with one node, and a six-statement block unscopes to six.
      assert.equal(await one.locator('[data-seq-unscope]').count(), 1);

      /* **The inner statement is editable THROUGH the block**, which is the claim that makes this
         a fix rather than a rendering. Its address is the block's — the body step *is* the block —
         and `inner` is the second half, so the edit rebuilds the block with one element replaced. */
      await one.locator('[data-seq-goto]').click();
      await fresh.locator('[data-editor-statement="WithinBlock"]').waitFor();
      await fresh.locator('[data-script="within"] [data-locator-value]').fill('Saved for later');
      const inner = fresh.locator('[data-inner-line] [data-script="click"]');
      await inner.locator('[data-locator-value]').fill('Delete');
      await fresh.locator('[data-tab="source"]').click();
      await fresh.locator('[data-tabstrip="source"]').waitFor();
      const text = (await fresh.locator('[data-preview]').textContent())!;
      // **The scope survives an edit to the statement inside it**, and the statement survives an
      // edit to the scope. A rebuild that dropped either would print a file that still parses.
      assert.match(text, /within list "Saved for later"\n\s+click button "Delete"/);

      // **THE GROUP ARM.** Two statements, so the block is a header with its body indented and
      // every row of it addressable — the eight in the corpus that earn it.
      await fresh.locator('[data-tab="compose"]').click();
      await fresh.goto(`${base}/?token=${TOKEN}#/browser/compose/web.tflw/L6`);
      await fresh.locator('[data-seq-scope]').waitFor();
      assert.equal(await fresh.locator('[data-seq-scope]').getAttribute('data-seq-scope-holds'), '2');
      const held = await fresh.locator('[data-seq-scope] .seq .seq-row').evaluateAll((els) => els.map((e) => (e.querySelector('.seq-text')?.textContent ?? '').trim()));
      assert.deepEqual(held, ['button "Remove"', 'button "Undo"']);
      assert.equal(await fresh.locator('[data-seq-scope] > .seq-row .seq-scope').count(), 0, 'a group says its scope on its own row, not as a chip on a gesture');
    } finally {
      await ui.close();
    }
  } finally {
    await fresh.close();
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * **`+ step…`, and the assertion offer that follows the phase** — `M219` `E`/`G` (`D1164`,
 * `D1166`).
 *
 * The two are in one gate because they need the same fixture — a test with an assertion in each
 * phase — and neither needs a browser of its own.
 */
test('`M219` `E`/`G`: `+ step…` previews the buffer, and the subject offer follows the phase', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m219-step-'));
  const fresh = await newPage();
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local\n  web "http://localhost:3000"\n  api "http://127.0.0.1:1"\n', 'utf8');
    await writeFile(
      join(dir, 'web.tflw'),
      'test "mixed"\n  api POST /login\n  expect status equals 200\n  open "/account"\n  expect text "Hi" is visible\n  expect status equals 200\n',
      'utf8',
    );
    const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
    try {
      const base = `http://127.0.0.1:${await ui.listen(0)}`;
      await fresh.goto(`${base}/?token=${TOKEN}#/browser/compose/web.tflw/L1`);
      await fresh.locator('[data-seq-add="step"]').waitFor();

      /**
       * **THE OFFER IS AN ORDERING, NOT A DROP** (`D1166`), and the corpus is why. Mirroring
       * `D1114` — BROWSER drops the response subjects the way API drops `an element` — looked
       * obvious and is refused by the measurement: inside browser-bearing tests **436 of 1125
       * assertions (38.8%) use an api subject**, 428 of them `status`, which is the
       * second-commonest assertion in a browser test. Split by phase instead and it is clean:
       * setup is 91.0% api, the session 95.2% browser.
       */
      await fresh.locator('.seq-col .seq-row[data-stmt="ExpectStmt"]').first().locator('[data-seq-goto]').click();
      await fresh.locator('[data-expect-phase]').waitFor();
      assert.equal(await fresh.locator('[data-expect-phase]').getAttribute('data-expect-phase'), 'api');
      const setupLeads = (await fresh.locator('[data-expect-leads]').getAttribute('data-expect-leads'))!.split(',');
      assert.equal(setupLeads[0], 'status', 'a row in setup leads with the subject 405 of setup’s 445 assertions use');
      assert.equal(setupLeads.includes('locator'), false, 'and `an element` is behind `more…`, not gone');

      /* `.nth(1)`, not `.last()`: the fixture holds three assertions — `status` in setup, `text` in
         the session, and a second `status` in the session, which is the 4.7% the phase split does
         not claim and is what the `carried` assertion below needs. */
      await fresh.locator('.seq-col .seq-row[data-stmt="ExpectStmt"]').nth(1).locator('[data-seq-goto]').click();
      await fresh.locator('[data-expect-phase="browser"]').waitFor();
      const sessionLeads = (await fresh.locator('[data-expect-leads]').getAttribute('data-expect-leads'))!.split(',');
      assert.equal(sessionLeads[0], 'value', 'the neutral subject leads both phases — it is evidence of neither');
      assert.ok(sessionLeads.includes('locator') && sessionLeads.includes('page'), 'the session leads with the browser subjects');
      assert.equal(sessionLeads.includes('status'), false);
      /* **Nothing is unreachable**, which is the whole of what makes this an ordering. Every one of
         the language's subjects is in the select, in one half or the other. */
      const every = await fresh.locator('[data-expect-subject] option').evaluateAll((els) => els.map((e) => e.getAttribute('value')));
      for (const id of ['status', 'duration', 'request', 'header', 'body', 'bodyText', 'bodyBytes', 'value', 'response', 'locator', 'page', 'networkRequest', 'dialogMessage', 'dialogType']) {
        assert.ok(every.includes(id), `\`${id}\` is not reachable from a session row`);
      }
      /* **Three of those had never been offered anywhere** (`D1166`): browser-only, 26 occurrences
         across the two corpora, and absent from every door's select — not dropped by a table,
         never listed. That is the silent-omission failure `D1076` refuses. */
      assert.ok(['networkRequest', 'dialogMessage', 'dialogType'].every((id) => sessionLeads.includes(id)));

      /**
       * **A subject the row already says is always offered, whatever the phase thinks of it.**
       *
       * `status` is the second-commonest assertion in a browser test — **428 of them**, in the
       * corpus, behind `an element` at 645 — and this fixture writes one **in the session**, which
       * is the 4.7% the phase split does not claim. An ordering that dropped it from the row that
       * holds it would make a real assertion's own subject unselectable, which is the failure
       * `D1076` refuses and the reason `carried` has never been dropped by anything.
       */
      await fresh.locator('.seq-col .seq-row[data-stmt="ExpectStmt"]').last().locator('[data-seq-goto]').click();
      await fresh.locator('[data-expect-subject="status"]').waitFor();
      const kept = (await fresh.locator('[data-expect-leads]').getAttribute('data-expect-leads'))!.split(',');
      assert.equal(await fresh.locator('[data-expect-phase]').getAttribute('data-expect-phase'), 'browser', 'it is in the session');
      assert.ok(kept.includes('status'), `a session row that says \`status\` still offers it: ${kept.join(',')}`);

      /**
       * **`+ step…` previews from the BUFFER, never from the disk** (`D1141`) — `M217`'s own
       * defect report, inherited rather than re-earned. With a pending edit, a dialog that read
       * the saved bytes previewed and wrote a file the pane was not showing, and the next Save put
       * the old buffer back over it.
       */
      await fresh.locator('.seq-col .seq-row[data-stmt="ExpectStmt"]').first().locator('[data-seq-goto]').click();
      await fresh.locator('[data-expect-operand]').fill('201');
      await fresh.locator('[data-compose-dirty]').waitFor();
      await fresh.locator('[data-seq-add="step"]').click();
      await fresh.locator('[data-add-step]').waitFor();
      /* `M239-04` — the dialog's fields start empty and the build refuses until one is filled, so
         the preview is blank at first. Filling the default kind's locator is what makes it build;
         the claim below is about WHAT it builds over, which is unchanged. */
      await fresh.locator('[data-add-step-kind="HoverStmt"]').click();
      await fresh.locator('[data-add-step] [data-locator-value]').fill('Menu');
      await fresh.locator('[data-add-step-go]:not([disabled])').waitFor();
      const preview = (await fresh.locator('[data-add-step-preview]').textContent())!;
      assert.match(preview, /expect status equals 201/, `the preview is built from the text the author has:\n${preview}`);

      /**
       * **The tail is twenty-three, and it was eighteen until `M232`** — `M213-06` (`D1273`).
       *
       * 22 browser kinds − the three in the foot − `within`, which under `D1163` is a field on a
       * row and leaves the `+` vocabulary entirely; **plus the five door-agnostic kinds**
       * `capture`, `log`, `call`, `give` and `pause`, which are constructible on every door and
       * were offered on none. `stepCatalogue`'s third clause read `STEP_LENS[kind] !== null` as
       * *this door cannot build it* when it means *this construct does not choose a door*, and its
       * own docblock justified it as the **first** clause's job.
       *
       * It filtered nothing on the day it was written, because every `CATALOGUE` row was a browser
       * kind — so it was a trap rather than a defect, and the trap is that adding the five rows
       * would have changed this number by zero and reddened nothing.
       */
      assert.equal(await fresh.locator('[data-add-step-count]').getAttribute('data-add-step-count'), '23');
      assert.equal(await fresh.locator('[data-add-step-kind="WithinBlock"]').count(), 0);
      assert.equal(await fresh.locator('[data-add-step-kind="CaptureStmt"]').count(), 1, 'a door-agnostic kind is offered on the BROWSER door — it was offered nowhere');
      assert.equal(await fresh.locator('[data-add-step-kind="LetStmt"]').count(), 0, 'and `let` is not, because every door already carries `+ let` in its foot');
      // It filters by typing, and the bytes it previews are the bytes that land.
      await fresh.locator('[data-add-step-filter]').fill('dialog');
      assert.equal(await fresh.locator('[data-add-step-count]').getAttribute('data-add-step-count'), '2');
      await fresh.locator('[data-add-step-kind="DismissDialogStmt"]').click();
      const chosen = (await fresh.locator('[data-add-step-preview]').textContent())!;
      assert.match(chosen, /dismiss dialog/);
      await fresh.locator('[data-add-step-go]').click();
      await fresh.locator('[data-add-step]').waitFor({ state: 'detached' });
      await fresh.locator('[data-tab="source"]').click();
      await fresh.locator('[data-tabstrip="source"]').waitFor();
      const landed = (await fresh.locator('[data-preview]').textContent())!;
      assert.match(landed, /dismiss dialog/, 'the bytes previewed are the bytes that land');
      assert.match(landed, /expect status equals 201/, 'and the pending edit is still there — the shape `M217` `2` found');
    } finally {
      await ui.close();
    }
  } finally {
    await fresh.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a pick session outlives a tab switch and dies with the door — asserted on the process, not the DOM', async () => {
  // `M206` `Q2`/`S3`. The claim has two halves and **neither is visible to the page**: an orphaned
  // browser is invisible to every assertion the DOM can make about itself, which is exactly why the
  // plan said this gate could not be a DOM gate.
  //
  // IT IS STILL DRIVEN AGAINST A STUB, and the reason is the one the sibling test already gives:
  // spawning a real headed browser per run on a shared box is a cost with no claim attached, and a
  // gate that leaves browsers behind is the same defect in a test's clothing. That decision costs
  // nothing here, because **the claim was never about Chromium** — it is about the spawned child's
  // lifetime being bound to the door and not to the tab. A stub is a process too, so it can answer
  // the question the real browser would, for the price of a `setInterval`.
  //
  // The stub writes its own pid and then stays alive. `process.kill(pid, 0)` is the reading: it
  // throws `ESRCH` once the process is gone and returns silently while it lives.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-pick-life-'));
  const stub = join(dir, 'stub.mjs');
  const pidFile = join(dir, 'pick.pid');
  const fresh = await newPage();
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local\n  web "http://localhost:3000"\n  api "http://127.0.0.1:1"\n', 'utf8');
    // A `click` row, because `pick` is a **locator-fixer** since `M213` `S4` (`D1106`) — the
    // button lives on the statement whose locator it fixes, so a file with no locator in it has
    // nowhere to start a session from, which is the right behaviour and not a gate to work around.
    await writeFile(join(dir, 'web.tflw'), 'test "a page"\n  open "/"\n  click button "Sign in"\n  expect text "Hi" is visible\n', 'utf8');
    await writeFile(
      stub,
      [
        `import { writeFileSync } from 'node:fs';`,
        `writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
        'process.stdout.write(`opening ${process.argv[3]} — press Ctrl+C to stop.\n`);',
        'process.stdout.write(`button "Sign in"\n`);',
        // Stay alive the way the real `pick` does — waiting for a human who never arrives.
        'setInterval(() => {}, 1000);',
      ].join('\n'),
      'utf8',
    );
    const srv = new UiServer({ token: TOKEN, root: dir, cliEntry: stub, execArgv: [], staticDir: join(scratch, 'ui') });
    const port = await srv.listen(0);
    const url = `http://127.0.0.1:${port}/`;
    try {
      await fresh.goto(`${url}?token=${TOKEN}#/browser`);
      await fresh.locator('[data-door-form="browser"]').waitFor();
      await fresh.locator(`[data-file-row="web.tflw"]`).click();
      await fresh.locator('[data-compose-summary]').waitFor();
      /* **`pick` lives on the row whose locator it fixes** (`D1106`), and from `M219` `A` the row
         is drawn in the **editor** — one editor for whatever the address names — so the `click` is
         selected first. Before this round every row was a live form and the button was simply on
         screen; the affordance is unchanged and where it is drawn is not. */
      await fresh.locator('[data-seq-row][data-stmt="ClickStmt"] [data-seq-goto]').first().click();
      await fresh.locator('[data-script="click"]').waitFor();
      await fresh.locator('[data-pick]').first().click();
      await fresh.locator('[data-pick-state="running"]').waitFor();

      // The child exists, and the strip says so — the mark is the only thing on the page that will
      // still be true once Compose is gone, because the suggestions live in the row that unmounts.
      await fresh.locator('[data-tab-mark="compose"]').waitFor();
      // Polled, not read once: the child spawns and writes on the server's schedule, and the row
      // reads `running` the moment the button is pressed — `setPicking` runs before the stream
      // connects — so the row is NOT evidence the process exists. Reading immediately
      // failed with `ENOENT` on the first run here, which is `M205-08`'s race a second time and in
      // this round's own gate.
      const pid = await waitForPidFile(pidFile);
      process.kill(pid, 0);

      // HALF ONE — a tab switch must NOT kill it. Compose genuinely unmounts here, so this is the
      // half that would break the moment the session's state slipped down into the panel.
      await fresh.locator('[data-tab="source"]').click();
      await fresh.locator('[data-tabstrip="source"]').waitFor();
      assert.equal(await fresh.locator('[data-compose-summary]').count(), 0, 'Compose did not unmount, so surviving it proves nothing');
      await new Promise((r) => setTimeout(r, 300));
      process.kill(pid, 0); // throws ESRCH if the tab switch killed the browser
      await fresh.locator('[data-tab-mark="compose"]').waitFor();

      // HALF TWO — leaving the DOOR must kill it. This is the promise `BrowserForm`'s cleanup
      // comment made (*leaving this door must not leave it running*) and that nothing ever
      // checked; `ComposeDoor` inherited both the promise and this gate when the form was retired.
      await fresh.locator('[data-door-tab="api"]').click();
      await fresh.locator('[data-door-form="api"]').waitFor();
      await waitForExit(pid);
    } finally {
      await srv.close();
    }
  } finally {
    await fresh.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('`M213` `S5`: a recording writes statements into the test it was started on, as they happen', async () => {
  /**
   * **Driven against a stub `tflw record`, for `pick`'s reason and one more.** The real command
   * opens a visible browser and waits for a person to use it; a page gate cannot produce that, and
   * spawning a headed browser per run on a shared box is a cost with no claim attached. What is
   * left after the stub is every claim this slice makes *at this layer*: the session is started
   * against the page the file opens, the lines arrive, they are **classified by the grammar**, and
   * each one becomes a statement in the body it was started on, in order, in the pending buffer.
   * What the recorder decides — eighteen keystrokes into one `fill`, a checkbox into a `tick` —
   * is `@tflw/runtime`'s `recorder.test.ts`, where it can be asserted without a browser at all.
   */
  const dir = await mkdtemp(join(tmpdir(), 'tflw-record-'));
  const stub = join(dir, 'stub.mjs');
  const fresh = await newPage();
  const pageErrors: string[] = [];
  fresh.on('pageerror', (e) => pageErrors.push(e.message));
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local\n  web "http://localhost:3000"\n  api "http://127.0.0.1:1"\n', 'utf8');
    await writeFile(join(dir, 'web.tflw'), 'test "a page"\n  open "/checkout"\n  expect text "Hi" is visible\n', 'utf8');
    await writeFile(
      stub,
      [
        /* **THE BANNERS ARE ON STDERR AND THE STATEMENTS ARE ON STDOUT** — `D1265`, which is what
           `M219-01` turned out to need. They matter for `pick`'s reason too: a reader that
           filtered by matching their wording would turn one into a step the day somebody rewords
           it — so nothing here reads them, it reads which channel they came down. */
        'process.stderr.write(`recording ${process.argv[3]} — press Ctrl+C to stop.\n`);',
        'process.stderr.write(`ready — use the page as a user would. Close the window or press Ctrl+C to stop.\n`);',
        'process.stdout.write(`click button "Sign in"\n`);',
        /* A stdout line that is not a statement. Before `D1265` this was indistinguishable from a
           banner and had to be dropped; now everything on this channel is meant to be a step, so
           a line that does not read is a recorder defect and says so. */
        'process.stdout.write(`…and something the grammar does not admit\n`);',
        'process.stdout.write(`fill field "Email" with "alice@example.com"\n`);',
        /* **A block, which is a statement that is not a line** (`D1268`) — the reason the page
           accumulates stdout rather than parsing each line where it lands. */
        'process.stdout.write(`switch to new tab\n  click text "View receipt"\n`);',
        'process.stdout.write(`tick field "Remember me"\n`);',
        // And the word `record` writes when the builders refuse a gesture — stderr, beside the
        // banners, because it is the command talking about itself and never a step.
        'process.stderr.write(`skipped one click: could not read the locator "css \\"#x\\""\n`);',
        'const alive = setInterval(() => {}, 250);',
        'setTimeout(() => { clearInterval(alive); process.exit(0); }, 4000);',
        'process.on("SIGINT", () => process.exit(0));',
      ].join('\n'),
      'utf8',
    );

    const ui = new UiServer({ token: TOKEN, root: dir, cliEntry: stub, execArgv: [], staticDir: join(scratch, 'ui') });
    try {
      const base = `http://127.0.0.1:${await ui.listen(0)}`;
      await fresh.goto(`${base}/?token=${TOKEN}#/browser`);
      await fresh.locator('[data-door-form="browser"]').waitFor();
      await fresh.locator('[data-file-row="web.tflw"]').click();
      await fresh.locator('[data-compose-summary]').waitFor();

      await fresh.locator('[data-seq-add="record"]').first().click();
      // The button says it is running, and so does the strip — the strip is the half that is still
      // true once Compose is not the tab you are on, and a recording runs while you look away.
      await fresh.locator('[data-seq-add-live="yes"]').waitFor();
      await fresh.locator('[data-tab-mark="compose"]').waitFor();

      /**
       * **THE LINES LAND IN THE SESSION PANEL, NOT IN THE BUFFER** — `M219` `F` (`D1165`), which
       * **amends `D1095`**.
       *
       * `D1095`'s argument for appending live was that the buffer is reversible. It is; what it is
       * not is *reviewable*. A two-minute session writes thirty statements into the file the
       * author is looking at, and the only way to drop the four that were mis-clicks is to find
       * them among the twenty-six that were not. So the statements are evidence until they are
       * ticked — `D1102`'s rule, one door over, with a live page as the evidence.
       *
       * Everything this gate asserted about *classification* is unchanged and is asserted here:
       * three lines parse, the two banners and the unreadable line are not statements.
       */
      await fresh.locator('[data-session-line]').first().waitFor();
      const shown = await fresh.locator('[data-session-line]').evaluateAll((els) =>
        els.map((e) => ({ kind: e.getAttribute('data-session-line-kind'), text: (e.querySelector('.stmt-text')?.textContent ?? '').trim() })),
      );
      assert.deepEqual(
        shown.filter((l) => l.kind === 'step').map((l) => l.text),
        [
          'click button "Sign in"',
          'fill field "Email" with "alice@example.com"',
          /* **One row, two lines** — the block arrived whole because the page accumulates stdout
             and offers the parser a chunk, not a line (`D1268`). Parsed where they landed, the
             head would have been unreadable and the body a `click` that scopes nothing. */
          'switch to new tab\n  click text "View receipt"',
          'tick field "Remember me"',
        ],
        'the recorder’s statements arrive as rows, in order, and a block is one of them',
      );

      /**
       * **`M219-01` IS CLOSED HERE, AND THE COUNT IS HOW YOU CAN TELL** — `M231` (`D1265`).
       *
       * `M219` `F` built exactly this row, measured every session opening with **two junk rows**
       * above the first real one, and withdrew it — because `tflw record`'s stream had no framing:
       * the banners failed to parse for precisely the reason a refused gesture does, and nothing
       * in the line said which it was. The assertion that replaced it said so in advance —
       * *the day a line is attributable, the count changes* — and this is that day.
       *
       * Attribution is now the channel. A line on stdout is meant to be a step, so one that does
       * not read is a **recorder defect** and is shown as one; everything the command says about
       * itself is on stderr and is shown as a notice, which is not a statement and never was.
       */
      assert.deepEqual(
        shown.filter((l) => l.kind === 'unreadable').map((l) => l.text),
        ['…and something the grammar does not admit'],
        `a stdout line that does not parse is kept and named, not dropped:\n${JSON.stringify(shown, null, 1)}`,
      );
      const notices = shown.filter((l) => l.kind === 'notice').map((l) => l.text);
      assert.equal(notices.length, 3, `two banners and one refusal, all of them notices:\n${JSON.stringify(shown, null, 1)}`);
      assert.ok(notices.some((n) => n.startsWith('recording ')), 'the opening banner is a notice, not an error and not a step');
      assert.ok(notices.some((n) => n.startsWith('skipped one click:')), 'and so is the word the command writes when the builders refuse a gesture');
      assert.equal(shown.length, 8, `four statements, one unreadable line and three notices:\n${JSON.stringify(shown, null, 1)}`);

      /**
       * **AND THE BUTTON COUNTS STATEMENTS, NOT ROWS.**
       *
       * `SessionPanel` read `kind !== 'locator'` for *the statements*, which was right for as long
       * as a step and a locator were the only rows that could exist — `unreadable` was declared
       * beside them in `M219` `F` and never constructed. Making it reachable and adding `notice`
       * turns that proxy into a lie: *keep all 8* over four statements, on a panel whose own
       * `keepAll` splices four. This arc's fourth rule keyed on a proxy that broke when the proxy
       * gained a member.
       */
      assert.equal(await fresh.locator('[data-session-lines="8"]').count(), 1, 'the panel holds eight rows');
      assert.match(
        (await fresh.locator('[data-session-keep-all]').textContent()) ?? '',
        /keep all 4\b/,
        'and offers to keep the four that are statements',
      );

      /* **And the file has not changed**, which is the whole of what `D1165` adds. The mutation
         this pins is *the recorder appends straight to the buffer*: with it, the three statements
         are in the pending source before anything was ticked. */
      await fresh.locator('[data-tab="source"]').click();
      await fresh.locator('[data-tabstrip="source"]').waitFor();
      const before = (await fresh.locator('[data-preview]').textContent())!;
      assert.equal(before.includes('click button "Sign in"'), false, `nothing is written until it is kept:\n${before}`);
      assert.equal(await fresh.locator('[data-compose-dirty]').count(), 0, 'and the pane is not dirty, because nothing has been written');

      /* **THE CONTROL, because a gate that only asserts a refusal is half a gate** (`M218` §8.8,
         and §5's own rule this round). Keeping is the path that must WORK: tick one line and
         exactly that one statement is spliced. */
      await fresh.locator('[data-tab="compose"]').click();
      await fresh.locator('[data-tabstrip="compose"]').waitFor();
      const keep = fresh.locator('[data-session-line][data-session-line-kind="step"]').nth(1);
      await keep.locator('[data-session-keep]').click();
      await fresh.locator('[data-compose-dirty]').waitFor();
      await fresh.locator('[data-tab="source"]').click();
      await fresh.locator('[data-tabstrip="source"]').waitFor();
      const after = (await fresh.locator('[data-preview]').textContent())!;
      assert.ok(after.includes('fill field "Email" with "alice@example.com"'), `the kept line is in the buffer:\n${after}`);
      assert.equal(after.includes('click button "Sign in"'), false, 'and only the kept line — the other three are still evidence');
      assert.equal(after.includes('tick field "Remember me"'), false);
      assert.equal(after.includes('switch to new tab'), false);

      /**
       * **`M221` `C` — ▶ on the panel runs the test WITH the pending lines, and keeps none of
       * them** (`D1185`, `D1186`).
       *
       * The two claims are separable and both are here, because each passes alone against a
       * different wrong build: *the lines are in what runs* is green for a ▶ that simply called
       * `keepAll` first, and *the file did not change* is green for a ▶ that ran the saved test
       * and ignored the session entirely. Together they are the gesture.
       *
       * The run itself goes to the stub, which is not a `tflw` and writes no report — deliberately.
       * What this gate is about is **what gets written before the run**, and that is a file on
       * disk this test can read. Whether a report comes back and lands in the stage is `A`'s claim
       * and is held where a real run happens.
       */
      await fresh.locator('[data-tab="compose"]').click();
      await fresh.locator('[data-tabstrip="compose"]').waitFor();
      const tryIt = fresh.locator('[data-session-play]');
      await tryIt.waitFor();
      /* Three statements are still pending — the keep above took one of four — so the control
         counts what is left rather than what the session started with, and counts STATEMENTS:
         the unreadable row and the three notices are beside them and are not lines to run. */
      assert.match((await tryIt.textContent())!, /▶ try 3/, 'the control does not count the lines still pending, nor the rows that are not statements');
      const onDisk = await readFile(join(dir, 'web.tflw'), 'utf8');
      await tryIt.click();

      /* The scratch is beside the file, and `web.tflw` is at this fixture's root — so `D1184`'s
         join produces the root basename here, which is the one case where it agrees with `send`. */
      const scratch = join(dir, '.play.tflw');
      let played = '';
      for (let i = 0; i < 60 && played === ''; i += 1) {
        played = await readFile(scratch, 'utf8').catch(() => '');
        if (played === '') await new Promise((r) => setTimeout(r, 100));
      }
      assert.notEqual(played, '', 'no scratch was written beside the file — ▶ ran the disk');
      /* `D1185` — the whole test, with the pending lines spliced into it: the one `keep` already
          wrote is in the buffer, and the three still pending are added on top. */
      assert.ok(played.includes('open "/checkout"'), `the test's own steps are in what ran:\n${played}`);
      assert.ok(played.includes('click button "Sign in"'), `a pending line is in what ran:\n${played}`);
      assert.ok(played.includes('tick field "Remember me"'), `and the others:\n${played}`);
      assert.ok(played.includes('switch to new tab'), `including the block, whose body goes with it:\n${played}`);
      assert.ok(played.includes('fill field "Email"'), 'the kept line is there too — the scratch is the BUFFER, not the disk');

      /* `D1186` — and nothing was kept. The file has not moved and the session still holds every
         line it held, so the tick is still the only thing that writes (`D1165`). */
      assert.equal(await readFile(join(dir, 'web.tflw'), 'utf8'), onDisk, 'a play wrote to the file — playing is not keeping');
      assert.equal(await fresh.locator('[data-session-line][data-session-line-kind="step"]').count(), 3, 'the play consumed the lines it ran');

      assert.deepEqual(pageErrors, [], 'classifying a line must not throw — a dropped line and a crashed handler are otherwise indistinguishable');
    } finally {
      await ui.close();
    }
  } finally {
    await fresh.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('`M213` `S4`: `pick` fixes the locator on the row it is pressed on, from a live session', async () => {
  // `D1055`. **Driven against a STUB `tflw pick`, deliberately, and the reason is this morning.**
  // The real command opens a real, visible browser and waits for a human to click something — a
  // page gate cannot produce that click, and spawning one headed browser per run on a shared box
  // to assert a banner is a cost with no claim attached. This box was carrying fourteen orphaned
  // `Xvfb` servers from killed runs when `A2-6` started; a gate that leaves browsers behind is the
  // same defect in a test's clothing.
  //
  // What is left after the stub is every claim this slice actually makes: the session is spawned
  // for the path **the file opens** — read out of the test's own `open` statement since `M213`
  // `S4`, rather than out of a field that asked the author to repeat it — the lines arrive, they
  // are CLASSIFIED BY THE GRAMMAR, and clicking a suggestion fills **both halves** of the locator
  // on the row the button was pressed on. The real command's own behaviour is covered where it
  // lives, and `pickArgv`/`pickUrl` pin the boundary between them.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-pick-door-'));
  const stub = join(dir, 'stub.mjs');
  const fresh = await newPage();
  // **A THROWN HANDLER AND A FILTERED LINE LOOK IDENTICAL FROM THE OUTSIDE**, which is how the
  // kind check nearly shipped unverified. Remove it and a banner — a `MalformedStep`, with no
  // `.locator` — makes `locatorFromPickLine` throw inside the stream callback; the suggestion is
  // not added, the count is still 2, the contents are still right, and every assertion below
  // passes. Only the error itself distinguishes them, and nothing but the browser can see it.
  const pageErrors: string[] = [];
  fresh.on('pageerror', (e) => pageErrors.push(e.message));
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local\n  web "http://localhost:3000"\n  api "http://127.0.0.1:1"\n', 'utf8');
    // `open "/checkout"` is what the session must be opened against, and it is a fact of the file
    // rather than of a form — the assertion on `argv` below is what makes that a claim.
    await writeFile(join(dir, 'web.tflw'), 'test "a page"\n  open "/checkout"\n  click button "Sign in"\n  expect text "Hi" is visible\n', 'utf8');
    // Two banner lines and two locators — the banners matter, because a form filtering by matching
    // their wording would turn one into a suggestion the day somebody rewords it.
    await writeFile(
      stub,
      [
        'process.stdout.write(`opening ${process.argv[3]} — press Ctrl+C to stop.\n`);',
        'process.stdout.write(`ready — click any element to print its locator. Close the window or press Ctrl+C to stop.\n`);',
        'process.stdout.write(`button "Sign in"\n`);',
        'process.stdout.write(`css "#totals .amount"\n`);',
        // **A LINE THAT PARSES WITH RECOVERY**, which is the case the two guards divide between
        // them. The banners above become `MalformedStep`, so the `ClickStmt` check filters them;
        // this one parses as a perfectly good `ClickStmt` with a diagnostic, its trailing text
        // dropped — so without the diagnostics check it would arrive as `button "Sign in"` and the
        // form would have silently truncated something its own tool emitted.
        'process.stdout.write(`button "Cancel" and some trailing text\n`);',
        // **BOUNDED, so that leaking it cannot hang anything.** The stub must outlive the assertions
        // to prove the stream is live, and must not outlive the test — otherwise a mutation that
        // drops the kill leaves a child holding piped stdio, the test file never exits, and the
        // failure the assertions correctly produce is invisible behind a hang. `A3-6` paid 180
        // seconds and a hand-killed run to learn that.
        'const alive = setInterval(() => {}, 250);',
        'setTimeout(() => { clearInterval(alive); process.exit(0); }, 3000);',
        'process.on("SIGINT", () => process.exit(0));',
      ].join('\n'),
      'utf8',
    );

    const ui = new UiServer({ token: TOKEN, root: dir, cliEntry: stub, execArgv: [], staticDir: join(scratch, 'ui') });
    try {
      const base = `http://127.0.0.1:${await ui.listen(0)}`;
      await fresh.goto(`${base}/?token=${TOKEN}#/browser`);
      await fresh.locator('[data-door-form="browser"]').waitFor();
      await fresh.locator('[data-file-row="web.tflw"]').click();
      await fresh.locator('[data-compose-summary]').waitFor();

      /* See the sibling gate above — `pick` is drawn on the selected statement from `M219` `A`. */
      await fresh.locator('[data-seq-row][data-stmt="ClickStmt"] [data-seq-goto]').first().click();
      await fresh.locator('[data-script="click"]').waitFor();
      await fresh.locator('[data-pick]').first().click();
      await fresh.locator('[data-pick-state="running"]').waitFor();

      // **EXACTLY TWO SUGGESTIONS, NOT FOUR.** The stub writes four lines and two of them are
      // banners; the form asks the parser whether `click <line>` is a click step rather than
      // excluding the banner text, so a reworded banner cannot become a locator and a locator
      // whose text happens to read like prose cannot be dropped.
      // Waited on the COUNT, not on the element: the empty state renders `data-picked="0"`
      // immediately, so waiting for the attribute to exist resolves before a single line has
      // arrived and reads 0 every time.
      await fresh.locator('[data-picked="2"]').waitFor();
      assert.equal(await fresh.locator('[data-picked-option]').count(), 2, 'the two banner lines are not locators');

      // **THE SESSION OPENED AGAINST THE PAGE THE FILE OPENS.** The stub echoes its own argv, so
      // this is read off what the server actually spawned rather than off what the page intended.
      assert.match((await fresh.locator('[data-picked-option="1"]').textContent())!, /Sign in/);

      // Clicking a suggestion fills the row — and the KIND travels with it, which a control
      // storing only the text would lose.
      await fresh.locator('[data-picked-option="0"]').click();
      const row = fresh.locator('[data-script="click"]').first();
      assert.equal(await row.locator('[data-locator-value]').inputValue(), '#totals .amount');
      assert.equal(await row.locator('[data-locator-kind]').inputValue(), 'css');

      // …and it reaches the buffer, which is the only claim that matters in the end.
      await fresh.locator('[data-tab="source"]').click();
      await fresh.locator('[data-tabstrip="source"]').waitFor();
      assert.match((await fresh.locator('[data-preview]').textContent())!, /click css "#totals \.amount"/);

      assert.deepEqual(pageErrors, [], 'classifying a line must not throw — a filtered banner and a crashed handler are otherwise indistinguishable');
    } finally {
      await ui.close();
    }
  } finally {
    await fresh.close();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// `M200` `A2-3` — the SCANS door. Two tests, and the split is the door's whole character: the
// fixture project DECLARES an `authorized target`, so it exercises the authorized path; a project
// `tflw init --scan` just made does not, so it exercises the one thing no other door has to show.
// ---------------------------------------------------------------------------

test('the SCANS door grades a response a test already fetches, and the three independent words all land', async () => {
  /* **Re-pointed to the pane by `M228` `B` (`D1237`).** This drove `ScanForm` — a `<select>` of
     which test to append to, a family, a floor, a `soft` box and a Save. The door draws the
     standard pane now, so the gesture is the one every other door already has: edit the row.
     The claim is unchanged and is the one worth keeping — **`check`/`expect`, the family and the
     severity floor are three independent positions in the grammar**, so a gate carrying only one
     of them could not tell a printer that dropped another. */
  await page.goto(`${pageUrl}#/scan`);
  await page.reload();
  await page.locator('.compose-pane-grid').waitFor();

  const target = 'tests/orders.tflw';
  const before = await readFile(join(root, target), 'utf8');
  const line = before.split('\n').findIndex((l) => l.trim() === 'expect status equals 200') + 1;
  assert.ok(line > 0, `the fixture file must hold a plain status assertion to widen:\n${before}`);
  await page.goto(`${pageUrl}#/scan/compose/${target}/L${line}`);
  await page.locator('[data-expect-matcher]').first().waitFor();

  /* **The subject first, and `M228` `D` is why.** This was written matcher-first and timed out on
     `option being selected is not enabled`: a scan family is refused on a `status` subject by
     `TF042`, so the select now greys it out (`D1243`). That is the feature catching the gate, and
     the order it forces is the order the grammar reads in anyway. */
  await page.locator(`[data-assert-line="${line}"] [data-expect-subject]`).selectOption('response');
  await page.locator(`[data-assert-line="${line}"] [data-expect-matcher]`).selectOption('hasNoInputHandlingViolations');
  await page.locator(`[data-assert-line="${line}"] [data-expect-severity]`).selectOption('serious');
  await page.locator(`[data-assert-line="${line}"] [data-assert-more]`).click();
  await page.locator(`[data-assert-line="${line}"] [data-expect-kind]`).selectOption('check');

  // What is shown is what is written — the claim every door in this arc makes, and here the
  // showing surface is Source rather than a form's own preview box.
  await openTab('source');
  const shown = (await page.locator('.doorpane pre').textContent()) ?? '';
  assert.match(shown, /check response has no serious input handling violations/, `the three words did not all reach the draft:\n${shown}`);

  await openTab('compose');
  await page.locator('[data-compose-write]').click();
  await page.waitForTimeout(600);

  const after = await readFile(join(root, target), 'utf8');
  try {
    assert.equal(after, shown, 'what was shown is what was written');
    assert.notEqual(after, before);
    // …and it is still INSIDE the test it belongs to, which is the half an append could get wrong.
    const lines = after.split('\n');
    const header = lines.findIndex((l) => l.startsWith('test '));
    const assertionLine = lines.findIndex((l) => l.includes('has no serious input handling violations'));
    assert.ok(header >= 0 && assertionLine > header, `the assertion must sit under its test:\n${after}`);
  } finally {
    await writeFile(join(root, target), before, 'utf8');
  }
});

test('a project with no `authorized target`: the SCANS door says so, shows the TF060 it will get, and writes anyway', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-scan-door-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage();
  try {
    const base = `http://127.0.0.1:${await ui.listen(0)}`;
    await fresh.goto(`${base}/?token=${TOKEN}`);

    // 1. The landing offers to create one, and SCANS now has a scaffold of its own to offer —
    //    `D1053`. Before `A2-4` this door created the plain project and said so.
    await fresh.locator('[data-landing]').waitFor();
    /* `M235-08` — the wait above is on `[data-landing]` and the read below is on a **door**, which
       is a different subject, so the landing could be up and still be deciding. It was:
       `noProject` was `useState(false)` and `false` is one of the two answers, so a directory that
       is not a project painted `open` doors until the probe returned. `E`'s sweep caught it at
       1 of 56 with `'open' !== 'create'`. The page now says `asking` until it knows, which is what
       makes this wait expressible without being the assertion (`M141`): *it has finished asking* is
       measurable, *what it answered* is the claim. A door still `asking` after two seconds fails here. */
    const decided = await settle(
      () => fresh.locator('[data-door="scan"] [data-door-state]').getAttribute('data-door-state'),
      untilMeasurable('the landing has finished asking whether this is a project', (v) => v !== null && v !== 'asking'),
      { attempts: 40, delayMs: 50, page: fresh },
    );
    assert.equal(decided.value, 'create', `the door offers to create a project (${decided.attempts} look(s))`);
    await fresh.locator('[data-door="scan"]').click();
    await fresh.locator('.compose-pane-grid').waitFor();

    // 2. What `tflw init --scan` wrote is what a terminal writes, byte for byte — the claim
    //    `A0-5` makes about `--load`, now made about the flag `D1053` added.
    const scaffold = await readFile(join(dir, 'scan.tflw'), 'utf8');
    const fromTerminal = await mkdtemp(join(tmpdir(), 'tflw-terminal-scan-'));
    execFileSync(process.execPath, ['--import', tsxLoader, cliEntry, 'init', '--scan'], { cwd: fromTerminal, stdio: 'pipe' });
    assert.equal(scaffold, await readFile(join(fromTerminal, 'scan.tflw'), 'utf8'), 'the page and the terminal write the same bytes');
    assert.equal(
      await readFile(join(dir, 'tflw.config'), 'utf8'),
      await readFile(join(fromTerminal, 'tflw.config'), 'utf8'),
      'including the commented-out declaration, which is the whole of `D1053`',
    );
    await rm(fromTerminal, { recursive: true, force: true });

    // 3. **THE NOTICE**, which is now region 2's `scan` segment rather than a banner on a form
    //    (`M228` `A`, `D1239`). The declaration is commented out, so the env authorizes nothing,
    //    and the door says it in the one place the author is about to act — naming the file it
    //    lives in, which this page deliberately cannot write (`D1049`/`D291`).
    //
    //    **It is reached by opening the declaration**, and that is the segment's own rule rather
    //    than an inconvenience: it is earned by a construct, so it appears where a scan assertion
    //    is, not wherever this door happens to be.
    await fresh.locator('[data-file-row="scan.tflw"]').click();
    await fresh.locator('[data-compose-scan]').waitFor();
    const notice = (await fresh.locator('[data-compose-scan-unauthorized]').textContent()) ?? '';
    assert.match(notice, /declares no/);
    assert.match(notice, /TF060/);
    assert.match(notice, /tflw\.config/);
    // And the coverage table says where a scan here would reach and that nothing covers it —
    // `TF060`'s own condition, one origin at a time.
    assert.equal(await fresh.locator('[data-compose-scan-covered="yes"]').count(), 0, 'nothing is authorized, so no origin may read as covered');
    assert.ok((await fresh.locator('[data-compose-scan-covered="no"]').count()) > 0, 'and the origins a scan can reach are named rather than left implicit');

    // 4. **AND THE DIAGNOSTIC, WHICH IS THE WIRING THIS SLICE EXISTS FOR.** `diagnose` ran
    //    `checkProgram` with NO options until `A2-3`, and `TF060` needs the env's declarations —
    //    so this panel would have shown a clean file and the author would have met the error in a
    //    terminal. That is exactly the surprise `D1052` exists to prevent, on the one door where
    //    it is guaranteed rather than possible.
    /* `M228` `B` — the pane's own `+ new test` writes the scan, `D1244`'s scaffold. It is the
       gesture `ScanForm`'s mode/name/path fields were, and it goes through `newSource` and the
       builders like every other door's. */
    await fresh.locator('[data-file-row="scan.tflw"]').click();
    await fresh.locator('[data-compose-new-test]').click();
    await fresh.locator('[data-new-thing]').waitFor();
    await fresh.locator('[data-new-name]').fill('the page can ask for a scan');
    await fresh.locator('[data-new-path]').fill('/health');
    await fresh.locator('[data-new-create]').click();
    await fresh.locator('[data-new-thing]').waitFor({ state: 'detached' });
    await fresh.locator('[data-tab="source"]').click();
    await fresh.locator('[data-diagnostics]').waitFor();
    // TWO of them, and the second one is the point: the panel judges the whole file the PUT will
    // carry, so the scaffold's own `scan.tflw` assertion is refused alongside the one being added.
    // A test that took `.first()` without saying how many there are would have passed just as well
    // against a panel that showed one.
    const tf060s = fresh.locator('[data-diagnostic-code="TF060"]');
    assert.equal(await tf060s.count(), 2, 'the scaffolded assertion and the new one are both TF060');
    const tf060 = await tf060s.first().textContent();
    assert.ok(tf060?.includes('authorized target'), tf060 ?? 'the panel must carry TF060');
    await fresh.locator('[data-tab="compose"]').click();

    // 5. It never blocks. `D1052`: a half-written test is a legitimate intermediate state.
    //
    // **And what it writes is READ BACK, not just counted.** The first draft asserted the test name
    // appeared and stopped, so a mutation survived that wrote the assertion with no request for it
    // to grade. A scan grades the LAST response, so a test that asserts one without fetching
    // anything is a file `tflw check` rejects — that is this door's whole subject, and it was not
    // covered by a test that only checked something had been written.
    //
    // **`M228` `B` (`D1244`) — the three lines are the SCAFFOLD's now, not a form's fields.** The
    // `as <session>` half went with `ScanForm` and is not re-pointed: `D1244` deliberately does
    // not scaffold a principal, because the scaffold writes a **security** assertion, which reads
    // a response the test already asked for and needs no owner. `as` is `AuthPanel`'s subject and
    // the sequence's own `more` tab, both gated elsewhere.
    await fresh.locator('[data-compose-write]').click();
    await fresh.locator('[data-compose-dirty]').waitFor({ state: 'detached' });

    const written = await readFile(join(dir, 'scan.tflw'), 'utf8');
    const body = written.slice(written.indexOf('test "the page can ask for a scan"'));
    assert.match(body, /^test "the page can ask for a scan"$/m, 'the test the scaffold names');
    assert.match(body, /^ {2}api GET \/health$/m, 'the request the assertion grades');
    assert.match(body, /^ {2}expect status equals 200$/m, 'and the assertion that says the request worked');
    assert.match(body, /^ {2}expect response has no critical security violations$/m, 'the line that puts this test behind SCANS');
    // …and in that order: the request has to precede the assertion that reads its response.
    assert.ok(body.indexOf('api GET /health') < body.indexOf('has no critical security violations'), body);

    // 6. And the notice is not a decoration: uncommenting the declaration — the one act the
    //    scaffold asks for — takes both it and the diagnostic away. Without this the assertions
    //    above hold for a banner that is always on.
    //
    //    **THIS LINE USED TO RE-INDENT THE DECLARATION WHILE UNCOMMENTING IT, AND THAT WAS THE
    //    DEFECT COMPENSATING FOR ITSELF (`M207-03`).** It read
    //    `.replace(/^#   (authorized target .*)$/m, '  $1…')` — dropping the `#` *and* moving the
    //    line from column 0 to inside the `env` block, because at column 0 it is `TF022` and this
    //    test would not have gone green. So the gate performed a repair the product never told an
    //    author to perform, and by succeeding it kept the scaffold's one instruction broken and
    //    invisible for as long as it stood. The scaffold now writes the line where a live one
    //    belongs, and this does what the prose says: remove the `#`.
    const config = await readFile(join(dir, 'tflw.config'), 'utf8');
    await writeFile(
      join(dir, 'tflw.config'),
      config.replace('#authorized target', 'authorized target').replace('reason ""', 'reason "the fixture server beside this test"'),
      'utf8',
    );
    await fresh.reload();
    await fresh.locator('[data-compose-scan]').waitFor();
    assert.equal(await fresh.locator('[data-compose-scan-unauthorized]').count(), 0, 'the notice must read the config, not be permanent');
    assert.ok((await fresh.locator('[data-compose-scan-covered="yes"]').count()) > 0, 'and the origin the scan reaches is covered now');
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// `M200` `A0-5` / §5's green condition, whole: open the page on a directory that is not a tflw
// project, pick LOAD, and come out the other side having run a workload test the page wrote.
// Its own server over its own empty directory, because the fixture project above is a project.
// ---------------------------------------------------------------------------

test('a directory that is not a project: pick LOAD, get one, write a test into it, run it, read its charts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-green-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage();
  try {
    const base = `http://127.0.0.1:${await ui.listen(0)}`;
    await fresh.goto(`${base}/?token=${TOKEN}`);

    // 1. The landing says there is nothing here, and offers to make one rather than showing four
    //    doors onto an empty project.
    await fresh.locator('[data-landing]').waitFor();
    /* `M235-08` — the wait above is on `[data-landing]` and the read below is on a **door**, which
       is a different subject, so the landing could be up and still be deciding. It was:
       `noProject` was `useState(false)` and `false` is one of the two answers, so a directory that
       is not a project painted `open` doors until the probe returned. `E`'s sweep caught it at
       1 of 56 with `'open' !== 'create'`. The page now says `asking` until it knows, which is what
       makes this wait expressible without being the assertion (`M141`): *it has finished asking* is
       measurable, *what it answered* is the claim. The `create` copy asserted below is downstream of the same answer. */
    const decided = await settle(
      () => fresh.locator('[data-door="load"] [data-door-state]').getAttribute('data-door-state'),
      untilMeasurable('the landing has finished asking whether this is a project', (v) => v !== null && v !== 'asking'),
      { attempts: 40, delayMs: 50, page: fresh },
    );
    assert.equal(decided.value, 'create', `the door offers to create a project (${decided.attempts} look(s))`);
    assert.match((await fresh.locator('[data-door="load"]').textContent()) ?? '', /create a project, with a load test/);

    // 2. Picking LOAD creates the project and lands in the LOAD door. `tflw init --load`, spawned
    //    — so what is on disk is what a terminal would have written.
    await fresh.locator('[data-door="load"]').click();
    await fresh.locator('[data-compose-pane]').waitFor();
    assert.equal(new URL(fresh.url()).hash, '#/load');
    const scaffold = await readFile(join(dir, 'load.tflw'), 'utf8');
    const fromTerminal = await mkdtemp(join(tmpdir(), 'tflw-terminal-'));
    execFileSync(process.execPath, ['--import', tsxLoader, cliEntry, 'init', '--load'], { cwd: fromTerminal, stdio: 'pipe' });
    assert.equal(scaffold, await readFile(join(fromTerminal, 'load.tflw'), 'utf8'), 'the page and the terminal write the same bytes');
    await rm(fromTerminal, { recursive: true, force: true });

    // 3. Point the new project at the fixture server, so a run has something to call.
    const config = await readFile(join(dir, 'tflw.config'), 'utf8');
    await writeFile(join(dir, 'tflw.config'), config.replace(/api "[^"]*"/, `api "http://127.0.0.1:${fixturePort}"`));

    /* 4. Write a workload test into the file the door scaffolded — through `+ new test`, which is
          the page's one way to write one (`D1118`) and which on this door writes `D1213`'s four
          lines: the workload, the threshold `TF033` forces, a request and its assertion.

          **THE STEP THIS TEST USED TO SPLICE IN FROM OUTSIDE IS GONE**, and that is the round's
          visible result at this end. It read *"a form cannot write a test that calls anything, so
          give it one step from the outside"* and then PUT an `api GET /health` through the write
          route — the workaround `insertIntoSource`'s own docblock records as the gap it could not
          close (*"a LOAD form cannot write a test that calls anything, because `api` steps are the
          API door's vocabulary"*). The LOAD door's vocabulary is API's now (`D1211`, `TF033`), so
          the scaffold writes the request and the run below has something to call. */
    await fresh.reload();
    await fresh.locator('[data-compose-pane]').waitFor();
    await fresh.locator(`[data-file-row="load.tflw"]`).click();
    await fresh.locator('[data-compose-new-test]').click();
    await fresh.locator('[data-new-name]').fill('the health check under load');
    await fresh.locator('[data-new-path]').fill('/health');
    if (await fresh.locator('[data-new-create]').isDisabled()) assert.fail(`the dialog cannot write: ${await fresh.locator('[data-new-problem]').textContent()}`);
    await fresh.locator('[data-new-create]').click();
    await fresh.locator('[data-new-thing]').waitFor({ state: 'detached' });
    // `+ new test` **stages** the buffer (`D1118`); the write is still the author's press.
    await fresh.locator('[data-compose-write]').click();
    await fresh.locator('[data-compose-dirty]').waitFor({ state: 'detached' });

    const written = await readFile(join(dir, 'load.tflw'), 'utf8');
    assert.match(written, /\n {2}ramp to 5 users over 2s\n {2}api GET \/health\n {2}expect status equals 200\n {2}threshold error rate is less than 1%\n/, written);

    // 5. Run it from the page and read the charts of the test the page wrote.
    //
    // **THE RUN IS STARTED FROM THE SIDEBAR AND READ FROM THE Run TAB**, and those are two
    // gestures since `M207` `S1` gave this door a strip. `M206` `Q5` is why they are two: there is
    // no `send` on LOAD, so a run marks Run rather than switching to it — and a workload run is
    // the long one, so being moved off a form you are still filling in would cost most here. The
    // mark is waited on first, because it is the page's own claim that there is something to go
    // and look at.
    await fresh.reload();
    await fresh.locator('[data-files]').waitFor();
    await fresh.locator('[data-file-row="load.tflw"]').click();
    await fresh.locator('[data-run]').click();
    await fresh.locator('[data-tab-mark="run"]').waitFor({ timeout: 60_000 });
    await fresh.locator('[data-tab="run"]').click();
    await fresh.locator('[data-tabstrip="run"]').waitFor();
    await fresh.locator('[data-report]').waitFor({ timeout: 60_000 });
    /* `M235` `E` — **the one HIGH the `ATTACH-ONLY` rule turned up, and it is `M227` `A`'s recorded
       shape at a second site**: `waitFor()` settles that the canvas has attached, `boundingBox()`
       then reads a box that may be pre-layout, and `M227 A` failed in CI reading exactly that as
       `[0]` against `[180]`. Written on `laidOutChartHeights`' pattern, which is this file's
       established answer to the same question. The predicate is a measurability one — a canvas is
       either laid out or it is not, which is not `M141`'s *measured wrong* — and it stays
       falsifiable because the budget is bounded: a report whose charts never size fails here with
       the widths it saw, rather than passing on a lucky frame or hanging. */
    const painted = await settle(
      () => fresh.locator('[data-report] canvas')
        .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width))),
      untilMeasurable("the report's charts mounted and sized", (w) => w.length > 0 && !w.includes(0)),
      { attempts: 50, delayMs: 100, page: fresh },
    );
    assert.ok(
      painted.value.length > 0 && !painted.value.includes(0),
      `the workload charts are painted (${painted.attempts} look(s); widths ${painted.value.join(', ') || 'none'})`,
    );

    // 6. And the file is readable by the tool with no page involved.
    const check = execFileSync(process.execPath, ['--import', tsxLoader, cliEntry, 'check'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
    assert.ok(!/error/i.test(check), check);
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// `M200` `A1-4` — the API door writes work, not a policy about work. The LOAD **form** could only
// ever add a workload line or a threshold, because `api` steps were the API door's vocabulary —
// the gap `A0-5`'s green-condition test had to write around. `M224` `D` closed it at the source:
// `VOCABULARY.load.constructs` is API's set, for `TF033`'s reason. What survives here is the claim
// that outlives the form — **a door adds the work it knows how to describe, to a test any door may
// have started** (`D1044`) — and the three regions of one test it lands in.
// ---------------------------------------------------------------------------


test('the API door adds work to a test the LOAD door started, above its workload’s thresholds', async () => {
  // A `steps` insertion has to land below the `run … iterations` line and above any `threshold`,
  // which is three regions of one test and the shape the lang gate measures directly.
  const target = 'tests/load.tflw';
  await page.goto(`${pageUrl}#/load`);
  await page.reload();
  await page.locator('[data-compose-pane]').waitFor();
  await page.locator(`[data-file-row="${target}"]`).click();
  await page.locator('[data-compose-new-test]').click();
  await page.locator('[data-new-name]').fill('the API door finishes this one');
  await page.locator('[data-new-path]').fill('/health');
  await page.locator('[data-new-create]').click();
  await page.locator('[data-new-thing]').waitFor({ state: 'detached' });
  // `+ new test` stages the buffer; the write is still the author's.
  await page.locator('[data-compose-write]').click();
  await page.locator('[data-compose-dirty]').waitFor({ state: 'detached' });

  const started = await readFile(join(root, target), 'utf8');
  assert.ok(started.includes('ramp to 5 users over 2s'), started);
  // **The scaffold now writes the request the form could not** (`D1211`, `D1213`) — so the claim
  // below is no longer *the LOAD door wrote no work*, which stopped being true this round. It is
  // that the API door adds a SECOND request to a test this door started, and that it lands in the
  // right region of it.
  assert.ok(/the API door finishes this one[\s\S]*?\n  api GET \/health\n/.test(started), started);

  // **`M212` `S4b` moved this gesture and not this claim.** The retired form did it by picking
  // *add to an existing test* out of a dropdown; the API door now does it with `+ request` at the
  // foot of that test's own body. `D1044` is unchanged either way — a door adds the work it knows
  // how to describe, to a test any door may have started.
  await page.goto(`${pageUrl}#/api`);
  await page.reload();
  await page.locator('[data-door-form="api"]').waitFor();
  await page.locator(`[data-file-row="${target}"]`).click();
  const started2 = await readFile(join(root, target), 'utf8');
  const declLine = started2.split('\n').findIndex((l) => l.includes('test "the API door finishes this one"')) + 1;
  await page.goto(`${pageUrl}#/api/compose/${target}/L${declLine}`);
  await page.locator('[data-seq-add="request"]').click();
  await page.locator('[data-compose-dirty]').waitFor();
  // The address names the TEST (`M214` `D1113`), so the request that was just added is picked from
  // the column — which is also the gesture a person makes, and the reason the column is beside the
  // editor rather than above it.
  await page.locator('[data-seq-row="request"] [data-seq-pick]').last().click();
  await page.locator('[data-request-path]').fill('/items');
  await page.locator('[data-compose-dirty]').waitFor();

  await openTab('source');
  const preview = (await page.locator('[data-preview]').textContent()) ?? '';
  await openTab('compose');
  await page.locator('[data-compose-write]').click();
  await page.locator('[data-compose-dirty]').waitFor({ state: 'detached' });

  const finished = await readFile(join(root, target), 'utf8');
  assert.equal(finished, preview, 'the bytes on disk are the bytes previewed');

  // The three regions, in order: the workload line, then the work, then the threshold.
  const test = finished.slice(finished.indexOf('test "the API door finishes this one"'));
  /* **`indexOf` on the assertion reads the SCAFFOLD's, not the added one, since `M224` `F`.**
     `D1213` writes `expect status equals 200` under the scaffolded request, so the first match sits
     *above* `api GET /items` and the order assertion failed on correct bytes. The added pair is the
     last of each, which is also what the claim is about. */
  const workloadAt = test.indexOf('ramp to 5 users over 2s');
  const stepAt = test.indexOf('api GET /items');
  const expectAt = test.lastIndexOf('expect status equals 200');
  const thresholdAt = test.indexOf('threshold error rate is less than 1%');
  assert.ok(workloadAt >= 0 && stepAt >= 0 && expectAt >= 0 && thresholdAt >= 0, test);
  assert.ok(workloadAt < stepAt, `the work goes below the workload line, not above it:\n${test}`);
  assert.ok(stepAt < expectAt, `the assertion reads the request above it:\n${test}`);
  assert.ok(expectAt < thresholdAt, `the threshold stays at the foot:\n${test}`);

  const check = execFileSync(process.execPath, ['--import', tsxLoader, cliEntry, 'check'], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  assert.ok(!/error/i.test(check), check);
});

test('a header that interpolates a variable the test already captured checks clean', () => {
  // The positive half of `A1-4`'s `stringLit` fix, which the unbound case cannot make: the built
  // node has to carry the reference AS a reference for the checker to resolve it against the
  // `capture` above it. A text blob would have been invisible to `TF030` in both directions —
  // never flagged when wrong, and never resolvable when right.
  const source = [
    'test "t"',
    '  api GET /items',
    '  capture body.items[0].id as firstId',
    '  api GET /items/1',
    '    header "X-Trace" is "item-{firstId}"',
    '  expect status equals 200',
    '',
  ].join('\n');
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics.filter((d) => d.severity === 'error'), []);
  assert.deepEqual(checkProgram(program).filter((d) => d.severity === 'error'), []);
  // …and the same text with the capture removed is the TF030 the form now shows.
  const unbound = parseSource(source.replace('  capture body.items[0].id as firstId\n', ''));
  assert.ok(checkProgram(unbound.program).some((d) => d.code === 'TF030'), 'the control must fail');
});

// ---------------------------------------------------------------------------
// `M200` `A1-5` — `D1047`'s Send. One execution path and one artefact kind: the page writes a
// scratch file through the same route the save button uses, runs the same `tflw run` the sidebar
// runs, and reads the response out of `results.json`.
// ---------------------------------------------------------------------------



test('the page says when the scratch file is not ignored, rather than editing .gitignore itself', async () => {
  // A project `tflw init` makes lists the scratch; an older one does not, and the page tells the
  // author instead of silently changing a file they own. The fixture project has no `.gitignore` at
  // all, which is the case that matters — absence, not a wrong rule.
  //
  // **`M212` `S4b` moved the notice, and the move is the point.** It used to sit in the retired
  // form, under a Send that no longer exists; it now sits beside the Send that does, because a
  // warning about a file belongs next to the button that writes that file. Reaching it therefore
  // means selecting a request, which is also when it first becomes true.
  const view = await fullProject();
  const f = view.files.find((x) => x.path.endsWith('catalog.tflw'))!;
  // The reload is load-bearing: a `goto` that only changes the hash is a same-document navigation,
  // so the shell keeps the project view it already has and the notice would be reading a fact from
  // before the `.gitignore` was written.
  const atRequest = async (): Promise<void> => {
    await page.goto(`${pageUrl}#/api/compose/${f.path}`);
    await page.reload();
    await page.locator('[data-prefix]').waitFor();
  };
  await atRequest();
  const notice = await page.locator('[data-api-scratch-unignored]').textContent();
  assert.ok((notice ?? '').includes(SCRATCH_PATH), notice ?? '');
  assert.match(notice ?? '', /gitignore/);

  // THE CONTROL, AND IT HAS TO BE ON THE PAGE. Asserting the server's fact flips is not asserting
  // the notice reads it: the mutation showing the notice unconditionally survived a version of
  // this test that checked only `/api/project`. So the line is added, the page reloaded, and the
  // notice has to be gone.
  await writeFile(join(root, '.gitignore'), `${SCRATCH_PATH}\n`, 'utf8');
  const project = (await (await api(`${baseUrl}/api/project`)).json()) as { scratchPath: string; scratchIgnored: boolean };
  assert.equal(project.scratchPath, SCRATCH_PATH);
  assert.equal(project.scratchIgnored, true);

  await atRequest();
  assert.equal(await page.locator('[data-api-scratch-unignored]').count(), 0, 'the notice goes when the line is there');

  await rm(join(root, '.gitignore'), { force: true });
  await atRequest();
  await page.locator('[data-api-scratch-unignored]').waitFor();
});



test('the strip is an address, and Compose keeps what you typed while you are looking somewhere else', async () => {
  // `M205` S5. The tab is the hash's second segment, which buys three things at once: a link to a
  // tab is a link, the back button walks tabs, and `D1045`'s rule — the choice lives in the URL and
  // nowhere else — extends to the strip without a second mechanism.
  //
  // The first claim is the one with a cost if it is wrong. `#/api` meant something before the strip
  // existed and has to keep meaning it, because every link anyone has ever pasted is of that shape
  // and `doorFromHash` now has to ignore a segment that was not there.
  await page.goto(`${pageUrl}#/api`);
  await page.reload();
  await page.locator('[data-door-form="api"]').waitFor();
  assert.equal(await page.locator('[data-tabstrip]').getAttribute('data-tabstrip'), 'compose', 'a pre-strip link stopped opening the door');

  // A pasted tab link lands on that tab, with the door still resolved around it.
  await page.goto(`${pageUrl}#/api/source`);
  await page.reload();
  await page.locator('[data-tabstrip="source"]').waitFor();
  assert.equal(await page.locator('[data-doorbar]').getAttribute('data-doorbar'), 'api');

  // A tab nobody has heard of is `compose`, not an error — the same tolerance `doorFromHash` has
  // for a hand-typed door, for the same reason.
  await page.goto(`${pageUrl}#/api/coverage`);
  await page.reload();
  await page.locator('[data-tabstrip="compose"]').waitFor();

  // Clicking writes the hash, and the DEFAULT tab writes the bare door hash rather than
  // `#/api/compose` — the commonest address stays the short one, which is also what keeps the
  // first assertion in this test true a year from now.
  const view = await fullProject();
  const f = view.files.find((x) => x.path.endsWith('catalog.tflw'))!;
  // **`M214` `D1113` — the editor draws whatever is SELECTED, and an address with no `L` selects
  // the file.** That is not a special case: clicking a file in the explorer drops the focus line by
  // design (`setFile`), so *no line* is exactly the state that gesture produces, and the file's own
  // fields are what it should show. A request is named by its line, which is what this test is
  // about anyway — it types into a request's path.
  const firstRequest = requestsInSource(await readFile(join(root, f.path), 'utf8'))[0]!;
  await page.goto(`${pageUrl}#/api/compose/${f.path}/L${firstRequest.line}`);
  await page.locator('[data-request-path]').waitFor();

  // **`M212` `S4b` changed what is typed into, and sharpened what this grades.** The retired form's
  // fields were `useState` in `ApiForm`, so this test was about a component boundary; Compose's are
  // the **pending buffer** (`D1079`), which is the thing a tab trip must not drop — and the buffer
  // is what the write button carries, so losing it loses an edit rather than a draft.
  await page.locator('[data-request-path]').fill('/typed-before-leaving');
  await page.locator('[data-compose-dirty]').waitFor();
  await openTab('run');
  assert.match(new URL(page.url()).hash, /^#\/api\/run\//);
  await openTab('compose');

  // **The Run tab's address names a REPORT, not this file** — `#/api/run/<id>` carries no `L`, so
  // coming back the address names the file and `D1113` selects the file. The buffer is what this
  // gate is about and the buffer is the shell's (`D1079`), so it survived the trip; the request is
  // one click away in the column, which is where it has been since `M214`.
  await page.locator('[data-seq-row="request"] [data-seq-pick]').first().click();
  assert.equal(await page.locator('[data-request-path]').inputValue(), '/typed-before-leaving');
  assert.ok(await page.locator('[data-request-path]').isVisible(), 'and its controls came back reachable, not merely present');
  await page.locator('[data-compose-dirty]').waitFor();

  // And the back button walks the tabs, because they are addresses and not a mode.
  await openTab('source');
  await page.goBack();
  await page.locator('[data-tabstrip="compose"]').waitFor();
  assert.equal(await page.locator('[data-request-path]').inputValue(), '/typed-before-leaving', 'going back re-mounted the pane over the same buffer');
  await page.locator('[data-compose-discard]').click();
});

test('Auth says what a session does NOT reach, and a mixed test is where that matters', async () => {
  // `M206` `S4`, closing `M206-01`. The shipped panel said *who this file runs as* and stopped.
  // SPEC §3.3: **a session does not log the browser in** — its cached state is never applied to the
  // test's fresh browser context, because a cookie jar and a browser context's storage state are
  // two representations `D10` deliberately never bridges. So the sentence was true of a file's api
  // steps and false of its page steps.
  //
  // **THIS TEST BRINGS ITS OWN PROJECT, AND THAT IS THE FINDING.** Not one test in
  // `packages/ui/fixtures/project` carries both an api step and a page step — every file there is
  // all-api or all-page — so the corpus behind the shipped gate could not produce the case where
  // its panel was wrong. The assertion was not weak; the fixture had no instance of the class.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-auth-mixed-'));
  const fresh = await newPage();
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local\n  api "http://127.0.0.1:1"\n  web "http://localhost:3000"\n', 'utf8');
    // One test that logs in twice — an API call for its api steps and a form for its page — which
    // is what SPEC §3.3 says a mixed test must do, and the shape the old sentence misdescribed.
    await writeFile(
      join(dir, 'mixed.tflw'),
      [
        'test "signing in, both ways"',
        '  api POST /login body { email: "sam@example.com" }',
        '  expect status equals 200',
        '  open "/signin"',
        '  fill field "Email" with "sam@example.com"',
        '  click button "Sign in"',
        '  expect text "Signed in" is visible',
        '',
        'test "just the api"',
        '  api GET /items',
        '  expect status equals 200',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(join(dir, 'apionly.tflw'), 'test "nothing but api"\n  api GET /items\n  expect status equals 200\n', 'utf8');

    const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
    const base = `http://127.0.0.1:${await ui.listen(0)}/`;
    try {
      await fresh.goto(`${base}?token=${TOKEN}#/browser/auth/mixed.tflw`);
      await fresh.locator('[data-auth-reach-api]').waitFor();

      // Both kinds counted, from the language's own `stepLensCounts` rather than a rule invented
      // here. `header`/`csrf` count as api on purpose — for an auth panel a `header` line is where
      // a credential is written by hand.
      // Exact numbers, not `> 0`, and **summed over the FILE** because the panel is file-scoped:
      // 4 api (two requests and the two `expect status` that read them, across both tests) against
      // 4 page (open, fill, click and the `expect text … is visible`). An `expect` counts for the
      // kind of work its subject does — `StatusSubject` is api, `LocatorSubject` is browser — which
      // is the doors' own classification rather than a narrower one invented for this panel.
      assert.equal(await fresh.locator('[data-auth-reach-api]').getAttribute('data-auth-reach-api'), '4', 'api work miscounted');
      assert.equal(await fresh.locator('[data-auth-reach-page]').getAttribute('data-auth-reach-page'), '4', 'page work miscounted');

      // The refusal itself — the sentence the panel exists to stop implying the opposite of.
      const bridge = await fresh.locator('[data-auth-no-bridge]').textContent();
      assert.match(bridge ?? '', /session does not log the browser in/i);

      // And the case it matters most in, named rather than counted: the test that establishes
      // identity twice.
      assert.equal(await fresh.locator('[data-auth-mixed]').getAttribute('data-auth-mixed'), '1');
      assert.match((await fresh.locator('[data-auth-mixed]').textContent()) ?? '', /signing in, both ways/);

      // NEGATIVE CONTROL, and the test is worth little without it: on a file with no page steps the
      // refusal is ABSENT. A warning shown unconditionally is decoration, and would pass every
      // assertion above while telling an api-only author something irrelevant.
      await fresh.goto(`${base}?token=${TOKEN}#/browser/auth/apionly.tflw`);
      await fresh.locator('[data-auth-reach-api]').waitFor();
      assert.equal(await fresh.locator('[data-auth-reach-page]').getAttribute('data-auth-reach-page'), '0');
      assert.equal(await fresh.locator('[data-auth-no-bridge]').count(), 0, 'the refusal is shown on a file it does not apply to');
      assert.equal(await fresh.locator('[data-auth-mixed]').count(), 0);
    } finally {
      await ui.close();
    }
  } finally {
    await fresh.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the Auth block leads with the anonymous case, and each door gets only its own caveat', async () => {
  // `M207` `S3`, building `Q2`/`Q3`/`Q4`, and repairing `M207-01` on the way.
  //
  // `M206` `S4` titled this block *what a session reaches here* and built it against a browser file
  // that DOES log in. Measured, **94% of files name no session at all** — 20 of the sibling's 319
  // tests, 9 of its 84 files, zero in the fixture and zero in `examples/storefront` — so on the
  // commonest file in every project the title presupposed something not there. The anonymous case
  // is the headline now and each door's caveat hangs off it.
  //
  // **THE PROJECT IS THIS TEST'S OWN** (`Q5`). The shared fixture declares zero sessions, so it
  // cannot produce `Q4`'s panel at all; the gate already builds eleven temporary projects, so
  // bringing one is the dominant pattern here rather than an exception. Five sessions, two of them
  // `privileged`, so the probe set AND the exclusion set are both non-empty and nameable — a
  // fixture with one or the other empty would let a panel that showed only one of them pass.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-auth-frame-'));
  const fresh = await newPage();
  try {
    await writeFile(
      join(dir, 'tflw.config'),
      [
        'env local',
        '  api "http://127.0.0.1:1"',
        '  web "http://localhost:3000"',
        '  authorized target "http://127.0.0.1:1" because "a fixture server this test owns"',
        '',
        'session admin privileged',
        '  api POST /login body { who: "admin" }',
        '  expect status equals 200',
        '',
        'session ops privileged',
        '  api POST /login body { who: "ops" }',
        '  expect status equals 200',
        '',
        'session shopper',
        '  api POST /login body { who: "shopper" }',
        '  expect status equals 200',
        '',
        'session peer',
        '  api POST /login body { who: "peer" }',
        '  expect status equals 200',
        '',
        'session guest',
        '  api POST /login body { who: "guest" }',
        '  expect status equals 200',
        '',
      ].join('\n'),
      'utf8',
    );
    // Two files, and the split is the whole test: one names a session, one names none. 94% of real
    // files are the second kind, and the second kind is what the old title got wrong.
    await writeFile(join(dir, 'named.tflw'), 'test "as somebody" as shopper\n  api GET /items\n  expect status equals 200\n', 'utf8');
    await writeFile(join(dir, 'nobody.tflw'), 'test "as nobody"\n  api GET /items\n  expect status equals 200\n', 'utf8');

    const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
    try {
      const base = `http://127.0.0.1:${await ui.listen(0)}/`;

      // 1. THE HEADLINE, on the commonest kind of file. The block leads with the anonymous case
      //    rather than with a caveat about sessions the file does not have.
      await fresh.goto(`${base}?token=${TOKEN}#/api/auth/nobody.tflw`);
      await fresh.locator('[data-auth-identity]').waitFor();
      assert.equal(await fresh.locator('[data-auth-identity]').getAttribute('data-auth-identity'), 'anonymous');
      assert.match((await fresh.locator('[data-auth-identity]').textContent()) ?? '', /Nothing here declares an identity/);
      assert.match((await fresh.locator('[data-auth-identity]').textContent()) ?? '', /anonymous/);

      // …and it is said ONCE. Before the reframe the enumeration block carried the same sentence,
      // which would now be a duplicate over one file on 94% of files — the class `Q1` refused
      // between Compose and Auth, one block apart instead of one tab.
      assert.equal(await fresh.locator('[data-auth-sessions]').count(), 0, 'the enumeration renders with nothing to enumerate');

      // 2. The other kind of file names its sessions in the same headline slot.
      await fresh.goto(`${base}?token=${TOKEN}#/api/auth/named.tflw`);
      await fresh.locator('[data-auth-identity]').waitFor();
      assert.equal(await fresh.locator('[data-auth-identity]').getAttribute('data-auth-identity'), 'named');
      assert.match((await fresh.locator('[data-auth-identity]').textContent()) ?? '', /shopper/);
      assert.equal(await fresh.locator('[data-auth-sessions]').getAttribute('data-auth-sessions'), '1');

      // 3. `Q4` — SCANS inverts the premise: the identity in force is not one, it is all of them.
      //    Both sets named, and the numbers are the ones `probeSetFor` would build: five declared
      //    sessions, two privileged, so four probe as (three plus `anonymous`) and two are out.
      await fresh.goto(`${base}?token=${TOKEN}#/scan/auth/named.tflw`);
      await fresh.locator('[data-auth-scan-caveat]').waitFor();
      const scanCaveat = fresh.locator('[data-auth-scan-caveat]');
      assert.equal(await scanCaveat.getAttribute('data-auth-probe-set'), '4', 'the probe set is not three sessions plus anonymous');
      assert.equal(await scanCaveat.getAttribute('data-auth-probe-excluded'), '2', 'the privileged exclusion is not both privileged sessions');
      const scanText = (await scanCaveat.textContent()) ?? '';
      for (const name of ['shopper', 'peer', 'guest', 'anonymous']) assert.match(scanText, new RegExp(name), `${name} is not named in the probe set`);
      for (const name of ['admin', 'ops']) assert.match(scanText, new RegExp(name), `${name} is not named as excluded`);
      assert.match(scanText, /says nothing about what those principals could reach/, 'the consequence of the exclusion is not stated');

      // 4. `Q3` — LOAD's caveat, and the half that matters is the second: a re-login's own requests
      //    are absent from the numbers a `threshold p95 duration` is computed over.
      await fresh.goto(`${base}?token=${TOKEN}#/load/auth/named.tflw`);
      await fresh.locator('[data-auth-load-caveat]').waitFor();
      const loadText = (await fresh.locator('[data-auth-load-caveat]').textContent()) ?? '';
      assert.match(loadText, /Many users, one identity/);
      assert.match(loadText, /absent from this run's numbers/);
      assert.match(loadText, /threshold p95 duration/);

      // 5. **THE NEGATIVE CONTROL, AND IT IS THE POINT OF THE SLICE.** Each caveat appears on its
      //    own door and NOWHERE ELSE. A panel that showed all three to every reader would satisfy
      //    every assertion above — and is exactly what shipped in `S4`, which is how BROWSER's
      //    refusal came to be stated on the SCANS door. Walked across all four.
      for (const door of ['api', 'browser', 'load', 'scan'] as const) {
        await fresh.goto(`${base}?token=${TOKEN}#/${door}/auth/named.tflw`);
        await fresh.locator('[data-auth-identity]').waitFor();
        assert.equal(await fresh.locator('[data-auth-load-caveat]').count(), door === 'load' ? 1 : 0, `LOAD's caveat on the ${door} door`);
        assert.equal(await fresh.locator('[data-auth-scan-caveat]').count(), door === 'scan' ? 1 : 0, `SCANS' caveat on the ${door} door`);
        // BROWSER's needs page work as well as the door, and `named.tflw` has none — so it is
        // absent on all four here, which is `S4`'s own control still holding under the door gate.
        assert.equal(await fresh.locator('[data-auth-no-bridge]').count(), 0, `the bridge refusal on the ${door} door with no page steps`);
      }
    } finally {
      await ui.close();
    }
  } finally {
    await fresh.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('no step carries the LOAD lens, so the wire no longer ships a bucket that cannot be non-zero', async () => {
  // `M207-01`, repaired by `M207` `S3`. Found while measuring for this round: `stepLensCounts`
  // returned a `load` key that was **structurally incapable of being non-zero**, because no step,
  // subject or matcher maps to that lens — it comes from `test.workload !== null` or
  // `test.thresholds.length > 0`, which are properties of the test and not of its body.
  //
  // Nothing read it, so nothing was broken. The cost was the next slice: a LOAD panel built by
  // copying `M206` `S4`'s pattern would have said *"0 statements do load work"* on a workload test,
  // which is the wrong-number class `S4` corrected mid-slice arriving one door later.
  //
  // It is checked here on the **wire** rather than in a unit test of `stepLensCounts`, because the
  // field's whole existence was as something the page reads. The type change in `lenses.ts` is what
  // makes it unwritable; this is what makes it observably gone.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-steps-load-'));
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local\n  api "http://127.0.0.1:1"\n', 'utf8');
    // A test that is behind the LOAD door by both routes at once — a workload line AND a threshold
    // — plus api work and a scan matcher, so three buckets are non-zero and the fourth's absence
    // cannot be confused with an empty test.
    await writeFile(
      join(dir, 'w.tflw'),
      [
        'test "under load"',
        '  run 120 iterations across 4 users',
        '  threshold p95 duration < 500ms',
        '  api GET /items',
        '  expect status equals 200',
        '  expect response has no serious security violations',
        '',
      ].join('\n'),
      'utf8',
    );
    const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
    try {
      const base = `http://127.0.0.1:${await ui.listen(0)}`;
      const project = (await (await api(`${base}/api/project`)).json()) as {
        files: { path: string; tests: { name: string; lenses: string[]; steps: Record<string, number> }[] }[];
      };
      const test = project.files.find((f) => f.path === 'w.tflw')!.tests[0]!;

      // The test IS behind LOAD — asserted first, because without it the absence below is the
      // absence of a lens nothing here carries, which would be true of any file at all.
      assert.ok(test.lenses.includes('load'), 'the fixture is not behind the LOAD door, so this proves nothing');

      assert.deepEqual(Object.keys(test.steps).sort(), ['api', 'browser', 'scan'], 'the wire still ships a `load` step bucket');
      assert.ok(test.steps.api! > 0 && test.steps.scan! > 0, 'the buckets that should count are empty, so the shape above is not evidence');
    } finally {
      await ui.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the affirmation this door refuses to make is one the author can make on this page (M207-02)', async () => {
  // `M207` `S4`, repairing `M207-02`. The notice gave two reasons — the target lives in a file
  // *"this page does not write (`D1049`) and must not (`D291`)"* — and `M205` `Q5` had made the
  // first half false the day before: `ConfigPanel` writes `tflw.config` through `PUT /api/config`,
  // a second route with its own validation, so that `D1049`'s one-write-call-site property for
  // `.tflw` stayed untouched.
  //
  // That is worse than a wholly stale comment. A reader who checks it finds the page CAN write the
  // file and may conclude the whole refusal is obsolete, removing a safeguard whose basis never
  // moved. And it pointed away from a repair that was already reachable: `D291` asks that the
  // affirmation be the author's, and **typing it into Config is the author making it**.
  //
  // So this gate is the live consequence rather than a prose check — it walks the repair the notice
  // now names, on a project that genuinely has none, and asserts the notice retracts itself. A test
  // that only read the sentence would pass against a link that went nowhere.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-scan-affirm-'));
  const fresh = await newPage();
  try {
    execFileSync(process.execPath, ['--import', tsxLoader, cliEntry, 'init', '--scan'], { cwd: dir, stdio: 'pipe' });
    const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
    try {
      const base = `http://127.0.0.1:${await ui.listen(0)}`;
      await fresh.goto(`${base}/?token=${TOKEN}#/scan/compose/scan.tflw`);
      await fresh.locator('[data-compose-scan-unauthorized]').waitFor();

      // 1. THE PROSE, both halves. `D291` is named as the standing reason, and the claim that the
      //    page cannot write `tflw.config` is gone — asserted as an absence, because the repair of a
      //    two-reason sentence that lost one reason is not complete while the false half survives.
      const notice = (await fresh.locator('[data-compose-scan-unauthorized]').textContent()) ?? '';
      assert.match(notice, /D291/, 'the standing reason is not named');
      assert.doesNotMatch(notice, /D1049/, 'the half `M205` `Q5` falsified is still stated');
      assert.doesNotMatch(notice, /does not write|cannot write/i, 'the notice still claims this page cannot write tflw.config');
      assert.match(notice, /Config/, 'the notice does not say where the affirmation is made');

      // 2. THE LINK GOES THERE, and the address carries it (`D1045`).
      await fresh.locator('[data-compose-scan-config-link]').click();
      await fresh.locator('[data-tabstrip="config"]').waitFor();
      assert.equal(new URL(fresh.url()).hash, '#/scan/config/scan.tflw', 'the link did not put the tab in the address');

      // 3. **THE AFFIRMATION, MADE HERE.** `tflw init --scan` leaves the line commented out on
      //    purpose, so uncommenting it in this textarea is precisely the act `D291` reserves to the
      //    author — and it is the act the old prose sent the reader out of the product to perform.
      const before = await fresh.locator('[data-api-config-text]').inputValue();
      assert.match(before, /^\s+#authorized target .* reason ""$/m, 'the scaffold no longer leaves an inert declaration, so this test affirms nothing');

      // **REMOVING THE `#` IS SUFFICIENT, AND UNTIL `M207` `S4` IT WAS NOT (`M207-03`).** The
      // scaffold wrote this line at column 0, after a blank line that had already closed
      // `env local default` — and `authorized target` is only grammatical indented inside an `env`
      // or `defaults` block. So the one act the scaffold instructs produced `TF022` (and `TF020`
      // too, if you kept the indentation), which this gate found by trying to walk the repair the
      // SCANS notice now names. The declaration moved inside the block in the same slice.
      const uncommented = before.replace('#authorized target', 'authorized target');
      assert.notEqual(uncommented, before, 'the uncomment did nothing, so the steps below prove nothing');

      // **AND IT IS TWO ACTS, NOT ONE, WHICH THE SCAFFOLD DESIGNED ON PURPOSE.** Uncommenting alone
      // is `TF082` — the scaffold writes `reason ""` and a blank reason is refused — so `TF060`
      // says *uncomment this* and `TF082` says *now say why*, and neither can be satisfied by
      // accident. Asserted through the save button, which `ConfigPanel` disables while the text has
      // errors: the affirmation is not complete until the claim has a reason, and the page will not
      // let it be written half-made. This is also the control on the step above — a `#` removal
      // that had left the line ungrammatical would disable save for the WRONG reason, so the
      // diagnostic is read rather than only the button.
      await fresh.locator('[data-api-config-text]').fill(uncommented);
      await fresh.locator('[data-api-config-diagnostics]').waitFor();
      assert.match((await fresh.locator('[data-api-config-diagnostics]').textContent()) ?? '', /TF082/, 'the blank reason is not what the page is objecting to');
      assert.equal(await fresh.locator('[data-api-config-save]').isDisabled(), true, 'a blank reason saves, so TF082 is not being enforced on this page');

      await fresh.locator('[data-api-config-text]').fill(uncommented.replace('reason ""', 'reason "a fixture host this test owns"'));
      await fresh.locator('[data-api-config-save]').click();
      await fresh.locator('[data-api-config-saved]').waitFor();

      // 4. AND THE NOTICE RETRACTS ITSELF. This is the whole claim: the form said the write would be
      //    `TF060`, named where to fix it, and the fix taken from this page makes the form stop
      //    saying it. Read after a reload, so the assertion is about `tflw.config` on disk and not
      //    about a value this page is still holding.
      await fresh.goto(`${base}/?token=${TOKEN}#/scan/compose/scan.tflw`);
      await fresh.reload();
      await fresh.locator('[data-compose-scan]').waitFor();
      assert.equal(await fresh.locator('[data-compose-scan-unauthorized]').count(), 0, 'the notice survives the affirmation it asked for');

      // …and the file says so too, with no page involved — the only reading that proves the page
      // wrote a real `authorized target` rather than merely hiding its own warning.
      const config = await readFile(join(dir, 'tflw.config'), 'utf8');
      assert.match(config, /^\s*authorized target/m, 'tflw.config has no uncommented authorized target');
    } finally {
      await ui.close();
    }
  } finally {
    await fresh.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the reason for authorized targets lives on the door that owns it, in both states, and not in Auth', async () => {
  // `M207` `S5`. Auth's `authorized targets in force` block opened with a paragraph explaining WHY
  // the language demands the declaration — *"A scan issues requests nobody wrote…"*. Every sentence
  // was true; the problem is that a **project-scoped block explained itself in one door's terms on
  // all four**, prose written when Auth existed only on the API door and generalised by propagation
  // rather than by decision. `Q1` had already settled the principle for the other half of this same
  // subject, so this applies it one block further: Auth states the facts, SCANS' Compose states the
  // reason.
  //
  // **THE MEASUREMENT CHANGED THE SLICE'S DESIGN BEFORE IT WAS WRITTEN, AND THE VACUITY CONTROL IS
  // WHAT CARRIES THAT.** `ScanForm`'s notice renders only when the env declares NO target, and all
  // three projects on this machine declare one — `testFlow-tests` 2, `fixtures/project` 1,
  // `examples/storefront` 1. Moving the justification into that branch as it stood would have put
  // the explanation somewhere that renders in none of them: deleted from the healthy case, with
  // every gate green, because no corpus reaches the branch that would have shown the loss. So the
  // reason is asserted reachable **with targets declared and with none**, and the first of those is
  // the case today's corpora actually exercise.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-scan-why-'));
  const fresh = await newPage();
  try {
    execFileSync(process.execPath, ['--import', tsxLoader, cliEntry, 'init', '--scan'], { cwd: dir, stdio: 'pipe' });
    const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
    try {
      const base = `http://127.0.0.1:${await ui.listen(0)}`;
      const reason = /A scan issues requests nobody wrote/;

      // 1. STATE ONE — nothing authorized. This is the state `tflw init --scan` leaves, and the
      //    only state the old notice rendered in.
      //
      //    `M228` `A` (`D1239`) moved this from `ScanForm`'s banner to region 2's `scan` segment,
      //    which is earned by the construct — so the address names the declaration rather than the
      //    door. The sentence itself is carried **verbatim**: a gate matching a regex against
      //    prose that was reworded in transit stops being about the same claim, and this one's
      //    whole point is that the sentence exists in both states.
      await fresh.goto(`${base}/?token=${TOKEN}#/scan/compose/scan.tflw`);
      await fresh.locator('[data-compose-scan-why]').waitFor();
      assert.equal(await fresh.locator('[data-compose-scan-why]').getAttribute('data-compose-scan-why-targets'), '0');
      assert.match((await fresh.locator('[data-compose-scan-why]').textContent()) ?? '', reason, 'the reason is not on the door with nothing authorized');

      // 2. Authorize one, from this page, the way `S4` established.
      const config = await readFile(join(dir, 'tflw.config'), 'utf8');
      await writeFile(
        join(dir, 'tflw.config'),
        config.replace('#authorized target', 'authorized target').replace('reason ""', 'reason "a fixture host this test owns"'),
        'utf8',
      );

      // 3. STATE TWO — something authorized, which is **every project measured for this round** and
      //    the state the old prose would have lost the explanation in. The reason is still here, and
      //    the affirmative half names the count.
      await fresh.goto(`${base}/?token=${TOKEN}#/scan/compose/scan.tflw`);
      await fresh.reload();
      await fresh.locator('[data-compose-scan-why]').waitFor();
      assert.equal(await fresh.locator('[data-compose-scan-unauthorized]').count(), 0, 'the fixture is not in the authorized state, so this half proves nothing');
      assert.equal(await fresh.locator('[data-compose-scan-why]').getAttribute('data-compose-scan-why-targets'), '1');
      const why = (await fresh.locator('[data-compose-scan-why]').textContent()) ?? '';
      assert.match(why, reason, 'the reason vanished in exactly the state every measured project is in');
      assert.match(why, /1 authorized target is in force/, 'the affirmative half does not say what is in force');

      // 4. **AND IT IS A MOVE, NOT A COPY.** The justification is asserted ABSENT from Auth on all
      //    four doors — without this the slice could have left the paragraph where it was and added
      //    a second one, which every assertion above would accept. All four, because the whole
      //    complaint was a project-scoped block reading in one door's terms on every door.
      for (const door of ['api', 'browser', 'load', 'scan'] as const) {
        await fresh.goto(`${base}/?token=${TOKEN}#/${door}/auth`);
        await fresh.reload();
        await fresh.locator('[data-auth-targets]').waitFor();
        assert.doesNotMatch((await fresh.locator('[data-auth-targets]').textContent()) ?? '', reason, `the justification is still in Auth on the ${door} door`);
        // …and the facts stayed. Otherwise "absent" is satisfied by a block that lost everything.
        assert.equal(await fresh.locator('[data-auth-targets]').getAttribute('data-auth-targets'), '1');
        assert.match((await fresh.locator('[data-auth-target-reason]').textContent()) ?? '', /a fixture host this test owns/, `the target's own reason is gone from Auth on the ${door} door`);
      }
    } finally {
      await ui.close();
    }
  } finally {
    await fresh.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the Auth tab says who this file runs as, and every editable thing lands in Config on its own line', async () => {
  // `M205` S5b, Q6. Auth is the rule's second clause — *a project fact that file resolves against*
  // — and it reads where Config writes. The three states it exists to tell apart are all here:
  // a session that resolves, a session declared for another env (which resolves to nothing, and
  // until this tab said nowhere on the page), and the reserved `anonymous` principal.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-auth-tab-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage();
  const noise: string[] = [];
  fresh.on('console', (m) => { if (m.type() === 'error') noise.push(m.text()); });
  try {
    await writeFile(
      join(dir, 'tflw.config'),
      [
        'defaults',                                                                    // 1
        '  authorized target "http://127.0.0.1:4720" reason "the fixture on loopback"', // 2
        '    probe mutating',                                                           // 3
        '',                                                                             // 4
        'env local default',                                                            // 5
        '  api "http://127.0.0.1:4720"',                                                // 6
        '',                                                                             // 7
        'env staging',                                                                  // 8
        '  api "https://staging.example.com"',                                          // 9
        '',                                                                             // 10
        'session admin privileged',                                                     // 11
        '  api POST /login',                                                            // 12
        '  header "Authorization" is "Bearer t"',                                       // 13
        '',                                                                             // 14
        'session ops for env staging',                                                  // 15
        '  api POST /login',                                                            // 16
      ].join('\n') + '\n',
      'utf8',
    );
    await writeFile(
      join(dir, 'orders.tflw'),
      ['test "the ledger" as admin', '  api GET /orders', '  expect status equals 200', '', 'test "ops too" as ops', '  api GET /orders', '  expect status equals 200', '', 'test "the catalogue"', '  api GET /products', '  expect status equals 200', ''].join('\n'),
      'utf8',
    );
    const base = `http://127.0.0.1:${await ui.listen(0)}`;
    await fresh.goto(`${base}/?token=${TOKEN}#/api/auth`);
    await fresh.locator('[data-api-auth]').waitFor();

    // 1. A session that resolves says what running `as` it ADDS to a request — which is the
    //    question a reader has, and one neither Source nor Config answers without reading a body.
    const admin = fresh.locator('[data-auth-session="admin"]');
    assert.equal(await admin.getAttribute('data-auth-session-resolves'), 'true');
    assert.match(await admin.locator('[data-auth-session-what]').innerText(), /adds `Authorization`/);
    assert.match(await admin.innerText(), /privileged/, 'the claim that excludes it from the probe set is on the row');

    // 2. **The state this tab exists for.** `ops` is declared `for env staging`, the active env is
    //    `local`, so the test naming it runs as nobody — a `tflw check` diagnostic with no home on
    //    the page until now. It is marked, and it says which env would have it.
    const ops = fresh.locator('[data-auth-session="ops"]');
    assert.equal(await ops.getAttribute('data-auth-session-resolves'), 'false');
    assert.match(await ops.locator('[data-auth-session-what]').innerText(), /declared for `staging` and you are on `local`/);

    // 3. `anonymous`, counted. It is the one principal nobody declares, so it is the one a reader
    //    cannot find by looking at the config — which is why it is stated rather than implied by
    //    an absent `as` clause.
    assert.match(await fresh.locator('[data-auth-anonymous-tests]').innerText(), /1 of 3 tests in orders\.tflw run as anonymous: the catalogue/);

    // 4. An authorized target, with its `probe` opt-in rendered as WHAT IT GRANTS — Q6's answer.
    //    A checkbox cannot express this declaration and neither can the clause's own name.
    const target = fresh.locator('[data-auth-target]');
    assert.equal(await target.locator('[data-auth-probes]').getAttribute('data-auth-probes'), '1');
    assert.match(await target.locator('[data-auth-probe="probeMutating"]').innerText(), /re-issue a POST\/PUT\/PATCH\/DELETE/);
    assert.match(await target.locator('[data-auth-target-reason]').innerText(), /the fixture on loopback/, 'the reason is the declaration, not a comment on it');

    // 5. **`[edit]` is a link, and it lands on the block.** One editor for one file, so nothing
    //    here is a field — and the jump is the hash's third segment, so it is shareable and the
    //    back button walks out of it.
    await fresh.locator('[data-auth-edit="session:admin"]').click();
    await fresh.locator('[data-api-config-text]').waitFor();
    assert.equal(new URL(fresh.url()).hash, '#/api/config/L11');
    assert.equal(
      await selectedText(fresh, '[data-api-config-text]'),
      'session admin privileged',
      'the line it named, selected — a caret in a 16-line file is not visibly anywhere',
    );
    await fresh.goBack();
    await fresh.locator('[data-api-auth]').waitFor();
    await fresh.locator('[data-auth-edit="target:2"]').click();
    await fresh.locator('[data-api-config-text]').waitFor();
    assert.match(
      await selectedText(fresh, '[data-api-config-text]'),
      /^  authorized target "http:\/\/127\.0\.0\.1:4720"/,
    );

    assert.deepEqual(noise, [], 'the Auth tab logged nothing');
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the Config tab makes the edit the product had been telling the author to make', async () => {
  // **`M205-03`, closed.** `tflw init`'s scaffold says *swap this one line for your service* and
  // the demo service's 404 hint says the same thing in a terminal — while `resolveWritablePath`
  // refused `tflw.config` by design. Q5's answer is a second capability with its own route, so
  // the refusal stands for the route that writes tests and the page can do what it was telling
  // people to do.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-config-tab-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage();
  try {
    execFileSync(process.execPath, ['--import', tsxLoader, cliEntry, 'init'], { cwd: dir, stdio: 'pipe' });
    const scaffold = await readFile(join(dir, 'tflw.config'), 'utf8');
    assert.match(scaffold, /Swap this one line for your service|Swap this one line|api "tflw:\/\/demo"/, 'the scaffold still says what this test is about');

    const base = `http://127.0.0.1:${await ui.listen(0)}`;
    await fresh.goto(`${base}/?token=${TOKEN}#/api/config`);
    await fresh.locator('[data-api-config-text]').waitFor();
    assert.equal(await fresh.locator('[data-api-config-text]').inputValue(), scaffold, 'the bytes on disk, not a re-print of them');
    assert.equal(await fresh.locator('[data-api-config-save]').isDisabled(), true, 'nothing to save on arrival');

    // 1. Text that does not parse is refused HERE, before the server sees it — and it is refused
    //    by disabling the save rather than by a dialog, because `D1052` says the form shows what
    //    `tflw check` will say. The server refuses it too; a button that always 422s is a button
    //    that lies.
    await fresh.locator('[data-api-config-text]').fill(scaffold + '\nenv\n');
    assert.match(await fresh.locator('[data-api-config-diagnostics] li').first().innerText(), /TF010/);
    assert.equal(await fresh.locator('[data-api-config-save]').isDisabled(), true);

    // 2. An unsaved edit MARKS the tab and SURVIVES a trip to another one. The second half is
    //    `S5a`'s finding applied rather than repeated: the strip unmounts panels, so state inside
    //    one is lost, and a half-edited config thrown away by a glance at Auth would be exactly
    //    the failure the Compose fields were saved from.
    const edited = scaffold.replace('api "tflw://demo"', 'api "http://localhost:3001"');
    await fresh.locator('[data-api-config-text]').fill(edited);
    assert.equal(await fresh.locator('[data-tab-mark="config"]').count(), 1, 'the tab says it is holding something');
    await fresh.locator('[data-tab="auth"]').click();
    await fresh.locator('[data-api-auth]').waitFor();
    await fresh.locator('[data-tab="config"]').click();
    await fresh.locator('[data-api-config-text]').waitFor();
    // Quiescence before the read, and it is load-bearing rather than tidy. The failure this
    // assertion is for — the tab re-reading `tflw.config` every time it is opened — lands
    // ASYNCHRONOUSLY, so an `inputValue()` taken the instant the textarea appears sees the edit
    // still there and passes. Mutating the read's guard away proved it: the test reddened, but on
    // a click thirty seconds later rather than here. That is `M205-08`'s shape again — reading a
    // value where the thing being graded is a settled state — caught this time by making the
    // mutation before shipping the gate.
    await fresh.waitForLoadState('networkidle');
    assert.equal(await fresh.locator('[data-api-config-text]').inputValue(), edited, 'a tab trip threw away an unsaved config');

    // 3. The save, and the three things that make it real: the bytes on disk, the mark gone, and
    //    — the one that matters — the TOOL now reads the new base. A page that wrote the file and
    //    left `readProject` describing the old one would have closed half the finding.
    await fresh.locator('[data-api-config-save]').click();
    await fresh.locator('[data-api-config-saved]').waitFor();
    assert.equal(await readFile(join(dir, 'tflw.config'), 'utf8'), edited, 'byte for byte, unreformatted');
    assert.equal(await fresh.locator('[data-tab-mark="config"]').count(), 0);
    const view = (await (await api(`${base}/api/project`)).json()) as { authorization: { apiBaseUrl: string | null } };
    assert.equal(view.authorization.apiBaseUrl, 'http://localhost:3001', 'the project the page describes is the project that was edited');

    // 4. And the capability it did NOT acquire: the route that writes tests still refuses this
    //    file. `D1049`'s refusal is what Q5 declined to widen, and this is the assertion that
    //    would notice if a later slice took the shortcut.
    const sneaky = await api(`${base}/api/file`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'tflw.config', text: edited }),
    });
    assert.equal(sneaky.status, 400);
    assert.match(((await sneaky.json()) as { error: string }).error, /only a \.tflw file can be written here/);
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

// `M209` `S2`, second half of the green condition: **the index rebuilds after a save.**
//
// Its own project, because the assertion is about a file gaining a declaration and the shared
// fixture is read by every report oracle in this file. The write goes through the page's own
// gesture rather than through `PUT /api/file`: what is being asserted is that the shell re-reads
// the projection after a write, and a fetch made from the test would not ask it to.
test('a test written from Compose appears in the Source index without a reload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-s2-index-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage();
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    await writeFile(join(dir, 'shop.tflw'), ['@api', 'test "the catalogue answers"', '  api GET /catalog', '  expect status equals 200', ''].join('\n'));
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;

    await fresh.goto(`${base}/?token=${TOKEN}#/api/source/shop.tflw`);
    await fresh.locator('[data-test-index]').waitFor();
    assert.equal(await fresh.locator('[data-test-index]').getAttribute('data-test-index'), '1');
    assert.equal(await fresh.locator('[data-source-test]').count(), 1);

    await fresh.locator('[data-tab="compose"]').click();
    // `M212` `S4b`: through the create dialog, which is the page's one way to write a new test.
    await fresh.locator('[data-compose-new-test]').click();
    await fresh.locator('[data-new-name]').fill('the orders endpoint answers');
    await fresh.locator('[data-new-method]').selectOption('GET');
    await fresh.locator('[data-new-path]').fill('/orders');
    if (await fresh.locator('[data-new-create]').isDisabled()) assert.fail(`the dialog cannot write: ${await fresh.locator('[data-new-problem]').textContent()}`);
    await fresh.locator('[data-new-create]').click();
    await fresh.locator('[data-new-thing]').waitFor({ state: 'detached' });
    // **`M217` `C` (`D1141`) put a Save here, and the claim above it is unchanged.** The dialog
    // used to `PUT` — the only gesture on the pane that wrote straight to the file, which is how it
    // came to build from the bytes on disk while the author was looking at a buffer (`M217-01`). It
    // now stages like everything else, so the file this gate reads is written by the same Save that
    // writes a `+ request`.
    await fresh.locator('[data-compose-write]').click();
    await fresh.locator('[data-compose-dirty]').waitFor({ state: 'detached' });

    // No reload — the tab is pressed, and the index is what the shell re-read.
    await fresh.locator('[data-tab="source"]').click();
    await fresh.locator('[data-test-index]').waitFor();
    assert.equal(await fresh.locator('[data-test-index]').getAttribute('data-test-index'), '2');
    const row = fresh.locator('[data-source-test="the orders endpoint answers"]');
    await row.waitFor();
    // At its own line, graded against the file on disk rather than against a number written here.
    const written = (await readFile(join(dir, 'shop.tflw'), 'utf8')).split('\n');
    const line = Number(await row.getAttribute('data-line'));
    assert.match(written[line - 1]!, /^test "the orders endpoint answers"/);
    assert.equal(await row.getAttribute('data-test-here'), 'yes', 'derived from the `api` step it carries');
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// `M210` `S1` — Compose reads (`D1072`). The pane that writes a file, showing the file it writes.
//
// **THE ORACLE IS THE FILE, PARSED HERE.** Not `/api/project` — that route carries a per-test index
// and deliberately not an outline, because `D1073`'s unit is one request and a request is a level
// below anything the project view has ever answered. So these gates parse the fixture's own bytes
// with `@tflw/lang` and ask whether the page drew what is in them.
//
// **AND THEY READ THE PAINT, NOT THE CLASS** (`M209-02`, §7). *Disabled* is asked of the control's
// own `disabled` property; *dimmed* is asked of the computed opacity. A class is a request for
// paint and this round is made of controls, so the distinction is the whole difference between a
// gate that means something here and one that does not.

/** Every request in a file, as the language sees it — `[declaration line, request line, method]`. */
const requestsInSource = (source: string): Array<{ decl: number; line: number; method: string; path: string }> => {
  const { program } = parseSource(source);
  const out: Array<{ decl: number; line: number; method: string; path: string }> = [];
  for (const d of [...program.hooks, ...program.tests]) {
    for (const s of d.body) {
      if (s.type === 'ApiStep') out.push({ decl: d.span.start.line, line: s.span.start.line, method: s.method, path: s.path.raw });
      else if (s.type === 'WaitUntilApiStmt') out.push({ decl: d.span.start.line, line: s.span.start.line, method: s.request.method, path: s.request.path.raw });
    }
  }
  return out.sort((a, b) => a.line - b.line);
};

test('Compose draws every request the file holds, at its own line, under the declaration that owns it', async () => {
  const view = await fullProject();
  for (const f of view.files) {
    const source = await readFile(join(root, f.path), 'utf8');
    const wanted = requestsInSource(source);
    await page.goto(`${pageUrl}#/api/compose/${f.path}`);
    // **`[data-compose]` is not the thing to wait for.** The shell reads the file asynchronously
    // and the pane renders a *reading…* state meanwhile, so a gate that waited for the pane counted
    // rows before any existed. `[data-compose-summary]` appears only once the outline is in hand.
    //
    // **AND WAITING FOR IT IS NOT ENOUGH ON ITS OWN, WHICH IS WHY THE RELOAD IS HERE** (`M213-12`).
    // These five `goto`s differ only in the HASH, so the browser does not navigate — it fires
    // `hashchange`, the app re-renders, and until React commits that render **the previous file's
    // `[data-compose-summary]` is still in the DOM**. So the wait could be satisfied by the frame
    // before the one it means, and the read that follows lands wherever the commit happens to be:
    // this loop read `[]` for the second file, in 25 ms, on a box slow enough to lose the race.
    // The dangerous half is not the red — it is that the same window can hand back the PREVIOUS
    // file's rows and be believed, which is the whole claim inverted. A reload makes the DOM this
    // file's by construction, and it is this file's own established idiom (32 sites). The generic
    // shape: **an attribute that every render carries cannot tell you WHICH render you are on.**
    await page.reload();
    await page.locator('[data-compose-summary]').waitFor();
    /* `M235` `C2` — `[data-compose-summary]` being present does not mean the outline under it has
       painted its rows, and `evaluateAll` waits for nothing: CI read `[]` against `[4,6,16,29]` in
       38 ms. `untilEqual` on the sorted list, because the rows converge on a total this test
       already knows, and the bound is what keeps a file that genuinely draws the wrong rows
       failing rather than spinning. */
    const want = wanted.map((r) => r.line).sort((a, b) => a - b);
    const outline = await settle(
      async () => (await page.locator('[data-outline-request]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-outline-request'))))).sort((a, b) => a - b),
      untilEqual(want),
      { attempts: 40, delayMs: 50, page },
    );
    assert.deepEqual(outline.value, want, `${f.path}: every request in the file is a row in the explorer's outline (${outline.attempts} look(s))`);
    // And the declarations, which is the other half of `D1081`'s two levels.
    const { program } = parseSource(source);
    const decls = [...program.hooks, ...program.tests].map((d) => d.span.start.line).sort((a, b) => a - b);
    const outlineDecls = await settle(
      async () => (await page.locator('[data-outline-decl]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-outline-line'))))).sort((a, b) => a - b),
      untilEqual(decls),
      { attempts: 40, delayMs: 50, page },
    );
    assert.deepEqual(outlineDecls.value, decls, `${f.path}: every hook and test is a row too — a declaration with no request is still there (${outlineDecls.attempts} look(s))`);
  }
});

/**
 * **`M214` kept both halves of this and moved one of them** (`D1112`, `D1113`).
 *
 * *The card is the request the address names* is unchanged — it is drawn in the editor region
 * rather than inline in a scrolling document, and `[data-request-line]` still identifies it.
 * *The band is the declaration that holds it* is now **the sequence column's first row**: the same
 * claim, costing one line instead of a panel, and carrying the same `data-band-line`.
 */
test('the card is the request the address names, and the band is the declaration that holds it', async () => {
  const view = await fullProject();
  const withRequests = view.files.find((f) => f.path.endsWith('catalog.tflw'))!;
  const source = await readFile(join(root, withRequests.path), 'utf8');
  const wanted = requestsInSource(source);
  assert.ok(wanted.length >= 2, 'the fixture file holds more than one request, or this asserts nothing');
  for (const r of wanted) {
    await page.goto(`${pageUrl}#/api/compose/${withRequests.path}/L${r.line}`);
    await page.locator(`[data-request-line="${r.line}"]`).waitFor();
    // The attribute, not the text: since `S2` the method is a `<select>`, and a select's
    // `textContent` is every option it offers concatenated.
    assert.equal(await page.locator('[data-request-method]').getAttribute('data-request-method'), r.method);
    assert.equal(await page.locator('[data-request-path]').getAttribute('data-request-path'), r.path);
    assert.equal(await page.locator('[data-band-line]').getAttribute('data-band-line'), String(r.decl), `L${r.line} shows the declaration that owns that request`);
  }

  // **A header's value is printed, not stringified here.** The first draft read the `StringLit`'s
  // text and fell back to the node's `type` for anything else, so a numeric or interpolated value
  // rendered `NumberLit` to the reader. The oracle is `print()` over the same node.
  const withHeaders = requestsInSource(source).map((r) => r.line);
  const { program: prog } = parseSource(source);
  const headed = [...prog.hooks, ...prog.tests]
    .flatMap((d) => d.body)
    .find((st) => st.type === 'ApiStep' && st.headers.length > 0);
  if (headed && headed.type === 'ApiStep' && withHeaders.includes(headed.span.start.line)) {
    await page.goto(`${pageUrl}#/api/compose/${withRequests.path}/L${headed.span.start.line}`);
    await page.locator(`[data-request-line="${headed.span.start.line}"]`).waitFor();
    for (const h of headed.headers) {
      const printed = print(h.value);
      assert.ok(printed.ok, `the language can print this header's value`);
      assert.equal(await page.locator(`[data-request-header-value="${h.name.value}"]`).textContent(), printed.text, `header ${h.name.value} is drawn in the language's own spelling`);
    }
  }
});

test('a line naming a declaration opens THAT declaration, not the request nearest it in the file', async () => {
  // `D1080`'s cost, bounded. Measured on the served page first: `L261` on the sibling's
  // `tests/mixed/storefront.tflw` opened a request belonging to the test ABOVE the one named,
  // because that test's own first request is further down than its `test` line.
  const view = await fullProject();
  const f = view.files.find((x) => x.path.endsWith('catalog.tflw'))!;
  const source = await readFile(join(root, f.path), 'utf8');
  const { program } = parseSource(source);
  const target = program.tests.find((t) => t.body.some((s) => s.type === 'ApiStep') && t.span.start.line > (requestsInSource(source)[0]?.line ?? 0));
  assert.ok(target, 'the fixture has a test declared after some earlier request');
  await page.goto(`${pageUrl}#/api/compose/${f.path}/L${target.span.start.line}`);
  // `.test-band` explicitly: since `M214` `D1112` the sequence column's first row carries
  // `data-band-line` too — the same claim, *this is the declaration that holds everything below
  // it*, costing one line instead of a panel. Both are right; this assertion is about the card.
  await page.locator('.test-band[data-band-line]').waitFor();
  assert.equal(await page.locator('.test-band[data-band-line]').getAttribute('data-band-line'), String(target.span.start.line));
  // The band's name is a **field** since `S5`, so this asks the control rather than the text —
  // the same move `S1`'s own gate makes about the request's path.
  assert.equal(await page.locator('[data-band-name]').inputValue(), target.name.value);
});

test('what the reader has not lit yet is disabled — and it is the control that is asked, not a class', async () => {
  // **`D1082` narrowed a third time, which is the decision working rather than the decision
  // lapsing.** `S1`'s claim was that nothing on this pane types; `S2` lit the request's fields,
  // `S3`/`S4` the statements, `S5` the band. What is left read-only is a list that can be named:
  // the three clauses on the card that `ApiStepSpec` cannot express and that an edit carries rather
  // than rebuilds, and the **workload**, which is the LOAD door's to shape (`D1042`) and says so
  // with a link. A pane that is half live has to be able to say which half, in the controls.
  const view = await fullProject();
  for (const f of view.files) {
    await page.goto(`${pageUrl}#/api/compose/${f.path}`);
    await page.reload(); // the same hash-only navigation as the loop above — see `M213-12` there
    await page.locator('[data-compose-summary]').waitFor();
    // `document` is a DOM global and this file is typechecked under `types: ["node"]` with no DOM
    // lib — so every browser-side callback reaches it through `el.ownerDocument`, which Playwright
    // types for us. The parity gate below already had to do this; it is the file's convention.
    const state = await page.locator('[data-compose]').evaluate((root) => {
      const doc = root.ownerDocument;
      // **Assertion rows are excluded, and by their element rather than by their band** (`M210`
      // `S3`). An `expect` is neutral vocabulary, so a browser test seen from this door is one long
      // preamble of them — inside `.test-band`, live, and correctly so. What `D1082` still claims is
      // the band's OWN facts: the tags, the table, the workload, the thresholds.
      const reader = [...doc.querySelectorAll('[data-band-workload] input, [data-band-workload] select, .request-card [data-field-value="timeout"], .request-card [data-field-value="redirects"], .request-card [data-field-value="retry after"]')];
      // **No named helper inside this callback.** `tsx` transforms this file with esbuild's
      // `keepNames`, which wraps every function declaration in a `__name(...)` call — a helper that
      // exists in the test process and not in the page, so a `const off = (e) => …` here dies as
      // `ReferenceError: __name is not defined` the moment Playwright serialises it. Inline, and it
      // is one expression anyway.
      return {
        reader: reader.length,
        readerEnabled: reader.filter((e) => (e as unknown as { disabled?: boolean }).disabled !== true).length,
      };
    });
    assert.equal(state.readerEnabled, 0, `${f.path}: the workload row and the three carried clauses cannot be typed into (\`D1082\`)`);
    // …and the band's own facts ARE live, which is the half that would go missing silently.
    const bands = await page.locator('[data-band-kind]').count();
    if (bands > 0) {
      const editable = await page.locator('[data-band-name], [data-band-when]').first().isEditable();
      assert.equal(editable, true, `${f.path}: its declaration's header takes a keystroke`);
    }
    // **And the request's own fields ARE live**, on every file that holds a request — which is the
    // other half of the same claim, and the half that would quietly go missing if `S2` regressed.
    // Asserting only what is disabled would stay green on a pane where nothing works at all.
    const editable = await page.locator('[data-request-editable]').count();
    if (editable > 0) {
      assert.equal(await page.locator('[data-request-editable]').getAttribute('data-request-editable'), 'yes', `${f.path}: its request is editable`);
      assert.equal(await page.locator('[data-request-path]').isEditable(), true, `${f.path}: and its path takes a keystroke`);
    }
    // …and so is every assertion the language can address (`M210` `S3`). Same argument as the line
    // above: a gate that only asserts what is disabled stays green on a pane where nothing works.
    const rows = await page.locator('li.stmt[data-stmt-editable="yes"]').count();
    if (rows > 0) {
      assert.equal(await page.locator('li.stmt[data-stmt-editable="yes"] [aria-label="matcher"]').first().isEditable(), true, `${f.path}: its assertions take a keystroke`);
    }
  }
});

test('a step from another door is drawn in position, locked, and dimmed in paint rather than in a class name', async () => {
  const view = await fullProject();
  // `shop.tflw` — four browser steps and no request at all, which is both halves of this at once.
  const f = view.files.find((x) => x.path.endsWith('shop.tflw'))!;
  const source = await readFile(join(root, f.path), 'utf8');
  const { program } = parseSource(source);
  const browserSteps = program.tests.flatMap((t) => t.body).filter((s) => STEP_LENS[s.type] === 'browser');
  assert.ok(browserSteps.length > 0, 'the fixture holds steps this door cannot edit');
  await page.goto(`${pageUrl}#/api/compose/${f.path}/L${program.tests[0]!.span.start.line}`);
  await page.locator('[data-compose-summary]').waitFor();
  assert.equal(await page.locator('[data-compose]').getAttribute('data-compose'), 'no-request', 'a file with no request says so rather than drawing an empty card');
  const drawn = await page.locator('[data-stmt-locked="yes"]').evaluateAll((els) =>
    els.map((e) => ({
      line: Number(e.getAttribute('data-stmt-line')),
      lens: e.getAttribute('data-stmt-lens'),
      text: e.querySelector('.stmt-text')?.textContent ?? '',
      // Through the element's own window, for the `types: ["node"]` reason above.
      opacity: Number(e.ownerDocument.defaultView!.getComputedStyle(e).opacity),
      door: e.querySelector('[data-stmt-door]')?.getAttribute('href'),
    })),
  );
  const first = program.tests[0]!.body.filter((s) => STEP_LENS[s.type] === 'browser');
  assert.deepEqual(drawn.map((d) => d.line), first.map((s) => s.span.start.line), 'in position — the file\'s own order, not a bucket at the end');
  for (const d of drawn) {
    assert.equal(d.lens, 'browser');
    assert.ok(d.text.length > 0, 'a locked row still says what the step is');
    assert.equal(d.door, '#/browser', 'and links to the door that owns it');
    // Paint, not a class: a rule that fails to load leaves the class and removes the dimming.
    assert.ok(d.opacity < 1, `a locked row is dimmed — computed opacity ${d.opacity}`);
  }
  const free = await page.locator('[data-stmt-locked="no"]').first().evaluate((e) => Number(e.ownerDocument.defaultView!.getComputedStyle(e).opacity));
  assert.equal(free, 1, 'and a row this door owns is not');
});

test('a note is collapsed to its first line with a count, opens to the rest, and does not say the first line twice', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m210-notes-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    // A header on line 1, a hook, a note on the test, and a note on a statement — the four places
    // `D1077` puts a comment. The fixture project has **zero** comment lines, so the rule this
    // round is built on has no instrument there at all.
    await writeFile(
      join(dir, 'noted.tflw'),
      [
        '# the file, line one',
        '# and its second line',
        '# and a third',
        '',
        'before',
        '  api POST /reset',
        '  expect status equals 204',
        '',
        '# about this test',
        '@api',
        'test "it answers"',
        '  # about the request',
        '  api GET /thing',
        '  expect status equals 200',
        '',
      ].join('\n'),
    );
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;
    // **`M214` `D1113` — one editor, so one scope at a time, so three visits.** The three notes
    // this grades live on three different things: the file, the declaration, and the request. The
    // old pane stacked all three down one document and this test read them in one render; the pane
    // draws whatever is SELECTED now, so each note is asserted under the selection it belongs to —
    // which is a stronger statement of the same rule, because it says *which* thing each note is
    // a note ON rather than only that it is on screen somewhere.
    //
    // The file is the address with no `L`, which is what an explorer click produces.
    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/noted.tflw`);
    await fresh.locator('[data-compose-summary]').waitFor();

    const header = fresh.locator('[data-note="the file"]');
    assert.equal(await header.getAttribute('data-note-lines'), '3');
    assert.equal(await header.locator('summary').textContent(), '# the file, line one +2', 'collapsed to the first line with a count');
    // **The read-only body is lines two onward** — a `<details>` keeps showing its summary while
    // open, so a body holding the whole block printed line one twice, which the served page said
    // and no model check could. The file's header is editable since `S5`, so what it opens onto is
    // the **whole** block without its `#`s, which is the other claim and the one that belongs to a
    // control: what you are editing is the note, not the note minus its first line.
    assert.equal(await header.locator('[data-note-edit]').inputValue(), 'the file, line one\nand its second line\nand a third');
    const readOnly = fresh.locator('[data-note="the file\'s last word"], [data-note="test it answers"]').first();
    void readOnly;

    // A declaration's note is editable since `S5`, so it is a `<details>` like the request's below
    // — one line in the summary, the whole block in the control, without its `#`.
    // The declaration — and it is the TEST, not the hook this file opens with, so its line is read
    // off the explorer's own outline rather than off whichever declaration the column is showing.
    const declLine = await fresh.locator('[data-outline-decl="test"] [data-outline-goto]').first().getAttribute('data-outline-goto');
    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/noted.tflw/L${declLine}`);
    await fresh.locator('[data-note="test it answers"]').waitFor();
    const decl = fresh.locator('[data-note="test it answers"]');
    assert.equal(await decl.locator('summary').textContent(), '# about this test ');
    assert.equal(await decl.locator('[data-note-edit]').inputValue(), 'about this test');
    // **The request's note is editable since `S4`, and an editable note is a `<details>` even when
    // it is one line long**: the collapsed form has to open onto something, and the thing it opens
    // onto is the WHOLE block, first line included, because that is what is being edited. So the
    // claim above — *lines two onward* — belongs to the read-only body, and the editable form's
    // claim is the other one: every line exactly once, in the control, without its `#`.
    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/noted.tflw/L13`);
    await fresh.locator('[data-note="request 13"]').waitFor();
    const request = fresh.locator('[data-note="request 13"]');
    assert.equal(await request.locator('summary').textContent(), '# about the request ');
    assert.equal(await request.locator('[data-note-edit]').inputValue(), 'about the request');

    // The hook is a declaration with a body like any other, and it is in the outline beside the test.
    const decls = await fresh.locator('[data-outline-decl]').evaluateAll((els) => els.map((e) => e.getAttribute('data-outline-decl')));
    assert.deepEqual(decls, ['hook', 'test'], 'a hook is drawn, and before the test, because that is where it is');
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a request can be added to a test from the body’s own sequence', async () => {
  // **`M212` `S4b`.** This is the one thing `.legacy` could do that Compose could not — its second
  // mode, *add steps to an existing test* — and `D1088` cannot retire a form whose job is still
  // half undone. It lands where the pane's other `+` gestures already are.
  //
  // The step and its assertion go in as ONE insertion, which `insertIntoSource` requires for a
  // reason worth restating: two writes would leave the file, between them, with an assertion
  // naming a response nothing fetched.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m212-addreq-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    await writeFile(
      join(dir, 'grow.tflw'),
      ['before', '  api GET /reset', '', 'test "it answers"', '  api GET /a', '  expect status equals 200', ''].join('\n'),
    );
    const port = await ui.listen(0);
    await fresh.goto(`http://127.0.0.1:${port}/?token=${TOKEN}#/api/compose/grow.tflw/L5`);
    await fresh.locator('[data-seq-add="request"]').click();
    await fresh.locator('[data-compose-dirty]').waitFor();
    await fresh.locator('[data-compose-write]').click();
    await fresh.locator('[data-compose-dirty]').waitFor({ state: 'detached' });

    const onDisk = await readFile(join(dir, 'grow.tflw'), 'utf8');
    assert.match(onDisk, /^test "it answers"\n {2}api GET \/a\n {2}expect status equals 200\n {2}api GET \/\n {2}expect status equals 200$/m);
    assert.match(onDisk, /^before$/m, 'the hook is untouched — a splice, not a rewrite');

    // A hook has no name for the splice to address, which is a fact about the language rather than
    // a limit of this door — so the pane says so where the button would be, instead of hiding it.
    await fresh.goto(`http://127.0.0.1:${port}/?token=${TOKEN}#/api/compose/grow.tflw/L1`);
    await fresh.locator('[data-seq-add-hook]').waitFor();
    assert.equal(await fresh.locator('[data-seq-add="request"]').count(), 0);
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a new .tflw file can be made from the page, and the page then opens it', async () => {
  // **`M212` `S4`, `D1087`.** `PUT /api/file` with no `If-Match` creates the file, and has since
  // the route was written — `writeProjectFile` says so in its own refusal text. **The page offered
  // no control for it anywhere**, in Compose or in the explorer, so the only way to start a second
  // file in a project was to leave the page. Third occurrence of the class: `M205` found project
  // creation built and unreachable behind one `existsSync`, `M209` found four shipped sites
  // delegating to an explorer nobody had written.
  //
  // The last assertion is the one that makes this a capability rather than a write: a create that
  // leaves you looking at the file you were already on has no visible consequence.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m212-newfile-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    await writeFile(join(dir, 'first.tflw'), ['test "it answers"', '  api GET /a', '  expect status equals 200', ''].join('\n'));
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;
    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/first.tflw`);
    await fresh.locator('[data-compose-new-file]').click();
    await fresh.locator('[data-new-thing="file"]').waitFor();

    // It refuses before it writes, and says which mistake it is. *That is not a path* and *the file
    // already exists* are different, and neither should cost a round trip to find out.
    await fresh.locator('[data-new-file]').fill('first.tflw');
    await fresh.locator('[data-new-name]').fill('it also answers');
    await fresh.locator('[data-new-path]').fill('/b');
    assert.match((await fresh.locator('[data-new-problem]').textContent())!, /already exists/);
    assert.equal(await fresh.locator('[data-new-create]').isDisabled(), true);
    await fresh.locator('[data-new-file]').fill('tests/second.md');
    assert.match((await fresh.locator('[data-new-problem]').textContent())!, /ends in \.tflw/);

    // **The preview is the bytes.** Not a courtesy — it is the same value the button writes, so the
    // two cannot describe different files.
    await fresh.locator('[data-new-file]').fill('tests/second.tflw');
    await fresh.locator('[data-new-method]').selectOption('POST');
    const preview = (await fresh.locator('[data-new-preview]').textContent())!;
    await fresh.locator('[data-new-create]').click();
    await fresh.locator('[data-new-thing="file"]').waitFor({ state: 'detached' });

    const onDisk = await readFile(join(dir, 'tests', 'second.tflw'), 'utf8');
    assert.equal(onDisk, preview, 'the bytes on disk are the bytes it previewed');
    assert.match(onDisk, /^test "it also answers"$/m);
    assert.match(onDisk, /^ {2}api POST \/b$/m);
    // **The assertion is not a preference** — `B3-17`: an `api` step with nothing reading it can
    // never fail, so a guided start that produced one would teach the shape the checker warns about.
    assert.match(onDisk, /^ {2}expect status equals 200$/m);

    /* `M235` `C2` — the create navigates, and the router writes the hash on a later effect than
       the one that detaches the dialog. The wait is *the address has left the file it started on*,
       which is measurable without assuming where it went; the assertion is where it went. A create
       that landed on the wrong file satisfies the predicate at once and fails here. */
    const moved = await settle(
      async () => new URL(fresh.url()).hash,
      untilMeasurable('the address has left the file it started on', (h) => !h.includes('first.tflw')),
      { attempts: 40, delayMs: 50, page: fresh },
    );
    assert.match(moved.value, /compose\/tests\/second\.tflw/, `and the page is now on the file it just made (${moved.attempts} look(s), hash ${moved.value})`);
    /* `M235` `E` — THE SWEEP CONVICTED THIS READ 3 OF 56, AND THE GATE HAD CALLED IT CLEAN.
       It was `waitFor()` on `[data-compose-subject-what]` and then `textContent()` on the same
       subject, which reads as settled and is not: `waitFor` waits for a *state*, the element was
       on screen throughout carrying `first.tflw`'s subject, so the wait returned on the first tick
       and the assertion judged the document the page had just left. That is the whole `ATTACH-ONLY`
       class, and this is the read that found it.
       What is measurable without assuming the answer is **which file the pane is drawing** — the
       pane states it in its own bar. The assertion is then what that file's first declaration says,
       and a pane that arrives on the right file carrying the wrong subject fails here rather than
       being retried away, which is `M141`'s rule. */
    const showing = await settle(
      () => fresh.locator('[data-compose-file]').first().textContent(),
      untilEqual<string | null>('tests/second.tflw'),
      { attempts: 40, delayMs: 50, page: fresh },
    );
    assert.equal(showing.value, 'tests/second.tflw', `the pane is drawing the file the create made (${showing.attempts} look(s))`);
    // one-shot: the settle above established the pane is on `tests/second.tflw`; a subject drawn from another file would mean the bar and the body render from different sources, which is a defect to report rather than retry.
    assert.equal((await fresh.locator('[data-compose-subject-what]').textContent())!, 'test "it also answers"');
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('`M222`: the create dialog reads the door — BROWSER scaffolds `open`, and the test it makes is one BROWSER can edit', async () => {
  /**
   * **`D1042`'s second clause, live for the first time** — *"a door decides where you land and
   * **what the new-test button scaffolds**, and nothing else"*, quoted in `ui-server.ts` since
   * `M200` `A0-3` with only the first half implemented.
   *
   * The defect this grades is not cosmetic and it is not about fields. `newSource` hardcoded
   * `buildApiStep` + `buildExpect(status equals 200)` for every door, and `ApiStep` is not in
   * `vocabulary.ts`'s `browser.constructs` — so pressing `+ new test` on BROWSER produced a test
   * whose only step the BROWSER pane draws as a plain code line with `data-stmt-editable="no"`,
   * no control and no reason. That is the pane `D1082` refuses, and it is a fresh instance of
   * exactly what `M219` `C` spent a slice removing across 650 statements.
   *
   * So the assertion that carries the round is the LAST one here: the pane the create gesture
   * returns you to can edit what the create gesture just wrote. The field count is the visible
   * half; editability is the half that was broken.
   */
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m222-door-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(
      join(dir, 'tflw.config'),
      ['env local default', '  api "http://127.0.0.1:4799"', '  web "http://127.0.0.1:4799"', ''].join('\n'),
    );
    await writeFile(join(dir, 'one.tflw'), ['test "the first"', '  open "/"', '  expect text "hi" is visible', ''].join('\n'));
    const port = await ui.listen(0);

    // **The API door first, unchanged**, so the comparison below is between two doors in one run
    // rather than against a remembered number.
    await fresh.goto(`http://127.0.0.1:${port}/?token=${TOKEN}#/api/compose/one.tflw`);
    await fresh.locator('[data-compose-new-test]').click();
    await fresh.locator('[data-new-thing="test"]').waitFor();
    assert.equal(await fresh.locator('[data-new-fields]').getAttribute('data-new-fields'), 'api');
    assert.equal(await fresh.locator('[data-new-method]').count(), 1, 'the API door lost its method select');
    await fresh.locator('[data-new-cancel]').click();
    await fresh.locator('[data-new-thing]').waitFor({ state: 'detached' });

    // **BROWSER: the dialog is SHORTER, which is the round's answer to *make it more dynamic*.**
    // The option has already been chosen — it is the door — so asking again inside the dialog
    // would put a control in front of every create on every door to serve a choice nobody makes
    // twice. `method` is the field that goes; `path` stays and says what it opens.
    await fresh.goto(`http://127.0.0.1:${port}/?token=${TOKEN}#/browser/compose/one.tflw`);
    await fresh.locator('[data-compose-new-test]').click();
    await fresh.locator('[data-new-thing="test"]').waitFor();
    assert.equal(await fresh.locator('[data-new-fields]').getAttribute('data-new-fields'), 'open');
    assert.equal(await fresh.locator('[data-new-method]').count(), 0, 'the BROWSER door still draws a method select — it issues no request');
    assert.equal(await fresh.locator('[data-new-path]').count(), 1, 'the BROWSER door draws no path field at all');
    assert.equal(await fresh.locator('[data-new-path]').getAttribute('aria-label'), 'the page to open');

    await fresh.locator('[data-new-name]').fill('the second');
    await fresh.locator('[data-new-path]').fill('/checkout');

    // **The preview is the proof** (`D1191`) — the same value `create` writes, so it cannot
    // describe a different file from the one that lands. Two lines, and the absence of a third is
    // `D1192`: the language has no url or title matcher to derive an assertion from, and what
    // text is on the page is the one thing the author has not seen yet.
    const preview = (await fresh.locator('[data-new-preview]').textContent())!;
    assert.match(preview, /^ {2}open "\/checkout"$/m);
    assert.doesNotMatch(preview, /\bapi\b/, 'the BROWSER preview contains an api step');
    assert.doesNotMatch(preview, /expect status/, 'the BROWSER preview carries the API door’s companion assertion');

    await fresh.locator('[data-new-create]').click();
    await fresh.locator('[data-new-thing="test"]').waitFor({ state: 'detached' });
    await fresh.locator('[data-compose-write]').click();
    await fresh.locator('[data-compose-dirty]').waitFor({ state: 'detached' });

    const onDisk = await readFile(join(dir, 'one.tflw'), 'utf8');
    assert.match(onDisk, /^test "the first"$/m, 'the file was spliced, not rewritten');
    assert.match(onDisk, /^test "the second"$/m);
    assert.match(onDisk, /^ {2}open "\/checkout"$/m);
    assert.doesNotMatch(onDisk, /^ {2}api /m, 'the BROWSER door wrote an api step to disk');

    /* **THE ASSERTION THE ROUND EXISTS FOR.** Back on the door that created it, the step the
       create gesture wrote is editable — `data-stmt-editable` is the pane's own word for whether
       a row has a control behind it, and `"no"` is what every `ApiStep` on this door renders as.
       Before `M222` this read `no` for a test one press old. */
    const declLine = onDisk.split('\n').findIndex((l) => l.startsWith('test "the second"')) + 1;
    await fresh.goto(`http://127.0.0.1:${port}/?token=${TOKEN}#/browser/compose/one.tflw/L${declLine}`);
    await fresh.locator('[data-compose-subject-what]').waitFor();
    assert.equal((await fresh.locator('[data-compose-subject-what]').textContent())!, 'test "the second"');
    /* **A `count() === 0` is the shape that passes when nothing rendered**, so the selector is
       made to say something first. Two controls, both on this same page: the rows exist at all,
       and the same selector returns NON-ZERO on the API door — where `open` is foreign and every
       statement in this file draws dead. Without the second, "no dead rows" could be a claim
       about a selector that never matches anything. */
    /* **The attribute lives on the EDITOR BODY and appears only once a row is picked** — measured
       on this page rather than assumed: with nothing selected both doors report zero of it, which
       is the reading that would have made a bare `count() === 0` pass for the wrong reason. The
       plan's §1.3 said *"renders its only step as a plain code line"*, meaning the sequence row;
       the sequence row carries no such attribute at all (`deadInRows` is 0 on every door), and the
       claim is true of the editor. */
    await fresh.locator('[data-seq-row]').last().locator('[data-seq-pick]').click();
    await fresh.locator('[data-editor-statement]').waitFor();
    assert.equal(
      await fresh.locator('[data-editor-statement]').getAttribute('data-stmt-editable'),
      'yes',
      'the BROWSER door cannot edit the step its own create gesture just wrote — the `M219` `C` defect, manufactured by `+ new test`',
    );

    /* **The control that makes the line above a claim.** The same statement, picked the same way,
       on the API door — where an `open` is foreign — answers `no`. Without it, `yes` could be an
       attribute that is always `yes`. */
    await fresh.goto(`http://127.0.0.1:${port}/?token=${TOKEN}#/api/compose/one.tflw/L${declLine}`);
    await fresh.locator('[data-compose-subject-what]').waitFor();
    await fresh.locator('[data-seq-row]').last().locator('[data-seq-pick]').click();
    await fresh.locator('[data-editor-statement]').waitFor();
    assert.equal(
      await fresh.locator('[data-editor-statement]').getAttribute('data-stmt-editable'),
      'no',
      'an `open` reads as editable on the API door too, so `data-stmt-editable` says nothing and the assertion above proves nothing',
    );
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a new test goes into the open file through the same builders the pane’s own controls use', async () => {
  // **`D1087`'s load-bearing clause, and the whole of why a dialog is safe here.** A dialog is a
  // second authoring surface, and this repository has the receipt for what those cost: `.legacy`
  // drifted until it offered `/orders/{orderId}` and *"the orders endpoint answers"* as
  // placeholders for whatever file happened to be open. So the claim is not *the dialog works* —
  // it is that **there is one construction path**, and the way to state that against the rendered
  // page is that what the dialog writes is what Compose then reads back, clause for clause.
  //
  // The existing file is left alone, which is the other half: a splice, not a rewrite.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m212-newtest-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    await writeFile(
      join(dir, 'one.tflw'),
      ['# this comment must survive', '', 'test "the first"', '  api GET /a', '  expect status equals 200', ''].join('\n'),
    );
    const port = await ui.listen(0);
    await fresh.goto(`http://127.0.0.1:${port}/?token=${TOKEN}#/api/compose/one.tflw`);
    await fresh.locator('[data-compose-new-test]').click();
    await fresh.locator('[data-new-thing="test"]').waitFor();
    assert.equal(await fresh.locator('[data-new-file]').count(), 0, 'a new test needs no file name — the pane is already on one');
    await fresh.locator('[data-new-name]').fill('the second');
    await fresh.locator('[data-new-path]').fill('/b/{id}');
    await fresh.locator('[data-new-create]').click();
    await fresh.locator('[data-new-thing="test"]').waitFor({ state: 'detached' });
    // `M217` `C` (`D1141`) — a new test lands in the pending buffer and one Save writes it, so
    // that is now where the bytes come from. The claim being graded is untouched: what the dialog
    // built is what Compose reads back, clause for clause, through one construction path.
    await fresh.locator('[data-compose-write]').click();
    await fresh.locator('[data-compose-dirty]').waitFor({ state: 'detached' });

    const onDisk = await readFile(join(dir, 'one.tflw'), 'utf8');
    assert.match(onDisk, /^# this comment must survive$/m, 'the file was spliced, not rewritten');
    assert.match(onDisk, /^test "the first"$/m);
    assert.match(onDisk, /^test "the second"$/m);

    // Compose reads the new test back through its own reader, and finds the request where the
    // builders put it. One construction path means the pane cannot disagree with the dialog.
    const declLine = onDisk.split('\n').findIndex((l) => l.startsWith('test "the second"')) + 1;
    await fresh.goto(`http://127.0.0.1:${port}/?token=${TOKEN}#/api/compose/one.tflw/L${declLine}`);
    await fresh.locator('[data-compose-subject-what]').waitFor();
    assert.equal((await fresh.locator('[data-compose-subject-what]').textContent())!, 'test "the second"');
    // **`M214` `D1113` — a declaration's own line selects the declaration.** It used to resolve to
    // that declaration's FIRST REQUEST, which is why the editor could never show a test's own
    // fields and why a 40-character name sat in a 176 px box. The test is now the sequence
    // column's first row and picking it fills the editor with the test's fields; the request is
    // one row below and is named by its own line, which is what this assertion does. The address
    // grammar did not change — what a line means is now one rule for four kinds of thing.
    await fresh.locator(`[data-seq-row="request"] [data-seq-pick]`).first().click();
    assert.equal(await fresh.locator('[data-seq-open] [data-request-path]').inputValue(), '/b/{id}');
    assert.equal(await fresh.locator('[data-seq-open] [data-request-attached]').getAttribute('data-request-attached'), '1');
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a clause the file does not write is not a field — it is in a menu that names all of them', async () => {
  // **`M212` `S3`, `D1084` — amending `D1076`.** The scaffold `tflw init` writes is three lines and
  // the pane drew **47 controls, 34 of them fields, 18 of those empty or showing a default**. A
  // pane where half the fields stand for nothing teaches a reader that most of what they are
  // looking at is noise.
  //
  // `D1076` (*Compose models the whole vocabulary*) is answered, not dismissed, and the second half
  // of this test is that answer: **the menu must name every clause the scope admits**, including
  // the ones already in use and the ones this door cannot construct. A menu listing only what you
  // could add would teach a smaller language than the one that exists — which is the failure
  // `D1076` was written against, arriving by the other road.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m212-add-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    // The scaffold's own shape — the file this round's §0 is about.
    await writeFile(join(dir, 'bare.tflw'), ['test "health check"', '  api GET /health', '  expect status equals 200', ''].join('\n'));
    const port = await ui.listen(0);
    await fresh.goto(`http://127.0.0.1:${port}/?token=${TOKEN}#/api/compose/bare.tflw/L2`);
    await fresh.locator('[data-request-drawn]').waitFor();

    // **`M214` `A2` (`D1115`) — the clauses are in four TABS now, and `More` costs one word at
    // rest.** `D1084`'s rule is unchanged: a clause the file does not write is not a field. What
    // changed is where the unwritten ones wait, and the tab strip is what makes *nothing is stated*
    // readable at a glance — a count beside a tab, or no count at all.
    assert.equal(await fresh.locator('[data-request-drawn]').getAttribute('data-request-drawn'), '0');
    assert.deepEqual(
      await fresh.locator('[data-editor-tab]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-editor-tab')}:${e.getAttribute('data-editor-tab-count')}`)),
      ['headers:0', 'body:0', 'assert:1', 'more:0'],
      'the strip says what this request writes — one assertion, and nothing else',
    );
    await fresh.locator('[data-editor-tab="more"]').click();
    assert.equal(
      (await fresh.locator('[data-request-fields]').getAttribute('data-request-fields')),
      '',
      'no `service`, no `label`, no `timeout`, no `redirects` reading `followed`, no `retry after`',
    );
    await fresh.locator('[data-editor-tab="body"]').click();
    assert.equal(await fresh.locator('[data-body-edit-text]').count(), 0, 'a body nobody wrote has no textarea');
    await fresh.locator('[data-editor-tab="more"]').click();

    // And the vocabulary is one click away, complete. `redirects` is the clause that argued in
    // writing against being hidden — *a field only drawn when it is unusual is invisible exactly
    // when it matters* — and this is the answer to it: named here on every request, whether or not
    // this one sets it.
    const options = await fresh
      .locator('[data-add-clause="request"] [data-add-option]')
      .evaluateAll((els) => els.map((e) => `${e.getAttribute('data-add-option')}:${e.getAttribute('data-add-state')}`));
    // **`M214` `A2` — NOTHING IS `locked` ANY MORE, AND THAT IS THE ROUND'S SHARPEST FINDING.**
    // `timeout`, `redirects` and `retryAfter` were three permanently disabled rows, each repeating
    // *"the request spec has no room for it yet; it is carried across an edit, not rebuilt"* —
    // 240 characters of apology on every one of the corpus's 1058 requests, for three clauses used
    // **five times in a thousand** between them. And the apology was **false**: `ApiRequestSpec`
    // has carried all three fields since the enterprise arc and the printer has written them for
    // just as long. What stopped at six fields was `ApiStepSpec`, the builder's input, in one file.
    // `A2` widened it, so `D1076`'s completeness is now satisfied by controls rather than by rows
    // that say why there is no control.
    assert.deepEqual(options, [
      'service:addable',
      'label:addable',
      'timeout:addable',
      'redirects:addable',
      'retryAfter:addable',
    ]);
    // Headers and body are tabs rather than menu entries, which is the other half of `D1115`: a
    // clause with its own editor does not need to be *added* before it can be looked at.
    assert.equal(await fresh.locator('[data-editor-tab="headers"]').count(), 1);
    assert.equal(await fresh.locator('[data-editor-tab="body"]').count(), 1);

    // The test's own clauses are a different scope and are reached by selecting the test — which is
    // the column's first row (`D1112`, `D1113`).
    await fresh.goto(`http://127.0.0.1:${port}/?token=${TOKEN}#/api/compose/bare.tflw/L1`);
    await fresh.locator('[data-band-drawn]').waitFor();
    assert.equal(await fresh.locator('[data-band-drawn]').getAttribute('data-band-drawn'), '0', 'the band states none of its six clauses either');
    const bandOptions = await fresh
      .locator('[data-add-clause="test"] [data-add-option]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-add-option')));
    assert.deepEqual(bandOptions, ['tags', 'sessions', 'retry', 'table', 'workload', 'thresholds']);
    await fresh.goto(`http://127.0.0.1:${port}/?token=${TOKEN}#/api/compose/bare.tflw/L2`);
    await fresh.locator('[data-editor-tab="more"]').click();

    // Closed, the menu is not in the tab order — `S1`'s lesson, applied to the control `S3` adds,
    // and read with `S1`'s corrected instrument rather than either of the two that lie.
    assert.equal(
      await fresh
        .locator('[data-add-clause="request"]')
        .evaluate((d) => [...d.querySelectorAll('button')].filter((b) => b.checkVisibility()).length),
      0,
    );

    // Adding one draws it, and only it.
    await editorTab(fresh, 'more');
    await fresh.locator('[data-add-clause="request"] > summary').click();
    await fresh.locator('[data-add-go="timeout"]').click();
    await fresh.locator('[data-field="timeout"]').waitFor();
    assert.equal(await fresh.locator('[data-request-fields]').getAttribute('data-request-fields'), 'timeout', 'and only it');
    assert.equal(
      await fresh.locator('[data-add-clause="request"] [data-add-option="timeout"]').getAttribute('data-add-state'),
      'present',
      'the menu stays complete and says which clauses are already here',
    );
    // **And it is a LIVE field**, which is the whole of `A2`: type the language's own spelling and
    // the bytes change. Before this round the control did not exist and the menu explained why.
    await fresh.locator('[data-field-value="timeout"]').fill('30s');
    await fresh.locator('[data-compose-dirty]').waitFor();
    await fresh.locator('[data-tab="source"]').click();
    await fresh.locator('[data-tabstrip="source"]').waitFor();
    assert.match((await fresh.locator('[data-preview]').textContent())!, /api GET \/health timeout 30s/);
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a clause the file DOES write is drawn without being asked for', async () => {
  // The control that keeps the test above from being satisfied by a pane that draws nothing. Every
  // assertion there is a zero, and a component returning `null` would pass all of them.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m212-addstated-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    await writeFile(
      join(dir, 'stated.tflw'),
      [
        '@slow',
        'test "checkout" retry 2',
        '  api POST /carts body { sku: "a" } as "open"',
        '    header "X-Trace" is "1"',
        '  expect status equals 201',
        '',
      ].join('\n'),
    );
    const port = await ui.listen(0);
    await fresh.goto(`http://127.0.0.1:${port}/?token=${TOKEN}#/api/compose/stated.tflw/L3`);
    await fresh.locator('[data-request-drawn]').waitFor();
    // The tab strip is the count, and the count is read off the file (`M214` `A2`).
    assert.deepEqual(
      await fresh.locator('[data-editor-tab]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-editor-tab')}:${e.getAttribute('data-editor-tab-count')}`)),
      ['headers:1', 'body:1', 'assert:1', 'more:1'],
      'one header, a body, an assertion and a label — each written, each counted',
    );
    await fresh.locator('[data-editor-tab="headers"]').click();
    assert.equal(await fresh.locator('[data-request-headers]').getAttribute('data-request-headers'), '1');
    await fresh.locator('[data-editor-tab="body"]').click();
    assert.equal(await fresh.locator('[data-request-body]').getAttribute('data-request-body'), 'json');
    await fresh.locator('[data-editor-tab="more"]').click();
    assert.equal(await fresh.locator('[data-request-fields]').getAttribute('data-request-fields'), 'label');
    // The test's clauses are the test's scope — its own row in the column (`D1113`).
    await fresh.goto(`http://127.0.0.1:${port}/?token=${TOKEN}#/api/compose/stated.tflw/L2`);
    await fresh.locator('[data-band-drawn]').waitFor();
    assert.equal(await fresh.locator('[data-band-drawn]').getAttribute('data-band-drawn'), '2', 'tags and retry are written, so tags and retry are drawn');
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

const SEQUENCE_FILE = [
  'test "checkout"',
  '  let cart = "c1"',
  '  api POST /carts',
  '  expect status equals 201',
  '  capture body.id as cartId',
  '  api GET /carts/{cartId}',
  '  expect status equals 200',
  '  log "fetched"',
  '  api POST /carts/{cartId}/checkout',
  '  expect status equals 200',
  '',
].join('\n');

test('every request in the declaration is on the pane, in the file’s own order, with one open', async () => {
  // **`M212` `S2`, `D1086` — amending `D1073`.** The pane drew the selected request's card and
  // nothing else, so on the corpus's largest test **twelve of thirteen requests were absent from
  // Compose entirely** and the only place they existed was the tree on the left. `42.5% of 694
  // tests carry more than one request`, so this was the common case, not the corner.
  //
  // `D1073`'s argument survives and is what this shape satisfies: it was never *show one request*,
  // it was *do not stack thirteen 410px cards*. One expands; the rest are one line each.
  //
  // The order claim is the one that needs a real fixture rather than a pair: `206 of 396`
  // multi-request tests interleave a non-api statement between two requests, so a pane that
  // grouped requests and statements separately would be lossy on half the corpus. This fixture
  // interleaves, and the assertion is the file's line numbers **ascending with no gaps in the set**
  // — which a grouped rendering cannot produce.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m212-seq-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    await writeFile(join(dir, 'seq.tflw'), SEQUENCE_FILE);
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;
    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/seq.tflw/L3`);
    await fresh.locator('[data-body-sequence]').waitFor();

    // **`M214` `D1112` — the column is the WHOLE sequence, and nothing is collapsed any more.**
    // `M212`'s answer to *every request is drawn* was one open card among collapsed rows, which is
    // what made the pane's height a function of the file; the column is a list of one-line rows
    // that scrolls inside itself, so *open* has stopped being a property of a row at all. What is
    // open is the **editor**, in the region beside it, and `data-seq-open` names the request it is
    // showing.
    const open = await fresh.locator('[data-seq-open]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-seq-open'))));
    const requests = await fresh.locator('[data-seq-request]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-seq-request'))));
    assert.deepEqual(open, [3], 'exactly one request is in the editor, and it is the one the address names');
    assert.deepEqual(requests, [3, 6, 9], 'every request has a row, in file order — the selected one included');

    // **And every statement between them, which is the measurement `D1112` rests on**: 101 `let`
    // and `wait until` statements sit between two requests across the corpus and 617 of 760
    // bindings are read downstream, so a column that drew only requests would be throwing away the
    // one thing tflw has that Bruno and Postman do not. 4 and 5 are here now — they were missing
    // from this list under `M212` because they were inside the selected request's own card.
    const lines = await fresh.locator('[data-seq-line]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-seq-line'))));
    assert.deepEqual(lines.slice(1), [2, 3, 4, 5, 6, 7, 8, 9, 10], 'the body is one list in the file’s order — preamble, requests, and what reads them');
    assert.equal(lines[0], 1, 'and the first row is the declaration that holds all of it');

    // The editor keeps the whole request, attachments included: selecting is not a highlight.
    assert.equal(await fresh.locator('[data-seq-open] .request-card').count(), 1);
    assert.equal(await fresh.locator('[data-seq-open] [data-request-attached]').getAttribute('data-request-attached'), '2');
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('clicking a collapsed request opens it, and the one that was open collapses', async () => {
  // The sequence is a navigator as well as a picture, and it moves the selection **through the
  // address** (`D1045`) rather than through state of its own — the same gesture the tree's request
  // rows use. A second mechanism for *where am I* is a second answer to it.
  //
  // The second assertion is the one that would be missed: a row that opened without closing the
  // previous one would satisfy every "the request I clicked is open" check and rebuild the 5.9
  // screens this slice exists to remove.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m212-seqclick-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    await writeFile(join(dir, 'seq.tflw'), SEQUENCE_FILE);
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;
    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/seq.tflw/L3`);
    await fresh.locator('[data-seq-goto="9"]').click();
    await fresh.locator('[data-seq-open="9"]').waitFor();
    assert.equal(await fresh.locator('[data-seq-open]').count(), 1, 'one request is open, not two');
    assert.match(fresh.url(), /\/L9$/, 'the selection moved through the address');
    assert.equal(await fresh.locator('[data-seq-request="3"]').count(), 1, 'the request that was open is now a row like the others');
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the file’s facts are outside the test card, and on the page whether or not a test is picked', async () => {
  // **`M212` `S1`, `D1085`.** `FileRow` used to be the last block *inside* `.test-band`, so a card
  // headed `TEST health check` ended with the FILE's comment, `imports`, `uses` and `actions`. The
  // card's boundary matched no boundary in the language — `D956`'s family, a claim about one
  // artifact drawn beside a different one — and no amount of styling could make a card legible
  // whose edges were in the wrong place.
  //
  // Two claims, and the second is the one the old arrangement got backwards: the strip is there
  // when a declaration is selected AND when none is. `at ? <TestBand/> : <FileRow/>` made the two
  // scopes alternatives, so picking a test took the file's imports off the screen and the pane's
  // answer to *what does this file bring in?* depended on where the cursor was.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m212-strip-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    await mkdir(join(dir, 'shared'), { recursive: true });
    await writeFile(join(dir, 'shared', 'a.tflw'), ['action make thing()', '  api POST /t', '  expect status equals 201', ''].join('\n'));
    await writeFile(
      join(dir, 'scoped.tflw'),
      ['import "./shared/a.tflw"', '', 'test "it answers"', '  api GET /thing', '  expect status equals 200', ''].join('\n'),
    );
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;

    // **`M214` `D1113` REPLACED THE STACK WITH A SELECTION, AND `D1085`'s CLAIM SURVIVES IT.**
    // `D1085` was about containment: the file's imports had been drawn *inside* `.test-band`, so a
    // card headed `TEST it answers` ended with four file-scoped facts — `D956`'s family, a claim
    // about one artifact printed beside a different one. `M212` fixed that by stacking two strips
    // down one document; `M214` fixes it by construction, because the editor draws exactly one
    // scope and a scope can no longer be inside another one.
    //
    // So what is gated is the same rule with a stronger instrument: pick the file, get the file's
    // facts and no test card; pick the test, get the test's card and no file facts. Both halves,
    // because a pane that lost the file's facts entirely would be as wrong as one that nested them.
    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/scoped.tflw`);
    await fresh.locator('[data-compose-summary]').waitFor();
    await fresh.locator('[data-file-facts]').waitFor();
    assert.equal(
      await fresh.locator('[data-file-facts]').evaluate((e) => e.closest('.test-band') !== null),
      false,
      "the file's facts are not inside a test's card",
    );
    assert.equal(await fresh.locator('.test-band').count(), 0, 'and the test card is not drawn over the file the reader picked');

    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/scoped.tflw/L3`);
    await fresh.locator('.test-band').waitFor();
    assert.equal(await fresh.locator('.test-band').count(), 1, 'the selected declaration has its own card');
    assert.equal(await fresh.locator('[data-file-facts]').count(), 0, 'and the file is a different subject, reachable from the explorer');
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('no scope but the selected one is in the tab order, and the selected one is fully editable', async () => {
  // **The defect this slice must not repeat.** `.legacy` is collapsed to 30px and carries thirteen
  // non-button fields, reachable by Tab, with placeholders from a different fictional example — so
  // tabbing through Compose walks into a second authoring form for a file that is not open. A new
  // disclosure that did the same would be `M212`'s own §0 finding, introduced by the slice written
  // to fix it.
  //
  // Measured rather than reasoned: a `<details>` hides its contents from focus by default, and a
  // stylesheet is one `display` rule away from undoing that (`M209-02` — a gate asserting a class
  // or an attribute has not asserted what the reader gets).
  //
  // The open half is this test's negative control and it is not optional: `0 focusable` is what a
  // strip that renders nothing at all would also report, and `D1085` asked for a collapsed strip
  // that is **still editable**, not for the facts to be taken away.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m212-striptab-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    await mkdir(join(dir, 'shared'), { recursive: true });
    await writeFile(join(dir, 'shared', 'a.tflw'), ['action make thing()', '  api POST /t', '  expect status equals 201', ''].join('\n'));
    await writeFile(
      join(dir, 'tabbed.tflw'),
      ['import "./shared/a.tflw"', '', 'test "it answers"', '  api GET /thing', '  expect status equals 200', ''].join('\n'),
    );
    const port = await ui.listen(0);
    // **`M214` `D1113` retired the disclosure and kept the claim.** The hazard this test exists for
    // is `.legacy`'s: a collapsed surface carrying thirteen reachable fields for a file that is not
    // open, so tabbing through Compose walked into a second authoring form. `M212` answered it with
    // a `<details>` whose contents Chrome skips for focus; `M214` answers it by drawing exactly one
    // scope, which is the stronger version — there is no hidden surface to reason about at all.
    //
    // Both halves are still gated, and the second is not optional: `0 focusable` is also what a
    // pane that renders nothing would report.
    await fresh.goto(`http://127.0.0.1:${port}/?token=${TOKEN}#/api/compose/tabbed.tflw/L3`);
    await fresh.locator('.test-band').waitFor();

    // **`checkVisibility()`, and the two instruments that lie about this.** Measured in this
    // Chromium against a closed `<details>` holding an input and a button:
    //
    //     getClientRects().length   1, 1     — says rendered
    //     offsetParent !== null     true     — says rendered
    //     checkVisibility()         false    — says not
    //     focus()                   does not land
    //     Tab from before it        SUMMARY -> BODY, skipping both
    //
    // Chrome hides closed `<details>` content with `content-visibility`, which skips **painting and
    // focus** but still generates boxes — so the two obvious rendered-ness tests both report a
    // control that no keyboard can reach as present, and only `checkVisibility()` agrees with what
    // Tab actually does. Both wrong instruments were written here first and passed review by
    // looking rigorous, which is `M209-02`'s rule biting the gate rather than the product.
    const reachable = async (selector: string): Promise<number> =>
      fresh.locator(selector).evaluate(
        (root) => [...root.querySelectorAll('input, select, textarea, button')].filter((el) => el.checkVisibility()).length,
      );

    // The test is selected, so the file's own fields are not on the page — not hidden, absent.
    assert.equal(await fresh.locator('[data-file-facts]').count(), 0, 'the unselected scope contributes nothing to the tab order');
    assert.ok((await reachable('.editor')) > 0, 'and the selected scope is editable, not merely drawn');

    // Pick the file, and it is the one that is editable. The same control set, one selection over.
    await fresh.goto(`http://127.0.0.1:${port}/?token=${TOKEN}#/api/compose/tabbed.tflw`);
    await fresh.locator('[data-file-facts]').waitFor();
    const open = await reachable('[data-file-facts]');
    assert.ok(open > 0, `selected, the file is editable — it offered ${open} controls`);
    assert.equal(await fresh.locator('.test-band').count(), 0, 'and now the test card is the one that is not there');
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the head names the declaration the body is drawing, not the file the body is not', async () => {
  // **`D1085`.** The head read `8 declarations · 6 requests — this file, as it is on disk` above a
  // body drawing exactly ONE of the eight, and the only clue as to which was the string `line 30`
  // further down the pane. One sentence describing a different artifact from the one beneath it:
  // `D956` in the place a reader looks first.
  //
  // Both directions are gated, because the fix has two ways to be wrong — a head that stops naming
  // the file at all is as bad as one that only names the file.
  const view = await fullProject();
  const many = view.files.find((x) => x.tests.length > 1)!;
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    // **An address with no line still has a subject**, and that is `addressed`'s own rule rather
    // than a fallback drawn here: it answers the file's FIRST declaration when the hash names no
    // line (`outline.ts`). So the head names a declaration here too, and the thing to gate is that
    // it names the right one — a head that read `file` on this address would be describing
    // something the body is not showing, which is the defect this slice is about.
    await fresh.goto(`${pageUrl}#/api/compose/${many.path}`);
    await fresh.locator('[data-compose-subject-what]').waitFor();
    assert.equal(await fresh.locator('[data-compose-summary]').getAttribute('data-compose-subject'), 'declaration');
    assert.equal((await fresh.locator('[data-compose-subject-what]').textContent())!, `test "${many.tests[0]!.name}"`);

    const second = many.tests[1]!;
    await fresh.goto(`${pageUrl}#/api/compose/${many.path}/L${second.line}`);
    await fresh.locator('[data-compose-subject-what]').waitFor();
    assert.equal(await fresh.locator('[data-compose-summary]').getAttribute('data-compose-subject'), 'declaration');
    assert.equal((await fresh.locator('[data-compose-subject-what]').textContent())!, `test "${second.name}"`);
    const head = (await fresh.locator('[data-compose-summary]').textContent())!;
    assert.match(head, new RegExp(`line ${second.line}\\b`), 'the head says which declaration, by line');
    // And the file's own count survives — demoted to context, not deleted. A head that named only
    // the declaration would leave a reader unable to tell a one-test file from a forty-test one.
    assert.match(head, /of \d+ declarations in this file/);
  } finally {
    await fresh.close();
  }
});

test('the file row carries what the file brings in, comma-separated, and says `none` where there is nothing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m210-filerow-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    await mkdir(join(dir, 'shared'), { recursive: true });
    await writeFile(join(dir, 'shared', 'a.tflw'), ['action make thing()', '  api POST /t', '  expect status equals 201', ''].join('\n'));
    await writeFile(join(dir, 'shared', 'b.tflw'), ['action drop thing()', '  api DELETE /t', '  expect status equals 204', ''].join('\n'));
    await writeFile(
      join(dir, 'uses.tflw'),
      ['import "./shared/a.tflw"', 'import "./shared/b.tflw"', '', 'test "it answers"', '  api GET /thing', '  expect status equals 200', ''].join('\n'),
    );
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;
    // **`M214` `D1113` — the file is a SELECTION, and an address with no `L` is it.** The facts
    // were behind a `<details>` in a strip above the card; they are the editor's own content now,
    // open, with nothing to press first — which is what clicking a file in the explorer lands on,
    // because that gesture drops the focus line by design.
    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/uses.tflw`);
    await fresh.locator('[data-file-facts]').waitFor();
    assert.equal(await fresh.locator('[data-file-imports]').getAttribute('data-file-imports'), '2');
    // **One field per line since `S5`**, and the count is still the claim: the paths are what the
    // file brings in, one row each, in the order the file writes them. The comma-separated
    // rendering `S1` gated is what a door with no `onFileDecl` still draws, and what `actions`
    // draws here — they are named and their bodies are not on this pane at all.
    assert.deepEqual(
      await fresh.locator('[data-file-path]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-file-path')}=${(e as unknown as { value: string }).value}`)),
      ['import:0=./shared/a.tflw', 'import:1=./shared/b.tflw'],
    );
    assert.equal(await fresh.locator('[data-file-uses]').getAttribute('data-file-uses'), '0');
    assert.equal((await fresh.locator('[data-file-actions]').textContent())!.trim(), 'actions none');
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the reader's fields stand as tall as its siblings — the hazard the stylesheet predicted in writing", async () => {
  // **`styles.css` says, above `M205` `S1`'s fix: *"A new column-direction container under
  // `.authoring` needs a line like this one."* `M210` `S1` added one and walked straight into it.**
  //
  // The shared rule `.authoring input, .authoring select { flex: 1 1 120px }` is a WIDTH in every
  // band of this form, because every other band is a row. Inside a `flex-direction: column` label
  // the same declaration is a HEIGHT. The reader's field row inherited the fix by accident — it was
  // called `.request-line` in the first draft — and lost it the moment the name collided with the
  // legacy form's row and had to change. Five controls at 130 px against their siblings' 26, on a
  // page that had been correct one edit earlier.
  //
  // That is the class no test can catch by asserting what code does: a comment described the
  // hazard, named the fix, and had been applied in one place and not the next. So the gate reads
  // the browser's own rectangles, and carries its own negative control.
  const view = await fullProject();
  const f = view.files.find((x) => x.path.endsWith('catalog.tflw'))!;
  const sized = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await sized.goto(`${pageUrl}#/api/compose/${f.path}`);
    await sized.locator('[data-compose-summary]').waitFor();
    // The hazard is a property of a column-direction container, and the container that has one is
    // the request editor's `More` tab — so the request is selected first (`M214` `D1113`).
    await sized.locator('[data-seq-row="request"] [data-seq-pick]').first().click();
    await sized.locator('[data-request-editable="yes"]').waitFor();
    const heights = async (selector: string): Promise<number[]> => {
      const all = sized.locator(selector);
      const out: number[] = [];
      for (let i = 0; i < (await all.count()); i += 1) {
        const box = await all.nth(i).boundingBox();
        assert.ok(box, `${selector} #${i} has no rectangle`);
        out.push(Math.round(box.height));
      }
      return out;
    };
    // **`M212` `S3` changed the population, not the claim.** A clause the request does not write
    // is no longer a field (`D1084`), so this fixture's first request draws none of the five until
    // they are asked for. Two of them are asked for here; the hazard is a property of the container
    // and one field in it is enough to see it, which is why this is a smaller census and not a
    // weaker one.
    await editorTab(sized, 'more');
    await sized.locator('[data-add-clause="request"] > summary').click();
    await sized.locator('[data-add-go="service"]').click();
    await sized.locator('[data-add-go="label"]').click();
    await sized.locator('.more-form .field > input').first().waitFor();
    const fields = await heights('.more-form .field > input');
    assert.equal(fields.length, 2, 'service and label — the two of the five this door can construct');
    for (const h of fields) assert.ok(h < 40, `a reader field is ${h}px — the shared flex rule is being read as a height again`);

    // THE NEGATIVE CONTROL. Put the axis-dependent declaration back and the five have to tower —
    // otherwise this passes on a page where the fix was never applied, which is the failure mode
    // this repository files most often.
    await sized.addStyleTag({ content: '.more-form .field > input { flex: 1 1 120px !important; }' });
    for (const h of await heights('.more-form .field > input')) {
      assert.ok(h > 80, `with the shared rule reaching the column container a field should tower, got ${h}px`);
    }
  } finally {
    await sized.close();
  }
});

test("the explorer's outline opens under the open file's row and under no other", async () => {
  const view = await fullProject();
  const f = view.files.find((x) => x.path.endsWith('catalog.tflw'))!;
  await page.goto(`${pageUrl}#/api/compose/${f.path}`);
  await page.locator('[data-outline]').waitFor();
  const shape = await page.locator('.sidebar').evaluate((root, path: string) => {
    const doc = root.ownerDocument;
    const outlines = [...doc.querySelectorAll('[data-outline]')];
    const openRow = doc.querySelector(`[data-file-row="${path}"]`);
    const owner = outlines[0]?.closest('li')?.querySelector('[data-file-row]')?.getAttribute('data-file-row');
    const fileLeft = openRow?.getBoundingClientRect().left ?? 0;
    // `.outline-row` rather than `> button` since `M217` `D`: a declaration row is now a flex pair
    // holding the row and its `+`, because a `<button>` cannot contain another one. Naming the
    // class asks about the row itself rather than about where it sits in the tree.
    const declBtn = outlines[0]?.querySelector('[data-outline-decl] .outline-row');
    const reqBtn = outlines[0]?.querySelector('[data-outline-request] button');
    return {
      count: outlines.length,
      owner,
      fileLeft: Math.round(fileLeft),
      declLeft: declBtn ? Math.round(declBtn.getBoundingClientRect().left) : null,
      reqLeft: reqBtn ? Math.round(reqBtn.getBoundingClientRect().left) : null,
      sidebarRight: Math.round(root.getBoundingClientRect().right),
      reqRight: reqBtn ? Math.round(reqBtn.getBoundingClientRect().right) : null,
    };
  }, f.path);
  assert.equal(shape.count, 1, 'exactly one file expands — an outline under all 84 rows is the 26-screen sidebar this pane spent three rounds escaping');
  assert.equal(shape.owner, f.path, 'and it is the file the tabs are facing');
  // `D1081`'s nesting, in pixels: each level is indented past the one above it, and the deepest
  // row still ends inside the pane. The indent is measured, not read off the stylesheet.
  assert.ok(shape.declLeft! > shape.fileLeft, `a declaration is indented past its file (${shape.fileLeft} → ${shape.declLeft})`);
  assert.ok(shape.reqLeft! > shape.declLeft!, `a request past its declaration (${shape.declLeft} → ${shape.reqLeft})`);
  assert.ok(shape.reqRight! <= shape.sidebarRight, `and the deepest row stays inside the pane (${shape.reqRight} ≤ ${shape.sidebarRight})`);
});

// ---------------------------------------------------------------------------
// `M210` `S2` — the request edits (`D1079`). One buffer, one write.
//
// `S1` made Compose a reader. This makes the request it is reading editable, and the shape is the
// one `D1079` names: field values produce **bytes**, the bytes are the shell's, and the write is one
// real `PUT` of the whole file under the etag it was read at (`D1049`, unchanged). So the card, the
// explorer's outline and Source are three views of one buffer, and the write carries exactly what
// all three are showing — which is what these gates check, rather than checking a field's value.

/** A project of its own, because the shared fixture has **no** request carrying the three clauses
 *  `ApiStepSpec` cannot express, and those are the whole of the second gate below. */

/**
 * **Open a file and select its first request** — `M214` `D1113`.
 *
 * An address with no `L` selects the **file** now, which is what clicking a file in the explorer
 * produces (`setFile` drops the focus line by design) and is the right subject for that gesture.
 * Every gate below that types into a request therefore has to name one, and naming it by *the
 * first one in the file* rather than by a line number keeps these fixtures editable: a line is a
 * position, and adding a comment to a fixture used to be enough to move it.
 */
const openFirstRequest = async (p: Page, base: string, file = 'edit.tflw'): Promise<void> => {
  await p.goto(`${base}/?token=${TOKEN}#/api/compose/${file}`);
  await p.locator('[data-seq-row="request"] [data-seq-pick]').first().click();
  await p.locator('[data-request-editable="yes"]').waitFor();
};

/**
 * **Open one of the request editor's four tabs** — `M214` `A2` (`D1115`).
 *
 * Headers · Body · Assert · More. `Assert` is the one that opens, which is a measurement rather
 * than a preference: 63% of the corpus's 1736 assertions are about `status` and every request worth
 * anything carries some, while `timeout`, `without redirects` and `retry after` together are used
 * five times in a thousand requests. So a gate that wants a header, a body or one of the rare three
 * says which tab it is in — and that it HAS to say so is the point of the tabs.
 */
const editorTab = async (p: Page, tab: 'headers' | 'body' | 'assert' | 'more'): Promise<void> => {
  await p.locator(`[data-editor-tab="${tab}"]`).click();
  await p.locator(`[data-editor-tabs="${tab}"]`).waitFor();
};

/** Select one statement by its line, and wait for the editor to be about it (`D1113`). */
const pickStatement = async (p: Page, line: number): Promise<void> => {
  await p.locator(`[data-seq-pick="${line}"]`).click();
  await p.locator(`[data-editor-line="${line}"], [data-request-line="${line}"]`).first().waitFor();
};

const withEditFixture = async (body: string, run: (page: Page, base: string, dir: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m210-edit-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    await writeFile(join(dir, 'edit.tflw'), body);
    const port = await ui.listen(0);
    await run(fresh, `http://127.0.0.1:${port}`, dir);
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
};

/** The file the edit gates work on: a header the file already has, a comment, a second request,
 *  and — on the first request — every clause the edit vocabulary cannot express. */
const EDITABLE = [
  '# the file, and this line must survive every edit below',
  '',
  '@crud',
  'test "it places an order"',
  '  # a note on the request',
  '  api POST /orders body { itemId: 1 } timeout 9s without redirects as "place"',
  '    header "Authorization" is "Bearer {token}"',
  '  expect status equals 201',
  '  capture body.id as orderId',
  '  api GET /orders/{orderId}',
  '  expect status equals 200',
  '',
].join('\n');

test('`M210` `S2`: a field edit becomes bytes, and every other byte of the file survives', async () => {
  await withEditFixture(EDITABLE, async (p, base) => {
    await openFirstRequest(p, base);
    await p.locator('[data-request-path]').fill('/orders/bulk');
    await p.locator('[data-compose-dirty]').waitFor();

    // The bytes, read through Source — the same buffer, which is the claim.
    await p.locator('[data-tab="source"]').click();
    await p.locator('[data-source="pending"]').waitFor();
    const text = (await p.locator('[data-preview]').textContent())!;
    assert.match(text, /^ {2}api POST \/orders\/bulk /m, 'the edit is in the bytes');
    assert.match(text, /^# the file, and this line must survive every edit below$/m);
    assert.match(text, /^@crud$/m);
    assert.match(text, /^ {2}# a note on the request$/m, 'the comment above the edited statement stays');
    assert.match(text, /^ {2}expect status equals 201$/m);
    assert.match(text, /^ {2}capture body\.id as orderId$/m);
    assert.match(text, /^ {2}api GET \/orders\/\{orderId\}$/m, 'and the request after it is untouched');
  });
});

test('`M210` `S2`: the three clauses `ApiStepSpec` used to have no room for survive an edit — and are editable', async () => {
  // **`ApiStepSpec` HAS room for them since `M214` `A2`, and this gate gained a clause rather than
  // losing one.** The three were carried across an edit explicitly, because a node rebuilt from the
  // spec alone came back without them and the file lost them silently — source that still parses,
  // still runs, still passes, and tests something the author did not ask for. That hazard is real
  // and is *why* the widening had to happen in the builder rather than by another carry: three
  // permanently disabled controls, each repeating *"the request spec has no room for it yet"* on
  // all 1058 requests in the corpus, for clauses used five times in a thousand between them.
  //
  // So the claim here is now both halves: an edit that does not touch them keeps them, **and** an
  // edit that does touch them lands in the bytes.
  await withEditFixture(EDITABLE, async (p, base) => {
    await openFirstRequest(p, base);
    await editorTab(p, 'more');
    assert.equal(await p.locator('[data-field-value="timeout"]').inputValue(), '9s', 'the language\'s own spelling, not the node\'s milliseconds');
    assert.equal(await p.locator('[data-field-value="redirects"]').isChecked(), false, '`without redirects` is drawn as the thing it is');
    await editorTab(p, 'assert');
    await p.locator('[data-request-path]').fill('/orders/bulk');
    await p.locator('[data-compose-dirty]').waitFor();
    await p.locator('[data-tab="source"]').click();
    const text = (await p.locator('[data-preview]').textContent())!;
    assert.match(text, /timeout 9s/, 'the timeout survived');
    assert.match(text, /without redirects/, 'the redirect clause survived');
    assert.match(text, /as "place"/, 'and so did the label, which the spec DOES carry');
  });
});

test('`M210` `S2`: the write is one PUT of the buffer, and the buffer goes when it lands', async () => {
  await withEditFixture(EDITABLE, async (p, base, dir) => {
    await openFirstRequest(p, base);
    await p.locator('[data-request-path]').fill('/orders/bulk');
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
    // The oracle is the file on disk, never the page's own claim to have written it.
    const onDisk = await readFile(join(dir, 'edit.tflw'), 'utf8');
    assert.match(onDisk, /^ {2}api POST \/orders\/bulk /m, 'the edit is on disk');
    assert.match(onDisk, /timeout 9s/, 'with the clauses the spec cannot express');
    assert.match(onDisk, /^# the file, and this line must survive every edit below$/m);
    // And what is on disk is what `tflw check` would accept — the write route's own two refusals.
    const { diagnostics } = parseSource(onDisk);
    assert.deepEqual(diagnostics.filter((d) => d.severity === 'error').map((d) => d.code), []);
  });
});

test('`M210` `S2`: discard puts the file back and leaves nothing on disk', async () => {
  await withEditFixture(EDITABLE, async (p, base, dir) => {
    const before = await readFile(join(dir, 'edit.tflw'), 'utf8');
    await openFirstRequest(p, base);
    await p.locator('[data-request-path]').fill('/orders/bulk');
    await p.locator('[data-compose-discard]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
    assert.equal(await p.locator('[data-request-path]').inputValue(), '/orders', 'the card is back on the file');
    assert.equal(await readFile(join(dir, 'edit.tflw'), 'utf8'), before, 'and nothing was written');
  });
});

test('`M210` `S2`: an edit that is not yet a request says so and leaves the buffer where it was', async () => {
  await withEditFixture(EDITABLE, async (p, base) => {
    await openFirstRequest(p, base);
    await p.locator('[data-request-path]').fill('/orders/bulk');
    await p.locator('[data-compose-dirty]').waitFor();
    // A header with no value is a legal thing to be halfway through typing and not a legal request.
    await editorTab(p, 'headers');
    await p.locator('[data-header-edit-add]').click();
    await p.locator('[data-compose-problem]').waitFor();
    assert.ok((await p.locator('[data-compose-problem]').textContent())!.length > 0, 'the pane says why');
    await p.locator('[data-tab="source"]').click();
    const held = (await p.locator('[data-preview]').textContent())!;
    assert.match(held, /^ {2}api POST \/orders\/bulk /m, 'and the buffer still holds the last edit that WAS a request');
    // Finish typing it and the buffer moves again.
    await p.locator('[data-tab="compose"]').click();
    await p.locator('[data-header-edit-name="1"]').fill('X-Trace');
    await p.locator('[data-header-edit-value="1"]').fill('abc');
    await p.locator('[data-compose-problem]').waitFor({ state: 'detached' });
    await p.locator('[data-tab="source"]').click();
    assert.match((await p.locator('[data-preview]').textContent())!, /header "X-Trace" is "abc"/);
  });
});

test('`M210` `S2`: the address keeps the request across a tab trip, and Config does not inherit its line', async () => {
  // `D1080` puts the request in the address, and a plain tab click passes no focus — so a glance at
  // Source and back dropped it and the card fell to the file's first request. The line is carried
  // onto the file's own stages and **not** onto Config, which is `setDoc`'s rule one tab along: a
  // line number is an offset into the document that named it.
  await withEditFixture(EDITABLE, async (p, base) => {
    await openFirstRequest(p, base);
    const second = Number(await p.locator('[data-outline-request]').last().getAttribute('data-outline-request'));
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/edit.tflw/L${second}`);
    await p.locator(`[data-request-line="${second}"]`).waitFor();
    await p.locator('[data-tab="source"]').click();
    assert.match(new URL(p.url()).hash, new RegExp(`/L${second}$`), 'Source keeps the line');
    await p.locator('[data-tab="compose"]').click();
    assert.equal(await p.locator('[data-request-line]').getAttribute('data-request-line'), String(second), 'and coming back shows the same request');
    await p.locator('[data-tab="config"]').click();
    assert.doesNotMatch(new URL(p.url()).hash, /\/L\d+$/, "Config's subject is another document, so the line does not travel");
  });
});

test('`M210` `S2`: an edit that moves the request keeps the address on it', async () => {
  // Adding a header adds a line, so every request below moves. The request's identity across an
  // edit is its index pair, not its line — so the new line is read back by that pair and written
  // to the hash. Without it, editing the first of two requests moves the selection to the second.
  await withEditFixture(EDITABLE, async (p, base) => {
    await openFirstRequest(p, base);
    const rows = () => p.locator('[data-outline-request]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-outline-request'))));
    const secondBefore = (await rows())[1]!;
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/edit.tflw/L${secondBefore}`);
    await p.locator(`[data-request-line="${secondBefore}"]`).waitFor();
    // `M212` `S3`: this request writes no header, so the group is in the menu rather than on the
    // card. One click to ask for it — `D1084`'s stated cost, paid here in the open.
    // `M214` `A2` — headers have their own tab, so there is no clause to ask for first: a clause
    // with its own editor does not need to be *added* before it can be looked at (`D1115`).
    await editorTab(p, 'headers');
    await editorTab(p, 'headers');
    await p.locator('[data-header-edit-add]').click();
    await p.locator('[data-header-edit-name="0"]').fill('X-Trace');
    await p.locator('[data-header-edit-value="0"]').fill('abc');
    await p.locator('[data-compose-dirty]').waitFor();
    const path = await p.locator('[data-request-path]').inputValue();
    assert.equal(path, '/orders/{orderId}', 'the card is still on the request that was edited');
    const line = Number(await p.locator('[data-request-line]').getAttribute('data-request-line'));
    assert.match(new URL(p.url()).hash, new RegExp(`/L${line}$`), 'and the address names its current line');
  });
});

test('`M210` `S2`: an upload body survives an edit to the request around it', async () => {
  // **The sharpest instance of the carry hazard, and the one that deletes data rather than losing a
  // clause.** `ApiBodySpec` has no upload, so `buildApiStep` answers `body: null` for one — and the
  // first draft folded `upload` into `none`, which meant editing the *path* of a request with a
  // `multipart/form-data` payload **removed the payload**. The file still parsed, still ran, and
  // sent nothing. Twelve requests in the sibling carry one.
  const file = [
    '@files',
    'test "it uploads"',
    '  api POST /files upload "./f.png" as "file" type "image/png"',
    '  expect status equals 201',
    '',
  ].join('\n');
  await withEditFixture(file, async (p, base, dir) => {
    await openFirstRequest(p, base);
    await editorTab(p, 'body');
    assert.equal(await p.locator('[data-body-edit-kind]').inputValue(), 'upload', 'the card says what this request sends');
    await editorTab(p, 'assert');
    await p.locator('[data-request-path]').fill('/files/bulk');
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
    const onDisk = await readFile(join(dir, 'edit.tflw'), 'utf8');
    assert.match(onDisk, /api POST \/files\/bulk upload "\.\/f\.png" as "file" type "image\/png"/, 'the path changed and the whole upload clause is still there');
    const { diagnostics } = parseSource(onDisk);
    assert.deepEqual(diagnostics.filter((d) => d.severity === 'error').map((d) => d.code), []);
  });
});

// `M210` `S3` — the expectation edits. 16 subjects, 23 matchers, the quantifier, `expect`/`check`,
// the negation and the subset.
//
// `S2` lit the request; this lights what the request is read for. The vocabulary is the language's
// own — `ComposePane`'s matcher list is a `Record<MatcherName, string>`, so a matcher the language
// gains is a type error rather than a row that quietly stops being offered — and the gates below
// are about the two directions a projection can lie in: a value read back wrong, and a field the
// rebuild cannot say that therefore disappears.

/** A file holding one assertion of each shape this slice has to survive, including two identical
 *  ones — the case an index pair exists for. */
const ASSERTIONS = [
  '# the file header, which must survive every edit below',
  '',
  '@crud',
  'test "the order is what it says"',
  '  api GET /orders/1',
  '  expect status not equals 500',
  '  expect body matches subset { id: 1, name: "Widget" }',
  '  expect body matches schema "Order" from root "/openapi.json"',
  '  expect any body csv.qty equals "2"',
  '  expect response has no security violations',
  // **A floor that is not the default**, because the control's empty value and a mutant that never
  // reads the field are the same string — a fixture whose value equals the mutant's constant
  // asserts nothing, which this repository has paid for twice.
  '  expect response has no serious authorization violations',
  '  expect status equals 200',
  '  expect status equals 200',
  '  wait until api GET /orders/1',
  '    expect body.status equals "done"',
  '',
].join('\n');

/** The rows of the card, read as a reader would: one object per assertion, from the controls. */
/**
 * Every assertion row, read as a reader would — with the `⋯` open on all of them.
 *
 * **`M214` `D1114` put three of the seven controls behind a per-row disclosure**, because measured
 * over the corpus's 1736 assertions `check` is used 7 times (0.4%), the quantifier 78 (4.5%) and
 * `not` 34 (2.0%) — and those three owned the first, second and fourth positions on every row. The
 * vocabulary **moved**; it did not shrink, which is `D1076` kept rather than dropped. So this
 * helper opens what is shut and reads all seven, which keeps the claim it has always made: every
 * assertion in the file is a row of controls holding what the file says.
 *
 * That a row *already spelling* one of the three draws it open with no gesture is a separate
 * claim, asserted where it belongs and defended by its own mutation.
 */
const assertionRows = async (p: Page): Promise<Array<Record<string, string | boolean | null>>> => {
  const shut = p.locator('[data-compose] .stmts [data-assert-more="shut"]');
  for (let i = await shut.count(); i > 0; i = await shut.count()) await shut.first().click();
  return p.locator('[data-compose] .stmts').first().evaluate((list) =>
    // **No named helper inside this callback**, not even a `const value = (s) => …`. `tsx`
    // transforms this file with esbuild's `keepNames`, which wraps a named function — arrow
    // assignments included — in a `__name(...)` call that exists in the test process and not in the
    // page, so the callback dies as `ReferenceError: __name is not defined` the moment Playwright
    // serialises it. `S1` wrote this down and `S3`'s first draft did it anyway; the rule is that a
    // browser-side callback is one expression per read, however repetitive it looks.
    [...list.querySelectorAll('li.stmt')].map((li) => ({
      line: li.getAttribute('data-stmt-line'),
      editable: li.getAttribute('data-stmt-editable'),
      kind: (li.querySelector('[data-expect-kind]') as unknown as { value?: string } | null)?.value ?? null,
      quantifier: (li.querySelector('[data-expect-quantifier]') as unknown as { value?: string } | null)?.value ?? null,
      subject: (li.querySelector('[aria-label="subject"]') as unknown as { value?: string } | null)?.value ?? null,
      argument: (li.querySelector('[data-expect-argument]') as unknown as { value?: string } | null)?.value ?? null,
      negated: li.querySelector('[data-expect-negated]') === null ? null : (li.querySelector('[data-expect-negated]') as unknown as { checked: boolean }).checked,
      matcher: (li.querySelector('[aria-label="matcher"]') as unknown as { value?: string } | null)?.value ?? null,
      operand: (li.querySelector('[data-expect-operand]') as unknown as { value?: string } | null)?.value ?? null,
      severity: (li.querySelector('[data-expect-severity]') as unknown as { value?: string } | null)?.value ?? null,
      schema: (li.querySelector('[data-expect-schema-name]') as unknown as { value?: string } | null)?.value ?? null,
      service: (li.querySelector('[data-expect-schema-service]') as unknown as { value?: string } | null)?.value ?? null,
      source: (li.querySelector('[data-expect-schema-source]') as unknown as { value?: string } | null)?.value ?? null,
      carried: li.querySelector('[aria-label="subject"] option[value="carried"]')?.textContent ?? null,
    })),
  );
};

test('`M210` `S3`: every assertion in the file is a row of controls holding what the file says', async () => {
  // The read direction, across the shapes that are not `status equals 200` — which is 83% of the
  // corpus and the only one a form built from frequency would get right. Each of these was a
  // refusal somewhere before this slice: the interpolated operand and the subset object could not
  // be **printed** at all (`S3a`), the schema clause could not be **built**, and `not` was not in
  // the spec.
  await withEditFixture(ASSERTIONS, async (p, base) => {
    await openFirstRequest(p, base);
    const rows = await assertionRows(p);
    assert.equal(rows.length, 8, 'every assertion attached to the request is a row');
    assert.deepEqual(
      rows.map((r) => [r.subject, r.negated, r.matcher, r.operand, r.quantifier]),
      [
        ['status', true, 'equals', '500', ''],
        ['body', false, 'matchesSubset', null, ''],
        ['body', false, 'matchesSchema', null, ''],
        ['carried', false, 'equals', '"2"', 'any'],
        ['response', false, 'hasNoSecurityViolations', null, ''],
        ['response', false, 'hasNoAuthzViolations', null, ''],
        ['status', false, 'equals', '200', ''],
        ['status', false, 'equals', '200', ''],
      ],
    );
    // The subject the spec cannot spell keeps its own spelling, and is offered nowhere else.
    assert.equal(rows[3]!.carried, 'body csv.qty — kept as it is');
    assert.equal(rows[0]!.carried, null, 'a subject the spec CAN spell is not offered as a carried one');
    // The clause matchers show their clause rather than an operand field.
    assert.deepEqual([rows[2]!.schema, rows[2]!.service, rows[2]!.source], ['Order', 'root', '/openapi.json']);
    assert.equal(rows[4]!.severity, '', 'a scan with no floor says every severity, and says it in the control');
    assert.equal(rows[5]!.severity, 'serious', 'and one with a floor says the floor');
    // And the subset is rows, not a text field.
    assert.equal(await p.locator('[data-expect-subset]').getAttribute('data-expect-subset'), '2');
    assert.deepEqual(await p.locator('[data-subset-key]').evaluateAll((els) => els.map((e) => (e as unknown as { value: string }).value)), ['id', 'name']);
    assert.deepEqual(await p.locator('[data-subset-value]').evaluateAll((els) => els.map((e) => (e as unknown as { value: string }).value)), ['1', '"Widget"']);
  });
});

test('`M210` `S3`: `not` is a control, and an edit that does not touch it cannot drop it', async () => {
  // **The sharpest failure this slice could have shipped.** `buildExpect` hardcoded `negated:
  // false`, so rebuilding `expect status not equals 500` from a spec produced `expect status equals
  // 500` — a file that parses, runs, and asserts the opposite of what its author wrote. 92 such
  // assertions across the two corpora. Both directions are here: an edit *elsewhere* on the row
  // keeps the word, and the checkbox puts it on a row that had none.
  await withEditFixture(ASSERTIONS, async (p, base) => {
    await openFirstRequest(p, base);
    // **Addressed by the control's own value, never by the row's text.** The first draft picked
    // rows with `filter({ hasText: … })` and it matched the wrong one every time: every matcher
    // select carries all 23 options, so the words "security", "snapshot" and "subset" are in the
    // text of every row on the pane. The gate found it by inverting the assertion it was written to
    // defend — it un-negated the row it meant to leave alone.
    const negated = p.locator('li.stmt:has([data-expect-negated])').first();
    await negated.locator('[data-expect-operand]').fill('503');
    await p.locator('[data-compose-dirty]').waitFor();
    await p.locator('[data-tab="source"]').click();
    assert.match((await p.locator('[data-preview]').textContent())!, /^ {2}expect status not equals 503$/m, 'the operand moved and the negation did not');

    await p.locator('[data-tab="compose"]').click();
    const plain = p.locator('li.stmt:has([data-expect-matcher="hasNoSecurityViolations"])').first();
    // **`M214` `D1114` — a row that does NOT already spell one of the rare three opens it with the
    // `⋯`**, which is the whole shape of that decision: the vocabulary moves, it never shrinks.
    // The row above needed no gesture, because it is already negated and therefore draws `not`
    // inline — and the two halves together are what make this a disclosure rather than a removal.
    await plain.locator('[data-assert-more="shut"]').click();
    await plain.locator('[data-expect-negated]').click();
    await p.locator('[data-tab="source"]').click();
    assert.match((await p.locator('[data-preview]').textContent())!, /^ {2}expect response not has no security violations$/m, 'and the checkbox writes the word');
  });
});

test('`M210` `S3`: a subject the spec cannot spell is kept whole across an edit to the row', async () => {
  // Five of the language's sixteen subjects have no `SubjectSpec` — `body csv`, `body pdf text`,
  // `request to "…"` and the two dialog subjects — and a `status of request to "…"` carries a
  // clause the spec has no room for either. This is `S2`'s `upload` one construct over: the row is
  // editable in every other field, the original subject goes back on after the build, and the
  // control that would change it offers the option only where it already applies.
  await withEditFixture(ASSERTIONS, async (p, base, dir) => {
    await openFirstRequest(p, base);
    const csv = p.locator('li.stmt').filter({ has: p.locator('option[value="carried"]') }).first();
    await csv.locator('[aria-label="matcher"]').selectOption('contains');
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
    const onDisk = await readFile(join(dir, 'edit.tflw'), 'utf8');
    assert.match(onDisk, /^ {2}expect any body csv\.qty contains "2"$/m, 'the matcher changed; the subject, its path and the quantifier did not');
    const { diagnostics } = parseSource(onDisk);
    assert.deepEqual(diagnostics.filter((d) => d.severity === 'error').map((d) => d.code), []);
  });
});

test('`M210` `S3`: the subset editor is the operand, and a clause matcher keeps its clause', async () => {
  await withEditFixture(ASSERTIONS, async (p, base) => {
    await openFirstRequest(p, base);
    await p.locator('[data-subset-value="1"]').fill('"Gadget"');
    await p.locator('[data-compose-dirty]').waitFor();
    await p.locator('[data-tab="source"]').click();
    assert.match((await p.locator('[data-preview]').textContent())!, /^ {2}expect body matches subset \{ id: 1, name: "Gadget" \}$/m);

    // A key added from the editor is a key in the object, quoted only where the language needs it.
    await p.locator('[data-tab="compose"]').click();
    await p.locator('[data-subset-add]').click();
    await p.locator('[data-subset-key="2"]').fill('user name');
    await p.locator('[data-subset-value="2"]').fill('"ada"');
    await p.locator('[data-tab="source"]').click();
    assert.match((await p.locator('[data-preview]').textContent())!, /matches subset \{ id: 1, name: "Gadget", "user name": "ada" \}/);

    // …and the schema clause, which is the operand this matcher spells after itself.
    await p.locator('[data-tab="compose"]').click();
    await p.locator('[data-expect-schema-name]').fill('OrderV2');
    await p.locator('[data-tab="source"]').click();
    assert.match((await p.locator('[data-preview]').textContent())!, /^ {2}expect body matches schema "OrderV2" from root "\/openapi\.json"$/m, 'the service the clause names survives an edit to the name beside it');
  });
});

test('`M210` `S3`: two identical assertions, and the edit lands on the one that was asked', async () => {
  // A line is a position and an index pair is an identity (`D1080`, `replaceInSource`). The file
  // holds `expect status equals 200` twice, which is legal and says nothing about which is which —
  // so this is the case where addressing by text or by line would land on the wrong one and look
  // right.
  await withEditFixture(ASSERTIONS, async (p, base, dir) => {
    await openFirstRequest(p, base);
    const twins = p.locator('li.stmt:has([data-expect-subject="status"]):not(:has([data-expect-negated]:checked))');
    assert.equal(await twins.count(), 2, 'the two identical assertions, and only those');
    await twins.last().locator('[data-expect-operand]').fill('204');
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
    const lines = (await readFile(join(dir, 'edit.tflw'), 'utf8')).split('\n');
    const changed = lines.filter((l) => l.trim() === 'expect status equals 204');
    const kept = lines.filter((l) => l.trim() === 'expect status equals 200');
    assert.equal(changed.length, 1, 'exactly one of the two moved');
    assert.equal(kept.length, 1, 'and exactly one stayed');
    assert.ok(lines.indexOf(kept[0]!) < lines.indexOf(changed[0]!), 'and it was the second one');
  });
});

test('`M210` `S3`: an assertion inside a `wait until api` block is read-only, in position, and says why', async () => {
  // `stepPath` is `null` for exactly one population: the expects nested inside a polling block,
  // which are not in the body's own step list and so cannot be named by an index pair. They stay
  // where they are and say so — `D1078`'s rule one level down, where showing what you cannot edit
  // here is true and therefore allowed.
  await withEditFixture(ASSERTIONS, async (p, base) => {
    await openFirstRequest(p, base);
    const lines = await p.locator('[data-outline-request]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-outline-request'))));
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/edit.tflw/L${lines[lines.length - 1]}`);
    // **Scoped to the open request since `M212` `S2`.** The pane now draws the whole body in file
    // order, so the first `ExpectStmt` in the document belongs to an earlier request and is
    // perfectly editable — an unscoped `.first()` was reading a different statement and asserting
    // about this one.
    const row = p.locator('[data-seq-open] li.stmt[data-stmt="ExpectStmt"]').first();
    await row.waitFor();
    assert.equal(await row.getAttribute('data-stmt-editable'), 'no');
    assert.equal(await row.locator('.stmt-text').textContent(), 'expect body.status equals "done"', 'and it is still drawn, in the language\'s own spelling');
    assert.ok((await row.locator('[data-stmt-unaddressable]').textContent())!.length > 0, 'with the reason on the row');
  });
});

// `M210` `S4` — the statements between the requests, and the notes above them.
//
// The corpus is mostly made of these: **793 `capture`, 321 `let`, 184 `call`, 71 `log`, 8 `give`,
// 4 `pause`** across the two corpora, against 1855 requests. A pane that edits a request and an
// assertion and draws the rest as text cannot change most of a test.

/** A test whose body holds one of each — a preamble before the request, attachments after it, a
 *  note on a statement, and a polling request with a block of its own. */
const SCRIPTS = [
  '# the file header, which must survive every edit below',
  '',
  '@crud',
  'test "it places an order"',
  '  let email = unique email',
  '  # why this pause is here',
  // **A range, and not in milliseconds**, because a fixed pause reads `''` for its upper bound and
  // a `500ms` one reads the same whether the raw spelling is kept or the node's `ms` is reprinted —
  // in both cases the mutant's constant is the fixture's value. This one separates them.
  '  pause 1s to 3s',
  '  login("a", "b")',
  '  api POST /orders body { email: {email} }',
  '  expect status equals 201',
  '  capture body.id as orderId',
  // Likewise: an `info` log with no destination is exactly what a reader that drops both returns.
  '  log warn "created {orderId}" to html',
  '  give {orderId}',
  '  wait until api GET /orders/{orderId}',
  '    header "Authorization" is "Bearer {token}"',
  '    expect body.status equals "done"',
  '',
].join('\n');

test('`M210` `S4`: every statement kind in the body is a row of controls holding what the file says', async () => {
  await withEditFixture(SCRIPTS, async (p, base) => {
    // **`M214` `D1113` — one editor, so the claim is read one selection at a time.** It is the same
    // claim: every statement kind in this body is a row of controls holding what the file says, in
    // the file's own order. What changed is that the rows are not all on screen at once — the
    // sequence column is one line per statement and the controls are in the region beside it, which
    // is what took the pane from 48 controls in 761 px to the one statement somebody is working on.
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/edit.tflw`);
    await p.locator('[data-seq-col]').waitFor();
    const statementLines = await p
      .locator('[data-seq-row][data-stmt-line]')
      .evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-stmt-line'))));
    const rows: Array<{ kind: string | null; values: string[] }> = [];
    for (const line of statementLines) {
      await pickStatement(p, line);
      const got = await p.locator('[data-script]').evaluateAll((els) =>
        // One expression per read — no named helper inside a browser callback (`keepNames`).
        els.map((el) => ({
          kind: el.getAttribute('data-script'),
          values: [...el.querySelectorAll('input,select')].map((c) => `${c.getAttribute('aria-label') ?? ''}=${(c as unknown as { value: string }).value}`),
        })),
      );
      rows.push(...got);
    }
    assert.deepEqual(rows, [
      { kind: 'let', values: ['variable=email', 'value=unique email'] },
      { kind: 'pause', values: ['pause=1s', 'upper bound=3s'] },
      { kind: 'call', values: ['action=login', 'argument 1="a"', 'argument 2="b"'] },
      { kind: 'capture', values: ['subject=body', 'subject argument=id', 'variable=orderId'] },
      { kind: 'log', values: ['level=warn', 'message=created {orderId}', 'destination=html'] },
      { kind: 'give', values: ['value={orderId}'] },
    ]);
    // A fixed pause is a blank upper bound, and the field says so rather than looking unfinished —
    // all four pauses in the corpus are fixed.
    await pickStatement(p, statementLines[1]!);
    assert.equal(await p.locator('[data-pause-max]').getAttribute('placeholder'), '(a fixed pause)');
  });
});

test('`M210` `S4`: each of them becomes bytes, and the statement beside it does not move', async () => {
  await withEditFixture(SCRIPTS, async (p, base, dir) => {
    // **Each one is selected before it is typed into** (`D1113`), and the lines are read off the
    // column rather than written here: every edit below moves the lines under it, which is the cost
    // `D1080` states and the reason this re-reads between edits instead of closing over a list.
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/edit.tflw`);
    await p.locator('[data-seq-col]').waitFor();
    const edits: Array<[string, (loc: ReturnType<Page['locator']>) => Promise<void>]> = [
      ['[data-let-value]', (l) => l.fill('unique("ord")')],
      ['[data-pause-max]', (l) => l.fill('')],
      ['[data-call-arg="1"]', (l) => l.fill('"c"')],
      ['[data-capture-name]', (l) => l.fill('placedId')],
      ['[data-log-level]', (l) => l.selectOption('error').then(() => undefined)],
      ['[data-log-destination]', (l) => l.selectOption('').then(() => undefined)],
      ['[data-give-value]', (l) => l.fill('{placedId}')],
    ];
    for (const [selector, apply] of edits) {
      const lines = await p.locator('[data-seq-row][data-stmt-line]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-stmt-line'))));
      let found = false;
      for (const line of lines) {
        await pickStatement(p, line);
        if ((await p.locator(selector).count()) === 0) continue;
        await apply(p.locator(selector));
        found = true;
        break;
      }
      assert.ok(found, `no statement in this body offers ${selector}`);
    }
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });

    const onDisk = await readFile(join(dir, 'edit.tflw'), 'utf8');
    assert.match(onDisk, /^ {2}let email = unique\("ord"\)$/m);
    assert.match(onDisk, /^ {2}pause 1s$/m, 'a cleared upper bound is a fixed pause, and the lower one keeps its own spelling');
    assert.match(onDisk, /^ {2}login\("a", "c"\)$/m);
    assert.match(onDisk, /^ {2}capture body\.id as placedId$/m);
    assert.match(onDisk, /^ {2}log error "created \{orderId\}"$/m, 'and a destination cleared to the default is written by leaving it out');
    assert.match(onDisk, /^ {2}give \{placedId\}$/m);
    // …and everything the edits did not name.
    assert.match(onDisk, /^# the file header, which must survive every edit below$/m);
    assert.match(onDisk, /^ {2}# why this pause is here$/m);
    assert.match(onDisk, /^ {2}api POST \/orders body \{ email: \{email\} \}$/m);
    assert.match(onDisk, /^ {2}expect status equals 201$/m);
    const { diagnostics } = parseSource(onDisk);
    assert.deepEqual(diagnostics.filter((d) => d.severity === 'error').map((d) => d.code), []);
  });
});

test('`M210` `S4`: a note is edited where it is, written where there was none, and removed by clearing it', async () => {
  // `D1077` — a note is a note on what it explains, which is what gives a comment an address at
  // all: its owner's index pair. This is the one edit on the pane that is not a node.
  await withEditFixture(SCRIPTS, async (p, base, dir) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/edit.tflw`);
    await p.locator('[data-seq-col]').waitFor();
    await p.locator('[data-seq-row][data-stmt="PauseStmt"] [data-seq-pick]').click();
    await p.locator('[data-editor-statement="PauseStmt"]').waitFor();

    // The one that is there: opened from its own summary, and edited without its `#`.
    // **Addressed by the row, not by the line.** A note's `what` is the line of the statement it
    // explains — which is its whole address (`D1077`), the block itself having no identity of its
    // own — and a line moves the moment a note grows: this note goes from one line to two below,
    // and every statement under it shifts. The first draft of this gate named `line 7` twice and
    // timed out on the second, which is `D1080`'s own cost showing up in a test.
    const pause = p.locator('[data-editor-statement="PauseStmt"]');
    await pause.locator('summary').click();
    const editor = pause.locator('[data-note-edit]');
    assert.equal(await editor.inputValue(), 'why this pause is here');
    await editor.fill('the API needs a beat before the order lands\nmeasured, not guessed');
    await p.locator('[data-compose-dirty]').waitFor();

    // …and one where there was none. The editor **stays open while it is typed into**, which is
    // the whole reason the gesture owns that state rather than the `<details>` doing: a disclosure
    // driven by the note's own emptiness shuts on the first keystroke.
    await p.locator('[data-seq-row][data-stmt="CaptureStmt"] [data-seq-pick]').click();
    await p.locator('[data-editor-statement="CaptureStmt"]').waitFor();
    await p.locator('[data-editor-statement="CaptureStmt"] [data-note-add]').click();
    const fresh = p.locator('[data-editor-statement="CaptureStmt"] [data-note-edit]');
    await fresh.waitFor();
    await fresh.fill('the id the poll below reads');
    await fresh.waitFor();
    assert.equal(await fresh.inputValue(), 'the id the poll below reads', 'the editor survived the buffer moving under it');

    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
    const onDisk = await readFile(join(dir, 'edit.tflw'), 'utf8');
    assert.match(onDisk, /^ {2}# the API needs a beat before the order lands\n {2}# measured, not guessed\n {2}pause 1s to 3s$/m);
    assert.match(onDisk, /^ {2}# the id the poll below reads\n {2}capture body\.id as orderId$/m);
    assert.match(onDisk, /^# the file header, which must survive every edit below$/m, 'and the file header is not a statement note');

    // Cleared to nothing, the note goes — which is the only way to get rid of one, and the reason
    // the call carries whether there *was* one: the empty editor a new note opens with must not
    // read as a removal before it has been typed into.
    await p.locator('[data-seq-row][data-stmt="PauseStmt"] [data-seq-pick]').click();
    await pause.waitFor();
    await pause.locator('summary').click();
    await pause.locator('[data-note-edit]').fill('');
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
    const after = await readFile(join(dir, 'edit.tflw'), 'utf8');
    // **The line is gone, not blanked.** Asserting only that the words went is green against a
    // note replaced by a bare `#`, which is litter that still parses — so the claim is what is
    // directly above the statement, and it is the statement before it.
    assert.match(after, /^ {2}let email = unique email\n {2}pause 1s to 3s$/m, 'the note was removed, not emptied');
    assert.match(after, /^ {2}# the id the poll below reads$/m, 'and the other note did not move');

    // **And a gesture nobody finished leaves nothing behind.** `+ note` opens an editor and writes
    // no bytes, so an author who opens one and thinks better of it does not litter the file with a
    // bare `#` — the same rule as the removal above, which is why there is one rule and not two.
    const before = await readFile(join(dir, 'edit.tflw'), 'utf8');
    await p.locator('[data-seq-row][data-stmt="LetStmt"] [data-seq-pick]').click();
    await p.locator('[data-editor-statement="LetStmt"]').waitFor();
    await p.locator('[data-editor-statement="LetStmt"] [data-note-add]').click();
    await p.locator('[data-editor-statement="LetStmt"] [data-note-edit]').waitFor();
    assert.equal(await p.locator('[data-compose-dirty]').count(), 0, 'opening a note is not an edit');
    await p.locator('[data-editor-statement="LetStmt"] [data-note-edit]').fill('  ');
    assert.equal(await p.locator('[data-compose-dirty]').count(), 0, 'and neither is typing whitespace into one');
    assert.equal(await readFile(join(dir, 'edit.tflw'), 'utf8'), before, 'nothing reached disk either');
  });
});

test('`M210` `S4`: a polling request is editable, and its own block survives the edit', async () => {
  // `wait until api` holds an `ApiRequestSpec` in a field rather than being one, and its expects
  // live inside its own block — which is why `S3` cannot address them and why the card refused to
  // edit it at all until now. The request is editable; the two things only the block has — those
  // nested expects and `waitMs`, which is the poll budget and **not** `timeoutMs` — are carried.
  await withEditFixture(SCRIPTS, async (p, base, dir) => {
    await openFirstRequest(p, base);
    const lines = await p.locator('[data-outline-request]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-outline-request'))));
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/edit.tflw/L${lines[lines.length - 1]}`);
    await p.locator('[data-request-kind="WaitUntilApiStmt"]').waitFor();
    assert.equal(await p.locator('[data-request-editable]').getAttribute('data-request-editable'), 'yes');
    await p.locator('[data-request-path]').fill('/orders/{orderId}/status');
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
    const onDisk = await readFile(join(dir, 'edit.tflw'), 'utf8');
    assert.match(onDisk, /^ {2}wait until api GET \/orders\/\{orderId\}\/status$/m);
    assert.match(onDisk, /^ {4}header "Authorization" is "Bearer \{token\}"$/m, 'the block\'s header survived');
    assert.match(onDisk, /^ {4}expect body\.status equals "done"$/m, 'and so did the expects only the block can hold');
    const { diagnostics } = parseSource(onDisk);
    assert.deepEqual(diagnostics.filter((d) => d.severity === 'error').map((d) => d.code), []);
  });
});

// `M210` `S5` — the band's own facts, and the file row (`D1074`).
//
// Everything here is a **declaration** fact rather than a step, so none of it can be addressed by
// the index pair `S2` built: a header is the run of lines above a body, a threshold is a line at
// the end of one, an `import` is a line at the top of the file. Measured over the two corpora,
// which is what decides what gets a control: 683 of 858 tests carry tags, 67 name sessions, 9 carry
// a retry, 2 are parallel, 12 carry a table, 39 carry thresholds — and 50 carry a workload, which
// is the one this door does not edit.

const BAND = [
  '# the file header, which must survive every edit below',
  '',
  'import "./shared/helpers.tflw"',
  '',
  'before',
  '  api POST /reset',
  '',
  '@crud @orders',
  'test "it places an order" as admin retry 2',
  '  # why this pause is here',
  '  pause 500ms',
  '  api POST /orders body { email: "a@b.c" }',
  '  expect status equals 201',
  '  threshold p95 duration is less than 500ms',
  '',
  '@perf',
  'test "it holds up"',
  '  run 10 iterations across 2 users',
  '  api GET /orders',
  '  expect status equals 200',
  '',
].join('\n');

test('`M210` `S5`: the band holds the declaration\'s own facts, and the workload is one of them', async () => {
  await withEditFixture(BAND, async (p, base) => {
    // **`/L9`, because this file opens with a hook** and the band shows the declaration the
    // address names — which is `addressed`'s own rule (`D1080`) and worth naming here, since a
    // gate that opened on the default would be reading the hook and asserting about a test.
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/edit.tflw/L9`);
    await p.locator('[data-band-name]').waitFor();
    assert.equal(await p.locator('[data-band-name]').inputValue(), 'it places an order');
    assert.equal(await p.locator('[data-band-tags-edit]').inputValue(), 'crud orders', 'one field for all of them, because the file writes one line for all of them');
    assert.equal(await p.locator('[data-band-sessions-edit]').inputValue(), 'admin');
    assert.equal(await p.locator('[data-band-retry-edit]').inputValue(), '2');
    assert.equal(await p.locator('[data-band-parallel]').getAttribute('data-band-parallel'), 'no');
    // `M212` `S3`: this test writes no `with each`, so the control is one click away rather than a
    // select reading `none` — which was never a fact about the test (`M141`'s retracted census
    // counted exactly this kind of default as a clause in use).
    await p.locator('[data-add-clause="test"] > summary').click();
    await p.locator('[data-add-go="table"]').click();
    assert.equal(await p.locator('[data-band-table-kind]').inputValue(), 'none');
    assert.equal(await p.locator('[data-threshold-metric="0"]').inputValue(), 'duration');
    assert.equal(await p.locator('[data-threshold-percentile="0"]').inputValue(), '95');
    assert.equal(await p.locator('[data-threshold-bound="0"]').inputValue(), '500');

    /* **THE WORKLOAD WAS DRAWN AND LINKED AND IS NOW EDITED** — `M224` `B` (`D1205`), and this
       assertion is the one it inverts. It read:

         > *"The workload is drawn and linked, not edited (`D1042`). A workload is a shape of work
         > with stages in it and LOAD's form is built around that shape… The cost is two clicks,
         > and the link is what says so."*

       The two clicks were the problem. Followed live on `examples/storefront`, the door that link
       pointed at listed all three of its workload tests as *(already a workload test)* with the
       arming checkbox **disabled**, and the `+ workload` menu entry drew a row with zero controls.
       The cost was not two clicks; it was infinite in both directions. `D1044` had said since
       `M200` that a panel is earned by the construct and never granted by the door, and this row
       was the one place the product did the opposite. */
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/edit.tflw/L17`);
    await p.locator('[data-band-workload-edit]').waitFor();
    assert.equal(await p.locator('[data-band-workload]').getAttribute('data-band-workload'), 'SharedIterationsWorkload');
    assert.equal(await p.locator('[data-band-workload-door]').count(), 0, 'the row still links to a door instead of editing');
    assert.equal(await p.locator('[data-band-workload-edit]').getAttribute('data-band-workload-edit'), 'iterations');
    assert.ok((await p.locator('[data-band-workload] input, [data-band-workload] button').count()) > 0, 'nothing in that row types');
  });
});

test('`M210` `S5`: a header edit rewrites the header and not one byte of the body', async () => {
  // The hazard this member exists to avoid: printing a `TestDecl` prints the test *and everything
  // in it*, and the printer emits no comments — so a tag edit that went through the whole
  // declaration would delete every note inside it.
  await withEditFixture(BAND, async (p, base, dir) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/edit.tflw/L9`);
    await p.locator('[data-band-name]').waitFor();
    await p.locator('[data-band-tags-edit]').fill('crud orders slow');
    await p.locator('[data-band-name]').fill('it places a bulk order');
    await p.locator('[data-band-sessions-edit]').fill('admin, shopper');
    await p.locator('[data-band-retry-edit]').fill('3');
    await p.locator('[data-band-parallel]').click();
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });

    const onDisk = await readFile(join(dir, 'edit.tflw'), 'utf8');
    assert.match(onDisk, /^@crud @orders @slow$/m, 'the tags are one line, which is what 450 of the corpus\'s 682 tag lines are');
    assert.match(onDisk, /^test "it places a bulk order" as admin, shopper retry 3 parallel$/m);
    assert.match(onDisk, /^ {2}# why this pause is here\n {2}pause 500ms$/m, 'the note inside the body is still there');
    assert.match(onDisk, /^ {2}api POST \/orders body \{ email: "a@b\.c" \}$/m);
    assert.match(onDisk, /^ {2}threshold p95 duration is less than 500ms$/m);
    assert.match(onDisk, /^before\n {2}api POST \/reset$/m, 'and the hook above it did not move');
    const { diagnostics } = parseSource(onDisk);
    assert.deepEqual(diagnostics.filter((d) => d.severity === 'error').map((d) => d.code), []);
  });
});

test('`M210` `S5`: `with each` is written from cells, read from a file, and taken away again', async () => {
  await withEditFixture(BAND, async (p, base, dir) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/edit.tflw/L9`);
    await p.locator('[data-band-name]').waitFor();
    await p.locator('[data-add-clause="test"] > summary').click();
    await p.locator('[data-add-go="table"]').click();
    await p.locator('[data-band-table-kind]').selectOption('inline');
    await p.locator('[data-table-column="0"]').fill('email');
    await p.locator('[data-table-cell="0:0"]').fill('"a@b.c"');
    await p.locator('[data-table-row-add]').click();
    await p.locator('[data-table-cell="1:0"]').fill('unique email');
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
    let onDisk = await readFile(join(dir, 'edit.tflw'), 'utf8');
    // The cells are the whole value grammar, same as a `let` — so a generator in a cell is a
    // generator and not the string `"unique email"`.
    // The columns are padded to the widest cell by `printTable`, which is the printer's business
    // and not this gate's — so the cells are asserted and the padding is not.
    assert.match(onDisk, /^with each\n {2}\| email\s+\|\n {2}\| "a@b\.c"\s+\|\n {2}\| unique email\s*\|\ntest "it places an order"/m);

    await p.locator('[data-band-table-kind]').selectOption('file');
    await p.locator('[data-band-table-path]').fill('../data/orders.json');
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
    onDisk = await readFile(join(dir, 'edit.tflw'), 'utf8');
    assert.match(onDisk, /^with each from "\.\.\/data\/orders\.json"\ntest "it places an order"/m);

    await p.locator('[data-band-table-kind]').selectOption('none');
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
    onDisk = await readFile(join(dir, 'edit.tflw'), 'utf8');
    assert.doesNotMatch(onDisk, /with each/);
    assert.match(onDisk, /^@crud @orders\ntest "it places an order" as admin retry 2$/m, 'and the rest of the header is where it was');
  });
});

test('`M210` `S5`: a threshold is added, edited and removed, at the end of the body where the printer puts them', async () => {
  await withEditFixture(BAND, async (p, base, dir) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/edit.tflw/L9`);
    await p.locator('[data-band-name]').waitFor();
    await p.locator('[data-threshold-bound="0"]').fill('250');
    await p.locator('[data-threshold-scope="0"]').fill('checkout');
    await p.locator('[data-threshold-add]').click();
    await p.locator('[data-threshold-metric="1"]').selectOption('errorRate');
    await p.locator('[data-threshold-bound="1"]').fill('2');
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });

    let onDisk = await readFile(join(dir, 'edit.tflw'), 'utf8');
    assert.match(onDisk, /^ {2}threshold p95 duration for "checkout" is less than 250ms$/m);
    // **The bound a form holds is the number beside the `%`**, not the fraction the AST stores —
    // `buildThreshold` owns that conversion so no form has to know that `2%` is `0.02` inside.
    assert.match(onDisk, /^ {2}threshold error rate is less than 2%$/m);

    await p.locator('[data-threshold-remove="0"]').click();
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
    onDisk = await readFile(join(dir, 'edit.tflw'), 'utf8');
    assert.doesNotMatch(onDisk, /p95/);
    assert.match(onDisk, /^ {2}threshold error rate is less than 2%$/m, 'and the one beside it stayed');
    const { diagnostics } = parseSource(onDisk);
    assert.deepEqual(diagnostics.filter((d) => d.severity === 'error').map((d) => d.code), []);
  });
});

test('`M210` `S5`: the file row writes what the file brings in, and the file\'s own note is a note like any other', async () => {
  await withEditFixture(BAND, async (p, base, dir) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/edit.tflw/L9`);
    await p.locator('[data-band-name]').waitFor();
    // `M212` `S1`: the file's facts are their own strip above the declaration, collapsed. Opening
    // it is the gesture a reader makes to edit a file-scoped thing, and it is what this gate now
    // makes before editing one.
    // `M214` `D1113` — the file's own fields are what an address with no `L` selects.
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/edit.tflw`);
    await p.locator('[data-file-facts]').waitFor();
    assert.equal(await p.locator('[data-file-path="import:0"]').inputValue(), './shared/helpers.tflw');
    await p.locator('[data-file-path="import:0"]').fill('./shared/orders.tflw');
    await p.locator('[data-file-path-add="use"]').click();
    await p.locator('[data-file-path="use:0"]').fill('./helpers/wait.ts');

    // The file's own header is a note with an owner of its own (`D1077`) — the block that starts on
    // line 1, which `readNotes` gives to nobody else.
    await p.locator('[data-note="the file"] summary').click();
    await p.locator('[data-note-edit="the file"]').fill('what this file is for, in the author\'s words');
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });

    let onDisk = await readFile(join(dir, 'edit.tflw'), 'utf8');
    assert.match(onDisk, /^# what this file is for, in the author's words$/m);
    assert.doesNotMatch(onDisk, /the file header, which must survive/);
    assert.match(onDisk, /^import "\.\/shared\/orders\.tflw"$/m);
    assert.match(onDisk, /^use "\.\/helpers\/wait\.ts"$/m);
    assert.match(onDisk, /^ {2}# why this pause is here$/m, 'and the note inside the test is not the file\'s');

    // A path cleared to nothing is that line removed — the same rule a note follows, which is why
    // there is no second gesture for taking one away.
    await p.locator('[data-file-path="import:0"]').fill('');
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
    onDisk = await readFile(join(dir, 'edit.tflw'), 'utf8');
    assert.doesNotMatch(onDisk, /^import /m);
    assert.match(onDisk, /^use "\.\/helpers\/wait\.ts"$/m, 'and the `use` beside it stayed');

    // …and the same for the header itself: cleared away, then written again from nothing. **A file
    // with no header is the case that tells the file's note from the first declaration's** — the
    // block that owns a file starts on line 1, and one written anywhere else belongs to whatever is
    // under it. Without this the whole `+ note` path on the file row goes unexercised, which a
    // mutation said by surviving.
    // **A written buffer re-renders the note closed**, so the disclosure is opened by its own
    // property rather than by a second click — clicking a `<details>` that is already open shuts
    // it, and which state it is in after a write is not something a gate should have to predict.
    await p.locator('[data-note="the file"]').evaluate((el) => { (el as unknown as { open: boolean }).open = true; });
    await p.locator('[data-note-edit="the file"]').fill('');
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
    assert.doesNotMatch(await readFile(join(dir, 'edit.tflw'), 'utf8'), /^#/m, 'the file opens with code now');

    await p.locator('[data-note-add="file"]').click();
    await p.locator('[data-note-edit="the file"]').fill('written from nothing, at the top');
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
    onDisk = await readFile(join(dir, 'edit.tflw'), 'utf8');
    assert.match(onDisk, /^# written from nothing, at the top\n\nuse "\.\/helpers\/wait\.ts"/, 'above the first line of code, and nowhere else');
  });
});

test('`M210` `S5`: a hook\'s header is its two words, and `each` is the one you get by writing nothing', async () => {
  await withEditFixture(BAND, async (p, base, dir) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/edit.tflw/L5`);
    await p.locator('[data-band-kind="hook"]').waitFor();
    assert.equal(await p.locator('[data-band-when]').inputValue(), 'before');
    assert.equal(await p.locator('[data-band-scope]').inputValue(), 'each');
    await p.locator('[data-band-scope]').selectOption('file');
    await p.locator('[data-band-when]').selectOption('after');
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
    const onDisk = await readFile(join(dir, 'edit.tflw'), 'utf8');
    assert.match(onDisk, /^after file\n {2}api POST \/reset$/m);
    assert.match(onDisk, /^@crud @orders$/m, 'and the test below it did not move');
  });
});

// `M210` `S6` — send runs the prefix (`D1075`).
//
// **Four requests in five cannot run alone**: of the sibling's 1031, 185 reference nothing, 734
// read a variable bound earlier, 379 read a capture from the file's `before` hook and 113 read an
// `env()`. So a Send that fired the selected request by itself would be honest about 18% of them.
// What runs instead is the file's hooks and this declaration up to the selected request — which is
// the expensive thing to press, and why the pane lists it first.

test('`M210` `S6`: send runs the file up to the selected request, and says so before it is pressed', async () => {
  const fixtureServer = (await import(pathToFileURL(join(root, 'server.mjs')).href)) as { startFixtureServer: (port: number) => Promise<Server> };
  const target = await fixtureServer.startFixtureServer(fixturePort);
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m210-send-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', `  api "http://127.0.0.1:${fixturePort}"`, ''].join('\n'));
    await writeFile(
      join(dir, 'send.tflw'),
      [
        '# the file this sends from',
        '',
        'before',
        '  api GET /items',
        '  capture body.items[0].id as seeded',
        '',
        'test "it reads one item"',
        // **A workload, and a request after the selected one.** Both are here because a mutation
        // said so by surviving: with the selected request last in its test, "keep every request in
        // the declaration" changes nothing, and with no workload, "keep the workload" changes
        // nothing either — the fixture's own shape was the mutant's constant, twice.
        '  run 2 iterations across 1 users',
        '  api GET /items',
        '  expect status equals 200',
        '  capture body.items[0].id as first',
        '  api GET /items/{first}',
        '  expect status equals 200',
        '  expect body.id equals 999',
        // **A non-assertion statement between the selected request and the next one, and the
        // mutation registry is what says it has to be here.** `a-send-runs-past-the-request-it-is-
        // about` SURVIVED the first draft of this fixture, because the only things attached to the
        // selected request were assertions — which `withoutAssertions` removes anyway, so the wide
        // cut and the narrow one printed the same bytes and the gate could not tell them apart.
        // `attached` means *everything up to the next request*, so it is a statement that is NOT an
        // assertion that makes the two rules differ at all. The same family as the two mutants this
        // fixture's workload and trailing request were added for: the fixture's own shape was the
        // mutant's constant, for the third time in one file.
        '  capture body.name as itemName',
        '  api GET /items/{first}/history',
        '  expect status equals 404',
        '',
        'test "another test that must not run"',
        '  api GET /items',
        '  expect status equals 500',
        '',
      ].join('\n'),
    );
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;
    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/send.tflw/L12`);
    await fresh.locator('[data-prefix]').waitFor();

    // **The list is the claim, and it is on screen before anything is pressed.** Three requests:
    // the hook's, this test's first, and the selected one — in that order.
    assert.equal(await fresh.locator('[data-prefix]').getAttribute('data-prefix'), '3');
    assert.deepEqual(
      await fresh.locator('[data-prefix-request]').evaluateAll((els) => els.map((e) => e.textContent!.replace(/\s+/g, ' ').trim())),
      ['GET /items before each', 'GET /items it reads one item', 'GET /items/{first} it reads one item'],
    );

    await fresh.locator('[data-compose-send="this"]').click();
    await fresh.locator('[data-compose-response]').waitFor({ timeout: 30_000 });

    // **The scratch is the prefix, and it carries NO ASSERTIONS** (`M215` `A1`, `D1119`).
    //
    // The hook, this test truncated after the selected request, and **not** the test below it —
    // which asserts a 500 the fixture will not give, so a scratch that carried it would have run
    // something the author did not ask for. And not one `expect` from any of them: send fires the
    // requests and shows what came back; the Run tab is what grades a file.
    const written = await readFile(join(dir, SCRATCH_PATH), 'utf8');
    assert.match(written, /^before\n {2}api GET \/items$/m);
    assert.match(written, /^test "scratch"$/m);
    assert.match(written, /^ {2}api GET \/items\/\{first\}$/m);
    assert.doesNotMatch(written, /another test that must not run/);
    assert.doesNotMatch(written, /\bexpect\b/, 'not one assertion reached the scratch — a send does not validate');
    // The captures DID, and they have to: 734 of the sibling's 1031 requests read a variable bound
    // by an earlier one, so a send that dropped the bindings would fire `/items/{first}` with the
    // braces still in it. The request line above proves the interpolation resolved.
    assert.match(written, /^ {2}capture body\.items\[0\]\.id as first$/m);
    // **And it stops AT the request, not after it** (`D1119`). The cut used to run to the last
    // statement *attached* to the request so the verdicts had steps to come from; nothing grades a
    // send now, and `attached` is everything between this request and the next — on
    // `examples/storefront` that is an `open "/"`, so sending an API request booted a browser.
    assert.match(written, /api GET \/items\/\{first\}\n$/, 'the scratch ends at the selected request');
    assert.doesNotMatch(written, /itemName/, 'and not at the last thing ATTACHED to it — that reach is what ran the browser step below a request');
    // …and neither the request below the selected one nor the workload that would turn one press
    // into a load run. `send` means send this request, not run this test as a workload.
    assert.doesNotMatch(written, /history/);
    assert.doesNotMatch(written, /run 2 iterations/);

    // **No verdict, anywhere, from a send** — amending `D1108`, which used to map the scratch's
    // steps onto the assertion rows by position. There are no steps after the request to map.
    assert.equal(await fresh.locator('[data-verdict]').count(), 0, 'a send grades nothing');

    // **The response is beside them, and the pane did not go anywhere.** The legacy Send leaves for
    // Run because that is where its response lives; this one puts the response where the assertions
    // that read it are, so leaving would take the author off the thing they pressed for.
    assert.match(new URL(fresh.url()).hash, /^#\/api\/compose\//, 'still on Compose');
    assert.equal(await fresh.locator('[data-compose-response]').getAttribute('data-compose-response'), '200');
    assert.equal(await fresh.locator('[data-compose-response-scope]').getAttribute('data-compose-response-scope'), 'send');
    assert.equal(await fresh.locator('[data-compose-response-status]').textContent(), '200');
    assert.match((await fresh.locator('[data-compose-response-when]').textContent()) ?? '', /from this send/);
    await fresh.locator('[data-compose-response-body]').waitFor();
    assert.match((await fresh.locator('[data-compose-response-url]').textContent()) ?? '', /^GET http:\/\/127\.0\.0\.1:\d+\/items\/\d+$/);
    assert.ok(JSON.parse((await fresh.locator('[data-compose-response-body]').textContent()) ?? 'null'), 'the body is the server\'s own JSON');
    // …laid out, because that is what `M215` `B2` is for, and the text is still the bytes.
    assert.equal(await fresh.locator('[data-compose-response-body]').getAttribute('data-compose-response-laid'), 'yes');
    assert.match((await fresh.locator('[data-compose-response-body]').textContent()) ?? '', /\n/, 'the service answered on one line and the pane did not');
    // …and painted. The keys are `typ` and not `str`, which is the one distinction a JSON view
    // exists to draw and the one the raw highlighter gets wrong on a quoted key (`M215` `B2`).
    const painted = await fresh.locator('[data-compose-response-body]').evaluate((pre) => ({
      keys: [...pre.querySelectorAll('.t-typ')].map((e) => e.textContent),
      nums: [...pre.querySelectorAll('.t-num')].map((e) => e.textContent),
    }));
    assert.deepEqual(painted.keys, ['"id"', '"name"', '"price"']);
    assert.ok(painted.nums.length >= 2, 'and the numbers are numbers');

    /**
     * **A failing assertion above the request no longer eats the send** — the defect `M215` `A1`
     * was written for, and the one no gate could see while send ran the assertions.
     *
     * `expect body.id equals 999` on the selected request is false against this fixture, and a
     * hard `expect` fails fast (P#16). It sits *after* the request, so the old arrangement still
     * got a response — which is why this gate passed for two rounds. Move a false assertion
     * **above** the request instead and the old send aborted at it, the request never left, and
     * the pane said *the run reported no api step*. The press below is the same press against the
     * same file with one line changed, and it has to come back with a 200.
     */
    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/send.tflw/L9`);
    await pickStatement(fresh, 9);
    await editorTab(fresh, 'assert');
    // Line 10 — `expect status equals 200` on the request ABOVE the selected one. 418 is a status
    // this fixture never answers with, so the assertion is false and it is false first.
    await fresh.locator('[data-seq-open] [data-expect-operand]').first().fill('418');
    await fresh.locator('[data-compose-write]').click();
    await fresh.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
    assert.match(await readFile(join(dir, 'send.tflw'), 'utf8'), /expect status equals 418/, 'the false assertion is in the file');

    /* **Reloaded, not just re-addressed.** A hash change keeps the page's state, and the first
       send's response is still held for line 12 — so without this the assertion below would read
       the OLD response and pass whatever the new press did. The reload is what makes
       `[data-prefix]` the on-screen state again, which is itself the proof that nothing has run
       this request yet. */
    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/send.tflw/L12`);
    await fresh.reload();
    await fresh.locator('[data-prefix]').waitFor();
    assert.equal(await fresh.locator('[data-compose-response]').count(), 0, 'nothing is showing before the press');
    await fresh.locator('[data-compose-send="this"]').click();
    await fresh.locator('[data-compose-response]').waitFor({ timeout: 30_000 });
    assert.equal(
      await fresh.locator('[data-compose-response]').getAttribute('data-compose-response'),
      '200',
      'the request behind a false assertion is exactly the one a person is exploring',
    );
    // And the file really does still hold the false assertion — the send did not quietly drop it
    // from the buffer, it dropped it from the scratch.
    assert.match(await readFile(join(dir, 'send.tflw'), 'utf8'), /expect status equals 418/);
    assert.doesNotMatch(await readFile(join(dir, SCRATCH_PATH), 'utf8'), /\bexpect\b/);
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
    await new Promise<void>((resolve) => target.close(() => resolve()));
  }
});

// ---------------------------------------------------------------------------
// `M214` `A4`–`A6` — the three gestures the pane did not have.
//
// **Complaint four was *"I see no option to remove request — neither for existing request block
// nor for a new one I add"*, and it was exactly right.** `remove` existed for a header, a subset
// entry, a threshold and a table row — for the *parts* of a statement — and for nothing a person
// actually writes. Four rounds of authoring shipped with no way to unwrite a line.
//
// Complaint five was *"why no option to add a new file in this sidebar/project explorer"*, and the
// answer was that the button existed, in the Compose head, two regions away from the list of files
// it makes another of.
// ---------------------------------------------------------------------------

/** A project with one file, served, for the gestures below. */
const withRemovalFixture = async (body: string, run: (page: Page, base: string, dir: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m214-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    await writeFile(join(dir, 'x.tflw'), body);
    const port = await ui.listen(0);
    await run(fresh, `http://127.0.0.1:${port}`, dir);
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
};

test('`M214` `A4`: `✕` on a request takes its assertions with it, in one edit (`D1117`)', async () => {
  // **The attachments are not optional and the reason is the language's.** `body` means *the last
  // response*; an `expect body.total equals 12` left behind when the request above it is gone reads
  // whatever ran before, silently, and may well pass. So it is one edit — `replaceInSource`'s
  // `remove` member takes a LIST of step indices — or a file that is wrong between two of them.
  const body = [
    '# the file survives',
    '',
    '@crud',
    'test "two requests"',
    '  api GET /a',
    '  # why this one is here',
    '  expect status equals 200',
    '  expect body.name equals "widget"',
    '  api GET /b',
    '  expect status equals 201',
    '',
  ].join('\n');
  await withRemovalFixture(body, async (p, base, dir) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw`);
    await p.locator('[data-seq-col]').waitFor();
    assert.deepEqual(
      await p.locator('[data-seq-request]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-seq-request')))),
      [5, 9],
      'both requests are rows before anything is pressed',
    );
    await p.locator('[data-seq-line="5"] [data-seq-remove="request"]').click();
    await p.locator('[data-compose-dirty]').waitFor();
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });

    const onDisk = await readFile(join(dir, 'x.tflw'), 'utf8');
    assert.doesNotMatch(onDisk, /api GET \/a/, 'the request is gone');
    assert.doesNotMatch(onDisk, /expect body\.name equals "widget"/, 'and the assertions that read it went with it');
    assert.doesNotMatch(onDisk, /# why this one is here/, "and the note whose owner was deleted, which explains nothing now (`D1077`)");
    assert.match(onDisk, /^ {2}api GET \/b$/m, 'the request below is untouched');
    assert.match(onDisk, /^ {2}expect status equals 201$/m);
    assert.match(onDisk, /^# the file survives$/m);
    assert.match(onDisk, /^@crud$/m);
    const { diagnostics } = parseSource(onDisk);
    assert.deepEqual(diagnostics.filter((d) => d.severity === 'error').map((d) => d.code), [], 'and what is left parses');
  });
});

test('`M214` `A4`: `✕` refuses what another statement is holding, and names the line holding it (`D1117`)', async () => {
  // **A refusal rather than a warning, and the measurement is why**: 760 `capture`/`let` bindings
  // exist across the 97-file corpus and **617 of them — 81% — are read later in the same test**. A
  // gesture whose commonest outcome is a file that no longer runs is not a gesture; it is a trap
  // with an undo button.
  //
  // And the reason is **inline, not on hover**. A disabled control that does not say why is the
  // pattern this whole round exists to remove — the pane carried three of them on every request —
  // so this one is pressed, it answers, and the answer names the line as a link.
  const body = [
    'test "the chain"',
    '  api POST /orders',
    '  expect status equals 201',
    '  capture body.id as orderId',
    '  api GET /orders/{orderId}',
    '  expect status equals 200',
    '',
  ].join('\n');
  await withRemovalFixture(body, async (p, base, dir) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw`);
    await p.locator('[data-seq-col]').waitFor();
    const before = await readFile(join(dir, 'x.tflw'), 'utf8');

    await p.locator('[data-seq-line="4"] [data-seq-remove="statement"]').click();
    const refusal = p.locator('[data-seq-refusal="orderId"]').first();
    await refusal.waitFor();
    // The first dependent, by line — `api GET /orders/{orderId}` is line 5.
    assert.equal(await refusal.locator('[data-seq-refusal-goto]').getAttribute('data-seq-refusal-goto'), '5');
    assert.match((await refusal.textContent())!, /orderId/);
    assert.match((await refusal.textContent())!, /api GET \/orders\/\{orderId\}/, 'and says what is holding it, in the language’s own spelling');
    // **Nothing was written.** A refusal that still edited the buffer would be a warning wearing a
    // refusal's clothes, and the file would be the thing that proves it.
    assert.equal(await p.locator('[data-compose-dirty]').count(), 0, 'the buffer did not move');

    // Remove what is holding it, and then the capture goes — which is the whole of what a refusal
    // asks for: deal with the dependent first.
    await p.locator('[data-seq-line="5"] [data-seq-remove="request"]').click();
    await p.locator('[data-compose-dirty]').waitFor();
    await p.locator('[data-seq-line="4"] [data-seq-remove="statement"]').click();
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });

    const after = await readFile(join(dir, 'x.tflw'), 'utf8');
    assert.notEqual(after, before);
    assert.doesNotMatch(after, /capture body\.id as orderId/, 'with nothing reading it, the capture goes');
    assert.doesNotMatch(after, /api GET \/orders/, 'and so did the request that was reading it');
    assert.match(after, /^ {2}api POST \/orders$/m, 'and the request that binds nothing is still here');
  });
});

test('`M214` `A4`: `✕` on the test removes the declaration, and the file is what is left (`D1117`)', async () => {
  const body = [
    '# the file, which is not a declaration',
    '',
    '@slow',
    'test "the first"',
    '  api GET /a',
    '  expect status equals 200',
    '',
    'test "the second"',
    '  api GET /b',
    '  expect status equals 200',
    '',
  ].join('\n');
  await withRemovalFixture(body, async (p, base, dir) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L4`);
    await p.locator('.test-band').waitFor();
    // **A declaration's own line is where its HEADER starts, tags included** — `@slow` is line 3,
    // not a line above the test. `replaceHeader` has known that since `M210` `S5a` and `selectedAt`
    // reads it the same way, which is what makes an `[edit]` link written against a tag line land
    // on the test rather than on the request below it.
    const row = (await p.locator('[data-band-line]').first().getAttribute('data-band-line'))!;
    assert.equal(row, '3', 'the row is the declaration, and the declaration starts at its tag');
    await p.locator(`[data-seq-line="${row}"] [data-seq-remove="test"]`).click();
    await p.locator('[data-compose-dirty]').waitFor();
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });

    const onDisk = await readFile(join(dir, 'x.tflw'), 'utf8');
    assert.doesNotMatch(onDisk, /test "the first"/);
    assert.doesNotMatch(onDisk, /@slow/, 'a tag line is part of the declaration’s header, not a line above it');
    assert.match(onDisk, /^test "the second"$/m, 'the other declaration is untouched');
    // **Line 1's block is the FILE's and nobody else's** (`readNotes`), so a declaration that walks
    // up for its own note may not take the file header with it.
    assert.match(onDisk, /^# the file, which is not a declaration$/m);
  });
});

test('`M214` `A5` + `M223` `B`: the response is a region under the editor, behind a divider the reader can still move (`D1116`, `D1196`)', async () => {
  // `D1109`'s chip is retired: a response drawn open on every request is what put the old pane over
  // its height bar, and `M214` retired the bar because the thing it held — *every request drawn*
  // AND *1.50 screens* — could not both be true on the file `D1086` measures. The response has its
  // own region now, and how much of the column it gets is the reader's.
  //
  // **THE MECHANISM UNDER IT FLIPPED IN `M223` AND THIS GATE FLIPPED WITH IT.** `D1116` made the
  // divider a FRACTION and this test asserted `tflw.compose.split` held it — *a fraction and not a
  // pixel count, because the window is not the same height on the next visit*. `D1195` measured
  // what that bought: a 62% editor takes 48 px it cannot use while the pane under it clips by 27,
  // with 22 px spare in the same column. So the track is content-sized at rest and the reader's
  // override is an absolute height (`D1196`) — which answers `D1116`'s objection rather than
  // ignoring it, because the stored number is clamped against the live column and the track is
  // `minmax(0, Npx)`. What survives unchanged is the claim this test was written for: the response
  // is under the editor, and the boundary between them is the reader's.
  const body = ['test "one"', '  api GET /a', '  expect status equals 200', ''].join('\n');
  await withRemovalFixture(body, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L2`);
    await p.locator('[data-compose-split]').waitFor();
    assert.equal(
      await p.locator('[data-compose-split]').getAttribute('data-compose-split'),
      'auto',
      'at rest the height is `D1195`\u2019s and nobody has overridden it',
    );

    // The keyboard, because the divider is a `separator` and not a `<div>` with a pointer handler:
    // a control a pointer alone can reach is a control some readers cannot.
    await p.locator('[data-compose-split]').focus();
    await p.keyboard.press('ArrowDown');
    const after = Number(await p.locator('[data-compose-split]').getAttribute('data-compose-split'));
    assert.ok(Number.isFinite(after) && after > 0, `the divider did not take a height — read ${JSON.stringify(after)}`);
    assert.equal(
      // Through the element's own window: this file is typechecked under `types: ["node"]` with no
      // DOM lib, so the `window` global does not exist for `tsc` even though it exists in the
      // browser the callback is serialised into — the same move the appearance gate makes.
      await p.locator('[data-compose-split]').evaluate((el) => el.ownerDocument.defaultView!.localStorage.getItem('tflw.compose.editor')),
      String(after),
      'and it is remembered where a per-viewer convenience belongs',
    );
    // **`D1116`'s key is not migrated, it is removed** — a remembered `0.62` is an answer to a
    // question this round stops asking, and a reader who has one must not be left on it.
    assert.equal(
      await p.locator('[data-compose-split]').evaluate((el) => el.ownerDocument.defaultView!.localStorage.getItem('tflw.compose.split')),
      null,
      'the retired ratio key is still in the reader\u2019s storage',
    );

    // …and it comes back. A remembered height that a reload forgets is not remembered.
    await p.reload();
    await p.locator('[data-compose-split]').waitFor();
    assert.equal(Number(await p.locator('[data-compose-split]').getAttribute('data-compose-split')), after);

    // `Home` gives the track back to what the editor holds — the same gesture the column grip has
    // (`D1135`), and the only way back, since there is no builder's number to return to.
    await p.locator('[data-compose-split]').focus();
    await p.keyboard.press('Home');
    assert.equal(await p.locator('[data-compose-split]').getAttribute('data-compose-split'), 'auto');
    assert.equal(
      await p.locator('[data-compose-split]').evaluate((el) => el.ownerDocument.defaultView!.localStorage.getItem('tflw.compose.editor')),
      null,
      '`Home` left the override in storage, so the next visit is still overridden',
    );

    // The geometry, which is the claim the attribute is only evidence for.
    const box = await p.locator('[data-seq-open]').evaluate((col) => ({
      editor: Math.round(col.querySelector('.editor')!.getBoundingClientRect().bottom),
      response: Math.round(col.querySelector('.responsebox')!.getBoundingClientRect().top),
    }));
    assert.ok(box.response >= box.editor - 1, `the response is under the editor — editor ends ${box.editor}, response starts ${box.response}`);
  });
});

/**
 * **`M223` `B`+`C` — the panes fit what they hold, and a divider says so.**
 *
 * Three asks, from four screenshots of the BROWSER door: the line-edit pane is almost hidden by
 * the record-session pane; make the middle separation resizable too; and all that empty space in
 * the line-edit pane. **Two of them are the same defect seen from opposite ends** — measured on
 * the live page at 1440x900, a 62% editor over an `open` statement takes **147 px for 99 px of
 * content** while the session panel under it gets 85 for the **112** it needs, so 48 px is wasted
 * and 27 px clipped in the same column, with 22 px still spare. **The third is for a control that
 * shipped five days earlier and could not be seen**: `.col-grip` computed to `rgba(0, 0, 0, 0)` at
 * rest by a written decision, and `.split` was painted `var(--line)`, which is 1.20:1 on the panel
 * and therefore indistinguishable from every other border on the page.
 *
 * Every reading here is a RELATIONSHIP — slack is zero, nothing clips, a handle is not transparent
 * — and not an arrangement or a pixel count, because a gate that pins one layout freezes the page
 * it was written against.
 *
 * **The bounded poll is not optional** (`M222-02`): opening a file writes the hash twice, so the
 * pane draws, blanks back to its placeholder, and draws again. A `waitFor` on any element in it is
 * a proxy that goes false after it has been true. The callbacks going into the page stay anonymous
 * and bind no arrow to a name (`M222-01`, tsx's keep-names transform), and they reach the document
 * through `el.ownerDocument` because this file is typechecked with `types: ["node"]` and no DOM
 * lib.
 */
test('`M223` `B`+`C`: the editor asks for what it holds, the pane under it is never clipped, and both dividers are visible at rest (`D1195`, `D1197`, `D1198`)', async () => {
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    /** One synchronous pass over the column: the editor's box, what is actually inside it, its own
     *  padding (which is NOT slack — the first write-up of this round counted it as slack and
     *  reported 71 px where there were 48), and where the pane below it ends. */
    const slack = () =>
      fresh.locator('body').evaluate((root) => {
        const col = root.querySelector('.editor-col');
        const editor = root.querySelector('.editor');
        const body = root.querySelector('.editor-body, .band, .statement-editor, .request-editor');
        if (col === null || editor === null) return null;
        const pad = root.ownerDocument.defaultView!.getComputedStyle(editor);
        const inner = body === null ? editor.scrollHeight : body.getBoundingClientRect().height + parseFloat(pad.paddingTop) + parseFloat(pad.paddingBottom);
        const lower = root.querySelector('.responsebox');
        return {
          editor: editor.getBoundingClientRect().height,
          needs: inner,
          colBottom: col.getBoundingClientRect().bottom,
          /* **The REGION, not the panel inside it.** The first draft read `.session-none` — and
             `.responsebox` has `overflow: auto`, so the panel's own rectangle runs past the column
             whenever its paragraph is taller than the box it scrolls in. That is a true number
             about something the reader can still reach, and it reddened this gate on unmutated
             code at 1000x480. What `D1195` actually promises is that the region is never handed
             less than its empty state needs. */
          lower: lower === null ? null : lower.getBoundingClientRect().height,
          lowerBottom: lower === null ? null : lower.getBoundingClientRect().bottom,
          rows: root.querySelectorAll('[data-seq-row]').length,
        };
      });

    /* **Gates 3 and 4 — the BROWSER door, on the shape the user photographed**: an `open`
       statement selected, whose editor is the smallest thing this pane can hold. The mutation for
       both is reinstating the 62% track: 48 px of slack appears above, and 27 px of the record
       pane goes below the column's own bottom edge. */
    await fresh.goto(`${pageUrl}#/browser/compose/tests/shop.tflw/L3`);
    let m = await slack();
    for (let i = 0; i < 50 && (m === null || m.rows === 0); i++) {
      await fresh.waitForTimeout(100);
      m = await slack();
    }
    assert.ok(m !== null && m.rows > 0, `the BROWSER pane never settled — ${JSON.stringify(m)}`);
    assert.ok(
      Math.abs(m.editor - m.needs) <= 1,
      `the editor is ${Math.round(m.editor)}px for ${Math.round(m.needs)}px of content — ${Math.round(m.editor - m.needs)}px it cannot use`,
    );
    assert.ok(m.lower !== null && m.lowerBottom !== null, 'there is no region under the editor on the BROWSER door, so gate 4 reads nothing');
    assert.ok(m.lowerBottom <= m.colBottom + 1, `the record pane ends ${Math.round(m.lowerBottom - m.colBottom)}px below its own column`);
    assert.ok(m.lower >= 112, `the record pane is ${Math.round(m.lower)}px — under the 112px its own button and sentence need`);

    /**
     * **Gate 7 — a handle at rest, on both dividers, with the pointer off the page** (`D1197`).
     *
     * `fedora-box-dashboard`'s `M23` found two of three instruments for exactly this claim
     * vacuous: an `h2` fills its panel whatever the grip does, and `opacity: 0` does not take a
     * `::before` out of flow. So this reads **the computed colour of the handle itself**, not a
     * width and not a hover delta — and it asserts the negative control in the same pass, that
     * neither element is `:hover`, because a page whose pointer happens to be resting on a
     * divider would report `--accent` and pass for the wrong reason.
     */
    const handles = await fresh.locator('body').evaluate((root) => {
      const view = root.ownerDocument.defaultView!;
      return {
        muted: view.getComputedStyle(root.ownerDocument.documentElement).getPropertyValue('--muted').trim(),
        seen: ['.col-grip', '.split'].map((sel) => {
          const el = root.querySelector(sel);
          if (el === null) return { sel, colour: null, hovered: false };
          return { sel, colour: view.getComputedStyle(el, '::before').backgroundColor, hovered: el.matches(':hover') };
        }),
      };
    });
    const hex = handles.muted.replace('#', '');
    const asRgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
    for (const h of handles.seen) {
      assert.equal(h.hovered, false, `${h.sel} is under the pointer, so its colour is the LIT one and this reading proves nothing`);
      assert.equal(h.colour, asRgb, `${h.sel}'s handle is ${h.colour} at rest — it is meant to be --muted (${asRgb}), which measures 4.34:1 on the panel`);
    }

    /**
     * **Gate 5 — the API door gets the same rule** (`D1198`).
     *
     * This is the half nobody reported. `.editor-col` is one component shared by both doors since
     * `M214`, and the same ratio that pinched the BROWSER pane by 27 px wasted **208 px** under an
     * API `expect` and clipped nothing — because the response pane happened to be tall enough.
     * The mutation is a `door === 'browser'` conditional on the track: this number returns to 208.
     */
    await fresh.goto(`${pageUrl}#/api/compose/tests/catalog.tflw/L4`);
    let api = await slack();
    for (let i = 0; i < 50 && (api === null || api.rows === 0); i++) {
      await fresh.waitForTimeout(100);
      api = await slack();
    }
    assert.ok(api !== null && api.rows > 0, `the API pane never settled — ${JSON.stringify(api)}`);
    assert.ok(
      Math.abs(api.editor - api.needs) <= 1,
      `the API door's editor is ${Math.round(api.editor)}px for ${Math.round(api.needs)}px of content — ${Math.round(api.editor - api.needs)}px wasted on the door that had it worst`,
    );

    /**
     * **Gate 4's own shape: a tall editor in a short column, where the floor is the only thing
     * holding the region open.**
     *
     * At 1440x900 gate 4 is *implied* by gate 3 — an editor that asks for 99 px leaves 588 for the
     * pane below it whatever the floor says — and a gate that only ever passes for another gate's
     * reason is one this project has filed as vacuous four times. So the floor gets the shape it
     * was written for: an API **request** (237 px of editor, the tallest thing this pane holds) in
     * a column the window has squeezed to ~286. `minmax(112px, 1fr)` gives the editor 168 and the
     * response its 112; the mutation `minmax(0, 1fr)` gives the editor all 237 and the response
     * **43**, and this is the only reading in the round that can tell those two apart.
     */
    await fresh.setViewportSize({ width: 1000, height: 480 });
    await fresh.goto(`${pageUrl}#/api/compose/tests/catalog.tflw/L3`);
    let tight = await slack();
    for (let i = 0; i < 50 && (tight === null || tight.rows === 0 || tight.needs < 160); i++) {
      await fresh.waitForTimeout(100);
      tight = await slack();
    }
    assert.ok(tight !== null && tight.lower !== null, `the short-window reading found no region — ${JSON.stringify(tight)}`);
    // The denominator: the editor above it really is asking for more than the column can give,
    // which is the only condition under which the floor is doing any work at all.
    assert.ok(tight.needs >= 160, `the request editor wants only ${Math.round(tight.needs)}px here, so the floor is not what is holding the region open and this reading proves nothing`);
    assert.ok(tight.lower >= 112, `at 1000x480 the response region is ${Math.round(tight.lower)}px — the editor above it has taken the floor`);
    await fresh.setViewportSize({ width: 1440, height: 900 });

    /**
     * **Gate 6 — a drag still wins, and keeps winning** (`D1196`).
     *
     * `D1195` makes the track content-sized, which is a DEFAULT and not a rule: a reader who wants
     * a tall editor over a short statement still gets one. What this asserts is the part a
     * content-sized track could quietly take back — that the override survives selecting a
     * different row, whose content would otherwise resize the track under it. The mutation is
     * dropping the override: the editor snaps back to what it holds on the next click.
     */
    await fresh.goto(`${pageUrl}#/browser/compose/tests/shop.tflw/L3`);
    let split = await fresh.locator('[data-compose-split]').boundingBox();
    for (let i = 0; i < 50 && split === null; i++) {
      await fresh.waitForTimeout(100);
      split = await fresh.locator('[data-compose-split]').boundingBox();
    }
    assert.ok(split !== null, 'the divider is not on the page');
    await fresh.mouse.move(split.x + split.width / 2, split.y + split.height / 2);
    await fresh.mouse.down();
    await fresh.mouse.move(split.x + split.width / 2, split.y + split.height / 2 + 60, { steps: 6 });
    await fresh.mouse.up();
    const dragged = Number(await fresh.locator('[data-compose-split]').getAttribute('data-compose-split'));
    assert.ok(Number.isFinite(dragged), `the drag left the divider at ${JSON.stringify(dragged)} rather than a height`);
    const before = await slack();
    assert.ok(before !== null && before.editor > before.needs + 20, `the drag bought no room — editor ${Math.round(before?.editor ?? 0)} against ${Math.round(before?.needs ?? 0)} of content`);

    // …and now a different row, whose content is a different height.
    await fresh.locator('[data-seq-line="4"] [data-seq-pick]').first().click();
    await fresh.waitForTimeout(150);
    const after = await slack();
    assert.equal(Number(await fresh.locator('[data-compose-split]').getAttribute('data-compose-split')), dragged, 'the row change dropped the reader’s own height');
    assert.ok(
      after !== null && Math.abs(after.editor - before.editor) <= 1,
      `the editor re-sized itself to the new row — ${Math.round(before.editor)} → ${Math.round(after?.editor ?? 0)} — so the drag does not win`,
    );
  } finally {
    await fresh.close();
  }
});

/**
 * **`M223` `E` — the playback height is the reader's, and the drag survives the frame** (`D1199`).
 *
 * The user pointed at a **gap**. With a trace up `.compose-pane` sits on its 320 px floor and the
 * viewer on its 620 px one — 994 px of want in a 900 px window — so the page queues them down a
 * scroll and the two can never be seen together at a size anybody chose. The 14 px between them is
 * `.stage`'s `margin-top`, and it reads as a seam because both columns' bottom borders run across
 * the full width right above it: a line that is not a control, which is `.split`'s own pre-`D1197`
 * misreading a second time.
 *
 * **It runs a real play, in a project of its own, and both halves of that are load-bearing.** A
 * real play because the frame only exists once there is a trace and there is no trace in the
 * fixture corpus — every `trace.path` in `reports/full` is `null`, so a seeded report cannot
 * produce this state. A project of its own because a play WRITES a report, and `D1099` has the
 * pane read *the last run that touched this file*: doing it in the shared fixture would hand every
 * later gate a report they did not write.
 *
 * The headline assertion is the drag distance, and it is the one that caught the defect. Measured
 * on the live page: a 300 px drag moved the frame **90 px** and stopped — exactly the distance
 * from the grip to the frame's top edge, because from there on `pointermove` belongs to the
 * iframe's document and the page never hears another one. Every grip in this app listens on the
 * window for the opposite reason (a pointer leaving a 6 px strip mid-drag is normal), and that
 * reasoning is simply void across a same-origin frame.
 */
test('`M223` `E`: with a trace up, the playback height is the reader’s — and the drag survives the frame (`D1199`)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m223-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    // The fixture server is already up for this process — pointing at it is what makes the play a
    // real one. `node_modules` is symlinked for the same reason the shared fixture does it: with
    // no `playwright-core` resolvable from the project there is no viewer to serve and no trace to
    // put in it, and `readProject().traceViewer` would be false.
    await symlink(join(here, '..', '..', '..', 'node_modules'), join(dir, 'node_modules'), 'dir');
    await writeFile(join(dir, 'tflw.config'), ['env local default', `  web "http://127.0.0.1:${fixturePort}"`, ''].join('\n'));
    await writeFile(join(dir, 'b.tflw'), ['@ui', 'test "one"', '  open "/"', ''].join('\n'));
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;

    const read = () =>
      fresh.locator('body').evaluate((root) => {
        /* **No `const box = (sel) => …` here, and the first draft had one** (`M222-01`): tsx's
           keep-names transform wraps any function expression with an INFERRED name in a call to
           `__name`, which exists in the test process and not in the browser — `ReferenceError:
           __name is not defined`, 1.4 s in, before the play it is waiting for even starts. An
           anonymous arrow passed straight to `.map` is fine, which is why the sibling gate's
           handle loop survives; binding one to a `const` is not. */
        const view = root.ownerDocument.defaultView!;
        const main = root.querySelector('.main-fill');
        const grip = root.querySelector('[data-grip="stage"]');
        const pane = root.querySelector('.compose-pane');
        const frame = root.querySelector('.stage-frame');
        return {
          fit: root.querySelector('.doorpane')?.getAttribute('data-stage-fit') ?? null,
          /* `.main-fill` is the scroll container, not the document — `documentElement` reads 900
             whatever the region below the fold is doing, which is how a page that scrolls can look
             like one that does not. */
          over: main === null ? null : main.scrollHeight - main.clientHeight,
          pane: pane === null ? null : { h: Math.round(pane.getBoundingClientRect().height) },
          frame: frame === null ? null : { h: Math.round(frame.getBoundingClientRect().height) },
          grips: root.querySelectorAll('[data-grip="stage"]').length,
          handle: grip === null ? null : view.getComputedStyle(grip, '::before').backgroundColor,
          hovered: grip === null ? false : grip.matches(':hover'),
          muted: view.getComputedStyle(root.ownerDocument.documentElement).getPropertyValue('--muted').trim(),
          rows: root.querySelectorAll('[data-seq-row]').length,
        };
      });

    await fresh.goto(`${base}/?token=${TOKEN}#/browser/compose/b.tflw/L3`);
    let m = await read();
    for (let i = 0; i < 50 && m.rows === 0; i++) {
      await fresh.waitForTimeout(100);
      m = await read();
    }
    assert.ok(m.rows > 0, `the pane never settled — ${JSON.stringify(m)}`);
    // `D1082` — with no trace the stage is a 17 px bar, and a control that resizes a bar is a
    // control that does nothing.
    assert.equal(m.grips, 0, 'the playback grip is drawn before there is anything to share');

    await fresh.locator('[data-seq-play="test"]').first().click();
    for (let i = 0; i < 240 && m.frame === null; i++) {
      await fresh.waitForTimeout(500);
      m = await read();
    }
    assert.ok(m.frame !== null, `no trace landed in two minutes, so this gate measured nothing — ${JSON.stringify(m)}`);
    assert.equal(m.grips, 1, 'there is a trace and no grip on the boundary above it');
    // The handle, at rest, with the pointer nowhere near it (`D1197` applied to the third grip).
    const hex = m.muted.replace('#', '');
    assert.equal(m.hovered, false, 'the grip is under the pointer, so its colour is the lit one');
    assert.equal(m.handle, `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`);
    // The denominator: at rest this really is the state the round is about — the two regions do
    // not fit and the region scrolls. Without this the assertions below pass on a window that was
    // never crowded.
    assert.equal(m.fit, 'auto', 'something has already overridden the height, so `M221`’s own state is not what is being measured');
    assert.ok((m.over ?? 0) > 100, `at rest the two regions already fit (${m.over}px over), so there is nothing for the reader to decide`);
    const atRest = m;

    const g = (await fresh.locator('[data-grip="stage"]').boundingBox())!;
    await fresh.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await fresh.mouse.down();
    // **Deliberately far enough to cross the frame's own top edge**, which is ~100 px below the
    // grip: a drag that stopped there is the defect, and a shorter drag cannot tell the two apart.
    await fresh.mouse.move(g.x + g.width / 2, g.y + g.height / 2 + 400, { steps: 12 });
    await fresh.mouse.up();
    await fresh.waitForTimeout(300);
    const dragged = await read();
    assert.ok(
      dragged.frame !== null && atRest.frame !== null && atRest.frame.h - dragged.frame.h >= 300,
      `a 400px drag moved the playback ${Math.round((atRest.frame?.h ?? 0) - (dragged.frame?.h ?? 0))}px — it is dying at the frame’s top edge`,
    );
    // …and the thing the drag is FOR: both regions in one window, at the share the reader set.
    assert.equal(dragged.over, 0, `the region still scrolls by ${dragged.over}px after the reader asked for both at once`);
    assert.ok(
      dragged.pane !== null && atRest.pane !== null && dragged.pane.h >= atRest.pane.h,
      `the authoring pane did not take the room back — ${atRest.pane?.h} → ${dragged.pane?.h}`,
    );

    // `Home` gives `M221`'s viewer back exactly: 620 is `.stage-frame`'s own floor, which is why
    // the grip sizes the FRAME rather than the section around it.
    await fresh.locator('[data-grip="stage"]').focus();
    await fresh.keyboard.press('Home');
    await fresh.waitForTimeout(300);
    const home = await read();
    assert.equal(home.fit, String(STAGE_FALLBACK));
    assert.ok(home.frame !== null && Math.abs(home.frame.h - atRest.frame.h) <= 2, `\`Home\` did not restore the viewer — ${atRest.frame.h} → ${home.frame?.h}`);
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * **Nothing on the sequence column is painted the disabled colour** — `M223` `G`.
 *
 * `button:disabled` and `input:disabled` are `color: var(--muted)` in this stylesheet, and so were
 * a step's keyword and a step's own words. That is not a figure of speech about how it looked: one
 * token carried *greyed out* and *this is a step of your test*, and measured on the live pane the
 * step's argument read **4.34:1** — the only body text on the column under the 4.5:1 AA floor for
 * 12 px, three pixels under a head reading 12.91:1.
 *
 * Every reading here is a RELATIONSHIP and not a literal: *the step's ink is the head's ink*, *the
 * keyword is legible on its own chip*, *the chip lifts the row by the same amount whether or not
 * the row is selected*, *one keyword renders one way on every surface that draws it*. A gate that
 * pinned `#9ca4ad` would freeze one theme of four and say nothing about the other three.
 *
 * **The chip is read through `over`, never as its own colour.** Its ground is translucent by
 * decision (`D1203`), so `getComputedStyle` hands back a colour that is not what anybody sees —
 * the thing the reader gets is that colour composited over whatever the row is doing, and the
 * whole point of the decision is that the row is sometimes selected. Reading the declared value
 * would have graded the mutation as green.
 *
 * `M222-02`'s bounded poll and `M222-01`'s anonymous callbacks apply here exactly as they do to the
 * geometry gate above, and `--muted` is resolved off a probe element rather than written down, so
 * the comparison is against the live token.
 */
test('`M223` `G`: a step is content and its keyword is a label — one ink on three surfaces, a chip that lifts rather than paints, and a rail that belongs to the group (`D1202`, `D1203`, `D1204`)', async () => {
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    const read = () =>
      fresh.locator('body').evaluate((root) => {
        const view = root.ownerDocument.defaultView!;
        const col = root.querySelector('.seq-col');
        const step = root.querySelector('.seq-col .seq-row.under');
        const head = root.querySelector('.seq-col .seq-row:not(.under) .seq-text');
        const declKw = root.querySelector('.seq-col .seq-row:not(.under) .seq-kind');
        const attached = root.querySelector('.seq-group > ol.seq.attached');
        const sideKw = root.querySelector('.outline-row .seq-kind');
        if (col === null || step === null || head === null) return null;
        const kw = step.querySelector('.seq-kind');
        const txt = step.querySelector('.seq-text');
        /* `--muted` resolved off the page rather than written into this file: the claim is about
           the token the disabled controls actually use, not about a hex that was true once. */
        const probe = root.ownerDocument.createElement('div');
        probe.style.color = 'var(--muted)';
        root.appendChild(probe);
        const muted = view.getComputedStyle(probe).color;
        probe.remove();
        const chipCs = kw === null ? null : view.getComputedStyle(kw);
        const on = root.querySelector('.seq-col .seq-row.on.under .seq-kind');
        return {
          rows: root.querySelectorAll('[data-seq-row]').length,
          ground: view.getComputedStyle(col).backgroundColor,
          muted,
          stepText: txt === null ? null : view.getComputedStyle(txt).color,
          headText: view.getComputedStyle(head).color,
          kwColor: chipCs === null ? null : chipCs.color,
          chipBg: chipCs === null ? null : chipCs.backgroundColor,
          padX: chipCs === null ? 0 : parseFloat(chipCs.paddingLeft),
          marX: chipCs === null ? 0 : parseFloat(chipCs.marginLeft),
          declKwBg: declKw === null ? null : view.getComputedStyle(declKw).backgroundColor,
          declKwColor: declKw === null ? null : view.getComputedStyle(declKw).color,
          sideKwColor: sideKw === null ? null : view.getComputedStyle(sideKw).color,
          railStyle: attached === null ? null : view.getComputedStyle(attached).borderLeftStyle,
          railWidth: attached === null ? null : view.getComputedStyle(attached).borderLeftWidth,
          railColor: attached === null ? null : view.getComputedStyle(attached).borderLeftColor,
          onChipBg: on === null ? null : view.getComputedStyle(on).backgroundColor,
          onRowBg: on === null ? null : view.getComputedStyle(on.closest('.seq-row')!).backgroundColor,
        };
      });

    const settle = async (): Promise<NonNullable<Awaited<ReturnType<typeof read>>>> => {
      let m = await read();
      for (let i = 0; i < 50 && (m === null || m.rows === 0); i++) {
        await fresh.waitForTimeout(100);
        m = await read();
      }
      assert.ok(m !== null && m.rows > 0, `the pane never settled — ${JSON.stringify(m)}`);
      return m;
    };

    /* ── the BROWSER door, with a step selected so the chip is read on both grounds ──────── */
    await fresh.goto(`${pageUrl}#/browser/compose/tests/shop.tflw/L4`);
    const b = await settle();

    /* **Gate 11 — a step's own words are content.** The mutation is putting
       `.seq-row.under .seq-text { color: var(--muted) }` back: 12.91:1 becomes 4.34:1. */
    assert.ok(
      contrast(b.stepText!, b.ground) >= 7,
      `a step's own words read ${contrast(b.stepText!, b.ground).toFixed(2)}:1 against the column — \`button:disabled\` is ${b.muted}`,
    );
    /* **Gate 12 — and they are the SAME ink the head uses**, which is the part that says *content*
       rather than merely *legible*. Its own mutation is a value that clears the floor above and is
       still not the head's: `color-mix(in srgb, var(--fg) 85%, var(--muted))`. */
    assert.equal(b.stepText, b.headText, 'a step is drawn in a different ink from the declaration above it — `D1202` says a step is content, not a quieter kind of chrome');

    /* **Gate 13 — the keyword is legible ON ITS OWN CHIP.** Read through `over`, because the chip
       is translucent: its declared colour is not what anybody sees. The mutation is
       `.seq-kind { color: var(--muted) }`, which measures 2.97:1 on this ground. */
    const chipRest = over(b.chipBg!, b.ground);
    assert.ok(
      contrast(b.kwColor!, chipRest) >= 4.5,
      `the step keyword reads ${contrast(b.kwColor!, chipRest).toFixed(2)}:1 on its own chip — under the AA floor for 12px text`,
    );

    /* **Gate 14 — one keyword, three surfaces** (`M216`). The sidebar draws the same class and the
       Source index draws it a third time; the mutation is scoping the ink to `.seq-col`, which
       leaves the sidebar on the disabled token while this column comes up. */
    assert.ok(b.sideKwColor !== null, 'the sidebar draws no `.seq-kind`, so the one-spelling claim reads nothing');
    assert.equal(b.sideKwColor, b.kwColor, 'the sidebar’s declaration keyword and the sequence’s step keyword are the same class drawn two ways — `M216` says that is how three surfaces drift apart');

    /* **Gate 15 — the chip is a shape, not a whisper.** The mutation is `--muted 8%`, which lifts
       the row by 1.06 and is a rectangle nobody can find. */
    const liftRest = contrast(chipRest, b.ground);
    assert.ok(liftRest >= 1.3, `the chip lifts its row by ${liftRest.toFixed(2)}:1 — below that it is not a shape at 11px`);

    /* **Gate 16 — and the lift is the same when the row is selected**, which is the whole reason
       the ground is translucent (`D1203`). The mutation is an opaque ground: it paints `--panel`
       regardless of the row, so the lift measured 1.46 at rest and **1.17** here. This assertion
       is deliberately AFTER the floor above and BEFORE nothing — `F`'s finding was a control that
       could never run because a ratio above it failed first, and these two are independent. */
    assert.ok(b.onChipBg !== null && b.onRowBg !== null, 'no step row is selected, so the selected-row reading is vacuous');
    const onGround = over(b.onRowBg, b.ground);
    const liftOn = contrast(over(b.onChipBg, onGround), onGround);
    assert.ok(
      Math.abs(liftOn - liftRest) / liftRest <= 0.1,
      `the chip lifts ${liftRest.toFixed(2)}:1 at rest and ${liftOn.toFixed(2)}:1 on the selected row — an opaque ground paints \`--panel\` whatever the row is doing`,
    );

    /* **Gate 17 — the chip has a ground to be, and gate 18 — it costs the text almost nothing.**
       Two mutations: `padding: 1px 0` leaves the background hugging the glyph, and
       `padding: 1px 5px; margin-inline: 0` is the first draft, which spends 10px. */
    assert.ok(b.padX >= 3, `the chip has ${b.padX}px of horizontal padding — its ground is hugging the word`);
    assert.ok(2 * (b.padX + b.marX) <= 3, `the chip spends ${(2 * (b.padX + b.marX)).toFixed(1)}px of \`.seq-text\`, which is the scarcest text on this pane`);

    /* **Gate 19 — the declaration keyword did NOT get a chip**, and that is `M216` again rather
       than restraint: the chip's scope is its meaning. The mutation widens it to
       `.seq-row .seq-kind`, and `test` gains a ground the sidebar's own `test` has not. */
    assert.equal(alphaOf(b.declKwBg!), 0, 'the declaration keyword has a chip ground — the chip then means *any keyword*, and the sidebar and Source draw the same class without one');
    assert.ok(
      contrast(b.declKwColor!, b.ground) >= 7,
      `\`test\` reads ${contrast(b.declKwColor!, b.ground).toFixed(2)}:1 — it is on the disabled token too`,
    );

    /* ── the API door: the rail is the group's, not the session's ────────────────────────── */
    const browserRail = b.railColor;
    await fresh.goto(`${pageUrl}#/api/compose/tests/catalog.tflw/L2`);
    const a = await settle();

    /* **Gate 20 — a request group has a rail at all.** The mutation is reverting the selector to
       `.seq-group.session > .seq`: this reads `none` and the API door goes back to holding an
       `expect` to its request by a 10px indent and nothing else. */
    assert.equal(a.railStyle, 'solid', 'the API door’s request group has no rail — `D1204` gives both groups the one their body already shares');
    assert.equal(a.railWidth, '1px', 'the rail is a band rather than a hairline');
    /* **Gate 21 — and it is the SAME rail**, so the two doors are one rule and not two. */
    assert.equal(a.railColor, browserRail, 'the two doors draw different rails — `D1198` says one rule, no door conditional');
    /* **Gate 22 — still a mark, not a seam** (`D1200`'s arithmetic, restated where it can fail). */
    assert.ok(
      contrast(a.railColor!, a.ground) >= 2.5,
      `the rail reads ${contrast(a.railColor!, a.ground).toFixed(2)}:1 — \`--line\` measures 1.20 and is an absent mark, not a quiet one`,
    );
  } finally {
    await fresh.close();
  }
});

test('`M214` `A6`: `+ new file` is in the explorer, where files are (`D1118`)', async () => {
  // *"Why no option to add a new file in this sidebar/project explorer"* — and the button existed,
  // in the **Compose head**, a toolbar over a pane about one declaration. Creation lives where the
  // thing is created; the dialog is the shell's, because the explorer and Compose are siblings and
  // both ask for it.
  await withRemovalFixture(['test "one"', '  api GET /a', '  expect status equals 200', ''].join('\n'), async (p, base, dir) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw`);
    await p.locator('[data-files]').waitFor();
    // `M238-04` — the explorer arriving says nothing about Compose: `[data-seq-foot]` renders after
    // the file is read, so the counts below read it one-shot and `+ new test` came back 0 once in a
    // 296-run sweep. The `0` two lines down was worse, since it passes against a pane that has not
    // drawn yet. Waiting on the foot settles both.
    await p.locator('[data-seq-foot]').waitFor();
    assert.equal(
      await p.locator('.sidebar [data-compose-new-file]').count(),
      1,
      'the create is in the list of files it makes another of',
    );
    assert.equal(await p.locator('.doorpane [data-compose-new-file]').count(), 0, 'and no longer in the Compose head');
    // `+ new test` is at the foot of the sequence, because a test is what that column lists.
    assert.equal(await p.locator('[data-seq-foot] [data-compose-new-test]').count(), 1);

    await p.locator('.sidebar [data-compose-new-file]').click();
    await p.locator('[data-new-thing="file"]').waitFor();
    await p.locator('[data-new-file]').fill('second.tflw');
    await p.locator('[data-new-name]').fill('the second file');
    await p.locator('[data-new-path]').fill('/b');
    await p.locator('[data-new-create]').click();
    await p.locator('[data-new-thing="file"]').waitFor({ state: 'detached' });

    assert.match(await readFile(join(dir, 'second.tflw'), 'utf8'), /^test "the second file"$/m);
    // **A create that leaves you looking at the file you were already on is a write with no visible
    // consequence** — the shape `M209` found four times over.
    await p.locator('[data-file-row="second.tflw"][data-open="yes"]').waitFor();
    assert.match(new URL(p.url()).hash, /second\.tflw/);
  });
});

// ---------------------------------------------------------------------------
// `M215` `B1`–`B3` — the body, coloured, checked and laid out.
//
// **The two blocks that show a JSON document were the two with no colour and no check.** The
// request body was a bare `<textarea>` whose only feedback was the write being refused with a
// sentence, after the fact, with no position; the response was a flat `<pre>` of whatever the
// service sent, which for a real API is one minified line beside the assertions that read it.
//
// The language half is `D1120`: a value carrying a newline used to be refused outright, and that
// refusal was wrong about exactly one shape — a `{`/`[` literal, which the lexer already lets span
// lines because it emits no `newline` while a bracket is open. It mattered because a JSON body is
// the one value a person **pastes**, and pasted JSON is pretty-printed.
// ---------------------------------------------------------------------------

test('`M215` `B3`: the JSON body is painted, and the language underlines what it cannot read', async () => {
  const body = ['test "one request"', '  api POST /orders body { itemId: 2, qty: 3 }', '  expect status equals 201', ''].join('\n');
  await withEditFixture(body, async (p, base) => {
    await openFirstRequest(p, base);
    await editorTab(p, 'body');

    // **The coloured copy and the editable text are the same bytes.** That is the whole safety
    // property of drawing one over the other: a reader looking at the ink and a writer typing into
    // the field must never be looking at two documents.
    const ink = p.locator('[data-body-ink]');
    assert.equal(((await ink.textContent()) ?? '').replace(/\n$/, ''), '{ itemId: 2, qty: 3 }');
    assert.equal(await p.locator('[data-body-edit-text]').inputValue(), '{ itemId: 2, qty: 3 }');

    // A **bare** key is a key, exactly as a quoted one is. The highlighter alone calls the first
    // `typ` and the second `str`; `jsonview`'s first rule is what makes them agree.
    assert.deepEqual(await ink.locator('.t-typ').evaluateAll((els) => els.map((e) => e.textContent)), ['itemId', 'qty']);
    assert.deepEqual(await ink.locator('.t-num').evaluateAll((els) => els.map((e) => e.textContent)), ['2', '3']);
    assert.equal(await p.locator('[data-body-problem]').getAttribute('data-body-problem'), 'none');
    assert.equal(await p.locator('[data-body-ok]').count(), 1);

    // **A mistake is underlined where the language says it is**, on the keystroke, not at the write.
    await p.locator('[data-body-edit-text]').fill('{ itemId: , qty: 3 }');
    await p.locator('[data-body-problem-text]').waitFor();
    assert.equal(await p.locator('[data-body-problem]').getAttribute('data-body-problem'), 'TF010');
    assert.equal(await ink.locator('.squiggle').textContent(), ',', 'the comma standing where a value should be');
    // The colouring did not collapse because something was wrong — the pieces are computed over
    // the whole text once, and only their roles change.
    assert.deepEqual(await ink.locator('.t-typ').evaluateAll((els) => els.map((e) => e.textContent)), ['itemId', 'qty']);

    // **`format` lays it out; the file still gets one line.** A value is one line to the printer
    // and every edit here goes back through it, so the layout is a reading aid for as long as the
    // request is open — which is a cost worth paying only because the *other* direction changed.
    await p.locator('[data-body-edit-text]').fill('{ itemId: 2, qty: 3 }');
    await p.locator('[data-body-format]').click();
    assert.equal(await p.locator('[data-body-edit-text]').inputValue(), '{\n  itemId: 2,\n  qty: 3\n}');
    assert.equal(await p.locator('[data-body-format]').isDisabled(), true, 'there is nothing left to lay out');

  });
});

test('`M215` `B1`: a pasted, pretty-printed JSON body is accepted and written back on one line', async () => {
  // **The gesture this round exists for.** Before `D1120` this exact paste was refused with *a
  // value is written on one line* — true about a scalar, and a wall in front of the commonest
  // thing anyone does with a Body tab.
  const body = ['test "one request"', '  api POST /orders body { itemId: 2, qty: 3 }', '  expect status equals 201', ''].join('\n');
  await withEditFixture(body, async (p, base, dir) => {
    await openFirstRequest(p, base);
    await editorTab(p, 'body');
    await p.locator('[data-body-edit-text]').fill('{\n  "itemId": 7,\n  "qty": 1,\n  "note": "gift",\n  "big": 12345678901234567890\n}');
    assert.equal(await p.locator('[data-body-problem]').getAttribute('data-body-problem'), 'none', 'the language reads it');
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
    const written = await readFile(join(dir, 'edit.tflw'), 'utf8');
    assert.match(written, /^ {2}api POST \/orders body \{ itemId: 7, qty: 1, note: "gift", big: 12345678901234567890 \}$/m);
    // **The big number is the point of the layout being a whitespace pass.** A `JSON.parse` round
    // trip would have shown — and written — 12345678901234567000.
    assert.doesNotMatch(written, /12345678901234567000/);
  });
});

// ---------------------------------------------------------------------------
// `M216` `B0` — the gates slice `A` shipped without.
//
// **Slice `A` was built during the grilling that scoped this round, and it landed with no gate at
// all.** Five changes went in on measurement — a line-number gutter, a resizable project pane, a
// `test` chip on three surfaces, the `expect expect` stutter, and the Compose band painted in place
// — and the whole suite stayed green through every one of them, because not one of those five is a
// thing any existing assertion asks about. `PLAN_M216_REMOVE_AND_PRESENT.md` `§4` puts this slice
// first for that reason: `A4` especially, since a stutter fix with no gate is exactly the change a
// later refactor undoes by accident, and the pane would go back to reading `expect expect status
// equals 201` with 4494 tests green.
//
// **Each claim here is a property, never a string.** The round's standing instruction is *stop
// producing gates that freeze a lifeless UI*, and three Compose rounds ended in the same pane
// because a gate pinned an arrangement or a sentence. So: no row's text is pinned, no name is
// pinned, no palette is pinned. What is pinned is *a row does not repeat its own chip*, *the text
// under the gutter is still the file*, *the pane obeys the reader*, and *one class draws a
// declaration on all three surfaces that draw one*.
// ---------------------------------------------------------------------------

/** Slice `A`'s subject: a file long enough to need a two-digit gutter, with a declaration name long
 *  enough to truncate at the pane's floor and short enough to fit at its ceiling — the two widths
 *  `A2`'s claim has to be asked at, since a truncation rule passes vacuously at one. */
const LEGIBLE = [
  '# the file, so line 1 is not a declaration',
  '',
  '@checkout',
  'test "it accepts a basket and confirms one order"',
  '  api POST /baskets body { lines: [{ itemId: 1, qty: 2 }], coupon: "SHELF10" }',
  '    header "Accept" is "application/json"',
  '  expect status equals 201',
  '  expect body.total equals 2520',
  '  capture body.id as basketId',
  '  api POST /orders/checkout body { basketId: "{basketId}" }',
  '    header "Authorization" is "Bearer tok"',
  '  expect status equals 401',
  '',
  'test "short"',
  '  api GET /health',
  '  expect status equals 200',
  '',
].join('\n');

test('`M216` `B0`/`A1`: Source numbers every line, and the text under the numbers is still the file byte for byte (`D985`)', async () => {
  await withRemovalFixture(LEGIBLE, async (p, base, dir) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/source/x.tflw`);
    const file = await readFile(join(dir, 'x.tflw'), 'utf8');
    const lines = file.split('\n');
    // The last line, not the `<pre>`: the element is in the document before the bytes are.
    await p.locator(`[data-preview] [data-source-line="${lines.length}"]`).waitFor();

    // **This assertion is `A1`'s whole design, not a side condition.** `D985` makes this `<pre>`'s
    // `textContent` the file byte for byte, and every page gate that reads `[data-preview]` rests
    // on it — so the numbers had to be drawn as generated content, which `textContent` does not
    // see. Render them as text instead and this line reddens on the first character: it IS the
    // mutation detector for the obvious implementation.
    assert.equal(await p.locator('[data-preview]').textContent(), file, 'the gutter costs the projection nothing');

    // Every physical line is numbered, including the blank ones — a gutter that skips the empties
    // renumbers the file.
    const spans = p.locator('[data-preview] [data-source-line]');
    assert.equal(await spans.count(), lines.length, `${lines.length} lines, ${lines.length} numbers`);
    assert.deepEqual(
      await spans.evaluateAll((els) => els.map((e) => e.getAttribute('data-source-line'))),
      lines.map((_, i) => String(i + 1)),
      'and they count from one, in order',
    );

    // **The number the READER sees**, which is a different claim from the attribute being present:
    // the attribute has been there since `M213` for the index to scroll to, and nothing drew it.
    const drawn = await spans.first().evaluate((el) => {
      const view = el.ownerDocument.defaultView!;
      const before = view.getComputedStyle(el, '::before');
      return { content: before.content, width: Math.round(Number.parseFloat(before.width)) };
    });
    assert.match(drawn.content, /1/, `the first line's gutter draws its number (${drawn.content})`);
    assert.ok(drawn.width > 0, `and it occupies the page (${drawn.width}px)`);

    // **The gutter is as wide as the widest number and no wider**, which is why it is a variable
    // rather than a constant: a 17-line file spends two characters and a 120-line file spends
    // three. Asked at both, so the rule cannot pass by agreeing with one hardcoded answer.
    assert.equal(await p.locator('[data-preview]').getAttribute('data-source-gutter'), '2', '17 lines, two digits');
  });

  const long: string[] = ['# a file past a hundred lines', ''];
  for (let i = 0; i < 30; i++) long.push('@api', `test "case ${i}"`, `  api GET /c/${i}`, '  expect status equals 200', '');
  await withRemovalFixture(long.join('\n'), async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/source/x.tflw`);
    // Waited for by its LAST line, not by the `<pre>`: the element is in the document before the
    // bytes are, and a gutter width read off an empty buffer is one digit — which is how the first
    // draft of this assertion failed while the page was perfectly correct.
    await p.locator(`[data-preview] [data-source-line="${long.length}"]`).waitFor();
    assert.equal(await p.locator('[data-preview]').getAttribute('data-source-gutter'), '3', `${long.length} lines, three digits`);
  });
});

test('`M216` `B0`/`A2`: the project pane is the reader’s width — nudged, dragged, clamped at both ends, and remembered', async () => {
  await withRemovalFixture(LEGIBLE, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L4`);
    await p.locator('[data-files]').waitFor();

    const grip = p.locator('[data-grip="sidebar"]');
    const paneWidth = (): Promise<number> => p.locator('.sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().width));
    // The long declaration's label, which is what the width is FOR. `A2` does not abolish
    // truncation and is not meant to; what it buys is that the trade is the reader's.
    // The declaration's OWN button — the `<li>` also holds a nested list of request rows, and
    // every one of them draws an `.outline-name` too.
    const label = p.locator('.sidebar [data-outline-decl="test"]').first().locator('.outline-row').first().locator('.outline-name');
    const cut = (): Promise<boolean> => label.evaluate((el) => el.scrollWidth > el.clientWidth);

    assert.equal(await grip.getAttribute('role'), 'separator', 'a separator, not a div with a pointer handler');
    assert.equal(await grip.getAttribute('aria-valuenow'), '320');
    assert.equal(await paneWidth(), 320, 'and the grid agrees with the value it announces');

    // **The keyboard first.** A control only a pointer can reach is a control some readers do not
    // have, and it is also the cheapest way to prove the value and the geometry move together.
    await grip.focus();
    await p.keyboard.press('ArrowRight');
    assert.equal(await paneWidth(), 336, 'one nudge is 16px');
    await p.keyboard.press('ArrowLeft');
    assert.equal(await paneWidth(), 320);

    // **Dragged past the ceiling, and it stops at the ceiling.** The pointer owns the window during
    // a drag — the listeners are on `window`, not on the 6px target — so a pointer that leaves the
    // grip is the normal case, which is exactly what this drag does.
    const box = (await grip.boundingBox())!;
    await p.mouse.move(box.x + box.width / 2, box.y + 100);
    await p.mouse.down();
    await p.mouse.move(1430, box.y + 100, { steps: 8 });
    await p.mouse.up();
    assert.equal(await paneWidth(), 720, 'clamped at the ceiling — half of a 1440 window');
    assert.equal(await cut(), false, 'and at the ceiling the long name is whole');

    await p.mouse.move((await grip.boundingBox())!.x + 3, box.y + 100);
    await p.mouse.down();
    await p.mouse.move(4, box.y + 100, { steps: 8 });
    await p.mouse.up();
    assert.equal(await paneWidth(), 200, 'clamped at the floor');
    assert.equal(await cut(), true, 'and at the floor it is an ellipsis — the two widths the rule has to be asked at');

    // **Remembered where a per-viewer convenience belongs** — `localStorage`, keyed per origin,
    // which is per served project. Nothing about a pane's width is a fact about the project.
    assert.equal(
      await grip.evaluate((el) => el.ownerDocument.defaultView!.localStorage.getItem('tflw.sidebar.width')),
      '200',
    );
    await p.reload();
    await p.locator('[data-files]').waitFor();
    assert.equal(await paneWidth(), 200, 'a remembered width a reload forgets is not remembered');

    await p.locator('[data-grip="sidebar"]').focus();
    await p.keyboard.press('Home');
    assert.equal(await paneWidth(), 320, 'and there is a way back');
  });
});

test('`M216` `B0`/`A3`: a declaration wears the same chip on all three surfaces that draw one', async () => {
  // **Three surfaces now say *this is a declaration* and a fourth spelling is how they drift
  // apart.** The sidebar outline and the Source index both drew a bare name — the one row a reader
  // scans a list for was the only row in the list with no shape, while the request rows under it
  // had carried a coloured method chip since `D1081`. This asserts the class is literally shared,
  // which is the thing a later edit breaks by restyling one of them in place.
  await withRemovalFixture(LEGIBLE, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L4`);
    await p.locator('[data-files]').waitFor();
    assert.equal(
      await p.locator('.sidebar [data-outline-decl="test"]').first().locator('.outline-row > .seq-kind').textContent(),
      'test',
      'the sidebar outline',
    );
    const band = p.locator('[data-band-line]').first().locator('.seq-kind');
    assert.equal(await band.textContent(), 'test', 'the Compose sequence');

    await p.locator('[data-tab="source"]').click();
    await p.locator('[data-test-index]').waitFor();
    assert.equal(
      await p.locator('[data-source-test="it accepts a basket and confirms one order"] .seq-kind').textContent(),
      'test',
      'the Source index',
    );
  });
});

test('`M216` `B0`/`A4`: no sequence row repeats its own chip — the chip is the keyword and the text is what follows it', async () => {
  // **The defect this replaces was in six of seven rows on the example's first test.** Every
  // statement row drew a chip derived from the node (`ExpectStmt` → `expect`) beside the
  // statement's own source line, which *begins* with that same word — so the pane read `expect
  // expect status equals 201`. It read correctly on the declaration row only because a test's text
  // is its name and a name carries no keyword, which is why the shape looked right where it was
  // designed and stuttered everywhere it was reused.
  //
  // **Written as a property over whatever rows are on screen**, not as a list of expected strings:
  // a gate naming the rows is a gate that has to be edited to admit a fourteenth statement kind,
  // and pinning the sentences is how the last three rounds froze this pane.
  await withRemovalFixture(LEGIBLE, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L4`);
    await p.locator('[data-seq-row]').first().waitFor();
    const rows = await p.locator('li[data-stmt]').evaluateAll((els) =>
      els.map((el) => ({
        kind: el.getAttribute('data-stmt'),
        chip: (el.querySelector('.seq-kind')?.textContent ?? '').trim(),
        text: (el.querySelector('.seq-text')?.textContent ?? '').trim(),
      })),
    );
    // The vacuity control: a property over an empty list is green, and this one would have been
    // green on a Compose pane that rendered nothing at all.
    // Four, not seven: the two `api` steps are REQUESTS, drawn as their own groups, and what
    // `data-stmt` marks is the statements between them.
    assert.ok(rows.length >= 4, `the test's statements are on screen (${rows.length} rows)`);
    for (const row of rows) {
      assert.ok(row.chip.length > 0, `${row.kind} carries a chip`);
      assert.ok(
        !row.text.startsWith(`${row.chip} `),
        `${row.kind}: the chip says "${row.chip}" and the text must not say it again — got "${row.text}"`,
      );
    }
    // And the positive half, because *never starts with its chip* is also satisfied by a row that
    // shows nothing: one row, read whole, is the keyword and then the rest of its own line.
    const expects = rows.filter((r) => r.kind === 'ExpectStmt');
    assert.ok(expects.length >= 3);
    assert.equal(expects[0]!.chip, 'expect');
    assert.equal(expects[0]!.text, 'status equals 201', 'the line, less the word already on the chip');
  });
});

test('`M216` `B0`/`A5`: the Compose band says which declaration this is, in the language’s own roles', async () => {
  // It was one flat grey sentence, so the single fact a reader wants off that line — *which
  // declaration am I composing* — carried the same weight as the counts beside it. Nothing was
  // rearranged: the sentence, its order and its counts are untouched, and only the subject is
  // painted. The roles are the language's own, which is why the quotes are here and not on the
  // sidebar's row: this line is prose ABOUT a declaration, so it quotes it the way the file does.
  await withRemovalFixture(LEGIBLE, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L4`);
    const what = p.locator('[data-compose-subject-what]');
    await what.waitFor();
    assert.equal(await what.locator('.t-kw').textContent(), 'test', 'the keyword is a keyword');
    assert.equal(
      await what.locator('.t-str').textContent(),
      '"it accepts a basket and confirms one order"',
      'and the name is the string the file writes',
    );
    // The colouring is two spans over the same words, never a second copy of them.
    assert.equal(await what.textContent(), 'test "it accepts a basket and confirms one order"');
  });
});

// ---------------------------------------------------------------------------
// `M216` `B1`-`B3` — the hover, presented by us.
//
// **The round's premise was wrong and measuring it is what produced this slice.** *"No hover info
// anywhere?"* — and 62 of the API door's 67 interactive controls already carried a `title`, 40 of
// them real guidance. What failed is the four things `title` does not expose: the ~1 s delay, the
// position, the OS styling, and invisibility to touch. All three of the user's screenshots are
// position, and all three are the same shape — the tooltip covering the row underneath.
//
// So nothing here reads a sentence. What is gated is where the box lands, that it lands at all on
// a keyboard, that an icon-only control did not lose its name on the way, and `D1127`'s derived
// rule asked at **two widths**, because a truncation rule is green at one width by luck.
// ---------------------------------------------------------------------------

/** The tooltip's own rect, and the rect of the control it is describing. */
const tipGeometry = async (p: Page): Promise<{ tip: { x: number; y: number; w: number; h: number }; side: string }> => {
  const el = p.locator('#tflw-tip');
  await el.waitFor();
  const r = (await el.boundingBox())!;
  return { tip: { x: r.x, y: r.y, w: r.width, h: r.height }, side: (await el.getAttribute('data-tip-shown'))! };
};

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; width: number; height: number }): boolean =>
  a.x < b.x + b.width && a.x + a.w > b.x && a.y < b.y + b.height && a.y + a.h > b.y;

test('`M216` `B3`: `title` is retired across the shell and the Compose pane — every hover is ours', async () => {
  await withRemovalFixture(LEGIBLE, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L4`);
    await p.locator('[data-seq-row]').first().waitFor();

    // **The vacuity control comes first**, because *no element carries a `title`* is also true of a
    // blank page, and it is exactly what a half-finished migration looks like.
    const asking = await p.locator('[data-tip], [data-tip-derived]').count();
    assert.ok(asking >= 30, `the page's controls still ask for a hover (${asking} of them)`);

    const left = await p.locator('[title]').evaluateAll((els) =>
      els.map((e) => `${e.tagName.toLowerCase()}[${e.className}]: ${e.getAttribute('title')}`));
    assert.deepEqual(left, [], 'and not one of them asks the platform for it');
  });
});

test('`M216` `B1`/`B2`: the hover is our element, and it covers neither the control nor the row under it (`D1125`)', async () => {
  await withRemovalFixture(LEGIBLE, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L4`);
    await p.locator('[data-seq-row]').first().waitFor();

    // A row in a list with a row directly beneath it — the shape of all three screenshots.
    await p.locator('[data-add-clause="test"] summary').click();
    const row = p.locator('[data-add-go="tags"]');
    const own = row.locator('xpath=ancestor-or-self::li[1]');
    await row.hover();
    const { tip, side } = await tipGeometry(p);

    const control = (await row.boundingBox())!;
    const next = await own.evaluate((el) => {
      const sib = el.nextElementSibling;
      if (sib === null) return null;
      const r = sib.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    });
    assert.equal(overlaps(tip, control), false, `the tooltip is clear of its own control (side ${side})`);
    if (next !== null) assert.equal(overlaps(tip, next), false, 'and clear of the row under it — the defect this round exists for');

    // On the screen, which a native `title` also manages and is worth keeping true.
    const view = p.viewportSize()!;
    assert.ok(tip.x >= 0 && tip.y >= 0 && tip.x + tip.w <= view.width && tip.y + tip.h <= view.height, 'and on the screen');
  });
});

test('`M216` `B1`: it appears on keyboard focus, and describes without renaming (`D1129`)', async () => {
  await withRemovalFixture(LEGIBLE, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L4`);
    await p.locator('[data-seq-row]').first().waitFor();

    /* `M237` `B2` — **THE INSTRUMENT THAT NAMES THE EVENT, AFTER `B` NAMED THE MECHANISM.**
       `B`'s sweep (2 red of 168) established that `hide()` ran: the tip element is GONE at the
       moment the attribute is absent, which refutes the re-render reading. It left exactly one
       question. `Tooltip.tsx` reaches `hide()` from SEVEN places — `pointerover` onto anything
       that asks for no tip, `pointerdown`, `focusin` onto the same, `focusout`, `Escape`,
       `scroll` and `resize` — and the occurrence named none of them. The row names three; the
       listener list is the authority, and it is seven.
       So this records all seven at capture phase beside the two removals that matter, and the
       LAST EVENT BEFORE `aria-describedby -> REMOVED` is the culprit rather than a candidate.
       **THE ORDERING IS WHY THIS WORKS, AND IT IS NOT LUCK.** `hide()` calls `removeAttribute`
       synchronously inside the app's own listener, which was registered first and therefore runs
       BEFORE this one — so a naive "record the attribute, then the event" would invert them. A
       `MutationObserver` callback is a microtask delivered after the whole dispatch completes, so
       the event is always recorded before the removal it caused, whichever listener ran first.
       **NOTHING HERE TOUCHES `packages/ui/src`.** `M237` §6's rule, stated before the sweep, is
       that the product moves only if the re-render mechanism is the one named — and it is not.
       This is a test-side observer: seven passive listeners and one attribute-filtered observer. */
    await p.locator('body').evaluate((el) => {
      // **No DOM lib in this package** (see `selectedText`), so every name below is structural:
      // `Element`, `EventTarget` and `MutationObserver` are not names in this file.
      type TNode = {
        id?: string;
        tagName?: string;
        getAttribute?: (name: string) => string | null;
        closest?: (sel: string) => unknown;
      };
      type TRec = {
        attributeName: string | null;
        target: TNode;
        addedNodes: ArrayLike<TNode>;
        removedNodes: ArrayLike<TNode>;
      };
      const doc = el.ownerDocument as unknown as {
        documentElement: unknown;
        defaultView: {
          performance: { now: () => number };
          scrollX: number;
          scrollY: number;
          innerWidth: number;
          innerHeight: number;
          MutationObserver: new (cb: (rs: TRec[]) => void) => { observe: (t: unknown, o: unknown) => void };
          addEventListener: (type: string, h: () => void, capture?: boolean) => void;
          __tipTrace?: string[];
        };
        addEventListener: (type: string, h: (e: { target: TNode | null }) => void, capture?: boolean) => void;
      };
      const win = doc.defaultView;
      const trace: string[] = [];
      win.__tipTrace = trace;
      // **NOT ONE NAMED FUNCTION IN THIS CALLBACK, AND THAT IS THE WHOLE OF WHY IT RUNS.**
      // The first draft factored the push into `const note = (s) => …` and a `const where = …`
      // beside it, which is what anyone would write. It threw `ReferenceError: __name is not
      // defined` on every run of this test: `tsx` is esbuild, esbuild's `keepNames` wraps any
      // function that gets an INFERRED NAME as `__name(fn, "note")` to preserve `fn.name`, and
      // that helper is defined in the Node module scope — while Playwright serialises this
      // callback's source and evaluates it in the BROWSER, where no such name exists.
      // The rule is narrower than "no functions": an arrow passed INLINE AS AN ARGUMENT has no
      // inferred name and is never wrapped, which is why every listener and the observer callback
      // below are fine exactly as written and a `const` helper is not. `tsc` cannot see any of
      // this — it is the sibling of `selectedText`'s note about types being stripped unchecked —
      // and neither can any test that does not run the line. A control run caught it.
      // The `trace.length` guard is repeated rather than factored for the same reason: a page
      // that scrolls under a pointer emits these by the hundred and only the tail is ever read.
      for (const type of ['pointerover', 'pointerdown', 'focusin', 'focusout', 'keydown']) {
        doc.addEventListener(type, (e) => {
          const t = e.target;
          const at = t === null
            ? 'nothing'
            : t.closest !== undefined && t.closest('[data-seq-remove]') !== null
              ? 'THE CONTROL'
              : t.tagName ?? 'non-element';
          if (trace.length < 400) trace.push(`${Math.round(win.performance.now())}ms ${type} on ${at}`);
        }, true);
      }
      win.addEventListener('scroll', () => {
        if (trace.length < 400) trace.push(`${Math.round(win.performance.now())}ms scroll to ${win.scrollX},${win.scrollY}`);
      }, true);
      win.addEventListener('resize', () => {
        if (trace.length < 400) trace.push(`${Math.round(win.performance.now())}ms resize to ${win.innerWidth}x${win.innerHeight}`);
      });
      new win.MutationObserver((records) => {
        for (const r of records) {
          if (r.attributeName === 'aria-describedby' && trace.length < 400) {
            trace.push(`${Math.round(win.performance.now())}ms aria-describedby -> ${r.target.getAttribute?.('aria-describedby') ?? 'REMOVED'}`);
          }
          for (const n of Array.from(r.removedNodes)) {
            if (n.id === 'tflw-tip' && trace.length < 400) trace.push(`${Math.round(win.performance.now())}ms #tflw-tip REMOVED`);
          }
          for (const n of Array.from(r.addedNodes)) {
            if (n.id === 'tflw-tip' && trace.length < 400) trace.push(`${Math.round(win.performance.now())}ms #tflw-tip added`);
          }
        }
      }).observe(doc.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['aria-describedby'],
      });
    });

    // **A tooltip a keyboard cannot reach is a tooltip some readers do not have**, and `title` had
    // exactly that property.
    const x = p.locator('[data-seq-remove]').first();
    await x.focus();
    await p.locator('#tflw-tip').waitFor();
    /* `M235` `E` — **THE SWEEP FOUND THIS ONE AND THE CLASSIFIER'S ORDERING DID NOT** (1 of 56 runs,
       `null !== 'tflw-tip'`, 121 ms). The wait above is on the TIP; the read below is on the
       CONTROL. One effect mounts the tip and points the control at it, and waiting for the first
       half of that effect says nothing about the second — so the read lands on an element that is
       attached, focused, and not yet described. `getAttribute` auto-waits for the element and not
       for the attribute, which is the whole distinction.
       `C1` flagged this read correctly as `NEVER-WAITED`; it banded it `LOW`, and `C2` converted
       the HIGH read in this same test and left this one. The band is where to start, not where the
       risk ends — see §`E`. */
    /* `M235` `E`, SECOND SWEEP — **the conversion did its job and the failure changed meaning.**
       It failed again, 1 of 56, and now as `(40 look(s)) null !== 'tflw-tip'`: the retry spent its
       whole 2s budget and the attribute was still not there. Under `M141` that is no longer *read
       too early*, it is *measured absent* — a claim about the page, which is what a settle is for.
       Two mechanisms fit, and `Tooltip.tsx` allows both. `#tflw-tip` renders only while `shown` is
       set, and `go()` sets `aria-describedby` and `setShown` together, so the attribute is present
       the instant the tip is. Either (a) something called `hide()` after the `waitFor` above —
       `focusout`, `pointerover` off the control, `scroll` are all bound — which removes the
       attribute and unmounts the tip, or (b) the control re-rendered: the attribute is written with
       `el.setAttribute` on a DOM node, outside React, so a re-render drops it while `anchor.current`
       keeps pointing at the detached node and the tip stays up. The two disagree about exactly one
       observable, so the read takes it and the message names it. Nothing is repaired on a mechanism
       nobody has reproduced; the next occurrence will say which one it is. */
    const described = await settle(
      async () => ({
        points: await x.getAttribute('aria-describedby'),
        tip: await p.locator('#tflw-tip').count(),
      }),
      untilMeasurable('the control has been given something to be described by', (v) => v.points !== null),
      { attempts: 40, delayMs: 50, page: p },
    );
    // `M237` `B2` — read whatever the recorder above collected, always, so the message carries the
    // page's own account of the failure rather than a second guess at it. Fourteen entries is the
    // tail that matters: the settle spends 40 looks and the culprit is adjacent to the removal.
    const trace = await p.locator('body').evaluate((el) =>
      ((el.ownerDocument as unknown as { defaultView: { __tipTrace?: string[] } }).defaultView.__tipTrace ?? [])
        .slice(-14),
    );
    assert.equal(
      described.value.points,
      'tflw-tip',
      `the control points at what describes it (${described.attempts} look(s); the tip element is `
      + `${described.value.tip > 0 ? 'STILL ON SCREEN -> the control re-rendered out from under an imperative setAttribute' : 'GONE -> the layer was hidden after the wait'})`
      + `\n      what the page did, last 14: ${trace.length === 0 ? '(nothing recorded)' : trace.join(' | ')}`,
    );
    assert.equal(await p.locator('#tflw-tip').getAttribute('role'), 'tooltip');

    // **And the name survived the migration.** On an icon-only control `title` was doing two jobs;
    // moving it to `data-tip` without this leaves the button announced as "button" and nothing
    // else — a regression nothing on the page shows.
    // **"Icon-only" is *carries no letter or digit*, and the first draft of this rule got it
    // wrong in a useful way**: a length cutoff called the `as` clause button an icon, and `as` is
    // the language's own keyword rendered as a two-character word. A glyph is a glyph because it
    // is unreadable, not because it is short.
    /* `M235` `C2` — the claim below is an EMPTINESS, and an emptiness over a set that has not
       painted is a pass for the wrong reason. So the population is established first, as a
       measurability wait, and only then is the filtered subset read. Retrying the filter itself
       would be the other mistake: it would spend the budget hiding a real violation. */
    const tipped = await settle(
      () => p.locator('[data-tip], [data-tip-derived]').count(),
      untilMeasurable('the controls that carry a tip have painted', (n) => n > 0),
      { attempts: 40, delayMs: 50, page: p },
    );
    assert.ok(tipped.value > 0, `there are tip-bearing controls to judge (${tipped.attempts} look(s))`);
    // one-shot: read over the population the wait above established; a retry would only delay a
    // real violation until the budget ran out
    const nameless = await p.locator('[data-tip], [data-tip-derived]').evaluateAll((els) =>
      els.filter((e) => ['BUTTON', 'A'].includes(e.tagName))
        .filter((e) => !/[\p{L}\p{N}]/u.test((e.textContent ?? '').trim()))
        .filter((e) => ((e.getAttribute('aria-label') ?? '').trim() === ''))
        .map((e) => e.outerHTML.slice(0, 160)));
    assert.deepEqual(nameless, [], `every icon-only control still carries its own accessible name (of ${tipped.value})`);

    await p.keyboard.press('Escape');
    await p.locator('#tflw-tip').waitFor({ state: 'detached' });
    /* The same pair in reverse, and the same gap: the tip leaving does not mean the control has
       been un-pointed. `untilEqual` rather than `untilMeasurable` because here `null` IS the wanted
       reading, so there is no unreadable state to wait out — this is retrying on the assertion, and
       it stays honest only because the budget is bounded (`settle.ts`). */
    const dropped = await settle(
      () => x.getAttribute('aria-describedby'),
      untilEqual<string | null>(null),
      { attempts: 40, delayMs: 50, page: p },
    );
    assert.equal(dropped.value, null, `and the pointer is dropped when it goes (${dropped.attempts} look(s))`);
  });
});

test('`M216` `B3`: a row’s hover is derived from whether it is truncated, asked at two widths (`D1127`)', async () => {
  await withRemovalFixture(LEGIBLE, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L4`);
    await p.locator('[data-files]').waitFor();
    const label = p.locator('.sidebar [data-outline-decl="test"]').first().locator('.outline-row').first();
    const grip = p.locator('[data-grip="sidebar"]');
    const setWidth = async (to: number): Promise<void> => {
      const box = (await grip.boundingBox())!;
      await p.mouse.move(box.x + box.width / 2, box.y + 100);
      await p.mouse.down();
      await p.mouse.move(to, box.y + 100, { steps: 6 });
      await p.mouse.up();
    };

    // **Wide: the row says it all, so the tooltip says nothing.** Fifteen of the 67 titles were a
    // row's own visible text said back to it, and this is what replaces them — not a shorter
    // sentence, no sentence.
    await setWidth(1430);
    await p.mouse.move(4, 4);
    await label.hover();
    await p.waitForTimeout(600);
    assert.equal(await p.locator('#tflw-tip').count(), 0, 'nothing is hidden, so nothing is offered');

    // **Narrow: the same row, the same zero authored strings, and now there is something to say.**
    await p.mouse.move(4, 4);
    await setWidth(4);
    await label.hover();
    assert.equal(
      await p.locator('#tflw-tip').textContent(),
      'it accepts a basket and confirms one order',
      'the part the ellipsis took, and only the part the ellipsis took',
    );
  });
});

test('`M216` `B1`: the hover is painted from the theme, in all four (`D1124`)', async () => {
  await withRemovalFixture(LEGIBLE, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L4`);
    await p.locator('[data-seq-row]').first().waitFor();
    await p.locator('[data-add-clause="test"] summary').click();
    const seen = new Set<string>();
    for (const theme of ['terminal', 'instrument', 'paper', 'blueprint']) {
      // Through an element's OWN document, because this package is typechecked with `types:
      // ["node"]` and no DOM lib — `document` is not a name here even though it exists in the
      // browser the callback is serialised into. `tsx` strips types without checking them, so the
      // first draft of both of these passed every gate and failed `tsc`: the file's own `S1`
      // finding, arriving a third time.
      await p.locator('body').evaluate((el, t) => { el.ownerDocument.documentElement.setAttribute('data-tflw-theme', t); }, theme);
      await p.mouse.move(4, 4);
      await p.locator('[data-add-go="tags"]').hover();
      await p.locator('#tflw-tip').waitFor();
      // **Compared against a probe painted from the same token**, rather than against a literal:
      // a gate holding four hex values is a gate that has to be edited to repaint a theme, and
      // `D1096` makes a theme a token set precisely so nothing downstream holds its values.
      const [got, want] = await p.locator('#tflw-tip').evaluate((el) => {
        const doc = el.ownerDocument;
        const probe = doc.createElement('div');
        probe.style.background = 'var(--panel2)';
        doc.body.appendChild(probe);
        const wanted = doc.defaultView!.getComputedStyle(probe).backgroundColor;
        probe.remove();
        return [doc.defaultView!.getComputedStyle(el).backgroundColor, wanted];
      });
      assert.equal(got, want, `${theme}: the tooltip is the theme's own surface`);
      seen.add(got);
      await p.mouse.move(4, 4);
    }
    // The vacuity control: four themes that all resolve to one colour would pass every equality
    // above while proving the tooltip is painted with a constant.
    assert.ok(seen.size >= 2, `the four themes are not one theme (${[...seen].join(', ')})`);
  });
});

test('`M216` `C`: `send` and `run` each say what they do, and they do not say the same thing (`D1130`)', async () => {
  // **One gate for slice `C`, and deliberately not five.** `§5` leaves *which controls have a
  // hover, and how many* free on purpose — a gate holding a list of five is a gate that has to be
  // edited to add a sixth, and pinning the sentences is how the last three Compose rounds froze
  // this pane. What is not free is `D1130`: `send` and `run` sit inches apart, do different things,
  // and the confusion between them **has a milestone named after it** — `M215` exists because
  // pressing `send` was read as running the test and grading it. So the claim is the narrow one:
  // both speak, and they are not saying the same sentence. Neither sentence is pinned.
  await withRemovalFixture(LEGIBLE, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L4`);
    await p.locator('[data-compose-send]').first().waitFor();
    const send = await p.locator('[data-compose-send]').first().getAttribute('data-tip');
    const run = await p.locator('[data-run]').getAttribute('data-tip');
    assert.ok((send ?? '').trim().length > 20, `send says what it does (${send})`);
    assert.ok((run ?? '').trim().length > 20, `run says what it does (${run})`);
    assert.notEqual(send, run, 'and the two controls the round exists to tell apart are told apart');
  });
});

// ---------------------------------------------------------------------------
// `M216` `D` — thirteen clauses could be added and none could be removed.
//
// **The hole was total and it was exactly one level above where the page was fine.** Rows —
// declarations, requests, statements — have carried a `✕` with a refusal since `D1117`. Clauses
// had nothing: 13 addable, 0 removable, and four of them in the worst state of the three, letting
// you delete their contents one at a time and never the clause, so `headers` could be emptied to
// nothing and still be there.
//
// **The first gate is a round trip over whatever the vocabulary holds, not a list of thirteen
// names.** A gate naming the clauses is a gate that has to be edited to admit a fourteenth, and
// `M214`'s `the-add-menu-hides-what-it-cannot-add` is this repository's own measured precedent for
// a completeness gate freezing a pane. So: *every option the menu offers is either removable or
// refuses with a reason*, asked of the menu itself.
// ---------------------------------------------------------------------------

/** A file whose test carries every band clause the menu can name, and whose request carries the
 *  request ones — so the round trip is asked about clauses that are WRITTEN, not only drawn. */
const FULL = [
  '@crud @slow',
  // `retry` is written ON the test line — `packages/ui/fixtures/project/tests/orders.tflw:13` is
  // the shape. The first draft of this fixture put it on its own line and did not parse, and four
  // gates then timed out waiting for a dirty marker a broken file can never produce.
  'test "it carries every clause the band can draw" retry 2',
  '  api POST /orders body { itemId: 1 } timeout 9s without redirects as "place"',
  '    header "Authorization" is "Bearer t"',
  '  expect status equals 201',
  '',
].join('\n');

test('`M216` `D1`: every clause the menu offers can be removed, or refuses with a reason (`D1131`)', async () => {
  await withRemovalFixture(FULL, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L2`);
    await p.locator('[data-add-clause="test"]').waitFor();
    await p.locator('[data-add-clause="test"] summary').click();

    // **The round trip, over the menu's own list.** Nothing here knows how many clauses there are
    // or what they are called; it reads the vocabulary off the page and asks the same question of
    // each member, so a fourteenth clause is covered the day someone adds it.
    const options = await p.locator('[data-add-clause="test"] [data-add-option]').evaluateAll((els) =>
      els.map((e) => ({ key: e.getAttribute('data-add-option')!, state: e.getAttribute('data-add-state')! })));
    assert.ok(options.length >= 6, `the band's vocabulary is on the page (${options.length} clauses)`);

    for (const o of options) {
      const row = p.locator(`[data-add-clause="test"] [data-add-option="${o.key}"]`);
      if (o.state === 'present') {
        assert.equal(await row.locator('[data-add-remove]').count(), 1, `${o.key}: a present clause offers its removal`);
      } else {
        // An absent clause has nothing to remove, so the round trip is asked the other way: add it,
        // and the removal has to appear. This is what makes the property a ROUND TRIP rather than
        // an inventory of the file's current state.
        await row.locator(`[data-add-go="${o.key}"]`).click();
        await p.locator(`[data-add-clause="test"] [data-add-option="${o.key}"][data-add-state="present"]`).waitFor();
        assert.equal(await row.locator('[data-add-remove]').count(), 1, `${o.key}: added, and now removable`);
      }
    }
  });
});

test('`M216` `D1`: removing a clause unwrites it, and the bytes say so', async () => {
  await withRemovalFixture(FULL, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L2`);
    await p.locator('[data-add-clause="test"] summary').click();

    // `tags` is written in the file (`@crud @slow` above the test) and has no per-part control, so
    // the menu is the only place its removal could live.
    assert.equal(await p.locator('[data-add-option="tags"]').getAttribute('data-add-state'), 'present');
    await p.locator('[data-add-option="tags"] [data-add-remove]').click();
    await p.locator('[data-compose-dirty]').waitFor();

    await p.locator('[data-tab="source"]').click();
    await p.locator('[data-source="pending"]').waitFor();
    const text = (await p.locator('[data-preview]').textContent())!;
    assert.doesNotMatch(text, /@crud/, 'the tag line is gone from the pending bytes');
    assert.match(text, /^test "it carries every clause the band can draw" retry 2$/m, 'and the test it was on is not, nor the clause beside it');
    assert.match(text, /^ {2}api POST \/orders /m, 'nor anything under it');
  });
});

test('`M216` `D2`: the last part takes its clause with it, and the lock that made that impossible is gone (`D1132`)', async () => {
  // **This gate exists because the rule chosen in the grilling deadlocked.** *Refuse while it has
  // content, empty it first* — and `TableEditor` disabled its row remove at `rows.length === 1`,
  // so `with each` could never reach empty and could therefore never be removed at all.
  await withRemovalFixture(FULL, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L2`);
    await p.locator('[data-add-clause="test"] summary').click();
    await p.locator('[data-add-go="table"]').click();
    await p.locator('[data-band-table-kind]').selectOption('inline');
    await p.locator('[data-table-row-add]').click();
    const rows = p.locator('[data-table-row-remove]');
    assert.ok(await rows.count() >= 1);

    // While it has rows, the menu refuses and says why — and the clause is still there afterwards,
    // which is the half a refusal that silently succeeded would also satisfy.
    await p.locator('[data-add-option="table"] [data-add-remove]').click();
    const why = await p.locator('[data-add-refusal="table"]').textContent();
    assert.match(why ?? '', /empty it first/, `the refusal says what to do (${why})`);
    assert.equal(await p.locator('[data-add-option="table"]').getAttribute('data-add-state'), 'present', 'and refused means refused');

    // **The last row is pressable**, which it was not before this round.
    const last = p.locator('[data-table-row-remove]').last();
    assert.equal(await last.isDisabled(), false, 'the last row is not locked');
    while (await p.locator('[data-table-row-remove]').count() > 0) {
      await p.locator('[data-table-row-remove]').last().click();
    }
    await p.locator('[data-add-clause="test"] [data-add-option="table"][data-add-state="addable"]').waitFor();
  });
});

test('`M216` `D3`: `TF033` refuses by name, in both places the removal can be attempted (`D1133`)', async () => {
  // A workload-bearing test must carry a threshold. **The rule is asked in the menu AND on the
  // threshold row**, because `M214`'s own finding — a rule enforced where a thing is constructed is
  // not enforced where it is patched — is exactly this shape one level up.
  // The shape is `examples/storefront/tests/load.tflw`'s: a `ramp` line is what makes a test
  // workload-bearing, and ONE threshold, because the gate's premise is *this is the last one*.
  const workloadFile = [
    'test "it is graded under load"',
    '  ramp to 4 users over 2s',
    '  threshold error rate is less than 1%',
    '  api GET /items',
    '  expect status equals 200',
    '',
  ].join('\n');
  await withRemovalFixture(workloadFile, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L1`);
    await p.locator('[data-add-clause="test"] summary').click();

    await p.locator('[data-add-option="thresholds"] [data-add-remove]').click();
    const menu = await p.locator('[data-add-refusal="thresholds"]').textContent();
    assert.match(menu ?? '', /TF033/, `the menu names the rule that refused (${menu})`);

    // And the other door into the same forbidden state: removing the last threshold from the row.
    await p.locator('[data-threshold-remove="0"]').click();
    const row = await p.locator('[data-threshold-refusal]').textContent();
    assert.match(row ?? '', /TF033/, `the row names it too (${row})`);
    assert.equal(await p.locator('[data-threshold="0"]').count(), 1, 'and the threshold is still there');
  });
});

test('`M216` `D4`: the request scope removes the same way, and an added-but-unwritten clause just stops being drawn', async () => {
  await withRemovalFixture(FULL, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L2`);
    await openFirstRequest(p, base, 'x.tflw');
    await editorTab(p, 'more');
    await p.locator('[data-add-clause="request"] summary').click();

    // **Written, so removing it is an edit to the bytes.** `timeout 9s` is on the request above.
    assert.equal(await p.locator('[data-add-clause="request"] [data-add-option="timeout"]').getAttribute('data-add-state'), 'present');
    await p.locator('[data-add-clause="request"] [data-add-option="timeout"] [data-add-remove]').click();
    await p.locator('[data-compose-dirty]').waitFor();
    await p.locator('[data-tab="source"]').click();
    await p.locator('[data-source="pending"]').waitFor();
    assert.doesNotMatch((await p.locator('[data-preview]').textContent())!, /timeout 9s/, 'the clause is unwritten');

    // **Drawn but never written, so removing it is forgetting a row.** The reader cannot tell the
    // two cases apart, and the point of the gate is that they do not have to.
    await p.locator('[data-tab="compose"]').click();
    await editorTab(p, 'more');
    await p.locator('[data-add-clause="request"] summary').click();
    await p.locator('[data-add-clause="request"] [data-add-go="service"]').click();
    await p.locator('[data-add-clause="request"] [data-add-option="service"][data-add-state="present"]').waitFor();
    await p.locator('[data-add-clause="request"] [data-add-option="service"] [data-add-remove]').click();
    await p.locator('[data-add-clause="request"] [data-add-option="service"][data-add-state="addable"]').waitFor();
    assert.equal(await p.locator('[data-field="service"]').count(), 0, 'and the field it drew is gone with it');
  });
});

// ---------------------------------------------------------------------------
// `M216` `E` — the chrome, and the second split.
//
// `§1.2`'s measurement is the whole of this slice: the add menu's label was at **12.43:1** and its
// **border at 1.16:1**, on a fill the same colour as the page. *"Hardly visible"* was right and
// the obvious repair would have brightened the one number that already passed.
// ---------------------------------------------------------------------------

/**
 * A computed colour as three 0-1 channels, in **either** spelling a browser reports.
 *
 * A plain declaration comes back `rgb(86, 212, 221)`; **a `color-mix()` comes back
 * `color(srgb 0.184549 0.362902 0.387843)`**, already normalised — which is what `M223` `F`'s
 * session rail is, and is why this is one parser and not a second one written beside the first.
 */
const channels = (css: string): [number, number, number] => {
  const mixed = /color\(srgb([^)]+)\)/.exec(css);
  const n = mixed !== null
    ? mixed[1]!.trim().split(/[\s/]+/).slice(0, 3).map(Number)
    : (/rgba?\(([^)]+)\)/.exec(css)![1]!).split(',').slice(0, 3).map((x) => Number(x.trim()) / 255);
  return [n[0]!, n[1]!, n[2]!];
};

/**
 * How far a colour is from grey — the widest channel minus the narrowest (`M223` `F`, `D1200`).
 *
 * Deliberately not a colour-science chroma and it does not need to be: the claim is *this mark is
 * not the accent hue*, and max-minus-min separates the two by 7x here — `--accent` measures 0.530,
 * `--muted` 0.075, and the rail this replaced 0.203.
 */
const chroma = (css: string): number => {
  const [r, g, b] = channels(css);
  return Math.max(r, g, b) - Math.min(r, g, b);
};

/**
 * The alpha of either spelling — `color(srgb … / a)` or `rgba(r, g, b, a)`, 1 when none is given.
 *
 * `channels` above deliberately drops it, because `F`'s question was about hue. `G`'s is about a
 * ground that COMPOSITES, so the alpha is the whole subject and the two spellings disagree about
 * where it lives: the `color()` form separates it with a solidus and the `rgba()` form with the
 * same comma as the channels, so the second parser cannot be the first one with a wider slice.
 */
const alphaOf = (css: string): number => {
  const mixed = /color\(srgb([^)]+)\)/.exec(css);
  if (mixed !== null) {
    const parts = mixed[1]!.trim().split(/[\s/]+/);
    return parts.length > 3 ? Number(parts[3]) : 1;
  }
  const plain = /rgba?\(([^)]+)\)/.exec(css);
  if (plain === null) return 1;
  const parts = plain[1]!.split(',').map((x) => Number(x.trim()));
  return parts.length > 3 ? parts[3]! : 1;
};

/**
 * `top` composited over `bottom` — what the compositor paints, and therefore what the reader gets.
 *
 * Gamma-encoded on purpose: this is not a colour-mixing model, it is a restatement of what Chromium
 * does with a translucent background over an opaque one, which is a straight per-channel lerp of
 * the values `getComputedStyle` already hands back.
 */
const over = (top: string, bottom: string): string => {
  const a = alphaOf(top);
  const [tr, tg, tb] = channels(top);
  const [br, bg, bb] = channels(bottom);
  const lerp = (t: number, b: number): number => t * a + b * (1 - a);
  return `color(srgb ${lerp(tr, br)} ${lerp(tg, bg)} ${lerp(tb, bb)})`;
};

/** WCAG relative luminance and the contrast ratio, over either spelling. */
const contrast = (a: string, b: string): number => {
  const lum = (css: string): number => {
    const [r, g, bl] = channels(css);
    const c = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(bl);
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

/**
 * **GATE 16 — nothing in the workload editor is painted the disabled colour** — `M224` `G`.
 *
 * `M223` `G`'s finding, applied to the controls this round moved rather than repeated about the
 * ones it left alone: **a token that names a STATE gets spent as a TONE, and then the state stops
 * being sayable.** `--muted` is `:disabled` in this stylesheet — `button:disabled`,
 * `input:disabled`, `select:disabled`, `textarea:disabled` — and `LoadForm` used it for the
 * editor's own field words, which measured **4.34:1** and is why the user's *"the steps appear as
 * if they are disabled"* was a true statement about the source rather than a perception to argue
 * with.
 *
 * The field words take `.seq-kind`'s ink instead — `color-mix(in srgb, var(--fg) 70%, var(--muted))`
 * — which is one declaration for what is now a **fourth** surface, and the reading is a
 * **relationship** rather than a literal: the editor's words are the same ink as a step's keyword,
 * which is what says *this is a label of your test* and not *this is switched off*. A gate that
 * pinned a hex would freeze one theme of four.
 *
 * `--muted` is resolved off a probe rather than written down, so the floor is compared against the
 * live token in whichever theme is showing.
 */
test('`M224` `G`: no text in the workload editor reads below the AA floor, and its labels are a step keyword\'s ink', async () => {
  const lines = await declLines('tests/load.tflw');
  await declAt('load', 'tests/load.tflw', lines[0]!);
  await page.locator('[data-band-workload-edit]').waitFor();

  const seen = await page.locator('[data-band-workload-edit]').evaluate((editor) => {
    const view = editor.ownerDocument.defaultView!;
    const probe = editor.ownerDocument.createElement('button');
    probe.disabled = true;
    editor.append(probe);
    const muted = view.getComputedStyle(probe).color;
    probe.remove();
    /* The ground is the **panel** the band sits on and not the editor's own box, which is
       transparent — `M223` `A` recorded the twin of this: a rectangle inside an `overflow: auto`
       region runs past its container, so the thing to read is the surface that actually paints. */
    /* `Element` is not a name in this package (`types: ["node"]`, no DOM lib) — `M223` `G` paid
       for this twice, once on `CSSStyleDeclaration` and once on `Element` itself. The type comes
       from the one thing here that has one: `getComputedStyle`'s own parameter. */
    type El = Parameters<typeof view.getComputedStyle>[0];
    let painted: El = editor;
    for (let el: El | null = editor; el !== null; el = el.parentElement) {
      const bg = view.getComputedStyle(el).backgroundColor;
      if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') { painted = el; break; }
    }
    const ground = view.getComputedStyle(painted).backgroundColor;
    const inks: { where: string; color: string }[] = [];
    for (const el of editor.querySelectorAll('.seq-kind, .profile, .unit, .cell, button')) {
      if ((el.textContent ?? '').trim() === '') continue;
      inks.push({ where: `${el.className || el.tagName}:${(el.textContent ?? '').trim().slice(0, 12)}`, color: view.getComputedStyle(el).color });
    }
    const label = editor.querySelector('.seq-kind');
    return { muted, ground, inks, label: label === null ? null : view.getComputedStyle(label).color };
  });

  assert.ok(seen.inks.length >= 8, `the gate is reading ${seen.inks.length} pieces of text in the editor — it is not looking at a rendered grid`);
  const under = seen.inks
    .map((i) => ({ ...i, ratio: contrast(i.color, seen.ground) }))
    .filter((i) => i.ratio < 4.5);
  assert.deepEqual(under.map((i) => `${i.where} ${i.ratio.toFixed(2)}:1`), [], `text in the workload editor is under the AA floor — \`button:disabled\` is ${seen.muted} on this ground`);

  /* And the relationship, which is the part that says *label* rather than merely *legible*: the
     editor's field words are the ink a step's keyword uses. The mutation that clears the floor
     above and still fails here is `var(--fg)` — legible, and no longer a label. */
  const kw = await page.locator('.seq-col .seq-kind').first().evaluate((el) => el.ownerDocument.defaultView!.getComputedStyle(el).color);
  assert.equal(seen.label, kw, 'the workload editor draws its field words in an ink of their own — `M223` `G` made that one declaration for every surface that says *label*');
  assert.notEqual(seen.label, seen.muted, 'the editor is painted the `:disabled` token, which is the defect this gate is named for');
});

test('`M216` `E`: the add menu’s options are drawn as controls, in all four themes (`D1134`)', async () => {
  await withRemovalFixture(FULL, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L2`);
    await p.locator('[data-add-clause="test"] summary').click();
    for (const theme of ['terminal', 'instrument', 'paper', 'blueprint']) {
      // Through an element's OWN document, because this package is typechecked with `types:
      // ["node"]` and no DOM lib — `document` is not a name here even though it exists in the
      // browser the callback is serialised into. `tsx` strips types without checking them, so the
      // first draft of both of these passed every gate and failed `tsc`: the file's own `S1`
      // finding, arriving a third time.
      await p.locator('body').evaluate((el, t) => { el.ownerDocument.documentElement.setAttribute('data-tflw-theme', t); }, theme);
      const read = await p.locator('[data-add-clause="test"] [data-add-option]').evaluateAll((els) =>
        els.map((li) => {
          const view = li.ownerDocument.defaultView!;
          const go = li.querySelector('[data-add-go]')!;
          const s = view.getComputedStyle(go);
          return {
            key: li.getAttribute('data-add-option'),
            state: li.getAttribute('data-add-state'),
            border: s.borderTopColor,
            fill: s.backgroundColor,
            label: s.color,
            behind: view.getComputedStyle(li.parentElement!).backgroundColor,
          };
        }));
      assert.ok(read.length >= 6, 'the vacuity control: a menu with no options passes every floor below');
      for (const o of read) {
        // **Every label, not only the enabled ones.** The disabled-label figure was 4.18:1, and it
        // moved by removing its subject: a present clause is not *unavailable*, it is something
        // this test says, so it reads at full strength and only the ADD is disabled.
        const against = o.state === 'addable' ? o.fill : o.behind;
        assert.ok(contrast(o.label, against) >= 4.5,
          `${theme}/${o.key}: the label reads (${contrast(o.label, against).toFixed(2)}:1)`);
        if (o.state === 'addable') {
          assert.ok(contrast(o.border, o.fill) >= 3,
            `${theme}/${o.key}: there is a button around it (${contrast(o.border, o.fill).toFixed(2)}:1, was 1.16:1)`);
        }
      }
    }
  });
});

test('`M216` `E`: the Compose columns are the reader’s too, by the same grip (`D1135`)', async () => {
  await withRemovalFixture(FULL, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L2`);
    await p.locator('[data-grip="compose"]').waitFor();
    const grip = p.locator('[data-grip="compose"]');
    const seqWidth = (): Promise<number> => p.locator('.seq-col').evaluate((el) => Math.round(el.getBoundingClientRect().width));

    // **One mechanism, so the same claims hold without being reimplemented**: a separator role, a
    // keyboard, a clamp at both ends, and a memory that survives a reload.
    assert.equal(await grip.getAttribute('role'), 'separator');
    /* `M239-11` — the default is no longer the grid's old 300 px ceiling: with nothing remembered
       the column opens as wide as the file needs, inside the grip's own range. The claim here is
       the grip's, and it holds from wherever the column opened. */
    const opened = await seqWidth();
    assert.ok(opened >= 220 && opened <= 620, `the column opened at ${opened}px, outside the grip's range`);
    await grip.focus();
    await p.keyboard.press('ArrowRight');
    assert.equal(await seqWidth(), Math.min(620, opened + 16));

    const box = (await grip.boundingBox())!;
    await p.mouse.move(box.x + box.width / 2, box.y + 60);
    await p.mouse.down();
    await p.mouse.move(1430, box.y + 60, { steps: 6 });
    await p.mouse.up();
    assert.equal(await seqWidth(), 620, 'clamped at the ceiling');
    await p.mouse.move((await grip.boundingBox())!.x + 3, box.y + 60);
    await p.mouse.down();
    await p.mouse.move(4, box.y + 60, { steps: 6 });
    await p.mouse.up();
    assert.equal(await seqWidth(), 220, 'and at the floor');

    assert.equal(
      await grip.evaluate((el) => el.ownerDocument.defaultView!.localStorage.getItem('tflw.compose.width')),
      '220',
      'remembered under its own key — the two grips do not share a width',
    );
    await p.reload();
    await p.locator('[data-grip="compose"]').waitFor();
    assert.equal(await seqWidth(), 220);
    // And the project pane is untouched by any of it, which is what *its own key* buys.
    assert.equal(await p.locator('.sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().width)), 320);
  });
});

// ---------------------------------------------------------------------------
// `M217` — the create gestures.
//
// Three asks, each from a screenshot: a `+` beside a file in the explorer, a `+` beside a test,
// and a dialog for `+ request` because *"upon its click it just add empty GET at the end which is
// a bit confusing"*. Measuring the page before scoping changed two of the three.
//
// **`+ request` was not only missing a dialog — it pointed at nothing.** Pressed on the test at
// `L41` of the example it spliced a request in and then moved *nothing*: the hash stayed put,
// `data-seq-open` stayed null, the editor went on showing the declaration, focus stayed on the
// button. The new request was the fourteenth row of a list, below nine `expect`s. `+ let` was
// worse, because what it writes is a placeholder asking to be typed over.
//
// **And "after" turned out to be the load-bearing word.** `body` means *the last response*, so a
// request spliced on the literal next line re-points every assertion under it until the next
// request. Parsed over `examples/storefront`: **19 requests, 19 with statements attached, 47 of
// those 49 statements read the response.** There is no request in that project where the next line
// is a safe place to put another one — so `D1138` reads "after" as *after the request and its
// attachments*, and the hazard stops existing rather than being detected.
//
// The gates below are round trips over what the fixture holds, never lists of names: `M214`'s
// mutation `the-add-menu-hides-what-it-cannot-add` is this repository's own measured precedent for
// a completeness gate freezing a pane, and this round adds controls to two lists that will grow.
// ---------------------------------------------------------------------------

/**
 * **Every statement that reads a response, paired with the request whose response it reads.**
 *
 * This is the only thing an insertion can silently break, and it is the whole of `D1138`. A pair
 * is `(what the statement says, what the request it reads says)` taken from the source itself via
 * each node's own span, so it survives every line moving under `format` — which a splice
 * guarantees they will.
 *
 * Returned as a flat list rather than a map because **duplicates are the interesting case**: the
 * example's third test carries `expect status equals 201` twice, under two different requests, and
 * a map would silently keep one of them. Multiset containment is what the gate then asserts.
 */
function responseReaders(text: string): string[] {
  const { program } = parseSource(text);
  const slice = (span: { start: { offset: number }; end: { offset: number } }): string =>
    text.slice(span.start.offset, span.end.offset).replace(/\s+/g, ' ').trim();
  const pairs: string[] = [];
  for (const t of program.tests) {
    let reading = '(nothing has run yet)';
    for (const s of t.body) {
      if (s.type === 'ApiStep' || s.type === 'WaitUntilApiStmt') {
        reading = slice(s.span);
        continue;
      }
      // `checker.ts`'s own `stepReadsResponse` set: an assertion on a response subject, every
      // capture, and `csrf from`. Spelled out rather than imported because the export is internal
      // to the checker, and a gate that drifts from it is a gate that stops asking the question.
      // (`check` is not in it: the language spells a soft assertion `expect … softly`, so it is an
      // `ExpectStmt` — `tsc` said so, which is the third time this file has been corrected by the
      // type of a node rather than by a test.)
      if (s.type === 'ExpectStmt' || s.type === 'CaptureStmt' || s.type === 'CsrfStmt') {
        pairs.push(`${t.name} ▸ ${slice(s.span)} ▸ reads ▸ ${reading}`);
      }
    }
  }
  return pairs;
}

/** Is every pair in `before` still present in `after`, counting duplicates? The one-directional
 *  question is deliberate: an insertion is *allowed* to add pairs and never to change one. */
function keepsEveryReader(before: readonly string[], after: readonly string[]): string | null {
  const left = [...after];
  for (const pair of before) {
    const i = left.indexOf(pair);
    if (i < 0) return pair;
    left.splice(i, 1);
  }
  return null;
}

/**
 * **Open an address with nothing pending.**
 *
 * `page.goto` to a URL differing only in its hash does not reload, and since `D1142` a draft lives
 * in memory for the life of the page — so a gate that presses a gesture, navigates "back" and
 * presses another was measuring the two of them together. Both `B1` and `B3` failed on exactly
 * that, which is this round's own feature breaking this round's own gates: before `M217` the
 * buffer was cleared by opening any file, so the leak could not happen and nothing had to say so.
 */
const openClean = async (p: Page, url: string): Promise<void> => {
  await p.goto(url);
  await p.reload();
};

/** A project of several files, served — the sidebar gates need more than one. */
const withProjectFixture = async (
  files: Readonly<Record<string, string>>,
  run: (page: Page, base: string, dir: string) => Promise<void>,
): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m217-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    for (const [name, body] of Object.entries(files)) {
      // Nested paths are supported because the indentation a folder costs is part of what the
      // sidebar gates measure — a root-level file gets the whole pane and a real project's do not.
      if (name.includes('/')) await mkdir(dirname(join(dir, name)), { recursive: true });
      await writeFile(join(dir, name), body);
    }
    const port = await ui.listen(0);
    await run(fresh, `http://127.0.0.1:${port}`, dir);
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
};

/**
 * A test shaped like the ones the hazard was measured on: **every request carries statements that
 * read it**, and one statement's binding is interpolated by a later request, which is the case
 * where a re-pointed reader stops being a wrong assertion and becomes a wrong *request*.
 */
const CHAINED = [
  'test "a chain of three"',
  '  api POST /baskets',
  '  expect status equals 201',
  '  capture body.id as basketId',
  '  api POST /orders/checkout body { basketId: "{basketId}" }',
  '  expect status equals 201',
  '  expect body.total equals 3060',
  '  api GET /orders/{basketId}',
  '  expect status equals 200',
  '',
].join('\n');

test('`M217` `A1`: a create gesture opens what it made, and puts the cursor in it (`D1136`)', async () => {
  // **The three foot gestures share one defect and one shape**, so they share one gate. Fixing the
  // one that was complained about and leaving the other two would have made the inconsistency the
  // reader's problem — and `+ let` is the worst of them, because `let value = "change me"` is a
  // placeholder that asks to be typed over and then leaves you looking somewhere else.
  await withRemovalFixture(CHAINED, async (p, base) => {
    for (const gesture of ['request', 'let', 'wait'] as const) {
      await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L1`);
      await p.locator(`[data-seq-add="${gesture}"]`).click();
      await p.locator('[data-compose-dirty]').waitFor();

      // The address moved, and it moved to a line that is now the selected row.
      const line = new URL(p.url()).hash.match(/\/L(\d+)$/)?.[1] ?? null;
      assert.ok(line !== null, `${gesture}: the address names a line (${p.url()})`);
      assert.equal(
        await p.locator(`[data-seq-line="${line}"]`).getAttribute('data-seq-selected'),
        'yes',
        `${gesture}: and the row at that line is the selected one`,
      );

      // The editor is showing the thing, not the declaration it went into.
      assert.notEqual(
        await p.locator('[data-editor]').getAttribute('data-editor'),
        'test',
        `${gesture}: the editor left the declaration for what was just made`,
      );

      // And the cursor is in a field of it. **The first field, whichever it is** — naming
      // `.request-path` would be right for one of the three and silently wrong for the others.
      //
      // Asked through a locator rather than `document.activeElement`, because `tsconfig.test.json`
      // pins `types: ["node"]` with no DOM lib and `document` is not a name here — this file's own
      // `S1` finding, met for the fourth time. `.editor :focus` asks both halves at once: it
      // matches only if something is focused AND it is inside the editor.
      assert.equal(await p.locator('.editor :focus').count(), 1, `${gesture}: focus is inside the editor`);
      const tag = await p.locator('.editor :focus').evaluate((el) => el.tagName);
      assert.ok(['INPUT', 'TEXTAREA'].includes(tag), `${gesture}: and it is a field (${tag})`);

      // **And it happens ONLY on a create.** This clause exists because the first implementation
      // failed it: the effect listed the selected line among its dependencies, so once anything had
      // been created, every later selection change re-ran it — and from then on **clicking any row
      // in the sequence yanked focus into the editor and selected its text**. The trigger is *a
      // create landed*; the line is only how the effect finds what landed. Caught by driving the
      // page, not by the clauses above, every one of which was green.
      const other = await p.locator('.seq-row[data-seq-selected="no"] .seq-pick').first();
      await other.click();
      assert.equal(await p.locator('.editor :focus').count(), 0, `${gesture}: selecting another row does not pull focus into the editor`);
    }
  });
});

test('`M217` `B1`: inserting a request changes no reader’s response — asked of every request (`D1138`)', async () => {
  // **THE gate of this round.** Not *the new request landed on line N* — a line is an accident of
  // formatting — but the property the placement exists to preserve: every statement that read a
  // response before the edit reads the same one after it. Derived from the parse, so a fixture
  // that grows a request grows the gate.
  await withRemovalFixture(CHAINED, async (p, base, dir) => {
    const before = responseReaders(await readFile(join(dir, 'x.tflw'), 'utf8'));
    // An equality, not a floor: a floor here would stay green if the fixture lost a reader, and a
    // fixture with fewer readers is a weaker question asked with the same confidence.
    assert.equal(before.length, 5, `the fixture's readers (${before.join(' | ')})`);

    const requests = await p.evaluate(() => 0).then(async () => {
      await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L1`);
      await p.locator('[data-seq-plus]').first().waitFor();
      return p.locator('[data-seq-plus]').evaluateAll((els) => els.map((e) => e.getAttribute('data-seq-plus')!));
    });
    assert.equal(requests.length, 3, `one \`+\` per request (${requests.join(' · ')})`);

    for (const after of requests) {
      await openClean(p, `${base}/?token=${TOKEN}#/api/compose/x.tflw/L1`);
      await p.locator(`[data-seq-plus="${after}"]`).click();
      await p.locator('[data-compose-dirty]').waitFor();

      // **Read the sequence BEFORE leaving for Source**, which unmounts the column (`M205` `S5a`'s
      // rule, met again): read afterwards it comes back `[]`, and `deepEqual` then reports a
      // placement failure rather than a gate looking at the wrong tab.
      const order = await p.locator('[data-seq-plus]').evaluateAll((els) => els.map((e) => e.getAttribute('data-seq-plus')!));

      await p.locator('[data-tab="source"]').click();
      await p.locator('[data-source="pending"]').waitFor();
      const pending = (await p.locator('[data-preview]').textContent())!;

      const lost = keepsEveryReader(before, responseReaders(pending));
      assert.equal(lost, null, `+ after \`${after}\`: this reader changed what it reads — ${lost}`);
      // And the thing was actually inserted, so the assertion above is not vacuously true of a
      // gesture that did nothing.
      assert.equal(responseReaders(pending).length, before.length + 1, `+ after \`${after}\`: one new reader, and one only`);

      // **It landed WHERE IT WAS PRESSED**, and this clause exists because the mutation sweep
      // walked straight through the two above it: swapping `stepsAfter` for `steps` — appending at
      // the foot of the body, wherever you pressed — re-points nothing and adds exactly one
      // reader, so *no reader changed* stayed true and *the request is after this one* was never
      // asked. **A property that is necessary is not thereby sufficient.** The order is read off
      // the page's own list of `+`s, so it needs no line numbers.
      const at = requests.indexOf(after);
      assert.deepEqual(
        order,
        [...requests.slice(0, at + 1), 'GET /', ...requests.slice(at + 1)],
        `+ after \`${after}\`: the new request is directly below the one that was pressed`,
      );
    }
  });
});

test('`M217` `B2`: the `+` is on requests and nowhere else (`D1137`, `D1144`)', async () => {
  // A round trip over the DOM's own two answers to *which rows are requests*, so neither side is a
  // list anybody maintains. `data-stmt` is absent on exactly the request rows — that is what the
  // sequence column already uses to mark a statement — and `[data-seq-plus]` must agree with it.
  await withRemovalFixture(CHAINED, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L1`);
    await p.locator('[data-seq-plus]').first().waitFor();
    const rows = await p.locator('.seq-row').evaluateAll((els) =>
      els.map((e) => ({
        line: e.getAttribute('data-seq-line')!,
        kind: e.getAttribute('data-seq-row')!,
        plus: e.querySelector('[data-seq-plus]') !== null,
      })));
    for (const r of rows) {
      const isRequest = r.kind === 'request' || r.kind === 'wait';
      assert.equal(r.plus, isRequest, `line ${r.line} (${r.kind}): a \`+\` belongs to a request row and to no other`);
    }
    assert.ok(rows.some((r) => !r.plus), 'and some row does not have one, so the claim above is not vacuous');
  });
});

test('`M217` `B3`: the last request’s `+` and the foot’s `+ request` write the same bytes', async () => {
  // **The gate that catches `stepsAfter` and `steps` diverging.** *After the last request and its
  // attachments* and *at the end of the body* are the same place by construction, so the two
  // controls must produce byte-identical files — and the mutation that swaps one splice for the
  // other has to redden HERE and not in `B1`, because appending at the foot never re-points
  // anything and `B1` would stay green.
  await withRemovalFixture(CHAINED, async (p, base) => {
    const bytes = async (press: string): Promise<string> => {
      await openClean(p, `${base}/?token=${TOKEN}#/api/compose/x.tflw/L1`);
      await p.locator(press).click();
      await p.locator('[data-compose-dirty]').waitFor();
      await p.locator('[data-tab="source"]').click();
      await p.locator('[data-source="pending"]').waitFor();
      return (await p.locator('[data-preview]').textContent())!;
    };
    const viaPlus = await bytes('[data-seq-plus="GET /orders/{basketId}"]');
    const viaFoot = await bytes('[data-seq-add="request"]');
    assert.equal(viaPlus, viaFoot, 'the last row’s `+` and the foot’s `+ request` are the same edit');
  });
});

test('`M217` `C1`: the create dialog previews the bytes that land, pending edits included (`D1141`)', async () => {
  // **`D1087` claims this about the dialog and it was false about the page.** The dialog built
  // from `openFileView.text` — the copy on disk — so with anything pending it previewed and wrote
  // a file that was not the one the author was looking at, then left a stale buffer behind that
  // the next Save would have put back over the new test.
  await withRemovalFixture(CHAINED, async (p, base, dir) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/x.tflw/L1`);
    await p.locator('[data-seq-plus="POST /baskets"]').click();
    await p.locator('[data-compose-dirty]').waitFor();

    await p.locator('[data-compose-new-test]').click();
    await p.locator('[data-new-name]').fill('staged beside a pending edit');
    await p.locator('[data-new-preview]').waitFor();
    // **The whole file is asked for, because since `M229` `C` (`D1251`) the preview opens on the
    // ADDITION.** The claim this test makes is about which *bytes* the dialog built from — the
    // pending buffer and not the saved file — and those bytes are the surrounding file, which is
    // now one control away rather than in front of you. Restated rather than patched: reading the
    // addition alone here would have been a green assertion about a different claim.
    assert.equal(await p.locator('[data-new-preview]').getAttribute('data-new-preview-showing'), 'addition');
    await p.locator('[data-new-preview-context]').click();
    const preview = (await p.locator('[data-new-preview]').textContent())!;
    assert.match(preview, /capture body\.id as basketId\n\s+api GET \/\n\s+expect status equals 200/, 'the preview carries the pending request');
    assert.match(preview, /test "staged beside a pending edit"/, 'and the test about to be made');

    // **It stages; it does not write.** The file on disk is untouched, the buffer is still dirty,
    // and the pane has grown a declaration.
    await p.locator('[data-new-create]').click();
    await p.locator('[data-new-thing]').waitFor({ state: 'detached' });
    assert.doesNotMatch(await readFile(join(dir, 'x.tflw'), 'utf8'), /staged beside/, 'nothing reached the disk');
    assert.equal(await p.locator('[data-compose-dirty]').count(), 1, 'and the buffer still holds it');

    // One Save, and both halves land together — which is the thing that was impossible before.
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
    const written = await readFile(join(dir, 'x.tflw'), 'utf8');
    assert.match(written, /test "staged beside a pending edit"/, 'the new test is on disk');
    assert.match(written, /capture body\.id as basketId\n\s+api GET \/\n/, 'and so is the edit that was pending beside it');
  });
});

test('`M217` `C2`: a draft belongs to its file and survives a look at another one (`D1142`, `D1143`)', async () => {
  // Measured before the change, on the example: pending edit on one file, click another in the
  // explorer — dirty gone, no prompt, nothing in the page text matching unsaved/pending/discard —
  // click back, the edit gone. `M217` puts a `+` on every file row, which makes crossing a pending
  // edit a one-click gesture, so that behaviour could not be shipped under it.
  await withProjectFixture({ 'a.tflw': CHAINED, 'b.tflw': ['test "elsewhere"', '  api GET /b', '  expect status equals 200', ''].join('\n') }, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/a.tflw/L1`);
    await p.locator('[data-seq-add="request"]').click();
    await p.locator('[data-compose-dirty]').waitFor();
    /* `M235` `C2` — `count()` waits for nothing, and this is the reading the whole test is
       measured against: if it samples a half-painted pane the expected total is wrong and the
       comparison at the end is against a number that was never true. `untilMeasurable`, because
       "no rows at all" is a pane that has not painted, not a sequence with nothing in it — a
       request was just added, so zero is unreadable rather than small. */
    const drawn = await settle(
      () => p.locator('.seq-row').count(),
      untilMeasurable('the sequence has painted', (n) => n > 0),
      { attempts: 40, delayMs: 50, page: p },
    );
    const rows = drawn.value;

    // Away. The explorer says which file is unsaved — the set of marks IS the set of drafts, so
    // the other file must not carry one.
    await p.locator('[data-file-row="b.tflw"]').click();
    await p.locator('[data-file-row="b.tflw"][data-open="yes"]').waitFor();
    /* Both of these read state that the file switch *removes* and *moves*, and the wait above is
       on a third subject — the row's own `data-open`. `untilEqual` rather than `untilMeasurable`
       for the pair, knowingly: a marker that is still on screen is measurable and wrong, so this
       is retrying on the assertion, which `settle.ts` sanctions only because the budget is bounded
       and a permanently-wrong value still fails. The alternative — waiting on the pane's own
       `data-compose-file` — would be stronger, and is not taken here because it would be a claim
       about an attribute this test does not otherwise use. */
    const pending = await settle(
      () => p.locator('[data-compose-dirty]').count(),
      untilEqual(0),
      { attempts: 40, delayMs: 50, page: p },
    );
    assert.equal(pending.value, 0, `the file you are looking at has nothing pending (${pending.attempts} look(s))`);
    const marked = await settle(
      () => p.locator('[data-file-unsaved]').evaluateAll((els) => els.map((e) => e.getAttribute('data-file-unsaved'))),
      untilEqual(['a.tflw']),
      { attempts: 40, delayMs: 50, page: p },
    );
    assert.deepEqual(
      marked.value,
      ['a.tflw'],
      `and the explorer marks the one that does, and only it (${marked.attempts} look(s))`,
    );

    // Back, and the work is there.
    await p.locator('[data-file-row="a.tflw"]').click();
    await p.locator('[data-compose-dirty]').waitFor();
    /* `M234` `A6` — **the count is what has to retry, not the wait in front of it** (`D1308`).
       `A` put a row wait here on the reading that the sequence had not been drawn yet. It had:
       CI Node 22 then read 0 rows against 11 with the wait satisfied and the whole test taking
       359 ms, which is a re-render between the two calls and not a slow one. */
    const back = await countSettling(p, '.seq-row', rows);
    if (back !== rows) {
      // one-shot: it says which file the pane was showing when the count came back wrong; a retry
      // would describe a later page than the one that failed
      const showing = await p.locator('[data-compose-file]').evaluateAll((els) => els.map((e) => e.getAttribute('data-compose-file')));
      assert.fail(`the pending edit did not come back with the file — ${back} rows against ${rows}, pane showing ${JSON.stringify(showing)}`);
    }
  });
});

test('`M217` `D1`: a `+` on a file row opens THAT file’s dialog (`D1139`)', async () => {
  // **The explorer builds nothing.** It opens the file and opens the dialog the sequence column's
  // own button opens — which is what keeps `D1087`'s single construction path intact while adding
  // a second place to start from. The dangerous half is timing: `setFile` and the read that
  // follows it are not the same tick, so a dialog opened too early would splice a test into one
  // file's name using another file's bytes, or into an empty string.
  await withProjectFixture({ 'a.tflw': CHAINED, 'b.tflw': ['test "elsewhere"', '  api GET /b', '  expect status equals 200', ''].join('\n') }, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/a.tflw`);
    await p.locator('li[data-file="b.tflw"] [data-row-plus="test"]').click();
    await p.locator('[data-new-thing="test"]').waitFor();
    assert.match((await p.locator('[data-new-thing] h2').textContent())!, /b\.tflw$/, 'the dialog names the file the `+` was on');

    await p.locator('[data-new-name]').fill('made from the explorer');
    // The whole file, for `D1251`'s reason — see the note on the staging test above. The claim is
    // which file's bytes the dialog built from, and that is a claim about the context.
    await p.locator('[data-new-preview-context]').click();
    const preview = (await p.locator('[data-new-preview]').textContent())!;
    assert.match(preview, /test "elsewhere"/, 'and is built from THAT file’s bytes');
    assert.doesNotMatch(preview, /basketId/, 'not from the one that was open a moment ago');
  });
});

test('`M217` `D2`: a `+` on a test row adds a request to that test, and opens it (`D1139`, `D1144`)', async () => {
  // `before file`, not `before each` — the first draft wrote the latter and `TF010` refused it
  // (*unexpected `each` at end of declaration*), which is a file Compose will not edit at all: the
  // gate then timed out waiting for a dirty marker a broken file can never produce. The same trap
  // `M216`'s `FULL` fixture recorded one construct over, which is why this comment is here too.
  await withProjectFixture({ 'a.tflw': [CHAINED, 'before file', '  api GET /warm', '  expect status equals 200', ''].join('\n') }, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/a.tflw`);
    await p.locator('[data-outline-decl="test"]').first().waitFor();

    // A hook gets none, and that is the language rather than a gap: the splice names a test BY
    // NAME and a hook has none. Asked as a round trip over the outline's own kinds.
    const decls = await p.locator('[data-outline-decl]').evaluateAll((els) =>
      els.map((e) => ({ kind: e.getAttribute('data-outline-decl')!, plus: e.querySelector('[data-row-plus="request"]') !== null })));
    assert.ok(decls.some((d) => d.kind === 'hook'), 'the fixture has a hook, so the claim below is not vacuous');
    for (const d of decls) assert.equal(d.plus, d.kind === 'test', `a \`${d.kind}\` row carries a \`+\` only if it is a test`);

    // And the accessible name says whose it is, rather than being a constant.
    const label = await p.locator('[data-outline-decl="test"] [data-row-plus="request"]').first().getAttribute('aria-label');
    assert.match(label ?? '', /a chain of three/, `the \`+\` names its own subject (${label})`);

    await p.locator('[data-outline-decl="test"] [data-row-plus="request"]').first().click();
    await p.locator('[data-compose-dirty]').waitFor();
    assert.equal(await p.locator('[data-editor]').getAttribute('data-editor'), 'request', 'the pane opened what it made');
    assert.equal(await p.locator('[data-seq-selected="yes"]').count(), 1, 'and exactly one row is selected');
  });
});

test('`M217` `D3`: the `+` costs no name that was not already cut (`D1140`)', async () => {
  // The declaration rows are the most starved text on the page — `.outline-name` gets 182 px at
  // the pane's default for names whose natural width runs to 596. The claim is not a pixel
  // constant, which would go stale the day anything else on the row changes; it is a COMPARISON
  // taken in the same run: hiding the `+` must not make any more names fit.
  //
  // **The fixture's names have to be long enough for the question to exist**, and the first draft's
  // were not: `CHAINED` declares *a chain of three*, which fits at 320 px with or without a `+`, so
  // the gate compared `0` against `0` and a mutation giving the `+` a 90 px `min-width` walked
  // through it. A comparison gate needs an input where the two sides CAN differ.
  //
  // **And it needs a name in the range where the `+` is what decides**, which is the second thing
  // the sweep found: with only a long name, both sides read *cut* whichever width the `+` has, so
  // a mutation giving it a 90 px `min-width` walked through a gate that was true and blind. The
  // second name below is sized to fit the ~163 px the row gives a name under one folder of
  // indentation, and not the ~91 px a fat `+` would leave — so it is the one whose verdict the
  // control actually changes. It was tuned against a measurement, twice: the first length fitted at
  // the root and not under `tests/`, which is where real files live.
  const LONG = [
    'test "a name long enough that the pane has to cut it, which is the case this gate is about"',
    '  api GET /a',
    '  expect status equals 200',
    '',
    'test "a middling name"',
    '  api GET /b',
    '  expect status equals 200',
    '',
  ].join('\n');
  // **Under a folder, like a real project's files are.** At the root the pane gives a declaration
  // row enough width that it never has to shrink, and a gate measured there cannot see a row that
  // refuses to — which is exactly the defect above.
  await withProjectFixture({ 'tests/a.tflw': LONG }, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/tests/a.tflw`);
    await p.locator('[data-outline-decl="test"]').first().waitFor();
    const cut = async (): Promise<number> =>
      p.locator('.outline-row .outline-name').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);

    const withPlus = await cut();
    // `setAttribute` rather than `.style`, for the same reason as above: there is no `HTMLElement`
    // in this file's type world.
    await p.locator('.outline .row-plus').evaluateAll((els) => { for (const e of els) e.setAttribute('style', 'display: none'); });
    const without = await cut();
    // **And every `+` is inside the pane it belongs to**, which is the clause that would have
    // caught the defect this gate was green through: a flex item defaults to `min-width: auto`, so
    // the declaration row never shrank and its `+` rendered at **305–323 px in a 320 px sidebar**
    // — outside its own pane, with the pane gaining horizontal overflow. A name that never shrinks
    // is never newly cut, so the comparison below stayed true of a layout that was not doing the
    // thing at all.
    const fit = await p.locator('.sidebar').evaluate((side) => {
      const right = side.getBoundingClientRect().right;
      const out = [...side.querySelectorAll('[data-row-plus]')]
        .map((e) => ({ kind: e.getAttribute('data-row-plus'), r: Math.round(e.getBoundingClientRect().right) }))
        .filter((e) => e.r > right);
      return { overflow: side.scrollWidth - side.clientWidth, outside: out, right: Math.round(right) };
    });
    assert.deepEqual(fit.outside, [], `every \`+\` ends inside the pane (right edge ${fit.right})`);
    assert.ok(fit.overflow <= 0, `and the pane has no horizontal overflow (${fit.overflow}px)`);

    assert.ok(without >= 1, `the fixture has a name the pane must cut whatever the \`+\` costs (${without})`);
    assert.ok(without < 2, `and one it can show whole, so this comparison can fail (${without} of 2 cut with the \`+\` hidden)`);
    assert.equal(withPlus, without, `the \`+\` truncates no name the row was already showing whole (${withPlus} cut with it, ${without} without)`);
  });
});

// ── `M218` — the right-click menu, and moving or deleting a file ───────────────────────────────
//
// The properties below are written as round-trips rather than as lists of item names, on `M214`'s
// measured precedent: its frozen mutation `the-add-menu-hides-what-it-cannot-add` is what a
// completeness gate spelled as an enumeration looks like when it freezes a UI. So `B1` asks *does
// every item either work or say why*, never *are these the eight items*.

/** A project whose two tests both import a third file — the shape every refusal here is about. */
const IMPORTED = {
  'shared/login.tflw': ['test "signs in"', '  api GET /session', '  expect status equals 200', ''].join('\n'),
  'tests/checkout.tflw': ['import "../shared/login.tflw"', '', 'test "checks out"', '  api GET /orders', '  expect status equals 200', ''].join('\n'),
  'tests/basket.tflw': ['import "../shared/login.tflw"', '', 'test "baskets"', '  api GET /baskets', '  expect status equals 200', ''].join('\n'),
  'tests/lonely.tflw': ['test "alone"', '  api GET /x', '  expect status equals 200', ''].join('\n'),
};

/**
 * Right-click a row and wait for the menu to be **placed** rather than merely present.
 *
 * **A real right-click, not a dispatched event.** The first draft used
 * `locator.dispatchEvent('contextmenu', …)` and every gate built on it timed out with no menu at
 * all, while the same gesture worked from raw page script — Playwright's `dispatchEvent` does not
 * produce an event React's `onContextMenu` accepts here. The correction is the better gate anyway:
 * this presses the button a person presses.
 *
 * `:not([data-menu-placed="measuring"])` is the wait, because `measuring` is the deliberate hidden
 * first frame in which the menu is rendered at the origin so `place()` can read its height. Waiting
 * for visibility alone would measure a box that is about to move.
 */
/**
 * `.count()` that settles — `M234` `A6` (`D1308`).
 *
 * This file's own docblock warns that a read after a wait does not retry, and this round has now
 * spent three CI rounds on that shape at three different sites. `count()` is the sharpest case of
 * it: it resolves against whatever the DOM holds on one tick, and a pane that re-renders between
 * the wait and the read answers **0** with no error of any kind. CI Node 22 read 0 rows against
 * 11 on a test whose whole duration was 359 ms — so nothing was slow, and a longer wait was never
 * the answer; the DOM simply had a frame in which the rows were not there.
 *
 * Playwright's own auto-retrying assertions live in `@playwright/test`, which this file does not
 * use — it is `node:test` plus the `playwright` library — so the retry is written out. It returns
 * what it last saw rather than throwing, so the caller can say what else was on the page.
 *
 * `M235` `B1` — the loop now lives in `settle.ts`, and this is the suite's one `untilEqual` site.
 * That predicate retries on the assertion itself, which `M141` forbids in general; it is sound here
 * for one reason only, and the reason is the budget. A pane that is painting climbs 0 -> 11 and
 * settles; a pane that genuinely holds nine rows is asked a hundred times, answers nine a hundred
 * times, and is returned as nine for the caller to fail on. Remove the bound and this stops being a
 * gate. See `settle.ts` for why the other predicate is the one to reach for everywhere else.
 */
const countSettling = async (p: Page, selector: string, want: number): Promise<number> => {
  const outcome = await settle(
    () => p.locator(selector).count(),
    untilEqual(want),
    { attempts: 100, delayMs: 100, page: p },
  );
  return outcome.value;
};

const PLACED_MENU = '.ctx-menu:not([data-menu-placed="measuring"])';

const openMenu = async (p: Page, selector: string): Promise<void> => {
  await p.locator(selector).first().click({ button: 'right' });
  await p.locator(PLACED_MENU).waitFor({ state: 'visible' });
};

/**
 * Open a context menu and read its box as ONE retrying operation — `M234-06` (`D1308`'s shape,
 * fourth site).
 *
 * `countSettling` above says this file has spent three CI rounds on *a read after a wait does not
 * retry*. This is the fourth, and unlike the first three it is grounded in the error rather than in
 * a guess at it. CI Node 22 reported, inside the Coverage step:
 *
 *     locator.boundingBox: Timeout 30000ms exceeded.
 *       - waiting for locator('.ctx-menu:not([data-menu-placed="measuring"])')
 *       at ui-page.test.ts:9782
 *
 * — which is the READ, not `openMenu`'s wait and not the click. So the menu was visible when
 * `openMenu` returned and was gone one line later, and `boundingBox()` auto-waits, so a menu that
 * never comes back costs the full default timeout instead of returning `null`.
 *
 * **`A4` diagnosed the cause correctly and its repair moved the window rather than closing it.**
 * `ContextMenu.tsx:199` closes on `resize`, `setViewportSize` resolves before the page has
 * necessarily dispatched that event, and `settleViewport`'s two frames are a *timing heuristic*: on
 * a two-core runner already carrying c8 instrumentation, the event can land after them. When it
 * lands before `openMenu`'s wait the menu is simply absent (`A4`'s `menus []`, fast); when it lands
 * between that wait and this read the menu is visible and then gone — the 30 s hang seen here. Same
 * mechanism, later by a few milliseconds, and a frame count cannot be made robust against a machine
 * that is arbitrarily slow.
 *
 * So the retry is written out, as `A6` wrote out `count()`. A vanished menu is asked for again; a
 * *mis-placed* one is not retried and is returned to the caller to judge, because a menu outside
 * the viewport still has a box — `null` here means **not in the document**, never "in the wrong
 * place". Every wait is bounded so that a genuine breakage fails in seconds rather than spending
 * 30 s per read, and the attempt count is returned so the diagnostic can say whether the placement
 * it reports was reached first time or on the sixth.
 *
 * `M235` `B1` — the loop now lives in `settle.ts`. This site is why `settle` takes a *read* and not
 * a locator: one attempt here is a gesture and two bounded waits, and `null` is this read's own word
 * for "not yet". The budget stays 8, the delay stays 0 because the 1500 ms `waitFor` is the pacing.
 */
type MenuBox = { x: number; y: number; width: number; height: number };

const openMenuAndBox = async (
  p: Page,
  selector: string,
): Promise<{ box: MenuBox | null; attempts: number }> => {
  // The re-click is inside the read, not beside it: one attempt of this wait IS *open it and
  // measure it*, which is the whole point of the fourth site. `settle` needs no separate hook for
  // it, and a read that decides its own bounded wait means “not yet” is the only shape this
  // needs — `settle` itself never swallows an error (`settle.ts`).
  const outcome = await settle(
    async (): Promise<MenuBox | null> => {
      await p.locator(selector).first().click({ button: 'right' });
      try {
        await p.locator(PLACED_MENU).waitFor({ state: 'visible', timeout: 1500 });
      } catch {
        return null; // never arrived, or arrived and left before the wait resolved — ask again
      }
      return await p.locator(PLACED_MENU).boundingBox({ timeout: 1500 }).catch(() => null);
    },
    untilMeasurable('the menu is in the document', (box) => box !== null),
    { attempts: 8, delayMs: 0, page: p },
  );
  return { box: outcome.value, attempts: outcome.attempts };
};

test('`M218` `A1`: the menu stays on screen wherever it is opened, on every row kind (`D1145`)', async () => {
  await withProjectFixture(IMPORTED, async (p, base) => {
    await openClean(p, `${base}/?token=${TOKEN}#/api/compose/tests/checkout.tflw/L3`);
    // **Sizes rather than pointer coordinates.** The clamp is only asked a question when the menu
    // does not fit where it was asked for, and shrinking the window is how a real pointer gets
    // near an edge — a synthetic corner coordinate would put the menu over a row that is not there.
    const sizes = [{ width: 1440, height: 900 }, { width: 900, height: 600 }, { width: 700, height: 420 }];
    const rows = ['[data-file-row="tests/checkout.tflw"]', '[data-dir-toggle="tests"]', '[data-outline-goto="3"]', '[data-seq-line="3"]'];
    const off: string[] = [];
    const skipped: string[] = [];
    /* `M234` `A4` — **THE PREVIOUS RESIZE CLOSES THE NEXT MENU**, and the instrumentation `A2`
       added is what proved it (`D1308`). CI Node 22 reported
       `[data-file-row="tests/checkout.tflw"] at 700x420 → null · menus [] · row {…,"height":22}`:
       the row is present and a sane size, and there is **no `.ctx-menu` in the document at all**.
       So nothing was mis-placed and nothing was clipped — `openMenu`'s visible-wait passed and the
       menu was gone one line later. `ContextMenu.tsx:199` closes on `resize`, which is right: a
       menu placed against a window that has changed size is in the wrong place. `setViewportSize`
       resolves before the page has necessarily dispatched that event, so the FIRST menu opened
       after a resize is the one the previous resize closes — which is exactly the row and the
       viewport CI named, the first row of the smallest size.
       Two guesses were made at this failure from a bare `→ null` and both were wrong (`A`, `A2`).
       This is the third, and it is the first one a measurement asked for. */
    const settleViewport = async (size: { width: number; height: number }): Promise<void> => {
      await p.setViewportSize(size);
      // Two frames, so the `resize` listener has run before the next menu is opened.
      //
      // **Reached through the element's own document rather than through `window`**, because this
      // file has no DOM globals at all and that is a decision rather than an omission — three
      // comments in it say so where a `document.activeElement` would have been easier than a
      // `:focus` locator. `tsconfig.test.json` carries `types: ["node"]` and no DOM lib, and
      // `ui-appearance.test.ts` pays for its own access with four hand-written `declare const`
      // shims whose whole argument is that `declare const document: any` would typecheck the
      // probe's bugs as happily as its correctness. Adding a fifth here to buy two frames is the
      // wrong trade; the element Playwright hands the callback already knows its own window.
      await p.locator('body').evaluate((el) => new Promise<void>((resolve) => {
        const view = el.ownerDocument.defaultView;
        if (view === null) { resolve(); return; }
        view.requestAnimationFrame(() => view.requestAnimationFrame(() => { resolve(); }));
      }));
    };
    for (const size of sizes) {
      await settleViewport(size);
      for (const row of rows) {
        /* `M235` `C2` — a `count()` waits for nothing, so a row that has not painted yet answers
           `0` and this loop **silently skips its own subject and passes**. That is `M168`'s shape:
           a guard must leave the guarded thing reachable. The guard itself stays, because not
           every row kind need exist in every fixture — but it now costs a bounded wait before it
           believes the absence, and a row it skips is named in the diagnostic instead of
           vanishing. `untilMeasurable`, because "no rows at all" is not a small number of rows,
           it is a reading that has not happened. */
        const present = await settle(
          () => p.locator(row).count(),
          untilMeasurable('the row has painted', (n) => n > 0),
          { attempts: 20, delayMs: 50, page: p },
        );
        if (present.value === 0) { skipped.push(`${row} at ${size.width}x${size.height}`); continue; }
        /* `M234` `A` — THE SAME SELECTOR `openMenu` WAITED ON, AND THE ESCAPE IS AWAITED
           (`D1308`). Two halves of one race, and `A2` twenty lines down already has both: it waits
           on `.ctx-menu:not([data-menu-placed="measuring"])` and then on `{ state: 'detached' }`
           after its own Escape. This loop opens a menu per row per viewport and waited for
           neither, so a right-click could land while the previous menu was still detaching — the
           `waitFor` inside `openMenu` then matches the OLD menu, and `boundingBox()` reads it as
           it leaves. That is the `null` Node 22 reported at 700x420, on the third viewport and the
           second row, which is exactly where the backlog of undismissed menus is deepest.

           `M234-06` — the open and the read are now ONE retrying operation (`openMenuAndBox`),
           because the repair above closed the half of the race it could see and the other half
           came back as a 30 s hang on this very line. Read that helper's docblock before touching
           this: the retry is for a menu that is GONE, and a mis-placed one is still judged here. */
        const { box, attempts } = await openMenuAndBox(p, row);
        if (box === null || box.x < 0 || box.y < 0 || box.x + box.width > size.width || box.y + box.height > size.height) {
          /* `M234` `A` — SAY WHAT WAS SEEN, because twice now a repair has been guessed from
             `→ null` alone and twice it has been wrong (`D1308`). `null` from `boundingBox()`
             means *not visible*, and this gate cannot currently tell an unplaced menu from a
             zero-height one from one that closed between the wait and the read. CI reports the
             SAME row at the SAME viewport on both runs — `[data-dir-toggle="tests"]` at 700x420 —
             which is a deterministic fact about that environment rather than a race, and none of
             it reproduces on the box. So the gate is made to report its own state instead of
             being repaired on a third guess. */
          // one-shot: it reports what was on the page at the instant the clamp was violated, and a
          // retry would report a different page from the one that failed
          const seen = await p.locator('.ctx-menu').evaluateAll((els) => els.map((e) => {
            const r = e.getBoundingClientRect();
            return { placed: e.getAttribute('data-menu-placed'), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
          }));
          // one-shot: the same instant as `seen` above; the two are read as one description
          const rowBox = await p.locator(row).first().boundingBox();
          off.push(`${row} at ${size.width}x${size.height} → ${JSON.stringify(box)} · after ${attempts} open(s) · menus ${JSON.stringify(seen)} · row ${JSON.stringify(rowBox)}`);
        }
        await p.keyboard.press('Escape');
        await p.locator('.ctx-menu').waitFor({ state: 'detached' });
      }
    }
    await p.setViewportSize({ width: 1440, height: 900 });
    assert.deepEqual(off, [], `every menu is fully inside the window${skipped.length ? ` (rows not present: ${skipped.join(', ')})` : ''}`);
  });
});

test('`M218` `A2`: `Shift`+`F10` opens it and `Escape` gives focus back (`D1147`)', async () => {
  await withProjectFixture(IMPORTED, async (p, base) => {
    await openClean(p, `${base}/?token=${TOKEN}#/api/compose/tests/checkout.tflw/L3`);
    const row = p.locator('[data-file-row="tests/checkout.tflw"]');
    await row.focus();
    await p.keyboard.press('Shift+F10');
    await p.locator('.ctx-menu:not([data-menu-placed="measuring"])').waitFor({ state: 'visible' });

    // The arrows move the current item, and only among the ones that can be run.
    const at = () => p.locator('.ctx-menu').getAttribute('aria-activedescendant');
    const first = await at();
    await p.keyboard.press('ArrowDown');
    assert.notEqual(await at(), first, 'the arrow moved the current item');
    await p.keyboard.press('End');
    const last = await at();
    await p.keyboard.press('ArrowDown');
    assert.notEqual(await at(), last, 'and it wraps rather than stopping');

    await p.keyboard.press('Escape');
    await p.locator('.ctx-menu').waitFor({ state: 'detached' });
    // Asked with a `:focus` locator rather than `document.activeElement`: `tsconfig.test.json`
    // pins `types: ["node"]` with no DOM lib, so `document` is not a name in this file. That is
    // this file's own documented `S1` finding, and this is its fifth recurrence.
    assert.equal(
      await p.locator('[data-file-row="tests/checkout.tflw"]:focus').count(),
      1,
      'focus went back to the row the menu was opened from',
    );
  });
});

test('`M218` `A3`: opening a second menu leaves one open, not two', async () => {
  await withProjectFixture(IMPORTED, async (p, base) => {
    await openClean(p, `${base}/?token=${TOKEN}#/api/compose/tests/checkout.tflw/L3`);
    await openMenu(p, '[data-file-row="tests/checkout.tflw"]');
    await openMenu(p, '[data-file-row="tests/lonely.tflw"]');
    assert.equal(await p.locator('.ctx-menu').count(), 1);
    assert.equal(await p.locator('.ctx-menu').getAttribute('data-menu-subject'), 'tests/lonely.tflw');
  });
});

test('`M218` `B1`: every item either runs or says why — asked of every row kind (`D1146`)', async () => {
  await withProjectFixture(IMPORTED, async (p, base) => {
    await openClean(p, `${base}/?token=${TOKEN}#/api/compose/tests/checkout.tflw/L3`);
    const rows = ['[data-file-row="shared/login.tflw"]', '[data-file-row="tests/lonely.tflw"]', '[data-dir-toggle="tests"]', '[data-outline-goto="3"]', '[data-seq-line="3"]', '[data-seq-line="4"]'];
    const silent: string[] = [];
    let seenDisabled = 0;
    for (const row of rows) {
      await openMenu(p, row);
      const items = await p.locator('.ctx-menu [data-menu-item]').all();
      assert.ok(items.length > 0, `${row} offers something`);
      for (const item of items) {
        const id = await item.getAttribute('data-menu-item');
        if ((await item.getAttribute('data-menu-state')) !== 'disabled') continue;
        seenDisabled += 1;
        const why = await p.locator(`.ctx-menu [data-menu-why="${id}"]`).textContent();
        if (why === null || why.trim() === '') silent.push(`${row} ▸ ${id}`);
      }
      await p.keyboard.press('Escape');
      // `M234` `A` — awaited away before the next row opens one (`D1308`), same as `A1`'s loop.
      await p.locator('.ctx-menu').waitFor({ state: 'detached' });
    }
    assert.deepEqual(silent, [], 'no disabled item is silent about why');
    // The control: if nothing was ever disabled the loop above proved nothing at all. `shared/
    // login.tflw` is imported twice, so its Delete must be one of them.
    assert.ok(seenDisabled > 0, 'and at least one item was actually disabled, so the rule was exercised');
  });
});

test('`M218` `B1`: Delete is refused on an imported file and names the importers (`D1146`, `D1153`)', async () => {
  await withProjectFixture(IMPORTED, async (p, base) => {
    await openClean(p, `${base}/?token=${TOKEN}#/api/compose/tests/checkout.tflw/L3`);
    await openMenu(p, '[data-file-row="shared/login.tflw"]');
    assert.equal(await p.locator('.ctx-menu [data-menu-item="delete"]').getAttribute('data-menu-state'), 'disabled');
    const why = (await p.locator('.ctx-menu [data-menu-why="delete"]').textContent()) ?? '';
    assert.ok(why.includes('tests/checkout.tflw') && why.includes('tests/basket.tflw'), `the reason names them: ${why}`);
    await p.keyboard.press('Escape');
    /* `M234` `A` — and gone before the next one opens (`D1308`). `openMenu` waits for a PLACED
       menu to be visible, which the menu being dismissed still is: without this the second
       `openMenu` can return on the first file's menu and the assertion below reads `disabled`
       from the row it was supposed to have left. */
    await p.locator('.ctx-menu').waitFor({ state: 'detached' });
    // …and the same menu on a file nobody imports offers it.
    await openMenu(p, '[data-file-row="tests/lonely.tflw"]');
    assert.equal(await p.locator('.ctx-menu [data-menu-item="delete"]').getAttribute('data-menu-state'), 'enabled');
  });
});

test('`M218` `B2`: the menu acts on the row under the pointer, not on the selection (`D1149`)', async () => {
  await withProjectFixture(IMPORTED, async (p, base) => {
    await openClean(p, `${base}/?token=${TOKEN}#/api/compose/tests/checkout.tflw/L3`);
    // Build a three-file selection — which in this pane means *what will run*, nothing else.
    await p.locator('[data-file-row="tests/checkout.tflw"]').click();
    await p.locator('[data-file-row="tests/basket.tflw"]').click({ modifiers: ['Meta'] });
    await p.locator('[data-file-row="tests/lonely.tflw"]').click({ modifiers: ['Meta'] });
    assert.equal(await p.locator('[data-selected="yes"]').count(), 3, 'three files are selected');

    await openMenu(p, '[data-file-row="tests/lonely.tflw"]');
    assert.equal(await p.locator('.ctx-menu').getAttribute('data-menu-subject'), 'tests/lonely.tflw');
    // And the selection is untouched by having opened a menu over it.
    assert.equal(await p.locator('[data-selected="yes"]').count(), 3);
  });
});

test('`M218` `C2`: the preview names the files the apply writes, and nothing else (`D1150`)', async () => {
  await withProjectFixture(IMPORTED, async (p, base, dir) => {
    const preview = await (await api(`${base}/api/refactor?op=move&from=shared%2Flogin.tflw&to=shared%2Fsignin.tflw`)).json() as { edits: { path: string }[]; removes: string[] };
    const before = new Map<string, string>();
    for (const name of Object.keys(IMPORTED)) before.set(name, await readFile(join(dir, name), 'utf8'));

    const applied = await api(`${base}/api/move`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: 'shared/login.tflw', to: 'shared/signin.tflw' }) });
    assert.equal(applied.status, 200);

    // What actually changed on disk, asked of the bytes rather than of the response.
    const changed: string[] = [];
    for (const [name, was] of before) {
      const now = await readFile(join(dir, name), 'utf8').catch(() => null);
      if (now !== was) changed.push(name);
    }
    assert.deepEqual(
      changed.sort(),
      [...preview.edits.map((e) => e.path).filter((x) => !before.has(x)), ...preview.edits.map((e) => e.path).filter((x) => before.has(x)), ...preview.removes]
        .filter((x, i, a) => a.indexOf(x) === i && before.has(x)).sort(),
      'every file the apply touched was named by the preview',
    );
    await p.close?.call(p);
  });
});

test('`M218` `D1`: deleting an imported file is refused and the file survives (`D1153`)', async () => {
  await withProjectFixture(IMPORTED, async (_p, base, dir) => {
    const res = await api(`${base}/api/file?path=shared%2Flogin.tflw`, { method: 'DELETE' });
    assert.equal(res.status, 409);
    const body = await res.json() as { importers: string[] };
    assert.deepEqual(body.importers, ['tests/basket.tflw', 'tests/checkout.tflw']);
    assert.ok(await readFile(join(dir, 'shared/login.tflw'), 'utf8').then(() => true).catch(() => false), 'the file is still there');
  });
});

test('`M218` `D2`: the recovery sentence is about this file, and degrades rather than guessing (`D1154`)', async () => {
  // **All three answers, in one repository this test makes itself.**
  //
  // The first draft took its `tracked` control from `examples/storefront`, which is a git checkout
  // on the machine this was written on and an **rsync copy** on the box the suite actually runs on
  // — so the gate passed locally and failed remotely, asserting `tracked` against a directory git
  // has never heard of. A gate whose subject is *whether git knows this file* has to bring its own
  // git, or it is measuring where it is being run.
  //
  // Two directions are required and not one: `unknown` alone is satisfied by a function that always
  // answers `unknown`, and `tracked` alone by one that always answers `tracked`. `untracked` is the
  // case the whole decision turned on — a file inside a real repository that git still cannot give
  // back, which is exactly what a `.git`-directory check would have called recoverable.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m218-git-'));
  const git = (...args: string[]): void => { execFileSync('git', args, { cwd: dir, stdio: 'ignore' }); };
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    const body = ['test "t"', '  api GET /x', '  expect status equals 200', ''].join('\n');
    await writeFile(join(dir, 'committed.tflw'), body);
    await writeFile(join(dir, 'never-committed.tflw'), body);
    const port = await ui.listen(0);
    const ask = async (name: string): Promise<string> =>
      ((await (await api(`http://127.0.0.1:${port}/api/refactor?op=delete&path=${encodeURIComponent(name)}`)).json()) as { recovery: string }).recovery;

    // 1. No repository at all — the flat "this cannot be undone".
    assert.equal(await ask('committed.tflw'), 'unknown', 'outside a repository the answer is `unknown`');

    // 2. A repository, and one of the two files committed into it.
    git('init', '-q');
    // Set locally: a box with no global identity would otherwise fail the commit, not the gate.
    git('config', 'user.email', 'gate@example.invalid');
    git('config', 'user.name', 'gate');
    git('add', 'committed.tflw');
    git('commit', '-qm', 'the one git can give back');
    assert.equal(await ask('committed.tflw'), 'tracked', 'a committed file is `tracked`');

    // 3. The case `D1154` exists for: inside the repository, and gone forever if deleted.
    assert.equal(await ask('never-committed.tflw'), 'untracked', 'an uncommitted file in a repository is NOT recoverable');
  } finally {
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('`M218` `B3`: `New file here` opens in the folder it was asked from (`D1159`)', async () => {
  // **Two folders, and neither is the dialog's default.** Checked first on the live page against
  // `tests/`, whose name is also the default the field has always carried — so the right answer and
  // a prop doing nothing produce the identical string, and the observation established nothing.
  // It turned out to be establishing nothing about a prop that really was unused: `inDir` was
  // destructured and never read, and this gate is what said so.
  //
  // The foot's own `+ new file` is asserted too, because `startCreating` exists for it: a create
  // opened from the foot must not inherit the folder a menu last used.
  await withProjectFixture(
    { 'suites/a.tflw': ['test "a"', '  api GET /a', '  expect status equals 200', ''].join('\n'),
      'flows/b.tflw': ['test "b"', '  api GET /b', '  expect status equals 200', ''].join('\n') },
    async (p, base) => {
      await openClean(p, `${base}/?token=${TOKEN}#/api/compose/suites/a.tflw/L1`);

      for (const folder of ['suites', 'flows']) {
        await openMenu(p, `[data-dir-toggle="${folder}"]`);
        await p.locator('.ctx-menu [data-menu-item="new-file-here"]').click();
        await p.locator('[data-new-file]').waitFor({ state: 'visible' });
        assert.equal(await p.locator('[data-new-file]').inputValue(), `${folder}/new.tflw`);
        await p.locator('[data-new-cancel], [data-file-action-cancel]').first().click().catch(async () => { await p.keyboard.press('Escape'); });
        await p.locator('[data-new-file]').waitFor({ state: 'detached' });
      }

      // The foot's `+ new file` lives at the bottom of the explorer and can sit below the fold.
      const foot = p.locator('[data-compose-new-file]').first();
      await foot.scrollIntoViewIfNeeded();
      await foot.click();
      await p.locator('[data-new-file]').waitFor({ state: 'visible' });
      assert.equal(await p.locator('[data-new-file]').inputValue(), 'tests/new.tflw', 'the foot inherits no folder');
    },
  );
});

test('`M218` `E4`: a draft follows its file across a rename (`D1155`)', async () => {
  await withProjectFixture(IMPORTED, async (p, base) => {
    await openClean(p, `${base}/?token=${TOKEN}#/api/compose/tests/lonely.tflw/L1`);
    // Make a pending edit that exists only in the page.
    await p.locator('[data-seq-add="request"]').click();
    await p.locator('[data-file-unsaved="tests/lonely.tflw"]').waitFor({ state: 'visible' });

    await openMenu(p, '[data-file-row="tests/lonely.tflw"]');
    await p.locator('.ctx-menu [data-menu-item="rename"]').click();
    await p.locator('[data-file-action="move"]').waitFor({ state: 'visible' });
    await p.locator('[data-action-to]').fill('tests/renamed.tflw');
    await p.locator('[data-action-go="move"]').click();
    await p.locator('[data-file-action]').waitFor({ state: 'detached' });

    // The dot is the page's own claim that bytes are pending, and it has to have moved with them.
    await p.locator('[data-file-unsaved="tests/renamed.tflw"]').waitFor({ state: 'visible' });
    assert.equal(await p.locator('[data-file-unsaved="tests/lonely.tflw"]').count(), 0, 'and is not left behind on a path nothing opens');
  });
});

test('`M218` `F1`: duplicating a request copies its statements with it (`D1156`)', async () => {
  await withProjectFixture({ 'a.tflw': CHAINED }, async (p, base) => {
    await openClean(p, `${base}/?token=${TOKEN}#/api/compose/a.tflw/L1`);
    // Wait for the column before counting it: a count taken on an unrendered page is `0`, which
    // made this read `4 !== 1` and look like a duplicate that had added four requests.
    await p.locator('[data-seq-request]').first().waitFor();
    const before = await p.locator('[data-seq-request]').count();
    await openMenu(p, '[data-seq-line="2"]');
    await p.locator('.ctx-menu [data-menu-item="duplicate"]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'visible' });
    assert.equal(await p.locator('[data-seq-request]').count(), before + 1, 'one more request');

    // The copy carries the two statements attached to the original, and the original keeps its own.
    const rows = await p.locator('[data-seq-line]').evaluateAll((els) =>
      els.map((e) => `${e.getAttribute('data-seq-row')}`));
    // `request, ExpectStmt, CaptureStmt` twice over, back to back.
    const joined = rows.join(',');
    assert.ok(
      joined.includes('request,ExpectStmt,CaptureStmt,request,ExpectStmt,CaptureStmt'),
      `the copy brought its attachments: ${joined}`,
    );
  });
});

test('`M218` `F2`: duplicating changes no existing assertion’s response (`D1138`, `D1156`)', async () => {
  await withProjectFixture({ 'a.tflw': CHAINED }, async (p, base) => {
    await openClean(p, `${base}/?token=${TOKEN}#/api/compose/a.tflw/L1`);
    const before = responseReaders(CHAINED);
    // Duplicate the FIRST request — the position where a copy landing without its statements
    // would re-point the originals, which is the whole hazard.
    await openMenu(p, '[data-seq-line="2"]');
    await p.locator('.ctx-menu [data-menu-item="duplicate"]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'visible' });
    await p.locator('[data-tab="source"]').click();
    const after = await p.locator('[data-compose-source], .source-text, pre').first().innerText();
    const lost = keepsEveryReader(before, responseReaders(after));
    assert.equal(lost, null, `this pair stopped being true: ${lost}`);
  });
});

// ── `M225` — what `send` sends, and a composer that says what it is ──────────────────────────
//
// Two defects the user found driving `M224`'s own LOAD corpus on the served page, and they are one
// round because they are the same failure twice: **a control that does not say what it does.**
//
// Gate 1 of the pair: `send` on a declaration issued the FIRST request and nothing else, whatever
// the test held — `addressed()` resolves a line above every request to `requests[0]` (`D1080`),
// which is right for navigation and was deciding what a press fired. On a real rung — lookup,
// capture, the contended POST — pressing send under the test's own name sent the lookup and never
// the checkout, which is the request the rung exists to measure.
//
// Gate 2 of the pair: **after that send the panel holding the button still said it had not
// happened.** `.response-none` stayed on screen reading *"nothing has run this request"* — the
// exact sentence the press had just falsified — because `sentRan` was keyed on the request's line
// while the selected row was the declaration's.
test('`M225` `A`/`B`: send all issues every request, indexes every one, and the panel stops denying it', async () => {
  const fixtureServer = (await import(pathToFileURL(join(root, 'server.mjs')).href)) as { startFixtureServer: (port: number) => Promise<Server> };
  const target = await fixtureServer.startFixtureServer(fixturePort);
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m225-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const p = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', `  api "http://127.0.0.1:${fixturePort}"`, ''].join('\n'));
    await writeFile(
      join(dir, 'm225.tflw'),
      [
        '# a rung with two endpoints, which is the shape `send` could not address',
        '',
        'before',
        '  api GET /items',
        '',
        // **The workload is here because the composer is half of this round** — and because a
        // declaration that carries one is exactly the address whose send was broken.
        'test "the rung"',
        '  run 2 iterations across 1 users',
        '  api GET /items',
        '  expect status equals 200',
        '  capture body.items[0].id as first',
        '  api GET /items/{first}',
        '  expect status equals 200',
        '  threshold p95 duration is less than 5000ms',
        '  threshold error rate is less than 100%',
        '',
        // The control for gate 6: one request, so the ordinary panel must not grow a strip.
        'test "one endpoint"',
        '  api GET /items',
        '  expect status equals 200',
        '',
      ].join('\n'),
    );
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;

    // ── The declaration address ───────────────────────────────────────────────────────────────
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/m225.tflw/L6`);
    await p.locator('[data-band-workload-edit]').waitFor();

    // **GATE 11 — every control in the composer speaks in the page's own voice.**
    // Mutation: leave one `title`. The measurement that opened this round was 25 controls in this
    // block, 0 with `data-tip`, 16 with `title` and 3 with nothing at all — and page-wide, all
    // sixteen of the page's `title`s were inside it.
    /* `M222-01`, fourth occurrence in this file: the callback is inline, because `tsx --keepNames`
       wraps a `const`-bound arrow in `__name(...)` and the page has no such function. And
       `document` is reached through an element, because `tsconfig.test.json` carries
       `types: ["node"]` with no DOM lib. */
    const tips = await p.locator('body').evaluate((body) => {
      const doc = body.ownerDocument;
      const blocks = [...doc.querySelectorAll('.workload-edit, [data-threshold]')];
      const controls = blocks.flatMap((b) => [...b.querySelectorAll('button, input, select')]);
      return {
        controls: controls.length,
        tipped: controls.filter((c) => (c.getAttribute('data-tip') ?? c.closest('label')?.getAttribute('data-tip') ?? '').trim().length > 0).length,
        titled: doc.querySelectorAll('.workload-edit [title], [data-threshold] [title]').length,
        pageTitles: doc.querySelectorAll('[title]').length,
      };
    });
    assert.ok(tips.controls >= 20, `the block has ${tips.controls} controls — that is not the composer`);
    assert.equal(tips.tipped, tips.controls, 'every control in the composer and its thresholds carries the page\'s own tip');
    assert.equal(tips.titled, 0, 'not one native `title` is left in the block that was the only user of them');
    assert.equal(tips.pageTitles, 0, 'and the page as a whole has stopped using the OS tooltip');

    // **GATE 12's on-page half** — a cell's tip is not its row label plus its column label.
    const cell = await p.locator('[data-shape-cell="spike:rps"]').getAttribute('data-tip');
    assert.ok((cell ?? '').length > 40, `the cell that picks the shape says "${cell}"`);
    assert.notEqual(cell, 'spike rps');

    // **GATE 14 — the clause says the language's own spelling.**
    // Mutation: restore `type.replace(/Workload$/, '')`, which read `SharedIterations` here.
    assert.equal((await p.locator('[data-band-workload-words]').textContent())?.trim(), 'run iterations');

    // `D1220`'s sentence and `D1221`'s citation are both on screen, and the citation is a fact
    // rather than a blank — nothing has run this file. **GATE 15's on-page half.**
    assert.match((await p.locator('[data-workload-says]').textContent()) ?? '', /iterations in total/);
    await p.locator('[data-workload-did]').waitFor();
    assert.equal(await p.locator('[data-workload-did]').getAttribute('data-workload-did'), 'never');
    assert.match((await p.locator('[data-workload-did]').textContent()) ?? '', /not run here yet/);

    // ── The press ─────────────────────────────────────────────────────────────────────────────
    await p.locator('[data-compose-region2-tab="response"]').click();
    await p.locator('[data-prefix]').waitFor();

    // **GATE 4's on-page half, and the whole of §1.1** — on a declaration there is no *this*, so
    // only `send all` is offered and the button stops silently meaning `requests[0]`.
    assert.equal(await p.locator('[data-compose-send="this"]').count(), 0, 'a declaration has no *this* to send');
    assert.equal(await p.locator('[data-compose-send="all"]').count(), 1);
    // Three requests: the hook's, and both of this test's — which is what the old press did not do.
    assert.equal(await p.locator('[data-prefix]').getAttribute('data-prefix'), '3');
    assert.match((await p.locator('[data-compose-send="all"]').textContent()) ?? '', /send all — 3 requests/);

    await p.locator('[data-compose-send="all"]').click();
    await p.locator('[data-compose-response]').waitFor({ timeout: 30_000 });

    // **GATE 7 — `.response-none` is gone after a send at the declaration address.**
    // Mutation: key the empty state on the row again. That is what shipped, and it is why the
    // panel went on reading *nothing has run this request* after a press that had just run two.
    assert.equal(await p.locator('.response-none').count(), 0, 'the panel is still denying the send');
    assert.equal(await p.locator('[data-compose-responsebox]').getAttribute('data-compose-responsebox'), 'yes');

    // **GATE 5 — one strip entry per request issued, and the FIRST is selected.**
    // Mutation: select the last. An iteration is read in the order it ran; the argument for the
    // last (a rung's final POST is what the test exists to measure) is recorded in the plan and
    // lost to that.
    const strip = p.locator('[data-compose-sendstrip]');
    await strip.waitFor();
    assert.equal(await strip.getAttribute('data-compose-sendstrip'), '2', 'the hook is not a row in this file');
    const entries = await p.locator('[data-compose-sendstrip-entry]').evaluateAll((els) =>
      els.map((e) => ({ text: e.textContent!.replace(/\s+/g, ' ').trim(), on: e.getAttribute('aria-pressed') })));
    assert.equal(entries.length, 2);
    assert.equal(entries[0]!.on, 'true', 'the first entry is the one showing');
    assert.equal(entries[1]!.on, 'false');
    assert.match(entries[0]!.text, /^GET \/items 200$/);
    assert.match(entries[1]!.text, /^GET \/items\/\{first\} 200$/);

    // **GATE 8 — the strip header names the press and its age.**
    // Mutation: drop the press name. The panel states its own provenance rather than leaving a
    // reader to infer it from a status code.
    const head = (await p.locator('[data-compose-sendstrip-head]').textContent()) ?? '';
    assert.match(head, /send all/);
    assert.match(head, /2 requests/);
    assert.match(head, /\d+[smhd] ago/);

    // **GATE 2's on-page half — a send indexes every request it issued, not one.**
    // Both request rows light with their statuses; before this round only the last one did.
    const badges = await p.locator('[data-seq-status]').evaluateAll((els) => els.map((e) => e.textContent!.trim()));
    assert.deepEqual(badges, ['200', '200'], 'both requests the press issued carry their verdict');

    // **GATE 9 — the row whose response is showing is marked, and the mark is not the selection's.**
    // Mutation: make the two styles equal. `M223` `G` is this project's record of a token that
    // named a state being spent as a tone, so this reads computed style rather than a class name.
    const marks = await p.locator('[data-seq-status]').evaluateAll((els) =>
      els.map((e) => {
        const s = e.ownerDocument.defaultView!.getComputedStyle(e);
        return { showing: e.getAttribute('data-seq-showing'), bg: s.backgroundColor, fg: s.color, border: s.borderTopWidth };
      }));
    assert.deepEqual(marks.map((m) => m.showing), ['yes', 'no'], 'exactly one row is the one being read');
    assert.notEqual(marks[0]!.bg, marks[1]!.bg, 'the showing badge is solid and the other is outlined');
    assert.notEqual(marks[0]!.fg, marks[1]!.fg);
    assert.ok(marks.every((m) => m.border !== '0px'), 'both are chips, so the fill is a change of state and not of geometry');

    // **GATE 10 — and the mark is NOT in the gutter.**
    // Mutation: add an accent-hued inset on `.seq-row`. `D1200` closed a measured collision of two
    // accent marks 4.9 px apart in an 18 px gutter with *in this gutter the accent is the
    // selection's alone* — and on this address the selection is deliberately still the `test` row.
    const gutters = await p.locator('[data-seq-request]').evaluateAll((els) =>
      els.map((e) => e.ownerDocument.defaultView!.getComputedStyle(e.querySelector('.seq-row')!).boxShadow));
    assert.equal(new Set(gutters).size, 1, `a request the reader has not selected grew a gutter mark: ${gutters.join(' | ')}`);

    // ── Moving the strip ──────────────────────────────────────────────────────────────────────
    await p.locator('[data-compose-sendstrip-entry="1"]').click();
    await p.locator('[data-compose-response-line="11"]').waitFor();
    assert.deepEqual(
      await p.locator('[data-seq-status]').evaluateAll((els) => els.map((e) => e.getAttribute('data-seq-showing'))),
      ['no', 'yes'],
      'the mark follows the body, which is the whole point of it',
    );
    // And choosing an entry moved nothing in region 1: the composer is still on screen, which is
    // what `D1042` forbids making door-dependent and what a navigation would have cost.
    assert.equal(await p.locator('[data-band-workload-edit]').count(), 1, 'the composer left the screen');

    // **GATE 18 — region 2's response body box is >= 120 px at 900, for all three shapes.**
    // Mutation: add a line to region 1 without moving the ratio. `M225` §1.11 measured the box at
    // 112-127 px BEFORE this round added two lines above it and a strip inside it, and `D1223`
    // makes that a stated budget rather than a hope.
    //
    // **It is measured with a response IN the box**, which the first draft did not do and the run
    // caught: switching to `spike` turns one workload line into a three-line block, every request
    // below it moves, and `D1093`'s `(line, source)` join correctly drops every verdict — so the
    // first draft measured region 2 *empty* and called it the budget. The shape is written and the
    // press repeated for each one, which is what a reader working on that shape actually has.
    for (const shape of ['spike:users', 'ramp:users', 'hold:rps'] as const) {
      await p.locator(`[data-shape-cell="${shape}"]`).click();
      await p.locator(`[data-band-workload-edit="${shape.split(':')[0]}"]`).waitFor();
      await p.locator('[data-compose-write]').click();
      await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
      await p.locator('[data-compose-send="all"]').click();
      await p.locator('[data-compose-sendstrip]').waitFor({ timeout: 30_000 });
      /* `M222-01`, and it bit inside this very block. The first draft lifted the repeated
         `querySelector(...).height` into a `const q = (sel) => …` one line up — and `tsx
         --keepNames` wraps a const-bound arrow in `__name(...)`, which does not exist in the page,
         so the probe threw `ReferenceError` and graded as a failure of the code. Fourth occurrence
         in this file. Inline, however repetitive it reads. */
      /**
       * **What `D1223` budgets is region 2's box, and the instrument had to be corrected to say
       * so.** The first draft measured the intersection of the response body with the box and
       * asserted 120 px of it — and the run answered **0 px at 112 and 0 px at 240**, because the
       * body sits below the tick list by `D1100`'s own design and `.ticks` alone is `max-height:
       * 30vh`. A response body fully visible without a scroll is not a property this panel has
       * ever had and is not what this round changed. Recorded rather than massaged.
       *
       * So the claim is `D1223`'s own — region 2 is at least 120 px — plus the one the strip
       * makes newly checkable: **the strip and the response's provenance line are inside the box
       * without a scroll.** At the old 112 px floor they were not, which is the defect.
       */
      const geo = await p.locator('.editor-col').evaluate((col) => {
        const box = col.querySelector('.responsebox')!.getBoundingClientRect();
        const strip = col.querySelector('.sendstrip')?.getBoundingClientRect() ?? null;
        const head = col.querySelector('.response-head-bar')?.getBoundingClientRect() ?? null;
        return {
          col: Math.round(col.getBoundingClientRect().height),
          box: Math.round(box.height),
          strip: strip === null ? -1 : Math.round(strip.height),
          /** How far the provenance line's bottom is above the box's — negative means clipped. */
          headRoom: head === null ? -1 : Math.round(box.bottom - head.bottom),
          composer: Math.round(col.querySelector('.workload-edit')?.getBoundingClientRect().height ?? -1),
          editorScrolls: col.querySelector('.editor')!.scrollHeight > col.querySelector('.editor')!.clientHeight,
        };
      });
      assert.ok(geo.strip > 0, `${shape}: the strip is not on screen, so this is not the state D1223 is about`);
      assert.ok(geo.box >= 120, `${shape}: region 2 is ${geo.box} px, under D1223's 120 px floor — ${JSON.stringify(geo)}`);
      assert.ok(geo.headRoom > 0, `${shape}: the strip and the response's own header do not fit in region 2 — ${JSON.stringify(geo)}`);
      const overflow = await p.locator('main').evaluate((main) => main.scrollHeight - main.clientHeight);
      assert.ok(overflow <= 1, `${shape}: main overflows by ${overflow} px`);
    }

    // ── GATE 6 — with one request the panel has no strip control ──────────────────────────────
    // Mutation: render a one-entry strip. This is the common case — the whole LOAD corpus but one
    // test, and every functional test in the sibling — so the ordinary path must not grow a
    // control for a press already on screen.
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/m225.tflw/L16`);
    await p.reload();
    await p.locator('[data-prefix]').waitFor();
    // A one-request test at its own declaration: `send all` alone, because there is no *this*.
    assert.equal(await p.locator('[data-compose-send]').count(), 1);
    assert.equal(await p.locator('[data-compose-send="all"]').count(), 1);
    await p.locator('[data-compose-send]').click();
    await p.locator('[data-compose-response]').waitFor({ timeout: 30_000 });
    assert.equal(await p.locator('[data-compose-sendstrip]').count(), 0, 'one request, one response, no control');
    assert.equal(await p.locator('.response-none').count(), 0);

    // And ON that one request, `send all` is suppressed too, because it would fire the same
    // press. **`upTo` was the first draft's test for that and the run caught it**: `send all` runs
    // to the end of the body and `send this` stops at the request, so on a test whose last line is
    // an `expect` the two cuts differ by a step and issue the same request — two buttons, one
    // press. The comparison is the requests issued.
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/m225.tflw/L17`);
    await p.reload();
    await p.locator('[data-compose-send="this"]').waitFor();
    assert.equal(await p.locator('[data-compose-send]').count(), 1, 'a one-request test offers one press wherever you stand in it');

    // ── GATE 3's on-page half — `send this` is untouched ───────────────────────────────────────
    //
    // On the FIRST request the two presses differ, so both are offered: `this` runs the hook and
    // one request, `all` runs the hook and both.
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/m225.tflw/L8`);
    await p.reload();
    await p.locator('[data-prefix]').waitFor();
    assert.equal(await p.locator('[data-compose-send="this"]').count(), 1, 'a request address has a *this*');
    assert.equal(await p.locator('[data-compose-send="all"]').count(), 1, 'and an *all*, because there is more of the test below');
    assert.equal(await p.locator('[data-prefix]').getAttribute('data-prefix'), '2', 'the prefix up to the first request is the hook and it');

    // On the LAST request they coincide — same requests, same press — so `all` is suppressed and
    // the pane offers the one button it has always offered. **The run caught this assertion being
    // wrong before it caught any code being wrong**, which is the right order.
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/m225.tflw/L11`);
    await p.reload();
    await p.locator('[data-prefix]').waitFor();
    assert.equal(await p.locator('[data-compose-send="this"]').count(), 1);
    assert.equal(await p.locator('[data-compose-send="all"]').count(), 0, 'the last request is the whole test, and one press is one button');
    assert.equal(await p.locator('[data-prefix]').getAttribute('data-prefix'), '3', 'the prefix up to the second request is unchanged');
  } finally {
    await p.close();
    await ui.close();
    await new Promise<void>((resolve) => target.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

// ── `M225` `H` — no scroller in region 2 sits inside another one (`D1224`) ────────────────────
//
// The user's report, driving the LOAD corpus on the served page: *"this double scroll pane I
// mean — it can lead to a messy scroll situation"*, with the suggestion that moving the region to
// a footer would settle it.
//
// It would not, and measuring said why. `.responsebox` scrolled, and so did both things it can
// hold: `.preview` caps itself at `40vh` and `.ticks` at `30vh`, each with its own `overflow:
// auto`. On the live page at 1440x900 with a 100-item catalogue response the box was 399 px of
// viewport over **585 px** of content and the `pre` inside it 380 px over **30 732 px** — two
// bars, and which one a wheel moved depended on where the pointer happened to be.
//
// **The outer 186 px of overflow was manufactured by the inner cap.** The `pre`'s 360 px frame
// was laid out with no knowledge of how much of the box was left — the box ran y 359 → 759, the
// `pre` y 542 → 924 — so the box had to scroll to reach the bottom edge of a thing that was
// itself scrolling. That is a containment relationship, which is why the footer would not have
// touched it and why a TALLER region makes it worse: the box grows, the cap does not, and what
// opens up between them is dead space.
//
// So this gate is about nesting and not about counting. Two scrollers side by side are legible —
// the pointer is unambiguously in one of them. A scroller inside a scroller is the defect, and
// the property has a name: **nothing in region 2 has a scrolling ancestor.**
//
// It is taken in all four states the region has tenants for, because a rule checked in the state
// that motivated it is the vacuity `M223` `F` recorded: `.session-panel` already had the right
// shape of its own (`.session-lines` is its own scroller) and was nested inside this box's the
// whole time, which is the same defect on the BROWSER door with nobody to report it.
test('`M225` `H`: region 2 never nests one scroller inside another, in any of its four states', async () => {
  const fixtureServer = (await import(pathToFileURL(join(root, 'server.mjs')).href)) as { startFixtureServer: (port: number) => Promise<Server> };
  const target = await fixtureServer.startFixtureServer(fixturePort);
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m225h-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const p = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', `  api "http://127.0.0.1:${fixturePort}"`, ''].join('\n'));
    await writeFile(
      join(dir, 'm225h.tflw'),
      [
        // A workload so region 2 is segmented (`D1209`) and the `plan` tenant is reachable, and a
        // body long enough that the `pre` really overflows — a gate whose subject fits is green
        // under every mutation, which is `M224`'s control lesson in one line.
        'test "the long one"',
        '  run 2 iterations across 1 users',
        '  api GET /items',
        '  expect status equals 200',
        '  threshold p95 duration is less than 5000ms',
        '',
      ].join('\n'),
    );
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;

    /* One reading, taken four times.
       **`M222-01`, fifth occurrence in this file, and it nearly landed again**: every callback
       below is passed inline as an argument and none is bound to a `const`, because `tsx
       --keepNames` wraps a `const`-bound arrow in `__name(...)` and the page has no such
       function. The first draft of this gate hoisted the *does it scroll* test into a
       `const scrolls = (el) => …` at the top of the `evaluate`, which is the identical shape
       that broke `M225`'s own measuring probe. And the test tsconfig carries `types: ["node"]`
       with no DOM lib, so nothing here names a DOM type and the window is reached through the
       element (`box.ownerDocument.defaultView`). */
    const scan = async (): Promise<{ nested: string[]; boxScrolls: boolean; clipped: string[]; scrollers: number }> =>
      p.locator('.responsebox').evaluate((box) => {
        const win = box.ownerDocument.defaultView!;
        const scrolling = [box, ...box.querySelectorAll('*')].filter((el) => {
          const cs = win.getComputedStyle(el);
          return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1;
        });
        const nested = scrolling.flatMap((el) => {
          for (let up = el.parentElement; up !== null && up !== box.parentElement; up = up.parentElement) {
            if (scrolling.some((other) => other === up)) return [`${String(el.className)} inside ${String(up.className)}`];
          }
          return [];
        });
        /* Clipped by the box and NOT inside a scroller of its own — i.e. genuinely unreachable,
           as opposed to merely scrolled out of view, which is what the body's own syntax tokens
           are. Without that second half this reads the response's every highlighted span. */
        const edge = box.getBoundingClientRect().bottom;
        const clipped = [...box.querySelectorAll('*')].filter((el) => {
          if (el.getBoundingClientRect().bottom <= edge + 1) return false;
          for (let up = el.parentElement; up !== null && up !== box.parentElement; up = up.parentElement) {
            if (scrolling.some((other) => other === up)) return false;
          }
          return true;
        }).map((el) => String(el.className)).slice(0, 4);
        return { nested, boxScrolls: scrolling.some((el) => el === box), clipped, scrollers: scrolling.length };
      });

    // ── state 1: the empty state, before anything has been sent ──────────────────────────────
    await p.goto(`${base}/?token=${TOKEN}#/load/compose/m225h.tflw/L3`);
    await p.locator('[data-prefix]').waitFor();
    let seen = await scan();
    assert.deepEqual(seen.nested, [], 'the empty state nests nothing');
    assert.deepEqual(seen.clipped, [], 'and reaches everything it draws');

    // ── state 2: the plan segment ────────────────────────────────────────────────────────────
    await p.locator('[data-compose-region2-tab="plan"]').click();
    await p.locator('[data-compose-plan]').waitFor();
    seen = await scan();
    assert.deepEqual(seen.nested, [], 'the plan nests nothing');
    assert.deepEqual(seen.clipped, [], 'and the plot is not clipped by a box that cannot scroll');

    // ── state 3: a real response, which is the state the user reported ───────────────────────
    await p.locator('[data-compose-region2-tab="response"]').click();
    await p.locator('[data-compose-send="this"]').click();
    await p.locator('[data-compose-response-body]').waitFor();
    seen = await scan();
    assert.equal(seen.boxScrolls, false, 'region 2 lays its tenant out; it does not scroll it');
    assert.deepEqual(seen.nested, [], 'and the body scrolls with no scrolling ancestor above it');
    assert.deepEqual(seen.clipped, [], 'nothing outside the body is cut off by the box');

    /* **The body really is longer than its window** — without this the claim above is a claim
       about a `pre` that fits, which every arrangement satisfies. This is the unmutated control
       `M224` cost us for not having.

       **The margin is absolute and was a ratio** (`M227` `E`). `scroll > client * 2` is a claim
       about the page's total height, not about this `pre`: the fixture's body is a fixed 350 px
       and the window is whatever `1fr` leaves, so the control's strength moved every time anything
       else on the page changed size. `D1236` took the notice out of an empty stage, the region
       shrank 73 -> 17, region 2 gained those 56 px, the window went 175 -> 180 and the ratio fell
       through 2.0 with the body unchanged. What the control needs to assert is that the `pre`
       overflows by enough rows to be worth scrolling — which is a distance, and does not move. */
    const body = await p.locator('[data-compose-response-body]').evaluate((pre) => ({ client: pre.clientHeight, scroll: pre.scrollHeight }));
    assert.ok(body.scroll > body.client + 120, `the body is ${body.scroll} over ${body.client} — a gate on a body that fits proves nothing`);

    /* **And the divider now changes how much of it you see.** Before `D1224` it did not: dragging
       gave the box more height while `.preview` stayed pinned at `40vh`, so the drag grew a frame
       around a porthole. This asserts the fix's *point*, not just the absence of the defect. */
    const before = body.client;
    const split = p.locator('.split');
    const at = (await split.boundingBox())!;
    await p.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await p.mouse.down();
    await p.mouse.move(at.x + at.width / 2, at.y - 120, { steps: 10 });
    await p.mouse.up();
    await p.locator('[data-compose-response-body]').waitFor();
    const after = await p.locator('[data-compose-response-body]').evaluate((pre) => pre.clientHeight);
    assert.ok(after > before + 40, `dragging the divider up gave the body ${after} px, from ${before} — the drag must move the body, not a frame around it`);
    assert.deepEqual((await scan()).nested, [], 'and it is still one scroller after the drag');
  } finally {
    await p.close();
    await ui.close();
    await new Promise<void>((resolve) => target.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

// ── `M226` `A` — region 2 goes to the foot when the declaration carries a workload (`D1225`) ──
//
// The other half of the user's original suggestion. `M225` `H` settled how many scrollbars are in
// region 2 and said, correctly, that moving the region would not have fixed that. This is the part
// moving it DOES fix, and it is a width: the response body's longest line wants **871 px** and had
// **699** under the editor column, so it scrolled sideways as well as down.
//
// **The axis is the construct and not the door** (`D1044`, and `D1209`'s axis one round earlier),
// because the measurement is what chose it: `.editor` on a workload declaration wants 537–568 px
// and gets 471–493, and **no other door is squeezed at all** — so a declaration carrying a workload
// is a different shape of thing, with the tallest editor on the page and, being a rung, three rows
// of sequence beside it in every corpus file.
//
// So gate 2 is taken **on the API door**, on one file, comparing a workload declaration with a
// functional one four lines away. On LOAD the door and the construct agree and every mutation that
// made this door-granted would pass; here they disagree, which is the only place the claim is
// falsifiable. That is `M223` `F`'s vacuity lesson, and `D1209` is where this round learned it.
test('`M226` `A`: a workload declaration puts region 2 at the foot of the pane, and the construct is what decides', async () => {
  const fixtureServer = (await import(pathToFileURL(join(root, 'server.mjs')).href)) as { startFixtureServer: (port: number) => Promise<Server> };
  const target = await fixtureServer.startFixtureServer(fixturePort);
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m226-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const p = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', `  api "http://127.0.0.1:${fixturePort}"`, ''].join('\n'));
    /* **Both declarations in ONE file, on the API door.** Two files would let a mutation keyed on
       the file pass, and two doors would let one keyed on the door pass. */
    await writeFile(
      join(dir, 'm226.tflw'),
      [
        'test "carries a workload"',
        '  run 2 iterations across 1 users',
        '  api GET /items',
        '  expect status equals 200',
        '  threshold p95 duration is less than 5000ms',
        '',
        'test "carries none"',
        '  api GET /items',
        '  expect status equals 200',
        '',
      ].join('\n'),
    );
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;

    const layout = async (): Promise<{ footer: string | null; region2W: number; editorW: number; editorH: number; editorWants: number; nested: number }> =>
      p.locator('.compose-pane-grid').evaluate((grid) => {
        const win = grid.ownerDocument.defaultView!;
        const box = grid.querySelector('.responsebox')!;
        const ed = grid.querySelector('.editor')!;
        const inner = [...box.querySelectorAll('*')].filter((el) => {
          const cs = win.getComputedStyle(el);
          if (!((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1)) return false;
          for (let up = el.parentElement; up !== null && up !== box.parentElement; up = up.parentElement) {
            const pc = win.getComputedStyle(up);
            if ((pc.overflowY === 'auto' || pc.overflowY === 'scroll') && up.scrollHeight > up.clientHeight + 1) return true;
          }
          return false;
        });
        return {
          footer: grid.getAttribute('data-compose-footer'),
          region2W: Math.round(box.getBoundingClientRect().width),
          editorW: Math.round(ed.getBoundingClientRect().width),
          editorH: Math.round(ed.getBoundingClientRect().height),
          editorWants: ed.scrollHeight,
          nested: inner.length,
        };
      });

    // ── GATES 1 + 2 — the workload declaration, on the API door ──────────────────────────────
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/m226.tflw/L1`);
    await p.locator('[data-compose-footer]').waitFor();
    const withLoad = await layout();
    assert.equal(withLoad.footer, 'yes', 'a declaration carrying a workload draws region 2 at the foot');
    assert.ok(
      withLoad.region2W > withLoad.editorW + 100,
      `region 2 is ${withLoad.region2W} px against an editor of ${withLoad.editorW} — the point of the move is that it is WIDER than the column it left`,
    );

    // ── GATE 3 — the functional declaration, SAME FILE, SAME DOOR ────────────────────────────
    /* This is the assertion the round exists to make falsifiable. A branch reading `door === 'load'`
       satisfies every other line in this test and fails here, because here the door says LOAD-ish
       nothing and only the declaration differs. */
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/m226.tflw/L7`);
    await p.reload();
    await p.locator('[data-compose-footer]').waitFor();
    const without = await layout();
    assert.equal(without.footer, 'no', 'a declaration with no workload keeps region 2 in the editor column — four lines away, same file, same door');
    assert.equal(without.region2W, without.editorW, 'and there it is exactly as wide as the editor above it');

    // ── GATE 4 — the move costs the editor no height ─────────────────────────────────────────
    /* The plan claimed the footer would give the editor its full content height. **It does not** —
       a footer is still a row, so the top track is the same arithmetic either way — and the gate
       says what is true instead: moving region 2 takes nothing from the editor. Asserted as a
       comparison between the two layouts in one run rather than against a constant, which is the
       only form that survives a theme, a font or a viewport changing. */
    assert.ok(
      Math.abs(withLoad.editorH - without.editorH) <= 4 || withLoad.editorH >= without.editorH,
      `the editor is ${withLoad.editorH} px in the footer layout against ${without.editorH} in the column layout — the move must not cost it height`,
    );

    // ── GATES 5 + 6 — a real send, in the footer layout ──────────────────────────────────────
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/m226.tflw/L3`);
    await p.reload();
    await p.locator('[data-compose-send]').first().click();
    await p.locator('[data-compose-response-body]').waitFor();
    const sent = await layout();
    assert.equal(sent.footer, 'yes', 'the request inside a workload test is still the workload test');
    assert.equal(sent.nested, 0, '`D1224` holds in the footer: nothing in region 2 has a scrolling ancestor');
    const body = await p.locator('[data-compose-response-body]').evaluate((pre) => ({
      w: Math.round(pre.getBoundingClientRect().width),
      scrollW: pre.scrollWidth,
      col: Math.round(pre.closest('.responsebox')!.getBoundingClientRect().width),
    }));
    assert.ok(body.w > 900, `the body is ${body.w} px wide — the footer's whole payout is width, and under the column it was 699`);

    // ── GATE 7 — the divider drags here, and remembers under its OWN key ─────────────────────
    /* Two keys because they hold different quantities: above the divider in this layout is the
       sequence column as well. One key would mis-restore on the first click between the two
       declarations above, which is a gesture this very test performs. */
    const split = p.locator('.split');
    const at = (await split.boundingBox())!;
    assert.ok(at.width > withLoad.editorW + 100, `the divider spans the pane (${Math.round(at.width)} px), because what it moves is the pane's split`);
    await p.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await p.mouse.down();
    await p.mouse.move(at.x + at.width / 2, at.y - 110, { steps: 10 });
    await p.mouse.up();
    await p.locator('[data-compose-response-body]').waitFor();
    const keys = await p.locator('body').evaluate((el) => {
      const win = el.ownerDocument.defaultView!;
      return { footer: win.localStorage.getItem('tflw.compose.footer'), editor: win.localStorage.getItem('tflw.compose.editor') };
    });
    assert.ok(keys.footer !== null, 'the drag wrote the footer layout\'s own height');
    assert.equal(keys.editor, null, 'and left the column layout\'s key alone — they are different quantities');
  } finally {
    await p.close();
    await ui.close();
    await new Promise<void>((resolve) => target.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

// ── `M227` — the footer earns its height, and speaks with one voice ──────────────────────────
//
// `M226` moved region 2 to the foot of the pane and measured the move as costing the editor
// nothing. It did not measure what the footer then HELD. Driving the served LOAD corpus at
// 1440x900 found the consequence, on `rate-shapes.tflw` `L13`:
//
//   `.responsebox`  112 px        — the EMPTY floor
//   `.plan-panel`   62 px of window for **312 px of content**
//   **18 elements entirely below the footer's own bottom edge** — the x-axis, the legend, both
//   sentences
//
// `D1223` gave region 2 two floors, 240 holding a response and 112 empty. A plan is a third
// tenant and was never given a number, so it fell through to 112. `D1229` keys the floor on the
// TENANT instead. Three more decisions follow from what the space is then used for: the plot is
// the region's height rather than a constant (`D1230`), the panel is two columns so `M226`'s
// width is spent rather than fought (`D1231`), the footer speaks at one size (`D1232`), the plan
// is drawn from zero because its height is a quantity somebody declared (`D1233`), and an
// iteration shape draws its work rather than sitting as one paragraph where every other shape has
// a figure (`D1234`).
//
// **Taken on the API door**, on one file, across four workload shapes and a functional control —
// `D1209`'s axis. On LOAD the door and the construct agree and every mutation that made this
// door-granted would pass; here they disagree, which is the only place the claim is falsifiable.
// That is `M223` `F`'s vacuity lesson.
//
// Every callback inside `page.evaluate` is passed INLINE. `tsx --keepNames` wraps a `const`-bound
// arrow in `__name(...)`, which the browser has no definition for — `M222-01`, and this is its
// fifth recurrence in this file's history.
test('`M227`: a plan-bearing footer gets the height it needs, draws from zero, and says it once', async () => {
  const fixtureServer = (await import(pathToFileURL(join(root, 'server.mjs')).href)) as { startFixtureServer: (port: number) => Promise<Server> };
  const target = await fixtureServer.startFixtureServer(fixturePort);
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m227-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const p = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', `  api "http://127.0.0.1:${fixturePort}"`, ''].join('\n'));
    /* One file, five declarations, on the API door. **`41 across 4` is deliberate**: it divides
       11/10/10/10, so gate 10 can tell a picture that shows the remainder from one that rounds it
       away. Four equal bars would have been green under both. */
    await writeFile(
      join(dir, 'm227.tflw'),
      [
        'test "a ramp"',                                  // L1
        '  ramp to 8 users over 4s',
        '  api GET /items',
        '  expect status equals 200',
        '  threshold error rate is less than 5%',
        '',
        'test "a steady hold"',                           // L7
        '  hold 4 users for 2s',
        '  api GET /items',
        '  expect status equals 200',
        '  threshold error rate is less than 5%',
        '',
        'test "work shared out"',                         // L13
        '  run 41 iterations across 4 users',
        '  api GET /items',
        '  expect status equals 200',
        '  threshold error rate is less than 5%',
        '',
        'test "work per user"',                           // L19
        '  run 10 iterations per user across 4 users',
        '  api GET /items',
        '  expect status equals 200',
        '  threshold error rate is less than 5%',
        '',
        'test "carries no workload"',                     // L25
        '  api GET /items',
        '  expect status equals 200',
        '',
      ].join('\n'),
    );
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;

    /* One read of the whole footer. No `const`-bound arrow crosses into the page (`M222-01`), and
       no DOM type name appears — `packages/cli/tsconfig.test.json` carries `types: ["node"]` and
       no DOM lib, so every annotation here would be `TS2304`. Inference through the chains does
       the work instead. */
    const geom = async (): Promise<{
      footer: string | null; tall: string | null; boxH: number; belowN: number; below: string[];
      cols: number; proseSizes: string[]; canvasH: number; canvasW: number; axes: number;
      shares: number[]; figW: number; wordsW: number;
    }> =>
      p.locator('.compose-pane-grid').evaluate((grid) => {
        const win = grid.ownerDocument.defaultView!;
        const box = grid.querySelector('.responsebox')!;
        const r = box.getBoundingClientRect();
        const panel = box.querySelector('.plan-panel');
        const cv = box.querySelector('canvas');
        const fig = box.querySelector('.plan-figure');
        const words = box.querySelector('.plan-words');
        /* **`bottom`, not `top`.** The first draft of this asked whether an element STARTED below
           the edge, which is how the defect was found (18 elements wholly below it) and is blind
           to the more common shape: something that starts inside the footer and ends past it. It
           reported a clean zero on a build whose uPlot legend hung 18 px over — see `Chart.tsx`'s
           `fit`. A clipping gate has to ask about the far edge. */
        const below = [...box.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().bottom > r.bottom + 1).map((el) => String(el.className || el.tagName));
        let cols = 0;
        if (panel !== null) cols = win.getComputedStyle(panel).gridTemplateColumns.trim().split(/\s+/).length;
        return {
          footer: grid.getAttribute('data-compose-footer'),
          tall: grid.getAttribute('data-compose-footer-tall'),
          boxH: Math.round(r.height),
          belowN: below.length,
          below: below.slice(0, 6),
          cols,
          /* `D1232` is about what the page SAYS, so the sample is the prose and the notes — a
             response body and `pre.preview` are what it SHOWS and keep their own sizes. */
          proseSizes: [...box.querySelectorAll('.plan-panel p, .response-none > p')].map((el) => win.getComputedStyle(el).fontSize),
          canvasH: cv === null ? 0 : Math.round(cv.getBoundingClientRect().height),
          canvasW: cv === null ? 0 : Math.round(cv.getBoundingClientRect().width),
          axes: box.querySelectorAll('.u-axis').length,
          shares: [...box.querySelectorAll('[data-share-count]')].map((el) => Number(el.getAttribute('data-share-count'))),
          figW: fig === null ? 0 : Math.round(fig.getBoundingClientRect().width),
          wordsW: words === null ? 0 : Math.round(words.getBoundingClientRect().width),
        };
      });

    /** Where the drawn curve sits in its own canvas, as a fraction from the top. The stroke is the
     *  only thing on this canvas — uPlot puts its axis values in the DOM — so the ink IS the
     *  series. */
    const ink = async (): Promise<{ top: number; bottom: number; rows: number }> =>
      p.locator('.responsebox canvas').evaluate((cv) => {
        const ctx = (cv as unknown as { getContext: (k: string) => { getImageData: (a: number, b: number, c: number, d: number) => { data: Uint8ClampedArray } } }).getContext('2d');
        const w = (cv as unknown as { width: number }).width;
        const h = (cv as unknown as { height: number }).height;
        const d = ctx.getImageData(0, 0, w, h).data;
        let minY = h;
        let maxY = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (d[i + 3]! < 8) continue;
            if (Math.abs(d[i]! - d[0]!) + Math.abs(d[i + 1]! - d[1]!) + Math.abs(d[i + 2]! - d[2]!) < 24) continue;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        return { top: minY / h, bottom: maxY / h, rows: maxY - minY + 1 };
      });

    const open = async (line: number, plan: string): Promise<void> => {
      await p.goto(`${base}/?token=${TOKEN}#/api/compose/m227.tflw/L${line}`);
      await p.locator('[data-compose-footer]').waitFor();
      if (plan !== '') await p.locator(`[data-compose-plan="${plan}"]`).waitFor();
      await p.waitForTimeout(250);
    };

    // ── GATE 1 — a plan-bearing footer opens at the tall floor, not the empty one ────────────
    await open(1, 'users');
    const ramp = await geom();
    assert.equal(ramp.footer, 'yes', 'a workload declaration is in the footer layout (`D1225`)');
    assert.equal(ramp.tall, 'yes', 'and the plan earns the tall floor (`D1229`)');
    assert.ok(ramp.boxH >= 240, `the footer opens at the plan's floor, not the empty one — ${ramp.boxH} px, was 112`);

    // ── GATE 2 — nothing in the plan panel is below the footer's own bottom edge ─────────────
    /* This is the user's defect stated as an assertion. It measured **18** before the round: the
       whole x-axis, the legend and both sentences, 250 px down a 62 px scroller. */
    assert.equal(ramp.belowN, 0, `nothing hangs below the footer's edge — found ${ramp.belowN}: ${ramp.below.join(', ')}`);

    // ── GATE 9a — the width is split, and the prose is the narrower half ─────────────────────
    assert.equal(ramp.cols, 2, `the plan panel is two columns at 1440 (\`D1231\`) — got ${ramp.cols}`);
    assert.ok(ramp.wordsW > 0 && ramp.wordsW < ramp.figW, `the prose column is the narrower one (${ramp.wordsW} against ${ramp.figW})`);
    assert.ok(ramp.canvasW > 400 && ramp.canvasW < 900, `and the plot stops spanning the pane — ${ramp.canvasW} px, was 1042`);

    // ── GATE 7 — every explanatory line in region 2 computes to 12 px ────────────────────────
    assert.ok(ramp.proseSizes.length >= 2, `there are sentences to measure (${ramp.proseSizes.length})`);
    assert.deepEqual([...new Set(ramp.proseSizes)], ['12px'], `one voice (\`D1232\`) — got ${[...new Set(ramp.proseSizes)].join(', ')}`);

    // ── GATE 9b — and it collapses at the page's own breakpoint, not a second one ────────────
    await p.setViewportSize({ width: 800, height: 900 });
    await p.waitForTimeout(250);
    assert.equal((await geom()).cols, 1, 'below 900 px the panel is one column, the same breakpoint `.app` and `.trace` already use');
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.waitForTimeout(250);

    // ── GATE 6 — a constant workload is drawn from zero ──────────────────────────────────────
    /* `hold 4 users for 2s` measured **8 ink rows of 180 at y 71-78** before the round — a
       hairline floating mid-panel against an axis reading about 3.9 to 4.1, which no amount of
       height fixes. Against a zero baseline the plan's own value IS the maximum, so the line sits
       near the top of its own plot. */
    await open(7, 'users');
    const hold = await ink();
    assert.ok(hold.top < 0.25, `the hold's line sits against its maximum, so the axis starts at zero (\`D1233\`) — ${(hold.top * 100).toFixed(1)}% down, was 41%`);

    // ── GATE 8 — the same sentence is the same size in both branches ─────────────────────────
    const sizeOfProse = async (): Promise<string> =>
      p.locator('[data-load-plot-prose]').first().evaluate((el) => el.ownerDocument.defaultView!.getComputedStyle(el).fontSize);
    await open(1, 'users');
    const rateSize = await sizeOfProse();
    await open(13, 'no-clock');
    const iterSize = await sizeOfProse();
    assert.equal(rateSize, iterSize, `planProse() is one function and renders at one size — rate ${rateSize}, iterations ${iterSize} (was 11px against 14px)`);
    assert.equal(iterSize, '12px');

    // ── GATES 10 + 11 — an iteration shape draws its work, and it is not a chart ─────────────
    const shared = await geom();
    assert.deepEqual(shared.shares, [11, 10, 10, 10], `41 shared across 4 shows the remainder, not four equal bars (\`D1234\`) — got ${shared.shares.join('/')}`);
    assert.equal(shared.canvasH, 0, 'it draws no canvas — there is no series and no axis to hang one on');
    assert.equal(shared.axes, 0, 'and no time axis, which is the fact `plannedCurve` returns `null` for');
    assert.equal(shared.cols, 2, 'and it enters the same two-column frame as every other shape');
    assert.equal(shared.belowN, 0, 'with nothing below the footer\'s edge');

    await open(19, 'no-clock');
    assert.deepEqual((await geom()).shares, [10, 10, 10, 10], '`10 per user across 4` is four equal shares — the other half of the pair');

    // ── GATE 2, THE UNMUTATED CONTROL — a functional declaration, clipping nothing ───────────
    /* A scan that returns zero for the wrong reason is `M224`'s coin. Here region 2 has no plan
       at all and must report zero for a different reason, which is what makes gate 2's zero mean
       something. */
    await open(25, '');
    const plain = await geom();
    assert.equal(plain.footer, 'no', 'a declaration with no workload is not in the footer layout at all (`D1225`)');
    assert.equal(plain.belowN, 0, 'and clips nothing either — the control beside gate 2');

    // ── GATE 3 — the EMPTY floor did not just go up ──────────────────────────────────────────
    /* The floor follows the tenant, so a workload declaration showing its RESPONSE segment with
       nothing sent is still the empty case. A mutation that made the floor unconditionally 240
       passes every gate above and dies here. */
    await open(1, 'users');
    await p.locator('[data-compose-region2-tab="response"]').click();
    await p.waitForTimeout(250);
    const empty = await geom();
    assert.equal(empty.tall, 'no', 'the response segment with nothing sent is the empty tenant (`D1229`)');
    /* **240 is the constant, and 200 was a margin** (`M227` `E`). The claim is *the floor did not
       become unconditionally `RESPONSE_MIN`*, and `RESPONSE_MIN` is 240; the region's actual height
       above that floor is whatever `1fr` hands down, which is not this gate's subject and moved
       when `D1236` gave the empty stage's 56 px back to the columns (219 px here, was under 200).
       A number chosen for headroom rather than from the rule is a number that goes red for a
       reason the rule does not care about. **The `tall` line above is what the mutation dies on**
       — measured, `'yes' !== 'no'` — and this one reads the rendered consequence beside it. */
    assert.ok(empty.boxH < 240, `so the footer is back on the short floor — ${empty.boxH} px against RESPONSE_MIN's 240`);

    // ── GATE 4 — the plot is the region's height, and the drag is what says so ───────────────
    await p.locator('[data-compose-region2-tab="plan"]').click();
    await p.locator('[data-compose-plan="users"]').waitFor();
    await p.waitForTimeout(250);
    const before = (await geom()).canvasH;
    const split = p.locator('.split');
    const at = (await split.boundingBox())!;
    await p.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await p.mouse.down();
    await p.mouse.move(at.x + at.width / 2, at.y - 180, { steps: 10 });
    await p.mouse.up();
    await p.waitForTimeout(300);
    const after = (await geom()).canvasH;
    assert.ok(after > before + 100, `the plot grew into the height the reader dragged for (\`D1230\`) — ${before} to ${after}, a constant would have stayed put`);
  } finally {
    await p.close();
    await ui.close();
    await new Promise<void>((resolve) => target.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

// ── `M227` `D` (`D1235`) — the footer yields to a live playback region ───────────────────────
//
// Found by the user on a populated BROWSER playback, and the picture was right while the ordering
// was untouched. `D1181` has put the Stage below both columns on **every** door since `M220`, and
// `M226` reordered nothing. What it did was make region 2 the same width as the Stage — measured
// on this door, `.responsebox` **753 -> 1072** with `.stage` already at 1072 — so two identical
// full-width bands stack and the upper one reads as the page's floor while the lower one is.
//
// The cost is measured, not aesthetic: a trace is **620 px** (`STAGE.fallback`), and on BROWSER
// the plan took **371** rather than its 240 floor, because that door's editor wants only 237 and
// `1fr` hands the slack downward. A third of the pane was a chart between the author and the
// thing the door exists for.
//
// **Keyed on the state, never the door.** *This pane has playback up* is true on LOAD the moment
// you press ▶ on a browser test and false on BROWSER until you do — so this gate PLAYS one, with
// the same declaration selected before and after. A door-keyed rule would be green under every
// mutation that made it state-keyed, and the other way round.
test('`M227` `D`+`E`: a trace takes the page\'s floor back from the footer (`D1235`), and the scratch notice closes the region rather than leading it (`D1236`)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m227d-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    /* The same arrangement `M223` `E` needs and for the same reason: with no `playwright-core`
       resolvable from the project there is no viewer to serve and no trace to put in it, so
       `readProject().traceViewer` is false and this gate would measure nothing. */
    await symlink(join(here, '..', '..', '..', 'node_modules'), join(dir, 'node_modules'), 'dir');
    await writeFile(
      join(dir, 'tflw.config'),
      ['env local default', `  web "http://127.0.0.1:${fixturePort}"`, `  api "http://127.0.0.1:${fixturePort}"`, ''].join('\n'),
    );
    /* **One file, both declarations.** Two files would reset `played` — it is cleared on a change
       of PATH and not of line — and the whole gate is that the same declaration reads differently
       before and after a trace lands. */
    await writeFile(
      join(dir, 'd.tflw'),
      [
        '@ui',                                  // L1
        'test "plays"',                         // L2
        '  open "/"',                           // L3
        '',                                     // L4
        'test "carries a workload"',            // L5
        '  ramp to 4 users over 2s',            // L6
        '  api GET /items',                     // L7
        '  expect status equals 200',           // L8
        '  threshold error rate is less than 5%', // L9
        '',
      ].join('\n'),
    );
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;

    /* `noticeTop` and `frameBottom` carry `E`. `dir` has no `.gitignore` at all, so `playIgnored`
       is false and the sentence is live for the whole run — which is what makes its ABSENCE before
       the play a reading rather than a vacancy, and its presence after is that control's proof. */
    const read = async (): Promise<{
      footer: string | null; boxW: number; stageW: number; stage: string | null;
      notices: number; noticeTop: number | null; frameBottom: number | null; barBottom: number | null;
    }> =>
      fresh.locator('.doorpane').evaluate((pane) => {
        const grid = pane.querySelector('.compose-pane-grid');
        const box = pane.querySelector('.responsebox');
        const st = pane.querySelector('[data-stage]');
        const note = pane.querySelector('[data-stage-unignored]');
        const frame = pane.querySelector('[data-stage-frame]');
        const bar = pane.querySelector('.stage-bar');
        return {
          footer: grid === null ? null : grid.getAttribute('data-compose-footer'),
          boxW: box === null ? 0 : Math.round(box.getBoundingClientRect().width),
          stageW: st === null ? 0 : Math.round(st.getBoundingClientRect().width),
          stage: st === null ? null : st.getAttribute('data-stage'),
          notices: pane.querySelectorAll('[data-stage-unignored]').length,
          noticeTop: note === null ? null : Math.round(note.getBoundingClientRect().top),
          frameBottom: frame === null ? null : Math.round(frame.getBoundingClientRect().bottom),
          barBottom: bar === null ? null : Math.round(bar.getBoundingClientRect().bottom),
        };
      });

    // ── BEFORE — nothing has been played, and the workload declaration takes the page's width ──
    await fresh.goto(`${base}/?token=${TOKEN}#/browser/compose/d.tflw/L5`);
    await fresh.locator('[data-compose-footer]').waitFor();
    await fresh.waitForTimeout(400);
    const before = await read();
    assert.equal(before.stage, 'empty', 'nothing has been played yet, which is what makes this the control');
    assert.equal(before.footer, 'yes', 'with an empty playback region the workload declaration still earns the footer (`D1225`)');
    assert.ok(before.boxW > before.stageW - 20, `and it really is the page's width — region 2 ${before.boxW}, stage ${before.stageW}`);
    /* `E`, first half — the OCCASION. Nothing has been played, so nothing has written the scratch,
       and the sentence about it is not drawn. It led the region in all four stage states before
       this slice, including this one, where the hint directly above it reads *press ▶ on a test to
       run it and watch it here*. */
    assert.equal(before.notices, 0, `an empty stage has written no scratch and says nothing about one — found ${before.notices}`);

    // ── Play the browser test, in the same file, so `played` survives the trip back ────────────
    await fresh.goto(`${base}/?token=${TOKEN}#/browser/compose/d.tflw/L2`);
    await fresh.locator('[data-seq-play="test"]').first().waitFor();
    await fresh.locator('[data-seq-play="test"]').first().click();
    let m = await read();
    for (let i = 0; i < 240 && m.stage !== 'trace'; i++) {
      await fresh.waitForTimeout(500);
      m = await read();
    }
    assert.equal(m.stage, 'trace', `no trace landed in two minutes, so this gate measured nothing — ${JSON.stringify(m)}`);

    // ── AFTER — the same declaration, and the page has one full-width band again ───────────────
    await fresh.goto(`${base}/?token=${TOKEN}#/browser/compose/d.tflw/L5`);
    await fresh.locator('[data-compose-footer]').waitFor();
    await fresh.waitForTimeout(400);
    const after = await read();
    assert.equal(after.stage, 'trace', 'the trace survived the trip back, so the two readings differ in one fact');
    assert.equal(after.footer, 'no', 'with playback up the footer yields and region 2 goes back to the editor column (`D1235`)');
    assert.ok(
      after.boxW < after.stageW - 200,
      `region 2 is the column's width again, not the page's — ${after.boxW} against the stage's ${after.stageW} (was ${before.boxW})`,
    );

    /* `E`, second half — the POSITION, and it is taken on the FAR edge for `M227` `A`'s reason: a
       rule reading `noticeTop > barBottom` is true of the shipped defect too, since the notice led
       the region from directly under the bar. The frame's BOTTOM is the only edge the two
       arrangements disagree about. `notices === 1` is the pair's own control: the project does not
       ignore `.play.tflw`, so a sentence that never appears at all would pass a position rule
       vacuously. */
    assert.equal(after.notices, 1, 'the play wrote the scratch, so the sentence is drawn once (`D1076`)');
    assert.ok(after.frameBottom !== null, 'a trace is up, so there is a frame to be below');
    assert.ok(
      after.noticeTop !== null && after.frameBottom !== null && after.noticeTop >= after.frameBottom - 1,
      `the notice closes the region instead of leading it — top ${after.noticeTop} against the frame's bottom ${after.frameBottom} and the bar's ${after.barBottom} (\`D1236\`)`,
    );
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

/* ── `M228` `A` — the authorization segment, and `TF060` in the pane's own diagnostics ─────────
   Four readings and two of them are controls, which is what `M224` cost us the hard way.

   **Every one is taken on the API door on purpose.** Both rules in this slice are keyed on the
   construct — a declaration carrying a severity matcher earns the segment and the diagnostic
   wherever it is opened — and a gate taken on SCANS would be green under every mutation that made
   them door-granted, because there the door and the construct agree. That is `M223` `F`'s vacuity
   lesson, and it is why 25 of the corpus's 96 scan assertions living in files nobody calls a scan
   file is a fact about the product rather than about the corpus. */
test('`M228` `A`: a scan assertion earns region 2 a `scan` segment on any door (`D1239`), and `TF060` reaches the pane (`D1240`)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m228a-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  const target = `http://127.0.0.1:${fixturePort}`;
  const config = (authorized: boolean): string =>
    [
      'env local default',
      `  api "${target}"`,
      ...(authorized ? [`  authorized target "${target}" reason "the fixture server, named so this test is not TF060"`] : []),
      '',
    ].join('\n');
  try {
    await writeFile(join(dir, 'tflw.config'), config(true));
    /* **One file, two declarations, and the only difference between them is the matcher.** Same
       door, same file, same request — so a segment that appeared on both would be the *file*
       talking and not the construct, and a reading that found it on neither would be the door. */
    await writeFile(
      join(dir, 'd.tflw'),
      [
        'test "grades what came back"',                        // L1
        '  api GET /items',                                    // L2
        '  expect status equals 200',                          // L3
        '  expect response has no serious security violations', // L4
        '',                                                    // L5
        'test "asks for nothing but a status"',                // L6
        '  api GET /items',                                    // L7
        '  expect status equals 200',                          // L8
        '',
      ].join('\n'),
    );
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;

    /* `openTab` drives the module-level page; this gate has its own, so the two lines it needs
       are written here rather than by widening a helper eleven other tests share. */
    const tabOn = async (tab: string): Promise<void> => {
      await fresh.locator(`[data-tab="${tab}"]`).click();
      await fresh.locator(`[data-tabstrip="${tab}"]`).waitFor();
    };

    const read = async (): Promise<{
      tabs: string[]; showing: string | null; panel: string | null; targets: string | null;
      families: string[]; probesNone: number; reason: string | null;
    }> =>
      fresh.locator('.doorpane').evaluate((pane) => {
        const p = pane.querySelector('[data-compose-scan]');
        return {
          tabs: [...pane.querySelectorAll('[data-compose-region2-tab]')].map((x) => x.getAttribute('data-compose-region2-tab') ?? ''),
          showing: pane.querySelector('[data-compose-region2]')?.getAttribute('data-compose-region2') ?? null,
          panel: p === null ? null : p.getAttribute('data-compose-scan'),
          targets: p === null ? null : p.getAttribute('data-compose-scan-targets'),
          families: [...pane.querySelectorAll('[data-compose-scan-family]')].map((x) => x.getAttribute('data-compose-scan-family') ?? ''),
          probesNone: pane.querySelectorAll('[data-compose-scan-probes-none]').length,
          reason: pane.querySelector('.scan-reason')?.textContent ?? null,
        };
      });

    // ── Gate 1 — the scan-bearing declaration, on API ────────────────────────────────────────
    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/d.tflw/L1`);
    await fresh.locator('.compose-pane-grid').waitFor();
    await fresh.waitForTimeout(400);
    const scanning = await read();
    assert.deepEqual(scanning.tabs, ['scan', 'response'], `the declaration earns a second tenant on the API door — got ${JSON.stringify(scanning.tabs)}`);
    assert.equal(scanning.showing, 'scan', 'and a declaration opens the richest thing it has earned (`D1209`)');
    assert.equal(scanning.panel, 'authorized', 'this env declares a target, so the panel is in its healthy state');
    assert.equal(scanning.targets, '1', `one target in force — got ${scanning.targets}`);
    assert.deepEqual(scanning.families, ['hasNoSecurityViolations'], 'and the panel names the family this declaration actually claims');
    assert.ok(
      scanning.reason !== null && scanning.reason.includes('named so this test is not TF060'),
      `the reason travels from the config into the panel, which is the half of \`D291\` that makes the claim auditable — got ${scanning.reason}`,
    );
    /* The opt-ins said out loud in their absence. `probe oversized`/`probe traversal` occur **0
       times** in any `.tflw` file in either repository because they are not written there, so
       `has no input-handling violations` reports *not probed* rather than sending anything — and
       a reader who has never met the clause cannot learn that from a passing run. */
    assert.equal(scanning.probesNone, 1, 'no `probe` opt-in is declared, and the panel says so rather than leaving it blank');

    // ── Gate 2 — the unmutated control: same door, same file, no severity matcher ─────────────
    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/d.tflw/L6`);
    await fresh.waitForTimeout(400);
    const plain = await read();
    assert.deepEqual(plain.tabs, [], `a declaration with no scan assertion earns no segment at all — got ${JSON.stringify(plain.tabs)}`);
    assert.equal(plain.panel, null, 'and no panel; a segment drawn unconditionally dies here');

    // ── Gate 4 — the authorized control for gate 3, taken FIRST so that the mutation is the ───
    //    config and nothing else. The draft has to differ from the file for the preview list to
    //    be drawn at all (`SourcePanel`), so the edit is made once and both readings share it.
    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/d.tflw/L4`);
    await fresh.locator('[data-expect-severity]').waitFor();
    await fresh.locator('[data-expect-severity]').selectOption('critical');
    await tabOn('source');
    await fresh.waitForTimeout(400);
    const codes = async (): Promise<string[]> =>
      fresh.locator('.doorpane').evaluate((pane) => [...pane.querySelectorAll('[data-diagnostic-code]')].map((x) => x.getAttribute('data-diagnostic-code') ?? ''));
    const gated = await codes();
    assert.deepEqual(gated, [], `the env authorizes this target, so the same bytes are clean — got ${JSON.stringify(gated)}`);

    // ── Gate 3 — the same bytes with the declaration taken out of `tflw.config` ───────────────
    /* **`reload`, not `goto`.** The first draft of this gate navigated to the same URL with a
       different hash, which is not a navigation at all — the SPA moved its route and never asked
       `/api/project` again, so the page went on holding the authorized config it had read at
       load and the reading came back empty. It is also what makes the pair above honest rather
       than vacuous: an instrument that never draws the list would pass gate 4 by saying nothing,
       and gate 3 is the proof that these exact bytes on this exact page can produce a row. */
    await writeFile(join(dir, 'tflw.config'), config(false));
    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/d.tflw/L4`);
    await fresh.reload();
    await fresh.locator('[data-expect-severity]').waitFor();
    await fresh.locator('[data-expect-severity]').selectOption('critical');
    await tabOn('source');
    await fresh.waitForTimeout(400);
    const ungated = await codes();
    assert.ok(
      ungated.includes('TF060'),
      `an ungated scan assertion is \`TF060\` and the pane says so before the terminal does (\`D1240\`) — got ${JSON.stringify(ungated)}`,
    );
    /* And the panel is in its other state on the same reload — `M207` `S5`'s warning, which every
       project on this machine is too healthy to render. */
    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/d.tflw/L1`);
    await fresh.waitForTimeout(400);
    const unauthorized = await read();
    assert.deepEqual(unauthorized.tabs, ['scan', 'response'], 'the segment is earned by the construct, so losing the target does not remove it');
    assert.equal(unauthorized.panel, 'none', 'with no target declared the panel carries `D291`’s warning instead of the healthy sentence');
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

/* ── `M228` `B` — the SCANS door joins the pane ────────────────────────────────────────────────
   Four readings, and the last two are what make the vocabulary row a decision rather than a copy
   of API's. `sends`/`plays` are the pair `D1241` argues in both directions: ▶ is offered and
   priced, `send` is refused on `D1119`'s own grounds, and a table that copied API's row wholesale
   would fail the fourth reading while passing the first three. */
test('`M228` `B`: SCANS draws the standard pane (`D1237`), fills the window, scaffolds a scan (`D1244`), and plays without sending (`D1241`)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m228b-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(
      join(dir, 'tflw.config'),
      [
        'env local default',
        `  api "http://127.0.0.1:${fixturePort}"`,
        `  authorized target "http://127.0.0.1:${fixturePort}" reason "the fixture server, named so this test is not TF060"`,
        '',
      ].join('\n'),
    );
    await writeFile(
      join(dir, 'd.tflw'),
      ['test "grades what came back"', '  api GET /items', '  expect status equals 200', '  expect response has no serious security violations', ''].join('\n'),
    );
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;

    // ── Gate 5 — the door renders the pane and no form ───────────────────────────────────────
    await fresh.goto(`${base}/?token=${TOKEN}#/scan`);
    await fresh.locator('.compose-pane-grid').waitFor();
    assert.equal(await fresh.locator('[data-scan-form]').count(), 0, '`ScanForm` is still on the screen, so the fork was narrowed rather than deleted');
    await fresh.locator(`[data-file-row="d.tflw"]`).click();
    await fresh.locator('[data-seq-foot]').waitFor();
    assert.deepEqual(
      (await fresh.locator('[data-seq-foot]').getAttribute('data-seq-adds'))?.split(','),
      ['request', 'let', 'wait'],
      'the sequence offers nothing to add, so `adds` is still empty and `composes` is still false on this door',
    );

    /* ── Gate 6 — the 270 px ─────────────────────────────────────────────────────────────────
       Measured 1440x900 on `examples/storefront` while this plan was scoped: `.doorpane` bottom
       **630** against `main`'s **900**. It was outside `main-fill` because `M223` `D1193` /
       `M224` `D1210` key that predicate on `adds.length > 0`, which is right and which SCAN was
       simply on the other side of. BROWSER lost **278 px** the same way before `D1193` and LOAD
       **190** before `D1210`; this is the third and last occurrence, and it closes because the
       door joined the pane rather than because the predicate moved. */
    /* **Through a locator, not `document`** — this package's tsconfig carries no `dom` lib, so a
       bare `page.evaluate` closure has no `document` to typecheck against. Every other reading in
       this file already goes through an element for that reason; this one did not, and `npm run
       typecheck` is where that shows up rather than `npm test`, which is why it shipped in
       `M228` `A`-`E`. */
    const box = async (): Promise<{ pane: number; main: number }> =>
      fresh.locator('body').evaluate((body) => {
        const pane = body.querySelector('.doorpane');
        const main = body.querySelector('main');
        return {
          pane: pane === null ? 0 : Math.round(pane.getBoundingClientRect().bottom),
          main: main === null ? 0 : Math.round(main.getBoundingClientRect().bottom),
        };
      });
    const fills = await box();
    assert.ok(
      fills.main - fills.pane <= 20,
      `the SCANS pane still leaves the window unclaimed — pane bottom ${fills.pane} against main's ${fills.main} (was 270 px short)`,
    );

    /* ── Gate 8 — ▶ is offered and priced; `send` is refused ─────────────────────────────────
       **Addressed at the REQUEST, and the first draft of this named the declaration and was
       vacuous.** `D1215` gives a declaration address no `prefix` — there is no *this* to send —
       so `[data-compose-send]` is absent there whatever the table says, and the `sends: true`
       mutation left this gate green. The control beside it is the same line on the API door,
       without which *absent* is satisfied by a send row that has stopped rendering anywhere. */
    await fresh.goto(`${base}/?token=${TOKEN}#/scan/compose/d.tflw/L2`);
    await fresh.locator('[data-seq-play="test"]').first().waitFor();
    await fresh.waitForTimeout(300);
    assert.equal(
      await fresh.locator('[data-compose-send]').count(),
      0,
      '`send` is on the SCANS door, and `D1241` refuses it: it strips the assertions this door exists for (`D1119`)',
    );
    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/d.tflw/L2`);
    await fresh.locator('[data-compose-send]').first().waitFor();
    assert.ok(
      (await fresh.locator('[data-compose-send]').count()) > 0,
      'the same request on the API door has no send either, so the SCANS reading above is about nothing',
    );

    await fresh.goto(`${base}/?token=${TOKEN}#/scan/compose/d.tflw/L1`);
    await fresh.locator('[data-seq-play="test"]').first().waitFor();
    const price = (await fresh.locator('[data-seq-play="test"]').first().getAttribute('data-tip')) ?? '';
    assert.ok(price.length > 0, '▶ states no price at all on the door where the press is most consequential (`D1212`)');

    // ── Gate 7 — `+ new test` writes a scan, and every line it writes is editable here ────────
    await fresh.locator('[data-compose-new-test]').click();
    await fresh.locator('[data-new-name]').fill('what the door scaffolds');
    await fresh.locator('[data-new-path]').fill('/health');
    await fresh.locator('[data-new-create]').click();
    await fresh.locator('[data-new-thing]').waitFor({ state: 'detached' });
    await fresh.locator('[data-compose-write]').click();
    await fresh.locator('[data-compose-dirty]').waitFor({ state: 'detached' });

    const written = await readFile(join(dir, 'd.tflw'), 'utf8');
    const body = written.slice(written.indexOf('test "what the door scaffolds"'));
    assert.match(body, /^ {2}api GET \/health$/m, 'the request the scan assertion grades');
    assert.match(body, /^ {2}expect status equals 200$/m, 'and the assertion saying the request worked');
    assert.match(body, /^ {2}expect response has no critical security violations$/m, 'the line that puts the scaffold behind its own door (`D1244`)');

    /* **And `D1189`'s invariant, read off the screen rather than off the table.** A scaffold that
       writes a kind its own pane cannot edit draws it dead — `data-stmt-editable="no"` with no
       control and no reason — which is the 650 statements `M219` `C` spent a slice removing and
       the defect `M222` was scoped from. Asserted on the rows the create gesture just made, so
       it is about what landed rather than about what the vocabulary claims. */
    const line = written.split('\n').findIndex((l) => l.includes('what the door scaffolds')) + 1;
    await fresh.goto(`${base}/?token=${TOKEN}#/scan/compose/d.tflw/L${line}`);
    await fresh.locator('[data-seq-foot]').waitFor();
    const dead = await fresh.locator('[data-stmt-editable="no"]').count();
    assert.equal(dead, 0, `the SCANS scaffold wrote ${dead} row(s) its own pane draws dead (\`D1082\`, \`D1189\`)`);
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

/* ── `M228` `C` — a `crawl` is drawn, and not built (`D1238`) ──────────────────────────────────
   **THE PLAN'S OWN GATE HERE WAS WRONG, AND MEASURING IT IS WHAT SAID SO.** It asked for *the
   sidebar badge equals the number of declaration rows drawn under it, on every door*, off a
   reading of `scan.tflw` as badge **1** / rows **2** on SCANS against **2** / **2** on API. The
   equality on API was a coincidence of that file: the badge counts what is behind THIS DOOR and
   the tree draws every declaration in the file, because `D1063` settled that *the door is a count,
   never a filter*. Any file holding a declaration behind another door breaks the equality while
   nothing at all is wrong.

   What §1.5 actually measured is narrower and is a real contradiction: **the badge counted a
   construct the tree could not draw at all.** `Sidebar.tsx:424` adds `f.crawls`; `:363` maps
   `o.declarations`, which `outline.ts:249` said in as many words could not hold one. So the rule
   is that the tree draws every declaration the FILE has — which the badge's own inputs are a
   subset of — and it is taken on both doors, because a crawl is the only construct that reaches
   SCANS without also reaching API. */
test('`M228` `C`: a `crawl` is drawn in the tree and in the pane, read-only and saying why (`D1238`)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m228c-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(
      join(dir, 'tflw.config'),
      [
        'env local default',
        `  api "http://127.0.0.1:${fixturePort}"`,
        `  authorized target "http://127.0.0.1:${fixturePort}" reason "the fixture server, named so this test is not TF060"`,
        '',
      ].join('\n'),
    );
    /* One test and one crawl, so the two halves of `M228`'s measurement are both present in one
       file: the test reaches API and SCANS, the crawl reaches SCANS alone. */
    await writeFile(
      join(dir, 'c.tflw'),
      [
        'test "the surface the crawl will walk"', // L1
        '  api GET /items',                       // L2
        '  expect status equals 200',             // L3
        '',                                       // L4
        'crawl "walked again as a stranger"',     // L5
        '  seed traffic',                         // L6
        '  expect response has no serious security violations', // L7
        '',
      ].join('\n'),
    );
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;

    const view = (await (await api(`${base}/api/project`)).json()) as { files: { path: string; tests: unknown[]; crawls: unknown[] }[] };
    const entry = view.files.find((f) => f.path === 'c.tflw')!;
    const declared = entry.tests.length + entry.crawls.length;
    assert.equal(declared, 2, 'the fixture must hold a test and a crawl for either half of this to mean anything');

    // ── Gate 9 — every declaration the file has is drawn, on every door ──────────────────────
    for (const door of ['scan', 'api'] as const) {
      await fresh.goto(`${base}/?token=${TOKEN}#/${door}/compose/c.tflw`);
      await fresh.locator('[data-outline]').waitFor();
      await fresh.waitForTimeout(300);
      const drawn = await fresh.locator('[data-outline-decl]').count();
      assert.equal(
        drawn,
        declared,
        `the ${door} tree draws ${drawn} of the file's ${declared} declarations — a crawl the badge counts and the tree cannot show is §1.5's contradiction`,
      );
      assert.equal(await fresh.locator('[data-outline-decl="crawl"]').count(), 1, `the crawl is missing from the ${door} tree`);
    }

    // ── Gate 10 — read-only, and the reason is the crawl's own rather than the block's ───────
    await fresh.goto(`${base}/?token=${TOKEN}#/scan/compose/c.tflw/L5`);
    await fresh.locator('[data-band-kind="crawl"]').waitFor();
    assert.equal(await fresh.locator('[data-crawl-name]').textContent(), 'walked again as a stranger');
    assert.deepEqual(
      await fresh.locator('[data-crawl-seed]').evaluateAll((els) => els.map((e) => e.getAttribute('data-crawl-seed'))),
      ['TrafficSeed'],
      'the seeds are the whole of where a crawl’s requests come from, and were invisible in the product before this slice',
    );
    /* **`isVisible`, not `textContent`.** The first draft read the text and the `hidden` mutation
       survived it: an element the reader cannot see still carries every word it was written with.
       `M224` `G` (`D1214`) filed exactly this once already — `hidden` on a block that was fully
       visible and interactive — and the mirror of it is a gate that cannot tell the two apart. */
    assert.ok(await fresh.locator('[data-crawl-why]').isVisible(), 'a disabled declaration with no visible explanation is the pane `D1082` refuses');
    const why = (await fresh.locator('[data-crawl-why]').textContent()) ?? '';
    assert.match(why, /crawl/, `the reason does not say what it is about — got ${why}`);

    /* **No control that does nothing.** ▶ needs `--only <name>` against a test, and `✕` and every
       step removal name a declaration by `replaceInSource`'s index — which a crawl deliberately
       does not have. Drawn-and-inert is worse than absent, and is the same failure as a disabled
       row with no reason. */
    assert.equal(await fresh.locator('[data-seq-play]').count(), 0, '▶ is offered on a crawl and could only ever refuse');
    assert.equal(await fresh.locator('[data-seq-remove]').count(), 0, '`✕` is offered on a crawl and `onRemoveDecl` cannot address one');
    assert.equal(await fresh.locator('[data-seq-foot]').getAttribute('data-seq-adds'), '', 'the foot offers `+` gestures that would splice into a crawl');

    await fresh.goto(`${base}/?token=${TOKEN}#/scan/compose/c.tflw/L7`);
    await fresh.locator('[data-stmt-editable]').first().waitFor();
    assert.equal(await fresh.locator('[data-stmt-editable="yes"]').count(), 0, "a crawl's own assertion is live, so its address is reachable after all");
    const reason = (await fresh.locator('.editor-body .stmt-line p').textContent()) ?? '';
    assert.match(reason, /crawl/, `the row gives the nested-block reason about a crawl, which is a true-shaped sentence about the wrong thing — got ${reason}`);

    /* **The control**, and it is the one `M224` cost us: the same pane, the same door, one file
       away, still fully live. Without it every assertion above is satisfied by a pane that has
       stopped editing anything. */
    await fresh.goto(`${base}/?token=${TOKEN}#/scan/compose/c.tflw/L3`);
    await fresh.locator('[data-expect-matcher]').first().waitFor();
    assert.equal(await fresh.locator('[data-seq-play]').count(), 1, 'the test beside the crawl lost ▶, so the crawl rule is keyed too wide');
    assert.equal(await fresh.locator('[data-seq-foot]').getAttribute('data-seq-adds'), 'request,let,wait', 'and its `+` gestures with it');
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

/* ── `M228` `D` — the matcher select stops offering 23 on every subject (`D1243`) ──────────────
   The rendering half. `packages/ui/test/matcherOffer.test.ts` holds the table half, and neither
   substitutes: a select that read the rule correctly and forgot to pass `disabled` passes that
   file, and one that hard-coded four ids passes this against today's corpus.

   **`D1242` IS NOT HERE, AND THE PLAN WAS WRONG ABOUT IT.** §1.4 read `[data-expect-not]` **0**
   and `[data-expect-severity]` **0** and concluded the severity floor and `not` had no control.
   Both have had one since `M210` `S3` — measured live on `examples/storefront/tests/signin.tflw`
   `L19`, the severity select reads `serious` off the file and `not` is drawn by the row's own
   `⋯`, open already on any row that uses it. The scoping measurement was taken through a
   URL-encoded path segment the address grammar does not use, so the page silently fell back to
   another file and answered about a row with neither. `M210` `S3`'s own gates cover both. */
test('`M228` `D`: every matcher is drawn on every subject, and the ones `TF042` refuses are disabled and say so (`D1243`)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m228d-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', `  api "http://127.0.0.1:${fixturePort}"`, ''].join('\n'));
    await writeFile(
      join(dir, 'd.tflw'),
      ['test "three subjects, one file"', '  api GET /items', '  expect status equals 200', '  expect response has no serious security violations', ''].join('\n'),
    );
    const base = `http://127.0.0.1:${await ui.listen(0)}`;

    const options = async (line: number): Promise<{ total: number; refused: string[]; tip: string | null }> =>
      fresh.locator(`[data-assert-line="${line}"] [data-expect-matcher]`).evaluate((el) => {
        const opts = [...(el as unknown as { options: { value: string; disabled: boolean; title: string }[] }).options];
        return {
          total: opts.length,
          refused: opts.filter((o) => o.disabled).map((o) => o.value),
          tip: opts.find((o) => o.disabled)?.title ?? null,
        };
      });

    // ── Gate 13 — a `status` subject: everything drawn, the ones that need a page or a response
    //    greyed, and the sentence is the checker's own.
    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/d.tflw/L3`);
    await fresh.locator('[data-expect-matcher]').first().waitFor();
    const onStatus = await options(3);
    assert.equal(onStatus.total, 23, `the select filtered instead of disabling — ${onStatus.total} options against the language's 23 (\`D1076\`)`);
    for (const m of ['hasNoA11yViolations', 'hasNoSecurityViolations', 'visible', 'wasMade']) {
      assert.ok(onStatus.refused.includes(m), `\`${m}\` is offered live on a \`status\` subject`);
    }
    // The control — a select that greyed all 23 would satisfy every line above.
    for (const m of ['equals', 'contains', 'greaterThan']) {
      assert.ok(!onStatus.refused.includes(m), `\`${m}\` is greyed out on \`status\`, which is the subject it exists for`);
    }
    assert.ok(
      onStatus.tip !== null && onStatus.tip.includes('TF042'),
      `a greyed option carries no explanation — a control that is drawn, disabled and silent about which half is what \`D1082\` refuses (got ${onStatus.tip})`,
    );

    // …and the mirror: on `response` the scan families are the live ones.
    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/d.tflw/L4`);
    await fresh.locator('[data-expect-matcher]').first().waitFor();
    const onResponse = await options(4);
    assert.equal(onResponse.total, 23);
    assert.ok(!onResponse.refused.includes('hasNoSecurityViolations'), 'a security scan is refused on `response`, the only subject it takes');
    assert.ok(onResponse.refused.includes('equals'), '`equals` is live on `response`, which carries no value to compare');

    /* ── Gate 14 — `{value}` abstains entirely ───────────────────────────────────────────────
       `checkOneMatcherSubject` skips `ValueSubject` because `TF041` owns that pairing and says it
       better. A select that greyed anything out here would report one mistake twice — once as an
       unreachable control and once as a diagnostic the author cannot act on from the row. */
    await fresh.locator(`[data-assert-line="4"] [data-expect-subject]`).selectOption('value');
    await fresh.waitForTimeout(300);
    const onValue = await options(4);
    assert.equal(onValue.total, 23);
    assert.deepEqual(onValue.refused, [], `\`{value}\` greys out ${JSON.stringify(onValue.refused)} — \`TF041\` owns that pairing (\`D1243\`)`);
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

/* ── `M228` `F` — the segments say what they are, and the recorder belongs to the door that ────
   records.

   Three readings and two of them are controls. The subject is a rule that was keyed on a PROXY —
   `!VOCABULARY[door].sends` standing in for *is this BROWSER* — so the only reading that can
   defend it is one taken on a door where the proxy and the truth DISAGREE. SCANS is that door by
   construction (`D1241`), and BROWSER is the control: a gate that read SCANS alone would pass on
   a build that had simply removed the session panel everywhere. */
test('`M228` `F`: SCANS offers no recorder and BROWSER still does (`D1245`), every segment says what it is (`D1246`), and the env half is labelled (`D1247`)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m228f-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  const target = `http://127.0.0.1:${fixturePort}`;
  try {
    await writeFile(
      join(dir, 'tflw.config'),
      [
        'env local default',
        `  api "${target}"`,
        // `web` is what makes the browser test legal at all (`TF051`), and the control needs to be
        // a real browser test rather than a near-miss the door would refuse.
        `  web "${target}"`,
        `  authorized target "${target}" reason "the fixture server, named so this gate is not TF060"`,
        '',
      ].join('\n'),
    );
    /* **One file, two declarations, both on doors with no `send`.** That is the whole design of
       this gate: `sends` is false for each, so any rule reading `sends` answers the same for both,
       and only a rule reading `records` can tell them apart. */
    await writeFile(
      join(dir, 'd.tflw'),
      [
        'test "a scan, which does not send and does not record"',  // L1
        '  api GET /items',                                        // L2
        '  expect status equals 200',                              // L3
        '  expect response has no serious security violations',    // L4
        '',                                                        // L5
        'test "a session, which does not send and DOES record"',   // L6
        '  open "/"',                                              // L7
        '  expect text "hello" is visible',                        // L8
        '',                                                        // L9
        /* **The three-tenant declaration**, which is the only place `plan`'s tip is observable:
           a workload earns `plan`, the severity matcher earns `scan`, and `response` is always
           there. `TF033` is why the threshold is not optional — a workload-bearing test must
           carry one, so a fixture without it would be refused before the page ever drew a nav. */
        'test "a workload that also makes a security claim"',      // L10
        '  run 4 iterations across 2 users',                       // L11
        '  api GET /items',                                        // L12
        '  expect status equals 200',                              // L13
        '  expect response has no serious security violations',    // L14
        '  threshold p95 duration is less than 5s',                // L15
        '',
      ].join('\n'),
    );
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;

    const read = async (): Promise<{
      tabs: string[]; untipped: string[]; session: string | null; startBtn: number;
      envLabel: string | null; order: string | null;
    }> =>
      fresh.locator('.doorpane').evaluate((pane) => {
        const tabs = [...pane.querySelectorAll('[data-compose-region2-tab]')];
        const claims = pane.querySelector('[data-compose-scan-families]');
        const env = pane.querySelector('[data-compose-scan-env]');
        const why = pane.querySelector('[data-compose-scan-why]');
        /* The heading's POSITION is the decision, not its presence: `D1247` is that the env half
           is labelled as the env's, and a heading rendered above the claims line would label the
           declaration's own sentence as belonging to the env — the opposite claim, with the same
           element present. */
        const between =
          claims === null || env === null || why === null
            ? null
            /* `4` is `Node.DOCUMENT_POSITION_FOLLOWING`, written as its value because the `Node`
               global is not in this package's `lib` either — see the note on `box()` above. */
            : (claims.compareDocumentPosition(env) & 4) !== 0 &&
              (env.compareDocumentPosition(why) & 4) !== 0
              ? 'claims < env < why'
              : 'out of order';
        return {
          tabs: tabs.map((x) => x.getAttribute('data-compose-region2-tab') ?? ''),
          untipped: tabs.filter((x) => (x.getAttribute('data-tip') ?? '') === '').map((x) => x.getAttribute('data-compose-region2-tab') ?? ''),
          session: pane.querySelector('[data-session]')?.getAttribute('data-session') ?? null,
          startBtn: pane.querySelectorAll('[data-session-start]').length,
          envLabel: env === null ? null : env.getAttribute('data-compose-scan-env'),
          order: between,
        };
      });

    const toResponse = async (): Promise<void> => {
      await fresh.locator('[data-compose-region2-tab="response"]').click();
      await fresh.waitForTimeout(250);
    };

    // ── Gate 1 — the scan declaration on SCANS: no recorder anywhere in the region ────────────
    await fresh.goto(`${base}/?token=${TOKEN}#/scan/compose/d.tflw/L1`);
    await fresh.locator('.compose-pane-grid').waitFor();
    await fresh.waitForTimeout(400);
    const scanArrival = await read();
    assert.deepEqual(scanArrival.tabs, ['scan', 'response'], `the scan declaration earns both tenants — got ${JSON.stringify(scanArrival.tabs)}`);

    /* **Every tab, not a sample** (`M223` `G`). A gate that read one tab's tip is green on a build
       that tipped that one and forgot the others, which is exactly how this shipped: the nav has
       always had two or three tenants and carried a tip on none of them. */
    assert.deepEqual(scanArrival.untipped, [], `a region-2 segment carries no tip — got ${JSON.stringify(scanArrival.untipped)}`);

    // `D1247` — the heading, and its position, which is the actual claim.
    assert.equal(scanArrival.envLabel, 'local', `the env half names the env it is about — got ${scanArrival.envLabel}`);
    assert.equal(scanArrival.order, 'claims < env < why', 'the heading sits between the declaration’s own line and the env’s block, which is the whole of `D1247`');

    await toResponse();
    const scanResponse = await read();
    /* **Absent, not disabled** (`D1082`): the recorder's subject does not exist on this door, and
       `D1082` forbids drawing a dead control rather than requiring one. */
    assert.equal(scanResponse.session, null, 'the SCANS door draws no session region at all — it does not send AND it does not record (`D1245`)');
    assert.equal(scanResponse.startBtn, 0, '`record a session` is offered on SCANS, which would splice steps this door’s vocabulary cannot construct');

    // ── Gate 2 — the control: same file, same `sends: false`, BROWSER ────────────────────────
    await fresh.goto(`${base}/?token=${TOKEN}#/browser/compose/d.tflw/L6`);
    await fresh.waitForTimeout(400);
    const browserPane = await read();
    /* This declaration earns ONE tenant, so there is no nav here and no tip to read — asserted
       rather than left implicit, because `untipped` would come back `[]` from a page with no tabs
       at all and a reading that celebrated it would be vacuous. The tips are gated below, where
       three tenants are actually drawn. */
    assert.deepEqual(browserPane.tabs, [], 'a browser test with no workload and no scan matcher earns one tenant, so the nav is not drawn (`D1209`)');
    assert.equal(browserPane.session, 'none', 'BROWSER lost the recorder — a live session is this door’s evidence (`D1165`)');
    assert.equal(browserPane.startBtn, 1, 'and the press that starts one is offered');

    // ── Gate 3 — all three tenants at once, which is where `D1246` is observable ─────────────
    await fresh.goto(`${base}/?token=${TOKEN}#/load/compose/d.tflw/L10`);
    await fresh.waitForTimeout(400);
    const three = await read();
    assert.deepEqual(three.tabs, ['plan', 'scan', 'response'], `a workload-bearing test with a severity matcher earns all three — got ${JSON.stringify(three.tabs)}`);
    assert.deepEqual(three.untipped, [], `a region-2 segment carries no tip — got ${JSON.stringify(three.untipped)}`);
    /* And the recorder is absent here too, on a THIRD door, which is the reading that separates
       `records` from every other predicate in the table: LOAD sends, BROWSER records, SCANS does
       neither — three doors, three answers, one field. */
    assert.equal(three.session, null, 'LOAD draws no session region — it sends, and the recorder is not its evidence');
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

/* ── `M228` `F4` — the pane predicts against the env the strip is pointing at ──────────────────
   Two readings and they are a PAIR, deliberately: `D1248` can be got half-right in two
   independent ways — the coverage table following the pick while `diagnose` keeps the default, or
   the reverse — and each is invisible to the gate that catches the other. `M227` `A`'s rule, a
   third time: both ways to get a floor wrong need their own mutation.

   The fixture is two envs over ONE api base. That matters: if the envs differed in their base URL
   the rows would move for a reason unrelated to authorization, and a build that ignored `?env=`
   entirely could still look like it had changed something. Here the only difference between the
   two envs is the `authorized target` line, so the rows can only move if the server resolved the
   env the page asked for. */
test('`M228` `F4`: the `scan` segment and the pane’s `TF060` preview both follow the env picker (`D1248`)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m228f4-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await newPage({ viewport: { width: 1440, height: 900 } });
  const target = `http://127.0.0.1:${fixturePort}`;
  try {
    await writeFile(
      join(dir, 'tflw.config'),
      [
        'env local default',
        `  api "${target}"`,
        `  authorized target "${target}" reason "the fixture server, named so this env is clean"`,
        '',
        'env staging',
        `  api "${target}"`,
        // …and no `authorized target`. Same bytes in the test file, different verdict.
        '',
      ].join('\n'),
    );
    await writeFile(
      join(dir, 'd.tflw'),
      [
        'test "grades what came back"',                         // L1
        '  api GET /items',                                     // L2
        '  expect status equals 200',                           // L3
        '  expect response has no serious security violations', // L4
        '',
      ].join('\n'),
    );
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;

    const tabOn = async (tab: string): Promise<void> => {
      await fresh.locator(`[data-tab="${tab}"]`).click();
      await fresh.locator(`[data-tabstrip="${tab}"]`).waitFor();
    };
    const codes = async (): Promise<string[]> =>
      fresh.locator('.doorpane').evaluate((pane) => [...pane.querySelectorAll('[data-diagnostic-code]')].map((x) => x.getAttribute('data-diagnostic-code') ?? ''));
    const scan = async (): Promise<{ state: string | null; env: string | null; reach: string[] }> =>
      fresh.locator('.doorpane').evaluate((pane) => ({
        state: pane.querySelector('[data-compose-scan]')?.getAttribute('data-compose-scan') ?? null,
        env: pane.querySelector('[data-compose-scan-env]')?.getAttribute('data-compose-scan-env') ?? null,
        reach: [...pane.querySelectorAll('[data-compose-scan-reach-url]')].map(
          (x) => `${x.getAttribute('data-compose-scan-reach-url')}=${x.getAttribute('data-compose-scan-covered')}`,
        ),
      }));

    // ── The control: the default env, which authorizes the target ────────────────────────────
    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/d.tflw/L1`);
    await fresh.locator('.compose-pane-grid').waitFor();
    await fresh.waitForTimeout(400);
    const clean = await scan();
    assert.equal(clean.env, 'local', `the panel opens on the config's default env — got ${clean.env}`);
    assert.equal(clean.state, 'authorized', 'which declares a target');
    assert.deepEqual(clean.reach, [`${target}=yes`], `one scannable origin, covered — got ${JSON.stringify(clean.reach)}`);

    /* The diagnostics half of the control. The preview only renders while the draft differs from
       the file (`SourcePanel`, `D1052` — it is a preview of what you are about to WRITE), so the
       edit is what makes the list drawable at all; `deepEqual([])` rather than `!includes`,
       because a negative on an empty list is the vacuity `M228` `A`'s gate 4 was rewritten for. */
    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/d.tflw/L4`);
    await fresh.locator('[data-expect-severity]').waitFor();
    await fresh.locator('[data-expect-severity]').selectOption('critical');
    await tabOn('source');
    await fresh.waitForTimeout(400);
    assert.deepEqual(await codes(), [], 'env `local` authorizes this target, so the same bytes preview clean');

    // ── The move: the strip's own control, and nothing else ──────────────────────────────────
    /* **The env is changed by driving the select the reader drives**, not by rewriting the config
       — which is the whole point of the reading. A config rewrite would prove the server reads a
       file, and the defect was that the PAGE could not ask it a question. */
    await tabOn('compose');
    await fresh.locator('[data-env-select]').selectOption('staging');
    await fresh.waitForTimeout(500);

    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/d.tflw/L1`);
    await fresh.waitForTimeout(400);
    const gap = await scan();
    assert.equal(gap.env, 'staging', `the panel followed the pick — got ${gap.env}`);
    assert.equal(gap.state, 'none', 'env `staging` declares no `authorized target`, and the panel is in its other state');
    assert.deepEqual(gap.reach, [`${target}=no`], `the same origin, now uncovered — got ${JSON.stringify(gap.reach)}`);

    // ── …and the preview, which is the half that contradicted `D1052` ────────────────────────
    await fresh.goto(`${base}/?token=${TOKEN}#/api/compose/d.tflw/L4`);
    await fresh.locator('[data-expect-severity]').waitFor();
    await fresh.locator('[data-expect-severity]').selectOption('critical');
    await tabOn('source');
    await fresh.waitForTimeout(400);
    const gated = await codes();
    assert.ok(
      gated.includes('TF060'),
      `the pane previews the env the run will use, not the config's default (\`D1240\`, \`D1248\`) — got ${JSON.stringify(gated)}`,
    );
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

// `M229` `C` (`D1251`) — the dialog previews the addition, and the addition is on screen.
test('the create dialog shows the lines it is about to write, on every door', async () => {
  // **The finding, in one number: the scaffold was 1183 px below the fold on LOAD.** The preview
  // rendered the whole file, pinned at the top, in a box that shows eleven lines — so what a reader
  // saw was the existing file's header comment, on all four doors, with nothing saying the lines
  // the dialog exists to write were further down. `D1052` says the pane previews what will happen;
  // this one previewed what would not change, and the cost scaled with the file.
  //
  // **The negative control is the product's own control, which is the best kind.** `D1251` keeps
  // the whole file one press away, and that press reproduces the defect exactly — so the same
  // measurement, taken twice in one page, is both the claim and the proof that the claim can fail.
  // A code mutation would have had to invent the state this button reaches honestly.
  const header = Array.from({ length: 60 }, (_, i) => `# a teaching comment, line ${i + 1} of sixty — this is what the dialog used to show`).join('\n');
  const file = `${header}\ntest "the one that was already here"\n  api GET /a\n  expect status equals 200\n`;
  await withProjectFixture({ 'one.tflw': file }, async (p, base) => {
    for (const door of ['api', 'browser', 'load', 'scan']) {
      await p.goto(`${base}/?token=${TOKEN}#/${door}/compose/one.tflw`);
      await p.reload();
      await p.locator('[data-compose-new-test]').click();
      await p.locator('[data-new-name]').fill(`written on ${door}`);
      await p.locator('[data-new-preview]').waitFor();

      // The reading: where the line naming the new test sits, against what the box is showing.
      const seen = async (): Promise<{ showing: string | null; visible: boolean; top: number; scroll: number; height: number; lines: number }> =>
        p.locator('[data-new-preview]').evaluate((pre, name) => {
          const rows = [...pre.querySelectorAll('[data-source-line]')];
          const row = rows.find((r) => (r.textContent ?? '').includes(`test "${name}"`)) ?? null;
          // Rectangles rather than `offsetTop`, because the claim is *on screen* and the box
          // scrolls: the row's top relative to the box's own is what `scrollTop` moves.
          const box = pre.getBoundingClientRect();
          const top = row === null ? -1 : row.getBoundingClientRect().top - box.top;
          return {
            showing: pre.getAttribute('data-new-preview-showing'),
            visible: row !== null && top >= 0 && top < pre.clientHeight,
            top: Math.round(top),
            scroll: Math.round(pre.scrollTop),
            height: pre.clientHeight,
            lines: rows.length,
          };
        }, `written on ${door}`);

      const addition = await seen();
      assert.equal(addition.showing, 'addition', `${door}: the dialog did not open on the addition`);
      assert.ok(addition.lines > 1 && addition.lines <= 10, `${door}: the addition is ${addition.lines} lines — that is a file, not a scaffold`);
      assert.ok(addition.visible, `${door}: the new test is ${addition.top}px into a box ${addition.height}px tall (scrolled ${addition.scroll})`);

      // …and the control that restores the old view restores the old defect, which is what makes
      // the line above a measurement rather than a tautology about a short string.
      await p.locator('[data-new-preview-context]').click();
      const whole = await seen();
      assert.equal(whole.showing, 'file');
      assert.ok(whole.lines > 60, `${door}: the whole-file view is ${whole.lines} lines`);
      assert.equal(whole.visible, false, `${door}: the whole-file view was supposed to push the scaffold off screen and did not`);

      await p.locator('[data-new-cancel]').click();
      await p.locator('[data-new-thing]').waitFor({ state: 'detached' });
    }
  });
});

// `M229` `D` (`D1252`) — an address names what is drawn.
test('an address that resolves to something else is corrected to what is on screen', async () => {
  // **Three cases, and the third is the one `M228` paid for.** An unrecognised tab, an
  // unrecognised door, and a hash naming a file the project does not have — all three drew a page
  // and went on advertising an address that reproduces a different one.
  await withProjectFixture(
    { 'one.tflw': 'test "the only one"\n  api GET /a\n  expect status equals 200\n' },
    async (p, base) => {
      const historyLength = (): Promise<number> => p.locator('body').evaluate((el) => el.ownerDocument.defaultView!.history.length);
      const settle = async (hash: string, want: string): Promise<{ hash: string; entries: number }> => {
        await p.goto(`${base}/?token=${TOKEN}#/api/compose/one.tflw`);
        await p.reload();
        await p.locator('[data-tabstrip]').waitFor();
        const before = await historyLength();
        await p.locator('body').evaluate((el, h) => { el.ownerDocument.location.hash = h; }, hash);
        // **Waited for, not slept on.** The correction lands in an effect that runs after the
        // project read, so the address is the signal; a fixed delay would be a gate tuned to this
        // machine. The wait is a string expression because this package compiles with no DOM lib
        // (`ui-appearance.test.ts` states the rule), and it is allowed to time out: the control
        // cases below expect the address NOT to move, and a timeout there is the pass.
        // `M239` `C`: a string predicate is `eval` in the page, which its policy refuses — so the
        // wait reads the address from outside the page.
        await p.waitForURL((u) => u.hash === want, { timeout: 4000 }).catch(() => {});
        return { hash: new URL(p.url()).hash, entries: (await historyLength()) - before };
      };

      // 1. A tab nobody has heard of. The page draws Compose, which is `doors.ts`'s own tolerance
      //    working; the address now says so.
      const bogusTab = await settle('#/api/bogus', '#/api');
      assert.equal(bogusTab.hash, '#/api', 'the address kept naming a tab the page is not showing');

      // 2. `#/api/runs`, which is the near-miss the review actually found — one letter from a real
      //    tab, which is how a reader produces this state without trying.
      assert.equal((await settle('#/api/runs', '#/api')).hash, '#/api');

      // 3. **A file this project does not have.** The pane falls back to the first file, and until
      //    now the address went on naming the other one — which is `M228`'s `%2F` defect exactly:
      //    every reading taken off that page was honestly read off the wrong row.
      const gone = await settle('#/api/compose/gone.tflw', '#/api/compose/one.tflw');
      assert.equal(gone.hash, '#/api/compose/one.tflw', 'the address named a file the pane is not drawing');

      // 4. A door nobody has heard of draws the landing, and the landing's address is `#`.
      // `''` and not `'#'`: the browser stores a bare `#` as no fragment at all, so those are one
      // address and the `URL` parser reports the shorter spelling. The page wrote `#`.
      assert.equal((await settle('#/bogus', '')).hash, '');

      // **The correction replaces rather than pushes.** Otherwise the back button walks into the
      // address that was just corrected, and pressing it corrects it again — a trap the reader
      // cannot get out of except by going back twice as fast as the page rewrites.
      assert.ok(bogusTab.entries <= 1, `the correction added ${bogusTab.entries} history entries`);

      // And the control: an address that is already honest is left exactly alone, so this is a
      // correction and not a rewriter that happens to agree.
      assert.equal((await settle('#/api/source/one.tflw', '#/api/source/one.tflw')).hash, '#/api/source/one.tflw');
      assert.equal((await settle('#/browser/compose/one.tflw/L2', '#/browser/compose/one.tflw/L2')).hash, '#/browser/compose/one.tflw/L2');
    },
  );
});

// `M229` `E` (`D1253`, `D1254`, `D1255`) — the run list's first three decisions, on a page.
test('the run list marks the open report, counts `current` as a property, and keeps the directory name out of the row', async () => {
  // **`RunList` occurs 0 times in `DECISIONS.md`** and it draws the surface every ▶ press lands
  // on — `UI_STRUCTURE.md` §4's headline, and the review's last pass found three defects there.
  // The fixture is the shape that produced all three: two kept runs, and a `report/` that is a byte
  // copy of the newer one, which is what `keepReport` leaves behind after every run this page
  // starts.
  const older = '2026-09-20T10-41-50-120Z';
  const newer = '2026-09-21T11-02-03-400Z';
  await withProjectFixture({ 'one.tflw': 'test "the only one"\n  api GET /a\n  expect status equals 200\n' }, async (p, base, dir) => {
    const results = (passed: number, total: number): string => JSON.stringify({ ok: passed === total, total, passed, failed: total - passed, tests: [] });
    for (const [id, body] of [[older, results(1, 2)], [newer, results(3, 3)]] as const) {
      await mkdir(join(dir, 'report', 'runs', id), { recursive: true });
      await writeFile(join(dir, 'report', 'runs', id, 'results.json'), body);
    }
    // `report/` is the newer run copied — the same bytes, which is exactly what `keepReport` does.
    await writeFile(join(dir, 'report', 'results.json'), results(3, 3));

    await p.goto(`${base}/?token=${TOKEN}#/api/run/one.tflw`);
    await p.reload();
    await p.locator('[data-runs]').waitFor();

    const rows = p.locator('[data-report-row]');
    // **`D1254` — two directories, one run each, and `current` is not a third.** Before this the
    // list drew three rows for two runs, the top two identical in counts and instant.
    assert.deepEqual(await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-report-row'))), [newer, older], 'the list holds one row per run, newest first');
    assert.equal(await p.locator(`[data-report-row="${newer}"] [data-row-current]`).count(), 1, '`current` is not marked on the run that holds it');
    assert.equal(await p.locator(`[data-report-row="${older}"] [data-row-current]`).count(), 0, 'and it is marked on a run that does not');

    // **`D1255` — the directory name is provenance.** It was the widest thing in the row and the
    // readable date sat beside it saying the same instant; it is in the tip now, which is where a
    // value you might need to copy belongs.
    for (const id of [newer, older]) {
      const row = p.locator(`[data-report-row="${id}"]`);
      const text = (await row.textContent()) ?? '';
      assert.ok(!text.includes(id), `the row still prints its directory name: ${text}`);
      assert.match(text, /\d/, `the row says nothing at all: ${text}`);
      assert.ok(((await row.getAttribute('data-tip')) ?? '').includes(id), `the directory name is not in the tip either — it has simply been lost`);
    }

    // **`D1253` — which of them is open.** The class and the accent border have been here since
    // `M192`; what was missing is a state a script or a screen reader can read, which is why the
    // review measured this surface as having no selected state at all.
    const pressed = (): Promise<(string | null)[]> => rows.evaluateAll((els) => els.map((e) => e.getAttribute('aria-pressed')));
    // On arrival the shell has already opened the newest report — measured, not assumed: the first
    // draft of this line asserted nothing was open and read `['true', 'false']`, which is the page
    // being helpful and the gate being wrong about it.
    assert.deepEqual(await pressed(), ['true', 'false'], 'exactly one row is marked on arrival, and it is the newest');
    await p.locator(`[data-report-row="${older}"]`).click();
    await p.locator(`[data-report-row="${older}"][aria-pressed="true"]`).waitFor();
    assert.deepEqual(await pressed(), ['false', 'true'], 'exactly one row is marked, and it is the one that was opened');
    // …and it is the row whose evidence the pane is actually showing — a marker on the wrong row
    // is worse than none, and nothing above this line would have caught it.
    assert.match((await p.locator('[data-report-summary], .report, main').first().textContent()) ?? '', /1\s*\/\s*2|1 of 2|passed/i);
    await p.locator(`[data-report-row="${newer}"]`).click();
    await p.locator(`[data-report-row="${newer}"][aria-pressed="true"]`).waitFor();
    assert.deepEqual(await pressed(), ['true', 'false'], 'opening another run left two rows marked');
  });
});

// `M236` `C` (`M235-09`, `D-M236-3`) — **what `[data-compose-pane]` means.**
//
// Six gates in this file wait with `locator('[data-compose-pane]').waitFor()` and then read
// something out of the pane. Until `M236` the reading placeholder rendered
// `data-compose-pane="reading"`, so every one of those waits was satisfiable by a pane that had
// drawn nothing — the wait said *a pane exists*, the test meant *a pane has a file in it*, and
// `:2877` reddened on exactly that at 1 of 56.
//
// **The placeholder window is held open on purpose.** A race gated by whichever side happened to
// win is not gated (`D1252`'s own argument, one test below): the file read is delayed, the
// assertion is taken while it is outstanding, and then it is released and the same selectors are
// read again. So the test states both halves of the marker's meaning rather than one.
//
// The mutation is one attribute: putting `data-compose-pane` back on `ComposePane.tsx`'s reading
// branch reddens the middle assertion and nothing else.
//
// **What this does and does not demonstrate**, said plainly rather than implied. It demonstrates
// that the placeholder window is reachable, that it is observable, and that `[data-compose-pane]`
// no longer answers during it. It does **not** individually mutation-prove the other five sites:
// each of them is `waitFor()` on that selector with nothing before it but a navigation, so the
// window this test holds open is the same window they were racing, but that is an argument from
// the shape of the five and not a measurement of each.
test('the reading placeholder is not a pane: `[data-compose-pane]` answers only for a pane with a file in it', async () => {
  await withProjectFixture(
    {
      'first.tflw': 'test "it answers"\n  api GET /a\n  expect status equals 200\n',
      'second.tflw': 'test "it also answers"\n  api GET /b\n  expect status equals 200\n',
    },
    async (p, base) => {
      await p.goto(`${base}/?token=${TOKEN}#/api/compose/first.tflw`);
      await p.reload();
      await p.locator('[data-compose-pane]').waitFor();

      // The handler parks until this test says so — and **the parking is what has to be cleaned
      // up**. A route left mid-flight resumes after `unroute` and `route.continue()` then throws
      // `Route is already handled!` as an unhandled rejection, which node:test attributes to the
      // `before` hook and fails the whole file. Measured on the box: this test passed and the file
      // did not. So every handler invocation is tracked, they are all awaited before the route is
      // removed, and the continue itself tolerates a route torn down underneath it.
      let release: (() => void) | null = null;
      const held = new Promise<void>((r) => { release = r; });
      const inflight: Promise<void>[] = [];
      await p.route('**/api/file**', async (route) => {
        const job = (async () => {
          await held;
          await route.continue().catch(() => {});
        })();
        inflight.push(job);
        await job;
      });
      try {
        // Open the other file. The read is now outstanding and `outline` is null, so the pane is
        // the placeholder — for as long as this test wants it to be.
        await p.goto(`${base}/?token=${TOKEN}#/api/compose/second.tflw`);
        await p.locator('[data-compose-placeholder]').waitFor();

        assert.equal(
          await p.locator('[data-compose-placeholder]').count(), 1,
          'the placeholder is on screen, so this is the window the six waits were racing',
        );
        // one-shot: the file read is held open by the route above, so the pane it would draw
        // CANNOT arrive while this line runs — the absence is a fact about a blocked request and
        // not a race. A `settle` here would be a retry loop waiting for something this test is
        // itself preventing, which is the shape `M141` calls a gate that can no longer fail.
        assert.equal(
          await p.locator('[data-compose-pane]').count(), 0,
          'a pane that has drawn nothing must not answer to the selector six gates read as `the file is here`',
        );
      } finally {
        release!();
        await Promise.all(inflight);
        await p.unroute('**/api/file**');
      }

      // …and the other half: once the bytes land, the selector answers, and it answers about a
      // pane that has rows. Without this the assertion above is satisfiable by a broken marker.
      await p.locator('[data-compose-pane]').waitFor();
      assert.equal(await p.locator('[data-compose-placeholder]').count(), 0, 'the placeholder went away when the file arrived');
      await p.locator('[data-seq-row]').first().waitFor({ timeout: 5000 });
    },
  );
});

// `M229` `D` (`D1252`) — the half of the normalisation that only a slow machine found.
test('an address ahead of a project read is not an address that contradicts it', async () => {
  // **THIS IS THE GATE FOR A DEFECT THIS MAC COULD NOT PRODUCE.** `D1252`'s first build corrected
  // any address naming a file the project does not have — and `+ new file` produces exactly that
  // address for as long as its re-read takes, because `onDone` starts the read and moves the
  // address in the same breath. Two standing gates went red **on the box and nowhere else**: the
  // create wrote `tests/second.tflw`, the correction put the hash back on `first.tflw`, and this
  // machine had been winning the race by a few milliseconds every time.
  //
  // So the read is **delayed on purpose** rather than hoped about. A timing defect gated by the
  // timing that happened to occur is not gated at all — it is the same class as `M213-12`, whose
  // hash-only navigation raced a React commit and was latent until the box was slow enough to lose.
  await withProjectFixture({ 'first.tflw': 'test "it answers"\n  api GET /a\n  expect status equals 200\n' }, async (p, base) => {
    await p.goto(`${base}/?token=${TOKEN}#/api/compose/first.tflw`);
    await p.reload();
    await p.locator('[data-files]').waitFor();
    // Only now: the first read must land normally, or the page has no project to be ahead of.
    await p.route('**/api/project**', async (route) => {
      await new Promise((r) => setTimeout(r, 700));
      await route.continue();
    });
    try {
      await p.locator('[data-compose-new-file]').click();
      await p.locator('[data-new-file]').fill('tests/second.tflw');
      await p.locator('[data-new-name]').fill('it also answers');
      await p.locator('[data-new-create]').click();
      await p.locator('[data-new-thing="file"]').waitFor({ state: 'detached' });

      // Immediately: the write has happened, the read has not, and the address names the new file.
      assert.match(new URL(p.url()).hash, /compose\/tests\/second\.tflw/, 'the address was corrected off the file that had just been made');
      // …and it is still naming it once the read lands, which is the half that says the guard
      // released rather than merely stuck.
      const rows = await settle(() => p.locator('[data-file-row]').count(), untilEqual(2), { attempts: 20, delayMs: 250, page: p });
      assert.equal(rows.value, 2, 'the delayed project read landed, and the tree has both files');
      // one-shot: the rows above are the project read having landed, and the address is written by
      // the same commit that draws them; a drift after that would be a second defect, not this one.
      assert.match(new URL(p.url()).hash, /compose\/tests\/second\.tflw/, 'the address moved once the project caught up');
    } finally {
      await p.unroute('**/api/project**');
    }
  });
});
