// Tokenizes a representative .tflw snippet with the real TextMate engine VS Code itself uses
// (vscode-textmate + vscode-oniguruma), so a broken grammar (bad regex, wrong scope name, a rule
// that never matches) fails a test instead of only being noticed by eyeballing a colored screenshot
// (decision 76 — highlight-only, no checker integration).

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IGrammar, IOnigLib } from 'vscode-textmate';

// Both packages' ESM entry points don't re-export their named exports correctly (only `default` +
// a namespace object) — load them via CJS `require`, which exposes the real named exports, same as
// VS Code's own extension host does under the hood.
const require = createRequire(import.meta.url);
const { Registry, parseRawGrammar, INITIAL } = require('vscode-textmate') as typeof import('vscode-textmate');
const { loadWASM, OnigScanner, OnigString } = require('vscode-oniguruma') as typeof import('vscode-oniguruma');

const here = dirname(fileURLToPath(import.meta.url));
const grammarPath = join(here, '..', 'syntaxes', 'tflw.tmLanguage.json');

async function createOnigLib(): Promise<IOnigLib> {
  const wasmPath = join(dirname(require.resolve('vscode-oniguruma/package.json')), 'release', 'onig.wasm');
  await loadWASM(readFileSync(wasmPath).buffer);
  return {
    createOnigScanner: (patterns: string[]) => new OnigScanner(patterns),
    createOnigString: (s: string) => new OnigString(s),
  };
}

let grammar: IGrammar;

before(async () => {
  const registry = new Registry({
    onigLib: createOnigLib(),
    loadGrammar: async (scopeName) => {
      if (scopeName !== 'source.tflw') return null;
      return parseRawGrammar(readFileSync(grammarPath, 'utf8'), grammarPath);
    },
  });
  const loaded = await registry.loadGrammar('source.tflw');
  if (!loaded) throw new Error('failed to load source.tflw grammar');
  grammar = loaded;
});

interface Token {
  readonly text: string;
  readonly scopes: readonly string[];
}

function tokenizeLines(lines: readonly string[]): Token[][] {
  let ruleStack = INITIAL;
  return lines.map((line) => {
    const result = grammar.tokenizeLine(line, ruleStack);
    ruleStack = result.ruleStack;
    return result.tokens.map((t) => ({ text: line.slice(t.startIndex, t.endIndex), scopes: t.scopes }));
  });
}

/** First token on any line whose text (trimmed) exactly equals `text`. */
function findToken(tokensByLine: readonly Token[][], text: string): Token {
  for (const lineTokens of tokensByLine) {
    const found = lineTokens.find((t) => t.text.trim() === text);
    if (found) return found;
  }
  throw new Error(`token "${text}" not found in tokenized output`);
}

function hasScope(token: Token, scope: string): boolean {
  return token.scopes.includes(scope);
}

test('tokenizes a representative .tflw snippet with the expected scopes', () => {
  const lines = tokenizeLines([
    '# a comment',
    '@smoke',
    'test "health check"',
    '  api GET /health',
    '  expect status equals 200',
    '  capture body.token as token',
    '  header "Authorization" is "Bearer {token}"',
    '  expect body matches subset { title: "Not Found" }',
  ]);

  assert.ok(lines[0]!.some((t) => hasScope(t, 'comment.line.number-sign.tflw')), 'a `#` line should be a comment');
  assert.ok(hasScope(findToken(lines, '@smoke'), 'entity.name.tag.tflw'), '@tags should be highlighted as tags');
  assert.ok(hasScope(findToken(lines, 'test'), 'keyword.control.tflw'), '`test` is a statement keyword');
  assert.ok(lines[2]!.some((t) => t.text === 'health check' && hasScope(t, 'string.quoted.double.tflw')), 'a quoted string should be highlighted');
  assert.ok(hasScope(findToken(lines, 'GET'), 'keyword.control.http-method.tflw'), 'GET should be an HTTP method keyword');
  assert.ok(hasScope(findToken(lines, '/health'), 'string.unquoted.path.tflw'), 'a path right after the method should be highlighted as a path');
  assert.ok(hasScope(findToken(lines, 'expect'), 'keyword.control.tflw'));
  assert.ok(hasScope(findToken(lines, 'status'), 'support.type.tflw'), '`status` is a subject keyword');
  assert.ok(hasScope(findToken(lines, 'equals'), 'keyword.operator.word.tflw'), '`equals` is a matcher keyword');
  assert.ok(hasScope(findToken(lines, '200'), 'constant.numeric.tflw'));
  assert.ok(hasScope(findToken(lines, 'capture'), 'keyword.control.tflw'));
  assert.ok(hasScope(findToken(lines, 'is'), 'keyword.operator.word.tflw'), '`is` is a matcher keyword');
  assert.ok(lines[6]!.some((t) => t.text === '{token}' && hasScope(t, 'variable.interpolation.tflw')), 'a `{ref}` interpolation inside a string should be highlighted distinctly');
  assert.ok(hasScope(findToken(lines, 'subset'), 'keyword.operator.word.tflw'), '`subset` is a matcher keyword (matches subset {...})');
});

