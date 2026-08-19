// Unit tests for semanticTokens.ts (PLAN.md decision 105): the two-pass classifier (SymbolTable-
// derived variable/parameter/function spans + a lexer-driven wordlist/colon-lookahead pass) that
// backs the LSP's `textDocument/semanticTokens/full` provider.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource, collectSymbols, collectConfigSymbols, collectSemanticTokens, type SemanticToken, type SemanticTokenType } from '../src/index.js';

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
  return collectSemanticTokens(source, symbols, 'test');
}

/** The `tflw.config` dialect (M133). `server.ts` hands `collectSemanticTokens` whatever the store
 * analyzed, which is a `ConfigFile` for a config buffer — so config vocabulary is colored by this
 * same function, and the only difference on the test side is which parser/symbol collector feeds
 * it, plus the `'config'` dialect the function now takes explicitly (`M136b`, D427). */
function configTokensOf(source: string): readonly SemanticToken[] {
  const { config } = parseConfigSource(source);
  const symbols = collectConfigSymbols(config, source);
  return collectSemanticTokens(source, symbols, 'config');
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

test('collectSemanticTokens: `h` is not a duration unit, so `5h` is not merged into one number token (B5-10, M142)', () => {
  // `parser.ts`'s `DURATION_UNITS` is `['ms','s','m']`, and its docblock says the hour/day/week
  // family is deliberately absent — `5h` is `TF023: unknown time unit`. This list used to carry a
  // fourth entry `h`, so the editor rendered `5h` as a finished duration literal and the checker
  // then rejected it. Colouring a word the lexer rejects is the one drift direction that is never
  // cosmetic: it is the editor asserting something false about the language.
  const source = `test "ok"\n  api GET /health\n  expect duration is less than 5h\n`;
  const tokens = tokensOf(source);
  const tok = findToken(tokens, source, '5h');
  assert.ok(tok, 'the bare number is still a token');
  assert.equal(tok!.type, 'number');
  assert.equal(tok!.span.end.offset - tok!.span.start.offset, 1, '`h` must be left uncoloured, not swallowed into the number');
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

// M133 (D24b catch-up). The two pentest scans are asserted separately rather than folded into the
// a11y test above, because they were not equally covered: `security` was already in `OPERATORS`
// (M128b) and `authorization` was not, so one of these two lines passed on `main` and the other did
// not. A single combined assertion would have hidden which.
test('collectSemanticTokens: `has no <severity> security violations` (M128b) words classify as `operator`', () => {
  const source = `test "ok"\n  expect response has no serious security violations\n`;
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'serious', 'operator');
  assertTypeAt(tokens, source, 'security', 'operator');
  assertTypeAt(tokens, source, 'violations', 'operator');
});

test('collectSemanticTokens: `has no <severity> authorization violations` (M130b/D304) words classify as `operator`', () => {
  const source = `test "ok"\n  expect response has no critical authorization violations\n`;
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'critical', 'operator');
  assertTypeAt(tokens, source, 'authorization', 'operator');
  assertTypeAt(tokens, source, 'violations', 'operator');
});

// M133: the arc's config-dialect vocabulary. `privileged` is asserted on a `session` header rather
// than in isolation because that is the only place it is legal, and the header is also where the
// session *name* lives — so this doubles as proof the new keyword does not steal the name's span
// from the AST-derived pass, which runs first and claims it.
test('collectSemanticTokens: `authorized target`/`reason`/`probe mutating`/`privileged` (M128b/M130b) classify as `keyword` in tflw.config', () => {
  const source =
    'defaults\n' +
    '  authorized target "http://localhost:4001" reason "self-hosted test fixture"\n' +
    '    probe mutating\n' +
    '\n' +
    'session admin privileged\n' +
    '  header "Authorization" is "Bearer t"\n';
  const tokens = configTokensOf(source);
  assertTypeAt(tokens, source, 'authorized', 'keyword');
  assertTypeAt(tokens, source, 'target', 'keyword');
  assertTypeAt(tokens, source, 'reason', 'keyword');
  assertTypeAt(tokens, source, 'probe', 'keyword');
  assertTypeAt(tokens, source, 'mutating', 'keyword');
  assertTypeAt(tokens, source, 'privileged', 'keyword');
  // `session admin privileged` must not become three keywords in a row. Session names get no
  // semantic token at all by design (`symbolKindToTokenType` returns null for `session` — grammar
  // coloring already covers them), so the correct assertion is *absence*, not a different type.
  assert.equal(findToken(tokens, source, 'admin'), undefined, 'the session name is not a keyword');
});

// M137a (`D384`'s residue) — the test that would have caught the drift this milestone is fixing.
// `M134a` added `input`/`handling` here and `oversized`/`traversal` only to `tflw.tmLanguage.json`,
// then recorded the catch-up as done. Nothing in the repo could contradict it, because none of
// `M134a`'s four words had a test in either file. `B5-09`, fourth arc running.
// `M137c` (D432/D450) — the crawl's four words, in the milestone that ships them, with the sibling in
// `packages/vscode/test/grammar.test.ts`. The pair is what makes drift between the two wordlists
// detectable; `M137a` had to add the pair for `M134a`'s words after the fact, which is `B5-09`'s
// fourth arc and the reason these are written up front now.
test('collectSemanticTokens: `crawl`/`seed`/`openapi`/`traffic` are `keyword` (M137c)', () => {
  const source = 'crawl "the v1 surface" as peer\n  seed openapi "/openapi.json"\n  seed traffic\n  exclude "/vuln/**"\n  expect response has no critical security violations\n';
  // Zero diagnostics first, for the reason the M136b tests state: this pass is lexer-driven and never
  // consults the parse, so a source the parser rejects would still colour — and the test would pass
  // while describing a crawl nobody can write.
  const { diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics.map((d) => d.code), [], 'the crawl source parses clean');
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'crawl', 'keyword');
  assertTypeAt(tokens, source, 'seed', 'keyword');
  assertTypeAt(tokens, source, 'openapi', 'keyword');
  assertTypeAt(tokens, source, 'traffic', 'keyword');
  assertTypeAt(tokens, source, 'exclude', 'keyword');
});

