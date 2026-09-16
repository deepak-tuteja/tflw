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
import { UiServer } from '../src/ui-server.js';
import { checkProgram, parseSource } from '@tflw/lang';
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
 */
const API_DOOR = '#/api';

/** The functional entries of a report — the workload kind carries metrics, not steps (U4). */
const functional = (report: RunReport): TestResult[] => report.tests.filter((t): t is TestResult => t.kind === 'functional');

async function openReport(id: string): Promise<void> {
  await page.goto(`${baseUrl}${API_DOOR}`);
  await page.locator(`[data-report-row="${id}"]`).click();
  await page.locator(`[data-report="${id}"]`).waitFor();
}

test('the sidebar is the project behind this door: every file, test, line and tag the server read, and the envs', async () => {
  await page.goto(`${baseUrl}${API_DOOR}`);
  await page.locator('[data-files]').waitFor();
  const project = (await (await fetch(`${baseUrl}/api/project`)).json()) as { files: { path: string; tests: { name: string; line: number; tags: string[]; lenses: string[] }[] }[]; envs: { name: string; isDefault: boolean }[] };
  assert.ok(project.files.length >= 2, 'the fixture project has two files');
  for (const f of project.files) {
    const behind = f.tests.filter((t) => t.lenses.includes('api'));
    const row = page.locator(`[data-file="${f.path}"]`);
    // A file with nothing behind this door and nothing behind another is not listed at all; the
    // fixture has no such file, which this assertion would catch if one arrived.
    assert.equal(await row.count(), 1, `file ${f.path} listed once`);
    for (const t of behind) {
      const item = row.locator(`[data-project-test="${t.name}"]`);
      assert.equal(await item.getAttribute('data-line'), String(t.line));
      const text = await item.textContent();
      for (const tag of t.tags) assert.ok(text?.includes(`@${tag}`), `${t.name} shows @${tag}`);
    }
    for (const t of f.tests.filter((x) => !x.lenses.includes('api'))) {
      assert.equal(await row.locator(`[data-project-test="${t.name}"]`).count(), 0, `${t.name} is behind another door and is not listed here`);
    }
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
  // U7: the tag cloud folds above `FOLD_TAGS_ABOVE` (the dogfood's 90 hid every file); the
  // fixture's few stay open, and the fold names the count either way. Behind a door, the cloud is
  // the tags of the tests this door lists — a tag on nothing visible is a filter that empties the
  // pane when pressed.
  const allTags = new Set(project.files.flatMap((f) => f.tests.filter((t) => t.lenses.includes('api')).flatMap((t) => t.tags)));
  const fold = page.locator('[data-tags-fold]');
  assert.equal(await fold.getAttribute('data-tags-fold'), String(allTags.size));
  assert.ok(allTags.size <= 24, 'the fixture is under the fold (`FOLD_TAGS_ABOVE` in Sidebar.tsx, restated — the cli typecheck has no jsx)');
  assert.equal(await fold.evaluate((el) => (el as { open: boolean }).open), true);
  assert.equal(await fold.locator('[data-tag]').count(), allTags.size);
  // U7: the tab has the docs site's mark, and the page's own load logs no 404 for it.
  const icon = await fetch(`${baseUrl}/favicon.svg`);
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get('content-type'), 'image/svg+xml');
});

test('the run list is the report directories, each row carrying its own results.json counts', async () => {
  await page.goto(`${baseUrl}${API_DOOR}`);
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
    await page.goto(`${baseUrl}${API_DOOR}`);
    await page.locator('[data-tag="catalog"]').click();
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
    await page.goto(`${baseUrl}${API_DOOR}`);
    const before = new Set(await page.locator('[data-report-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-report-row'))));
    await page.locator('[data-tag="load"]').click();
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
  await page.goto(`${baseUrl}${API_DOOR}`);
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
  const row = page.locator(`[data-run-row="${run.id}"]`);
  assert.equal(await row.getAttribute('data-status'), 'done');
  assert.equal(await row.getAttribute('data-exit'), String(run.exitCode));
  assert.match((await row.textContent())!, new RegExp(`exit ${run.exitCode} · no report`));
  await openReport('full');
  assert.equal(await page.locator(`[data-run-row="${run.id}"]`).count(), 1, 'the row survives a selection elsewhere');
  await page.locator(`[data-run-row="${run.id}"]`).click();
  await page.locator(`[data-live="${run.id}"] [data-stderr]`).waitFor({ timeout: 30_000 });
  await page.locator('[data-workers]').fill('');
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

