// `M147d`/`M137f-02` (D642) — `session <name> for env <a>[, <b>...]`.
//
// **What the row said, and what measuring it added.** The row reads: a top-level `session` has to
// resolve under *every* declared env, so a session against a second origin forces that origin's
// service name, its `allow hosts` entry and its `authorized target` into every `env` block in the
// config — including envs that never touch it. Both halves reproduce: with `api adminConsole`
// declared on one env of two, `check --env one` is clean and `check --env two` is
// `TF026: unknown api service "adminConsole"` **at the session line**, before any assertion, in an
// env whose invocation may name a single file that has nothing to do with the console.
//
// Three things the row does not say, all of which changed the shape of the fix:
//
//  1. **The runtime never establishes an unnamed session.** All five establishment paths are
//     demand-driven — `test.sessions`, `crawl.sessions`, `scenario.sessions` and
//     `probePrincipalFor(name)` — so the checker was strictly stricter than the thing it checks.
//  2. **The cost is the D21 declarations, not the service name.** The row's other candidate fix,
//     "let a session name an absolute origin", removes the `api` line and leaves `TF060`'s
//     affirmation and `TF065`'s `allow hosts` entry, which are the two that matter: in the corpus
//     this was filed from, one env had to widen an allowlist whose entire purpose is to make a
//     refusal have exactly one possible cause. That is what settles the choice between the row's
//     two candidates rather than taste.
//  3. **A session is also a probe-set member** (D306), so a session that resolves nowhere removes an
//     identity from every Tier 2 differential oracle in the suite while every assertion stays green.
//     That is why a typo'd env name is `TF074` and not tolerated silence.
//
// The fix is `resolve.ts` filtering one list — every consumer already reads `resolved.sessions`, so
// no two of them can disagree about which sessions exist under an env.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfigSource, parseSource, validateConfig, checkSessions, checkSessionBody, Codes } from '../src/index.js';
import type { SessionDecl } from '../src/index.js';

function sessions(src: string): readonly SessionDecl[] {
  const parsed = parseConfigSource(src);
  return parsed.config?.sessions ?? [];
}
function parseCodes(src: string): string[] {
  return parseConfigSource(src).diagnostics.map((d) => d.code);
}
function said(src: string): string {
  return parseConfigSource(src)
    .diagnostics.map((d) => `${d.message} ${d.hint ?? ''}`)
    .join('\n');
}
function configCodes(src: string): string[] {
  const parsed = parseConfigSource(src);
  return validateConfig(parsed.config!).map((d) => d.code);
}
function configSaid(src: string): string {
  const parsed = parseConfigSource(src);
  return validateConfig(parsed.config!)
    .map((d) => `${d.message} ${d.hint ?? ''}`)
    .join('\n');
}

const TWO_ENVS = 'env one default\n  api shared "https://a.example.com"\n\nenv two\n  api shared "https://a.example.com"\n\n';

// --- the clause parses, and its absence still means every env ---------------------------------

test('`M147d`: a session with no `for env` clause parses to `null`, which means every env', () => {
  const [s] = sessions('session admin\n  api GET /login\n');
  // The whole additive claim rests on this one value. `null` is not "no envs" — it is the state
  // every session written before D642 is in, and the filter in `resolve.ts` reads it as "all".
  assert.equal(s!.envs, null);
});

test('`M147d`: `for env <name>` scopes a session to one env', () => {
  const [s] = sessions('session console for env plaintext\n  api GET /login\n');
  assert.deepEqual(s!.envs?.map((e) => e.name), ['plaintext']);
  assert.equal(s!.envs?.[0]!.type, 'EnvScopeRef');
});

test('`M147d`: the clause takes a comma list', () => {
  const [s] = sessions('session console for env plaintext, staging, ci\n  api GET /login\n');
  assert.deepEqual(s!.envs?.map((e) => e.name), ['plaintext', 'staging', 'ci']);
});

test('`M147d`: the clause is line-terminated, so it takes no trailing comma (D637)', () => {
  // D637's rule is about what *closes* a list, not what it holds: a bracket-closed list has
  // somewhere for a trailing comma to sit and a line-terminated one does not. This clause is the
  // second kind, like `require env` and `allow hosts`, and it inherits the answer rather than
  // getting its own.
  assert.ok(parseCodes('session console for env plaintext,\n  api GET /login\n').includes(Codes.UNEXPECTED_TOKEN));
});

test('`M147d`: the scope clause composes with both modifiers, in that order', () => {
  const [plain] = sessions('session admin for env local privileged\n  api GET /login\n');
  assert.deepEqual(plain!.envs?.map((e) => e.name), ['local']);
  assert.equal(plain!.privileged, true);

  const [oauth] = sessions(
    'session svc for env local oauth2 privileged\n  token url "https://t"\n  client id "i"\n  client secret "s"\n',
  );
  assert.deepEqual(oauth!.envs?.map((e) => e.name), ['local']);
  assert.equal(oauth!.privileged, true);
  assert.ok(oauth!.oauth2);
});

// --- the two ways to write it wrong -------------------------------------------------------------

test('`M147d`: `privileged for env` is refused by name, not by a cascade', () => {
  // D310 spent a diagnostic on `privileged oauth2` for exactly this reason: a rejected ordering
  // should cost one message naming the spelling that works, rather than an `endLine()` failure
  // followed by the indented body being parsed as something else entirely.
  const src = 'session admin privileged for env local\n  api GET /login\n';
  const out = said(src);
  assert.ok(out.includes('`for env` comes before `oauth2`/`privileged`'));
  assert.ok(out.includes('session admin for env local privileged'));
  // Recovery consumed the clause, so the body below still parsed as a body.
  assert.equal(sessions(src)[0]!.body.length, 1);
});

