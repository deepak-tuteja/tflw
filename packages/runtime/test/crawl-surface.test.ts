// `seed openapi` — the documented surface read and turned into requests (`M137c`, `D435`/`D436`).
//
// The module is pure, so these are unit tests over hand-written documents rather than fixture-server
// runs, and they are organised around the two properties the file exists to keep rather than around
// its functions:
//
//  1. **Everything enumerated is accounted for**, so `D435`'s disclosure line is arithmetic. A
//     surface that silently dropped what it could not build would report a smaller denominator and
//     read as better coverage.
//  2. **Every invented value is named.** `D370`'s warning is verbatim that a schema *"does not tell
//     you a request that reaches real code"*, and synthesis cannot make that false. It can only say
//     which parts tflw made up, so a `404` on a route whose id we chose reads as *we guessed* rather
//     than as *this route is missing*.
//
// The refusals get as much attention as the successes, for `D436`'s reason: an operation that produces
// no request has to say so, because the alternative — sending something plausible and judging what
// comes back — is the false-negative engine that decision rejected an alternative to avoid.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateOpenApiSurface, matchesRoutePattern } from '../src/crawlSurface.js';
import type { OpenApiDocument } from '../src/contract.js';

function doc(paths: Record<string, unknown>, components?: Record<string, unknown>): OpenApiDocument {
  return { paths, ...(components ? { components } : {}) } as OpenApiDocument;
}

const OK = { responses: { '200': { description: 'ok' } } };

// -- everything enumerated is accounted for --------------------------------------------------------

test('every operation produces either a request or a stated reason, and the two add up', () => {
  const surface = enumerateOpenApiSurface(
    doc({
      '/products': { get: OK, post: { ...OK, requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object' } } } } } },
      '/health': { get: OK },
      '/legacy': { trace: OK },
    }),
  );
  // Four operations described, four accounted for. This is the arithmetic `D435` needs: a planned
  // total the crawl can print before it sends anything, with nothing missing from the denominator.
  assert.equal(surface.requests.length + surface.skipped.length, 4);
  assert.deepEqual(surface.requests.map((r) => `${r.method} ${r.template}`), ['GET /products', 'GET /health']);
  assert.deepEqual(surface.skipped.map((s) => `${s.method} ${s.template}`), ['POST /products', 'TRACE /legacy']);
});

test('the surface is in the document`s own order', () => {
  // A generated document lists paths in controller-registration order, which is the order an author
  // recognises. Sorting them would make two runs of one suite diff for no reason anyone can act on.
  const surface = enumerateOpenApiSurface(doc({ '/zebra': { get: OK }, '/apple': { get: OK }, '/mango': { get: OK } }));
  assert.deepEqual(surface.requests.map((r) => r.template), ['/zebra', '/apple', '/mango']);
});

test('a method tflw has no step for is reported by name, not ignored', () => {
  const surface = enumerateOpenApiSurface(doc({ '/x': { trace: OK } }));
  assert.equal(surface.requests.length, 0);
  assert.match(surface.skipped[0]!.reason, /tflw has no step for this method/);
  assert.equal(surface.skipped[0]!.method, 'TRACE', 'the verb is named, so a reader can see what was left out');
});

test('a path item or operation that is not an object is a stated skip, not a crash', () => {
  // A document is untrusted input off the network. Every one of these is a real shape a
  // hand-edited or proxy-mangled document arrives in.
  const surface = enumerateOpenApiSurface(doc({ '/a': 'nonsense', '/b': { get: 42 }, '/c': { get: OK } }));
  assert.deepEqual(surface.requests.map((r) => r.template), ['/c']);
  assert.equal(surface.skipped.length, 2);
});

test('`mutating` comes from the one `isSafeMethod` every other gate reads', () => {
  // Carried on the plan rather than re-derived at the send site, so the disclosure line and the gate
  // cannot disagree about which requests are writes.
  const surface = enumerateOpenApiSurface(doc({ '/x': { get: OK, head: OK, options: OK, post: OK, put: OK, patch: OK, delete: OK } }));
  const mutating = surface.requests.filter((r) => r.mutating).map((r) => r.method);
  assert.deepEqual(mutating, ['POST', 'PUT', 'PATCH', 'DELETE']);
});

// -- every invented value is named ------------------------------------------------------------------

test('a path parameter is filled and disclosed as invented', () => {
  const surface = enumerateOpenApiSurface(
    doc({ '/products/{id}': { get: { ...OK, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }] } } }),
  );
  assert.equal(surface.requests[0]!.path, '/products/1');
  assert.equal(surface.requests[0]!.template, '/products/{id}', 'the template is the identity, and it survives');
  assert.deepEqual(surface.requests[0]!.invented, ['path parameter `id`']);
});

