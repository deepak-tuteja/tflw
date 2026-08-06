// Lexer golden (token stream) + explicit source-position assertions. Positions are the
// foundation of every diagnostic, so a few are pinned exactly rather than only snapshotted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lex, parseSource, checkProgram, type Token } from '../src/index.js';
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

// -- M98c: the diagnostics that fired and taught nothing ----------------------------------------
// The M98b rows were facts the lexer withheld. These are facts it *stated* — at the wrong position,
// in its own vocabulary, or once per line for a single mistake. A diagnostic that fires is not the
// same as a diagnostic that helps, and every row here was already "covered" by a passing test.

test('A1-09/D159: `newline` sits at the end of the code, not past a trailing comment', () => {
  // `eolOffset = lineStart + line.length` is the *physical* end of the line, so every "found end of
  // line" caret landed inside the comment: the missing path here belongs just after `GET`, and the
  // caret was 63 columns further right, under the word "later".
  const src = 'test "t"\n  api GET                                  # TODO fill in the path later\n';
  const nl = lex(src).tokens.filter((t) => t.type === 'newline');
  //   `  api GET` is 9 code units — the `newline` belongs at index 9 of the line, column 10.
  assert.equal(nl[1]!.span.start.line, 2);
  assert.equal(nl[1]!.span.start.column, 10);
  assert.equal(nl[1]!.span.start.offset, src.indexOf('  api GET') + '  api GET'.length, 'the caret must not be in the comment');
});

test('A1-09: trailing whitespace is not part of the line either', () => {
  // The same fix, for the case with no comment at all: a line with trailing spaces used to put the
  // caret past the last visible character, which reads as pointing at nothing.
  const { tokens } = lex('test "t"\n  api GET   \n');
  const nl = tokens.filter((t) => t.type === 'newline');
  assert.equal(nl[1]!.span.start.column, 10);
});

test('A1-09: a `#` inside a string is not a comment — the control that forces the return value', () => {
  // This is why `lexContent` has to *return* where it stopped rather than the caller re-scanning for
  // `#`: a scan would find this one and place `newline` in the middle of the step. The step ends
  // after the closing quote.
  const src = 'test "t"\n  log "a # b"\n';
  const nl = lex(src).tokens.filter((t) => t.type === 'newline');
  assert.equal(nl[1]!.span.start.offset, src.lastIndexOf('"') + 1);
});

test('A1-12/A1-13/TF048: the tab rule has its own code and fires once per file', () => {
  // 100 lines, one editor setting, one mistake. It used to be 100 identical `TF003`s — and `TF003`
  // is the *alignment* code, which is all `spec-data.ts` documented, so SPEC §17, the Reference page
  // and LSP hover each described the wrong rule for half of that code's firings.
  const src = 'test "t"\n' + Array.from({ length: 100 }, (_, i) => `\tlog "line ${i}"`).join('\n') + '\n';
  const found = diags(src).filter((d) => d.code === 'TF048');
  assert.equal(found.length, 1, 'one diagnostic per file, not per line');
  assert.equal(found[0]!.span.start.line, 2, 'reported at the first offending line');
  assert.match(found[0]!.hint ?? '', /99 more lines/, 'the count belongs in the help line, not in 99 more diagnostics');
  assert.equal(diags(src).filter((d) => d.code === 'TF003').length, 0, '`TF003` must now mean exactly one thing');
  // The negative control for over-firing is the rest of this suite: every other source in it is
  // indented with spaces, so a `TF048` that fired on those would fail hundreds of assertions.
});

test('A1-13: `TF003` still fires for the condition it documents — the control for the split', () => {
  // Splitting a code is only safe if the *other* meaning survives. A 3-space block inside a 2-space
  // one closes to neither level, which is `TF003`'s one remaining meaning.
  const found = diags('test "t"\n  api GET /a\n     log "x"\n   log "y"\n').filter((d) => d.code === 'TF003');
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /does not match any enclosing block/);
});

test('A1-16/D163: one emoji is one diagnostic naming the character, not two naming surrogates', () => {
  // `let a = 🚀` advanced one UTF-16 code unit at a time and reported `"\ud83d"` and `"\ude80"` —
  // two diagnostics, neither of them a character anybody typed.
  const found = diags('test "t"\n  let a = 🚀\n').filter((d) => d.code === 'TF001');
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /🚀/);
});

test('A1-16: a run of rejected characters is one mistake', () => {
  const found = diags('test "t"\n  let 名前 = 1\n').filter((d) => d.code === 'TF001');
  assert.equal(found.length, 1, 'one word, one diagnostic');
  assert.match(found[0]!.message, /unexpected characters "名前"/);
});

