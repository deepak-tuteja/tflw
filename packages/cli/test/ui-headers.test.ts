// `tflw ui`'s response headers (`M239` `C`, `D1278`) — the review's S5, which measured the served
// page with no `Content-Security-Policy`, no `X-Content-Type-Options` and no framing rule, from a
// product whose own scanner ships `sec/csp-missing` as a serious finding.
//
// The load-bearing test here is the last one: tflw's OWN security rules, run over the page's
// response the way `expect page has no security findings` runs them over anyone else's. A gate
// that asserted header strings by hand could drift from what the scanner ships; this one cannot.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { runSecurityScan, type Observation } from '@tflw/runtime';
import { UiServer, documentPolicy } from '../src/ui-server.js';

const here = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(here, '..', 'src', 'cli.ts');
const tsxLoader = fileURLToPath(import.meta.resolve('tsx'));
const TOKEN = 'm239-headers-token-0123456789abcdef';
const bearer = { authorization: `Bearer ${TOKEN}` };
const EXAMPLE_REPORT = join(here, '..', '..', 'ui', 'fixtures', 'example-reports', 'local');

/** A stub bundle: the placeholder the real `index.html` carries on its one inline script. */
async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-headers-'));
  await writeFile(join(dir, 'tflw.config'), 'env local default\n  api "http://127.0.0.1:1"\n', 'utf8');
  await mkdir(join(dir, 'static', 'assets'), { recursive: true });
  await writeFile(join(dir, 'static', 'index.html'), '<!doctype html><html><head><script nonce="__TFLW_NONCE__">document.documentElement.dataset.t="1"</script></head><body><div id="root"></div><script type="module" src="./assets/app.js"></script></body></html>', 'utf8');
  await writeFile(join(dir, 'static', 'assets', 'app.js'), 'export {};', 'utf8');
  await cp(EXAMPLE_REPORT, join(dir, 'report', 'runs', 'local'), { recursive: true });
  return dir;
}

function observed(url: string, res: Response): Observation {
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  return { url, headers, setCookie: res.headers.getSetCookie(), requestHeaders: {} };
}

test('`documentPolicy` admits exactly the inline scripts a document carries, by hash, and never `unsafe-inline` for script', () => {
  const html = '<script>alert(1)</script><script type="module" src="./a.js"></script><script>\nx()\n</script>';
  const policy = documentPolicy(html, { framedBy: 'none' });
  const sha = (s: string) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;
  assert.match(policy, new RegExp(`script-src 'self' ${sha('alert(1)').replace(/[+/=]/g, (c) => `\\${c}`)} ${sha('\nx()\n').replace(/[+/=]/g, (c) => `\\${c}`)};`));
  assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /base-uri 'none'; form-action 'none'/);
  assert.match(policy, /worker-src 'none'/);
  // No inline script, no hash — the control that says the hashes above came from the input.
  assert.match(documentPolicy('<script src="a.js"></script>', { framedBy: 'none' }), /script-src 'self';/);
  // The trace viewer's shape: framed by the page, and a service worker over `blob:`.
  const viewer = documentPolicy('<script>1</script>', { framedBy: 'self', workers: true });
  assert.match(viewer, /frame-ancestors 'self'/);
  assert.match(viewer, /worker-src 'self' blob:/);
  // …and no `frame-src` and no `default-src` to fall back to: its snapshot frames are documents a
  // service worker synthesises, whose URL is empty and matches no source (see `documentPolicy`).
  assert.doesNotMatch(viewer, /frame-src|default-src/);
  assert.match(viewer, /object-src 'none'/);
  assert.match(viewer, /script-src 'self' 'sha256-[^']+' blob:;/);
  // The page's own: a nonce beside the hash.
  assert.match(documentPolicy('', { framedBy: 'none', nonce: 'abc' }), /script-src 'self' 'nonce-abc';/);
});