test('the document`s own words win over anything synthesis would choose, and are then NOT invented', () => {
  // `example`, `default`, `enum` — in that order. A value the API's authors wrote down is the whole
  // difference between a crawl that sends what a request looks like and one that sends "tflw" at
  // everything, and it is not a guess, so it is not disclosed as one.
  const surface = enumerateOpenApiSurface(
    doc({
      '/a/{k}': { get: { ...OK, parameters: [{ name: 'k', in: 'path', schema: { type: 'string', example: 'sku-9' } }] } },
      '/b/{k}': { get: { ...OK, parameters: [{ name: 'k', in: 'path', schema: { type: 'string', default: 'dflt' } }] } },
      '/c/{k}': { get: { ...OK, parameters: [{ name: 'k', in: 'path', schema: { enum: ['first', 'second'] } }] } },
    }),
  );
  assert.deepEqual(surface.requests.map((r) => r.path), ['/a/sku-9', '/b/dflt', '/c/first']);
  assert.deepEqual(surface.requests.flatMap((r) => r.invented), [], 'nothing here was tflw`s idea');
});

test('a path parameter the document never describes is filled anyway, and says it had nothing to go on', () => {
  // A slightly-wrong document is common, and a crawl that refused one would report a smaller surface
  // than the app has. Both facts are in the disclosure: invented, and undocumented.
  const surface = enumerateOpenApiSurface(doc({ '/orders/{orderId}': { get: OK } }));
  assert.equal(surface.requests[0]!.path, '/orders/1');
  assert.match(surface.requests[0]!.invented[0]!, /path parameter `orderId`.*does not describe/);
});

test('a synthesized value that would change the route is percent-encoded', () => {
  // `inputCorpus.ts` learned this the hard way: an unencoded `/` or `..` stops being a value and
  // becomes part of the path, `new URL` normalises it away before the request leaves the process, and
  // so the request sent is not the request planned with nothing saying so.
  const surface = enumerateOpenApiSurface(
    doc({ '/files/{name}': { get: { ...OK, parameters: [{ name: 'name', in: 'path', schema: { enum: ['../etc/passwd'] } }] } } }),
  );
  assert.equal(surface.requests[0]!.path, '/files/..%2Fetc%2Fpasswd');
});

test('D467: a REQUIRED query parameter is sent, an optional one is not, and a documented optional one is', () => {
  // The rule that keeps the invented list short enough to read: synthesis invents a value only where
  // the request cannot be made without one. An invented `?limit=1` adds surface the crawl cannot
  // interpret — a `400` from a value we chose is not a finding about anything.
  const surface = enumerateOpenApiSurface(
    doc({
      '/search': {
        get: {
          ...OK,
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'sort', in: 'query', schema: { type: 'string', default: 'newest' } },
          ],
        },
      },
    }),
  );
  assert.equal(surface.requests[0]!.path, '/search?q=tflw&sort=newest');
  assert.deepEqual(surface.requests[0]!.invented, ['query parameter `q`'], 'only `q` was tflw`s to choose');
});

