// `tflw ui`'s server (`M192` U1) — every route against a fixture project, with a real `tflw run`
// spawned from the source entry under tsx (the same way `tflw ui` spawns it from `dist/cli.cjs`).
// The green condition's clause "no `.tflw` file was written by anything in the `ui` verb" is a
// test here too, on the source: a grep is a gate a reviewer can re-run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UiServer, readProject, runArgv, safeJoin, parseUiArgs, traceViewerDir, type RunRecord, type ReportEntry } from '../src/ui-server.js';

const here = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(here, '..', 'src', 'cli.ts');
// `--import tsx` resolves the package from the CHILD's cwd — the fixture project, which has no
// node_modules — so the loader travels as an absolute path, which is what `tflw ui` under the
// source entry passes along too.
const tsxLoader = fileURLToPath(import.meta.resolve('tsx'));

async function withFixtureServer<T>(fn: (baseUrl: string, slow: { release: () => void; held: () => number }) => Promise<T>): Promise<T> {
  const held: Array<() => void> = [];
  const server: Server = createServer((req, res) => {
    if (req.url === '/health') res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    else if (req.url === '/slow') held.push(() => res.writeHead(200).end('{}'));
    else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  try {
    return await fn(`http://127.0.0.1:${address.port}`, { release: () => held.splice(0).forEach((f) => f()), held: () => held.length });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
}

async function fixtureProject(baseUrl: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-ui-'));
  await writeFile(join(dir, 'tflw.config'), `exclude "skipped"\nenv local default\n  api "${baseUrl}"\nenv other\n  api "${baseUrl}"\n`, 'utf8');
  await writeFile(join(dir, 'health.tflw'), `@smoke @api\ntest "health"\n  api GET /health\n  expect status equals 200\n`, 'utf8');
  await mkdir(join(dir, 'deep'));
  await writeFile(join(dir, 'deep', 'slow.tflw'), `test "slow"\n  api GET /slow\n  expect status equals 200\n`, 'utf8');
  await writeFile(join(dir, 'broken.tflw'), `test "broken"\n  api GET\n`, 'utf8');
  await mkdir(join(dir, 'skipped'));
  await writeFile(join(dir, 'skipped', 'no.tflw'), `test "excluded"\n  api GET /health\n`, 'utf8');
  // A repro tflw wrote into its own report directory is never a test (M137d).
  await mkdir(join(dir, 'report', 'authz-repro'), { recursive: true });
  await writeFile(join(dir, 'report', 'authz-repro', 'r.tflw'), `test "repro"\n  api GET /health\n`, 'utf8');
  return dir;
}

async function readSse(url: string): Promise<{ data: string[]; end: Record<string, unknown> | null }> {
  const res = await fetch(url);
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const text = await res.text();
  const data: string[] = [];
  let end: Record<string, unknown> | null = null;
  for (const block of text.split('\n\n')) {
    if (block.startsWith('event: end\n')) end = JSON.parse(block.slice('event: end\ndata: '.length)) as Record<string, unknown>;
    else if (block.startsWith('data: ')) data.push(block.slice(6));
  }
  return { data, end };
}

test('readProject: envs, discovered files with their tests, the excluded dir and the report dir left out, a broken file counted', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await fixtureProject(baseUrl);
    try {
      const p = await readProject(dir);
      assert.deepEqual(p.envs, [{ name: 'local', isDefault: true }, { name: 'other', isDefault: false }]);
      assert.equal(p.reportDir, './report');
      assert.deepEqual(p.files.map((f) => f.path).sort(), ['broken.tflw', 'deep/slow.tflw', 'health.tflw']);
      const health = p.files.find((f) => f.path === 'health.tflw')!;
      // `line` is where the declaration starts, tags included — the line a click should land on.
      assert.deepEqual(health.tests, [{ name: 'health', tags: ['smoke', 'api'], line: 1, workload: false }]);
      assert.equal(health.diagnostics, 0);
      assert.ok(p.files.find((f) => f.path === 'broken.tflw')!.diagnostics > 0, 'the broken file reports its diagnostics');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('runArgv maps a request onto tflw run flags and nothing else', () => {
  assert.deepEqual(runArgv({}), ['run', '--format', 'ndjson', '--no-color']);
  assert.deepEqual(runArgv({ env: 'other', workers: 2, tags: ['a', 'b'], only: 'x', files: ['f.tflw', 'g/h.tflw'] }), [
    'run', '--format', 'ndjson', '--no-color', '--env', 'other', '--workers', '2', '--tag', 'a,b', '--only', 'x', 'f.tflw', 'g/h.tflw',
  ]);
});

test('safeJoin refuses a path that escapes its base, including the sibling-prefix trick', () => {
  assert.equal(safeJoin('/base/report', 'results.json'), join('/base/report', 'results.json'));
  assert.equal(safeJoin('/base/report', 'runs/x/results.json'), join('/base/report', 'runs', 'x', 'results.json'));
  assert.equal(safeJoin('/base/report', '../tflw.config'), null);
  assert.equal(safeJoin('/base/report', '../report-evil/x'), null);
  assert.equal(safeJoin('/base/report', '/etc/passwd'), null);
});

test('parseUiArgs: defaults, --port, --no-open, a directory, and the two refusals', () => {
  assert.deepEqual(parseUiArgs([], '/cwd'), { root: '/cwd', port: 4141, open: true });
  assert.deepEqual(parseUiArgs(['--port', '0', '--no-open', 'proj'], '/cwd'), { root: '/cwd/proj', port: 0, open: false });
  assert.deepEqual(parseUiArgs(['--port', 'x'], '/cwd'), { usage: '--port takes a number 0-65535, got x' });
  assert.deepEqual(parseUiArgs(['--port'], '/cwd'), { usage: '--port takes a number 0-65535, got nothing' });
  assert.deepEqual(parseUiArgs(['--host', '0.0.0.0'], '/cwd'), { usage: 'unknown flag `--host` for `tflw ui`' });
});

test('a run from the API is a real tflw run: the stream arrives over SSE, the report directory is kept, its files are served', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await fixtureProject(baseUrl);
    const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static') });
    try {
      const port = await ui.listen(0);
      assert.equal((ui.server.address() as { address: string }).address, '127.0.0.1', 'loopback only');
      const base = `http://127.0.0.1:${port}`;

      const started = await fetch(`${base}/api/run`, { method: 'POST', body: JSON.stringify({ files: ['health.tflw'] }) });
      assert.equal(started.status, 202);
      const record = (await started.json()) as RunRecord;
      assert.equal(record.status, 'running');
      assert.deepEqual(record.argv, ['run', '--format', 'ndjson', '--no-color', 'health.tflw']);

      const { data, end } = await readSse(`${base}/api/runs/${record.id}/events`);
      const types = data.map((l) => (JSON.parse(l) as { type: string }).type);
      const stderr = ((await (await fetch(`${base}/api/runs/${record.id}/stderr`)).json()) as { stderr: string }).stderr;
      assert.ok(types.includes('run:start') && types.includes('test:end') && types.includes('run:end'), `stream carried ${types.join(',')}; stderr: ${stderr}`);
      assert.equal(end?.status, 'done');
      assert.equal(end?.exitCode, 0);
      assert.equal(end?.kept, `report/runs/${record.id}`, `kept; stderr: ${stderr}`);

      // A late subscriber replays the whole stream and gets the end at once.
      const replay = await readSse(`${base}/api/runs/${record.id}/events`);
      assert.deepEqual(replay.data, data);
      assert.equal(replay.end?.status, 'done');

      const runs = (await (await fetch(`${base}/api/runs`)).json()) as RunRecord[];
      assert.equal(runs.length, 1);
      assert.equal(runs[0]!.status, 'done');

      const reports = (await (await fetch(`${base}/api/reports`)).json()) as ReportEntry[];
      assert.deepEqual(reports.map((r) => r.id), ['current', record.id]);
      for (const r of reports) {
        assert.deepEqual(r.summary, { ok: true, total: 1, passed: 1, failed: 0 });
        assert.ok(r.files.includes('results.json') && r.files.includes('events.ndjson'), `${r.id} holds ${r.files.join(',')}`);
      }
      assert.equal(reports[1]!.path, `report/runs/${record.id}`);

      const served = await fetch(`${base}/api/reports/${record.id}/results.json`);
      assert.equal(served.status, 200);
      assert.equal(served.headers.get('content-type'), 'application/json; charset=utf-8');
      const kept = JSON.parse(await readFile(join(dir, 'report', 'runs', record.id, 'results.json'), 'utf8')) as { passed: number };
      assert.equal(((await served.json()) as { passed: number }).passed, kept.passed);
      // The kept copy never contains itself.
      await assert.rejects(access(join(dir, 'report', 'runs', record.id, 'runs')));

      // Escapes are refused, not resolved.
      assert.equal((await fetch(`${base}/api/reports/current/..%2Ftflw.config`)).status, 400);
      assert.equal((await fetch(`${base}/api/reports/..%2F..%2Fx/results.json`)).status, 400);
      assert.equal((await fetch(`${base}/api/reports/current/nope.json`)).status, 404);
      assert.equal((await fetch(`${base}/api/runs/nope/events`)).status, 404);
      assert.equal((await fetch(`${base}/api/nothing`)).status, 404);
    } finally {
      await ui.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('cancel sends SIGINT to the child; the run ends cancelled and its subscribers are told', async () => {
  await withFixtureServer(async (baseUrl, slow) => {
    const dir = await fixtureProject(baseUrl);
    const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static') });
    try {
      const port = await ui.listen(0);
      const base = `http://127.0.0.1:${port}`;
      const record = (await (await fetch(`${base}/api/run`, { method: 'POST', body: JSON.stringify({ files: ['deep/slow.tflw'] }) })).json()) as RunRecord;
      const stream = readSse(`${base}/api/runs/${record.id}/events`);
      // Cancel once the run is genuinely inside the held request, not merely spawned.
      const deadline = Date.now() + 30_000;
      while (slow.held() === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      assert.equal(slow.held(), 1, 'the run reached the held request');
      const cancelled = (await (await fetch(`${base}/api/runs/${record.id}/cancel`, { method: 'POST' })).json()) as { cancelled: boolean };
      assert.equal(cancelled.cancelled, true);
      const { end } = await stream;
      assert.equal(end?.status, 'cancelled');
      assert.equal((await (await fetch(`${base}/api/runs/${record.id}/cancel`, { method: 'POST' })).json() as { cancelled: boolean }).cancelled, false, 'a second cancel has nothing to cancel');
      slow.release();
    } finally {
      await ui.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('the page: index.html for / and for any extension-less path, files by name, 404 otherwise, 503 when the bundle is not built', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-ui-static-'));
  const staticDir = join(dir, 'ui');
  await mkdir(join(staticDir, 'assets'), { recursive: true });
  await writeFile(join(dir, 'tflw.config'), 'env local default\n  api "http://127.0.0.1:1"\n', 'utf8');
  await writeFile(join(staticDir, 'index.html'), '<title>tflw</title>', 'utf8');
  await writeFile(join(staticDir, 'assets', 'index-abc.js'), 'console.log(1)', 'utf8');
  const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir });
  const unbuilt = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'missing') });
  try {
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;
    assert.equal(await (await fetch(`${base}/`)).text(), '<title>tflw</title>');
    assert.equal(await (await fetch(`${base}/reports/2026`)).text(), '<title>tflw</title>');
    const js = await fetch(`${base}/assets/index-abc.js`);
    assert.equal(js.status, 200);
    assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal((await fetch(`${base}/assets/nope.js`)).status, 404);
    assert.equal((await fetch(`${base}/..%2Ftflw.config`)).status, 404);
    const port2 = await unbuilt.listen(0);
    const r = await fetch(`http://127.0.0.1:${port2}/`);
    assert.equal(r.status, 503);
    assert.match(await r.text(), /not built/);
  } finally {
    await ui.close();
    await unbuilt.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the trace viewer: served under /trace/ from the project\'s own playwright-core, absent when the project has none, never outside it', async () => {
  // `M192` U3. A project with `playwright-core` reachable from its root (here, this repository's
  // `node_modules`, linked in) gets Playwright's viewer; one without gets a 404 that names the
  // command. The viewer is *the project's*, not tflw's, because the traces are the project's.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-ui-trace-'));
  await writeFile(join(dir, 'tflw.config'), 'env local default\n  api "http://127.0.0.1:1"\n', 'utf8');
  await writeFile(join(dir, 'package.json'), '{"name":"fixture","private":true}', 'utf8');
  const bare = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'ui') });
  try {
    const port = await bare.listen(0);
    const base = `http://127.0.0.1:${port}`;
    assert.equal(traceViewerDir(dir), null);
    assert.equal((await readProject(dir)).traceViewer, false);
    const missing = await fetch(`${base}/trace/index.html`);
    assert.equal(missing.status, 404);
    assert.match(((await missing.json()) as { error: string }).error, /show-trace/);

    await symlink(join(here, '..', '..', '..', 'node_modules'), join(dir, 'node_modules'), 'dir');
    const viewerDir = traceViewerDir(dir);
    assert.ok(viewerDir !== null && viewerDir.endsWith(join('lib', 'vite', 'traceViewer')), `resolved ${viewerDir}`);
    assert.equal((await readProject(dir)).traceViewer, true);
    const index = await fetch(`${base}/trace/index.html`);
    assert.equal(index.status, 200);
    assert.equal(index.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(await index.text(), /Playwright Trace Viewer/);
    assert.equal(await (await fetch(`${base}/trace/`)).status, 200);
    const sw = await fetch(`${base}/trace/sw.bundle.js`);
    assert.equal(sw.status, 200);
    assert.equal(sw.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal((await fetch(`${base}/trace/..%2Fpackage.json`)).status, 400);
    assert.equal((await fetch(`${base}/trace/nope.js`)).status, 404);
  } finally {
    await bare.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the server has no write path to a .tflw file — the green condition, grepped on the source', async () => {
  const source = await readFile(join(here, '..', 'src', 'ui-server.ts'), 'utf8');
  assert.doesNotMatch(source, /writeFile|appendFile|createWriteStream|openSync|writeSync/, 'ui-server.ts must not write files; slice 1 is a viewer (D985)');
  assert.match(source, /\bcp\(/, 'the one copy it makes — a report directory kept aside — is here');
});
