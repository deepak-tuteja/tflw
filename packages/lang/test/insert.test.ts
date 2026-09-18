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
import { buildApiStep, buildClick, buildExpect, buildFill, buildLocator, buildOpen, buildTest, buildThreshold, buildWithin, buildWorkload, format, insertIntoSource, parseSource, print, replaceInSource, stringLit, LOCATOR_KINDS, type ApiStepSpec, type ExpectSpec, type ExpectStmt, type Insertion, type StringLit } from '../src/index.js';

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
    // An EMPTY path is its own case, and the two messages must differ (`M205` Q9). The API form
    // opens with this field blank now, so this sentence is the first thing the door says: it asks
    // for a path and shows the shape of one. Telling a blank field it does not start with a slash
    // is true, unhelpful, and reads as a refusal of something nobody has done yet. The two rows sit
    // together because the claim is the DIFFERENCE: drop the empty branch and `''` falls through to
    // the row below it, whose sentence this row's pattern does not match.
    [() => buildApiStep({ service: null, method: 'GET', path: '', headers: [], body: null, label: null }), /like `\/orders`/],
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
    [() => buildExpect({ soft: false, quantifier: 'any', subject: { kind: 'status' }, matcher: 'equals', operand: '200' }), /`any` and `all` quantify a list/],
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