test('A1-16: an identifier cut short says so, where the truncation happened', () => {
  // `let café = 1` emits a perfectly valid-looking `ident:"caf"` before the error, and that token
  // goes on to the checker, which reports an unknown variable `caf` the author never wrote. The
  // token is *kept* — recovery needs it — so the explanation has to travel with the character.
  const { tokens, diagnostics } = lex('test "t"\n  let café = 1\n');
  assert.ok(tokens.some((t) => t.type === 'ident' && t.value === 'caf'), 'recovery still emits the prefix');
  const found = diagnostics.filter((d) => d.code === 'TF001');
  assert.equal(found.length, 1);
  assert.match(found[0]!.hint ?? '', /the name `caf` was cut short here/);
});

test('A1-16: an invisible character is named by code point, not quoted', () => {
  // `unexpected character " "` for U+00A0 is a message whose evidence the reader cannot see. The
  // negative control is in the same assertion: a *visible* character is still quoted, as before.
  const nbsp = diags('test "t"\n  log "x"\n').filter((d) => d.code === 'TF001');
  assert.equal(nbsp.length, 1);
  assert.match(nbsp[0]!.message, /U\+00A0 NO-BREAK SPACE/);
  const dollar = diags('test "t"\n  let a = $x\n').filter((d) => d.code === 'TF001');
  assert.match(dollar[0]!.message, /unexpected character "\$"/, 'a visible character is still shown as itself');
});

test('A1-16: the coalesced run is bounded — the guard A1-01 caught the first time', () => {
  // Coalescing without a cap put a whole 50 KB unlexable file inside one message: the same quadratic
  // blow-up `A1-01` exists to prevent, re-entering through the message instead of the count. Both
  // bounds are needed, and this asserts the one the run introduced.
  const { diagnostics } = lex('§'.repeat(50_000));
  for (const d of diagnostics) assert.ok(d.message.length < 200, `a single message grew to ${d.message.length} characters`);
});

test('A1-16: ordinary ASCII source produces no run diagnostics — the negative control', () => {
  // `isUnlexable` is derived from `lexContent`'s branches, so a mistake in it would swallow real
  // tokens as garbage. This exercises every character class the lexer has a branch for.
  const src = 'test "t"\n  api POST /o?a=1,2 body { qty: 3, tags: ["x"] }\n  expect status equals 201\n  let r = (1 + 2) * 3 / 4 - 5\n  expect duration is less than 500ms\n';
  assert.deepEqual(diags(src), []);
});

test('A1-16: a rejected run stops at the next real token — the control M11 showed was missing', () => {
  // The first version of the ASCII control only asserted that *clean* source stays clean, which can
  // never fail for a rule that only runs after every other branch has declined. Dropping `@` from
  // `isUnlexable` — making the run swallow a token start — left the whole suite green. This is the
  // case that catches it: garbage immediately followed by each kind of token the lexer recognises.
  for (const [after, type] of [
    ['"s"', 'string'],
    ['12', 'number'],
    ['@t', 'tag'],
    ['ab', 'ident'],
    ['{', 'lbrace'],
    ['/p', 'slash'],
  ] as const) {
    const { tokens, diagnostics } = lex(`§${after}\n`);
    assert.equal(diagnostics.filter((d) => d.code === 'TF001').length, 1, `§${after}: one run, one diagnostic`);
    assert.equal(tokens[0]!.type, type, `§${after}: the run must stop at the ${type} that follows it`);
  }
});

// -- M98d: the characters that make rendered source and parsed source two different texts ---------
// `A1-17`, D165/D166. Everything above this line assumes the reader of a `.tflw` can see what it
// asserts. These are the characters for which that is false.

test('A1-17: a bidi override in a comment is an error (the finding\'s first repro)', () => {
  // Renders in most editors as though the *next* assertion read 500, when it reads 200. Before this
  // the file was reported as `1 file checked, no problems found.`
  const found = diags('test "t"\n  # \u202Eexpect status equals 500 \u202D\n  api GET /health\n').filter((d) => d.code === 'TF049');
  assert.equal(found.length, 2, 'both the override and the pop are reported');
  assert.match(found[0]!.message, /U\+202E RIGHT-TO-LEFT OVERRIDE in a comment/);
});

test('A1-17: a zero-width space inside a compared string is an error (second repro)', () => {
  // `"admin\u200Buser"` renders identically to `"adminuser"` and compares unequal to it — the exact
  // shape of an assertion that reads as passing for a reason it is not passing for.
  const found = diags('test "t"\n  log "admin\u200Buser"\n').filter((d) => d.code === 'TF049');
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /U\+200B ZERO WIDTH SPACE in a string/);
});

