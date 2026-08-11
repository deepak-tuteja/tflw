// M125b1 (`FU-18`, D245/D246/D265/D266) — an absolute URL is a legal request target, and says so.
//
// Two halves, and they fail in opposite directions, which is why they are tested apart:
//
//   the LEXER half can only fail by making something that used to lex stop lexing. `api GET
//   https://x/y` was a hard parse error before this milestone, so no existing program changes
//   meaning — but `canStartPath()` is shared with the `/` branch, and decision 60 (`let ratio = get
//   / 2` is division, not a path) lives entirely inside it. A fix that reached for `isIdentStart(ch)
//   && looksLikeScheme` without the guard would undo that silently, so the controls below are as
//   important as the positives.
//
//   the CHECKER half can only fail by being wrong about a *correct* program — the same shape M124's
//   rules have. `TF058` in particular fires on the ABSENCE of a config key, so every way of not
//   having one has to be distinguished: `undefined` (nobody resolved a config) and `[]` (a config
//   was read and declares none) select DIFFERENT diagnostics rather than one of them selecting
//   silence. That is the one place this option's `undefined`-vs-`[]` rule differs from the five
//   `ProgramCheckOptions` fields before it, and it is asserted directly.
//
// `M92d`'s rule throughout — a negative control that cannot fail is a passing test of nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSource,
  parseConfigSource,
  lex,
  checkProgram,
  checkAbsoluteUrls,
  checkBaseUrls,
  checkSessionBody,
  Codes,
  isAbsoluteUrl,
  absoluteUrlHost,
  type EnvAllowHosts,
} from '../src/index.js';

const DECLARED: EnvAllowHosts = { envName: 'local', hosts: ['api.example.com', 'example.com'] };
const NONE_DECLARED: EnvAllowHosts = { envName: 'local', hosts: [] };

/** A step body through the `TF057`/`TF058`/`TF059` pass alone. A parse error fails loudly rather
 *  than yielding an empty program that every assertion here would pass against. */
const codes = (body: string, env?: EnvAllowHosts): string[] => {
  const source = `test "t"\n${body}`;
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${source}`);
  return checkAbsoluteUrls(program, env ? { envAllowHosts: env } : {}).map((d) => d.code);
};

const diags = (body: string, env?: EnvAllowHosts) => {
  const { program } = parseSource(`test "t"\n${body}`);
  return checkAbsoluteUrls(program, env ? { envAllowHosts: env } : {});
};

// ---------------------------------------------------------------------------
// The lexer (D265)
// ---------------------------------------------------------------------------

/** The token types on the first line, which is where every fixture below puts the interesting one. */
const tokenTypes = (source: string): string[] =>
  lex(source)
    .tokens.filter((t) => t.type !== 'newline' && t.type !== 'indent' && t.type !== 'dedent' && t.type !== 'eof')
    .map((t) => t.type);

test('an absolute URL in method position lexes as one `path` token', () => {
  const { tokens } = lex('test "t"\n  api GET https://api.example.com/orders?q=1\n');
  const path = tokens.find((t) => t.type === 'path');
  assert.ok(path, 'no `path` token was produced — the parser will report `found `https``');
  assert.equal(path.value, 'https://api.example.com/orders?q=1');
});

test('and the whole step parses, which is the half the row filed', () => {
  // The filed repro, verbatim: `api GET https://example.com/x` →
  // `error[TF010]: expected a path like \`/orders\`, found \`https\``.
  const { diagnostics } = parseSource('test "t"\n  api GET https://example.com/x\n');
  assert.deepEqual(diagnostics, [], 'the row\'s own repro still does not parse');
});

test('any RFC 3986 scheme, not an `http`/`https` allowlist', () => {
  // Deliberate: which schemes are acceptable is `fetch`'s question, answered at run time with a
  // real error. A lexer that pre-judged it would make `api GET ws://…` a *syntax* error, which is
  // both wrong and the kind of wrong that needs a grammar change to walk back.
  for (const scheme of ['http', 'https', 'ws', 'wss', 'ftp', 'x-custom.scheme+v2']) {
    const { diagnostics } = parseSource(`test "t"\n  api GET ${scheme}://host/p\n`);
    assert.deepEqual(diagnostics, [], `\`${scheme}://\` did not lex as a request target`);
  }
});

