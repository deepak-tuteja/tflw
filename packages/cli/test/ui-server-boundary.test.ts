// `tflw ui`'s boundary (`M239` `A`–`B`, `D1316`/`D1317`) — what a request the page did NOT make
// gets. The review (`REVIEW_ENTERPRISE_READINESS.md` S1–S3, S6, S8) forged three of these by hand
// against the served page and each was answered; this file is those forgeries, kept.
//
// The route list the token test walks is READ OFF THE ROUTER'S SOURCE, not written here: a route
// added to `ui-server.ts` tomorrow joins this test the same day, which is the only way a 401
// "on every route" can stay true of every route.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UiServer, boundaryRefusal, hostnameOf, credentialOf, BODY_CAP, RUNS_KEPT, type RunRecord } from '../src/ui-server.js';

const here = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(here, '..', 'src', 'cli.ts');
const tsxLoader = fileURLToPath(import.meta.resolve('tsx'));
const TOKEN = 'm239-boundary-token-0123456789abcdef';
const bearer = { authorization: `Bearer ${TOKEN}` };
const cookie = { cookie: `tflw-ui-token=${TOKEN}` };

/** A project with one test, a report a reader could open, and a file OUTSIDE it a symlink points at. */
async function fixture(): Promise<{ dir: string; outside: string }> {
  const parent = await mkdtemp(join(tmpdir(), 'tflw-boundary-'));
  const dir = join(parent, 'project');
  await mkdir(dir);
  await writeFile(join(dir, 'tflw.config'), 'env local default\n  api "http://127.0.0.1:1"\n', 'utf8');
  await writeFile(join(dir, 'health.tflw'), 'test "health"\n  api GET /health\n  expect status equals 200\n', 'utf8');
  const outside = join(parent, 'outside.tflw');
  await writeFile(outside, 'test "outside"\n  api GET /health\n', 'utf8');
  await symlink(outside, join(dir, 'linked.tflw'));
  await mkdir(join(dir, 'report', 'runs', 'kept'), { recursive: true });
  await writeFile(join(dir, 'report', 'runs', 'kept', 'report.html'), '<!doctype html><html><body><script>document.title="r"</script></body></html>', 'utf8');
  await writeFile(join(dir, 'report', 'runs', 'kept', 'results.json'), '{"tests":[]}', 'utf8');
  return { dir, outside };
}

function fakeRequest(headers: Record<string, string>, method = 'GET', url = '/api/project'): { req: Parameters<typeof boundaryRefusal>[0]; url: URL } {
  return { req: { headers, method } as unknown as Parameters<typeof boundaryRefusal>[0], url: new URL(url, 'http://127.0.0.1') };
}

test('`Host` is judged on its hostname only, so `ssh -L` with a different local port keeps working while DNS rebinding does not', () => {
  assert.equal(hostnameOf('127.0.0.1:4141'), '127.0.0.1');
  assert.equal(hostnameOf('localhost'), 'localhost');
  assert.equal(hostnameOf('[::1]:4141'), '[::1]');
  assert.equal(hostnameOf('evil.example:4141'), 'evil.example');
  assert.equal(hostnameOf(undefined), null);
  assert.equal(hostnameOf(''), null);
  // The forwarding case: the browser's `Host` carries the LOCAL port, whatever the server bound.
  const forwarded = fakeRequest({ host: '127.0.0.1:9000', ...bearer });
  assert.equal(boundaryRefusal(forwarded.req, forwarded.url, TOKEN), null);
  // A name an attacker's DNS pointed at loopback: the browser sends it as `Host`, and it is refused.
  const rebound = fakeRequest({ host: 'evil.example:4141', ...bearer });
  assert.equal(boundaryRefusal(rebound.req, rebound.url, TOKEN)?.status, 421);
  const nohost = fakeRequest({ ...bearer });
  assert.equal(boundaryRefusal(nohost.req, nohost.url, TOKEN)?.status, 421);
});

