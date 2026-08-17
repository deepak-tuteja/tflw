// M105 (`PLAN_M105_PICK_INTERRUPT.md`, review `M104-02`): Ctrl+C during `tflw pick`'s browser
// startup. Real `dist/cli.cjs`, real headed Chromium, real SIGINT — the `watch.test.ts` shape,
// for the same reason: `pick` never exits on its own, so it has to be driven as a long-running
// child rather than through `execFile`.
//
// **Nothing here sleeps.** Both interrupt windows are fired from a real signal, which is the whole
// point — the downstream guard that found this bug used a fixed `setTimeout(2000)` against a cold
// CI runner's browser launch, and that wall-clock guess is precisely why the failure showed up as
// an intermittent red check instead of as the defect it was:
//
//   * the pre-launch window fires on `opening <url>`, which the CLI prints immediately after
//     installing its handler — so seeing it *proves* the handler is installed;
//   * the mid-navigation window fires on the browser's own HTTP request for the page, which proves
//     the browser process exists and `goto` is in flight, and is then never answered.
//
// Both triggers exist on the pre-M105 build too, so each test below is a real control rather than
// a test written after the fact against the fix. Measured on the pre-fix build: the first exits
// `null` (killed by SIGINT, no handler anywhere), the second exits `2` with
// `error: page.goto: net::ERR_ABORTED` on stderr.

import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const cliEntry = join(repoRoot, 'packages', 'cli', 'dist', 'cli.cjs');

before(() => {
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'pipe' });
});

const PAGE_HTML = '<!doctype html><html><body><button id="go">Go</button></body></html>';