test('the leading `//` is required — a bare `scheme:` is not a URL', () => {
  // `mailto:x@y` has no authority, so it names no host to connect to or allow. Left to lex as it
  // always did rather than quietly accepted as a request target.
  assert.equal(lex('test "t"\n  api GET mailto:someone@example.com\n').tokens.some((t) => t.type === 'path'), false);
});

test('CONTROL — an absolute URL outside method position is NOT a path', () => {
  // THE control for the new branch, and the one that has to contain `://` to be one at all.
  //
  // Written first as `let ratio = get / 2` — decision 60's own example — which was a control of
  // nothing here: the mutation that strips `canStartPath()` from the *new* branch leaves that line
  // untouched, because it has no scheme in it. The mutation harness said so (`m125b1`,
  // `absolute-url-lexes-outside-method-position` survived), and it is the general lesson: **a
  // control has to exercise the branch it is controlling, not the decision the branch is named
  // after.** Two tests can both be about `canStartPath()` and only one of them reach the code.
  assert.equal(tokenTypes('test "t"\n  let u = https://x/y\n').includes('path'), false);
  assert.equal(tokenTypes('test "t"\n  log "x" ftp://host/f\n').includes('path'), false);
  // And in a position that reads like method position but is not: `expect` is not `api`.
  assert.equal(tokenTypes('test "t"\n  expect GET https://x/y\n').includes('path'), false);
});

test('CONTROL — decision 60 survives: `/` after a variable named `get` is still division', () => {
  // The `/` branch's own control, kept because the new branch shares its predicate — if someone
  // widens `canStartPath()` itself rather than the branch, this is what fails. It does NOT cover the
  // absolute-URL branch; see the test above for why that distinction cost a surviving mutant.
  assert.equal(tokenTypes('test "t"\n  let ratio = get / 2\n').includes('path'), false);
});

test('CONTROL — a method word not preceded by `api` starts nothing', () => {
  const outside = lex('test "t"\n  api GET /a\n  let x = 1\n');
  assert.equal(outside.tokens.filter((t) => t.type === 'path').length, 1);
});

test('a `#` in an absolute URL is diagnosed, not silently truncated', () => {
  // `A1-02`'s rule, on the new branch. A fragment is the form people paste out of a browser, so
  // this is *more* reachable here than on the `/` branch it was written for. Silently shortening
  // the URL would send a request nobody wrote — the one failure a testing tool must never produce.
  const { diagnostics } = lex('test "t"\n  api GET https://x.example/p#frag\n');
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]!.code, Codes.UNEXPECTED_CHAR);
  assert.match(diagnostics[0]!.message, /ends the URL/);
});

// ---------------------------------------------------------------------------
// The shared predicate (D233)
// ---------------------------------------------------------------------------

test('`isAbsoluteUrl` is what the lexer, checker and runtime all ask', () => {
  assert.equal(isAbsoluteUrl('https://x/y'), true);
  assert.equal(isAbsoluteUrl('ftp://x/y'), true);
  assert.equal(isAbsoluteUrl('/orders'), false);
  assert.equal(isAbsoluteUrl('orders'), false);
  assert.equal(isAbsoluteUrl('//x/y'), false, 'a protocol-relative URL names no scheme');
  assert.equal(isAbsoluteUrl('{base}/orders'), false, 'an interpolated target is undecidable, not absolute');
});

test('`absoluteUrlHost` returns null for both kinds of "no host I can be sure of"', () => {
  assert.equal(absoluteUrlHost('https://api.example.com/x'), 'api.example.com');
  assert.equal(absoluteUrlHost('/orders'), null);
  assert.equal(absoluteUrlHost('https://['), null, 'an unparseable URL must not throw out of a checker pass');
});

