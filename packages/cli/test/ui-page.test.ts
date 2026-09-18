// The page gate (`M192` U2, `D988`): the built page, served by `UiServer` over the fixture
// project, read by a real browser, and every rendered value asserted against `results.json`
// read from disk — the report directory is the oracle, never a number written in this file.
// The corpus under `packages/ui/fixtures/reports/` is what `tflw run` wrote over
// `packages/ui/fixtures/project/` (`scripts/make-fixtures.mjs`), one directory per evidence
// level. The last test runs the project from the page against the fixture server and grades
// the page against the directory that run wrote.

import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, cp, rm, readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Server } from 'node:http';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright';
import { UiServer, SCRATCH_PATH } from '../src/ui-server.js';
import { checkProgram, parseSource, print, STEP_LENS } from '@tflw/lang';
import { roundDurationMs, type LoadMetrics, type RunReport, type StepResult, type TestResult, type WorkloadTestResult } from '@tflw/runtime';
import { describeWorkload, formatThresholdActual, formatThresholdTarget, remediationFor } from '@tflw/reporter';
import { findingsSummaryLine, sortFindings, WITHHELD_LABEL, SCAN_KIND_LABEL } from '@tflw/runtime';

const here = dirname(fileURLToPath(import.meta.url));
const uiRoot = join(here, '..', '..', 'ui');
const fixtures = join(uiRoot, 'fixtures');
const cliEntry = join(here, '..', 'src', 'cli.ts');
const tsxLoader = fileURLToPath(import.meta.resolve('tsx'));

let scratch: string;
let root: string;
/** The fixture server's port for this process — a free one, written into the scratch copy of
 * `tflw.config` in place of the file's 4717. Two page gates on one host (`M194`'s parallel sweep)
 * cannot both hold 4717; the recorded trace in `reports/full` still says 4717 and that is history. */
let fixturePort: number;
let server: UiServer;
let baseUrl: string;
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

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'tflw-ui-page-'));
  // The bundle, built here rather than taken from `dist/ui` so this file grades the checked-out
  // page whatever was last built. The ui's own vite, not the root's (VitePress pins a vite 5).
  const viteManifestPath = createRequire(uiRoot).resolve('vite/package.json');
  const viteBin = join(dirname(viteManifestPath), (JSON.parse(await readFile(viteManifestPath, 'utf8')) as { bin: { vite: string } }).bin.vite);
  const staticDir = join(scratch, 'ui');
  execFileSync(process.execPath, [viteBin, 'build', '--outDir', staticDir, '--logLevel', 'warn'], { cwd: uiRoot, stdio: 'pipe' });

  root = join(scratch, 'project');
  await cp(join(fixtures, 'project'), root, { recursive: true });
  fixturePort = await new Promise<number>((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
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

  server = new UiServer({ root, cliEntry, execArgv: ['--import', tsxLoader], staticDir });
  const port = await server.listen(0);
  baseUrl = `http://127.0.0.1:${port}`;
  browser = await chromium.launch();
  page = await browser.newPage();
});

after(async () => {
  await browser?.close();
  await server?.close();
  await rm(scratch, { recursive: true, force: true });
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
/**
 * Open Compose's legacy *write a new test* form (`M210` `S1`).
 *
 * Every gate below this line was written when the Compose **tab** and the authoring **form** were
 * the same thing. `S1` makes the tab a reader (`D1072`) and keeps `M200` `A1-4`'s form behind a
 * disclosure, because `D1082`'s *read-only first* is about what the new surface claims, not about
 * taking the API door's only write path away for four slices. A closed `<details>` does not lay out
 * its content, so a `fill` into it times out rather than failing — hence a helper rather than a
 * selector change: these gates still assert exactly what they asserted, one gesture further in.
 *
 * `S2`–`S5` dissolve the form, and this helper goes with the last of it.
 */
const openLegacyForm = async (p: Page): Promise<void> => {
  const details = p.locator('[data-compose-legacy]');
  await details.waitFor();
  if (!(await details.evaluate((e) => (e as unknown as { open: boolean }).open))) await details.locator('summary').click();
  await p.locator('[data-api-path]').waitFor();
};

const API_DOOR = '#/api';
const API_RUN = '#/api/run';

/** The functional entries of a report — the workload kind carries metrics, not steps (U4). */
const functional = (report: RunReport): TestResult[] => report.tests.filter((t): t is TestResult => t.kind === 'functional');

async function openReport(id: string): Promise<void> {
  await page.goto(`${baseUrl}${API_RUN}`);
  await page.locator(`[data-report-row="${id}"]`).click();
  await page.locator(`[data-report="${id}"]`).waitFor();
}

test('the sidebar is the project as a tree: every file the server read, a leaf name per row, and this door as a count', async () => {
  await page.goto(`${baseUrl}${API_DOOR}`);
  await page.reload();
  await page.locator('[data-files]').waitFor();
  const project = (await (await fetch(`${baseUrl}/api/project`)).json()) as { files: { path: string; tests: { name: string; line: number; tags: string[]; lenses: string[] }[]; crawls: { lenses: string[] }[] }[]; envs: { name: string; isDefault: boolean }[] };
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
    assert.equal(await row.locator('> .file-row > code').textContent(), f.path.split('/').pop());
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
    const paint = await row.locator('> .file-row').evaluate((el) => {
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
  const icon = await fetch(`${baseUrl}/favicon.svg`);
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get('content-type'), 'image/svg+xml');
});

test('the run list is the report directories, each row carrying its own results.json counts', async () => {
  await page.goto(`${baseUrl}${API_RUN}`);
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
  const zip = await fetch(`${baseUrl}${await line.locator('[data-trace-download]').getAttribute('href')}`);
  assert.equal(zip.status, 200);
  assert.equal(Number(zip.headers.get('content-length')), Buffer.from(traced[0]!.trace!.base64, 'base64').length);
  assert.equal(await line.locator('code').textContent(), `npx playwright show-trace ${path}`);
  // *open trace*: Playwright's own viewer, served by tflw ui, reading the archive from the same origin.
  const viewerHref = (await line.locator('[data-open-trace]').getAttribute('href'))!;
  assert.match(viewerHref, /^\/trace\/index\.html\?trace=/);
  const viewer = await browser.newPage();
  try {
    await viewer.goto(`${baseUrl}${viewerHref}`);
    // The trace's own content, rendered by the viewer: the page the test opened.
    await viewer.getByText('127.0.0.1:4717', { exact: false }).first().waitFor({ timeout: 60_000 });
  } finally {
    await viewer.close();
  }
  assert.equal(await page.locator('[data-evidence-withheld]').count(), 0);
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
      assert.equal(await rows.count(), inRule.length);
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
    await page.goto(`${baseUrl}${API_RUN}`);
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
    const runs = (await (await fetch(`${baseUrl}/api/runs`)).json()) as { argv: string[]; status: string; exitCode: number | null; kept: string }[];
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
    await page.goto(`${baseUrl}${API_RUN}`);
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
    const runs = (await (await fetch(`${baseUrl}/api/runs`)).json()) as { status: string; exitCode: number | null; kept: string }[];
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
  await page.goto(`${baseUrl}${API_RUN}`);
  // `--workers 0` — `tflw run` refuses it (usage, exit 2) before any report is written.
  const before = (await (await fetch(`${baseUrl}/api/runs`)).json()) as { id: string }[];
  await page.locator('[data-workers]').fill('0');
  await page.locator('[data-run]').click();
  const pane = page.locator('[data-live]');
  await pane.locator('[data-stderr]').waitFor({ timeout: 60_000 });
  const runs = (await (await fetch(`${baseUrl}/api/runs`)).json()) as { id: string; status: string; exitCode: number | null; kept: string | null }[];
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
  files: { path: string; tests: { name: string; line: number; tags: string[]; workload: boolean; lenses: string[] }[]; crawls: { name: string; line: number; lenses: string[] }[] }[];
}
const fullProject = async (): Promise<FullProject> => (await (await fetch(`${baseUrl}/api/project`)).json()) as FullProject;

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
    await page.goto(`${baseUrl}#/api/source/${f.path}`);
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
  await page.goto(`${baseUrl}#/api/source/${elsewhere.path}`);
  const row = page.locator(`[data-source-test="${elsewhere.name}"]`);
  await row.waitFor();
  assert.equal(await row.getAttribute('data-test-here'), 'no', 'the row says this door is not one of its own');
  const also = await row.locator('[data-also]').evaluateAll((els) => els.map((e) => e.getAttribute('data-also')!).sort());
  assert.deepEqual(also, [...elsewhere.lenses].sort(), 'and names every door it is behind');
  // The sidebar cannot say this: it lists the file with a count and never the test.
  await page.goto(`${baseUrl}${API_DOOR}`);
  await page.locator('[data-files]').waitFor();
  assert.equal(await page.locator(`[data-project-test="${elsewhere.name}"]`).count(), 0);
});

// The scroll half of `D1067`, on a project of its own.
//
// The shared fixture's longest file is 23 lines, and `scrollIntoView({block: 'center'})` cannot
// centre a line the page has no room to scroll past — so on that fixture the gate is satisfied by
// any scroll at all. Measured: a row pointing **three lines off** left the target on screen and the
// first draft of this test passed. A file long enough to have a middle is the instrument.
test('an index row scrolls the text to its own line, and puts that line in the middle', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-s2-scroll-'));
  const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await browser.newPage({ viewport: { width: 900, height: 300 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    const body: string[] = [];
    for (let i = 0; i < 24; i++) body.push('@api', `test "case ${i}"`, `  api GET /c/${i}`, '  expect status equals 200', '');
    await writeFile(join(dir, 'long.tflw'), body.join('\n'));
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;

    await fresh.goto(`${base}/#/api/source/long.tflw`);
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
    await page.goto(`${baseUrl}#/${door}`);
    await page.locator('[data-files]').waitFor();
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
    await page.goto(`${baseUrl}#/${door}`);
    await page.locator('[data-files]').waitFor();
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
  const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await browser.newPage();
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    await mkdir(join(dir, 'shared'), { recursive: true });
    // A fragment: an action and nothing else. Every project that shares a login has one.
    await writeFile(join(dir, 'shared', 'root.tflw'), ['action "the root" do', '  api GET /', '  expect status equals 200', ''].join('\n'));
    // A file with tests, none of them behind BROWSER — the `0` state, which IS dimmed.
    await writeFile(join(dir, 'api.tflw'), ['@api', 'test "the catalogue answers"', '  api GET /catalog', '  expect status equals 200', ''].join('\n'));
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;

    await fresh.goto(`${base}/#/browser`);
    await fresh.locator('[data-files]').waitFor();
    assert.equal(await fresh.locator('[data-file]').count(), 2, 'the fragment is listed at all — it was in no list before this slice');

    const fragment = fresh.locator('[data-file="shared/root.tflw"]');
    const fCount = fragment.locator('[data-door-count]');
    assert.equal(await fCount.getAttribute('data-door-count-state'), 'fragment');
    assert.equal(await fCount.textContent(), '—');
    assert.doesNotMatch((await fragment.locator('> .file-row').getAttribute('class'))!, /\bmuted\b/, 'a fragment declares nothing by nature and is not dimmed for it');

    const withTests = fresh.locator('[data-file="api.tflw"]');
    const wCount = withTests.locator('[data-door-count]');
    assert.equal(await wCount.getAttribute('data-door-count-state'), 'none');
    assert.equal(await wCount.textContent(), '0');
    assert.match((await withTests.locator('> .file-row').getAttribute('class'))!, /\bmuted\b/, 'has tests, none behind this door — dimmed');

    // And on the door it IS behind, the same row counts.
    await fresh.goto(`${base}/#/api`);
    await fresh.locator('[data-files]').waitFor();
    assert.equal(await fresh.locator('[data-file="api.tflw"] [data-door-count]').textContent(), '1');
    assert.equal(await fresh.locator('[data-file="shared/root.tflw"] [data-door-count]').textContent(), '—', 'the fragment reads the same behind every door');

    // The fragment is now openable, which is the capability `D1062` is for: it was in no list, so
    // it could not be read in Source or edited anywhere.
    await fresh.goto(`${base}/#/api/source/shared/root.tflw`);
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
  const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    const deep = 'tests/api/identity/session-refresh-and-oauth2-and-then-some.tflw';
    await mkdir(join(dir, 'tests', 'api', 'identity'), { recursive: true });
    await writeFile(join(dir, deep), ['@api', 'test "it answers"', '  api GET /x', '  expect status equals 200', ''].join('\n'));
    const port = await ui.listen(0);
    await fresh.goto(`http://127.0.0.1:${port}/#/api`);
    await fresh.locator('[data-files]').waitFor();

    const row = fresh.locator(`[data-file="${deep}"] > .file-row`);
    const box = (await row.boundingBox())!;
    const lineHeight = Number(await row.evaluate((el) => parseFloat(el.ownerDocument.defaultView!.getComputedStyle(el).lineHeight)));
    assert.ok(box.height <= lineHeight + 8, `the row is one line (${box.height} against a ${lineHeight} line)`);
    // Truncated, not shortened: the element is narrower than the text it holds.
    const code = fresh.locator(`[data-file="${deep}"] code`);
    const { client, scroll } = await code.evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
    assert.ok(scroll > client, `the name is clipped rather than fitting (${scroll} into ${client})`);
    // And nothing is lost: the whole path is on the row and in the address.
    assert.equal(await row.getAttribute('title'), deep);
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a folder collapses, and the address reopens it (`D1066` — expansion is inferred, never in the URL)', async () => {
  await page.goto(`${baseUrl}${API_DOOR}`);
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
  await page.goto(`${baseUrl}#/api/source/${nested.path}`);
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
      assert.equal(await page.locator('aside.sidebar [data-env-select], aside.sidebar [data-workers], aside.sidebar [data-run], aside.sidebar [data-cancel]').count(), 0, `the sidebar assembles no command on ${where}`);
    }
  }
});

test("the narrowing is the explorer's gesture and the strip reads it back — one request across two panes", async () => {
  // **Reloaded, not merely navigated to.** `goto` to a URL that differs only in its fragment is a
  // fragment navigation and not a load, so the page keeps whatever React state the previous test
  // left behind — which here was a tag chip another test selected and never cleared. The first
  // draft of this test read `/^run all/`, which matches `run all · @load` perfectly well, and so
  // it passed on the wrong page. The assertion is an equality now for the same reason.
  await page.goto(`${baseUrl}${API_DOOR}`);
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
    await page.goto(`${baseUrl}${API_RUN}`);
    await page.reload();
    await page.locator('[data-search]').fill(`@${tag}`);
    assert.equal(await page.locator('[data-run]').getAttribute('data-run-narrowing'), 'tag');
    assert.equal(await page.locator('[data-run]').textContent(), `run @${tag}`);
    const before = new Set(((await (await fetch(`${baseUrl}/api/runs`)).json()) as { id: string }[]).map((r) => r.id));
    await page.locator('[data-run]').click();
    // The run is identified through `/api/runs` rather than by whatever `[data-report]` happens to
    // be selected: this file runs the project several times, so *the report that is not one of the
    // two fixtures* stopped being a unique description some tests ago.
    // Waited for at the server, not at the page: when a run ends the page swaps the live pane for
    // the report it kept, so every DOM landmark this could watch is one the page is in the middle
    // of replacing.
    let mine: { id: string; status: string; kept: string | null } | undefined;
    for (let i = 0; i < 120 && mine?.status !== 'done'; i++) {
      const runs = (await (await fetch(`${baseUrl}/api/runs`)).json()) as { id: string; status: string; kept: string | null }[];
      mine = runs.find((r) => !before.has(r.id));
      if (mine?.status !== 'done') await new Promise((r) => setTimeout(r, 500));
    }
    assert.equal(mine?.status, 'done', 'the run finished');
    assert.ok(mine.kept, 'the run kept a directory');
    const written = JSON.parse(await readFile(join(root, mine.kept, 'results.json'), 'utf8')) as RunReport;
    assert.deepEqual(written.tests.map((t) => t.name).sort(), expected, 'the run is the tag, not the files');
  } finally {
    target.close();
    await page.locator('[data-search]').fill('');
  }
});

test('the box says which of the two things a query is doing', async () => {
  await page.goto(`${baseUrl}${API_DOOR}`);
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
  await page.goto(`${baseUrl}${API_DOOR}`);
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
  await page.goto(`${baseUrl}${API_DOOR}`);
  await page.reload();
  await page.locator('[data-files]').waitFor();
  const view = await fullProject();
  const tag = [...new Set(view.files.flatMap((f) => f.tests.flatMap((t) => t.tags)))].sort()[0]!;
  await page.locator('[data-search]').fill(`@${tag}`);
  const link = page.url();
  assert.match(new URL(link).hash, new RegExp(`[?&]q=%40${tag}`));

  const fresh = await browser.newPage();
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
  assert.match(new URL(page.url()).hash, /\?files=[^&]+&q=/);
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
  await page.goto(`${baseUrl}${API_DOOR}`);
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
  await page.goto(`${baseUrl}${API_DOOR}`);
  await page.reload();
  await page.locator('[data-files]').waitFor();
  const rows = await page.locator('[data-file-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-file-row')!));
  await page.locator(`[data-file-row="${rows[0]}"]`).click();
  await page.locator(`[data-file-row="${rows[2]}"]`).click({ modifiers: ['ControlOrMeta'] });
  const link = page.url();
  assert.match(new URL(link).hash, /\?files=/);

  // `D1066`'s whole point: a link reproduces a run, and a reload never silently empties the button.
  const fresh = await browser.newPage();
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
  await page.goto(`${baseUrl}#/api/compose/${rows[0]}`);
  await page.locator('[data-files]').waitFor();
  assert.deepEqual(await selectedFiles(page), []);
  assert.equal(await page.locator('[data-runstrip] [data-run]').textContent(), 'run all');
});

