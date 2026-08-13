// **The probe pace, pinned as a property rather than left to hold by accident** (M131a,
// `PLAN_M131_SAFETY_COMPLETION.md` D346 — D21 §3.2(5)'s half of the safety model).
//
// `AuthzProber.probeAll` is a plain `for … await` loop, so exactly one cross-identity request is
// ever in flight per assertion and the fan-out is (probeable principals) × (assertion sites),
// serialized. That is not a DoS shape, and saying so precisely matters more than filing it beside
// the two controls this milestone actually builds.
//
// But it was **not a control** either: nothing declared the bound, no test held it, and it would
// have evaporated the first time somebody wrapped that loop in a `Promise.all` for latency — with
// no gate anywhere to notice a safety property had been traded for speed. A property that holds by
// accident of implementation is a different object from one that is asserted, and this file is the
// difference.
//
// ## The deferral this file makes observable
//
// A **declared** pace — `probe rate`, an inter-probe delay, grammar of its own — is deferred, and
// per D336 the deferral names a condition rather than a milestone number:
//
//   >>> REVIVING CONDITION: the first change that permits two probes to be in flight
//   >>> simultaneously. Not "Tier 3", not a version — a state of this code, which the assertion
//   >>> below observes directly.
//
// That is the whole point of writing the test now: the condition cannot be forgotten, because the
// commit that creates the need is the commit that turns this red. `M130-09` exists because D291
// addressed three controls to "Tier 3" when what mattered was "does anything originate traffic
// yet", and Tier 2 originated traffic while nobody was watching a milestone number.
//
// Building the pace *now* was rejected: nothing in the system can exceed one-in-flight, so it would
// ship a control with nothing exercising it — precisely the vacuity D291 argued against and this
// milestone exists to correct. Repeating that error inside its own repair would be remarkable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANONYMOUS, AuthzProber, probeOrder, type ProbePolicy, type ProbePrincipal, type ProbeRequest } from '../src/authzProbe.js';
import type { RequestTrace, ResponseTrace } from '../src/types.js';

const POLICY: ProbePolicy = {
  timeoutMs: 5_000,
  allowHosts: null,
  insecure: false,
  probeMutating: false,
  // Loopback, so this file is measuring the pace and nothing else: a public origin would be refused
  // by `TF065` before a single request was built, and every count below would be zero — a passing
  // test of nothing, which is the failure mode `M92d` named.
  allowPublicTargets: [],
};

const OBSERVED: RequestTrace = {
  method: 'GET',
  url: 'http://localhost:4001/v1/orders/a1',
  headers: { Authorization: 'Bearer OWNER' },
};

function response(): ResponseTrace {
  return {
    status: 403,
    statusText: 'Forbidden',
    headers: {},
    bodyText: '{}',
    bodyBytes: Buffer.from(''),
    json: {},
    durationMs: 1,
    finalUrl: OBSERVED.url,
    cookieEvents: [],
  };
}

/**
 * A sender that measures **concurrency**, not calls.
 *
 * It holds each request open across a macrotask turn before replying, so a `Promise.all` rewrite
 * would genuinely overlap here rather than merely appearing to: every probe would enter before any
 * left, and `maxInFlight` would be the principal count. Under the sequential loop it can never
 * exceed 1. Counting sends alone would not detect the change at all — the same requests go out
 * either way, which is exactly why `sentCount` (asserted all over `authz-probe.test.ts`) is not the
 * instrument for this question.
 */
function concurrencySender(): { send: (r: ProbeRequest) => Promise<ResponseTrace>; maxInFlight: () => number; order: string[] } {
  let inFlight = 0;
  let max = 0;
  const order: string[] = [];
  return {
    maxInFlight: () => max,
    order,
    send: async (r) => {
      inFlight++;
      max = Math.max(max, inFlight);
      order.push(r.headers['X-Principal'] ?? '(none)');
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight--;
      return response();
    },
  };
}

function principals(...names: string[]): ProbePrincipal[] {
  return names.map((name) => ({ name, headers: { 'X-Principal': name } }));
}

test('at most one probe is in flight at a time, with four principals to overlap (D346)', async () => {
  const sender = concurrencySender();
  const set = principals('alice', 'bob', 'carol');
  const probes = await new AuthzProber(sender.send).probeAll(OBSERVED, ['a1'], probeOrder([...set, { name: ANONYMOUS, headers: {} }]), POLICY);

  assert.equal(probes.length, 4, 'every principal produced an outcome');
  assert.equal(sender.maxInFlight(), 1, 'two probes were in flight at once — see this file\'s REVIVING CONDITION before changing the assertion');
});

test('the control: the same sender does report overlap when requests really are concurrent', async () => {
  // Without this, the assertion above is satisfied by a sender that cannot count, and the test
  // passes forever regardless of what `probeAll` does. `M92d`'s rule — prove the instrument moves.
  const sender = concurrencySender();
  const set = principals('alice', 'bob', 'carol');
  await Promise.all(set.map((p) => sender.send({ method: 'GET', url: OBSERVED.url, headers: p.headers, timeoutMs: 1, insecure: false })));
  assert.equal(sender.maxInFlight(), 3, 'the instrument does not detect concurrency, so the assertion above proves nothing');
});

test('the order is the declared one with `anonymous` last, on every run (D326)', async () => {
  const sender = concurrencySender();
  const set = [...principals('alice', 'bob'), { name: ANONYMOUS, headers: { 'X-Principal': ANONYMOUS } }];
  await new AuthzProber(sender.send).probeAll(OBSERVED, ['a1'], probeOrder(set), POLICY);
  // Sequential *and* ordered: a fixed order is what makes the report read identically run to run
  // without a sort step, and what keeps the target from seeing a burst it could classify as an
  // attack. The pace assertion above would still hold under a shuffled order, so it is asserted
  // separately rather than assumed to ride along.
  assert.deepEqual(sender.order, ['alice', 'bob', ANONYMOUS]);
});
