// The `crawl` declaration's semantic rules (`M137c`, `D443`/`D463`/`D464`) — `TF068`, `TF070`, and the
// four existing passes the construct had to be wired into.
//
// The parser tests live in `crawl.test.ts`. What is worth testing here is not that a bad crawl is
// refused; it is the **two directions a new top-level construct fails silently in**, and each one has
// a test below whose failure would otherwise be invisible:
//
//  1. **A pass that does not know about crawls stays quiet.** `checkProgram` runs twenty-odd passes
//     over `program.tests`, and a crawl body reaches none of them by default. Two of those passes are
//     `D21` safety layers — `TF060`'s `authorized target` and `TF065`'s `--allow-public-target` — so an
//     unwired crawl is the most traffic-originating construct in the language with both of its gates
//     absent, and *green*. The `TF060`/`TF065`/`TF063`/`TF028` cases here are that wiring pinned from
//     the outside, where a future refactor that reverts it goes red.
//  2. **A pass that should NOT see a crawl body reports a correct crawl as broken.** `TF039` is the
//     sharp one: it means *no response to assert about yet*, decided from whether a request-issuing
//     step precedes the assertion, and a crawl body has none by construction. Wiring
//     `checkResponseScopes` would refuse every correct crawl that will ever be written. It is asserted
//     as a silence, which is the only way an omission-by-decision can be told apart from an oversight.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkProgram, parseSource } from '../src/index.js';
import type { ProgramCheckOptions } from '../src/checker.js';
import type { Diagnostic } from '../src/diagnostic.js';

function check(source: string, opts: ProgramCheckOptions = {}): readonly Diagnostic[] {
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `the source must parse cleanly: ${JSON.stringify(diagnostics)}`);
  return checkProgram(program, opts);
}

function codes(source: string, opts: ProgramCheckOptions = {}): string[] {
  return check(source, opts).map((d) => d.code);
}

const SECURITY = '  expect response has no critical security violations';

// -- `TF068`: a crawl with no surface -------------------------------------------------------------

test('TF068: a crawl that declares no `seed` is refused before anything runs (D443)', () => {
  const diags = check(`crawl "the v1 surface"\n${SECURITY}\n`);
  assert.deepEqual(diags.map((d) => d.code), ['TF068']);
  assert.match(diags[0]!.message, /has nothing to crawl/);
  assert.match(diags[0]!.hint ?? '', /could not have failed whatever the application did/);
  // The span is the header, not the assertion: the missing thing is a header clause, and pointing at
  // the `expect` would send the reader to the line that is correct.
  assert.equal(diags[0]!.span.start.line, 1);
});

test('TF068 is silent the moment there is one seed — either kind', () => {
  assert.deepEqual(codes(`crawl "s"\n  seed traffic\n${SECURITY}\n`), []);
  assert.deepEqual(codes(`crawl "s"\n  seed openapi "/openapi.json"\n${SECURITY}\n`), []);
});

test('TF068 is a fact about the file, so an `exclude` that may cover everything is NOT it', () => {
  // The static door decides only what it can prove, which is `TF067`'s line. Whether `"/**"` excludes
  // every discovered route depends on what the run discovers, so it belongs to the runtime door
  // reusing this same code — a checker that guessed here would refuse a suite that works.
  assert.deepEqual(codes(`crawl "s"\n  seed traffic\n  exclude "/**"\n${SECURITY}\n`), []);
});

// -- `TF070`: what a crawl body may contain ------------------------------------------------------

test('TF070: all three `violations` families are legal in one crawl body, and nothing else is (D450)', () => {
  // This is `D450`'s claim made checkable: Tier 4 adds a source of requests, not a judgement, so the
  // families a crawl asserts are exactly the ones the arc already ships — no fourth matcher family.
  const source = [
    'crawl "the v1 surface" as peer',
    '  seed traffic',
    '  expect response has no critical security violations',
    '  expect response has no critical authorization violations',
    '  expect response has no critical input handling violations',
    '',
  ].join('\n');
  assert.deepEqual(codes(source, { knownSessions: ['peer'] }), []);
});

test('TF070: a step that sends its own request is refused, and the message says which mistake it is', () => {
  const diags = check(`crawl "s"\n  seed traffic\n  api GET /products\n${SECURITY}\n`);
  assert.deepEqual(diags.map((d) => d.code), ['TF070']);
  assert.match(diags[0]!.message, /takes only `violations` assertions/);
  assert.match(diags[0]!.message, /a step that sends its own request/);
  assert.match(diags[0]!.hint ?? '', /belongs in a `test`/);
});

test('TF070: an ordinary assertion is refused for the reason that is specific to a crawl', () => {
  // Not "unsupported matcher" — a crawl issues many responses, so `expect status equals 200` names a
  // thing the construct does not have. That sentence is the whole difference between this code and a
  // generic wrong-place error.
  const diags = check(`crawl "s"\n  seed traffic\n  expect status equals 200\n`);
  assert.deepEqual(diags.map((d) => d.code), ['TF070']);
  assert.match(diags[0]!.message, /`expect` about one response — a crawl has many/);
});

test('TF070 names `check` when the author wrote `check`', () => {
  const diags = check(`crawl "s"\n  seed traffic\n  check status equals 200\n`);
  assert.match(diags[0]!.message, /`check` about one response/);
});

