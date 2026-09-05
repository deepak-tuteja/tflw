// The corpus gate, against declarations whose defects are known (`M171a`).
//
// This file has the same hazard `verify-ledger.test.mjs` opens with, one level further out: a gate
// that checks declarations can itself be checked by a test that only ever sees good declarations.
// So every case here hands `plants()` or `resolve()` something specific and wrong, and asserts the
// gate says so — and one case asserts the real declarations pass, because a checker that always
// complains proves nothing either.

import test from 'node:test'
import assert from 'node:assert/strict'

import { CORPORA, plants, resolve, records } from './verify-corpora.mjs'

test('every declaration states a subject, a resolver and at least one plant', () => {
  assert.ok(CORPORA.length > 0, 'the registry is empty — no guard has taken this shape')
  for (const c of CORPORA) {
    assert.equal(typeof c.id, 'string', `${c.id}: no id`)
    assert.ok(c.subject?.length > 20, `${c.id}: a subject has to say something`)
    assert.equal(typeof c.resolve, 'function', `${c.id}: no resolver`)
    assert.ok(c.plants?.length > 0, `${c.id}: no plant`)
    assert.ok(Array.isArray(c.needs), `${c.id}: no needs — say what this checkout must supply, even if it is nothing`)
  }
})

test('the real declarations pass their own plants', () => {
  const bad = plants().filter((p) => !p.ok)
  assert.deepEqual(bad, [], bad.map((b) => `${b.id} — ${b.what}: ${b.why}`).join('\n'))
})

test('a declaration with no plant is reported, not skipped', () => {
  // The whole difference between this gate and a docblock convention. A corpus nothing can be
  // planted inside makes exactly the claim `M171` exists to stop trusting.
  const r = plants([{ id: 'x', subject: 'a subject long enough to pass', resolve: () => ({ units: 1, describe: '' }), plants: [] }])
  assert.equal(r.length, 1)
  assert.equal(r[0].ok, false)
  assert.match(r[0].why, /sentence, not a guard/)
})

test('a plant the guard does not catch is reported', () => {
  const r = plants([{ id: 'x', subject: 's'.repeat(30), resolve: () => ({ units: 1 }), plants: [{ what: 'w', run: () => false }] }])
  assert.equal(r[0].ok, false)
  assert.match(r[0].why, /did not catch/)
})

test('a plant that throws is reported as a failure, never as a pass', () => {
  const r = plants([{ id: 'x', subject: 's'.repeat(30), resolve: () => ({ units: 1 }), plants: [{ what: 'w', run: () => { throw new Error('boom') } }] }])
  assert.equal(r[0].ok, false)
  assert.match(r[0].why, /threw: boom/)
})

test('an empty corpus is a failure — a resolver that finds nothing has found nothing', () => {
  const r = resolve({ ledger: '', plans: [] }, [
    { id: 'x', subject: 's'.repeat(30), resolve: () => ({ units: 0, describe: 'nothing' }), plants: [] },
  ])
  assert.equal(r[0].ok, false)
})

test('absent records are reported field by field, not as one absent tier (`D874`, `M171b`)', () => {
  // The tier-2 half of `D683`'s shape. The records are gitignored; a gate that reported them as
  // checked on a CI runner would be `M171`'s own defect wearing this milestone's badge.
  //
  // `M171b` is why this is per-field. While the ledger was the only guard with a declared corpus,
  // `records()` returned `null` whole and `resolve()` skipped everything — correct by accident,
  // because every declaration happened to need the same file. The scrub gate's two corpora need
  // only the repository, and under the old shape a CI runner would have printed *corpus resolution
  // did not run* over two corpora it could have resolved. A gate claiming less than it checked is
  // the same defect as one claiming more; it just fails in the polite direction.
  assert.equal(resolve(null), null)
  const rec = records('/nonexistent-root-for-this-test')
  assert.equal(rec.ledger, null)
  assert.equal(rec.plans, null)
  assert.equal(rec.root, '/nonexistent-root-for-this-test')
})

test('a declaration whose needs are unmet is skipped by name, beside one that still resolves', () => {
  const declared = [
    { id: 'needs-the-records', subject: 's'.repeat(30), needs: ['ledger'], plants: [],
      resolve: () => ({ units: 1, describe: 'read the ledger' }) },
    { id: 'needs-only-the-repo', subject: 's'.repeat(30), needs: [], plants: [],
      resolve: () => ({ units: 7, describe: 'read the checkout' }) },
  ]
  const r = resolve({ root: '/somewhere', ledger: null, plans: null }, declared)
  assert.match(r[0].skipped, /needs ledger/)
  assert.equal(r[0].ok, undefined, 'a skipped corpus is neither green nor red')
  assert.equal(r[1].ok, true, 'the one that needs nothing absent still resolves')
  assert.equal(r[1].units, 7)
})

test('the registry is not all one kind — some corpora need the records and some need only the repo', () => {
  // If every declaration needed the same thing, the per-field split above would be untested by the
  // real registry and would rot the first time it mattered. This asserts the mixture exists.
  const needsRecords = CORPORA.filter((c) => c.needs.length > 0)
  const repoOnly = CORPORA.filter((c) => c.needs.length === 0)
  assert.ok(needsRecords.length > 0, 'no declaration needs the gitignored records')
  assert.ok(repoOnly.length > 0, 'no declaration is resolvable on a CI checkout')
})

test('a resolver that throws does not take the gate down with it', () => {
  const r = resolve({ ledger: '', plans: [] }, [
    { id: 'x', subject: 's'.repeat(30), resolve: () => { throw new Error('nope') }, plants: [] },
  ])
  assert.equal(r[0].ok, false)
  assert.match(r[0].describe, /threw: nope/)
})
