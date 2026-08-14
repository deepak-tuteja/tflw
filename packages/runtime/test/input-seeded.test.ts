// M134b (PLAN_M134_PENTEST_TIER3.md D369/D388) — the seeded mutation layer.
//
// **The load-bearing test in this file is that the layer grants nothing.** `--probe-seeded` is a
// command-line flag and a mutation class is a claim in `tflw.config`; if asking for more payloads
// could reach `traversal` on a target that never wrote `probe traversal`, D372 would be undone by
// the back door and the safety model would have a hole whose entrance is a number. The generator's
// signature makes that structurally impossible — it is handed the *granted* classes, never the full
// set — and the tests below assert the consequence rather than the structure, because a later
// refactor can change the structure without anyone noticing it changed the consequence.
//
// The second theme is that generated payloads have to meet the same standard the reviewed corpus
// does. `defineCorpus` throws on a payload no rule can read, and nothing can throw here — so the
// vacuity properties are asserted over a drawn set instead. A generated payload that violates no
// invariant is a request sent for nothing, and at 64 per class that is thousands of them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INPUT_CORPUS, type MutationClass, type Payload } from '../src/inputCorpus.js';
import { MAX_SEEDED_PER_CLASS, SEEDED_ID_PREFIX, seededIds, seededPayloads } from '../src/inputSeeded.js';

const SEED = 0x5eed;
const ALL: MutationClass[] = ['type-confusion', 'injection', 'oversized', 'traversal'];
const DEFAULT_ON: MutationClass[] = ['type-confusion', 'injection'];

function classesIn(payloads: readonly Payload[]): Set<MutationClass> {
  return new Set(payloads.map((p) => p.class));
}

// ---------------------------------------------------------------------------
// D388 — the layer grants nothing
// ---------------------------------------------------------------------------

test('a target that granted only the default classes gets no opt-in payloads, whatever n is', () => {
  for (const n of [1, 8, MAX_SEEDED_PER_CLASS]) {
    const drawn = seededPayloads(DEFAULT_ON, n, SEED);
    assert.deepEqual([...classesIn(drawn)].sort(), ['injection', 'type-confusion']);
  }
});

// The interesting direction: the flag is the *only* thing that grew, and the answer must not.
test('raising --probe-seeded cannot reach a class the config withheld', () => {
  const small = seededPayloads(['type-confusion'], 1, SEED);
  const large = seededPayloads(['type-confusion'], MAX_SEEDED_PER_CLASS, SEED);
  assert.deepEqual([...classesIn(small)], ['type-confusion']);
  assert.deepEqual([...classesIn(large)], ['type-confusion']);
  assert.equal(large.length, MAX_SEEDED_PER_CLASS);
});

test('a target that granted every class gets n payloads in each of the four', () => {
  const drawn = seededPayloads(ALL, 3, SEED);
  assert.equal(drawn.length, 12);
  for (const klass of ALL) assert.equal(drawn.filter((p) => p.class === klass).length, 3);
});

test('the layer off sends nothing extra — n = 0 is byte-for-byte the pre-M134b corpus', () => {
  assert.deepEqual(seededPayloads(ALL, 0, SEED), []);
});

// ---------------------------------------------------------------------------
// Determinism — the reason a seeded finding can print a seed at all
// ---------------------------------------------------------------------------

test('the same seed draws the same payloads, values and all', () => {
  assert.deepEqual(seededPayloads(ALL, 5, SEED), seededPayloads(ALL, 5, SEED));
});

test('a different seed draws different payloads', () => {
  const a = seededPayloads(ALL, 8, SEED);
  const b = seededPayloads(ALL, 8, SEED + 1);
  assert.notDeepEqual(
    a.map((p) => p.text ?? JSON.stringify(p.json)),
    b.map((p) => p.text ?? JSON.stringify(p.json)),
  );
});

// Each class draws from its own sub-seed, so granting `probe traversal` to a target does not silently
// re-roll the injection payloads that target was already sending — which would make "the run changed
// because I added a class" indistinguishable from "the run changed because the app changed".
test('granting another class does not shift the payloads an existing class draws', () => {
  const before = seededPayloads(DEFAULT_ON, 4, SEED).filter((p) => p.class === 'injection');
  const after = seededPayloads(ALL, 4, SEED).filter((p) => p.class === 'injection');
  assert.deepEqual(before, after);
});

test('the order classes were granted in does not change the draw', () => {
  assert.deepEqual(seededPayloads(['traversal', 'injection'], 4, SEED), seededPayloads(['injection', 'traversal'], 4, SEED));
});

