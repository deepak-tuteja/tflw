// The Tier 2 authorization pack (M130b1, PLAN_M130B_AUTHZ_ENGINE.md D320–D322/D324) — pure unit
// tests over hand-built bundles, independent of the prober (`authz-probe.test.ts`), of the
// interpreter wiring, and of any network.
//
// **The three states of D284 are asserted here as they were for Tier 1**, and the third one carries
// more weight in this tier than it did in the last: Tier 2's not-applicable is reachable four
// different ways (a non-2xx owner, the wrong body shape, an unreadable body, and a probe set nobody
// could judge), and each of those is a distinct sentence a reader is meant to act on. They are
// asserted by rule id and by the `because` text, never by count.
//
// The `M128` lesson is deliberately not re-learned here: a pure test can agree with the code about
// a fact the rest of the system contradicts, so these tests bound what they prove. They prove the
// oracle's arithmetic. `authz-assert.test.ts` (M130b2, D335) drives the same pack through a real
// `tflw run` against a fixture server, which is what proves it fires for anybody.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTHZ_RULES,
  boundaryHeld,
  containsAnyId,
  extractResourceIds,
  judgeable,
  ownerShape,
  PROBE_OUTCOME_LABEL,
  runAuthzScan,
  type AuthzObservation,
  type ProbeOutcome,
  type ProbeResult,
} from '../src/authzRules.js';
import type { RequestTrace, ResponseTrace } from '../src/types.js';

const OBJECT_LEAK = 'sec/authz-object-leak';
const COLLECTION_LEAK = 'sec/authz-collection-leak';

function res(over: Partial<ResponseTrace> = {}): ResponseTrace {
  const json = 'json' in over ? over.json : { id: 'a1' };
  return {
    status: 200,
    statusText: 'OK',
    headers: {},
    bodyText: JSON.stringify(json ?? null),
    bodyBytes: Buffer.from(''),
    json,
    durationMs: 1,
    finalUrl: 'https://api.test/v1/orders/a1',
    cookieEvents: [],
    ...over,
  };
}

function req(over: Partial<RequestTrace> = {}): RequestTrace {
  return { method: 'GET', url: 'https://api.test/v1/orders/a1', headers: {}, ...over };
}

function probe(principal: string, outcome: ProbeOutcome): ProbeResult {
  return { principal, outcome };
}

function bundle(over: Partial<AuthzObservation> = {}): AuthzObservation {
  const response = over.owner?.response ?? res();
  return {
    owner: { request: req(), response },
    ownerPrincipals: ['shopper'],
    ownerIds: extractResourceIds(response.json),
    probes: [probe('peer', { kind: 'refused', status: 403 })],
    ...over,
  };
}

/** `fired` / `silent` / `not-applicable` for one rule, the same three-state helper Tier 1 uses. */
function stateOf(o: AuthzObservation, id: string): 'fired' | 'silent' | 'not-applicable' {
  const r = runAuthzScan(o);
  if (r.notApplicable.some((n) => n.rule.id === id)) return 'not-applicable';
  return r.findings.some((f) => f.id === id) ? 'fired' : 'silent';
}

function becauseOf(o: AuthzObservation, id: string): string {
  const r = runAuthzScan(o);
  const na = r.notApplicable.find((n) => n.rule.id === id);
  assert.ok(na, `${id} was expected to be not-applicable, but it was not`);
  return na.because;
}

// ---------------------------------------------------------------------------
// D321 — extraction reaches the bare shapes only.
// ---------------------------------------------------------------------------

test('D321: a root `id` on an object is the resource identity', () => {
  assert.deepEqual(extractResourceIds({ id: 'a1' }), ['a1']);
});

test('D321: a nested id is not a resource identity', () => {
  // The exclusion that stops shared `productId`s making this a false-positive machine.
  assert.deepEqual(extractResourceIds({ id: 'a1', items: [{ productId: 'p1', id: 'line-9' }] }), ['a1']);
});

test('D321: each array element contributes its root id', () => {
  assert.deepEqual(extractResourceIds([{ id: 'a1' }, { id: 'a2' }]), ['a1', 'a2']);
});

test('D321: an envelope yields nothing — the oracle refuses to guess which key is the payload', () => {
  assert.deepEqual(extractResourceIds({ data: [{ id: 'r1' }], nextCursor: 'x' }), []);
});

