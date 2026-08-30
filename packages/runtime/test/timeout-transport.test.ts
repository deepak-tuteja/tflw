// `M155a`/`D768`-`D772` — **`timeout api` and `timeout browser` narrow `timeout step`.**
//
// The grammar has five targets and the resolved shape has four: `step` is the fallback *input* and
// does not survive resolution (`D769`), so every one of the 23 runtime sites has to name a
// transport and one added later cannot inherit the shared budget by accident.
//
// Two halves. The first grades the **resolution rule**; the second grades its **effect** against a
// real socket, because a resolver test cannot tell a correctly resolved number from one nobody
// reads. The browser side of that effect is `browser-steps.test.ts`, whose short-budget fixtures
// moved from `step` to `browser` in this milestone and fail if a browser site reads anything else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfigSource, parseSource, Codes } from '@tflw/lang';
import { resolveConfig, selectEnv } from '../src/resolve.js';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig } from './support.js';

const resolved = (lines: readonly string[]) => {
  // An empty `defaults` is `TF015`, so the no-config case is written as the block being absent —
  // which is what a config that never mentions `timeout` actually looks like.
  const block = lines.length ? `defaults\n${lines.map((l) => `  ${l}`).join('\n')}\n\n` : '';
  const source = `${block}env local default\n  api "http://x.example"\n`;
  const parsed = parseConfigSource(source);
  assert.deepEqual(parsed.diagnostics.map((d) => `${d.code}: ${d.message}`), [], `fixture did not parse:\n${source}`);
  return resolveConfig(parsed.config!, selectEnv(parsed.config!, {}));
};

// `D768`'s table, all four rows. The third and fourth are the milestone; the second is the promise
// that no config already written changes meaning.
test('nothing written: both transports take 30s', () => {
  const t = resolved([]);
  assert.equal(t.timeouts.api, 30_000);
  assert.equal(t.timeouts.browser, 30_000);
});

test('`timeout step` alone still sets both — the pre-M155 behaviour, unchanged', () => {
  const t = resolved(['timeout step 10s']);
  assert.equal(t.timeouts.api, 10_000);
  assert.equal(t.timeouts.browser, 10_000);
});

test('`timeout browser` alone narrows the browser and leaves HTTP on the default', () => {
  const t = resolved(['timeout browser 60s']);
  assert.equal(t.timeouts.api, 30_000);
  assert.equal(t.timeouts.browser, 60_000);
});

// **The control** (`M141`'s class). A resolver that read the narrow key and dropped the broad one,
// or dropped the narrow key and kept the broad one, passes a one-sided assertion. Both halves are
// asserted in one test on purpose: the failure this is written against is a *swap*, and a swap
// looks correct from either end alone.
test('`timeout step 30s, api 10s`: the narrow key wins for HTTP and does not reach the browser', () => {
  const t = resolved(['timeout step 30s, api 10s']);
  assert.equal(t.timeouts.api, 10_000, 'the narrow `api` key was ignored and HTTP kept the broad budget');
  assert.equal(t.timeouts.browser, 30_000, 'the narrow `api` key leaked into the browser budget');
});

test('all four resolved fields, and no fifth', () => {
  const t = resolved(['timeout step 30s, api 10s, browser 60s, expect 1s, wait 90s']);
  assert.deepEqual({ ...t.timeouts }, { api: 10_000, browser: 60_000, expect: 1_000, wait: 90_000 });
});

// `D772` — the cross-tier case, which is the one a reader may reasonably expect to go the other
// way. Same-key-wins is applied *per key*, so an env writing the broad key does not reset a narrow
// key inherited from `defaults`; it only supplies the fallback for the transport that has none.
test('`defaults: timeout api 10s` + `env: timeout step 20s` resolves to api 10s, browser 20s', () => {
  const source = 'defaults\n  timeout api 10s\n\nenv staging default\n  api "http://x.example"\n  timeout step 20s\n';
  const parsed = parseConfigSource(source);
  assert.deepEqual(parsed.diagnostics, []);
  const t = resolveConfig(parsed.config!, selectEnv(parsed.config!, {}));
  assert.equal(t.timeouts.api, 10_000);
  assert.equal(t.timeouts.browser, 20_000);
});

test('an `env` may narrow a transport its `defaults` set broadly', () => {
  const source = 'defaults\n  timeout step 30s\n\nenv slowui default\n  api "http://x.example"\n  timeout browser 90s\n';
  const parsed = parseConfigSource(source);
  const t = resolveConfig(parsed.config!, selectEnv(parsed.config!, {}));
  assert.equal(t.timeouts.api, 30_000);
  assert.equal(t.timeouts.browser, 90_000);
});

