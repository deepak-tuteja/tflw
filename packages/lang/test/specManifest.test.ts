// M154a (`PLAN_M154_DOGFOOD_CONFORMANCE.md`, D736) — the manifest `tflw spec --json` emits.
//
// This file holds two different kinds of claim, and it is worth being clear which is which.
//
// **The parity claims are load-bearing.** `LOCATORS` joins `STEP_KEYWORDS` (D277) and
// `CONFIG_KEYWORDS` (D444) as a hand-authored table held two-way to the parser's own list —
// `spec-data.ts` cannot import `parser.ts` (the dependency runs the other way and a cycle here
// would be a real one), so the two are kept in step by a test or not at all. A row for a locator
// the parser rejects would put a broken spelling in front of every consumer of the manifest; a
// locator with no row would be a construct the conformance gate never demands.
//
// **The assembly claims are anti-regression.** `specConstructs()` is a fold over six tables, and
// the way a fold like this fails is by silently dropping one — the `M141`/`D538` shape, where a
// gate goes quiet rather than red. So every source table is asserted present by count, not by
// sampling. `testFlow-tests`' coverage gate keys on `id`, so uniqueness and stability of that field
// are asserted here rather than discovered across a repository boundary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DECLARATION_KEYWORDS,
  DECLARATIONS,
  describeDeclarations,
  parseSource,
  LOCATOR_KEYWORDS,
  LOCATORS,
  STEP_KEYWORDS,
  WORKLOAD_DIRECTIVES,
  MATCHERS,
  GENERATORS,
  CONFIG_KEYWORDS,
  DIAGNOSTICS,
  SPEC_MANIFEST_VERSION,
  specConstructs,
  CLI_FLAGS,
} from '../src/index.js';

const constructs = specConstructs();
const byId = new Map(constructs.map((c) => [c.id, c]));

test('every locator the parser dispatches on has a manifest entry, and vice versa', () => {
  assert.deepEqual(
    LOCATORS.map((l) => l.id).slice().sort(),
    [...LOCATOR_KEYWORDS].sort(),
    'LOCATORS and parser.ts LOCATOR_KEYWORDS must name the same six words',
  );
});

test('`element` is in neither list — SPEC §9.3 has it planned, and the parser refuses it', () => {
  // D736's worked case. A manifest that listed a planned construct would promise a spelling
  // `parseLocator` rejects; leaving it out means the day it is built it simply appears here, and
  // the sibling repo's `no construct without a row` rule goes red on its own.
  assert.ok(!(LOCATOR_KEYWORDS as readonly string[]).includes('element'));
  assert.ok(!LOCATORS.some((l) => l.id === 'element'));
});

test('ids are unique across the whole manifest', () => {
  assert.equal(byId.size, constructs.length, 'two constructs share an id — the coverage gate keys on it');
});

test('every source table reaches the manifest, by count', () => {
  const count = (family: string) => constructs.filter((c) => c.family === family).length;
  assert.equal(count('declaration'), DECLARATIONS.length, 'DECLARATIONS');
  assert.equal(count('step'), STEP_KEYWORDS.length, 'STEP_KEYWORDS');
  assert.equal(count('matcher'), MATCHERS.length, 'MATCHERS');
  assert.equal(count('generator'), GENERATORS.length, 'GENERATORS');
  assert.equal(count('locator'), LOCATORS.length, 'LOCATORS');
  assert.equal(count('config'), CONFIG_KEYWORDS.length, 'CONFIG_KEYWORDS');
  assert.equal(count('diagnostic'), DIAGNOSTICS.length, 'DIAGNOSTICS');
  assert.equal(
    constructs.length,
    DECLARATIONS.length + STEP_KEYWORDS.length + MATCHERS.length + GENERATORS.length + LOCATORS.length + CONFIG_KEYWORDS.length + DIAGNOSTICS.length,
    'the manifest is exactly the seven tables and nothing else',
  );
});

