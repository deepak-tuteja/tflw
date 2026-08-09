// M116 (`PLAN_M97_CHECKER_CONTRACT.md`, D148) — `TF051`: a step needing a base URL the active env
// does not declare. Closes `M97a-04` (`web`) and `M97a-15` (`api`).
//
// **What this file is really guarding.** `TF051` is the one rule in M116 that can be wrong about a
// whole suite at once: it fires on `api GET /path`, which is the single most common line in every
// `.tflw` file in existence. A false positive here is not one bad diagnostic, it is `tflw check`
// refusing an entire project — `A4-05`'s failure mode, and the reason D137 clause 1 is stated
// before clause 2. So the negative half of this file matters more than the positive half, and it
// is deliberately the longer of the two.
//
// Every test states its negative control (`M92d` — a negative control that cannot fail is a
// passing test of nothing). The blunt one for the whole file: set both booleans to `true` and every
// assertion below that expects `TF051` fails. It is exercised for real, not just described — see
// the last group.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource, checkBaseUrls, checkSessionBody, Codes, type EnvBaseUrls } from '../src/index.js';

const BOTH: EnvBaseUrls = { envName: 'local', api: true, web: true };
const NEITHER: EnvBaseUrls = { envName: 'local', api: false, web: false };
const API_ONLY: EnvBaseUrls = { envName: 'local', api: true, web: false };
const WEB_ONLY: EnvBaseUrls = { envName: 'local', api: false, web: true };

const codes = (body: string, env: EnvBaseUrls | undefined): string[] => {
  const source = `test "t"\n${body}`;
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${source}`);
  return checkBaseUrls(program, env ? { envBaseUrls: env } : {}).map((d) => d.code);
};

const messages = (body: string, env: EnvBaseUrls): string[] => {
  const { program } = parseSource(`test "t"\n${body}`);
  return checkBaseUrls(program, { envBaseUrls: env }).map((d) => d.message);
};

// ---------------------------------------------------------------------------
// The `web` half — `M97a-04`.
// ---------------------------------------------------------------------------

test('`open` against an env with no `web` base URL is `TF051`', () => {
  // Control: `WEB_ONLY` (below) runs the identical program and must be silent.
  assert.deepEqual(codes('  open "/login"\n', API_ONLY), [Codes.NO_BASE_URL_FOR_STEP]);
});

test('`open` is silent when the env declares `web`', () => {
  assert.deepEqual(codes('  open "/login"\n', WEB_ONLY), []);
  assert.deepEqual(codes('  open "/login"\n', BOTH), []);
});

test('an interpolated `open` path is still `TF051`', () => {
  // Not a `TF043`-style prediction: `open`'s path is *always* relative to the `web` base URL
  // (`ast.ts:774` — no method/service prefix, so there is no absolute-URL form), which means the
  // runtime throws before it ever looks at the path. Nothing about the operand can rescue it, so
  // unlike a file path, "not statically known" does not make this unknowable.
  // Control: same program under `WEB_ONLY` is silent (asserted here, not just claimed).
  assert.deepEqual(codes('  let p = "/x"\n  open "{p}"\n', API_ONLY), [Codes.NO_BASE_URL_FOR_STEP]);
  assert.deepEqual(codes('  let p = "/x"\n  open "{p}"\n', WEB_ONLY), []);
});

test('a browser step that is not `open` does not need a `web` base URL', () => {
  // The over-reach this rule could easily have shipped. `click`/`fill` resolve a locator against an
  // already-open page; only `open` calls `resolveWebUrl`. Reporting them would be a false positive
  // on every `within` block in a suite whose `open` came from a hook.
  assert.deepEqual(codes('  click button "Buy"\n  fill field "Email" with "a@b.c"\n', API_ONLY), []);
});

// ---------------------------------------------------------------------------
// The `api` half — `M97a-15`.
// ---------------------------------------------------------------------------

test('an un-prefixed `api` step against an env with no default `api` is `TF051`', () => {
  assert.deepEqual(codes('  api GET /health\n', WEB_ONLY), [Codes.NO_BASE_URL_FOR_STEP]);
});

test('a *service-prefixed* api step is silent, even with no default `api`', () => {
  // The rule's whole precision. `api orders GET /health` resolves against `services['orders']` and
  // never reaches `resolveBaseUrl(null, …)`, so reporting it would reject a correct program — and
  // a multi-service config with no default `api` is a perfectly ordinary shape.
  assert.deepEqual(codes('  api orders GET /health\n', WEB_ONLY), []);
  assert.deepEqual(codes('  api orders GET /health\n', NEITHER), []);
});

test('`wait until api` counts, and its service prefix counts too', () => {
  // Shares `parseApiRequestLine` with `api`, so it reaches the identical throw — and a hand-written
  // walker that only knew `ApiStep` would miss it in silence.
  assert.deepEqual(codes('  wait until api GET /health\n    expect status equals 200\n', WEB_ONLY), [Codes.NO_BASE_URL_FOR_STEP]);
  assert.deepEqual(codes('  wait until api orders GET /health\n    expect status equals 200\n', WEB_ONLY), []);
});

test('`matches schema … from "<relative>"` needs the default `api` base URL', () => {
  // The third site, and the one a reader does not expect: `contract.ts:45` resolves a non-absolute
  // schema source against the default service. Found by reading `resolveBaseUrl`'s callers rather
  // than the row, which named only the api-step path.
  const body = '  api orders GET /health\n  expect body matches schema "Order" from "./openapi.json"\n';
  assert.deepEqual(codes(body, WEB_ONLY), [Codes.NO_BASE_URL_FOR_STEP]);
  assert.deepEqual(codes(body, BOTH), []);
});

test('an *absolute* schema source needs no base URL', () => {
  // `resolveSchemaSourceUrl` passes `http(s)://` straight through, so this program runs fine
  // against an env with no `api` at all. The same test, kept character-for-character.
  assert.deepEqual(codes('  api orders GET /health\n  expect body matches schema "Order" from "https://ex.com/openapi.json"\n', NEITHER), []);
});