test('a required header or cookie parameter is a refusal, and the reason says why it is not invented', () => {
  // Every other synthesized value is data. A header is credential-shaped, and the crawl's whole
  // reachability story rests on the credential being the declared principal's — a request carrying a
  // header tflw made up has an auth story no reader can reconstruct.
  const surface = enumerateOpenApiSurface(
    doc({
      '/admin': { get: { ...OK, parameters: [{ name: 'X-Tenant', in: 'header', required: true, schema: { type: 'string' } }] } },
      '/public': { get: { ...OK, parameters: [{ name: 'X-Tenant', in: 'header', schema: { type: 'string' } }] } },
    }),
  );
  assert.deepEqual(surface.requests.map((r) => r.template), ['/public'], 'an OPTIONAL one is simply not sent');
  assert.match(surface.skipped[0]!.reason, /requires a `X-Tenant` header the crawl will not invent/);
  assert.match(surface.skipped[0]!.reason, /credential-shaped/);
});

test('a path-item parameter reaches every operation, and an operation`s own overrides it', () => {
  const surface = enumerateOpenApiSurface(
    doc({
      '/t/{id}': {
        parameters: [{ name: 'id', in: 'path', schema: { enum: ['shared'] } }],
        get: OK,
        delete: { ...OK, parameters: [{ name: 'id', in: 'path', schema: { enum: ['own'] } }] },
      },
    }),
  );
  assert.deepEqual(surface.requests.map((r) => r.path), ['/t/shared', '/t/own']);
});

// -- bodies ----------------------------------------------------------------------------------------

test('a body is built from the required fields, resolving a `$ref`', () => {
  const surface = enumerateOpenApiSurface(
    doc(
      { '/products': { post: { ...OK, requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/NewProduct' } } } } } } },
      {
        schemas: {
          NewProduct: {
            type: 'object',
            required: ['name', 'priceCents', 'active', 'tags'],
            properties: {
              name: { type: 'string' },
              priceCents: { type: 'integer', minimum: 100 },
              active: { type: 'boolean' },
              tags: { type: 'array', items: { type: 'string' } },
              description: { type: 'string' },
            },
          },
        },
      },
    ),
  );
  const request = surface.requests[0]!;
  assert.deepEqual(request.body, { name: 'tflw', priceCents: 100, active: false, tags: [] });
  assert.equal(request.contentType, 'application/json');
  assert.deepEqual(request.invented, ['body field `name`', 'body field `priceCents`', 'body field `active`', 'body field `tags`']);
  assert.equal((request.body as Record<string, unknown>).description, undefined, 'an optional field is not invented');
});

test('a required boolean is `false`, and that is a safety choice rather than a coin toss', () => {
  // `SAFE_METHODS`' comment states the principle: of the two wrong answers only one of them does
  // something to somebody's data. A synthesized `force: true` is a flag nobody asked to set.
  const surface = enumerateOpenApiSurface(
    doc({ '/purge': { post: { ...OK, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['force', 'deleteAll'], properties: { force: { type: 'boolean' }, deleteAll: { type: 'boolean' } } } } } } } } }),
  );
  assert.deepEqual(surface.requests[0]!.body, { force: false, deleteAll: false });
});

test('a string honours the `format` a validator would enforce', () => {
  // Ignoring `format` produces a `400` from a validator, and a `400` is indistinguishable from a
  // hardened endpoint — the exact false negative `D436` rejected an alternative to avoid.
  const surface = enumerateOpenApiSurface(
    doc({ '/signup': { post: { ...OK, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'when', 'home', 'code'], properties: { email: { type: 'string', format: 'email' }, when: { type: 'string', format: 'date-time' }, home: { type: 'string', format: 'uri' }, code: { type: 'string', minLength: 8 } } } } } } } } }),
  );
  assert.deepEqual(surface.requests[0]!.body, {
    email: 'tflw@example.invalid',
    when: '2020-01-01T00:00:00.000Z',
    home: 'https://example.invalid/tflw',
    code: 'tflwxxxx',
  });
});

test('OpenAPI 3.0 `nullable` is folded by the same function the validator uses, so a required field is still a value', () => {
  // `D460` exported `normalizeOpenApiSchema` for exactly this: two copies of the fold would drift, and
  // a synthesizer that missed it would send `null` where the validator on the other side of the same
  // document expects a string.
  const surface = enumerateOpenApiSurface(
    doc({ '/x': { post: { ...OK, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['note'], properties: { note: { type: 'string', nullable: true } } } } } } } } }),
  );
  assert.deepEqual(surface.requests[0]!.body, { note: 'tflw' });
});

