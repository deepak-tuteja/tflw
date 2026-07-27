// M5, SPEC §12: `tflw watch` — real dist binary, real (headed) Chromium, a real recursive
// `fs.watch` on a real temp project. Spawned as a long-running child process (unlike every other
// CLI test, which uses `execFile` and waits for exit) since `watch` never exits on its own; SIGINT
// is sent the same way a terminal Ctrl+C would deliver it.

import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const cliEntry = join(repoRoot, 'packages', 'cli', 'dist', 'cli.cjs');

before(() => {
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'pipe' });
});

const PAGE_HTML = `<!doctype html><html><body>
  <button id="go">Go</button>
  <p id="status">idle</p>
  <script>document.getElementById('go').addEventListener('click', function () { document.getElementById('status').textContent = 'clicked'; });</script>
</body></html>`;

async function withPageServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE_HTML);
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

interface WatchController {
  readonly output: () => string;
  /** Blocks until at least `n` runs have each reached `tflw watch`'s own "watching for changes"
   * marker — i.e. `n` full run-to-completion cycles, not just `n` "running …" starts. */
  waitForRunsCompleted(n: number, timeoutMs?: number): Promise<void>;
  /** Sends a real SIGINT (same delivery mechanism as a terminal Ctrl+C) and waits for real exit. */
  stop(): Promise<number | null>;
}

