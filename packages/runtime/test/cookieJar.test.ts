// First-class cookie jar (SPEC §3.3, P#33) — pure unit tests for the jar's own parsing/expiry/
// scoping/serialization logic, independent of the interpreter wiring (covered separately in
// cookieJar-integration.test.ts). See cookieJar.ts's header comment for what is still deliberately
// out of scope (`Path`, `Secure`/`HttpOnly`/`SameSite`).
//
// Rewritten for M88c2 (`B4-06`): every cookie is now filed under the origin that set it, so the
// jar's whole API is origin-taking. The tests that predate that milestone are unchanged in what
// they assert — one origin behaves exactly as it always did — and everything below
// `--- origin scoping ---` is the new behaviour.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CookieJar, domainMatches } from '../src/cookieJar.js';

const A = 'http://a.test:4001';
const B = 'http://b.test:4002';

/** The single-origin shorthand these tests used before origins existed. */
function set(jar: CookieJar, ...lines: string[]): void {
  jar.applySetCookieLines(A, lines);
}

test('a single Set-Cookie is captured and serialized as a bare name=value pair', () => {
  const jar = new CookieJar();
  set(jar, 'session=abc123; Path=/; HttpOnly; SameSite=Lax');
  assert.equal(jar.serialize(A), 'session=abc123');
});

test('an empty jar serializes to undefined, never an empty Cookie: header', () => {
  const jar = new CookieJar();
  assert.equal(jar.serialize(A), undefined);
});

test('applying no cookie events at all is a no-op', () => {
  const jar = new CookieJar();
  jar.applyCookieEvents([]);
  set(jar);
  assert.equal(jar.serialize(A), undefined);
});

test('two Set-Cookie lines from one response both land in the jar', () => {
  const jar = new CookieJar();
  set(jar, 'session=abc123; Path=/; HttpOnly', 'session_refresh=xyz789; Path=/; HttpOnly');
  const serialized = jar.serialize(A)!;
  assert.match(serialized, /session=abc123/);
  assert.match(serialized, /session_refresh=xyz789/);
  assert.doesNotMatch(serialized, /\n/, 'the serialized Cookie header must never contain a literal newline');
});

test('a later Set-Cookie for the same name overwrites the earlier value (last-value-wins)', () => {
  const jar = new CookieJar();
  set(jar, 'session=first');
  set(jar, 'session=second');
  assert.equal(jar.serialize(A), 'session=second');
});

test('Max-Age <= 0 deletes the cookie immediately, same as a real browser', () => {
  const jar = new CookieJar();
  set(jar, 'session=abc123');
  assert.equal(jar.serialize(A), 'session=abc123');
  set(jar, 'session=abc123; Max-Age=0');
  assert.equal(jar.serialize(A), undefined);
});

test('a negative Max-Age also deletes the cookie', () => {
  const jar = new CookieJar();
  set(jar, 'session=abc123');
  set(jar, 'session=abc123; Max-Age=-1');
  assert.equal(jar.serialize(A), undefined);
});

test('a cookie with a real (positive) Max-Age is pruned from serialize() once it has actually expired', async () => {
  const jar = new CookieJar();
  set(jar, 'session=abc123; Max-Age=0.05'); // 50ms
  assert.equal(jar.serialize(A), 'session=abc123', 'not expired yet');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(jar.serialize(A), undefined, 'must be pruned once its Max-Age has elapsed');
});

test('Expires in the past deletes the cookie from serialize(), Expires in the future keeps it', () => {
  const jar = new CookieJar();
  set(jar, 'past=x; Expires=Mon, 01 Jan 2001 00:00:00 GMT');
  set(jar, 'future=y; Expires=Fri, 01 Jan 2100 00:00:00 GMT');
  const serialized = jar.serialize(A);
  assert.doesNotMatch(serialized ?? '', /past=x/);
  assert.match(serialized ?? '', /future=y/);
});

test('Max-Age wins over Expires when a line carries both (RFC 6265 §5.3)', () => {
  const jar = new CookieJar();
  // Expires says "already gone", Max-Age says "very much alive" — Max-Age must win.
  set(jar, 'session=abc123; Expires=Mon, 01 Jan 2001 00:00:00 GMT; Max-Age=3600');
  assert.equal(jar.serialize(A), 'session=abc123');
});

