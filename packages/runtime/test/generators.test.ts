// M2: `unique`/`random` generators + seeded reproducibility (P#19, P#21–23). `unique` guarantees
// distinctness via a monotonic counter (not randomness); `random` is deterministic per `--seed`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram, makeUniqueSeq } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';
import { asEntry } from './__helpers__/entry.js';

test('the same seed reproduces identical `random` values; a different seed changes them', async () => {
  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 201, { ok: true }) });

  const source = `test "gen"
  let qty = random number 1 to 1000000
  let price = random decimal 0 to 100
  let color = random of "red", "blue", "green", "yellow", "purple"
  let token = random string 16
  let code = random like "SKU-####-??"
  api POST /orders body { qty: {qty} }
  expect status equals 201
`;
  const { program } = parseSource(source);
  const config = testConfig(server.baseUrl);

  const runA = await runProgram(program, config, { source, seed: 42 });
  const runB = await runProgram(program, config, { source, seed: 42 });
  const runC = await runProgram(program, config, { source, seed: 7 });

  const detailsA = asEntry(runA.report.tests[0], 'functional').steps.slice(0, 5).map((s) => s.detail);
  const detailsB = asEntry(runB.report.tests[0], 'functional').steps.slice(0, 5).map((s) => s.detail);
  const detailsC = asEntry(runC.report.tests[0], 'functional').steps.slice(0, 5).map((s) => s.detail);

  assert.deepEqual(detailsA, detailsB, 'same seed must reproduce the exact same generated values');
  assert.notDeepEqual(detailsA, detailsC, 'a different seed should (overwhelmingly likely) differ');
  assert.equal(runA.report.seed, 42);
  assert.equal(runC.report.seed, 7);
  for (const d of detailsA) assert.match(d ?? '', /\(random\)$/);

  await server.close();
});

test('`random number`/`random decimal` with a reversed range fail clearly instead of silently producing an out-of-range value (decision 70)', async () => {
  const numberSource = `test "reversed number range"
  let qty = random number 10 to 5
  expect status equals 200
`;
  const { program: numberProgram } = parseSource(numberSource);
  const { report: numberReport } = await runProgram(numberProgram, testConfig('http://127.0.0.1:1'), { source: numberSource });
  assert.equal(numberReport.ok, false);
  assert.match(asEntry(numberReport.tests[0], 'functional').error ?? '', /random number 10 to 5.*`to` must be ≥ `from`/);

  const decimalSource = `test "reversed decimal range"
  let price = random decimal 10.5 to 2.5
  expect status equals 200
`;
  const { program: decimalProgram } = parseSource(decimalSource);
  const { report: decimalReport } = await runProgram(decimalProgram, testConfig('http://127.0.0.1:1'), { source: decimalSource });
  assert.equal(decimalReport.ok, false);
  assert.match(asEntry(decimalReport.tests[0], 'functional').error ?? '', /random decimal 10\.5 to 2\.5.*`to` must be ≥ `from`/);
});

test('`random date between` with the bounds reversed fails instead of returning a date before `from` (M124-01)', async () => {
  // **Spelled through a `let` on purpose.** `TF054` now decides the same-anchor case before the run,
  // so a fixture written `random date between today and today - 10 days` would be refused by the
  // checker and never reach this throw — and a runtime rule no suite can provoke is the `M97a-09`
  // trap, a manifest row describing a rule that is not there. A reference is what the checker
  // declines to type, so it is what leaves the throw reachable.
  const source = `test "reversed date range"
  let past = today - 10 days
  let when = random date between today and {past}
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig('http://127.0.0.1:1'), { source });
  assert.equal(report.ok, false);
  assert.match(asEntry(report.tests[0], 'functional').error ?? '', /random date between .*`to` must be ≥ `from`/);
});

test('`random string` with a negative length fails instead of returning the empty string (M124-02)', async () => {
  // Through a `let` for the same reason as above: the literal `random string -3` is `TF054` now.
  const source = `test "negative length"
  let n = 0 - 3
  let s = random string {n}
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig('http://127.0.0.1:1'), { source });
  assert.equal(report.ok, false);
  assert.match(asEntry(report.tests[0], 'functional').error ?? '', /random string -3: length must be 0 or more/);
});

