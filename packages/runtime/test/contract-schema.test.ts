// `expect body matches schema "Name" from "source"` (SPEC, PLAN decision 102a, enterprise arc
// cluster 3, closes TFLW-GAPS.md gap #6) — real ajv validation against a fetched OpenAPI
// document's `components.schemas`. Real fixture server (no mocking): the `/openapi.json` fixture
// below has a cross-`$ref`'d pair (`Widget.address` → `Address`) to prove ref resolution, not
// just a flat schema.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { loadOpenApiDocumentForCrawl, normalizeOpenApiSchema } from '../src/contract.js';
import { startFixtureServer, testConfig, json } from './support.js';

const OPENAPI_DOC = {
  components: {
    schemas: {
      Address: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
      Widget: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          address: { $ref: '#/components/schemas/Address' },
        },
        required: ['id', 'name'],
      },
    },
  },
};

async function startWidgetServer() {
  return startFixtureServer({
    '/openapi.json': (_req, res) => json(res, 200, OPENAPI_DOC),
    '/widgets/good': (_req, res) => json(res, 200, { id: 'w1', name: 'Widget', address: { city: 'Springfield' } }),
    '/widgets/bad': (_req, res) => json(res, 200, { id: 'w1' }), // missing required `name`
    '/openapi-broken.json': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('not json');
    },
  });
}

test('a response that matches its documented schema passes, resolving a cross-$ref', async () => {
  const server = await startWidgetServer();
  const config = testConfig(server.baseUrl);
  const source = `test "widget matches its schema"
  api GET /widgets/good
  expect body matches schema "Widget" from "/openapi.json"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));

  await server.close();
});

test('a response missing a required field fails with a readable ajv error', async () => {
  const server = await startWidgetServer();
  const config = testConfig(server.baseUrl);
  const source = `test "widget missing a required field"
  api GET /widgets/bad
  expect body matches schema "Widget" from "/openapi.json"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, false);
  const expectStep = report.tests[0]!.steps.find((s) => s.kind === 'expect')!;
  assert.equal(expectStep.ok, false);
  assert.match(expectStep.detail!, /to match schema "Widget"/);
  assert.match(expectStep.detail!, /name/);

  await server.close();
});

test('`not matches schema` passes when the shape genuinely does not match', async () => {
  const server = await startWidgetServer();
  const config = testConfig(server.baseUrl);
  const source = `test "bad widget correctly does not match"
  api GET /widgets/bad
  expect body not matches schema "Widget" from "/openapi.json"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));

  await server.close();
});

test('an unknown schema name fails clearly, naming the schema', async () => {
  const server = await startWidgetServer();
  const config = testConfig(server.baseUrl);
  const source = `test "schema that was never documented"
  api GET /widgets/good
  expect body matches schema "DoesNotExist" from "/openapi.json"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /schema "DoesNotExist" not found/);

  await server.close();
});

test('a malformed (non-JSON, no components.schemas) OpenAPI document fails clearly', async () => {
  const server = await startWidgetServer();
  const config = testConfig(server.baseUrl);
  const source = `test "openapi doc is not usable"
  api GET /widgets/good
  expect body matches schema "Widget" from "/openapi-broken.json"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, false);
  // Since `D460` this says which of the two things went wrong. The body did not parse at all, so
  // there is no document to look for schemas in, and the error says *that* rather than reporting a
  // missing `components.schemas` — which was true but was the second-order consequence.
  assert.match(report.tests[0]!.error ?? '', /is not a JSON object/);

  await server.close();
});

test('the OpenAPI document is fetched once and cached across multiple assertions in one run', async () => {
  const server = await startWidgetServer();
  const config = testConfig(server.baseUrl);
  const source = `test "two schema assertions, one fetch"
  api GET /widgets/good
  expect body matches schema "Widget" from "/openapi.json"
  expect body.address matches schema "Address" from "/openapi.json"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(server.received.get('/openapi.json')!.length, 1, 'the doc must be fetched once and cached, not once per assertion');

  await server.close();
});

