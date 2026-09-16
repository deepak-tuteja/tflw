// `D1043`'s derivation — `M200` `A0-3`.
//
// The load-bearing test in this file is the tag control. `D1043` says a mode is derived from
// constructs and never from a label, and the only way to assert that is to show the same body
// landing in the same lenses with the tags removed, and a `@security` tag on a browser test
// buying nothing. Everything else here could pass under an implementation that read the tags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSource, lensesOfTest, lensesOfCrawl, checkProgram, STEP_LENS, SUBJECT_LENS } from '../src/index.js';
import type { Step, Subject } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

const lenses = (src: string): readonly string[] => {
  const { program, diagnostics } = parseSource(src);
  assert.deepEqual(diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.message}`), [], src);
  assert.equal(program.tests.length, 1, src);
  return lensesOfTest(program.tests[0]!);
};

test('a lens is derived from the constructs a test carries', () => {
  assert.deepEqual(lenses('test "t"\n  api GET /x\n  expect status equals 200\n'), ['api']);
  assert.deepEqual(lenses('test "t"\n  open "/shop"\n  click button "Buy"\n'), ['browser']);
  assert.deepEqual(lenses('test "t"\n  run 10 iterations across 2 users\n  api GET /x\n'), ['api', 'load']);
  assert.deepEqual(lenses('test "t"\n  api GET /x\n  expect response has no security violations\n'), ['api', 'scan']);
  // A test that does nothing a door is about is in no door, and that is an answer.
  assert.deepEqual(lenses('test "t"\n  let x = 1\n  expect {x} equals 1\n'), []);
});

test('the tag buys nothing — the control that makes D1043 a claim about constructs', () => {
  // `@load` and `@security` carry no runtime meaning: they are ordinary user tags beside
  // `@orders` and `@flaky`. If the derivation read them, these four would disagree.
  const workload = '  run 10 iterations across 2 users\n  api GET /x\n';
  assert.deepEqual(lenses(`test "t"\n${workload}`), lenses(`@load\ntest "t"\n${workload}`));
  assert.deepEqual(lenses(`@security @flaky @orders\ntest "t"\n${workload}`), ['api', 'load']);

  // And a tag cannot put a test in a door its body has no evidence for.
  assert.deepEqual(lenses('@security\ntest "t"\n  open "/shop"\n  click button "Buy"\n'), ['browser']);
  assert.deepEqual(lenses('@load\ntest "t"\n  api GET /x\n  expect status equals 200\n'), ['api']);
});

test('the two fixture shapes the grilling turned on', () => {
  // `load.tflw`'s tests ARE functional tests with a workload line round them — the case that
  // makes "a mode is a kind of test" fail, since it belongs to two doors at once.
  assert.deepEqual(
    lenses('@load\ntest "the catalog holds"\n  run 120 iterations across 4 users\n  api GET /search?q=g as "search"\n  expect status equals 200\n  threshold p95 duration is less than 500ms\n'),
    ['api', 'load'],
  );
  // `security.tflw`'s third test is an `api POST /login` with one severity gate.
  assert.deepEqual(
    lenses('@security\ntest "login resists"\n  api POST /login body { user: "a" }\n  expect response has no serious security violations\n'),
    ['api', 'scan'],
  );
});

test('accessibility is a browser assertion, not a fifth door', () => {
  // Resolved by measurement in §1 and never put to the user: the matcher takes the `page`
  // subject, and a crawl body cannot hold it.
  assert.deepEqual(lenses('test "t"\n  open "/shop"\n  expect page has no critical a11y violations\n'), ['browser']);
});

test('a threshold alone is load evidence — D1044’s own case', () => {
  // The LOAD lens may add a threshold to a test whose workload line is not written yet; the test
  // has to appear in LOAD the moment it does, or the lens cannot see what it just wrote.
  assert.deepEqual(lenses('test "t"\n  api GET /x\n  threshold error rate is less than 1%\n'), ['api', 'load']);
});

test('evidence nested inside a block still counts', () => {
  assert.deepEqual(lenses('test "t"\n  open "/x"\n  within list "Cart"\n    click button "Remove"\n'), ['browser']);
  assert.deepEqual(
    lenses('test "t"\n  wait until api GET /jobs\n    expect status equals 200\n'),
    ['api'],
  );
});

test('a crawl is the SCANS door’s own declaration', () => {
  const { program } = parseSource('crawl "the surface"\n  seed spider "/"\n  expect response has no security violations\n');
  // `Program.crawls` is absent-when-empty by design (`ast.ts`: a required field would put
  // `"crawls": []` into every program's serialised AST and redden 31 parser goldens), so presence
  // is asserted rather than assumed.
  const crawls = program.crawls;
  assert.ok(crawls, 'the program declares a crawl');
  assert.equal(crawls.length, 1);
  assert.deepEqual(lensesOfCrawl(crawls[0]!), ['scan']);
});

test('the classification tables cover their unions, checked against ast.ts itself', () => {
  // `tsc` already proves this: both tables are `Record<Step['type'], …>`/`Record<Subject['type'],
  // …>`, so a union member with no entry is a compile error. This is the second, independent
  // control — it reads the union out of the source, so it also catches the tables being held to a
  // union that quietly stopped being the real one.
  const ast = readFileSync(join(here, '..', 'src', 'ast.ts'), 'utf8');
  const members = (name: string): string[] => {
    const start = ast.indexOf(`export type ${name} =`);
    assert.ok(start > 0, `${name} not found in ast.ts`);
    const body = ast.slice(start, ast.indexOf(';', start));
    return [...body.matchAll(/\|\s*([A-Z][A-Za-z]*)/g)].map((m) => m[1]!);
  };
  assert.deepEqual(members('Step').filter((m) => !(m in STEP_LENS)), [], 'every Step is classified');
  assert.deepEqual(members('Subject').filter((m) => !(m in SUBJECT_LENS)), [], 'every Subject is classified');
  assert.deepEqual(Object.keys(STEP_LENS).filter((k) => !members('Step').includes(k)), [], 'STEP_LENS names no step that is not one');
  assert.deepEqual(Object.keys(SUBJECT_LENS).filter((k) => !members('Subject').includes(k)), [], 'SUBJECT_LENS names no subject that is not one');
});