test('tokenizes base64/hex/url transform keywords (decision 22/M18) as generator-family highlighting', () => {
  const lines = tokenizeLines(['  let creds = base64 encode("{email}:{pw}")']);

  assert.ok(hasScope(findToken(lines, 'base64'), 'support.function.generator.tflw'), '`base64` should share the generator/transform highlight class');
  assert.ok(hasScope(findToken(lines, 'encode'), 'support.function.generator.tflw'), '`encode` should share the generator/transform highlight class');
});

// M28 (PLAN_LOG_LSP.md): `log` (M27) had never caught this independent-copy grammar keyword list up.
test('tokenizes `log` (M27/M28) as a statement keyword', () => {
  const lines = tokenizeLines(['  log warn "order {id} created" to console']);
  assert.ok(hasScope(findToken(lines, 'log'), 'keyword.control.tflw'), '`log` is a statement keyword');
});

test('tokenizes `upload … type "…"` — `upload`/`as`/`type` all get statement-keyword highlighting (decision 22/M19)', () => {
  const lines = tokenizeLines(['  api POST /uploads upload "./img.png" as "avatar" type "image/png"']);

  assert.ok(hasScope(findToken(lines, 'upload'), 'keyword.control.tflw'), '`upload` is a statement keyword');
  assert.ok(hasScope(findToken(lines, 'as'), 'keyword.control.tflw'), '`as` is a statement keyword');
  assert.ok(hasScope(findToken(lines, 'type'), 'keyword.control.tflw'), '`type` should get the same statement-keyword highlight class as `upload`/`as`/`form`');
});

test('tokenizes browser-arc step/locator/subject keywords (M3a-M3c, M4a catch-up)', () => {
  const lines = tokenizeLines([
    '  open "/checkout"',
    '  click button "Pay"',
    '  fill field "Email" with "a@b.c"',
    '  within css "#cart"',
    '    hover text "Menu"',
    '  press "Enter" on field "Search"',
    '  stub GET "/api/x" respond status 200',
  ]);

  assert.ok(hasScope(findToken(lines, 'open'), 'keyword.control.tflw'), '`open` is a statement keyword');
  assert.ok(hasScope(findToken(lines, 'click'), 'keyword.control.tflw'), '`click` is a statement keyword');
  assert.ok(hasScope(findToken(lines, 'button'), 'support.type.tflw'), '`button` is a locator-noun subject keyword');
  assert.ok(hasScope(findToken(lines, 'fill'), 'keyword.control.tflw'));
  assert.ok(hasScope(findToken(lines, 'field'), 'support.type.tflw'), '`field` is a locator-noun subject keyword');
  assert.ok(hasScope(findToken(lines, 'within'), 'keyword.control.tflw'));
  assert.ok(hasScope(findToken(lines, 'css'), 'support.type.tflw'), '`css` is a locator-noun subject keyword');
  assert.ok(hasScope(findToken(lines, 'hover'), 'keyword.control.tflw'));
  assert.ok(hasScope(findToken(lines, 'on'), 'keyword.control.tflw'), '`on` (press … on field …) is a statement keyword');
  assert.ok(hasScope(findToken(lines, 'stub'), 'keyword.control.tflw'));
  assert.ok(hasScope(findToken(lines, 'respond'), 'keyword.control.tflw'));
});

test('tokenizes `page` + `has no [<severity>] a11y violations` (M3e, M4a catch-up)', () => {
  const lines = tokenizeLines(['  expect page has no critical a11y violations']);

  assert.ok(hasScope(findToken(lines, 'page'), 'support.type.tflw'), '`page` is a subject keyword');
  assert.ok(hasScope(findToken(lines, 'has'), 'keyword.operator.word.tflw'));
  assert.ok(hasScope(findToken(lines, 'no'), 'keyword.operator.word.tflw'));
  assert.ok(hasScope(findToken(lines, 'critical'), 'keyword.operator.word.tflw'), '`critical` is a severity-floor matcher word');
  assert.ok(hasScope(findToken(lines, 'a11y'), 'keyword.operator.word.tflw'));
  assert.ok(hasScope(findToken(lines, 'violations'), 'keyword.operator.word.tflw'));
});