test('a cookie with no Max-Age/Expires at all (a session cookie) never expires within the jar\'s lifetime', () => {
  const jar = new CookieJar();
  set(jar, 'session=abc123');
  assert.equal(jar.serialize(A), 'session=abc123');
});

test('a malformed Set-Cookie line (no "=" at all) is skipped, not thrown', () => {
  const jar = new CookieJar();
  set(jar, 'this-is-not-a-cookie');
  assert.equal(jar.serialize(A), undefined);
});

// --- origin scoping (M88c2, `B4-06`, D-M88-7/8/9) -----------------------------------------------

test('a cookie set by one origin is not sent to another — the whole point of `B4-06`', () => {
  const jar = new CookieJar();
  set(jar, 'session=secret-for-a');
  assert.equal(jar.serialize(A), 'session=secret-for-a');
  assert.equal(jar.serialize(B), undefined, "A's session cookie must never be replayed to B");
});

test('the same cookie name at two origins coexists instead of clobbering', () => {
  const jar = new CookieJar();
  jar.applySetCookieLines(A, ['session=for-a']);
  jar.applySetCookieLines(B, ['session=for-b']);
  assert.equal(jar.serialize(A), 'session=for-a');
  assert.equal(jar.serialize(B), 'session=for-b');
});

test('port and scheme are part of the key — one host on two ports is two origins', () => {
  const jar = new CookieJar();
  jar.applySetCookieLines('http://localhost:4001', ['session=api']);
  assert.equal(jar.serialize('http://localhost:4002'), undefined, 'a different port is a different origin');
  assert.equal(jar.serialize('https://localhost:4001'), undefined, 'a different scheme is a different origin');
  assert.equal(jar.serialize('http://localhost:4001'), 'session=api');
});

test('a default port normalizes away, so the two spellings of one origin share a jar', () => {
  const jar = new CookieJar();
  // `URL.origin` drops :80/:443 — `cookieEventFor` produces the normalized form, and a base URL
  // written either way has to reach the same bucket or a cookie silently vanishes.
  jar.applySetCookieLines(new URL('http://a.test:80/login').origin, ['session=abc']);
  assert.equal(jar.serialize(new URL('http://a.test/profile').origin), 'session=abc');
});

test('a `Domain=` cookie reaches a sibling subdomain of the host that set it (D-M88-9)', () => {
  const jar = new CookieJar();
  jar.applySetCookieLines('https://login.example.com', ['sso=tok; Domain=example.com']);
  assert.equal(jar.serialize('https://api.example.com'), 'sso=tok', 'subdomain SSO — worked by accident before scoping, kept on purpose after');
  assert.equal(jar.serialize('https://example.com'), 'sso=tok', 'the domain itself matches too');
  assert.equal(jar.serialize('https://example.org'), undefined, 'an unrelated domain never matches');
  assert.equal(jar.serialize('https://notexample.com'), undefined, 'a suffix match is not a domain match — the boundary must be a dot');
});

test('a leading dot on `Domain=` is ignored, and matching is case-insensitive (RFC 6265 §5.2.3)', () => {
  const jar = new CookieJar();
  jar.applySetCookieLines('https://login.Example.com', ['sso=tok; Domain=.EXAMPLE.com']);
  assert.equal(jar.serialize('https://api.example.com'), 'sso=tok');
});

test('a `Domain=` the setting host does not belong to is narrowed to host-only, not dropped', () => {
  const jar = new CookieJar();
  jar.applySetCookieLines('https://evil.test', ['sso=tok; Domain=example.com']);
  assert.equal(jar.serialize('https://api.example.com'), undefined, 'one host must not claim another\'s cookies');
  assert.equal(jar.serialize('https://evil.test'), 'sso=tok', 'but the cookie is kept where it was set — silent loss is the failure this jar exists to end');
});

test('an IP-literal host is never a domain match', () => {
  // Without the guard, `127.0.0.1`.endsWith('.0.0.1') makes a `Domain=0.0.1` cookie look shared.
  assert.equal(domainMatches('127.0.0.1', '0.0.1'), false);
  assert.equal(domainMatches('127.0.0.1', '127.0.0.1'), true);
  assert.equal(domainMatches('api.example.com', 'example.com'), true);
});

