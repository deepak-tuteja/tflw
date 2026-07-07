// First-class cookie jar (SPEC §3.3, P#33) — pure unit tests for the jar's own parsing/expiry/
// serialization logic, independent of the interpreter wiring (covered separately in
// cookieJar-integration.test.ts). See cookieJar.ts's header comment for the deliberate
// scope-narrowings (no Domain/Path/HttpOnly/SameSite semantics).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CookieJar } from '../src/cookieJar.js';

test('a single Set-Cookie is captured and serialized as a bare name=value pair', () => {
  const jar = new CookieJar();
  jar.applySetCookie('session=abc123; Path=/; HttpOnly; SameSite=Lax');
  assert.equal(jar.serialize(), 'session=abc123');
});

test('an empty jar serializes to undefined, never an empty Cookie: header', () => {
  const jar = new CookieJar();
  assert.equal(jar.serialize(), undefined);
});

test('applySetCookie(undefined) is a no-op', () => {
  const jar = new CookieJar();
  jar.applySetCookie(undefined);
  assert.equal(jar.serialize(), undefined);
});

test('two Set-Cookie lines (newline-joined, matching capture header "set-cookie"\'s convention) both land in the jar', () => {
  const jar = new CookieJar();
  jar.applySetCookie('session=abc123; Path=/; HttpOnly\nsession_refresh=xyz789; Path=/; HttpOnly');
  const serialized = jar.serialize()!;
  assert.match(serialized, /session=abc123/);
  assert.match(serialized, /session_refresh=xyz789/);
  assert.doesNotMatch(serialized, /\n/, 'the serialized Cookie header must never contain a literal newline');
});

test('a later Set-Cookie for the same name overwrites the earlier value (last-value-wins)', () => {
  const jar = new CookieJar();
  jar.applySetCookie('session=first');
  jar.applySetCookie('session=second');
  assert.equal(jar.serialize(), 'session=second');
});

test('Max-Age <= 0 deletes the cookie immediately, same as a real browser', () => {
  const jar = new CookieJar();
  jar.applySetCookie('session=abc123');
  assert.equal(jar.serialize(), 'session=abc123');
  jar.applySetCookie('session=abc123; Max-Age=0');
  assert.equal(jar.serialize(), undefined);
});

test('a negative Max-Age also deletes the cookie', () => {
  const jar = new CookieJar();
  jar.applySetCookie('session=abc123');
  jar.applySetCookie('session=abc123; Max-Age=-1');
  assert.equal(jar.serialize(), undefined);
});

test('a cookie with a real (positive) Max-Age is pruned from serialize() once it has actually expired', async () => {
  const jar = new CookieJar();
  jar.applySetCookie('session=abc123; Max-Age=0.05'); // 50ms
  assert.equal(jar.serialize(), 'session=abc123', 'not expired yet');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(jar.serialize(), undefined, 'must be pruned once its Max-Age has elapsed');
});

test('Expires in the past deletes the cookie from serialize(), Expires in the future keeps it', () => {
  const jar = new CookieJar();
  jar.applySetCookie('past=x; Expires=Mon, 01 Jan 2001 00:00:00 GMT');
  jar.applySetCookie('future=y; Expires=Fri, 01 Jan 2100 00:00:00 GMT');
  const serialized = jar.serialize();
  assert.doesNotMatch(serialized ?? '', /past=x/);
  assert.match(serialized ?? '', /future=y/);
});

test('Max-Age wins over Expires when a line carries both (RFC 6265 §5.3)', () => {
  const jar = new CookieJar();
  // Expires says "already gone", Max-Age says "very much alive" — Max-Age must win.
  jar.applySetCookie('session=abc123; Expires=Mon, 01 Jan 2001 00:00:00 GMT; Max-Age=3600');
  assert.equal(jar.serialize(), 'session=abc123');
});

test('a cookie with no Max-Age/Expires at all (a session cookie) never expires within the jar\'s lifetime', () => {
  const jar = new CookieJar();
  jar.applySetCookie('session=abc123');
  assert.equal(jar.serialize(), 'session=abc123');
});

test('a malformed Set-Cookie line (no "=" at all) is skipped, not thrown', () => {
  const jar = new CookieJar();
  jar.applySetCookie('this-is-not-a-cookie');
  assert.equal(jar.serialize(), undefined);
});

test('clone() is independent — mutating the clone never affects the original, or vice versa', () => {
  const original = new CookieJar();
  original.applySetCookie('a=1');
  const clone = original.clone();
  assert.equal(clone.serialize(), 'a=1');

  clone.applySetCookie('a=2');
  assert.equal(clone.serialize(), 'a=2');
  assert.equal(original.serialize(), 'a=1', 'the original must be unaffected by the clone\'s mutation');

  original.applySetCookie('b=3');
  assert.equal(original.serialize(), 'a=1; b=3');
  assert.equal(clone.serialize(), 'a=2', 'the clone must be unaffected by the original\'s later mutation');
});