test('S3a: the expect builder writes the assertions the corpus writes', () => {
  // `M210` `S3` came to EDIT an assertion that already exists, and the builder had only ever been
  // asked to append a new one. Four gaps fell out of that change of direction, each measured over
  // this repository's 21 files and the sibling's 274 before it was closed. Every row below is a
  // spelling the corpus holds and this builder refused or corrupted.
  const ok = <T>(r: { ok: true; node: T } | { ok: false; reason: string }): T => {
    assert.ok(r.ok, r.ok ? '' : r.reason);
    return r.node;
  };
  const line = (spec: ExpectSpec): string => {
    const printed = print(ok(buildExpect(spec)), { indent: 1 });
    assert.equal(printed.ok, true, printed.reason);
    return printed.text.trim();
  };

  // **1. NEGATION, which is the one whose absence inverts the meaning.** `negated` was hardcoded
  // `false`, so rebuilding `expect status not equals 500` from a spec produced `expect status
  // equals 500` — a file that parses, runs, and asserts the opposite. 92 assertions across the two
  // corpora are negated, spread over 15 different matchers.
  assert.equal(line({ soft: false, quantifier: null, subject: { kind: 'status' }, matcher: 'equals', operand: '500', negated: true }), 'expect status not equals 500');
  // The negative control, and it is the half that matters: *absent* must still mean not negated,
  // because every caller written before this field existed omits it.
  assert.equal(line({ soft: false, quantifier: null, subject: { kind: 'status' }, matcher: 'equals', operand: '500' }), 'expect status equals 500');
  assert.equal(line({ soft: false, quantifier: null, subject: { kind: 'status' }, matcher: 'equals', operand: '500', negated: false }), 'expect status equals 500');
  // It is not the value matchers' own word: the corpus negates state and scan matchers too.
  assert.equal(line({ soft: true, quantifier: null, subject: { kind: 'page' }, matcher: 'hasNoA11yViolations', operand: null, negated: true }), 'check page not has no a11y violations');

  // **2. `was made` takes no operand at all** — 13 occurrences, 0 of them with a value — and fell
  // through to *"compares against something"*. Its subject is the network request the browser door
  // holds, which no spec can spell, so this is built the way `M210`'s card builds one: a stand-in
  // subject through the builder, the real node substituted after. That substitution is the whole
  // mechanism the pane rests on, so it is gated here rather than only in the browser.
  const made = parseSource('test "t"\n  expect request to "/orders" was made\n');
  const original = made.program.tests[0]!.body[0] as ExpectStmt;
  const rebuilt = ok(buildExpect({ soft: false, quantifier: null, subject: { kind: 'status' }, matcher: 'wasMade', operand: null }));
  const carriedNode: ExpectStmt = { ...rebuilt, subject: original.subject };
  const carried = print(carriedNode, { indent: 1 });
  assert.equal(carried.ok, true, carried.reason);
  assert.equal(carried.text.trim(), 'expect request to "/orders" was made');

  // **3. The three matchers whose operand is a trailing clause.** `matches schema`, `matches file`
  // and `matches snapshot` were unreachable from any form: with no value they hit the same
  // *"compares against something"* refusal, and with one the printer refuses for want of the
  // clause. 25 assertions across the two corpora.
  assert.equal(
    line({ soft: false, quantifier: null, subject: { kind: 'body', path: '' }, matcher: 'matchesSchema', operand: null, schema: { name: 'Order', source: 'openapi.json' } }),
    'expect body matches schema "Order" from "openapi.json"',
  );
  assert.equal(
    line({ soft: false, quantifier: null, subject: { kind: 'body', path: '' }, matcher: 'matchesSchema', operand: null, schema: { name: 'Order', source: '/openapi.json', service: 'root' } }),
    'expect body matches schema "Order" from root "/openapi.json"',
  );
  assert.equal(
    line({ soft: false, quantifier: null, subject: { kind: 'bodyBytes' }, matcher: 'matchesFile', operand: null, filePath: 'fixtures/logo.png' }),
    'expect body bytes matches file "fixtures/logo.png"',
  );
  assert.equal(
    line({ soft: false, quantifier: null, subject: { kind: 'page' }, matcher: 'matchesSnapshot', operand: null, snapshotName: 'checkout' }),
    'expect page matches snapshot "checkout"',
  );
  // Each clause belongs to one matcher, and a clause offered to another is a refusal rather than a
  // silent drop — the rule `severityFloor` already lives by, for the same reason: a form that
  // ignored it would show a schema name the file does not have.
  const refusals: readonly (readonly [() => ReturnType<typeof buildExpect>, RegExp])[] = [
    [() => buildExpect({ soft: false, quantifier: null, subject: { kind: 'status' }, matcher: 'equals', operand: '200', filePath: 'x.png' }), /belongs to that matcher/],
    [() => buildExpect({ soft: false, quantifier: null, subject: { kind: 'body', path: '' }, matcher: 'matchesSchema', operand: null, snapshotName: 'x' }), /belongs to that matcher/],
    [() => buildExpect({ soft: false, quantifier: null, subject: { kind: 'body', path: '' }, matcher: 'matchesSchema', operand: '"Order"' }), /takes its operand as the clause/],
    [() => buildExpect({ soft: false, quantifier: null, subject: { kind: 'body', path: '' }, matcher: 'matchesSchema', operand: null }), /names a schema and the document/],
    [() => buildExpect({ soft: false, quantifier: null, subject: { kind: 'body', path: '' }, matcher: 'matchesSchema', operand: null, schema: { name: 'Order', source: '  ' } }), /names a schema and the document/],
    [() => buildExpect({ soft: false, quantifier: null, subject: { kind: 'bodyBytes' }, matcher: 'matchesFile', operand: null }), /give it a path/],
    [() => buildExpect({ soft: false, quantifier: null, subject: { kind: 'page' }, matcher: 'matchesSnapshot', operand: null }), /names the baseline/],
  ];
  for (const [build, pattern] of refusals) {
    const r = build();
    assert.equal(r.ok, false, `expected a refusal matching ${String(pattern)}`);
    assert.match(r.reason ?? '', pattern);
  }

  // **4. The quantifier's rule is `quantifiable()`, not `BodySubject`.** 3 of the corpus's 85
  // quantified assertions quantify a `body csv` path, which the old rule refused — and the card's
  // carry-the-subject-across mechanism is exactly where that refusal would have landed, about a
  // file that parses.
  // Reachable from a spec through `{value}`, which `quantifiable()` has always included and this
  // builder refused: `expect any {items} equals 1` parses, prints and now builds.
  assert.equal(line({ soft: false, quantifier: 'any', subject: { kind: 'value', ref: 'items' }, matcher: 'equals', operand: '1' }), 'expect any {items} equals 1');
  const csv = parseSource('test "t"\n  expect any body csv[0].name equals "Widget"\n');
  const csvExpect = csv.program.tests[0]!.body[0] as ExpectStmt;
  const csvRebuilt = ok(buildExpect({ soft: false, quantifier: 'any', subject: { kind: 'body', path: '' }, matcher: 'equals', operand: '"Widget"' }));
  const csvCarriedNode: ExpectStmt = { ...csvRebuilt, subject: csvExpect.subject };
  const csvCarried = print(csvCarriedNode, { indent: 1 });
  assert.equal(csvCarried.ok, true, csvCarried.reason);
  assert.equal(csvCarried.text.trim(), 'expect any body csv[0].name equals "Widget"');

  // Every one of these is a file the write route has to accept, not only a string (`D1049`).
  acceptable(
    'test "t"\n' +
      '  api GET /orders\n' +
      '  expect status not equals 500\n' +
      '  expect body matches schema "Order" from "openapi.json"\n' +
      '  expect body bytes matches file "fixtures/logo.png"\n',
    'the S3a vocabulary',
  );
});