test('`random string 0` stays legal and produces the empty string (D629)', async () => {
  // The positive half of the ruling, and the control that keeps the throw above from widening into
  // "any length that produces nothing": the empty string is a string of length 0, so the generator
  // kept its promise and the run is clean.
  const server = await startFixtureServer({ '/health': (_req, res) => res.writeHead(200).end('ok') });
  const source = `test "zero length"
  let s = random string 0
  api GET /health
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, true);
  assert.match(asEntry(report.tests[0], 'functional').steps[0]!.detail ?? '', /""/);
  await server.close();
});

test('`unique(...)`/`unique email`/`unique number` are guaranteed distinct across a run', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => res.writeHead(200).end('ok') });

  const letLines = Array.from({ length: 15 }, (_, i) => `  let order${i} = unique("order")`).join('\n');
  const source = `test "uniques"
${letLines}
  let a = unique email
  let b = unique email
  let c = unique number
  let d = unique number
  api GET /health
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const details = asEntry(report.tests[0], 'functional').steps.slice(0, 19).map((s) => s.detail);
  assert.equal(new Set(details).size, 19, 'every unique(...)/unique email/unique number value must be distinct');
  for (const d of details) assert.match(d ?? '', /\(unique\)$/);

  await server.close();
});

// Decision 52 backfill: `today`/`now`/`random date in past`/`in future` used to anchor on
// wall-clock `Date.now()`, so `--seed` alone never reproduced them across separate invocations.
// They now derive from one run-clock (`--now`, or the real instant otherwise) threaded through
// `EvalCtx`, so `--seed` + `--now` together reproduce absolute dates exactly.
test('the same seed AND `now` reproduce identical `random date in past`/`in future` values', async () => {
  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 201, { ok: true }) });

  const source = `test "dates"
  let past = random date in past
  let future = random date in future
  api POST /orders body { past: {past} }
  expect status equals 201
`;
  const { program } = parseSource(source);
  const config = testConfig(server.baseUrl);

  const runA = await runProgram(program, config, { source, seed: 42, now: '2026-01-01T00:00:00.000Z' });
  const runB = await runProgram(program, config, { source, seed: 42, now: '2026-01-01T00:00:00.000Z' });
  const runC = await runProgram(program, config, { source, seed: 42, now: '2027-06-15T00:00:00.000Z' });

  const detailsA = asEntry(runA.report.tests[0], 'functional').steps.slice(0, 2).map((s) => s.detail);
  const detailsB = asEntry(runB.report.tests[0], 'functional').steps.slice(0, 2).map((s) => s.detail);
  const detailsC = asEntry(runC.report.tests[0], 'functional').steps.slice(0, 2).map((s) => s.detail);

  assert.deepEqual(detailsA, detailsB, 'same seed + same `now` must reproduce the exact same dates');
  assert.notDeepEqual(detailsA, detailsC, 'the same seed with a different `now` anchor must produce different absolute dates');
  assert.equal(runA.report.now, '2026-01-01T00:00:00.000Z');
  assert.equal(runC.report.now, '2027-06-15T00:00:00.000Z');
  for (const d of detailsA) assert.match(d ?? '', /\(random\)$/);

  await server.close();
});

test('`today`/`now` derive from the run clock, not wall-clock `Date.now()` at evaluation time', async () => {
  // Comparison-based (not a hardcoded date string) so the test is timezone-independent: whatever
  // the runner's local timezone, the same `--now` must format identically across two runs, and a
  // different `--now` must format differently.
  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 201, { ok: true }) });

  const source = `test "today and now"
  let d = format today as "yyyy-MM-dd"
  let n = format now as "yyyy-MM-dd HH:mm:ss"
  api POST /orders body { d: {d} }
  expect status equals 201
`;
  const { program } = parseSource(source);
  const config = testConfig(server.baseUrl);

  const runA = await runProgram(program, config, { source, now: '2026-03-15T12:34:56.000Z' });
  const runB = await runProgram(program, config, { source, now: '2026-03-15T12:34:56.000Z' });
  const runC = await runProgram(program, config, { source, now: '2030-11-02T08:00:00.000Z' });
  for (const r of [runA, runB, runC]) assert.equal(r.report.ok, true, JSON.stringify(r.report.tests[0], null, 2));

  const detailsA = asEntry(runA.report.tests[0], 'functional').steps.slice(0, 2).map((s) => s.detail);
  const detailsB = asEntry(runB.report.tests[0], 'functional').steps.slice(0, 2).map((s) => s.detail);
  const detailsC = asEntry(runC.report.tests[0], 'functional').steps.slice(0, 2).map((s) => s.detail);

  assert.deepEqual(detailsA, detailsB, 'the same `now` must format identically across separate runs');
  assert.notDeepEqual(detailsA, detailsC, 'a different `now` must format differently');

  await server.close();
});

