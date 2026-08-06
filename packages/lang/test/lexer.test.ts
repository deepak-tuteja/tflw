// Lexer golden (token stream) + explicit source-position assertions. Positions are the
// foundation of every diagnostic, so a few are pinned exactly rather than only snapshotted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lex, type Token } from '../src/index.js';
import { assertGolden } from './helpers.js';

function tokenStream(tokens: readonly Token[]): string {
  return tokens
    .map((t) => {
      switch (t.type) {
        case 'newline':
          return 'NEWLINE';
        case 'indent':
          return 'INDENT';
        case 'dedent':
          return 'DEDENT';
        case 'eof':
          return 'EOF';
        default:
          return `${t.type} ${JSON.stringify(t.value)}`;
      }
    })
    .join('\n');
}

test('offside rule: token stream snapshot', () => {
  const src = `test "s"
  api POST /orders body { qty: 3 }
  expect status equals 201
`;
  const { tokens, diagnostics } = lex(src);
  assert.equal(diagnostics.length, 0);
  assertGolden('tokens/offside.txt', tokenStream(tokens));
});

test('a multi-line object literal suppresses newline/indent/dedent while a `{`/`[` is open', () => {
  const src = `test "s"
  api POST /orders body {
    name: "Widget",
    qty: 3
  }
  expect status equals 201
`;
  const { tokens, diagnostics } = lex(src);
  assert.equal(diagnostics.length, 0);
  // Exactly one NEWLINE per logical line: `test "s"`, the whole multi-line `api … }` step, and
  // `expect …` — not one per physical line.
  const stream = tokenStream(tokens);
  assert.equal(stream.split('\n').filter((l) => l === 'NEWLINE').length, 3);
  // No stray INDENT/DEDENT leaked from the interior lines of the object literal.
  assert.equal(tokens.filter((t) => t.type === 'indent').length, 1);
  assert.equal(tokens.filter((t) => t.type === 'dedent').length, 1);
});

test('nested multi-line objects/arrays track bracket depth correctly', () => {
  const src = `test "s"
  api POST /orders body {
    name: "Widget",
    tags: [
      "a",
      "b"
    ],
    nested: {
      inner: 1
    }
  }
  expect status equals 201
`;
  const { diagnostics } = lex(src);
  assert.equal(diagnostics.length, 0);
});

test('nested indentation produces matching indent/dedent counts', () => {
  const src = `test "a"
  api GET /x
test "b"
  api GET /y
`;
  const { tokens } = lex(src);
  const indents = tokens.filter((t) => t.type === 'indent').length;
  const dedents = tokens.filter((t) => t.type === 'dedent').length;
  assert.equal(indents, 2);
  assert.equal(dedents, 2);
});

test('source positions are 1-based line/column with correct offsets', () => {
  const src = `test "x"\n  api GET /health\n`;
  const { tokens } = lex(src);
  const testKw = tokens.find((t) => t.type === 'ident' && t.value === 'test')!;
  assert.deepEqual(testKw.span.start, { offset: 0, line: 1, column: 1 });

  const apiKw = tokens.find((t) => t.type === 'ident' && t.value === 'api')!;
  assert.deepEqual(apiKw.span.start, { offset: 11, line: 2, column: 3 });

  const path = tokens.find((t) => t.type === 'path')!;
  assert.equal(path.value, '/health');
  assert.equal(path.span.start.line, 2);
});

test('a token after a closed multi-line bracket has the correct line/column (decision 69)', () => {
  // `astJson()` strips `span` from every AST golden, so a regression in line/column math across a
  // multi-line `{…}`/`[…]` construct — where the lexer's line-tracking has the most surface area to
  // get wrong — would otherwise pass every existing test untested.
  const src = `test "s"
  api POST /orders body {
    name: "Widget"
  }
  expect status equals 201
`;
  const { tokens, diagnostics } = lex(src);
  assert.equal(diagnostics.length, 0);
  const expectKw = tokens.find((t) => t.type === 'ident' && t.value === 'expect')!;
  assert.deepEqual(expectKw.span.start, { offset: src.indexOf('expect'), line: 5, column: 3 });
});

