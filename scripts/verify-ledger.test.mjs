// The ledger guard, run against ledgers whose defects are known (M113).
//
// `verify-ledger.mjs` exists because §6's awk one-liner is a check that runs, passes, and cannot
// see the thing it is asked about. Shipping a *second* such check would be the joke telling itself,
// so every case here breaks a fixture ledger in one specific way and asserts the guard notices —
// and three of them are not hypotheticals but reconstructions of defects the real ledger was
// carrying on 2026-08-08: `M98c-02`'s missing `🚫`, `M99`'s three rows left `open` after the code
// shipped, and a published tally typed from a stale count.
//
// The two easiest ways to be accidentally green are both pinned here: `sound()` asserts the guard
// stays quiet on a clean ledger (a checker that always complains proves nothing), and the shipped
// flag is varied while everything else is held constant (a checker that flags an `open` row
// regardless of whether the milestone shipped would pass the staleness cases for the wrong reason).

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { check, classify, isWellFormed, parseIndex, planClaims, newestPublishedTally } from './verify-ledger.mjs'

const execFileAsync = promisify(execFile)
const SCRIPT = fileURLToPath(new URL('verify-ledger.mjs', import.meta.url))

/** A minimal but structurally faithful ledger: a prose tally, then §6 with rows. */
function ledger({ rows, tally = null, milestone = 'M99' }) {
  const t = tally ?? countOf(rows)
  return [
    '# Review findings',
    '',
    `**Ledger after \`${milestone}\` (re-derived with §6's own awk one-liner): ${t.open} open — S2 ${t.s2} ·`,
    `S3 ${t.s3} · S4 ${t.s4} — ${t.closed} closed, ${t.deferred} deferred, ${t.withdrawn} withdrawn,`,
    `${t.total} total.**`,
    '',
    '## 6. Full index',
    '',
    '| id | sev | claim | status |',
    '|---|---|---|---|',
    ...rows.map(([id, sev, status]) => `| \`${id}\` | ${sev} | a claim | ${status} |`),
    '',
    '## 7. Something else',
    '',
    '| `NOT-01` | S2 | outside §6 | open |',
  ].join('\n')
}

function countOf(rows) {
  const t = { open: 0, closed: 0, deferred: 0, withdrawn: 0, total: rows.length, s2: 0, s3: 0, s4: 0 }
  for (const [, sev, status] of rows) {
    const k = classify(status)
    t[k]++
    if (k === 'open') t[sev.toLowerCase()]++
  }
  return t
}

const CLEAN = [
  ['A3-05', 'S2', '✅ **M99a** — fixed'],
  ['A3-08', 'S3', '✅ **M99a** — fixed'],
  ['B3-04', 'S2', 'open'],
  ['M98c-02', 'S4', '🚫 **withdrawn** — filed wrong'],
  ['A4-07', 'S2', '🟨 **M97c** — shipped in part'],
  ['A2-10', 'S3', '⏸ B'],
]

const M99_PLAN = {
  file: 'PLAN_M99_VALUE_TERMINATION.md',
  milestone: '99',
  ids: ['A3-05', 'A3-08'],
}

const sound = (over = {}) => ({ ledger: ledger({ rows: CLEAN }), plans: [M99_PLAN], shipped: new Set(['99']), ...over })

test('a sound ledger produces no problems', () => {
  const { problems, derived } = check(sound())
  assert.deepEqual(problems, [], problems.join('\n'))
  assert.equal(derived.total, 6)
  assert.equal(derived.open, 2) // `B3-04` and the `🟨` partial — `🟨` counts open, as §6's awk does
})

test('the row outside §6 is not counted', () => {
  assert.equal(parseIndex(ledger({ rows: CLEAN })).length, 6)
})

// ---- 1. status vocabulary — the `M98c-02` defect, reconstructed -------------------------------

test('a status cell saying `withdrawn` with no 🚫 is caught', () => {
  // The real defect: the row read exactly this, and §6's awk counted it open in every published
  // tally from 2026-08-07 until M113 — because to the awk, `withdrawn` is just prose.
  const rows = CLEAN.map((r) => (r[0] === 'M98c-02' ? ['M98c-02', 'S4', 'withdrawn'] : r))
  const { problems } = check(sound({ ledger: ledger({ rows }) }))
  assert.equal(problems.length, 1, problems.join('\n'))
  assert.match(problems[0], /`M98c-02`.*counts the row OPEN/)
})

test('the classifier and the well-formedness rule agree on what is sanctioned', () => {
  for (const [status, kind] of [
    ['✅ M99', 'closed'],
    ['⏸ B', 'deferred'],
    ['🚫 withdrawn', 'withdrawn'],
    ['🟨 partial', 'open'],
    ['open', 'open'],
    ['open — with a note', 'open'],
  ]) {
    assert.equal(classify(status), kind, status)
    assert.equal(isWellFormed(status), true, status)
  }
  for (const status of ['withdrawn', 'closed', 'fixed in M60', 'record', 'done', ''])
    assert.equal(isWellFormed(status), false, status)
})