test('the workload shapes are step keywords, not a seventh family', () => {
  // `WORKLOAD_DIRECTIVES` and `STEP_KEYWORDS`' `workload` family are the same seven words. Emitting
  // both would put two ids on one construct, and a coverage gate would then be able to call `ramp`
  // covered under one id while the other stayed red for ever.
  const workload = constructs.filter((c) => c.family === 'step' && c.group === 'workload').map((c) => c.name);
  assert.deepEqual(workload.slice().sort(), [...WORKLOAD_DIRECTIVES].sort());
});

test('the four workload shapes M154 was scoped for are demandable constructs', () => {
  // `cleanup` was the fifth id checked here until `M157c` removed the construct and, with it, its
  // row — `D724` in the direction it is rarely read. It is not replaced by `config:key:teardown`:
  // this test is about the *workload-shape* census, and the new key is a config construct that the
  // `CONFIG_KEYWORDS` half of the manifest covers.

  // Not a tautology worth deleting: these four are the census's headline — `hold`, `step`, `spike`
  // and `run … iterations` have never been executed by anything in `testFlow-tests`, and the gate
  // that will demand them can only do so if they carry ids. Naming them pins that.
  for (const shape of ['hold', 'step', 'spike', 'run']) {
    assert.ok(byId.has(`step:${shape}`), `no manifest id for the workload shape \`${shape}\``);
  }
});

test('status is `shipped` unless a source table says otherwise, and only MATCHERS can', () => {
  // D736: the manifest lists what the parser dispatches. `MATCHERS` is the single table carrying its
  // own `status` field (M97b), so a `planned` construct can only ever come from there — anywhere
  // else it would mean the fold invented one.
  for (const c of constructs) {
    if (c.status === 'planned') assert.equal(c.family, 'matcher', `\`${c.id}\` is planned but not a matcher`);
  }
  const plannedMatchers = MATCHERS.filter((m) => m.status === 'planned').map((m) => `matcher:${m.id}`);
  assert.deepEqual(constructs.filter((c) => c.status === 'planned').map((c) => c.id), plannedMatchers);
});

test('diagnostics carry their code and none of SPEC §17’s prose', () => {
  // ~78 KB of markdown written for a spec table, in a document a gate reads on every run. The code
  // is the construct; `meaning` and `example` stay where they are rendered.
  const one = byId.get('diagnostic:TF001');
  assert.ok(one, 'TF001 is missing from the manifest');
  assert.equal(one.name, 'TF001');
  assert.equal(one.summary, undefined);
  assert.equal(one.example, undefined);
  assert.equal(one.syntax, undefined);
});

test('a fresh array each call — a consumer cannot mutate the next caller’s manifest', () => {
  const a = specConstructs();
  const b = specConstructs();
  assert.notEqual(a, b);
  assert.deepEqual(a, b);
});

test('the manifest version is an integer a consumer can pin', () => {
  assert.equal(typeof SPEC_MANIFEST_VERSION, 'number');
  assert.ok(Number.isInteger(SPEC_MANIFEST_VERSION) && SPEC_MANIFEST_VERSION >= 1);
});

// --- the declaration dialect (`M154c`, `D742`) --------------------------------
//
// These are parity claims of the load-bearing kind, and they are made **behaviourally**. The other
// two-way tables in this file compare a manifest table against a parser array, which proves the two
// arrays agree and nothing more — if both were edited from the same wrong belief, both are wrong
// together. A declaration is cheap to just *try*, so these parse a minimal file per row and ask the
// parser what it did with it.

/** The smallest file in which `word` is a well-formed top-level declaration. */
function minimalDeclaration(word: string): string {
  switch (word) {
    case 'test': return 'test "t"\n  api GET /a\n';
    case 'crawl': return 'crawl "c"\n  expect response has no critical security violations\n';
    case 'action': return 'action make thing()\n  api GET /a\n';
    case 'import': return 'import "./other.tflw"\n';
    case 'use': return 'use "./helper.ts"\n';
    case 'before': return 'before file\n  api GET /a\n';
    case 'after': return 'after file\n  api GET /a\n';
    default: throw new Error(`no minimal file written for the declaration \`${word}\` — add one when you add the row`);
  }
}