// M133 (D24b catch-up), verified against the real TextMate tokenizer like every other case here.
test('tokenizes `has no [<severity>] security violations` (M128b) and `… authorization violations` (M130b, M133 catch-up)', () => {
  const secLines = tokenizeLines(['  expect response has no serious security violations']);
  assert.ok(hasScope(findToken(secLines, 'response'), 'support.type.tflw'), '`response` is the scan subject');
  assert.ok(hasScope(findToken(secLines, 'serious'), 'keyword.operator.word.tflw'));
  assert.ok(hasScope(findToken(secLines, 'security'), 'keyword.operator.word.tflw'));

  const authzLines = tokenizeLines(['  expect response has no critical authorization violations']);
  assert.ok(hasScope(findToken(authzLines, 'authorization'), 'keyword.operator.word.tflw'), 'the arc shipped `security` here and not `authorization`');
  assert.ok(hasScope(findToken(authzLines, 'violations'), 'keyword.operator.word.tflw'));
});

test('tokenizes the pentest arc config declarations: `authorized target … reason …`, `probe mutating`, `session … privileged` (M133 catch-up)', () => {
  const lines = tokenizeLines([
    'defaults',
    '  authorized target "http://localhost:4001" reason "authorized probe target"',
    '    probe mutating',
    'session admin privileged',
  ]);

  assert.ok(hasScope(findToken(lines, 'authorized'), 'keyword.control.tflw'));
  assert.ok(hasScope(findToken(lines, 'target'), 'keyword.control.tflw'));
  assert.ok(hasScope(findToken(lines, 'reason'), 'keyword.control.tflw'));
  assert.ok(hasScope(findToken(lines, 'probe'), 'keyword.control.tflw'));
  assert.ok(hasScope(findToken(lines, 'mutating'), 'keyword.control.tflw'));
  assert.ok(hasScope(findToken(lines, 'privileged'), 'keyword.control.tflw'));
  // The reason sentence stays a string even when it is made entirely of the words just added to
  // the wordlist — `\b`-anchored keyword patterns must not reach inside a quoted literal. Written
  // as `some(...)` rather than `findToken`, which throws on a miss and so cannot express absence.
  assert.ok(
    lines[1]!.some((t) => t.text === 'authorized probe target' && hasScope(t, 'string.quoted.double.tflw')),
    'the reason sentence is one string token, not three keywords',
  );
});

test('tokenizes `request to "…" was made` (M3d, M4a catch-up)', () => {
  const lines = tokenizeLines(['  expect request to "/orders" was made']);

  assert.ok(hasScope(findToken(lines, 'was'), 'keyword.operator.word.tflw'));
  assert.ok(hasScope(findToken(lines, 'made'), 'keyword.operator.word.tflw'));
});

test('tokenizes `matches snapshot "<name>" mask <locator>` (M4b)', () => {
  const lines = tokenizeLines(['  expect page matches snapshot "checkout-page" mask css ".timestamp"']);

  assert.ok(hasScope(findToken(lines, 'matches'), 'keyword.operator.word.tflw'));
  assert.ok(hasScope(findToken(lines, 'snapshot'), 'keyword.operator.word.tflw'), '`snapshot` is a matcher sub-word');
  assert.ok(lines[0]!.some((t) => t.text === 'checkout-page' && hasScope(t, 'string.quoted.double.tflw')));
  assert.ok(hasScope(findToken(lines, 'mask'), 'keyword.control.tflw'), '`mask` is a statement keyword');
  assert.ok(hasScope(findToken(lines, 'css'), 'support.type.tflw'), '`css` is a locator-noun subject keyword');
});

// M33 (perf-arc LSP/VS Code catch-up, D24b): the M29-M32 load-testing grammar (`ramp`/`threshold`/
// `cleanup`/`pause`) had zero keyword coverage in this grammar before this milestone — a
// load-testing file rendered visually flat next to an ordinary `test`/browser file. M50 (D93)
// later removed the standalone `scenario` keyword this originally covered — a `test` is a load
// test whenever it contains a `ramp to …` line.