test('a tab counts as one code unit in the machine coordinate (decision 69, D147)', () => {
  // M98a (`A1-OS-03`): this test was titled "a tab … does not distort column tracking", which is
  // true of what it asserts and false of what a reader takes away. `Position.column` is a *machine*
  // coordinate — UTF-16 code units, what `slice` and LSP want — and a tab is one of those. It is
  // not a display column, and until M98a the renderer spent it as if it were, so the caret under
  // this very line landed ~7 cells left of its target. The display half is asserted in
  // `errors.test.ts` ("the caret lands under the offending character"), which is where a terminal
  // coordinate is actually computed; this test's job is only to pin the machine one.
  const src = 'test "s"\n  api\tGET /x\n  expect status equals 200\n';
  const { tokens, diagnostics } = lex(src);
  assert.equal(diagnostics.length, 0);
  const getMethod = tokens.find((t) => t.type === 'ident' && t.value === 'GET')!;
  // "  api" is 5 code units (0-4), the tab is index 5, so `GET` starts at index 6 → column 7.
  assert.deepEqual(getMethod.span.start, { offset: src.indexOf('GET'), line: 2, column: 7 });
});

test('string escapes are decoded, raw is preserved', () => {
  const { tokens } = lex(`test "a\\nb"\n  api GET /x\n`);
  const str = tokens.find((t) => t.type === 'string')!;
  assert.equal(str.value, 'a\nb');
  assert.equal(str.raw, '"a\\nb"');
});

test('comments and blank lines carry no tokens or structure', () => {
  const src = `# a comment\ntest "x"\n\n  api GET /x   # trailing comment\n`;
  const { tokens, diagnostics } = lex(src);
  assert.equal(diagnostics.length, 0);
  assert.equal(tokens.filter((t) => t.value.includes('comment')).length, 0);
});

test('`/` right after an HTTP method starts a PATH token', () => {
  const { tokens } = lex(`test "x"\n  api GET /orders/{id}\n`);
  const kinds = tokens.filter((t) => t.type !== 'newline' && t.type !== 'indent' && t.type !== 'dedent' && t.type !== 'eof').map((t) => t.type);
  assert.deepEqual(kinds, ['ident', 'string', 'ident', 'ident', 'path']);
});

test('`/` right after HEAD or OPTIONS starts a PATH token too (gap #16)', () => {
  for (const verb of ['HEAD', 'OPTIONS']) {
    const { tokens, diagnostics } = lex(`test "x"\n  api ${verb} /orders/{id}\n`);
    assert.equal(diagnostics.length, 0, `unexpected diagnostics for verb ${verb}`);
    const path = tokens.find((t) => t.type === 'path');
    assert.equal(path?.value, '/orders/{id}', `path token for verb ${verb}`);
  }
});

test('`/` anywhere else is the arithmetic divide operator (M2, P#25)', () => {
  const { tokens, diagnostics } = lex(`test "x"\n  let ratio = {a} / {b}\n  api GET /health\n`);
  assert.equal(diagnostics.length, 0);
  // one `slash` from the division, one `path` for the api step's own /health.
  assert.equal(tokens.filter((t) => t.type === 'slash').length, 1);
  assert.equal(tokens.filter((t) => t.type === 'path').length, 1);
});

test('a named service before the method does not confuse divide-detection', () => {
  const { tokens, diagnostics } = lex(`test "x"\n  api billing GET /invoices/{id}\n`);
  assert.equal(diagnostics.length, 0);
  const path = tokens.find((t) => t.type === 'path')!;
  assert.equal(path.value, '/invoices/{id}');
});