test('`Origin`, when sent, must be the page\'s own — `http://<Host>` — else 403; a same-site page on another loopback port is exactly what this catches', () => {
  const own = fakeRequest({ host: '127.0.0.1:4141', origin: 'http://127.0.0.1:4141', ...bearer }, 'POST');
  assert.equal(boundaryRefusal(own.req, own.url, TOKEN), null);
  const ownCased = fakeRequest({ host: 'LOCALHOST:4141', origin: 'http://localhost:4141', ...bearer }, 'POST');
  assert.equal(boundaryRefusal(ownCased.req, ownCased.url, TOKEN), null);
  for (const origin of ['https://evil.example', 'http://127.0.0.1:9999', 'http://localhost:4141', 'null']) {
    const forged = fakeRequest({ host: '127.0.0.1:4141', origin, ...bearer }, 'POST');
    assert.equal(boundaryRefusal(forged.req, forged.url, TOKEN)?.status, 403, `origin ${origin}`);
  }
});

test('the token has three carriers and each is accepted only where the page needs it', () => {
  const header = fakeRequest({ host: '127.0.0.1:1', ...bearer });
  assert.equal(credentialOf(header.req, header.url, TOKEN), 'header');
  const query = fakeRequest({ host: '127.0.0.1:1' }, 'GET', `/api/runs/x/events?token=${TOKEN}`);
  assert.equal(credentialOf(query.req, query.url, TOKEN), 'query');
  const jar = fakeRequest({ host: '127.0.0.1:1', cookie: `other=1; tflw-ui-token=${TOKEN}` });
  assert.equal(credentialOf(jar.req, jar.url, TOKEN), 'cookie');
  const wrong = fakeRequest({ host: '127.0.0.1:1', authorization: 'Bearer nope', cookie: 'tflw-ui-token=nope' }, 'GET', '/api/project?token=nope');
  assert.equal(credentialOf(wrong.req, wrong.url, TOKEN), null);
  // A prefix of the token is not the token — the comparison is on length first.
  const prefix = fakeRequest({ host: '127.0.0.1:1', authorization: `Bearer ${TOKEN.slice(0, 10)}` });
  assert.equal(credentialOf(prefix.req, prefix.url, TOKEN), null);

  // Where the cookie is spent: the report files a browser opens on its own, and the trace viewer.
  const download = fakeRequest({ host: '127.0.0.1:1', ...cookie }, 'GET', '/api/reports/kept/report.html');
  assert.equal(boundaryRefusal(download.req, download.url, TOKEN), null);
  const viewer = fakeRequest({ host: '127.0.0.1:1', ...cookie }, 'GET', '/trace/index.html');
  assert.equal(boundaryRefusal(viewer.req, viewer.url, TOKEN), null);
  // …and where it is not: a same-site `<img src>` must not be able to start a `pick` session.
  const pick = fakeRequest({ host: '127.0.0.1:1', ...cookie }, 'GET', '/api/pick?path=x.tflw');
  assert.equal(boundaryRefusal(pick.req, pick.url, TOKEN)?.status, 401);
  const list = fakeRequest({ host: '127.0.0.1:1', ...cookie }, 'GET', '/api/reports');
  assert.equal(boundaryRefusal(list.req, list.url, TOKEN)?.status, 401, 'the report LIST is a fetch, and a fetch carries the header');
});

