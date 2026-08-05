// `tflw migrate` (P#38, decision 45's 1.0-gate deliverable): mechanical rewrite engine for
// checker-flagged deprecations. The synthetic-diagnostic tests below prove the engine's arithmetic;
// the `dd5d998^` corpus at the bottom (M90b) is the primary evidence, because it is the one real
// migration in this project's history rather than a fixture written to pass.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSource } from '../src/index.js';
import { collectMigrations, applyMigrations } from '../src/migrate.js';
import { renderDiagnostic } from '../src/diagnostic.js';
import type { Diagnostic } from '../src/diagnostic.js';
import type { Position, Span } from '../src/token.js';

function pos(offset: number): Position {
  // line/column are unused by collectMigrations/applyMigrations (offset-only splicing) — filled
  // with placeholder values so the `Position` shape is satisfied without computing real ones.
  return { offset, line: 1, column: offset + 1 };
}

function span(start: number, end: number): Span {
  return { start: pos(start), end: pos(end) };
}

function deprecated(start: number, end: number, replacement: string): Diagnostic {
  return {
    code: 'TF999',
    severity: 'warning',
    message: 'deprecated (test fixture)',
    span: span(start, end),
    deprecation: { replacement },
  };
}

function ordinary(start: number, end: number): Diagnostic {
  return { code: 'TF010', severity: 'error', message: 'unrelated (test fixture)', span: span(start, end) };
}

test('collectMigrations turns a deprecation-tagged diagnostic into a span edit with the original text captured', () => {
  const source = 'expect status equal 200\n';
  //                            ^^^^^ offsets 14..19 = "equal"
  const diags = [deprecated(14, 19, 'equals')];
  const edits = collectMigrations(diags, source);
  assert.equal(edits.length, 1);
  assert.deepEqual(edits[0], { start: 14, end: 19, oldText: 'equal', newText: 'equals' });
});

test('diagnostics without a `deprecation` payload are silently skipped, not an error', () => {
  const source = 'expect status equals 200\n';
  const diags = [ordinary(0, 6), deprecated(7, 13, 'code')];
  const edits = collectMigrations(diags, source);
  assert.equal(edits.length, 1);
  assert.equal(edits[0]!.oldText, 'status');
});

test('applyMigrations splices a single edit correctly', () => {
  const source = 'expect status equal 200\n';
  const edits = collectMigrations([deprecated(14, 19, 'equals')], source);
  assert.equal(applyMigrations(source, edits), 'expect status equals 200\n');
});

test('collectMigrations sorts edits widest-first (descending start) so applying them in order never invalidates an earlier offset', () => {
  const source = 'AAAA BBBB CCCC\n';
  // Two edits, deliberately constructed out of source order.
  const diags = [deprecated(10, 14, 'DDDD'), deprecated(0, 4, 'ZZZZ')];
  const edits = collectMigrations(diags, source);
  assert.deepEqual(
    edits.map((e) => e.start),
    [10, 0],
  );
  assert.equal(applyMigrations(source, edits), 'ZZZZ BBBB DDDD\n');
});

test('a real deprecation round-trip: the migrated source reparses cleanly through the real parser', () => {
  // A real, fully valid `.tflw` file — migrate must work against real source, not just abstract
  // strings. Simulates a deprecation that renames a locator's own text (a made-up rename, purely
  // to exercise the pipeline end to end against a real parseable file both before and after).
  const source = 'test "x"\n  click button "Old Label"\n  expect status equals 200\n';
  const before = parseSource(source);
  assert.deepEqual(before.diagnostics, []);

  const idx = source.indexOf('Old Label');
  const diags = [deprecated(idx, idx + 'Old Label'.length, 'New Label')];
  const migrated = applyMigrations(source, collectMigrations(diags, source));
  assert.equal(migrated, 'test "x"\n  click button "New Label"\n  expect status equals 200\n');

  const after = parseSource(migrated);
  assert.deepEqual(after.diagnostics, [], `migrated source must still parse cleanly:\n${migrated}`);
});