test('`M147d`: `for` without `env` says which of the two `for`s this is', () => {
  // `header "X" is "Y" for <service>` is the language's other `for`, and it is the one an author
  // reaching for a scope clause is most likely to have in mind — so the message names it rather
  // than reporting an anonymous unexpected token.
  const out = said('session admin for local\n  api GET /login\n');
  assert.ok(out.includes('introduces an env scope'));
  assert.ok(out.includes('for <service>'));
});

// --- TF074: an env name that is not there --------------------------------------------------------

test('`M147d`: an env the config does not declare is `TF074`', () => {
  assert.deepEqual(
    configCodes(TWO_ENVS + 'session admin for env onee\n  api shared GET /login\n'),
    [Codes.CONFIG_UNKNOWN_ENV],
  );
});

test('`M147d`: `TF074` suggests the env that is right there in the file', () => {
  const out = configSaid(TWO_ENVS + 'session admin for env onee\n  api shared GET /login\n');
  assert.ok(out.includes('unknown env "onee"'));
  assert.ok(out.includes('did you mean `one`?'));
});

test('`M147d`: `TF074` is silent on every declared env, including a multi-env clause', () => {
  assert.deepEqual(configCodes(TWO_ENVS + 'session admin for env one, two\n  api shared GET /login\n'), []);
});

test('`M147d`: `TF074` underlines the name, not the declaration', () => {
  // A `session` span runs to the end of its indented body, so anchoring here would underline a
  // paragraph to complain about a word — the reason `SessionDecl.envs` carries nodes rather than
  // the bare strings `RequireDecl.names` keeps.
  const src = TWO_ENVS + 'session admin for env onee\n  api shared GET /login\n  api shared GET /again\n';
  const [d] = validateConfig(parseConfigSource(src).config!);
  const line = src.split('\n')[d!.span.start.line - 1]!;
  assert.equal(line.slice(d!.span.start.column - 1, d!.span.end.column - 1), 'onee');
});

test('`M147d`: a config with no envs at all says so instead of listing nothing', () => {
  const out = configSaid('session admin for env local\n  api GET /login\n');
  assert.ok(out.includes('declares no `env` blocks'));
  assert.ok(out.includes('drop the `for env` clause'));
});

test('`M147d`: one diagnostic per unknown name', () => {
  assert.deepEqual(
    configCodes(TWO_ENVS + 'session admin for env ghost, one, spectre\n  api shared GET /login\n'),
    [Codes.CONFIG_UNKNOWN_ENV, Codes.CONFIG_UNKNOWN_ENV],
  );
});

// --- TF028 learns the difference between "no such session" and "not this env's" ------------------

const OPTS_IN = parseSource('test "t" as console\n  api GET /a\n  expect status equals 200\n').program;

test('`M147d`: a session scoped elsewhere is `TF028` with a hint naming where it lives', () => {
  const diags = checkSessions(OPTS_IN, ['shopper'], {
    envName: 'secureLocal',
    declaredElsewhere: new Map([['console', ['plaintext']]]),
  });
  assert.deepEqual(diags.map((d) => d.code), [Codes.UNKNOWN_SESSION]);
  assert.ok(diags[0]!.message.includes('in env "secureLocal"'));
  assert.ok(diags[0]!.hint!.includes('`for env plaintext`'));
  // The repair the author most likely wants is named, and so is the other one.
  assert.ok(diags[0]!.hint!.includes('add "secureLocal" to that clause'));
});

test('`M147d`: a name nobody declared keeps the old hint, not the scoping one', () => {
  // Same code for both, because it is one question — *is there a session by this name here* — and
  // splitting it across two numbers would make the answer harder to look up, not easier. What must
  // not happen is the scoping hint appearing for a plain typo.
  const diags = checkSessions(OPTS_IN, ['consoel'], {
    envName: 'secureLocal',
    declaredElsewhere: new Map(),
  });
  assert.ok(diags[0]!.hint!.includes('did you mean `consoel`?'));
  assert.ok(!diags[0]!.hint!.includes('for env'));
});

test('`M147d`: a caller that resolved no env is not made to invent one', () => {
  // The docs-site editor demo and the language server both check files with no env resolved. If
  // the absent argument were read as "declared nowhere", every `as admin` in the documentation
  // would render as a scoping error.
  const diags = checkSessions(OPTS_IN, ['console']);
  assert.deepEqual(diags, []);
});

// --- the row's own shape ------------------------------------------------------------------------

test('`M147d`: the row\'s config — a session body is not checked against an env it is not scoped to', () => {
  // This is `M137f-02` itself, at the level the CLI reads it: `checkSessionBody` is handed the
  // *env-filtered* roster, so the console's `api adminConsole` never meets an env that has no such
  // service. Under the old behaviour the same call received every declared session and reported
  // `TF026` for this one under every env but its own.
  const consoleSession = sessions('session console for env plaintext\n  api adminConsole GET /login\n');
  const secureLocal: string[] = ['storefront'];

  // What the CLI now passes under `--env secureLocal`: the console is filtered out, so nothing is
  // checked against a service map that could not have it.
  assert.deepEqual(checkSessionBody([], secureLocal), []);
  // And the same session under the env it *is* scoped to still gets every pass, unchanged.
  assert.deepEqual(
    checkSessionBody(consoleSession, ['adminConsole']).map((d) => d.code),
    [],
  );
  // The control: hand the unfiltered roster to the wrong env's services and `TF026` is exactly what
  // came back before this slice — the row, reproduced through the same entry point that fixed it.
  assert.deepEqual(
    checkSessionBody(consoleSession, secureLocal).map((d) => d.code),
    [Codes.UNKNOWN_SERVICE],
  );
});
