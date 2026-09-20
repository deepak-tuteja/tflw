// `M213` `S0b` — the source colouring (`M213-10`).
//
// THE FIRST TEST IS THE ONE THAT MATTERS, AND IT IS NOT ABOUT COLOUR. `SourcePanel`'s `<pre>` is a
// projection of the file; `D985` says the file is the only truth, the panel's own comment records
// that its `textContent` is the file byte for byte, and every page gate reading `[data-preview]`
// rests on that. Splitting a file into coloured spans is exactly the kind of change that can lose a
// byte — an off-by-one on a span boundary, a dropped blank line, a `\r`. So the claim is
// **reassembly is total**, asserted against this repository's whole `.tflw` corpus rather than
// against a fixture: a span that is wrong on a construct nobody wrote a fixture for is precisely
// the defect a fixture cannot see. `M201` settled the corpus question for the printer the same way,
// and for the same reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { highlightLines, highlightFragment, type Piece } from '../src/highlight.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** **The corpus is the source this repository holds, and it is named by where source lives.**
 *
 * This has now been wrong twice, in opposite directions, and both are worth keeping written down
 * because the two wrong answers are the two obvious ones.
 *
 * The first draft walked the whole repository and counted **40 files here against 21 on the box**:
 * `runs/` holds report directories pulled back from earlier box runs, each carrying a copy of the
 * page fixtures' `.tflw` files. Those are output, not source, and they exist on one machine and not
 * the other.
 *
 * The repair asked **git** instead — `committableFiles`, which every other corpus gate here uses —
 * and that was right about the question and wrong about the machine. **The box runs this suite in
 * an rsync'd tree with no `.git` at all**, so `git ls-files` there is not a different answer, it is
 * `fatal: not a git repository`. The gate passed on the Mac and could not run on the machine whose
 * result counts. A gate that depends on a repository is a gate that depends on being *in* one.
 *
 * So the corpus is the two directories this project keeps source in. It needs no git, it is the
 * same set on both machines, and `runs/` is excluded **structurally** — it sits at the repository
 * root and is under neither — rather than by a denylist that would need extending every time the
 * project grows a new output directory. */
const SOURCE_ROOTS = ['packages', 'examples'] as const;

const tflwFiles = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
        walk(full);
      } else if (entry.name.endsWith('.tflw') && !entry.name.startsWith('.')) {
        // **A dot-prefixed `.tflw` is not part of the authored corpus** (`M215`, `M215-01`). `tflw
        // ui`'s send writes `.scratch.tflw` into the project it serves, and `examples/storefront`
        // is both a served project and a root of this walk. This is the **fifth** copy of the same
        // traversal — `lenses.test.ts`, `print.test.ts`, `outline.test.ts` and
        // `verify-fmt-roundtrip.mjs` are the others — which is `M215-01`'s open half.
        out.push(full);
      }
    }
  };
  for (const root of SOURCE_ROOTS) walk(join(repoRoot, root));
  return out.sort();
};

const rejoin = (lines: readonly (readonly Piece[])[]): string => lines.map((l) => l.map((p) => p.text).join('')).join('\n');

test('every `.tflw` file in this repository reassembles byte for byte, and the line count is the file’s own', () => {
  const files = tflwFiles();
  // The floor's job is not to pin the corpus — it grows, and pinning it would make every new
  // `.tflw` file a failing test. Its job is to catch the walk coming back empty, which is how a
  // gate over a corpus passes while reading zero files. **21 under `packages/` and `examples/` on
  // both machines**, which is the point of naming those two roots.
  assert.ok(files.length >= 20, `the corpus is ${files.length} files — the source roots are returning less than this repository holds`);
  let coloured = 0;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const lines = highlightLines(source);
    assert.equal(rejoin(lines), source, `${file}: the pieces do not reassemble to the file`);
    assert.equal(lines.length, source.split('\n').length, `${file}: line count disagrees with the file's own`);
    if (lines.some((l) => l.some((p) => p.role !== null))) coloured++;
  }
  // The control. Byte-exactness is satisfied perfectly by colouring nothing at all — the fallback
  // path does exactly that — so the claim above is vacuous without this line beside it.
  assert.equal(coloured, files.length, `${files.length - coloured} files came back with no colour at all`);
});

test('the seven roles are what the three channels produce, on one statement of each kind', () => {
  // Matching a WHOLE piece, never a substring: the claim is that the colouring treats this lexeme
  // as one thing, so a needle found inside a larger piece is a miss and must report as one.
  const roleOf = (source: string, needle: string): string | null =>
    highlightLines(source)
      .flat()
      .find((p) => p.text === needle)?.role ?? '(no piece is exactly that text)';
  const src = [
    'test "it answers"',
    '  api GET /items?page=2',
    '  expect status equals 200        # the happy path',
    '  capture body.id as $orderId',
    '  expect body matches subset { type: "about:blank" }',
    '',
  ].join('\n');

  assert.equal(roleOf(src, 'test'), 'kw', 'a statement keyword');
  assert.equal(roleOf(src, 'api'), 'kw', 'a step keyword');
  assert.equal(roleOf(src, '"it answers"'), 'str', 'a string, quotes included');
  assert.equal(roleOf(src, '/items?page=2'), 'str', 'a path is a literal you typed');
  assert.equal(roleOf(src, '200'), 'num', 'a number');
  assert.equal(roleOf(src, '# the happy path'), 'com', 'a TRAILING comment — the case with no recorded offset');
  assert.equal(roleOf(src, '{'), 'op', 'punctuation is structure');
});

