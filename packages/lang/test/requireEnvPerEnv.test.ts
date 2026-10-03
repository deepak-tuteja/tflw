// `M266` — **a secret one env needs is required by that env** (`D1422`-`D1429`).
//
// `require env` used to be a top-level directive only, so a secret only `staging` sends had to be set
// under every env — the runbook's chapter 10 wrote a placeholder into `.env` for exactly that. An
// `env` block may now carry its own `require env` line, and the two halves of `M156`'s promise have
// to stay whole: every `env(NAME)` is declared *for where it is read* (`TF077`), and every declared
// name is set before the first request (the run-start gate, `packages/runtime`).
//
// What declares a reference depends on its position, never on `--env` (`D1424`/`D1425`): an `env`
// block reads the top level and its own lines; a session or signer scoped `for env` reads the top
// level and the names **every** env in its scope declares; everything else — `defaults`, an unscoped
// session, a test file — reads the top level alone. Each position below has its negative control.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSource,
  parseConfigSource,
  checkProgram,
  checkConfigDeclaredEnvRefs,
  topLevelRequiredEnv,
  requiredEnvByEnv,
  Codes,
  type Diagnostic,
} from '../src/index.js';
import { only } from './__helpers__/only.js';

const STAGING = ['env staging', '  api "https://staging.example.com"', '  require env STAGING_TOKEN'];
const LOCAL = ['env local default', '  api "http://localhost:3000"'];

const config = (...lines: string[]) => {
  const parsed = parseConfigSource(`${lines.join('\n')}\n`);
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  assert.deepEqual(errors.map((d) => `${d.code}: ${d.message}`), [], `fixture did not parse:\n${lines.join('\n')}`);
  return parsed;
};
const tf077 = (diags: readonly Diagnostic[]) => diags.filter((d) => d.code === Codes.UNDECLARED_ENV_REF);

// ---------------------------------------------------------------------------
// The grammar: one production, two positions
// ---------------------------------------------------------------------------

test('`require env` inside an `env` block parses into that block, and the top level keeps its own', () => {
  const { config: c } = config('require env EVERYWHERE', ...STAGING, ...LOCAL);
  assert.deepEqual(topLevelRequiredEnv(c), ['EVERYWHERE']);
  assert.deepEqual(requiredEnvByEnv(c), { staging: ['STAGING_TOKEN'] });
  const staging = c.envs.find((e) => e.name === 'staging')!;
  assert.deepEqual(staging.entries.map((e) => e.type), ['ApiServiceDecl', 'RequireDecl']);
});

test('several lines in one block accumulate, and a block may list several names', () => {
  const { config: c } = config('env staging', '  require env A_TOKEN, B_TOKEN', '  api "https://s.example.com"', '  require env C_TOKEN');
  assert.deepEqual(requiredEnvByEnv(c), { staging: ['A_TOKEN', 'B_TOKEN', 'C_TOKEN'] });
  assert.deepEqual(c.requires, [], 'nothing leaked to the top level');
});

test('in `defaults` it is `TF025`, and the hint names the top level first (`D1423`)', () => {
  const parsed = parseConfigSource(['defaults', '  require env A_TOKEN', ...LOCAL, ''].join('\n'));
  const diag = only(parsed.diagnostics);
  assert.equal(diag.code, Codes.CONFIG_KEY_CONTEXT);
  assert.match(diag.message, /`require env` is not allowed in defaults/);
  assert.match(diag.hint ?? '', /^move it to the top level of the file, where it is required under every env, or into one `env` block/);
});

test('a malformed list inside a block recovers at the next line, and the block keeps parsing', () => {
  const parsed = parseConfigSource(['env staging', '  require env A_TOKEN,', '  api "https://s.example.com"', ''].join('\n'));
  assert.ok(parsed.diagnostics.length > 0, 'the trailing comma is reported');
  const staging = parsed.config.envs[0]!;
  assert.ok(
    staging.entries.some((e) => e.type === 'ApiServiceDecl'),
    `the \`api\` line after the bad list still parsed: ${staging.entries.map((e) => e.type).join(', ')}`,
  );
});

// ---------------------------------------------------------------------------
// `TF077` in the config: what declares a reference depends on where it is written
// ---------------------------------------------------------------------------

test('an env block may read its own declaration — the positive control', () => {
  const parsed = config(...STAGING, '  header "Authorization" is env(STAGING_TOKEN)', ...LOCAL);
  assert.deepEqual(tf077(checkConfigDeclaredEnvRefs(parsed.config)), []);
});

test('another env reading it is `TF077`, naming the env that does require it', () => {
  const parsed = config(...STAGING, ...LOCAL, '  header "Authorization" is env(STAGING_TOKEN)');
  const diag = only(tf077(checkConfigDeclaredEnvRefs(parsed.config)));
  assert.equal(diag.severity, 'error');
  assert.equal(diag.message, '`STAGING_TOKEN` is read here, but only `env staging` requires it');
  assert.match(diag.hint ?? '', /this line is in `env local`\. Add `require env STAGING_TOKEN` to that block, or declare it at the top level/);
});

test('`defaults` applies under every env, so it reads the top level only', () => {
  const parsed = config('defaults', '  header "Authorization" is env(STAGING_TOKEN)', ...STAGING, ...LOCAL);
  const diag = only(tf077(checkConfigDeclaredEnvRefs(parsed.config)));
  assert.match(diag.message, /only `env staging` requires it/);
  assert.match(diag.hint ?? '', /this line applies under every env/);
  // Control: the same read with the name on the top-level line.
  const top = config('require env STAGING_TOKEN', 'defaults', '  header "Authorization" is env(STAGING_TOKEN)', ...LOCAL);
  assert.deepEqual(tf077(checkConfigDeclaredEnvRefs(top.config)), []);
});

