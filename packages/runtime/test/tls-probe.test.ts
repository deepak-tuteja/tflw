// The out-of-band TLS probe (M128c, D288) — against real listeners, not mocks, for the reason
// `insecure-tls.test.ts` above it gives: everything interesting here is a property of an actual
// handshake (which protocol got negotiated, what a refused connection reports, whether a peer that
// accepts and then says nothing is caught at all), and none of those survive being stubbed.
//
// `securityRules.test.ts` covers what the two rules *decide*; this covers where their facts come
// from. The split is deliberate — the rules are pure and can be tested against a TLS 1.0 handshake
// that no listener here can actually produce, which matters because the plan's §3 risk note says
// that positive may not be constructible on OpenSSL 3 at all.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createTlsServer, type Server as TlsServer } from 'node:tls';
import { createServer as createTcpServer, type Server as TcpServer } from 'node:net';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROKEN_SUITE_CANDIDATES, TlsProber, connectionOptions, type TlsProbePolicy } from '../src/tlsProbe.js';

let certDir: string;
let key: Buffer;
let cert: Buffer;
/** A current-defaults TLS listener. */
let modern: TlsServer;
let modernUrl: string;
/** A listener pinned to TLS 1.2, to prove the probe reports the version rather than assuming one. */
let tls12: TlsServer;
let tls12Url: string;
/** Accepts the TCP connection and then never speaks — the hang a connect-only timeout misses. */
let mute: TcpServer;
let muteUrl: string;

/** `insecure`, because every listener here is self-signed. The certificate-verification path gets
 * its own test rather than being switched off wholesale. */
function policy(over: Partial<TlsProbePolicy> = {}): TlsProbePolicy {
  return {
    timeoutMs: 4000,
    insecure: true,
    allowHosts: null,
    authorizedTargets: [{ target: 'https://127.0.0.1', reason: 'self-hosted test fixture' }],
    ...over,
  };
}

/** D291 is origin-scoped and these listeners get an ephemeral port, so the declaration has to be
 * built once the port is known. */
function authorizedFor(url: string, over: Partial<TlsProbePolicy> = {}): TlsProbePolicy {
  return policy({ authorizedTargets: [{ target: new URL(url).origin, reason: 'self-hosted test fixture' }], ...over });
}

async function listen(server: TlsServer | TcpServer): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  return `https://127.0.0.1:${address.port}`;
}

