// D339's exemption table, tested as a table (M131a, `PLAN_M131_SAFETY_COMPLETION.md`).
//
// This is the input to a safety control, so the test is written to be **readable against the plan**
// rather than to be short: every row of D339 appears here by name, and so does every case the plan
// argues should *not* be exempt. A reader comparing the two documents should be able to do it line
// by line.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAddress } from '../src/index.js';

function exempt(...urls: string[]): void {
  for (const u of urls) assert.equal(classifyAddress(u), 'exempt', `${u} should be exempt`);
}
function pub(...urls: string[]): void {
  for (const u of urls) assert.equal(classifyAddress(u), 'public', `${u} should be public`);
}
function invalid(...urls: string[]): void {
  for (const u of urls) assert.equal(classifyAddress(u), 'invalid', `${u} should be invalid`);
}

// --- D339's exempt rows -----------------------------------------------------

test('IPv4 loopback is the whole /8, not just 127.0.0.1', () => {
  exempt('http://127.0.0.1:4001', 'http://127.0.0.1', 'https://127.1.2.3/v1', 'http://127.255.255.254');
});

test('IPv6 loopback, bracketed and expanded', () => {
  exempt('http://[::1]:4001', 'https://[::1]', 'http://[0:0:0:0:0:0:0:1]');
});

test('RFC1918 — all three blocks, and only those', () => {
  exempt('http://10.0.0.1', 'http://10.255.255.255', 'http://172.16.0.1', 'http://172.31.255.255', 'http://192.168.1.1');
  // The edges of 172.16/12 are the ones a hand-written check gets wrong.
  pub('http://172.15.0.1', 'http://172.32.0.1', 'http://192.169.1.1', 'http://11.0.0.1');
});

test('IPv6 unique-local fc00::/7 covers fc and fd', () => {
  exempt('http://[fc00::1]', 'http://[fd12:3456:789a::1]');
  pub('http://[fe00::1]', 'http://[2001:db8::1]');
});

test('link-local, both families', () => {
  exempt('http://169.254.169.254', 'http://[fe80::1]', 'http://[feba::1]');
  // fe80::/10 is fe80–febf. `fec0::` is site-local, deprecated, and not on D339's list.
  pub('http://[fec0::1]', 'http://169.253.0.1');
});

test('CGNAT 100.64/10', () => {
  exempt('http://100.64.0.1', 'http://100.127.255.255');
  pub('http://100.63.0.1', 'http://100.128.0.1');
});

test('`localhost` and anything under it (RFC 6761 §6.3)', () => {
  exempt('http://localhost:4001', 'https://LOCALHOST', 'http://api.localhost:8080', 'http://a.b.localhost');
  // Not a suffix match on the *string* — `notlocalhost` is a name somebody could register.
  pub('http://notlocalhost', 'http://localhost.example.com');
});

test('IPv4-mapped IPv6 forms classify as the address they map', () => {
  exempt('http://[::ffff:127.0.0.1]', 'http://[::ffff:7f00:1]', 'http://[::ffff:10.0.0.1]', 'http://[::ffff:c0a8:101]');
  pub('http://[::ffff:8.8.8.8]', 'http://[::ffff:808:808]');
});

// --- what is deliberately not exempt ----------------------------------------

test('every other hostname is public — there is no name-based exemption beyond localhost', () => {
  // The whole of D338's accepted cost, in one assertion: this name is genuinely private and still
  // asks for the flag, because nothing in the string says so and nothing here resolves it.
  pub('https://api.internal.corp', 'https://staging.example.com', 'https://box.local', 'https://api.internal');
});

test('`.invalid` is public, which is what makes the acceptance corpus offline (D347)', () => {
  // RFC 2606 guarantees this never resolves. A DNS-based classifier could not answer at all here;
  // a literal one answers `public`, and `M131b` grades three real outcomes without a packet.
  pub('https://staging.example.invalid', 'https://other.example.invalid/v1');
});

test('ports and paths do not change the answer', () => {
  exempt('http://127.0.0.1:65535/v1/orders?x=1');
  pub('https://staging.example.com:8443/v1');
});

test('the obfuscated IPv4 forms resolve to what they actually are, because `URL` normalizes them', () => {
  // `0177.0.0.1`, `2130706433` and `0x7f000001` are all 127.0.0.1, and the WHATWG parser says so
  // before the classifier sees a thing — so no `inet_aton` re-implementation is needed here, and
  // more importantly none is *wanted*: the sender parses with the same `URL`, and a second opinion
  // about which host a URL names is how a gate and a socket come to disagree.
  exempt('http://0177.0.0.1', 'http://2130706433', 'http://0x7f000001');
});

// --- D339's third answer ----------------------------------------------------

test('the unspecified addresses are `invalid`, not loopback and not public', () => {
  // They name no host. Treating them as loopback would bless whatever the resolver decides they
  // mean; treating them as public would let `--allow-public-target` *authorize* one.
  invalid('http://0.0.0.0:4001', 'http://[::]', 'http://[0:0:0:0:0:0:0:0]', 'http://[::ffff:0.0.0.0]');
});

test('anything that is not a URL is `invalid` — permission is never inferred from a parse failure', () => {
  invalid('staging.example.com', 'not a url', '', '/v1/orders', 'https://');
});