// ---------------------------------------------------------------------------
// Reach: nested blocks, hooks, actions — the silence failure mode.
// ---------------------------------------------------------------------------

test('a step nested inside a block is still reached', () => {
  // The reason this pass walks the object graph instead of naming block kinds: a `within` a
  // hand-written walker had not been taught about is skipped *in silence*, which is exactly how
  // `A4-07` presented (`no problems found`).
  // Control: change the walk to iterate `test.body` only and this test fails while every other
  // test in the file still passes.
  assert.deepEqual(codes('  open "/x"\n  within list "Cart items"\n    api GET /health\n', NEITHER), [
    Codes.NO_BASE_URL_FOR_STEP,
    Codes.NO_BASE_URL_FOR_STEP,
  ]);
});

test('hooks and actions are walked, not just tests', () => {
  const source = 'before\n  api GET /warm\n\naction seed()\n  api GET /seed\n\ntest "t"\n  expect status equals 200\n';
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], 'fixture did not parse');
  assert.deepEqual(checkBaseUrls(program, { envBaseUrls: WEB_ONLY }).map((d) => d.code), [
    Codes.NO_BASE_URL_FOR_STEP,
    Codes.NO_BASE_URL_FOR_STEP,
  ]);
});

// ---------------------------------------------------------------------------
// The soundness half — the one that matters most.
// ---------------------------------------------------------------------------

test('a fully-declared env reports nothing, whatever the program does', () => {
  // The blunt negative control for the entire file, run rather than described.
  const everything =
    '  open "/login"\n  api GET /health\n  api orders GET /health\n  wait until api GET /health\n    expect status equals 200\n';
  assert.deepEqual(codes(everything, BOTH), []);
});

test('`undefined` skips the pass entirely — `undefined` is not `false`', () => {
  // `ProgramCheckOptions`' doctrine, and the single most dangerous place in M116 to get it
  // backwards: with `envBaseUrls` absent, the docs-site editor demo (a browser, where no
  // `tflw.config` can exist even in principle) would otherwise report `TF051` on every sample it
  // renders. A caller that resolved no config has not said "this env declares nothing".
  assert.deepEqual(codes('  open "/login"\n  api GET /health\n', undefined), []);
});

test('the message names the env the user actually selected', () => {
  // Half the value of the diagnostic. "declares none" is useless without *which* env, because the
  // usual cause is running against the wrong `--env`, not a genuinely missing line.
  const [msg] = messages('  api GET /health\n', { envName: 'staging', api: false, web: true });
  assert.match(msg!, /env "staging" declares none/);
  assert.match(msg!, /`api` base URL/);
});

// ---------------------------------------------------------------------------
// D152 — a `session` body gets this pass, on the `api` half `sessionPassCoverage` cannot reach.
// ---------------------------------------------------------------------------

test('a `session` body\'s un-prefixed `api` step is `TF051` (D152)', () => {
  // `sessionPassCoverage.test.ts` proves the wiring using the `web` half, because its shared
  // fixture config must declare `api` for its other rows to mean anything. This is the api half,
  // in a session, against an env that declares neither — the shape that actually occurs, since a
  // session's first line is nearly always a login against the default service.
  const config = 'env local default\n  web "http://localhost:3000"\n\nsession s\n  api POST /auth/login body { u: "a" }\n';
  const parsed = parseConfigSource(config);
  assert.deepEqual(parsed.diagnostics, [], 'fixture did not parse');
  const env: EnvBaseUrls = { envName: 'local', api: false, web: true };
  assert.deepEqual(checkSessionBody(parsed.config.sessions, [], env).map((d) => d.code), [Codes.NO_BASE_URL_FOR_STEP]);
  // Control: the same session against an env that declares `api` is silent.
  assert.deepEqual(checkSessionBody(parsed.config.sessions, [], BOTH).map((d) => d.code), []);
  // And the option is skipped when omitted, exactly as on the program side.
  assert.deepEqual(checkSessionBody(parsed.config.sessions, []).map((d) => d.code), []);
});