/**
 * `M201-01` — **`M200-05`'s twin, found by the first push of this branch and not before.**
 *
 * This gate walked `repoRoot` **and** `siblingRoot` and asserted `total > 400`, which is a claim
 * about `testFlow-tests`. CI has one tree by decision (`D710` refuses a sibling checkout; `D511`
 * fixes the merge order), so on the first push it classified **42 tests** and went red — while the
 * printer gate beside it, repaired in `M201`, passed.
 *
 * That is the part worth recording: **a finding named after one file gets repaired in that file.**
 * `M200-05` was written up as *`print.test.ts` reads the sibling*, the repair was scoped to
 * `print.test.ts`, and the identical defect sat two files away for the whole of `M200` and `M201`
 * because nobody asked which *other* guards walk a corpus. The census that answers it is one
 * `grep` for `testFlow-tests` under every package's test directory, and it was never run.
 * (Writing that path with a glob is what broke this docblock on the first run: the two
 * characters that end a comment sit in the middle of it.)
 *
 * Repaired in `M201`'s shape (`D1056`, `D1058`): the **corpus is this repository**, the sibling is
 * **pressure**, the count is pinned by **equality** rather than a floor — a floor is blind in
 * exactly the direction both defects ran — and the ratio `D1043` argues from is measured on the
 * corpus, where it is **35.7%** and makes the argument without borrowing anything.
 */