test('collectSemanticTokens: `input handling` (D366) is `operator`, and `probe oversized`/`traversal` (D372) are `keyword`', () => {
  const matcherSource = 'test "ok"\n  expect response has no moderate input handling violations\n';
  const matcherTokens = tokensOf(matcherSource);
  assertTypeAt(matcherTokens, matcherSource, 'input', 'operator');
  assertTypeAt(matcherTokens, matcherSource, 'handling', 'operator');

  const probeSource =
    'defaults\n' +
    '  authorized target "http://localhost:4001" reason "self-hosted test fixture"\n' +
    '    probe oversized\n' +
    '    probe traversal\n';
  // Zero diagnostics, for the reason the M136b tests state: the lexer-driven pass never consults
  // the parse, so a source the parser rejects would still colour and this would pass while
  // describing a config nobody can write.
  const { diagnostics } = parseConfigSource(probeSource);
  assert.deepEqual(diagnostics.map((d) => d.code), [], 'the probe sub-clause source parses clean');
  const probeTokens = configTokensOf(probeSource);
  assertTypeAt(probeTokens, probeSource, 'oversized', 'keyword');
  assertTypeAt(probeTokens, probeSource, 'traversal', 'keyword');
});

// -- M136b (D427/D427a): the config dialect's own vocabulary --------------------------------
//
// `M133-01` said nine words were missing from this list. Measuring every word `parser.ts` puts in
// keyword position, rather than the nine the row enumerated, found eighteen in the config dialect
// (and four more in the test dialect, filed as `M136b-01`). These three tests are the two
// directions of the split plus the realistic case.