test('A3-5: the browser builders produce a file the write route would accept', () => {
  // The whole point of this file applied to BROWSER: every result must **parse with no error** and
  // be a **`format` fixpoint**, because the write route refuses anything else (`D1049`). A test
  // comparing strings could pass while the door could not write a file.
  const ok = <T>(r: { ok: true; node: T } | { ok: false; reason: string }): T => {
    assert.ok(r.ok, r.ok ? '' : r.reason);
    return r.node;
  };

  const test1 = ok(buildTest({
    name: 'the cart holds what was added',
    tags: ['web'],
    workload: null,
    thresholds: [],
    body: [
      ok(buildOpen('/catalogue')),
      ok(buildClick({ locator: { kind: 'button', value: 'Add to cart' }, kind: 'single' })),
      ok(buildWithin({
        locator: { kind: 'css', value: '#cart' },
        frame: false,
        body: [
          ok(buildFill({ locator: { kind: 'field', value: 'Quantity' }, value: '"2"' })),
          ok(buildExpect({ soft: false, quantifier: null, subject: { kind: 'locator', locator: { kind: 'text', value: 'Subtotal' } }, matcher: 'visible', operand: null })),
        ],
      })),
    ],
  }));
  const printed = print(test1);
  assert.equal(printed.ok, true, printed.reason);
  acceptable(printed.text + '\n', 'a browser test');
  assert.equal(
    printed.text + '\n',
    '@web\ntest "the cart holds what was added"\n  open "/catalogue"\n  click button "Add to cart"\n  within css "#cart"\n    fill field "Quantity" with "2"\n    expect text "Subtotal" is visible\n',
  );

  // **A fill takes a VALUE, so the three spellings the corpus uses all have to survive the
  // builder** — a field that only accepted a string would be right for 422 of 437 corpus fills and
  // unable to express the other fifteen.
  for (const [written, expected] of [['"typed"', 'fill field "Email" with "typed"'], ['{captured}', 'fill field "Email" with {captured}'], ['env(LOGIN)', 'fill field "Email" with env(LOGIN)']] as const) {
    const f = print(ok(buildFill({ locator: { kind: 'field', value: 'Email' }, value: written })));
    assert.equal(f.ok, true, f.reason);
    assert.equal(f.text, expected);
  }

  // `page` is reachable from a spec, which is what lets a BROWSER door write the a11y assertion
  // `A2-3`'s SCANS door deliberately could not offer.
  const a11y = print(ok(buildExpect({ soft: false, quantifier: null, subject: { kind: 'page' }, matcher: 'hasNoA11yViolations', operand: null, severityFloor: 'serious' })));
  assert.equal(a11y.ok, true, a11y.reason);
  assert.equal(a11y.text, 'expect page has no serious a11y violations');
  // **`frame` HAS TO BE BUILT, NOT ONLY PRINTED.** `A3-4` covers the printer's `frame` word, and a
  // mutation hardcoding `frame: false` HERE survived all of it — every case above builds an
  // unframed block, so the flag reached the printer correct by luck rather than by test. It is 4
  // of the corpus' 404 blocks, which is exactly the population a gate written from frequency
  // forgets.
  const framed = print(ok(buildWithin({
    locator: { kind: 'css', value: "iframe[title='Payment']" },
    frame: true,
    body: [ok(buildFill({ locator: { kind: 'field', value: 'CVC' }, value: '"123"' }))],
  })));
  assert.equal(framed.ok, true, framed.reason);
  assert.equal(framed.text, `within frame css "iframe[title='Payment']"\n  fill field "CVC" with "123"`);
});

