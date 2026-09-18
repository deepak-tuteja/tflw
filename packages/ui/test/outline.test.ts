// The reader's gate (`M210` `S1`, `D1072`). Two claims, both equalities, plus the rules themselves.
//
// **IT COUNTS THIS REPOSITORY'S FILES, NOT THE SIBLING'S**, and that is a correction to the plan
// rather than a shortcut. `PLAN_M210` `S6` writes the floor as *"for every file in the sibling
// corpus"* — which is exactly `M200-05`, the defect `M201` repaired three rounds ago: a gate whose
// numbers come from a tree CI does not have (`D710` refuses a sibling checkout) meets its floors at
// roughly 1% of their pin on the first push. So the shape is `print.test.ts`'s (`D1056`): this
// repository's own `.tflw` files carry every claim — **21** of them after `SKIP_DIR` drops the
// scratch directories and pulled run artefacts, holding 544 steps of 31 kinds — and the sibling is
// **pressure with no number on it** — the same verdict either way, more slowly arrived at when it
// is there.
//
// **BOTH CLAIMS ARE EQUALITIES, NOT FLOORS.** A floor is blind in one direction, and in a reader
// the blind direction is the dangerous one: *at least N steps were placed* stays green while a
// step kind silently lands nowhere. `placed === total` cannot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApiStep, lex, parseSource, replaceInSource, STEP_LENS, type Step } from '@tflw/lang';
import { addressed, fileOutline, groupBody, isForeign, prefixOf, readNotes, statementsOf } from '../src/outline';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const siblingRoot = join(repoRoot, '..', 'testFlow-tests');

/** Directories that hold copies rather than sources — `print.test.ts`'s own list. */
const SKIP_DIR = /^(node_modules|dist|\.git|runs|coverage)$|^\.m.*-scratch$/;

function corpus(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (SKIP_DIR.test(entry)) continue;
      const p = join(dir, entry);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (entry.endsWith('.tflw')) out.push(p);
    }
  };
  walk(root);
  return out;
}

/** Every top-level step of every hook and test body — what the outline has to place. A block's
 *  nested steps are inside the block's own printed row, so the unit here is the body's own list. */
function topLevelSteps(source: string): Step[] {
  const { program } = parseSource(source);
  return [...program.hooks.flatMap((h) => h.body), ...program.tests.flatMap((t) => t.body)];
}

test('every step of every body lands in exactly one row, by kind', () => {
  const files = corpus(repoRoot);
  // 21 files at the time of writing — `printer-corpus`, `migrate-corpus`, `doors-corpus`, the UI
  // fixtures and `examples/storefront`. Small, authored, and present in CI, which is the whole
  // point of it; the sibling below is where the volume is. The guard is against a walk that finds
  // nothing and reports success for having examined zero files.
  assert.ok(files.length > 15, `the corpus is ${files.length} files — a walk that finds nothing is a broken walk, not a held claim`);
  const total: Record<string, number> = {};
  const placed: Record<string, number> = {};
  for (const path of files) {
    const source = readFileSync(path, 'utf8');
    for (const s of topLevelSteps(source)) total[s.type] = (total[s.type] ?? 0) + 1;
    const outline = fileOutline(path, source);
    for (const decl of outline.declarations) {
      // A request is a row; a statement is a row; nothing else is in a body.
      for (const r of decl.body.requests) placed[r.kind] = (placed[r.kind] ?? 0) + 1;
      for (const s of statementsOf(decl.body)) {
        // `wait until api`'s nested expects are its own attachments and are NOT top-level steps,
        // so they are counted out here rather than inflating the comparison.
        if (s.nested) continue;
        placed[s.kind] = (placed[s.kind] ?? 0) + 1;
      }
    }
  }
  const kinds = [...new Set([...Object.keys(total), ...Object.keys(placed)])].sort();
  const mismatched = kinds.filter((k) => (total[k] ?? 0) !== (placed[k] ?? 0));
  assert.deepEqual(mismatched, [], `these kinds were not placed exactly once: ${mismatched.map((k) => `${k} ${total[k] ?? 0}→${placed[k] ?? 0}`).join(', ')}`);
  const sum = Object.values(total).reduce((a, b) => a + b, 0);
  console.log(`  outline: ${sum} steps of ${kinds.length} kinds across ${files.length} files, every one placed`);
});

