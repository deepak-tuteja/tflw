// The Tier 3 mutation corpus (M134a, PLAN_M134_PENTEST_TIER3.md D368/D371) — pure unit tests over
// hand-built requests, independent of the prober, of the pack, and of any network.
//
// Two properties carry most of the weight here, and both are structural rather than exemplary:
// **the corpus cannot contain a payload nothing can read** (D368's vacuity check, which is D291's
// rule one tier later), and **a mutation changes exactly one input** — the property a differential
// oracle loses first and can never recover, because two changed fields make attribution impossible.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMutation,
  enabledPayloads,
  INPUT_CORPUS,
  INPUT_RULE_IDS,
  isIdentifierSegment,
  mutationSites,
  parseBodyPath,
  payloadsForSite,
  templateEndpoint,
  type MutationClass,
  type Payload,
} from '../src/inputCorpus.js';
import type { RequestTrace } from '../src/types.js';

function req(over: Partial<RequestTrace> = {}): RequestTrace {
  return { method: 'GET', url: 'https://api.test/v1/orders/7', headers: {}, ...over };
}

const ALL_CLASSES: MutationClass[] = ['type-confusion', 'injection', 'oversized', 'traversal'];

// --- D368: the corpus is well-formed by construction ---------------------------------------------

test('every payload in the corpus declares at least one invariant (D368)', () => {
  const vacuous = INPUT_CORPUS.filter((p) => p.invariants.length === 0);
  assert.deepEqual(vacuous.map((p) => p.id), [], 'a payload no rule reads is a request sent for nothing — D291\'s vacuity shape');
});

test('every payload declares a deliverable target and a value for it', () => {
  for (const p of INPUT_CORPUS) {
    assert.ok(p.targets.length > 0, `${p.id} can never be delivered`);
    assert.ok(p.text !== undefined || p.json !== undefined, `${p.id} has nothing to send`);
    if (p.targets.some((t) => t !== 'body')) {
      assert.ok(p.text !== undefined, `${p.id} targets a path or query site but only a JSON body can carry a JSON value`);
    }
  }
});

test('payload ids are unique — they key the report and M134b\'s baseline', () => {
  const ids = INPUT_CORPUS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every invariant a payload names is a rule id the pack can actually apply', () => {
  const known = new Set<string>(Object.values(INPUT_RULE_IDS));
  for (const p of INPUT_CORPUS) {
    for (const inv of p.invariants) assert.ok(known.has(inv), `${p.id} names unknown invariant ${inv}`);
  }
});

test('every rule id in the pack has at least one payload that can trigger it (D291, the other direction)', () => {
  // The vacuity check runs both ways: a payload nothing reads is one failure, and a **rule nothing
  // can reach** is the other — a control with no positive that exercises it, which is exactly what
  // D291 forbids and exactly what a hand-maintained pair of lists drifts into.
  for (const id of Object.values(INPUT_RULE_IDS)) {
    assert.ok(INPUT_CORPUS.some((p) => p.invariants.includes(id)), `no payload can ever trigger ${id}`);
  }
});

test('type confusion is body-only — a path or query site has no type to confuse (D371)', () => {
  for (const p of INPUT_CORPUS.filter((c) => c.class === 'type-confusion')) {
    assert.deepEqual([...p.targets], ['body'], `${p.id} must not be delivered where only text can go`);
  }
});

test('the injection payloads name no table, file, command or host (D22 — reveal without exercising)', () => {
  for (const p of INPUT_CORPUS.filter((c) => c.class === 'injection')) {
    const text = p.text ?? '';
    assert.ok(!/\b(select|drop|union|insert|delete|update)\b/i.test(text), `${p.id} contains a SQL verb`);
    assert.ok(!/\b(cat|curl|wget|rm|id|whoami|nc)\b/.test(text.replace(/^tflw/, '')), `${p.id} contains a command`);
    assert.ok(!/<script/i.test(text), `${p.id} contains a live script payload`);
  }
});

// --- D371: which sites a request offers -----------------------------------------------------------

test('an identifier path segment is a site; a route word is not', () => {
  assert.equal(isIdentifierSegment('7'), true);
  assert.equal(isIdentifierSegment('9f1c4d2e-1a2b-3c4d-5e6f-7a8b9c0d1e2f'), true);
  assert.equal(isIdentifierSegment('507f1f77bcf86cd799439011'), true);
  assert.equal(isIdentifierSegment('orders'), false);
  assert.equal(isIdentifierSegment('v1'), false);
  // The safe direction: an unrecognised identifier costs coverage and says so; a misrecognised
  // route word costs a wall of 404s that would read as findings-adjacent noise.
  assert.equal(isIdentifierSegment('my-first-order'), false);
});