test('every declaration the parser dispatches on has a manifest entry, and vice versa', () => {
  assert.deepEqual(
    DECLARATIONS.filter((d) => d.group === 'declaration').map((d) => d.id).sort(),
    [...DECLARATION_KEYWORDS].sort(),
    'DECLARATIONS and parser.ts DECLARATION_KEYWORDS must name the same seven words',
  );
});

test('the parser actually accepts every declaration the manifest offers', () => {
  for (const word of DECLARATION_KEYWORDS) {
    const { diagnostics } = parseSource(minimalDeclaration(word));
    const rejected = diagnostics.filter((d) => d.code === 'TF016');
    assert.deepEqual(rejected, [], `\`${word}\` is in the manifest but the top level refused it`);
  }
});

test('a word that is not a declaration is refused, so the check above can fail', () => {
  // The control. Without it, `minimalDeclaration` returning something the parser ignores entirely
  // would make the test above pass for every possible input — the vacuous-green class `M141` is
  // named after.
  const { diagnostics } = parseSource('teardown\n  api GET /a\n');
  assert.ok(diagnostics.some((d) => d.code === 'TF016'), 'the top level accepted `teardown`');
});

test('every test-header clause the manifest offers parses on a real header', () => {
  const header: Record<string, string> = {
    tags: '@smoke\ntest "t"\n  api GET /a\n',
    'with-each': 'with each\n  | name |\n  | a    |\ntest "t"\n  api GET /a\n',
    as: 'test "t" as shopper\n  api GET /a\n',
    retry: 'test "t" retry 2\n  api GET /a\n',
    concurrency: 'test "t" sequential\n  api GET /a\n',
  };
  // No parser-side array to compare against, on purpose (see `DECLARATION_KEYWORDS`' neighbour
  // comment): three of these ids are not words the language has. Every header row must carry a
  // sample, so adding one to the manifest without proving it parses fails here.
  for (const clause of DECLARATIONS.filter((d) => d.group === 'header').map((d) => d.id)) {
    const source = header[clause];
    assert.ok(source, `no header written for \`${clause}\` — add one when you add the row`);
    const { diagnostics } = parseSource(source);
    assert.deepEqual(diagnostics, [], `\`${clause}\` is in the manifest but a header using it did not parse`);
  }
});

test('the top-level error message names every declaration, and is rendered from one list', () => {
  // `M142-01`'s rule, applied to the list that used to be spelled out twice inside the branch that
  // reports it. A declaration added without its rendering would otherwise ship an error message
  // telling the author their valid keyword does not exist.
  const rendered = describeDeclarations();
  for (const word of DECLARATION_KEYWORDS) {
    assert.ok(rendered.includes(`\`${word}\``), `the top-level error does not mention \`${word}\``);
  }
  const { diagnostics } = parseSource('teardown\n');
  const top = diagnostics.find((d) => d.code === 'TF016');
  assert.ok(top && top.message.includes(rendered), 'the diagnostic does not use the shared rendering');
});

// ---- M154g-03: the manifest's prose is a fourth flag surface, and it was unchecked -----------

test('every CLI flag the construct manifest names is a real flag in CLI_FLAGS', () => {
  // `CLI_FLAGS` is checked against `tflw --help` in *both* directions already (M62/M63, in
  // `packages/cli/test/e2e.test.ts`) — but the construct manifest is a third consumer of the same
  // vocabulary and nothing compared it to the registry. `declaration:tags` advertised
  // `--tag`/`--exclude-tag` selection; `--exclude-tag` has never existed, `tflw run --exclude-tag`
  // answers `unknown flag`, and SPEC §4.1 says outright "No exclusion syntax". The string occurred
  // exactly once in the whole repository — in that summary — so nothing implemented it, nothing
  // removed it, and no test asserted it.
  //
  // What makes this cheap enough to be worth gating: the entire 178-construct manifest names only
  // six distinct flags, so this is a six-element check that closes the class rather than the one
  // instance. `D723` designates the manifest as the program's own account of itself, and a
  // conformance gate reads its *ids*; its prose was the part nobody had pointed anything at.
  const known = new Set(CLI_FLAGS.flatMap((f) => [...f.flag.matchAll(/(--[a-z][a-z0-9-]*)/g)].map((m) => m[1])));

  const phantom: string[] = [];
  for (const c of specConstructs()) {
    for (const field of ['summary', 'syntax', 'example'] as const) {
      for (const m of String(c[field] ?? '').matchAll(/--[a-z][a-z0-9-]*/g)) {
        if (!known.has(m[0])) phantom.push(`${c.id}.${field} names ${m[0]}`);
      }
    }
  }
  assert.deepEqual(phantom, [], 'a manifest summary may only name a flag `tflw` actually takes');
});