test('the sibling is pressure and carries no number', { skip: corpus(siblingRoot).length === 0 ? 'the sibling is not on this machine' : false }, () => {
  for (const path of corpus(siblingRoot)) {
    const source = readFileSync(path, 'utf8');
    const total: Record<string, number> = {};
    for (const s of topLevelSteps(source)) total[s.type] = (total[s.type] ?? 0) + 1;
    const placed: Record<string, number> = {};
    for (const decl of fileOutline(path, source).declarations) {
      for (const r of decl.body.requests) placed[r.kind] = (placed[r.kind] ?? 0) + 1;
      for (const s of statementsOf(decl.body)) {
        if (s.nested) continue;
        placed[s.kind] = (placed[s.kind] ?? 0) + 1;
      }
    }
    assert.deepEqual(placed, total, `${path} placed a different multiset of steps than it holds`);
  }
});

test('not one comment line is lost — every one is a header, a note or the tail', () => {
  for (const path of corpus(repoRoot)) {
    const source = readFileSync(path, 'utf8');
    const written = lex(source).lines.filter((l) => l.kind === 'comment').length;
    const notes = readNotes(source);
    const kept =
      (notes.header?.lines.length ?? 0) +
      (notes.tail?.lines.length ?? 0) +
      [...notes.byOwner.values()].reduce((n, x) => n + x.lines.length, 0);
    assert.equal(kept, written, `${path}: ${written} comment lines written, ${kept} carried`);
  }
});

test('a block on line 1 is the file header, and a blank line under it changes nothing', () => {
  const notes = readNotes('# the file\n# two lines\n\ntest "a"\n  log info "x"\n');
  assert.equal(notes.header?.lines.length, 2);
  assert.equal(notes.header?.first, '# the file');
  assert.equal(notes.byOwner.size, 0, 'the header owns no declaration');
});

test('a header and a note on the first declaration are two blocks, told apart by the air between them', () => {
  const notes = readNotes('# the file\n\n# about this test\ntest "a"\n  log info "x"\n');
  assert.equal(notes.header?.first, '# the file');
  assert.equal(notes.byOwner.get(4)?.first, '# about this test');
});

test('a block owns the next line of code across a blank line — 127 of the corpus s 419 blocks do', () => {
  const notes = readNotes('test "a"\n  # about the log\n\n  log info "x"\n');
  assert.equal(notes.byOwner.get(4)?.first, '# about the log');
});

test('a block with no code after it is the tail, not a loss', () => {
  const notes = readNotes('test "a"\n  log info "x"\n\n# an idea nobody wrote yet\n');
  assert.equal(notes.tail?.first, '# an idea nobody wrote yet');
});

const SRC = `test "orders"
  let n = 2
  api GET /orders
  expect status equals 200
  capture body.id as orderId
  api POST /orders/{orderId}/pay
  expect status equals 201
`;

test('a statement belongs to the request above it, and the preamble is what has none', () => {
  const outline = fileOutline('t.tflw', SRC);
  const t = outline.declarations[0]!;
  assert.equal(t.kind, 'test');
  assert.deepEqual(t.body.preamble.map((s) => s.kind), ['LetStmt']);
  assert.equal(t.body.requests.length, 2);
  assert.deepEqual(t.body.requests[0]!.attached.map((s) => s.kind), ['ExpectStmt', 'CaptureStmt']);
  assert.deepEqual(t.body.requests[1]!.attached.map((s) => s.kind), ['ExpectStmt']);
  assert.equal(t.body.requests[1]!.path, '/orders/{orderId}/pay');
  assert.equal(t.body.requests[1]!.method, 'POST');
});