test('a request with no id, no query and no JSON body offers no site at all — TF067\'s condition', () => {
  assert.deepEqual(mutationSites(req({ url: 'https://api.test/v1/health' })), []);
});

test('path, query and body leaves are all found, in request order', () => {
  const sites = mutationSites(
    req({
      method: 'POST',
      url: 'https://api.test/v1/orders/7?q=shoes&page=2',
      body: JSON.stringify({ note: 'hi', items: [{ name: 'a' }], count: 3 }),
    }),
  );
  assert.deepEqual(
    sites.map((s) => s.location),
    ['path segment 3', 'query `q`', 'query `page`', 'body `note`', 'body `items[0].name`', 'body `count`'],
  );
});

test('a repeated query parameter yields one site per occurrence, not one collapsed site', () => {
  const sites = mutationSites(req({ url: 'https://api.test/v1/search?tag=a&tag=b' }));
  assert.deepEqual(sites.map((s) => s.key), ['tag', 'tag#2']);
});

test('a non-JSON body offers no leaves and is not an error', () => {
  assert.deepEqual(mutationSites(req({ method: 'POST', url: 'https://api.test/v1/upload', body: 'a=1&b=2' })), []);
});

test('a null body field is not a leaf — there is no observed type to confuse', () => {
  const sites = mutationSites(req({ method: 'POST', url: 'https://api.test/v1/notes', body: JSON.stringify({ a: null, b: 'x' }) }));
  assert.deepEqual(sites.map((s) => s.key), ['b']);
});

// --- D376: the templated endpoint ------------------------------------------------------------------

test('the endpoint templates its identifier segments, so one weakness fingerprints once', () => {
  assert.equal(templateEndpoint('get', 'https://api.test/v1/orders/7'), 'GET /v1/orders/{id}');
  assert.equal(
    templateEndpoint('GET', 'https://api.test/v1/orders/9f1c4d2e-1a2b-3c4d-5e6f-7a8b9c0d1e2f/items/3'),
    'GET /v1/orders/{id}/items/{id}',
  );
  // The query string is deliberately absent: two calls differing only in `?page=` are the same
  // endpoint, and a fingerprint that disagreed would put one weakness in a baseline twice.
  assert.equal(templateEndpoint('GET', 'https://api.test/v1/orders/7?page=2'), 'GET /v1/orders/{id}');
});

// --- applying a mutation ---------------------------------------------------------------------------

const payload = (id: string): Payload => {
  const p = INPUT_CORPUS.find((c) => c.id === id);
  assert.ok(p, `no payload ${id}`);
  return p;
};

test('a body mutation changes exactly one leaf and leaves every sibling at its observed value', () => {
  const observed = req({ method: 'POST', url: 'https://api.test/v1/notes', body: JSON.stringify({ title: 'a', text: 'b', tags: ['x', 'y'] }) });
  const site = mutationSites(observed).find((s) => s.key === 'text')!;
  const out = applyMutation(observed, site, payload('injection/sql-quote'));
  assert.deepEqual(JSON.parse(out.body!), { title: 'a', text: "tflw'", tags: ['x', 'y'] });
});

test('a nested leaf mutation preserves the surrounding structure', () => {
  const observed = req({ method: 'POST', url: 'https://api.test/v1/orders', body: JSON.stringify({ items: [{ sku: 'a' }, { sku: 'b' }] }) });
  const site = mutationSites(observed).find((s) => s.key === 'items[1].sku')!;
  const out = applyMutation(observed, site, payload('injection/sql-quote'));
  assert.deepEqual(JSON.parse(out.body!), { items: [{ sku: 'a' }, { sku: "tflw'" }] });
});

test('type/null delivers a JSON null, not the string "null"', () => {
  // `null !== undefined`, and getting this wrong would send `"null"` while the report claimed a
  // type had been confused — a test asserting a stringified null would have passed either way.
  const observed = req({ method: 'POST', url: 'https://api.test/v1/notes', body: JSON.stringify({ text: 'b' }) });
  const site = mutationSites(observed)[0]!;
  const out = applyMutation(observed, site, payload('type/null'));
  assert.deepEqual(JSON.parse(out.body!), { text: null });
});