test('A3-5: the browser builders refuse in the form’s own words', () => {
  // Each of these is a field a form can point at, rather than a file the parser would reject —
  // the same bar `A1`'s builders were held to.
  const reason = (r: { ok: boolean; reason?: string }) => (r.ok ? '' : (r.reason ?? ''));

  // The parser accepts `button ""` happily; a locator matching nothing is a test that fails at run
  // time for a reason the file does not show, so the builder is where it gets said.
  assert.match(reason(buildLocator({ kind: 'button', value: '   ' })), /needs something to match/);
  assert.match(reason(buildClick({ locator: { kind: 'text', value: '' }, kind: 'single' })), /needs something to match/);

  assert.match(reason(buildOpen('  ')), /needs a path/);
  assert.match(reason(buildFill({ locator: { kind: 'field', value: 'Email' }, value: '' })), /needs a value/);

  // **The empty `within` is refused in the BUILDER and in the PRINTER, deliberately in both.** The
  // printer refuses because the bytes would not parse back (`A3-4`); this refuses because a form
  // that let you build one would only find out at the write. Same rule, two surfaces, different
  // callers.
  assert.match(reason(buildWithin({ locator: { kind: 'css', value: '#x' }, frame: false, body: [] })), /needs at least one/);

  // Every kind the grammar has is offered — the parser's own list, so a seventh reaches the form
  // the day it reaches the language.
  assert.deepEqual([...LOCATOR_KINDS], ['button', 'field', 'text', 'list', 'css', 'xpath']);

});

// ---------------------------------------------------------------------------
// `M210` `S2` — `replaceInSource`. The other direction: an edit to a statement that already exists.
//
// `insertIntoSource` above adds work to a file. Compose reads a file now (`D1072`), so the next
// thing it must be able to do is **change one statement without touching any other byte** — which
// is `D1046`'s splice argument applied to editing rather than to writing, and buys the same thing:
// the printer has to be right about the node being edited and about nothing else.
//
// Every case asserts `acceptable()` for the reason at the top of this file, and every case also
// asserts what was **not** touched, because "the edit landed" and "the edit landed and nothing else
// moved" are different claims and only the second one is the point.

/** A file with something of every kind around the statement under edit. */
const AROUND = `# the file's own header
#
# two paragraphs of it

import "./shared/root.tflw"

before
  api POST /reset
  expect status equals 204

@crud @orders
test "it places an order" as admin
  # a note on the let
  let n = 1
  api POST /orders body { itemId: 1 }
    header "A" is "b"
  expect status equals 201
  capture body.id as orderId
  api GET /orders/{orderId}
  expect status equals 200
`;

const putStep = (spec: Partial<ApiStepSpec> = {}) => {
  const built = buildApiStep({ service: null, method: 'PUT', path: '/orders/{orderId}', headers: [], body: null, label: null, ...spec });
  assert.ok(built.ok, built.ok ? '' : built.reason);
  return built.node;
};

