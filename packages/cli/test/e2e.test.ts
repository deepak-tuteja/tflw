// Backfill: every other test in this monorepo calls library functions in-process via tsx — none
// of them would catch "the built dist/ artifact is broken but the source isn't" (a tsc config
// gap, a missing dist file in package.json's `files`, an ESM resolution issue that only shows up
// post-build). This is the one minimal smoke test that runs the actual distributable: build the
// workspace, then spawn `node dist/cli.cjs run` as a real subprocess against a real HTTP server.
// Found via /grill-me, 2026-07-05.

import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_FLAGS } from '@tflw/lang';
import { ARTIFACT_CONTRACT } from '@tflw/reporter';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const cliEntry = join(repoRoot, 'packages', 'cli', 'dist', 'cli.cjs');
const execFileAsync = promisify(execFile);

before(() => {
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'pipe' });
});

/** GitHub Actions itself sets `GITHUB_ACTIONS=true` in every workflow run's own environment —
 * child processes spawned without an explicit `env` override inherit it from this test process,
 * so any test that assumes GH Actions log grouping (decision 111/M17) is *off* must explicitly
 * strip it, not just omit an override (omitting one means "inherit", which is on in CI). */
function envWithout(...keys: string[]): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of keys) delete env[k];
  return env;
}

async function withFixtureServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server: Server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

/** `/health` (200) plus a `POST /orders` (201) — used by the `tflw refactor apply` round-trip
 * test, which needs a real duplicated *API* flow (no browser/Playwright dependency). */
async function withOrdersServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server: Server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    } else if (req.url === '/orders' && req.method === 'POST') {
      res.writeHead(201, { 'content-type': 'application/json' }).end('{"id":1}');
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test('the built dist/cli.cjs runs a real test file against a real server and writes report.html', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'health.tflw'),
        `test "health check"\n  api GET /health\n  expect status equals 200\n  expect body.ok equals true\n`,
        'utf8',
      );

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir });

      assert.match(stdout, /health check/);
      assert.match(stdout, /1\/1 passed/);

      const reportPath = join(dir, 'report', 'report.html');
      await access(reportPath);
      const html = await readFile(reportPath, 'utf8');
      assert.match(html, /health check/);

      const junitPath = join(dir, 'report', 'junit.xml');
      const junit = await readFile(junitPath, 'utf8');
      assert.match(junit, /<testsuites name="tflw" tests="1" failures="0"/);
      // M65 (FS-09): the file the test came from reaches junit.xml, not just report.html — the
      // stamping happens in the CLI (`mergeReports`), so only an end-to-end run proves it survives
      // the trip. A unit test on `renderJunitXml` can only prove the renderer would use it.
      assert.match(junit, /<testsuite name="health\.tflw" tests="1" failures="0"/);
      assert.match(junit, /<testcase name="health check" classname="health\.tflw"/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// M65 (FS-09, review finding A13-01) — the end-to-end form of the property: two files each
// declaring a test with the *same name*, one passing and one failing. A CI dashboard keys
// flaky-test history off name + classname; before this, both files' tests shared one
// `<testsuite name="tflw">` and carried no classname at all, so the two were byte-identical and the
// failure landed on whichever row the dashboard happened to merge them into.
test('two files declaring a same-named test produce two suites, and the failure is attributed to exactly one of them', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-multifile-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'smoke.tflw'), `test "checkout works"\n  api GET /health\n  expect status equals 200\n`, 'utf8');
      await writeFile(join(dir, 'regression.tflw'), `test "checkout works"\n  api GET /health\n  expect status equals 999\n`, 'utf8');

      await assert.rejects(
        execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir }),
        (e: unknown) => (e as { code?: number }).code === 1,
      );

      const junit = await readFile(join(dir, 'report', 'junit.xml'), 'utf8');
      assert.match(junit, /<testsuites name="tflw" tests="2" failures="1"/);
      assert.match(junit, /<testsuite name="smoke\.tflw" tests="1" failures="0"/);
      assert.match(junit, /<testsuite name="regression\.tflw" tests="1" failures="1"/);

      const cases = [...junit.matchAll(/<testcase name="([^"]+)" classname="([^"]+)"/g)].map((m) => [m[1], m[2]]);
      assert.equal(cases.length, 2);
      assert.deepEqual(
        cases.map((c) => c[0]),
        ['checkout works', 'checkout works'],
      );
      assert.equal(new Set(cases.map((c) => c[1])).size, 2, 'same name, different file — the pair must not collapse to one identity');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('the built dist/cli.cjs exits non-zero on a failing test, and still writes the report', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-fail-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'health.tflw'),
        `test "health check"\n  api GET /health\n  expect status equals 999\n`,
        'utf8',
      );

      await assert.rejects(
        execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir }),
        (e: unknown) => (e as { code?: number }).code === 1,
      );

      await access(join(dir, 'report', 'report.html'));
      const junit = await readFile(join(dir, 'report', 'junit.xml'), 'utf8');
      assert.match(junit, /<testsuites name="tflw" tests="1" failures="1"/);
      assert.match(junit, /<failure /);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// M27, PLAN_LOG.md decision 118: a `log` step prints to the console unconditionally — regardless