test('a `#` inside a string is not a comment — the case needs BOTH on one line, or the scan is never reached', () => {
  // **The first draft of this row was vacuous and a mutation said so.** It asserted that
  // `test "a # in a name"` produces no comment — but that line carries no comment, so
  // `info.comment` is undefined and `collectSpans` skips it before the scan runs. Starting the
  // scan at the beginning of the line instead of after the last token left it green.
  //
  // The case that reaches the scan has a hash inside a string AND a real comment after it, which
  // is the whole reason the scan is anchored to the token spans rather than to `indexOf('#')`.
  const src = 'test "x"\n  expect body equals "a # b"   # the real one\n';
  const lines = highlightLines(src);
  assert.equal(rejoin(lines), src);
  const second = lines[1]!;
  assert.equal(second.find((p) => p.text === '"a # b"')?.role, 'str', 'the string keeps the hash it contains');
  const comments = second.filter((p) => p.role === 'com');
  assert.equal(comments.length, 1, 'exactly one comment on that line');
  assert.equal(comments[0]!.text, '# the real one', 'and it starts at the hash AFTER the string, not the one inside it');

  // And a comment-only line still is one, so the positive above is not just a broken scan.
  const whole = highlightLines('# a whole line\ntest "x"\n');
  assert.equal(whole[0]!.filter((p) => p.role === 'com').map((p) => p.text).join(''), '# a whole line');
});

test('an action name that CONTAINS a keyword: the outer name wins and its interior spans are dropped, not trimmed', () => {
  // **A mutation found this branch untested, and a measurement found it unreachable from here.**
  // Dropping the overlap guard left all six rows green, so the guard looked dead. It is not: over
  // both repositories' 179 `.tflw` files it fires **67 times across 11 files — every one of them in
  // the sibling**, and `D710` forbids a gate here from requiring a sibling checkout. So the shape
  // comes back as a fixture instead.
  //
  // The shape is a property of the language: action names are multi-word, so an action can be
  // called `sleep and retry` — and `collectSemanticTokens` then emits `function` for the whole
  // name AND `function`/`keyword` for `and`/`retry` inside it. Three spans, one containing two.
  // The guard keeps the outer and drops the inner, because an action's name is one name; without
  // it those bytes are emitted twice and the file no longer reassembles.
  const src = ['action sleep and retry(seconds)', '  pause 1s', '', 'test "it waits"', '  let waited = sleep and retry(2)', ''].join('\n');
  const lines = highlightLines(src);
  assert.equal(rejoin(lines), src, 'the interior spans must be dropped, not re-emitted');
  const call = lines[4]!;
  assert.equal(call.find((p) => p.text === 'sleep and retry')?.role, 'typ', 'the action name is one piece');
  assert.equal(call.filter((p) => p.text === 'and').length, 0, 'and NOT three, with `and` coloured separately inside it');
});

test('a file that does not parse still renders every byte, uncoloured rather than absent', () => {
  // A broken file is a first-class thing on this page — the explorer badges it and the reader
  // opens it to find out why. `parseSource` never throws, so this exercises the harder case: text
  // the lexer itself chokes on.
  const broken = 'test "unterminated\n  api GET /x\n  expect status equals\n';
  const lines = highlightLines(broken);
  assert.equal(rejoin(lines), broken, 'the bytes survive a file the language cannot read');
  assert.equal(lines.length, broken.split('\n').length);
});

test('a statement fragment keeps its keywords, because that pass is lexer-driven and needs no AST', () => {
  // `ComposePane` draws a collapsed statement as one `<code>`, with no declaration around it. The
  // symbol-derived half of the semantic pass comes back thin for a fragment; the keyword half does
  // not, and this row is what says so — it is the assumption `highlightFragment` rests on.
  const pieces = highlightFragment('expect status equals 200');
  assert.equal(pieces.map((p) => p.text).join(''), 'expect status equals 200');
  assert.equal(pieces.find((p) => p.text === 'expect')?.role, 'kw');
  assert.equal(pieces.find((p) => p.text === '200')?.role, 'num');
});

test('the empty file, and a file that is only newlines', () => {
  assert.deepEqual(highlightLines(''), [[]]);
  assert.equal(rejoin(highlightLines('\n\n')), '\n\n');
  assert.equal(highlightLines('\n\n').length, 3);
});
