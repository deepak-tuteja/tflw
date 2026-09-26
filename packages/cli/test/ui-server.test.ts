// `tflw ui`'s server (`M192` U1) — every route against a fixture project, with a real `tflw run`
// spawned from the source entry under tsx (the same way `tflw ui` spawns it from `dist/cli.cjs`).
// The green condition's clause "no `.tflw` file was written by anything in the `ui` verb" is a
// test here too, on the source: a grep is a gate a reviewer can re-run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, symlink, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseConfigSource } from '@tflw/lang';
import { resolveConfig, selectEnv } from '@tflw/runtime';
import { UiServer, blockForEnv, readProject, runArgv, initArgv, pickArgv, recordArgv, pickUrl, safeJoin, parseUiArgs, traceViewerDir, writeProjectFile, writeConfigFile, writeBaselineDoc, resolveBaselineDoc, dropScratch, etagOf, SCAFFOLDED, SCRATCH_PATH, PLAY_SCRATCH, type RunRecord, type ReportEntry } from '../src/ui-server.js';
import { buildStamp } from '../src/buildStamp.js';
import { readdir } from 'node:fs/promises';

const readdirSafe = async (dir: string): Promise<string[]> => readdir(dir).catch(() => []);

const here = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(here, '..', 'src', 'cli.ts');
// `--import tsx` resolves the package from the CHILD's cwd — the fixture project, which has no
// node_modules — so the loader travels as an absolute path, which is what `tflw ui` under the
// source entry passes along too.
const tsxLoader = fileURLToPath(import.meta.resolve('tsx'));
// `M239` `A` (`D1316`) — one known token for every server here, sent the way the page sends it.
// The boundary itself — what a request WITHOUT it gets — is `ui-server-boundary.test.ts`.
const TOKEN = 'm239-test-token-0123456789abcdef';
const api = (url: string, init: RequestInit = {}): Promise<Response> => fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${TOKEN}` } });

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
  const res = await api(url);
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
      // `M240` `F` (`M239-10`) — the build stamp `tflw spec` prints, on the wire: the same object
      // `buildStamp()` returns, so the page and the CLI can never name two builds.
      assert.deepEqual(p.version, await buildStamp(), 'the project view carries a stamp that is not the CLI’s own');
      assert.equal(p.version.source, 'dev', 'under tsx there is no bundle, and the stamp must say so');
      assert.deepEqual(p.envs, [{ name: 'local', isDefault: true }, { name: 'other', isDefault: false }]);
      assert.equal(p.reportDir, './report');
      assert.deepEqual(p.files.map((f) => f.path).sort(), ['broken.tflw', 'deep/slow.tflw', 'health.tflw']);
      const health = p.files.find((f) => f.path === 'health.tflw')!;
      // `line` is where the declaration starts, tags included — the line a click should land on.
      // `lenses` is `M200` `A0-3`'s derivation (`D1043`): `health` makes a request, so it is
      // behind API — and its `@api` tag is beside the point, since the same tag on a test that
      // made no request would put it behind nothing.
      // `sessions` is `M205` S5b's addition — the `as <session>` names, and **empty is a fact**:
      // this test runs as `anonymous`, the one principal nobody declares.
      // `steps` is `M206` `S4`'s: how many statements do each kind of work, which is what lets Auth
      // say what a session does NOT reach. **Two api, not one** — `api GET /health` is the request
      // and `expect status equals 200` reads a `StatusSubject`, and both are api work by the doors'
      // own classification, which this shares rather than narrowing.
      // **THREE BUCKETS, NOT FOUR** (`M207-01`, repaired by `M207` `S3`). `S4` shipped a `load` key
      // that no step could ever fill: the LOAD lens comes from `test.workload` and
      // `test.thresholds`, which are properties of the test rather than of its body. This
      // `deepEqual` is where its removal is observable — a `notDeepEqual` or a per-key check would
      // have gone on passing with the dead bucket in place.
      assert.deepEqual(health.tests, [
        { name: 'health', tags: ['smoke', 'api'], line: 1, workload: false, lenses: ['api'], sessions: [], steps: { api: 2, browser: 0, scan: 0 } },
      ]);
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
  assert.deepEqual(runArgv({ evidence: 'full', only: 'scratch', files: [SCRATCH_PATH] }), [
    'run', '--format', 'ndjson', '--no-color', '--only', 'scratch', '--evidence', 'full', SCRATCH_PATH,
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
    assert.equal(without.scratchPath, SCRATCH_PATH);
    assert.equal(without.scratchEtag, null, 'a project with no scratch file has no hash to seed the page with');
    assert.equal(without.scratchIgnored, false, 'no .gitignore at all');

    await writeFile(join(dir, '.gitignore'), '.env\nreport/\n', 'utf8');
    assert.equal((await readProject(dir)).scratchIgnored, false, 'a .gitignore without the line');

    await writeFile(join(dir, '.gitignore'), `.env\nreport/\n${SCRATCH_PATH}\n`, 'utf8');
    assert.equal((await readProject(dir)).scratchIgnored, true);

    // A rule that WOULD ignore it but is spelled differently reads as false — stated here rather
    // than left to be discovered, because it is the cost of not shelling out to `git`.
    await writeFile(join(dir, '.gitignore'), '*.tflw\n', 'utf8');
    assert.equal((await readProject(dir)).scratchIgnored, false, 'the documented false negative');

    /**
     * **And the same question about `M221`'s play scratch** (`D1184`).
     *
     * `PLAY_SCRATCH` is a **basename**, not a path, because ▶ writes it beside whichever file it
     * runs — `imports.ts` resolves a relative `use` against `dirname(filePath)`, so a root scratch
     * would change what a nested test imports. The exact-line test is *truer* for a basename than
     * for a path: a `.gitignore` entry with no slash is git's own match-at-any-depth pattern, so
     * one line really does cover every directory.
     */
    await writeFile(join(dir, '.gitignore'), `.env\nreport/\n${SCRATCH_PATH}\n`, 'utf8');
    const onlySend = await readProject(dir);
    assert.equal(onlySend.playScratch, PLAY_SCRATCH);
    assert.equal(onlySend.playIgnored, false, 'the send scratch being listed says nothing about the play scratch');
    await writeFile(join(dir, '.gitignore'), `.env\nreport/\n${SCRATCH_PATH}\n${PLAY_SCRATCH}\n`, 'utf8');
    const both = await readProject(dir);
    assert.equal(both.playIgnored, true);
    assert.equal(both.scratchIgnored, true, 'and the two answers are independent, not one field read twice');

    /**
     * **And it is invisible to discovery at DEPTH, which is the half `M205` Q15 only needed at the
     * root** (`M221` gate 7).
     *
     * `project.ts`'s walk skips every dot-prefixed entry at every level, so the leading dot is the
     * whole mechanism and there is no `exclude` key to scaffold. This is asserted rather than
     * assumed because it is what stands between ▶ and `M205-04`'s defect one directory down: a
     * sidebar reading `2 files` for one the author wrote, and a bare `tflw run` executing the same
     * test twice.
     */
    await mkdir(join(dir, 'tests'), { recursive: true });
    await writeFile(join(dir, 'tests', 'a.tflw'), 'test "one"\n  api GET "/"\n  expect status equals 200\n', 'utf8');
    const before = await readProject(dir);
    assert.deepEqual(before.files.map((f) => f.path), ['tests/a.tflw']);
    await writeFile(join(dir, 'tests', PLAY_SCRATCH), 'test "one"\n  api GET "/"\n  expect status equals 200\n', 'utf8');
    assert.deepEqual((await readProject(dir)).files.map((f) => f.path), ['tests/a.tflw'], 'the play scratch is in the tree');
    // NEGATIVE CONTROL: the same bytes under a name WITHOUT the dot are discovered, so the line
    // above is about the leading dot and not about the walk missing the directory.
    await writeFile(join(dir, 'tests', 'play.tflw'), 'test "one"\n  api GET "/"\n  expect status equals 200\n', 'utf8');
    assert.equal((await readProject(dir)).files.length, 2, 'the walk never reached tests/ at all');
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
    const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static') });
    try {
      const port = await ui.listen(0);
      assert.equal((ui.server.address() as { address: string }).address, '127.0.0.1', 'loopback only');
      const base = `http://127.0.0.1:${port}`;

      const started = await api(`${base}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: ['health.tflw'] }) });
      assert.equal(started.status, 202);
      const record = (await started.json()) as RunRecord;
      assert.equal(record.status, 'running');
      assert.deepEqual(record.argv, ['run', '--format', 'ndjson', '--no-color', 'health.tflw']);

      const { data, end } = await readSse(`${base}/api/runs/${record.id}/events`);
      const types = data.map((l) => (JSON.parse(l) as { type: string }).type);
      const stderr = ((await (await api(`${base}/api/runs/${record.id}/stderr`)).json()) as { stderr: string }).stderr;
      assert.ok(types.includes('run:start') && types.includes('test:end') && types.includes('run:end'), `stream carried ${types.join(',')}; stderr: ${stderr}`);
      assert.equal(end?.status, 'done');
      assert.equal(end?.exitCode, 0);
      assert.equal(end?.kept, `report/runs/${record.id}`, `kept; stderr: ${stderr}`);

      // A late subscriber replays the whole stream and gets the end at once.
      const replay = await readSse(`${base}/api/runs/${record.id}/events`);
      // U7: a run that refuses its own argv writes nothing — and `report/` still holds the run
      // above, so presence alone would keep that as this run's record. Nothing is kept.
      const refused = (await (await api(`${base}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workers: 0 }) })).json()) as RunRecord;
      const refusedEnd = await readSse(`${base}/api/runs/${refused.id}/events`);
      assert.equal(refusedEnd.end?.exitCode, 2);
      assert.equal(refusedEnd.end?.kept, null, 'a run that wrote no report keeps no directory, whatever the previous run left');
      assert.match(((await (await api(`${base}/api/runs/${refused.id}/stderr`)).json()) as { stderr: string }).stderr, /positive integer/);
      assert.deepEqual(replay.data, data);
      assert.equal(replay.end?.status, 'done');

      const runs = (await (await api(`${base}/api/runs`)).json()) as RunRecord[];
      assert.equal(runs.length, 2, 'newest first: the refused run, then the real one');
      assert.deepEqual(runs.map((r) => [r.status, r.kept]), [['done', null], ['done', `report/runs/${record.id}`]]);

      // **`M229` `E` (`D1254`) — RESTATED, because that round made the old line false on purpose.**
      // It read `['current', record.id]`, and those two entries were **one run**: `keepReport`
      // copies `report/` into `report/runs/<id>` entry by entry, so the newest kept directory and
      // `current` are the same bytes under two names. The list advertised two runs, both with the
      // same counts and the same instant, and nothing on either row said so. `current` is a flag on
      // the run now, so the assertion is the count as much as the ids.
      const reports = (await (await api(`${base}/api/reports`)).json()) as ReportEntry[];
      assert.deepEqual(reports.map((r) => [r.id, r.current === true]), [[record.id, true]], 'one run, and it is the one `report/current` holds');
      for (const r of reports) {
        assert.deepEqual(r.summary, { ok: true, total: 1, passed: 1, failed: 0 });
        assert.ok(r.artefacts.includes('results.json') && r.artefacts.includes('events.ndjson'), `${r.id} holds ${r.artefacts.join(',')}`);
        /**
         * **`M232` (`M213-19`, `D1271`) — the two lists are different lists, and the field is now
         * named for which one it is.**
         *
         * `artefacts` was called `files`, and `files` is true of both sets and wrong about one of
         * them: the first consumer to read it as *the `.tflw` files this run executed* matched
         * nothing and said nothing, because `'health.tflw'.includes` of an artefact name is simply
         * false. The carry is **a field name that is a category rather than a contract**.
         *
         * This assertion is the one that could not be written before — and it is an equality on
         * both sides, because a gate saying only *`tests` is non-empty* would pass on an
         * implementation that put the artefacts in it.
         */
        assert.deepEqual(r.tests, ['health.tflw'], `${r.id} ran ${JSON.stringify(r.tests)}`);
        assert.equal(r.tests.some((f) => r.artefacts.includes(f)), false, 'the two lists share no member — that is the whole reason for two fields');
      }
      assert.equal(reports[0]!.path, `report/runs/${record.id}`);

      // **THE OTHER DIRECTION, WHICH IS THE ONE THAT COULD LOSE A RUN.** `tflw run` in a terminal
      // writes `report/` and keeps nothing, so `current` is then a run with no `runs/<id>` of its
      // own. Folding on *position* — the newest kept row — would have hidden it behind a run it has
      // nothing to do with, which is why `listReports` compares the evidence instead. Written by
      // hand here because a second run through this server would keep itself and never make the
      // shape.
      const terminalRun = JSON.stringify({ ok: false, total: 3, passed: 2, failed: 1 });
      await writeFile(join(dir, 'report', 'results.json'), terminalRun);
      const after = (await (await api(`${base}/api/reports`)).json()) as ReportEntry[];
      assert.deepEqual(after.map((r) => [r.id, r.current === true]), [['current', true], [record.id, false]], 'a `report/` that matches no kept run is a run of its own');
      assert.deepEqual(after[0]!.summary, { ok: false, total: 3, passed: 2, failed: 1 }, 'and it is the terminal run’s own evidence, not the kept one’s');
      // Put it back, so nothing below reads a report this assertion invented.
      await cp(join(dir, 'report', 'runs', record.id, 'results.json'), join(dir, 'report', 'results.json'));

      // **THE SAME RUN IS NOT ALWAYS THE SAME EVIDENCE, and the sibling's sweep is what found it.**
      // `testFlow-tests`' `verify-ui.mjs` plants a stale `findings.sarif` into `report/` and reads
      // `/api/reports` to watch it appear and then go — `M192-03`'s own grader — and a fold decided
      // on `results.json` alone closed the only window that grader has. So a `report/` holding a
      // member its kept copy does not is a row of its own, which is also the honest answer: that
      // state is the defect `M192-03` filed, and a list that hid it would be hiding a defect.
      await writeFile(join(dir, 'report', 'findings.sarif'), '{"runs":[]}');
      const planted = (await (await api(`${base}/api/reports`)).json()) as ReportEntry[];
      assert.deepEqual(planted.map((r) => [r.id, r.current === true]), [['current', true], [record.id, false]], 'a `report/` carrying a member its copy does not is the same run and not the same evidence');
      assert.ok(planted[0]!.artefacts.includes('findings.sarif') && !planted[1]!.artefacts.includes('findings.sarif'), 'the plant is visible on exactly one of the two rows');
      await rm(join(dir, 'report', 'findings.sarif'));
      const swept = (await (await api(`${base}/api/reports`)).json()) as ReportEntry[];
      assert.deepEqual(swept.map((r) => r.id), [record.id], 'and they fold back together the moment the evidence matches again');

      const served = await api(`${base}/api/reports/${record.id}/results.json`);
      assert.equal(served.status, 200);
      assert.equal(served.headers.get('content-type'), 'application/json; charset=utf-8');
      const kept = JSON.parse(await readFile(join(dir, 'report', 'runs', record.id, 'results.json'), 'utf8')) as { passed: number };
      assert.equal(((await served.json()) as { passed: number }).passed, kept.passed);
      // The kept copy never contains itself.
      await assert.rejects(access(join(dir, 'report', 'runs', record.id, 'runs')));

      // Escapes are refused, not resolved.
      assert.equal((await api(`${base}/api/reports/current/..%2Ftflw.config`)).status, 400);
      assert.equal((await api(`${base}/api/reports/..%2F..%2Fx/results.json`)).status, 400);
      assert.equal((await api(`${base}/api/reports/current/nope.json`)).status, 404);
      assert.equal((await api(`${base}/api/runs/nope/events`)).status, 404);
      assert.equal((await api(`${base}/api/nothing`)).status, 404);
    } finally {
      await ui.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('cancel sends SIGINT to the child; the run ends cancelled and its subscribers are told', async () => {
  await withFixtureServer(async (baseUrl, slow) => {
    const dir = await fixtureProject(baseUrl);
    const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static') });
    try {
      const port = await ui.listen(0);
      const base = `http://127.0.0.1:${port}`;
      const record = (await (await api(`${base}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: ['deep/slow.tflw'] }) })).json()) as RunRecord;
      const stream = readSse(`${base}/api/runs/${record.id}/events`);
      // Cancel once the run is genuinely inside the held request, not merely spawned.
      const deadline = Date.now() + 30_000;
      while (slow.held() === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      assert.equal(slow.held(), 1, 'the run reached the held request');
      const cancelled = (await (await api(`${base}/api/runs/${record.id}/cancel`, { method: 'POST' })).json()) as { cancelled: boolean };
      assert.equal(cancelled.cancelled, true);
      const { end } = await stream;
      assert.equal(end?.status, 'cancelled');
      assert.equal((await (await api(`${base}/api/runs/${record.id}/cancel`, { method: 'POST' })).json() as { cancelled: boolean }).cancelled, false, 'a second cancel has nothing to cancel');
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
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir });
  const unbuilt = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'missing') });
  try {
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;
    assert.equal(await (await api(`${base}/`)).text(), '<title>tflw</title>');
    assert.equal(await (await api(`${base}/reports/2026`)).text(), '<title>tflw</title>');
    const js = await api(`${base}/assets/index-abc.js`);
    assert.equal(js.status, 200);
    assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal((await api(`${base}/assets/nope.js`)).status, 404);
    assert.equal((await api(`${base}/..%2Ftflw.config`)).status, 404);
    const port2 = await unbuilt.listen(0);
    // `D1316`: the token first — without it the answer is 401 whatever the bundle's state.
    assert.equal((await fetch(`http://127.0.0.1:${port2}/`)).status, 401);
    const r = await fetch(`http://127.0.0.1:${port2}/?token=${TOKEN}`);
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
  const bare = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'ui') });
  try {
    const port = await bare.listen(0);
    const base = `http://127.0.0.1:${port}`;
    assert.equal(traceViewerDir(dir), null);
    assert.equal((await readProject(dir)).traceViewer, false);
    const missing = await api(`${base}/trace/index.html`);
    assert.equal(missing.status, 404);
    assert.match(((await missing.json()) as { error: string }).error, /show-trace/);

    await symlink(join(here, '..', '..', '..', 'node_modules'), join(dir, 'node_modules'), 'dir');
    const viewerDir = traceViewerDir(dir);
    assert.ok(viewerDir !== null && viewerDir.endsWith(join('lib', 'vite', 'traceViewer')), `resolved ${viewerDir}`);
    assert.equal((await readProject(dir)).traceViewer, true);
    const index = await api(`${base}/trace/index.html`);
    assert.equal(index.status, 200);
    assert.equal(index.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(await index.text(), /Playwright Trace Viewer/);
    assert.equal(await (await api(`${base}/trace/`)).status, 200);
    const sw = await api(`${base}/trace/sw.bundle.js`);
    assert.equal(sw.status, 200);
    assert.equal(sw.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal((await api(`${base}/trace/..%2Fpackage.json`)).status, 400);
    assert.equal((await api(`${base}/trace/nope.js`)).status, 404);
  } finally {
    await bare.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the server writes through exactly one call site — the green condition, narrowed twice, not dropped', async () => {
  // Slice 1's clause was "no write path at all", grepped on this source. `M200` `A0-2` made the
  // page an authoring surface, so the clause was replaced by its successor rather than deleted: a
  // guard widened until it admits the new thing is no guard, and this one is narrowed to the new
  // thing's own shape each time the shape changes.
  //
  // **`M205` S5b is the second narrowing, and it is the one this gate was waiting for.** Q5 adds a
  // capability that writes `tflw.config` — a *second* thing the page may write — and the honest
  // reading of `D1049` was never "one file kind" but "one place where bytes reach the disk, and a
  // separate decision per capability about what may reach it". So: one `writeFile`, in
  // `atomicWrite`; exactly two callers, each with its own validation; and — the clause S5b could
  // most easily have broken — `resolveWritablePath` still refuses `tflw.config`, so the config
  // capability was added beside the test-writing one and not smuggled through it.
  const source = await readFile(join(here, '..', 'src', 'ui-server.ts'), 'utf8');
  const writes = source.match(/\bwriteFile\(/g) ?? [];
  assert.equal(writes.length, 1, `ui-server.ts must write through exactly one call site, found ${writes.length}`);
  const body = (name: string): string => {
    const at = source.indexOf(name);
    assert.ok(at >= 0, `${name} is here`);
    return source.slice(at, source.indexOf('\n}\n', at));
  };
  assert.match(body('async function atomicWrite'), /\bwriteFile\(/, 'the one writeFile call is inside atomicWrite');
  const callers = (source.match(/\bawait atomicWrite\(/g) ?? []).length;
  // THREE SINCE `M208` `S2`, AND THE NUMBER IS THE POINT RATHER THAN THE PROPERTY. `D1049` says
  // one write **call site**, and there is still exactly one `writeFile(` above. What this counts is
  // capabilities, and each new one is a deliberate answer to *may the page write this kind of
  // thing* — tests, then the config (`Q5`), now a declared baseline document. A baseline is the
  // narrowest of the three: it cannot name a `.tflw`, it cannot name a path at all, and it reaches
  // disk only through a path `tflw.config` itself declares.
  assert.equal(callers, 3, `exactly three capabilities write: the .tflw route, the config route and the baseline route, found ${callers}`);
  assert.match(body('export async function writeProjectFile'), /\bawait atomicWrite\(/);
  assert.match(body('export async function writeConfigFile'), /\bawait atomicWrite\(/);
  assert.match(body('export async function writeBaselineDoc'), /\bawait atomicWrite\(/);
  // The narrowing, asserted rather than described: the baseline route takes a config **block**, so
  // there is no parameter a page could point at a file of its choosing. `SCRATCH_PATH`'s own
  // docblock makes the same argument for `dropScratch`.
  assert.doesNotMatch(body('export async function writeBaselineDoc'), /resolveWritablePath/);
  assert.match(body('export async function resolveBaselineDoc'), /safeJoin\(/, 'and the project boundary still runs, because a person can type `baseline "../.."`');
  assert.doesNotMatch(source, /appendFile|createWriteStream|openSync|writeSync|truncate\(/, 'no other write verb (D985)');
  assert.match(source, /\bcp\(/, 'the one copy it makes — a report directory kept aside — is here');
  // The refusal the config route did NOT dissolve. Asserted here rather than only in
  // `writeProjectFile refuses …` below, because this is the clause about the *architecture*: the
  // page can write a config, and it still cannot write one through the route that writes tests.
  const refused = await writeProjectFile(await mkdtemp(join(tmpdir(), 'tflw-d1049-')), 'tflw.config', 'env local default\n  api "http://x"\n', null);
  assert.ok('status' in refused && refused.status === 400, 'resolveWritablePath still refuses tflw.config');
});

test('GET /api/file serves a file’s text and its etag, and refuses what is not one', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await fixtureProject(baseUrl);
    const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static') });
    try {
      const base = `http://127.0.0.1:${await ui.listen(0)}`;
      const res = await api(`${base}/api/file?path=health.tflw`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { path: string; text: string; etag: string };
      assert.equal(body.path, 'health.tflw');
      assert.equal(body.text, await readFile(join(dir, 'health.tflw'), 'utf8'));
      assert.equal(body.etag, etagOf(body.text));

      assert.equal((await api(`${base}/api/file?path=nope.tflw`)).status, 404);
      assert.equal((await api(`${base}/api/file?path=../escape.tflw`)).status, 400);
      assert.equal((await api(`${base}/api/file?path=tflw.config`)).status, 400, 'the config is not a test file');
      assert.equal((await api(`${base}/api/file?path=`)).status, 400);
    } finally {
      await ui.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('PUT /api/file creates, updates on a matching etag, and refuses a stale one', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await fixtureProject(baseUrl);
    const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static') });
    const put = (body: unknown, ifMatch?: string) =>
      api(`http://127.0.0.1:${port}/api/file`, {
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
    const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static') });
    try {
      const port = await ui.listen(0);
      const before = await readFile(join(dir, 'health.tflw'), 'utf8');
      const etag = etagOf(before);
      const put = (text: string) =>
        api(`http://127.0.0.1:${port}/api/file`, {
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
    // `line` and `block` are `M205` S5b's addition — where the declaration is written, so Auth's
    // `[edit]` lands on it. The element stays assignable to `EnvAuthorizedTargets`, which is what
    // lets the page keep handing this object to `checkAuthorizedTargets` untranslated.
    assert.deepEqual(view.authorization.targets, [
      { target: 'https://staging.example.com', reason: 'agreed window', probeMutating: false, probeOversized: false, probeTraversal: false, probeCiphers: false, line: 2, block: 'defaults' },
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

test('GET and PUT /api/config: the config is readable, writable under its etag, and refuses the rest', async () => {
  // `M205` Q5, closing `M205-03` — the finding that the product told the author, in two places, to
  // make an edit its own page was forbidden from making.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-config-route-'));
  try {
    const original = ['env local default', '  api "tflw://demo"'].join('\n') + '\n';
    await writeFile(join(dir, 'tflw.config'), original, 'utf8');
    await writeFile(join(dir, 't.tflw'), 'test "t"\n  api GET /health\n  expect status equals 200\n', 'utf8');
    const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static') });
    const base = `http://127.0.0.1:${await ui.listen(0)}`;
    const put = (text: string, headers: Record<string, string> = {}) =>
      api(`${base}/api/config`, { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ text }) });
    try {
      const read = await api(`${base}/api/config`);
      assert.equal(read.status, 200);
      const view = (await read.json()) as { path: string; text: string; etag: string };
      assert.equal(view.path, 'tflw.config');
      assert.equal(view.text, original, 'the bytes, not a re-print of them');
      assert.equal(view.etag, etagOf(original));

      // The edit the scaffold's own comment asks for, and the demo service's 404 hint after it.
      const edited = original.replace('tflw://demo', 'http://localhost:3001');
      const ok = await put(edited, { 'if-match': view.etag });
      assert.equal(ok.status, 200);
      const wrote = (await ok.json()) as { etag: string };
      assert.equal(await readFile(join(dir, 'tflw.config'), 'utf8'), edited, 'byte for byte what was sent');
      assert.equal(wrote.etag, etagOf(edited), 'the etag is over the bytes the page holds, so the next write needs no re-read');

      // Four refusals, and the file is untouched by every one of them.
      assert.equal((await put(edited)).status, 409, 'no If-Match: a config always exists, so there is no create case');
      assert.equal((await put(edited, { 'if-match': '*' })).status, 400, '`*` is any version, which is the check itself');
      assert.equal((await put(edited, { 'if-match': view.etag })).status, 409, 'the etag it was read at is now stale');
      const bad = await put('env\n', { 'if-match': wrote.etag });
      assert.equal(bad.status, 422);
      const why = (await bad.json()) as { code?: string; line?: number };
      assert.equal(why.code, 'TF010', 'the diagnostic travels, so the page can point at the line');
      assert.equal(why.line, 1);
      assert.equal(await readFile(join(dir, 'tflw.config'), 'utf8'), edited, 'nothing refused touched the file');

      // And the refusal that matters most, because a config that does not parse takes
      // `GET /api/project` down with it — a page allowed to write one could lock itself out of
      // the project it is editing. The control: the project still reads.
      assert.equal((await api(`${base}/api/project`)).status, 200);
    } finally {
      await ui.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('GET and PUT /api/baseline: a document the config declares, addressed by its block', async () => {
  // `M208` `S2` (`Q2`/`D1060`). The Config tab was already the one tab whose subject is not the
  // addressed file — it renders `tflw.config` while the hash names the `.tflw` — and this is the
  // second document it can show. The route's whole safety argument is that **the page names a
  // config block, never a path**: the config says which file, the server reads the config, and the
  // only thing crossing the wire is a word that already appears in it.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-baseline-route-'));
  try {
    const config = [
      'defaults',
      '  baseline "./security-baseline.json"',
      '',
      'env local default',
      '  api "http://127.0.0.1:1"',
      '  baseline "./sec/local.json"',
      '',
      'env prod',
      '  api "http://127.0.0.1:2"',
      '',
    ].join('\n');
    await writeFile(join(dir, 'tflw.config'), config, 'utf8');
    await writeFile(join(dir, 't.tflw'), 'test "t"\n  api GET /health\n  expect status equals 200\n', 'utf8');
    const declared = JSON.stringify({ version: 1, accepted: [{ fingerprint: 'a3f19c2e5b04d871', rule: 'sec/csp-missing', endpoint: 'GET /' }] });
    await writeFile(join(dir, 'security-baseline.json'), declared, 'utf8');

    const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static') });
    const base = `http://127.0.0.1:${await ui.listen(0)}`;
    const put = (doc: string, text: string, headers: Record<string, string> = {}) =>
      api(`${base}/api/baseline?doc=${doc}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ text }) });
    try {
      // 1. The `defaults` block's document, read through the block that declares it.
      const read = await api(`${base}/api/baseline?doc=defaults`);
      assert.equal(read.status, 200);
      const view = (await read.json()) as { path: string; declaredIn: string; text: string | null; etag: string | null };
      assert.deepEqual(
        { path: view.path, declaredIn: view.declaredIn, text: view.text, etag: view.etag },
        { path: './security-baseline.json', declaredIn: 'defaults', text: declared, etag: etagOf(declared) },
      );

      // 2. A DECLARED DOCUMENT THAT IS NOT ON DISK IS `200` WITH `text: null`, NOT `404`. The
      //    declaration is really there and the file is not, which is the ordinary state of a
      //    project adopting triage. A `404` would make *no such env* and *not written yet* the
      //    same answer, and only one of them is a mistake — so the control is step 3, which is
      //    the other one.
      const absent = await api(`${base}/api/baseline?doc=local`);
      assert.equal(absent.status, 200);
      const absentView = (await absent.json()) as { path: string; text: string | null; etag: string | null };
      assert.deepEqual({ path: absentView.path, text: absentView.text, etag: absentView.etag }, { path: './sec/local.json', text: null, etag: null });

      // 3. The two real `404`s: a block with no `baseline`, and a block that does not exist.
      assert.equal((await api(`${base}/api/baseline?doc=prod`)).status, 404, 'env prod declares no baseline');
      assert.equal((await api(`${base}/api/baseline?doc=nope`)).status, 404, 'there is no env nope');
      assert.equal((await api(`${base}/api/baseline`)).status, 400, 'and no document at all is a usage error');

      // 4. Writing it. `If-Match` absent means CREATE — the difference from `PUT /api/config`, and
      //    the case `[accept]` on a first finding hits. The nested directory is made on the way.
      const first = JSON.stringify({ version: 1, accepted: [] });
      const created = await put('local', first);
      assert.equal(created.status, 200);
      assert.equal(await readFile(join(dir, 'sec', 'local.json'), 'utf8'), first, 'byte for byte, in a directory that did not exist');
      const createdEtag = ((await created.json()) as { etag: string }).etag;

      // 5. Four refusals, and the file is untouched by every one of them.
      assert.equal((await put('local', first)).status, 409, 'no If-Match on a document that now exists');
      assert.equal((await put('local', first, { 'if-match': '*' })).status, 400, '`*` is any version, which is the check itself');
      assert.equal((await put('local', first, { 'if-match': 'deadbeefdeadbeef' })).status, 409, 'a stale etag');
      const bad = await put('local', JSON.stringify({ version: 2, accepted: [] }), { 'if-match': createdEtag });
      assert.equal(bad.status, 422, "a document this tflw does not understand is refused, not accepted as 'nothing'");
      assert.match(((await bad.json()) as { error: string }).error, /version/);
      assert.equal(await readFile(join(dir, 'sec', 'local.json'), 'utf8'), first, 'nothing refused touched the file');

      // 6. AND THE REFUSAL THE WHOLE FEATURE RESTS ON. `parseBaseline` is the strictest bar in this
      //    repository because every failure mode of a baseline makes a build GREENER — a document
      //    that parses to *accepted nothing* is indistinguishable from a codebase that fixed
      //    everything. The page is the author here, so this is the claim the page cannot be trusted
      //    to make about itself.
      assert.equal((await put('local', 'not json at all', { 'if-match': createdEtag })).status, 422);
      assert.equal((await put('local', JSON.stringify({ version: 1, accepted: [{ rule: 'x' }] }), { 'if-match': createdEtag })).status, 422, 'an entry with no fingerprint matches nothing and would silently accept nothing');
    } finally {
      await ui.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a `baseline` pointing outside the project is refused, and the page never names the path anyway', async () => {
  // Two separate claims, and the second is why the first can be a thin check rather than a
  // sanitiser. The page names a config **block**; only a person editing `tflw.config` can write a
  // path at all, so the boundary here is the project boundary and not a defence against the page.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-baseline-escape-'));
  try {
    await writeFile(join(dir, 'tflw.config'), 'defaults\n  baseline "../../escape.json"\n\nenv local default\n  api "http://127.0.0.1:1"\n', 'utf8');
    const escaped = await resolveBaselineDoc(dir, { block: 'defaults' });
    assert.ok('status' in escaped, 'a path outside the root must not resolve');
    assert.equal(escaped.status, 400);
    const refused = await writeBaselineDoc(dir, 'defaults', JSON.stringify({ version: 1, accepted: [] }), null);
    assert.ok('status' in refused && refused.status === 400, 'and the write refuses it before touching anything');
    // Control: the same config with a path inside the root resolves, so the refusal above is about
    // the escape and not about this fixture.
    await writeFile(join(dir, 'tflw.config'), 'defaults\n  baseline "./inside.json"\n\nenv local default\n  api "http://127.0.0.1:1"\n', 'utf8');
    const inside = await resolveBaselineDoc(dir, { block: 'defaults' });
    assert.ok(!('status' in inside), `the control must resolve: ${JSON.stringify(inside)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('`blockForEnv` agrees with `resolveConfig` about which baseline an env is graded against', async () => {
  // `M208` `S3`. `[accept]` has to link to a **block**, because that is what an address can name —
  // and `resolveConfig` answers with a **path**, because that is what a run uses. Only the AST has
  // the first, so the fallback rule is written a second time, which is the shape `M169d5` is filed
  // under: two implementations of one rule, where a parity check agreed with itself while 43 wrong
  // sites published.
  //
  // So it is graded against `resolveConfig` itself rather than against a table of expected answers.
  // Nothing here says what the rule *is*; it says the two agree, over configs chosen to separate
  // them — and a change on either side turns this red from either direction.
  const cases: { readonly why: string; readonly config: string; readonly env: string }[] = [
    { why: 'the env declares its own', config: 'defaults\n  baseline "./d.json"\n\nenv a default\n  api "http://127.0.0.1:1"\n  baseline "./a.json"\n', env: 'a' },
    { why: 'the env declares none, so defaults wins', config: 'defaults\n  baseline "./d.json"\n\nenv a default\n  api "http://127.0.0.1:1"\n', env: 'a' },
    { why: 'neither declares one', config: 'env a default\n  api "http://127.0.0.1:1"\n', env: 'a' },
    { why: 'only the env declares one', config: 'env a default\n  api "http://127.0.0.1:1"\n  baseline "./a.json"\n', env: 'a' },
    { why: 'a second line in one block: the last wins, as TF081 says it does', config: 'env a default\n  api "http://127.0.0.1:1"\n  baseline "./first.json"\n  baseline "./second.json"\n', env: 'a' },
    { why: 'another env declares one and this one does not', config: 'env a default\n  api "http://127.0.0.1:1"\n\nenv b\n  api "http://127.0.0.1:2"\n  baseline "./b.json"\n', env: 'a' },
  ];
  const dir = await mkdtemp(join(tmpdir(), 'tflw-blockforenv-'));
  try {
    let resolvedSome = false;
    let resolvedNone = false;
    for (const c of cases) {
      const { config } = parseConfigSource(c.config);
      const viaResolve = resolveConfig(config, selectEnv(config, {}), {}).baselinePath;
      await writeFile(join(dir, 'tflw.config'), c.config, 'utf8');
      const block = blockForEnv(config, c.env);
      const viaBlock = block === null ? null : await resolveBaselineDoc(dir, { block });
      const path = viaBlock === null ? null : 'status' in viaBlock ? `refused: ${viaBlock.error}` : viaBlock.path;
      assert.equal(path, viaResolve, `${c.why}: the address's document and the run's document disagree`);
      if (viaResolve === null) resolvedNone = true;
      else resolvedSome = true;
    }
    // Non-vacuity: the table reaches both outcomes, so an agreement that is always `null === null`
    // would not pass for correct.
    assert.ok(resolvedSome && resolvedNone, 'the table must exercise both a resolved baseline and none');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the config route accepts unformatted text and the .tflw route does not — the difference is the editor, not an oversight', async () => {
  // `writeProjectFile` requires text `format` would already have produced, because the page there
  // is a FORM whose bytes come out of the printer and a server that silently reformatted would
  // hand back an etag for a file the page has never seen. The Config tab is a TEXT EDITOR over
  // the author's own bytes; nothing reformats them, so the etag is already over what the page
  // holds, and refusing an unformatted config would mean refusing to save a file `tflw fmt`
  // would happily fix.
  //
  // Both halves are asserted, because the claim is a *difference*: without the control this
  // passes on a server that checks formatting nowhere at all.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-config-fmt-'));
  try {
    const config = 'env local default\n  api "http://127.0.0.1:1"\n';
    await writeFile(join(dir, 'tflw.config'), config, 'utf8');
    const sloppy = 'env local default\n        api      "http://127.0.0.1:1"\n';
    const saved = await writeConfigFile(dir, sloppy, etagOf(config));
    assert.ok(!('status' in saved), `the config route takes it: ${JSON.stringify(saved)}`);
    assert.equal(await readFile(join(dir, 'tflw.config'), 'utf8'), sloppy, 'unchanged — nothing reformatted it');

    const refused = await writeProjectFile(dir, 't.tflw', 'test "t"\n        api GET /health\n', null);
    assert.ok('status' in refused, 'the .tflw route refuses the same shape of input');
    assert.equal(refused.status, 422);
    assert.match(refused.error, /not formatted/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readProject carries who runs as what: the sessions declared, the sessions used, and where each is written', async () => {
  // `M205` S5b — what the Auth tab reads. Three claims the page cannot make for itself: which
  // sessions the active env actually gets, which of them a file's tests name, and the line each
  // declaration sits on so `[edit]` lands somewhere true.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-sessions-'));
  try {
    await writeFile(
      join(dir, 'tflw.config'),
      [
        'defaults',                                                                          // 1
        '  authorized target "https://a.example.com" reason "one"',                           // 2
        '',                                                                                   // 3
        'env local default',                                                                  // 4
        '  api "https://a.example.com"',                                                      // 5
        '  authorized target "https://a.example.com" reason "the same host, a second reason"', // 6
        '',                                                                                   // 7
        'env staging',                                                                        // 8
        '  api "https://s.example.com"',                                                       // 9
        '',                                                                                    // 10
        'session admin privileged',                                                            // 11
        '  api POST /login',                                                                   // 12
        '  header "Authorization" is "Bearer t"',                                              // 13
        '',                                                                                    // 14
        'session ops for env staging',                                                         // 15
        '  api POST /login',                                                                   // 16
      ].join('\n') + '\n',
      'utf8',
    );
    await writeFile(
      join(dir, 't.tflw'),
      ['test "one" as admin', '  api GET /x', '  expect status equals 200', '', 'test "two"', '  api GET /y', '  expect status equals 200', ''].join('\n'),
      'utf8',
    );

    const view = await readProject(dir);
    const { sessions, targets } = view.authorization;

    // Declared, in the active env, with what running `as` it adds to a request. Header NAMES and
    // never values: a session header is where a bearer token lives and this object is serialised
    // to a browser.
    assert.deepEqual(sessions[0], { name: 'admin', privileged: true, oauth2: false, headers: ['Authorization'], steps: 2, line: 11, outOfScope: null });
    // Declared for another env, which is the state the Auth tab exists to make visible: the test
    // that names it runs anonymous and `tflw check` is the only other place that says so.
    assert.deepEqual(sessions[1], { name: 'ops', privileged: false, oauth2: false, headers: [], steps: 1, line: 15, outOfScope: ['staging'] });

    // `as` on the test itself, so the page can show which of the declared sessions this FILE uses
    // — a list that differs from the declared one in every project that has ever deleted a test.
    const tests = view.files.find((f) => f.path === 't.tflw')!.tests;
    assert.deepEqual(tests.map((t) => [t.name, t.sessions]), [['one', ['admin']], ['two', []]]);

    // One row per DECLARATION and not per origin — `resolve.ts` accumulates rather than folds, so
    // "every declaration still travels to the report with its own reason". Two rows for one host,
    // each with its own line, is what the config says and what Auth must render.
    assert.deepEqual(
      targets.map((t) => [t.target, t.reason, t.block, t.line]),
      [
        ['https://a.example.com', 'one', 'defaults', 2],
        ['https://a.example.com', 'the same host, a second reason', 'local', 6],
      ],
    );
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

test('`M240` `B` (`D1310`): a directory with no tflw.config is a project that has not started — the project route says so with a 200, the lists are empty, and every other route is a 409 with no path in it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-empty-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static') });
  try {
    const base = `http://127.0.0.1:${await ui.listen(0)}`;
    const res = await api(`${base}/api/project`);
    assert.equal(res.status, 200, 'the unconfigured answer is not an error');
    const body = (await res.json()) as { configured: boolean; noProject?: boolean; root: string; version: { version: string } };
    assert.equal(body.configured, false);
    assert.equal(body.noProject, true, 'the name the page and `e2e.test.ts` already ask by');
    assert.equal(body.root, basename(dir), 'the directory by name — the 404 this replaces carried the absolute path');
    assert.deepEqual(body.version, await buildStamp(), 'the landing still says which tflw this is');
    // The lists answer empty rather than reaching `readProject` and dying with an `ENOENT` — which
    // `/api/reports` did on every landing over an empty directory, logged and unshown.
    assert.deepEqual(await (await api(`${base}/api/reports`)).json(), []);
    assert.deepEqual(await (await api(`${base}/api/runs`)).json(), []);
    // Reads and writes of a project that is not there: one sentence, 409, until `init` has run.
    const answers: Record<string, number> = {};
    for (const [method, path, init] of [
      ['GET', '/api/file?path=x.tflw', {}],
      ['PUT', '/api/file', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'x.tflw', text: 'test "a"\n', etag: null }) }],
      ['POST', '/api/run', { headers: { 'content-type': 'application/json' }, body: '{}' }],
      ['GET', '/api/baseline', {}],
      ['GET', '/api/refactor?path=x.tflw', {}],
    ] as const) {
      const r = await api(`${base}${path}`, { method, ...init });
      answers[`${method} ${path}`] = r.status;
      const text = await r.text();
      assert.match(text, /no tflw\.config yet/, `${method} ${path}: ${text}`);
      assert.doesNotMatch(text, /\/(tmp|home|Users)\//, `${method} ${path} carries an absolute path: ${text}`);
    }
    assert.deepEqual(new Set(Object.values(answers)), new Set([409]), JSON.stringify(answers));
    // `/api/config` keeps its own 404 — the sentence a person reads, with no path in it — because
    // the Config tab asks for the file by name and that file is what is missing.
    const config = await api(`${base}/api/config`);
    assert.equal(config.status, 404);
    const configBody = (await config.json()) as { error: string };
    assert.match(configBody.error, /not a tflw project yet/);
    assert.doesNotMatch(configBody.error, /ENOENT|\/(tmp|home|Users)\//);
    // And nothing above wrote anything into the directory.
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('POST /api/init creates a project by spawning tflw init, and the LOAD door gets a load test', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-init-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static') });
  try {
    const base = `http://127.0.0.1:${await ui.listen(0)}`;
    const init = (door: string) => api(`${base}/api/init`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ door }) });

    const res = await init('load');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; created: string[] };
    assert.equal(body.ok, true);
    // `created` is what is on disk afterwards, not what the child claimed (`D985`).
    assert.ok(body.created.includes('tflw.config'));
    assert.ok(body.created.includes('load.tflw'), 'the LOAD door scaffolds a load test');
    await access(join(dir, 'load.tflw'));

    // The project now reads, and the scaffolded load test is behind LOAD by derivation.
    const view = (await (await api(`${base}/api/project`)).json()) as { files: { path: string; tests: { lenses: string[] }[] }[] };
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
  // **THIS TEST SAID `scan` AND MEANT "the door without a scaffold", AND `A2-4` GAVE SCANS ONE.**
  // It went on passing, because its only negative claim was that SCANS does not get *LOAD's*
  // file — which stayed true while the sentence in its own title stopped being. `A2-6` repoints it
  // at BROWSER, which is the door that genuinely has none, and gives SCANS the positive assertion
  // that would have gone red the day the title expired.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-init-api-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static') });
  try {
    const base = `http://127.0.0.1:${await ui.listen(0)}`;
    const res = await api(`${base}/api/init`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ door: 'browser' }) });
    const body = (await res.json()) as { ok: boolean; created: string[] };
    assert.equal(body.ok, true);
    assert.ok(body.created.includes('tflw.config'));
    assert.ok(body.created.includes('example.tflw'));
    assert.ok(!body.created.includes('load.tflw'), 'BROWSER has no scaffold yet, and does not get LOAD’s');
    assert.ok(!body.created.includes('scan.tflw'), 'nor SCANS’');
  } finally {
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('POST /api/init for SCANS scaffolds the scan and the authorization it must not grant', async () => {
  // The claim `A2-4` built and left unasserted at this surface (`D1053`). `e2e.test.ts` proves the
  // CLI's own `--scan`; this proves the *door* reaches it, which is the half that had drifted —
  // the landing's own words for this door said "create a project" until `A2-6`.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-init-scan-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static') });
  try {
    const base = `http://127.0.0.1:${await ui.listen(0)}`;
    const res = await api(`${base}/api/init`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ door: 'scan' }) });
    const body = (await res.json()) as { ok: boolean; created: string[] };
    assert.equal(body.ok, true);
    // ON DISK FIRST, because that is the claim — and because the two can disagree, which is what
    // this test found. `runInit` reports "what is on disk afterwards, not what the child claimed",
    // and did it by probing a **hardcoded list of five names** written when `load.tflw` was the
    // only door-specific scaffold; `A2-4` added `scan.tflw` to the CLI and not to that list, so
    // the SCANS door wrote the file and told the page it had not.
    await access(join(dir, 'scan.tflw'));
    const config = await readFile(join(dir, 'tflw.config'), 'utf8');
    // The declaration arrives commented out — the whole of `D1053`. A scaffold writing a live
    // `authorized target` would be the page forging a permission on the author's behalf.
    assert.match(config, /^\s*#.*authorized target/m, `the declaration is written commented out:\n${config}`);
    // And then that the page is told, which is the half that was false.
    assert.ok(body.created.includes('scan.tflw'), `SCANS scaffolds its own test: ${body.created.join(', ')}`);
  } finally {
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('every file `tflw init` can create is a file the page is told about', async () => {
  // **THE DRIFT GATE `A2-6` NEEDED AND DID NOT HAVE.** `runInit` reports `created` by probing a
  // fixed list of names, and `A2-4` taught `initCommand` to write `scan.tflw` without extending
  // it — so for four commits the SCANS door wrote a scaffold and reported four files instead of
  // five. Neither side is wrong in isolation, which is why only a test that reads BOTH can see it;
  // this is `M62`'s third-surface check pointed at a second pair of surfaces.
  //
  // The CLI's own `created` array is the truth, read out of its source rather than re-listed here,
  // because a gate that restates one side is a third place to forget.
  const source = await readFile(join(here, '..', 'src', 'cli.ts'), 'utf8');
  const seed = /const created = \[([^\]]*)\]/.exec(source);
  assert.ok(seed, 'initCommand still seeds `created` with the config');
  const names = new Set<string>([
    ...[...seed[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!),
    ...[...source.matchAll(/created\.push\('([^']+)'\)/g)].map((m) => m[1]!),
  ]);

  // `.gitignore` is the one deliberate omission, and for a reason `existsSync` cannot work
  // around: `ensureGitignore` APPENDS to an existing file, so the CLI can honestly report it as
  // touched while `runInit`'s probe — which only knows whether a path exists — would report it as
  // created in every project that already had one. Named here so that omission stays a decision.
  names.delete('.gitignore');

  assert.deepEqual([...names].sort(), [...SCAFFOLDED].sort(), 'a name `tflw init` can write is missing from SCAFFOLDED (or vice versa)');
});

test('pickUrl composes what `tflw pick` needs from what an author types', () => {
  // **`tflw pick` READS NO CONFIG AND REQUIRES AN ABSOLUTE URL, by its own design** — its doc
  // comment says it "has no notion of a `web` base URL", unlike `open "/path"` inside a file,
  // which resolves against one. An author types a path, because that is what `open` takes, so
  // somebody has to close the gap; doing it server-side is `A2-3`'s shape, where the page is
  // handed a fact composed from the config the server already read.
  assert.equal(pickUrl('http://localhost:3000', '/checkout'), 'http://localhost:3000/checkout');

  // Exactly one slash, however either side was written — the commonest way a composed URL goes
  // wrong, and the one nobody notices until a 404 that looks like a routing bug.
  assert.equal(pickUrl('http://localhost:3000/', '/checkout'), 'http://localhost:3000/checkout');
  assert.equal(pickUrl('http://localhost:3000', 'checkout'), 'http://localhost:3000/checkout');
  assert.equal(pickUrl('http://localhost:3000/', 'checkout'), 'http://localhost:3000/checkout');
  assert.equal(pickUrl('http://localhost:3000', '/'), 'http://localhost:3000/');

  // An absolute URL is taken verbatim: the author pasted the whole thing, and joining it to a base
  // would produce a URL neither of them meant.
  assert.equal(pickUrl('http://localhost:3000', 'https://example.test/x'), 'https://example.test/x');

  // **`null` is a question, not a failure.** An env with no `web` base has no page to pick from —
  // and cannot run a browser test at all — so the door says so instead of spawning a browser at a
  // URL it invented.
  assert.equal(pickUrl(null, '/checkout'), null);

  // One URL and nothing else, so the page cannot ask for a session a terminal could not open.
  assert.deepEqual(pickArgv('http://localhost:3000/checkout'), ['pick', 'http://localhost:3000/checkout']);
  /* **And its sibling names a different command**, which is the one thing `/api/pick` and
     `/api/record` do not share (`M213` `S5`). One route serves both — the config read, the URL
     composition, the line framing and the `SIGINT` on disconnect are identical, and `D1106` is
     precisely the decision that what differs is *what the browser does with a click*. So the
     branch that picks the argv is the whole difference, and it is worth one line. */
  assert.deepEqual(recordArgv('http://localhost:3000/checkout'), ['record', 'http://localhost:3000/checkout']);
  assert.notDeepEqual(pickArgv('http://x/'), recordArgv('http://x/'));
});

test('GET /api/pick refuses when the env declares no `web` base, rather than opening a browser', async () => {
  // The refusal is the interesting half: this route spawns a REAL, VISIBLE browser, so the
  // condition under which it must not is worth a test of its own. `409` and a sentence naming the
  // line to add — the same shape the SCANS door uses for `authorized target`.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-pick-'));
  const ui = new UiServer({ token: TOKEN, root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static') });
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local\n  api url "http://127.0.0.1:1"\n', 'utf8');
    const base = `http://127.0.0.1:${await ui.listen(0)}`;
    const res = await api(`${base}/api/pick?path=/checkout`);
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /declares no `web` base/);
    assert.match(body.error, /web "http:\/\/localhost:3000"/, 'the refusal names the line to add');

    // And `readProject` reports the same fact the route decided on, so the door can disable the
    // control instead of offering one that always refuses.
    assert.equal((await readProject(dir)).webBaseUrl, null);
  } finally {
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('GET /api/pick streams the child’s lines, and the child dies with the connection', async () => {
  // **THE STREAM IS THE SESSION** — the property this route's shape exists for. There is no start
  // call and no stop call, so a session that is never streamed is never started and an orphan is
  // unconstructible. That matters more here than anywhere else in this server: `tflw pick` opens a
  // real, visible browser, and an orphan is a process somebody has to find and kill on a machine
  // they may be sharing.
  //
  // Driven against a STUB entry rather than the real CLI, deliberately. The real command needs a
  // human to click something before it emits a locator, and launching a browser per test run on a
  // shared box to assert a banner is a cost with no claim attached. What is being tested here is
  // this server's plumbing — spawn, line-split, SSE framing, lifetime — and the stub makes every
  // one of those observable.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-pick-live-'));
  const stub = join(dir, 'stub.mjs');
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local\n  web "http://localhost:3000"\n  api "http://127.0.0.1:1"\n', 'utf8');
    // Prints the argv it was given, then a locator, then stays alive — so the test can prove the
    // URL reached the command AND that disconnecting is what ends it.
    await writeFile(
      stub,
      [
        'import { writeFileSync } from "node:fs";',
        'process.stdout.write(`argv ${process.argv.slice(2).join(" ")}\n`);',
        'process.stdout.write(`button "Sign in"\n`);',
        // **BOUNDED, so that leaking it cannot hang anything.** The stub must outlive the assertions
        // to prove the stream is live, and must not outlive the test — otherwise a mutation that
        // drops the kill leaves a child holding piped stdio, the test file never exits, and the
        // failure the assertions correctly produce is invisible behind a hang. `A3-6` paid 180
        // seconds and a hand-killed run to learn that.
        'const alive = setInterval(() => {}, 250);',
        'setTimeout(() => { clearInterval(alive); process.exit(0); }, 3000);',
        // The stub RECORDS the signal, so the claim below can be positive: the file appearing is
        // the child having been stopped, and a leaked child never writes it.
        `process.on("SIGINT", () => { writeFileSync(${JSON.stringify(join(dir, 'stopped'))}, "1"); process.exit(0); });`,
      ].join('\n'),
      'utf8',
    );
    const ui = new UiServer({ token: TOKEN, root: dir, cliEntry: stub, execArgv: [], staticDir: join(dir, 'no-static') });
    try {
      const base = `http://127.0.0.1:${await ui.listen(0)}`;
      const controller = new AbortController();
      const res = await api(`${base}/api/pick?path=/checkout`, { signal: controller.signal });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);

      const reader = res.body!.getReader();
      let seen = '';
      while (!seen.includes('Sign in')) {
        const { value, done } = await reader.read();
        if (done) break;
        seen += new TextDecoder().decode(value);
      }
      // The composed URL reached the command, through `pickArgv`, as one argument.
      assert.match(seen, /argv pick http:\/\/localhost:3000\/checkout/);
      // …and the locator line arrives as its own SSE message, JSON-encoded so a line containing a
      // quote cannot break the framing.
      assert.match(seen, /data: "button \\"Sign in\\""/);

      // **DISCONNECTING STOPS IT, ASSERTED POSITIVELY AND WITH A DEADLINE.** The first draft
      // aborted, slept, and asserted nothing — so the mutation that leaks the child did not redden
      // this test, it **HUNG** it: the stub stayed alive holding piped stdio, the test file never
      // exited, and the mutation runner sat there until it was killed by hand. A hang is a far
      // worse signal than a failure, because it is indistinguishable from slowness and it blocks
      // everything behind it — on a shared box, the lock included.
      //
      // The stub writes a file on SIGINT, so what is asserted is the signal ARRIVING rather than
      // the absence of a symptom, and a leak fails in two seconds instead of never.
      controller.abort();
      const stopped = join(dir, 'stopped');
      const deadline = Date.now() + 2000;
      let signalled = false;
      while (Date.now() < deadline && !signalled) {
        signalled = await access(stopped).then(() => true).catch(() => false);
        if (!signalled) await new Promise((r) => setTimeout(r, 25));
      }
      assert.ok(signalled, 'closing the stream must stop the pick session — a leaked child is a browser window nobody can find');
    } finally {
      await ui.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('DELETE /api/scratch drops the file, which the project view never counted', async () => {
  // `D1054`, amended by `M205` Q15. This test was written the other way up: it asserted that a
  // scratch file **is** a file to the project view (`before + 1`) — *"which is the whole
  // finding"* — because at `A2-6` it was, and Discard's claim was that the count came back down.
  //
  // Q15 removed the premise rather than the symptom. `SCRATCH_PATH` is dot-prefixed now, and
  // `discoverTests` skips every dot-prefixed entry, so the count never goes up and there is
  // nothing for Discard to bring down. The first assertion is therefore **inverted, not
  // deleted**: the scratch is invisible to the project view with the file sitting right there,
  // which is `M205-04`'s repair stated where it can be read off one function.
  //
  // What Discard still promises is unchanged, and is the rest of this test: the file is gone,
  // another terminal's scratch is not dropped silently, and a second click is not an error about
  // a success. `readProject` is asked directly rather than through the page, so the claim holds
  // with no browser in it.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-drop-'));
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local\n  api url "http://127.0.0.1:1"\n', 'utf8');
    await writeFile(join(dir, 'kept.tflw'), 'test "kept"\n  api GET /x\n  expect status equals 200\n', 'utf8');
    const before = (await readProject(dir)).files.length;

    const scratchText = 'test "scratch"\n  api GET /y\n  expect status equals 200\n';
    await writeFile(join(dir, SCRATCH_PATH), scratchText, 'utf8');
    const withScratch = await readProject(dir);
    assert.equal(withScratch.files.length, before, 'the scratch is a file on disk and not a test in the project — `M205-04`');
    assert.equal(withScratch.scratchEtag, etagOf(scratchText), 'and the page is handed its hash, so it never has to ask for it');

    // A stale `If-Match` is refused and the file survives: dropping somebody else's run silently
    // is the one destructive surprise this route could produce.
    const stale = await dropScratch(dir, etagOf('something else entirely'));
    assert.ok('status' in stale && stale.status === 409, `a stale etag is 409: ${JSON.stringify(stale)}`);
    await access(join(dir, SCRATCH_PATH));

    const dropped = await dropScratch(dir, etagOf(scratchText));
    assert.deepEqual(dropped, { removed: true });
    await assert.rejects(() => access(join(dir, SCRATCH_PATH)), /ENOENT/);
    assert.equal((await readProject(dir)).scratchEtag, null, 'and the seed goes with it');

    // Idempotent, and absent is not a failure: Discard promises the file is not there, and it is
    // not. A `404` here would make a second click an error about a success.
    assert.deepEqual(await dropScratch(dir, null), { removed: false });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