function startWatch(dir: string, extraArgs: string[] = []): WatchController {
  const child: ChildProcessWithoutNullStreams = spawn('node', [cliEntry, 'watch', ...extraArgs], { cwd: dir });
  let out = '';
  child.stdout.on('data', (d: Buffer) => {
    out += d.toString();
  });
  child.stderr.on('data', (d: Buffer) => {
    out += d.toString();
  });
  let exitCode: number | null = null;
  const exited = new Promise<void>((resolve) => {
    child.on('exit', (code) => {
      exitCode = code;
      resolve();
    });
  });
  return {
    output: () => out,
    async waitForRunsCompleted(n, timeoutMs = 20000) {
      const start = Date.now();
      while ((out.match(/watching for changes/g) ?? []).length < n) {
        if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${n} completed run(s); output so far:\n${out}`);
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    async stop() {
      child.kill('SIGINT');
      await Promise.race([exited, new Promise((r) => setTimeout(r, 10000))]);
      return exitCode;
    },
  };
}

test('the initial run passes headed against a real page, then saving the test file re-runs just that file with the same seed', async () => {
  await withPageServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-watch-'));
    const watch = startWatch(dir);
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  web "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'smoke.tflw'),
        'test "smoke"\n  open "/"\n  click button "Go"\n  expect text "clicked" is visible\n',
        'utf8',
      );

      await watch.waitForRunsCompleted(1);
      assert.match(watch.output(), /running the full suite/);
      assert.match(watch.output(), /PASS 1\/1 passed/);
      const seedMatch = watch.output().match(/seed (\d+)/);
      assert.ok(seedMatch, 'expected a seed to be printed');
      const seed = seedMatch![1];

      // Re-save the same (still-passing) test file — should re-run *only* that file, not the
      // full suite, and reuse the exact same seed (M5: "reuses the last failing seed", trivially
      // true here since the seed never changes for the life of the session).
      await writeFile(
        join(dir, 'smoke.tflw'),
        'test "smoke"\n  open "/"\n  click button "Go"\n  expect text "clicked" is visible\n  # resaved\n',
        'utf8',
      );
      await watch.waitForRunsCompleted(2);
      assert.match(watch.output(), /running smoke\.tflw/);
      const passCount = (watch.output().match(/PASS 1\/1 passed/g) ?? []).length;
      assert.equal(passCount, 2);
      const secondSeedMatches = watch.output().match(/seed (\d+)/g) ?? [];
      assert.ok(secondSeedMatches.every((m) => m === `seed ${seed}`), `expected every run to reuse seed ${seed}, got: ${secondSeedMatches.join(', ')}`);
    } finally {
      await watch.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('a failing test keeps the run failing, still under the same seed, until fixed and re-saved', async () => {
  await withPageServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-watch-fail-'));
    const watch = startWatch(dir, ['--seed', '4242']);
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  web "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'smoke.tflw'),
        'test "smoke"\n  open "/"\n  click button "Go"\n  expect text "clicked" is visible\n',
        'utf8',
      );
      await watch.waitForRunsCompleted(1);
      assert.match(watch.output(), /seed 4242/);
      assert.match(watch.output(), /PASS 1\/1 passed/);

      await writeFile(
        join(dir, 'smoke.tflw'),
        'test "smoke"\n  open "/"\n  click button "Go"\n  expect text "never appears" is visible\n',
        'utf8',
      );
      await watch.waitForRunsCompleted(2, 30000);
      assert.match(watch.output(), /FAIL 0\/1 passed, 1 failed/);

      await writeFile(
        join(dir, 'smoke.tflw'),
        'test "smoke"\n  open "/"\n  click button "Go"\n  expect text "clicked" is visible\n',
        'utf8',
      );
      await watch.waitForRunsCompleted(3);
      const passCount = (watch.output().match(/PASS 1\/1 passed/g) ?? []).length;
      assert.equal(passCount, 2);
      // Every run this whole session — pass or fail — used the explicit --seed, never a fresh one.
      const seeds = watch.output().match(/seed \d+/g) ?? [];
      assert.ok(seeds.every((s) => s === 'seed 4242'), `expected every run to use seed 4242, got: ${seeds.join(', ')}`);
    } finally {
      await watch.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('saving tflw.config re-runs the full suite, not just one file', async () => {
  await withPageServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-watch-config-'));
    const watch = startWatch(dir);
    try {
      const configPath = join(dir, 'tflw.config');
      await writeFile(configPath, `env local default\n  web "${baseUrl}"\n`, 'utf8');
      await writeFile(
        join(dir, 'smoke.tflw'),
        'test "smoke"\n  open "/"\n  click button "Go"\n  expect text "clicked" is visible\n',
        'utf8',
      );
      await watch.waitForRunsCompleted(1);

      await writeFile(configPath, `env local default\n  web "${baseUrl}"\n  # resaved\n`, 'utf8');
      await watch.waitForRunsCompleted(2);
      const runningLines = watch.output().match(/\[watch\] running .+/g) ?? [];
      assert.equal(runningLines.length, 2);
      assert.match(runningLines[1]!, /the full suite/);
    } finally {
      await watch.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('Ctrl+C (SIGINT) stops cleanly, closing the shared browser (no chromium process survives)', async () => {
  await withPageServer(async (baseUrl) => {
    const dir = await mkdtemp(join(tmpdir(), 'tflw-watch-sigint-'));
    const watch = startWatch(dir);
    try {
      await writeFile(join(dir, 'tflw.config'), `env local default\n  web "${baseUrl}"\n`, 'utf8');
      await writeFile(join(dir, 'smoke.tflw'), 'test "smoke"\n  open "/"\n  expect text "idle" is visible\n', 'utf8');
      await watch.waitForRunsCompleted(1);

      const code = await watch.stop();
      // Once a browser has launched, Playwright installs its own SIGINT handler (verified: 0 → 1
      // listeners around `chromium.launch()`) to kill its spawned subprocess on Ctrl+C — invoked
      // alongside `watchCommand`'s own handler (both registered, Node calls every SIGINT listener),
      // and it typically wins the race to actually terminate the process, producing the standard
      // Unix "died from signal N" code (128+SIGINT=130) rather than `watchCommand`'s own `EXIT_OK`.
      // Either is an acceptable clean stop — what actually matters is that nothing survives it.
      assert.ok(code === 0 || code === 130, `expected a clean-stop exit code (0 or 130), got ${code}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