test('every test in the corpus classifies, and a third of them land in more than one lens', () => {
  const SKIP = /^(node_modules|dist|\.git|runs|coverage)$|^\.m.*-scratch$/;
  const walk = (dir: string, out: string[] = []): string[] => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return out; }
    for (const entry of entries) {
      if (SKIP.test(entry)) continue;
      const p = join(dir, entry);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p, out);
      else if (entry.endsWith('.tflw')) out.push(p);
    }
    return out;
  };
  const root = resolve(here, '..', '..', '..');

  const census = (files: string[]): { total: number; multi: number; combos: Map<string, number> } => {
    let total = 0;
    let multi = 0;
    const combos = new Map<string, number>();
    for (const file of files) {
      const { program, diagnostics } = parseSource(readFileSync(file, 'utf8'));
      if (diagnostics.some((d) => d.severity === 'error')) continue;
      for (const t of program.tests) {
        const ls = lensesOfTest(t);
        total += 1;
        if (ls.length > 1) multi += 1;
        const key = ls.join('+') || '(none)';
        combos.set(key, (combos.get(key) ?? 0) + 1);
      }
    }
    return { total, multi, combos };
  };

  const mine = census(walk(root));
  const theirs = census(walk(resolve(root, '..', 'testFlow-tests')));

  console.log(`\n  lens census — ${mine.total} tests in this repository, ${mine.multi} in more than one lens` +
    (theirs.total > 0 ? `  (+ ${theirs.total} in the sibling, ${theirs.multi} multi-lens, pressure only)` : ''));
  for (const [k, n] of [...mine.combos.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(5)}  ${k}`);
  console.log('');

  // AN EQUALITY, over this repository's corpus (`D1058`). The old `total > 400` was a floor over
  // two trees: it could not see the sibling arriving, which is how it passed here for the whole of
  // `M200`, and it could not survive the sibling leaving, which is how it failed in CI.
  // `M203` `S3` — the doors corpus (`__fixtures__/doors-corpus/`, 2 files, 8 tests + 1 crawl) joined this repository's corpus: 42 -> 50 (its 8 tests; the crawl is counted by `combos`, not by `total`).
  const EXPECTED_TESTS = 50;
  assert.equal(mine.total, EXPECTED_TESTS,
    `the corpus classified ${mine.total} tests, expected ${EXPECTED_TESTS} — move the number in the change that moved the corpus`);

  // `D1043`'s whole argument, measured where CI can see it: 15 of 42. The old threshold was 20%
  // against a 30% measurement taken with both trees present; the corpus alone reads 35.7%.
  assert.ok(mine.multi / mine.total > 0.2,
    `${((100 * mine.multi) / mine.total).toFixed(1)}% of corpus tests are multi-lens — D1043's whole argument`);

  // A CORRECTNESS claim, so it reads both: every multi-lens test includes `api` — there is no
  // browser+load, no browser+scan and no three-lens test in either tree. Recorded as measured, not
  // required; a project that wrote one would be legal, and this is deliberately not the assertion
  // that forbids it.
  const offAxis = [...mine.combos.keys(), ...theirs.combos.keys()]
    .filter((k) => k.includes('+') && !k.startsWith('api'));
  assert.deepEqual(offAxis, [], `an off-axis lens combination appeared: ${offAxis.join(', ')}`);

});

// ---------------------------------------------------------------------------
// The isolating table. Written after a mutation run in which FIVE mutations survived — a click
// stopping being browser evidence, a response subject stopping being api evidence, a locator
// subject, and both recursions — all for one reason: every fixture above carries **two** reasons
// for the same conclusion. `within list "Cart"` was preceded by `open`, `expect status` sat beside
// an `api` step, so no single classification was ever the only thing producing its lens and
// deleting any one of them changed no answer.
//
// A fixture carrying two reasons for its conclusion tests neither. So: one minimal source per
// classified node type, holding that construct and nothing else that could account for the
// result. The tables are typed by the unions, so this is exhaustive by construction — a new node
// kind is a compile error here as well as in `lenses.ts`.
// ---------------------------------------------------------------------------

/**
 * One test body per step kind, isolating it, **with the lens it must produce written out here**.
 *
 * The expectation is spelled in this file and never read from `STEP_LENS`. The first draft did
 * read it, and four mutations survived because of it: flipping `ClickStmt: 'browser'` to `null`
 * flipped the expectation in the same breath, so the test compared the implementation with
 * itself and agreed. A test that sources its expectation from the code under test asserts only
 * that the code is self-consistent.
 *
 * `null` means the kind cannot be written in a test body at all, which is asserted rather than
 * skipped — see the test below.
 */