test('a *failed* document fetch is not cached — the next assertion retries and succeeds once the server recovers (M63/A12-02)', async () => {
  // The twin of the test above, and the half its fixture could never reach: caching-works and
  // caching-a-failure are the same line of code, but every failure-path test in this file uses a
  // server that fails deterministically, so the cache is always cold when they run. A transient
  // 500 was therefore permanent for the life of the process — and, worse, tests 2..N failed
  // citing the *first* one's HTTP status, describing an exchange they never had. Under
  // `tflw watch` that meant fixing the server and re-saving never cleared the failure.
  let hits = 0;
  const server = await startFixtureServer({
    '/openapi.json': (_req, res) => {
      hits++;
      if (hits === 1) {
        res.writeHead(500, { 'content-type': 'text/plain' }).end('transient outage');
        return;
      }
      json(res, 200, OPENAPI_DOC);
    },
    '/widgets/good': (_req, res) => json(res, 200, { id: 'w1', name: 'Widget', address: { city: 'Springfield' } }),
  });
  const config = testConfig(server.baseUrl);
  const source = `test "first assertion — the document fetch 500s"
  api GET /widgets/good
  expect body matches schema "Widget" from "/openapi.json"

test "second assertion — the server has recovered"
  api GET /widgets/good
  expect body matches schema "Widget" from "/openapi.json"

test "third assertion — still healthy, and now served from the cache"
  api GET /widgets/good
  expect body matches schema "Widget" from "/openapi.json"
`;
  const { program } = parseSource(source);
  // try/finally, unlike this file's other tests: without it a failing assertion skips the close
  // and the leaked server keeps the test process alive, so a regression here would hang the suite
  // instead of reporting.
  try {
    const { report } = await runProgram(program, config, { source });

    assert.equal(report.tests[0]!.ok, false, 'the outage itself must still fail — this is not about swallowing the error');
    assert.match(report.tests[0]!.error ?? '', /got 500/);
    assert.equal(report.tests[1]!.ok, true, 'the second assertion must re-fetch, not replay a cached rejection');
    assert.equal(report.tests[2]!.ok, true);

    // Exactly two fetches: one that failed and was evicted, one that succeeded and was kept. Three
    // would mean the cache stopped working; one is the bug.
    assert.equal(server.received.get('/openapi.json')!.length, 2, 'the failure evicts, the success caches');
  } finally {
    await server.close();
  }
});

// A12-03. `loadSchemaDoc` issues a real `sendRequest` that, until this milestone, appeared in no
// step, no trace and no report — while `interpreter.ts` states the opposite principle in as many
// words one screen away: "a retry is visible evidence in the report, never a silent, invisible
// extra round-trip (P#5/P#16)". The fetch is `checkHostAllowed`-gated, i.e. already understood to
// be security-relevant, and it is the *only* evidence that A12-02's cache is doing anything.
//
// Asserted on `step.detail` rather than on the fetch itself, deliberately: the finding is not "no
// request is made" (one plainly is — the assertions pass) but "nothing a reader can see records
// it". `detail` is the string that reaches report.html, results.json, --format ndjson and
// junit.xml, so proving it there proves every sink at once.
test('the schema-document fetch is visible evidence in the step that caused it, and a cache hit says so (A12-03)', async () => {
  const server = await startWidgetServer();
  const config = testConfig(server.baseUrl);
  const source = `test "the assertion that pays for the document"
  api GET /widgets/good
  expect body matches schema "Widget" from "/openapi.json"

test "the assertion that rides on it"
  api GET /widgets/good
  expect body matches schema "Widget" from "/openapi.json"
`;
  const { program } = parseSource(source);
  try {
    const { report } = await runProgram(program, config, { source });
    assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));

    const detailOf = (i: number) => report.tests[i]!.steps.find((s) => s.kind === 'expect')!.detail!;

    // The first assertion names the document, what it cost, and what came back — enough for a
    // reader to tell that *this* step made the round-trip.
    assert.match(detailOf(0), /fetched schema document "[^"]*\/openapi\.json"/);
    assert.match(detailOf(0), /2 schemas/, 'the document has Widget and Address');
    assert.match(detailOf(0), /\d+ms/);

    // The second says the opposite, in as many words. Before this, the only signal that it did no
    // I/O was its duration — a number nothing distinguishes from a fast fetch.
    assert.match(detailOf(1), /from cache/);
    assert.doesNotMatch(detailOf(1), /fetched schema document/);

    // The control on the control: the two details must genuinely differ. A `provenance()` that
    // returned one constant string would satisfy both `match`es above and prove nothing.
    assert.notEqual(detailOf(0), detailOf(1));
    assert.equal(server.received.get('/openapi.json')!.length, 1, 'and the claim must be true — one fetch, not two');
  } finally {
    await server.close();
  }
});

// -- `D460`: the same loader, now serving a second reader with different needs ---------------------
//
// `M137c`'s crawl seeds itself from `paths`; this matcher validates against `components.schemas`.
// Until this milestone the loader demanded the second and discarded the first, so the document below
// — routes, no component schemas, entirely legal, and what a NestJS app with only primitive
// responses actually publishes — was a **hard error**, thrown while *seeding*, about *validation*.
// That is the wrong-cause failure `D443` allocated `TF068` to avoid, arriving from the wrong layer.

const PATHS_ONLY_DOC = {
  openapi: '3.0.0',
  paths: {
    '/products': { get: { responses: { '200': { description: 'ok' } } } },
    '/health': { get: { responses: { '200': { description: 'ok' } } } },
  },
};

test('D460: a document with `paths` and no `components.schemas` loads for a crawl', async () => {
  const server = await startFixtureServer({
    '/openapi.json': (_req, res) => json(res, 200, PATHS_ONLY_DOC),
  });
  try {
    const loaded = await loadOpenApiDocumentForCrawl('/openapi.json', testConfig(server.baseUrl));
    // The routes survive the trip — the whole point of widening the cached value.
    assert.deepEqual(Object.keys(loaded.document.paths ?? {}), ['/products', '/health']);
    assert.equal(loaded.url, `${server.baseUrl}/openapi.json`, 'a relative seed resolves against the default service, like `api GET /path`');
    assert.equal(loaded.fetched, true);
  } finally {
    await server.close();
  }
});