// ---- the `dd5d998^` corpus (M90b, PLAN_M90_MIGRATION.md §3.3) ---------------
//
// `testFlow-tests` commit `dd5d998` — "Migrate the checkbox action to `tick`/`untick` (tflw FS-04,
// milestone B1 step 2)" — is a human doing, on a production corpus, exactly what `migrate` is
// built to do. `dd5d998^` is the pre-rename input; the three files below are copied from it
// verbatim. `dd5d998` itself is the *review* oracle, not the assertion oracle: byte-equality with
// the human's commit is the wrong property, because the human also rewrote prose inside comments
// and `test "…"` names and a span splice on a keyword token cannot.
//
// Rejected: running the dogfood suite at `dd5d998^`. It needs the contemporary tflw (bare `check`
// still parsing) *and* the Docker stack, to re-derive a fact history already proved — the human's
// version is current `main`, CI green.

const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'migrate-corpus');
const CORPUS = ['accessibility-demo', 'storefront', 'webv2-admin'] as const;

function corpus(name: (typeof CORPUS)[number]): string {
  return readFileSync(join(CORPUS_DIR, `${name}.tflw`), 'utf8');
}

/** One migrate pass over a source: parse, collect, splice. */
function migrateOnce(source: string): { migrated: string; edits: ReturnType<typeof collectMigrations> } {
  const edits = collectMigrations(parseSource(source).diagnostics, source);
  return { migrated: applyMigrations(source, edits), edits };
}

test('the corpus is what the plan says it is: 7 code sites across 3 files, 5 of them the form migrate declines', () => {
  // Pinning the input, not the output. If someone re-copies these fixtures from a later commit,
  // every number below changes and this fails first with the reason.
  const codes = CORPUS.flatMap((f) => parseSource(corpus(f)).diagnostics.map((d) => d.code));
  assert.equal(codes.filter((c) => c === 'TF014').length, 5, 'five bare `check <locator>` sites');
  assert.equal(codes.filter((c) => c === 'TF011').length, 2, 'two `uncheck` sites');
  assert.equal(codes.length, 7, 'and nothing else — these files were otherwise valid at the time');
});

test('migrate rewrites the 2 mechanical sites and declines all 5 that need a human — 29% of the one real migration in this history', () => {
  // The uncomfortable number, asserted rather than argued. D-M90-3 stands on the strength of
  // `dd5d998`'s own commit message — "Seven lines across three files, *all genuinely the action
  // form*" — which *is* the judgment call migrate refuses to make. Had it guessed, that
  // verification would never have happened, and one wrong guess turns an assertion into a click in
  // a test that keeps passing.
  const applied = CORPUS.flatMap((f) => migrateOnce(corpus(f)).edits);
  assert.equal(applied.length, 2, 'exactly the two `uncheck` sites');
  assert.deepEqual(
    applied.map((e) => `${e.oldText}->${e.newText}`),
    ['uncheck->untick', 'uncheck->untick'],
  );
});

test('after migrate the corpus has no new diagnostic classes — only the `TF014`s it deliberately left', () => {
  // The property a user actually cares about: migrate never makes a file worse. It does *not* leave
  // the corpus clean, and saying so is the point — the residual is exactly the five sites D-M90-3
  // hands back, and under D-M90-1 the post-splice re-check prints each one at real file:line, so
  // the manual pass is a worked checklist rather than a re-discovery.
  for (const f of CORPUS) {
    const { migrated } = migrateOnce(corpus(f));
    const after = parseSource(migrated).diagnostics;
    assert.ok(
      after.every((d) => d.code === 'TF014'),
      `${f}: only bare-\`check\` diagnostics may remain, got ${after.map((d) => d.code).join(',')}`,
    );
    assert.equal(after.length, parseSource(corpus(f)).diagnostics.filter((d) => d.code === 'TF014').length, `${f}: and exactly as many as before`);
  }
});

test('migrate is idempotent over the corpus: a second pass finds nothing and changes no bytes', () => {
  // The cheapest guard against an off-by-one splice there is — a span that is one character wide
  // in the wrong direction survives pass 1 and shows up here.
  for (const f of CORPUS) {
    const { migrated } = migrateOnce(corpus(f));
    const second = migrateOnce(migrated);
    assert.equal(second.edits.length, 0, `${f}: nothing left to migrate`);
    assert.equal(second.migrated, migrated, `${f}: and the bytes are untouched`);
  }
});

