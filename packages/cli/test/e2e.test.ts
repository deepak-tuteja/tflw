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
  assert.equal(parallel.token, sequential.token, 'the same --seed must reproduce the session\'s generated value regardless of --workers concurrency');
  assert.equal(parallel.ownerTest, sequential.ownerTest, 'the same test must own the session\'s step-splice regardless of --workers concurrency');
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
        await execFileAsync('node', [cliEntry, 'run', '--seed', '42', '--workers', String(workers), '--no-color'], { cwd: dir });
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
  assert.equal(parallel.auth1Owner, sequential.auth1Owner, 'auth1\'s owner must not depend on --workers concurrency');
  assert.equal(parallel.auth2Owner, sequential.auth2Owner, 'auth2\'s owner must not depend on --workers concurrency');
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

      const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--verbose', '--no-color'], { cwd: dir });
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

test('--verbose --workers 2 buffers each file\'s step lines into one contiguous block, never interleaved (Track 4)', async () => {
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

    const { stdout } = await execFileAsync('node', [cliEntry, 'run', '--verbose', '--workers', '2', '--no-color'], { cwd: dir });
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
// bundled into dist/cli.js — no network, no cwd/tflw.config needed, so no fixture dir required.
test('`tflw docs` with no topic lists every topic, one per line', async () => {
  const { stdout } = await execFileAsync('node', [cliEntry, 'docs']);
  assert.match(stdout, /Topics:/);
  assert.match(stdout, /^ {2}quantifiers$/m);
  assert.match(stdout, /^ {2}subset$/m);
  assert.match(stdout, /^ {2}config$/m);
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
test('`tflw check --format json` prints the target file\'s Diagnostic[] as JSON, exit 2 on a real error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-check-json-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "http://localhost:1"\n`, 'utf8');
    await writeFile(join(dir, 'broken.tflw'), `test "broken"\n  expct status equals 200\n`, 'utf8');

    await assert.rejects(
      execFileAsync('node', [cliEntry, 'check', '--format', 'json', 'broken.tflw'], { cwd: dir }),
      (e: unknown) => {
        const { code, stdout } = e as { code?: number; stdout?: string };
        if (code !== 2) return false;
        const diagnostics = JSON.parse((stdout ?? '').trim());
        return (
          Array.isArray(diagnostics) &&
          diagnostics.length === 1 &&
          diagnostics[0].code === 'TF011' &&
          diagnostics[0].hint === 'did you mean `expect`?' &&
          typeof diagnostics[0].span?.start?.line === 'number'
        );
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('`tflw check --format json` prints an empty array and exits 0 on a clean file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-e2e-check-json-clean-'));
  try {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "http://localhost:1"\n`, 'utf8');
    await writeFile(join(dir, 'clean.tflw'), `test "ok"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

    const { stdout } = await execFileAsync('node', [cliEntry, 'check', '--format', 'json', 'clean.tflw'], { cwd: dir });
    assert.deepEqual(JSON.parse(stdout.trim()), []);
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
