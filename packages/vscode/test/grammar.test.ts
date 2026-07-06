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