test('D321: an `orderId` spelling yields nothing — no key aliases in v1', () => {
  assert.deepEqual(extractResourceIds({ orderId: 'a1' }), []);
  assert.deepEqual(extractResourceIds({ _id: 'a1' }), []);
  assert.deepEqual(extractResourceIds({ uuid: 'a1' }), []);
});

test('D321: a numeric id is accepted and stringified', () => {
  assert.deepEqual(extractResourceIds({ id: 7 }), ['7']);
  assert.deepEqual(extractResourceIds([{ id: 1 }, { id: 2 }]), ['1', '2']);
});

test('D321: an id that is neither string nor number is not an identity', () => {
  // `true` is not an identity and `null` is the absence of one — accepting either would put a
  // value into the containment set that matches things which are not identifiers at all.
  assert.deepEqual(extractResourceIds({ id: true }), []);
  assert.deepEqual(extractResourceIds({ id: null }), []);
  assert.deepEqual(extractResourceIds({ id: '' }), []);
  assert.deepEqual(extractResourceIds({ id: { nested: 'a1' } }), []);
});

test('D321: non-JSON, scalars and mixed arrays', () => {
  assert.deepEqual(extractResourceIds(undefined), []);
  assert.deepEqual(extractResourceIds('a1'), []);
  assert.deepEqual(extractResourceIds(42), []);
  assert.deepEqual(extractResourceIds([]), []);
  assert.deepEqual(extractResourceIds(['a1', { id: 'a2' }]), ['a2']);
});

test('D321: duplicate ids collapse, and order is the body order', () => {
  assert.deepEqual(extractResourceIds([{ id: 'a1' }, { id: 'a1' }, { id: 'a2' }]), ['a1', 'a2']);
});

// ---------------------------------------------------------------------------
// D322 — containment is a scalar-leaf walk with exact equality, at any depth.
// ---------------------------------------------------------------------------

test('D322: an id at the same position is contained', () => {
  assert.deepEqual(containsAnyId({ id: 'a1e3' }, ['a1e3']), ['a1e3']);
});

test('D322: an id nested under a different key is still contained — the asymmetry is deliberate', () => {
  assert.deepEqual(containsAnyId({ data: [{ orderId: 'a1e3' }] }, ['a1e3']), ['a1e3']);
  assert.deepEqual(containsAnyId({ a: { b: { c: ['x', 'a1e3'] } } }, ['a1e3']), ['a1e3']);
});

test('D322: exact leaf equality — a short numeric id cannot match inside a larger number', () => {
  // THE test for the substring oracle this design rejected: `1` must not be found in `41`, and a
  // substring search would need a minimum-length threshold to avoid it. There is no threshold here.
  assert.deepEqual(containsAnyId({ total: 41 }, ['1']), []);
  assert.deepEqual(containsAnyId({ ts: 1786617104 }, ['17']), []);
  assert.deepEqual(containsAnyId({ note: 'order a1e3 was shipped' }, ['a1e3']), []);
});

test('D322: a numeric leaf matches a stringified id, and vice versa', () => {
  assert.deepEqual(containsAnyId({ id: 7 }, ['7']), ['7']);
});

test('D322: nothing is contained in an unparsed body or an empty id set', () => {
  assert.deepEqual(containsAnyId(undefined, ['a1']), []);
  assert.deepEqual(containsAnyId({ id: 'a1' }, []), []);
});

test('D322: multiple owner ids report in the owner’s order', () => {
  assert.deepEqual(containsAnyId([{ id: 'a2' }, { id: 'a1' }], ['a1', 'a2']), ['a1', 'a2']);
});

test('D322: deep nesting does not overflow the stack', () => {
  // Iterative on purpose. The depth that reaches here is whatever `JSON.parse` accepted, which is
  // not this code's to bound — a security check must not fall over on a body the client accepted.
  let deep: unknown = 'a1e3';
  for (let i = 0; i < 20_000; i++) deep = { next: deep };
  assert.deepEqual(containsAnyId(deep, ['a1e3']), ['a1e3']);
});

// ---------------------------------------------------------------------------
// D320 — the shape gate.
// ---------------------------------------------------------------------------

test('D320: an object owner engages object-leak and stands collection-leak down', () => {
  const o = bundle();
  assert.equal(stateOf(o, OBJECT_LEAK), 'silent');
  assert.equal(stateOf(o, COLLECTION_LEAK), 'not-applicable');
});

