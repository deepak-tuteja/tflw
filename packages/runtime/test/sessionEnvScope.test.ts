// `M147d`/`M137f-02` (D642) — the env scope clause, at the one place that applies it.
//
// `resolveConfig` is where a session becomes a fact about an env, and it is deliberately the *only*
// place: `resolved.sessions` is read by the `TF028` roster, by the `privileged` subset `TF063`
// reasons about, and by all five of the interpreter's establishment paths. Filtering here means no
// two of those can disagree about which sessions exist, which is why these tests assert on the
// resolved map rather than on any one consumer.
//
// The last test is the one that is not about ergonomics. A `session` is a member of every Tier 2
// probe set (D306), so scoping is not only about whether a login resolves — it decides who a
// differential oracle probes with.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfigSource } from '@tflw/lang';
import { selectEnv, resolveConfig } from '../src/resolve.js';

function resolveUnder(src: string, envName: string) {
  const parsed = parseConfigSource(src);
  assert.deepEqual(parsed.diagnostics, [], 'fixture must parse cleanly');
  const config = parsed.config!;
  return resolveConfig(config, selectEnv(config, { flag: envName }));
}

const TWO_ENVS = 'env one default\n  api shared "https://a.example.com"\n\nenv two\n  api shared "https://a.example.com"\n\n';

test('`M147d`: a session with no `for env` clause resolves under every env', () => {
  // The additive half. Every session written before D642 is this one, and it must keep resolving
  // in both directions or the clause is a breaking change wearing an optional keyword.
  const src = TWO_ENVS + 'session admin\n  api shared GET /login\n';
  assert.ok(resolveUnder(src, 'one').sessions.has('admin'));
  assert.ok(resolveUnder(src, 'two').sessions.has('admin'));
});

test('`M147d`: a scoped session resolves under its own env and is absent from the others', () => {
  const src = TWO_ENVS + 'session console for env one\n  api shared GET /login\n';
  assert.ok(resolveUnder(src, 'one').sessions.has('console'));
  assert.equal(resolveUnder(src, 'two').sessions.has('console'), false);
});

test('`M147d`: a multi-env clause resolves under each env it names', () => {
  const src =
    'env one default\n  api shared "https://a"\n\nenv two\n  api shared "https://a"\n\nenv three\n  api shared "https://a"\n\n' +
    'session console for env one, three\n  api shared GET /login\n';
  assert.ok(resolveUnder(src, 'one').sessions.has('console'));
  assert.equal(resolveUnder(src, 'two').sessions.has('console'), false);
  assert.ok(resolveUnder(src, 'three').sessions.has('console'));
});

test('`M147d`: `sessionsOutOfScope` carries the envs a filtered-out session does live in', () => {
  // This map exists for one consumer — `TF028`'s hint — and it is the difference between telling an
  // author "there is no session called console" while they are looking straight at one, and telling
  // them which env it belongs to.
  const src = TWO_ENVS + 'session console for env one\n  api shared GET /login\n';
  assert.deepEqual(resolveUnder(src, 'two').sessionsOutOfScope.get('console'), ['one']);
  // And under the env that *does* have it, it is not also reported as elsewhere.
  assert.equal(resolveUnder(src, 'one').sessionsOutOfScope.has('console'), false);
});

test('`M147d`: scoping a session scopes its membership of the authorization probe set', () => {
  // `privilegedSessions` is derived by the CLI from this same map, so a session scoped to one env
  // cannot silently change another env's probe set — which is the consequence `M137f-02` never
  // names and the reason a typo'd env is `TF074` rather than tolerated.
  const src =
    TWO_ENVS +
    'session shopper\n  api shared GET /login\n\n' +
    'session admin for env one privileged\n  api shared GET /login\n';

  const one = resolveUnder(src, 'one');
  assert.deepEqual([...one.sessions.keys()].sort(), ['admin', 'shopper']);
  assert.deepEqual([...one.sessions.keys()].filter((n) => one.sessions.get(n)!.privileged), ['admin']);

  const two = resolveUnder(src, 'two');
  assert.deepEqual([...two.sessions.keys()], ['shopper']);
  // Nobody privileged here, so nothing was excluded from env two's probe set by a declaration that
  // belongs to env one.
  assert.deepEqual([...two.sessions.keys()].filter((n) => two.sessions.get(n)!.privileged), []);
});