test('`M210` `S2`: a step is replaced in place and every other byte of the file survives', () => {
  // `step` counts STATEMENTS, and a comment is not one: the `let` is 0 and the request is 1. The
  // first draft of this test said 2 and replaced the `expect` — which the gate caught, because it
  // asserts what did *not* move as well as what did.
  const out = replaceInSource(AROUND, { kind: 'step', path: { decl: 1, step: 1 }, node: putStep({ headers: [{ name: 'X', value: 'y' }], body: { kind: 'json', text: '{ qty: 3 }' }, label: 'place' }) });
  assert.ok(out.ok, out.ok ? '' : out.reason);
  acceptable(out.text, 'a replaced step');
  assert.match(out.text, /^ {2}api PUT \/orders\/\{orderId\} body \{ qty: 3 \} as "place"$/m);
  assert.match(out.text, /^ {4}header "X" is "y"$/m, "the new step's own sub-block is there");
  assert.doesNotMatch(out.text, /api POST \/orders body/, 'and the one it replaced is gone');

  // **What did NOT move.** This is the half that matters: a reprint would have kept the file
  // parseable while quietly renormalising everything around the edit.
  assert.match(out.text, /^# the file's own header$/m);
  assert.match(out.text, /^import "\.\/shared\/root\.tflw"$/m);
  assert.match(out.text, /^@crud @orders$/m);
  assert.match(out.text, /^test "it places an order" as admin$/m);
  assert.match(out.text, /^ {2}# a note on the let$/m, 'a comment above an untouched statement stays where it was');
  assert.match(out.text, /^ {2}let n = 1$/m);
  assert.match(out.text, /^ {2}expect status equals 201$/m, 'the assertions that read the response are untouched');
  assert.match(out.text, /^ {2}capture body\.id as orderId$/m);
  assert.match(out.text, /^ {2}api GET \/orders\/\{orderId\}$/m, 'and so is the request after it');
  assert.match(out.text, /^ {2}api POST \/reset$/m, "and the hook's");
});

test('`M210` `S2`: a hook is a declaration like any other, and `decl` counts in line order', () => {
  // The hook is declared first, so it is `decl: 0` — the same ordering the UI's outline builds,
  // and the reason the path is an index pair rather than a test name: a hook has no name.
  const out = replaceInSource(AROUND, { kind: 'step', path: { decl: 0, step: 0 }, node: putStep({ path: '/reset-all' }) });
  assert.ok(out.ok, out.ok ? '' : out.reason);
  acceptable(out.text, 'a replaced hook step');
  assert.match(out.text, /^ {2}api PUT \/reset-all$/m);
  assert.match(out.text, /^ {2}api POST \/orders body \{ itemId: 1 \}$/m, "the test's own request is untouched");
});

test("`M210` `S2`: the span's trailing whitespace is trimmed, or the next statement is glued on", () => {
  // A step's span runs to the start of whatever follows it, so a request with an indented
  // sub-block ends `…\n  ` — the newline and the NEXT line's indentation. Cutting through that
  // produces text that does not lex. The step under edit here is exactly that shape.
  const out = replaceInSource(AROUND, { kind: 'step', path: { decl: 1, step: 1 }, node: putStep() });
  assert.ok(out.ok, out.ok ? '' : out.reason);
  const lines = out.text.split('\n');
  const at = lines.findIndex((l) => l.trim().startsWith('api PUT'));
  assert.ok(at >= 0);
  assert.equal(lines[at + 1], '  expect status equals 201', 'the following statement is still its own line');
});

test('`M210` `S2`: an index that does not exist is refused, and the source comes back untouched', () => {
  for (const path of [{ decl: 9, step: 0 }, { decl: 1, step: 99 }]) {
    const out = replaceInSource(AROUND, { kind: 'step', path, node: putStep() });
    assert.equal(out.ok, false, `path ${JSON.stringify(path)} should be refused`);
    if (!out.ok) assert.match(out.reason, /has no (declaration|step)/);
  }
});

test('`M210` `S2`: source that does not parse is refused rather than guessed at', () => {
  const out = replaceInSource('test "a"\n  capture body.id as\n', { kind: 'step', path: { decl: 0, step: 0 }, node: putStep() });
  assert.equal(out.ok, false);
  if (!out.ok) assert.match(out.reason, /does not parse/);
});

test('`M210` `S2`: an unformatted file is formatted first, so the indices still name what they named', () => {
  // `insertIntoSource` normalises for `TF003`'s reason and this must too — but normalising moves
  // LINES, which is why the path is an index pair rather than a line.
  //
  // **THREE-SPACE INDENTATION, AND THAT IS THE WHOLE TEST.** The first draft used four, and the
  // mutation removing the initial `format()` stayed green: four is exactly twice `INDENT`, so the
  // block level this function derives from a column came out right by arithmetic coincidence and
  // the un-normalised splice happened to land at a legal depth. Three is legal tflw (the offside
  // rule takes any consistent indent) and is not a multiple of two, so the coincidence is gone and
  // the claim is falsifiable. A fixture that cannot separate the rule from an accident is not a
  // fixture for that rule.
  const three = 'test "a"\n   api GET /one\n   expect status equals 200\n   api GET /two\n   expect status equals 200\n';
  assert.deepEqual(parseSource(three).diagnostics.filter((d) => d.severity === 'error'), [], 'three-space indentation is legal tflw');
  const out = replaceInSource(three, { kind: 'step', path: { decl: 0, step: 2 }, node: putStep({ path: '/replaced' }) });
  assert.ok(out.ok, out.ok ? '' : out.reason);
  acceptable(out.text, 'a replaced step in a three-space file');
  assert.match(out.text, /^ {2}api GET \/one$/m, 'the whole file is normalised to `INDENT`, which the write route requires anyway');
  assert.match(out.text, /^ {2}api PUT \/replaced$/m, 'and the third statement is the one that changed');
});

test('`M210` `S2`: the result is a fixpoint of `format`, which is what the write route demands', () => {
  const out = replaceInSource(AROUND, { kind: 'step', path: { decl: 1, step: 4 }, node: putStep({ path: '/orders/{orderId}/pay', method: 'POST' }) });
  assert.ok(out.ok, out.ok ? '' : out.reason);
  const again = format(out.text);
  assert.ok(again.ok);
  assert.equal(again.formatted, out.text, '`D1049` refuses text `format` would still change');
});