test('`unique like` renders the pattern and stays distinct across calls', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => res.writeHead(200).end('ok') });

  const source = `test "unique like"
  let a = unique like "ORD-######"
  let b = unique like "ORD-######"
  api GET /health
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const details = asEntry(report.tests[0], 'functional').steps.slice(0, 2).map((s) => s.detail);
  const [a, b] = details;
  // Two steps with a detail each is this test's premise, not an incidental — `slice(0, 2)` on a
  // report with one step yields one element, and the two `assert.match` calls below would then
  // throw on `undefined` rather than fail a claim about generated values.
  assert.ok(a && b, `expected two generated steps with details, got ${JSON.stringify(details)}`);
  assert.match(a, /^a = "ORD-\d{6}" \(unique\)$/);
  assert.match(b, /^b = "ORD-\d{6}" \(unique\)$/);
  assert.notEqual(a, b);

  await server.close();
});

// `M154g-07` — the test above draws two values and asserts they differ, and the *pre-fix*
// implementation passed it: it keyed a local RNG off the run-wide counter, filled the pattern from
// that RNG, and then discarded the counter, so distinctness was probabilistic (1-in-10^6 for the
// documented pattern) while SPEC §7.2 promised the whole `unique` family was guaranteed. Two draws
// cannot tell a guarantee from a coin-flip. This one draws a small pattern's **entire** value space
// and asserts every value is distinct, which is the guarantee itself rather than a sample of it —
// under the old implementation ten draws of `ORD-##` already produced `ORD-85` three times
// (measured on `fedora-box`, `--seed 4242`), so a hundred is not a probabilistic argument.
test('`unique like` fills its whole value space without a collision, then refuses to overflow it', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => res.writeHead(200).end('ok') });

  const draws = (n: number) => Array.from({ length: n }, (_unused, i) => `  let v${i} = unique like "ORD-##"`).join('\n');
  const sourceFor = (n: number) => `test "unique like x${n}"\n${draws(n)}\n  api GET /health\n  expect status equals 200\n`;

  const full = sourceFor(100);
  const { report: rFull } = await runProgram(parseSource(full).program, testConfig(server.baseUrl), { source: full });
  assert.equal(rFull.ok, true, JSON.stringify(rFull.tests[0], null, 2));
  const values = asEntry(rFull.tests[0], 'functional').steps.slice(0, 100).map((s) => {
    const m = s.detail!.match(/^v\d+ = "([^"]+)" \(unique\)$/);
    assert.ok(m, `expected a tagged unique detail, got: ${s.detail}`);
    return m[1]!;
  });
  for (const v of values) assert.match(v, /^ORD-\d{2}$/);
  assert.equal(new Set(values).size, 100, '100 codes must yield 100 distinct values, not 100 draws from 100 codes');

  // The counter is shared with the rest of the family (SPEC §7.5), so a narrow pattern can genuinely
  // run out. It throws rather than wrapping, and the message names both numbers — wrapping silently
  // would put the false guarantee straight back, which is the whole of this repair.
  const over = sourceFor(101);
  const { report: rOver } = await runProgram(parseSource(over).program, testConfig(server.baseUrl), { source: over });
  assert.equal(rOver.ok, false);
  assert.match(asEntry(rOver.tests[0], 'functional').error ?? '', /can encode at most 100 distinct values/);
  assert.match(asEntry(rOver.tests[0], 'functional').error ?? '', /counter has already reached 100/);

  await server.close();
});

