// `M147f`/`M147-07` (D647) — `header "X" is "Y" for <service>` naming a service no env declares.
//
// **The failure is total, and silent in both directions of reading.** `validateConfig` had checked
// session names, the reserved principal, env conflicts and — one row earlier, as `TF074` — the
// `for env` clause, and had never once looked at a `HeaderDecl`'s `service`. `resolveConfig` copies
// the name through verbatim, and the interpreter sets the header only where the clause is absent or
// equals the step's own service, so an unmatched name attaches the header to *nothing*: `tflw check`
// prints "no problems found", exit 0, the run is green, and every request goes out without the
// header the config plainly says it carries.
//
// That is the shape `TF074` was spent on for `session ... for env`, in a construct that had already
// shipped — which is the part worth carrying. Order 6 found the same defect twice in two clauses
// written years apart, and the second one only because the first was being fixed.
//
// **Why the union and not the active env.** Services are declared per `env`; a `header` may sit in
// `defaults`. A per-env rule would therefore reject the correct config where a defaults header
// scopes to a service one env declares, so this checks the name against every service declared
// anywhere in the file. Every typo is caught — a typo matches nothing anywhere — at zero false
// positives, and the answer arrives in the editor on `tflw.config` alone, which is the reason
// `D642` gave for putting `for env` in the checker rather than at `TF026`'s resolve-time position.
// The under-approximation is deliberate and is pinned below, so it is a known gap rather than a
// silent one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfigSource, Codes } from '../src/index.js';

const diags = (src: string) => parseConfigSource(src).diagnostics;
const codes = (src: string) => diags(src).map((d) => d.code);

// ---- the defect ---------------------------------------------------------------------------------

test('a header scoped to a service no env declares is refused', () => {
  const src = ['env one default', '  api shop "https://a"', '  header "X-Tenant" is "acme" for ghostService', ''].join('\n');
  const found = diags(src).filter((d) => d.code === Codes.CONFIG_UNKNOWN_SERVICE);
  assert.equal(found.length, 1, JSON.stringify(codes(src)));
  assert.match(found[0]!.message, /unknown service "ghostService"/);
});

test('the caret sits on the service name, not on the whole declaration', () => {
  // `HeaderDecl.service` was a bare string until this milestone, so there was nothing to point at.
  // Same reason `SessionDecl.envs` carries `EnvScopeRef` nodes (`D642`): a scope clause is where a
  // typo lands, and a typo needs a caret on the word, not on the line.
  const line = '  header "X-Tenant" is "acme" for ghostService';
  const src = ['env one default', '  api shop "https://a"', line, ''].join('\n');
  const [d] = diags(src).filter((x) => x.code === Codes.CONFIG_UNKNOWN_SERVICE);
  assert.ok(d);
  assert.equal(d.span.start.line, 3);
  assert.equal(d.span.start.column, line.indexOf('ghostService') + 1);
  assert.equal(d.span.end.column, line.indexOf('ghostService') + 1 + 'ghostService'.length);
});

test('a near-miss gets `did you mean`, which is the whole value in the common case', () => {
  const src = ['env one default', '  api shop "https://a"', '  header "X-Tenant" is "acme" for shp', ''].join('\n');
  const [d] = diags(src).filter((x) => x.code === Codes.CONFIG_UNKNOWN_SERVICE);
  assert.match(d!.hint!, /did you mean `shop`\?/);
});

test('with no near-miss the hint lists what the file does declare', () => {
  const src = [
    'env one default',
    '  api shop "https://a"',
    '  api billing "https://b"',
    '  header "X-Tenant" is "acme" for zzzzzzzz',
    '',
  ].join('\n');
  const [d] = diags(src).filter((x) => x.code === Codes.CONFIG_UNKNOWN_SERVICE);
  assert.match(d!.hint!, /billing, shop/);
});

test('a config with no named services at all says so, rather than listing nothing', () => {
  // The empty-set branch. Without it the hint reads `and it declares: ` with nothing after the
  // colon, which tells the reader the file is broken in some way they cannot see.
  const src = ['env one default', '  api "https://a"', '  header "X-Tenant" is "acme" for shop', ''].join('\n');
  const [d] = diags(src).filter((x) => x.code === Codes.CONFIG_UNKNOWN_SERVICE);
  assert.match(d!.hint!, /declares no named `api` services/);
});