test('TF070: a `capture` in a crawl body is refused too — there is no one response to bind from', () => {
  const diags = check(`crawl "s"\n  seed traffic\n  capture status as code\n${SECURITY}\n`);
  assert.deepEqual(diags.map((d) => d.code), ['TF070']);
});

test('TF070 reports a misplaced BLOCK once, not once per step inside it', () => {
  // The walk is flat on purpose. A `within` block is already refused as itself, so descending would
  // report the block and each of its children — several diagnostics for one line to fix.
  const source = ['crawl "s"', '  seed traffic', '  within css "#cart"', '    expect status equals 200', '    expect status equals 201', SECURITY, ''].join('\n');
  assert.deepEqual(codes(source), ['TF070'], 'one construct, one diagnostic');
});

// -- the passes a crawl body HAD to be wired into (D464) -----------------------------------------

test('TF028: a typo in a crawl`s `as` list is caught, like a test`s', () => {
  // Worth its own case rather than trusting the shared helper: a typo'd principal on a test fails one
  // test, while a typo'd principal on a crawl silently drops an identity from the differential oracle
  // across the whole discovered surface — `M130-01`'s shape, a green run over an unjudged surface.
  const diags = check(`crawl "s" as peer, shoppr\n  seed traffic\n${SECURITY}\n`, { knownSessions: ['peer', 'shopper'] });
  assert.deepEqual(diags.map((d) => d.code), ['TF028']);
  assert.match(diags[0]!.message, /unknown session "shoppr"/);
  assert.match(diags[0]!.hint ?? '', /did you mean `shopper`\?/);
});

test('TF063: a crawl with no `as` cannot assert authorization violations, and the message names the crawl', () => {
  const diags = check(`crawl "the v1 surface"\n  seed traffic\n  expect response has no critical authorization violations\n`);
  assert.deepEqual(diags.map((d) => d.code), ['TF063']);
  assert.match(diags[0]!.message, /crawl "the v1 surface"/, 'the label has to say which crawl, not "a test"');
});

test('TF063 is silent once the crawl declares a principal', () => {
  const source = 'crawl "s" as peer\n  seed traffic\n  expect response has no critical authorization violations\n';
  assert.deepEqual(codes(source, { knownSessions: ['peer'] }), []);
});

const STAGING: ProgramCheckOptions = {
  knownSessions: ['peer'],
  envAuthorizedTargets: {
    envName: 'staging',
    targets: [],
    apiBaseUrl: 'https://staging.example.com/v1',
    services: [],
  },
};

test('TF060: a crawl needs an `authorized target` naming the origin it would scan (D21)', () => {
  // The single most load-bearing line of D464's wiring. A crawl is the most traffic-originating
  // construct in the language; if `forEachExpect` did not walk crawl bodies this would be silent, and
  // a crawl would scan an origin nothing authorizes while the run reported green.
  const diags = check(`crawl "s" as peer\n  seed traffic\n${SECURITY}\n`, STAGING);
  assert.ok(diags.some((d) => d.code === 'TF060'), `expected TF060, got ${diags.map((d) => d.code).join(', ')}`);
});

test('TF065: a crawl against a public origin still needs `--allow-public-target`', () => {
  // D21 §3.2(3) — the layer no config key can supply. A crawl reaching it through the same walk is
  // what stops a committed `tflw.config` from pointing CI's crawler at the internet by itself.
  const authorized: ProgramCheckOptions = {
    knownSessions: ['peer'],
    envAuthorizedTargets: {
      envName: 'staging',
      targets: [{ target: 'https://staging.example.com', reason: 'we own it' }],
      apiBaseUrl: 'https://staging.example.com/v1',
      services: [],
    },
  };
  const source = 'crawl "s" as peer\n  seed traffic\n  expect response has no critical authorization violations\n';
  const diags = check(source, authorized);
  assert.ok(diags.some((d) => d.code === 'TF065'), `expected TF065, got ${diags.map((d) => d.code).join(', ')}`);
});

// -- the silences that are decisions ------------------------------------------------------------

test('TF039 is NOT reported for a crawl body, and that is the deliberate omission (D464)', () => {
  // `TF039` means *no response to assert about yet*, decided from whether a request-issuing step
  // precedes the assertion. A crawl body never has one: the crawl issues the requests and each
  // `expect` judges every response that comes back. Wiring `checkResponseScopes` would put `TF039` on
  // every correct crawl ever written — a checker refusing the only shape the feature has.
  //
  // The control that keeps this honest is below it: the identical assertion in a `test` IS `TF039`, so
  // this test cannot pass because the pass stopped working.
  assert.deepEqual(codes(`crawl "s"\n  seed traffic\n${SECURITY}\n`), []);
  assert.ok(codes(`test "t"\n${SECURITY}\n`).includes('TF039'), 'precondition: the pass still fires where it should');
});

test('TF033 is not reported for a crawl — it has no workload clause to multiply by', () => {
  // A fact about the grammar rather than a default: `crawl` takes no `with` clause and is never nested
  // in a `test`, so the multiply-hostile-traffic-by-the-load-factor rule has nothing to fire on. If a
  // crawl ever gains a scheduling clause, this is the test that has to be revisited.
  const source = 'crawl "s" as peer\n  seed traffic\n  expect response has no critical authorization violations\n';
  assert.deepEqual(codes(source, { knownSessions: ['peer'] }), []);
});

test('a program with no crawl is unaffected by any of it', () => {
  assert.deepEqual(codes('test "t"\n  api GET /health\n  expect status equals 200\n'), []);
});