// `M154g-15` — the old `unique like` seeded its RNG with `subSeed(runSeed, counter)`, which is the
// *same* expression, over the same run seed, that keys a test's own `random` stream from its index
// (`interpreter.ts`'s `testSeed`). One sub-seed space, two unrelated indices: `unique like`'s k-th
// draw in a run rendered test k's `random` stream verbatim. Pinned to a seed, so this asserts a
// deterministic separation rather than betting on two random values differing.
test('`unique like` does not render some test\'s own `random` stream (`M154g-15`)', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => res.writeHead(200).end('ok') });

  const source = `test "t0"
  let r0 = random like "####"
  let u0 = unique like "AAA-####"
  api GET /health
  expect status equals 200

test "t1"
  let r1 = random like "####"
  api GET /health
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, seed: 4242 });
  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));

  const digits = (detail: string) => detail.match(/"(?:AAA-)?(\d{4})"/)![1]!;
  const r0 = digits(asEntry(report.tests[0], 'functional').steps[0]!.detail!);
  const u0 = digits(asEntry(report.tests[0], 'functional').steps[1]!.detail!);
  const r1 = digits(asEntry(report.tests[1], 'functional').steps[0]!.detail!);

  // Counter 0 used to reproduce test 0's stream; counter 1 reproduced test 1's. Both directions.
  assert.notEqual(u0, r0, '`unique like` must not replay the drawing test\'s `random` stream');
  assert.notEqual(u0, r1, '`unique like` must not replay another test\'s `random` stream either');

  await server.close();
});

// `unique like` and `random like` share the pattern language and are told apart by which axis each
// one moves on — the discriminator, and the reason this is asserted in both directions in one test.
// `M181a` (`D931`) gives that discriminator its second axis rather than a caveat: **`random` moves
// with `--seed` and not with the clock; `unique` moves with `--now` and not with the seed.** Before
// `M181a` the `unique` half of that was "moves with neither", which is what made a second run
// against a live database re-issue the first run's values (`M162-01`).
//
// Every value below is pinned by an explicit `--seed` and `--now`, so all four assertions are
// deterministic — the two `notEqual`s are not bets on two draws from a 10^6 space differing.
test('`unique like` moves with the clock and not the seed; `random like` the other way round', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => res.writeHead(200).end('ok') });

  const source = `test "keying"
  let u = unique like "ORD-######"
  let r = random like "ORD-######"
  api GET /health
  expect status equals 200
`;
  const { program } = parseSource(source);
  const draw = async (seed: number, now: string) => {
    const { report } = await runProgram(program, testConfig(server.baseUrl), { source, seed, now });
    assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
    return asEntry(report.tests[0], 'functional').steps.slice(0, 2).map((st) => st.detail!.match(/"(ORD-\d{6})"/)![1]!);
  };

  const [u1, r1] = await draw(4242, '2026-07-06T00:00:00.000Z');
  const [u2, r2] = await draw(9999, '2026-07-06T00:00:00.000Z');
  const [u3, r3] = await draw(4242, '2027-07-06T00:00:00.000Z');

  assert.equal(u1, u2, '`unique like` must not move with the seed — it renders a counter, not a draw');
  assert.notEqual(u1, u3, '`unique like` must move with the run clock — that is the run namespace (`D929`)');
  assert.notEqual(r1, r2, '`random like`, on the same pattern, must move with the seed');
  assert.equal(r1, r3, '`random like` must not move with the clock — no `random like` draw touches it');

  await server.close();
});

// `M181a` (`D929`–`D932`), the milestone's own acceptance in miniature. `M162-01` measured thirteen
// API tests degrading on a second `tflw run` against one live stack, twelve of them one column:
// `user<counter>@example.test` restarts at `user0` every run while `user.email` outlives it. So the
// property under test is not "distinct within this run" — that has held since M2 — but **two runs
// draw disjoint values**, which is what a database sees.
//
// `unique uuid` is graded apart from the other four because it is the one member with a seed-derived
// half: its shape bytes move with `--seed` by design (they are v4 realism and carry no part of the
// guarantee), while the two halves that DO carry it — the run namespace in bytes 8-11 and the
// counter in bytes 12-15 — must not. Asserting the whole string were seed-stable would be asserting
// the wrong thing about it, and asserting nothing would leave `--seed N` free to re-issue a run's
// uuids wholesale, which is exactly what it did until this milestone.
test('two runs of the same file draw disjoint `unique` values, and `--seed` + `--now` replays them exactly', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => res.writeHead(200).end('ok') });

  const source = `test "the whole family"
  let p = unique("Widget")
  let e = unique email
  let n = unique number
  let l = unique like "ORD-######"
  let u = unique uuid
  api GET /health
  expect status equals 200
