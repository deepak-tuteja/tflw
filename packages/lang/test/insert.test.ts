// The authoring pipeline, end to end and without a browser — `M200` `A0-4`.
//
// `buildWorkload`/`buildThreshold`/`buildTest` → `print` → splice → `format`. Everything the page
// does to a file happens in these functions, so this file is where `A0`'s green condition is
// actually provable: the page's own gate can then assert that pressing the button calls them.
//
// The invariant every case here asserts is the one the write route enforces (`D1049`): whatever
// comes out **parses with no error diagnostic** and **`format` is already a fixpoint on it**. A
// result that fails either would be refused by the server, so a test that only compared strings
// could pass while the feature could not write a file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTest, buildThreshold, buildWorkload, format, insertIntoSource, parseSource, type Insertion } from '../src/index.js';

/** Every result has to be something the write route would accept. */
function acceptable(text: string, what: string): void {
  const { diagnostics } = parseSource(text);
  assert.deepEqual(
    diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} at ${d.span.start.line}`),
    [],
    `${what} must parse:\n${text}`,
  );
  const f = format(text);
  assert.equal(f.ok, true, f.reason);
  assert.equal(f.formatted, text, `${what} must already be formatted:\n${text}`);
}

const insert = (source: string, insertion: Insertion): string => {
  const r = insertIntoSource(source, insertion);
  assert.equal(r.ok, true, r.ok ? '' : r.reason);
  assert.ok(r.ok);
  acceptable(r.text, 'the result');
  return r.text;
};

const workload = (spec: Parameters<typeof buildWorkload>[0]) => {
  const r = buildWorkload(spec);
  assert.ok(r.ok, r.ok ? '' : r.reason);
  return r.node;
};
const threshold = (spec: Parameters<typeof buildThreshold>[0]) => {
  const r = buildThreshold(spec);
  assert.ok(r.ok, r.ok ? '' : r.reason);
  return r.node;
};

const FUNCTIONAL = 'test "the catalog answers"\n  api GET /catalog\n  expect status equals 200\n';

test('a workload line turns a functional test into a workload-bearing one, under the header', () => {
  const out = insert(FUNCTIONAL, {
    kind: 'workload',
    testName: 'the catalog answers',
    node: workload({ kind: 'iterations', perUser: false, count: 120, vus: 4 }),
  });
  assert.equal(out, 'test "the catalog answers"\n  run 120 iterations across 4 users\n  api GET /catalog\n  expect status equals 200\n');
  // And it is now a load test by derivation, not by anything anyone wrote down.
  assert.equal(parseSource(out).program.tests[0]!.workload?.type, 'SharedIterationsWorkload');
});

test('every workload shape survives the trip, and comes back as the node the form asked for', () => {
  const cases: ReadonlyArray<readonly [Parameters<typeof buildWorkload>[0], string]> = [
    [{ kind: 'ramp', unit: 'users', target: 50, overMs: 30_000 }, 'ramp to 50 users over 30s'],
    [{ kind: 'ramp', unit: 'rps', target: 200, overMs: 60_000 }, 'ramp to 200 rps over 1m'],
    [{ kind: 'hold', unit: 'users', target: 20, forMs: 120_000 }, 'hold 20 users for 2m'],
    [{ kind: 'hold', unit: 'rps', target: 5, forMs: 500 }, 'hold 5 rps for 500ms'],
    [{ kind: 'iterations', perUser: false, count: 500, vus: 10 }, 'run 500 iterations across 10 users'],
    [{ kind: 'iterations', perUser: true, count: 3, vus: 10 }, 'run 3 iterations per user across 10 users'],
    [{ kind: 'step', unit: 'users', stages: [{ mode: 'jump', target: 10, durationMs: 5000 }, { mode: 'jump', target: 50, durationMs: 5000 }] }, 'step users'],
    [{ kind: 'spike', unit: 'rps', stages: [{ mode: 'jump', target: 10, durationMs: 2000 }, { mode: 'ramp', target: 120, durationMs: 1000 }] }, 'spike rps'],
  ];
  for (const [spec, opening] of cases) {
    const out = insert(FUNCTIONAL, { kind: 'workload', testName: 'the catalog answers', node: workload(spec) });
    assert.ok(out.includes(`  ${opening}`), `expected \`${opening}\` in:\n${out}`);
    const back = parseSource(out).program.tests[0]!.workload;
    assert.equal(back?.type, workload(spec).type, `${opening} round-trips to its own node`);
  }
});

test('a spike’s stages come back in order, with the jump and the ramp spelled the way a spike spells them', () => {
  const out = insert(FUNCTIONAL, {
    kind: 'workload',
    testName: 'the catalog answers',
    node: workload({
      kind: 'spike',
      unit: 'users',
      stages: [
        { mode: 'jump', target: 10, durationMs: 2000 },
        { mode: 'ramp', target: 120, durationMs: 1000 },
        { mode: 'jump', target: 10, durationMs: 2000 },
      ],
    }),
  });
  assert.ok(out.includes('  spike users\n    hold 10 for 2s\n    to 120 over 1s\n    hold 10 for 2s\n'), out);
});