test('an origin\'s own cookie wins over a domain cookie of the same name inherited from elsewhere', () => {
  const jar = new CookieJar();
  jar.applySetCookieLines('https://login.example.com', ['session=from-sso; Domain=example.com']);
  jar.applySetCookieLines('https://api.example.com', ['session=from-api']);
  assert.equal(jar.serialize('https://api.example.com'), 'session=from-api');
  assert.equal(jar.serialize('https://other.example.com'), 'session=from-sso', 'an origin with none of its own still inherits');
});

test('a `Max-Age=0` logout carrying `Domain=` clears the cookie wherever it was set', () => {
  const jar = new CookieJar();
  jar.applySetCookieLines('https://login.example.com', ['sso=tok; Domain=example.com']);
  assert.equal(jar.serialize('https://api.example.com'), 'sso=tok');
  // A different host of the same domain logs out — a domain cookie's identity is (name, domain),
  // so deleting only within the deleting origin's own bucket would leave it very much alive.
  jar.applySetCookieLines('https://www.example.com', ['sso=; Domain=example.com; Max-Age=0']);
  assert.equal(jar.serialize('https://api.example.com'), undefined);
  assert.equal(jar.serialize('https://login.example.com'), undefined);
});

test('originsWithCookies() names every origin holding a live cookie, and skips expired ones', () => {
  const jar = new CookieJar();
  jar.applySetCookieLines(A, ['session=live']);
  jar.applySetCookieLines(B, ['stale=x; Expires=Mon, 01 Jan 2001 00:00:00 GMT']);
  assert.deepEqual(jar.originsWithCookies(), [A]);
});

// --- clone / mergeFrom under session sharing (SPEC §3.3) ----------------------------------------

test('clone() is independent — mutating the clone never affects the original, or vice versa', () => {
  const original = new CookieJar();
  set(original, 'a=1');
  const clone = original.clone();
  assert.equal(clone.serialize(A), 'a=1');

  clone.applySetCookieLines(A, ['a=2']);
  assert.equal(clone.serialize(A), 'a=2');
  assert.equal(original.serialize(A), 'a=1', 'the original must be unaffected by the clone\'s mutation');

  set(original, 'b=3');
  assert.equal(original.serialize(A), 'a=1; b=3');
  assert.equal(clone.serialize(A), 'a=2', 'the clone must be unaffected by the original\'s later mutation');
});

test('clone() copies two levels — a one-level copy would share the per-origin Maps outright', () => {
  // The nesting `B4-06` introduced is exactly where `clone()`'s guarantee can silently stop being
  // true: `new Map(outer)` copies the origin keys and hands both jars the *same* inner Maps, so a
  // test's own login would write straight into the cached session every other test starts from.
  const session = new CookieJar();
  session.applySetCookieLines(A, ['session=cached']);
  const perTest = session.clone();

  perTest.applySetCookieLines(A, ['extra=only-in-this-test']);
  perTest.applySetCookieLines(B, ['other=only-in-this-test']);

  assert.equal(session.serialize(A), 'session=cached', 'the cached session jar must not have gained the test\'s cookie');
  assert.equal(session.serialize(B), undefined, 'nor an entire new origin');
  assert.equal(perTest.serialize(A), 'session=cached; extra=only-in-this-test');
});

test('mergeFrom() is last-wins per (origin, name) — unchanged within an origin, coexisting across them', () => {
  const admin = new CookieJar();
  admin.applySetCookieLines(A, ['session=admin-token']);
  admin.applySetCookieLines(B, ['inventory=admin-inv']);

  const shopper = new CookieJar();
  shopper.applySetCookieLines(A, ['session=shopper-token']);

  const merged = new CookieJar();
  merged.mergeFrom(admin.clone());
  merged.mergeFrom(shopper.clone());

  assert.equal(merged.serialize(A), 'session=shopper-token', 'later-listed session wins within one origin, exactly as before M88c2');
  assert.equal(merged.serialize(B), 'inventory=admin-inv', 'and the other origin\'s cookie survives instead of being clobbered');
});

test('mergeFrom() copies entries, so mutating the merged jar never reaches the source', () => {
  const source = new CookieJar();
  source.applySetCookieLines(A, ['session=cached']);
  const merged = new CookieJar();
  merged.mergeFrom(source);

  merged.applySetCookieLines(A, ['extra=1']);
  assert.equal(source.serialize(A), 'session=cached');
});