test('a body is JSON or it is 415 before it is read, and over the cap it is 413 — a bodiless POST needs neither', () => {
  const plain = fakeRequest({ host: '127.0.0.1:1', 'content-type': 'text/plain', 'content-length': '12', ...bearer }, 'POST', '/api/run');
  assert.equal(boundaryRefusal(plain.req, plain.url, TOKEN)?.status, 415);
  const form = fakeRequest({ host: '127.0.0.1:1', 'content-type': 'application/x-www-form-urlencoded', 'transfer-encoding': 'chunked', ...bearer }, 'POST', '/api/run');
  assert.equal(boundaryRefusal(form.req, form.url, TOKEN)?.status, 415);
  const json = fakeRequest({ host: '127.0.0.1:1', 'content-type': 'application/json; charset=utf-8', 'content-length': '2', ...bearer }, 'PUT', '/api/file');
  assert.equal(boundaryRefusal(json.req, json.url, TOKEN), null);
  const empty = fakeRequest({ host: '127.0.0.1:1', 'content-length': '0', ...bearer }, 'POST', '/api/runs/x/cancel');
  assert.equal(boundaryRefusal(empty.req, empty.url, TOKEN), null, 'a cancel has no body and no content type, and that is fine');
  const huge = fakeRequest({ host: '127.0.0.1:1', 'content-type': 'application/json', 'content-length': String(BODY_CAP + 1), ...bearer }, 'POST', '/api/run');
  assert.equal(boundaryRefusal(huge.req, huge.url, TOKEN)?.status, 413);
});

test('no refusal names a path — the page gets a sentence and the terminal gets the rest', () => {
  for (const [headers, method, url] of [
    [{ host: 'evil.example' }, 'GET', '/api/project'],
    [{ host: '127.0.0.1:1', origin: 'http://evil.example' }, 'POST', '/api/run'],
    [{ host: '127.0.0.1:1' }, 'GET', '/api/project'],
    [{ host: '127.0.0.1:1', 'content-type': 'text/plain', 'content-length': '1', ...bearer }, 'POST', '/api/run'],
  ] as const) {
    const r = fakeRequest({ ...headers }, method, url);
    const refusal = boundaryRefusal(r.req, r.url, TOKEN);
    assert.ok(refusal !== null);
    assert.doesNotMatch(refusal.error, /\/Users\/|\/home\/|\/tmp\/|[A-Z]:\\/, refusal.error);
  }
});

test('every route the router knows answers 401 without the token — the list is read off `ui-server.ts`, so a new route cannot forget', async () => {
  const source = await readFile(join(here, '..', 'src', 'ui-server.ts'), 'utf8');
  const literal = [...source.matchAll(/path === '(\/api\/[a-z-]+)'/g)].map((m) => m[1]!);
  const routes = new Set<string>([...literal, '/api/runs/x/events', '/api/runs/x/cancel', '/api/runs/x/stderr', '/api/reports/kept/results.json', '/api/reports/kept/report.html', '/api/nothing-here', '/trace/', '/trace/index.html']);
  assert.ok(routes.size >= 14, `the router's own literals were read: ${[...routes].join(' ')}`);

  const { dir } = await fixture();
  const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static'), token: TOKEN });
  try {
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;
    for (const route of routes) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
        const res = await fetch(`${base}${route}`, { method });
        assert.equal(res.status, 401, `${method} ${route} without the token`);
        assert.match(((await res.json()) as { error: string }).error, /token/);
        const withCookie = await fetch(`${base}${route}`, { method, headers: cookie });
        const navigational = method === 'GET' && (route.startsWith('/trace') || /^\/api\/reports\/[^/]+\/.+/.test(route));
        if (navigational) assert.notEqual(withCookie.status, 401, `${method} ${route} with the cookie is a navigation the browser makes on its own`);
        else assert.equal(withCookie.status, 401, `${method} ${route} with only the cookie`);
      }
    }
    // The controls: the same routes answer something other than 401 with the header.
    assert.equal((await fetch(`${base}/api/project`, { headers: bearer })).status, 200);
    assert.equal((await fetch(`${base}/api/reports/kept/report.html`, { headers: cookie })).status, 200);
    // The bundle itself is public — nothing in it is the reader's — and the page is not.
    assert.equal((await fetch(`${base}/favicon.svg`)).status, 404, 'no static dir here, so 404 rather than 401 says the asset route needs no token');
    const bare = await fetch(`${base}/`);
    assert.equal(bare.status, 401);
    assert.match(await bare.text(), /the URL <code>tflw ui<\/code> printed/);
    assert.equal(bare.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(bare.headers.get('referrer-policy'), 'no-referrer');
    assert.match(bare.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    // A browser that opened the page once and comes back to the bare origin is sent to a URL
    // that carries the token — a reload keeps working.
    const back = await fetch(`${base}/`, { headers: cookie, redirect: 'manual' });
    assert.equal(back.status, 302);
    assert.equal(back.headers.get('location'), `/?token=${TOKEN}`);
  } finally {
    await ui.close();
    await rm(dirname(dir), { recursive: true, force: true });
  }
});