test('D460: and the schema matcher still refuses that same document, in the same words', async () => {
  // The requirement moved; it did not soften. This is the control that says so — an author who has
  // seen this sentence before must see it again, from the reader that actually cannot proceed.
  const server = await startFixtureServer({
    '/openapi.json': (_req, res) => json(res, 200, PATHS_ONLY_DOC),
    '/widgets/good': (_req, res) => json(res, 200, { id: 'w1' }),
  });
  const source = `test "a document with no component schemas"
  api GET /widgets/good
  expect body matches schema "Widget" from "/openapi.json"
`;
  const { program } = parseSource(source);
  try {
    const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
    assert.equal(report.ok, false);
    assert.match(report.tests[0]!.error ?? '', /has no `components\.schemas` to validate against/);
    // And it now carries the provenance clause every other outcome of this matcher has — the reader
    // learns which document was consulted, not just that one was unusable.
    assert.match(report.tests[0]!.error ?? '', /fetched schema document/);
  } finally {
    await server.close();
  }
});

test('D460: the crawl seed shares the one cache, so a seed and an assertion cost one fetch between them', async () => {
  // Not a performance test. A second, naive cache is the specific mistake `D460` names, and what it
  // would re-earn is `A12-02`'s: a rejection cached for the life of the process. Sharing the existing
  // one is how the crawl inherits the eviction rule instead of reimplementing it.
  const server = await startFixtureServer({
    '/openapi.json': (_req, res) => json(res, 200, { ...PATHS_ONLY_DOC, ...OPENAPI_DOC }),
    '/widgets/good': (_req, res) => json(res, 200, { id: 'w1', name: 'Widget', address: { city: 'Springfield' } }),
  });
  const config = testConfig(server.baseUrl);
  const source = `test "the assertion that rides on the seed's fetch"
  api GET /widgets/good
  expect body matches schema "Widget" from "/openapi.json"
`;
  const { program } = parseSource(source);
  try {
    const seeded = await loadOpenApiDocumentForCrawl('/openapi.json', config);
    assert.equal(seeded.fetched, true);
    const { report } = await runProgram(program, config, { source });
    assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
    assert.equal(server.received.get('/openapi.json')!.length, 1, 'one document, one fetch, two readers');
    assert.match(report.tests[0]!.steps.find((s) => s.kind === 'expect')!.detail!, /from cache/);
  } finally {
    await server.close();
  }
});

test('D460: a crawl seed is refused by `allow hosts` before any I/O, like every other document fetch', async () => {
  // `checkHostAllowed` reached the crawl for free by being inside `loadSchemaDoc`, which is the
  // argument for the reuse. Pinned anyway: this is `D342`'s permission door on the arc's most
  // traffic-originating construct, and "we got it for free" is exactly the kind of property a
  // refactor silently removes.
  const server = await startFixtureServer({ '/openapi.json': (_req, res) => json(res, 200, PATHS_ONLY_DOC) });
  const config = { ...testConfig(server.baseUrl), allowHosts: ['example.invalid'] };
  try {
    await assert.rejects(
      () => loadOpenApiDocumentForCrawl('/openapi.json', config),
      (err: Error) => {
        assert.match(err.message, /allow hosts/i);
        return true;
      },
    );
    assert.equal(server.received.get('/openapi.json'), undefined, 'refused before any I/O, not after');
  } finally {
    await server.close();
  }
});

test('D460: `normalizeOpenApiSchema` is the one folder of OpenAPI 3.0 `nullable`, now shared', () => {
  // Exported so synthesis reads a NestJS schema the way the validator does. Two implementations
  // would drift, and the drift is invisible: a synthesizer that missed `nullable` would send a value
  // the validator on the other side of the same document would have accepted as `null`.
  assert.deepEqual(normalizeOpenApiSchema({ type: 'string', nullable: true }), { type: ['string', 'null'] });
  assert.deepEqual(
    normalizeOpenApiSchema({ type: 'object', properties: { a: { type: 'number', nullable: true } } }),
    { type: 'object', properties: { a: { type: ['number', 'null'] } } },
  );
  assert.deepEqual(normalizeOpenApiSchema({ type: 'string' }), { type: 'string' }, 'and it leaves an ordinary schema exactly as it found it');
});

test('a failing schema assertion still reports where the schema came from (A12-03)', async () => {
  const server = await startWidgetServer();
  const config = testConfig(server.baseUrl);
  const source = `test "widget missing a required field"
  api GET /widgets/bad
  expect body matches schema "Widget" from "/openapi.json"
`;
  const { program } = parseSource(source);
  try {
    const { report } = await runProgram(program, config, { source });
    assert.equal(report.ok, false);
    const detail = report.tests[0]!.steps.find((s) => s.kind === 'expect')!.detail!;
    // The failure path is where provenance matters most: "the response doesn't match the schema"
    // is only actionable once you know *which* document was consulted, and when.
    assert.match(detail, /fetched schema document "[^"]*\/openapi\.json"/);
    assert.match(detail, /to match schema "Widget"/, 'the original message must survive, not be replaced');
  } finally {
    await server.close();
  }
});