// ---------------------------------------------------------------------------
// `TF057` / `TF058` — and which of the two, which is the whole of D263
// ---------------------------------------------------------------------------

test('an allowlist exists → `TF057`, the portability warning', () => {
  assert.deepEqual(codes('  api GET https://api.example.com/orders\n', DECLARED), [Codes.ABSOLUTE_URL_NOT_PORTABLE]);
});

test('no config was resolved → `TF057`, because a refusal cannot be predicted', () => {
  // `undefined` means nobody looked. The portability warning is still true — it depends on nothing
  // outside the file — so the pass does not go silent, it says the part it knows.
  assert.deepEqual(codes('  api GET https://api.example.com/orders\n'), [Codes.ABSOLUTE_URL_NOT_PORTABLE]);
});

test('a config was resolved and declares none → `TF058`, the refusal warning', () => {
  assert.deepEqual(codes('  api GET https://api.example.com/orders\n', NONE_DECLARED), [Codes.ABSOLUTE_URL_NEEDS_ALLOW_HOSTS]);
});

test('`undefined` and `[]` select DIFFERENT diagnostics — neither selects silence', () => {
  // The assertion D263 exists for, stated as one comparison rather than left implicit across the
  // three tests above. Collapsing the two in either direction is a one-character edit that no other
  // test in this repo would catch: read `[]` as "not resolved" and `TF058` disappears entirely;
  // read `undefined` as `[]` and every absolute URL in the docs-site editor demo — a browser, where
  // no `tflw.config` can exist even in principle — warns that a run will refuse it.
  const unresolved = codes('  api GET https://api.example.com/orders\n');
  const resolvedEmpty = codes('  api GET https://api.example.com/orders\n', NONE_DECLARED);
  assert.notDeepEqual(unresolved, resolvedEmpty);
  assert.deepEqual(unresolved, [Codes.ABSOLUTE_URL_NOT_PORTABLE]);
  assert.deepEqual(resolvedEmpty, [Codes.ABSOLUTE_URL_NEEDS_ALLOW_HOSTS]);
});

test('one diagnostic per step, never both', () => {
  // A step that is going to be refused does not also need to be told it is unportable: that reads
  // as two problems where there is one, and the second is irrelevant until the first is fixed.
  assert.equal(codes('  api GET https://api.example.com/orders\n', NONE_DECLARED).length, 1);
  assert.equal(codes('  api GET https://api.example.com/orders\n', DECLARED).length, 1);
});

test('`TF058` names the env and the host to add', () => {
  const [d] = diags('  api GET https://api.example.com/orders\n', NONE_DECLARED);
  assert.match(d!.message, /env "local"/);
  assert.match(d!.hint!, /allow hosts "api\.example\.com"/);
});

test('both are warnings — the run is not blocked (D147)', () => {
  // The tier is the whole decision. `allow hosts` is read from `tflw.config` and differs per env, so
  // this is a prediction: a suite whose CI env declares an allowlist is correct, and an error would
  // make it unrunnable with no override.
  assert.deepEqual(diags('  api GET https://x.example/o\n', NONE_DECLARED).map((d) => d.severity), ['warning']);
  assert.deepEqual(diags('  api GET https://x.example/o\n', DECLARED).map((d) => d.severity), ['warning']);
});

// ---------------------------------------------------------------------------
// Every target-bearing step, and only those (D247)
// ---------------------------------------------------------------------------

test('`open` with an absolute URL warns — the silent-concat half', () => {
  assert.deepEqual(codes('  open "https://example.com/checkout"\n', DECLARED), [Codes.ABSOLUTE_URL_NOT_PORTABLE]);
});

test('`wait until api` warns too', () => {
  assert.deepEqual(
    codes('  wait until api GET https://api.example.com/ready\n    expect status equals 200\n', DECLARED),
    [Codes.ABSOLUTE_URL_NOT_PORTABLE],
  );
});