test('the door narrows the list and never the test — a test behind two doors is listed under both', async () => {
  const view = await projectView();
  const multi = view.files.flatMap((f) => f.tests).filter((t) => t.lenses.length > 1);
  assert.ok(multi.length > 0, 'the fixture must hold a multi-lens test — D1043’s whole case');

  for (const test_ of multi) {
    for (const lens of test_.lenses) {
      await page.goto(`${baseUrl}#/${lens}`);
      const item = page.locator(`[data-project-test="${test_.name}"]`);
      await item.waitFor();
      assert.equal(await item.getAttribute('data-test-lenses'), test_.lenses.join(' '), `${test_.name} carries its whole derivation behind ${lens}`);
      // The other doors it is behind are named on the row itself.
      for (const other of test_.lenses.filter((l) => l !== lens)) {
        assert.equal(await item.locator(`[data-also="${other}"]`).count(), 1, `${test_.name} names its ${other} door while in ${lens}`);
      }
    }
  }
});

test('the derivation is about constructs, not tags — the page shows it where the tag disagrees', async () => {
  // `security.tflw`'s tests carry `@security` AND an `api` step, so they are behind API as well.
  // `shop.tflw`'s carry no such tag and are behind BROWSER. If the page were reading tags, the
  // first would be missing from API and the second from BROWSER.
  const view = await projectView();
  const tagged = view.files.find((f) => f.path.endsWith('security.tflw'));
  assert.ok(tagged, 'the fixture has security.tflw');
  await page.goto(`${baseUrl}#/api`);
  await page.locator('[data-files]').waitFor();
  for (const t of tagged.tests) {
    assert.equal(await page.locator(`[data-project-test="${t.name}"]`).count(), 1, `${t.name} is behind API because it makes a request, whatever its tag says`);
  }
});