`;
  const { program } = parseSource(source);
  const draw = async (seed: number, now: string): Promise<string[]> => {
    const { report } = await runProgram(program, testConfig(server.baseUrl), { source, seed, now });
    assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
    return asEntry(report.tests[0], 'functional').steps.slice(0, 5).map((st) => st.detail!.match(/= "?([^"]+?)"? \(unique\)$/)![1]!);
  };

  const T1 = '2026-07-06T09:00:00.000Z';
  const T2 = '2026-07-06T09:02:00.000Z'; // two minutes later — the gap between two runs of one suite
  const a = await draw(4242, T1);
  const b = await draw(4242, T1);
  const c = await draw(9999, T1);
  const d = await draw(4242, T2);

  assert.deepEqual(a, b, '`--seed` + `--now` together must reproduce a run exactly (§7.4)');
  assert.deepEqual(a.slice(0, 4), c.slice(0, 4), 'the four non-uuid members must not move with the seed — `unique` never consults the RNG (`M154g-07`)');

  // The whole point, and the shape a database sees: nothing a later run issues may repeat anything
  // an earlier one did.
  const overlap = a.filter((v) => d.includes(v));
  assert.deepEqual(overlap, [], `two runs two minutes apart must share no \`unique\` value at all — shared: ${JSON.stringify(overlap)}`);

  // `unique uuid`, graded on its two halves. Group 4 and the first half of group 5 are the run
  // namespace; the trailing 8 hex digits are the counter.
  const uuidOf = (vals: string[]): string => vals[4]!;
  const namespaceBytes = (u: string): string => u.slice(19, 23) + u.slice(24, 28);
  const counterBytes = (u: string): string => u.slice(-8);
  assert.equal(counterBytes(uuidOf(a)), counterBytes(uuidOf(c)), 'a uuid\'s counter digits must not move with the seed');
  assert.equal(namespaceBytes(uuidOf(a)), namespaceBytes(uuidOf(c)), 'a uuid\'s namespace digits must not move with the seed either');
  assert.notEqual(uuidOf(a), uuidOf(c), 'a uuid\'s shape half is seed-derived — v4 realism, and it does move');
  assert.equal(counterBytes(uuidOf(a)), counterBytes(uuidOf(d)), 'the counter restarts at the same place in the next run — which is why the namespace has to be the thing that differs');
  assert.notEqual(namespaceBytes(uuidOf(a)), namespaceBytes(uuidOf(d)), 'a uuid\'s namespace digits must move with the run clock');

  await server.close();
});

// `unique number` is the one member whose value space is bounded by something other than a pattern:
// the run namespace takes 30 of a JavaScript safe integer's 53 bits, leaving 2^23 counter values.
// Past that, `namespace * 2^23 + counter` stops being exact and two counters could round onto one
// double — a silent repeat under a guarantee of distinctness, which is `uniqueLike`'s hazard and
// gets `uniqueLike`'s answer. Driven through `runProgram`'s injectable `uniqueSeq` because 8.4
// million draws is not a test; the ceiling is still the shipped one, not a test-only constant.
test('`unique number` refuses its per-run ceiling rather than wrapping past a safe integer', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => res.writeHead(200).end('ok') });

  const source = `test "at the ceiling"
  let n = unique number
  api GET /health
  expect status equals 200
`;
  const { program } = parseSource(source);
  const seqFrom = (start: number): { next(): number } => {
    let n = start;
    return { next: () => n++ };
  };

  const under = await runProgram(program, testConfig(server.baseUrl), { source, uniqueSeq: seqFrom(2 ** 23 - 1) });
  assert.equal(under.report.ok, true, 'the last value in the space must still be issued');
  const at = await runProgram(program, testConfig(server.baseUrl), { source, uniqueSeq: seqFrom(2 ** 23) });
  assert.equal(at.report.ok, false, 'one past the space must fail the run, not wrap');
  const error = asEntry(at.report.tests[0], 'functional').error ?? '';
  assert.match(error, /can encode at most 8388608 distinct values in one run/);
  assert.match(error, /counter has already reached 8388608/);

  await server.close();
});

// decision 98: uuid/password generators + base64/hex/url transforms

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('`unique uuid` is v4-shaped and guaranteed distinct via the embedded run counter', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => res.writeHead(200).end('ok') });

  const letLines = Array.from({ length: 10 }, (_, i) => `  let id${i} = unique uuid`).join('\n');
  const source = `test "unique uuids"
${letLines}
  api GET /health
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const details = asEntry(report.tests[0], 'functional').steps.slice(0, 10).map((s) => s.detail!);
  const uuids = details.map((d) => {
    const m = d.match(/^id\d+ = "([^"]+)" \(unique\)$/);
    assert.ok(m, `expected a tagged unique uuid detail, got: ${d}`);
    return m[1]!;
  });
  for (const u of uuids) assert.match(u, UUID_RE);
  assert.equal(new Set(uuids).size, 10, 'every unique uuid must be distinct');
  // The trailing 8 hex digits are the run's monotonic counter itself, so consecutive calls in one
  // test produce consecutive trailing segments.
  const trailers = uuids.map((u) => parseInt(u.slice(-8), 16));
  for (let i = 1; i < trailers.length; i++) assert.equal(trailers[i], trailers[i - 1]! + 1);

  await server.close();
});

test('`random uuid` is v4-shaped and reproducible under the same `--seed`', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => res.writeHead(200).end('ok') });

  const source = `test "random uuid"
  let a = random uuid
  let b = random uuid
  api GET /health
  expect status equals 200
