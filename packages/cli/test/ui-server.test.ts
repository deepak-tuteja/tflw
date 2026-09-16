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

import { UiServer, readProject, runArgv, initArgv, safeJoin, parseUiArgs, traceViewerDir, writeProjectFile, etagOf, type RunRecord, type ReportEntry } from '../src/ui-server.js';
import { readdir } from 'node:fs/promises';

const readdirSafe = async (dir: string): Promise<string[]> => readdir(dir).catch(() => []);

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
      // `lenses` is `M200` `A0-3`'s derivation (`D1043`): `health` makes a request, so it is
      // behind API — and its `@api` tag is beside the point, since the same tag on a test that
      // made no request would put it behind nothing.
      assert.deepEqual(health.tests, [{ name: 'health', tags: ['smoke', 'api'], line: 1, workload: false, lenses: ['api'] }]);
      assert.deepEqual(health.crawls, []);
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
  // `A1-5`: `--evidence` is what makes `D1047`'s Send a response pane rather than a verdict —
  // below `full` a step record carries no `request`/`response` at all (`D987`). It is raw text
  // here and validated by `runCommand` against `EVIDENCE_LEVELS`, exactly as a terminal's own
  // `--evidence` is, so the page still cannot ask for a level a terminal could not.
  assert.deepEqual(runArgv({ evidence: 'full', only: 'scratch', files: ['scratch.tflw'] }), [
    'run', '--format', 'ndjson', '--no-color', '--only', 'scratch', '--evidence', 'full', 'scratch.tflw',
  ]);
});