/** The eighteen, in declaration order: the `CONFIG_KEYS` top-level directives (`parser.ts:352`),
 * the `oauth2` session block, then the `log`/`redact` sub-clause words. */
const CONFIG_ONLY_WORDS = [
  'web', 'insecure', 'cert', 'key', 'allow', 'hosts', 'evidence', 'redact', 'viewport',
  'oauth2', 'token', 'client', 'id', 'secret', 'scope',
  'destination', 'level', 'query',
] as const;

test('collectSemanticTokens (M136b, D427a): all eighteen config-only keywords classify as `keyword` in a real tflw.config', () => {
  // Parses with zero diagnostics — asserted below, because a source the parser rejects would still
  // colour (the lexer-driven pass never consults the parse) and the test would pass while claiming
  // to describe a config anybody could write.
  const source =
    'defaults\n' +
    '  insecure true\n' +
    '  cert "./client.pem"\n' +
    '  key "./client-key.pem"\n' +
    '  allow hosts "api.example.com"\n' +
    '  evidence "headers-only"\n' +
    '  redact header "Authorization"\n' +
    '  redact query "token"\n' +
    '  viewport 1280 720\n' +
    '  log level "debug"\n' +
    '  log destination "both"\n' +
    '\n' +
    'env local\n' +
    '  api "https://api.example.com"\n' +
    '  web "https://app.example.com"\n' +
    '\n' +
    'session svc oauth2\n' +
    '  token url "https://auth.example.com/token"\n' +
    '  client id "abc"\n' +
    '  client secret "shh"\n' +
    '  scope "read:orders"\n';

  const { config, diagnostics } = parseConfigSource(source);
  assert.deepEqual(diagnostics.map((d) => d.message), [], 'the fixture config must parse cleanly');

  const tokens = collectSemanticTokens(source, collectConfigSymbols(config, source), 'config');
  // Occurrence-indexed, not `indexOf`: `token` first appears inside `redact query "token"` and
  // `client` inside `"./client.pem"`, so the naive lookup finds a string, not the keyword.
  assertTypeAt(tokens, source, 'insecure', 'keyword');
  assertTypeAt(tokens, source, 'cert', 'keyword');
  assertTypeAt(tokens, source, 'key', 'keyword'); // the directive precedes the "./client-key.pem" that also contains it
  assertTypeAt(tokens, source, 'allow', 'keyword');
  assertTypeAt(tokens, source, 'hosts', 'keyword');
  assertTypeAt(tokens, source, 'evidence', 'keyword');
  assertTypeAt(tokens, source, 'redact', 'keyword');
  assertTypeAt(tokens, source, 'viewport', 'keyword');
  assertTypeAt(tokens, source, 'level', 'keyword');
  assertTypeAt(tokens, source, 'destination', 'keyword');
  assertTypeAt(tokens, source, 'oauth2', 'keyword');
  assertTypeAt(tokens, source, 'scope', 'keyword');
});

test('collectSemanticTokens (M136b, D427): the config vocabulary is a keyword in `config` and nothing at all in `test`', () => {
  // Both directions on the same one-word source, so the *only* variable is the dialect argument.
  // This is the assertion the split exists for: `key`, `web` and `destination` are ordinary
  // identifiers in a .tflw file, and a fix that coloured them everywhere would be worse than the
  // uncoloured config this milestone set out to repair.
  const noSymbols = { defs: [], refs: [] };
  for (const word of CONFIG_ONLY_WORDS) {
    const inConfig = collectSemanticTokens(word, noSymbols, 'config');
    assert.equal(inConfig.length, 1, `"${word}" should produce exactly one token in a config buffer`);
    assert.equal(inConfig[0]!.type, 'keyword', `"${word}" in a config buffer`);

    const inTest = collectSemanticTokens(word, noSymbols, 'test');
    assert.deepEqual(inTest, [], `"${word}" must not be coloured in a .tflw buffer — it is an ordinary identifier there`);
  }
});