test('D320: an array owner engages collection-leak and stands object-leak down', () => {
  const response = res({ json: [{ id: 'a1' }, { id: 'a2' }] });
  const o = bundle({ owner: { request: req({ url: 'https://api.test/v1/orders' }), response }, ownerIds: ['a1', 'a2'] });
  assert.equal(stateOf(o, COLLECTION_LEAK), 'silent');
  assert.equal(stateOf(o, OBJECT_LEAK), 'not-applicable');
});

test('D320: the ordinary counts line is 3 rules — 1 applicable, 2 not applicable', () => {
  // The denominator is rules, not rules x principals. Four probes, still three considered.
  //
  // M137b (D434) made the third one, and its not-applicable is the honest reading rather than noise:
  // this bundle declares no `csrf from` clause, so there is no token to withhold and the rule reports
  // exactly that. A pack whose membership changed with the config would break `SCAN_RULE_IDS` and the
  // severity table, both of which are projections of the pack (D406), so the rule is always
  // considered and says why it did not apply — which is how the two leak rules already behave when
  // the owner's body is the wrong shape.
  const o = bundle({
    probes: [
      probe('peer', { kind: 'refused', status: 403 }),
      probe('oauthLong', { kind: 'refused', status: 403 }),
      probe('oauthShort', { kind: 'served-different', status: 200 }),
      probe('anonymous', { kind: 'refused', status: 401 }),
    ],
  });
  const r = runAuthzScan(o);
  assert.equal(r.considered, 3);
  assert.equal(r.applicable.length, 1);
  assert.equal(r.notApplicable.length, 2);
  assert.equal(r.findings.length, 0);
});

test('D320/D285: an unreadable owner body engages NOTHING, so the assertion has no power to fail', () => {
  // The row that matters. A 200 the oracle cannot read must not be a green.
  const response = res({ json: { data: [{ id: 'r1' }], nextCursor: 'x' } });
  const o = bundle({ owner: { request: req(), response }, ownerIds: [] });
  const r = runAuthzScan(o);
  assert.equal(r.applicable.length, 0, 'no rule may apply to a body the oracle cannot read');
  assert.equal(r.notApplicable.length, 3, 'M137b: the CSRF rule is the third, not applicable for its own reason');
  assert.match(becauseOf(o, OBJECT_LEAK), /no resource identity found/);
});

test('D321: the not-applicable sentence names the shape it read, so widening evidence can arrive', () => {
  const response = res({ json: { data: [], nextCursor: 'x', total: 0 } });
  const o = bundle({ owner: { request: req(), response }, ownerIds: [] });
  const because = becauseOf(o, OBJECT_LEAK);
  assert.match(because, /a JSON object with no root `id`/);
  assert.match(because, /`data`/, 'the keys it saw must be named — this is the widening trigger');
  assert.match(because, /this rule reads a root `id`/, 'and the shapes it can read');
});

test('D321: an array whose elements carry no root id is unreadable, not an empty collection', () => {
  const response = res({ json: [{ orderId: 'a1' }] });
  const o = bundle({ owner: { request: req(), response }, ownerIds: [] });
  assert.equal(stateOf(o, COLLECTION_LEAK), 'not-applicable');
  assert.match(becauseOf(o, COLLECTION_LEAK), /elements carry no root `id`/);
});