test('a body with no request at all is one preamble, which is what a browser test looks like from here', () => {
  const outline = fileOutline('t.tflw', 'test "a"\n  open "/"\n  click button "Buy"\n');
  const t = outline.declarations[0]!;
  assert.equal(t.body.requests.length, 0);
  assert.deepEqual(t.body.preamble.map((s) => s.kind), ['OpenStmt', 'ClickStmt']);
  assert.deepEqual(t.body.preamble.map((s) => s.lens), ['browser', 'browser']);
  assert.ok(t.body.preamble.every((s) => isForeign(s.lens, 'api')), 'a browser step is foreign to the API door');
  assert.ok(t.body.preamble.every((s) => s.text.length > 0), 'a locked row still renders what the step is');
});

test('a neutral statement is nobody s foreign — it is every door s vocabulary', () => {
  for (const kind of ['ExpectStmt', 'LetStmt', 'CaptureStmt', 'LogStmt', 'GiveStmt', 'CallStmt', 'PauseStmt'] as const) {
    assert.equal(STEP_LENS[kind], null, `${kind} is meant to be neutral`);
    assert.equal(isForeign(STEP_LENS[kind], 'api'), false);
    assert.equal(isForeign(STEP_LENS[kind], 'browser'), false);
  }
});

test('wait until api is a request, and its own expects hang off it', () => {
  const outline = fileOutline('t.tflw', 'test "a"\n  wait until api GET /jobs/1\n    expect body.state equals "done"\n');
  const t = outline.declarations[0]!;
  assert.equal(t.body.requests.length, 1);
  assert.equal(t.body.requests[0]!.kind, 'WaitUntilApiStmt');
  assert.equal(t.body.requests[0]!.path, '/jobs/1');
  assert.deepEqual(t.body.requests[0]!.attached.map((s) => s.kind), ['ExpectStmt']);
});

test('a hook is a declaration with a body like any other, in line order with the tests', () => {
  const outline = fileOutline('t.tflw', 'before\n  api POST /reset\n\ntest "a"\n  api GET /x\n');
  assert.deepEqual(outline.declarations.map((d) => d.kind), ['hook', 'test']);
  assert.equal(outline.declarations[0]!.kind === 'hook' ? outline.declarations[0]!.label : '', 'before each');
  assert.equal(outline.declarations[0]!.body.requests.length, 1);
});

test('the test band carries what the test declares, defaults included as defaults', () => {
  const outline = fileOutline('t.tflw', '@smoke @orders\ntest "a" as admin\n  api GET /x\n');
  const t = outline.declarations[0]!;
  assert.equal(t.kind, 'test');
  if (t.kind !== 'test') return;
  assert.deepEqual([...t.tags], ['smoke', 'orders']);
  assert.deepEqual([...t.sessions], ['admin']);
  assert.equal(t.retry, 0, 'retry 0 is the default, and the band must not read it as a fact in use');
  assert.equal(t.table, null);
  assert.equal(t.workload, null);
});

test('a file that does not parse still reads — a pane that showed nothing could not fix the typo', () => {
  const outline = fileOutline('t.tflw', 'test "a"\n  capture body.id as\n  api GET /x\n');
  assert.ok(outline.diagnostics.length > 0, 'the diagnostics are reported');
  assert.equal(outline.declarations.length, 1);
  assert.ok(statementsOf(outline.declarations[0]!.body).length + outline.declarations[0]!.body.requests.length > 0, 'and the body is still drawn');
});

test('grouping is a fold over the body and does not sort it', () => {
  const { program } = parseSource(SRC);
  const body = groupBody(program.tests[0]!.body, readNotes(SRC));
  const lines = [...body.preamble.map((s) => s.line), ...body.requests.flatMap((r) => [r.line, ...r.attached.map((s) => s.line)])];
  assert.deepEqual(lines, [...lines].sort((a, b) => a - b), 'rows come out in the order the file writes them');
});

/** Two tests, and **two requests in the second one** — the second request is what makes the
 *  within-declaration rule falsifiable at all. Written with one each first, and the mutation that
 *  ignores the line entirely stayed green: with one request per test the first and the last are
 *  the same row, so the gate asserted nothing about the line it was named for. */
const MIXED = `test "first"
  api GET /a
  expect status equals 200

test "second"
  let n = 1
  api GET /b
  expect status equals 200
  api POST /c
  expect status equals 201
`;