test('a threshold lands at the foot of the test, and a second lands beside the first', () => {
  const one = insert(FUNCTIONAL, {
    kind: 'threshold',
    testName: 'the catalog answers',
    node: threshold({ metric: { kind: 'duration', percentile: 95 }, op: 'lessThan', bound: 500, scope: null }),
  });
  assert.equal(one, `${FUNCTIONAL}  threshold p95 duration is less than 500ms\n`);

  const two = insert(one, {
    kind: 'threshold',
    testName: 'the catalog answers',
    node: threshold({ metric: { kind: 'errorRate' }, op: 'lessThan', bound: 1, scope: null }),
  });
  assert.equal(two, `${FUNCTIONAL}  threshold p95 duration is less than 500ms\n  threshold error rate is less than 1%\n`);
  assert.equal(parseSource(two).program.tests[0]!.thresholds.length, 2);
});

test('an error-rate bound goes in as the percentage the form holds and comes back as the same digits', () => {
  // `0.23%` is the smallest of the 1,007 two-decimal percentages that a naive `* 100` breaks on.
  for (const pct of [0.23, 1, 2.9, 99.99]) {
    const out = insert(FUNCTIONAL, {
      kind: 'threshold',
      testName: 'the catalog answers',
      node: threshold({ metric: { kind: 'errorRate' }, op: 'lessThan', bound: pct, scope: null }),
    });
    assert.ok(out.includes(`threshold error rate is less than ${pct}%`), out);
  }
});

test('a scoped threshold names the endpoint label it scopes to', () => {
  const src = 'test "t"\n  api GET /search as "search"\n  expect status equals 200\n';
  const out = insert(src, {
    kind: 'threshold',
    testName: 't',
    node: threshold({ metric: { kind: 'duration', percentile: 95 }, op: 'lessThan', bound: 500, scope: 'search' }),
  });
  assert.ok(out.includes('threshold p95 duration for "search" is less than 500ms'), out);
});

test('a new test is appended after everything the file holds, with a blank line', () => {
  const built = buildTest({ name: 'holds under load', tags: ['load'], workload: workload({ kind: 'iterations', perUser: false, count: 10, vus: 2 }), thresholds: [], body: [] });
  assert.ok(built.ok, built.ok ? '' : built.reason);
  // A test with a workload line and no steps parses; the checker is what has an opinion about an
  // empty body, and this function's contract is the write route's two claims, not the checker's.
  const out = insert(FUNCTIONAL, { kind: 'test', node: built.node });
  assert.equal(out, `${FUNCTIONAL}\n@load\ntest "holds under load"\n  run 10 iterations across 2 users\n`);
  assert.equal(parseSource(out).program.tests.length, 2);

  // Into an empty file, there is nothing to leave a blank line after.
  const fresh = insert('', { kind: 'test', node: built.node });
  assert.equal(fresh, '@load\ntest "holds under load"\n  run 10 iterations across 2 users\n');
});

test('the file the author already wrote is not reprinted — only the inserted line is new', () => {
  // A file holding constructs the printer cannot print at all. If this were a reprint rather than
  // a splice, it could not survive, and the point of `D1046` is that it does.
  const rich =
    'use "./helpers/sign.ts"\n\n' +
    'action a thing(x)\n  api POST /x body { v: {x} }\n  give {x}\n\n' +
    '@orders @flaky\ntest "a browser test with a table"\n  open "/shop"\n  fill form\n    | "Email" | "a@b.c" |\n  click button "Buy"\n  expect page has no critical a11y violations\n';
  const out = insert(rich, {
    kind: 'threshold',
    testName: 'a browser test with a table',
    node: threshold({ metric: { kind: 'errorRate' }, op: 'lessThan', bound: 1, scope: null }),
  });
  assert.ok(out.startsWith('use "./helpers/sign.ts"\n\naction a thing(x)\n'), out);
  assert.ok(out.includes('  fill form\n    | "Email" | "a@b.c" |\n'), 'the table is untouched');
  assert.ok(out.endsWith('  threshold error rate is less than 1%\n'), out);
});