test('A1-17: no position accepts a hidden character — the pin on a split invariant', () => {
  // The rule is enforced by *two* mechanisms: `TF049` in the four places a character is consumed
  // without being lexed, and `TF001` everywhere else, since none of these can start a token. Neither
  // mechanism is the invariant. The invariant is that no file containing one of these characters
  // checks clean, and a split invariant is exactly how a hole reopens quietly — so it is asserted as
  // a property over every position rather than against either half.
  const positions: Array<[string, (c: string) => string]> = [
    ['code', (c) => `test "t"\n  let a${c} = 1\n`],
    ['string', (c) => `test "t"\n  log "a${c}b"\n`],
    // A *trailing* comment and a comment-only line are read by two different call sites, and every
    // case first written here was the second kind — so deleting the trailing-comment scan left the
    // suite green. `api GET /health  # ‹override›` is the more dangerous of the two, being the one
    // that sits beside real code.
    ['trailing comment', (c) => `test "t"\n  log "x"  # a${c}b\n`],
    ['comment-only line', (c) => `# a${c}b\ntest "t"\n  log "x"\n`],
    ['path', (c) => `test "t"\n  api GET /hea${c}lth\n`],
    ['tag', (c) => `@sm${c}oke\ntest "t"\n  log "x"\n`],
    ['trailing whitespace', (c) => `test "t"\n  log "x" ${c}\n`],
    // Reached by exactly one call site — the leading-whitespace scan — and only a BOM can survive
    // the indentation loop to get there, so without this row that site can be deleted unnoticed.
    ['indentation', (c) => `test "t"\n${c}  log "x"\n`],
  ];
  for (const ch of ['\u202E', '\u2066', '\u200B', '\u200D', '\uFEFF']) {
    const cp = ch.codePointAt(0)!.toString(16).toUpperCase();
    for (const [name, build] of positions) {
      const found = diags(build(ch)).filter((d) => d.code === 'TF049' || d.code === 'TF001');
      assert.ok(found.length > 0, `U+${cp} in ${name} must be rejected by one rule or the other`);
    }
  }
});

test('A1-17/D166: `\\u{…}` is the way to write one — the rule has a legal alternative', () => {
  // Without this the milestone would not be shipping a lint. D157 made every unknown escape an
  // error and tflw had no `\u`, so rejecting the literal character would have left *no* way at all
  // to put a zero-width space in a string. The scan reads raw source, which is what makes the
  // escaped form legal while the literal one is not.
  const { tokens, diagnostics } = lex('test "t"\n  log "admin\\u{200B}user"\n');
  assert.equal(diagnostics.length, 0, 'the escaped form is legal');
  const str = tokens.filter((t) => t.type === 'string')[1]!;
  assert.equal(str.value, 'admin\u200Buser', 'and it decodes to the character it names');
});

test('D166: `\\u{…}` decodes astral characters as one escape, which `\\uXXXX` cannot', () => {
  const { tokens } = lex('test "t"\n  log "\\u{1F600}"\n');
  assert.equal(tokens.filter((t) => t.type === 'string')[1]!.value, '\u{1F600}');
});

test('D166: every malformed `\\u` is TF047, each saying which way it is malformed', () => {
  const cases: Array<[string, RegExp]> = [
    ['\\u0041', /needs braces/],
    ['\\u{}', /no code point/],
    ['\\u{ZZ}', /not closed/],
    ['\\u{41', /not closed/],
    ['\\u{110000}', /above the highest code point/],
    ['\\u{D800}', /half of a surrogate pair/],
  ];
  for (const [text, shape] of cases) {
    const found = diags(`test "t"\n  log "${text}"\n`).filter((d) => d.code === 'TF047');
    assert.equal(found.length, 1, `${text}: exactly one diagnostic`);
    assert.match(found[0]!.message, shape);
  }
});

test('D166: `\\u0041` is offered the exact braced spelling, not a rule to re-read', () => {
  const found = diags('test "t"\n  log "\\u0041"\n').filter((d) => d.code === 'TF047');
  assert.match(found[0]!.hint!, /write `\\u\{0041\}`/);
});

test('D166: malformed `\\u` recovery contributes nothing — braces are interpolation syntax', () => {
  // The neighbouring unknown-escape recovery drops the backslash and keeps the letter, which is safe
  // only because every escape it covers is one character. Keeping `\u{ZZ}` verbatim recovered to
  // `u{ZZ}`, and the checker then reported `TF030: unknown variable "ZZ"` — a name the author never
  // wrote, arriving as a second unrelated error.
  //
  // This assertion has to run the *checker*, not `diags` — `TF030` is a checker diagnostic, and the
  // first version of this test looked only at `lex()`'s output, where it can never appear. Mutating
  // the recovery back left the whole suite green: a control that cannot fail (M98c's lesson, twice
  // over now). The same applied to `M98d-01` below, which asserted against a parser code.
  const { program, diagnostics } = parseSource('test "t"\n  log "\\u{ZZ}"\n');
  const all = [...diagnostics, ...checkProgram(program)];
  assert.equal(all.filter((d) => d.code === 'TF030').length, 0, 'no invented variable');
  assert.equal(all.filter((d) => d.code === 'TF047').length, 1, 'and the escape itself is still reported');
});

