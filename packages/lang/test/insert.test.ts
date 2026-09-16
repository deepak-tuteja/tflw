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
import { buildApiStep, buildExpect, buildTest, buildThreshold, buildWorkload, format, insertIntoSource, parseSource, print, stringLit, type ApiStepSpec, type ExpectSpec, type Insertion, type StringLit } from '../src/index.js';

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

// ---- `A1-4` — the API form's half of the pipeline ---------------------------

const apiStep = (spec: ApiStepSpec) => {
  const r = buildApiStep(spec);
  // `assert.equal` is declared `asserts actual is T` in `@types/node`, so this narrows `r` to its
  // ok variant — a `if (!r.ok) throw` after it is unreachable, and `tsc` types it `never`.
  assert.equal(r.ok, true, r.ok ? '' : r.reason);
  return r.node;
};
const expectStmt = (spec: ExpectSpec) => {
  const r = buildExpect(spec);
  // `assert.equal` is declared `asserts actual is T` in `@types/node`, so this narrows `r` to its
  // ok variant — a `if (!r.ok) throw` after it is unreachable, and `tsc` types it `never`.
  assert.equal(r.ok, true, r.ok ? '' : r.reason);
  return r.node;
};

test('a built string literal breaks into the same parts the parser would give it', () => {
  // `A0-4` built one text blob and left a note saying interpolation was `A1`'s. The BYTES were
  // already right — `print` rebuilds from `parts` and `escape` does not touch braces — so the two
  // agreed by accident. The NODE did not: the thing the form previewed said "one run of text"
  // where the file says text-plus-reference, and anything reading the built node (which variables
  // does this step use? is that reference bound?) read a fiction.
  const built = stringLit('Bearer {token}');
  const { program } = parseSource('test "t"\n  api GET /x\n    header "A" is "Bearer {token}"\n');
  const step = program.tests[0]!.body[0]!;
  // Narrowed by the assertion above, so the header reads off `ApiStep` itself rather than through
  // a hand-written shape that had to restate `readonly` to compile.
  assert.equal(step.type, 'ApiStep');
  const parsed = step.headers[0]!.value;
  assert.deepEqual(built.parts, (parsed as StringLit).parts);
  assert.equal(built.parts.length, 2, 'two parts: the literal text and the reference');
});

test('the API form builds a request and the assertions that read it', () => {
  const step = apiStep({
    service: null,
    method: 'POST',
    path: '/orders',
    headers: [{ name: 'Authorization', value: 'Bearer {token}' }],
    body: { kind: 'json', text: '{ itemId: 1, qty: 2 }' },
    label: null,
  });
  assert.equal(print(step, { indent: 1 }).text, '  api POST /orders body { itemId: 1, qty: 2 }\n    header "Authorization" is "Bearer {token}"');

  const rows: readonly [ExpectSpec, string][] = [
    [{ soft: false, quantifier: null, subject: { kind: 'status' }, matcher: 'equals', operand: '201' }, '  expect status equals 201'],
    [{ soft: false, quantifier: null, subject: { kind: 'body', path: 'items[0].price' }, matcher: 'greaterThan', operand: '0' }, '  expect body.items[0].price is greater than 0'],
    [{ soft: true, quantifier: 'all', subject: { kind: 'body', path: 'items' }, matcher: 'hasCount', operand: '2' }, '  check all body.items has count 2'],
    [{ soft: false, quantifier: null, subject: { kind: 'header', name: 'content-type' }, matcher: 'contains', operand: '"json"' }, '  expect header "content-type" contains "json"'],
    [{ soft: false, quantifier: null, subject: { kind: 'duration' }, matcher: 'lessThan', operand: '500ms' }, '  expect duration is less than 500ms'],
    [{ soft: false, quantifier: null, subject: { kind: 'request' }, matcher: 'connects', operand: null }, '  expect request connects'],
    [{ soft: false, quantifier: null, subject: { kind: 'bodyText' }, matcher: 'contains', operand: '"ok"' }, '  expect body text contains "ok"'],
    [{ soft: false, quantifier: null, subject: { kind: 'value', ref: 'orderId' }, matcher: 'greaterThan', operand: '0' }, '  expect {orderId} is greater than 0'],
  ];
  for (const [spec, expected] of rows) assert.equal(print(expectStmt(spec), { indent: 1 }).text, expected);

  // The three other body shapes.
  assert.equal(print(apiStep({ service: null, method: 'POST', path: '/x', headers: [], body: { kind: 'text', text: 'raw' }, label: null }), { indent: 1 }).text, '  api POST /x body text "raw"');
  assert.equal(print(apiStep({ service: null, method: 'POST', path: '/x', headers: [], body: { kind: 'file', path: './p.json' }, label: null }), { indent: 1 }).text, '  api POST /x body from "./p.json"');
  assert.equal(print(apiStep({ service: null, method: 'POST', path: '/x', headers: [], body: { kind: 'form', fields: [{ key: 'email', value: 'a@b' }] }, label: null }), { indent: 1 }).text, '  api POST /x form email="a@b"');
  // A named service and a report label, which is the clause order `A1-2` corrected.
  assert.equal(print(apiStep({ service: 'root', method: 'GET', path: '/health', headers: [], body: null, label: 'health' }), { indent: 1 }).text, '  api root GET /health as "health"');
});