test('it refuses rather than guessing, and the source is never what comes back changed', () => {
  const refuse = (source: string, insertion: Insertion, pattern: RegExp) => {
    const r = insertIntoSource(source, insertion);
    assert.equal(r.ok, false, `expected a refusal, got:\n${r.ok ? r.text : ''}`);
    assert.match(r.ok ? '' : r.reason, pattern);
  };
  const w = workload({ kind: 'iterations', perUser: false, count: 1, vus: 1 });

  refuse('test "t"\n  api GET\n', { kind: 'workload', testName: 't', node: w }, /does not parse/);
  refuse(FUNCTIONAL, { kind: 'workload', testName: 'nope', node: w }, /no test named/);
  refuse(
    'test "t"\n  run 5 iterations across 1 users\n  api GET /x\n',
    { kind: 'workload', testName: 't', node: w },
    /already has a workload line at line 2/,
  );
  refuse(
    'test "t"\n  api GET /x\n\ntest "t"\n  api GET /y\n',
    { kind: 'threshold', testName: 't', node: threshold({ metric: { kind: 'errorRate' }, op: 'lessThan', bound: 1, scope: null }) },
    /2 tests are named/,
  );
});

test('the builders refuse what the parser would, in the form’s own words', () => {
  const no = (r: { ok: boolean; reason?: string }, pattern: RegExp) => {
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, pattern);
  };
  no(buildWorkload({ kind: 'ramp', unit: 'users', target: 0, overMs: 1000 }), /greater than zero/);
  no(buildWorkload({ kind: 'ramp', unit: 'users', target: -5, overMs: 1000 }), /greater than zero/);
  no(buildWorkload({ kind: 'ramp', unit: 'users', target: 1.5, overMs: 1000 }), /whole number/);
  no(buildWorkload({ kind: 'hold', unit: 'rps', target: 5, forMs: 0 }), /longer than zero/);
  no(buildWorkload({ kind: 'step', unit: 'users', stages: [] }), /at least one stage/);
  // The one refusal that is not a parser rule: a `step` block has no spelling for a ramp, so a
  // form offering one would build a node that cannot be written down (`print.ts`'s `CONTEXT_BOUND`).
  no(buildWorkload({ kind: 'step', unit: 'users', stages: [{ mode: 'ramp', target: 10, durationMs: 1000 }] }), /no way to write a ramped stage/);
  no(buildThreshold({ metric: { kind: 'duration', percentile: 0 }, op: 'lessThan', bound: 1, scope: null }), /p1 to p99/);
  no(buildThreshold({ metric: { kind: 'errorRate' }, op: 'lessThan', bound: 101, scope: null }), /cannot exceed 100/);
  no(buildTest({ name: '  ', tags: [], workload: null, thresholds: [], body: [] }), /needs a name/);
  no(buildTest({ name: 't', tags: ['not a tag'], workload: null, thresholds: [], body: [] }), /is not a tag/);
});

test('the foot of a test is neither of the two offsets that look like it', () => {
  // Both alternatives were measured before this was written. A trailing comment is not an AST
  // node, so the furthest child span stops above it; and a declaration's span runs to the dedent
  // that closes it, so on a test followed by another it points at the NEXT declaration's first
  // character. Walking back over whitespace from the declaration's end is what lands in neither.
  const t = threshold({ metric: { kind: 'errorRate' }, op: 'lessThan', bound: 1, scope: null });

  // A trailing comment keeps annotating the step it was written under.
  const commented = insert('test "t"\n  api GET /x\n  # assert the body too\n', { kind: 'threshold', testName: 't', node: t });
  assert.equal(commented, 'test "t"\n  api GET /x\n  # assert the body too\n  threshold error rate is less than 1%\n');

  // A following declaration is not written into.
  const followed = insert('test "t"\n  api GET /x\n\ntest "u"\n  api GET /y\n', { kind: 'threshold', testName: 't', node: t });
  assert.equal(followed, 'test "t"\n  api GET /x\n  threshold error rate is less than 1%\n\ntest "u"\n  api GET /y\n');
  assert.equal(parseSource(followed).program.tests[1]!.thresholds.length, 0, "the second test gained nothing");

  // Trailing blank lines at the end of the file are not somewhere to put a line either.
  const trailing = insert('test "t"\n  api GET /x\n\n\n', { kind: 'threshold', testName: 't', node: t });
  assert.equal(trailing, 'test "t"\n  api GET /x\n  threshold error rate is less than 1%\n');
});

test('an insert into a file that was never formatted formats the whole file, and that is stated', () => {
  // `D1049`'s write route refuses text `format` would still change, so the result of an insert
  // has to be formatted — which means the FIRST edit to a hand-written file normalises all of it,
  // not only the line that was added. That is a real consequence and is asserted here rather than
  // discovered by someone whose diff is bigger than their edit.
  const handWritten = 'test   "t"\n    api GET /x\n    expect  status equals   200\n';
  assert.notEqual(format(handWritten).formatted, handWritten, 'the fixture must actually need formatting');
  const out = insert(handWritten, {
    kind: 'threshold',
    testName: 't',
    node: threshold({ metric: { kind: 'errorRate' }, op: 'lessThan', bound: 1, scope: null }),
  });
  assert.equal(out, 'test "t"\n  api GET /x\n  expect status equals 200\n  threshold error rate is less than 1%\n');
});
