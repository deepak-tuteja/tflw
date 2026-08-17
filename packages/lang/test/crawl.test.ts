// The `crawl` declaration (`M137c`, `D432`/`D450`) — Tier 4's active crawl, a top-level construct
// sibling to `test`, executed by plain `tflw run`.
//
// What is worth testing here is not that the happy path parses. It is the two ways this construct can
// break something that already worked, both of which are invisible in the AST of a file that declares
// no crawl:
//
//  1. **The tag prefix is shared with `test`.** `@vuln` above a declaration says nothing about which
//     one follows, so the top-level dispatcher has to peek past the tags. `tagsContinue()` decides
//     whether a newline after a tag line continues the run, and it enumerated `tag`/`with`/`test` by
//     name — so before it knew about `crawl`, a tagged crawl stopped at the newline and reported
//     `expected a crawl name string` against a line that had one, or worse, `expected a test`.
//  2. **A program that declares no crawl must serialise exactly as before.** `Program.crawls` is
//     absent-when-empty for the reason `recoveredSpans` records: a required field would have put
//     `"crawls": []` into every program in the language and turned all 31 parser goldens red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '../src/index.js';
import type { CrawlDecl } from '../src/ast.js';

function parseCrawl(source: string): CrawlDecl {
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `unexpected diagnostics: ${JSON.stringify(diagnostics)}`);
  const crawls = program.crawls ?? [];
  assert.equal(crawls.length, 1, 'expected exactly one crawl');
  return crawls[0]!;
}

const FULL = [
  '@crawl @vuln',
  'crawl "the v1 API surface" as peer, shopperBearer',
  '  seed openapi "/openapi.json"',
  '  seed traffic',
  '  exclude "/vuln/**"',
  '',
  '  expect response has no critical security violations',
  '  expect response has no critical authorization violations',
  '',
].join('\n');

test('a crawl parses its tags, name, sessions, seeds, excludes and assertions (D450)', () => {
  const c = parseCrawl(FULL);
  assert.equal(c.name.value, 'the v1 API surface');
  assert.deepEqual(c.tags, ['crawl', 'vuln']);
  // `as` takes the same comma list `test` does — the multi-principal case needs no new syntax.
  assert.deepEqual(c.sessions, ['peer', 'shopperBearer']);
  assert.deepEqual(
    c.seeds.map((s) => (s.type === 'OpenApiSeed' ? `openapi:${s.source.value}` : 'traffic')),
    ['openapi:/openapi.json', 'traffic'],
  );
  assert.deepEqual(
    c.excludes.map((e) => e.value),
    ['/vuln/**'],
  );
  assert.equal(c.body.length, 2, 'both `expect` lines reach the body as ordinary steps');
});

test('a crawl needs no tags, no sessions, no excludes — one seed and one expect is a whole crawl', () => {
  const c = parseCrawl('crawl "surface"\n  seed traffic\n  expect response has no critical security violations\n');
  assert.deepEqual(c.tags, []);
  assert.deepEqual(c.sessions, [], 'a credential-less crawl is legal grammar; whether it is useful is not the parser\'s question');
  assert.deepEqual(c.excludes, []);
  assert.equal(c.seeds.length, 1);
});

test('a TAGGED crawl parses — the tag run is shared with `test`, so the lookahead has to see past it', () => {
  // The regression this pins: `tagsContinue()` listed `tag`/`with`/`test`, so the newline after
  // `@vuln` ended the tag loop and the declaration was parsed as a `test` whose name was `crawl`.
  const c = parseCrawl('@vuln\n@crawl\ncrawl "surface"\n  seed traffic\n  expect response has no critical security violations\n');
  assert.deepEqual(c.tags, ['vuln', 'crawl']);
  assert.equal(c.name.value, 'surface');
});

test('a program with no crawl carries no `crawls` key at all (the goldens assert this)', () => {
  const { program, diagnostics } = parseSource('test "t"\n  api GET /health\n');
  assert.deepEqual(diagnostics, []);
  assert.equal('crawls' in program, false, 'absent, not empty — see `Program.recoveredSpans` for why');
});

test('`crawl` is contextual, so a test may still be named after it and a step may still use the word', () => {
  const { program, diagnostics } = parseSource('test "crawl the catalog"\n  api GET /crawl\n');
  assert.deepEqual(diagnostics, []);
  assert.equal(program.tests.length, 1);
  assert.equal('crawls' in program, false);
});

// -- diagnostics ---------------------------------------------------------------------------------

function firstDiagnostic(source: string) {
  const { diagnostics } = parseSource(source);
  assert.ok(diagnostics.length > 0, 'expected at least one diagnostic');
  return diagnostics[0]!;
}

test('`seed` with an unknown word names both seeds rather than saying "unexpected"', () => {
  const d = firstDiagnostic('crawl "surface"\n  seed sitemap\n  expect response has no critical security violations\n');
  assert.match(d.message, /expected `openapi` or `traffic` after `seed`/);
  assert.match(d.hint ?? '', /seed openapi/);
  assert.match(d.hint ?? '', /seed traffic/);
});

test('a crawl with no body is an empty block, and the message says what a body needs', () => {
  const d = firstDiagnostic('crawl "surface"\n');
  assert.match(d.message, /this `crawl` has no body/);
  assert.match(d.hint ?? '', /seed/);
});

test('a second `as` clause on a crawl reports a repeat and keeps parsing (A2-06)', () => {
  const source = 'crawl "surface" as peer as shopperBearer\n  seed traffic\n  expect response has no critical security violations\n';
  const { program, diagnostics } = parseSource(source);
  assert.equal(diagnostics.length, 1, `expected exactly one diagnostic: ${JSON.stringify(diagnostics)}`);
  assert.match(diagnostics[0]!.message, /already has an `as` clause/);
  // The first clause stands and the body is still parsed — abandoning the header would report every
  // body line as a stray top-level declaration, which is three diagnostics for one typo.
  const c = (program.crawls ?? [])[0]!;
  assert.deepEqual(c.sessions, ['peer']);
  assert.equal(c.body.length, 1);
});

test('the top-level error names `crawl` among the legal declarations', () => {
  const d = firstDiagnostic('cralw "surface"\n  seed traffic\n');
  assert.match(d.message, /expected a `test`, `crawl`, `action`, `import`, `use`, `before`, or `after`/);
  assert.match(d.hint ?? '', /only `test`, `crawl`,/);
});