const STEP_FORM: Readonly<Record<Step['type'], readonly [form: string, lenses: readonly string[]] | null>> = {
  ApiStep: ['  api GET /x', ['api']],
  WaitUntilApiStmt: ['  wait until api GET /x\n    expect {v} equals "a"', ['api']],
  // `header` is dual-purpose and `csrf` is session-only: `parseStep` offers neither.
  HeaderStmt: null,
  CsrfStmt: null,
  OpenStmt: ['  open "/x"', ['browser']],
  ClickStmt: ['  click button "Buy"', ['browser']],
  FillStmt: ['  fill field "Email" with "a@b.c"', ['browser']],
  FillFormStmt: ['  fill form\n    | "Email" | "a@b.c" |', ['browser']],
  SelectStmt: ['  select "Widget" from field "Size"', ['browser']],
  TickStmt: ['  tick field "Accept terms"', ['browser']],
  UntickStmt: ['  untick field "Accept terms"', ['browser']],
  PressStmt: ['  press "Enter" on field "Search"', ['browser']],
  HoverStmt: ['  hover button "Menu"', ['browser']],
  ScrollStmt: ['  scroll to button "Load more"', ['browser']],
  WithinBlock: ['  within list "Cart items"\n    log "inside"', ['browser']],
  AcceptDialogStmt: ['  accept dialog with "Blue"', ['browser']],
  DismissDialogStmt: ['  dismiss dialog', ['browser']],
  SwitchToNewTabBlock: ['  switch to new tab\n    log "inside"', ['browser']],
  SwitchToTabStmt: ['  switch to tab 1', ['browser']],
  CloseTabStmt: ['  close tab', ['browser']],
  DownloadBlock: ['  download as file\n    log "inside"', ['browser']],
  DragStmt: ['  drag text "First" to text "Second"', ['browser']],
  DropFileStmt: ['  drop file "./receipt.png" onto css "#dropzone"', ['browser']],
  ScreenshotStmt: ['  screenshot "before payment"', ['browser']],
  StubStmt: ['  stub POST "/pay" respond status 500', ['browser']],
  WaitUntilUiStmt: ['  wait until button "Submit" is enabled', ['browser']],
  ExpectStmt: ['  expect {v} equals "a"', []],
  LetStmt: ['  let v = "a"', []],
  CaptureStmt: ['  capture body.id as orderId', []],
  LogStmt: ['  log "hello"', []],
  GiveStmt: null, // an action's return; ends a step sequence, and a test is not an action
  CallStmt: ['  call an action()', []],
  PauseStmt: ['  pause 500ms', []],
  MalformedStep: null, // the parser's recovery node — the absence of a construct
};

/** `expect <form> …`, one per subject kind (the forms are `specManifest.test.ts`'s own table),
 *  with the lens it must produce written out here rather than read from `SUBJECT_LENS`. */
const SUBJECT_FORM: Readonly<Record<Subject['type'], readonly [form: string, lenses: readonly string[]]>> = {
  StatusSubject: ['status', ['api']],
  DurationSubject: ['duration', ['api']],
  HeaderSubject: ['header "content-type"', ['api']],
  BodySubject: ['body.total', ['api']],
  BodyTextSubject: ['body text', ['api']],
  BodyBytesSubject: ['body bytes', ['api']],
  BodyCsvSubject: ['body csv', ['api']],
  BodyPdfTextSubject: ['body pdf text', ['api']],
  RequestSubject: ['request', ['api']],
  NetworkRequestSubject: ['request to "https://example.test/orders"', ['browser']],
  LocatorSubject: ['button "Submit"', ['browser']],
  PageSubject: ['page', ['browser']],
  ResponseSubject: ['response', ['api']],
  DialogMessageSubject: ['dialog message', ['browser']],
  DialogTypeSubject: ['dialog type', ['browser']],
  ValueSubject: ['{orderId}', []],
};