test('over the wire: a forged `Origin` is 403, a forged `Host` 421, `text/plain` 415 with the body unread, and a body over the cap 413 — chunked included', async () => {
  const { dir } = await fixture();
  const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static'), token: TOKEN });
  try {
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;
    const forgedOrigin = await fetch(`${base}/api/run`, { method: 'POST', headers: { ...bearer, origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(forgedOrigin.status, 403);
    // `fetch` will not send a `Host` of one's choosing (a forbidden header name), which is the
    // browser's rule and not the server's; a raw request is what a rebinding attack amounts to.
    const rebound = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: '/api/project', method: 'GET', headers: { ...bearer, host: 'evil.example' } }, (res) => resolve(res.statusCode ?? 0));
      req.on('error', reject);
      req.end();
    });
    assert.equal(rebound, 421);
    // `text/plain` with a body the JSON parser would reject: 415 says the type was judged and the
    // body was not, where 400 would say the body was read and parsed.
    const plain = await fetch(`${base}/api/run`, { method: 'POST', headers: { ...bearer, 'content-type': 'text/plain' }, body: 'not json at all' });
    assert.equal(plain.status, 415);
    const big = await fetch(`${base}/api/file`, { method: 'PUT', headers: { ...bearer, 'content-type': 'application/json' }, body: JSON.stringify({ path: 'x.tflw', text: 'x'.repeat(BODY_CAP + 16) }) });
    assert.equal(big.status, 413);
    // Chunked, so no `Content-Length` announces it: the cap is on the bytes read, not the header.
    const chunked = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: '/api/file', method: 'PUT', headers: { ...bearer, 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, (res) => resolve(res.statusCode ?? 0));
      req.on('error', reject);
      req.write('{"path":"x.tflw","text":"');
      const piece = 'y'.repeat(64 * 1024);
      for (let sent = 0; sent <= BODY_CAP; sent += piece.length) req.write(piece);
      req.end('"}');
    }).catch(() => 413); // the server drops the socket past the cap; a reset before the status is the same refusal
    assert.equal(chunked, 413);
    // The control: a well-formed run request is accepted.
    const ok = await fetch(`${base}/api/run`, { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' }, body: JSON.stringify({ files: ['health.tflw'] }) });
    assert.equal(ok.status, 202, await ok.text());
  } finally {
    await ui.close();
    await rm(dirname(dir), { recursive: true, force: true });
  }
});