const SESSION_BODY = ['  api POST /login body { token: env(STAGING_TOKEN) }', '  expect status equals 200'];

test('a session scoped to the env that requires it may read it', () => {
  const parsed = config(...STAGING, ...LOCAL, '', 'session robot for env staging', ...SESSION_BODY);
  assert.deepEqual(tf077(checkConfigDeclaredEnvRefs(parsed.config)), []);
});

test('an unscoped session runs under every env, so reading a per-env name is `TF077`', () => {
  const parsed = config(...STAGING, ...LOCAL, '', 'session robot', ...SESSION_BODY);
  const diag = only(tf077(checkConfigDeclaredEnvRefs(parsed.config)));
  assert.match(diag.message, /only `env staging` requires it/);
  assert.match(diag.hint ?? '', /scope the session or signer that reads it with `for env staging`/);
});

test('a session scoped to two envs needs the name in both — the intersection, not the union', () => {
  const prod = ['env prod', '  api "https://prod.example.com"'];
  const parsed = config(...STAGING, ...prod, ...LOCAL, '', 'session robot for env staging, prod', ...SESSION_BODY);
  const diag = only(tf077(checkConfigDeclaredEnvRefs(parsed.config)));
  assert.match(diag.hint ?? '', /scoped to `env staging`, `env prod`, and `env prod` does not require it/);
  // Control: declare it in `prod` too and the scope is covered.
  const both = config(...STAGING, ...prod, '  require env STAGING_TOKEN', ...LOCAL, '', 'session robot for env staging, prod', ...SESSION_BODY);
  assert.deepEqual(tf077(checkConfigDeclaredEnvRefs(both.config)), []);
});

test('a name nobody declares keeps the original message — the per-env wording is only for a placement', () => {
  const parsed = config(...LOCAL, '  header "Authorization" is env(NOBODY_TOKEN)');
  const diag = only(tf077(checkConfigDeclaredEnvRefs(parsed.config)));
  assert.equal(diag.message, '`NOBODY_TOKEN` is read here but no `require env` line declares it');
});

test('`--env` cannot change the answer: the config rule reads the file, not a selection', () => {
  // The same file checked twice would need a selected env to differ; the signature has none to take.
  // Stated as a test so a later "pass the active env for a better hint" has to delete this first.
  assert.equal(checkConfigDeclaredEnvRefs.length, 1);
});

// ---------------------------------------------------------------------------
// `TF077` in a test file: the top level only (`D1425`)
// ---------------------------------------------------------------------------

const READS_STAGING = 'test "t"\n  api GET /health\n  expect body.token equals env(STAGING_TOKEN)\n';
const checkTest = (requiredEnv: readonly string[], byEnv?: Record<string, readonly string[]>) =>
  checkProgram(parseSource(READS_STAGING).program, { requiredEnv, ...(byEnv ? { requiredEnvByEnv: byEnv } : {}) });

test('a test reading a name only one env requires is `TF077`, and the hint says why a test cannot', () => {
  const diag = only(tf077(checkTest([], { staging: ['STAGING_TOKEN'] })));
  assert.equal(diag.message, '`STAGING_TOKEN` is read here, but only `env staging` requires it');
  assert.match(diag.hint ?? '', /a test runs under every env/);
  assert.match(diag.hint ?? '', /in a session scoped to it with `for env staging`/);
});

test('the per-env sets only word the hint: they never make a test reference declared', () => {
  // The mutation this pins: checking a test file against `top ∪ byEnv` — the union — instead of the
  // top level. Every name some env declares would then pass, and the other envs' runs would die.
  assert.equal(tf077(checkTest([], { staging: ['STAGING_TOKEN'] })).length, 1);
  assert.deepEqual(tf077(checkTest(['STAGING_TOKEN'], { staging: ['STAGING_TOKEN'] })), [], 'the top level does declare it');
  // Without the sets the message is the original one.
  assert.match(only(tf077(checkTest([]))).message, /no `require env` line declares it/);
});

// ---------------------------------------------------------------------------
// `TF097` — a block repeating a top-level name (`D1429`)
// ---------------------------------------------------------------------------

test('a block repeating a top-level name is `TF097`, a warning, once per name', () => {
  const parsed = parseConfigSource(['require env A_TOKEN, B_TOKEN', 'env local default', '  api "http://localhost:3000"', '  require env A_TOKEN, B_TOKEN, C_TOKEN', ''].join('\n'));
  const diags = parsed.diagnostics.filter((d) => d.code === Codes.REQUIRE_ENV_ALREADY_EVERY_ENV);
  assert.deepEqual(diags.map((d) => d.message), ['`A_TOKEN` is already required under every env', '`B_TOKEN` is already required under every env']);
  assert.ok(diags.every((d) => d.severity === 'warning'));
  assert.match(diags[0]!.hint ?? '', /this line in `env local` adds nothing — remove `A_TOKEN` from it/);
});

test('`TF097` is silent when the block names something the top level does not', () => {
  const parsed = parseConfigSource(['require env A_TOKEN', ...STAGING, ...LOCAL, ''].join('\n'));
  assert.deepEqual(parsed.diagnostics.map((d) => d.code), []);
});
