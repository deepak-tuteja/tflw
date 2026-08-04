// `TF036` — an env whose own base URL its own `allow hosts` list can never match (M85, review
// cluster C1 / `A4-10`). Both halves of the contradiction are literals in one file, so `tflw check`
// can see it; before M85 it said "no problems found" and the run then produced one identical
// refusal per step, forever, for one wrong config line.
//
// The pass is deliberately narrow — being wrong here means refusing a config that works — so most
// of what these tests pin is what it must NOT flag: an interpolated base URL, a list that lives in
// `defaults`, a wildcard, a config with no list at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfigSource, checkAllowHostsCoversBaseUrls, hostMatchesAllowPattern } from '../src/index.js';

/** Runs the check the way its callers do — against **one** env, the active one. Defaults to the
 * env marked `default`, which is what `selectEnv` falls back to with no `--env`/`TFLW_ENV`; the
 * scoping tests below pass a name explicitly, standing in for the flag. */
function allowHostsDiags(source: string, envName?: string) {
  const { config, diagnostics } = parseConfigSource(source);
  assert.deepEqual(diagnostics, [], `unexpected parse/validateConfig diagnostics: ${JSON.stringify(diagnostics)}`);
  const env = envName ? config.envs.find((e) => e.name === envName) : config.envs.find((e) => e.isDefault);
  assert.ok(env, `no env ${envName ?? '(default)'} in this fixture`);
  return checkAllowHostsCoversBaseUrls(config, env);
}

test('an `api` base URL outside the env\'s own `allow hosts` is TF036', () => {
  const diags = allowHostsDiags(`env local default\n  api "http://127.0.0.1:9099"\n  allow hosts "example.com"\n`);

  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.severity, 'error');
  assert.match(diags[0]!.message, /env `local`'s `api` base URL is "http:\/\/127\.0\.0\.1:9099"/);
  assert.match(diags[0]!.message, /host "127\.0\.0\.1" is not in its own `allow hosts` \(example\.com\)/);
  // Which of the two lines is wrong is the author's call, so the hint names both ways out rather
  // than recommending one (C7/M84 — a suggestion is a promise about what the tool will accept).
  assert.match(diags[0]!.hint ?? '', /add "127\.0\.0\.1" to `allow hosts`/);
  assert.match(diags[0]!.hint ?? '', /point `api` at a host that is already on the list/);
});

test('the diagnostic points at the base URL, the line the author can act on', () => {
  const diags = allowHostsDiags(`env local default\n  api "http://127.0.0.1:9099"\n  allow hosts "example.com"\n`);

  assert.equal(diags[0]!.span.start.line, 2);
});

test('a `web` base URL is checked too — the browser half is on the list as of M85', () => {
  const diags = allowHostsDiags(`env local default\n  api "https://example.com"\n  web "http://localhost:5173"\n  allow hosts "example.com"\n`);

  assert.equal(diags.length, 1);
  assert.match(diags[0]!.message, /`web` base URL/);
  assert.match(diags[0]!.message, /host "localhost"/);
});

test('a named service quotes its own key back (`api billing`), not a bare `api`', () => {
  const diags = allowHostsDiags(`env local default\n  api "https://example.com"\n  api billing "https://billing.other.test"\n  allow hosts "example.com"\n`);

  assert.equal(diags.length, 1);
  assert.match(diags[0]!.message, /`api billing` base URL/);
  assert.match(diags[0]!.hint ?? '', /point `api billing` at a host/);
});

test('the hint states the consequence that key actually has, not the widest one', () => {
  // Only the default `api` base takes the whole suite down. A named service takes its own calls
  // and leaves the rest running; `web` takes the browser half. One shared "every request in this
  // env" sentence would be a diagnostic claiming more than it knows — C7's failure mode, on the
  // one line the author is being asked to act on.
  const source = `env local default\n  api "https://a.test"\n  api billing "https://b.test"\n  web "https://c.test"\n  allow hosts "example.com"\n`;
  const byKey = new Map(allowHostsDiags(source).map((d) => [/`(api(?: \w+)?|web)` base URL/.exec(d.message)![1]!, d.hint ?? '']));

  assert.match(byKey.get('api')!, /every request against this env would be refused before it is sent/);
  assert.match(byKey.get('api billing')!, /every `api billing` request would be refused before it is sent/);
  assert.match(byKey.get('web')!, /every browser step in this env would be refused before it navigates/);
});

test('every offending base URL in one env is reported, not just the first', () => {
  const diags = allowHostsDiags(`env local default\n  api "https://a.test"\n  api billing "https://b.test"\n  web "https://c.test"\n  allow hosts "example.com"\n`);

  assert.equal(diags.length, 3);
});

// ---- what it must not flag -------------------------------------------------

test('a list declared in `defaults` covers the env — the arrangement SPEC §3.7 recommends', () => {
  // Checking an env against only its own block would flag this, which is every config that keeps a
  // baseline list in `defaults` and extends it per env.
  assert.deepEqual(allowHostsDiags(`defaults\n  allow hosts "api.example.com"\n\nenv local default\n  api "https://api.example.com"\n  allow hosts "billing.test"\n`), []);
});