test('a variable named after an HTTP verb still divides (decision 60)', () => {
  for (const verb of ['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'GET', 'Post']) {
    const src = `test "x"\n  let ${verb} = 10\n  let ratio = ${verb} / 2\n  api GET /health\n`;
    const { tokens, diagnostics } = lex(src);
    assert.equal(diagnostics.length, 0, `unexpected diagnostics for verb ${verb}`);
    // one `slash` from `${verb} / 2`, one `path` for the real api step's /health.
    assert.equal(tokens.filter((t) => t.type === 'slash').length, 1, `slash count for verb ${verb}`);
    assert.equal(tokens.filter((t) => t.type === 'path').length, 1, `path count for verb ${verb}`);
  }
});

// -- M59: the A1 pass's lexer findings -------------------------------------------------------
// Each of these asserts the *property* that was violated, not merely that lexing succeeds. The
// review's `OBS-03` found a test titled "…redacted in the report" that only asserted `1/1 passed`
// and so never noticed the secret it was named for; these are written not to repeat that.

test('A1-02: a `#` inside a path is diagnosed, never silently truncated', () => {
  const { tokens, diagnostics } = lex(`test "x"\n  api GET /items?color=#fff&size=large\n`);
  // The bug: the path token shrank to `/items?color=` and *no* diagnostic was produced anywhere,
  // so `check` said "no problems found" and the run passed against a request nobody wrote.
  assert.equal(diagnostics.length, 1, 'the `#` collision must be reported');
  assert.match(diagnostics[0]!.message, /`#` ends the path/);
  assert.match(diagnostics[0]!.hint ?? '', /%23/, 'the hint must name the escape that works');
  const path = tokens.find((t) => t.type === 'path')!;
  assert.equal(path.value, '/items?color=', 'the truncation itself is unchanged — only its silence was the bug');
});

test('A1-06: every RFC 3986 path/query character lexes as one path token', () => {
  // `?q=hello+world` and `?ids=1,2,3` were both hard parse errors whose help said only
  // "expected end of line", never mentioning the path.
  for (const ch of ['!', '$', "'", '(', ')', '*', '+', ',', ';', '[', ']', '@', '&', '=', ':', '-', '.', '_', '~']) {
    const { tokens, diagnostics } = lex(`test "x"\n  api GET /a${ch}b\n`);
    assert.equal(diagnostics.length, 0, `unexpected diagnostic for ${JSON.stringify(ch)}`);
    const path = tokens.find((t) => t.type === 'path')!;
    assert.equal(path.value, `/a${ch}b`, `path token truncated at ${JSON.stringify(ch)}`);
  }
});

test('A1-03: a CRLF file lexes identically to the same file with LF', () => {
  const body = `test "crlf"\n  api GET /health\n  expect status equals 200\n`;
  const lf = lex(body);
  const crlf = lex(body.replace(/\n/g, '\r\n'));
  assert.equal(crlf.diagnostics.length, 0, 'a Windows-authored file produced one TF001 per line');
  assert.deepEqual(
    crlf.tokens.map((t) => [t.type, t.value]),
    lf.tokens.map((t) => [t.type, t.value]),
    'CRLF and LF must produce the same token stream',
  );
});

test('A1-04: a leading UTF-8 BOM is invisible to the lexer', () => {
  const { diagnostics } = lex(`﻿test "x"\n  api GET /health\n`);
  // Left as an "unexpected character" this produced a diagnostic quoting a character that
  // renders as nothing at all — unactionable by construction.
  assert.equal(diagnostics.length, 0);
});

// -- M98b: the facts the lexer computed and dropped ------------------------------------------
// Each row here was a place where `lexer.ts` already knew something and said nothing, so `tflw
// check` reported "no problems found" over a file that could not mean what it says. The tests
// assert *where* the diagnostic lands and *what it teaches*, not merely that one exists — a
// diagnostic pointing at the wrong token is most of the original complaint.

function diags(src: string) {
  return lex(src).diagnostics;
}

test('A1-10/TF045: an unclosed `{` is reported at the `{` itself, not at a synthesized dedent', () => {
  // Before M98b the lexer tracked an open-bracket *count*, which is enough to decide line
  // continuation and leaves nothing to point at. This file produced `TF010: expected a field name,
  // found a dedent` with a caret on line 3 of a 2-line file, underlining nothing at all.
  const src = 'test "x"\n  api POST /o body {\n';
  const found = diags(src).filter((d) => d.code === 'TF045');
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /is never closed/);
  //   `  api POST /o body ` is 19 code units, so the `{` sits at index 19 → column 20.
  assert.deepEqual(found[0]!.span.start, { offset: src.indexOf('{'), line: 2, column: 20 });
  assert.match(found[0]!.hint ?? '', /continuation of the same step/, 'the hint must explain why the rest of the file vanished');
});

