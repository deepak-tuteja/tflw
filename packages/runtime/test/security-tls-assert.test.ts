// The TLS half of `expect response has no … security violations`, wired end to end (M128c,
// D288/D291/D297/D298) — a real https fixture, a real handshake, and the interpreter in between.
//
// `tls-probe.test.ts` covers the prober in isolation and `security-rules.test.ts` covers what the
// two rules decide. What is only observable here is the *joins*: that an https response gets probed
// at all, that a plaintext one does not, that D291's refusal reaches the not-applicable listing
// instead of vanishing, and that a session's establishment scan deliberately leaves TLS alone.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:https';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { testConfig } from './support.js';
import { TlsProber } from '../src/tlsProbe.js';
import type { ResolvedConfig } from '../src/types.js';

let certDir: string;
let https: Server;
let httpsUrl: string;
let plain: HttpServer;
let plainUrl: string;

/** Both fixtures answer identically apart from the scheme, so every difference below is the scheme's
 * doing and not the route's. */
const BODY = '{"ok":true}';
const HEADERS = { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' };

async function port(server: Server | HttpServer): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  return address.port;
}

before(async () => {
  certDir = mkdtempSync(join(tmpdir(), 'tflw-sec-tls-'));
  const keyPath = join(certDir, 'key.pem');
  const certPath = join(certDir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', keyPath, '-out', certPath, '-days', '1', '-nodes', '-subj', '/CN=127.0.0.1'], {
    stdio: 'ignore',
  });
  https = createServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (req, res) => {
    const hardened = req.url === '/hardened' ? { 'strict-transport-security': 'max-age=31536000' } : {};
    res.writeHead(200, { ...HEADERS, ...hardened }).end(BODY);
  });
  httpsUrl = `https://127.0.0.1:${await port(https)}`;
  plain = createHttpServer((_req, res) => res.writeHead(200, HEADERS).end(BODY));
  plainUrl = `http://127.0.0.1:${await port(plain)}`;
});

after(async () => {
  await new Promise<void>((resolve) => https.close(() => resolve()));
  await new Promise<void>((resolve) => plain.close(() => resolve()));
  rmSync(certDir, { recursive: true, force: true });
});

/** `insecure`, because the fixture is self-signed — and `authorizedTargets` covering it, because
 * D291 is enforced against wherever the run actually ended up. */
function config(over: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    ...testConfig(httpsUrl, {}, true),
    authorizedTargets: [{ target: httpsUrl, reason: 'self-hosted test fixture' }],
    ...over,
  };
}

const SOURCE = 'test "t"\n  api GET /a\n  expect response has no security violations\n';

async function assertionDetail(cfg: ResolvedConfig, source = SOURCE): Promise<string> {
  const { program } = parseSource(source);
  const { report } = await runProgram(program, cfg, { source });
  const t = report.tests[0]!;
  const steps = t.kind === 'functional' ? t.steps : [];
  const asserts = steps.filter((s) => s.kind === 'expect' || s.kind === 'check');
  return asserts[asserts.length - 1]!.detail ?? '';
}

test('an https response is probed, so both TLS rules become applicable', async () => {
  const detail = await assertionDetail(config());
  // 12 considered, 5 applicable: the two unconditional rules (nosniff, server-version), hsts because
  // the scheme is https, and the two TLS rules — which the probe answered for, so they are applicable
  // rather than standing down. Without the probe wired in they would be 2 of the 7 that stand down,
  // which is what makes this count the assertion that the wiring happened.
  assert.match(detail, /12 rules — 5 applicable, 7 not applicable/);
  assert.doesNotMatch(detail, /could not be evaluated/);
});

test('a modern fixture trips neither TLS rule — the negative case, live', async () => {
  const detail = await assertionDetail(config());
  assert.doesNotMatch(detail, /sec\/tls-version-old:/);
  assert.doesNotMatch(detail, /sec\/tls-weak-cipher:/);
  // The one finding an unhardened https fixture does produce, so this is not passing vacuously.
  assert.match(detail, /sec\/hsts-missing/);
});

