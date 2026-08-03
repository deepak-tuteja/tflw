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

test('a tab used as inline whitespace (not indentation) does not distort column tracking (decision 69)', () => {
  const src = 'test "s"\n  api\tGET /x\n  expect status equals 200\n';
  const { tokens, diagnostics } = lex(src);
  assert.equal(diagnostics.length, 0);
  const getMethod = tokens.find((t) => t.type === 'ident' && t.value === 'GET')!;
  // Columns count characters, not tab-expanded width: "  api" is 5 chars (0-4), the tab is index 5,
  // so `GET` starts at index 6 → column 7.
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

test('A1-01: unreadable input is bounded, not quadratic', () => {
  // 50 KB of unlexable bytes previously emitted one diagnostic per byte, each rendered with a full
  // copy of the line plus O(n) caret padding — 3.6 GB, then `Aborted (core dumped)`.
  const { diagnostics } = lex('§'.repeat(50_000));
  assert.ok(diagnostics.length <= 50, `expected the cap to hold, got ${diagnostics.length}`);
  const last = diagnostics[diagnostics.length - 1]!;
  assert.match(last.message, /too many unreadable characters/);
  assert.match(last.hint ?? '', /not tflw source at all/, 'the cap must explain itself, not just stop');
});
