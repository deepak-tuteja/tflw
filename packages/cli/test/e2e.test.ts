// Backfill: every other test in this monorepo calls library functions in-process via tsx — none
// of them would catch "the built dist/ artifact is broken but the source isn't" (a tsc config
// gap, a missing dist file in package.json's `files`, an ESM resolution issue that only shows up
// post-build). This is the one minimal smoke test that runs the actual distributable: build the
// workspace, then spawn `node dist/cli.js run` as a real subprocess against a real HTTP server.
// Found via /grill-me, 2026-07-05.

import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { mkdtemp, writeFile, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const cliEntry = join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');
const execFileAsync = promisify(execFile);

before(() => {
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'pipe' });
});

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

test('the built dist/cli.js runs a real test file against a real server and writes report.html', async () => {
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
      assert.match(junit, /<testsuite name="tflw" tests="1" failures="0"/);
      assert.match(junit, /<testcase name="health check"/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('the built dist/cli.js exits non-zero on a failing test, and still writes the report', async () => {
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
      assert.match(junit, /<testsuite name="tflw" tests="1" failures="1"/);
      assert.match(junit, /<failure /);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('`tflw --version`/`-v` print the real package version, injected at bundle time (decision 74b)', async () => {
  const { readFile: readPkg } = await import('node:fs/promises');
  const pkg = JSON.parse(await readPkg(join(repoRoot, 'packages', 'cli', 'package.json'), 'utf8')) as { version: string };

  const { stdout: long } = await execFileAsync('node', [cliEntry, '--version']);
  assert.equal(long.trim(), pkg.version);
  const { stdout: short } = await execFileAsync('node', [cliEntry, '-v']);
  assert.equal(short.trim(), pkg.version);
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

test('--workers with a non-positive-integer value is a usage error', async () => {
  await withFixtureServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-workers-'));
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'health.tflw'), `test "ok"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

      await assert.rejects(
        execFileAsync('node', [cliEntry, 'run', '--workers', '0', '--no-color'], { cwd: dir }),
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
      await writeFile(join(dir, 'a-crashes.tflw'), `import "./missing.tflw"\ntest "never runs"\n  api GET /health\n`, 'utf8');
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

test('random values are stable under --seed regardless of --workers concurrency (P#47)', async () => {
  async function runOnce(workers: number): Promise<string[]> {
    return withFixtureServer(async (baseUrl) => {
      const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-seed-workers-'));
      try {
        await writeFile(join(dir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
        for (const n of ['a', 'b', 'c']) {
          await writeFile(join(dir, `${n}.tflw`), `test "${n}"\n  let v = random number 1 to 1000000\n  api GET /health\n  expect status equals 200\n`, 'utf8');
        }
        await execFileAsync('node', [cliEntry, 'run', '--seed', '42', '--workers', String(workers), '--no-color'], { cwd: dir });
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

test('a `session` block in tflw.config runs once and its header applies to `as <session>` tests, redacted in the report (P#42)', async () => {
  const server: Server = createServer((req, res) => {
    if (req.url === '/auth/login' && req.method === 'POST') {
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
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-session-'));
  try {
    await writeFile(
      join(dir, 'tflw.config'),
      [
        `env local default`,
        `  api "${baseUrl}"`,
        ``,
        `session admin`,
        `  api POST /auth/login body { user: "a", pass: "b" }`,
        `  capture body.token as token`,
        `  header "Authorization" is "Bearer {token}"`,
        ``,
      ].join('\n'),
      'utf8',
    );
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
    assert.match(html, /reads orders/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('a session\'s generated values and step-splice target are stable under --workers concurrency (decision 53)', async () => {
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
        await execFileAsync('node', [cliEntry, 'run', '--seed', '42', '--workers', String(workers), '--no-color'], { cwd: dir });
        const html = await readFile(join(dir, 'report', 'report.html'), 'utf8');

        // `token = &quot;TOK-####&quot;` is the session's own `let` step detail — it renders only in
        // whichever test's report the session's steps were spliced into (the "owner"). The
        // session's *header* value (`Authorization: Bearer TOK-####`) legitimately appears in
        // every `as auth` test's request trace, so that substring alone can't distinguish the
        // owner from the other two tests — the `let` step detail can.
        const tokenPattern = /token = &quot;(TOK-\d{4})&quot; \(random\)/g;
        const [token] = [...html.matchAll(tokenPattern)].map((m) => m[1]!);
        if (!token) throw new Error(`no generated token found in report:\n${html}`);

        const sections = [...html.matchAll(/<section class="test[^"]*">[\s\S]*?<\/section>/g)].map((m) => m[0]);
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
  assert.equal(parallel.token, sequential.token, 'the same --seed must reproduce the session\'s generated value regardless of --workers concurrency');
  assert.equal(parallel.ownerTest, sequential.ownerTest, 'the same test must own the session\'s step-splice regardless of --workers concurrency');
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
    assert.equal(hits, 0, '`tflw check` must never make an HTTP request — it only parses and validates');
    await assert.rejects(access(join(dir, 'report', 'report.html')), '`tflw check` must not write a report — it never executes anything');
  } finally {
    await rm(dir, { recursive: true, force: true });
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
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

test('`tflw init` appends only the missing line(s) to an existing `.gitignore`, never duplicating (decision 82)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-init-gitignore-'));
  try {
    await writeFile(join(dir, '.gitignore'), 'node_modules/\n.env\n', 'utf8');

    const { stdout } = await execFileAsync('node', [cliEntry, 'init'], { cwd: dir });
    assert.match(stdout, /created tflw\.config, example\.tflw, \.env\.example, \.gitignore/);

    const gitignore = await readFile(join(dir, '.gitignore'), 'utf8');
    assert.equal(gitignore.match(/^\.env$/gm)?.length, 1, '.env must not be duplicated');
    assert.match(gitignore, /^report\/$/m);
    assert.match(gitignore, /^node_modules\/$/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