test('migrate rewrites keywords, not prose — the corpus still says `check field` in its comments and test names afterwards', () => {
  // Half of `dd5d998`'s diff was prose: 6 comment/`test "…"` lines against 7 code lines. A span
  // splice on a keyword token touches none of it, so a migrated file can be entirely correct code
  // and still describe the old keyword in English. Users will expect a rename-symbol refactor
  // unless told otherwise — M90c owes the docs that sentence, and this pins the behaviour it
  // describes.
  const { migrated } = migrateOnce(corpus('storefront'));
  assert.match(migrated, /test "the a11y-demo's accessible checkbox check\/uncheck is real/, 'the test name is prose and stays as written');
  assert.match(migrated, /# M40: closes check field\/uncheck field/, 'so does the comment');
  assert.doesNotMatch(migrated, /^\s+uncheck field/m, 'while every actual `uncheck` *step* is gone');
  assert.match(migrated, /^\s+untick field/m, 'replaced by `untick`');
});

test('D-M90-4: every payload-bearing diagnostic offers `tflw migrate`, and no other diagnostic does', () => {
  // The advertisement and the capability are the same fact, asserted as a property over the whole
  // corpus rather than site by site. This is what cluster C8 *was*: four surfaces describing a tool
  // that could not act. `TF014` carries no payload by design (D-M90-3), so it must make no offer —
  // which is the mechanism, not a special case.
  const OFFER = /run `tflw migrate` to apply this automatically/;
  let withPayload = 0;
  for (const f of CORPUS) {
    const source = corpus(f);
    for (const d of parseSource(source).diagnostics) {
      const rendered = renderDiagnostic(d, source, { filename: `${f}.tflw` });
      if (d.deprecation) {
        withPayload++;
        assert.match(rendered, OFFER, `${d.code} carries a replacement and must offer migrate`);
        // Found by writing this milestone's negative control badly: setting `replacement: ''`
        // instead of dropping the payload left `d.deprecation` truthy, so the offer still rendered
        // — and migrate would have *deleted* the keyword while advertising a rewrite. An empty
        // replacement is a deletion, and nothing in this cluster wants one silently.
        assert.notEqual(d.deprecation.replacement, '', `${d.code}'s replacement must be real text, not a deletion`);
      } else {
        assert.doesNotMatch(rendered, OFFER, `${d.code} has no replacement and must not offer migrate`);
      }
    }
  }
  assert.equal(withPayload, 2, 'and the corpus really does exercise both sides');
});

test('a clean file is byte-identical after migrate — it does not touch what it should not', () => {
  const source = 'test "x"\n  api GET /health\n  expect status equals 200\n';
  const { migrated, edits } = migrateOnce(source);
  assert.equal(edits.length, 0);
  assert.equal(migrated, source);
});

// ---- §3.2: `scenario` → `test` is total, not approximate ---------------------

/** Spans move when a rewrite changes length (`scenario`→`test` is −4), so AST equivalence has to
 * be asserted on structure with positions stripped. */
function stripSpans(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripSpans);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'span') continue;
      out[k] = stripSpans(v);
    }
    return out;
  }
  return node;
}

test('§3.2: a migrated `scenario` block is structurally identical to the hand-written `test` equivalent', () => {
  // `parseScenarioDecl` (verified at `a2c457c^`) made a workload line *mandatory*, so every legal
  // old `scenario` becomes a workload-bearing `test` and a silent load-test→functional-test
  // demotion is structurally impossible. All three body constructs the old block allowed
  // (`as admin, userA`, `threshold …`, `cleanup`) still parse inside `parseTest` today — so the
  // one-token splice yields a semantically identical program, asserted here rather than argued.
  const body = [
    '  ramp to 10 users over 5s',
    '  threshold p95 duration is less than 1s',
    '  threshold error rate is less than 1%',
    '  api GET /x',
    '  expect status equals 200',
    '  cleanup',
    '',
  ].join('\n');
  const old = `scenario "burst" as admin\n${body}`;
  const handWritten = `test "burst" as admin\n${body}`;

  const { migrated, edits } = migrateOnce(old);
  assert.deepEqual(
    edits.map((e) => `${e.oldText}->${e.newText}`),
    ['scenario->test'],
  );
  assert.equal(migrated, handWritten, 'the splice reproduces the hand-written form exactly');

  const a = parseSource(migrated);
  const b = parseSource(handWritten);
  assert.deepEqual(a.diagnostics, [], 'and it parses clean');
  assert.deepEqual(stripSpans(a.program), stripSpans(b.program));
});