// The check above is only as good as its haystack: if the manifest ever stopped naming flags at
// all it would pass vacuously and say nothing. Seven is the count today: `M157e` added `--teardown`
// on its own new row and `--evidence` on the row beside it, applying `M156`'s `D780` rule — a
// config key's summary says which command overrides it — to the one that had the shape already and
// did not say so.
test('…and the manifest does name flags, so the check above is not vacuous', () => {
  const named = new Set<string>();
  for (const c of specConstructs()) {
    for (const field of ['summary', 'syntax', 'example'] as const) {
      for (const m of String(c[field] ?? '').matchAll(/--[a-z][a-z0-9-]*/g)) named.add(m[0]);
    }
  }
  assert.deepEqual(
    [...named].sort(),
    ['--env', '--evidence', '--now', '--seed', '--tag', '--teardown', '--workers'],
    'the manifest names exactly these flags — update this list deliberately, never to make a failure go away',
  );
});

// ---- M159g/D806d: which phase decides a diagnostic -------------------------------------------
//
// `phase` exists for one consumer in another repository, which is the weakest position a field can
// be in: nothing here would notice it going wrong, and the gate that reads it would report the
// wrong thing rather than nothing. So it is checked from both sides against the evidence it is
// derived from, and the derivation is checked for being a derivation.

test('every diagnostic construct says which phase decides it, and no other construct does', () => {
  for (const c of specConstructs()) {
    if (c.family === 'diagnostic') {
      assert.ok(c.phase === 'check' || c.phase === 'run', `${c.id} carries no phase`);
    } else {
      assert.equal(c.phase, undefined, `${c.id} is not a diagnostic and must not claim a phase`);
    }
  }
});

test('the `run` phase names exactly the rows whose evidence is a runtime test', () => {
  // Both directions, against `DIAGNOSTICS` itself rather than against a written-down list: a code
  // whose row carries `runtime` is unprovable by `tflw check`, and a code whose row carries probes
  // is provable by nothing else. `spec-data.ts` already forces exactly one of the two, so these two
  // sets partition the manifest and a third answer is not expressible.
  const byPhase = (phase: string) => specConstructs().filter((c) => c.family === 'diagnostic' && c.phase === phase).map((c) => c.name).sort();
  assert.deepEqual(byPhase('run'), DIAGNOSTICS.filter((d) => d.runtime).map((d) => d.code).sort());
  assert.deepEqual(byPhase('check'), DIAGNOSTICS.filter((d) => d.probes).map((d) => d.code).sort());
  // Not vacuous in either direction. Written as a floor rather than a count so adding a code does
  // not edit this line, and as a floor above zero because an empty `run` set would satisfy the two
  // assertions above while telling the sibling's gate that no code needs a runtime proof.
  assert.ok(byPhase('run').length >= 2, `expected the runtime-only codes to be present, got ${byPhase('run').join(', ')}`);
  assert.ok(byPhase('check').length > 50);
});

test('phase is derived from the row, not stored beside it', () => {
  // The control this file can actually run: every `run` code is one no probe exists for. If `phase`
  // were ever hand-written, a row could claim `check` while carrying no probe — the state where the
  // sibling demands a fixture nobody can write and the failure names the wrong repository.
  for (const code of specConstructs().filter((c) => c.family === 'diagnostic' && c.phase === 'run').map((c) => c.name)) {
    const row = DIAGNOSTICS.find((d) => d.code === code)!;
    assert.equal(row.probes, undefined, `${code} is phase \`run\` and still carries probes`);
    assert.ok(row.runtime?.test && row.runtime.name, `${code} is phase \`run\` and names no runtime test`);
  }
});