test('each step kind produces its own lens, alone, with nothing else to account for it', () => {
  const wrong: string[] = [];
  for (const [nodeType, entry] of Object.entries(STEP_FORM)) {
    if (entry === null) continue;
    const [form, expectedLenses] = entry;
    const src = `test "t"\n${form}\n`;
    const { program, diagnostics } = parseSource(src);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    if (errors.length > 0) { wrong.push(`${nodeType}: ${errors.map((e) => `${e.code} ${e.message}`).join('; ')} — for ${JSON.stringify(form)}`); continue; }
    const step = program.tests[0]?.body[0];
    if (step?.type !== nodeType) { wrong.push(`${nodeType}: parsed as ${step?.type ?? 'nothing'}`); continue; }
    const got = lensesOfTest(program.tests[0]!);
    if (got.join('+') !== expectedLenses.join('+')) {
      wrong.push(`${nodeType}: expected [${expectedLenses.join('+') || 'nothing'}], got [${got.join('+') || 'nothing'}]`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('each subject produces its own lens, alone', () => {
  const wrong: string[] = [];
  for (const [nodeType, [form, expectedLenses]] of Object.entries(SUBJECT_FORM)) {
    const src = `test "t"\n  expect ${form} equals "x"\n`;
    const { program, diagnostics } = parseSource(src);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    if (errors.length > 0) { wrong.push(`${nodeType}: ${errors.map((e) => e.code).join(',')} for \`${form}\``); continue; }
    const got = lensesOfTest(program.tests[0]!);
    if (got.join('+') !== expectedLenses.join('+')) {
      wrong.push(`${nodeType}: expected [${expectedLenses.join('+') || 'nothing'}], got [${got.join('+') || 'nothing'}]`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('the two step kinds that cannot be written in a test body are refused there', () => {
  // `HeaderStmt` is dual-purpose and `CsrfStmt` is session-only — both are in the `Step` union and
  // neither is offered by `parseStep`, which is why `STEP_FORM` files them as `null`. Asserted
  // rather than skipped: a `null` that is merely "I did not work out the syntax" is a hole.
  for (const form of ['  header "X-Token" is "abc"', '  csrf from body.token send as header "X-CSRF"']) {
    const { diagnostics } = parseSource(`test "t"\n${form}\n`);
    assert.ok(diagnostics.some((d) => d.severity === 'error'), `\`${form.trim()}\` should not parse in a test body`);
  }
});

test('a `wait until api` body’s own evidence counts — the recursion, isolated', () => {
  // The recursion into `expects` is only observable when an inner assertion carries evidence the
  // outer step does not. `WaitUntilApiStmt` is already api, so a scan matcher inside it is the
  // one thing that can tell the two apart.
  const src = 'test "t"\n  wait until api GET /x\n    expect response has no security violations\n';
  const { program, diagnostics } = parseSource(src);
  assert.deepEqual(diagnostics.filter((d) => d.severity === 'error'), []);
  assert.deepEqual(lensesOfTest(program.tests[0]!), ['api', 'scan']);
});

test('a block’s inner evidence counts — the recursion, isolated from the block itself', () => {
  // `within`, `switch to new tab` and `download as` are each browser evidence in their own right,
  // so a click nested inside one is indistinguishable from the block containing it and the
  // recursion cannot be observed through it. The inner step has to carry a lens the block does
  // not — which is why these three bodies hold an `api` step rather than another click.
  const cases: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['  within list "Cart items"\n    api GET /x', ['api', 'browser']],
    ['  switch to new tab\n    api GET /x', ['api', 'browser']],
    ['  download as file\n    api GET /x', ['api', 'browser']],
  ];
  const wrong: string[] = [];
  for (const [form, expected] of cases) {
    const { program, diagnostics } = parseSource(`test "t"\n${form}\n`);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    if (errors.length > 0) { wrong.push(`${form}: ${errors.map((e) => e.code).join(',')}`); continue; }
    const got = lensesOfTest(program.tests[0]!);
    if (got.join('+') !== expected.join('+')) wrong.push(`${form}: expected [${expected.join('+')}], got [${got.join('+') || 'nothing'}]`);
  }
  assert.deepEqual(wrong, []);
});

/**
 * `M203` `S3`/`S2` — the doors corpus, and the two rules that bound it.
 *
 * **The corpus is `__fixtures__/doors-corpus/`, and it is this repository's own** (`D874`: every
 * guard declares the corpus it reads; `D1056`: a corpus authored for a claim, not harvested). It
 * is deliberately NOT the sibling's: `D710` refuses a sibling checkout in CI and `M200-05` /
 * `M201-01` are both *this guard has been measuring the other repository*. A door gate reading
 * `tflw-acceptance/security` would be that defect filed a third time.
 *
 * **Nine of fifteen, and the number was twelve until the checker was asked.** Four lenses admit 15
 * non-empty combinations. Six cannot exist, for two unrelated reasons, and the gate below
 * demonstrates each rather than asserting the combinations are merely absent — absence is what a
 * corpus that forgot to include them also looks like.
 */
const DOORS_CORPUS = join(here, '__fixtures__', 'doors-corpus');

/** The nine, in `LENSES` order within each row. An **equality** below, never a floor (`D1058`): a
 *  floor is blind in exactly the direction that matters here, which is a combination going
 *  missing. */
const REACHABLE = [
  'api', 'browser', 'load', 'scan',
  'api+browser', 'api+load', 'api+scan',
  'api+browser+scan', 'api+load+scan',
] as const;

test('the doors corpus carries every lens combination the language admits, and exactly those', () => {
  const found = new Map<string, string[]>();
  for (const entry of readdirSync(DOORS_CORPUS)) {
    if (!entry.endsWith('.tflw')) continue;
    const file = join(DOORS_CORPUS, entry);
    const { program, diagnostics } = parseSource(readFileSync(file, 'utf8'));
    assert.deepEqual(
      diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.message}`), [],
      `${entry} must parse — it is the corpus this gate reads`);
    // The checker runs too, because three of the six exclusions are ITS rule and a corpus that
    // only parses could hold a combination no project can contain (`TF033`).
    assert.deepEqual(
      checkProgram(program).filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.message}`), [],
      `${entry} must check — a combination the checker refuses is not one a door can ever show`);
    for (const t of program.tests) {
      const k = lensesOfTest(t).join('+') || '(none)';
      found.set(k, [...(found.get(k) ?? []), `${entry}:${t.span.start.line}`]);
    }
    for (const c of program.crawls ?? []) {
      const k = lensesOfCrawl(c).join('+');
      found.set(k, [...(found.get(k) ?? []), `${entry}:${c.span.start.line}`]);
    }
  }
  assert.deepEqual([...found.keys()].sort(), [...REACHABLE].sort(),
    'the corpus must hold each of the nine reachable combinations and nothing else');
  // One each: a combination carried twice would let a deletion go unnoticed, which is the same
  // blindness the equality above removes.
  assert.deepEqual([...found].filter(([, where]) => where.length !== 1).map(([k, w]) => `${k}: ${w.join(', ')}`), [],
    'exactly one declaration per combination');
});

test('`scan` without `api` is unreachable for a test — asked of every non-api subject there is', () => {
  // A test reaches `scan` only through `MATCHER_LENS`'s three severity matchers, and a matcher
  // contributes no subject of its own. So `scan` without `api` needs a severity matcher standing
  // against a subject whose own lens is NOT api. `SUBJECT_LENS` names exactly which those are —
  // read from the table rather than listed here, so a new non-api subject cannot slip past.
  const nonApi = (Object.entries(SUBJECT_LENS) as Array<[Subject['type'], string | null]>)
    .filter(([, lens]) => lens !== 'api').map(([kind]) => kind);
  const SPELLING: Readonly<Partial<Record<Subject['type'], string>>> = {
    NetworkRequestSubject: 'request to "/x"',
    LocatorSubject: 'button "Buy"',
    PageSubject: 'page',
    DialogMessageSubject: 'dialog message',
    DialogTypeSubject: 'dialog type',
    ValueSubject: '{v}',
  };
  assert.deepEqual(nonApi.filter((k) => SPELLING[k] === undefined), [],
    'every non-api subject needs a spelling here, or this gate stops being exhaustive');

  const admitted: string[] = [];
  for (const kind of nonApi) {
    const src = `test "t"\n  let v = 1\n  expect ${SPELLING[kind]!} has no security violations\n`;
    const { program, diagnostics } = parseSource(src);
    const bad = [...diagnostics, ...(program.tests.length === 1 ? checkProgram(program) : [])]
      .filter((d) => d.severity === 'error');
    if (bad.length > 0) continue; // refused, which is the claim
    const lenses = lensesOfTest(program.tests[0]!);
    if (!lenses.includes('api')) admitted.push(`${kind} -> ${lenses.join('+') || 'nothing'}`);
  }
  assert.deepEqual(admitted, [],
    'a severity matcher reached a non-api subject, so `scan` no longer implies `api` and the SCANS door has silently widened');
});

test('`browser` inside a workload is TF033 — the checker rule that removes three more combinations', () => {
  // `browser+load`, `api+browser+load` and `api+browser+load+scan` all PARSE and all CLASSIFY:
  // `lensesOfTest` returns `browser+load` quite happily. Only the checker knows they cannot exist,
  // which is why this gate runs it. `M202` §7 measured the reachable set with `parseSource` alone
  // and reported twelve; the language is the parser AND the checker.
  const workload = '  ramp to 5 users over 2s\n  threshold p95 duration is less than 1000ms\n  threshold error rate is less than 1%\n';
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['browser+load', `${workload}  open "/shop"\n`],
    ['api+browser+load', `${workload}  api GET /x\n  open "/shop"\n`],
    ['api+browser+load+scan', `${workload}  api GET /x\n  open "/shop"\n  expect response has no security violations\n`],
  ];
  const survived: string[] = [];
  for (const [label, body] of cases) {
    const { program, diagnostics } = parseSource(`test "t"\n${body}`);
    assert.deepEqual(diagnostics.filter((d) => d.severity === 'error'), [], `${label} is expected to PARSE`);
    assert.equal(lensesOfTest(program.tests[0]!).join('+'), label, `${label} is expected to CLASSIFY as itself`);
    if (!checkProgram(program).some((d) => d.code === 'TF033' && d.severity === 'error')) survived.push(label);
  }
  assert.deepEqual(survived, [],
    'a browser step inside a workload now checks clean, so three combinations became reachable and the corpus is short of them');
});