test('the switcher moves between doors without leaving the project', async () => {
  await page.goto(`${baseUrl}#/api`);
  await page.locator('[data-doorbar]').waitFor();
  const view = await projectView();
  const browserTests = view.files.flatMap((f) => f.tests).filter((t) => t.lenses.includes('browser') && !t.lenses.includes('api'));
  assert.ok(browserTests.length > 0, 'the fixture has a browser-only test');
  assert.equal(await page.locator(`[data-project-test="${browserTests[0]!.name}"]`).count(), 0, 'not listed behind API');

  await page.locator('[data-door-tab="browser"]').click();
  await page.locator(`[data-project-test="${browserTests[0]!.name}"]`).waitFor();
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
  await page.locator('[data-load-file]').selectOption(target);
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
  await page.locator('[data-load-file]').selectOption(target);
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
  await page.locator('[data-load-file]').selectOption(target);
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
  await page.locator('[data-load-file]').selectOption(target);
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

test('the BROWSER form writes a whole test — open, a scoped block, and an assertion', async () => {
  await page.goto(`${baseUrl}#/browser`);
  await page.reload();
  await page.locator('[data-browser-form]').waitFor();

  const target = 'tests/orders.tflw';
  await page.locator('[data-browser-file]').selectOption(target);
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
  await page.locator('[data-browser-file]').selectOption(target);
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
  await page.locator('[data-scan-file]').selectOption(target);
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
    await fresh.locator('[data-scan-file]').selectOption('scan.tflw');
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
    const config = await readFile(join(dir, 'tflw.config'), 'utf8');
    await writeFile(join(dir, 'tflw.config'), config.replace(/^#   (authorized target .*)$/m, '  $1reason-placeholder').replace('reason ""reason-placeholder', 'reason "the fixture server beside this test"'), 'utf8');
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
    await fresh.locator('[data-load-file]').selectOption('load.tflw');
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
    await fresh.reload();
    await fresh.locator('[data-files]').waitFor();
    await fresh.locator('[data-file-check="load.tflw"]').check();
    await fresh.locator('[data-run]').click();
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
  await page.locator('[data-api-form]').waitFor();

  const target = 'tests/orders.tflw';
  await page.locator('[data-api-file]').selectOption(target);
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
  await page.locator('[data-api-diagnostics]').waitFor();
  const unbound = await page.locator('[data-diagnostic-code="TF030"]').textContent();
  assert.ok(unbound?.includes('token'), unbound ?? 'the form should name the unbound variable');
  // And it is a warning about the file, not a veto on the write: `D1052` shows, never blocks.
  assert.equal(await page.locator('[data-api-save]').isDisabled(), false);

  // Take the reference back out, and the panel goes with it — the control that keeps the
  // assertion above about this header rather than about the panel always being there.
  await page.locator('[data-header-value="0"]').fill('Bearer static-token');
  await page.locator('[data-api-diagnostics]').waitFor({ state: 'detached' });

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

  const preview = await page.locator('[data-api-preview]').textContent();
  assert.ok(preview?.includes('@api @authored'), preview ?? '');
  assert.ok(preview?.includes('api POST /orders body { itemId: 1, qty: 2 } as "place"'), preview ?? '');
  assert.ok(preview?.includes('header "Authorization" is "Bearer static-token"'), preview ?? '');
  assert.ok(preview?.includes('expect status equals 201'), preview ?? '');
  assert.ok(preview?.includes('expect body.items[0].price is greater than 0'), preview ?? '');
  assert.ok(preview?.includes('check header "content-type" contains "json"'), preview ?? '');

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
  await page.locator('[data-load-file]').selectOption(target);
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
  await page.locator('[data-api-form]').waitFor();
  await page.locator('[data-api-file]').selectOption(target);
  await page.locator('[data-api-mode]').selectOption('existing');
  await page.locator('[data-api-test]').selectOption('the API door finishes this one');
  await page.locator('[data-api-method]').selectOption('GET');
  await page.locator('[data-api-path]').fill('/items');
  await page.locator('[data-expect-operand="0"]').fill('200');

  const preview = (await page.locator('[data-api-preview]').textContent()) ?? '';
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
  await page.locator('[data-api-form]').waitFor();

  await page.locator('[data-api-method]').selectOption('GET');
  await page.locator('[data-api-path]').fill('/items');
  await page.locator('[data-expect-operand="0"]').fill('200');

  await page.locator('[data-api-send]').click();
  await page.locator('[data-api-response]').waitFor({ timeout: 30_000 });

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
  assert.deepEqual(latest.argv, ['run', '--format', 'ndjson', '--no-color', '--only', 'scratch', '--evidence', 'full', 'scratch.tflw']);

  // And the scratch file on disk is a file a terminal can re-run by hand — the claim that keeps
  // "one execution path" honest.
  const scratch = await readFile(join(root, 'scratch.tflw'), 'utf8');
  assert.equal(scratch, 'test "scratch"\n  api GET /items\n  expect status equals 200\n');
  const check = execFileSync(process.execPath, ['--import', tsxLoader, cliEntry, 'check'], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  assert.ok(!/error/i.test(check), check);

  // `[Discard]` drops it — and what "drops" means is the project going back to the shape it had
  // before Send, which is the claim `A1-5` could not make and did not notice it could not.
  //
  // **THE FILE COUNT IS THE ASSERTION, not the file's contents.** `A1-5` emptied the scratch and
  // asserted `trim() === ''`, which is true of a file that is still there — so `discoverTests`
  // still found it, `readProject` still returned it, and the landing footer read `2 files` on a
  // one-test project forever after a single exploration. Every gate in that slice passed. Asking
  // the server what the project *is*, before and after, is the question that separates emptying
  // from dropping; `scratch.tflw` being absent is the mechanism and is asserted second.
  const filesBefore = ((await (await fetch(`${baseUrl}/api/project`)).json()) as { files: unknown[] }).files.length;
  await page.locator('[data-api-discard]').click();
  await page.locator('[data-api-response]').waitFor({ state: 'detached' });
  const filesAfter = ((await (await fetch(`${baseUrl}/api/project`)).json()) as { files: unknown[] }).files.length;
  assert.equal(filesAfter, filesBefore - 1, `Discard left the scratch in the project view: ${filesBefore} -> ${filesAfter}`);
  await assert.rejects(() => readFile(join(root, 'scratch.tflw'), 'utf8'), /ENOENT/, 'the scratch file is gone, not emptied');
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
  // A project `tflw init` makes lists `scratch.tflw`; an older one does not, and the page tells
  // the author instead of silently changing a file they own. The fixture project has no
  // `.gitignore` at all, which is the case that matters — absence, not a wrong rule.
  await page.goto(`${baseUrl}#/api`);
  await page.reload();
  await page.locator('[data-api-form]').waitFor();
  const notice = await page.locator('[data-api-scratch-unignored]').textContent();
  assert.match(notice ?? '', /scratch\.tflw/);
  assert.match(notice ?? '', /gitignore/);

  // THE CONTROL, AND IT HAS TO BE ON THE PAGE. Asserting the server's fact flips is not asserting
  // the notice reads it: the mutation showing the notice unconditionally survived a version of
  // this test that checked only `/api/project`. So the line is added, the page reloaded, and the
  // notice has to be gone.
  await writeFile(join(root, '.gitignore'), 'scratch.tflw\n', 'utf8');
  const view = (await (await fetch(`${baseUrl}/api/project`)).json()) as { scratchPath: string; scratchIgnored: boolean };
  assert.equal(view.scratchPath, 'scratch.tflw');
  assert.equal(view.scratchIgnored, true);

  await page.reload();
  await page.locator('[data-api-form]').waitFor();
  assert.equal(await page.locator('[data-api-scratch-unignored]').count(), 0, 'the notice goes when the line is there');

  await rm(join(root, '.gitignore'), { force: true });
  await page.reload();
  await page.locator('[data-api-scratch-unignored]').waitFor();
});