test('a non-2xx owner engages nothing — there is no authorized baseline to differ from', () => {
  // Four principals all getting 403 behind an owner who also got 403 is not a boundary working.
  const response = res({ status: 403, json: { id: 'a1' } });
  const o = bundle({ owner: { request: req(), response } });
  const r = runAuthzScan(o);
  assert.equal(r.applicable.length, 0);
  assert.match(becauseOf(o, OBJECT_LEAK), /the owner's own response was 403/);
});

// ---------------------------------------------------------------------------
// D324 — `clean` has to be earned.
// ---------------------------------------------------------------------------

test('D324: a leak is an ANSWER, even though it is not a pass', () => {
  // THE regression test for the bug this file's first draft shipped: `judgeable` was written as
  // `refused || served-different`, so a probe set whose only member leaked engaged no rule and the
  // critical finding came out as a not-applicable instead. *Answered the question* and *answered
  // in the app's favour* are two predicates, and collapsing them loses findings in the safe-looking
  // direction. Both are asserted here so neither can quietly become the other again.
  assert.equal(judgeable({ kind: 'leaked', ids: ['a1'] }), true);
  assert.equal(judgeable({ kind: 'refused', status: 404 }), true);
  assert.equal(judgeable({ kind: 'served-different', status: 200 }), true);
  assert.equal(judgeable({ kind: 'inconclusive', reason: 'x' }), false);
  assert.equal(judgeable({ kind: 'not-probed', reason: 'x' }), false);

  assert.equal(boundaryHeld({ kind: 'leaked', ids: ['a1'] }), false, 'a leak is never the boundary holding');
  assert.equal(boundaryHeld({ kind: 'refused', status: 403 }), true);
  assert.equal(boundaryHeld({ kind: 'served-different', status: 200 }), true);
  assert.equal(boundaryHeld({ kind: 'inconclusive', reason: 'rate limited (429)' }), false, 'a rate limiter is not an authorization boundary');
  assert.equal(boundaryHeld({ kind: 'not-probed', reason: 'x' }), false);
});

test('D324/D285: a lone leaked probe engages the rule and fires — it is not a non-answer', () => {
  const o = bundle({ probes: [probe('peer', { kind: 'leaked', ids: ['a1'] })] });
  const r = runAuthzScan(o);
  assert.equal(r.applicable.length, 1);
  assert.equal(r.findings.length, 1);
});

test('D324/D285: a probe set nobody could judge engages nothing', () => {
  // The second door into D285, and the one that stops a rate limiter reading as a boundary: if
  // every principal came back 429 or was never probed, the assertion proved nothing.
  const o = bundle({
    probes: [
      probe('peer', { kind: 'inconclusive', reason: 'rate limited (429)' }),
      probe('anonymous', { kind: 'not-probed', reason: 'a mutating method with no `probe mutating`' }),
    ],
  });
  const r = runAuthzScan(o);
  assert.equal(r.applicable.length, 0, 'nothing was judged, so nothing may be reported clean');
  assert.match(becauseOf(o, OBJECT_LEAK), /no principal produced a judgeable response/);
  assert.match(becauseOf(o, OBJECT_LEAK), /1 inconclusive, 1 not probed/);
});

test('D324: one judgeable principal is enough to engage the rule', () => {
  const o = bundle({
    probes: [
      probe('peer', { kind: 'inconclusive', reason: 'rate limited (429)' }),
      probe('anonymous', { kind: 'refused', status: 401 }),
    ],
  });
  assert.equal(stateOf(o, OBJECT_LEAK), 'silent');
});

test('D324: an empty probe set is not-applicable and says so distinctly', () => {
  const o = bundle({ probes: [] });
  assert.equal(becauseOf(o, OBJECT_LEAK), 'no principal was available to probe');
});

test('D324: the outcome vocabulary is complete and its labels are stable', () => {
  // A guard on the wording, since the reporter, the failure detail and the not-applicable listing
  // all render from this one map. Adding a sixth state without a label should fail here.
  assert.deepEqual(Object.keys(PROBE_OUTCOME_LABEL).sort(), ['inconclusive', 'leaked', 'not-probed', 'refused', 'served-different']);
  assert.equal(PROBE_OUTCOME_LABEL['served-different'], 'served different content');
});

// ---------------------------------------------------------------------------
// Findings.
// ---------------------------------------------------------------------------

test('a leaked probe is a critical finding naming rule, principal, method, path and id', () => {
  const o = bundle({ probes: [probe('peer', { kind: 'leaked', ids: ['a1'] })] });
  const r = runAuthzScan(o);
  assert.equal(r.findings.length, 1);
  const f = r.findings[0]!;
  assert.equal(f.id, OBJECT_LEAK);
  assert.equal(f.severity, 'critical');
  assert.match(f.detail, /GET \/v1\/orders\/a1/);
  assert.match(f.detail, /`peer` is not an owner/);
  assert.match(f.detail, /owners: shopper/);
  assert.match(f.detail, /received resource id "a1"/);
});

test('one finding per violating principal — the answer is *which* principals, not *whether*', () => {
  const o = bundle({
    probes: [
      probe('peer', { kind: 'leaked', ids: ['a1'] }),
      probe('anonymous', { kind: 'leaked', ids: ['a1'] }),
      probe('oauthLong', { kind: 'refused', status: 403 }),
    ],
  });
  const r = runAuthzScan(o);
  assert.equal(r.findings.length, 2);
  assert.deepEqual(
    r.findings.map((f) => f.detail.match(/`([^`]+)` is not an owner/)![1]),
    ['peer', 'anonymous'],
  );
});

test('D327: every owner the test named appears in the finding', () => {
  const o = bundle({ ownerPrincipals: ['admin', 'shopper'], probes: [probe('peer', { kind: 'leaked', ids: ['a1'] })] });
  assert.match(runAuthzScan(o).findings[0]!.detail, /owners: admin, shopper/);
});

test('a collection leak lists at most three ids, then a count', () => {
  // R10's prove-without-reproducing split: the finding proves the leak, the emitted repro re-runs
  // it. The full set stays on the ProbeResult for the emitter.
  const ids = ['a1', 'a2', 'a3', 'a4', 'a5'];
  const response = res({ json: ids.map((id) => ({ id })) });
  const o = bundle({
    owner: { request: req({ url: 'https://api.test/v1/orders' }), response },
    ownerIds: ids,
    probes: [probe('peer', { kind: 'leaked', ids })],
  });
  const f = runAuthzScan(o).findings[0]!;
  assert.equal(f.id, COLLECTION_LEAK);
  assert.match(f.detail, /received resource ids "a1", "a2", "a3" and 2 more/);
});

test('the query string travels with the path, since it can select the resource', () => {
  const response = res({ json: [{ id: 'a1' }] });
  const o = bundle({
    owner: { request: req({ url: 'https://api.test/v1/orders?status=paid' }), response },
    ownerIds: ['a1'],
    probes: [probe('peer', { kind: 'leaked', ids: ['a1'] })],
  });
  assert.match(runAuthzScan(o).findings[0]!.detail, /GET \/v1\/orders\?status=paid/);
});

// ---------------------------------------------------------------------------
// D296 — the floor narrows the pack before applicability, not the findings after.
// ---------------------------------------------------------------------------

test('D296: a floor narrows the pack, and `considered` reports what it narrowed to', () => {
  const o = bundle();
  assert.equal(runAuthzScan(o, 'critical').considered, 3, 'every rule in the pack is critical, so a critical floor keeps all three');
  // A floor above every rule in the pack leaves nothing considered — which is D285's own case, and
  // it must arrive as zero-applicable rather than as a green.
  const narrowed = runAuthzScan(o, 'critical', AUTHZ_RULES.filter((r) => r.severity === 'minor'));
  assert.equal(narrowed.considered, 0);
  assert.equal(narrowed.applicable.length, 0);
});

// ---------------------------------------------------------------------------
// The pack itself.
// ---------------------------------------------------------------------------

test('the pack is M130a\'s two rules plus M137b\'s, all critical, all `sec/`-prefixed', () => {
  // Cross-repo: VULNS.md V6-V8 name these ids and this severity. A rename here without one there
  // makes the target's positive controls unreachable, and this is the cheaper place to notice.
  // M137b (D434) adds the third, and it is in this pack rather than a fourth one because
  // `AuthzObservation` already carries everything it reads — but it reads a DIFFERENT field of it
  // (`csrfProbes`, D457), which is what keeps it from firing on the two leak rules' evidence.
  assert.deepEqual(AUTHZ_RULES.map((r) => r.id), [OBJECT_LEAK, COLLECTION_LEAK, 'sec/csrf-not-enforced']);
  for (const r of AUTHZ_RULES) {
    assert.equal(r.severity, 'critical', `${r.id} severity`);
    assert.ok(r.id.startsWith('sec/'), `${r.id} prefix`);
    assert.ok(r.appliesWhen.length > 0, `${r.id} declares a precondition`);
    assert.ok(r.description.length > 0, `${r.id} describes itself`);
  }
});

test('exactly one rule can apply to any single owner body', () => {
  // The invariant behind the counts line. If both could apply, `1 applicable, 1 not applicable`
  // would be a coincidence of the fixtures rather than a property.
  for (const json of [{ id: 'a1' }, [{ id: 'a1' }], { data: [] }, 'scalar']) {
    const response = res({ json });
    const o = bundle({ owner: { request: req(), response }, ownerIds: extractResourceIds(json) });
    assert.ok(runAuthzScan(o).applicable.length <= 1, `two rules applied to ${JSON.stringify(json)}`);
  }
});

test('ownerShape agrees with extractResourceIds about what is readable', () => {
  // Two functions read the same body for two purposes; a disagreement would produce a rule that
  // applies with an empty id set, which can never fire and would report clean forever.
  for (const json of [{ id: 'a1' }, [{ id: 'a1' }], { data: [{ id: 'r' }] }, { orderId: 'x' }, [], ['a'], 42, undefined]) {
    const readable = ownerShape(res({ json })) !== 'unreadable';
    assert.equal(readable, extractResourceIds(json).length > 0, `disagreement on ${JSON.stringify(json) ?? 'undefined'}`);
  }
});

// ---------------------------------------------------------------------------
// M137b (D434/D457) — `sec/csrf-not-enforced`.
// ---------------------------------------------------------------------------

const CSRF = 'sec/csrf-not-enforced';
const WITHHELD = 'shopper (csrf token withheld)';

/** A withheld-token probe that reached the app and got `status`. The rule reads the response, not the
 *  outcome taxonomy (D457), so the taxonomy kind here is only what `classifyResponse` would have said. */
function csrfProbe(status: number, outcome?: ProbeOutcome): ProbeResult {
  return {
    principal: WITHHELD,
    outcome: outcome ?? (status < 300 ? { kind: 'served-different', status } : { kind: 'refused', status }),
    response: res({ status, json: { id: 'a1' } }),
  };
}

test('D434: a 2xx with the token withheld is a critical finding against the derived principal', () => {
  const o = bundle({ csrfProbes: [csrfProbe(201)] });
  assert.equal(stateOf(o, CSRF), 'fired');
  const [finding] = runAuthzScan(o).findings.filter((f) => f.id === CSRF);
  assert.equal(finding!.severity, 'critical');
  assert.equal(finding!.where?.location, WITHHELD, 'R8/D376 — the principal is the location for this tier');
  assert.match(finding!.detail, /answered 201/);
  assert.match(finding!.detail, /any site the browser visits/, 'the detail has to say why a 2xx here matters');
});

test('D434: a 4xx with the token withheld is the defence working — applicable, no finding', () => {
  const o = bundle({ csrfProbes: [csrfProbe(403)] });
  assert.equal(stateOf(o, CSRF), 'silent', 'the rule applied and found nothing, which is what a working guard looks like');
});

test('D434: no `csrf from` clause means not applicable, never a green', () => {
  // The default for every assertion in a suite that has not adopted the clause. D285's door: a rule
  // that could not have fired must say so rather than contribute a clean result.
  assert.equal(stateOf(bundle(), CSRF), 'not-applicable');
  assert.match(becauseOf(bundle(), CSRF), /no owning session declares a `csrf from` clause/);
});

test('D434: a withheld probe that never reached the app is not applicable, not a pass', () => {
  // `probe mutating` withheld, or a transport failure: no response, so nothing about the app's CSRF
  // defence was observed. Scoring this clean is exactly the shape `M130-01` was filed about.
  const o = bundle({ csrfProbes: [{ principal: WITHHELD, outcome: { kind: 'not-probed', reason: 'no `probe mutating` covers this target' } }] });
  assert.equal(stateOf(o, CSRF), 'not-applicable');
  assert.match(becauseOf(o, CSRF), /no withheld-token probe reached the application/);
});

test('D457: the derived probe is invisible to the two leak rules, so a 2xx is not read as a leak', () => {
  // The false positive this field exists to prevent, asserted from the direction that would have
  // produced it. The derived principal IS the owner, so a successful token-less write returns the
  // owner's own ids — `sec/authz-object-leak`'s exact trigger. One shared list and this bundle would
  // report a critical BOLA finding against the owner's own resource.
  const o = bundle({
    probes: [probe('peer', { kind: 'refused', status: 403 })],
    csrfProbes: [{ principal: WITHHELD, outcome: { kind: 'leaked', ids: ['a1'] }, response: res({ status: 201 }) }],
  });
  const ids = runAuthzScan(o).findings.map((f) => f.id);
  assert.deepEqual(ids, [CSRF], `only the CSRF rule may fire here, got: ${ids.join(', ')}`);
});