test('the page is served under a per-response nonce that reaches its one inline script, with nosniff, no referrer and no framing', async () => {
  const dir = await fixture();
  const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'static'), token: TOKEN });
  try {
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;
    const first = await fetch(`${base}/?token=${TOKEN}`);
    assert.equal(first.status, 200);
    const html = await first.text();
    const csp = first.headers.get('content-security-policy') ?? '';
    const nonce = /'nonce-([A-Za-z0-9_-]+)'/.exec(csp)?.[1];
    assert.ok(nonce, `the policy names a nonce: ${csp}`);
    assert.ok(html.includes(`<script nonce="${nonce}">`), 'the same nonce is on the inline script');
    assert.ok(!html.includes('__TFLW_NONCE__'), 'the placeholder does not reach the browser');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-src 'self'/); // the trace viewer's frame
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(first.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(first.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.match(first.headers.get('set-cookie') ?? '', /^tflw-ui-token=[^;]+; Path=\/; HttpOnly; SameSite=Strict$/);
    // Per response: two loads, two nonces.
    const second = await fetch(`${base}/?token=${TOKEN}`);
    assert.notEqual(/'nonce-([A-Za-z0-9_-]+)'/.exec(second.headers.get('content-security-policy') ?? '')?.[1], nonce);
    // JSON answers carry the locked-down policy and the same two headers.
    const json = await fetch(`${base}/api/project`, { headers: bearer });
    assert.equal(json.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'");
    assert.equal(json.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(json.headers.get('referrer-policy'), 'no-referrer');
    // Static assets too, and they need no token.
    const asset = await fetch(`${base}/assets/app.js`);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('`report.html` is served under a policy admitting its own inline script by hash; every other report file gets none', async () => {
  const dir = await fixture();
  const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'static'), token: TOKEN });
  try {
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;
    const report = await fetch(`${base}/api/reports/local/report.html`, { headers: bearer });
    assert.equal(report.status, 200);
    const html = await report.text();
    const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    assert.ok(inline.length >= 1, 'the example report carries an inline script — the shape this policy exists for');
    const csp = report.headers.get('content-security-policy') ?? '';
    for (const script of inline) assert.ok(csp.includes(`'sha256-${createHash('sha256').update(script).digest('base64')}'`), 'each inline script is admitted by its hash');
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
    assert.match(csp, /frame-ancestors 'none'/);
    const results = await fetch(`${base}/api/reports/local/results.json`, { headers: bearer });
    assert.equal(results.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'");
  } finally {
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('tflw\'s own security rules, run over the served page, find nothing about its headers — the scanner and the product agree', async () => {
  const dir = await fixture();
  const ui = new UiServer({ root: dir, cliEntry, execArgv: ['--import', tsxLoader], staticDir: join(dir, 'static'), token: TOKEN });
  try {
    const port = await ui.listen(0);
    const base = `http://127.0.0.1:${port}`;
    for (const [url, init] of [
      [`${base}/?token=${TOKEN}`, {}],
      [`${base}/api/reports/local/report.html`, { headers: bearer }],
      [`${base}/api/project`, { headers: bearer }],
    ] as const) {
      const res = await fetch(url, init);
      const scan = runSecurityScan(observed(url, res));
      const ids = scan.findings.map((f) => f.id);
      for (const rule of ['sec/csp-missing', 'sec/x-frame-options', 'sec/nosniff-missing', 'sec/cookie-samesite-none', 'sec/cookie-not-httponly', 'sec/server-version-disclosure']) {
        assert.ok(!ids.includes(rule as never), `${rule} on ${url}: ${JSON.stringify(scan.findings)}`);
      }
      // What IS allowed to fire, and why: `sec/cookie-not-secure` — the cookie has no `Secure`
      // attribute because the server is loopback-only over http, where `Secure` would make Safari
      // drop it and would protect nothing (no network carries it). Stated rather than silenced.
      const others = ids.filter((id) => id !== 'sec/cookie-not-secure' && id !== 'sec/hsts-missing');
      assert.deepEqual(others, [], `unexpected findings on ${url}: ${JSON.stringify(scan.findings)}`);
    }
    // The negative control: the same scanner against a bare response does fire, so the empty
    // list above is a verdict and not an idle pack.
    const bare = runSecurityScan({ url: `${base}/`, headers: { 'content-type': 'text/html; charset=utf-8' }, setCookie: [], requestHeaders: {} });
    assert.ok(bare.findings.some((f) => f.id === 'sec/csp-missing'), 'the pack fires on a page with no headers');
  } finally {
    await ui.close();
    await rm(dir, { recursive: true, force: true });
  }
});
