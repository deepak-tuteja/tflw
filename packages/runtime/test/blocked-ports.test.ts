// M125b2, `FU-20a`, D260. `api GET` against `localhost:9` or `localhost:19` used to answer a bare
// `fetch failed` and nothing else, while `localhost:45999` — nothing listening either — got a full
// "connection refused; is the service actually listening at that host:port?". The filed framing was
// "privileged ports"; the real axis is the WHATWG fetch standard's blocked-ports list, which the
// fetch implementation refuses before it opens a socket, producing an error with **no `code`** for
// `fetchErrorHint`'s switch to match on.
//
// The hint is therefore derived from the URL, and the risk that creates is the one this file
// exists to hold: a hand-carried copy of someone else's constant can drift. So the first test
// checks `blockedPortList` against what `fetch()` *actually* refuses, rather than against itself —
// a divergence fails loudly here instead of quietly degrading a message in production. That is the
// trade D260 makes: the coupling is to observable behaviour under test, not to undici's prose at
// runtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { fetchErrorHint } from '../src/http.js';
import { blockedPort, blockedPortList } from '../src/blockedPorts.js';
import { testConfig } from './support.js';

/** Does `fetch` refuse this port outright? A blocked port fails with no `code` on the cause and
 * without touching the network — no listener, no timeout, no egress. A port that is *not* blocked
 * gets a real connect attempt against 127.0.0.1 and comes back ECONNREFUSED, which is a different
 * shape and just as immediate. */
async function refusedByTheStandard(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`);
    return false;
  } catch (err) {
    const cause = (err as { cause?: { code?: unknown } }).cause;
    return cause !== undefined && typeof cause.code !== 'string';
  }
}

test('every port tflw calls blocked is one fetch actually refuses (D260 conformance)', async () => {
  const disagreed: number[] = [];
  for (const port of blockedPortList) {
    if (!(await refusedByTheStandard(port))) disagreed.push(port);
  }
  assert.deepEqual(disagreed, [], `tflw lists these as blocked but fetch does not refuse them: ${disagreed.join(', ')}`);
});

test('a port tflw does not list is not refused by fetch either (the other direction)', async () => {
  // The list is only useful if it is also not *over*-broad — an entry that fetch happily connects
  // to would mislabel a genuine connection failure as a standards refusal. Sampled rather than
  // exhaustive: sweeping all 65535 would be a minute of syscalls to restate the same property.
  const notListed = [80, 443, 3000, 3001, 5173, 8080, 8443, 45999];
  for (const port of notListed) {
    assert.equal(blockedPort(`http://127.0.0.1:${port}/`), undefined, `tflw should not list ${port}`);
    assert.equal(await refusedByTheStandard(port), false, `fetch should not refuse ${port}`);
  }
});

test('blockedPort reads the URL, not the error', () => {
  assert.equal(blockedPort('http://localhost:19/orders'), 19);
  assert.equal(blockedPort('https://example.test:993/'), 993);
  assert.equal(blockedPort('http://localhost:45999/orders'), undefined);
});

test('a URL with no explicit port is never blocked (the scheme default is not on the list)', () => {
  assert.equal(blockedPort('http://example.test/orders'), undefined);
  assert.equal(blockedPort('https://example.test/orders'), undefined);
  // …and stating it the other way, since `URL.port` is `''` rather than `80`/`443` here: the two
  // defaults must not be on the list in the first place, or every ordinary request would light up.
  assert.equal(blockedPort('http://example.test:80/orders'), undefined);
  assert.equal(blockedPort('https://example.test:443/orders'), undefined);
});

test('an unparseable URL answers undefined rather than throwing (a hint must never be the thing that fails)', () => {
  assert.equal(blockedPort('not a url'), undefined);
  assert.equal(blockedPort(''), undefined);
  assert.equal(fetchErrorHint(new TypeError('fetch failed'), 'not a url'), '');
});

test('fetchErrorHint names the blocked port, the mechanism, and who refused it', () => {
  // The cause carries no `code` — the shape a blocked port actually produces (measured: a plain
  // `Error` whose own properties are `["stack","message"]`).
  const err = new TypeError('fetch failed', { cause: new Error('bad port') });
  const hint = fetchErrorHint(err, 'http://localhost:19/orders');
  assert.match(hint, /port 19/);
  assert.match(hint, /blocked-ports list/);
  assert.match(hint, /no request was sent/);
  assert.match(hint, /not tflw and not your network/);
});

test('fetchErrorHint never reads the cause message (D260 — the coupling that would fail closed)', () => {
  // The whole decision in one assertion: with undici's prose changed to anything at all, the hint
  // is unchanged, because the port is what it was derived from. A `case '…bad port…'` implementation
  // passes every other test in this file and fails only this one.
  const renamed = new TypeError('fetch failed', { cause: new Error('blocked port (undici v8 wording)') });
  assert.match(fetchErrorHint(renamed, 'http://localhost:19/orders'), /port 19/);
  const noCauseAtAll = new TypeError('fetch failed');
  assert.match(fetchErrorHint(noCauseAtAll, 'http://localhost:19/orders'), /port 19/);
});

test('a recognised cause code still wins over the blocked-port hint', () => {
  // Ordering is a precondition, not a preference: a blocked port produces no code, so reaching the
  // port check at all means nothing matched. This pins that a coded failure is never relabelled.
  const err = new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
  const hint = fetchErrorHint(err, 'http://localhost:19/orders');
  assert.match(hint, /DNS lookup failed/);
  assert.doesNotMatch(hint, /blocked-ports/);
});

test('the row itself: `api GET` against a blocked port is diagnosed end to end', async () => {
  const source = `test "x"\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig('http://127.0.0.1:19'), { source });

  assert.equal(report.ok, false);
  const error = report.tests[0]!.error ?? '';
  assert.match(error, /port 19 is on the fetch standard's blocked-ports list/, error);
});

test('the control: an unblocked closed port still gets the connection-refused diagnosis', async () => {
  // Without this, deleting the `code` switch entirely and always printing the port hint would pass
  // the test above. An ephemeral port bound and immediately closed is guaranteed refused right now,
  // with no network egress and no DNS.
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));

  const source = `test "x"\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(`http://127.0.0.1:${port}`), { source });

  assert.equal(report.ok, false);
  const error = report.tests[0]!.error ?? '';
  assert.match(error, /connection refused/, error);
  assert.doesNotMatch(error, /blocked-ports/, error);
});