test('collectSemanticTokens (M136b, D427): config words used as variables in a .tflw file stay variables', () => {
  // The realistic form of the negative above. `let key = …` is a perfectly ordinary line, and the
  // symbol pass claims these spans before the wordlist pass runs — so the assertion is that they
  // come back `variable`, not that they come back untyped.
  const source = 'test "t"\n  let key = "k"\n  let web = "w"\n  let destination = "d"\n  api GET "/x"\n';
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'key', 'variable');
  assertTypeAt(tokens, source, 'web', 'variable');
  assertTypeAt(tokens, source, 'destination', 'variable');
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

test('collectSemanticTokens (M33/M50): `ramp`/`over`/`threshold`/`cleanup`/`pause` classify as `keyword`', () => {
  const source = `test "checkout burst"\n  ramp to 10 users over 30s\n  threshold p95 duration is less than 800ms\n  cleanup\n  api GET /health\n  pause 1s to 3s\n`;
  const tokens = tokensOf(source);
  assertTypeAt(tokens, source, 'ramp', 'keyword');
  assertTypeAt(tokens, source, 'over', 'keyword');
  assertTypeAt(tokens, source, 'threshold', 'keyword');
  assertTypeAt(tokens, source, 'cleanup', 'keyword');
  assertTypeAt(tokens, source, 'pause', 'keyword');
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

// M142 commit 4 — the boundary `D552` was reversed on. The nine enumerated values of `evidence`,
// `log level` and `log destination` are the residue of the vocabulary walk that nobody had ever
// asked a question about, and the plan decided to colour them by putting them in `CONFIG_KEYWORDS`.
// They cannot be reached that way: every one is written as a STRING, so the lexer hands this pass a
// single `string` token and a set consulted against `ident` tokens never sees the word inside it.
//
// This pins that boundary, so a future "catch-up" that adds them to a wordlist is answered by a test
// rather than by nine entries that silently never fire — and so that teaching this pass to paint
// inside strings has to be a decision somebody takes, not a side effect.
//
// `D552`'s stated reason was an inconsistency that does not exist: it held that `log level "error"`
// lights up while `log level "debug"` stays grey, in the same clause, because `threshold error rate`
// had put `error` in `TYPES`. In that clause NEITHER lights up. `error` is a `type` only in the other
// dialect and a different construction — which the `users`/`rps`/`error`/`rate` test above ALREADY
// asserts, so the other half of this measurement needed no new test and does not get one.
test('M142: the enumerated config VALUES are strings, not keywords, while the keys around them are', () => {
  const source = 'defaults\n  evidence "headers-only"\n  log level "error"\n  log destination "console"\n';
  const { config, diagnostics } = parseConfigSource(source);
  assert.deepEqual(diagnostics.map((d) => d.message), [], 'the fixture config must parse cleanly');
  const tokens = collectSemanticTokens(source, collectConfigSymbols(config, source), 'config');

  // The keys are keywords, and stay so — this half is the control. Without it the assertion below
  // would also pass against a pass that had stopped colouring the config dialect altogether.
  assertTypeAt(tokens, source, 'evidence', 'keyword');
  assertTypeAt(tokens, source, 'level', 'keyword');
  assertTypeAt(tokens, source, 'destination', 'keyword');

  // The values carry no token of their own at all. Asserted by span containment rather than by
  // "no token whose text is `error`", because the point is that the *word* is not addressable here:
  // it is interior to a string the lexer produced in one piece.
  for (const value of ['headers-only', 'error', 'console']) {
    const at = source.indexOf(`"${value}"`) + 1;
    const covering = tokens.filter((t) => t.span.start.offset <= at && t.span.end.offset > at);
    assert.deepEqual(
      covering.map((t) => t.type),
      [],
      `\`${value}\` is inside a string literal and must not be classified — it is a value, not a keyword`,
    );
  }
});