async function withServer<T>(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  try {
    return await fn(`http://127.0.0.1:${address.port}/`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
}

interface PickController {
  readonly stdout: () => string;
  readonly stderr: () => string;
  waitForStdout(marker: string, timeoutMs?: number): Promise<void>;
  /** Every live descendant of the CLI process — the browser Playwright spawned, and its own
   * children. Scoped to *this* child rather than a global `pgrep` so a concurrently-running
   * `watch.test.ts` (which also launches headed browsers) cannot pollute the count. */
  descendants(): number[];
  /** A real SIGINT, delivered the way a terminal Ctrl+C would. Resolves with the real exit code,
   * or `null` when the process was killed by a signal instead of exiting. */
  interrupt(): Promise<number | null>;
  readonly exited: Promise<number | null>;
}

function startPick(url: string, extraArgs: string[] = []): PickController {
  const child: ChildProcessWithoutNullStreams = spawn('node', [cliEntry, 'pick', url, ...extraArgs]);
  let out = '';
  let errOut = '';
  child.stdout.on('data', (d: Buffer) => {
    out += d.toString();
  });
  child.stderr.on('data', (d: Buffer) => {
    errOut += d.toString();
  });
  const exited = new Promise<number | null>((resolve) => {
    child.on('exit', (code) => resolve(code));
  });
  return {
    stdout: () => out,
    stderr: () => errOut,
    async waitForStdout(marker, timeoutMs = 60_000) {
      const deadline = Date.now() + timeoutMs;
      while (!out.includes(marker)) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${JSON.stringify(marker)}. stdout:\n${out}\nstderr:\n${errOut}`);
        await new Promise((r) => setTimeout(r, 25));
      }
    },
    descendants() {
      const raw = execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' });
      const children = new Map<number, number[]>();
      for (const line of raw.split('\n')) {
        const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
        if (!m) continue;
        const pid = Number(m[1]);
        const ppid = Number(m[2]);
        children.set(ppid, [...(children.get(ppid) ?? []), pid]);
      }
      const found: number[] = [];
      const walk = (pid: number): void => {
        for (const c of children.get(pid) ?? []) {
          found.push(c);
          walk(c);
        }
      };
      if (child.pid !== undefined) walk(child.pid);
      return found;
    },
    async interrupt() {
      child.kill('SIGINT');
      const code = await Promise.race([exited, new Promise<'HUNG'>((r) => setTimeout(() => r('HUNG'), 30_000))]);
      if (code === 'HUNG') {
        child.kill('SIGKILL');
        throw new Error(`\`tflw pick\` did not exit within 30s of SIGINT. stdout:\n${out}\nstderr:\n${errOut}`);
      }
      return code;
    },
    exited,
  };
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The negative contract this milestone actually owns (decision 187). Not `=== 0`: Playwright
 * registers its own SIGINT handler alongside ours, Node runs every listener, and whichever
 * terminates the process first decides the code — so 130 ("died from SIGINT", `EXIT_ABORTED`'s own
 * convention here) is equally clean and equally correct. `2` is `EXIT_USAGE`, documented as
 * "could not run", and is the thing that must never happen. */
function assertInterruptedCleanly(pick: PickController, code: number | null): void {
  assert.ok(code === 0 || code === 130, `expected a clean stop (0 or 130), got ${code}. stderr:\n${pick.stderr()}`);
  assert.ok(!pick.stderr().includes('error'), `Ctrl+C was reported to the user as an error:\n${pick.stderr()}`);
}

test('Ctrl+C before the browser has even spawned stops cleanly', async () => {
  // Pre-M105 control: no SIGINT listener exists yet at this point, so Node's default kill applies
  // and the process dies by signal — `exit` fires with a `null` code, which is not 0 and not 130.
  await withServer(
    (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE_HTML),
    async (url) => {
      const pick = startPick(url);
      await pick.waitForStdout(`opening ${url}`);
      assertInterruptedCleanly(pick, await pick.interrupt());
    },
  );
});

test('Ctrl+C while the page is still navigating stops cleanly and leaks no browser', async () => {
  // The CI failure, made deterministic: the request proves the browser is up and `goto` is in
  // flight, and it is never answered, so the window stays open until the signal closes it.
  // Pre-M105 control: exit 2 with `error: page.goto: net::ERR_ABORTED` on stderr.
  let onRequest: () => void = () => {};
  const navigating = new Promise<void>((resolve) => {
    onRequest = resolve;
  });
  await withServer(
    () => onRequest(), // never responds
    async (url) => {
      const pick = startPick(url);
      await pick.waitForStdout(`opening ${url}`);
      // Bounded, and racing the child's own exit — which it was not, and that was a defect in the
      // instrument rather than in `pick`. Every other wait in this file has a deadline; a bare
      // `await navigating` has none, so when the browser never asks for the page the test blocks
      // forever at zero CPU instead of failing. Both reasons it might not ask are real: the launch
      // can fail (`pick` then exits 2 and nothing will ever resolve this promise), or the box can
      // be too contended to get a headed Chromium up inside the window. Unbounded, either one held
      // fedora-box's whole-box lock until something outside killed it — 61 and 41 minutes, twice,
      // before a per-gate `timeout` bounded it from the outside and told us nothing about why.
      // The diagnosis belongs here, where the two causes are still distinguishable.
      let navTimer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          navigating,
          pick.exited.then((code) => {
            throw new Error(
              `\`tflw pick\` exited (${code}) before the browser ever requested the page.\nstdout:\n${pick.stdout()}\nstderr:\n${pick.stderr()}`,
            );
          }),
          new Promise<never>((_, reject) => {
            navTimer = setTimeout(
              () =>
                reject(
                  new Error(
                    `the browser never requested the page within 60s of \`opening ${url}\`.\nstdout:\n${pick.stdout()}\nstderr:\n${pick.stderr()}`,
                  ),
                ),
              60_000,
            );
          }),
        ]);
      } finally {
        if (navTimer !== undefined) clearTimeout(navTimer);
      }
      const browserPids = pick.descendants();
      // Control for the leak check below. Without this the "nothing survived" assertion passes
      // trivially on an empty list — a passing test of nothing.
      assert.ok(browserPids.length > 0, 'expected the CLI to have spawned a browser by the time it requested the page');

      assertInterruptedCleanly(pick, await pick.interrupt());

      // Playwright closes what it spawned on SIGINT, so this is a regression guard rather than a
      // repro: `M104-02` claimed the browser was "orphaned rather than closed", and it never was.
      await new Promise((r) => setTimeout(r, 2_000)); // teardown is async; this bounds it, it does not time it
      const survivors = browserPids.filter(alive);
      assert.deepEqual(survivors, [], `browser processes survived the interrupt: ${survivors.join(', ')}`);
    },
  );
});

test('a genuine launch failure still reports it and still exits 2', async () => {
  // The soundness half, and the reason `interrupted` is a flag rather than a match on the error
  // text. Nothing is interrupted here: the port is closed, `goto` fails for real, and that has to
  // stay a loud `EXIT_USAGE`. If this ever goes quiet, the fix above has started swallowing real
  // failures — a worse bug than the one it removed. Passes before and after M105 by design.
  const pick = startPick('http://127.0.0.1:1/');
  const code = await pick.exited;
  assert.equal(code, 2, `expected EXIT_USAGE, got ${code}. stderr:\n${pick.stderr()}`);
  assert.ok(pick.stderr().includes('error'), `expected a reported error, stderr was:\n${pick.stderr()}`);
});

test('the readiness line prints only once the page is actually up', async () => {
  // Decision 188's other half. The old single banner announced "click any element to print its
  // locator" *before* the launch, when there was no window and nothing to click — which is why the
  // downstream guard had to follow it with a fixed 2s sleep. Ordering, not wording, is the fix.
  await withServer(
    (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE_HTML),
    async (url) => {
      const pick = startPick(url);
      await pick.waitForStdout(`opening ${url}`);
      assert.ok(
        !pick.stdout().includes('click any element'),
        `the readiness line printed before the browser launched:\n${pick.stdout()}`,
      );
      await pick.waitForStdout('ready — click any element to print its locator');
      assertInterruptedCleanly(pick, await pick.interrupt());
    },
  );
});
