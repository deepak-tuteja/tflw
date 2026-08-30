// `M165a`/`D830` — **the exemption list behind `TF081`, graded against what `resolveConfig` does.**
//
// `TF081` says a second declaration of a key discards the first. Four keys are exempt because they
// accumulate instead, and getting that set wrong is the whole risk of the rule: a key wrongly called
// single-valued makes `tflw check` refuse a legitimate config, and one wrongly called accumulating
// leaves the silence the code exists to remove.
//
// Both errors have happened, and neither was caught by reading. `TeardownDecl` arrived in `M157` and
// joined `resolve.ts`'s `switch` without appearing in any list of single-valued keys. `AllowHostsDecl`
// accumulates by **spread-assignment** rather than `.push`, so it reads as an assignment at a glance,
// and this rule's own draft classified it as an override. A hand-written table of an implementation's
// cases is a cache, and nothing in this repository invalidated it.
//
// **So nothing here is written down twice.** There is no expected-arity column. For each of the
// seventeen members of `ConfigEntry`, this doubles the key in one block, resolves it, and resolves a
// second config carrying only the *later* of the two lines. If the two resolve identically the first
// declaration was discarded — that is the measurement, not a claim about it — and the test then
// asserts `validateConfig` reports `TF081` for exactly the keys where that happened. The checker's
// classification is compared against the resolver's behaviour with no third copy in between, so a
// key that changes sides in `resolve.ts` turns this red from either direction.
//
// The case table is a `Record<ConfigEntry['type'], …>`, so a new config key cannot be added to the
// language without failing to typecheck here — the compile-time half of the same decision.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfigSource, validateConfig, Codes, type ConfigEntry } from '@tflw/lang';
import { resolveConfig, selectEnv } from '../src/resolve.js';

/** One doubled declaration: the two lines, the block they are legal in, and anything the resolver
 *  demands alongside them (`cert` and `key` must be set together, so each names the other). */
interface Doubling {
  readonly first: string;
  readonly second: string;
  readonly block: 'defaults' | 'env';
  readonly support?: readonly string[];
}

const DOUBLINGS: Record<ConfigEntry['type'], Doubling> = {
  ApiServiceDecl: { block: 'env', first: 'api "http://first.example"', second: 'api "http://second.example"' },
  WebDecl: { block: 'env', first: 'web "http://first.example"', second: 'web "http://second.example"' },
  TimeoutDecl: { block: 'env', first: 'timeout step 10s', second: 'timeout step 30s' },
  WorkersDecl: { block: 'defaults', first: 'workers 2', second: 'workers 4' },
  ReportDecl: { block: 'defaults', first: 'report "./first"', second: 'report "./second"' },
  InsecureDecl: { block: 'env', first: 'insecure true', second: 'insecure false' },
  CertDecl: { block: 'env', first: 'cert "./first.pem"', second: 'cert "./second.pem"', support: ['key "./client.key"'] },
  KeyDecl: { block: 'env', first: 'key "./first.key"', second: 'key "./second.key"', support: ['cert "./client.pem"'] },
  EvidenceDecl: { block: 'env', first: 'evidence full', second: 'evidence none' },
  TeardownDecl: { block: 'env', first: 'teardown always', second: 'teardown never' },
  ViewportDecl: { block: 'defaults', first: 'viewport 1280 720', second: 'viewport 800 600' },
  LogDestinationDecl: { block: 'env', first: 'log destination console', second: 'log destination html' },
  LogLevelDecl: { block: 'env', first: 'log level debug', second: 'log level warn' },
  HeaderDecl: { block: 'env', first: 'header "X-First" is "1"', second: 'header "X-Second" is "2"' },
  AllowHostsDecl: { block: 'env', first: 'allow hosts "first.example"', second: 'allow hosts "second.example"' },
  AuthorizedTargetDecl: {
    block: 'env',
    first: 'authorized target "https://first.example" reason "self-hosted fixture"',
    second: 'authorized target "https://second.example" reason "self-hosted fixture"',
  },
  RedactDecl: { block: 'env', first: 'redact header "X-First"', second: 'redact header "X-Second"' },
};