test('a line naming a test opens THAT test, even when its first request is further down', () => {
  const outline = fileOutline('t.tflw', MIXED);
  // line 5 is `test "second"`; its first request is line 7, and line 2 — the previous test's
  // request — is the nearest request at or before 5. Resolving over the whole file picks that one.
  const at = addressed(outline, 5);
  assert.equal(at?.decl.kind === 'test' ? at.decl.name : null, 'second');
  assert.equal(at?.request?.path, '/b');
});

test('a line inside a body opens the request above it in the same declaration', () => {
  const outline = fileOutline('t.tflw', MIXED);
  // Line 8 is the `expect` under `/b`; line 10 is the `expect` under `/c`. Two requests in one
  // test is what makes this assertion mean anything — see `MIXED`.
  assert.equal(addressed(outline, 8)?.request?.path, '/b');
  assert.equal(addressed(outline, 9)?.request?.path, '/c');
  assert.equal(addressed(outline, 10)?.request?.path, '/c');
  assert.equal(addressed(outline, 8)?.decl.kind === 'test' ? (addressed(outline, 8)!.decl as { name: string }).name : null, 'second');
});

test('no line at all opens the first declaration s first request', () => {
  const at = addressed(fileOutline('t.tflw', MIXED), null);
  assert.equal(at?.decl.kind === 'test' ? at.decl.name : null, 'first');
  assert.equal(at?.request?.path, '/a');
});

test('a declaration that issues no request resolves to itself with no request', () => {
  const at = addressed(fileOutline('t.tflw', 'test "a"\n  open "/"\n  click button "Buy"\n'), 1);
  assert.equal(at?.decl.kind === 'test' ? at.decl.name : null, 'a');
  assert.equal(at?.request, null);
});

test('a file with no declaration at all resolves to nothing', () => {
  assert.equal(addressed(fileOutline('t.tflw', '# just a comment\n'), null), null);
});

// ---------------------------------------------------------------------------
// `M210` `S2` — the outline's step paths are `replaceInSource`'s step paths.
//
// The reader produces an index pair for every statement; the language looks a statement up by that
// pair. **Two orderings that agree on every file written so far is exactly the arrangement that
// breaks on the first file where a hook comes after a test**, so this is asserted behaviourally —
// take the pair the outline gives, hand it to `replaceInSource`, and check the byte that moved is
// the one the outline was pointing at.

const HOOK_AFTER_TEST = `test "first"
  api GET /a
  expect status equals 200

after
  api DELETE /cleanup
  expect status equals 204

test "second"
  api GET /b
  expect status equals 200
`;

test('a request the outline points at is the request `replaceInSource` edits, hook order included', () => {
  const outline = fileOutline('t.tflw', HOOK_AFTER_TEST);
  // The hook is declared SECOND here, which is the shape that separates "sorted by line" from
  // "hooks first" — the ordering `fileOutline` and `replaceInSource` must share.
  assert.deepEqual(outline.declarations.map((d) => d.kind), ['test', 'hook', 'test']);
  const marker = (path: string) => {
    const built = buildApiStep({ service: null, method: 'PUT', path, headers: [], body: null, label: null });
    assert.ok(built.ok, built.ok ? '' : built.reason);
    return built.node;
  };
  for (const decl of outline.declarations) {
    for (const r of decl.body.requests) {
      const out = replaceInSource(HOOK_AFTER_TEST, { kind: 'step', path: r.stepPath, node: marker('/marked') });
      assert.ok(out.ok, out.ok ? '' : out.reason);
      // The edited file, read back: exactly one request is the marker, and it sits at the same
      // position in the same declaration the outline named.
      const after = fileOutline('t.tflw', out.text);
      const marked = after.declarations.flatMap((d, i) => d.body.requests.map((x) => ({ decl: i, path: x.path, step: x.stepPath.step })));
      const hits = marked.filter((m) => m.path === '/marked');
      assert.equal(hits.length, 1, `editing ${r.method} ${r.path} changed exactly one request`);
      assert.deepEqual({ decl: hits[0]!.decl, step: hits[0]!.step }, { decl: r.stepPath.decl, step: r.stepPath.step }, 'and it is the one the outline pointed at');
    }
  }
});