test('D247 — `stub` is a PATTERN, and nothing here fires on it', () => {
  // `testFlow-tests`' `storefront.tflw:121` writes exactly this today. A URL pattern is matched
  // against traffic; it is not an address anything is sent to, so a warning about portability or
  // about `allow hosts` is wrong in principle rather than merely noisy — and it would light up the
  // dogfood suite on day one.
  assert.deepEqual(codes('  stub GET "https://payments.example.test/v1/authorize" respond status 200\n', NONE_DECLARED), []);
});

test('D247 — an observed `request to "…"` assertion is a pattern too', () => {
  assert.deepEqual(
    codes('  expect request to "https://payments.example.test/v1/authorize" with method "POST" was made\n', NONE_DECLARED),
    [],
  );
});

test('CONTROL — a relative path is silent under every option shape', () => {
  for (const env of [undefined, DECLARED, NONE_DECLARED]) {
    assert.deepEqual(codes('  api GET /orders\n', env), [], 'a plain path must never warn');
    assert.deepEqual(codes('  open "/checkout"\n', env), []);
  }
});

test('CONTROL — an interpolated target is undecidable, so silent', () => {
  // `{base}/orders` may or may not resolve absolutely; that is a runtime fact. Reporting on it is
  // D137 clause 1 violated by a checker being clever — the same trap M124's rules are written
  // around.
  assert.deepEqual(codes('  let base = "https://x"\n  open "{base}/orders"\n', NONE_DECLARED), []);
});

test('an interpolated HOST inside a literal scheme is still absolute', () => {
  // The other side of the line above: `https://{host}/x` begins with a scheme in the source text,
  // so what leaves the machine is absolute no matter what `{host}` binds to. Decidable, therefore
  // decided.
  assert.deepEqual(codes('  open "https://{host}/x"\n', NONE_DECLARED), [Codes.ABSOLUTE_URL_NEEDS_ALLOW_HOSTS]);
});

// ---------------------------------------------------------------------------
// `TF059` — a service and an absolute URL (D266)
// ---------------------------------------------------------------------------

test('a named service plus an absolute URL is an ERROR, not a warning', () => {
  const [d] = diags('  api billing GET https://other.example/x\n', DECLARED);
  assert.equal(d!.code, Codes.SERVICE_WITH_ABSOLUTE_URL);
  // The contrast with the two warnings above is the clearest statement of D147 in the codebase:
  // both of this rule's operands are written in the file, so no config can make the combination
  // meaningful and there is nothing to predict.
  assert.equal(d!.severity, 'error');
});

test('`TF059` fires regardless of what the caller resolved', () => {
  for (const env of [undefined, DECLARED, NONE_DECLARED]) {
    assert.deepEqual(codes('  api billing GET https://other.example/x\n', env), [Codes.SERVICE_WITH_ABSOLUTE_URL]);
  }
});

test('`TF059` suppresses the URL warnings rather than stacking with them', () => {
  assert.equal(codes('  api billing GET https://other.example/x\n', NONE_DECLARED).length, 1);
});

test('CONTROL — a service with a PATH is the ordinary case and stays silent', () => {
  assert.deepEqual(codes('  api billing GET /orders\n', NONE_DECLARED), []);
});

test('its hint names both ways out without preferring one', () => {
  // Which of the two the author meant is genuinely not knowable from the step, so C7/M84's rule
  // applies: say what happened, and do not recommend an edit that is not obviously the right one.
  const [d] = diags('  api billing GET https://other.example/x\n');
  assert.match(d!.hint!, /Drop `billing`/);
  assert.match(d!.hint!, /write a path/);
});

// ---------------------------------------------------------------------------
// `TF051` — the interaction that makes this more than a lexer change
// ---------------------------------------------------------------------------