const configSource = (d: Doubling, lines: readonly string[]): string => {
  const body = [...(d.support ?? []), ...lines].map((l) => `  ${l}`);
  return d.block === 'defaults'
    ? ['defaults', ...body, 'env local default', '  api "http://base.example"', ''].join('\n')
    : ['env local default', ...body, ''].join('\n');
};

// `TF081` is the diagnostic under test and `parseConfigSource` already runs the checker, so it is
// the one code a fixture here is allowed to carry. Everything else is a broken fixture and says so.
const parse = (source: string) => {
  const parsed = parseConfigSource(source);
  const unexpected = parsed.diagnostics.filter((x) => x.code !== Codes.CONFIG_DUPLICATE_KEY);
  assert.deepEqual(unexpected.map((x) => `${x.code}: ${x.message}`), [], `fixture did not parse:\n${source}`);
  return parsed.config;
};

const resolved = (source: string) => {
  const config = parse(source);
  return resolveConfig(config, selectEnv(config, {}));
};

for (const [kind, doubling] of Object.entries(DOUBLINGS) as [ConfigEntry['type'], Doubling][]) {
  test(`${kind}: the checker's verdict matches what resolveConfig does with the key twice`, () => {
    const doubled = configSource(doubling, [doubling.first, doubling.second]);
    const laterOnly = configSource(doubling, [doubling.second]);

    // The measurement. Identical resolutions mean the earlier line reached nothing.
    let discardsTheFirst: boolean;
    try {
      assert.deepEqual(resolved(doubled), resolved(laterOnly));
      discardsTheFirst = true;
    } catch {
      discardsTheFirst = false;
    }

    const fired = validateConfig(parse(doubled)).filter((d) => d.code === Codes.CONFIG_DUPLICATE_KEY);
    assert.equal(
      fired.length > 0,
      discardsTheFirst,
      discardsTheFirst
        ? `${kind} silently discards its first declaration and no TF081 was reported — it is missing from the checker's single-valued set`
        : `${kind} accumulates, so both declarations survive, and TF081 was reported anyway — it is exempt in resolve.ts and not in the checker`,
    );
  });
}

// The negative control the seventeen cannot give: every one of them asserts an *agreement* between
// two things, and a check that never fires agrees with a resolver that never discards. This pins
// that both outcomes are actually reachable in the table above — without it, a `TF081` deleted
// outright would leave four passing cases and thirteen red ones, but a `TF081` that fired on
// nothing at all in a table of four accumulating keys would be indistinguishable from correct.
test('the table exercises both verdicts, so neither outcome is vacuous', () => {
  const verdicts = Object.values(DOUBLINGS).map((d) => {
    const doubled = configSource(d, [d.first, d.second]);
    return validateConfig(parse(doubled)).some((x) => x.code === Codes.CONFIG_DUPLICATE_KEY);
  });
  assert.equal(verdicts.filter(Boolean).length, 13, 'expected thirteen single-valued keys');
  assert.equal(verdicts.filter((v) => !v).length, 4, 'expected four accumulating keys');
});

// `D832` from the resolver's side. The rule is per block because a `defaults` value overridden in an
// `env` is the reason both blocks exist — and that is a claim about `resolveConfig`, so it is
// measured here rather than asserted in the checker's own tests: `applyEntries` runs over `defaults`
// and then over the env, so the env's value wins by the *same* last-one-assigns mechanism `TF081`
// reports inside a single block. The two cases are one line apart in `resolve.ts` and opposite in
// the rule, which is exactly why this pair is written down.
test('a key set in `defaults` and again in an `env` is silent, and the env wins', () => {
  const source = 'defaults\n  timeout step 5s\n\nenv ci default\n  api "http://base.example"\n  timeout step 9s\n';
  assert.deepEqual(
    parseConfigSource(source).diagnostics.filter((d) => d.code === Codes.CONFIG_DUPLICATE_KEY),
    [],
  );
  assert.equal(resolved(source).timeouts.step, 9000);
});