// ---- the controls -------------------------------------------------------------------------------

test('NEGATIVE — a header scoped to a service that IS declared is clean', () => {
  const src = ['env one default', '  api shop "https://a"', '  header "X-Tenant" is "acme" for shop', ''].join('\n');
  assert.deepEqual(codes(src), []);
});

test('NEGATIVE — an unscoped header is not checked against anything', () => {
  // `service === null` means "every service", which is the common case and must stay silent even in
  // a config that declares no named services at all.
  const src = ['env one default', '  api "https://a"', '  header "X-Tenant" is "acme"', ''].join('\n');
  assert.deepEqual(codes(src), []);
});

test('the union is across envs: a header in `defaults` may name a service one env declares', () => {
  // The case that decides union-vs-active-env. Under a per-env rule this correct config is rejected
  // in `env two`; under the union it is clean, which is the behaviour chosen.
  const src = [
    'defaults',
    '  header "X-Tenant" is "acme" for shop',
    'env one default',
    '  api shop "https://a"',
    'env two',
    '  api other "https://b"',
    '',
  ].join('\n');
  assert.deepEqual(codes(src), []);
});

test('a header inside one env may name a service declared only by another env', () => {
  // The same union, seen from the side that shows its cost: this config IS accepted, and the header
  // in `env two` is inert under `env two`. Pinned as the known under-approximation of the rule
  // rather than left to be discovered — `TF076`'s doc comment names the condition that reopens it.
  const src = [
    'env one default',
    '  api shop "https://a"',
    'env two',
    '  api other "https://b"',
    '  header "X-Tenant" is "acme" for shop',
    '',
  ].join('\n');
  assert.deepEqual(codes(src), [], 'accepted by design; see TF076 on why, and on what would change it');
});

test('the union reaches past the FIRST env — a defaults header may name the second env`s service', () => {
  // Added because a mutation earned it. Narrowing the sweep to `config.envs[0]` survived every case
  // above, since all of them happened to declare the service in the first env; a rule that only
  // reads one env is not the union and would reject this correct config in exactly the arrangement
  // the language exists for.
  const src = [
    'defaults',
    '  header "X-Tenant" is "acme" for billing',
    'env one default',
    '  api shop "https://a"',
    'env two',
    '  api billing "https://b"',
    '',
  ].join('\n');
  assert.deepEqual(codes(src), []);
});

test('services are gathered from envs only, because `api` cannot be declared in `defaults`', () => {
  // Written the other way round first, asserting that a `defaults`-declared service counts — and it
  // could not pass, because `ApiServiceDecl` is `ENV_ONLY`. So the `defaults` half of the service
  // sweep would have been dead code, and this is the case that says so rather than leaving the
  // asymmetry between the two loops looking like a bug. The header half is genuinely both.
  const src = ['defaults', '  api shop "https://a"', 'env one default', '  header "X-Tenant" is "acme" for shop', ''].join(
    '\n',
  );
  const found = codes(src);
  assert.ok(found.includes(Codes.CONFIG_KEY_CONTEXT), JSON.stringify(found));
});

test('every unknown scope clause is reported, not just the first', () => {
  const src = [
    'env one default',
    '  api shop "https://a"',
    '  header "A" is "1" for ghostOne',
    '  header "B" is "2" for ghostTwo',
    '',
  ].join('\n');
  const found = diags(src).filter((d) => d.code === Codes.CONFIG_UNKNOWN_SERVICE);
  assert.equal(found.length, 2);
  assert.deepEqual(
    found.map((d) => d.message),
    ['unknown service "ghostOne"', 'unknown service "ghostTwo"'],
  );
});

test('a `for` clause with no name at all is a parse error, and does not also become TF076', () => {
  // `serviceSpan` is null when the parser could not read a name, and a second diagnostic about a
  // service the author never finished typing is `M140-01`'s cascade in miniature.
  const src = ['env one default', '  api shop "https://a"', '  header "X-Tenant" is "acme" for', ''].join('\n');
  assert.ok(!codes(src).includes(Codes.CONFIG_UNKNOWN_SERVICE), JSON.stringify(codes(src)));
});
