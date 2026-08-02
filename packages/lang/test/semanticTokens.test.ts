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

// -- M4a: browser-arc (M3a-M3e) keyword/operator/type coverage, previously entirely unclassified ---

test('collectSemanticTokens: browser-step keywords (open/click/fill/within/stub) classify as `keyword`', () => {
  const source = `test "ok"\n  open "/checkout"\n  click button "Pay"\n  fill field "Email" with "a@b.c"\n  within css "#cart"\n    stub GET "/api/x" respond status 200\n`;
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'open', 'keyword');
  assertTypeAt(tokens, source, 'click', 'keyword');
  assertTypeAt(tokens, source, 'fill', 'keyword');
  assertTypeAt(tokens, source, 'with', 'keyword');
  assertTypeAt(tokens, source, 'within', 'keyword');
  assertTypeAt(tokens, source, 'stub', 'keyword');
  assertTypeAt(tokens, source, 'respond', 'keyword');
});

// -- M28 (PLAN_LOG_LSP.md): `log` (M27) had never caught up to this independent keyword copy ------

test('collectSemanticTokens: `log` statement keyword classifies as `keyword`', () => {
  const source = `test "ok"\n  let id = "1"\n  log warn "order {id} created" to console\n`;
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'log', 'keyword');
});

test('collectSemanticTokens: locator/page subject words (button/field/css/page) classify as `type`', () => {
  const source = `test "ok"\n  click button "Pay"\n  fill field "Email" with "x"\n  click css "#go"\n  expect page has no critical a11y violations\n`;
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'button', 'type');
  assertTypeAt(tokens, source, 'field', 'type');
  assertTypeAt(tokens, source, 'css', 'type');
  assertTypeAt(tokens, source, 'page', 'type');
});

test('collectSemanticTokens: `has no <severity> a11y violations` (M3e) words classify as `operator`', () => {
  const source = `test "ok"\n  expect page has no critical a11y violations\n`;
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'has', 'operator');
  assertTypeAt(tokens, source, 'no', 'operator');
  assertTypeAt(tokens, source, 'critical', 'operator');
  assertTypeAt(tokens, source, 'a11y', 'operator');
  assertTypeAt(tokens, source, 'violations', 'operator');
});

test('collectSemanticTokens: `was made` (M3d) classifies as `operator`', () => {
  const source = `test "ok"\n  expect request to "/orders" was made\n`;
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'was', 'operator');
  assertTypeAt(tokens, source, 'made', 'operator');
});

test('collectSemanticTokens (M4b): `mask` classifies as `keyword`, `snapshot` classifies as `operator`', () => {
  const source = `test "ok"\n  expect page matches snapshot "checkout-page" mask css ".timestamp"\n`;
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'matches', 'operator');
  assertTypeAt(tokens, source, 'snapshot', 'operator');
  assertTypeAt(tokens, source, 'mask', 'keyword');
});

test('collectSemanticTokens: a variable used inside a browser step (`fill … with {var}`) is colored `variable` (relies on symbols.ts walking browser steps, M4a)', () => {
  const source = `test "ok"\n  let userEmail = unique email\n  fill field "Email" with {userEmail}\n`;
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'userEmail', 'variable', 1); // def
  assertTypeAt(tokens, source, 'userEmail', 'variable', 2); // ref inside the FillStmt's braced value
});

// -- M33 (perf-arc LSP/VS Code catch-up, D24b): the M29-M32 load-testing grammar had never been
// classified — a load-testing file rendered visually flat next to an ordinary `test`/browser file,
// exactly the M4a-era browser-arc gap for a different construct. M50 (D93-D95) later collapsed
// `scenario` into a workload-bearing `test` — these now use `test "…" { ramp to … }` instead. ---

test('collectSemanticTokens (M33/M50): `ramp`/`over`/`threshold`/`cleanup`/`think` classify as `keyword`', () => {
  const source = `test "checkout burst"\n  ramp to 10 users over 30s\n  threshold p95 duration is less than 800ms\n  cleanup\n  api GET /health\n  think 1s to 3s\n`;
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'ramp', 'keyword');
  assertTypeAt(tokens, source, 'over', 'keyword');
  assertTypeAt(tokens, source, 'threshold', 'keyword');
  assertTypeAt(tokens, source, 'cleanup', 'keyword');
  assertTypeAt(tokens, source, 'think', 'keyword');
});

test('collectSemanticTokens (Phase 2b, D105-D107): `parallel`/`sequential` header modifiers classify as `keyword`', () => {
  const source = `test "checkout burst" retry 2 parallel\n  api GET /health\n\ntest "browsing" sequential\n  api GET /health\n`;
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'parallel', 'keyword');
  assertTypeAt(tokens, source, 'sequential', 'keyword');
});

test('collectSemanticTokens (M33/M50): `users`/`rps`/`error`/`rate` workload+threshold nouns classify as `type`', () => {
  const source = `test "browsing"\n  ramp to 100 rps over 30s\n  threshold error rate is less than 1%\n  api GET /health\n\ntest "checkout"\n  ramp to 10 users over 30s\n  api GET /health\n`;
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'rps', 'type');
  assertTypeAt(tokens, source, 'error', 'type');
  assertTypeAt(tokens, source, 'rate', 'type');
  assertTypeAt(tokens, source, 'users', 'type');
});

test('collectSemanticTokens (M33/M50): a `p50`/`p95`/`p99` threshold percentile classifies as `type`', () => {
  const source = `test "checkout burst"\n  ramp to 10 users over 30s\n  threshold p50 duration is less than 200ms\n  threshold p95 duration is less than 800ms\n  threshold p99 duration is less than 1500ms\n  api GET /health\n`;
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'p50', 'type');
  assertTypeAt(tokens, source, 'p95', 'type');
  assertTypeAt(tokens, source, 'p99', 'type');
  // `duration` right after each percentile is still its own, pre-existing `type` token (unaffected).
  assertTypeAt(tokens, source, 'duration', 'type', 1);
});

test('collectSemanticTokens (M33/M50): `as admin, userA` session refs on a workload-bearing `test` header classify like on a functional `test` header (session refs carry no token, by design)', () => {
  const source = `test "checkout burst" as admin, userA\n  ramp to 10 users over 30s\n  api GET /health\n`;
  const tokens = tokensOf(source);
  // Sessions deliberately get no semantic token (symbolKindToTokenType returns null for 'session') —
  // this asserts the workload-header case doesn't crash and doesn't spuriously tag them some other way.
  const adminTok = findToken(tokens, source, 'admin');
  const userATok = findToken(tokens, source, 'userA');
  assert.equal(adminTok, undefined);
  assert.equal(userATok, undefined);
});

test('collectSemanticTokens (M33/M50): a variable used inside a workload-bearing test body is colored `variable` (relies on symbols.ts walking its body)', () => {
  const source = `test "checkout burst"\n  ramp to 10 users over 30s\n  let orderId = unique("ord")\n  api GET /orders/{orderId}\n  expect status equals 200\n`;
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'orderId', 'variable', 1); // def
  assertTypeAt(tokens, source, 'orderId', 'variable', 2); // ref inside the interpolated path
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