// `D770` — the `0s` floor is a property of the target family, not a list of names. `TF071` is the
// parser's, so these read its diagnostics rather than resolving.
const codesFor = (line: string): string[] =>
  parseConfigSource(`defaults\n  ${line}\n\nenv local default\n  api "http://x.example"\n`).diagnostics.map((d) => d.code);

for (const target of ['step', 'api', 'browser']) {
  test(`\`timeout ${target} 0s\` is refused — a budget handed to an operation cannot be zero`, () => {
    assert.deepEqual(codesFor(`timeout ${target} 0s`), [Codes.INVALID_SETTING_VALUE]);
  });
}

for (const target of ['expect', 'wait']) {
  test(`\`timeout ${target} 0s\` stays legal — a poll ceiling tested after a read means "evaluate once"`, () => {
    assert.deepEqual(codesFor(`timeout ${target} 0s`), []);
  });
}

// The floor is 1ms and not 1s, and it was already so for `step`; asserted for the new pair because
// "refuses zero" and "refuses anything small" are different rules and only one of them is wanted.
test('a sub-second budget is legal for both new transports', () => {
  const t = resolved(['timeout api 50ms, browser 50ms']);
  assert.equal(t.timeouts.api, 50);
  assert.equal(t.timeouts.browser, 50);
});

test('`TF010` names all five targets, in budget-then-poll order', () => {
  const parsed = parseConfigSource('defaults\n  timeout nonsense 5s\n\nenv local default\n  api "http://x.example"\n');
  const d = parsed.diagnostics.find((x) => x.code === Codes.UNEXPECTED_TOKEN);
  assert.ok(d, 'expected TF010');
  assert.match(d.message, /expected a timeout target \(step\/api\/browser\/expect\/wait\)/);
});

test('both new targets parse in an `env` block as well as in `defaults`', () => {
  const source = 'env ci default\n  api "http://x.example"\n  timeout api 11s, browser 22s\n';
  const parsed = parseConfigSource(source);
  assert.deepEqual(parsed.diagnostics, []);
  const t = resolveConfig(parsed.config!, selectEnv(parsed.config!, {}));
  assert.equal(t.timeouts.api, 11_000);
  assert.equal(t.timeouts.browser, 22_000);
});

// `TF081` (`M165`) keys on `timeout <target>`, so the two new targets get the duplicate rule for
// free and — the half worth pinning — do not collide with each other or with `step`.
test('`TF081` separates the five targets and still catches a repeat of one', () => {
  const clean = parseConfigSource('defaults\n  timeout step 5s\n  timeout api 6s\n  timeout browser 7s\n\nenv local default\n  api "http://x.example"\n');
  assert.deepEqual(clean.diagnostics.filter((d) => d.code === Codes.CONFIG_DUPLICATE_KEY), []);
  const dup = parseConfigSource('defaults\n  timeout api 5s\n  timeout api 6s\n\nenv local default\n  api "http://x.example"\n');
  assert.equal(dup.diagnostics.filter((d) => d.code === Codes.CONFIG_DUPLICATE_KEY).length, 1);
});

// ---- The effect (`M155b`) --------------------------------------------------
//
// 8 HTTP sites moved to `timeouts.api` and 15 browser sites to `timeouts.browser`. The pair below
// is written against the failure that split can actually produce: not "a site reads no budget",
// which every existing timeout test already catches, but "a site reads the *other* transport's
// budget", which nothing in the repository would otherwise notice.

const slowServer = () =>
  startFixtureServer({
    '/slow': (_req, res) => {
      setTimeout(() => res.writeHead(200).end('finally'), 400);
    },
  });

const runSlow = async (timeouts: { api: number; browser: number }) => {
  const server = await slowServer();
  const source = 'test "slow"\n  api GET /slow\n  expect status equals 200\n';
  const { program } = parseSource(source);
  try {
    return await runProgram(program, testConfig(server.baseUrl, timeouts), { source });
  } finally {
    await server.close();
  }
};

test('an `api` step is bounded by `timeout api`', async () => {
  const { report } = await runSlow({ api: 100, browser: 5_000 });
  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /timed out after 100ms/);
});

// **The control.** A generous `timeout api` beside a punishing `timeout browser`: the request must
// finish. This fails on any implementation that left an HTTP site reading the browser budget — the
// exact residue an incomplete 23-site split leaves behind, and the one an "it timed out as
// configured" assertion is blind to, because it times out either way.
test('a browser budget of 50ms does not reach an HTTP request', async () => {
  const { report } = await runSlow({ api: 5_000, browser: 50 });
  assert.equal(report.ok, true, `an HTTP site is still reading the browser budget: ${report.tests[0]?.error ?? ''}`);
});