test('A1-10/TF045: only the innermost unclosed bracket is reported', () => {
  // Three levels left open by one missing `}`. A diagnostic per level would be noise proportional
  // to nesting depth, all of it naming the same typo; the innermost is the one nearest the mistake.
  const src = 'test "x"\n  api POST /o body { a: [ { b: 1\n';
  const found = diags(src).filter((d) => d.code === 'TF045');
  assert.equal(found.length, 1);
  assert.equal(found[0]!.span.start.offset, src.lastIndexOf('{'));
});

test('A1-20/TF045: a `}` that closes nothing is reported instead of being clamped away', () => {
  // `push()` used to guard the decrement with `> 0` and say nothing — the count could not go
  // negative, so the extra closer left no trace anywhere.
  const found = diags('test "x"\n  api GET /a }\n').filter((d) => d.code === 'TF045');
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /closes a bracket that was never opened/);
});

test('A1-10: a balanced multi-line literal stays silent — the negative control', () => {
  // The control for the whole bracket rule. `TF045` fires from two sites that every well-formed
  // multi-line body passes through, so a rule that over-fires here would break every hand-formatted
  // `body { … }` in the corpus rather than producing a subtle wrong message.
  const src = 'test "s"\n  api POST /o body {\n    tags: [\n      "a"\n    ]\n  }\n  expect status equals 201\n';
  assert.deepEqual(diags(src), []);
});

test('A1-11/TF046: a tag with no usable name is rejected, and `@ smoke` is told about the space', () => {
  // The consequence, which is why this is an error and not a lint: a tag that is not a writable
  // identifier can never be named in a `--tag` expression, so the test carrying it is neither
  // selectable nor excludable — a filter that appears to work and runs the wrong set.
  const bare = diags('@\ntest "x"\n  api GET /a\n').filter((d) => d.code === 'TF046');
  assert.equal(bare.length, 1);
  assert.match(bare[0]!.message, /needs a name after the `@`/);

  const spaced = diags('@ smoke\ntest "x"\n  api GET /a\n').filter((d) => d.code === 'TF046');
  assert.equal(spaced.length, 1);
  assert.match(spaced[0]!.hint ?? '', /delete the space/, 'the `@` is gone by the time the parser sees this — the hint has to be attached here');

  const digits = diags('@123\ntest "x"\n  api GET /a\n').filter((d) => d.code === 'TF046');
  assert.equal(digits.length, 1);
  assert.match(digits[0]!.message, /not a usable tag name/);
});

test('A1-11: a well-formed tag stays silent — the negative control', () => {
  for (const tag of ['@smoke', '@_internal', '@api2', '@Slow_path']) {
    assert.deepEqual(diags(`${tag}\ntest "x"\n  api GET /a\n`), [], `unexpected diagnostic for ${tag}`);
  }
});