test('D467 stops at the body`s edge: an optional body with a schema IS sent', () => {
  // The boundary, and it is a decision rather than an oversight. Inside the body the rule holds —
  // optional properties are skipped. The body itself is the request's substance, not an addition to
  // it, so a `POST /ping` sent without the body its own document describes would produce a `400`
  // about tflw's caution and get recorded as an unreachable route. That is `D436`'s named false
  // negative, reached from the careful direction.
  const withSchema = enumerateOpenApiSurface(
    doc({ '/ping': { post: { ...OK, requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['x'], properties: { x: { type: 'string' } } } } } } } } }),
  );
  assert.deepEqual(withSchema.requests[0]!.body, { x: 'tflw' });
  assert.deepEqual(withSchema.requests[0]!.invented, ['body field `x`']);

  // With no schema there is nothing to synthesize, so `required` is the only signal left and it
  // decides: an optional undescribed body gets nothing, a required one gets an empty object.
  const noSchema = enumerateOpenApiSurface(doc({ '/ping': { post: { ...OK, requestBody: { content: { 'application/json': {} } } } } }));
  assert.equal(noSchema.requests[0]!.body, undefined);
  assert.equal(noSchema.requests[0]!.contentType, undefined, 'no body means no content type, structurally');
  assert.deepEqual(noSchema.requests[0]!.invented, []);

  const required = enumerateOpenApiSurface(doc({ '/ping': { post: { ...OK, requestBody: { required: true, content: { 'application/json': {} } } } } }));
  assert.deepEqual(required.requests[0]!.body, {});
  assert.match(required.requests[0]!.invented[0]!, /empty `application\/json` body/);
});

test('a body shape synthesis does not build names the content types it found', () => {
  const surface = enumerateOpenApiSurface(
    doc({ '/upload': { post: { ...OK, requestBody: { required: true, content: { 'multipart/form-data': {}, 'application/octet-stream': {} } } } } }),
  );
  assert.match(surface.skipped[0]!.reason, /`multipart\/form-data`, `application\/octet-stream`/);
  assert.match(surface.skipped[0]!.reason, /synthesizes JSON only/);
});

test('a `+json` structured suffix is JSON — `application/merge-patch+json` is what PATCH documents', () => {
  const surface = enumerateOpenApiSurface(
    doc({ '/x': { patch: { ...OK, requestBody: { required: true, content: { 'application/merge-patch+json': { schema: { type: 'object', required: ['a'], properties: { a: { type: 'string' } } } } } } } } }),
  );
  assert.deepEqual(surface.requests[0]!.body, { a: 'tflw' });
});

