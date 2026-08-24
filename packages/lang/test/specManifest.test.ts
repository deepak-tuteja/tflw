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
  assert.equal(count('step'), STEP_KEYWORDS.length, 'STEP_KEYWORDS');
  assert.equal(count('matcher'), MATCHERS.length, 'MATCHERS');
  assert.equal(count('generator'), GENERATORS.length, 'GENERATORS');
  assert.equal(count('locator'), LOCATORS.length, 'LOCATORS');
  assert.equal(count('config'), CONFIG_KEYWORDS.length, 'CONFIG_KEYWORDS');
  assert.equal(count('diagnostic'), DIAGNOSTICS.length, 'DIAGNOSTICS');
  assert.equal(
    constructs.length,
    STEP_KEYWORDS.length + MATCHERS.length + GENERATORS.length + LOCATORS.length + CONFIG_KEYWORDS.length + DIAGNOSTICS.length,
    'the manifest is exactly the six tables and nothing else',
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
  // Not a tautology worth deleting: these four are the census's headline — `hold`, `step`, `spike`
  // and `run … iterations` have never been executed by anything in `testFlow-tests`, and the gate
  // that will demand them can only do so if they carry ids. Naming them pins that.
  for (const shape of ['hold', 'step', 'spike', 'run', 'cleanup']) {
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