test('a duplicated row id is caught', () => {
  const { problems } = check(sound({ ledger: ledger({ rows: [...CLEAN, ['B3-04', 'S2', 'open']] }) }))
  assert.ok(problems.some((p) => /`B3-04` is listed twice/.test(p)), problems.join('\n'))
})

// ---- 2. plan ↔ ledger — the `M99` defect, reconstructed ---------------------------------------

const STALE_M99 = CLEAN.map((r) => (r[0] === 'A3-05' || r[0] === 'A3-08' ? [r[0], r[1], 'open'] : r))

test('rows a shipped plan says it closed, still reading open, are caught', () => {
  const { problems } = check(sound({ ledger: ledger({ rows: STALE_M99 }) }))
  const stale = problems.filter((p) => /says M99 closes/.test(p))
  assert.equal(stale.length, 2, problems.join('\n'))
  assert.match(stale[0], /`A3-05`.*still reads "open"/)
})

test('the same rows are NOT flagged while the milestone is unshipped', () => {
  // The control that decides whether the case above proves anything. Identical ledger, identical
  // plan; only `shipped` changes. A guard that flagged any `open` row named by any plan would pass
  // the test above while being useless — a plan names the rows it is *about* to close.
  const { problems } = check(sound({ ledger: ledger({ rows: STALE_M99 }), shipped: new Set() }))
  assert.equal(problems.filter((p) => /says M99 closes/.test(p)).length, 0, problems.join('\n'))
})

test('a 🟨 partial named by a shipped plan is not flagged', () => {
  // `A4-07` is exactly this in the real ledger: `M97c` shipped and deliberately left a remainder.
  // Without this carve-out the guard cries wolf on every honest partial and gets switched off.
  const { problems } = check(sound({ plans: [{ file: 'PLAN_M97_X.md', milestone: '97', ids: ['A4-07'] }], shipped: new Set(['97']) }))
  assert.deepEqual(problems, [])
})

test('a plan claims only the rows in its opening paragraph', () => {
  // A plan's body cites dozens of rows as background; its header states the charter. Reading the
  // whole file would turn every citation into a closure claim and bury the signal — measured on
  // the 12 real plans, the header window yields 44 ids and exactly one flag.
  const plan = ['# Plan', 'Closes `A3-05`,', 'together with `A3-08`.', 'Body prose citing `B3-04` as background.'].join('\n')
  assert.deepEqual(planClaims(plan, 2), ['A3-05'])
  assert.deepEqual(planClaims(plan, 3), ['A3-05', 'A3-08'])
  assert.deepEqual(planClaims(plan, 4), ['A3-05', 'A3-08', 'B3-04'])
})

// ---- 3. published tally ↔ derived tally -------------------------------------------------------

test('a published tally that disagrees with the column is caught', () => {
  const t = { ...countOf(CLEAN), open: 3 } // one more than the column supports
  const { problems } = check(sound({ ledger: ledger({ rows: CLEAN, tally: t }) }))
  assert.equal(problems.length, 1, problems.join('\n'))
  assert.match(problems[0], /published for M99 says open=3; the status column says open=2/)
})

test('the newest tally wins even when an older one sits below it in the file', () => {
  // Not hypothetical: `M112`'s paragraph physically precedes `M113`'s, and `M113`'s wraps across
  // three lines inside a blockquote. Both properties are exercised here.
  const text = [
    '**Ledger after `M112`: 80 open — S2 19 · S3 43 · S4 18 — 159 closed, 3 deferred, 2 withdrawn, 244 total.**',
    '',
    '> Superseded by `M113`: the ledger is now 76 open — S2 16 · S3 44 · S4 16 — 164 closed,',
    '> 3 deferred, 4 withdrawn, 247 total.',
  ].join('\n')
  const t = newestPublishedTally(text)
  assert.equal(t.milestone, 113)
  assert.equal(t.open, 76)
  assert.equal(t.total, 247)
})

test('a tally naming no milestone is treated as history, not as current', () => {
  assert.equal(newestPublishedTally('Once: 9 open — S2 1 · S3 2 · S4 3 — 5 closed, 0 deferred, 0 withdrawn, 14 total.'), null)
})

test('a ledger with no §6 rows is a problem, not a pass', () => {
  const { problems } = check(sound({ ledger: '# Review findings\n\n## 6. Full index\n\nnothing here\n' }))
  assert.ok(problems.some((p) => /no rows/.test(p)), problems.join('\n'))
})

// ---- the anti-vacuity property ---------------------------------------------------------------

test('a missing ledger is a hard failure, never a skip', async () => {
  // The whole point. `REVIEW_FINDINGS.md` is gitignored, so the one environment where this guard
  // could quietly pass on an empty corpus is the one that runs everything — CI. It must not.
  const root = await mkdtemp(join(tmpdir(), 'tflw-ledger-test-'))
  try {
    const r = await execFileAsync(process.execPath, [SCRIPT], {
      env: { ...process.env, TFLW_LEDGER_ROOT: root, NO_COLOR: '1' },
    }).then(
      () => ({ code: 0, stderr: '' }),
      (e) => ({ code: e.code ?? 1, stderr: e.stderr ?? '' }),
    )
    assert.equal(r.code, 1)
    assert.match(r.stderr, /not found/)
    assert.match(r.stderr, /never a skip/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