test('a REQUIRED recursive `$ref` is a fact about the document, reported as one', () => {
  // `Category.parent: Category` is ordinary in a generated document. Optional, nothing happens —
  // optional properties are skipped. Required, the schema describes an infinitely deep object, so
  // there is no request to build, and the reason says that rather than announcing a recursion limit.
  const recursive = doc(
    { '/cats': { post: { ...OK, requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Category' } } } } } } },
    { schemas: { Category: { type: 'object', required: ['parent'], properties: { parent: { $ref: '#/components/schemas/Category' } } } } },
  );
  assert.equal(enumerateOpenApiSurface(recursive).requests.length, 0);
  assert.match(enumerateOpenApiSurface(recursive).skipped[0]!.reason, /recursive through `#\/components\/schemas\/Category`.*infinitely deep/);

  const optional = doc(
    { '/cats': { post: { ...OK, requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Category' } } } } } } },
    { schemas: { Category: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, parent: { $ref: '#/components/schemas/Category' } } } } },
  );
  assert.deepEqual(enumerateOpenApiSurface(optional).requests[0]!.body, { name: 'tflw' }, 'the same cycle, optional, is a non-event');
});

test('a `$ref` outside the document, or to something absent, is refused by name', () => {
  // Resolving an external ref means fetching a second document, which is a second `checkHostAllowed`
  // decision — a feature, not a detail, so it is refused rather than quietly followed.
  const surface = enumerateOpenApiSurface(
    doc({
      '/a': { post: { ...OK, requestBody: { required: true, content: { 'application/json': { schema: { $ref: 'https://elsewhere.invalid/schema.json#/X' } } } } } },
      '/b': { post: { ...OK, requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Gone' } } } } } },
    }),
  );
  assert.match(surface.skipped[0]!.reason, /outside this document/);
  assert.match(surface.skipped[1]!.reason, /does not contain/);
});

test('`allOf` merges and `oneOf` takes the branch the author wrote first', () => {
  const surface = enumerateOpenApiSurface(
    doc({
      '/a': { post: { ...OK, requestBody: { required: true, content: { 'application/json': { schema: { allOf: [{ type: 'object', required: ['x'], properties: { x: { type: 'string' } } }, { type: 'object', required: ['y'], properties: { y: { type: 'integer' } } }] } } } } } },
      '/b': { post: { ...OK, requestBody: { required: true, content: { 'application/json': { schema: { oneOf: [{ type: 'object', required: ['first'], properties: { first: { type: 'string' } } }, { type: 'object', required: ['second'], properties: { second: { type: 'string' } } }] } } } } } },
    }),
  );
  assert.deepEqual(surface.requests[0]!.body, { x: 'tflw', y: 1 });
  assert.deepEqual(surface.requests[1]!.body, { first: 'tflw' });
});

// -- `exclude` -------------------------------------------------------------------------------------

test('D466: `exclude` drops a subtree and names the pattern that did it', () => {
  // The pattern, not just the fact: an author with three `exclude` lines needs to know which one
  // swallowed the route. This is the one entry in the channel that is somebody's instruction rather
  // than tflw's limitation, and it reads that way.
  const surface = enumerateOpenApiSurface(
    doc({ '/vuln/notes': { get: OK }, '/vuln/notes/{id}': { get: OK, delete: OK }, '/products': { get: OK } }),
    ['/vuln/**'],
  );
  assert.deepEqual(surface.requests.map((r) => r.template), ['/products']);
  assert.deepEqual(surface.skipped.map((s) => s.method), ['*', '*'], 'one row per template — the author wrote one pattern');
  assert.equal(surface.skipped[0]!.reason, 'excluded by this crawl\'s `exclude "/vuln/**"`');
});

test('D466: `*` stays inside one path segment and `**` crosses them', () => {
  // The conventional reading, and the difference matters: `/admin/*` excluding `/admin/users/{id}`
  // would drop a subtree an author meant to keep.
  assert.equal(matchesRoutePattern('/admin/users', '/admin/*'), true);
  assert.equal(matchesRoutePattern('/admin/users/{id}', '/admin/*'), false);
  assert.equal(matchesRoutePattern('/admin/users/{id}', '/admin/**'), true);
  assert.equal(matchesRoutePattern('/products/{id}', '/products/{id}'), true, 'a literal template, braces and all');
  assert.equal(matchesRoutePattern('/products', '/**'), true);
  assert.equal(matchesRoutePattern('/products.json', '/products'), false, 'and it is a full match, not a prefix');
});

test('D466: exclusion is matched against the TEMPLATE, so it cannot depend on an invented id', () => {
  // If the pattern met the filled-in path, whether a route was excluded would turn on the value
  // synthesis happened to choose — a config whose meaning changes with tflw's guess.
  const document = doc({ '/products/{id}': { get: { ...OK, parameters: [{ name: 'id', in: 'path', schema: { type: 'integer' } }] } } });
  assert.equal(enumerateOpenApiSurface(document, ['/products/{id}']).requests.length, 0, 'the template excludes');
  assert.equal(enumerateOpenApiSurface(document, ['/products/1']).requests.length, 1, 'the synthesized path does not');
});

test('a document with no `paths` at all enumerates to nothing, and nothing is not an error here', () => {
  // The runtime `TF068` door is what turns an empty surface into a diagnostic (`D443`), and it lives
  // at the crawl, not here — this function's answer to an empty document is an empty surface.
  assert.deepEqual(enumerateOpenApiSurface({} as OpenApiDocument), { requests: [], skipped: [] });
});