test('TF047\'s help line cannot deny that `\\u{…}` exists', () => {
  // `ESCAPE_LIST` is derived from `ESCAPES`, and the braced form is the one escape that is not a key
  // in that table — so it is the one that could silently drop out of the help while remaining legal.
  const found = diags('test "t"\n  log "\\q"\n').filter((d) => d.code === 'TF047');
  assert.match(found[0]!.hint!, /\\u\{…\}/);
});

test('A1-17: a BOM stays legal at offset 0 and only there', () => {
  // The carve-out that keeps `A1-04` fixed, and a control that can actually fail: an implementation
  // that simply added `U+FEFF` to the rejected set would break every UTF-8-with-BOM file.
  assert.equal(diags('\uFEFFtest "t"\n  log "x"\n').filter((d) => d.code === 'TF049').length, 0);
  const mid = diags('test "t"\n  let a\uFEFFb = 1\n').filter((d) => d.code === 'TF049');
  assert.equal(mid.length, 1, 'the same character mid-line is not a byte-order mark');
  assert.match(mid[0]!.message, /byte-order mark/);
});

test('M98d-01: a BOM at offset 0 no longer makes line 1 read as indented', () => {
  // Pre-existing, found by this milestone's own probe and measured failing identically on the M98c
  // build: the BOM was skipped as whitespace but still *counted* as a column, so the first line of
  // every UTF-8-with-BOM file measured one level of indentation and the file failed to parse at all
  // — `TF016: … found an indented block`, on a file whose first line starts at column 1.
  // `parseSource`, not `diags`: `TF016` is a *parser* diagnostic, so a lexer-only assertion here
  // was green whether the fix was present or not.
  assert.deepEqual(parseSource('\uFEFFtest "t"\n  log "x"\n').diagnostics, []);
  // The tokens on that line keep their true columns; only the indent width was ever wrong.
  const first = lex('\uFEFFtest "t"\n  log "x"\n').tokens[0]!;
  assert.equal(first.span.start.column, 2, 'the `test` still sits after the BOM, at column 2');
});

test('A1-17: TF049 is bounded, for the reason TF001 is', () => {
  // A diagnostic renders a copy of its line plus O(n) caret padding, so one per character over a
  // large hostile file is `A1-01`'s quadratic blow-up arriving through a new door — which is how it
  // came back in M98c. Counted separately from `unexpectedChars` so that a file with 50 ordinary
  // typos cannot be the reason a hidden character goes unreported.
  const found = diags(`test "t"\n  log "${'\u200B'.repeat(5000)}"\n`).filter((d) => d.code === 'TF049');
  assert.ok(found.length <= 50, `bounded, got ${found.length}`);
  assert.match(found[found.length - 1]!.message, /too many hidden characters/);
});

test('A1-17: the ordinary corpus stays silent — a control with something to lose', () => {
  // Not "clean source stays clean", which is unfalsifiable for a rule that only inspects specific
  // code points (M98c's `M11` mutation survived exactly that shape). This puts the *visible*
  // characters a hidden one would be mistaken for — a real space, a real hyphen, a real joiner word
  // — in the positions the scan reads, and requires silence there.
  const src = 'test "t"\n  # a normal comment - with punctuation\n  log "admin user-name"\n  api GET /health\n';
  assert.deepEqual(diags(src).filter((d) => d.code === 'TF049'), []);
});

test('A1-17: a file full of ordinary typos does not use up TF049\'s budget', () => {
  // The reason `hiddenChars` is its own counter rather than sharing `unexpectedChars`. Sharing reads
  // as tidier and is wrong in one direction that matters: a file with enough unrelated garbage in it
  // would exhaust the budget before the scan ran, and the character that changes what the file
  // *means* would be the one that went unreported.
  const noise = Array.from({ length: 60 }, (_, i) => `  let a${i} = §\n`).join('');
  const found = diags(`test "t"\n${noise}  log "admin​user"\n`);
  assert.ok(found.some((d) => d.code === 'TF001' && /stopping after/.test(d.message)), 'TF001 is exhausted');
  assert.equal(found.filter((d) => d.code === 'TF049').length, 1, 'and TF049 still reports');
});