// of `--verbose` and regardless of the enclosing test's pass/fail — unlike every other step kind.
test('a `log` step prints to the console without `--verbose`, on a passing test, with a level prefix', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-log-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'health.tflw'),
        `test "health check"\n  api GET /health\n  expect status equals 200\n  log warn "stock running low"\n`,
        'utf8',
      );

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir, env: envWithout('GITHUB_ACTIONS') });

      assert.match(stdout, /\[WARN\] stock running low/);

      const resultsPath = join(dir, 'report', 'results.json');
      const results = JSON.parse(await readFile(resultsPath, 'utf8')) as { tests: { steps: { kind: string; level?: string; destination?: string }[] }[] };
      const logStep = results.tests[0]!.steps.find((s) => s.kind === 'log')!;
      assert.equal(logStep.level, 'warn');
      assert.equal(logStep.destination, 'both'); // no `to …` clause, tflw.config declares no `log destination` → default
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`--log-output console` keeps a bare `log` call\'s destination out of report.html, and `--log-level` filters low-severity console output', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-log-flags-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'health.tflw'),
        `test "health check"\n  api GET /health\n  expect status equals 200\n  log debug "verbose detail"\n  log error "something bad"\n`,
        'utf8',
      );

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--no-color', '--log-output', 'console', '--log-level', 'error'], {
        cwd: dir,
        env: envWithout('GITHUB_ACTIONS'),
      });

      // `--log-level error` filters the debug-level line out of console display (never out of
      // results.json — decision 122's "renderers filter, execution never does").
      assert.doesNotMatch(stdout, /verbose detail/);
      assert.match(stdout, /\[ERROR\] something bad/);

      const html = await readFile(join(dir, 'report', 'report.html'), 'utf8');
      // Note: the embedded <style> block always defines `.kind-log`-shaped selectors regardless of
      // whether any step used them — assert on the actual `<li>` markup, not a bare substring.
      assert.doesNotMatch(html, /<li class="step ok kind-log/); // --log-output console → bare `log` calls never reach html

      const results = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as {
        tests: { steps: { kind: string; level?: string; destination?: string; detail?: string }[] }[];
      };
      const logSteps = results.tests[0]!.steps.filter((s) => s.kind === 'log');
      assert.equal(logSteps.length, 2, 'both log steps are still recorded regardless of --log-level');
      assert.deepEqual(
        logSteps.map((s) => s.destination),
        ['console', 'console'],
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// PLAN decision 86: report.html now shows every `retry` attempt's evidence, not just the final
// pass — full pipeline check (real interpreter → redact → write to disk), not just the in-memory
// RunReport already covered by packages/runtime/test/retry.test.ts.
test('`retry N` produces a report.html with the earlier failing attempt(s) visible as collapsed evidence, not just the final passed attempt', async () => {
  let calls = 0;
  const server: Server = createServer((req, res) => {
    if (req.url === '/flaky') {
      calls++;
      if (calls < 3) res.writeHead(500, { 'content-type': 'application/json' }).end('{"error":"boom"}');
      else res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-retry-evidence-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
    await writeFile(join(dir, 'flaky.tflw'), `test "eventually works" retry 2\n  api GET /flaky\n  expect status equals 200\n`, 'utf8');

    const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir });
    assert.match(stdout, /1\/1 passed/);

    const html = await readFile(join(dir, 'report', 'report.html'), 'utf8');
    assert.equal([...html.matchAll(/<details class="attempt">/g)].length, 2, 'the 2 failed prior attempts should each get a collapsed block');
    assert.match(html, /attempt 1 — failed/);
    assert.match(html, /attempt 2 — failed/);
    assert.match(html, /got 500/, "the first attempt's failing status must survive the full interpreter → redact → write pipeline");
    assert.match(html, /class="flaky"/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await rm(dir, { recursive: true, force: true });
  }
});

test('`tflw --version`/`-v` print the real package version, injected at bundle time (decision 74b)', async () => {
  const { readFile: readPkg } = await import('node:fs/promises');
  const pkg = JSON.parse(await readPkg(join(repoRoot, 'packages', 'cli', 'package.json'), 'utf8')) as { version: string };

  const { stdout: long } = await execFileAsync('node', [cliEntry, '--version']);
  assert.equal(long.trim(), pkg.version);
  const { stdout: short } = await execFileAsync('node', [cliEntry, '-v']);
  assert.equal(short.trim(), pkg.version);
});

// `tflw pick` opens a real, visible browser window (SPEC §12, M5) — genuinely launching one isn't
// CI-portable (no display server), so that path is covered headlessly by `wirePickSession`'s own
// tests in @tflw/runtime. What's testable here, against the real dist binary, is argument
// validation — every one of these returns before a browser is ever launched.

test('`tflw pick` with no url is a usage error', async () => {
  await assert.rejects(
    execFileAsync('node', [cliEntry, 'pick']),
    (e: unknown) => (e as { code?: number; stderr?: string }).code === 2 && /needs a URL/.test((e as { stderr: string }).stderr),
  );
});

test('`tflw pick <bare-path>` (no scheme) is a usage error, not a silent misinterpretation', async () => {
  await assert.rejects(
    execFileAsync('node', [cliEntry, 'pick', '/checkout']),
    (e: unknown) =>
      (e as { code?: number; stderr?: string }).code === 2 && /isn't an absolute URL/.test((e as { stderr: string }).stderr),
  );
});

test('`tflw pick <url> --browser <unknown>` is a usage error', async () => {
  await assert.rejects(
    execFileAsync('node', [cliEntry, 'pick', 'http://localhost:1', '--browser', 'bogus']),
    (e: unknown) =>
      (e as { code?: number; stderr?: string }).code === 2 && /--browser expects one of/.test((e as { stderr: string }).stderr),
  );
});

test('`tflw pick <url> <extra>` (too many positional args) is a usage error', async () => {
  await assert.rejects(
    execFileAsync('node', [cliEntry, 'pick', 'http://localhost:1', 'extra']),
    (e: unknown) =>
      (e as { code?: number; stderr?: string }).code === 2 && /unexpected argument/.test((e as { stderr: string }).stderr),
  );
});

test('`tflw --help` mentions `tflw pick`', async () => {
  const { stdout } = await execFileAsync('node', [cliEntry, '--help']);
  assert.match(stdout, /tflw pick <url>/);
});

// ---- M63 (review finding A12-04): the flag surface, and its two silent holes ----------------

test('`tflw --help` lists every flag CLI_FLAGS documents — the help text is a third surface that had drifted', async () => {
  // A12-04: `--forbid-insecure`, `--evidence`, `--log-output` and `--log-level` were implemented,
  // accepted, listed in SPEC §12, and listed in the docs-site reference table (both generate from
  // CLI_FLAGS) — and absent from `--help`. The two a user reaches for when they care about
  // credential exposure and TLS policy were the two you could only find by opening SPEC.md.
  // Same shape as M60's checker-pass drift: three surfaces claiming to describe one thing, one of
  // them assembled by hand. This test is the thing that makes forgetting the hand-written one fail.
  const { stdout } = await execFileAsync('node', [cliEntry, '--help']);
  const missing = CLI_FLAGS.filter((f) => f.command !== 'global')
    .map((f) => /`(--[a-z-]+)`/.exec(f.flag)?.[1])
    .filter((name): name is string => name !== undefined)
    .filter((name) => !stdout.includes(name));
  assert.deepEqual([...new Set(missing)], [], 'every documented flag must appear in `tflw --help`');
});

test('…and the reverse: every flag `tflw --help` shows is in CLI_FLAGS (M62)', async () => {
  // The test above checks one direction only, and the gap on the other side had four flags in it:
  // `check --env`, `check --no-color`, `init --load` and `install-browsers --browser` were all
  // accepted by the parser and printed by `--help`, but missing from CLI_FLAGS — so the docs-site
  // reference page, which *generates* its tables from that list, simply didn't have them, and
  // `reference/cli.md` carried a hand-written sentence apologising for the omission. `--load` had
  // been shipping since M29. Found by M62's docs guard, which validates every documented
  // invocation against this same registry; a one-directional check on a list is half a check.
  const { stdout } = await execFileAsync('node', [cliEntry, '--help']);
  const documented = new Set(CLI_FLAGS.flatMap((f) => [...f.flag.matchAll(/(--[a-z][a-z-]*)/g)].map((m) => m[1])));

  // Usage lines only (`  tflw check [files...] [--env <name>] …`) — the prose beneath each command
  // explains flags in sentences, where a match would be a mention rather than a declaration.
  const undocumented = new Set<string>();
  for (const line of stdout.split('\n')) {
    if (!/^\s{2}tflw /.test(line)) continue;
    for (const m of line.matchAll(/(--[a-z][a-z-]*)/g)) if (!documented.has(m[1])) undocumented.add(m[1]);
  }
  assert.deepEqual([...undocumented], [], 'every flag `--help` prints must be in CLI_FLAGS, which the reference page generates from');
});

test('a value-taking flag with no value is a usage error, not a silent fall-back to the default (M63/A12-04)', async () => {
  // The sharper half of A12-04, and the reason this is a fix and not a note: `--evidence` given no
  // value didn't complain — it fell back to `full`, the *least* protective level, and the run
  // carried on. In CI, a flag that lost its argument to a YAML fold or a quoting slip produced a
  // full-evidence artifact and a green-looking pipeline. Given a *bad* value it always validated
  // properly (`--evidence bogus` → exit 2); only the missing case failed open.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-missing-flag-value-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "http://127.0.0.1:1"\n`, 'utf8');
    await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

    // Flag last on the line — the argument simply isn't there.
    await assert.rejects(
      execFileAsync('node', [cliEntry, 'run', 'health.tflw', '--evidence'], { cwd: dir }),
      (e: unknown) => (e as { code?: number }).code === 2 && /--evidence expects a value, but none was given/.test((e as { stderr: string }).stderr),
      '`--evidence` with nothing after it must not run at `full`',
    );

    // Flag followed by another flag — the value slot silently ate `--no-color` before.
    await assert.rejects(
      execFileAsync('node', [cliEntry, 'run', '--evidence', '--no-color', 'health.tflw'], { cwd: dir }),
      (e: unknown) => (e as { code?: number }).code === 2 && /--evidence expects a value, but the next argument is `--no-color`/.test((e as { stderr: string }).stderr),
      'a flag must never be swallowed as another flag\'s value',
    );

    // The rule belongs to the flag, not to `--evidence`: every value-taking flag, every subcommand.
    for (const [args, flag] of [
      [['run', '--env'], '--env'],
      [['run', '--log-file'], '--log-file'],
      [['check', '--format'], '--format'],
      [['watch', '--seed'], '--seed'],
      [['pick', 'http://127.0.0.1:1', '--browser'], '--browser'],
    ] as const) {
      await assert.rejects(
        execFileAsync('node', [cliEntry, ...args], { cwd: dir }),
        (e: unknown) => (e as { code?: number }).code === 2 && new RegExp(`\\${flag} expects a value`).test((e as { stderr: string }).stderr),
        `${args.join(' ')} must be a usage error`,
      );
    }

    // And the escape hatch the error message names really works: `=` still takes any value.
    const { stdout } = await execFileAsync('node', [cliEntry, 'check', '--format=json', 'health.tflw'], { cwd: dir });
    assert.deepEqual(
      JSON.parse(stdout),
      [{ file: 'health.tflw', diagnostics: [] }],
      '`--flag=value` is unaffected — it never goes through the value slot',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('B6-11: a mistyped flag is a teaching diagnostic, not a raw Node ENOENT (M61)', async () => {
  // The fourth way a flag went wrong without a word, and the most ordinary one: it was simply
  // misspelled. Every `parse*Args` funnelled an unrecognised token into the *file* list, so
  // `tflw run --verbos` surfaced, several layers later, as `ENOENT: no such file or directory,
  // open '/…/--verbos'` — an absolute path to a file nobody named, in a tool whose stated pillar
  // is teaching diagnostics and which already does this properly for `tflw docs <topic>`.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-unknown-flag-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "http://127.0.0.1:1"\n`, 'utf8');
    await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

    // The rule belongs to the flag surface, not to one subcommand — including the two that were
    // *quiet* rather than noisy: `install-browsers` dropped an unknown flag on the floor and
    // downloaded Chromium at exit 0, and `init` never inspected argv beyond `includes('--load')`,
    // so `--lod` scaffolded without the file it asked for and said nothing.
    for (const args of [
      ['run', '--verbos'],
      ['run', '--verbos=1'],
      ['check', '--strict'],
      ['watch', '--strict'],
      ['migrate', '--strict'],
      ['pick', 'http://127.0.0.1:1', '--browsr', 'firefox'],
      ['install-browsers', '--browsr', 'firefox'],
      ['init', '--lod'],
    ] as const) {
      await assert.rejects(
        execFileAsync('node', [cliEntry, ...args], { cwd: dir }),
        (e: unknown) => {
          const { code, stderr } = e as { code?: number; stderr: string };
          assert.equal(code, 2, `${args.join(' ')} must exit 2\n${stderr}`);
          assert.match(stderr, /unknown flag `--[a-z-]+` for `tflw /, stderr);
          assert.doesNotMatch(stderr, /ENOENT|EISDIR/, `${args.join(' ')} must not surface a raw Node error\n${stderr}`);
          return true;
        },
        `${args.join(' ')} must be a usage error`,
      );
    }

    // The half that makes it teaching rather than merely refusing: a near miss is named, drawn
    // from CLI_FLAGS — the same registry `--help` and the docs-site reference page generate from,
    // already guarded in both directions by the two tests above, so the suggestion pool cannot
    // drift from the documented surface without one of them failing.
    await assert.rejects(
      execFileAsync('node', [cliEntry, 'run', '--verbos'], { cwd: dir }),
      (e: unknown) => /did you mean `--verbose`\?/.test((e as { stderr: string }).stderr),
      '`--verbos` must name `--verbose`',
    );
    await assert.rejects(
      execFileAsync('node', [cliEntry, 'init', '--lod'], { cwd: dir }),
      (e: unknown) => /did you mean `--load`\?/.test((e as { stderr: string }).stderr),
      '`--lod` must name `--load`',
    );

    // And nothing legitimate got caught in it: a real flag, a real file, and a `-`-prefixed *value*
    // (which `flagValue` deliberately allows) all still work.
    const { stdout } = await execFileAsync('node', [cliEntry, 'check', '--no-color', 'health.tflw'], { cwd: dir });
    assert.match(stdout, /no problems found/);
    await execFileAsync('node', [cliEntry, 'check', '--format=json', 'health.tflw'], { cwd: dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('B6-09/C15: `install-browsers` refuses, and downloads nothing, when the project has no playwright (M92b)', async () => {
  // What this replaced: `spawn('npx', ['--yes', 'playwright', 'install', browser])`. In a project
  // with no `playwright`, `--yes` suppresses npx's prompt, npx fetches an **unpinned** playwright
  // from the registry, and that ephemeral copy downloads hundreds of MB of browser builds — exit
  // **0**. Observed end-to-end while probing C15, right down to Playwright's own "you are running
  // 'npx playwright install' without first installing your project's dependencies" wall. The user
  // ends up with a green install command and a browser test that still fails, because
  // `loadPlaywright()` resolves against *their* project, which still has none.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-no-playwright-'));
  const npmCache = await mkdtemp(join(tmpdir(), 'tflw-e2e-npm-cache-'));
  try {
    // A bare directory under the OS temp root: nothing above it carries a `node_modules`, so the
    // consumer-side resolution genuinely fails here rather than finding this repo's own copy.
    await assert.rejects(
      execFileAsync('node', [cliEntry, 'install-browsers'], {
        cwd: dir,
        // Redirecting npm's cache is what makes the *downloads nothing* half checkable rather than
        // merely asserted: a regression that reinstates `npx --yes` populates this directory.
        env: { ...process.env, npm_config_cache: npmCache },
      }),
      (e: unknown) => {
        const { code, stderr } = e as { code?: number; stderr: string };
        assert.equal(code, 2, `install-browsers without the peer must be a usage error, not a success\n${stderr}`);
        assert.match(stderr, /`playwright` isn't installed in this project/, stderr);
        assert.match(stderr, /npm install -D playwright/, 'the refusal must say how to fix it');
        return true;
      },
      'install-browsers must refuse when the optional peer is absent',
    );
    assert.deepEqual(await readdir(npmCache), [], 'nothing may be fetched from the registry — refusing is the point, and `npx --yes` is what made this directory fill up');
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(npmCache, { recursive: true, force: true });
  }
});

test('FU-04: `tflw init` then `tflw run` is green in an empty directory — the README’s own claim (M118)', async () => {
  // The row, verbatim: "the README quickstart is annotated 'green in seconds' and is red out of the
  // box". Measured on `main` at `964ae5b`: `FAIL 0/1 passed, 1 failed`, because the scaffold pointed
  // at `http://localhost:3001` and nothing listens there in a fresh directory.
  //
  // Driven through the built `dist/cli.cjs` in a temp dir on purpose: this row is a claim about what
  // a stranger sees typing two commands, and an in-process unit test cannot see that.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-quickstart-'));
  try {
    await execFileAsync('node', [cliEntry, 'init'], { cwd: dir });
    const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir });
    assert.match(stdout, /PASS 1\/1 passed/, `the quickstart must be green out of the box\n${stdout}`);
    // D202 — and it must never look like it proved something about a real system.
    assert.match(stdout, /demo: this run targeted tflw's built-in demo service/, stdout);
    const report = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as { demo?: boolean; ok: boolean };
    assert.equal(report.ok, true);
    assert.equal(report.demo, true, 'the flag has to reach the report, not only the terminal');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('FU-04: the demo service dies with the run that started it (M118, D203)', async () => {
  // What this proves is the `disconnect` half (`demo-service.ts`): the child's IPC channel is its
  // lifetime, so a demo cannot survive a crash, a `kill -9`, or any exit path that never reaches a
  // `finally`. It deliberately does **not** prove the teardown is called — after the CLI exits both
  // mechanisms give the same closed port, and `demo-outlives-the-run` survived the sweep saying so.
  // The explicit `stop()` is covered where it is the only thing standing between a run and a leak:
  // `watch.test.ts`, where the CLI process outlives the run.
  //
  // The port is read back out of the report rather than guessed: it is ephemeral by design (D200),
  // so this is the only place it is knowable.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-demo-lifetime-'));
  try {
    await execFileAsync('node', [cliEntry, 'init'], { cwd: dir });
    await execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir });
    const results = await readFile(join(dir, 'report', 'results.json'), 'utf8');
    const port = /127\.0\.0\.1:(\d+)/.exec(results)?.[1];
    assert.ok(port, `the run should have talked to a concrete loopback port\n${results.slice(0, 400)}`);
    await assert.rejects(
      fetch(`http://127.0.0.1:${port}/health`),
      'the demo port must be closed once the run that opened it has exited',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('FU-04: every forked load shard reaches the parent’s demo, not one of its own (M118, D200)', async () => {
  // Found by running it, not by reading it: `tflw run load.tflw --workers 2` against the freshly
  // scaffolded config came out at **exactly 50% failures** — the main process's own shard-0 was
  // perfect and the forked shard failed every iteration. `loadWorkerCommand` re-runs
  // `loadAndValidate` itself (M31/D19 — no AST is ever serialized), so it read `tflw://demo` straight
  // off disk and resolved a URL the runtime refuses. The address now travels in the start message.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-demo-shards-'));
  try {
    await execFileAsync('node', [cliEntry, 'init'], { cwd: dir });
    await writeFile(
      join(dir, 'load.tflw'),
      `test "health under load"\n  ramp to 10 rps over 1s\n  api GET /health\n  expect status equals 200\n  threshold error rate is less than 1%\n`,
      'utf8',
    );
    const { stdout } = await execFileAsync('node', [cliEntry, 'run', 'load.tflw', '--workers', '2', '--no-color'], { cwd: dir });
    assert.match(stdout, /PASS 1\/1 passed/, stdout);
    assert.match(stdout, /error rate < 1\.00% \(actual: 0\.00%\)/, `a shard that cannot reach the demo shows up here as a partial error rate\n${stdout}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('FU-04: `tflw check` accepts `tflw://demo` without executing anything (M118, D203)', async () => {
  // `check` does no I/O by contract (P#75) — the reason it runs in CI with no secrets and no live
  // API — so it must not start a server for a config that names one. The reserved URL also must not
  // be a checker error: the scaffold every new project starts from carries it.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-demo-check-'));
  try {
    await execFileAsync('node', [cliEntry, 'init'], { cwd: dir });
    const { stdout } = await execFileAsync('node', [cliEntry, 'check', '--no-color'], { cwd: dir });
    assert.doesNotMatch(stdout, /error/i, stdout);
    await assert.rejects(access(join(dir, 'report')), 'check must not have run anything, so there is no report');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * A project whose `playwright` is a stub: a real `node_modules/playwright/package.json` with a real
 * `bin`, pointing at a script that prints what Playwright prints and exits with `exitCode`.
 *
 * Stubbed rather than real on purpose. `FU-03` is entirely about the sentences tflw wraps around
 * the download — testing it against the genuine article would mean a 150 MB fetch per case, a
 * network dependency in a unit suite, and no way at all to exercise the failure path without
 * breaking someone's DNS.
 */
async function withStubPlaywright<T>(
  exitCode: number,
  fn: (dir: string) => Promise<T>,
  { version = '1.62.0' }: { version?: string } = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-stub-pw-'));
  try {
    const pkgDir = join(dir, 'node_modules', 'playwright');
    await mkdir(pkgDir, { recursive: true });
    await writeFile(join(pkgDir, 'package.json'), JSON.stringify({ name: 'playwright', version, bin: { playwright: 'cli.js' } }), 'utf8');
    await writeFile(
      join(pkgDir, 'cli.js'),
      exitCode === 0
        ? `process.stdout.write('chromium 1234 is already installed.\\n')\n`
        : `process.stderr.write('Error: connect ECONNREFUSED 127.0.0.1:9\\n    at TCPConnectWrap.afterConnect\\n')\nprocess.exit(${exitCode})\n`,
      'utf8',
    );
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('FU-03: a successful `install-browsers` says so, and names the playwright it installed for (M118)', async () => {
  // Measured on `main` at `964ae5b`, with the binary already present: exit 0, **0 bytes on stdout
  // and 0 bytes on stderr**. The row filed it as "no success message"; it was no message at all,
  // which is indistinguishable from a no-op, a silent hang, or a command that does not exist.
  await withStubPlaywright(0, async (dir) => {
    const { stdout } = await execFileAsync('node', [cliEntry, 'install-browsers'], { cwd: dir });
    assert.notEqual(stdout.trim(), '', 'a command that did real work must not exit in silence');
    assert.match(stdout, /chromium is ready/, stdout);
    // The version is the point of the line, not decoration: it is the proof that the browser landed
    // in *this project's* playwright, which is the exact confusion `B6-09`/M92b existed to end.
    assert.match(stdout, /playwright 1\.62\.0 in this project/, stdout);
    assert.match(stdout, /next:/, 'the success path owes a next step, the way `tflw init` does');
  });
});

test('FU-03: a failed download gets a tflw sentence beside Playwright’s stack dump, and exit 2 (M118)', async () => {
  await withStubPlaywright(1, async (dir) => {
    await assert.rejects(
      execFileAsync('node', [cliEntry, 'install-browsers', '--browser', 'webkit'], { cwd: dir }),
      (e: unknown) => {
        const { code, stderr } = e as { code?: number; stderr: string };
        // D205 — not `1`. `EXIT_FAIL` means "a test failed", and nothing here was tested.
        assert.equal(code, 2, `a failed download is "could not run", not a test failure\n${stderr}`);
        assert.match(stderr, /could not download the webkit browser binary/, stderr);
        assert.match(stderr, /exited 1/, 'the child’s own exit code is part of the diagnosis');
        // Playwright's raw output is *kept*, not swallowed: it is the only place the real cause
        // (here, a refused connection) is ever stated.
        assert.match(stderr, /ECONNREFUSED/, 'Playwright’s own error must still reach the user');
        assert.match(stderr, /PLAYWRIGHT_DOWNLOAD_HOST/, 'the causes named must be the actionable ones');
        return true;
      },
    );
  });
});

test('B6-11/C5: a positional argument that is not a readable .tflw file is a teaching diagnostic too (M82)', async () => {
  // M61 closed the `--`-prefixed half of every parser's fall-through branch and left the other
  // half exactly as it was: an unexamined push into the file list, `readFile`d layers later. So the
  // three ordinary ways a *path* goes wrong all still surfaced as raw Node errors — and the
  // directory one (`EISDIR: illegal operation on a directory, read`) does not even name the
  // directory it is complaining about.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-file-arg-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "http://127.0.0.1:1"\n`, 'utf8');
    await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');
    await mkdir(join(dir, 'legacy'), { recursive: true });
    await writeFile(join(dir, 'legacy', 'old.tflw'), `test "old"\n  api GET /old\n  expect status equals 200\n`, 'utf8');

    // One rule, one place — `run`, `check`, `migrate` and `watch` all reach their file list through
    // `loadAndValidate`, so all four are checked here rather than only the one that was reported.
    for (const command of ['run', 'check', 'migrate', 'watch'] as const) {
      await assert.rejects(
        execFileAsync('node', [cliEntry, command, 'nosuch.tflw'], { cwd: dir }),
        (e: unknown) => {
          const { code, stderr } = e as { code?: number; stderr: string };
          assert.equal(code, 2, `${command} nosuch.tflw must exit 2\n${stderr}`);
          assert.match(stderr, /no test file `nosuch\.tflw`/, stderr);
          assert.doesNotMatch(stderr, /ENOENT|EISDIR/, `${command} must not surface a raw Node error\n${stderr}`);
          return true;
        },
        `${command} nosuch.tflw must be a usage error`,
      );

      await assert.rejects(
        execFileAsync('node', [cliEntry, command, 'legacy'], { cwd: dir }),
        (e: unknown) => {
          const { code, stderr } = e as { code?: number; stderr: string };
          assert.equal(code, 2, `${command} legacy must exit 2\n${stderr}`);
          // The refusal has to name the directory — the raw `EISDIR` it replaces did not, which is
          // what made it unactionable — and name a file inside it, so it is one copy-paste from
          // what the user meant.
          assert.match(stderr, /`legacy` is a directory/, stderr);
          assert.match(stderr, /legacy\/old\.tflw/, stderr);
          assert.doesNotMatch(stderr, /ENOENT|EISDIR/, `${command} must not surface a raw Node error\n${stderr}`);
          return true;
        },
        `${command} legacy must be a usage error`,
      );
    }

    // The current directory is still a directory, and it was the one case the listing got wrong:
    // `relative(cwd, resolve(cwd, '.'))` is `''`, so the old prefix filter tested `startsWith('/')`
    // against cwd-relative paths and matched nothing — `tflw check .` claimed "no `.tflw` files were
    // found under it" in a directory holding two. Asserted on `check` alone: that all four commands
    // share this one rule is already proven by the loop above.
    await assert.rejects(
      execFileAsync('node', [cliEntry, 'check', '.'], { cwd: dir }),
      (e: unknown) => {
        const { code, stderr } = e as { code?: number; stderr: string };
        assert.equal(code, 2, `check . must exit 2\n${stderr}`);
        assert.match(stderr, /`\.` is a directory/, stderr);
        assert.doesNotMatch(stderr, /no `\.tflw` files were found under it/, `the refusal must not deny files that are right there\n${stderr}`);
        assert.match(stderr, /health\.tflw/, stderr);
        return true;
      },
      'check . must be a usage error',
    );

    // Negative control for the assertion above: the "none found" arm is still reachable, and still
    // the right thing to say, for a directory that genuinely holds no tests. Without this, deleting
    // the arm outright would pass.
    await mkdir(join(dir, 'empty'), { recursive: true });
    await assert.rejects(
      execFileAsync('node', [cliEntry, 'check', 'empty'], { cwd: dir }),
      (e: unknown) => {
        const { code, stderr } = e as { code?: number; stderr: string };
        assert.equal(code, 2, `check empty must exit 2\n${stderr}`);
        assert.match(stderr, /no `\.tflw` files were found under it/, stderr);
        return true;
      },
      'check empty must be a usage error',
    );

    // `tflw run tflw.config` used to parse the config as a test file and report every line of it as
    // a grammar error — a wall of diagnostics blaming the user's syntax for their argument.
    await assert.rejects(
      execFileAsync('node', [cliEntry, 'run', 'tflw.config'], { cwd: dir }),
      (e: unknown) => {
        const { code, stderr } = e as { code?: number; stderr: string };
        assert.equal(code, 2, stderr);
        assert.match(stderr, /`tflw\.config` is not a `\.tflw` test file/, stderr);
        assert.doesNotMatch(stderr, /allowed at the top level/, `must not report the config as bad grammar\n${stderr}`);
        return true;
      },
      '`run tflw.config` must be a usage error',
    );

    // The teaching half, drawn from real discovery rather than a fixed list: the nearest thing that
    // actually exists in *this* project is named.
    await assert.rejects(
      execFileAsync('node', [cliEntry, 'run', 'health.tflww'], { cwd: dir }),
      (e: unknown) => /did you mean `health\.tflw`\?/.test((e as { stderr: string }).stderr),
      '`health.tflww` must name `health.tflw`',
    );

    // Nothing legitimate caught in it: the file that does exist still runs, and bare discovery —
    // which never goes through this check — still finds both files.
    await execFileAsync('node', [cliEntry, 'check', '--no-color', 'health.tflw'], { cwd: dir });
    const { stdout } = await execFileAsync('node', [cliEntry, 'check', '--no-color'], { cwd: dir });
    assert.match(stdout, /2 files checked/, stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a directory refusal lists the files inside an `exclude`d directory too', async () => {
  // The other half of the same false negative: the listing used to be filtered out of the *bare
  // discovery* walk, which honours `exclude` (D127), so naming an excluded directory was told there
  // were no `.tflw` files under it. Exclusion scopes the no-args sweep and nothing else — an
  // explicit file arg inside an excluded path still runs (see `discoverTests`) — so those files are
  // precisely the ones the refusal should be naming.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-file-arg-excluded-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "http://127.0.0.1:1"\nexclude "vendor"\n`, 'utf8');
    await mkdir(join(dir, 'vendor'), { recursive: true });
    await writeFile(join(dir, 'vendor', 'third-party.tflw'), `test "third party"\n  api GET /x\n  expect status equals 200\n`, 'utf8');

    await assert.rejects(
      execFileAsync('node', [cliEntry, 'check', 'vendor'], { cwd: dir }),
      (e: unknown) => {
        const { code, stderr } = e as { code?: number; stderr: string };
        assert.equal(code, 2, `check vendor must exit 2\n${stderr}`);
        assert.match(stderr, /vendor\/third-party\.tflw/, stderr);
        assert.doesNotMatch(stderr, /no `\.tflw` files were found under it/, stderr);
        return true;
      },
      'check vendor must be a usage error',
    );

    // And the file it names does run when named, which is what makes naming it useful advice.
    const { stdout } = await execFileAsync('node', [cliEntry, 'check', '--no-color', 'vendor/third-party.tflw'], { cwd: dir });
    assert.match(stdout, /1 file checked/, stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('B6-02: `tflw watch <bad path>` refuses before watching, instead of crashing with a Node stack trace (M82)', async () => {
  // The sharpest shape in cluster C5, and one nobody filed: `runOne`'s promise chain has no
  // `.catch`, so `loadAndValidate`'s `readFile` rejection escaped as an **unhandled rejection**.
  // Node printed `node:internal/fs/promises:636` and a stack trace naming `dist/cli.cjs` internals,
  // then killed the process — `tflw watch health.tflww` died during its first run, having never
  // watched anything and never printed the line that says it is watching.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-watch-badpath-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "http://127.0.0.1:1"\n`, 'utf8');
    await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

    await assert.rejects(
      execFileAsync('node', [cliEntry, 'watch', 'health.tflww'], { cwd: dir }),
      (e: unknown) => {
        const { code, stdout, stderr } = e as { code?: number; stdout: string; stderr: string };
        assert.equal(code, 2, `must be a usage error, not a crash\n${stderr}`);
        assert.match(stderr, /did you mean `health\.tflw`\?/, stderr);
        // The crash signature, and the reason this is a *watch* finding rather than a duplicate of
        // the one above: an unhandled rejection prints a bare stack trace with no `error:` prefix.
        assert.doesNotMatch(stderr, /node:internal|at async/, `must not print a raw stack trace\n${stderr}`);
        // And it must refuse *before* claiming to watch — `[watch] watching for changes` printed
        // over a predicate no saved file can satisfy is `B6-02`'s companion line.
        assert.doesNotMatch(stdout, /watching for changes/, `must not claim to be watching\n${stdout}`);
        return true;
      },
      '`watch health.tflww` must exit 2 rather than crash',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('B6-01: an empty `--tag`/`--only` is a usage error, not a silent run of the whole suite (M70)', async () => {
  // The third way a value goes missing, after M63 closed the two above: present and empty. Both
  // filters were read for truthiness downstream, so `""` meant "no filter" — a *narrowing* flag
  // silently widened to every test in the repository, including every workload-bearing one,
  // against whatever env was active, at exit 0. `--tag nope` errors; `--tag ""` ran everything.
  //
  // The shape that produces it is `tflw run --tag "$SUITE_TAGS"` with the variable unset, which is
  // why the M63 test's own loop never caught it: these are values a shell interpolates, not values
  // a person types. So this test constructs them the way a shell would — both spellings.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-empty-filter-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "http://127.0.0.1:1"\n`, 'utf8');
    await writeFile(join(dir, 'suite.tflw'), `@smoke\ntest "one"\n  log "one ran"\n\ntest "two"\n  log "two ran"\n`, 'utf8');

    const run = (extra: string[]) =>
      execFileAsync('node', [cliEntry, 'run', 'suite.tflw', '--no-color', '--no-timestamps', ...extra], { cwd: dir });

    // The positive controls, so this test fails if filtering itself breaks rather than only if the
    // guard fires: unfiltered runs both, a real tag runs one, a real name runs one.
    assert.match((await run([])).stdout, /2\/2 passed/);
    assert.match((await run(['--tag=smoke'])).stdout, /1\/1 passed/);
    assert.match((await run(['--only=one'])).stdout, /1\/1 passed/);

    for (const [extra, pattern, why] of [
      [['--tag='], /--tag was given an empty value/, '`--tag=` (an unset shell variable, `=` spelling)'],
      [['--tag', ''], /--tag was given an empty value/, '`--tag ""` (an unset shell variable, space spelling)'],
      [['--tag=,,'], /--tag was given `,,`, which names no tags/, 'a value that is all separators still names no tags'],
      [['--tag= , '], /--tag was given ` , `, which names no tags/, 'whitespace between separators does not make a tag'],
      [['--only='], /--only was given an empty value/, '`--only=` selects no test, so it must not select every test'],
      [['--only', ''], /--only was given an empty value/, '`--only ""` (space spelling)'],
    ] as const) {
      await assert.rejects(
        run([...extra]),
        (e: unknown) =>
          (e as { code?: number }).code === 2 &&
          pattern.test((e as { stderr: string }).stderr) &&
          !/passed/.test((e as { stdout: string }).stdout),
        `${why} must be exit 2 with nothing run`,
      );
    }

    // Unchanged: a filter that is well-formed but matches nothing is still the error it always was
    // — P#46's invariant, which the empty case used to invert.
    await assert.rejects(
      run(['--tag=nope']),
      (e: unknown) => (e as { code?: number }).code === 2 && /no test anywhere carries the tag `nope`/.test((e as { stderr: string }).stderr),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- tflw refactor apply <id> (M6, P#2) ------------------------------------

test('`tflw refactor apply` with no subcommand/id is a usage error', async () => {
  await assert.rejects(
    execFileAsync('node', [cliEntry, 'refactor']),
    (e: unknown) => (e as { code?: number; stderr?: string }).code === 2 && /usage: tflw refactor apply <id>/.test((e as { stderr: string }).stderr),
  );
});

test('`tflw refactor apply <unknown-id>` is a clear usage error, not a crash', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-refactor-badid-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "http://127.0.0.1:1"\n`, 'utf8');
    await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');
    await assert.rejects(
      execFileAsync('node', [cliEntry, 'refactor', 'apply', 'RF999'], { cwd: dir }),
      (e: unknown) => (e as { code?: number; stderr?: string }).code === 2 && /no reuse hint `RF999` found/.test((e as { stderr: string }).stderr),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- M97c (`PLAN_M97_CHECKER_CONTRACT.md`) — `A4-07` / `B5-02` halves 2-3 -------------------

test('`tflw check` reports a referenced file that is not there (TF043, D144/`A4-07`)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-tf043-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "http://127.0.0.1:1"\n`, 'utf8');
    await writeFile(join(dir, 'gone.tflw'), `import "./nowhere.tflw"\n\ntest "t"\n  api GET /health\n  expect status equals 200\n`, 'utf8');
    // Control: the same suite with the import satisfied must check clean, or this test would pass
    // against a checker that rejects everything.
    await writeFile(join(dir, 'ok.tflw'), `test "t"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

    const clean = await execFileAsync('node', [cliEntry, 'check', 'ok.tflw', '--no-color'], { cwd: dir });
    assert.match(clean.stdout, /1 file checked, no problems found/);

    await assert.rejects(
      execFileAsync('node', [cliEntry, 'check', 'gone.tflw', '--no-color'], { cwd: dir }),
      (e: unknown) => {
        const err = e as { code?: number; stderr?: string };
        // Before M97c this printed `1 file checked, no problems found.` at exit 0, and `tflw run`
        // then printed `✗ gone.tflw (crashed) (0 ms)` and nothing else, `--verbose` included.
        return err.code === 2 && /error\[TF043\]: `import` names a file that does not exist: "\.\/nowhere\.tflw"/.test(err.stderr ?? '');
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('`tflw check` warns, at exit 0, for a file only a step opens (TF043 run tier, M97e/D147)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-tf043-warn-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "http://127.0.0.1:1"\n`, 'utf8');
    // The shape testFlow-tests hit: a path that is statically known and does not exist *yet*,
    // because the run creates it. M97c made this suite unrunnable with no override — `check` and
    // `run` both call `loadAndValidate`, which returns EXIT_USAGE on any error-severity diagnostic.
    await writeFile(join(dir, 'later.tflw'), `test "t"\n  api GET /health\n  expect body bytes matches file "./written-during-the-run.bin"\n`, 'utf8');

    const { stdout, stderr } = await execFileAsync('node', [cliEntry, 'check', 'later.tflw', '--no-color'], { cwd: dir });
    // Exit 0 is the fix. The warning being *printed* is the other half — a diagnostic downgraded to
    // silence would trade one defect for another, and this is the first time any shipped diagnostic
    // has taken the CLI's `warnings.length > 0` branch at all, so it is proven here rather than
    // assumed. It was written in M2.5 and had never once executed.
    assert.match(stderr, /warning\[TF043\]: `matches file` names a file that does not exist: "\.\/written-during-the-run\.bin"/);
    assert.match(stderr, /a warning, not an error, because this file is opened during the run/);
    // And the summary line has to agree with the diagnostic above it. Making the warning branch
    // reachable for the first time also made this line reachable in a state it got wrong: it is
    // written from `parsedFiles.length` alone, so it printed `no problems found` to stdout with a
    // `warning[TF043]` on stderr one line up.
    assert.match(stdout, /1 file checked, 1 warning\./);
    assert.doesNotMatch(stdout, /no problems found/);

    // Control 1: the same command on a clean file prints no warning at all — otherwise the match
    // above could be satisfied by a checker that warns unconditionally.
    await writeFile(join(dir, 'clean.tflw'), `test "t"\n  api GET /health\n  expect status equals 200\n`, 'utf8');
    const clean = await execFileAsync('node', [cliEntry, 'check', 'clean.tflw', '--no-color'], { cwd: dir });
    assert.doesNotMatch(clean.stderr, /TF043/);

    // Control 2 — the one that makes this test load-bearing. The *check* tier of the same rule,
    // in the same command, must still exit 2. Without it, deleting the pass outright would pass
    // every assertion above (no error, and `assert.match` on stderr would simply be dropped along
    // with the diagnostic). A negative control that cannot fail is a passing test of nothing.
    await writeFile(join(dir, 'imports.tflw'), `import "./nowhere.tflw"\n\ntest "t"\n  api GET /health\n  expect status equals 200\n`, 'utf8');
    await assert.rejects(
      execFileAsync('node', [cliEntry, 'check', 'imports.tflw', '--no-color'], { cwd: dir }),
      (e: unknown) => {
        const err = e as { code?: number; stderr?: string };
        return err.code === 2 && /error\[TF043\]/.test(err.stderr ?? '');
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('`tflw refactor apply` refuses a rewrite that would not check, and writes nothing (`B5-02` half 3)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-refactor-refuse-'));
  try {
    // The collision arrives through a file `detectReuse` never scans — `exclude` keeps it out of
    // discovery — so half 2's name seeding structurally cannot see it. That is the point: half 3 is
    // the backstop for the channel nobody has enumerated, and a control that half 2 already covers
    // would prove nothing about it (`B5-01` was an S1 for exactly that reason).
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "http://127.0.0.1:1"\n\nexclude "external"\n`, 'utf8');
    await mkdir(join(dir, 'external'), { recursive: true });
    await mkdir(join(dir, 'tests'), { recursive: true });
    await writeFile(join(dir, 'external', 'actions.tflw'), `action post orders()\n  api GET /health\n  expect status equals 200\n`, 'utf8');
    await writeFile(
      join(dir, 'tests', 'dup.tflw'),
      `import "../external/actions.tflw"

test "one"
  api POST /orders body { name: "a" }
  expect status equals 201
  api GET /orders
  expect status equals 200
  post orders()

test "two"
  api POST /orders body { name: "a" }
  expect status equals 201
  api GET /orders
  expect status equals 200
  post orders()
`,
      'utf8',
    );

    // Control: the hint is offered, so the refusal below is the re-check firing and not an absent
    // hint or a usage error.
    const { stdout } = await execFileAsync('node', [cliEntry, 'check', '--no-color'], { cwd: dir });
    assert.match(stdout, /proposed: action post orders\(\)/);

    const before = await readFile(join(dir, 'tests', 'dup.tflw'), 'utf8');
    await assert.rejects(
      execFileAsync('node', [cliEntry, 'refactor', 'apply', 'RF001'], { cwd: dir }),
      (e: unknown) => {
        const err = e as { code?: number; stderr?: string };
        return (
          err.code === 2 &&
          /error\[TF035\]: duplicate action "post orders"/.test(err.stderr ?? '') &&
          /applying this hint would leave a suite that does not check, so nothing was written/.test(err.stderr ?? '')
        );
      },
    );

    // Nothing written: not the extraction, not the rewritten call sites. Before M97c this exited 0,
    // created `shared/post-orders.tflw`, and left a suite `tflw check` rejected at exit 2.
    await assert.rejects(access(join(dir, 'shared', 'post-orders.tflw')), 'the extracted action file must not exist');
    assert.equal(await readFile(join(dir, 'tests', 'dup.tflw'), 'utf8'), before, 'the occurrence file must be byte-identical');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('`tflw --help` mentions `tflw refactor apply`', async () => {
  const { stdout } = await execFileAsync('node', [cliEntry, '--help']);
  assert.match(stdout, /tflw refactor apply <id>/);
});

test('`tflw refactor apply` extracts a real duplicated API flow, and the rewritten suite still runs green (M6, P#2)', async () => {
  await withOrdersServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-refactor-apply-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'orders.tflw'),
        `test "create widget order"
  api POST /orders body { name: "Widget", qty: 3 }
  expect status equals 201
  api GET /health
  expect status equals 200

test "create gadget order"
  api POST /orders body { name: "Gadget", qty: 3 }
  expect status equals 201
  api GET /health
  expect status equals 200
`,
        'utf8',
      );

      const { stdout: checkBefore } = await execFileAsync('node', [cliEntry, 'check', '--no-color'], { cwd: dir });
      assert.match(checkBefore, /reuse\[RF001\]/);

      const { stdout: applyOut } = await execFileAsync('node', [cliEntry, 'refactor', 'apply', 'RF001'], { cwd: dir });
      assert.match(applyOut, /applied RF001: extracted `action post orders\(name\)` into shared\/post-orders\.tflw/);
      assert.match(applyOut, /updated: orders\.tflw/);

      const sharedSource = await readFile(join(dir, 'shared', 'post-orders.tflw'), 'utf8');
      assert.match(sharedSource, /^action post orders\(name\)$/m);
      assert.match(sharedSource, /api POST \/orders body \{ name: \{name\}, qty: 3 \}/);
      assert.match(sharedSource, /expect status equals 201/);
      assert.match(sharedSource, /api GET \/health/);
      assert.match(sharedSource, /expect status equals 200/);

      const rewritten = await readFile(join(dir, 'orders.tflw'), 'utf8');
      assert.match(rewritten, /^import ".\/shared\/post-orders\.tflw"/m);
      assert.match(rewritten, /post orders\("Widget"\)/);
      assert.match(rewritten, /post orders\("Gadget"\)/);
      // the extraction removed the duplication — a second `tflw check` must find no more hints,
      // and the rewritten file must still be checker-clean (a real syntax/semantics smoke test of
      // the splice itself, not just a string match).
      const { stdout: checkAfter } = await execFileAsync('node', [cliEntry, 'check', '--no-color'], { cwd: dir });
      assert.match(checkAfter, /2 files checked, no problems found\./); // orders.tflw + the new shared/post-orders.tflw
      assert.doesNotMatch(checkAfter, /reuse hint/);

      const { stdout: runOut } = await execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir });
      assert.match(runOut, /2\/2 passed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---- tflw migrate (P#38, decision 45's 1.0-gate deliverable) ---------------

test('`tflw --help` mentions `tflw migrate`', async () => {
  const { stdout } = await execFileAsync('node', [cliEntry, '--help']);
  assert.match(stdout, /tflw migrate \[files/);
});

test('`tflw migrate` against a real, checker-clean suite reports nothing to migrate and touches no files (no deprecation exists in the grammar yet, decision 45)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-migrate-clean-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      const testSource = `test "health check"\n  api GET /health\n  expect status equals 200\n`;
      await writeFile(join(dir, 'health.tflw'), testSource, 'utf8');

      const { stdout } = await execFileAsync('node', [cliEntry, 'migrate', '--no-color'], { cwd: dir });
      assert.match(stdout, /no deprecated syntax found — nothing to migrate\./);

      // Genuinely untouched — not just "reported clean" while quietly rewriting the file.
      const after = await readFile(join(dir, 'health.tflw'), 'utf8');
      assert.equal(after, testSource);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('B5-11: `tflw migrate` on a file with an ordinary checker error says what is wrong instead of nothing at all (M90a)', async () => {
  // The defect this milestone exists for: `migrateCommand` returned on `loadAndValidate`'s error
  // path — before the splice loop, before any output — so *any* checker error, not just removed
  // syntax, produced zero bytes on stdout, zero on stderr, and exit 2. On a clean file migrate
  // explained itself; on a broken one, the only kind it exists for, it said nothing.
  //
  // The typo below is deliberately not a deprecation: migrate has no rewrite for it, which is the
  // case that used to be silent. What it must do is behave like `tflw check` — render the
  // diagnostics — and then say why it did not rewrite anything.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-migrate-b5-11-'));
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local default\n  api "http://127.0.0.1:1"\n', 'utf8');
    const source = 'test "t"\n  api GET /x\n  expct status equals 200\n';
    await writeFile(join(dir, 'd.tflw'), source, 'utf8');

    await assert.rejects(
      execFileAsync('node', [cliEntry, 'migrate', '--no-color'], { cwd: dir }),
      (e: unknown) => {
        const { code, stdout, stderr } = e as { code?: number; stdout: string; stderr: string };
        assert.equal(code, 2, 'errors remain, so the exit code stays 2');
        // The whole finding in one assertion: it is no longer silent on either stream.
        assert.notEqual(stdout.length + stderr.length, 0, 'migrate must not exit 2 with zero bytes of output');
        assert.match(stderr, /unknown step `expct`/, `the diagnostic \`check\` would print:\n${stderr}`);
        assert.match(stderr, /did you mean `expect`\?/, stderr);
        assert.match(stdout, /not deprecations, so migrate has no rewrite for them/, stdout);
        return true;
      },
    );

    assert.equal(await readFile(join(dir, 'd.tflw'), 'utf8'), source, 'and it rewrote nothing while saying so');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('B5-12: `tflw migrate --format` is an unknown flag, not a silently ignored one (M90a, D-M90-8)', async () => {
  // It was accepted, ignored, *and* unvalidated: `--format xml` exited 0 having done nothing with
  // the flag, while `check --format xml` rejects it. `CLI_FLAGS` never listed `--format` under
  // `migrate`, so `--help` and the docs-site reference already agreed — only the parser did not.
  //
  // The negative half matters as much as the positive one: `B5-12` exists because nobody checked
  // that the flag was *rejected* rather than merely absent. Both spellings, and `check` must keep
  // its own (different) rejection.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-migrate-format-'));
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local default\n  api "http://127.0.0.1:1"\n', 'utf8');
    await writeFile(join(dir, 'a.tflw'), 'test "t"\n  api GET /x\n  expect status equals 200\n', 'utf8');

    for (const args of [
      ['migrate', '--format', 'xml'],
      ['migrate', '--format=json'],
    ] as const) {
      await assert.rejects(
        execFileAsync('node', [cliEntry, ...args], { cwd: dir }),
        (e: unknown) => {
          const { code, stderr } = e as { code?: number; stderr: string };
          assert.equal(code, 2, `${args.join(' ')} must exit 2\n${stderr}`);
          assert.match(stderr, /unknown flag `--format` for `tflw migrate`/, stderr);
          return true;
        },
        `${args.join(' ')} must be a usage error`,
      );
    }

    // `check` keeps `--format`, and keeps rejecting a bad *value* — a different error from a
    // different place. Guards against "fixing" this by deleting the flag from both.
    await assert.rejects(
      execFileAsync('node', [cliEntry, 'check', '--format', 'xml'], { cwd: dir }),
      (e: unknown) => {
        const { stderr } = e as { stderr: string };
        assert.match(stderr, /unknown --format `xml` — only `json` is supported/, stderr);
        return true;
      },
    );
    const { stdout } = await execFileAsync('node', [cliEntry, 'check', '--format', 'json'], { cwd: dir });
    assert.match(stdout, /"file"/, `check --format json still works:\n${stdout}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('B5-05, code half: `tflw migrate` now rewrites the removed keyword a user would actually reach for (M90b)', async () => {
  // This test used to assert the opposite, and its own comment said why: "`think` → `pause` is a
  // real, mechanical, one-word rename … it is exactly what someone would reach for this command to
  // do. It cannot … This test pins that — including that the file is left alone — so wiring the two
  // together has to move the `--help` text, `CLI_FLAGS` and SPEC §12 with it." It did exactly that
  // job: M90b flipped the behaviour and this was the first thing to fail.
  //
  // The obstacle was never the splice engine — it was that `deprecation` was documented as
  // "present only on a `severity: 'warning'` diagnostic" while all four pre-1.0 removals went
  // straight to hard errors, so no rule could set it without un-removing the keyword (D-M90-0).
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-migrate-removed-kw-'));
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local default\n  api "http://127.0.0.1:1"\n', 'utf8');
    const source =
      'test "burst"\n  ramp to 1 users over 1s\n  threshold p95 duration is less than 1s\n  threshold error rate is less than 1%\n  think 2s\n  api GET /x\n';
    await writeFile(join(dir, 'old.tflw'), source, 'utf8');

    const { stdout } = await execFileAsync('node', [cliEntry, 'migrate', '--no-color'], { cwd: dir });
    assert.match(stdout, /migrated 1 file/, stdout);
    assert.match(stdout, /the rewritten suite checks clean\./, stdout);

    const after = await readFile(join(dir, 'old.tflw'), 'utf8');
    assert.equal(after, source.replace('think 2s', 'pause 2s'), 'exactly one token moved, nothing else');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('migrate keeps going until nothing is left: a `think` hidden inside a `scenario` block is rewritten in the same run (M90b)', async () => {
  // PLAN_M90_MIGRATION.md §3.1 predicted one pass would always be enough — "recovery is not a
  // problem … `recoverTopLevel()` resyncs cleanly. One migrate pass sees every occurrence; no
  // fixpoint loop." A probe disproved it: `recoverTopLevel()` skips the *entire* offending block,
  // so a `think` inside a `scenario` is invisible to the parser until `scenario` itself is fixed.
  // One pass rewrote `scenario`→`test`, exited 2, and pointed at a `think` it had not been able to
  // see — honest, and still a tool that does half its job and tells you to run it again.
  //
  // Termination is structural: every edit replaces a removed keyword with a live one, the supply
  // per file is finite, and no replacement is itself removed syntax.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-migrate-nested-'));
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local default\n  api "http://127.0.0.1:1"\n', 'utf8');
    const source =
      'scenario "burst"\n  ramp to 10 users over 5s\n  threshold p95 duration is less than 1s\n  threshold error rate is less than 1%\n  think 2s\n  api GET /x\n';
    await writeFile(join(dir, 'old.tflw'), source, 'utf8');

    const { stdout } = await execFileAsync('node', [cliEntry, 'migrate', '--no-color'], { cwd: dir });
    assert.match(stdout, /migrated 1 file/, stdout);
    assert.match(stdout, /the rewritten suite checks clean\./, `both rewrites, one run:\n${stdout}`);

    const after = await readFile(join(dir, 'old.tflw'), 'utf8');
    assert.match(after, /^test "burst"$/m, '`scenario` became `test`');
    assert.match(after, /^ {2}pause 2s$/m, 'and the `think` it was hiding became `pause`');
    assert.doesNotMatch(after, /scenario|think/, after);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('A3-01: the `scenario` diagnostic names the one-word rename, not a brace form the parser rejects (M90b, D-M90-5)', async () => {
  // The row: "the `scenario` migration diagnostic tells the user to write syntax the parser
  // rejects". It said ``write `test "…" { ramp to … }` instead`` — a `TF010` in an
  // indentation-based language, confirmed live. Worse, the `ramp to …` line it instructed the user
  // to add is *already in their file*: the old `parseScenarioDecl` made a workload line mandatory.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-a3-01-'));
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local default\n  api "http://127.0.0.1:1"\n', 'utf8');
    await writeFile(join(dir, 'old.tflw'), 'scenario "burst"\n  ramp to 10 users over 5s\n  api GET /x\n', 'utf8');

    await assert.rejects(
      execFileAsync('node', [cliEntry, 'check', '--no-color'], { cwd: dir }),
      (e: unknown) => {
        const { stderr } = e as { stderr: string };
        assert.match(stderr, /`scenario` was removed — write `test` instead/, stderr);
        assert.doesNotMatch(stderr, /\{ ramp to/, 'the brace form is a parse error and must not be advised');
        assert.match(stderr, /= fix: run `tflw migrate` to apply this automatically/, `and the offer is derived from the payload:\n${stderr}`);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('--tag matching zero tests anywhere is a hard usage error, not a silent green CI (P#46)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-tag-zero-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "untagged"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      await assert.rejects(
        execFileAsync('node', [cliEntry, 'run', '--tag', 'nope', '--no-color'], { cwd: dir }),
        (e: unknown) => (e as { code?: number }).code === 2,
      );
      await assert.rejects(access(join(dir, 'report', 'report.html')));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('--seed with a non-numeric value is a usage error, not a silent NaN→0 coercion (P#46)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-seed-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "ok"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      await assert.rejects(
        execFileAsync('node', [cliEntry, 'run', '--seed', 'abc', '--no-color'], { cwd: dir }),
        (e: unknown) => (e as { code?: number }).code === 2,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('--now with an unparseable date/time is a usage error (decision 52)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-now-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "ok"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      await assert.rejects(
        execFileAsync('node', [cliEntry, 'run', '--now', 'not-a-date', '--no-color'], { cwd: dir }),
        (e: unknown) => (e as { code?: number }).code === 2,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('--now stamps the exact run-clock instant on report.html, junit.xml, and the CLI summary (decision 52)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-now-stamp-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'dates.tflw'),
        `test "dates"\n  let d = format today as "yyyy-MM-dd"\n  api GET /health\n  expect status equals 200\n`,
        'utf8',
      );

      const iso = '2026-05-04T00:00:00.000Z';
      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--now', iso, '--no-color'], { cwd: dir });
      assert.match(stdout, new RegExp(`now ${iso}`));

      const html = await readFile(join(dir, 'report', 'report.html'), 'utf8');
      assert.match(html, new RegExp(iso));

      const junit = await readFile(join(dir, 'report', 'junit.xml'), 'utf8');
      assert.match(junit, new RegExp(`<property name="now" value="${iso}"/>`));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Phase 2b: `--parallel` is `--workers`'s pre-Phase-2b in-process file-concurrency flag, renamed
// (D111/D113) once `--workers` was repurposed for load-generation process forking.
test('--parallel with a non-positive-integer value is a usage error', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-workers-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "ok"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      await assert.rejects(
        execFileAsync('node', [cliEntry, 'run', '--parallel', '0', '--no-color'], { cwd: dir }),
        (e: unknown) => (e as { code?: number }).code === 2,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('a parse error in one file never lets another file execute (validate all before running any, P#46)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-validate-all-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'a-broken.tflw'), `test "broken"\n  expct status equals 200\n`, 'utf8');
      await writeFile(join(dir, 'b-fine.tflw'), `test "would run"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      await assert.rejects(
        execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir }),
        (e: unknown) => (e as { code?: number }).code === 2,
      );
      await assert.rejects(access(join(dir, 'report', 'report.html')), 'no report should be written — nothing ran');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('a runtime crash in one file still writes a report covering every file that ran (P#46)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-crash-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      // A crash that is still a *runtime* one after M97c: the helper is present and unloadable,
      // rather than an `import` of a file that isn't there — `TF043` now catches the latter at
      // check time, so it would never reach a run and this test would assert nothing. Same
      // `buildRegistry` phase either way.
      await writeFile(join(dir, 'broken-helper.ts'), 'export function boom() {}\nthis is not valid typescript(((\n', 'utf8');
      await writeFile(join(dir, 'a-crashes.tflw'), `use "./broken-helper.ts"\ntest "never runs"\n  api GET /health\n`, 'utf8');
      await writeFile(join(dir, 'b-fine.tflw'), `test "runs fine"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      await assert.rejects(
        execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir }),
        (e: unknown) => (e as { code?: number }).code === 1,
      );

      const html = await readFile(join(dir, 'report', 'report.html'), 'utf8');
      assert.match(html, /runs fine/);
      assert.match(html, /crashed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('random values are stable under --seed regardless of --parallel concurrency (P#47)', async () => {
  async function runOnce(workers: number): Promise<string[]> {
    return withFixtureServer(async (baseUrl) => {
      const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-seed-workers-'));
      try {
        await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
        for (const n of ['a', 'b', 'c']) {
          await writeFile(join(dir, `${n}.tflw`), `test "${n}"\n  let v = random number 1 to 1000000\n  api GET /health\n  expect status equals 200\n`, 'utf8');
        }
        await execFileAsync('node', [cliEntry, 'run', '--seed', '42', '--parallel', String(workers), '--no-color'], { cwd: dir });
        const html = await readFile(join(dir, 'report', 'report.html'), 'utf8');
        return [...html.matchAll(/v = (\d+) \(random\)/g)].map((m) => m[1]!);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }

  const sequential = await runOnce(1);
  const parallel = await runOnce(3);
  assert.equal(sequential.length, 3);
  assert.deepEqual(parallel, sequential, 'the same --seed must reproduce identical per-test random values in the same order regardless of --workers');
});

// M91b (review finding `OBS-03`, `D-M91-4`). This test was titled `… redacted in the report
// (P#42)` and asserted only `1/1 passed` plus `/reads orders/` in the HTML — never that anything
// was masked. It is the direct reason `FU-01`, this review's worst finding, was invisible to a
// green suite: anyone auditing coverage by test name concluded redaction was covered.
//
// Probing it found the title was false about the *product* too, not merely about the test. With
// this fixture the token appears **7 times in plaintext** in `report.html` — login response body,
// capture detail, session header detail, outgoing `Authorization` header, `/orders` response body,
// and the `expect` step's code line and detail. And that is correct: value-based redaction (SPEC
// §3.4) masks what entered via `env(...)`, this token entered via a `capture` from a response
// body, and the fixture declares no `redact`. Nothing was ever supposed to be masked here — so
// adding the "missing" assertion to *this* fixture would have failed.
//
// Hence two tests, one claim each. This one keeps the claim it actually proves; the one below
// declares `redact body.token` and proves the other.
/** The session fixture both tests below run against — one `session admin` that logs in and pins an
 * `Authorization` header, and two tests that use it. `logins` counts how many times `/auth/login`
 * was actually hit, which is how "runs once" stops being a claim and becomes an assertion. */
async function startSessionFixture(): Promise<{ readonly baseUrl: string; logins(): number; close(): Promise<void> }> {
  let logins = 0;
  const server: Server = createServer((req, res) => {
    if (req.url === '/auth/login' && req.method === 'POST') {
      logins++;
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"token":"secret-tok"}');
    } else if (req.url === '/orders') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ auth: req.headers['authorization'] ?? null }));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    logins: () => logins,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}

const sessionConfig = (baseUrl: string, extraEnvLines: readonly string[] = []): string =>
  [
    `env local default`,
    `  api "${baseUrl}"`,
    ...extraEnvLines,
    ``,
    `session admin`,
    `  api POST /auth/login body { user: "a", pass: "b" }`,
    `  capture body.token as token`,
    `  header "Authorization" is "Bearer {token}"`,
    ``,
  ].join('\n');

test('a `session` block in tflw.config runs once and its header applies to `as <session>` tests (P#42)', async () => {
  const fixture = await startSessionFixture();
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-session-'));
  try {
    await writeFile(join(dir, 'tflw.config'), sessionConfig(fixture.baseUrl), 'utf8');
    // Two tests, both `as admin`: "runs **once**" is the half of this title that a single-test
    // fixture left unproved — one test cannot distinguish once from per-test (M91b, `OBS-03`).
    await writeFile(
      join(dir, 'orders.tflw'),
      [
        `test "reads orders" as admin`,
        `  api GET /orders`,
        `  expect status equals 200`,
        `  expect body.auth equals "Bearer secret-tok"`,
        ``,
        `test "reads orders again" as admin`,
        `  api GET /orders`,
        `  expect body.auth equals "Bearer secret-tok"`,
        ``,
      ].join('\n'),
      'utf8',
    );

    const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir });
    assert.match(stdout, /2\/2 passed/);
    assert.equal(fixture.logins(), 1, 'the session block must establish once for the whole run, not once per test');

    const html = await readFile(join(dir, 'report', 'report.html'), 'utf8');
    assert.match(html, /reads orders/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await fixture.close();
  }
});

test('a `redact`-covered `capture` in a `session` block masks that value everywhere in report.html (P#42, FS-03)', async () => {
  // The claim `OBS-03`'s title made and its body never checked. `redact body.token` is what makes
  // the session's captured token a secret (SPEC §3.4 — a `capture` whose subject is a covered
  // position registers its value with the taint redactor); from there the value-based pass masks
  // it wherever it flows, including the literal a test author wrote into their own `expect` line.
  //
  // Both halves are asserted deliberately. Absence alone would pass on an empty file, and presence
  // alone would pass on a report that masked one occurrence and leaked six.
  const fixture = await startSessionFixture();
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-session-redact-'));
  try {
    await writeFile(join(dir, 'tflw.config'), sessionConfig(fixture.baseUrl, ['  redact body.token']), 'utf8');
    await writeFile(
      join(dir, 'orders.tflw'),
      [
        `test "reads orders" as admin`,
        `  api GET /orders`,
        `  expect status equals 200`,
        `  expect body.auth equals "Bearer secret-tok"`,
        ``,
      ].join('\n'),
      'utf8',
    );

    const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir });
    assert.match(stdout, /1\/1 passed/);

    const html = await readFile(join(dir, 'report', 'report.html'), 'utf8');
    assert.doesNotMatch(html, /secret-tok/, 'the session token must not appear in report.html in plaintext');
    assert.match(html, /•••\(token\)/, 'and its masked form must appear where it was');
  } finally {
    await rm(dir, { recursive: true, force: true });
    await fixture.close();
  }
});

test('a session\'s generated values and step-splice target are stable under --parallel concurrency (decision 53)', async () => {
  // Three files each run one test `as auth`; the session itself generates a value. Before decision
  // 53's fix, both the session's generated value (seeded from whichever racing test's rng won) and
  // which test's report shows the session's steps depended on a `--workers N>1` race. Run at
  // workers 1 and workers 3 and assert both are identical.
  async function runOnce(workers: number): Promise<{ token: string; ownerTest: string }> {
    return withFixtureServer(async (baseUrl) => {
      const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-session-workers-'));
      try {
        await writeFile(
          join(dir, 'tflw.config'),
          [`env local default`, `  api "${baseUrl}"`, ``, `session auth`, `  let token = random like "TOK-####"`, `  header "Authorization" is "Bearer {token}"`, ``].join(
            '\n',
          ),
          'utf8',
        );
        for (const n of ['a', 'b', 'c']) {
          await writeFile(join(dir, `${n}.tflw`), `test "${n} reads health" as auth\n  api GET /health\n  expect status equals 200\n`, 'utf8');
        }
        await execFileAsync('node', [cliEntry, 'run', '--seed', '42', '--parallel', String(workers), '--no-color'], { cwd: dir });
        const html = await readFile(join(dir, 'report', 'report.html'), 'utf8');

        // `token = &quot;TOK-####&quot;` is the session's own `let` step detail — it renders only in
        // whichever test's report the session's steps were spliced into (the "owner"). The
        // session's *header* value (`Authorization: Bearer TOK-####`) legitimately appears in
        // every `as auth` test's request trace, so that substring alone can't distinguish the
        // owner from the other two tests — the `let` step detail can.
        const tokenPattern = /token = &quot;(TOK-\d{4})&quot; \(random\)/g;
        const [token] = [...html.matchAll(tokenPattern)].map((m) => m[1]!);
        if (!token) throw new Error(`no generated token found in report:\n${html}`);

        const sections = [...html.matchAll(/<section class="test[^"]*"[^>]*>[\s\S]*?<\/section>/g)].map((m) => m[0]);
        const ownerSections = sections.filter((s) => /token = &quot;TOK-\d{4}&quot; \(random\)/.test(s));
        assert.equal(ownerSections.length, 1, `expected exactly one test to show the session's own \`let\` step, got ${ownerSections.length}`);
        const nameMatch = /<h2>.*?<\/span>([^<]+?)(?:\s*<span class="flaky">)? <span class="tms">/.exec(ownerSections[0]!);
        if (!nameMatch) throw new Error(`could not extract owner test name from section:\n${ownerSections[0]}`);
        return { token, ownerTest: nameMatch[1]! };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }

  const sequential = await runOnce(1);
  const parallel = await runOnce(3);
  assert.equal(parallel.token, sequential.token, 'the same --seed must reproduce the session\'s generated value regardless of --parallel concurrency');
  assert.equal(parallel.ownerTest, sequential.ownerTest, 'the same test must own the session\'s step-splice regardless of --parallel concurrency');
});

test('per-session splice-owner determinism (decision 53) extends to a test opting into several sessions at once (gap #7)', async () => {
  // Three files, two sessions, overlapping opt-ins: `a` opts into only `auth1`; `b` opts into
  // *both*; `c` opts into only `auth2`. Splice-owner is resolved per session *name*, independent
  // of which other names a test also opts into — smallest global index wins for each name
  // separately, so `auth1`'s owner should be `a` (indices 0 and 1 opt in; 0 wins) and `auth2`'s
  // owner should be `b` (indices 1 and 2 opt in; 1 wins), regardless of `--workers` concurrency.
  async function runOnce(workers: number): Promise<{ auth1Owner: string; auth2Owner: string }> {
    return withFixtureServer(async (baseUrl) => {
      const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-multi-session-workers-'));
      try {
        await writeFile(
          join(dir, 'tflw.config'),
          [
            `env local default`,
            `  api "${baseUrl}"`,
            ``,
            `session auth1`,
            `  let token1 = random like "ONE-####"`,
            `  header "X-Auth1" is "{token1}"`,
            ``,
            `session auth2`,
            `  let token2 = random like "TWO-####"`,
            `  header "X-Auth2" is "{token2}"`,
            ``,
          ].join('\n'),
          'utf8',
        );
        await writeFile(join(dir, 'a.tflw'), `test "a" as auth1\n  api GET /health\n  expect status equals 200\n`, 'utf8');
        await writeFile(join(dir, 'b.tflw'), `test "b" as auth1, auth2\n  api GET /health\n  expect status equals 200\n`, 'utf8');
        await writeFile(join(dir, 'c.tflw'), `test "c" as auth2\n  api GET /health\n  expect status equals 200\n`, 'utf8');
        await execFileAsync('node', [cliEntry, 'run', '--seed', '42', '--parallel', String(workers), '--no-color'], { cwd: dir });
        const html = await readFile(join(dir, 'report', 'report.html'), 'utf8');

        const sections = [...html.matchAll(/<section class="test[^"]*"[^>]*>[\s\S]*?<\/section>/g)].map((m) => m[0]);
        const nameOf = (section: string): string => {
          const m = /<h2>.*?<\/span>([^<]+?)(?:\s*<span class="flaky">)? <span class="tms">/.exec(section);
          if (!m) throw new Error(`could not extract test name from section:\n${section}`);
          return m[1]!;
        };
        const auth1Owners = sections.filter((s) => /token1 = &quot;ONE-\d{4}&quot; \(random\)/.test(s));
        const auth2Owners = sections.filter((s) => /token2 = &quot;TWO-\d{4}&quot; \(random\)/.test(s));
        assert.equal(auth1Owners.length, 1, `expected exactly one test to show auth1's own \`let\` step, got ${auth1Owners.length}`);
        assert.equal(auth2Owners.length, 1, `expected exactly one test to show auth2's own \`let\` step, got ${auth2Owners.length}`);
        return { auth1Owner: nameOf(auth1Owners[0]!), auth2Owner: nameOf(auth2Owners[0]!) };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }

  const sequential = await runOnce(1);
  const parallel = await runOnce(3);
  assert.equal(sequential.auth1Owner, 'a', 'auth1\'s smallest-global-index opt-in is test a');
  assert.equal(sequential.auth2Owner, 'b', 'auth2\'s smallest-global-index opt-in is test b, not c');
  assert.equal(parallel.auth1Owner, sequential.auth1Owner, 'auth1\'s owner must not depend on --parallel concurrency');
  assert.equal(parallel.auth2Owner, sequential.auth2Owner, 'auth2\'s owner must not depend on --parallel concurrency');
});

test('a typo\'d `{var}` is a checker error at parse time, exit 2, with a did-you-mean hint (decision 57)', async () => {
  // Before decision 57, a typo'd variable reference surfaced only as a runtime error the moment
  // the request actually fired — this proves it's now a compile-time squiggle instead, matching
  // SPEC §1's "diagnostics are a feature" pillar.
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-unknown-var-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'orders.tflw'),
        `test "typo'd capture reference"\n  api POST /health body { name: "Widget" }\n  capture body.ok as orderId\n  api GET /orders/{orderid}\n  expect status equals 200\n`,
        'utf8',
      );

      await assert.rejects(
        execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir }),
        (e: unknown) => {
          const { code, stderr } = e as { code?: number; stderr?: string };
          return code === 2 && /unknown variable "orderid"/.test(stderr ?? '') && /error\[TF030\]/.test(stderr ?? '');
        },
      );
      await assert.rejects(access(join(dir, 'report', 'report.html')), 'a checker error must abort before anything runs, like any other parse-time diagnostic');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('an unknown `as <session>` is a checker error at parse time, exit 2, before anything runs', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-session-unknown-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'orders.tflw'), `test "reads orders" as ghost\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      await assert.rejects(
        execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir }),
        (e: unknown) => (e as { code?: number; stderr?: string }).code === 2 && /unknown session "ghost"/.test((e as { stderr?: string }).stderr ?? ''),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('a typo\'d service name inside a `session` block is a checker error at parse time, exit 2 (decision 66)', async () => {
  // Before decision 66, `checkServices` only walked test/action/hook bodies — a typo'd service
  // name inside `session admin` was invisible until the session actually executed at runtime.
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-session-service-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n  api billing "${baseUrl}"\n\nsession admin\n  api billng POST /auth/login\n`, 'utf8');
      await writeFile(join(dir, 'orders.tflw'), `test "reads orders" as admin\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      await assert.rejects(
        execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir }),
        (e: unknown) => {
          const { code, stderr } = e as { code?: number; stderr?: string };
          return code === 2 && /unknown api service "billng"/.test(stderr ?? '') && /did you mean `billing`/.test(stderr ?? '');
        },
      );
      await assert.rejects(access(join(dir, 'report', 'report.html')), 'a checker error must abort before anything runs');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('a JS helper using a TS-only runtime construct (enum) fails with a teaching error under the built CLI (no tsx loader, P#43)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-helper-enum-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'helpers.ts'),
        `export enum Status { Active, Inactive }\nexport function status(): Status {\n  return Status.Active;\n}\n`,
        'utf8',
      );
      await writeFile(join(dir, 'uses-enum.tflw'), `use "./helpers.ts"\n\ntest "calls a helper that uses an enum"\n  let x = status()\n`, 'utf8');

      await assert.rejects(execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir }));
      // The `use`d module loads eagerly while building the file's call registry (before any test
      // step runs), so the teaching error surfaces as a synthetic "crashed" test entry rather than
      // a failed step — check the report, not stdout (cli-summary only prints failed *steps*).
      const html = await readFile(join(dir, 'report', 'report.html'), 'utf8');
      assert.match(html, /native type stripping/);
      assert.match(html, /enum/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('--tag filters to only the tagged tests across a file', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-tag-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'health.tflw'),
        [
          '@smoke',
          'test "tagged health check"',
          '  api GET /health',
          '  expect status equals 200',
          '',
          'test "untagged check"',
          '  api GET /health',
          '  expect status equals 200',
          '',
        ].join('\n'),
        'utf8',
      );

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--tag', 'smoke', '--no-color'], { cwd: dir });

      assert.match(stdout, /tagged health check/);
      assert.doesNotMatch(stdout, /untagged check/);
      assert.match(stdout, /1\/1 passed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('--tag a,b runs a test carrying any of the listed tags (OR composition, decision 97)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-tag-or-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'health.tflw'),
        [
          '@smoke',
          'test "smoke test"',
          '  api GET /health',
          '  expect status equals 200',
          '',
          '@critical',
          'test "critical test"',
          '  api GET /health',
          '  expect status equals 200',
          '',
          'test "neither"',
          '  api GET /health',
          '  expect status equals 200',
          '',
        ].join('\n'),
        'utf8',
      );

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--tag', 'smoke,critical', '--no-color'], { cwd: dir });

      assert.match(stdout, /smoke test/);
      assert.match(stdout, /critical test/);
      assert.doesNotMatch(stdout, /"neither"/);
      assert.match(stdout, /2\/2 passed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('--tag list tolerates whitespace around commas (" a, b ")', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-tag-or-ws-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'health.tflw'),
        ['@smoke', 'test "smoke test"', '  api GET /health', '  expect status equals 200', ''].join('\n'),
        'utf8',
      );

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--tag', ' smoke , critical ', '--no-color'], { cwd: dir });

      assert.match(stdout, /1\/1 passed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('--tag OR-list still combines with --only as AND', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-tag-only-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'health.tflw'),
        [
          '@smoke',
          'test "first"',
          '  api GET /health',
          '  expect status equals 200',
          '',
          '@smoke',
          'test "second"',
          '  api GET /health',
          '  expect status equals 200',
          '',
        ].join('\n'),
        'utf8',
      );

      const { stdout } = await execFileAsync(
        'node',
        [cliEntry, 'run', '--tag', 'smoke,critical', '--only', 'second', '--no-color'],
        { cwd: dir },
      );

      assert.doesNotMatch(stdout, /"first"/);
      assert.match(stdout, /second/);
      assert.match(stdout, /1\/1 passed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('--tag matching zero tests anywhere reports every listed tag in the error (OR-list)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-tag-or-zero-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "untagged"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      await assert.rejects(
        execFileAsync('node', [cliEntry, 'run', '--tag', 'nope,alsonope', '--no-color'], { cwd: dir }),
        (e: unknown) => (e as { code?: number; stderr?: string }).code === 2 && /nope/.test((e as { stderr?: string }).stderr ?? '') && /alsonope/.test((e as { stderr?: string }).stderr ?? ''),
      );
      await assert.rejects(access(join(dir, 'report', 'report.html')));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`tflw check` passes clean files with no execution and no HTTP traffic (decision 75)', async () => {
  let hits = 0;
  const server: Server = createServer((_req, res) => {
    hits++;
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-check-clean-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
    await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

    const { stdout } = await execFileAsync('node', [cliEntry, 'check', '--no-color'], { cwd: dir });
    assert.match(stdout, /1 file checked, no problems found\./);
    assert.doesNotMatch(stdout, /reuse hint/, 'a single test with nothing duplicated must never print a reuse section');
    assert.equal(hits, 0, '`tflw check` must never make an HTTP request — it only parses and validates');
    await assert.rejects(access(join(dir, 'report', 'report.html')), '`tflw check` must not write a report — it never executes anything');
  } finally {
    await rm(dir, { recursive: true, force: true });
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('`tflw check` also surfaces reuse-pass hints (M6, P#2) — advisory, exit 0 regardless', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-check-reuse-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "http://127.0.0.1:1"\n  web "http://127.0.0.1:1"\n`, 'utf8');
    await writeFile(
      join(dir, 'checkout.tflw'),
      `test "checkout as alice"
  open "/login"
  fill field "Username" with "alice"
  fill field "Password" with "secret1"
  click button "Log In"
  expect button "Sign out" is visible

test "checkout as bob"
  open "/login"
  fill field "Username" with "bob"
  fill field "Password" with "secret2"
  click button "Log In"
  expect button "Sign out" is visible
`,
      'utf8',
    );

    const { stdout } = await execFileAsync('node', [cliEntry, 'check', '--no-color'], { cwd: dir });
    assert.match(stdout, /1 file checked, no problems found\./);
    assert.match(stdout, /1 reuse hint found \(P#2\) — apply with `tflw refactor apply <id>`:/);
    assert.match(stdout, /reuse\[RF001\]: 2 occurrences of a similar 5-step sequence/);
    // M27 (PLAN_LOG.md): "log" is now a real statement keyword, so the reuse pass's own generic
    // keyword-collision guard (reuse.ts:615-634) prefixes the generated action name with "the" —
    // exactly the same defense that already covers "open"/"close"-prefixed names, working as
    // designed, not a regression.
    assert.match(stdout, /proposed: action the log in\(username, password\) in shared\/the-log-in\.tflw/);
    assert.match(stdout, /apply: tflw refactor apply RF001/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('`tflw check` exits 2 with a teaching diagnostic on a broken file, and touches no server (decision 75)', async () => {
  let hits = 0;
  const server: Server = createServer((_req, res) => {
    hits++;
    res.writeHead(200).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-check-broken-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
    await writeFile(join(dir, 'broken.tflw'), `test "broken"\n  expct status equals 200\n`, 'utf8');

    await assert.rejects(
      execFileAsync('node', [cliEntry, 'check', '--no-color'], { cwd: dir }),
      (e: unknown) => {
        const { code, stderr } = e as { code?: number; stderr?: string };
        return code === 2 && /did you mean `expect`/.test(stderr ?? '');
      },
    );
    assert.equal(hits, 0, '`tflw check` must never make an HTTP request, even to find out a file is broken');
  } finally {
    await rm(dir, { recursive: true, force: true });
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('`tflw check` never requires secrets to be set — it validates, it doesn\'t execute (decision 75)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-check-no-secrets-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "http://localhost:1"\n\nrequire env ADMIN_TOKEN\n`, 'utf8');
    await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

    // `tflw run` would fail here (ADMIN_TOKEN unset) — `tflw check` must not.
    const { stdout } = await execFileAsync('node', [cliEntry, 'check', '--no-color'], { cwd: dir });
    assert.match(stdout, /1 file checked, no problems found\./);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function withSelfSignedHttpsServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const certDir = await mkdtemp(join(tmpdir(), 'tflw-e2e-tls-'));
  const keyPath = join(certDir, 'key.pem');
  const certPath = join(certDir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', keyPath, '-out', certPath, '-days', '1', '-nodes', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });

  const server = createHttpsServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  try {
    return await fn(`https://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await rm(certDir, { recursive: true, force: true });
  }
}

test('`insecure true` in tflw.config lets `tflw run` pass against a self-signed cert, with a visible warning (decision 78)', async () => {
  await withSelfSignedHttpsServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-insecure-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n  insecure true\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir });
      assert.match(stdout, /1\/1 passed/);
      assert.match(stdout, /insecure: true/);
      assert.match(stdout, /TLS certificate verification was disabled/);

      const html = await readFile(join(dir, 'report', 'report.html'), 'utf8');
      assert.match(html, /insecure-warning/);
      assert.match(html, /TLS certificate verification was disabled/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('without `insecure true`, the same self-signed cert fails `tflw run` with a teaching hint and no warning (decision 78)', async () => {
  await withSelfSignedHttpsServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-insecure-off-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      await assert.rejects(
        execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir }),
        (e: unknown) => {
          const { code, stdout } = e as { code?: number; stdout?: string };
          return code === 1 && /self-signed or private-CA certificate/.test(stdout ?? '') && !/insecure: true/.test(stdout ?? '');
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// PLAN decision 101b (enterprise arc cluster 2, Safety/redaction): `--forbid-insecure` is a CI
// policy gate — fail before any test runs, not partway through, if `insecure true` is active for
// the env actually running.
test('`--forbid-insecure` refuses to run when `insecure true` is active, before any test runs', async () => {
  await withSelfSignedHttpsServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-forbid-insecure-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n  insecure true\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      await assert.rejects(
        execFileAsync('node', [cliEntry, 'run', '--forbid-insecure', '--no-color'], { cwd: dir }),
        (e: unknown) => {
          const { code, stderr } = e as { code?: number; stderr?: string };
          return code === 2 && /forbid-insecure/.test(stderr ?? '') && /insecure true/.test(stderr ?? '');
        },
      );
      await assert.rejects(access(join(dir, 'report', 'report.html')), 'nothing should have run at all');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`--forbid-insecure` has no effect when `insecure` is not active', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-forbid-insecure-noop-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--forbid-insecure', '--no-color'], { cwd: dir });
      assert.match(stdout, /1\/1 passed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// PLAN decision 101c: `evidence`/`--evidence` trims the report-only trace; `--evidence` overrides
// `tflw.config`'s `evidence` key for one run. Full pipeline check (real interpreter → redact →
// write to disk), not just the in-memory RunReport already covered by
// packages/runtime/test/evidence-level.test.ts.
test('`--evidence headers-only` drops response bodies from report.html but the test still passes', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-evidence-headers-only-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--evidence', 'headers-only', '--no-color'], { cwd: dir });
      assert.match(stdout, /1\/1 passed/);

      const html = await readFile(join(dir, 'report', 'report.html'), 'utf8');
      assert.doesNotMatch(html, /"ok":true/, 'the fixture server\'s JSON body must not appear in the report');
      assert.match(html, /omitted by evidence level/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`--evidence` with an unsupported value is a usage error, not silently ignored', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-evidence-badvalue-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "http://localhost:1"\n`, 'utf8');
    await assert.rejects(
      execFileAsync('node', [cliEntry, 'run', '--evidence', 'verbose', '--no-color'], { cwd: dir }),
      (e: unknown) => (e as { code?: number }).code === 2,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('`tflw init` appends only the missing line(s) to an existing `.gitignore`, never duplicating (decision 82)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-init-gitignore-'));
  try {
    await writeFile(join(dir, '.gitignore'), 'node_modules/\n.env\n', 'utf8');

    const { stdout } = await execFileAsync('node', [cliEntry, 'init'], { cwd: dir });
    assert.match(stdout, /created tflw\.config, example\.tflw, \.env\.example, package\.json, \.gitignore/);

    const gitignore = await readFile(join(dir, '.gitignore'), 'utf8');
    assert.equal(gitignore.match(/^\.env$/gm)?.length, 1, '.env must not be duplicated');
    assert.match(gitignore, /^report\/$/m);
    assert.match(gitignore, /^node_modules\/$/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// M125b2 (`FU-15`, D259) — the other half of the typeless-module warning. The runtime restates it
// in one tflw sentence when it happens; this stops it happening at all for a project started with
// `tflw init`, which before now scaffolded no `package.json` and so left Node guessing the module
// type at the first `use "./x.ts"`.
test('`tflw init` scaffolds a `package.json` with `"type": "module"`, and never touches one that exists (M125b2, FU-15)', async () => {
  const fresh = await mkdtemp(join(tmpdir(), 'tflw-e2e-init-pkg-'));
  try {
    await execFileAsync('node', [cliEntry, 'init'], { cwd: fresh });
    const pkg = JSON.parse(await readFile(join(fresh, 'package.json'), 'utf8'));
    assert.equal(pkg.type, 'module');
    assert.equal(pkg.private, true, 'a scaffolded test project is not something to publish by accident');
  } finally {
    await rm(fresh, { recursive: true, force: true });
  }

  // A `package.json` the user already has is theirs. `init` adds files that are missing; it does
  // not merge keys into, reformat, or overwrite an existing manifest — the same restraint
  // `.gitignore` gets, and the one that matters most here because this file carries dependencies.
  const existing = await mkdtemp(join(tmpdir(), 'tflw-e2e-init-pkg-keep-'));
  try {
    const mine = '{\n  "name": "mine",\n  "dependencies": { "left-pad": "^1.0.0" }\n}\n';
    await writeFile(join(existing, 'package.json'), mine, 'utf8');

    const { stdout } = await execFileAsync('node', [cliEntry, 'init'], { cwd: existing });
    assert.doesNotMatch(stdout, /package\.json/, 'an untouched file must not be reported as created');
    assert.equal(await readFile(join(existing, 'package.json'), 'utf8'), mine, 'byte-for-byte unchanged');
  } finally {
    await rm(existing, { recursive: true, force: true });
  }
});

// The real end-to-end for `FU-15`, and it has to live here rather than in `@tflw/runtime` (M125b2).
// That package's tests run under `node --import tsx`, and tsx resolves `.ts` itself, so Node never
// reaches its own detect-module path and the warning this row is about cannot be produced inside
// that harness at all — a fixture there asserts against an empty stderr and proves nothing. Only a
// real child process running the real binary sees what a user sees.
test('a `.ts` helper in a project whose `package.json` declares no `"type"` prints one tflw line, not four raw Node ones (M125b2, FU-15)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-typeless-'));
    try {
      // A manifest *without* `"type"` is the trigger — measured, and not what the row implied: with
      // no `package.json` above the helper Node emits nothing at all.
      await writeFile(join(dir, 'package.json'), '{\n  "name": "typeless-fixture"\n}\n', 'utf8');
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'label.ts'), 'export function makeLabel(_ctx: { env: NodeJS.ProcessEnv }, n: number): string {\n  return `n-${n}`;\n}\n', 'utf8');
      await writeFile(
        join(dir, 'helper.tflw'),
        'use "./label.ts"\n\ntest "uses a ts helper"\n  let l = make label(1)\n  api GET /health\n  expect status equals 200\n',
        'utf8',
      );

      const { stdout, stderr } = await execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir });
      const all = stdout + stderr;

      // The four lines the row filed, each asserted absent on its own so a partial regression is
      // named rather than lumped into one failure.
      assert.doesNotMatch(all, /MODULE_TYPELESS_PACKAGE_JSON/, all);
      assert.doesNotMatch(all, /Reparsing as ES module/, all);
      assert.doesNotMatch(all, /incurs a performance overhead/, all);
      assert.doesNotMatch(all, /trace-warnings/, all);
      // …replaced by one tflw sentence that names the fix. Asserted present, so this test cannot
      // pass by the helper simply never loading.
      assert.match(stderr, /⚠ tflw:/, all);
      assert.match(stderr, /"type": "module"/, all);
      // And the run itself is still green — the interception must not change what happens, only
      // what is said about it.
      assert.match(stdout, /uses a ts helper/, all);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Track 3a (UX grill-me, 2026-07-07): a failing test's diff must be visible live, without an
// interactive TTY and without `--verbose` — `--no-color` used to mean *zero* per-test output until
// the final CLI summary; now a failure always surfaces its diff line-by-line as it happens.
test('a failing test surfaces its diff live under the ✗ line even with --no-color and no --verbose (Track 3a)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-live-diff-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'health.tflw'),
        `test "health check"\n  api GET /health\n  expect status equals 999\n`,
        'utf8',
      );

      await assert.rejects(
        execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir }),
        (e: unknown) => {
          const { code, stdout } = e as { code?: number; stdout?: string };
          const lines = (stdout ?? '').split('\n');
          const failLine = lines.findIndex((l) => l.includes('✗ health check'));
          return (
            code === 1 &&
            failLine !== -1 &&
            /expected status to equal 999, but got 200/.test(lines[failLine + 1] ?? '')
          );
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('a passing test prints no live tick at all with --no-color and no --verbose (unchanged default terseness, Track 3a)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-quiet-pass-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir });
      // The final CLI summary (`renderCliSummary`) always lists every test once, regardless of the
      // live ticker — so the real invariant is "exactly one mention", not "zero": a live tick would
      // add a *second* occurrence above the summary, which is what must NOT happen here.
      assert.equal(stdout.split('health check').length - 1, 1, `expected exactly one mention of the test name, got:\n${stdout}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Track 4 (grill-me, 2026-07-07): --verbose prints one line per step, using the same detail/
// duration data report.html is built from — no new computation.
test('--verbose prints one indented line per step under a test-name header (Track 4)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-verbose-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'health.tflw'),
        `test "health check"\n  api GET /health\n  expect status equals 200\n  let done = true\n`,
        'utf8',
      );

      // --no-timestamps: this test is about verbose's step structure, not the separate
      // decision-111/M17 timestamp-prefix feature (its own dedicated test below) — keeps the
      // header line an exact `health check` match instead of coupling to timestamp formatting.
      // GITHUB_ACTIONS stripped: CI itself sets it, which would wrap the header in ::group::.
      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--verbose', '--no-color', '--no-timestamps'], {
        cwd: dir,
        env: envWithout('GITHUB_ACTIONS'),
      });
      const lines = stdout.split('\n');
      const headerIdx = lines.indexOf('health check');
      assert.notEqual(headerIdx, -1, 'expected a bare test-name header line in verbose mode');
      assert.match(lines[headerIdx + 1] ?? '', /✓ GET .*\/health → 200 \(\d+ms\)/);
      assert.match(lines[headerIdx + 2] ?? '', /✓ status to equal 200 \(\d+ms\)/);
      assert.match(lines[headerIdx + 3] ?? '', /✓ done = true \(\d+ms\)/);
      assert.match(lines[headerIdx + 4] ?? '', /✓ health check \(\d+ms\)/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('--verbose --parallel 2 buffers each file\'s step lines into one contiguous block, never interleaved (Track 4)', async () => {
  const server: Server = createServer((req, res) => {
    if (req.url === '/slow') {
      setTimeout(() => res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}'), 250);
    } else if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-verbose-workers-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
    // "slow" takes ~500ms of real wall-clock (two 250ms requests) while "fast" finishes almost
    // instantly — if buffering weren't applied, fast's lines would land in the middle of slow's.
    await writeFile(
      join(dir, 'a-slow.tflw'),
      `test "slow file order"\n  api GET /slow\n  expect status equals 200\n  api GET /slow\n  expect status equals 200\n`,
      'utf8',
    );
    await writeFile(
      join(dir, 'b-fast.tflw'),
      `test "fast file order"\n  api GET /health\n  expect status equals 200\n  api GET /health\n  expect status equals 200\n`,
      'utf8',
    );

    const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--verbose', '--parallel', '2', '--no-color'], { cwd: dir });
    const lines = stdout.split('\n');
    const slowIdx = lines.reduce<number[]>((acc, l, i) => (l.includes('/slow') ? [...acc, i] : acc), []);
    const fastIdx = lines.reduce<number[]>((acc, l, i) => (l.includes('/health') ? [...acc, i] : acc), []);
    assert.equal(slowIdx.length, 2);
    assert.equal(fastIdx.length, 2);
    const noInterleave = Math.max(...slowIdx) < Math.min(...fastIdx) || Math.max(...fastIdx) < Math.min(...slowIdx);
    assert.ok(noInterleave, `expected the two files' verbose blocks not to interleave, got lines:\n${stdout}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await rm(dir, { recursive: true, force: true });
  }
});

// Track 3b (grill-me, 2026-07-07): `tflw docs [topic]`, a static SPEC.md-derived cheatsheet
// bundled into dist/cli.cjs — no network, no cwd/tflw.config needed, so no fixture dir required.
test('`tflw docs` with no topic lists every topic, one per line', async () => {
  // `M125e`/`FU-29`/D281 widened the line: a topic still gets one line of its own, but under its
  // SPEC `##` group heading and followed by its title. `quantifiers` and `subset` are the two the
  // row named as unreadable slugs, so they are the two asserted to now say what they are — the
  // `$`-anchored version of this test passed for as long as the listing taught nothing.
  const { stdout } = await execFileAsync('node', [cliEntry, 'docs']);
  assert.match(stdout, /Topics:/);
  assert.match(stdout, /^ {2}quantifiers\s+Array quantifiers$/m);
  assert.match(stdout, /^ {2}subset\s+Partial-object matching/m);
  // `config` is a `##` section's own topic, whose title *is* the group heading printed directly
  // above it — so it stays bare rather than repeating itself.
  assert.match(stdout, /^ {2}config$/m);
  assert.match(stdout, /^Assertions$/m);
});

test('`tflw docs quantifiers` prints non-empty, recognizable SPEC.md content', async () => {
  const { stdout } = await execFileAsync('node', [cliEntry, 'docs', 'quantifiers']);
  assert.match(stdout, /Array quantifiers/);
  assert.match(stdout, /expect any /);
  assert.match(stdout, /expect all /);
});

test('`tflw docs` on an unknown topic is a usage error (exit 2) with a did-you-mean hint for a near miss', async () => {
  await assert.rejects(
    execFileAsync('node', [cliEntry, 'docs', 'quantifier']),
    (e: unknown) => {
      const { code, stderr } = e as { code?: number; stderr?: string };
      return code === 2 && /unknown docs topic `quantifier`/.test(stderr ?? '') && /Did you mean `quantifiers`\?/.test(stderr ?? '');
    },
  );
});

// Track 2 (grill-me, 2026-07-07): `tflw check --format json` and `tflw run --only` — new CLI
// surface the VS Code extension's diagnostics/CodeLens-run features need.
test('`tflw check --format json` prints one { file, diagnostics } entry per file, exit 2 on a real error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-check-json-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "http://localhost:1"\n`, 'utf8');
    await writeFile(join(dir, 'broken.tflw'), `test "broken"\n  expct status equals 200\n`, 'utf8');

    await assert.rejects(
      execFileAsync('node', [cliEntry, 'check', '--format', 'json', 'broken.tflw'], { cwd: dir }),
      (e: unknown) => {
        const { code, stdout } = e as { code?: number; stdout?: string };
        if (code !== 2) return false;
        const files = JSON.parse((stdout ?? '').trim());
        return (
          Array.isArray(files) &&
          files.length === 1 &&
          files[0].file === 'broken.tflw' &&
          files[0].diagnostics.length === 1 &&
          files[0].diagnostics[0].code === 'TF011' &&
          files[0].diagnostics[0].hint === 'did you mean `expect`?' &&
          typeof files[0].diagnostics[0].span?.start?.line === 'number'
        );
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('`tflw check --format json` lists a clean file with an empty diagnostics array, exit 0', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-check-json-clean-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "http://localhost:1"\n`, 'utf8');
    await writeFile(join(dir, 'clean.tflw'), `test "ok"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

    const { stdout } = await execFileAsync('node', [cliEntry, 'check', '--format', 'json', 'clean.tflw'], { cwd: dir });
    // Not `[]`: a consumer that drew diagnostics for this file last time has to be told it was
    // checked and is clean now, or it leaves them on screen. A top-level `[]` is reserved for
    // "nothing was checked" — the config-level failure below.
    assert.deepEqual(JSON.parse(stdout.trim()), [{ file: 'clean.tflw', diagnostics: [] }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('B6-07/A4-12: `tflw check --format json` attributes every diagnostic to its own file (M70)', async () => {
  // The shape was a flat `Diagnostic[]` concatenated across every discovered file, and `Diagnostic`
  // carries a span but no file — so two files with the same error on the same line produced two
  // byte-identical entries and a consumer had to guess. It only ever worked for exactly one file,
  // which nothing enforced and `--help` did not say; both tests above passed exactly one, which is
  // how the VS Code extension used it before the LSP replaced that path entirely.
  //
  // The colliding-span case is the point, so these two files are deliberately identical in shape:
  // same line, same column, same code, different file.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-check-json-multi-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "http://localhost:1"\n`, 'utf8');
    await writeFile(join(dir, 'a.tflw'), `test "a"\n  expct status equals 200\n`, 'utf8');
    await writeFile(join(dir, 'b.tflw'), `test "b"\n  expct status equals 200\n`, 'utf8');
    await writeFile(join(dir, 'c.tflw'), `test "c"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

    await assert.rejects(
      // No file arguments: discovery finds all three, which is the invocation decision 94's
      // single-file contract never described and the command never refused.
      execFileAsync('node', [cliEntry, 'check', '--format', 'json'], { cwd: dir }),
      (e: unknown) => {
        const { code, stdout } = e as { code?: number; stdout?: string };
        assert.equal(code, 2);
        const files = JSON.parse((stdout ?? '').trim()) as { file: string; diagnostics: { code: string; span: { start: { line: number; column: number } } }[] }[];

        assert.deepEqual(files.map((f) => f.file), ['a.tflw', 'b.tflw', 'c.tflw'], 'every file checked is listed, in discovery order');
        assert.deepEqual(files.map((f) => f.diagnostics.length), [1, 1, 0], 'the clean file is present with an empty batch');

        // The two errors are indistinguishable *except* by the `file` field — which is exactly the
        // defect: before this, both of these were entries in one flat array.
        const [a, b] = files;
        assert.equal(a!.diagnostics[0]!.code, b!.diagnostics[0]!.code);
        assert.deepEqual(a!.diagnostics[0]!.span.start, b!.diagnostics[0]!.span.start);
        return true;
      },
    );

    // Paths are POSIX-separated relative to the cwd, so a nested file is addressable too.
    await mkdir(join(dir, 'nested'), { recursive: true });
    await writeFile(join(dir, 'nested', 'd.tflw'), `test "d"\n  expct status equals 200\n`, 'utf8');
    await assert.rejects(
      execFileAsync('node', [cliEntry, 'check', '--format', 'json', 'nested/d.tflw'], { cwd: dir }),
      (e: unknown) => {
        const files = JSON.parse(((e as { stdout?: string }).stdout ?? '').trim()) as { file: string }[];
        assert.deepEqual(files.map((f) => f.file), ['nested/d.tflw']);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('`tflw check --format=xml` (an unsupported format) is a usage error, not silently ignored', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-check-badformat-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "http://localhost:1"\n`, 'utf8');
    await assert.rejects(
      execFileAsync('node', [cliEntry, 'check', '--format=xml'], { cwd: dir }),
      (e: unknown) => (e as { code?: number }).code === 2,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('`tflw run --only "<name>"` runs exactly that one test, across whichever file declares it', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-only-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'multi.tflw'),
        `test "first test"\n  api GET /health\n  expect status equals 200\n\ntest "second test"\n  api GET /health\n  expect status equals 200\n`,
        'utf8',
      );

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--only', 'second test', '--no-color'], { cwd: dir });
      assert.match(stdout, /1\/1 passed/);
      assert.match(stdout, /second test/);
      assert.doesNotMatch(stdout, /first test/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`tflw run --only` matching no test anywhere is a usage error, not a silent 0-test green run (P#46)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-only-zero-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "the only test"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      await assert.rejects(
        execFileAsync('node', [cliEntry, 'run', '--only', 'nope', '--no-color'], { cwd: dir }),
        (e: unknown) => (e as { code?: number }).code === 2,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// decision 98: uuid/password generators + base64/hex/url transforms — dogfoods the exact
// motivating use case from gap #9 (a declarative Basic-auth header) against a real HTTP Basic
// auth check, not just a round-trip in isolation.
test('uuid/password generators + base64/hex/url transforms work end to end, including a real Basic-auth header', async () => {
  const server: Server = createServer((req, res) => {
    if (req.url === '/whoami') {
      const auth = req.headers.authorization ?? '';
      const b64 = auth.replace(/^Basic /, '');
      const [user, pass] = Buffer.from(b64, 'base64').toString('utf8').split(':');
      if (!user || !pass) {
        res.writeHead(401).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ user, passLen: pass.length }));
      return;
    }
    if (req.url === '/echo' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        res.writeHead(201, { 'content-type': 'application/json' }).end(Buffer.concat(chunks).toString('utf8'));
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-generators-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
    await writeFile(
      join(dir, 'generators.tflw'),
      [
        'test "uuid/password generators + base64/hex/url transforms"',
        '  let id = unique uuid',
        '  let rid = random uuid',
        '  let pw = random password 16',
        '  let creds = base64 encode("alice@example.test:{pw}")',
        '  let roundtrip = base64 decode(creds)',
        '  let hexed = hex encode("abc")',
        '  let unhexed = hex decode(hexed)',
        '  let urled = url encode("a b")',
        '  let unurled = url decode(urled)',
        '  api POST /echo body { id: {id}, rid: {rid}, hexed: {hexed}, unhexed: {unhexed}, urled: {urled}, unurled: {unurled}, roundtrip: {roundtrip} }',
        '  expect status equals 201',
        '  expect body.hexed equals "616263"',
        '  expect body.unhexed equals "abc"',
        '  expect body.urled equals "a%20b"',
        '  expect body.unurled equals "a b"',
        '  expect body.roundtrip equals "alice@example.test:{pw}"',
        '  expect body.id matches "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"',
        '  expect body.rid matches "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"',
        '  api GET /whoami',
        '    header "Authorization" is "Basic {creds}"',
        '  expect status equals 200',
        '  expect body.user equals "alice@example.test"',
        '  expect body.passLen equals 16',
        '',
      ].join('\n'),
      'utf8',
    );

    const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir });
    assert.match(stdout, /1\/1 passed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

// ---- M17 (PLAN decision 111, enterprise arc cluster 6): CI ergonomics + console/log output ----

test('report/results.json is always written (no flag) and mirrors the exact redacted RunReport, secrets included', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-results-json-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n  header "X-Token" is env(TOKEN)\n\nrequire env TOKEN\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir, env: { ...process.env, TOKEN: 'shh-secret' } });
      assert.match(stdout, /1\/1 passed/);

      const resultsPath = join(dir, 'report', 'results.json');
      const results = JSON.parse(await readFile(resultsPath, 'utf8')) as {
        ok: boolean;
        total: number;
        passed: number;
        tests: { name: string; ok: boolean }[];
        seed: number;
      };
      assert.equal(results.ok, true);
      assert.equal(results.total, 1);
      assert.equal(results.passed, 1);
      assert.equal(results.tests[0]?.name, 'health check');
      assert.equal(typeof results.seed, 'number');
      // Redaction applies to results.json exactly like report.html/junit.xml (same RunReport
      // object, decision 111.1) — the raw secret must never appear in the artifact.
      const raw = await readFile(resultsPath, 'utf8');
      assert.doesNotMatch(raw, /shh-secret/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`tflw run --failed` re-runs only the previous run\'s failing tests (decision 111.2)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-failed-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'a.tflw'), `test "passes"\n  api GET /health\n  expect status equals 200\n`, 'utf8');
      await writeFile(join(dir, 'b.tflw'), `test "fails"\n  api GET /health\n  expect status equals 999\n`, 'utf8');

      await assert.rejects(execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir }));

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--failed', '--no-color'], { cwd: dir }).catch((e) => e as { stdout: string });
      assert.match(stdout, /1\/1 passed, 0 failed|0\/1 passed, 1 failed/);
      assert.doesNotMatch(stdout, /passes/);
      assert.match(stdout, /fails/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`FU-23`/D250: `--failed` says what it is replaying, and says when the last run was filtered', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-failed-filter-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'a.tflw'), `@smoke\ntest "passes"\n  api GET /health\n  expect status equals 200\n`, 'utf8');
      await writeFile(join(dir, 'b.tflw'), `test "fails"\n  api GET /health\n  expect status equals 999\n`, 'utf8');

      // A full run: the record names the failure and carries no filter.
      await assert.rejects(execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir }));
      const full = JSON.parse(await readFile(join(dir, 'report', '.last-run.json'), 'utf8')) as { failed: unknown[]; filter?: string };
      assert.equal(full.failed.length, 1);
      assert.equal(full.filter, undefined, 'an unfiltered run records no filter');

      // Replaying it names the count, and says nothing about a filter, because there was none.
      const replay = await execFileAsync('node', [cliEntry, 'run', '--failed', '--no-color'], { cwd: dir }).catch((e) => e as { stdout: string });
      assert.match(replay.stdout, /re-running 1 test that failed in the last run/);
      assert.doesNotMatch(replay.stdout, /which was filtered by/);

      // Now the defect's actual shape: a tag-filtered run overwrites the record. It still records
      // what it found (D250 keeps the overwrite), but now it records that it was narrowed.
      await execFileAsync('node', [cliEntry, 'run', '--tag', 'smoke', '--no-color'], { cwd: dir });
      const filtered = JSON.parse(await readFile(join(dir, 'report', '.last-run.json'), 'utf8')) as { failed: unknown[]; filter?: string };
      assert.equal(filtered.failed.length, 0, 'the smoke run passed, so it records no failures');
      assert.equal(filtered.filter, '--tag smoke');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`FU-23`: the "which was filtered by" clause fires when the replayed record was a narrowed one', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-failed-narrowed-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      // Both tagged, one failing: a `--tag smoke` run therefore records a failure *and* a filter,
      // which is the state in which `--failed` most badly needed to stop being silent.
      await writeFile(join(dir, 'a.tflw'), `@smoke\ntest "passes"\n  api GET /health\n  expect status equals 200\n`, 'utf8');
      await writeFile(join(dir, 'b.tflw'), `@smoke\ntest "fails"\n  api GET /health\n  expect status equals 999\n`, 'utf8');

      await assert.rejects(execFileAsync('node', [cliEntry, 'run', '--tag', 'smoke', '--no-color'], { cwd: dir }));
      const replay = await execFileAsync('node', [cliEntry, 'run', '--failed', '--no-color'], { cwd: dir }).catch((e) => e as { stdout: string });
      assert.match(replay.stdout, /re-running 1 test that failed in the last run — which was filtered by `--tag smoke`, not the whole suite/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`tflw run --failed` with no prior state falls back to the full suite, with a note (decision 111.2)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-failed-empty-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'a.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--failed', '--no-color'], { cwd: dir });
      assert.match(stdout, /no failed tests from the last run — running the full suite/);
      assert.match(stdout, /1\/1 passed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`tflw run --failed` narrows further on repeated invocations once a test is fixed (state always overwritten)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-failed-narrow-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'a.tflw'), `test "passes"\n  api GET /health\n  expect status equals 200\n`, 'utf8');
      await writeFile(join(dir, 'b.tflw'), `test "fails"\n  api GET /health\n  expect status equals 999\n`, 'utf8');

      await assert.rejects(execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir }));
      await assert.rejects(execFileAsync('node', [cliEntry, 'run', '--failed', '--no-color'], { cwd: dir }));

      // Fix the test, then --failed again: this run's own (empty) failure set gets recorded.
      await writeFile(join(dir, 'b.tflw'), `test "fails"\n  api GET /health\n  expect status equals 200\n`, 'utf8');
      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--failed', '--no-color'], { cwd: dir });
      assert.match(stdout, /fails/);
      assert.match(stdout, /1\/1 passed/);

      const lastRun = JSON.parse(await readFile(join(dir, 'report', '.last-run.json'), 'utf8')) as { failed: unknown[] };
      assert.deepEqual(lastRun.failed, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('--bail stops the run after the first failing test — a later file never starts (decision 111.3)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-bail-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'a-fails.tflw'), `test "a fails"\n  api GET /health\n  expect status equals 999\n`, 'utf8');
      await writeFile(join(dir, 'b-should-not-run.tflw'), `test "b should not run"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      const err = await execFileAsync('node', [cliEntry, 'run', '--bail', '--no-color'], { cwd: dir }).catch((e) => e as { stdout: string; code: number });
      assert.equal(err.code, 1);
      assert.match(err.stdout, /a fails/);
      assert.doesNotMatch(err.stdout, /b should not run/);

      const results = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as { total: number };
      assert.equal(results.total, 1, 'only the first (failing) file should have run at all');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('without --bail, both files still run after an earlier failure (unchanged default)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-no-bail-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'a-fails.tflw'), `test "a fails"\n  api GET /health\n  expect status equals 999\n`, 'utf8');
      await writeFile(join(dir, 'b-runs.tflw'), `test "b runs"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      await assert.rejects(execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir }));
      const results = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as { total: number };
      assert.equal(results.total, 2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('--format ndjson streams one JSON-parseable, file-tagged RunEvent per line, no human text mixed in, and also writes report/events.ndjson (decision 111.4)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-ndjson-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--format', 'ndjson', '--no-color'], { cwd: dir });
      const lines = stdout.trim().split('\n');
      assert.ok(lines.length >= 5, `expected run:start/test:start/step:end*2/test:end/run:end, got ${lines.length} lines`);
      const events = lines.map((l) => JSON.parse(l) as { type: string; file?: string });
      assert.equal(events[0]?.type, 'run:start');
      assert.equal(events.at(-1)?.type, 'run:end');
      for (const ev of events) assert.equal(ev.file, 'health.tflw', `every event must be file-tagged, got ${JSON.stringify(ev)}`);
      // No human text (a stray non-JSON line) mixed into stdout.
      for (const l of lines) assert.doesNotThrow(() => JSON.parse(l));

      // The persisted file mirrors the stream event-for-event. Since M63 it is additionally
      // re-walked through the final redaction pass before being written (V2-02), so the two can
      // legitimately differ on a run where a secret is first registered late — see the redaction
      // test below. This run has no secrets at all, so they must still match exactly.
      const ndjsonPath = join(dir, 'report', 'events.ndjson');
      const fileLines = (await readFile(ndjsonPath, 'utf8')).trim().split('\n');
      assert.deepEqual(fileLines.map((l) => JSON.parse(l)), events);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---- C4: the ndjson stream is a contract (M77 — `B3-05`, `B3-07`, `B5-03`; M88d — `B3-11`) ----
//
// SPEC §13 states three guarantees; before M77 all three were violated, and the existing ndjson
// tests missed every one because they assert that specific events *appear*, never that the stream
// is well-formed as a whole. `B3-11` is the same lesson one layer down: M77's own regression tests
// counted `test:start`/`test:end` for hooks and totals for workloads, so a workload test emitting
// *neither* event slipped between them — an absence is only catchable by a test that says how many
// there should be.

test('C4/B3-05+B3-07: every `test:start` is paired, and `run:start.total` forecasts what `run:end` reports (M77)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-ndjson-contract-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      // File hooks are what B3-05 is about, and they only emitted an end event when they *failed* —
      // so the happy path produced a malformed stream and the failure path a well-formed one.
      await writeFile(
        join(dir, 'hooks.tflw'),
        'before file\n  api GET /health\n\nafter file\n  api GET /health\n\ntest "a real test"\n  api GET /health\n  expect status equals 200\n',
        'utf8',
      );

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--format', 'ndjson', '--no-color'], { cwd: dir });
      const events = stdout.trim().split('\n').map((l) => JSON.parse(l) as { type: string; total?: number; report?: { total: number } });

      const starts = events.filter((e) => e.type === 'test:start').length;
      const ends = events.filter((e) => e.type === 'test:end').length;
      assert.equal(starts, 3, 'before file, the test, after file');
      assert.equal(ends, starts, 'guarantee 1: every `test:start` has a matching `test:end`');

      const runStart = events.find((e) => e.type === 'run:start')!;
      const runEnd = events.find((e) => e.type === 'run:end')!;
      assert.equal(runStart.total, 1, 'one declared test — passing hooks are not tests');
      assert.equal(runEnd.report!.total, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('C4/B3-07: a workload-bearing test is counted by `run:start`, not announced as zero (M77)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-ndjson-workload-total-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      // `expandTestCases` skips workload-bearing tests, so `cases.length` was 0 here while the
      // final report counted 1: a progress consumer rendered "0 tests" and then got a result.
      await writeFile(
        join(dir, 'load.tflw'),
        'test "burst"\n  ramp to 1 users over 100ms\n  threshold error rate is less than 100%\n  api GET /health\n',
        'utf8',
      );

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--format', 'ndjson', '--no-color'], { cwd: dir });
      const events = stdout.trim().split('\n').map((l) => JSON.parse(l) as { type: string; total?: number; report?: { total: number } });
      assert.equal(events.find((e) => e.type === 'run:start')!.total, 1);
      assert.equal(events.find((e) => e.type === 'run:end')!.report!.total, 1, 'the forecast matched the result');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('C4/B3-11: a workload-bearing test emits its own `test:start`/`test:end` pair instead of streaming nothing (M88d)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-ndjson-workload-pair-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      // Deliberately the *same* file shape as the `B3-07` test directly above — which passed
      // throughout, because it asserted `total` at both ends and never counted the events in
      // between. The entire stream for this file used to be `run:start` then `run:end`.
      await writeFile(
        join(dir, 'load.tflw'),
        'test "burst"\n  ramp to 1 users over 100ms\n  threshold error rate is less than 100%\n  api GET /health\n',
        'utf8',
      );

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--format', 'ndjson', '--no-color'], { cwd: dir });
      interface Line {
        readonly type: string;
        readonly name?: string;
        readonly report?: { readonly total: number };
        readonly result?: { readonly kind: string; readonly name: string; readonly ok: boolean; readonly steps?: unknown; readonly metrics?: { readonly iterations: number } };
      }
      const events = stdout.trim().split('\n').map((l) => JSON.parse(l) as Line);

      const starts = events.filter((e) => e.type === 'test:start');
      const ends = events.filter((e) => e.type === 'test:end');
      // The restated guarantee (D-M88-5), quantified over report rows rather than over pairs —
      // the old wording ("every `test:start` has a matching `test:end`") was satisfied by this
      // exact stream when it contained neither event, which is how the defect survived M77.
      assert.equal(events.find((e) => e.type === 'run:end')!.report!.total, 1);
      assert.equal(starts.length, 1, `a test counted in report.total must emit a start — got ${stdout}`);
      assert.equal(ends.length, 1, 'and its end');
      assert.equal(starts[0]!.name, 'burst');

      const result = ends[0]!.result!;
      assert.equal(result.kind, 'workload', 'the pair carries the workload result, not a functional stand-in');
      assert.equal(result.name, 'burst');
      assert.ok((result.metrics?.iterations ?? 0) > 0, 'with the metrics the report will hold');
      assert.equal(result.steps, undefined, 'and no step timeline — a workload iteration runs silently by design');
      assert.equal(events.filter((e) => e.type === 'step:end').length, 0, 'so no `step:end` either');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('C4/B3-11: a file mixing a functional and a workload test emits exactly one pair per report row (M88d)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-ndjson-mixed-pairs-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'mixed.tflw'),
        'test "functional"\n  api GET /health\n  expect status equals 200\n\ntest "burst"\n  ramp to 1 users over 100ms\n  threshold error rate is less than 100%\n  api GET /health\n',
        'utf8',
      );

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--format', 'ndjson', '--no-color'], { cwd: dir });
      const events = stdout.trim().split('\n').map((l) => JSON.parse(l) as { type: string; name?: string; result?: { name: string }; report?: { total: number; tests: { name: string }[] } });
      const report = events.find((e) => e.type === 'run:end')!.report!;

      // Row-for-row, both directions: no test in the report went unannounced, and nothing was
      // announced that the report doesn't hold.
      const started = events.filter((e) => e.type === 'test:start').map((e) => e.name);
      const ended = events.filter((e) => e.type === 'test:end').map((e) => e.result!.name);
      const rows = report.tests.map((t) => t.name);
      assert.deepEqual(started, rows, 'one `test:start` per report row, in order');
      assert.deepEqual(ended, rows, 'one `test:end` per report row, in order');
      assert.equal(report.total, 2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('C4/B5-03: a crashed file appears in the stream instead of vanishing from it (M77)', async () => {
  // The crash `RunReport` is built inside `runCommand`'s catch, after `runProgram`'s emitter is
  // gone — so `results.json`, `report.html` and `junit.xml` all carried the reason while the
  // documented *streaming* contract carried no event of any kind for the file. Only the exit code
  // disagreed, and a CI job parsing the stream saw nothing wrong.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-ndjson-crash-'));
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local default\n  api "http://127.0.0.1:1"\n', 'utf8');
    // The helper exists and does not load. It used to be simply absent, which M97c's `TF043` now
    // rejects at check time — a better outcome, and it would have made this test assert nothing
    // about streaming. The crash has to stay a *runtime* one to be this test's subject, so the file
    // is present and broken: same `buildRegistry` failure, same phase, still undecidable statically.
    await writeFile(join(dir, 'nope.ts'), 'export function boom() {}\nthis is not valid typescript(((\n', 'utf8');
    await writeFile(join(dir, 'crash.tflw'), 'use "./nope.ts"\n\ntest "t"\n  log "hi"\n', 'utf8');

    await assert.rejects(
      execFileAsync('node', [cliEntry, 'run', '--format', 'ndjson', '--no-color'], { cwd: dir }),
      (e: unknown) => {
        const { code, stdout } = e as { code?: number; stdout?: string };
        assert.equal(code, 1);
        const events = (stdout ?? '').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { type: string; file?: string; report?: { ok: boolean }; result?: { ok: boolean; error?: string } });

        assert.deepEqual(events.map((ev) => ev.type), ['run:start', 'test:start', 'test:end', 'run:end'], 'the same well-formed sequence any other file emits');
        assert.ok(events.every((ev) => ev.file === 'crash.tflw'), 'every event is attributed to the file that crashed');
        assert.equal(events.find((ev) => ev.type === 'run:end')!.report!.ok, false, 'the stream must not report a green run');
        assert.match(events.find((ev) => ev.type === 'test:end')!.result!.error ?? '', /nope\.ts/, 'and it carries the reason, not just a failure');
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('report/events.ndjson gets the same final redaction pass as every other artifact — no line carries a secret the report itself masks (M63/V2-02)', async () => {
  // V2-02: the file was written from the array collected live at emit time, so a secret first
  // registered *late* in the run stayed raw in the `step:end`/`test:end` lines while the very same
  // file's `run:end` line (which carries the already-redacted RunReport) masked it — one artifact
  // contradicting itself. `/whoami` echoes the value before any `env()` has been evaluated, which
  // is the only ordering that reproduces it.
  const secret = 'SUPERSECRET_LATE_VALUE_999';
  const server: Server = createServer((req, res) => {
    if (req.url === '/whoami') res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ note: `current pw is ${secret}` }));
    else if (req.url === '/login') res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-ndjson-redact-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
    await writeFile(join(dir, 'leak.tflw'), `test "secret surfaces before it is ever read"\n  api GET /whoami\n  expect status equals 200\n  api POST /login body { pass: env(LATE) }\n  expect status equals 200\n`, 'utf8');

    await execFileAsync('node', [cliEntry, 'run', '--format', 'ndjson', '--no-color'], { cwd: dir, env: { ...process.env, LATE: secret } });

    const ndjson = await readFile(join(dir, 'report', 'events.ndjson'), 'utf8');
    const results = await readFile(join(dir, 'report', 'results.json'), 'utf8');
    const count = (haystack: string): number => haystack.split(secret).length - 1;

    assert.equal(count(results), 0, 'baseline: results.json was already covered by the decision-56 pass');
    assert.equal(count(ndjson), 0, 'events.ndjson must not print a secret its own run:end line masks');
    assert.ok(ndjson.includes('•••(LATE)'), 'and the placeholder must actually be there — an empty file would also satisfy the line above');

    // The leak was in these two event kinds specifically; assert on them by name so a future
    // change that redacts only the report event fails here rather than passing on a technicality.
    const byType = (t: string): string[] => ndjson.trim().split('\n').filter((l) => (JSON.parse(l) as { type: string }).type === t);
    assert.ok(byType('step:end').length > 0 && byType('test:end').length === 1, 'sanity: the run produced the event kinds that leaked');
    for (const line of [...byType('step:end'), ...byType('test:end')]) assert.equal(count(line), 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('--format ndjson always includes step-level detail even without --verbose (decision 111.4)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-ndjson-detail-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--format', 'ndjson', '--no-color'], { cwd: dir });
      const events = stdout
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as { type: string });
      const stepEvents = events.filter((e) => e.type === 'step:end');
      assert.equal(stepEvents.length, 2, 'api + expect steps, without --verbose ever being passed');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('an unsupported `tflw run --format` value is a usage error, not silently ignored', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-format-bad-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "http://localhost:1"\n`, 'utf8');
    await assert.rejects(
      execFileAsync('node', [cliEntry, 'run', '--format', 'xml', '--no-color'], { cwd: dir }),
      (e: unknown) => (e as { code?: number }).code === 2,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('console output gets an HH:MM:SS.mmm timestamp prefix by default (decision 111.7)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-timestamps-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      // GITHUB_ACTIONS stripped: CI itself sets it, which would wrap the header in ::group:: and
      // break this test's bare-header assertion — unrelated to what this test actually checks.
      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--verbose', '--no-color'], {
        cwd: dir,
        env: envWithout('GITHUB_ACTIONS'),
      });
      assert.match(stdout, /^\d{2}:\d{2}:\d{2}\.\d{3} health check$/m);
      // Pre-existing quirk, unrelated to this decision: a verbose step line's `detail` already
      // bakes in its own duration text, and formatEvent appends a second `(Nms)` after it — not
      // anchoring on a trailing `$` here since that's not what this test is checking.
      assert.match(stdout, /^\d{2}:\d{2}:\d{2}\.\d{3} +✓ GET .*\/health → 200/m);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('--no-timestamps opts out, restoring the plain (pre-decision-111) output shape', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-no-timestamps-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      // GITHUB_ACTIONS stripped: CI itself sets it, which would wrap the header in ::group:: and
      // break this test's bare-header assertion — unrelated to what this test actually checks.
      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--verbose', '--no-color', '--no-timestamps'], {
        cwd: dir,
        env: envWithout('GITHUB_ACTIONS'),
      });
      // Anchored to line-start: the summary's own `now 2026-...T20:15:49.955Z` field legitimately
      // contains an HH:MM:SS.mmm-shaped substring midline — only a *leading* one would mean the
      // opt-out failed.
      assert.doesNotMatch(stdout, /^\d{2}:\d{2}:\d{2}\.\d{3} /m);
      assert.match(stdout, /^health check$/m);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('GitHub Actions log grouping wraps a test\'s output in ::group::/::endgroup:: only under --verbose, auto-detected via GITHUB_ACTIONS (decision 111.8)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-gh-group-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      const verbose = await execFileAsync('node', [cliEntry, 'run', '--verbose', '--no-color', '--no-timestamps'], {
        cwd: dir,
        env: { ...process.env, GITHUB_ACTIONS: 'true' },
      });
      assert.match(verbose.stdout, /^::group::health check$/m);
      assert.match(verbose.stdout, /^::endgroup::$/m);

      const notVerbose = await execFileAsync('node', [cliEntry, 'run', '--no-color', '--no-timestamps'], {
        cwd: dir,
        env: { ...process.env, GITHUB_ACTIONS: 'true' },
      });
      assert.doesNotMatch(notVerbose.stdout, /::group::/, 'normal mode is already one line per test — nothing worth folding');

      // envWithout, not just omitting an override: CI itself sets GITHUB_ACTIONS=true on this very
      // test process, which execFileAsync would otherwise inherit by default.
      const notOnActions = await execFileAsync('node', [cliEntry, 'run', '--verbose', '--no-color', '--no-timestamps'], {
        cwd: dir,
        env: envWithout('GITHUB_ACTIONS'),
      });
      assert.doesNotMatch(notOnActions.stdout, /::group::/, 'no GITHUB_ACTIONS env var set — no grouping');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('--log-file duplicates console output to a file (decision 111.9)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-log-file-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      const logPath = join(dir, 'run.log');
      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--no-color', '--no-timestamps', '--log-file', logPath], { cwd: dir });

      const logged = await readFile(logPath, 'utf8');
      assert.match(logged, /1\/1 passed/);
      assert.match(logged, /report:/);
      // Whatever went to stdout also landed in the log file (no ANSI codes to strip under
      // --no-color, so this is a direct comparison here).
      assert.equal(logged, stdout);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---- M3c: --browser / --headed (D11) ---------------------------------------

async function withWebFixtureServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server: Server = createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><html><body><button>Add to cart</button></body></html>');
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test('`tflw run --browser firefox` runs a real UI test end-to-end and stamps the engine on the report', async () => {
  await withWebFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-browser-firefox-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  web "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'ui.tflw'), `test "storefront"\n  open "/"\n  click button "Add to cart"\n`, 'utf8');

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--browser', 'firefox', '--no-color'], { cwd: dir });
      assert.match(stdout, /1\/1 passed/);

      const resultsJson = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as { browserEngine?: string };
      assert.equal(resultsJson.browserEngine, 'firefox');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`tflw run --browser <bogus>` is a usage error, not a silent fall-back to chromium', async () => {
  await withWebFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-browser-bogus-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  web "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'ui.tflw'), `test "storefront"\n  open "/"\n`, 'utf8');

      const failure = await execFileAsync('node', [cliEntry, 'run', '--browser', 'edge', '--no-color'], { cwd: dir }).catch((e) => e as { code: number; stderr: string });
      assert.equal(failure.code, 2);
      assert.match(failure.stderr, /--browser expects one of chromium, firefox, webkit, got "edge"/);
      await assert.rejects(access(join(dir, 'report', 'report.html')), 'no report should be written for a usage error');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---- tflw load / tflw init --load (M29/M30, PLAN_BROWSER_PERF_SECURITY.md D16-D19/D24a/D29/D30) ------

test('`tflw init --load` scaffolds load.tflw alongside the usual files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-init-load-'));
  try {
    const { stdout } = await execFileAsync('node', [cliEntry, 'init', '--load'], { cwd: dir });
    assert.match(stdout, /created tflw\.config, example\.tflw, load\.tflw, \.env\.example, package\.json, \.gitignore/);
    const loadSource = await readFile(join(dir, 'load.tflw'), 'utf8');
    assert.match(loadSource, /^test "/m);
    assert.match(loadSource, /ramp to \d+ rps over/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// M56 (Phase 3, D116/D117/D121): a workload test's result now lives inline in the one unified
// `report.tests` (tagged `kind: 'workload'`) — no more separate `load-results.json`/
// `load-report.html`/`load-junit.xml` artifacts.
interface WorkloadReportEntry {
  readonly kind: 'workload';
  readonly name: string;
  readonly ok: boolean;
  // M89b (`B3-03`) — a structural echo of `LoadWorkloadReport`'s discriminated union, kept loose
  // on purpose: this file reads `results.json` as an *external* consumer would, so it declares
  // only the discriminator plus whatever a given assertion narrows to.
  readonly workload: { readonly shape: string; readonly model?: string; readonly [k: string]: unknown };
  readonly metrics: { readonly iterations: number; readonly failures: number; readonly errorRate: number };
  readonly thresholds: { readonly label: string; readonly ok: boolean }[];
  readonly endpoints: { readonly identity: string; readonly metrics: { readonly iterations: number } }[];
  readonly backOff?: { readonly ratio: number; readonly warning: boolean };
}
interface UnifiedResultsJson {
  readonly ok: boolean;
  readonly failed: number;
  readonly inconclusive?: boolean;
  readonly aborted?: boolean;
  readonly abortedMessage?: string;
  readonly selfDiagnosis?: { readonly avgEventLoopLagMs: number; readonly maxEventLoopLagMs: number; readonly cpuPercent: number; readonly saturated: boolean };
  readonly tests: readonly (WorkloadReportEntry | { readonly kind: 'functional' })[];
}
function workloadEntries(results: UnifiedResultsJson): WorkloadReportEntry[] {
  return results.tests.filter((t): t is WorkloadReportEntry => t.kind === 'workload');
}

test('`tflw load` runs a real scenario end-to-end: passes, prints a summary, writes report/results.json', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-load-pass-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'load.tflw'),
        'test "health burst"\n  ramp to 10 rps over 300ms\n  api GET /health\n  expect status equals 200\n  threshold error rate is less than 50%\n',
        'utf8',
      );

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', 'load.tflw', '--no-color'], { cwd: dir });
      assert.match(stdout, /scenario "health burst"/);
      assert.match(stdout, /iterations: \d+/);
      assert.match(stdout, /PASS 1\/1 passed/);
      assert.doesNotMatch(stdout, /results:.*load-results\.json/);
      assert.match(stdout, /report:.*report\.html/);

      const results = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as UnifiedResultsJson;
      assert.equal(results.ok, true);
      assert.equal(results.inconclusive, false);
      const scenarios = workloadEntries(results);
      assert.equal(scenarios.length, 1);
      assert.equal(scenarios[0]!.name, 'health burst');
      assert.equal(scenarios[0]!.ok, true);
      assert.equal(scenarios[0]!.thresholds[0]!.ok, true);
      assert.ok(scenarios[0]!.metrics.iterations > 0);

      const html = await readFile(join(dir, 'report', 'report.html'), 'utf8');
      assert.match(html, /health burst/);

      const junit = await readFile(join(dir, 'report', 'junit.xml'), 'utf8');
      assert.match(junit, /<testsuites name="tflw"/);
      assert.match(junit, /health burst — error rate/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// M43 (PLAN_BROWSER_PERF_SECURITY.md §2.14, D67-D70): the per-endpoint breakdown fixing R6's
// deferred axis — a scenario with an untagged lookup and a `as "checkout"`-tagged request should
// surface both identities separately across all three report surfaces, and a `for "checkout"`-
// scoped threshold should gate on the tagged request's own p95, not the whole iteration's.
test('`tflw load`: a scenario with an untagged step and an `as "label"`-tagged step reports a per-endpoint breakdown across console, JSON, HTML, and a scoped threshold', async () => {
  await withOrdersServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-load-endpoints-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'load.tflw'),
        'test "checkout burst"\n' +
          '  ramp to 5 users over 200ms\n' +
          // The unscoped error-rate line is M89c's doing, not this test's subject: a *scoped*
          // duration threshold is still a duration threshold, so without it the file no longer
          // checks clean and this test can't get to the endpoint breakdown it exists to assert.
          '  threshold error rate is less than 1%\n' +
          '  threshold p95 duration for "checkout" is less than 5000ms\n' +
          '  api GET /health\n' +
          '  expect status equals 200\n' +
          '  api POST /orders as "checkout"\n' +
          '  expect status equals 201\n',
        'utf8',
      );

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', 'load.tflw', '--no-color'], { cwd: dir });
      assert.match(stdout, /endpoints:/);
      assert.match(stdout, /GET \/health: iterations \d+/);
      assert.match(stdout, /checkout: iterations \d+/);
      assert.match(stdout, /PASS 1\/1 passed/);

      const results = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as UnifiedResultsJson;
      const scenario = workloadEntries(results)[0]!;
      assert.deepEqual(
        scenario.endpoints.map((e) => e.identity),
        ['GET /health', 'checkout'],
      );
      assert.ok(scenario.endpoints.every((e) => e.metrics.iterations > 0));
      const scoped = scenario.thresholds.find((t) => t.label === 'p95 duration for "checkout"');
      assert.ok(scoped, `expected a scoped threshold, got ${JSON.stringify(scenario.thresholds)}`);
      assert.equal(scoped!.ok, true);

      const html = await readFile(join(dir, 'report', 'report.html'), 'utf8');
      assert.match(html, /class="endpoints"/);
      assert.match(html, /<details class="endpoint"><summary>checkout/);

      const junit = await readFile(join(dir, 'report', 'junit.xml'), 'utf8');
      assert.match(junit, /p95 duration for &quot;checkout&quot;/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// M34 acceptance-milestone finding: `tflw load` built its `LoadOptions` for both `runLoad`
// (single-process) and `runLoadShard` (each `--workers N>1` forked child) without ever passing
// `environ` through — `env(NAME)` inside a load scenario/session silently fell back to the raw
// `process.env` `runLoadCore` defaults to, never the `.env`-merged environment `loadAndValidate`
// already builds (the same one `tflw run` has always passed correctly). Invisible until this
// milestone's own acceptance run tried a real `.env`-only credential inside a `session` used by a
// `scenario` for the first time — no prior `tflw load` test (M29-M33) ever exercised `env(...)`
// against anything but a real, already-exported process env var. Fixed by passing `environ`
// through both call sites (cli.ts's `loadCommand` and its `--internal-load-worker` branch).
test('`tflw load`: an `env(NAME)` value from a `.env` file (not a real process env var) resolves inside a scenario, both single-process and under `--workers`', async () => {
  const server: Server = createServer((req, res) => {
    if (req.url === '/secret' && req.headers['x-api-key'] === 'from-dotenv-only') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    } else {
      res.writeHead(403).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-load-dotenv-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n\nrequire env API_KEY\n`, 'utf8');
    // Deliberately *not* set as a real process env var — `envWithout` below also strips it from
    // whatever the test runner's own environment might have, so a pass here can only mean the
    // `.env` file itself was actually read and threaded through to the running scenario.
    await writeFile(join(dir, '.env'), 'API_KEY=from-dotenv-only\n', 'utf8');
    await writeFile(
      join(dir, 'load.tflw'),
      'test "dotenv-only credential"\n  ramp to 3 users over 150ms\n  api GET /secret\n    header "X-Api-Key" is env(API_KEY)\n  expect status equals 200\n  threshold error rate is less than 1%\n',
      'utf8',
    );

    const single = await execFileAsync('node', [cliEntry, 'run', 'load.tflw', '--no-color'], { cwd: dir, env: envWithout('API_KEY') });
    assert.match(single.stdout, /PASS 1\/1 passed/);
    const singleResults = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as UnifiedResultsJson;
    const singleScenario = workloadEntries(singleResults)[0]!;
    assert.equal(singleScenario.metrics.failures, 0);
    assert.ok(singleScenario.metrics.iterations > 0);

    const workers = await execFileAsync('node', [cliEntry, 'run', 'load.tflw', '--no-color', '--workers', '2'], { cwd: dir, env: envWithout('API_KEY') });
    assert.match(workers.stdout, /PASS 1\/1 passed/);
    const workersResults = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as UnifiedResultsJson;
    const workersScenario = workloadEntries(workersResults)[0]!;
    assert.equal(workersScenario.metrics.failures, 0);
    assert.ok(workersScenario.metrics.iterations > 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await rm(dir, { recursive: true, force: true });
  }
});

// M34 (D17, back-off/coordinated-omission diagnostic — designed and built in this milestone, never
// shipped by M29-M32 despite D17 naming it). Real, non-simulated proof: a closed-model scenario
// against a server that's fast for the first couple of requests then deliberately slow demonstrates
// the exact warning D31's acceptance bar asks for.
test('`tflw load`: a closed-model scenario against a degrading server prints and reports a real back-off warning', async () => {
  // Fast for the scenario's own first half of wall-clock time (matching computeBackOff's own
  // early/late split at `overMs / 2`), then deliberately slow — a time-based trigger, not a
  // request-count one, so it lines up with exactly what the diagnostic actually measures.
  const runStart = Date.now();
  const server: Server = createServer((req, res) => {
    if (req.url !== '/slow') return void res.writeHead(404).end();
    if (Date.now() - runStart < 700) return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    setTimeout(() => res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}'), 150);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-load-backoff-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
    // 1400ms/5 users comfortably clears MIN_ITERATIONS_PER_HALF_FOR_BACK_OFF (10) on both halves —
    // runtime's load.test.ts has the full derivation of this margin.
    // `hold`, not `ramp`, since M107b (`M107-01`, D-M107-1): the diagnostic now requires one
    // concurrency level for the whole window, because a rising target made a *healthy*
    // finite-capacity service score 0.57 — higher than a genuinely degrading one. The trigger below
    // is time-based, so this end-to-end proof of the warning is unchanged in what it demonstrates;
    // under `ramp` it was partly demonstrating the artefact.
    await writeFile(join(dir, 'load.tflw'), 'test "degrading checkout"\n  hold 5 users for 1400ms\n  api GET /slow\n  expect status equals 200\n  threshold error rate is less than 1%\n', 'utf8');

    const { stdout } = await execFileAsync('node', [cliEntry, 'run', 'load.tflw', '--no-color'], { cwd: dir });
    assert.match(stdout, /⚠ your load backed off/);
    assert.match(stdout, /results understate real latency/);

    const results = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as UnifiedResultsJson;
    const backOff = workloadEntries(results)[0]!.backOff;
    assert.ok(backOff, 'expected the JSON report to carry a backOff diagnosis');
    assert.equal(backOff!.warning, true);
    assert.ok(backOff!.ratio > 0.2, `expected ratio > 0.2, got ${backOff!.ratio}`);

    const html = await readFile(join(dir, 'report', 'report.html'), 'utf8');
    assert.match(html, /class="backoff-warning"/);
    assert.match(html, /coordinated omission, D17/);

    // Report-only: a back-off warning must never touch the exit code or gate CI on its own — only
    // `threshold`s and `inconclusive` do that. The scenario's own error-rate threshold is met here
    // (a slow `/slow` still answers 200), so the one <testcase> it contributes passes and the
    // warning is visible without failing anything. This used to declare zero thresholds and lean on
    // D119's bare always-passing <testcase>; M60/A4-01 makes that shape a checker error — a
    // workload test with nothing to gate on reported `PASS` over a 100% error rate — so the
    // zero-threshold branch in `reporter/src/junit.ts` is now only reachable through the library
    // API, not from a `.tflw` file the CLI will run.
    const junit = await readFile(join(dir, 'report', 'junit.xml'), 'utf8');
    assert.match(junit, /tests="1" failures="0"/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await rm(dir, { recursive: true, force: true });
  }
});

// Phase 2b (D105-D109): a `test` defaults to `sequential` now — two workload-bearing tests only
// run concurrently when both are explicitly tagged `parallel` (D108: the synthetic multi-scenario
// case this test always demonstrated needs that keyword added to keep proving it, since sequential
// is no longer just an accident of "functional execution happens to be a plain for-loop").
test('`tflw run` runs two `parallel`-tagged workload-bearing tests concurrently: passes/fails independently, gates the overall exit code, and reports both combined and per-scenario metrics', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-load-multi-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'load.tflw'),
        'test "healthy" parallel\n' +
          '  ramp to 3 users over 150ms\n' +
          '  api GET /health\n' +
          '  expect status equals 200\n' +
          '  threshold error rate is less than 1%\n' +
          '\n' +
          'test "unhealthy" parallel\n' +
          '  ramp to 3 users over 150ms\n' +
          '  api GET /not-a-real-route\n' +
          '  expect status equals 200\n' +
          '  threshold error rate is less than 1%\n',
        'utf8',
      );

      const failure = await execFileAsync('node', [cliEntry, 'run', 'load.tflw', '--no-color'], { cwd: dir }).catch((e) => e as { code: number; stdout: string });
      assert.equal(failure.code, 1);
      assert.match(failure.stdout, /scenario "healthy"/);
      assert.match(failure.stdout, /scenario "unhealthy"/);
      // D117: no more pooled "combined:" view — each workload test renders standalone, like a
      // functional test; both still appear, each with its own metrics/threshold lines.
      assert.doesNotMatch(failure.stdout, /combined:/);
      assert.match(failure.stdout, /FAIL \d+\/2 passed, \d+ failed/);

      const results = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as UnifiedResultsJson;
      assert.equal(results.ok, false);
      const scenarios = workloadEntries(results);
      assert.equal(scenarios.length, 2);
      const healthy = scenarios.find((s) => s.name === 'healthy')!;
      const unhealthy = scenarios.find((s) => s.name === 'unhealthy')!;
      assert.equal(healthy.ok, true);
      assert.equal(unhealthy.ok, false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`tflw load` exits 1 and reports a breached threshold without throwing', async () => {
  const server: Server = createServer((_req, res) => res.writeHead(500).end());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-load-fail-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
    await writeFile(
      join(dir, 'load.tflw'),
      'test "always fails"\n  ramp to 3 users over 150ms\n  api GET /health\n  expect status equals 200\n  threshold error rate is less than 1%\n',
      'utf8',
    );

    const failure = await execFileAsync('node', [cliEntry, 'run', 'load.tflw', '--no-color'], { cwd: dir }).catch((e) => e as { code: number; stdout: string });
    assert.equal(failure.code, 1);
    assert.match(failure.stdout, /FAIL 0\/1 passed, 1 failed/);

    const results = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as UnifiedResultsJson;
    assert.equal(results.ok, false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await rm(dir, { recursive: true, force: true });
  }
});

// Phase 2b (D99): unlike the old, dropped `tflw load` (which hard-errored on 0 workload-bearing
// tests), `tflw run` on a file with none is just an ordinary functional-only run — no special
// case, no error (covered directly in `unified-dispatch.test.ts`). M56: no more `selfDiagnosis`/
// workload entry in `report.tests` either.
test('`tflw run` on a file with no workload-bearing `test` runs it as an ordinary functional test, no error', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-load-noscenario-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'plain.tflw'), 'test "not a load test"\n  api GET /health\n  expect status equals 200\n', 'utf8');

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', 'plain.tflw', '--no-color'], { cwd: dir });
      assert.match(stdout, /PASS 1\/1 passed/);
      const results = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as UnifiedResultsJson;
      assert.equal(results.selfDiagnosis, undefined);
      assert.equal(workloadEntries(results).length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// M52 (Phase 2, PLAN_UNIFIED_TEST_WORKLOAD.md): Phase 1b's 4 new workload kinds now actually
// execute end-to-end via the real CLI, not just under `@tflw/runtime`'s own unit tests.
test('`tflw load` runs a `hold` workload end-to-end: passes, prints a summary, writes reports', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-load-hold-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      // Below selfDiagnosis.ts's MIN_SATURATION_WINDOW_MS (300ms) so this stays a plain pass on a
      // busy CI box — a `hold` this tight and this short is a legitimately heavy generator load
      // (this local fixture returns in ~1ms, so 4 always-on VUs issue thousands of iterations),
      // exactly as it would be for an equivalent `ramp to N users over <dur>` at this scale too.
      await writeFile(join(dir, 'load.tflw'), 'test "steady load"\n  hold 4 users for 200ms\n  api GET /health\n  expect status equals 200\n  threshold error rate is less than 1%\n', 'utf8');

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', 'load.tflw', '--no-color'], { cwd: dir });
      assert.match(stdout, /scenario "steady load" — hold 4 users for 200ms \(closed\)/);
      // M89b (`B3-03`) — the summary line used to read `ramp to 4 users over 200ms`, contradicting
      // the pre-run line five seconds above it. Both now come from one `describeWorkload` over one
      // `LoadWorkloadReport`.
      assert.match(stdout, /✓ steady load \(workload — hold 4 users for 200ms \(closed\)\)/);
      assert.match(stdout, /PASS 1\/1 passed/);

      const results = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as UnifiedResultsJson;
      assert.equal(results.ok, true);
      assert.deepEqual(workloadEntries(results)[0]!.workload, { shape: 'hold', model: 'closed', target: 4, forMs: 200 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`tflw load` runs a `run N iterations across M users` workload end-to-end, exactly N iterations', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-load-iterations-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'load.tflw'), 'test "fixed batch"\n  run 12 iterations across 3 users\n  api GET /health\n  expect status equals 200\n  threshold error rate is less than 1%\n', 'utf8');

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', 'load.tflw', '--no-color'], { cwd: dir });
      assert.match(stdout, /scenario "fixed batch" — run 12 iterations across 3 users/);
      assert.match(stdout, /PASS 1\/1 passed/);

      const results = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as UnifiedResultsJson;
      assert.equal(results.ok, true);
      assert.equal(workloadEntries(results)[0]!.metrics.iterations, 12);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// M89b (`B3-03`, D-M89-5) — all 10 workload kinds, in one run, through the real CLI.
//
// Three claims, and the third is the one that used to be false in a way no unit test could see:
// every kind describes itself distinctly (8 of 10 used to collapse onto `ramp to N over Tms`, and
// the 2 count-based ones onto the impossible `ramp to N users over 0ms`); `results.json` keeps them
// distinguishable (`hold`/`ramp`, `step`/`spike`, and the 2 iteration forms used to serialize
// byte-identically at the same target); and the pre-run line the CLI prints matches the summary
// line the reporter prints, for every kind — no longer an agreement between two functions but the
// same call, so a divergence here means the wiring was undone, not that the copies drifted.
const ALL_TEN_WORKLOADS = [
  ['k01-ramp-users', 'ramp to 3 users over 100ms'],
  ['k02-ramp-rps', 'ramp to 5 rps over 100ms'],
  ['k03-hold-users', 'hold 3 users for 100ms'],
  ['k04-hold-rps', 'hold 5 rps for 100ms'],
  ['k05-step-users', 'step users\n    to 2 for 50ms\n    to 4 for 50ms'],
  ['k06-step-rps', 'step rps\n    to 4 for 50ms\n    to 8 for 50ms'],
  ['k07-spike-users', 'spike users\n    hold 2 for 50ms\n    to 6 over 50ms'],
  ['k08-spike-rps', 'spike rps\n    hold 4 for 50ms\n    to 10 over 50ms'],
  ['k09-shared-iterations', 'run 6 iterations across 2 users'],
  ['k10-per-vu-iterations', 'run 3 iterations per user across 2 users'],
] as const;

test('every workload kind describes itself distinctly, and the pre-run line is the summary line', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-load-kinds-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      const src = ALL_TEN_WORKLOADS.map(
        ([name, decl]) => `test "${name}"\n  ${decl}\n  api GET /health\n  expect status equals 200\n  threshold error rate is less than 50%\n`,
      ).join('\n');
      await writeFile(join(dir, 'kinds.tflw'), src, 'utf8');

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', 'kinds.tflw', '--no-color', '--no-timestamps'], { cwd: dir });

      const preRun = new Map<string, string>();
      const summary = new Map<string, string>();
      for (const raw of stdout.split('\n')) {
        const line = raw.trim();
        const p = /^scenario "([^"]+)" — (.+)$/.exec(line);
        if (p) preRun.set(p[1]!, p[2]!);
        const s = /^✓ (\S+) \(workload — (.+)\)$/.exec(line);
        if (s) summary.set(s[1]!, s[2]!);
      }
      assert.equal(preRun.size, 10, `expected a pre-run line per kind, got ${[...preRun.keys()].join(', ')}`);
      assert.deepEqual([...summary.keys()].sort(), [...preRun.keys()].sort());
      for (const [name, description] of preRun) {
        assert.equal(summary.get(name), description, `"${name}" describes itself two ways`);
      }
      assert.equal(new Set(preRun.values()).size, 10, `10 kinds must produce 10 distinct descriptions, got ${JSON.stringify([...preRun.values()])}`);
      // The two that used to render as a ramp over zero milliseconds, a workload the grammar
      // cannot express.
      assert.equal(preRun.get('k09-shared-iterations'), 'run 6 iterations across 2 users');
      assert.equal(preRun.get('k10-per-vu-iterations'), 'run 3 iterations per user across 2 users');

      const results = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as UnifiedResultsJson;
      const entries = workloadEntries(results);
      assert.equal(entries.length, 10);
      assert.equal(new Set(entries.map((e) => JSON.stringify(e.workload))).size, 10);
      const byName = new Map(entries.map((e) => [e.name, e.workload]));
      assert.deepEqual(byName.get('k03-hold-users'), { shape: 'hold', model: 'closed', target: 3, forMs: 100 });
      assert.deepEqual(byName.get('k07-spike-users'), {
        shape: 'spike',
        model: 'closed',
        stages: [
          { target: 2, durationMs: 50, ramped: false },
          { target: 6, durationMs: 50, ramped: true },
        ],
      });
      assert.deepEqual(byName.get('k10-per-vu-iterations'), { shape: 'iterations', iterations: 3, vus: 2, perVu: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Phase 2b (D99): unlike the old, dropped `tflw load` (which required exactly one explicit file
// argument), `tflw run` with none auto-discovers every `.tflw` file under cwd (unchanged, existing
// behavior) — a workload-bearing test discovered this way runs exactly like an explicitly-named one.
test('`tflw run` with no file argument auto-discovers a workload-bearing test too', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-load-nofile-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'load.tflw'), 'test "health burst"\n  ramp to 3 users over 150ms\n  api GET /health\n  expect status equals 200\n  threshold error rate is less than 1%\n', 'utf8');

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir });
      assert.match(stdout, /scenario "health burst"/);
      assert.match(stdout, /PASS 1\/1 passed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---- `exclude` (D127, PLAN_DISCOVERY_EXCLUDE.md) ---------------------------------------------

test('`exclude "<path>"` in tflw.config skips that directory during bare (no-file-args) discovery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-exclude-'));
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local default\n  api "http://127.0.0.1:1"\n\nexclude "other-suite"\n', 'utf8');
    await writeFile(join(dir, 'health.tflw'), 'test "health check"\n  api GET /health\n  expect status equals 200\n', 'utf8');
    await mkdir(join(dir, 'other-suite'), { recursive: true });
    // Deliberately invalid — proves this file is never even parsed, not just excluded from the run.
    await writeFile(join(dir, 'other-suite', 'broken.tflw'), 'test "broken"\n  expct status equals 200\n', 'utf8');

    const { stdout } = await execFileAsync('node', [cliEntry, 'check', '--no-color'], { cwd: dir });
    assert.match(stdout, /1 file checked, no problems found\./);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('B6-10: `exclude "<a .tflw file>"` skips that one file, not just directories (M73)', async () => {
  // The equality test lived inside the `isDirectory()` branch, so a file entry could never match:
  // `exclude "b.tflw"` discovered and checked `b.tflw` anyway, at exit 0, with no diagnostic — and
  // §3.9 opens by calling these "paths". A user excluding one known-broken file got no signal that
  // nothing had happened.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-exclude-file-'));
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local default\n  api "http://127.0.0.1:1"\n\nexclude "broken.tflw", "nested/also-broken.tflw"\n', 'utf8');
    await writeFile(join(dir, 'health.tflw'), 'test "health check"\n  api GET /health\n  expect status equals 200\n', 'utf8');
    // Both deliberately invalid: if either is discovered, `check` exits 2 and this fails loudly
    // rather than merely counting one file too many.
    await writeFile(join(dir, 'broken.tflw'), 'test "broken"\n  expct status equals 200\n', 'utf8');
    await mkdir(join(dir, 'nested'), { recursive: true });
    await writeFile(join(dir, 'nested', 'also-broken.tflw'), 'test "broken"\n  expct status equals 200\n', 'utf8');
    await writeFile(join(dir, 'nested', 'fine.tflw'), 'test "fine"\n  api GET /health\n  expect status equals 200\n', 'utf8');

    const { stdout } = await execFileAsync('node', [cliEntry, 'check', '--no-color'], { cwd: dir });
    assert.match(stdout, /2 files checked, no problems found\./, 'health.tflw + nested/fine.tflw, with both excluded files skipped at any depth');

    // Still not a hard deny — naming the excluded file explicitly runs it, same as a directory.
    await assert.rejects(
      execFileAsync('node', [cliEntry, 'check', 'broken.tflw', '--no-color'], { cwd: dir }),
      (e: unknown) => (e as { code?: number }).code === 2,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('`exclude` does not stop an explicit file arg inside the excluded path from running', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-exclude-explicit-'));
  try {
    await writeFile(join(dir, 'tflw.config'), 'env local default\n  api "http://127.0.0.1:1"\n\nexclude "other-suite"\n', 'utf8');
    await mkdir(join(dir, 'other-suite'), { recursive: true });
    await writeFile(join(dir, 'other-suite', 'health.tflw'), 'test "health check"\n  api GET /health\n  expect status equals 200\n', 'utf8');

    const { stdout } = await execFileAsync('node', [cliEntry, 'check', 'other-suite/health.tflw', '--no-color'], { cwd: dir });
    assert.match(stdout, /1 file checked, no problems found\./);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- M31: multi-process generator scaling + self-diagnosis (D19/D28) -------------------------

test('`tflw load --workers 3` really forks 3 OS processes and merges their results into one passing report', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-load-workers-pass-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'load.tflw'),
        'test "health burst"\n  ramp to 6 users over 200ms\n  api GET /health\n  expect status equals 200\n  threshold error rate is less than 1%\n',
        'utf8',
      );

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', 'load.tflw', '--workers', '3', '--no-color'], { cwd: dir });
      assert.match(stdout, /running across 3 generator processes/);
      assert.match(stdout, /scenario "health burst"/);
      assert.match(stdout, /PASS 1\/1 passed/);
      assert.match(stdout, /generator:/);

      const results = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as UnifiedResultsJson;
      assert.equal(results.ok, true);
      const scenarios = workloadEntries(results);
      assert.equal(scenarios.length, 1);
      assert.equal(scenarios[0]!.name, 'health burst');
      assert.equal(scenarios[0]!.ok, true);
      assert.ok(scenarios[0]!.metrics.iterations > 0, 'the 3 forked processes together should have produced real iterations');
      assert.equal(typeof results.selfDiagnosis!.saturated, 'boolean');
      assert.ok(results.selfDiagnosis!.avgEventLoopLagMs >= 0);
      assert.ok(results.selfDiagnosis!.cpuPercent >= 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`tflw load --workers 2` still fails the run (exit 1) when the merged, pooled error rate breaches a threshold', async () => {
  const server: Server = createServer((_req, res) => res.writeHead(500).end());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-load-workers-fail-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
    await writeFile(
      join(dir, 'load.tflw'),
      'test "always fails"\n  ramp to 4 users over 150ms\n  api GET /health\n  expect status equals 200\n  threshold error rate is less than 1%\n',
      'utf8',
    );

    const failure = await execFileAsync('node', [cliEntry, 'run', 'load.tflw', '--workers', '2', '--no-color'], { cwd: dir }).catch((e) => e as { code: number; stdout: string });
    assert.equal(failure.code, 1);
    assert.match(failure.stdout, /FAIL 0\/1 passed, 1 failed/);

    const results = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as UnifiedResultsJson;
    assert.equal(results.ok, false);
    const scenario = workloadEntries(results)[0]!;
    assert.ok(scenario.metrics.iterations > 0);
    assert.equal(scenario.metrics.failures, scenario.metrics.iterations, 'every /health hit a 500, every iteration should be a recorded failure');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await rm(dir, { recursive: true, force: true });
  }
});

test('`tflw load --workers 0` (or any non-positive-integer) is a usage error, same shape as `tflw run --workers`', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-load-workers-usage-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'load.tflw'), 'test "S"\n  ramp to 1 users over 50ms\n  api GET /health\n', 'utf8');

      const failure = await execFileAsync('node', [cliEntry, 'run', 'load.tflw', '--workers', '0', '--no-color'], { cwd: dir }).catch((e) => e as { code: number; stderr: string });
      assert.equal(failure.code, 2);
      assert.match(failure.stderr, /--workers expects a positive integer, got "0"/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---- M32: full load-report design (Ctrl-C partial report, inconclusive exit code —
// PLAN_REPORTS_PERF_SECURITY.md R1-R6/R11), now unified into report.html/junit.xml/results.json
// by M56 (Phase 3, D121) rather than separate load-report.html/load-junit.xml files -------------

/** Spawns `tflw load`, sends SIGINT after `killAfterMs`, and resolves once the process exits with
 * everything it printed. `execFileAsync` can't do this — it has no way to deliver a signal partway
 * through a run — so this is `spawn` + manual stdout/stderr collection instead. */
function runLoadAndSigint(loadArgs: string[], cwd: string, killAfterMs: number): Promise<{ code: number | null; output: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn('node', [cliEntry, 'run', ...loadArgs, '--no-color'], { cwd });
    let output = '';
    child.stdout.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr.on('data', (d: Buffer) => (output += d.toString()));
    setTimeout(() => child.kill('SIGINT'), killAfterMs);
    child.on('exit', (code) => resolvePromise({ code, output }));
  });
}

test('`tflw load`: Ctrl-C flushes a partial report (exit 130) instead of losing the run', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-load-sigint-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      // A long planned duration (4s) so "aborted well before the end" isn't a race against natural
      // completion — SIGINT fires at 300ms, under 1/10th of the plan.
      await writeFile(join(dir, 'load.tflw'), 'test "long"\n  ramp to 5 users over 4000ms\n  api GET /health\n  expect status equals 200\n  threshold error rate is less than 1%\n', 'utf8');

      const { code, output } = await runLoadAndSigint(['load.tflw'], dir, 300);
      assert.equal(code, 130);
      assert.match(output, /aborting… flushing a partial report/);
      assert.match(output, /⚠ aborted — aborted at \d+s of 4s planned/);

      const results = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as UnifiedResultsJson;
      assert.equal(results.aborted, true);
      assert.match(results.abortedMessage!, /^aborted at \d+s of 4s planned$/);
      assert.ok(workloadEntries(results)[0]!.metrics.iterations > 0, 'iterations completed before Ctrl-C must still be counted, not discarded');
      // `M114` (`M111-01`) — the artifact a CI job branches on, and the last sink `FU-07` left
      // dishonest. This file read `{"ok": true, "passed": 1, "failed": 0, "aborted": true}` while
      // the very same run exited 130: the JSON and the exit code disagreed about whether the run
      // passed, and only one of them is what a script reads. `failed` still says the narrow thing.
      assert.equal(results.ok, false, 'an aborted run must not report a pass in the file CI reads');
      assert.equal(results.failed, 0, '`ok: false` here means "no verdict", not "something failed" — that distinction is why no new field was added');

      const html = await readFile(join(dir, 'report', 'report.html'), 'utf8');
      assert.match(html, /insecure-warning/);

      const junit = await readFile(join(dir, 'report', 'junit.xml'), 'utf8');
      assert.match(junit, /<property name="aborted" value="aborted at \d+s of 4s planned"\/>/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// `M114` (`M111-01`) — `results.json` is one of the two machine-readable sinks the row named; this
// is the other. `report/events.ndjson` only exists under `--format ndjson`, which replaces the human
// console output entirely, so the abort's `run:end` event needs its own run rather than another
// assertion on the test above. Worth the extra 300ms: `--format ndjson` is the mode built to be
// consumed by something other than a person, which is exactly who was being lied to.
test('`--format ndjson`: an aborted run\'s `run:end` event carries `ok: false`, like every other sink', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-sigint-ndjson-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'load.tflw'), 'test "long"\n  ramp to 5 users over 4000ms\n  api GET /health\n  expect status equals 200\n  threshold error rate is less than 1%\n', 'utf8');

      const { code } = await runLoadAndSigint(['load.tflw', '--format', 'ndjson'], dir, 300);
      assert.equal(code, 130);

      const runEnd = (await readFile(join(dir, 'report', 'events.ndjson'), 'utf8'))
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line) as { type: string; report?: { ok: boolean; failed: number; aborted?: boolean } })
        .find((e) => e.type === 'run:end');
      assert.equal(runEnd?.report?.aborted, true, 'the abort must reach the stream at all before its verdict can be checked');
      assert.equal(runEnd?.report?.ok, false);
      assert.equal(runEnd?.report?.failed, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`tflw load --workers 2`: Ctrl-C propagates to forked workers and still merges a partial report', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-load-sigint-workers-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'load.tflw'), 'test "long"\n  ramp to 6 users over 4000ms\n  api GET /health\n  expect status equals 200\n  threshold error rate is less than 1%\n', 'utf8');

      // Phase 2b (D111): the main process now also runs its own striped shard-0 share in-process
      // (not just orchestrating N forked children the way pre-Phase-2b `tflw load` always did) —
      // `fork()`'s own one-time cost briefly counts against *this* process's self-diagnosis window
      // too now, so a kill delay this short can occasionally (legitimately) read as "inconclusive"
      // rather than "aborted (partial)" on a loaded CI box. 900ms gives the fork overhead room to
      // fall outside `MIN_SATURATION_WINDOW_MS`'s ratio before Ctrl-C fires.
      const { code, output } = await runLoadAndSigint(['load.tflw', '--workers', '2'], dir, 900);
      assert.equal(code, 130);
      assert.match(output, /running across 2 generator processes/);
      assert.match(output, /⚠ aborted — aborted at \d+s of 4s planned/);

      const results = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as UnifiedResultsJson;
      assert.equal(results.aborted, true);
      assert.ok(workloadEntries(results)[0]!.metrics.iterations > 0, 'at least one of the two workers must have completed real iterations before the abort');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`tflw load`: a genuinely saturated generator exits 3 (inconclusive) and marks every threshold `skipped`, not passed/failed, in junit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-load-inconclusive-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "http://127.0.0.1:1"\n`, 'utf8');
    await writeFile(
      join(dir, 'helpers.ts'),
      'export function burnCpu(): boolean {\n  const start = Date.now();\n  while (Date.now() - start < 20) {\n    // deliberate synchronous busy-work — real CPU saturation, not a timing race\n  }\n  return true;\n}\n',
      'utf8',
    );
    // No `api` step at all — this scenario's entire body is synchronous CPU burn, deliberately
    // saturating the one generator process for real (not simulated), the same way
    // `selfDiagnosis.test.ts`'s own busy-block test proves saturation deterministically.
    await writeFile(
      join(dir, 'load.tflw'),
      // The error-rate line is M89c's doing. It is also this suite's clearest instance of `B3-17`:
      // with no `api` step, the only way an iteration here fails is `burnCpu()` throwing, so the
      // threshold is satisfiable but near-unfalsifiable. M89c requires it to be *present*, which is
      // all a static check can honestly require — see REVIEW_FINDINGS.md `B3-17`.
      'use "./helpers.ts"\n\ntest "cpu burn"\n  ramp to 8 users over 600ms\n  let burned = burnCpu()\n  threshold p95 duration is less than 100000ms\n  threshold error rate is less than 1%\n',
      'utf8',
    );

    const failure = await execFileAsync('node', [cliEntry, 'run', 'load.tflw', '--no-color'], { cwd: dir }).catch((e) => e as { code: number; stdout: string });
    assert.equal(failure.code, 3);
    assert.match(failure.stdout, /⚠ tflw itself is the bottleneck/);
    assert.match(failure.stdout, /⚠ inconclusive/);
    // `M114` (`M111-01`) — until this milestone the badge above those two warnings read a green
    // `PASS 1/1 passed`, while this same run exited 3 and marked both its thresholds `<skipped/>`
    // below. `M111` gave `aborted` a badge of its own and left its sibling cause printing a pass.
    assert.match(failure.stdout, /INCONCLUSIVE 1\/1 passed/);
    assert.doesNotMatch(failure.stdout, /PASS 1\/1 passed/);

    const results = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as UnifiedResultsJson;
    assert.equal(results.inconclusive, true);
    assert.equal(results.selfDiagnosis!.saturated, true);
    assert.equal(results.ok, false, 'a run whose numbers tflw itself says are untrustworthy has not passed');
    assert.equal(results.failed, 0);

    const junit = await readFile(join(dir, 'report', 'junit.xml'), 'utf8');
    // junit emits one `<testcase>` per threshold, so M89c's added line takes this from 1 to 2 —
    // and only now does the "*every* threshold" in this test's own name mean anything. With a
    // single threshold, "every" and "the one" were the same assertion.
    assert.match(junit, /tests="2"[^>]*skipped="2"/);
    assert.equal(junit.match(/<skipped message="[^"]*saturated[^"]*"\/>/g)?.length, 2, 'both thresholds skipped, not just the first');
    assert.doesNotMatch(junit, /<failure/);

    const html = await readFile(join(dir, 'report', 'report.html'), 'utf8');
    assert.match(html, /generator process saturated/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- Phase 2b (D110/D113): `--skip-workload`, `--workers` scoped to workload-bearing tests -----

test('`tflw run --workers 4` on an all-functional file is a non-fatal no-op warning, and the file still runs', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-workers-noop-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'plain.tflw'), 'test "ok"\n  api GET /health\n  expect status equals 200\n', 'utf8');

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', 'plain.tflw', '--workers', '4', '--no-color'], { cwd: dir });
      assert.match(stdout, /`--workers` has no effect — plain\.tflw has no workload-bearing tests/);
      assert.match(stdout, /PASS 1\/1 passed/);
      const results = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as UnifiedResultsJson;
      assert.equal(workloadEntries(results).length, 0, 'no workload entry should appear for an all-functional file');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`tflw run --workers 4` on a file mixing functional and workload-bearing tests prints no warning', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-workers-mixed-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'mixed.tflw'),
        'test "functional"\n  api GET /health\n  expect status equals 200\n\ntest "burst"\n  ramp to 4 users over 150ms\n  api GET /health\n  expect status equals 200\n  threshold error rate is less than 1%\n',
        'utf8',
      );

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', 'mixed.tflw', '--workers', '4', '--no-color'], { cwd: dir });
      assert.doesNotMatch(stdout, /`--workers` has no effect/);
      assert.match(stdout, /running across 4 generator processes/);
      // M56: the workload test's result now lives inline in `report.tests` alongside the
      // functional one, so the tally counts both — 2/2, not just the functional side's 1/1.
      assert.match(stdout, /PASS 2\/2 passed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`tflw run --skip-workload` skips every workload-bearing test regardless of its `parallel`/`sequential` batch, functional tests still run', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-skip-workload-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'mixed.tflw'),
        'test "functional" parallel\n  api GET /health\n  expect status equals 200\n\ntest "burst" parallel\n  ramp to 4 users over 150ms\n  api GET /health\n  expect status equals 200\n  threshold error rate is less than 1%\n',
        'utf8',
      );

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', 'mixed.tflw', '--skip-workload', '--no-color'], { cwd: dir });
      assert.match(stdout, /PASS 1\/1 passed/);
      assert.doesNotMatch(stdout, /scenario "burst"/);
      const results = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as UnifiedResultsJson;
      assert.equal(workloadEntries(results).length, 0, 'no workload entry should appear once the workload-bearing test is skipped');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---- M60: the launch review's A4/A2 checker findings, end-to-end through the real CLI ---------
//
// Each of these ran green before M60. They assert the *outcome a user sees* — a refusal instead of
// a `PASS` — rather than the diagnostic's wording, because the defect in every case was that a
// wrong run reported success, not that a message read badly.

test('`tflw run` refuses a workload-bearing test with no `threshold` instead of reporting PASS over a 100% error rate (M60, A4-01)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-m60-no-threshold-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      // Every iteration fails: /nope-not-a-real-route 404s and the expectation demands 999.
      await writeFile(join(dir, 'load.tflw'), 'test "load no threshold"\n  run 5 iterations across 1 users\n  api GET /nope-not-a-real-route\n  expect status equals 999\n', 'utf8');

      const failure = await execFileAsync('node', [cliEntry, 'run', 'load.tflw', '--no-color'], { cwd: dir }).catch((e) => e as { code: number; stdout: string; stderr: string });
      assert.equal(failure.code, 2, 'a load test that cannot fail must not be runnable');
      assert.doesNotMatch(failure.stdout ?? '', /PASS/);
      assert.match(failure.stderr, /has no `threshold`, so it can never fail/);
      await assert.rejects(access(join(dir, 'report', 'results.json')), 'nothing should have executed');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`tflw check` catches a duplicate `action` name instead of letting the run abort with a bare `(crashed)` (M60, A2-01)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-m60-dup-action-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'a.tflw'), 'action fetch it()\n  log "FIRST"\n  give 1\n\naction fetch it()\n  log "SECOND"\n  give 2\n\ntest "t"\n  fetch it()\n', 'utf8');

      const failure = await execFileAsync('node', [cliEntry, 'check', '--no-color'], { cwd: dir }).catch((e) => e as { code: number; stderr: string });
      assert.equal(failure.code, 2, '`tflw check` used to print "no problems found" for this file');
      assert.match(failure.stderr, /duplicate action "fetch it"/);
      assert.match(failure.stderr, /already declared at line 1/, 'the diagnostic must carry a source location — the runtime crash carried none');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`tflw check` catches a browser step reached through an `action` from a workload-bearing test (M60, A4-02)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-m60-indirect-browser-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      // Verbatim from A4-02's repro A, plus the threshold A4-01 now requires. This ran 57 384
      // iterations at a 100% error rate and printed PASS.
      await writeFile(
        join(dir, 'load.tflw'),
        'action openIt()\n  open "/"\n  click button "Buy"\n\ntest "load"\n  hold 2 users for 1s\n  threshold error rate is less than 1%\n  openIt()\n  expect status equals 200\n',
        'utf8',
      );

      const failure = await execFileAsync('node', [cliEntry, 'check', '--no-color'], { cwd: dir }).catch((e) => e as { code: number; stderr: string });
      assert.equal(failure.code, 2);
      assert.match(failure.stderr, /browser steps aren't supported inside a workload-bearing `test`/);
      assert.match(failure.stderr, /`openIt` \(line 2\) contains a browser step/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`tflw check` catches a `pause` reached through an `action` from a functional test (M60, A4-02)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-m60-indirect-pause-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      // A4-02's repro B: this functional test slept for two real seconds and reported PASS.
      await writeFile(join(dir, 't.tflw'), 'action helper()\n  api GET /health\n  pause 2s\n\ntest "t"\n  helper()\n  api GET /health\n  expect status equals 200\n', 'utf8');

      const failure = await execFileAsync('node', [cliEntry, 'check', '--no-color'], { cwd: dir }).catch((e) => e as { code: number; stderr: string });
      assert.equal(failure.code, 2);
      assert.match(failure.stderr, /`pause` is only legal inside a workload-bearing `test`/);
      assert.match(failure.stderr, /`helper` \(line 3\) contains a `pause`/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// M87 (review cluster C6) — the CLI half of call resolution. `checkCalls` is unit-tested in
// `@tflw/lang`, but the *world* it resolves against is assembled out here: the checker never
// touches a filesystem, so `importedActions` is per-call-site wiring, and per-call-site wiring is
// exactly what M60 found had silently drifted between the CLI, the language server and the docs
// site. A unit test on the pass cannot tell whether anyone remembered to pass it a resolved world.
test('`tflw check` resolves an imported action and reports a wrong-arity call against it (M87, A4-03)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-m87-arity-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await mkdir(join(dir, 'shared'), { recursive: true });
      await writeFile(join(dir, 'shared', 'orders.tflw'), 'action create order(name)\n  api GET /health\n  expect status equals 200\n', 'utf8');
      await writeFile(join(dir, 't.tflw'), 'import "./shared/orders.tflw"\n\ntest "t"\n  create order("Widget", "extra")\n', 'utf8');

      const failure = await execFileAsync('node', [cliEntry, 'check', '--no-color'], { cwd: dir }).catch((e) => e as { code: number; stderr: string });
      assert.equal(failure.code, 2);
      assert.match(failure.stderr, /TF038/);
      assert.match(failure.stderr, /action "create order" expects 1 argument, got 2/);
      // The hint names the file it was imported from — only reachable if the import was genuinely
      // read off disk, which is the wiring this test exists to prove.
      assert.match(failure.stderr, /imported from "\.\/shared\/orders\.tflw"/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`tflw check` stays silent on an unresolvable world rather than calling a name unknown (M87)', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-m87-open-world-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      // A JS helper (`use`) can export any name, and enumerating those names means executing the
      // module — which the checker does not do. So `whatever(...)` is undecidable here, and the
      // file must check clean rather than be condemned on a guess.
      await writeFile(join(dir, 'helpers.mjs'), 'export function whatever() { return 1; }\n', 'utf8');
      await writeFile(join(dir, 't.tflw'), 'use "./helpers.mjs"\n\ntest "t"\n  let x = whatever()\n  api GET /health\n  expect status equals 200\n', 'utf8');

      const { stdout } = await execFileAsync('node', [cliEntry, 'check', '--no-color'], { cwd: dir });
      assert.match(stdout, /no problems found/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// -- `M111` (review row `B6-03`): a browser-launch failure is a test failure, not "could not run" --
//
// `exit 2` is `EXIT_USAGE`, defined at the top of `cli.ts` as "usage / config error — could not
// run". A browser test whose launch fails produced a *complete* report — console summary,
// `report.html`, `junit.xml`, `results.json`, the failing test correctly attributed — and then
// exited 2 anyway, because `BrowserManager.close()` re-threw the already-reported launch rejection
// past the per-file `try/catch` and onto `main`'s top-level handler.
//
// The exit code is the half of `B6-03` that no runtime-package test can see, which is why it lives
// here and `browser-launch-failure.test.ts` holds the other half. A CI job that branches on
// `2 = could not run` versus `1 = tests failed` — the distinction `cli.ts` documents and that this
// project's own `PLAN.md` sells — reads "your config is broken" over a run whose report says
// otherwise.
test('a browser test whose launch fails exits 1 with a full report, not 2 ("could not run")', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-launchfail-'));
    const emptyBrowsers = await mkdtemp(join(tmpdir(), 'tflw-e2e-nobrowsers-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n  web "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'api.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');
      await writeFile(join(dir, 'ui.tflw'), `test "a browser test"\n  open "/"\n  expect text "hello" is visible\n`, 'utf8');

      // An empty browsers directory is a real launch failure with no network and no uninstall —
      // and it is the *common* first-run shape, more so than the missing peer dependency `B6-03`
      // used to reach it. Every `browser.launch()` failure rejects the same promise.
      const env = { ...envWithout('GITHUB_ACTIONS'), PLAYWRIGHT_BROWSERS_PATH: emptyBrowsers };

      const failure = await execFileAsync('node', [cliEntry, 'run', 'api.tflw', 'ui.tflw', '--no-color'], { cwd: dir, env }).then(
        () => undefined,
        (e: unknown) => e as { code?: number; stdout?: string },
      );

      assert.ok(failure, 'the run should have failed — the browser test cannot pass without a browser');
      assert.equal(failure.code, 1, `expected exit 1 (tests failed), got ${failure.code}: 2 means "could not run", and it did`);
      // The report the exit code has to agree with: one test passed, one failed, both counted.
      assert.match(failure.stdout ?? '', /1\/2 passed, 1 failed/);
      const results = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as { total: number };
      assert.equal(results.total, 2);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(emptyBrowsers, { recursive: true, force: true });
    }
  });
});

// -- `M111` (review row `B6-05`): `--log-file` must not fail a green run, or vanish when it matters --
//
// `--help` says `--log-file <path>` "duplicates console output to a file (plain text)". The test
// above proves the one case that worked: an existing directory, a run that reaches the end, nothing
// on stderr. Four cases did not, and each is a separate assertion below, because the old
// implementation buffered the whole run in memory and wrote once — after the summary, after every
// artifact, with no `mkdir`, no `try`, and no path from stderr into the buffer at all.
//
// The fix is structural, not four patches: the file is opened before the run and written through.

test('--log-file creates its parent directory rather than failing a passing run with exit 2', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-log-mkdir-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      // `logs/` does not exist. It, `artifacts/` and `.tflw-logs/` are the paths a person picks.
      // This used to print `PASS 1/1 passed`, write `report.html`, then hit `ENOENT` in the final
      // `writeFile` — which reached `main`'s top-level catch and exited 2, i.e. "could not run",
      // over a suite that had just run and passed.
      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--no-color', '--no-timestamps', '--log-file', 'logs/run.log'], { cwd: dir });

      assert.match(stdout, /1\/1 passed/);
      assert.match(await readFile(join(dir, 'logs', 'run.log'), 'utf8'), /1\/1 passed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('--log-file writes the log even when the run returns early on a parse error', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-log-early-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'bad.tflw'), `test "beta"\n  api GET\n`, 'utf8');

      // The run returns from `loadAndValidate` long before the old `save()` at the end of the
      // function, so this produced **no file at all** — in exactly the situation someone keeps a
      // log for. And the diagnostic goes to stderr, which never passed through the log sink
      // either, so even a run that did reach `save()` logged stdout only.
      const failure = await execFileAsync('node', [cliEntry, 'run', 'bad.tflw', '--no-color', '--log-file', 'run.log'], { cwd: dir }).then(
        () => undefined,
        (e: unknown) => e as { code?: number },
      );
      assert.equal(failure?.code, 2);

      const logged = await readFile(join(dir, 'run.log'), 'utf8');
      assert.match(logged, /error\[TF010\]/);
      assert.match(logged, /bad\.tflw:2/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('--log-file mirrors stderr, so `error:` lines are in the log and not only on the terminal', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-log-stderr-'));
    try {
      // `require env` with the variable unset is an `err()` line, not a rendered diagnostic — the
      // other of the two stderr paths that used to bypass the log.
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n\nrequire env DJ_TOKEN\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      const env = envWithout('GITHUB_ACTIONS', 'DJ_TOKEN');
      const failure = await execFileAsync('node', [cliEntry, 'run', '--no-color', '--log-file', 'run.log'], { cwd: dir, env }).then(
        () => undefined,
        (e: unknown) => e as { code?: number; stderr?: string },
      );
      assert.equal(failure?.code, 2);

      // Plain text, per `--help`'s own promise — and specifically without the `\x1b[31m` that
      // `err()` used to emit unconditionally.
      const logged = await readFile(join(dir, 'run.log'), 'utf8');
      assert.match(logged, /error: missing required environment variable: DJ_TOKEN/);
      assert.doesNotMatch(logged, /\x1b\[/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('--log-file into a genuinely unusable path fails before any test runs, which is what exit 2 means', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-log-unusable-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');
      // A regular file standing exactly where the log's parent directory would have to be.
      await writeFile(join(dir, 'blocker'), 'not a directory', 'utf8');

      // The soundness half of the first test in this group. Creating a missing directory must not
      // have turned every bad `--log-file` into a silent success — an unusable path is still a
      // usage error. What changed is *when*: it is now refused before anything runs, which is the
      // one moment `EXIT_USAGE`'s own definition ("could not run") is a true statement about it.
      const failure = await execFileAsync('node', [cliEntry, 'run', '--no-color', '--log-file', 'blocker/run.log'], { cwd: dir }).then(
        () => undefined,
        (e: unknown) => e as { code?: number; stderr?: string },
      );
      assert.equal(failure?.code, 2);
      assert.match(failure?.stderr ?? '', /--log-file blocker\/run\.log/);
      // Nothing ran: no report directory, so the exit code and the artifacts agree.
      await assert.rejects(() => access(join(dir, 'report')));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// M134a's coverage repair, and it closes a real gap rather than moving a number.
//
// The Tier 3 engine shipped with four unit-level suites and one in-process end-to-end file, and
// **nothing that ran the matcher through the built `dist/cli.cjs`**. That is exactly the gap this
// file exists for — "the built artifact is broken but the source isn't" — and the coverage gate is
// what noticed: `c8` remaps the bundle back onto the source, so every function of `inputCorpus.ts`,
// `inputProbe.ts` and `inputRules.ts` was recorded **twice**, hit by the unit tests and unhit by the
// bundle, and the global `functions` figure fell from 94.49% to 93.79% against a floor of 94.
//
// The instructive part is that the number was right and the first reading of it was wrong. Seven
// exported functions of `inputCorpus.ts` showed as uncovered while their own unit tests passed,
// which looks like an instrumentation artifact and is not: it is a true statement that the shipped
// binary's copy of them had never been executed by any test. A scan whose engine is only ever
// exercised in-process is one bundler regression away from being a scan that silently finds nothing.
test('the built dist/cli.cjs runs an input-handling scan end to end against a real server', async () => {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    // One id path segment and one query parameter, which is what makes this request offer mutation
    // sites at all (`TF067`'s condition is a request that offers none).
    if (/^\/orders\/\d+$/.test(url.pathname)) {
      // Deliberately well-behaved: a JSON envelope with no stack frame, no SQL grammar and no
      // absolute path. D373's bar is disclosure rather than status, so a correct application under
      // the full corpus must come back **clean** — a green line here is the zero-false-positive bar
      // asserted through the shipped binary, not merely in a unit test.
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":7,"status":"open"}');
    } else {
      res.writeHead(404, { 'content-type': 'application/json' }).end('{"message":"Not found"}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-input-'));
  try {
    await writeFile(
      join(dir, 'tflw.config'),
      `defaults\n  authorized target "${baseUrl}" reason "self-hosted end-to-end fixture"\nenv local default\n  api "${baseUrl}"\n`,
      'utf8',
    );
    await writeFile(
      join(dir, 'input.tflw'),
      `test "input handling"\n  api GET /orders/7?sort=asc\n  expect status equals 200\n  expect response has no input handling violations\n`,
      'utf8',
    );

    const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir });

    assert.match(stdout, /1\/1 passed/);
    // The assertion's own message, read from `report.html` rather than stdout: a passing step prints
    // only its name unless `--verbose` is given, and the facts this test is about live in the step
    // detail. The report is also the durable artifact, which is the half a CI reader actually keeps.
    const html = await readFile(join(dir, 'report', 'report.html'), 'utf8');
    // The cost line, printed rather than asserted as a constant (D381) — its presence is what proves
    // the probe matrix actually ran through the bundle rather than the assertion short-circuiting on
    // a request with no mutable input, which would also have printed a pass.
    assert.match(html, /requests sent/);
    // `probe oversized`/`probe traversal` are absent from the config, so those two classes must be
    // reported as withheld. This is the half `input-assert.test.ts` found invisible on a passing
    // line: a green run that tested less has to say so, and here it has to say so through the CLI.
    assert.match(html, /oversized/);
    assert.match(html, /traversal/);

    // M135b (D403/D404) — the SARIF file, asserted **here** rather than only in the reporter's unit
    // tests, because the write is wired in `cli.ts` and nothing else executes that line. This is
    // `M134a-02`'s lesson applied before it could be filed again: an artifact produced only in
    // process is one wiring regression away from never being written at all, and its absence is
    // indistinguishable from D404 correctly declining to write it.
    const sarif = JSON.parse(await readFile(join(dir, 'report', 'findings.sarif'), 'utf8')) as {
      version: string;
      runs: { tool: { driver: { name: string; rules: { id: string }[] } }; results: unknown[]; properties: Record<string, unknown> }[];
    };
    assert.equal(sarif.version, '2.1.0');
    assert.equal(sarif.runs[0]!.tool.driver.name, 'tflw');
    // The scan was clean, so the document has zero results and still declares the rules that ran —
    // which is the state D404 exists to keep distinguishable from *no scan happened*.
    assert.deepEqual(sarif.runs[0]!.results, []);
    assert.ok(sarif.runs[0]!.tool.driver.rules.length > 0, 'a clean scan still names what it checked');
    assert.ok(sarif.runs[0]!.properties['tflw/notApplicable'], 'and what it did not');

    // M141 (`M137a-01`) — the `results.json` half of the same cross-repo contract, asserted on this
    // run's real document. It rides on this test rather than getting its own because the fixture
    // already produces the state the contract is about, and a second scan run to assert names would
    // cost thirty seconds to learn nothing new.
    //
    // **Why not in `sarif.test.ts` beside the other contract walk.** That file can only hand
    // `writeResultsJson` a `RunReport` literal it wrote itself, and `writeResultsJson` is
    // `JSON.stringify` — so the walk would be reading back the fixture's own keys and would pass
    // through any rename of the real emitter. The keys are produced by `buildScanCoverage` in
    // `cli.ts`, and this is the nearest test that observes what that function actually wrote,
    // through the shipped binary. A contract test that cannot fail is the defect `M141` is closing,
    // so it is not one this milestone gets to introduce.
    const results = JSON.parse(await readFile(join(dir, 'report', 'results.json'), 'utf8')) as Record<string, unknown>;
    const rc = ARTIFACT_CONTRACT.results;
    const coverage = results[rc.scanCoverage] as Record<string, unknown>[] | undefined;
    assert.ok(Array.isArray(coverage) && coverage.length > 0, `results.json carries a non-empty \`${rc.scanCoverage}\``);
    for (const field of Object.values(rc.scanCoverageFields)) {
      assert.ok(Object.hasOwn(coverage![0]!, field), `a census entry carries \`${field}\``);
    }
    // Both halves have to be non-empty or the walk below is vacuous in the way this milestone is
    // about: an empty `notApplicable` array has no entry to check the field names of, and the loop
    // would pass by iterating nothing. This fixture withholds two payload classes and reflects
    // none, so it stands three rules down while `sec/error-detail-disclosure` applies.
    const applied = coverage!.flatMap((c) => c[rc.scanCoverageFields.applied] as string[]);
    const notApplicable = coverage!.flatMap((c) => c[rc.scanCoverageFields.notApplicable] as Record<string, unknown>[]);
    assert.ok(applied.length > 0, 'the fixture applies at least one rule');
    assert.ok(notApplicable.length > 0, 'and stands at least one down — otherwise the field walk below iterates nothing');
    for (const field of Object.values(rc.notApplicableFields)) {
      assert.ok(Object.hasOwn(notApplicable[0]!, field), `a stood-down entry carries \`${field}\` — the name \`verify-security-acceptance.mjs\` reads`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

// `M134a-02`, the other two thirds. The row measured that the shipped binary's copy of the
// authorization engine had never been executed by any test in this repo, and that Tier 1's read
// 19/19 for a reason that is not reassuring: its scan also runs at session establishment (D287), so
// any CLI test that merely *declares* a session warms the bundled copy without asserting anything.
//
// Three tests rather than one parametrised case, because a failure has to name its own engine. A
// bundler or export regression does not break all three tiers together — it breaks the one whose
// module stopped being reachable — and a shared case that failed would say only "a scan broke".
test('the built dist/cli.cjs runs an authorization scan end to end against a real server', async () => {
  const OWNER_OF: Record<string, string> = { a1: 'shopper' };
  const TOKENS: Record<string, string> = { 'tok-shopper': 'shopper', 'tok-peer': 'peer' };
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const auth = req.headers['authorization'];
    const who = typeof auth === 'string' && auth.startsWith('Bearer ') ? (TOKENS[auth.slice(7)] ?? null) : null;
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    };
    const login = /^\/login\/(\w+)$/.exec(url.pathname);
    if (login) return json(200, { token: `tok-${login[1]!}` });
    const order = /^\/orders\/(\w+)$/.exec(url.pathname);
    if (order) {
      const id = order[1]!;
      if (who === null) return json(401, { error: 'unauthenticated' });
      // Correct: the owner sees their order, a stranger gets a 404 that discloses nothing. So the
      // pack applies, a principal answers, and the assertion comes back **clean** — the same
      // zero-false-positive bar the input-handling case above asserts, one tier over.
      if (who !== OWNER_OF[id]) return json(404, { error: 'not found' });
      return json(200, { id, total: 41 });
    }
    json(404, { message: 'Not found' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-authz-'));
  try {
    await writeFile(
      join(dir, 'tflw.config'),
      `defaults\n  authorized target "${baseUrl}" reason "self-hosted end-to-end fixture"\n` +
        `\nenv local default\n  api "${baseUrl}"\n` +
        `\nsession shopper\n  api POST /login/shopper\n  capture body.token as token\n  header "Authorization" is "Bearer {token}"\n` +
        `\nsession peer\n  api POST /login/peer\n  capture body.token as token\n  header "Authorization" is "Bearer {token}"\n`,
      'utf8',
    );
    await writeFile(
      join(dir, 'authz.tflw'),
      `test "orders are owner-scoped" as shopper\n  api GET /orders/a1\n  expect status equals 200\n  expect response has no authorization violations\n`,
      'utf8',
    );

    const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir });
    assert.match(stdout, /1\/1 passed/);

    // Read from `report.html` rather than stdout, for the reason the input case gives: a passing
    // step prints only its name without `--verbose`, and the facts are in the step detail.
    const html = await readFile(join(dir, 'report', 'report.html'), 'utf8');
    // D316's probe line. Its presence is what proves the probe engine actually ran through the
    // bundle rather than the assertion short-circuiting — a suite with an empty probe set would
    // have failed through D285's door instead, so a *pass* with a probe count is the whole claim.
    assert.match(html, /principals probed/);
    // The rule pack reached the bundle too, not merely the prober.
    assert.match(html, /sec\/authz-object-leak/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

// Tier 1 through the bundle, **asserted rather than incidentally warmed**. This is the case
// `M134a-02` explains is missing even though `securityRules.ts` reads 19/19: coverage counted the
// scan D287 runs at session establishment, which nothing asserts on. A rule that stopped firing
// would keep that number and break nothing here until a real suite trusted it.
test('the built dist/cli.cjs runs a hygiene scan end to end and fails on a real weakness', async () => {
  const server: Server = createServer((_req, res) => {
    // One planted weakness and nothing else: a session cookie without `HttpOnly`, which is
    // `sec/cookie-not-httponly` exactly. Asserted as a **failure** rather than a pass, because a
    // clean Tier 1 run is indistinguishable from a Tier 1 scan that never ran — which is the
    // failure mode this test exists to catch.
    res
      .writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'sid=abc123; Path=/' })
      .end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-hygiene-'));
  try {
    await writeFile(
      join(dir, 'tflw.config'),
      `defaults\n  authorized target "${baseUrl}" reason "self-hosted end-to-end fixture"\nenv local default\n  api "${baseUrl}"\n`,
      'utf8',
    );
    await writeFile(
      join(dir, 'hygiene.tflw'),
      `test "response hygiene"\n  api GET /session\n  expect status equals 200\n  expect response has no security violations\n`,
      'utf8',
    );

    // A failing run exits non-zero, so the rejection *is* the assertion — `execFileAsync` throws and
    // the error carries the output.
    const err = await execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir }).then(
      () => null,
      (e: { code?: number; stdout?: string }) => e,
    );
    assert.ok(err, 'a planted weakness must fail the run through the shipped binary');
    assert.equal(err.code, 1, 'a failed assertion is exit 1, not a crash');
    assert.match(err.stdout ?? '', /sec\/cookie-not-httponly/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

// M135b (D404) — the other half of the write condition, and the one whose failure is silent.
//
// `upload-sarif` reads an empty `results` array as *everything previously reported is fixed* and
// resolves the matching alerts. A repository whose functional suite and security suite are separate
// CI jobs would therefore have the functional job close the security job's whole backlog — no error,
// no warning, a green run and an empty dashboard. So a run that did not scan must write **no file**,
// and that is a fact about the CLI's wiring, not about the builder: `buildSarifLog` returning
// `undefined` is worth nothing if `cli.ts` writes an empty document anyway.
test('the built dist/cli.cjs writes no findings.sarif for a run that never scanned', async () => {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-nosarif-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
    await writeFile(join(dir, 'plain.tflw'), `test "no scan here"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

    const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir });
    assert.match(stdout, /1\/1 passed/);

    // The other three artifacts are unconditional, so their presence is what proves the run wrote a
    // report at all — without that control, "no SARIF" could just mean "no report directory".
    const written = await readdir(join(dir, 'report'));
    assert.ok(written.includes('report.html') && written.includes('results.json') && written.includes('junit.xml'));
    assert.ok(!written.includes('findings.sarif'), 'an empty SARIF document is not neutral — it resolves every existing alert');
  } finally {
    await rm(dir, { recursive: true, force: true });
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

// M134b (D369/D386/D387/D388) — the gate, the baseline and the seeded layer, through the **built**
// binary.
//
// This test exists because of what `M134a`'s own CI run cost. The Tier 3 engine shipped with four
// unit suites and an in-process end-to-end file and nothing running the shipped bundle, and the
// coverage instrument — not any test — was what noticed: `c8`'s `exclude-after-remap` maps
// `dist/cli.cjs` back onto its sources, so every runtime function is counted twice and the bundle's
// copy of an unexercised engine reads as uncovered while its unit tests pass. `--fail-on`,
// `--baseline`, `--baseline-write` and `--probe-seeded` are four flags no unit test can reach: they
// exist only on the command line.
test('the built dist/cli.cjs applies --fail-on, writes a baseline, and reads it back', async () => {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const q = url.searchParams.get('sort') ?? '';
    // Discloses a stack frame to anything it dislikes — one real, reviewed, fingerprintable finding,
    // which is what makes the three flags below observable rather than vacuous (D291).
    if (q !== 'asc') {
      res.writeHead(500, { 'content-type': 'application/json' })
        .end('{"message":"Error: bad sort\\n    at OrderService.list (/usr/src/app/order.service.js:12:5)"}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":7,"status":"open"}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-gate-'));
  try {
    await writeFile(
      join(dir, 'tflw.config'),
      `defaults\n  authorized target "${baseUrl}" reason "self-hosted end-to-end fixture"\nenv local default\n  api "${baseUrl}"\n`,
      'utf8',
    );
    await writeFile(
      join(dir, 'gate.tflw'),
      `test "input handling"\n  api GET /orders/7?sort=asc\n  expect status equals 200\n  expect response has no input handling violations\n`,
      'utf8',
    );

    // 1. Ungated: the finding fails the build, which is the pre-M134b behaviour and the control for
    //    everything below. Without this the two green runs that follow would prove nothing — a gate
    //    that suppresses a finding and a scan that never found one look identical.
    const red = await execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir }).catch((e: { code?: number; stdout?: string }) => e);
    assert.equal((red as { code?: number }).code, 1, 'an ungated reviewed finding must fail the build');

    // 2. `--baseline-write` produces the accepted set. R8 fingerprints are 16 hex characters; a
    //    feature whose adoption step is hand-transcribing them is not adoptable, which is why this
    //    ships in the same milestone as `--baseline` rather than after it (D387).
    await execFileAsync('node', [cliEntry, 'run', '--no-color', '--baseline-write', 'accepted.json'], { cwd: dir }).catch(() => undefined);
    const written = JSON.parse(await readFile(join(dir, 'accepted.json'), 'utf8')) as { version: number; accepted: { fingerprint: string }[] };
    assert.equal(written.version, 1);
    assert.ok(written.accepted.length > 0, 'the baseline must contain the finding the run just made');
    assert.match(written.accepted[0]!.fingerprint, /^[0-9a-f]{16}$/);

    // 3. Reading it back turns the build green — and the finding is still in the report, badged.
    //    That second half is the one that matters: a baseline whose contents you cannot see is not
    //    reviewable, and a report that agreed with the gate would describe the gate, not the run.
    const { stdout: green } = await execFileAsync('node', [cliEntry, 'run', '--no-color', '--baseline', 'accepted.json'], { cwd: dir });
    assert.match(green, /1\/1 passed/);
    const html = await readFile(join(dir, 'report', 'report.html'), 'utf8');
    assert.match(html, /Security findings/);
    assert.match(html, /known\/accepted/);
    assert.match(html, new RegExp(written.accepted[0]!.fingerprint));

    // 4. `--fail-on critical` relaxes the same run a different way — the finding is `serious`, so it
    //    is reported and withheld. The gate can only ever relax (D386).
    const { stdout: relaxed } = await execFileAsync('node', [cliEntry, 'run', '--no-color', '--fail-on', 'critical'], { cwd: dir });
    assert.match(relaxed, /1\/1 passed/);

    // 5. `--probe-seeded` adds generated payloads that never gate. Asserted against the *census and
    //    findings block* rather than the exit code, because a green run with the layer on and a green
    //    run with it off are the same exit code — which is the whole point of D369 and also the way
    //    this test could have been vacuous.
    const { stdout: seeded } = await execFileAsync(
      'node',
      [cliEntry, 'run', '--no-color', '--baseline', 'accepted.json', '--probe-seeded', '4', '--seed', '24301'],
      { cwd: dir },
    );
    assert.match(seeded, /1\/1 passed/);
    const seededHtml = await readFile(join(dir, 'report', 'report.html'), 'utf8');
    assert.match(seededHtml, /seed 24301/);
    assert.match(seededHtml, /promote this payload/i);

    // 6. The usage errors, which are the reason both flags are parsed before any test runs (P#46).
    const badFailOn = await execFileAsync('node', [cliEntry, 'run', '--fail-on', 'high'], { cwd: dir }).catch((e: { stderr?: string }) => e);
    assert.match((badFailOn as { stderr?: string }).stderr ?? '', /not a severity/);
    const badSeeded = await execFileAsync('node', [cliEntry, 'run', '--probe-seeded', '9999'], { cwd: dir }).catch((e: { stderr?: string }) => e);
    assert.match((badSeeded as { stderr?: string }).stderr ?? '', /exceeds the 64-per-class bound/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('M137d — the repros tflw writes are not collected as tests by the next run', async () => {
  // The defect this pins is **latent since M130b** and was found by Tier 3's own e2e failing. The repro
  // emitter writes runnable `.tflw` files under `reportDir`, and `discoverTests` skipped only dotfiles,
  // `node_modules` and the user's own `exclude` — so a second bare `tflw run` in the same project picked
  // them up and ran them. They are built to FAIL until the bug is fixed, so a run that found one weakness
  // reported several failures, most of them tflw's own artifacts. Worse than noisy: the suite's pass/fail
  // stops being about the application.
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if ((url.searchParams.get('sort') ?? '') !== 'asc') {
      res.writeHead(500, { 'content-type': 'application/json' })
        .end('{"message":"Error: bad sort\\n    at OrderService.list (/usr/src/app/order.service.js:12:5)"}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":7,"status":"open"}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-repro-discovery-'));
  try {
    await writeFile(
      join(dir, 'tflw.config'),
      `defaults\n  authorized target "${baseUrl}" reason "self-hosted end-to-end fixture"\nenv local default\n  api "${baseUrl}"\n`,
      'utf8',
    );
    await writeFile(
      join(dir, 'one.tflw'),
      `test "input handling"\n  api GET /orders/7?sort=asc\n  expect response has no input handling violations\n`,
      'utf8',
    );

    // First run: finds the disclosure, fails, and writes the repros.
    await execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir }).catch(() => undefined);
    const repros = await readdir(join(dir, 'report', 'input-repro'));
    assert.ok(repros.length > 0, 'the first run must actually have written repros, or this proves nothing');

    // Second run: the same one test. The control is the COUNT — without the fix this run reported one
    // case per repro file on top of the real one, all failing, and the emitted files are still sitting
    // in the report dir while this assertion is made.
    const second = await execFileAsync('node', [cliEntry, 'run', '--no-color'], { cwd: dir }).catch((e: { stdout?: string }) => e as { stdout?: string });
    const out = second.stdout ?? '';
    assert.match(out, /0\/1 passed|1\/1 passed/, `the suite must still be one test, got:\n${out}`);
    for (const name of repros) {
      assert.ok(!out.includes(name.replace(/\.tflw$/, '')), `the run collected its own repro ${name}`);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