`;
  const { program } = parseSource(source);
  const config = testConfig(server.baseUrl);

  const runA = await runProgram(program, config, { source, seed: 42 });
  const runB = await runProgram(program, config, { source, seed: 42 });
  const runC = await runProgram(program, config, { source, seed: 7 });

  const detailsA = asEntry(runA.report.tests[0], 'functional').steps.slice(0, 2).map((s) => s.detail!);
  const detailsB = asEntry(runB.report.tests[0], 'functional').steps.slice(0, 2).map((s) => s.detail!);
  const detailsC = asEntry(runC.report.tests[0], 'functional').steps.slice(0, 2).map((s) => s.detail!);

  for (const d of detailsA) {
    const m = d.match(/^\w+ = "([^"]+)" \(random\)$/);
    assert.ok(m, `expected a tagged random uuid detail, got: ${d}`);
    assert.match(m[1]!, UUID_RE);
  }
  assert.deepEqual(detailsA, detailsB, 'same seed must reproduce the exact same uuids');
  assert.notDeepEqual(detailsA, detailsC, 'a different seed should (overwhelmingly likely) differ');

  await server.close();
});

test('`random password` guarantees at least one upper/lower/digit/symbol, at any valid length', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => res.writeHead(200).end('ok') });

  const source = `test "passwords"
  let default_ = random password
  let long = random password 32
  let floor = random password 4
  api GET /health
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const details = asEntry(report.tests[0], 'functional').steps.slice(0, 3).map((s) => s.detail!);
  const pws = details.map((d) => {
    const m = d.match(/^\w+ = "([^"]+)" \(random\)$/);
    assert.ok(m, `expected a tagged random password detail, got: ${d}`);
    return m[1]!;
  });

  assert.equal(pws[0]!.length, 12, 'default length is 12');
  assert.equal(pws[1]!.length, 32);
  assert.equal(pws[2]!.length, 4);
  for (const pw of pws) {
    assert.match(pw, /[A-Z]/, `${pw} missing an uppercase letter`);
    assert.match(pw, /[a-z]/, `${pw} missing a lowercase letter`);
    assert.match(pw, /[0-9]/, `${pw} missing a digit`);
    assert.match(pw, /[!@#$%^&*\-_=+]/, `${pw} missing a symbol`);
  }

  await server.close();
});

test('`random password` below the length-4 floor fails clearly', async () => {
  const source = `test "too short"
  let pw = random password 3
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig('http://127.0.0.1:1'), { source });
  assert.equal(report.ok, false);
  assert.match(asEntry(report.tests[0], 'functional').error ?? '', /random password 3.*length must be at least 4/);
});

test('base64/hex/url transforms round-trip and stay untagged (not a generator)', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => res.writeHead(200).end('ok') });

  const source = `test "transforms"
  let creds = base64 encode("alice@example.test:s3cr3t")
  let decoded = base64 decode(creds)
  let hexed = hex encode("hello world")
  let unhexed = hex decode(hexed)
  let urled = url encode("a b&c")
  let unurled = url decode(urled)
  api GET /health
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const details = asEntry(report.tests[0], 'functional').steps.slice(0, 6).map((s) => s.detail!);
  for (const d of details) assert.doesNotMatch(d, /\((random|unique)\)$/, 'transforms are not generators, no tag expected');

  assert.equal(details[0], 'creds = "YWxpY2VAZXhhbXBsZS50ZXN0OnMzY3IzdA=="');
  assert.equal(details[1], 'decoded = "alice@example.test:s3cr3t"');
  assert.equal(details[2], 'hexed = "68656c6c6f20776f726c64"');
  assert.equal(details[3], 'unhexed = "hello world"');
  assert.equal(details[4], 'urled = "a%20b%26c"');
  assert.equal(details[5], 'unurled = "a b&c"');

  await server.close();
});

test('base64/hex decode reject malformed input instead of silently dropping bad characters', async () => {
  const badHex = `test "bad hex"
  let x = hex decode("not-hex!")
  expect status equals 200
`;
  const { program: hexProgram } = parseSource(badHex);
  const { report: hexReport } = await runProgram(hexProgram, testConfig('http://127.0.0.1:1'), { source: badHex });
  assert.equal(hexReport.ok, false);
  assert.match(asEntry(hexReport.tests[0], 'functional').error ?? '', /hex decode\(\.\.\.\): "not-hex!" is not valid hex/);

  const badBase64 = `test "bad base64"
  let x = base64 decode("not valid base64!!")
  expect status equals 200
`;
  const { program: b64Program } = parseSource(badBase64);
  const { report: b64Report } = await runProgram(b64Program, testConfig('http://127.0.0.1:1'), { source: badBase64 });
  assert.equal(b64Report.ok, false);
  assert.match(asEntry(b64Report.tests[0], 'functional').error ?? '', /base64 decode\(\.\.\.\): "not valid base64!!" is not valid base64/);
});

