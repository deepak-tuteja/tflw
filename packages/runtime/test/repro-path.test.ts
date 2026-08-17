// `reproPathFor` (M137d, PLAN_M137_PENTEST_TIER4.md D478) — the path a repro writes so that re-issuing
// it lands where the finding was.
//
// **This is a regression test for a defect that was latent since `M130b` and passed every gate.** The
// emitter used `new URL(url).pathname + search`. An env whose `api` is `https://host/v1` turns
// `api POST /vuln/notes` into `https://host/v1/vuln/notes`, so that pathname emits `api POST
// /v1/vuln/notes` — which tflw resolves against the base a **second** time. The repro dials
// `/v1/v1/vuln/notes`, gets a 404, finds no leak in the body, and **passes**. Every authorization repro
// this project's own acceptance corpus has ever written had it; found by running one, not by reading.
//
// The failure mode is why these tests are exhaustive over the shapes rather than sampling them: a wrong
// path does not error, it produces a green file. That is indistinguishable from a fixed application, and
// it is the artifact a maintainer closes the ticket with.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reproPathFor } from '../src/interpreter.js';
import type { ResolvedConfig } from '../src/types.js';

/** Only `apiBaseUrl` is read, so this is the whole config surface this function has. */
function cfg(apiBaseUrl: string | undefined): ResolvedConfig {
  return { apiBaseUrl, envName: 'local', services: {} } as unknown as ResolvedConfig;
}

test("a base URL's own path prefix is stripped, which is the whole bug", () => {
  const c = cfg('https://localhost:8443/v1');
  assert.equal(reproPathFor('https://localhost:8443/v1/vuln/notes', c), '/vuln/notes');
  // The exact shape the acceptance corpus produced, query included.
  assert.equal(reproPathFor('https://localhost:8443/v1/vuln/lookup?q=%3Ctflw%3E', c), '/vuln/lookup?q=%3Ctflw%3E');
});

test('a base URL with no path prefix leaves the path alone', () => {
  // The reason this went unnoticed for seven milestones: every fixture server in the test suite is
  // `http://127.0.0.1:<port>` with no prefix, where the buggy and the correct answer are identical.
  const c = cfg('http://127.0.0.1:4001');
  assert.equal(reproPathFor('http://127.0.0.1:4001/orders/7?sort=asc', c), '/orders/7?sort=asc');
});

test('a trailing slash on the base URL is not left behind in the path', () => {
  const c = cfg('https://localhost:8443/v1/');
  assert.equal(reproPathFor('https://localhost:8443/v1/vuln/notes', c), '/vuln/notes');
});

test('a request AT the base URL itself is `/`, not the empty string', () => {
  // An empty path would emit `api GET ` — a file that does not parse. `/` is what a suite would write.
  const c = cfg('https://localhost:8443/v1');
  assert.equal(reproPathFor('https://localhost:8443/v1', c), '/');
});

test('a prefix that only LOOKS like one is not stripped', () => {
  // `/v1` must not match `/v10/...`: string-prefix matching without the boundary would turn
  // `/v10/orders` into `0/orders`, which is a different endpoint that may well exist.
  const c = cfg('https://localhost:8443/v1');
  assert.equal(reproPathFor('https://localhost:8443/v10/orders', c), '/v10/orders');
});

test('another origin keeps its absolute URL, because it cannot be written relative', () => {
  // Deliberately the loud failure: an absolute URL in a suite is conditional on `allow hosts`
  // (TF057/TF058), so a recipient without it gets a diagnostic naming the reason. The alternative — a
  // plausible-looking relative path pointing at the wrong host — fails by passing.
  const c = cfg('https://localhost:8443/v1');
  assert.equal(reproPathFor('https://elsewhere.test/v1/orders', c), 'https://elsewhere.test/v1/orders');
});

test('an env with no default `api` returns the URL rather than throwing', () => {
  // `resolveBaseUrl` throws for this env, and a repro emitter is not a place to raise it: the finding is
  // already made and the run is already failing for its own reasons.
  assert.equal(reproPathFor('https://localhost:8443/v1/orders', cfg(undefined)), 'https://localhost:8443/v1/orders');
});

test('an unparseable URL is returned as-is rather than becoming a wrong path', () => {
  assert.equal(reproPathFor('not a url', cfg('https://localhost:8443/v1')), 'not a url');
});
