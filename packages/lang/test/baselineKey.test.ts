// `M208` `S1` (`D1060`) — `baseline "<file>"` in the config dialect.
//
// `M206` `Q6` found security triage sitting outside **both** halves of the strip's rule at once: the
// accepted-findings document (`D387`) is neither the `.tflw` file a tab is about nor `tflw.config`,
// because it was a run flag and nothing else. Asked directly, the language said so —
// `baseline "sec.json"` was `TF020`, *unknown config key*. This is the round that makes it a
// project fact instead, so the SCANS door can show it with the rule untouched.
//
// What is asserted here is the **grammar and the checker's view of it**; the resolver's behaviour is
// graded separately and against itself, in `packages/runtime/test/config-key-arity.test.ts`, which
// doubles the key, resolves both, and decides whether it is single-valued by measuring rather than
// by repeating this file's claim. The path's *existence* is `config-file-references.test.ts`, and
// the flag's precedence over the key is `packages/cli/test/e2e.test.ts` — neither is reachable from
// a parse.
//
// Every test states its negative control (`M92d`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfigSource, Codes, CONFIG_KEYS, type BaselineDecl } from '../src/index.js';
import { only } from './__helpers__/only.js';

// `parseConfigSource` already runs the config checker over what it parsed, so this is the whole
// verdict — lexer, declaration-only parser and `validateConfig`, concatenated. Adding
// `validateConfig` beside it reports every checker diagnostic twice, which is how the first draft
// of this file managed to fail on a fixture that was already correct.
//
// Named `configDiags` and written as a *call*, both of which `verify:observability` needs. That
// gate resolves a harness to the pipeline stages it can observe, and it was reporting all three
// checker assertions below as unfallible for two independent reasons: a bare `const parse =
// parseConfigSource` alias has no call in it to follow, and `parse` is itself an exported name of
// `parser.ts` — the lexer/parser stage only — so the local helper resolved to the global one and
// the check stage disappeared. A test that asserts `TF081` against a harness the tooling believes
// cannot emit it is a test the tooling is right to refuse.
const configDiags = (source: string) => parseConfigSource(source);

const DECLARED = 'defaults\n  baseline "./security-baseline.json"\n\nenv local default\n  api "http://localhost:3001"\n';

test('`baseline "<file>"` parses, and is no longer `TF020`', () => {
  const { config, diagnostics } = configDiags(DECLARED);
  // The negative control is the milestone's own measured starting point: this exact source was
  // `unknown config key \`baseline\`` before the key existed, so an empty diagnostic list here is a
  // change of verdict rather than a fixture that never said anything.
  assert.deepEqual(diagnostics.map((d) => `${d.code}: ${d.message}`), []);
  const entry = only(config.defaults?.entries.filter((e) => e.type === 'BaselineDecl') ?? []) as BaselineDecl;
  assert.equal(entry.path.value, './security-baseline.json');
});

test('it is in `CONFIG_KEYS`, so completion and the did-you-mean hint reach it', () => {
  // `M137a`/`D444`: one list, read by the parser's suggestion, by LSP completion and by the spec
  // manifest. A key dispatched by the `switch` but missing here is a key the editor cannot offer —
  // `A2-07b`'s defect in the other direction.
  assert.ok((CONFIG_KEYS as readonly string[]).includes('baseline'));
  // Control: a word that is not a key stays out of it, so the assertion above is not true of
  // everything.
  assert.ok(!(CONFIG_KEYS as readonly string[]).includes('baselines'));
});

test('a misspelling is `TF020` and the hint points at the real key', () => {
  const diag = only(configDiags('defaults\n  baselin "./x.json"\n').diagnostics);
  assert.equal(diag.code, Codes.CONFIG_UNKNOWN_KEY);
  assert.match(diag.message, /unknown config key `baselin`/);
  assert.match(diag.hint ?? '', /did you mean `baseline`\?/);
  // And it does not claim the key belongs somewhere else, because it belongs in both blocks.
  assert.doesNotMatch(diag.hint ?? '', /it belongs in/);
});

test('it is legal in `defaults` and in an `env` block, and one overrides the other', () => {
  // `TF025` is the placement rule (`DEFAULTS_ONLY`/`ENV_ONLY`). `baseline` is in neither set on
  // purpose: a team that accepts different findings in production than in staging says so with a
  // per-env line, and that is the whole reason the two tiers exist.
  assert.deepEqual(configDiags(DECLARED + '  baseline "./security-baseline.prod.json"\n').diagnostics, []);
  // Control, taken from a key that IS restricted: `workers` in an env is still refused, so the
  // clean verdict above is a property of `baseline` and not of this fixture shape.
  const restricted = only(configDiags('env local default\n  api "http://x"\n  workers 4\n').diagnostics);
  assert.equal(restricted.code, Codes.CONFIG_KEY_CONTEXT);
});

test('a second `baseline` in one block is `TF081`, reported at the second line', () => {
  // One run grades against one document. The checker's classification of the key as single-valued is
  // graded against `resolveConfig` itself in `config-key-arity.test.ts`; what is pinned here is that
  // the rule reaches this key at all, and where it points.
  const diags = configDiags('defaults\n  baseline "./first.json"\n  baseline "./second.json"\n').diagnostics;
  const diag = only(diags.filter((d) => d.code === Codes.CONFIG_DUPLICATE_KEY));
  assert.equal(diag.message, 'duplicate config key `baseline`');
  assert.equal(diag.span.start.line, 3);
  // Control: the same two lines in two different blocks are not a duplicate — that is an override,
  // which is the case the test above says is legal.
  const across = configDiags('defaults\n  baseline "./first.json"\n\nenv local default\n  api "http://x"\n  baseline "./second.json"\n');
  assert.deepEqual(across.diagnostics.filter((d) => d.code === Codes.CONFIG_DUPLICATE_KEY), []);
});

test('`baseline` with no path is refused, and the message says what belongs there', () => {
  const diags = configDiags('defaults\n  baseline\n').diagnostics;
  assert.ok(diags.length > 0, '`baseline` alone must not parse to a declaration with no document');
  assert.match(diags.map((d) => d.message).join('\n'), /baseline "\.\/security-baseline\.json"/);
});