test('url decode rejects malformed percent-encoding', async () => {
  const source = `test "bad percent-encoding"
  let x = url decode("100% not valid")
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig('http://127.0.0.1:1'), { source });
  assert.equal(report.ok, false);
  assert.match(asEntry(report.tests[0], 'functional').error ?? '', /url decode\(\.\.\.\): "100% not valid" is not validly percent-encoded/);
});

// ---------------------------------------------------------------------------
// M102 / A4-OS-11 + A4-OS-13 — a `StringLit` the checker binds `{var}`s in is a
// value at run time too. Header names and generator patterns were the last four
// operands where the checker and the runtime disagreed.
// ---------------------------------------------------------------------------

test('M102/A4-OS-11: a per-request header NAME interpolates', async () => {
  const seen: Record<string, string | undefined>[] = [];
  const server = await startFixtureServer({
    '/orders': (req, res) => {
      seen.push({ ...(req.headers as Record<string, string | undefined>) });
      json(res, 201, { ok: true });
    },
  });

  const source = `test "gen"
  let tenant = "acme"
  api POST /orders body { a: 1 }
    header "X-Step-{tenant}" is "step-local"
  expect status equals 201
`;
  const { program } = parseSource(source);
  const run = await runProgram(program, testConfig(server.baseUrl), { source, seed: 1 });

  assert.equal(run.report.tests[0]!.ok, true, JSON.stringify(asEntry(run.report.tests[0], 'functional').steps));
  const sent = seen[0]!;
  assert.equal(sent['x-step-acme'], 'step-local', 'the header must be sent under the interpolated name');
  // The control: `x-step-{tenant}` is what this line sent before M102, and it is a legal header
  // name, so asserting only the line above would still pass if interpolation ran but also left the
  // literal behind.
  assert.equal(sent['x-step-{tenant}'], undefined, 'the literal name must not be sent');

  await server.close();
});

test('M102/A4-OS-11: `expect header "{var}"` reads the interpolated header, and says so when it fails', async () => {
  const server = await startFixtureServer({
    '/orders': (_req, res) => {
      res.setHeader('X-Trace-Acme', 'abc123');
      json(res, 201, { ok: true });
    },
  });

  const source = `test "gen"
  let tenant = "acme"
  api POST /orders body { a: 1 }
  expect header "X-Trace-{tenant}" equals "abc123"
`;
  const { program } = parseSource(source);
  const run = await runProgram(program, testConfig(server.baseUrl), { source, seed: 1 });
  assert.equal(run.report.tests[0]!.ok, true, JSON.stringify(asEntry(run.report.tests[0], 'functional').steps));

  // Before M102 the lookup was `x-trace-{tenant}` — always `null`, so the assertion was decided
  // against a header that cannot exist. Prove the failing message names the resolved header.
  const badSource = `test "gen"
  let tenant = "acme"
  api POST /orders body { a: 1 }
  expect header "X-Trace-{tenant}" equals "nope"
`;
  const bad = parseSource(badSource).program;
  const badRun = await runProgram(bad, testConfig(server.baseUrl), { source: badSource, seed: 1 });
  assert.equal(badRun.report.tests[0]!.ok, false);
  const msg = asEntry(badRun.report.tests[0], 'functional').error ?? '';
  assert.match(msg, /header "X-Trace-acme"/, 'the failure must name the header actually read');
  assert.doesNotMatch(msg, /\{tenant\}/, 'the failure must not echo the un-interpolated literal');

  await server.close();
});

test('M102/A4-OS-13: `random like`/`unique like`/`format` patterns interpolate', async () => {
  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 201, { ok: true }) });

  const source = `test "gen"
  let region = "EU"
  let code = random like "{region}-####"
  let sku = unique like "{region}-??"
  api POST /orders body { a: 1 }
  expect status equals 201
`;
  const { program } = parseSource(source);
  const run = await runProgram(program, testConfig(server.baseUrl), { source, seed: 42 });
  assert.equal(run.report.tests[0]!.ok, true, JSON.stringify(asEntry(run.report.tests[0], 'functional').steps));

  const details = asEntry(run.report.tests[0], 'functional').steps.slice(0, 3).map((s) => s.detail ?? '');
  // `#` → digit and `?` → letter still work, so the pattern language survives interpolation. The
  // `{region}` half is the new behaviour; the `####` half is the guard that it stayed additive.
  assert.match(details[1]!, /EU-\d{4}/, `random like: ${details[1]}`);
  assert.match(details[2]!, /EU-[A-Z]{2}/, `unique like: ${details[2]}`);
  for (const d of details) assert.doesNotMatch(d, /\{region\}/);

  await server.close();
});

