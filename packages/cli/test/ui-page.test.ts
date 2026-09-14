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
import { mkdtemp, cp, rm, readFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Server } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright';
import { UiServer } from '../src/ui-server.js';
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

/** The functional entries of a report — the workload kind carries metrics, not steps (U4). */
const functional = (report: RunReport): TestResult[] => report.tests.filter((t): t is TestResult => t.kind === 'functional');

async function openReport(id: string): Promise<void> {
  await page.goto(baseUrl);
  await page.locator(`[data-report-row="${id}"]`).click();
  await page.locator(`[data-report="${id}"]`).waitFor();
}

test('the sidebar is the project: every file, test, line and tag the server read, and the envs', async () => {
  await page.goto(baseUrl);
  await page.locator('[data-files]').waitFor();
  const project = (await (await fetch(`${baseUrl}/api/project`)).json()) as { files: { path: string; tests: { name: string; line: number; tags: string[] }[] }[]; envs: { name: string; isDefault: boolean }[] };
  assert.ok(project.files.length >= 2, 'the fixture project has two files');
  for (const f of project.files) {
    const row = page.locator(`[data-file="${f.path}"]`);
    assert.equal(await row.count(), 1, `file ${f.path} listed once`);
    for (const t of f.tests) {
      const item = row.locator(`[data-project-test="${t.name}"]`);
      assert.equal(await item.getAttribute('data-line'), String(t.line));
      const text = await item.textContent();
      for (const tag of t.tags) assert.ok(text?.includes(`@${tag}`), `${t.name} shows @${tag}`);
    }
  }
  const options = await page.locator('[data-env-select] option').allTextContents();
  assert.deepEqual(
    options,
    project.envs.map((e) => `${e.name}${e.isDefault ? ' (default)' : ''}`),
  );
  const counts = await page.locator('[data-project-counts]').textContent();
  const total = project.files.reduce((n, f) => n + f.tests.length, 0);
  assert.equal(counts, `${project.files.length} files · ${total} tests`);
});

test('the run list is the report directories, each row carrying its own results.json counts', async () => {
  await page.goto(baseUrl);
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
  // Non-vacuity: a breached threshold is drawn as one, an error-rate actual carries its unit.
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
  const fixtureServer = (await import(pathToFileURL(join(root, 'server.mjs')).href)) as { startFixtureServer: () => Promise<Server> };
  const target = await fixtureServer.startFixtureServer();
  try {
    await page.goto(baseUrl);
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
    const runs = (await (await fetch(`${baseUrl}/api/runs`)).json()) as { argv: string[]; status: string; kept: string }[];
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0]!.argv.slice(-2), ['--tag', 'catalog']);
    assert.equal(runs[0]!.status, 'done');
    assert.equal(runs[0]!.kept, `report/runs/${id}`);
    assert.equal(written.total, 3);
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