test('a plaintext response is never probed, and says so in the static words', async () => {
  const detail = await assertionDetail(
    { ...testConfig(plainUrl), authorizedTargets: [{ target: plainUrl, reason: 'self-hosted test fixture' }] },
    'test "t"\n  api GET /a\n  expect response has no critical security violations\n',
  );
  // A `critical` floor over plaintext engages nothing at all — D285's verdict, which is where the
  // not-applicable listing is printed. The TLS rules are `serious`, so the floor drops them from the
  // pack entirely (D296) and they are correctly absent from the listing rather than in it.
  assert.match(detail, /had no power to fail/);
  assert.doesNotMatch(detail, /sec\/tls-/);
});

test('D291: an origin no declaration covers stands the TLS rules down with the reason', async () => {
  // The assertion still runs — this is not an error — but the two rules that needed a connection
  // report why they could not have one, rather than quietly joining the silent majority.
  const detail = await assertionDetail(config({ authorizedTargets: [{ target: 'https://elsewhere.example', reason: 'not this one' }] }));
  assert.match(detail, /12 rules — 3 applicable, 9 not applicable/);
  // Both rules, one line, because one connection failure blocked both.
  assert.match(detail, /note: sec\/tls-version-old, sec\/tls-weak-cipher could not be evaluated — .*no `authorized target` covers/);
});

test('a probe that cannot connect is not-applicable, not a failed assertion', async () => {
  // The verdict must still come from the other ten rules — a blocked probe degrades the scan, it
  // does not decide it.
  const refused = await assertionDetail(config({ authorizedTargets: [] }));
  assert.match(refused, /sec\/hsts-missing/); // the real finding still lands
  assert.match(refused, /could not be evaluated/);
  assert.doesNotMatch(refused, /sec\/tls-version-old:/); // and produced no finding of its own
});

test('a degraded probe is announced on a PASSING assertion too — no silent caps', async () => {
  // The case this note exists for. A hardened response over https whose probe never connected would
  // otherwise print a clean green line, and a reader would reasonably conclude the protocol version
  // had been checked and found fine.
  const hardened = await assertionDetail(
    config({ authorizedTargets: [] }),
    'test "t"\n  api GET /hardened\n  expect response has no security violations\n',
  );
  assert.match(hardened, /response has no security violations — 12 rules — 3 applicable/);
  assert.match(hardened, /note: sec\/tls-version-old, sec\/tls-weak-cipher could not be evaluated/);
});

test('the probe runs once for the whole run, not once per assertion', async () => {
  // Two assertions, two api steps, one host. D288's cache is a run-level promise map, so a second
  // assertion cannot open a second handshake — and if it did, this would still pass, which is why
  // `tls-probe.test.ts` counts handshakes directly. What this pins is that the second assertion gets
  // the *same answer*, i.e. that the cached value is reused rather than re-derived per step.
  const detail = await assertionDetail(config(), 'test "t"\n  api GET /a\n  expect response has no security violations\n  api GET /a\n  expect response has no security violations\n');
  assert.match(detail, /12 rules — 5 applicable, 7 not applicable/);
});

test('a floor that excludes both TLS rules opens no handshake at all', async () => {
  // D296 narrows the pack before applicability, so a `critical` assertion never consults a TLS rule.
  // Opening a connection whose answer is then discarded is a connection the assertion did not ask
  // for — and this milestone's entire safety story is that tflw's second connection is deliberate,
  // declared and needed.
  //
  // **Counted, not inferred.** An earlier version of this test watched for the *absence* of the
  // degraded note, which cannot distinguish "no probe was opened" from "a probe was opened and its
  // failure had nowhere to be reported, because the floor had already dropped the rules that would
  // have carried it". The mutation sweep is what said so: deleting the guard changed nothing the
  // test could see, and it survived. `RunOptions.tlsProber` exists precisely so a caller can hold the
  // cache, so the test holds it and reads the count.
  const prober = new TlsProber();
  const source = 'test "t"\n  api GET /a\n  expect response has no critical security violations\n';
  const { program } = parseSource(source);
  await runProgram(program, config(), { source, tlsProber: prober });
  assert.equal(prober.handshakeCount, 0);

  // The contrast, same everything, one floor lower: here the TLS rules are in play, so the probe is
  // needed and is opened. Without this half the assertion above would pass on a probe that was
  // broken rather than skipped.
  const needed = new TlsProber();
  const seriousSource = 'test "t"\n  api GET /a\n  expect response has no serious security violations\n';
  const parsed = parseSource(seriousSource);
  await runProgram(parsed.program, config(), { source: seriousSource, tlsProber: needed });
  assert.equal(needed.handshakeCount, 1);
});