before(async () => {
  certDir = mkdtempSync(join(tmpdir(), 'tflw-tls-probe-'));
  const keyPath = join(certDir, 'key.pem');
  const certPath = join(certDir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', keyPath, '-out', certPath, '-days', '1', '-nodes', '-subj', '/CN=127.0.0.1'], {
    stdio: 'ignore',
  });
  key = readFileSync(keyPath);
  cert = readFileSync(certPath);

  modern = createTlsServer({ key, cert }, (socket) => socket.end());
  modernUrl = await listen(modern);
  tls12 = createTlsServer({ key, cert, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' }, (socket) => socket.end());
  tls12Url = await listen(tls12);
  mute = createTcpServer(() => {
    /* accept, then nothing — deliberately */
  });
  muteUrl = await listen(mute);
});

after(async () => {
  for (const server of [modern, tls12, mute]) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  rmSync(certDir, { recursive: true, force: true });
});

// --- the happy path ----------------------------------------------------------

test('reports the negotiated protocol and cipher from a real handshake', async () => {
  const result = await new TlsProber().probe(modernUrl, authorizedFor(modernUrl));
  assert.ok(result.ok, `expected a successful probe, got ${JSON.stringify(result)}`);
  assert.match(result.protocol, /^TLSv1\.[23]$/);
  assert.ok(result.cipherName.length > 0);
});

test('reports the version the listener actually pins, not a default it assumed', async () => {
  const result = await new TlsProber().probe(tls12Url, authorizedFor(tls12Url));
  assert.ok(result.ok);
  assert.equal(result.protocol, 'TLSv1.2');
});

// --- D288's cache ------------------------------------------------------------

test('one handshake per host:port per run, however many times it is asked', async () => {
  const prober = new TlsProber();
  const pol = authorizedFor(modernUrl);
  const first = await prober.probe(modernUrl, pol);
  const second = await prober.probe(`${modernUrl}/some/other/path`, pol);
  assert.deepEqual(first, second);
  // The count, not just the equality: two probes returning matching facts is exactly what
  // re-handshaking every time would also look like.
  assert.equal(prober.handshakeCount, 1);
});

test('concurrent probes to the same host share one handshake rather than racing', async () => {
  const prober = new TlsProber();
  const pol = authorizedFor(modernUrl);
  const results = await Promise.all([prober.probe(modernUrl, pol), prober.probe(modernUrl, pol), prober.probe(modernUrl, pol)]);
  assert.equal(prober.handshakeCount, 1);
  for (const r of results) assert.ok(r.ok);
});

test('`insecure` is part of the cache key — a strict run never inherits a lax run\'s answer', async () => {
  const prober = new TlsProber();
  const strict = await prober.probe(modernUrl, authorizedFor(modernUrl, { insecure: false }));
  const lax = await prober.probe(modernUrl, authorizedFor(modernUrl, { insecure: true }));
  assert.equal(strict.ok, false);
  assert.equal(lax.ok, true);
  assert.equal(prober.handshakeCount, 2);
});

// --- failures are answers, not exceptions ------------------------------------

test('a self-signed certificate under a strict run is a stated reason, not a throw', async () => {
  const result = await new TlsProber().probe(modernUrl, authorizedFor(modernUrl, { insecure: false }));
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  // The code, because `DEPTH_ZERO_SELF_SIGNED_CERT` is the string an author can act on — it names
  // `insecure true` for anyone who has read SPEC §3.5, where Node's prose does not.
  assert.match(result.reason, /SELF_SIGNED_CERT|SELF_SIGNED/);
});

test('a closed port comes back as ECONNREFUSED, not as a failed assertion', async () => {
  // Bound and immediately released, so the port is real and certainly nobody's.
  const scratch = createTcpServer();
  const url = await listen(scratch);
  await new Promise<void>((resolve) => scratch.close(() => resolve()));
  const result = await new TlsProber().probe(url, authorizedFor(url));
  assert.ok(!result.ok);
  assert.match(result.reason, /ECONNREFUSED/);
});

test('a peer that accepts and then says nothing is caught by the idle timeout', async () => {
  // The failure a connect-only timeout misses entirely: the TCP connection succeeds, so nothing is
  // "refused", and the handshake simply never finishes.
  const result = await new TlsProber().probe(muteUrl, authorizedFor(muteUrl, { timeoutMs: 300 }));
  assert.ok(!result.ok);
  assert.match(result.reason, /went idle after 300ms|did not complete within 300ms/);
});

test('an unparseable URL is a reason, not an exception out of the assertion', async () => {
  const result = await new TlsProber().probe('not a url', policy());
  assert.ok(!result.ok);
  assert.match(result.reason, /could not be parsed/);
});

// --- policy: the two refusals ------------------------------------------------

test('a plaintext URL is refused without opening anything', async () => {
  const prober = new TlsProber();
  const result = await prober.probe('http://127.0.0.1:1/', policy());
  assert.ok(!result.ok);
  assert.match(result.reason, /did not arrive over https/);
  assert.equal(prober.handshakeCount, 0);
});

test('`allow hosts` refuses the probe in its own words, not the request\'s', async () => {
  // C7/M84's discipline. "refusing to send this request" would send an author back to an `api` step
  // that was allowed and did send; the probe is a connection tflw opened on its own initiative.
  const prober = new TlsProber();
  const result = await prober.probe(modernUrl, authorizedFor(modernUrl, { allowHosts: ['api.example.com'] }));
  assert.ok(!result.ok);
  assert.match(result.reason, /refusing to open the TLS probe connection/);
  assert.doesNotMatch(result.reason, /refusing to send this request/);
  assert.equal(prober.handshakeCount, 0);
});

test('D291: an origin no `authorized target` covers is refused, and nothing is opened', async () => {
  // The case the checker cannot see: `TF060` judges the base URL statically, and this is where a
  // redirect actually landed.
  const prober = new TlsProber();
  const result = await prober.probe(modernUrl, policy({ authorizedTargets: [{ target: 'https://elsewhere.example', reason: 'not this one' }] }));
  assert.ok(!result.ok);
  assert.match(result.reason, /no `authorized target` covers https:\/\/127\.0\.0\.1:/);
  // The refusal has to carry the line the author should write, not only the complaint.
  assert.match(result.reason, /authorized target "https:\/\/127\.0\.0\.1:\d+" reason/);
  assert.equal(prober.handshakeCount, 0);
});

test('an empty `authorized target` list refuses everything — the same thing as declaring none', async () => {
  const result = await new TlsProber().probe(modernUrl, policy({ authorizedTargets: [] }));
  assert.ok(!result.ok);
  assert.match(result.reason, /no `authorized target` covers/);
});

test('a declaration is matched by origin, not by path prefix or by wildcard', async () => {
  const origin = new URL(modernUrl).origin;
  // A declaration written with a path still covers the origin it names — the path is not part of an
  // origin, and demanding one would make the declaration mean less than it says.
  const withPath = await new TlsProber().probe(modernUrl, policy({ authorizedTargets: [{ target: `${origin}/v1`, reason: 'fixture' }] }));
  assert.ok(withPath.ok);
  // A different port is a different origin, and must not be covered.
  const otherPort = await new TlsProber().probe(modernUrl, policy({ authorizedTargets: [{ target: 'https://127.0.0.1:1', reason: 'fixture' }] }));
  assert.ok(!otherPort.ok);
});

test('a malformed declaration is skipped rather than crashing the probe', async () => {
  const origin = new URL(modernUrl).origin;
  const result = await new TlsProber().probe(modernUrl, policy({ authorizedTargets: [{ target: 'not a url', reason: 'x' }, { target: origin, reason: 'fixture' }] }));
  assert.ok(result.ok);
});

// --- D298: the probe reaches below Node's client floor ----------------------
//
// Measured before it was written, on Fedora 43 / OpenSSL 3.2.6 / Node 22:
//
//   tls.DEFAULT_MIN_VERSION ............................. TLSv1.2
//   TLS 1.0/1.1 listener, either side ................... not constructible (crypto policy)
//   3DES / RC4 listener ................................. not constructible (not in the provider)
//   NULL-SHA256 listener ................................ constructible, unreachable (!eNULL)
//
// So there is no live positive for either TLS rule to be had here, and the plan's §3 fallback
// applies to both rather than only to `tls-version-old`. What *is* testable, and is the thing that
// actually matters, is that widening the floor does not change the answer for a healthy server —
// because if it did, D298 would be trading a false negative for a false positive.

test('a healthy server still negotiates its best version against the widened floor', async () => {
  const modernResult = await new TlsProber().probe(modernUrl, authorizedFor(modernUrl));
  assert.ok(modernResult.ok);
  assert.equal(modernResult.protocol, 'TLSv1.3');
  // And a listener pinned to 1.2 reports 1.2 rather than being dragged lower by the floor we offer.
  const pinned = await new TlsProber().probe(tls12Url, authorizedFor(tls12Url));
  assert.ok(pinned.ok);
  assert.equal(pinned.protocol, 'TLSv1.2');
});

test('the widened floor is what the probe actually sends, not a comment about it', async () => {
  // Asserted on the options object rather than on a handshake, because on this platform there is no
  // handshake that can tell the difference — a TLS 1.0 listener is not constructible here. Deleting
  // `minVersion` would otherwise be a change no test on any modern machine could detect, which is
  // the definition of a decision that gets silently reverted.
  const { DEFAULT_MIN_VERSION } = await import('node:tls');
  assert.equal(DEFAULT_MIN_VERSION, 'TLSv1.2', 'Node moved its client floor — D298 needs re-reading');
  const options = connectionOptions('example.test', 443, policy());
  assert.equal(options.minVersion, 'TLSv1');
  assert.notEqual(options.minVersion, DEFAULT_MIN_VERSION);
  // And the asymmetry D298 turns on: ciphers are left alone HERE, because widening them drags
  // `@SECLEVEL=0` — a certificate-verification setting — along with them.
  //
  // `M137g`/`D486` widens them on a *different* connection, and this assertion is what keeps the two
  // apart: the verifying probe whose protocol and cipher every assertion reads still offers Node's
  // default list, and only `suiteHandshake` — which reads one bit, verifies nothing and feeds one
  // field — names a suite. If this line ever goes green with a cipher string in it, D298's objection
  // has arrived through the back door.
  assert.equal(options.ciphers, undefined);
});

test('the options carry the run\'s verification stance and SNI, and omit SNI for an IP', () => {
  assert.equal(connectionOptions('example.test', 443, policy({ insecure: false })).rejectUnauthorized, true);
  assert.equal(connectionOptions('example.test', 443, policy({ insecure: true })).rejectUnauthorized, false);
  assert.equal(connectionOptions('example.test', 443, policy()).servername, 'example.test');
  // Sending an IP literal as SNI is a protocol violation some servers reject outright.
  assert.equal(connectionOptions('127.0.0.1', 443, policy()).servername, undefined);
});

// ---------------------------------------------------------------------------
// M137g / D485 / D486 — the offered-suite enumeration.
// ---------------------------------------------------------------------------

/** A listener that offers a broken suite **alongside** a modern one and prefers the modern one.
 *
 * This is the exact host D441 says `sec/tls-weak-cipher` cannot see today: an ordinary client
 * negotiates AES-GCM and goes away happy, while `NULL-SHA256` — no encryption whatsoever — is still
 * in the configuration and still there for anybody who asks. Pinned to TLS 1.2 because TLS 1.3
 * negotiates its suites through a separate list and would let the server answer the modern way to
 * every candidate, making a broken offer look refused. */
function offeringServer(): TlsServer {
  return createTlsServer(
    { key, cert, ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:NULL-SHA256:@SECLEVEL=0', minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' },
    (socket) => socket.end(),
  );
}

function enumPolicy(url: string, over: Partial<TlsProbePolicy> = {}): TlsProbePolicy {
  return authorizedFor(url, { probeCiphers: true, ...over });
}

test('a host that OFFERS a broken suite while negotiating a modern one is caught by enumeration and invisible without it (`D441`)', async () => {
  const server = offeringServer();
  const url = await listen(server);
  try {
    const prober = new TlsProber();

    // The half that ships today, against this host: entirely clean, and correctly so.
    const negotiated = await prober.probe(url, enumPolicy(url));
    assert.equal(negotiated.ok, true);
    assert.ok(negotiated.ok && negotiated.cipherName.includes('AES128-GCM'), `expected a modern suite, got ${negotiated.ok ? negotiated.cipherName : '—'}`);

    // The half M137g adds: the same host, asked what it will accept.
    const offered = await prober.enumerateOffered(url, enumPolicy(url));
    assert.ok(offered, 'an affirmed host should have been enumerated');
    assert.ok(offered.accepted.includes('NULL-SHA256'), `expected NULL-SHA256 to be accepted, got ${JSON.stringify(offered)}`);
    // And it genuinely asked about the others rather than reporting one and stopping.
    assert.ok(offered.refused.length + offered.unaskable.length > 0);
  } finally {
    server.close();
  }
});

test('without `probe ciphers` the answer is undefined — which is NOT an empty offer', async () => {
  const server = offeringServer();
  const url = await listen(server);
  try {
    const prober = new TlsProber();
    const withheld = await prober.enumerateOffered(url, authorizedFor(url, { probeCiphers: false }));
    assert.equal(withheld, undefined);
    // The distinction the rule depends on: a host with a broken offer, unprobed, must not be
    // representable as `{accepted: []}`. If this ever returns an object, the rule reports a clean
    // offer for a host nobody asked.
    assert.notDeepEqual(withheld, { accepted: [], refused: [], unaskable: [] });
  } finally {
    server.close();
  }
});

test('a modern-only listener comes back with an empty `accepted` and a NON-empty `refused` — the evidence it was actually asked', async () => {
  const url = modernUrl;
  const prober = new TlsProber();
  const offered = await prober.enumerateOffered(url, enumPolicy(url));
  assert.ok(offered);
  assert.deepEqual(offered.accepted, []);
  // `M136a`: a scan that could not ask is not a scan that found nothing. An all-`unaskable` result
  // would be a clean bill of health nobody earned, so at least one candidate must have reached the
  // server and been declined by it.
  assert.ok(offered.refused.length > 0, `nothing was actually offered to the server: ${JSON.stringify(offered)}`);
});

test('the ceiling is reported, not hidden — suites this stack cannot offer land in `unaskable`', async () => {
  const url = modernUrl;
  const prober = new TlsProber();
  const offered = await prober.enumerateOffered(url, enumPolicy(url));
  assert.ok(offered);
  // Measured under D486 on OpenSSL 3.2: RC4 and 3DES are not merely refused here, they are absent —
  // our own OpenSSL will not put them in a ClientHello. That is a different fact from "the server
  // said no", and the whole point of the third list is that it cannot be mistaken for one.
  assert.ok(offered.unaskable.length > 0, 'expected some candidates to be unofferable by this stack');
  assert.equal(offered.accepted.length + offered.refused.length + offered.unaskable.length, BROKEN_SUITE_CANDIDATES.length);
  for (const suite of offered.unaskable) assert.ok(!offered.refused.includes(suite), `${suite} counted twice`);
});

test('enumeration is strictly sequential — `D435` holds on the non-HTTP path too', async () => {
  const url = modernUrl;
  const prober = new TlsProber();
  await prober.enumerateOffered(url, enumPolicy(url));
  // `authz-probe-pacing.test.ts:101` asserts the same property for the HTTP path. This is the first
  // place tflw deliberately opens many connections, so the guard is measured rather than asserted in
  // a comment — `probe rate` stays deferred only while this stays 1.
  assert.equal(prober.peakHandshakesInFlight, 1);
});

test('the enumeration is memoized per host, like the single handshake it sits beside', async () => {
  const url = modernUrl;
  const prober = new TlsProber();
  const first = await prober.enumerateOffered(url, enumPolicy(url));
  const peakAfterFirst = prober.peakHandshakesInFlight;
  const second = await prober.enumerateOffered(url, enumPolicy(url));
  assert.equal(first, second, 'the second call re-enumerated instead of reusing the first answer');
  assert.equal(prober.peakHandshakesInFlight, peakAfterFirst);
});

test('the two policy refusals apply to enumeration exactly as they apply to the probe', async () => {
  const url = modernUrl;
  const prober = new TlsProber();
  // No `authorized target` covering this origin — D291's runtime half.
  assert.equal(await prober.enumerateOffered(url, policy({ probeCiphers: true, authorizedTargets: [] })), undefined);
  // Outside `allow hosts`.
  assert.equal(await prober.enumerateOffered(url, enumPolicy(url, { allowHosts: ['example.test'] })), undefined);
  // http:// has no handshake to enumerate.
  assert.equal(await prober.enumerateOffered(url.replace('https:', 'http:'), enumPolicy(url)), undefined);
});

test('enumeration does not verify the certificate even when the RUN does — `D486`, and the reason it is admissible', async () => {
  const server = offeringServer();
  const url = await listen(server);
  try {
    const prober = new TlsProber();
    // `insecure: false` — this run rejects the self-signed cert, and the verifying probe says so.
    const verifying = enumPolicy(url, { insecure: false });
    const negotiated = await prober.probe(url, verifying);
    assert.equal(negotiated.ok, false, 'the D288 probe must still honour the run\'s verification stance');

    // The enumeration reaches the host anyway, because it reads one bit and never asks whether the
    // peer is who it claims. If this ever comes back with everything `refused`, the host is being
    // reported as having a clean offer on the strength of a certificate complaint — a silent failure
    // pointing at the wrong party.
    const offered = await prober.enumerateOffered(url, verifying);
    assert.ok(offered);
    assert.ok(offered.accepted.includes('NULL-SHA256'), `certificate verification leaked into the enumeration: ${JSON.stringify(offered)}`);
  } finally {
    server.close();
  }
});
