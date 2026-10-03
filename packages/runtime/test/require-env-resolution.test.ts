// `require env` (SPEC §3.4, `M168`) — **every name a line declares is required, not just the first.**
//
// `resolveConfig` flattens `config.requires` into `ResolvedConfig.requiredEnv`; `cli.ts`'s run-start
// gate refuses on `missingRequiredEnv` over that array, and `tflw check`'s advisory note (`D779`)
// calls the same function verbatim so the two can never disagree about what "missing" means. None of
// that was asserted anywhere until `M168` measured it.
//
// Narrowing the flatten to `r.names.slice(0, 1)` — `require env A, B` requiring only `A` — left all
// 1299 runtime tests green, and every `require env` case in the CLI e2e suite too, because **every
// `require env` line in this repository's tests declares exactly one name**. The multi-name form
// appears in the docs-site guides, the parser fixtures and one session test, and none of the three
// reaches this gate: two are parse-level and the third never runs it unset.
//
// The promise it falsified is published, in those words: §3.4's *"`require env` validates at
// startup; **one** error lists **all** missing vars."* The sibling conformance roster grades it as
// `C95`, whose sharpest leg is a **second name referenced nowhere in the config** being required
// just as hard as the first — which is what makes the directive a precondition on the environment
// rather than a check on use sites, and is exactly the half a first-name-only gate drops.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfigSource } from '@tflw/lang';
import { declaredEnvNames, missingRequiredEnv, requiredBy, resolveConfig, selectEnv } from '../src/resolve.js';

/** Three names on one line, none of them referenced anywhere — `TF077` rules on the converse only
 *  (a reference nothing declares), so a declaration nothing reads is a legal, ordinary config. */
const THREE_ON_ONE_LINE = 'env local default\n  api "http://base.example"\n\nrequire env FIRST_NAME, SECOND_NAME, THIRD_NAME\n';

const resolved = (source: string) => {
  const parsed = parseConfigSource(source);
  assert.deepEqual(
    parsed.diagnostics.map((d) => `${d.code}: ${d.message}`),
    [],
    `fixture did not parse:\n${source}`,
  );
  return resolveConfig(parsed.config, selectEnv(parsed.config, {}));
};

test('every name on a `require env` line reaches `requiredEnv`, in written order', () => {
  assert.deepEqual([...resolved(THREE_ON_ONE_LINE).requiredEnv], ['FIRST_NAME', 'SECOND_NAME', 'THIRD_NAME']);
});

test('several `require env` lines accumulate — a later line does not replace an earlier one', () => {
  const twoLines = 'env local default\n  api "http://base.example"\n\nrequire env A_TOKEN\nrequire env B_TOKEN, C_TOKEN\n';
  assert.deepEqual([...resolved(twoLines).requiredEnv], ['A_TOKEN', 'B_TOKEN', 'C_TOKEN']);
});

test('one `missingRequiredEnv` call lists every unset name, the trailing ones included', () => {
  assert.deepEqual(missingRequiredEnv(resolved(THREE_ON_ONE_LINE), {}), ['FIRST_NAME', 'SECOND_NAME', 'THIRD_NAME']);
});

test('satisfying the first name leaves the run refusable on the rest', () => {
  // The leg that separates "the gate reads the whole declaration" from "the gate reads the line's
  // head": with only `FIRST_NAME` set, a first-name-only gate reports nothing missing and the run
  // proceeds to its transport instead of being refused before one exists.
  assert.deepEqual(missingRequiredEnv(resolved(THREE_ON_ONE_LINE), { FIRST_NAME: 'set' }), ['SECOND_NAME', 'THIRD_NAME']);
});

test('an empty string counts as unset, so a blank `.env` line cannot satisfy a declaration', () => {
  // Asserted here because `cli.ts` states in a comment that the run's refusal and `check`'s note
  // must not be able to disagree about this case, and calls this function from both to guarantee
  // it — a guarantee that was resting on the comment.
  assert.deepEqual(
    missingRequiredEnv(resolved(THREE_ON_ONE_LINE), { FIRST_NAME: 'set', SECOND_NAME: '', THIRD_NAME: 'set' }),
    ['SECOND_NAME'],
  );
});

// ---------------------------------------------------------------------------
// `M266` (`D1422`/`D1426`/`D1427`) — an `env` block's own `require env`
// ---------------------------------------------------------------------------

const PER_ENV = [
  'require env EVERY_TOKEN',
  'env staging',
  '  api "https://staging.example.com"',
  '  require env STAGING_TOKEN, EXTRA_TOKEN',
  'env prod',
  '  api "https://prod.example.com"',
  '  require env PROD_TOKEN',
  'env local default',
  '  api "http://localhost:3000"',
  '',
].join('\n');

const under = (env: string | undefined) => {
  const parsed = parseConfigSource(PER_ENV);
  assert.deepEqual(parsed.diagnostics.map((d) => `${d.code}: ${d.message}`), [], 'fixture is clean');
  return resolveConfig(parsed.config, selectEnv(parsed.config, env === undefined ? {} : { flag: env }));
};

test('the gate requires the top level plus the selected env\'s own lines, and nothing from another env', () => {
  assert.deepEqual([...under('staging').requiredEnv], ['EVERY_TOKEN', 'STAGING_TOKEN', 'EXTRA_TOKEN']);
  assert.deepEqual([...under('prod').requiredEnv], ['EVERY_TOKEN', 'PROD_TOKEN']);
  // The case chapter 10 exists for: `local` declares nothing of its own and needs no staging secret.
  assert.deepEqual([...under(undefined).requiredEnv], ['EVERY_TOKEN']);
  assert.deepEqual(missingRequiredEnv(under(undefined), { EVERY_TOKEN: 'x' }), []);
  assert.deepEqual(missingRequiredEnv(under('staging'), { EVERY_TOKEN: 'x' }), ['STAGING_TOKEN', 'EXTRA_TOKEN']);
});

test('the top-level list and every env\'s own list are resolved under any selection', () => {
  const r = under(undefined);
  assert.deepEqual([...r.requiredEnvEveryEnv], ['EVERY_TOKEN']);
  assert.deepEqual(r.requiredEnvByEnv, { staging: ['STAGING_TOKEN', 'EXTRA_TOKEN'], prod: ['PROD_TOKEN'] });
  assert.deepEqual(under('staging').requiredEnvByEnv, r.requiredEnvByEnv, 'the same whichever env is selected');
});

test('a name declared both at the top level and in the block is required once', () => {
  const parsed = parseConfigSource('require env A_TOKEN\nenv local default\n  api "http://localhost:3000"\n  require env A_TOKEN, B_TOKEN\n');
  const r = resolveConfig(parsed.config, selectEnv(parsed.config, {}));
  assert.deepEqual([...r.requiredEnv], ['A_TOKEN', 'B_TOKEN']);
});

test('the redactor\'s set is every name any env declares (`D1427`); the gate\'s is not', () => {
  const r = under(undefined);
  assert.deepEqual(declaredEnvNames(r).sort(), ['EVERY_TOKEN', 'EXTRA_TOKEN', 'PROD_TOKEN', 'STAGING_TOKEN']);
  assert.deepEqual([...r.requiredEnv], ['EVERY_TOKEN'], 'control: the gate under the same selection is narrower');
});

test('the startup refusal names the env for a name only that env requires (`D1426`)', () => {
  const r = under('staging');
  assert.equal(requiredBy(r, 'STAGING_TOKEN'), ' (required by env staging)');
  assert.equal(requiredBy(r, 'EVERY_TOKEN'), '', 'a top-level name is required everywhere and says nothing extra');
});