test('the env\'s own list extends the baseline rather than replacing it', () => {
  // The mirror of the test above: the base URL is covered by the *env's* line while `defaults`
  // carries an unrelated one. Both directions have to hold for "accumulates" to mean anything.
  assert.deepEqual(allowHostsDiags(`defaults\n  allow hosts "unrelated.test"\n\nenv local default\n  api "https://api.example.com"\n  allow hosts "api.example.com"\n`), []);
});

test('an exact pattern does not cover a subdomain — the SPEC §3.7 rule, from the checker side', () => {
  // `example.com` matches `example.com` and nothing else; covering `api.example.com` takes
  // `*.example.com`. Pinned here because getting it backwards would make the pass reject configs
  // that run fine, which is the one failure mode worse than the finding it closes.
  const diags = allowHostsDiags(`env local default\n  api "https://api.example.com"\n  allow hosts "example.com"\n`);

  assert.equal(diags.length, 1);
  assert.match(diags[0]!.message, /host "api\.example\.com"/);
});

test('a `*.` pattern covering the base URL is accepted, matching the runtime matcher', () => {
  assert.deepEqual(allowHostsDiags(`env local default\n  api "https://api.example.com"\n  allow hosts "*.example.com"\n`), []);
});

test('an interpolated base URL is not decidable here and is left to the runtime', () => {
  // `api "https://{API_HOST}/v1"` — what its hostname will be is exactly what this pass cannot
  // know. Skipped rather than guessed at, the same conservatism `TF030` states for variables.
  assert.deepEqual(allowHostsDiags(`env local default\n  api "https://{API_HOST}/v1"\n  allow hosts "example.com"\n`), []);
});

test('no `allow hosts` anywhere means no enforcement — nothing to contradict', () => {
  assert.deepEqual(allowHostsDiags(`env local default\n  api "http://127.0.0.1:9099"\n`), []);
});

test('one env\'s list does not constrain another env\'s base URL', () => {
  // `allow hosts` is per-env (accumulated with `defaults`); a staging list saying nothing about
  // local is not a contradiction in local.
  assert.deepEqual(
    allowHostsDiags(`env local default\n  api "http://127.0.0.1:9099"\n\nenv staging\n  api "https://stg.example.com"\n  allow hosts "stg.example.com"\n`),
    [],
  );
});

// ---- env scope (the cross-repo gate's finding) -----------------------------

test('an unselected env\'s contradiction does not fail the env you are running', () => {
  // The shape that made checking every env wrong. `testFlow-tests` declares exactly this: a
  // dedicated env whose allowlist deliberately excludes its own base URL, as the negative-case
  // fixture proving a real reachable host is refused. Checking every env meant that one
  // intentional block reddened `tflw check` for its whole suite whichever env you had selected.
  const source = `env local default\n  api "http://127.0.0.1:9099"\n  allow hosts "127.0.0.1"\n\nenv blocked\n  api "http://127.0.0.1:9099"\n  allow hosts "example.com"\n`;

  assert.deepEqual(allowHostsDiags(source), []);
});

test('…and selecting that env is exactly when it fires', () => {
  // The other half, and the reason this is a scope and not an exemption: the contradiction is
  // still reported, at the moment it would actually cost a run.
  const source = `env local default\n  api "http://127.0.0.1:9099"\n  allow hosts "127.0.0.1"\n\nenv blocked\n  api "http://127.0.0.1:9099"\n  allow hosts "example.com"\n`;
  const diags = allowHostsDiags(source, 'blocked');

  assert.equal(diags.length, 1);
  assert.match(diags[0]!.message, /env `blocked`/);
});

test('`validateConfig` alone does not emit TF036 — it has no active env to check against', () => {
  // Which is why this is a `checkSessionServices`-shaped pass called after `selectEnv`, not a line
  // inside `validateConfig`. A surface with no env selection (the docs-site editor demo) reports
  // nothing here rather than reporting it for every env.
  const { diagnostics } = parseConfigSource(`env local default\n  api "http://127.0.0.1:9099"\n  allow hosts "example.com"\n`);

  assert.deepEqual(diagnostics, []);
});

// ---- the guard that retires the finding ------------------------------------

test('the checker and the runtime match hosts with the same function, not two copies of one rule', () => {
  // This finding is, one level down, what two statements of a matching rule produce: a checker that
  // blesses a config the runtime then refuses. `@tflw/runtime`'s `allowHosts.ts` imports this exact
  // export; a copy reintroduced there would drift silently, so the property is asserted from both
  // sides — here that the rule is the published one, and in `runtime/test/allow-hosts.test.ts` that
  // the enforcing path agrees with it over a corpus.
  const cases: [string, string, boolean][] = [
    ['api.example.com', '*.example.com', true],
    ['example.com', '*.example.com', true],
    ['notexample.com', '*.example.com', false],
    ['a.b.example.com', '*.example.com', true],
    ['example.com', 'example.com', true],
    ['api.example.com', 'example.com', false],
    ['127.0.0.1', '127.0.0.1', true],
    ['localhost', '127.0.0.1', false],
  ];
  for (const [hostname, pattern, expected] of cases) {
    assert.equal(hostMatchesAllowPattern(hostname, pattern), expected, `${hostname} vs ${pattern}`);
  }
});