test('a traversal payload in a path segment is percent-encoded, so `new URL` cannot normalise it away', () => {
  // The quietest possible false negative: an unencoded `../` is collapsed before the request leaves,
  // so the probe tests nothing and the assertion reports clean.
  const observed = req({ url: 'https://api.test/v1/files/7' });
  const site = mutationSites(observed)[0]!;
  const out = applyMutation(observed, site, payload('traversal/relative'));
  assert.ok(!out.url.includes('/v1/files/../'), 'the traversal must survive as a segment value');
  assert.ok(out.url.includes('%2F') || out.url.includes('%2f'), `expected an encoded separator, got ${out.url}`);
  // `/v1/files/<payload>` — four parts once the leading empty one is counted. The payload stays a
  // single segment rather than becoming four, which is what "delivered as a value" means.
  assert.equal(new URL(out.url).pathname.split('/').length, 4, 'the traversal must not add path structure');
});

test('mutating one occurrence of a repeated query parameter leaves its sibling alone', () => {
  const observed = req({ url: 'https://api.test/v1/search?tag=a&tag=b' });
  const site = mutationSites(observed).find((s) => s.key === 'tag#2')!;
  const out = applyMutation(observed, site, payload('injection/sql-quote'));
  const params = [...new URL(out.url).searchParams.getAll('tag')];
  assert.deepEqual(params, ['a', "tflw'"]);
});

test('a mutation never touches the method or the headers — the whole of D370/D375', () => {
  const observed = req({ method: 'PUT', url: 'https://api.test/v1/orders/7', headers: { 'X-CSRF-Token': 'abc', Cookie: 'sid=1' }, body: '{"a":"b"}' });
  const site = mutationSites(observed).find((s) => s.kind === 'body')!;
  const out = applyMutation(observed, site, payload('injection/sql-quote'));
  // `applyMutation` returns only what it changed; the prober copies the observed headers verbatim.
  // Asserted here because it is the property that makes `M130-01` not this tier's problem: the
  // observed request's own CSRF token still matches, so the guard admits the probe.
  assert.equal(out.url, observed.url);
  assert.ok(out.body !== observed.body);
});

test('parseBodyPath inverts what the site walker writes', () => {
  assert.deepEqual(parseBodyPath('items[0].name'), ['items', 0, 'name']);
  assert.deepEqual(parseBodyPath('[2].sku'), [2, 'sku']);
  assert.deepEqual(parseBodyPath('title'), ['title']);
});

// --- class gating ------------------------------------------------------------------------------------

test('only the enabled classes contribute payloads', () => {
  const on = enabledPayloads(['injection']);
  assert.ok(on.length > 0);
  assert.deepEqual([...new Set(on.map((p) => p.class))], ['injection']);
});

// M137a (`M134b-01`) — the row's residue, made mechanical instead of left as a note to remember.
//
// `M134b`'s sweep proved D388's safety property is carried by three gates, not by `seededPayloads`'
// signature as its comment then claimed: the narrowing at generation, `planProbes`' filter through
// `enabledPayloads`, and `InputProber.#probeOne`'s re-check before sending. The mutation written to
// falsify it survived as EQUIVALENT CODE — the property held, the explanation did not.
//
// The row stayed open at S4 for one reason, quoted: *"two of the three gates are downstream of a
// filter, and a filter is what a later refactor deletes as redundant once the caller 'already'
// restricts — the thing worth watching is whether `enabledPayloads`' class argument ever becomes
// optional."* That is a watch with nobody rostered on it. Giving `classes` a default is a one-token
// edit, it reads as a harmless convenience, every existing test still passes (they all pass classes
// explicitly), and the result is that a caller who forgets the argument silently gets the full
// corpus — including classes the target's config never granted, which is D372 undone by omission.
//
// `Function.prototype.length` counts parameters before the first defaulted one, so this is exactly
// that edit and nothing else: `corpus` already has a default and is not counted, and renaming or
// reordering does not move the number. `input-class-optin-ignored` (m134a) covers the gate that
// actually carries the property; this covers the gate whose removal would make that one load-bearing
// alone.
test('enabledPayloads requires its class list — a default here would hand callers the full corpus (D388, M134b-01)', () => {
  assert.equal(
    enabledPayloads.length,
    1,
    'enabledPayloads must take `classes` as a required parameter. A default (almost certainly ALL_CLASSES) means a caller that omits it gets every payload, including classes the config withheld — and no existing test would go red, because they all pass it explicitly.',
  );
});

test('a path site takes only payloads with a text form', () => {
  const site = mutationSites(req())[0]!;
  const forPath = payloadsForSite(site, enabledPayloads(ALL_CLASSES));
  assert.ok(forPath.length > 0);
  assert.ok(forPath.every((p) => p.text !== undefined));
  assert.ok(!forPath.some((p) => p.class === 'type-confusion'));
});