test('a nested row has no step path, because an index pair cannot address inside a block', () => {
  const outline = fileOutline('t.tflw', 'test "a"\n  wait until api GET /jobs/1\n    expect body.state equals "done"\n');
  const nested = outline.declarations[0]!.body.requests[0]!.attached;
  assert.equal(nested.length, 1);
  assert.equal(nested[0]!.nested, true);
  assert.equal(nested[0]!.stepPath, null);
});

test('every non-nested statement carries a path, and the paths within a body are the body s own indices', () => {
  const outline = fileOutline('t.tflw', SRC);
  const decl = outline.declarations[0]!;
  const rows = [...decl.body.preamble, ...decl.body.requests.flatMap((r) => [{ line: r.line, stepPath: r.stepPath }, ...r.attached])];
  const inLineOrder = [...rows].sort((a, b) => a.line - b.line);
  assert.deepEqual(
    inLineOrder.map((r) => r.stepPath?.step),
    inLineOrder.map((_, i) => i),
    'a body read in line order gives 0, 1, 2, … — which is what an index into `body` means',
  );
});

test('the prefix of a request is the hooks and its own declaration up to it — over every request in the corpus', () => {
  // **Four requests in five cannot run alone**: of the sibling's 1031, 734 read a variable bound
  // earlier and 379 read a capture from the file's `before` hook. So `send` runs what comes before
  // the selected request (`D1075`), and *what comes before it* is this function — checked here
  // against every request this repository holds rather than against one hand-written file, because
  // the interesting shapes (a hook with two requests, a test whose first request is its fourth
  // statement, a polling request) are all in there and none of them was written for this test.
  let checked = 0;
  for (const path of corpus(repoRoot)) {
    const outline = fileOutline(path, readFileSync(path, 'utf8'));
    if (outline.diagnostics.some((d) => d.severity === 'error')) continue;
    const hookRequests = outline.declarations.filter((d) => d.kind === 'hook').flatMap((d) => d.body.requests);
    for (const decl of outline.declarations) {
      for (const request of decl.body.requests) {
        const at = addressed(outline, request.line);
        assert.ok(at, path);
        const prefix = prefixOf(outline, at);
        assert.ok(prefix, `${path}: ${request.method} ${request.path} has a prefix`);
        checked += 1;

        // It ends on the request that was asked for, and it says so by its own last row.
        const last = prefix.requests[prefix.requests.length - 1]!;
        assert.deepEqual({ method: last.method, path: last.path }, { method: request.method, path: request.path }, `${path}: the prefix ends on the selected request`);
        // Every hook request is in it, before any of the declaration's own.
        assert.equal(prefix.requests.length, hookRequests.length + decl.body.requests.filter((r) => r.stepPath.step <= request.stepPath.step).length);
        for (const [i, hook] of hookRequests.entries()) {
          assert.equal(prefix.requests[i]!.path, hook.path, `${path}: the hooks run first`);
        }
        // And what is attached to the selected request is inside the cut, because it is what reads
        // the response — a prefix that stopped at the request would report no verdict for the one
        // thing the author is looking at.
        const attached = request.attached.filter((x) => x.stepPath !== null);
        const lastStep = attached.length === 0 ? request.stepPath.step : attached[attached.length - 1]!.stepPath!.step;
        assert.equal(prefix.upTo, lastStep, `${path}: the cut includes what reads the response`);
        assert.equal(prefix.decl, decl.index);
      }
    }
  }
  assert.ok(checked > 20, `expected the corpus's requests, checked ${checked}`);
});

test('a declaration with no request has no prefix, because there is nothing to send', () => {
  const outline = fileOutline('t.tflw', 'test "a"\n  open "/catalogue"\n  click button "Buy"\n');
  const at = addressed(outline, null);
  assert.ok(at);
  assert.equal(at.request, null);
  assert.equal(prefixOf(outline, at), null);
});