test('an absolute target does NOT need a base URL — `TF051` must not fire', () => {
  // The worst-direction failure available in this milestone, and it would have shipped invisibly:
  // `TF051` is an **error**, so a rule demanding a base URL an absolute step never uses would
  // *block a program that runs fine* — the checker predicting a refusal the runtime does not make,
  // which is D137 clause 1. Every pre-existing `TF051` test writes a path and passes either way.
  const noBases = { envName: 'local', api: false, web: false };
  const api = parseSource('test "t"\n  api GET https://api.example.com/orders\n');
  assert.equal(
    checkBaseUrls(api.program, { envBaseUrls: noBases }).map((d) => d.code).includes(Codes.NO_BASE_URL_FOR_STEP),
    false,
    '`TF051` demanded an `api` base URL for a step that never resolves one',
  );
  const open = parseSource('test "t"\n  open "https://example.com/checkout"\n');
  assert.equal(
    checkBaseUrls(open.program, { envBaseUrls: noBases }).map((d) => d.code).includes(Codes.NO_BASE_URL_FOR_STEP),
    false,
    '`TF051` demanded a `web` base URL for an `open` that never resolves one',
  );
});

test('CONTROL — `TF051` still fires for a relative step with no base', () => {
  // The half that must not be lost. A guard written as "skip this rule for api steps" rather than
  // "skip it for absolute ones" would pass the test above and silently retire `TF051`.
  const noBases = { envName: 'local', api: false, web: false };
  const api = parseSource('test "t"\n  api GET /orders\n');
  assert.ok(checkBaseUrls(api.program, { envBaseUrls: noBases }).some((d) => d.code === Codes.NO_BASE_URL_FOR_STEP));
  const open = parseSource('test "t"\n  open "/checkout"\n');
  assert.ok(checkBaseUrls(open.program, { envBaseUrls: noBases }).some((d) => d.code === Codes.NO_BASE_URL_FOR_STEP));
});

test('`wait until api` gets the same treatment on both sides', () => {
  const noBases = { envName: 'local', api: false, web: false };
  const absolute = parseSource('test "t"\n  wait until api GET https://api.example.com/ready\n    expect status equals 200\n');
  assert.equal(checkBaseUrls(absolute.program, { envBaseUrls: noBases }).length, 0);
  const relative = parseSource('test "t"\n  wait until api GET /ready\n    expect status equals 200\n');
  assert.ok(checkBaseUrls(relative.program, { envBaseUrls: noBases }).some((d) => d.code === Codes.NO_BASE_URL_FOR_STEP));
});

// ---------------------------------------------------------------------------
// Reachability — the composed pass list, and a `session` body
// ---------------------------------------------------------------------------

test('reachable through `checkProgram`, which is what `tflw check` runs', () => {
  // A pass can be perfect and unwired. M116 found two that were.
  const { program } = parseSource('test "t"\n  api GET https://api.example.com/orders\n');
  const codesOut = checkProgram(program, { envAllowHosts: NONE_DECLARED }).map((d) => d.code);
  assert.ok(codesOut.includes(Codes.ABSOLUTE_URL_NEEDS_ALLOW_HOSTS));
});

test('reachable inside an `action` and a hook body, not just a test', () => {
  const { program } = parseSource(
    'action fetch it()\n  api GET https://api.example.com/a\n\nbefore file\n  api GET https://api.example.com/b\n\ntest "t"\n  fetch it()\n',
  );
  assert.deepEqual(checkAbsoluteUrls(program, { envAllowHosts: DECLARED }).map((d) => d.code), [
    Codes.ABSOLUTE_URL_NOT_PORTABLE,
    Codes.ABSOLUTE_URL_NOT_PORTABLE,
  ]);
});

test('reachable inside a `session` body, where it is load-bearing', () => {
  // A session exists to log in, and the identity provider is very often a different host from the
  // app under test — which is precisely what an absolute URL is for.
  const parsed = parseConfigSource('session admin\n  api POST https://idp.example.com/token\n');
  assert.deepEqual(parsed.diagnostics, [], 'fixture did not parse as config');
  const out = checkSessionBody(parsed.config.sessions, [], undefined, undefined, NONE_DECLARED).map((d) => d.code);
  assert.ok(out.includes(Codes.ABSOLUTE_URL_NEEDS_ALLOW_HOSTS));
});