test('tokenizes `ramp to … users|rps over …`/`cleanup`/`pause` (M29-M32, M33 catch-up, M50)', () => {
  const lines = tokenizeLines([
    'test "checkout burst"',
    '  ramp to 10 users over 30s',
    '  cleanup',
    '  api GET /health',
    '  pause 1s to 3s',
  ]);

  assert.ok(hasScope(findToken(lines, 'ramp'), 'keyword.control.tflw'), '`ramp` is a statement keyword');
  assert.ok(hasScope(findToken(lines, 'over'), 'keyword.control.tflw'), '`over` is a statement keyword');
  assert.ok(hasScope(findToken(lines, 'users'), 'support.type.tflw'), '`users` is a workload-target subject keyword');
  assert.ok(hasScope(findToken(lines, 'cleanup'), 'keyword.control.tflw'), '`cleanup` is a statement keyword');
  assert.ok(hasScope(findToken(lines, 'pause'), 'keyword.control.tflw'), '`pause` is a statement keyword');

  const rpsLines = tokenizeLines(['  ramp to 100 rps over 30s']);
  assert.ok(hasScope(findToken(rpsLines, 'rps'), 'support.type.tflw'), '`rps` is a workload-target subject keyword');
});

test('tokenizes `threshold p95 duration is less than 800ms` / `threshold error rate is less than 1%` (M29/D24a, M33 catch-up)', () => {
  const lines = tokenizeLines(['  threshold p95 duration is less than 800ms', '  threshold error rate is less than 1%']);

  assert.ok(hasScope(findToken(lines, 'threshold'), 'keyword.control.tflw'), '`threshold` is a statement keyword');
  assert.ok(hasScope(findToken(lines, 'p95'), 'support.type.tflw'), '`p95` is a percentile metric selector');
  assert.ok(hasScope(findToken(lines, 'duration'), 'support.type.tflw'), '`duration` is a subject keyword');
  assert.ok(hasScope(findToken(lines, 'less'), 'keyword.operator.word.tflw'));
  assert.ok(hasScope(findToken(lines, 'than'), 'keyword.operator.word.tflw'));
  assert.ok(hasScope(findToken(lines, 'error'), 'support.type.tflw'), '`error` (error rate) is a subject keyword');
  assert.ok(hasScope(findToken(lines, 'rate'), 'support.type.tflw'), '`rate` (error rate) is a subject keyword');
});

test('tokenizes `test "…" retry N parallel`/`sequential` header modifiers (Phase 2b, D105-D107)', () => {
  const lines = tokenizeLines(['test "checkout burst" retry 2 parallel', 'test "browsing" sequential']);
  assert.ok(hasScope(findToken(lines, 'retry'), 'keyword.control.tflw'), '`retry` is a statement keyword');
  assert.ok(hasScope(findToken(lines, 'parallel'), 'keyword.control.tflw'), '`parallel` is a statement keyword');
  assert.ok(hasScope(findToken(lines, 'sequential'), 'keyword.control.tflw'), '`sequential` is a statement keyword');
});

test('tokenizes every p50/p90/p95/p99 percentile form, but leaves a similarly-shaped ordinary identifier alone (M33)', () => {
  const lines = tokenizeLines(['  threshold p50 duration is less than 200ms', '  threshold p90 duration is less than 500ms', '  threshold p99 duration is less than 1500ms']);
  assert.ok(hasScope(findToken(lines, 'p50'), 'support.type.tflw'));
  assert.ok(hasScope(findToken(lines, 'p90'), 'support.type.tflw'));
  assert.ok(hasScope(findToken(lines, 'p99'), 'support.type.tflw'));

  // A user variable that merely starts with `p` and digits, but isn't a real 1-2-digit percentile
  // shape, must not be swept up by the percentile regex.
  const varLines = tokenizeLines(['  let p100x = 1']);
  const varToken = varLines[0]!.find((t) => t.text.trim() === 'p100x');
  assert.ok(varToken, 'expected a token for the `p100x` identifier');
  assert.equal(hasScope(varToken!, 'support.type.tflw'), false, '`p100x` is not a valid percentile shape and should not be tagged as one');
});

test('tokenizes tflw.config keywords (env/defaults/require/session) and env(NAME) calls', () => {
  const lines = tokenizeLines(['env local default', '  api "http://localhost:3001"', '', 'require env ADMIN_TOKEN', '', 'session admin', '  header "Authorization" is env(ADMIN_TOKEN)']);

  assert.ok(hasScope(findToken(lines, 'env'), 'keyword.control.tflw'));
  assert.ok(hasScope(findToken(lines, 'default'), 'keyword.control.tflw'));
  assert.ok(hasScope(findToken(lines, 'require'), 'keyword.control.tflw'));
  assert.ok(hasScope(findToken(lines, 'session'), 'keyword.control.tflw'));
  const envCallLine = lines[6]!;
  const envCallToken = envCallLine.find((t) => t.text === 'env' && hasScope(t, 'support.function.env.tflw'));
  assert.ok(envCallToken, '`env(...)` should be highlighted as a function call, distinct from the `env <name>` block keyword');
});