test('M102/A4-OS-13: a `like` pattern with no `{` renders byte-identically to before', async () => {
  // The additivity claim, made checkable rather than asserted in a comment. `{` is not a
  // placeholder in `renderLikePattern` (`#`/`?`) or `formatDate` (`yyyy`/`MM`/`dd`), so every
  // pattern in the corpus is untouched by M102 — this pins that for the seeded case.
  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 201, { ok: true }) });
  const source = `test "gen"
  let code = random like "SKU-####-??"
  api POST /orders body { a: 1 }
  expect status equals 201
`;
  const { program } = parseSource(source);
  const run = await runProgram(program, testConfig(server.baseUrl), { source, seed: 42 });
  assert.match(asEntry(run.report.tests[0], 'functional').steps[0]!.detail ?? '', /SKU-\d{4}-[A-Z]{2}/);
  await server.close();
});

// `M154g-15`'s second half (`D815`). `unique like` was fixed in `M154g-07` by dropping the RNG
// entirely, which closed the harmful half; `unique uuid` still consults one, and still keyed it
// with `subSeed(runSeed, counter)` — the same expression, over the same run seed, that keys a
// test's own `random` stream from its index. The uuid's *distinctness* never depended on that half,
// so nothing looked wrong: the value was unique, merely predictable from an unrelated test. This is
// the direct inverse of the row's measurement, pinned to a seed so it asserts a deterministic
// separation rather than betting on two random values differing.
test('`unique uuid` does not shape itself from some test\'s own `random` stream (`M154g-15`)', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => res.writeHead(200).end('ok') });

  const source = `test "t0"
  let u0 = unique uuid
  let r0 = random uuid
  api GET /health
  expect status equals 200

test "t1"
  let r1 = random uuid
  api GET /health
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, seed: 4242 });
  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));

  const uuid = (detail: string) => /"([0-9a-f-]{36})"/.exec(detail)![1]!;
  const u0 = uuid(asEntry(report.tests[0], 'functional').steps[0]!.detail!);
  const r0 = uuid(asEntry(report.tests[0], 'functional').steps[1]!.detail!);
  const r1 = uuid(asEntry(report.tests[1], 'functional').steps[0]!.detail!);

  // The first 12 bytes are the shaped half — the trailing 8 hex digits are the counter and are
  // *supposed* to be predictable, so comparing whole uuids would pass for the wrong reason.
  const shaped = (u: string) => u.replace(/-/g, '').slice(0, 24);
  assert.notEqual(shaped(u0), shaped(r0), '`unique uuid` must not replay the drawing test\'s `random` stream');
  assert.notEqual(shaped(u0), shaped(r1), '`unique uuid` must not replay another test\'s `random` stream either');

  await server.close();
});

// `M161-01` (`D815`) — the process boundary, unit-level. The end-to-end proof is in
// `packages/cli/test/e2e.test.ts` (a real forked two-worker run against a recording target); this
// pins the mechanism directly so a regression names the cause rather than a duplicate-key error
// several layers away.
test('`makeUniqueSeq` stripes disjointly across shards, and is unchanged unsharded (`M161-01`)', async () => {
  const draws = (seq: { next(): number }, n: number): number[] => Array.from({ length: n }, () => seq.next());

  assert.deepEqual(draws(makeUniqueSeq(), 5), [0, 1, 2, 3, 4], 'unsharded must stay the plain run-wide counter');

  const shards = [0, 1, 2, 3].map((index) => draws(makeUniqueSeq({ index, count: 4 }), 25));
  const all = shards.flat();
  assert.equal(new Set(all).size, all.length, 'four shards must never draw the same value');
  assert.deepEqual(shards[0]!.slice(0, 3), [0, 4, 8]);
  assert.deepEqual(shards[3]!.slice(0, 3), [3, 7, 11]);
  // Striping, not block partitioning: no shard needs to know how many values another will draw,
  // and no shard can exhaust a block while another's sits unused.
  assert.deepEqual([...all].sort((a, b) => a - b), Array.from({ length: 100 }, (_, i) => i));
});