test('a folder means its files (`D1069`) — plain click folds, cmd-click selects what is under it', async () => {
  await page.goto(`${baseUrl}${API_DOOR}`);
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

test('Compose has no `file` control on any door — the explorer names the file (`M205` Q7)', async () => {
  for (const [door, attr] of [['api', 'data-api-file'], ['browser', 'data-browser-file'], ['load', 'data-load-file'], ['scan', 'data-scan-file']]) {
    await page.goto(`${baseUrl}#/${door}`);
    await page.locator('[data-files]').waitFor();
    assert.equal(await page.locator(`[${attr}]`).count(), 0, `${door}'s Compose no longer states the file a second time`);
  }
  // And the one control that does name it still works: a click opens the file and the form writes
  // into it.
  const view = await fullProject();
  const target = view.files.find((f) => f.tests.length > 0)!.path;
  await page.goto(`${baseUrl}#/api`);
  await page.locator('[data-files]').waitFor();
  await page.locator(`[data-file-row="${target}"]`).click();
  assert.equal(await page.locator('[data-api-save]').textContent(), `write ${target}`);
});

// ---------------------------------------------------------------------------
// `M200` `A0-3` — the shell: four doors, a lens derived from constructs, a switcher.
// Graded against `GET /api/project`, which carries the derivation the server computed with
// `@tflw/lang`'s own function — never against a number written in this file.
// ---------------------------------------------------------------------------

/** The project as the server derived it, used as this section's oracle. */
async function projectView(): Promise<{ files: { path: string; tests: { name: string; lenses: string[] }[]; crawls: { name: string; lenses: string[] }[] }[] }> {
  return (await (await fetch(`${baseUrl}/api/project`)).json()) as never;
}

test('the landing is four doors, each counting what is actually behind it', async () => {
  await page.goto(baseUrl);
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
  await page.goto(baseUrl);
  await page.locator('[data-door="load"]').click();
  await page.locator('[data-files]').waitFor();
  assert.equal(new URL(page.url()).hash, '#/load');
  assert.equal(await page.locator('[data-doorbar]').getAttribute('data-doorbar'), 'load');

  // The back button works, because the hash is the state.
  await page.goBack();
  await page.locator('[data-landing]').waitFor();

  // And a pasted link opens where it says, with nothing remembered from the visit above.
  await page.goto(`${baseUrl}#/scan`);
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
      await page.goto(`${baseUrl}#/${lens}/source/${test_.path}`);
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
  await page.goto(`${baseUrl}#/api/source/${tagged.path}`);
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
  await page.goto(`${baseUrl}#/api`);
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
// `M200` `A0-4` — the LOAD door writes a file. §5's green condition, in a real browser:
// pick LOAD, build a workload test by form, write it, and find those bytes on disk — then run
// the project and read the charts of the test the page itself wrote.
// ---------------------------------------------------------------------------

test('the LOAD form writes a real file, and the bytes on disk are the bytes it previewed', async () => {
  await page.goto(`${baseUrl}#/load`);
  await page.reload(); // the form's fields are component state, and a hash change does not reset them
  await page.locator('[data-load-form]').waitFor();

  // A file to write into, chosen by the form's own picker rather than by this test.
  const target = 'tests/load.tflw';
  await page.locator(`[data-file-row="${target}"]`).click();
  await page.locator('[data-load-name]').fill('written by the page');
  await page.locator('[data-load-tags]').fill('load authored');
  await page.locator('[data-load-shape]').selectOption('iterations');
  await page.locator('[data-load-field="count"]').fill('42');
  await page.locator('[data-load-field="vus"]').fill('3');
  await page.locator('[data-threshold-metric="0"]').selectOption('errorRate');
  await page.locator('[data-threshold-bound="0"]').fill('0.23');

  // The preview is the bytes the PUT will carry — the same value, not a rendering of it.
  const preview = await page.locator('[data-load-preview]').textContent();
  assert.ok(preview?.includes('@load @authored'), preview ?? '');  // one line, the corpus convention
  assert.ok(preview?.includes('test "written by the page"'), preview ?? '');
  assert.ok(preview?.includes('run 42 iterations across 3 users'), preview ?? '');
  // `0.23%` is one of the 1,007 two-decimal percentages a naive `* 100` breaks on.
  assert.ok(preview?.includes('threshold error rate is less than 0.23%'), preview ?? '');

  const before = await readFile(join(root, target), 'utf8');
  await page.locator('[data-load-save]').click();
  await page.locator('[data-load-wrote]').waitFor();

  const after = await readFile(join(root, target), 'utf8');
  assert.notEqual(after, before, 'the file changed');
  assert.equal(after, preview, 'the bytes on disk are exactly what the page showed');

  // And it is a file `tflw run` can read — asserted by the tool itself, not by this test's eye.
  const check = execFileSync(process.execPath, ['--import', tsxLoader, cliEntry, 'check'], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  assert.ok(!/error/i.test(check), check);

  // The page's own projection agrees: the new test is behind LOAD, derived from the workload
  // line it just wrote and not from the `@load` tag beside it.
  const view = (await (await fetch(`${baseUrl}/api/project`)).json()) as { files: { path: string; tests: { name: string; lenses: string[]; workload: boolean }[] }[] };
  const written = view.files.find((f) => f.path === target)?.tests.find((t) => t.name === 'written by the page');
  assert.ok(written, 'the server sees the test the page wrote');
  assert.equal(written.workload, true);
  assert.ok(written.lenses.includes('load'));
});

test('an existing test gains a threshold from the LOAD lens, and nothing else in the file moves', async () => {
  // §5's second clause, and `D1044`'s own case: a test authored as an API test picks up load
  // evidence from this door without any of its other steps being touched.
  const target = 'tests/catalog.tflw';
  const before = await readFile(join(root, target), 'utf8');

  await page.goto(`${baseUrl}#/load`);
  await page.reload(); // the form's fields are component state, and a hash change does not reset them
  await page.locator('[data-load-form]').waitFor();
  await page.locator(`[data-file-row="${target}"]`).click();
  await page.locator('[data-load-mode]').selectOption('existing');
  const first = (await (await fetch(`${baseUrl}/api/project`)).json()) as { files: { path: string; tests: { name: string; lenses: string[] }[] }[] };
  const victim = first.files.find((f) => f.path === target)!.tests[0]!;
  assert.ok(!victim.lenses.includes('load'), `${victim.name} must not already be behind LOAD`);

  await page.locator('[data-load-test]').selectOption(victim.name);
  // The workload checkbox stays untouched: this clause is `D1044`'s — a threshold alone, and the
  // test keeps running the way it always did.
  assert.equal(await page.locator('[data-load-also-workload]').isChecked(), false, 'a workload line is opt-in');
  await page.locator('[data-threshold-metric="0"]').selectOption('duration');
  await page.locator('[data-threshold-percentile="0"]').fill('95');
  await page.locator('[data-threshold-bound="0"]').fill('500');
  await page.locator('[data-load-save]').click();
  await page.locator('[data-load-wrote]').waitFor();

  const after = await readFile(join(root, target), 'utf8');
  // Every line the author wrote is still there, in order, with one line added.
  const added = after.split('\n').filter((l) => !before.split('\n').includes(l));
  assert.deepEqual(added, ['  threshold p95 duration is less than 500ms'], after);

  const view = (await (await fetch(`${baseUrl}/api/project`)).json()) as { files: { path: string; tests: { name: string; lenses: string[] }[] }[] };
  const now = view.files.find((f) => f.path === target)!.tests.find((t) => t.name === victim.name)!;
  assert.ok(now.lenses.includes('load'), 'a threshold alone is load evidence (D1044)');
  assert.ok(now.lenses.includes('api'), 'and it is still behind API — a door grants nothing and takes nothing away');
});

test('a write against a file that moved underneath is refused, and says what to do', async () => {
  // Prediction §6.2: the write route's first defect is concurrency. Here it is, deliberately —
  // the page holds an etag, a terminal changes the file, and the page must not win.
  const target = 'tests/orders.tflw';
  await page.goto(`${baseUrl}#/load`);
  await page.reload(); // the form's fields are component state, and a hash change does not reset them
  await page.locator('[data-load-form]').waitFor();
  await page.locator(`[data-file-row="${target}"]`).click();
  await page.locator('[data-load-name]').fill('racing the terminal');
  await page.locator('[data-load-preview]').waitFor();

  // Somebody else edits it after the page read it.
  const current = await readFile(join(root, target), 'utf8');
  await writeFile(join(root, target), `${current}\n# touched by someone else\n`);

  await page.locator('[data-load-save]').click();
  const message = await page.locator('[data-load-error]').textContent();
  assert.match(message ?? '', /changed on disk/);
  assert.match(message ?? '', /reopen the file/);
  const afterRefusal = await readFile(join(root, target), 'utf8');
  assert.ok(afterRefusal.includes('# touched by someone else'), 'the other edit survived');
  assert.ok(!afterRefusal.includes('racing the terminal'), 'and the page did not win');
});

test('ticking the workload box turns a functional test into a load test, and the derivation follows', async () => {
  // The opt-in branch. Without this, the checkbox's `true` path is code no test reaches — which
  // in this round has three times been the thing a surviving mutation was pointing at.
  const target = 'tests/orders.tflw';
  await page.goto(`${baseUrl}#/load`);
  await page.reload();
  await page.locator('[data-load-form]').waitFor();
  await page.locator(`[data-file-row="${target}"]`).click();
  await page.locator('[data-load-mode]').selectOption('existing');

  const before = (await (await fetch(`${baseUrl}/api/project`)).json()) as { files: { path: string; tests: { name: string; lenses: string[]; workload: boolean }[] }[] };
  const victim = before.files.find((f) => f.path === target)!.tests.find((t) => !t.workload)!;
  await page.locator('[data-load-test]').selectOption(victim.name);
  await page.locator('[data-load-also-workload]').check();
  await page.locator('[data-load-shape]').selectOption('hold');
  await page.locator('[data-load-unit]').selectOption('rps');
  await page.locator('[data-load-field="target"]').fill('5');
  await page.locator('[data-load-field="seconds"]').fill('2');
  await page.locator('[data-threshold-metric="0"]').selectOption('errorRate');
  await page.locator('[data-threshold-bound="0"]').fill('1');

  const preview = await page.locator('[data-load-preview]').textContent();
  assert.ok(preview?.includes('  hold 5 rps for 2s'), preview ?? '');
  await page.locator('[data-load-save]').click();
  await page.locator('[data-load-wrote]').waitFor();

  const after = (await (await fetch(`${baseUrl}/api/project`)).json()) as { files: { path: string; tests: { name: string; lenses: string[]; workload: boolean }[] }[] };
  const now = after.files.find((f) => f.path === target)!.tests.find((t) => t.name === victim.name)!;
  assert.equal(now.workload, true, 'it has a workload line now');
  assert.ok(now.lenses.includes('load') && now.lenses.includes('api'), 'behind both doors, by what it carries');

  // And a test that already has one cannot be given a second: the box is disabled for it.
  await page.locator('[data-load-test]').selectOption(victim.name);
  assert.equal(await page.locator('[data-load-also-workload]').isDisabled(), true);
});

// ---------------------------------------------------------------------------
// `M200` `A3-5` — the BROWSER door. Two tests: the door writing a whole test with a `within`
// around it, and the door adding steps to a test that already opened a page. The split matters
// because the second deliberately writes NO `open` — a browser test navigates once.
// ---------------------------------------------------------------------------

test('the BROWSER door has the same five tabs, and its run pane is only reachable through Run', async () => {
  // `M206` `S2b`. The strip propagates unchanged — the tab set is universal (`Q1`), so this is the
  // same five, at the same addresses, on a door whose Compose is a different form entirely.
  await page.goto(`${baseUrl}#/browser`);
  await page.reload();
  await page.locator('[data-browser-form]').waitFor();
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
  await page.locator('[data-browser-run-tab]').waitFor();
  assert.ok((await page.locator('[data-browser-run-tab] .runs').count()) > 0, 'Run does not hold the run pane it was given');

  // THE STATE CLAIM, and here it is strictly stronger than the API one. That test says it cannot
  // distinguish a hidden panel from an unmounted one; this door's Compose genuinely unmounts, so
  // the assertion is that the values return ACROSS AN UNMOUNT — which is only true because the
  // fields are `useState` in `BrowserForm`, above the panels.
  await openTab('compose');
  await page.locator('[data-browser-name]').fill('typed before leaving');
  await openTab('source');
  assert.equal(await page.locator('[data-browser-compose]').count(), 0, 'Compose did not unmount, so surviving it proves nothing');
  await openTab('compose');
  assert.equal(await page.locator('[data-browser-name]').inputValue(), 'typed before leaving');
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
  await page.goto(`${baseUrl}#/load`);
  await page.reload();
  await page.locator('[data-load-form]').waitFor();
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
  await page.locator('[data-load-run-tab]').waitFor();
  assert.ok((await page.locator('[data-load-run-tab] .runs').count()) > 0, 'Run does not hold the run pane it was given');

  // THE STATE CLAIM, across a real unmount — the fields are `useState` in `LoadForm`, above the
  // panels, so Compose genuinely goes away and the values still come back. Two fields rather than
  // one, and a number beside a string, because this form's state is the widest of the four doors:
  // six workload shapes and a threshold table.
  await openTab('compose');
  await page.locator('[data-load-name]').fill('typed before leaving');
  await page.locator('[data-load-field="vus"]').fill('7');
  await openTab('source');
  assert.equal(await page.locator('[data-load-compose]').count(), 0, 'Compose did not unmount, so surviving it proves nothing');
  await openTab('compose');
  assert.equal(await page.locator('[data-load-name]').inputValue(), 'typed before leaving');
  assert.equal(await page.locator('[data-load-field="vus"]').inputValue(), '7');

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
  const sized = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    const read = async (door: 'api' | 'browser' | 'load'): Promise<Record<string, number>> => {
      await sized.goto(`${baseUrl}#/${door}`);
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
    // BROWSER and LOAD have not adopted a reader, so their Compose is still the one-screen form.
    assert.equal(load.compose, browserDoor.compose, "the two doors that kept their forms still agree");

    // And the shape of those numbers, stated rather than left implicit — otherwise three doors
    // that had all regressed identically would satisfy the parity above.
    for (const tab of ['compose', 'source', 'auth', 'config'] as const) {
      assert.equal(load[tab], 900, `LOAD's ${tab} is ${load[tab]} px, not the one screen every door's ${tab} is`);
    }
    // API's Compose is the one that moved, and by how much is recorded rather than pinned: it is a
    // pane that draws a whole file's outline plus one request, so *taller than a screen* is what it
    // is, and a fixture's exact height is not a property worth freezing.
    assert.ok(api.compose! > 900, `API's Compose reads the file now, so it is taller than the form it replaced (${api.compose} px)`);
    assert.ok(load.run! > 900, 'Run fits in a screen, so this fixture has no report and the parity above is between three empty panes');

    // The control this gate needs to mean anything: the instrument can read an overflow at all.
    // Without it `=== 900` is one CSS change away from being the same vacuous assertion the
    // bounding-box reading was, and nothing would say so.
    // The probe is made through `el.ownerDocument` rather than the `document` global: this file is
    // typechecked under `types: ["node"]` with no DOM lib, so the global does not exist for `tsc`
    // even though it exists in the browser this callback is serialised into. `el` is typed by
    // Playwright, so reaching the document through it costs nothing and compiles.
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
  await page.goto(`${baseUrl}#/scan`);
  await page.reload();
  await page.locator('[data-scan-form]').waitFor();
  assert.equal(await page.locator('[data-tabstrip]').getAttribute('data-tabstrip'), 'compose', 'a pre-strip SCANS link stopped opening the door');

  for (const tab of ['source', 'run', 'auth', 'config'] as const) {
    await openTab(tab);
    assert.equal(new URL(page.url()).hash, `#/scan/${tab}`, `${tab} is not an address on this door`);
    assert.equal(await page.locator('[data-doorbar]').getAttribute('data-doorbar'), 'scan', 'a tab unseated the door');
  }
  await openTab('compose');
  assert.equal(new URL(page.url()).hash, '#/scan', 'the default tab stopped writing the bare door hash');

  assert.equal(await page.locator('.main > .runs').count(), 0, 'the run pane is still inline under the SCANS form');
  await openTab('run');
  await page.locator('[data-scan-run-tab]').waitFor();
  assert.ok((await page.locator('[data-scan-run-tab] .runs').count()) > 0, 'Run does not hold the run pane it was given');

  // **THE UNIVERSAL CLAIM, WHICH NO EARLIER SLICE COULD MAKE.** Every door, not this one: after
  // `S2` the inline placement does not exist for any value of `door`, so it is checked by walking
  // all four rather than by trusting that three previous gates still hold. A conditional narrowed
  // to a door that no longer needs it would pass every per-door test above and fail this.
  for (const door of ['api', 'browser', 'load', 'scan'] as const) {
    await page.goto(`${baseUrl}#/${door}`);
    await page.reload();
    await page.locator('[data-doorbar]').waitFor();
    assert.equal(await page.locator('.main > .runs').count(), 0, `${door} still renders its runs inline`);
  }

  // The state claim, across a real unmount, as on the other two doors — and this door needs a
  // wider one than they did. `data-scan-name` does not exist until the mode is `new`, because
  // SCANS opens on `existing`: its measured common act is grading a response a test already
  // fetched (102 matchers across 51 files against 11 crawls in 4). So the field is reachable only
  // through a piece of state that must ALSO survive, and the assertion covers both — a mode that
  // reset would take the field with it and a name-only check would time out rather than fail
  // clearly.
  await page.goto(`${baseUrl}#/scan`);
  await page.reload();
  await page.locator('[data-scan-form]').waitFor();
  assert.equal(await page.locator('[data-scan-mode]').inputValue(), 'existing', 'SCANS stopped opening on the act its census says is the common one');
  await page.locator('[data-scan-mode]').selectOption('new');
  await page.locator('[data-scan-name]').fill('typed before leaving');
  await page.locator('[data-scan-family]').selectOption('hasNoAuthzViolations');
  await openTab('source');
  assert.equal(await page.locator('[data-scan-compose]').count(), 0, 'Compose did not unmount, so surviving it proves nothing');
  await openTab('compose');
  assert.equal(await page.locator('[data-scan-mode]').inputValue(), 'new', 'the mode reset, so the field below it was never the thing at risk');
  assert.equal(await page.locator('[data-scan-name]').inputValue(), 'typed before leaving');
  assert.equal(await page.locator('[data-scan-family]').inputValue(), 'hasNoAuthzViolations');
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
  const fresh = await browser.newPage();
  try {
    execFileSync(process.execPath, ['--import', tsxLoader, cliEntry, 'init', '--scan'], { cwd: dir, stdio: 'pipe' });
    const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
    try {
      const base = `http://127.0.0.1:${await ui.listen(0)}`;
      await fresh.goto(`${base}#/scan`);
      await fresh.locator('[data-scan-unauthorized]').waitFor();

      // `tflw init --scan` leaves the line commented out on purpose (`D291`), so this project is
      // the unauthorized state — which is the only state the notice renders in today, and the
      // reason `S5` exists at all.
      const notice = (await fresh.locator('[data-scan-unauthorized]').textContent()) ?? '';
      assert.match(notice, /TF060/, 'the notice stopped naming what the write will get');

      // COMPOSE DOES NOT ENUMERATE. Asserted against the element Auth uses to list them, so this
      // cannot pass by the list merely being spelled differently.
      assert.equal(await fresh.locator('[data-scan-compose] [data-auth-targets]').count(), 0, 'Compose grew its own copy of the target list');

      // The link goes to Auth — the address, not just the panel, because the tab living in the URL
      // and nowhere else is `D1045` and is what makes this shareable rather than a callback.
      await fresh.locator('[data-scan-auth-link]').click();
      await fresh.locator('[data-tabstrip="auth"]').waitFor();
      assert.equal(new URL(fresh.url()).hash, '#/scan/auth', 'the link did not put the tab in the address');
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
  await page.goto(`${baseUrl}#/browser/config`);
  await page.reload();
  await page.locator('[data-api-config-text]').waitFor();
  const original = await page.locator('[data-api-config-text]').inputValue();
  await page.locator('[data-api-config-text]').fill(`${original}\n# an edit nobody saved\n`);
  await page.locator('[data-tab-mark="config"]').waitFor();

  // Leave by the DOOR, not by the tab — the whole point of this gate.
  await page.locator('[data-door-tab="api"]').click();
  await page.locator('[data-api-form]').waitFor();
  await page.locator('[data-door-tab="browser"]').click();
  await page.locator('[data-browser-form]').waitFor();
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
  await page.goto(`${baseUrl}#/scan/config`);
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
  await page.goto(`${baseUrl}#/scan/config/@headers`);
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

test('the BROWSER form writes a whole test — open, a scoped block, and an assertion', async () => {
  await page.goto(`${baseUrl}#/browser`);
  await page.reload();
  await page.locator('[data-browser-form]').waitFor();

  const target = 'tests/orders.tflw';
  await page.locator(`[data-file-row="${target}"]`).click();
  const before = await readFile(join(root, target), 'utf8');

  await page.locator('[data-browser-mode]').selectOption('new');
  await page.locator('[data-browser-name]').fill('the cart holds what was added');
  await page.locator('[data-browser-tags]').fill('web');
  await page.locator('[data-browser-open]').fill('/catalogue');

  // Row 0 is a click, which is the default because `click` is 766 of the corpus' browser steps.
  await page.locator('[data-browser-value="0"]').fill('Add to cart');

  // **THE SCOPE IS A `within`, AND IT WRAPS THE ROWS RATHER THAN SITTING BESIDE THEM.** A form
  // that emitted the block and the steps as siblings would preview something that parses and means
  // something else, which no diagnostic would catch — so the assertion below is on INDENTATION.
  await page.locator('[data-browser-scoped]').check();
  await page.locator('[data-browser-kind="scope"]').selectOption('css');
  await page.locator('[data-browser-value="scope"]').fill('#cart');

  await page.locator('[data-browser-add]').click();
  await page.locator('[data-browser-action="1"]').selectOption('expect');
  await page.locator('[data-browser-kind="1"]').selectOption('text');
  await page.locator('[data-browser-value="1"]').fill('Subtotal');
  await page.locator('[data-browser-matcher="1"]').selectOption('visible');

  const preview = (await page.locator('[data-browser-preview]').textContent()) ?? '';
  assert.match(preview, /open "\/catalogue"/);
  // Four spaces, not two: the click and the assertion are INSIDE the block, and a `within` printed
  // as a sibling would show them at two.
  assert.match(preview, /\n {2}within css "#cart"\n {4}click button "Add to cart"\n {4}expect text "Subtotal" is visible/);
  // **AND EACH STEP EXACTLY ONCE**, which the shape assertion above cannot say. A form that
  // emitted the block AND its steps as siblings — `[block, ...steps]` rather than `[block]` —
  // still satisfies every pattern above, because the block and its indented children are all
  // still there; the duplicates simply follow. Found by a mutation that survived the first draft.
  for (const line of ['click button "Add to cart"', 'expect text "Subtotal" is visible', 'within css "#cart"']) {
    assert.equal(preview.split(line).length - 1, 1, `${line} must appear exactly once:\n${preview}`);
  }

  await page.locator('[data-browser-save]').click();
  await page.locator('[data-browser-wrote]').waitFor();

  const after = await readFile(join(root, target), 'utf8');
  assert.equal(after, preview, 'what was shown is what was written');
  assert.notEqual(after, before);

  // And `tflw check` reads it — the claim that makes the preview worth anything (`D1052`).
  const check = execFileSync(process.execPath, ['--import', tsxLoader, cliEntry, 'check'], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  assert.ok(!/error/i.test(check), check);

  await writeFile(join(root, target), before, 'utf8');
});

test('the BROWSER form adds steps to a test that already opened a page, and writes no second `open`', async () => {
  // A browser test navigates once — 270 `open`s across 244 browser tests — so adding steps to an
  // existing one must NOT re-open. A second `open` would reload the page out from under whatever
  // the test had already set up, and it would still parse, check and run: a defect no gate but
  // this one can see.
  await page.goto(`${baseUrl}#/browser`);
  await page.reload();
  await page.locator('[data-browser-form]').waitFor();

  const target = 'tests/orders.tflw';
  await page.locator(`[data-file-row="${target}"]`).click();
  const before = await readFile(join(root, target), 'utf8');
  const openedBefore = (before.match(/^\s*open /gm) ?? []).length;

  await page.locator('[data-browser-mode]').selectOption('existing');
  const testName = await page.locator('[data-browser-test] option:nth-child(2)').getAttribute('value');
  assert.ok(testName, 'the fixture file must hold a test to extend');
  await page.locator('[data-browser-test]').selectOption(testName);
  await page.locator('[data-browser-action="0"]').selectOption('fill');
  await page.locator('[data-browser-kind="0"]').selectOption('field');
  await page.locator('[data-browser-value="0"]').fill('Coupon');
  await page.locator('[data-browser-operand="0"]').fill('"SAVE10"');

  const preview = (await page.locator('[data-browser-preview]').textContent()) ?? '';
  assert.match(preview, /fill field "Coupon" with "SAVE10"/);
  assert.equal((preview.match(/^\s*open /gm) ?? []).length, openedBefore, 'adding steps must not add an `open`');

  await page.locator('[data-browser-save]').click();
  await page.locator('[data-browser-wrote]').waitFor();

  const after = await readFile(join(root, target), 'utf8');
  assert.equal(after, preview);
  // …and it landed inside the test that was picked.
  const lines = after.split('\n');
  const header = lines.findIndex((l) => l.includes(`test "${testName}"`));
  const filled = lines.findIndex((l) => l.includes('fill field "Coupon"'));
  assert.ok(header >= 0 && filled > header, `the step must sit under its test:\n${after}`);

  await writeFile(join(root, target), before, 'utf8');
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
  const fresh = await browser.newPage();
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local\n  web "http://localhost:3000"\n  api "http://127.0.0.1:1"\n', 'utf8');
    await writeFile(join(dir, 'web.tflw'), 'test "a page"\n  open "/"\n  expect text "Hi" is visible\n', 'utf8');
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
    const srv = new UiServer({ root: dir, cliEntry: stub, execArgv: [], staticDir: join(scratch, 'ui') });
    const port = await srv.listen(0);
    const url = `http://127.0.0.1:${port}/`;
    try {
      await fresh.goto(`${url}#/browser`);
      await fresh.locator('[data-browser-form]').waitFor();
      await fresh.locator('[data-browser-pick]').first().click();
      await fresh.locator('[data-browser-picking]').waitFor();

      // The child exists, and the strip says so — the mark is the only thing on the page that will
      // still be true once Compose is gone, because the `.picking` pane lives inside it.
      await fresh.locator('[data-tab-mark="compose"]').waitFor();
      // Polled, not read once: the child spawns and writes on the server's schedule, and the
      // `.picking` pane appears the moment the button is pressed — `setPicking` runs before the
      // stream connects — so the pane is NOT evidence the process exists. Reading immediately
      // failed with `ENOENT` on the first run here, which is `M205-08`'s race a second time and in
      // this round's own gate.
      const pid = await waitForPidFile(pidFile);
      process.kill(pid, 0);

      // HALF ONE — a tab switch must NOT kill it. Compose genuinely unmounts here, so this is the
      // half that would break the moment the session's state slipped down into the panel.
      await fresh.locator('[data-tab="source"]').click();
      await fresh.locator('[data-tabstrip="source"]').waitFor();
      assert.equal(await fresh.locator('[data-browser-compose]').count(), 0, 'Compose did not unmount, so surviving it proves nothing');
      await new Promise((r) => setTimeout(r, 300));
      process.kill(pid, 0); // throws ESRCH if the tab switch killed the browser
      await fresh.locator('[data-tab-mark="compose"]').waitFor();

      // HALF TWO — leaving the DOOR must kill it. This is the promise `BrowserForm`'s cleanup
      // comment has always made (*leaving this door must not leave it running*) and that nothing
      // has ever checked.
      await fresh.locator('[data-door-tab="api"]').click();
      await fresh.locator('[data-api-form]').waitFor();
      await waitForExit(pid);
    } finally {
      await srv.close();
    }
  } finally {
    await fresh.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the BROWSER form picks a locator from a live session and fills the field with it', async () => {
  // `D1055`. **Driven against a STUB `tflw pick`, deliberately, and the reason is this morning.**
  // The real command opens a real, visible browser and waits for a human to click something — a
  // page gate cannot produce that click, and spawning one headed browser per run on a shared box
  // to assert a banner is a cost with no claim attached. This box was carrying fourteen orphaned
  // `Xvfb` servers from killed runs when `A2-6` started; a gate that leaves browsers behind is the
  // same defect in a test's clothing.
  //
  // What is left after the stub is every claim this slice actually makes: the session is spawned
  // for the path the form is writing, the lines arrive, they are CLASSIFIED BY THE GRAMMAR, and
  // clicking a suggestion fills the field it was opened for. The real command's own behaviour is
  // covered where it lives, and `pickArgv`/`pickUrl` pin the boundary between them.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-pick-door-'));
  const stub = join(dir, 'stub.mjs');
  const fresh = await browser.newPage();
  // **A THROWN HANDLER AND A FILTERED LINE LOOK IDENTICAL FROM THE OUTSIDE**, which is how the
  // kind check nearly shipped unverified. Remove it and a banner — a `MalformedStep`, with no
  // `.locator` — makes `locatorFromPickLine` throw inside the stream callback; the suggestion is
  // not added, the count is still 2, the contents are still right, and every assertion below
  // passes. Only the error itself distinguishes them, and nothing but the browser can see it.
  const pageErrors: string[] = [];
  fresh.on('pageerror', (e) => pageErrors.push(e.message));
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local\n  web "http://localhost:3000"\n  api "http://127.0.0.1:1"\n', 'utf8');
    await writeFile(join(dir, 'web.tflw'), 'test "a page"\n  open "/"\n  expect text "Hi" is visible\n', 'utf8');
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

    const ui = new UiServer({ root: dir, cliEntry: stub, execArgv: [], staticDir: join(scratch, 'ui') });
    try {
      const base = `http://127.0.0.1:${await ui.listen(0)}`;
      await fresh.goto(`${base}#/browser`);
      await fresh.locator('[data-browser-form]').waitFor();
      await fresh.locator('[data-browser-open]').fill('/checkout');

      await fresh.locator('[data-browser-pick="0"]').click();
      await fresh.locator('[data-browser-picking="0"]').waitFor();

      // **EXACTLY TWO SUGGESTIONS, NOT FOUR.** The stub writes four lines and two of them are
      // banners; the form asks the parser whether `click <line>` is a click step rather than
      // excluding the banner text, so a reworded banner cannot become a locator and a locator
      // whose text happens to read like prose cannot be dropped.
      // Waited on the COUNT, not on the element: the empty state renders `data-browser-picked="0"`
      // immediately, so waiting for the attribute to exist resolves before a single line has
      // arrived and reads 0 every time.
      await fresh.locator('[data-browser-picked="2"]').waitFor();
      assert.equal(await fresh.locator('[data-browser-apply]').count(), 2, 'the two banner lines are not locators');

      // Clicking a suggestion fills the field the session was opened for — and the KIND travels
      // with it, which a form storing only the text would lose.
      await fresh.locator('[data-browser-apply="0"]').click();
      assert.equal(await fresh.locator('[data-browser-value="0"]').inputValue(), '#totals .amount');
      assert.equal(await fresh.locator('[data-browser-kind="0"]').inputValue(), 'css');

      // …and it reaches the file, which is the only claim that matters in the end.
      const preview = (await fresh.locator('[data-browser-preview]').textContent()) ?? '';
      assert.match(preview, /click css "#totals \.amount"/);

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

test('the SCANS form grades a response a test already fetches, and writes the assertion into that test', async () => {
  await page.goto(`${baseUrl}#/scan`);
  await page.reload();
  await page.locator('[data-scan-form]').waitFor();

  // The fixture declares `authorized target "http://127.0.0.1:4717"`, so the notice is ABSENT —
  // which is the control that keeps the other test's assertion about the declaration rather than
  // about a banner that is always there.
  assert.equal(await page.locator('[data-scan-unauthorized]').count(), 0);

  const target = 'tests/orders.tflw';
  await page.locator(`[data-file-row="${target}"]`).click();
  const before = await readFile(join(root, target), 'utf8');
  const testName = await page.locator('[data-scan-test] option:nth-child(2)').getAttribute('value');
  assert.ok(testName, 'the fixture file must hold a test to grade');
  await page.locator('[data-scan-test]').selectOption(testName);
  await page.locator('[data-scan-family]').selectOption('hasNoInputHandlingViolations');
  await page.locator('[data-scan-floor]').selectOption('serious');
  await page.locator('[data-scan-soft]').check();

  // Every field is in the line, in the grammar's order — and `check`/`expect`, the family and the
  // floor are three independent positions, so a preview carrying only one of them could not tell a
  // printer that dropped another.
  const preview = (await page.locator('[data-scan-preview]').textContent()) ?? '';
  assert.match(preview, /check response has no serious input handling violations/);

  await page.locator('[data-scan-save]').click();
  await page.locator('[data-scan-wrote]').waitFor();

  // The bytes on disk are the bytes previewed — the claim every door in this arc makes.
  const after = await readFile(join(root, target), 'utf8');
  assert.equal(after, preview, 'what was shown is what was written');
  assert.notEqual(after, before);
  assert.match(after, /check response has no serious input handling violations/);

  // …and it landed INSIDE the test that was picked, not at the end of the file.
  const lines = after.split('\n');
  const header = lines.findIndex((l) => l.includes(`test "${testName}"`));
  const assertionLine = lines.findIndex((l) => l.includes('has no serious input handling violations'));
  assert.ok(header >= 0 && assertionLine > header, `the assertion must sit under its test:\n${after}`);

  await writeFile(join(root, target), before, 'utf8');
});

test('a project with no `authorized target`: the SCANS form says so, shows the TF060 it will get, and writes anyway', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-scan-door-'));
  const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await browser.newPage();
  try {
    const base = `http://127.0.0.1:${await ui.listen(0)}`;
    await fresh.goto(base);

    // 1. The landing offers to create one, and SCANS now has a scaffold of its own to offer —
    //    `D1053`. Before `A2-4` this door created the plain project and said so.
    await fresh.locator('[data-landing]').waitFor();
    assert.equal(await fresh.locator('[data-door="scan"] [data-door-state]').getAttribute('data-door-state'), 'create');
    await fresh.locator('[data-door="scan"]').click();
    await fresh.locator('[data-scan-form]').waitFor();

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

    // 3. **THE NOTICE.** The declaration is commented out, so the env authorizes nothing, and this
    //    door says it in the one place the author is about to act — naming the file it lives in,
    //    which this page deliberately cannot write (`D1049`/`D291`).
    const notice = (await fresh.locator('[data-scan-unauthorized]').textContent()) ?? '';
    assert.match(notice, /declares no/);
    assert.match(notice, /TF060/);
    assert.match(notice, /tflw\.config/);

    // 4. **AND THE DIAGNOSTIC, WHICH IS THE WIRING THIS SLICE EXISTS FOR.** `diagnose` ran
    //    `checkProgram` with NO options until `A2-3`, and `TF060` needs the env's declarations —
    //    so this panel would have shown a clean file and the author would have met the error in a
    //    terminal. That is exactly the surprise `D1052` exists to prevent, on the one door where
    //    it is guaranteed rather than possible.
    await fresh.locator(`[data-file-row="scan.tflw"]`).click();
    await fresh.locator('[data-scan-mode]').selectOption('new');
    await fresh.locator('[data-scan-name]').fill('the page can ask for a scan');
    await fresh.locator('[data-scan-path]').fill('/health');
    await fresh.locator('[data-scan-diagnostics]').waitFor();
    // TWO of them, and the second one is the point: the panel judges the whole file the PUT will
    // carry, so the scaffold's own `scan.tflw` assertion is refused alongside the one being added.
    // A test that took `.first()` without saying how many there are would have passed just as well
    // against a panel that showed one.
    const tf060s = fresh.locator('[data-diagnostic-code="TF060"]');
    assert.equal(await tf060s.count(), 2, 'the scaffolded assertion and the new one are both TF060');
    const tf060 = await tf060s.first().textContent();
    assert.ok(tf060?.includes('authorized target'), tf060 ?? 'the panel must carry TF060');

    // 5. It never blocks. `D1052`: a half-written test is a legitimate intermediate state.
    //
    // **And what it writes is READ BACK, not just counted.** The first draft asserted the test name
    // appeared and stopped, so two mutations survived: one that wrote the assertion with no request
    // for it to grade, and one that dropped `as <session>`. A scan grades the LAST response, so a
    // test that asserts one without fetching anything is a file `tflw check` rejects; and an
    // authorization scan re-issues the request under other principals, so a test with no owner
    // gives it nothing to compare against. Both are this door's whole subject, and neither was
    // covered by a test that only checked something had been written.
    await fresh.locator('[data-scan-session]').fill('shopper');
    await fresh.locator('[data-scan-family]').selectOption('hasNoAuthzViolations');
    assert.equal(await fresh.locator('[data-scan-save]').isDisabled(), false);
    await fresh.locator('[data-scan-save]').click();
    await fresh.locator('[data-scan-wrote]').waitFor();

    const written = await readFile(join(dir, 'scan.tflw'), 'utf8');
    const body = written.slice(written.indexOf('test "the page can ask for a scan"'));
    assert.match(body, /^test "the page can ask for a scan" as shopper$/m, 'the principal the scan compares against');
    assert.match(body, /^ {2}api GET \/health$/m, 'the request the assertion grades');
    assert.match(body, /^ {2}expect response has no authorization violations$/m);
    // …and in that order: the request has to precede the assertion that reads its response.
    assert.ok(body.indexOf('api GET /health') < body.indexOf('has no authorization violations'), body);

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
    await fresh.locator('[data-scan-form]').waitFor();
    assert.equal(await fresh.locator('[data-scan-unauthorized]').count(), 0, 'the notice must read the config, not be permanent');
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
  const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await browser.newPage();
  try {
    const base = `http://127.0.0.1:${await ui.listen(0)}`;
    await fresh.goto(base);

    // 1. The landing says there is nothing here, and offers to make one rather than showing four
    //    doors onto an empty project.
    await fresh.locator('[data-landing]').waitFor();
    assert.equal(await fresh.locator('[data-door="load"] [data-door-state]').getAttribute('data-door-state'), 'create');
    assert.match((await fresh.locator('[data-door="load"]').textContent()) ?? '', /create a project, with a load test/);

    // 2. Picking LOAD creates the project and lands in the LOAD door. `tflw init --load`, spawned
    //    — so what is on disk is what a terminal would have written.
    await fresh.locator('[data-door="load"]').click();
    await fresh.locator('[data-load-form]').waitFor();
    assert.equal(new URL(fresh.url()).hash, '#/load');
    const scaffold = await readFile(join(dir, 'load.tflw'), 'utf8');
    const fromTerminal = await mkdtemp(join(tmpdir(), 'tflw-terminal-'));
    execFileSync(process.execPath, ['--import', tsxLoader, cliEntry, 'init', '--load'], { cwd: fromTerminal, stdio: 'pipe' });
    assert.equal(scaffold, await readFile(join(fromTerminal, 'load.tflw'), 'utf8'), 'the page and the terminal write the same bytes');
    await rm(fromTerminal, { recursive: true, force: true });

    // 3. Point the new project at the fixture server, so a run has something to call.
    const config = await readFile(join(dir, 'tflw.config'), 'utf8');
    await writeFile(join(dir, 'tflw.config'), config.replace(/api "[^"]*"/, `api "http://127.0.0.1:${fixturePort}"`));

    // 4. Write a workload test by form, into the file the door scaffolded.
    await fresh.reload();
    await fresh.locator('[data-load-form]').waitFor();
    await fresh.locator(`[data-file-row="load.tflw"]`).click();
    await fresh.locator('[data-load-name]').fill('the health check under load');
    await fresh.locator('[data-load-tags]').fill('load');
    await fresh.locator('[data-load-shape]').selectOption('iterations');
    await fresh.locator('[data-load-field="count"]').fill('4');
    await fresh.locator('[data-load-field="vus"]').fill('2');
    await fresh.locator('[data-threshold-metric="0"]').selectOption('errorRate');
    await fresh.locator('[data-threshold-bound="0"]').fill('100');
    const preview = (await fresh.locator('[data-load-preview]').textContent()) ?? '';
    await fresh.locator('[data-load-save]').click();
    await fresh.locator('[data-load-wrote]').waitFor();
    assert.equal(await readFile(join(dir, 'load.tflw'), 'utf8'), preview, 'the bytes on disk are the bytes previewed');

    // A form cannot write a test that calls anything, so give it one step from the outside — the
    // same splice the page performs, through the same route. `A1` is what makes this a form.
    const withStep = (await readFile(join(dir, 'load.tflw'), 'utf8')).replace(
      '  run 4 iterations across 2 users\n',
      '  run 4 iterations across 2 users\n  api GET /health\n  expect status equals 200\n',
    );
    const etag = ((await (await fetch(`${base}/api/file?path=load.tflw`)).json()) as { etag: string }).etag;
    const put = await fetch(`${base}/api/file`, { method: 'PUT', headers: { 'content-type': 'application/json', 'if-match': etag }, body: JSON.stringify({ path: 'load.tflw', text: withStep }) });
    assert.equal(put.status, 200, await put.text());

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
    const chart = fresh.locator('[data-report] canvas').first();
    await chart.waitFor();
    assert.ok((await chart.boundingBox())!.width > 0, 'the workload charts are painted');

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
// `M200` `A1-4` — the API door writes work, not a policy about work. The LOAD form can only ever
// add a workload line or a threshold, because `api` steps are this door's vocabulary — which is
// the gap `A0-5`'s green-condition test had to write around. These two say it is closed.
// ---------------------------------------------------------------------------

test('the API form writes a request and its assertions in one edit, and the bytes on disk are the bytes it previewed', async () => {
  await page.goto(`${baseUrl}#/api`);
  await page.reload(); // field values are component state; a hash change does not reset them
  await openLegacyForm(page);
  await page.locator('[data-api-form]').waitFor();

  const target = 'tests/orders.tflw';
  await page.locator(`[data-file-row="${target}"]`).click();
  await page.locator('[data-api-name]').fill('the page can place an order');
  await page.locator('[data-api-tags]').fill('api authored');
  await page.locator('[data-api-method]').selectOption('POST');
  await page.locator('[data-api-path]').fill('/orders');
  await page.locator('[data-api-label]').fill('place');

  // A header whose value interpolates a variable NOTHING BINDS. This is `D1052`'s case and it is
  // how it was found: the write route's two `422`s are parse and format (`D1049`), and
  // `"Bearer {token}"` is both — so the first run of this test wrote the file happily and then
  // `tflw check` said `TF030: unknown variable "token"`. The form now says so first.
  await page.locator('[data-header-add]').click();
  await page.locator('[data-header-name="0"]').fill('Authorization');
  await page.locator('[data-header-value="0"]').fill('Bearer {token}');
  await openTab('source');
  await page.locator('[data-diagnostics]').waitFor();
  const unbound = await page.locator('[data-diagnostic-code="TF030"]').textContent();
  assert.ok(unbound?.includes('token'), unbound ?? 'the form should name the unbound variable');
  // And it is a warning about the file, not a veto on the write: `D1052` shows, never blocks.
  await openTab('compose');
  assert.equal(await page.locator('[data-api-save]').isDisabled(), false);

  // Take the reference back out, and the panel goes with it — the control that keeps the
  // assertion above about this header rather than about the panel always being there.
  await page.locator('[data-header-value="0"]').fill('Bearer static-token');
  await openTab('source');
  await page.locator('[data-diagnostics]').waitFor({ state: 'detached' });
  await openTab('compose');

  await page.locator('[data-api-body-kind]').selectOption('json');
  await page.locator('[data-api-body]').fill('{ itemId: 1, qty: 2 }');

  await page.locator('[data-expect-operand="0"]').fill('201');
  await page.locator('[data-expect-add]').click();
  await page.locator('[data-expect-subject="1"]').selectOption('body');
  await page.locator('[data-expect-argument="1"]').fill('items[0].price');
  await page.locator('[data-expect-matcher="1"]').selectOption('greaterThan');
  await page.locator('[data-expect-operand="1"]').fill('0');
  // A THIRD ROW, AND IT IS A `check` OVER A `header`. Both halves were found by the mutation run
  // surviving: with every row an `expect` over `status` or `body`, the mutation collapsing
  // `check` into `expect` and the one sending a literal where the header name goes both changed
  // nothing this test could see. One row that is soft and names a header covers both.
  await page.locator('[data-expect-add]').click();
  await page.locator('[data-expect-kind="2"]').selectOption('check');
  await page.locator('[data-expect-subject="2"]').selectOption('header');
  await page.locator('[data-expect-argument="2"]').fill('content-type');
  await page.locator('[data-expect-matcher="2"]').selectOption('contains');
  await page.locator('[data-expect-operand="2"]').fill('"json"');

  await openTab('source');
  // Source says WHICH of the two things it is showing. The claim below is about bytes that are
  // not on disk yet, so a panel quietly showing the saved file would satisfy every `includes`
  // under it and mean the opposite.
  assert.equal(await page.locator('[data-source]').getAttribute('data-source'), 'pending');
  const preview = await page.locator('[data-preview]').textContent();
  assert.ok(preview?.includes('@api @authored'), preview ?? '');
  assert.ok(preview?.includes('api POST /orders body { itemId: 1, qty: 2 } as "place"'), preview ?? '');
  assert.ok(preview?.includes('header "Authorization" is "Bearer static-token"'), preview ?? '');
  assert.ok(preview?.includes('expect status equals 201'), preview ?? '');
  assert.ok(preview?.includes('expect body.items[0].price is greater than 0'), preview ?? '');
  assert.ok(preview?.includes('check header "content-type" contains "json"'), preview ?? '');

  await openTab('compose');

  const before = await readFile(join(root, target), 'utf8');
  await page.locator('[data-api-save]').click();
  await page.locator('[data-api-wrote]').waitFor();

  const after = await readFile(join(root, target), 'utf8');
  assert.notEqual(after, before, 'the file changed');
  assert.equal(after, preview, 'the bytes on disk are exactly what the page showed');

  const check = execFileSync(process.execPath, ['--import', tsxLoader, cliEntry, 'check'], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  assert.ok(!/error/i.test(check), check);

  // And the server's own projection puts it behind API, derived from the `api` step rather than
  // from the `@api` tag beside it.
  const view = (await (await fetch(`${baseUrl}/api/project`)).json()) as { files: { path: string; tests: { name: string; lenses: string[] }[] }[] };
  const written = view.files.find((f) => f.path === target)?.tests.find((t) => t.name === 'the page can place an order');
  assert.ok(written, 'the server sees the test the page wrote');
  assert.ok(written.lenses.includes('api'));
});

test('the API door adds work to a test the LOAD door started, above its workload’s thresholds', async () => {
  // `A0-5`'s green condition had to reach past the form for exactly this, and said so. A `steps`
  // insertion has to land below the `run … iterations` line and above any `threshold`, which is
  // three regions of one test and the shape the lang gate measures directly.
  const target = 'tests/load.tflw';
  await page.goto(`${baseUrl}#/load`);
  await page.reload();
  await page.locator('[data-load-form]').waitFor();
  await page.locator(`[data-file-row="${target}"]`).click();
  await page.locator('[data-load-name]').fill('the API door finishes this one');
  await page.locator('[data-load-tags]').fill('load');
  await page.locator('[data-load-shape]').selectOption('iterations');
  await page.locator('[data-load-field="count"]').fill('20');
  await page.locator('[data-load-field="vus"]').fill('2');
  await page.locator('[data-threshold-metric="0"]').selectOption('errorRate');
  await page.locator('[data-threshold-bound="0"]').fill('1');
  await page.locator('[data-load-save]').click();
  await page.locator('[data-load-wrote]').waitFor();

  const started = await readFile(join(root, target), 'utf8');
  assert.ok(started.includes('run 20 iterations across 2 users'), started);
  assert.ok(!/the API door finishes this one[\s\S]*?\n  api /.test(started), 'the LOAD form wrote no work');

  await page.goto(`${baseUrl}#/api`);
  await page.reload();
  await openLegacyForm(page);
  await page.locator('[data-api-form]').waitFor();
  await page.locator(`[data-file-row="${target}"]`).click();
  await page.locator('[data-api-mode]').selectOption('existing');
  await page.locator('[data-api-test]').selectOption('the API door finishes this one');
  await page.locator('[data-api-method]').selectOption('GET');
  await page.locator('[data-api-path]').fill('/items');
  await page.locator('[data-expect-operand="0"]').fill('200');

  await openTab('source');
  const preview = (await page.locator('[data-preview]').textContent()) ?? '';
  await openTab('compose');
  await page.locator('[data-api-save]').click();
  await page.locator('[data-api-wrote]').waitFor();

  const finished = await readFile(join(root, target), 'utf8');
  assert.equal(finished, preview, 'the bytes on disk are the bytes previewed');

  // The three regions, in order: the workload line, then the work, then the threshold.
  const test = finished.slice(finished.indexOf('test "the API door finishes this one"'));
  const workloadAt = test.indexOf('run 20 iterations across 2 users');
  const stepAt = test.indexOf('api GET /items');
  const expectAt = test.indexOf('expect status equals 200');
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

test('Send writes a scratch file, runs it for real, and shows the response out of the report', async () => {
  // The fixture server has to be up, because Send really sends. The first draft of this test
  // omitted it and the pane came back saying `no response` with tflw's own
  // `connection refused; is the service actually listening at that host:port?` — which is the
  // whole machinery working and reporting the truth, and is why `D1047` puts the request through
  // a run rather than through a client the page owns.
  const fixtureServer = (await import(pathToFileURL(join(root, 'server.mjs')).href)) as { startFixtureServer: (port: number) => Promise<Server> };
  const target = await fixtureServer.startFixtureServer(fixturePort);
  try {
  await page.goto(`${baseUrl}#/api`);
  await page.reload();
  await openLegacyForm(page);
  await page.locator('[data-api-form]').waitFor();

  await page.locator('[data-api-method]').selectOption('GET');
  await page.locator('[data-api-path]').fill('/items');
  await page.locator('[data-expect-operand="0"]').fill('200');

  const projectFiles = async (): Promise<number> =>
    ((await (await fetch(`${baseUrl}/api/project`)).json()) as { files: unknown[] }).files.length;
  const filesBefore = await projectFiles();

  // No console error on the first Send in a project that has never been explored (`M205-05`).
  // The page used to read the scratch's etag before writing it, which on a fresh project is a
  // request whose only possible answer is `404` — and the browser logs a failed request whether
  // or not the caller catches it, which this one did. Listened for rather than read back, because
  // a console message is not retrievable after the fact.
  const consoleErrors: string[] = [];
  const onConsole = (m: { type(): string; text(): string }): void => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  };
  page.on('console', onConsole);

  await page.locator('[data-api-send]').click();
  await page.locator('[data-api-response]').waitFor({ timeout: 30_000 });
  page.off('console', onConsole);
  assert.deepEqual(consoleErrors, [], 'Send logged to the console on a project with no scratch file');

  // THE RESPONSE IS A REAL ONE. The fixture server beside the project answered it, and the bytes
  // came back through `results.json` rather than through a second HTTP client in the page —
  // which is the whole of `D1047`.
  assert.equal(await page.locator('[data-api-response]').getAttribute('data-api-response'), '200', await page.locator('[data-api-response]').innerHTML());
  assert.equal(await page.locator('[data-api-response]').getAttribute('data-api-response-ok'), 'true');
  const url = await page.locator('[data-api-response-url]').textContent();
  assert.match(url ?? '', /^GET http:\/\/127\.0\.0\.1:\d+\/items$/);
  const body = await page.locator('[data-api-response-body]').textContent();
  assert.ok(body && JSON.parse(body), `the body is the server's own JSON: ${body ?? ''}`);

  // WHAT THE PAGE ASKED FOR, not what this project would have given anyway. The fixture's default
  // env carries no `evidence` key and so is already `full`, which makes `--evidence full`
  // invisible in the result — the mutation removing it survived every assertion below until this
  // one. The same goes for `--only`: with one test in the file, running the whole file and
  // running only that test produce identical reports. So the claim is made against the argv the
  // server built, which is the only place the request is distinguishable from its outcome.
  const runs = (await (await fetch(`${baseUrl}/api/runs`)).json()) as { argv: string[]; request: { evidence?: string; only?: string } }[];
  const latest = runs[0]!;
  assert.deepEqual(latest.argv, ['run', '--format', 'ndjson', '--no-color', '--only', 'scratch', '--evidence', 'full', SCRATCH_PATH]);

  // **THE SCRATCH IS NOT A TEST IN THIS PROJECT** — `M205` Q15, closing `M205-04`. It used to be:
  // `discoverTests` found `scratch.tflw` like any other file, so one exploration took a one-test
  // project to `2 files · 3 behind API` and a bare `tflw run` issued the same request twice,
  // reporting a test the author does not think exists. `.gitignore` listed it, which is why
  // nobody saw it — being ignored by git is not being excluded from discovery. The leading dot is
  // the repair, and this is the assertion that says so: the count does not move for a Send.
  assert.equal(await projectFiles(), filesBefore, 'Send added a file to the project view');
  assert.equal(SCRATCH_PATH[0], '.', 'the scratch is dot-prefixed, which is the whole mechanism');

  // And the scratch file on disk is a file a terminal can re-run by hand — the claim that keeps
  // "one execution path" honest.
  const scratch = await readFile(join(root, SCRATCH_PATH), 'utf8');
  assert.equal(scratch, 'test "scratch"\n  api GET /items\n  expect status equals 200\n');
  const check = execFileSync(process.execPath, ['--import', tsxLoader, cliEntry, 'check'], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  assert.ok(!/error/i.test(check), check);

  // `[Discard]` drops it — and what "drops" means is the project going back to the shape it had
  // before Send, which is the claim `A1-5` could not make and did not notice it could not.
  //
  // **`A1-5` emptied the scratch and asserted `trim() === ''`**, which is true of a file that is
  // still there — so `discoverTests` still found it, `readProject` still returned it, and the
  // landing footer read `2 files` on a one-test project forever after a single exploration. Every
  // gate in that slice passed. `A2-6` made Discard remove the file, and asserted the project's
  // file count dropping by one as the thing emptying could not do.
  //
  // **That assertion is gone, and its absence is the finding.** Q15's leading dot means the
  // scratch is not in the project view at any point — the count is pinned above, across Send — so
  // "the count drops by one" has stopped being a true sentence about a working Discard. What is
  // left is what Discard always meant: the file is **gone**, not emptied.
  await page.locator('[data-api-discard]').click();
  await page.locator('[data-api-response]').waitFor({ state: 'detached' });
  assert.equal(await projectFiles(), filesBefore, 'Discard moved the project view, which the scratch is not in');
  await assert.rejects(() => readFile(join(root, SCRATCH_PATH), 'utf8'), /ENOENT/, 'the scratch file is gone, not emptied');
  } finally {
    await new Promise<void>((done) => target.close(() => done()));
  }
});

test('Send reports a request that could not be sent, rather than an empty pane', async () => {
  // The control for the case above, and the reason the response pane reads a REPORT rather than a
  // client of its own: with nothing listening, what comes back is tflw's own diagnosis of the
  // failure — the same sentence a terminal prints — instead of a fetch error the page invented.
  await page.goto(`${baseUrl}#/api`);
  await page.reload();
  await openLegacyForm(page);
  await page.locator('[data-api-form]').waitFor();
  await page.locator('[data-api-method]').selectOption('GET');
  await page.locator('[data-api-path]').fill('/items');
  await page.locator('[data-expect-operand="0"]').fill('200');
  await page.locator('[data-api-send]').click();
  await page.locator('[data-api-response]').waitFor({ timeout: 30_000 });

  assert.equal(await page.locator('[data-api-response]').getAttribute('data-api-response-ok'), 'false');
  const detail = await page.locator('[data-api-response-detail]').textContent();
  assert.match(detail ?? '', /connection refused|fetch failed/);
  assert.equal(await page.locator('[data-api-response-body]').count(), 0, 'no body, because there was no response');
});

test('the page says when the scratch file is not ignored, rather than editing .gitignore itself', async () => {
  // A project `tflw init` makes lists the scratch; an older one does not, and the page tells
  // the author instead of silently changing a file they own. The fixture project has no
  // `.gitignore` at all, which is the case that matters — absence, not a wrong rule.
  await page.goto(`${baseUrl}#/api`);
  await page.reload();
  await openLegacyForm(page);
  await page.locator('[data-api-form]').waitFor();
  const notice = await page.locator('[data-api-scratch-unignored]').textContent();
  assert.ok((notice ?? '').includes(SCRATCH_PATH), notice ?? '');
  assert.match(notice ?? '', /gitignore/);

  // THE CONTROL, AND IT HAS TO BE ON THE PAGE. Asserting the server's fact flips is not asserting
  // the notice reads it: the mutation showing the notice unconditionally survived a version of
  // this test that checked only `/api/project`. So the line is added, the page reloaded, and the
  // notice has to be gone.
  await writeFile(join(root, '.gitignore'), `${SCRATCH_PATH}\n`, 'utf8');
  const view = (await (await fetch(`${baseUrl}/api/project`)).json()) as { scratchPath: string; scratchIgnored: boolean };
  assert.equal(view.scratchPath, SCRATCH_PATH);
  assert.equal(view.scratchIgnored, true);

  await page.reload();
  await openLegacyForm(page);
  assert.equal(await page.locator('[data-api-scratch-unignored]').count(), 0, 'the notice goes when the line is there');

  await rm(join(root, '.gitignore'), { force: true });
  await page.reload();
  // A reload resets the disclosure, because its open state is `ApiForm`'s and not the document's —
  // which is exactly what makes it survive a tab trip (`ComposePaneProps.legacyOpen`).
  await openLegacyForm(page);
  await page.locator('[data-api-scratch-unignored]').waitFor();
});

test('the request line stands as tall as every other control, and says so against a browser that has rectangles', async () => {
  // `M205` S1. `styles.css`'s shared `.authoring input, .authoring select { flex: 1 1 120px }` is a
  // WIDTH in every band of this form, because every other band is a row; `.request-line label` is
  // the one `flex-direction: column` container under `.authoring`, and there the same declaration
  // is a HEIGHT. Measured on the live page at `main` `f539654`: method/path/service/label at
  // 120-130px against every sibling control's 26-30px, the request line 151px of a 904px pane.
  //
  // No fake DOM can see this. jsdom has no layout, so every one of these controls reports a zero
  // rectangle there and holds exactly the right value in exactly the right place — which is why
  // this lived through `A1-4` and every gate written since. It belongs here or nowhere.
  await page.goto(`${baseUrl}#/api`);
  await page.reload();
  await openLegacyForm(page);
  await page.locator('[data-api-form]').waitFor();

  /** Every control's height, off the browser's own rectangles — no DOM types, and none needed. */
  const heights = async (selector: string): Promise<number[]> => {
    const all = page.locator(selector);
    const out: number[] = [];
    for (let i = 0; i < (await all.count()); i += 1) {
      const box = await all.nth(i).boundingBox();
      assert.ok(box, `${selector} #${i} has no rectangle`);
      out.push(Math.round(box.height));
    }
    return out;
  };
  // **Scoped to the legacy form** since `M210` `S1`. Compose is two things on one pane now — the
  // reader and the form this tab used to be — and the reader draws its own row of request fields.
  // Unscoped, `line.length` came back 9 against the 4 this gate is about. The first draft of the
  // reader had also called its row `.request-line`, which is this row's name; it is
  // `.request-fields` now, and the scope here is belt as well as braces.
  const lineSel = '[data-compose-legacy] .request-line label > input, [data-compose-legacy] .request-line label > select';
  // The oracle is the form's OTHER controls, not a number written here: a padding or font change
  // should move the whole band together and leave this gate green, and that is the point of it.
  const otherSel = '[data-compose-legacy] .authoring :is(input, select):not(.request-line *)';

  const line = await heights(lineSel);
  const others = await heights(otherSel);
  assert.equal(line.length, 4, 'method, path, service, label');
  assert.ok(others.length >= 4, 'there are other controls to compare against');
  const tallestOther = Math.max(...others);
  for (const h of line) {
    assert.ok(h <= tallestOther + 2, `a request-line control is ${h}px against the form's tallest other control at ${tallestOther}px`);
  }

  // THE CONTROL. Put the axis-dependent declaration back, exactly as it was, and the four have to
  // blow past their siblings again — otherwise this test would pass on a page where the fix was
  // never applied, which is the failure mode this repository files most often.
  await page.addStyleTag({ content: '.request-line label > input, .request-line label > select { flex: 1 1 120px !important; }' });
  for (const h of await heights(lineSel)) {
    assert.ok(h > tallestOther + 40, `with the shared rule reaching the column container a control should tower, got ${h}px`);
  }
  await page.reload(); // the injected sheet dies with the document, so the next test starts clean
});

test('the API form opens empty, and an untouched form cannot send anything at all', async () => {
  // `M205` S4, closing `M205-02`. The form opened on `@api test "the orders endpoint answers"` /
  // `api GET /orders`, and `tflw init` scaffolds a project whose `api` points at tflw's own demo
  // service, which answers `GET /health` and nothing else. So the first gesture a new author made
  // — press `send`, unchanged — returned 404 out of the box, with nothing broken: two halves of
  // one product shipping defaults that disagreed, met on the first click.
  //
  // The repair is not a better guess. A default request is a guess about somebody's project, and
  // an empty field cannot contradict one. What the guess was worth is kept as a PLACEHOLDER,
  // which shows the shape of an answer and never becomes a test the author did not write.
  await page.goto(`${baseUrl}#/api`);
  await page.reload();
  await openLegacyForm(page);
  await page.locator('[data-api-form]').waitFor();

  for (const sel of ['[data-api-path]', '[data-api-name]', '[data-api-tags]', '[data-api-service]', '[data-api-label]']) {
    assert.equal(await page.locator(sel).inputValue(), '', `${sel} opens with a value`);
  }
  // The example survives where it cannot be written by accident.
  assert.equal(await page.locator('[data-api-path]').getAttribute('placeholder'), '/orders/{orderId}');
  assert.equal(await page.locator('[data-api-name]').getAttribute('placeholder'), 'the orders endpoint answers');

  // NOT emptied, and neither is a guess about the project: `GET` is the identity choice of a
  // control that must hold something, and the assertion row is load-bearing — `B3-17` records that
  // an `api` step with no assertions CAN NEVER FAIL, so a form opening with no assertion would make
  // the shortest path through this page a test that passes for having claimed nothing.
  assert.equal(await page.locator('[data-api-method]').inputValue(), 'GET');
  assert.equal(await page.locator('[data-api-expects]').getAttribute('data-api-expects'), '1');
  assert.equal(await page.locator('[data-expect-operand="0"]').inputValue(), '200');

  // THE CLOSURE OF THE FINDING: there is no 404 to meet, because there is nothing to send. Both
  // buttons are refused until the form is a request, which is what an empty default buys.
  assert.equal(await page.locator('[data-api-send]').isDisabled(), true, 'an empty form can be sent');
  assert.equal(await page.locator('[data-api-save]').isDisabled(), true, 'an empty form can be written');
  // Source shows the file AS IT IS, because an empty form is not about to write anything — and the
  // strip carries no mark, because a tab is marked only when the one you are not looking at has
  // something to say (`M205` §2).
  assert.equal(await page.locator('[data-tab-mark="source"]').count(), 0, 'the strip marks Source over an empty form');
  await openTab('source');
  assert.equal(await page.locator('[data-source]').getAttribute('data-source'), 'written');
  await openTab('compose');

  // And the first sentence the door says is a hint, not a warning. A blank field rendered as a
  // warning teaches a new author that the tool is annoyed with them for not having typed anything,
  // which is the opposite of what an empty form is for.
  const problem = page.locator('[data-api-problem]');
  assert.match((await problem.textContent()) ?? '', /like `\/orders`/);
  assert.equal(await problem.getAttribute('class'), 'muted');

  // One character of a real path and it is a warning again, because now there is something to be
  // wrong about. Without this the class assertion above holds for a page that never warns at all.
  await page.locator('[data-api-path]').fill('orders');
  assert.match((await problem.textContent()) ?? '', /starts with `\/`/);
  assert.equal(await problem.getAttribute('class'), 'warn');

  // Q11's other half: every control on this form carries a hint. Counted rather than enumerated,
  // because the claim is coverage — a control added later without one is what this catches, and
  // naming them here would have to be kept in step with the form by hand.
  const controls = await page.locator('.authoring label, .authoring [data-header-add], .authoring [data-expect-add]').count();
  const hinted = await page.locator('.authoring label[title], .authoring [data-header-add][title], .authoring [data-expect-add][title]').count();
  assert.equal(hinted, controls, `${controls - hinted} of ${controls} controls carry no hint`);

  // Filled in, it is a request again — the form still works, which is the control for all of it.
  await page.locator('[data-api-path]').fill('/items');
  await page.locator('[data-api-name]').fill('the items endpoint answers');
  assert.equal(await page.locator('[data-api-send]').isDisabled(), false);
  // And now Source has something to say, so the strip says so without taking you off the form.
  await page.locator('[data-tab-mark="source"]').waitFor();
  await openTab('source');
  assert.equal(await page.locator('[data-source]').getAttribute('data-source'), 'pending');
  assert.match((await page.locator('[data-preview]').textContent()) ?? '', /api GET \/items/);
});

test('the strip is an address, and Compose keeps what you typed while you are looking somewhere else', async () => {
  // `M205` S5. The tab is the hash's second segment, which buys three things at once: a link to a
  // tab is a link, the back button walks tabs, and `D1045`'s rule — the choice lives in the URL
  // and nowhere else — extends to the strip without a second mechanism.
  //
  // The first claim is the one with a cost if it is wrong. `#/api` meant something before the
  // strip existed and has to keep meaning it, because every link anyone has ever pasted is of
  // that shape and `doorFromHash` now has to ignore a segment that was not there.
  await page.goto(`${baseUrl}#/api`);
  await page.reload();
  await openLegacyForm(page);
  await page.locator('[data-api-form]').waitFor();
  assert.equal(await page.locator('[data-tabstrip]').getAttribute('data-tabstrip'), 'compose', 'a pre-strip link stopped opening the door');

  // A pasted tab link lands on that tab, with the door still resolved around it.
  await page.goto(`${baseUrl}#/api/source`);
  await page.reload();
  await page.locator('[data-tabstrip="source"]').waitFor();
  assert.equal(await page.locator('[data-doorbar]').getAttribute('data-doorbar'), 'api');

  // A tab nobody has heard of is `compose`, not an error — the same tolerance `doorFromHash` has
  // for a hand-typed door, for the same reason.
  await page.goto(`${baseUrl}#/api/coverage`);
  await page.reload();
  await page.locator('[data-tabstrip="compose"]').waitFor();

  // Clicking writes the hash, and the DEFAULT tab writes the bare door hash rather than `#/api/
  // compose` — the commonest address stays the short one, which is also what keeps the first
  // assertion in this test true a year from now.
  await page.goto(`${baseUrl}#/api`);
  await page.reload();
  // The reload reset the disclosure — see `openLegacyForm`. What this test is about starts here.
  await openLegacyForm(page);
  await page.locator('[data-api-path]').fill('/items');
  await page.locator('[data-api-name]').fill('typed before leaving');
  await openTab('run');
  assert.equal(new URL(page.url()).hash, '#/api/run');
  await openTab('compose');
  assert.equal(new URL(page.url()).hash, '#/api');

  // THE STATE CLAIM: a strip whose tabs threw away a half-written request would be worse than the
  // single long pane it replaced, because the author would learn not to look at Source — the one
  // tab that exists to be looked at.
  //
  // **What this grades, and what it cannot see.** It reddens if the field state is ever moved down
  // into the Compose panel, which is the way this property gets lost. It does NOT distinguish a
  // hidden panel from an unmounted one: the fields are `useState` in `ApiForm`, which the strip
  // never unmounts, so the values return either way. The first draft of this slice used `hidden`
  // and a comment calling it load-bearing; mutating it to an unmounted panel left this assertion
  // green, which is what said otherwise.
  assert.equal(await page.locator('[data-api-path]').inputValue(), '/items');
  assert.equal(await page.locator('[data-api-name]').inputValue(), 'typed before leaving');
  // **And the disclosure is still open** (`M210` `S1`). This is the half `inputValue` cannot see:
  // it reads a hidden input happily, so every assertion above stays green on a page where the form
  // came back shut — which is what `S1` shipped first, and what six gates then met as timeouts on
  // controls that were present, resolved and invisible. `legacyOpen` lives in `ApiForm` for the
  // same reason the field values do; put it back inside `ComposePane` and this line reddens alone.
  assert.equal(await page.locator('[data-compose-legacy]').evaluate((e) => (e as unknown as { open: boolean }).open), true, 'a trip to another tab closed the form');
  assert.ok(await page.locator('[data-api-path]').isVisible(), 'and its controls came back reachable, not merely present');

  // And the back button walks the tabs, because they are addresses and not a mode.
  await openTab('source');
  await page.goBack();
  await page.locator('[data-tabstrip="compose"]').waitFor();
  assert.equal(new URL(page.url()).hash, '#/api');
  assert.equal(await page.locator('[data-api-path]').inputValue(), '/items', 'going back re-mounted the form');
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
  const fresh = await browser.newPage();
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

    const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
    const base = `http://127.0.0.1:${await ui.listen(0)}/`;
    try {
      await fresh.goto(`${base}#/browser/auth/mixed.tflw`);
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
      await fresh.goto(`${base}#/browser/auth/apionly.tflw`);
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
  const fresh = await browser.newPage();
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

    const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
    try {
      const base = `http://127.0.0.1:${await ui.listen(0)}/`;

      // 1. THE HEADLINE, on the commonest kind of file. The block leads with the anonymous case
      //    rather than with a caveat about sessions the file does not have.
      await fresh.goto(`${base}#/api/auth/nobody.tflw`);
      await fresh.locator('[data-auth-identity]').waitFor();
      assert.equal(await fresh.locator('[data-auth-identity]').getAttribute('data-auth-identity'), 'anonymous');
      assert.match((await fresh.locator('[data-auth-identity]').textContent()) ?? '', /Nothing here declares an identity/);
      assert.match((await fresh.locator('[data-auth-identity]').textContent()) ?? '', /anonymous/);

      // …and it is said ONCE. Before the reframe the enumeration block carried the same sentence,
      // which would now be a duplicate over one file on 94% of files — the class `Q1` refused
      // between Compose and Auth, one block apart instead of one tab.
      assert.equal(await fresh.locator('[data-auth-sessions]').count(), 0, 'the enumeration renders with nothing to enumerate');

      // 2. The other kind of file names its sessions in the same headline slot.
      await fresh.goto(`${base}#/api/auth/named.tflw`);
      await fresh.locator('[data-auth-identity]').waitFor();
      assert.equal(await fresh.locator('[data-auth-identity]').getAttribute('data-auth-identity'), 'named');
      assert.match((await fresh.locator('[data-auth-identity]').textContent()) ?? '', /shopper/);
      assert.equal(await fresh.locator('[data-auth-sessions]').getAttribute('data-auth-sessions'), '1');

      // 3. `Q4` — SCANS inverts the premise: the identity in force is not one, it is all of them.
      //    Both sets named, and the numbers are the ones `probeSetFor` would build: five declared
      //    sessions, two privileged, so four probe as (three plus `anonymous`) and two are out.
      await fresh.goto(`${base}#/scan/auth/named.tflw`);
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
      await fresh.goto(`${base}#/load/auth/named.tflw`);
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
        await fresh.goto(`${base}#/${door}/auth/named.tflw`);
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
    const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
    try {
      const base = `http://127.0.0.1:${await ui.listen(0)}`;
      const project = (await (await fetch(`${base}/api/project`)).json()) as {
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

test('the affirmation this form refuses to make is one the author can make on this page (M207-02)', async () => {
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
  const fresh = await browser.newPage();
  try {
    execFileSync(process.execPath, ['--import', tsxLoader, cliEntry, 'init', '--scan'], { cwd: dir, stdio: 'pipe' });
    const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
    try {
      const base = `http://127.0.0.1:${await ui.listen(0)}`;
      await fresh.goto(`${base}#/scan`);
      await fresh.locator('[data-scan-unauthorized]').waitFor();

      // 1. THE PROSE, both halves. `D291` is named as the standing reason, and the claim that the
      //    page cannot write `tflw.config` is gone — asserted as an absence, because the repair of a
      //    two-reason sentence that lost one reason is not complete while the false half survives.
      const notice = (await fresh.locator('[data-scan-unauthorized]').textContent()) ?? '';
      assert.match(notice, /D291/, 'the standing reason is not named');
      assert.doesNotMatch(notice, /D1049/, 'the half `M205` `Q5` falsified is still stated');
      assert.doesNotMatch(notice, /does not write|cannot write/i, 'the notice still claims this page cannot write tflw.config');
      assert.match(notice, /Config/, 'the notice does not say where the affirmation is made');

      // 2. THE LINK GOES THERE, and the address carries it (`D1045`).
      await fresh.locator('[data-scan-config-link]').click();
      await fresh.locator('[data-tabstrip="config"]').waitFor();
      assert.equal(new URL(fresh.url()).hash, '#/scan/config', 'the link did not put the tab in the address');

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
      await fresh.goto(`${base}#/scan`);
      await fresh.reload();
      await fresh.locator('[data-scan-form]').waitFor();
      assert.equal(await fresh.locator('[data-scan-unauthorized]').count(), 0, 'the notice survives the affirmation it asked for');

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
  const fresh = await browser.newPage();
  try {
    execFileSync(process.execPath, ['--import', tsxLoader, cliEntry, 'init', '--scan'], { cwd: dir, stdio: 'pipe' });
    const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
    try {
      const base = `http://127.0.0.1:${await ui.listen(0)}`;
      const reason = /A scan issues requests nobody wrote/;

      // 1. STATE ONE — nothing authorized. This is the state `tflw init --scan` leaves, and the
      //    only state the old notice rendered in.
      await fresh.goto(`${base}#/scan`);
      await fresh.locator('[data-scan-why]').waitFor();
      assert.equal(await fresh.locator('[data-scan-why]').getAttribute('data-scan-why-targets'), '0');
      assert.match((await fresh.locator('[data-scan-why]').textContent()) ?? '', reason, 'the reason is not on the door with nothing authorized');

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
      await fresh.goto(`${base}#/scan`);
      await fresh.reload();
      await fresh.locator('[data-scan-why]').waitFor();
      assert.equal(await fresh.locator('[data-scan-unauthorized]').count(), 0, 'the fixture is not in the authorized state, so this half proves nothing');
      assert.equal(await fresh.locator('[data-scan-why]').getAttribute('data-scan-why-targets'), '1');
      const why = (await fresh.locator('[data-scan-why]').textContent()) ?? '';
      assert.match(why, reason, 'the reason vanished in exactly the state every measured project is in');
      assert.match(why, /1 authorized target is in force/, 'the affirmative half does not say what is in force');

      // 4. **AND IT IS A MOVE, NOT A COPY.** The justification is asserted ABSENT from Auth on all
      //    four doors — without this the slice could have left the paragraph where it was and added
      //    a second one, which every assertion above would accept. All four, because the whole
      //    complaint was a project-scoped block reading in one door's terms on every door.
      for (const door of ['api', 'browser', 'load', 'scan'] as const) {
        await fresh.goto(`${base}#/${door}/auth`);
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
  const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await browser.newPage();
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
    await fresh.goto(`${base}#/api/auth`);
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
  const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await browser.newPage();
  try {
    execFileSync(process.execPath, ['--import', tsxLoader, cliEntry, 'init'], { cwd: dir, stdio: 'pipe' });
    const scaffold = await readFile(join(dir, 'tflw.config'), 'utf8');
    assert.match(scaffold, /Swap this one line for your service|Swap this one line|api "tflw:\/\/demo"/, 'the scaffold still says what this test is about');

    const base = `http://127.0.0.1:${await ui.listen(0)}`;
    await fresh.goto(`${base}#/api/config`);
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
    const view = (await (await fetch(`${base}/api/project`)).json()) as { authorization: { apiBaseUrl: string | null } };
    assert.equal(view.authorization.apiBaseUrl, 'http://localhost:3001', 'the project the page describes is the project that was edited');

    // 4. And the capability it did NOT acquire: the route that writes tests still refuses this
    //    file. `D1049`'s refusal is what Q5 declined to widen, and this is the assertion that
    //    would notice if a later slice took the shortcut.
    const sneaky = await fetch(`${base}/api/file`, {
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
  const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await browser.newPage();
  try {
    await writeFile(join(dir, 'tflw.config'), ['env local default', '  api "http://127.0.0.1:4799"', ''].join('\n'));
    await writeFile(join(dir, 'shop.tflw'), ['@api', 'test "the catalogue answers"', '  api GET /catalog', '  expect status equals 200', ''].join('\n'));
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;

    await fresh.goto(`${base}/#/api/source/shop.tflw`);
    await fresh.locator('[data-test-index]').waitFor();
    assert.equal(await fresh.locator('[data-test-index]').getAttribute('data-test-index'), '1');
    assert.equal(await fresh.locator('[data-source-test]').count(), 1);

    await fresh.locator('[data-tab="compose"]').click();
    await openLegacyForm(fresh);
    await fresh.locator('[data-api-name]').fill('the orders endpoint answers');
    await fresh.locator('[data-api-method]').selectOption('GET');
    await fresh.locator('[data-api-path]').fill('/orders');
    if (await fresh.locator('[data-api-save]').isDisabled()) assert.fail(`the form cannot write: ${await fresh.locator('[data-api-problem]').textContent()}`);
    await fresh.locator('[data-api-save]').click();
    await fresh.locator('[data-api-wrote]').waitFor();

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
    await page.goto(`${baseUrl}#/api/compose/${f.path}`);
    // **`[data-compose]` is not the thing to wait for.** The shell reads the file asynchronously
    // and the pane renders a *reading…* state meanwhile, so a gate that waited for the pane counted
    // rows before any existed. `[data-compose-summary]` appears only once the outline is in hand.
    await page.locator('[data-compose-summary]').waitFor();
    const drawn = await page.locator('[data-outline-request]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-outline-request'))));
    assert.deepEqual(drawn.sort((a, b) => a - b), wanted.map((r) => r.line), `${f.path}: every request in the file is a row in the explorer's outline`);
    // And the declarations, which is the other half of `D1081`'s two levels.
    const { program } = parseSource(source);
    const decls = [...program.hooks, ...program.tests].map((d) => d.span.start.line).sort((a, b) => a - b);
    const drawnDecls = await page.locator('[data-outline-decl]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-outline-line'))));
    assert.deepEqual(drawnDecls.sort((a, b) => a - b), decls, `${f.path}: every hook and test is a row too — a declaration with no request is still there`);
  }
});

test('the card is the request the address names, and the band is the declaration that holds it', async () => {
  const view = await fullProject();
  const withRequests = view.files.find((f) => f.path.endsWith('catalog.tflw'))!;
  const source = await readFile(join(root, withRequests.path), 'utf8');
  const wanted = requestsInSource(source);
  assert.ok(wanted.length >= 2, 'the fixture file holds more than one request, or this asserts nothing');
  for (const r of wanted) {
    await page.goto(`${baseUrl}#/api/compose/${withRequests.path}/L${r.line}`);
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
    await page.goto(`${baseUrl}#/api/compose/${withRequests.path}/L${headed.span.start.line}`);
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
  await page.goto(`${baseUrl}#/api/compose/${f.path}/L${target.span.start.line}`);
  await page.locator('[data-band-line]').waitFor();
  assert.equal(await page.locator('[data-band-line]').getAttribute('data-band-line'), String(target.span.start.line));
  assert.equal(await page.locator('[data-band-name]').textContent(), target.name.value);
});

test('what the reader has not lit yet is disabled — and it is the control that is asked, not a class', async () => {
  // **`D1082` narrowed by `S2`, which is the decision working rather than the decision lapsing.**
  // `S1`'s claim was that nothing on this pane types. `S2` lights the request's own fields, so the
  // claim becomes what is still read-only: the **test band** (`S5`'s to light), and the three
  // clauses on the card that `ApiStepSpec` cannot express and that an edit therefore carries rather
  // than rebuilds. A pane that is half live has to be able to say which half, and it says it in the
  // controls themselves.
  const view = await fullProject();
  for (const f of view.files) {
    await page.goto(`${baseUrl}#/api/compose/${f.path}`);
    await page.locator('[data-compose-summary]').waitFor();
    // `document` is a DOM global and this file is typechecked under `types: ["node"]` with no DOM
    // lib — so every browser-side callback reaches it through `el.ownerDocument`, which Playwright
    // types for us. The parity gate below already had to do this; it is the file's convention.
    const state = await page.locator('[data-compose]').evaluate((root) => {
      const doc = root.ownerDocument;
      const reader = [...doc.querySelectorAll('.test-band input, .test-band select, .test-band textarea, .request-card [data-field-value="timeout"], .request-card [data-field-value="redirects"], .request-card [data-field-value="retry after"]')];
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
    assert.equal(state.readerEnabled, 0, `${f.path}: the band and the three carried clauses cannot be typed into (\`D1082\`)`);
    // **And the request's own fields ARE live**, on every file that holds a request — which is the
    // other half of the same claim, and the half that would quietly go missing if `S2` regressed.
    // Asserting only what is disabled would stay green on a pane where nothing works at all.
    const editable = await page.locator('[data-request-editable]').count();
    if (editable > 0) {
      assert.equal(await page.locator('[data-request-editable]').getAttribute('data-request-editable'), 'yes', `${f.path}: its request is editable`);
      assert.equal(await page.locator('[data-request-path]').isEditable(), true, `${f.path}: and its path takes a keystroke`);
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
  await page.goto(`${baseUrl}#/api/compose/${f.path}/L${program.tests[0]!.span.start.line}`);
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
  const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
    await fresh.goto(`${base}/#/api/compose/noted.tflw/L11`);
    await fresh.locator('[data-compose-summary]').waitFor();

    const header = fresh.locator('[data-note="the file"]');
    assert.equal(await header.getAttribute('data-note-lines'), '3');
    assert.equal(await header.locator('summary').textContent(), '# the file, line one +2', 'collapsed to the first line with a count');
    // **Lines two onward.** A `<details>` keeps showing its summary while open, so a body holding
    // the whole block printed line one twice — which the served page said and no model check could.
    assert.equal(await header.locator('.note-body').textContent(), '# and its second line\n# and a third');

    assert.equal(await fresh.locator('[data-note="test it answers"]').textContent(), '# about this test');
    assert.equal(await fresh.locator('[data-note="request 13"]').textContent(), '# about the request');

    // The hook is a declaration with a body like any other, and it is in the outline beside the test.
    const decls = await fresh.locator('[data-outline-decl]').evaluateAll((els) => els.map((e) => e.getAttribute('data-outline-decl')));
    assert.deepEqual(decls, ['hook', 'test'], 'a hook is drawn, and before the test, because that is where it is');
  } finally {
    await fresh.close();
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the file row carries what the file brings in, comma-separated, and says `none` where there is nothing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m210-filerow-'));
  const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
    await fresh.goto(`${base}/#/api/compose/uses.tflw`);
    await fresh.locator('[data-file-facts]').waitFor();
    assert.equal(await fresh.locator('[data-file-imports]').getAttribute('data-file-imports'), '2');
    // The first draft mapped straight to `<code>` and the three paths in the sibling's own
    // `storefront.tflw` rendered as one unbroken string. A list with no separator is not a list.
    assert.equal((await fresh.locator('[data-file-imports]').textContent())!.trim(), 'imports ./shared/a.tflw, ./shared/b.tflw');
    assert.equal((await fresh.locator('[data-file-uses]').textContent())!.trim(), 'uses none');
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
  const sized = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await sized.goto(`${baseUrl}#/api/compose/${f.path}`);
    await sized.locator('[data-compose-summary]').waitFor();
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
    const fields = await heights('.request-fields .field > input');
    assert.equal(fields.length, 5, 'service, label, timeout, redirects, retry after');
    for (const h of fields) assert.ok(h < 40, `a reader field is ${h}px — the shared flex rule is being read as a height again`);

    // THE NEGATIVE CONTROL. Put the axis-dependent declaration back and the five have to tower —
    // otherwise this passes on a page where the fix was never applied, which is the failure mode
    // this repository files most often.
    await sized.addStyleTag({ content: '.request-fields .field > input { flex: 1 1 120px !important; }' });
    for (const h of await heights('.request-fields .field > input')) {
      assert.ok(h > 80, `with the shared rule reaching the column container a field should tower, got ${h}px`);
    }
  } finally {
    await sized.close();
  }
});

test("the explorer's outline opens under the open file's row and under no other", async () => {
  const view = await fullProject();
  const f = view.files.find((x) => x.path.endsWith('catalog.tflw'))!;
  await page.goto(`${baseUrl}#/api/compose/${f.path}`);
  await page.locator('[data-outline]').waitFor();
  const shape = await page.locator('.sidebar').evaluate((root, path: string) => {
    const doc = root.ownerDocument;
    const outlines = [...doc.querySelectorAll('[data-outline]')];
    const openRow = doc.querySelector(`[data-file-row="${path}"]`);
    const owner = outlines[0]?.closest('li')?.querySelector('[data-file-row]')?.getAttribute('data-file-row');
    const fileLeft = openRow?.getBoundingClientRect().left ?? 0;
    const declBtn = outlines[0]?.querySelector('[data-outline-decl] > button');
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
const withEditFixture = async (body: string, run: (page: Page, base: string, dir: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m210-edit-'));
  const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(scratch, 'ui') });
  const fresh = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
    await p.goto(`${base}/#/api/compose/edit.tflw`);
    await p.locator('[data-request-editable="yes"]').waitFor();
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

test('`M210` `S2`: the three clauses the edit vocabulary cannot express survive an edit', async () => {
  // **`ApiStepSpec` has no room for `timeout`, `without redirects` or the per-request
  // `retry honoring "Retry-After"`.** A node rebuilt from the spec alone comes back without them,
  // and the file loses them silently — source that still parses, still runs, still passes, and
  // tests something the author did not ask for. They are copied across the edit explicitly; this
  // is the gate that says so, and it is the reason this fixture exists.
  await withEditFixture(EDITABLE, async (p, base) => {
    await p.goto(`${base}/#/api/compose/edit.tflw`);
    await p.locator('[data-request-editable="yes"]').waitFor();
    assert.equal(await p.locator('[data-field-value="timeout"]').inputValue(), '9000ms');
    assert.equal(await p.locator('[data-field-value="redirects"]').inputValue(), 'not followed');
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
    await p.goto(`${base}/#/api/compose/edit.tflw`);
    await p.locator('[data-request-editable="yes"]').waitFor();
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
    await p.goto(`${base}/#/api/compose/edit.tflw`);
    await p.locator('[data-request-editable="yes"]').waitFor();
    await p.locator('[data-request-path]').fill('/orders/bulk');
    await p.locator('[data-compose-discard]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
    assert.equal(await p.locator('[data-request-path]').inputValue(), '/orders', 'the card is back on the file');
    assert.equal(await readFile(join(dir, 'edit.tflw'), 'utf8'), before, 'and nothing was written');
  });
});

test('`M210` `S2`: an edit that is not yet a request says so and leaves the buffer where it was', async () => {
  await withEditFixture(EDITABLE, async (p, base) => {
    await p.goto(`${base}/#/api/compose/edit.tflw`);
    await p.locator('[data-request-editable="yes"]').waitFor();
    await p.locator('[data-request-path]').fill('/orders/bulk');
    await p.locator('[data-compose-dirty]').waitFor();
    // A header with no value is a legal thing to be halfway through typing and not a legal request.
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
    await p.goto(`${base}/#/api/compose/edit.tflw`);
    await p.locator('[data-request-editable="yes"]').waitFor();
    const second = Number(await p.locator('[data-outline-request]').last().getAttribute('data-outline-request'));
    await p.goto(`${base}/#/api/compose/edit.tflw/L${second}`);
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
    await p.goto(`${base}/#/api/compose/edit.tflw`);
    await p.locator('[data-request-editable="yes"]').waitFor();
    const rows = () => p.locator('[data-outline-request]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-outline-request'))));
    const secondBefore = (await rows())[1]!;
    await p.goto(`${base}/#/api/compose/edit.tflw/L${secondBefore}`);
    await p.locator(`[data-request-line="${secondBefore}"]`).waitFor();
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
    await p.goto(`${base}/#/api/compose/edit.tflw`);
    await p.locator('[data-request-editable="yes"]').waitFor();
    assert.equal(await p.locator('[data-body-edit-kind]').inputValue(), 'upload', 'the card says what this request sends');
    await p.locator('[data-request-path]').fill('/files/bulk');
    await p.locator('[data-compose-write]').click();
    await p.locator('[data-compose-dirty]').waitFor({ state: 'detached' });
    const onDisk = await readFile(join(dir, 'edit.tflw'), 'utf8');
    assert.match(onDisk, /api POST \/files\/bulk upload "\.\/f\.png" as "file" type "image\/png"/, 'the path changed and the whole upload clause is still there');
    const { diagnostics } = parseSource(onDisk);
    assert.deepEqual(diagnostics.filter((d) => d.severity === 'error').map((d) => d.code), []);
  });
});