test('steps land under the last step and above the thresholds', () => {
  // A `threshold` is parsed into its own array and sits at the FOOT of a test, below the body, so
  // "the last line" and "the last step" are different offsets on any test that has one. Appending
  // to the last line would put the request below the assertion about the whole run.
  const source = 'test "checkout"\n  api GET /health\n  expect status equals 200\n  threshold error rate is less than 1%\n';
  const out = insert(source, {
    kind: 'steps',
    testName: 'checkout',
    nodes: [
      apiStep({ service: null, method: 'POST', path: '/orders', headers: [], body: { kind: 'json', text: '{ qty: 1 }' }, label: null }),
      expectStmt({ soft: false, quantifier: null, subject: { kind: 'status' }, matcher: 'equals', operand: '201' }),
    ],
  });
  assert.equal(
    out,
    'test "checkout"\n  api GET /health\n  expect status equals 200\n  api POST /orders body { qty: 1 }\n  expect status equals 201\n  threshold error rate is less than 1%\n',
  );
  acceptable(out, 'a test that gained steps above its threshold');

  // A TEST'S SOURCE IS THREE REGIONS, NOT TWO — header, workload line, body, thresholds — and only
  // a fixture holding all of them at once can tell the three candidate anchors apart. This one
  // does: a step must land below `run … iterations` and below the last `expect`, and above the
  // `threshold`. The first draft of the anchor got this shape right and the shape BELOW it wrong.
  const allThree = '@load\ntest "the catalog holds"\n  run 50 iterations across 2 users\n  api GET /catalog\n  threshold error rate is less than 1%\n';
  const out3 = insert(allThree, { kind: 'steps', testName: 'the catalog holds', nodes: [expectStmt({ soft: false, quantifier: null, subject: { kind: 'status' }, matcher: 'equals', operand: '200' })] });
  assert.equal(out3, '@load\ntest "the catalog holds"\n  run 50 iterations across 2 users\n  api GET /catalog\n  expect status equals 200\n  threshold error rate is less than 1%\n');
  acceptable(out3, 'a test with a workload, a body and a threshold');

  // The control: with no threshold the two offsets coincide, so a test asserting only this shape
  // would pass against code that appended to the last line.
  const noThreshold = 'test "checkout"\n  api GET /health\n  expect status equals 200\n';
  const out2 = insert(noThreshold, { kind: 'steps', testName: 'checkout', nodes: [expectStmt({ soft: false, quantifier: null, subject: { kind: 'duration' }, matcher: 'lessThan', operand: '1s' })] });
  assert.equal(out2, 'test "checkout"\n  api GET /health\n  expect status equals 200\n  expect duration is less than 1s\n');
  acceptable(out2, 'a test that gained a step at its foot');
});

test('a step and the assertions that read it are one edit, not several', () => {
  // Inserting them separately would leave the file, between two writes, with assertions naming a
  // response nothing fetched — and `D1049` means each of those writes is a real PUT.
  const source = 'test "t"\n  api GET /health\n  expect status equals 200\n';
  const nodes = [
    apiStep({ service: null, method: 'GET', path: '/orders', headers: [], body: null, label: null }),
    expectStmt({ soft: false, quantifier: null, subject: { kind: 'status' }, matcher: 'equals', operand: '200' }),
    expectStmt({ soft: false, quantifier: null, subject: { kind: 'body', path: '' }, matcher: 'hasCount', operand: '3' }),
  ];
  const out = insert(source, { kind: 'steps', testName: 't', nodes });
  assert.equal(out, 'test "t"\n  api GET /health\n  expect status equals 200\n  api GET /orders\n  expect status equals 200\n  expect body has count 3\n');
  acceptable(out, 'a request and its assertions in one edit');

  const empty = insertIntoSource(source, { kind: 'steps', testName: 't', nodes: [] });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.match(empty.reason, /no steps to insert/);
});

