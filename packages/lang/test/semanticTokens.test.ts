// Unit tests for semanticTokens.ts (PLAN.md decision 105): the two-pass classifier (SymbolTable-
// derived variable/parameter/function spans + a lexer-driven wordlist/colon-lookahead pass) that
// backs the LSP's `textDocument/semanticTokens/full` provider.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, collectSymbols, collectSemanticTokens, type SemanticToken, type SemanticTokenType } from '../src/index.js';

/** Ground truth for a span, computed independently of the lexer/parser by a plain string scan. */
function posOf(source: string, needle: string, occurrence = 1): { offset: number } {
  let idx = -1;
  for (let i = 0; i < occurrence; i++) {
    idx = source.indexOf(needle, idx + 1);
    if (idx === -1) throw new Error(`"${needle}" occurrence ${occurrence} not found in source`);
  }
  return { offset: idx };
}

function tokensOf(source: string): readonly SemanticToken[] {
  const { program } = parseSource(source);
  const symbols = collectSymbols(program, source);
  return collectSemanticTokens(source, symbols);
}

function findToken(tokens: readonly SemanticToken[], source: string, needle: string, occurrence = 1): SemanticToken | undefined {
  const { offset } = posOf(source, needle, occurrence);
  return tokens.find((t) => t.span.start.offset === offset);
}

function assertTypeAt(tokens: readonly SemanticToken[], source: string, needle: string, type: SemanticTokenType, occurrence = 1): void {
  const tok = findToken(tokens, source, needle, occurrence);
  assert.ok(tok, `expected a semantic token at "${needle}" (occurrence ${occurrence})`);
  assert.equal(tok!.type, type, `type of "${needle}"`);
  assert.equal(tok!.span.end.offset, tok!.span.start.offset + needle.length, `end offset of "${needle}"`);
}

test('collectSemanticTokens: statement keyword, matcher operator, subject type, generator function', () => {
  const source = `test "ok"\n  let id = unique("x")\n  api GET /health\n  expect status equals 200\n`;
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'test', 'keyword');
  assertTypeAt(tokens, source, 'api', 'keyword');
  assertTypeAt(tokens, source, 'GET', 'keyword');
  assertTypeAt(tokens, source, 'expect', 'keyword');
  assertTypeAt(tokens, source, 'status', 'type');
  assertTypeAt(tokens, source, 'equals', 'operator');
  assertTypeAt(tokens, source, 'unique', 'function');
});

test('collectSemanticTokens: numbers, including a duration literal merged with its unit suffix', () => {
  const source = `test "ok"\n  api GET /health\n  expect status equals 200\n  expect duration is less than 5000ms\n`;
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, '200', 'number');
  const dur = findToken(tokens, source, '5000ms');
  assert.ok(dur, 'expected one combined token covering "5000ms"');
  assert.equal(dur!.type, 'number');
  assert.equal(dur!.span.end.offset - dur!.span.start.offset, '5000ms'.length);
});

test('collectSemanticTokens: variable def/ref (bare and inside string interpolation)', () => {
  const source = `test "ok"\n  let orderId = unique("ord")\n  api GET /orders/{orderId}\n    header "Authorization" is "Bearer {orderId}"\n  expect status equals 200\n`;
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'orderId', 'variable', 1); // def
  assertTypeAt(tokens, source, 'orderId', 'variable', 2); // ref inside an unquoted path interpolation
  assertTypeAt(tokens, source, 'orderId', 'variable', 3); // ref inside a quoted string interpolation hole
});

test('collectSemanticTokens: an action param ref resolves to `parameter`, not `variable`', () => {
  const source = `action create order(customerName)\n  api POST /orders body { customer: {customerName} }\n  give customerName\n`;
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'customerName', 'parameter', 1); // def
  assertTypeAt(tokens, source, 'customerName', 'parameter', 2); // ref inside interpolation
  assertTypeAt(tokens, source, 'customerName', 'parameter', 3); // ref in `give`
});

test('collectSemanticTokens: an in-file action call resolves to `function`', () => {
  const source = `action create order(name)\n  give name\n\ntest "ok"\n  let orderId = create order("Widget")\n  api GET /orders/{orderId}\n  expect status equals 200\n`;
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'create order', 'function');
});

test('collectSemanticTokens: a bare object-literal key is `property`; a quoted key gets no token', () => {
  const source = `test "ok"\n  api POST /reviews body { rating: 5, "Idempotency-Key": "abc" }\n  expect status equals 201\n`;
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'rating', 'property');
  // The quoted key is already colored by the TextMate grammar's string rule — no semantic token
  // should double up on it (only its `string` lexer token exists, never an `ident`).
  const quotedKeyToken = tokens.find((t) => t.span.start.offset === posOf(source, '"Idempotency-Key"').offset);
  assert.equal(quotedKeyToken, undefined, 'expected no semantic token for a quoted object-literal key');
});

test('collectSemanticTokens: a field literally named after a keyword word classifies as `property`, not `type`/`keyword`', () => {
  const source = `test "ok"\n  api POST /orders body { status: "pending", body: "x" }\n  expect status equals 201\n`;
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'status', 'property', 1); // the object-literal field key
  assertTypeAt(tokens, source, 'status', 'type', 2); // the real `expect status` subject keyword
});

test('collectSemanticTokens: returned tokens are sorted by start offset with no duplicate start offsets', () => {
  const source = `test "checkout"\n  api POST /products/{productIdA}/reviews body { rating: 5, comment: "e" }\n    header "Authorization" is "Bearer {shopperToken}"\n  expect status equals 201\n  expect duration is less than 5000ms\n`;
  const tokens = tokensOf(source);
  assert.ok(tokens.length > 10, 'expected a substantial number of classified tokens for this snippet');
  for (let i = 1; i < tokens.length; i++) {
    assert.ok(
      tokens[i]!.span.start.offset > tokens[i - 1]!.span.start.offset,
      `token ${i} (${JSON.stringify(source.slice(tokens[i]!.span.start.offset, tokens[i]!.span.end.offset))}) is not strictly after token ${i - 1}`,
    );
  }
});
