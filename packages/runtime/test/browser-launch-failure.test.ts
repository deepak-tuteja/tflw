// `M111` (review row `B6-03`) — teardown must not re-raise a launch that already failed.
//
// `BrowserManager.getBrowser()` memoizes the launch *promise*, so a rejected launch stays on the
// field. The step that asked for it handled the rejection and failed its test normally; `close()`
// then re-awaited that same rejected promise and threw it a second time. `cli.ts` awaits
// `browserManager.close()` **outside** its per-file `try/catch`, after the summary and after every
// artifact write, so the second throw reached `main`'s top-level `.catch` → `err(message)` →
// `process.exit(EXIT_USAGE)`. Measured: a run that printed `FAIL 1/2 passed, 1 failed` and wrote
// `report.html`, `junit.xml` and `results.json` in full exited `2` — which `cli.ts` defines as
// "usage / config error — could not run". It also printed the launch error a third time, after the
// summary, having already printed it live and against the failing step.
//
// **This is its own file for a mechanical reason, not a stylistic one.** Playwright reads
// `PLAYWRIGHT_BROWSERS_PATH` when its module is first loaded, so setting it inside a file that has
// already launched a browser does nothing — the first draft of this test lived at the end of
// `browser-steps.test.ts` and reported `Missing expected rejection`, i.e. it had quietly become a
// test against a *working* browser. A test whose whole premise is "the launch fails" has to run
// where nothing has launched yet.
//
// An empty `PLAYWRIGHT_BROWSERS_PATH` is the cheapest genuine launch failure available: no network,
// no uninstall, fails in milliseconds on a missing executable. It stands in for every other one —
// a missing peer dependency, no binary downloaded, a sandbox refusal, a corrupt install — because
// they all reject this one promise. The missing peer named in `B6-03` is merely the cheapest way a
// *reader* reaches it; a missing binary is the more common first run.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserManager } from '../src/browser.js';

test('`close()` after a failed launch resolves instead of re-throwing the launch error', async () => {
  const emptyBrowsers = await mkdtemp(join(tmpdir(), 'tflw-no-browsers-'));
  const previous = process.env.PLAYWRIGHT_BROWSERS_PATH;
  process.env.PLAYWRIGHT_BROWSERS_PATH = emptyBrowsers;
  try {
    const manager = new BrowserManager();

    // The launch really does fail. Without this the test would pass against a working browser and
    // assert nothing whatsoever — which is exactly what happened when it lived in the wrong file.
    await assert.rejects(() => manager.getBrowser(), /Executable doesn't exist|browserType\.launch/);

    // The claim: tearing down an already-reported failure adds nothing, so it stays silent.
    await manager.close();

    // And stays true on a second call — `close()` is documented as safe to call regardless.
    await manager.close();
  } finally {
    if (previous === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    else process.env.PLAYWRIGHT_BROWSERS_PATH = previous;
    await rm(emptyBrowsers, { recursive: true, force: true });
  }
});

test('`close()` still propagates a failure that is not the launch', async () => {
  // The soundness half. The fix swallows *the memoized launch rejection*, which has already been
  // reported through the step that requested it. It must not have turned `close()` into a
  // catch-all: a browser that launched fine and then failed to close is a different event, with no
  // prior report of its own, and silence there would be a new instance of the defect this row is
  // about rather than a fix for it.
  const manager = new BrowserManager();
  const boom = new Error('close failed');
  // Stand in for a launched browser whose `close()` rejects.
  (manager as unknown as { browserPromise: Promise<unknown> }).browserPromise = Promise.resolve({
    close: () => Promise.reject(boom),
  });
  await assert.rejects(() => manager.close(), /close failed/);
});