test('A1-05/TF047: an unknown string escape is an error, not a silently deleted backslash', () => {
  // `"^\d+$"` decoded to `^d+$` and the run then matched a pattern nobody wrote — the step echo
  // printed the written form and the reason line the mangled one, with nothing connecting them.
  const found = diags('test "x"\n  expect body.id matches "^\\d+$"\n').filter((d) => d.code === 'TF047');
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /unknown escape `\\d`/);
  assert.match(found[0]!.hint ?? '', /\\\\d/, 'a regex is where a backslash appears — the hint must show the doubled form');
});

test('A1-05: every supported escape stays silent, `\\r` included — the negative control', () => {
  // `\r` is the one that matters: GRAMMAR.md § Lexical lists four escapes and the lexer has five,
  // so a hand-typed help line or a hand-typed test would very likely have made `"\r"` an error.
  // `TF047`'s help line is derived from `ESCAPES` for the same reason.
  const src = 'test "x"\n  log "a\\nb\\tc\\rd\\"e\\\\f"\n';
  assert.deepEqual(diags(src), []);
  const str = lex(src).tokens.find((t) => t.type === 'string' && t.value.includes('a'))!;
  assert.equal(str.value, 'a\nb\tc\rd"e\\f');
});

test('A1-18: the numeric notations tflw does not have are taught at the number', () => {
  // `1e3` is the case worth the diagnostic: it lexes as `1` + `e3`, so the written value and the
  // read value differ by 1000×, and the only report was `TF010: unexpected `e3` at end of step`
  // with a help line pointing at the end of the line.
  const cases: [string, RegExp, string][] = [
    ['1e3', /exponent notation/, '1000'],
    ['1e-3', /exponent notation/, '0.001'],
    ['0xff', /hexadecimal/, '255'],
    ['0b1010', /binary/, '10'],
    ['0o17', /octal/, '15'],
    ['1_000', /digit separators/, '1000'],
  ];
  for (const [literal, message, value] of cases) {
    const found = diags(`test "x"\n  let n = ${literal}\n  api GET /a\n`).filter((d) => d.code === 'TF001');
    assert.equal(found.length, 1, `expected exactly one TF001 for ${literal}`);
    assert.match(found[0]!.message, message, `message for ${literal}`);
    assert.match(found[0]!.hint ?? '', new RegExp(`\`${value.replace('.', '\\.')}\``), `the hint for ${literal} must name the decimal value to write`);
  }
});

test('A1-18: a duration is not a foreign numeric notation — the control that shapes the rule', () => {
  // The obvious rule — "a `number` followed directly by a name" — is wrong, and this is what says
  // so: that pattern is exactly how *every duration in the language* lexes. Under the general rule
  // each of these lines would have become an error, so the check is deliberately narrowed to the
  // five shapes that can never be a duration unit.
  for (const src of [
    'test "x"\n  pause 30s\n  api GET /a\n',
    'test "x"\n  timeout step 10s, expect 5s, wait 30s\n  api GET /a\n',
    'test "x"\n  api GET /a\n  expect duration is less than 500ms\n',
    'test "x"\n  pause 2m\n  api GET /a\n',
    'test "x"\n  pause 0s\n  api GET /a\n',
  ]) {
    assert.deepEqual(diags(src), [], `a duration was diagnosed as a numeric notation:\n${src}`);
  }
});

test('A1-01: unreadable input is bounded, not quadratic', () => {
  // 50 KB of unlexable bytes previously emitted one diagnostic per byte, each rendered with a full
  // copy of the line plus O(n) caret padding — 3.6 GB, then `Aborted (core dumped)`.
  const { diagnostics } = lex('§'.repeat(50_000));
  assert.ok(diagnostics.length <= 50, `expected the cap to hold, got ${diagnostics.length}`);
  const last = diagnostics[diagnostics.length - 1]!;
  assert.match(last.message, /too many unreadable characters/);
  assert.match(last.hint ?? '', /not tflw source at all/, 'the cap must explain itself, not just stop');
});