// ---------------------------------------------------------------------------
// The bound (D381's sequential probe is what makes n a wall-clock cost)
// ---------------------------------------------------------------------------

test('a value past the bound is refused rather than clamped', () => {
  // Clamping would make the run quieter than the flag the operator typed, and the whole argument for
  // this layer is that its output gets read rather than trusted.
  assert.throws(() => seededPayloads(ALL, MAX_SEEDED_PER_CLASS + 1, SEED), /exceeds the 64-per-class bound/);
});

test('a fractional or negative count is refused', () => {
  assert.throws(() => seededPayloads(ALL, 2.5, SEED), /whole number/);
  assert.throws(() => seededPayloads(ALL, -1, SEED), /whole number/);
});

// ---------------------------------------------------------------------------
// Generated payloads meet the reviewed corpus's own standard
// ---------------------------------------------------------------------------

test('every generated payload could actually be read by a rule and delivered somewhere', () => {
  for (const p of seededPayloads(ALL, MAX_SEEDED_PER_CLASS, SEED)) {
    assert.ok(p.invariants.length > 0, `${p.id} declares no invariant — a request sent for nothing`);
    assert.ok(p.targets.length > 0, `${p.id} can never be delivered`);
    assert.ok(p.text !== undefined || p.json !== undefined, `${p.id} carries nothing to send`);
    // `inputCorpus.ts`'s D371 rule: only a body leaf can carry a JSON value, so anything aimed at a
    // path or query segment must have text.
    if (p.targets.some((t) => t !== 'body')) assert.notEqual(p.text, undefined, `${p.id} targets a non-body site with no text`);
  }
});

test('generated ids are unique, and unique against the reviewed corpus too', () => {
  const drawn = seededPayloads(ALL, MAX_SEEDED_PER_CLASS, SEED);
  const ids = new Set(drawn.map((p) => p.id));
  assert.equal(ids.size, drawn.length);
  // A collision with a corpus id would collapse two payloads into one row and one fingerprint —
  // `defineCorpus` refuses that inside the constant, and nothing checks across the two halves.
  for (const p of INPUT_CORPUS) assert.equal(ids.has(p.id), false);
});

test('generated ids carry the seeded prefix so a report reads unambiguously', () => {
  for (const p of seededPayloads(ALL, 2, SEED)) assert.ok(p.id.startsWith(SEEDED_ID_PREFIX), p.id);
});

// The injection stream must produce both shapes it declares invariants for. A stream that only ever
// emitted unbalanced quoting would leave `reflected-input-unescaped` permanently not-applicable in
// the seeded half, which is the vacuity D291 refuses — a control with no positive that exercises it.
test('the injection stream produces both a template expression and unbalanced quoting', () => {
  const texts = seededPayloads(['injection'], MAX_SEEDED_PER_CLASS, SEED).map((p) => p.text ?? '');
  assert.ok(texts.some((t) => /7\*7/.test(t)), 'no template expression in 64 draws');
  assert.ok(texts.some((t) => t.startsWith('tflw')), 'no quoting payload in 64 draws');
});

test('a generated oversized value stays under the reviewed corpus’s own 64 KiB', () => {
  for (const p of seededPayloads(['type-confusion', 'injection', 'oversized'], MAX_SEEDED_PER_CLASS, SEED)) {
    if (p.class === 'oversized') assert.ok((p.text ?? '').length < 64 * 1024, `${p.id} is ${(p.text ?? '').length} chars`);
  }
});

test('a generated traversal payload names a target and repeats a prefix', () => {
  for (const p of seededPayloads(['traversal'], 16, SEED)) {
    assert.match(p.text ?? '', /(\.\.|%2e%2e)/);
  }
});

// ---------------------------------------------------------------------------
// `seededIds` — what the report boundary uses to decide whether a finding gates
// ---------------------------------------------------------------------------

test('seededIds maps each drawn payload id to the value it delivered', () => {
  const drawn = seededPayloads(['injection'], 3, SEED);
  const map = seededIds(drawn);
  assert.equal(map.size, 3);
  for (const p of drawn) assert.equal(map.get(p.id), p.text);
});

// Membership, not the prefix. If the boundary matched on `seeded/` a corpus payload named that way
// would silently stop gating — a reviewed finding downgraded to a suggestion by a naming choice.
test('a reviewed payload named like a seeded one is not in the drawn set', () => {
  const map = seededIds(seededPayloads(['injection'], 2, SEED));
  assert.equal(map.has(`${SEEDED_ID_PREFIX}injection/999`), false);
});

test('an empty draw yields an empty set, so a run without the layer looks nothing up', () => {
  assert.equal(seededIds(seededPayloads(ALL, 0, SEED)).size, 0);
});