test('the API door can add work to a test another door started, which closes `A0-5`’s gap', () => {
  // `A0-5`'s green-condition test had to write an `api` step through the raw write route and say
  // so where it did it, because a LOAD form cannot describe one. This is `D1044` from the writing
  // side: a door adds the work it knows how to describe, to a test any door may have started.
  const load = insert('', {
    kind: 'test',
    node: (() => {
      const w = workload({ kind: 'iterations', perUser: false, count: 50, vus: 2 });
      const t = buildTest({ name: 'the catalog holds', tags: ['load'], workload: w, thresholds: [], body: [] });
      assert.equal(t.ok, true, t.ok ? '' : t.reason);
      return t.node;
    })(),
  });
  assert.equal(load, '@load\ntest "the catalog holds"\n  run 50 iterations across 2 users\n');

  const withWork = insert(load, {
    kind: 'steps',
    testName: 'the catalog holds',
    nodes: [
      apiStep({ service: null, method: 'GET', path: '/catalog', headers: [], body: null, label: 'catalog' }),
      expectStmt({ soft: false, quantifier: null, subject: { kind: 'status' }, matcher: 'equals', operand: '200' }),
    ],
  });
  assert.equal(withWork, '@load\ntest "the catalog holds"\n  run 50 iterations across 2 users\n  api GET /catalog as "catalog"\n  expect status equals 200\n');
  acceptable(withWork, 'a LOAD-authored test that the API door gave work to');
});

test('the API builders refuse in the form’s own words', () => {
  const rows: readonly [() => { ok: boolean; reason?: string }, RegExp][] = [
    [() => buildApiStep({ service: null, method: 'GET', path: 'orders', headers: [], body: null, label: null }), /starts with `\/`/],
    [() => buildApiStep({ service: null, method: 'GET', path: '/a b', headers: [], body: null, label: null }), /cannot contain a space/],
    [() => buildApiStep({ service: 'my service', method: 'GET', path: '/x', headers: [], body: null, label: null }), /is not a service name/],
    [() => buildApiStep({ service: null, method: 'GET', path: '/x', headers: [{ name: '  ', value: 'v' }], body: null, label: null }), /a header needs a name/],
    [() => buildApiStep({ service: null, method: 'GET', path: '/x', headers: [], body: null, label: '  ' }), /cannot be blank/],
    // The JSON body is the one field whose content is a program fragment, so it is PARSED rather
    // than trusted — and the refusal is the parser's own sentence about the line the author typed.
    [() => buildApiStep({ service: null, method: 'POST', path: '/x', headers: [], body: { kind: 'json', text: '{ oops' }, label: null }), /never closed/],
    [() => buildApiStep({ service: null, method: 'POST', path: '/x', headers: [], body: { kind: 'json', text: '5' }, label: null }), /JSON object or array/],
    [() => buildApiStep({ service: null, method: 'POST', path: '/x', headers: [], body: { kind: 'form', fields: [] }, label: null }), /at least one field/],
    [() => buildApiStep({ service: null, method: 'POST', path: '/x', headers: [], body: { kind: 'form', fields: [{ key: 'a b', value: 'v' }] }, label: null }), /is not a form field name/],
    [() => buildExpect({ soft: false, quantifier: 'any', subject: { kind: 'status' }, matcher: 'equals', operand: '200' }), /quantify a body path/],
    [() => buildExpect({ soft: false, quantifier: null, subject: { kind: 'body', path: 'items[x]' }, matcher: 'equals', operand: '1' }), /is not a path segment/],
    [() => buildExpect({ soft: false, quantifier: null, subject: { kind: 'status' }, matcher: 'equals', operand: '' }), /compares against something/],
    [() => buildExpect({ soft: false, quantifier: null, subject: { kind: 'request' }, matcher: 'connects', operand: '200' }), /takes no value/],
    [() => buildExpect({ soft: false, quantifier: null, subject: { kind: 'header', name: '' }, matcher: 'equals', operand: '"x"' }), /needs a header name/],
    [() => buildExpect({ soft: false, quantifier: null, subject: { kind: 'value', ref: '' }, matcher: 'equals', operand: '1' }), /names a variable/],
  ];
  for (const [build, pattern] of rows) {
    const r = build();
    assert.equal(r.ok, false, `expected a refusal matching ${String(pattern)}`);
    assert.match(r.reason ?? '', pattern);
  }

  // …and the matcher with no operand is accepted without one, which is the control that keeps the
  // "give it a value" refusal about the matchers that need one.
  const bare = buildExpect({ soft: false, quantifier: null, subject: { kind: 'request' }, matcher: 'fails', operand: null });
  assert.equal(bare.ok, true, bare.ok ? '' : bare.reason);
});