test('`files` in a run request stay inside the project: `../x.tflw` and a symlink out of the root are 400 naming the entry, and `?trace=` opens report files only', async () => {
  const { dir } = await fixture();
  const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'no-static'), token: TOKEN });
  try {
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;
    const post = (files: string[]) => fetch(`${base}/api/run`, { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' }, body: JSON.stringify({ files }) });
    const up = await post(['../outside.tflw']);
    assert.equal(up.status, 400);
    assert.match(((await up.json()) as { error: string }).error, /`\.\.\/outside\.tflw` is outside the project/);
    const linked = await post(['linked.tflw']);
    assert.equal(linked.status, 400, 'a symlink is judged by where it points');
    assert.match(((await linked.json()) as { error: string }).error, /`linked\.tflw` is outside/);
    const absolute = await post([await realpath(join(dirname(dir), 'outside.tflw'))]);
    assert.equal(absolute.status, 400);
    const missing = await post(['nope.tflw']);
    assert.equal(missing.status, 400);
    assert.match(((await missing.json()) as { error: string }).error, /no `nope\.tflw`/);
    const inside = await post(['health.tflw']);
    assert.equal(inside.status, 202, 'the control');

    for (const trace of ['http://evil.example/x.zip', 'http://127.0.0.1/tflw.config', '/api/project', 'file:///etc/passwd', '%%%']) {
      const res = await fetch(`${base}/trace/index.html?trace=${encodeURIComponent(trace)}`, { headers: bearer });
      assert.equal(res.status, 400, `?trace=${trace}`);
    }
    const allowed = await fetch(`${base}/trace/index.html?trace=${encodeURIComponent(`${base}/api/reports/kept/trace.zip`)}`, { headers: bearer });
    assert.notEqual(allowed.status, 400, 'a report file of this project is what the viewer is for');
  } finally {
    await ui.close();
    await rm(dirname(dir), { recursive: true, force: true });
  }
});

test('`runs keep 3` in `tflw.config` leaves three runs, read at each run (`M241` `E`, `D1325`)', async () => {
  const { dir } = await fixture();
  await writeFile(join(dir, 'tflw.config'), 'runs keep 3\nenv local default\n  api "http://127.0.0.1:1"\n', 'utf8');
  const stub = join(dir, 'stub.mjs');
  await writeFile(stub, 'process.stdout.write(JSON.stringify({ type: "run:end" }) + "\\n");\n', 'utf8');
  const ui = new UiServer({ root: dir, cliEntry: stub, execArgv: [], staticDir: join(dir, 'no-static'), token: TOKEN });
  try {
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const record = await ui.startRun({});
      ids.push(record.id);
      for (let waited = 0; waited < 200; waited++) {
        const runs = (await (await fetch(`${base}/api/runs`, { headers: bearer })).json()) as RunRecord[];
        if (runs.find((r) => r.id === record.id)?.status !== 'running') break;
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    const runs = (await (await fetch(`${base}/api/runs`, { headers: bearer })).json()) as RunRecord[];
    assert.deepEqual(runs.map((r) => r.id), ids.slice(-3).reverse(), 'the newest three, newest first');
  } finally {
    await ui.close();
    await rm(dirname(dir), { recursive: true, force: true });
  }
});

test(`the server remembers the last ${RUNS_KEPT} runs — the ${RUNS_KEPT + 1}st evicts the first`, async () => {
  const { dir } = await fixture();
  const stub = join(dir, 'stub.mjs');
  await writeFile(stub, 'process.stdout.write(JSON.stringify({ type: "run:end" }) + "\\n");\n', 'utf8');
  const ui = new UiServer({ root: dir, cliEntry: stub, execArgv: [], staticDir: join(dir, 'no-static'), token: TOKEN });
  try {
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;
    const ids: string[] = [];
    for (let i = 0; i <= RUNS_KEPT; i++) {
      const record = await ui.startRun({});
      ids.push(record.id);
      // Let it end: eviction never drops a running run, so the list is judged on ended ones.
      for (let waited = 0; waited < 200; waited++) {
        const runs = (await (await fetch(`${base}/api/runs`, { headers: bearer })).json()) as RunRecord[];
        if (runs.find((r) => r.id === record.id)?.status !== 'running') break;
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    const runs = (await (await fetch(`${base}/api/runs`, { headers: bearer })).json()) as RunRecord[];
    assert.equal(runs.length, RUNS_KEPT);
    assert.ok(!runs.some((r) => r.id === ids[0]), 'the first run is gone');
    assert.ok(runs.some((r) => r.id === ids[ids.length - 1]), 'the newest is kept');
    assert.equal((await fetch(`${base}/api/runs/${ids[0]}/stderr`, { headers: bearer })).status, 404);
  } finally {
    await ui.close();
    await rm(dirname(dir), { recursive: true, force: true });
  }
});