test('the project view names the scratch file and says whether git will ignore it', async () => {
  // `D1047`'s file is one path, overwritten — so the page can say, before writing it, whether it
  // is about to appear in someone's `git status`. The check is an EXACT LINE, the same shape
  // `tflw init`'s `ensureGitignore` writes with, which makes it right for every project `init`
  // made and a false negative for a rule spelled another way.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-scratch-'));
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local default\n  api "http://127.0.0.1:1"\n', 'utf8');
    const without = await readProject(dir);
    assert.equal(without.scratchPath, 'scratch.tflw');
    assert.equal(without.scratchIgnored, false, 'no .gitignore at all');

    await writeFile(join(dir, '.gitignore'), '.env\nreport/\n', 'utf8');
    assert.equal((await readProject(dir)).scratchIgnored, false, 'a .gitignore without the line');

    await writeFile(join(dir, '.gitignore'), '.env\nreport/\nscratch.tflw\n', 'utf8');
    assert.equal((await readProject(dir)).scratchIgnored, true);

    // A rule that WOULD ignore it but is spelled differently reads as false — stated here rather
    // than left to be discovered, because it is the cost of not shelling out to `git`.
    await writeFile(join(dir, '.gitignore'), '*.tflw\n', 'utf8');
    assert.equal((await readProject(dir)).scratchIgnored, false, 'the documented false negative');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
      // U7: a run that refuses its own argv writes nothing — and `report/` still holds the run
      // above, so presence alone would keep that as this run's record. Nothing is kept.
      const refused = (await (await fetch(`${base}/api/run`, { method: 'POST', body: JSON.stringify({ workers: 0 }) })).json()) as RunRecord;
      const refusedEnd = await readSse(`${base}/api/runs/${refused.id}/events`);
      assert.equal(refusedEnd.end?.exitCode, 2);
      assert.equal(refusedEnd.end?.kept, null, 'a run that wrote no report keeps no directory, whatever the previous run left');
      assert.match(((await (await fetch(`${base}/api/runs/${refused.id}/stderr`)).json()) as { stderr: string }).stderr, /positive integer/);
      assert.deepEqual(replay.data, data);
      assert.equal(replay.end?.status, 'done');

      const runs = (await (await fetch(`${base}/api/runs`)).json()) as RunRecord[];
      assert.equal(runs.length, 2, 'newest first: the refused run, then the real one');
      assert.deepEqual(runs.map((r) => [r.status, r.kept]), [['done', null], ['done', `report/runs/${record.id}`]]);

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

test('the server writes through exactly one call site — the green condition, narrowed, not dropped', async () => {
  // Slice 1's clause was "no write path at all", grepped on this source. `M200` `A0-2` makes the
  // page an authoring surface, so the clause is replaced by its successor rather than deleted: a
  // guard widened until it admits the new thing is no guard, and this one is narrowed to the new
  // thing's own shape. Exactly one `writeFile`, in `writeProjectFile`, and no other write verb.
  const source = await readFile(join(here, '..', 'src', 'ui-server.ts'), 'utf8');
  const writes = source.match(/\bwriteFile\(/g) ?? [];
  assert.equal(writes.length, 1, `ui-server.ts must write through exactly one call site, found ${writes.length}`);
  const fn = source.slice(source.indexOf('export async function writeProjectFile'));
  assert.ok(fn.length > 0, 'the one write lives in writeProjectFile');
  assert.match(fn.slice(0, fn.indexOf('\n}\n')), /\bwriteFile\(/, 'the one writeFile call is inside writeProjectFile');
  assert.doesNotMatch(source, /appendFile|createWriteStream|openSync|writeSync|truncate\(/, 'no other write verb (D985)');
  assert.match(source, /\bcp\(/, 'the one copy it makes — a report directory kept aside — is here');
});

test('GET /api/file serves a file’s text and its etag, and refuses what is not one', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await fixtureProject(baseUrl);
    const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static') });
    try {
      const base = `http://127.0.0.1:${await ui.listen(0)}`;
      const res = await fetch(`${base}/api/file?path=health.tflw`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { path: string; text: string; etag: string };
      assert.equal(body.path, 'health.tflw');
      assert.equal(body.text, await readFile(join(dir, 'health.tflw'), 'utf8'));
      assert.equal(body.etag, etagOf(body.text));

      assert.equal((await fetch(`${base}/api/file?path=nope.tflw`)).status, 404);
      assert.equal((await fetch(`${base}/api/file?path=../escape.tflw`)).status, 400);
      assert.equal((await fetch(`${base}/api/file?path=tflw.config`)).status, 400, 'the config is not a test file');
      assert.equal((await fetch(`${base}/api/file?path=`)).status, 400);
    } finally {
      await ui.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('PUT /api/file creates, updates on a matching etag, and refuses a stale one', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await fixtureProject(baseUrl);
    const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static') });
    const put = (body: unknown, ifMatch?: string) =>
      fetch(`http://127.0.0.1:${port}/api/file`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...(ifMatch === undefined ? {} : { 'if-match': ifMatch }) },
        body: JSON.stringify(body),
      });
    let port = 0;
    try {
      port = await ui.listen(0);
      const created = `test "new"\n  api GET /health\n  expect status equals 200\n`;

      // Create: no If-Match means "this should not exist yet".
      const a = await put({ path: 'made/by-the-page.tflw', text: created });
      assert.equal(a.status, 200);
      const firstEtag = ((await a.json()) as { etag: string }).etag;
      assert.equal(await readFile(join(dir, 'made', 'by-the-page.tflw'), 'utf8'), created, 'the bytes on disk are the bytes sent');

      // Creating it a second time is the two-pages-racing case, and is refused — with its OWN
      // message. Both refusals are 409 and the client's remedy differs: "you did not read it
      // first" is a different instruction from "re-read and re-apply, it moved". Asserting only
      // the status made this branch invisible, because the etag guard below returns 409 for the
      // same request anyway — found by the mutation that deleted it and survived.
      const twice = await put({ path: 'made/by-the-page.tflw', text: created });
      assert.equal(twice.status, 409);
      assert.match(((await twice.json()) as { error: string }).error, /already exists/);

      // Update with the etag it was created under.
      const updated = `test "new"\n  api GET /health\n  expect status equals 201\n`;
      const b = await put({ path: 'made/by-the-page.tflw', text: updated }, firstEtag);
      assert.equal(b.status, 200);
      const secondEtag = ((await b.json()) as { etag: string }).etag;
      assert.notEqual(secondEtag, firstEtag);
      assert.equal(await readFile(join(dir, 'made', 'by-the-page.tflw'), 'utf8'), updated);

      // The stale etag is prediction §6.2's case: the file moved under the page.
      const stale = await put({ path: 'made/by-the-page.tflw', text: created }, firstEtag);
      assert.equal(stale.status, 409);
      assert.match(((await stale.clone().json()) as { error: string }).error, /changed on disk/);
      assert.equal(await readFile(join(dir, 'made', 'by-the-page.tflw'), 'utf8'), updated, 'a refused write changes nothing');

      // An etag for a file that is not there.
      assert.equal((await put({ path: 'made/ghost.tflw', text: created }, firstEtag)).status, 404);

      // `*` is refused outright: it means "whatever is there now", which is the check itself.
      assert.equal((await put({ path: 'made/by-the-page.tflw', text: created }, '*')).status, 400);

      // A quoted etag is the same etag — HTTP quotes these by convention.
      assert.equal((await put({ path: 'made/by-the-page.tflw', text: created }, `"${secondEtag}"`)).status, 200);
    } finally {
      await ui.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('PUT /api/file refuses text that does not parse or is not formatted, and leaves the file alone', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await fixtureProject(baseUrl);
    const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static') });
    try {
      const port = await ui.listen(0);
      const before = await readFile(join(dir, 'health.tflw'), 'utf8');
      const etag = etagOf(before);
      const put = (text: string) =>
        fetch(`http://127.0.0.1:${port}/api/file`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', 'if-match': etag },
          body: JSON.stringify({ path: 'health.tflw', text }),
        });

      const bad = await put('test "t"\n  api GET\n');
      assert.equal(bad.status, 422);
      const detail = (await bad.json()) as { error: string; code?: string; line?: number };
      assert.ok(detail.code?.startsWith('TF'), `a refusal names its diagnostic, got ${JSON.stringify(detail)}`);
      assert.equal(detail.line, 2);

      // Correct tflw, wrong shape: four spaces where `format` writes two.
      const unformatted = await put('test "t"\n    api GET /health\n');
      assert.equal(unformatted.status, 422);
      assert.match(((await unformatted.json()) as { error: string }).error, /not formatted/);

      assert.equal(await readFile(join(dir, 'health.tflw'), 'utf8'), before, 'neither refusal touched the file');
      const left = await readdirSafe(dir);
      assert.deepEqual(left.filter((f) => f.includes('tflw-ui-')), [], 'no temp file is left behind');
    } finally {
      await ui.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('writeProjectFile refuses a path that is not a .tflw inside the project', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-write-'));
  try {
    const ok = `test "t"\n  api GET /x\n`;
    for (const [path, status] of [['../out.tflw', 400], ['/etc/x.tflw', 400], ['tflw.config', 400], ['notes.md', 400], ['', 400]] as const) {
      const r = await writeProjectFile(dir, path, ok, null);
      assert.ok('status' in r, `${path} should be refused`);
      assert.equal((r as { status: number }).status, status, path);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readProject carries the env\'s authorization, composed the way `resolve.ts` composes it', async () => {
  // `M200` `A2-3`. The page's `tflw check` preview cannot raise `TF060` without this, and `TF060`
  // is the SCANS door's commonest diagnostic by construction. Read off `resolved`, so a declaration
  // in `defaults` and a base URL in the env arrive as ONE answer — the composition `resolve.ts`
  // already does, not a second one here.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-authz-'));
  try {
    await writeFile(
      join(dir, 'tflw.config'),
      [
        'defaults',
        '  authorized target "https://staging.example.com" reason "agreed window"',
        '',
        'env local default',
        '  api "https://staging.example.com/v1"',
        '  api billing "https://billing.example.com"',
        '',
        'env other',
        '  api "https://other.example.com"',
      ].join('\n') + '\n',
      'utf8',
    );
    await writeFile(join(dir, 't.tflw'), 'test "t"\n  api GET /health\n  expect status equals 200\n', 'utf8');

    const view = await readProject(dir);
    assert.equal(view.authorization.envName, 'local', 'the DEFAULT env, which is what a bare `tflw run` takes');
    // The probe opt-ins come with it. They travel on the wire regardless, so the type names them
    // rather than under-describing its own JSON — and `probe mutating` is the one that decides
    // whether an authorization scan may re-issue a write, which a SCANS form has a use for.
    assert.deepEqual(view.authorization.targets, [
      { target: 'https://staging.example.com', reason: 'agreed window', probeMutating: false, probeOversized: false, probeTraversal: false, probeCiphers: false },
    ]);
    // The base is the active env's, not `defaults`' — the two blocks are composed, not concatenated.
    assert.equal(view.authorization.apiBaseUrl, 'https://staging.example.com/v1');
    // And the declared services come too: `D343` widened `TF060` to cover them, so a view that
    // dropped them would let the page show a clean preview for a scan against a different host.
    assert.deepEqual(view.authorization.services, [{ name: 'billing', url: 'https://billing.example.com' }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('initArgv: a door scaffolds with the flag it has, and two doors now have one', () => {
  // `D1051` said "one flag, because `tflw init` has one flag" and `A2-4` (`D1053`) gave it a
  // second. BROWSER still has no scaffold of its own and gets the plain project — stated here so
  // that a door growing a scaffold is a change to this line and not an accident.
  assert.deepEqual(initArgv('load'), ['init', '--load']);
  assert.deepEqual(initArgv('scan'), ['init', '--scan']);
  assert.deepEqual(initArgv('api'), ['init']);
  assert.deepEqual(initArgv('browser'), ['init']);
});

test('GET /api/project says "not a project here" as its own answer, not as an ENOENT', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-empty-'));
  const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static') });
  try {
    const base = `http://127.0.0.1:${await ui.listen(0)}`;
    const res = await fetch(`${base}/api/project`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as { noProject?: boolean; error: string };
    assert.equal(body.noProject, true);
    // The sentence a person reads, not a filesystem error with an absolute path in it.
    assert.match(body.error, /not a tflw project yet/);
    assert.doesNotMatch(body.error, /ENOENT/);
  } finally {
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('POST /api/init creates a project by spawning tflw init, and the LOAD door gets a load test', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-init-'));
  const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static') });
  try {
    const base = `http://127.0.0.1:${await ui.listen(0)}`;
    const init = (door: string) => fetch(`${base}/api/init`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ door }) });

    const res = await init('load');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; created: string[] };
    assert.equal(body.ok, true);
    // `created` is what is on disk afterwards, not what the child claimed (`D985`).
    assert.ok(body.created.includes('tflw.config'));
    assert.ok(body.created.includes('load.tflw'), 'the LOAD door scaffolds a load test');
    await access(join(dir, 'load.tflw'));

    // The project now reads, and the scaffolded load test is behind LOAD by derivation.
    const view = (await (await fetch(`${base}/api/project`)).json()) as { files: { path: string; tests: { lenses: string[] }[] }[] };
    const scaffold = view.files.find((f) => f.path === 'load.tflw');
    assert.ok(scaffold, 'the scaffolded file is discovered');
    assert.ok(scaffold.tests.every((t) => t.lenses.includes('load')), 'the scaffold is what puts it behind LOAD, not its name');

    // Doing it again is refused by `tflw init` itself, in its own words, and nothing is rewritten.
    const before = await readFile(join(dir, 'tflw.config'), 'utf8');
    const again = await init('load');
    assert.equal(again.status, 409);
    const refusal = (await again.json()) as { ok: boolean; output: string };
    assert.equal(refusal.ok, false);
    assert.match(refusal.output, /already exists/);
    assert.equal(await readFile(join(dir, 'tflw.config'), 'utf8'), before);

    // And a door that is not one is refused before anything is spawned.
    assert.equal((await init('nope')).status, 400);
  } finally {
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a door with no scaffold of its own still creates a project, and does not pretend otherwise', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-init-api-'));
  const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static') });
  try {
    const base = `http://127.0.0.1:${await ui.listen(0)}`;
    const res = await fetch(`${base}/api/init`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ door: 'scan' }) });
    const body = (await res.json()) as { ok: boolean; created: string[] };
    assert.equal(body.ok, true);
    assert.ok(body.created.includes('tflw.config'));
    assert.ok(body.created.includes('example.tflw'));
    assert.ok(!body.created.includes('load.tflw'), 'SCANS has no scaffold yet, and does not get LOAD’s');
  } finally {
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});
