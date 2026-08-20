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
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
  check,
  classify,
  isWellFormed,
  locate,
  milestoneTokens,
  parseIndex,
  parseStamp,
  planClaims,
  newestPublishedTally,
  staleReport,
} from './verify-ledger.mjs'

const execFileAsync = promisify(execFile)
const SCRIPT = fileURLToPath(new URL('verify-ledger.mjs', import.meta.url))

/** A minimal but structurally faithful ledger: a prose tally, then §6 with rows. */
function ledger({ rows, tally = null, milestone = 'M99', stamp = true }) {
  const t = tally ?? countOf(rows)
  return [
    '# Review findings',
    '',
    `**Ledger after \`${milestone}\` (re-derived with §6's own awk one-liner): ${t.open} open — S2 ${t.s2} ·`,
    `S3 ${t.s3} · S4 ${t.s4} — ${t.closed} closed, ${t.deferred} deferred, ${t.withdrawn} withdrawn,`,
    `${t.total} total.** <!-- tally:current -->`,
    '',
    '## 6. Full index',
    '',
    '| id | sev | claim | status |',
    '|---|---|---|---|',
    ...rows.map(([id, sev, status]) => `| \`${id}\` | ${sev} | a claim | ${stamp ? stamped(status) : status} |`),
    '',
    '## 7. Something else',
    '',
    '| `NOT-01` | S2 | outside §6 | open |',
  ].join('\n')
}

/**
 * `M140`'s stamp requirement applies to every open row, so a fixture that means to be *sound* has to
 * satisfy it. Auto-stamping here rather than in each of the 21 pre-existing cases keeps them saying
 * what they were written to say — none of them is about stamps — while making the sound baseline
 * genuinely sound under the new rule. A case that IS about stamps writes its own status and this
 * leaves it alone.
 */
const STAMP = 'rv 2026-08-19 @cfb256a reproduces** · `packages/lang/src/parser.ts:1` · still does it'
const stamped = (status) => (classify(status) === 'open' && !status.includes('rv 2') ? `${status} — **${STAMP}` : status)

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
  assert.match(stale[0], /`A3-05`.*still reads "open/)
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

// ---- 2b. staged plans ------------------------------------------------------------------------
//
// A plan that ships in stages is finished by its LAST stage. Keying the check on the bare milestone
// number asks "has anything called M125 shipped?", which `M125b1` answers yes to while `M125c`,
// `M125d` and `M125e` are still unwritten — so every row those stages owe reads as stale from the
// day the first stage merges.
//
// **This was found by using the tool, and it could not have been found earlier.** A milestone is
// never on `main` while its own gate is running, so `M125b1`'s gate was green; the check went red
// the moment `M125b1` was merged, during the *next* milestone, reporting ten rows nobody had
// touched. Same shape as every other defect this file guards: the instrument was right about its
// rule and wrong about when the rule applies.

test('a commit subject names both its suffixed milestone and its bare number', () => {
  // `125b1` is what a staged plan's `closes-at` matches; `125` is what every unstaged plan has
  // always matched. Dropping either one silently disables one of the two behaviours.
  assert.deepEqual(milestoneTokens('M125b1: an absolute URL is the address'), ['125b1', '125'])
  assert.deepEqual(milestoneTokens('M97a: the runtime rules the checker owes'), ['97a', '97'])
  assert.deepEqual(milestoneTokens('M111+M112: report honesty'), ['111', '112'])
  // A milestone named only in the body, after the colon, is not a claim that it shipped.
  assert.deepEqual(milestoneTokens('M123: the fix M114 asked for'), ['123'])
})

test('a staged plan is not judged by its first stage', () => {
  const plans = [{ file: 'PLAN_M99_X.md', milestone: '99', closesAt: '99c', ids: ['A3-05', 'A3-08'] }]
  const { problems } = check(sound({ ledger: ledger({ rows: STALE_M99 }), plans, shipped: new Set(['99', '99a']) }))
  assert.deepEqual(problems, [], problems.join('\n'))
})

test('…and IS judged once its last stage ships', () => {
  // The control. Same plan, same ledger; only the shipped set moves on. Without this, "never flag a
  // staged plan" would pass the test above and switch the check off for every staged plan forever.
  const plans = [{ file: 'PLAN_M99_X.md', milestone: '99', closesAt: '99c', ids: ['A3-05', 'A3-08'] }]
  const { problems } = check(sound({ ledger: ledger({ rows: STALE_M99 }), plans, shipped: new Set(['99', '99c']) }))
  assert.equal(problems.filter((pr) => /says M99 closes/.test(pr)).length, 2, problems.join('\n'))
})

test('an unstaged plan is unaffected — `closesAt` absent behaves exactly as before', () => {
  const plans = [{ file: 'PLAN_M99_X.md', milestone: '99', closesAt: null, ids: ['A3-05', 'A3-08'] }]
  const { problems } = check(sound({ ledger: ledger({ rows: STALE_M99 }), plans, shipped: new Set(['99']) }))
  assert.equal(problems.filter((pr) => /says M99 closes/.test(pr)).length, 2, problems.join('\n'))
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

test('the marked tally wins over unmarked history, wrapped across lines and inside a blockquote', () => {
  // Not hypothetical: `M112`'s paragraph physically precedes `M113`'s, and `M113`'s wraps across
  // lines inside a blockquote. Both properties are exercised here.
  const text = [
    '**Ledger after `M112`: 80 open — S2 19 · S3 43 · S4 18 — 159 closed, 3 deferred, 2 withdrawn, 244 total.**',
    '',
    '> Superseded by `M113`: the ledger is now 76 open — S2 16 · S3 44 · S4 16 — 164 closed,',
    '> 3 deferred, 4 withdrawn, 247 total. <!-- tally:current -->',
  ].join('\n')
  const t = newestPublishedTally(text)
  assert.equal(t.milestone, 'M113')
  assert.equal(t.open, 76)
  assert.equal(t.total, 247)
})

test('a suffixed milestone that ships after a higher-numbered one is still found (the bug the marker replaced)', () => {
  // `M107b` follows `M107` but shipped *after* `M113`. The first version of this function took the
  // highest `M<N>` near each match and therefore went on validating `M113`'s stale numbers — silently,
  // which is the one failure mode this whole file exists to prevent. Milestone names are not a total
  // order; the marker is, so it is what decides.
  const text = [
    '> Ledger after `M113`: 77 open — S2 16 · S3 44 · S4 17 — 164 closed, 3 deferred, 4 withdrawn, 248 total.',
    '',
    '**Ledger after `M107b`: 76 open — S2 15 · S3 44 · S4 17 — 165 closed, 3 deferred, 4 withdrawn,',
    '248 total.** <!-- tally:current -->',
  ].join('\n')
  const t = newestPublishedTally(text)
  assert.equal(t.milestone, 'M107b')
  assert.equal(t.open, 76)
  assert.equal(t.closed, 165)
})

test('a `>`-only line ends a paragraph — the real log is one blockquote, not one paragraph (M118)', () => {
  // The two fixtures above separate blockquote entries with *genuinely empty* lines. The ledger
  // never has: its milestone log is one continuous blockquote whose blank lines are `>`, so before
  // M118 this function saw a single 17,000-character paragraph spanning five milestones and
  // reported `ambiguous` the moment a second tally landed inside it. Every entry here is `>`-led,
  // exactly as the file writes them.
  const text = [
    '> **Ledger after `M118`: 70 open — S2 4 · S3 46 · S4 20 — 180 closed, 3 deferred, 4 withdrawn,',
    '> 257 total.** <!-- tally:current --> Two closed, two filed.',
    '>',
    '> ---',
    '>',
    '> **Ledger after `M117`: 70 open — S2 6 · S3 45 · S4 19 — 178 closed, 3 deferred, 4 withdrawn,',
    '> 255 total.** One row closed, one filed.',
  ].join('\n')
  const t = newestPublishedTally(text)
  assert.equal(t.ambiguous, undefined, 'the older entry is history, not a second current tally')
  assert.equal(t.milestone, 'M118')
  assert.equal(t.open, 70)
  assert.equal(t.closed, 180)
  assert.equal(t.total, 257)
})

test('an unmarked tally is history, not the current count', () => {
  assert.equal(newestPublishedTally('Once: 9 open — S2 1 · S3 2 · S4 3 — 5 closed, 0 deferred, 0 withdrawn, 14 total.'), null)
})

test('two marked tallies are a problem — at most one can be live', () => {
  const rows = CLEAN
  const t = countOf(rows)
  const one = `${t.open} open — S2 ${t.s2} · S3 ${t.s3} · S4 ${t.s4} — ${t.closed} closed, ${t.deferred} deferred, ${t.withdrawn} withdrawn, ${t.total} total. <!-- tally:current -->`
  const text = ledger({ rows }).replace('# Review findings', `# Review findings\n\nAfter \`M1\`: ${one}\n\nAfter \`M2\`: ${one}`)
  const { problems } = check(sound({ ledger: text }))
  assert.ok(
    problems.some((p) => /tallies are marked/.test(p)),
    problems.join('\n'),
  )
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

// ---- 4. the re-verification stamp (M140) --------------------------------------------------------
//
// `M136a-01`: nothing ever re-checked whether an open row still reproduces, so a row fixed in
// passing stayed open and the queue planned around a defect that was not there. The sweep that
// found that is a one-off; these are what make it an invariant.

test('a stamp parses into its four parts', () => {
  const s = parseStamp('open — **rv 2026-08-19 @cfb256a drifted** · `packages/lang/src/checker.ts:3071` · narrower now')
  assert.deepEqual(s, {
    date: '2026-08-19',
    commit: 'cfb256a',
    verdict: 'drifted',
    paths: ['packages/lang/src/checker.ts'],
  })
})

test('`fixed` is not a verdict an open row may carry', () => {
  // A row that no longer reproduces is *closed*, and `✅ **fixed `M<N>`**` already says so. Allowing
  // `fixed` here would create a second, quieter way to record a close — one the tally cannot see.
  assert.equal(parseStamp('open — **rv 2026-08-19 @cfb256a fixed** · `packages/lang/src/parser.ts:1` · gone'), null)
})

test('a backticked command is not a citation, but a root-level file is', () => {
  // Two failures this pins. A command (`env -u DISPLAY node scripts/verify-watch.mjs`) contains a
  // path but is not one — git cannot be asked about it. And requiring a slash was this check's own
  // first defect: `SPEC.md` is a repo-relative path that happens to live at the root.
  const s = parseStamp(
    'open — **rv 2026-08-19 @cfb256a reproduces** · `SPEC.md:2975` · shown by `env -u DISPLAY node scripts/verify-watch.mjs`',
  )
  assert.deepEqual(s.paths, ['SPEC.md'])
})

test('an open row with no stamp is a hard failure (D517)', () => {
  const rows = [['B3-04', 'S2', 'open — never measured, just filed']]
  const { problems } = check(sound({ ledger: ledger({ rows, stamp: false }), plans: [] }))
  assert.ok(problems.some((p) => /`B3-04` is open with no re-verification stamp/.test(p)), problems.join('\n'))
})

test('only OPEN rows need one — a close, a deferral and a withdrawal do not', () => {
  // A closed row's truth is its close; a deferred row is not a claim about the code. If this were
  // wrong the guard would demand ~250 stamps for rows nobody is asking a question about.
  const rows = [
    ['A3-05', 'S2', '✅ **M99a** — fixed'],
    ['A2-10', 'S3', '⏸ B'],
    ['M98c-02', 'S4', '🚫 **withdrawn** — filed wrong'],
  ]
  const { problems } = check(sound({ ledger: ledger({ rows }), plans: [] }))
  assert.deepEqual(problems, [], problems.join('\n'))
})

test('a 🟨 partial DOES need one — the unshipped half is a live claim', () => {
  const rows = [['A4-07', 'S2', '🟨 **M97c** — shipped in part']]
  const { problems } = check(sound({ ledger: ledger({ rows, stamp: false }), plans: [] }))
  assert.ok(problems.some((p) => /`A4-07` is open with no re-verification stamp/.test(p)), problems.join('\n'))
})

test('a stamp citing nothing that exists is caught (D519 — evidence, not a re-reading)', () => {
  // The vacuous-control class, pointed at this milestone: "I re-read it and it still looks true" is
  // a check that runs, passes and cannot see anything. A path that resolves is what makes it a
  // measurement, and it is also what `D525` keys the staleness question on.
  const rows = [['B3-04', 'S2', 'open — **rv 2026-08-19 @cfb256a reproduces** · `no/such/file.ts:1` · trust me']]
  const { problems } = check(sound({ ledger: ledger({ rows }), plans: [], resolve: () => false }))
  assert.ok(problems.some((p) => /`B3-04` is stamped but cites no path that exists/.test(p)), problems.join('\n'))
})

test('the same row passes once the cited path resolves — the flag is resolution, not shape', () => {
  const rows = [['B3-04', 'S2', 'open — **rv 2026-08-19 @cfb256a reproduces** · `no/such/file.ts:1` · trust me']]
  const { problems } = check(sound({ ledger: ledger({ rows }), plans: [], resolve: () => true }))
  assert.deepEqual(problems, [], problems.join('\n'))
})

// ---- 5. staleness: a report, and one that can actually fire (D525/D527/D529) --------------------
//
// The live run is not evidence here. On the branch this shipped from every stamp named the commit
// the branch was cut at, so `<commit>..HEAD` was empty for all 70 citations and "none moved" was
// true for free — a check that runs, passes and cannot see anything, which is precisely the class
// this file exists to attack. So the tier is proven against a repo built to have moved.

/** A throwaway git repo with one file, committed twice. Returns the first commit's sha. */
async function twoCommitRepo(root, relPath) {
  const git = (...a) => execFileAsync('git', ['-C', root, ...a])
  await git('init', '-q', '-b', 'main')
  await git('config', 'user.email', 't@example.invalid')
  await git('config', 'user.name', 'test')
  await mkdir(join(root, relPath, '..'), { recursive: true })
  await writeFile(join(root, relPath), 'one\n')
  await git('add', '-A')
  await git('commit', '-qm', 'first')
  const { stdout } = await git('rev-parse', 'HEAD')
  const first = stdout.trim()
  await writeFile(join(root, relPath), 'two\n')
  await git('add', '-A')
  await git('commit', '-qm', 'second')
  return first
}

test('a stamp whose cited path has moved since its commit is reported', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tflw-stale-'))
  try {
    const sha = await twoCommitRepo(root, 'src/thing.ts')
    const rows = [{ id: 'B3-04', status: `open — **rv 2026-08-19 @${sha} reproduces** · \`src/thing.ts:1\` · e`, line: 1 }]
    const { lines, checked, unavailable } = staleReport(rows, root)
    assert.equal(checked, 1)
    assert.equal(unavailable, 0)
    assert.equal(lines.length, 1, lines.join('\n'))
    assert.match(lines[0], /`B3-04`.*`src\/thing\.ts` has changed since/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('…and one whose path has NOT moved is not reported (the control)', async () => {
  // Without this the previous case passes for a checker that reports every stamp unconditionally.
  const root = await mkdtemp(join(tmpdir(), 'tflw-stale-'))
  try {
    await twoCommitRepo(root, 'src/thing.ts')
    const { stdout } = await execFileAsync('git', ['-C', root, 'rev-parse', 'HEAD'])
    const rows = [
      { id: 'B3-04', status: `open — **rv 2026-08-19 @${stdout.trim()} reproduces** · \`src/thing.ts:1\` · e`, line: 1 },
    ]
    const { lines, checked } = staleReport(rows, root)
    assert.equal(checked, 1)
    assert.deepEqual(lines, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a sibling-repo path is judged by date, and says so (D529)', async () => {
  // The stamped sha is a tflw commit and means nothing in testFlow-tests, so the question falls
  // back to the date the stamp already carries. Skipping sibling paths instead would be `0 stale`
  // wearing a hat — and a third of this corpus is about the sibling repo.
  const ws = await mkdtemp(join(tmpdir(), 'tflw-ws-'))
  try {
    await mkdir(join(ws, 'tflw'), { recursive: true })
    const sib = join(ws, 'testFlow-tests')
    await mkdir(sib, { recursive: true })
    await twoCommitRepo(sib, 'apiV2/package.json')
    const rows = [
      {
        id: 'M138b-01',
        status: 'open — **rv 2020-01-01 @cfb256a reproduces** · `testFlow-tests/apiV2/package.json:16` · e',
        line: 1,
      },
    ]
    const { lines, checked } = staleReport(rows, join(ws, 'tflw'))
    assert.equal(checked, 1)
    assert.equal(lines.length, 1, lines.join('\n'))
    assert.match(lines[0], /by date/)
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('own repo wins over the sibling for the same relative path (D528)', async () => {
  // `scripts/verify-watch.mjs` names a real file in testFlow-tests and nothing in tflw. If lookup
  // order went the other way an unprefixed sibling path would silently resolve, and the citation
  // would point at a file the reader cannot open.
  const ws = await mkdtemp(join(tmpdir(), 'tflw-ws-'))
  try {
    const own = join(ws, 'tflw')
    await mkdir(join(own, 'scripts'), { recursive: true })
    await writeFile(join(own, 'scripts', 'x.mjs'), '')
    await mkdir(join(ws, 'scripts'), { recursive: true })
    await writeFile(join(ws, 'scripts', 'x.mjs'), '')
    assert.deepEqual(locate('scripts/x.mjs', own), { dir: own, rel: 'scripts/x.mjs', sibling: false })
    assert.equal(locate('nope/x.mjs', own), null)
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('where there is no git, the stale check says UNAVAILABLE and never `0 stale` (D527)', async () => {
  // `exec.mjs` rsyncs the worktree without `.git`, which is why `verify:ledger` cannot run on the
  // box at all (`M131-03`). The stale tier needs git per path and fails the same way. A check that
  // reports zero when it could not look is the failure this whole file is about, so absence is
  // announced — asserted here on the process's real output, not on an internal count.
  const root = await mkdtemp(join(tmpdir(), 'tflw-nogit-'))
  try {
    await writeFile(
      join(root, 'REVIEW_FINDINGS.md'),
      [
        '**Ledger after `M99`: 1 open — S2 1 · S3 0 · S4 0 — 0 closed, 0 deferred, 0 withdrawn, 1 total.**',
        '<!-- tally:current -->',
        '',
        '## 6. Full index',
        '',
        '| id | sev | claim | status |',
        '|---|---|---|---|',
        '| `B3-04` | S2 | a claim | open — **rv 2026-08-19 @cfb256a reproduces** · `p.md:1` · e |',
      ].join('\n'),
    )
    await writeFile(join(root, 'p.md'), 'x\n')
    const r = await execFileAsync(process.execPath, [SCRIPT], {
      env: { ...process.env, TFLW_LEDGER_ROOT: root, NO_COLOR: '1' },
    }).then(
      (o) => ({ code: 0, stdout: o.stdout }),
      (e) => ({ code: e.code ?? 1, stdout: e.stdout ?? '' }),
    )
    assert.equal(r.code, 0, r.stdout)
    assert.match(r.stdout, /stale check UNAVAILABLE — no git here/)
    assert.doesNotMatch(r.stdout, /0 citations checked|none moved/)
    // `M147a` — the same rule for the manifest tier. This fixture root has no `conformance.ts`,
    // and a root without one must not read as a root whose pointers all check out.
    assert.match(r.stdout, /conformance pointers UNAVAILABLE — no manifest at/)
    assert.doesNotMatch(r.stdout, /every conformance pointer/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// ---- 6. instrument precision: the two `M143` rows against this file (`M145`) -------------------
//
// Both rows are the arc's own subject turned on its own tooling — a check answering one level above
// the one it claims. `M143-07` reads the commit *graph* where it means file *content*; `M143-08`
// reads a plan's *header* where it means the plan's *claims*. Neither is a bug in what the check
// does. Both are a mismatch between what it measures and what it reports, which is the class that
// survives review precisely because the check keeps working.

test('an explicit `plan:closes` list is the answer, and the header is not read at all', () => {
  // `M143-08`. The header here names three ids in three different roles — one closed, one that
  // LEAVES the cluster, one merely FILED — which is exactly the shape that produced two live false
  // positives. The list settles it without anything having to read the verb.
  const plan = [
    '# M143 — sweep reliability',
    'Closes `M137g-03`. `M115-02` leaves the cluster (`D575`). Files `M143-01`, `M143-02`.',
    '<!-- plan:closes M137g-03 -->',
  ].join('\n')
  assert.deepEqual(planClaims(plan), ['M137g-03'])
})

test('…and the header heuristic still applies when no list is given (the control)', () => {
  // Without this, the fix above passes just as well for a `planClaims` that returns `[]` always —
  // which would silently disarm the check for every plan written before the marker existed.
  const plan = ['# M143 — sweep reliability', 'Closes `M137g-03`. `M115-02` leaves the cluster.'].join('\n')
  assert.deepEqual(planClaims(plan), ['M137g-03', 'M115-02'])
})

test('an empty `plan:closes` list is a claim of nothing, not a missing marker', () => {
  // A plan that fixes nothing and files rows is a real shape (`M143c` was close to it). It must be
  // able to say so, or its header's filed-row ids read as closures.
  const plan = ['# M144a — two guards', 'Files `M144-01`. Half-fixes `A2-16`.', '<!-- plan:closes -->'].join('\n')
  assert.deepEqual(planClaims(plan), [])
})

test('`plan:closes-at` is not read as `plan:closes` — the two markers share a prefix', () => {
  // `\s+` after `closes` is the whole separation, and `-` is not whitespace. If this regressed, a
  // staged plan's completion marker would silently become its close-claim list and claim nothing,
  // disarming the check for exactly the plans that need it most.
  const plan = ['# M125 — staged', 'Closes `A3-05`.', '<!-- plan:closes-at M125e -->'].join('\n')
  assert.deepEqual(planClaims(plan), ['A3-05'])
})

test('bare and backticked ids are both read inside the list', () => {
  const plan = ['# M99', 'header naming nothing', '<!-- plan:closes A3-05, `A3-08` -->'].join('\n')
  assert.deepEqual(planClaims(plan), ['A3-05', 'A3-08'])
})

/** A repo whose file is changed and then changed back: history moved, content did not. */
async function revertedRepo(root, relPath) {
  const git = (...a) => execFileAsync('git', ['-C', root, ...a])
  await git('init', '-q', '-b', 'main')
  await git('config', 'user.email', 't@example.invalid')
  await git('config', 'user.name', 'test')
  await mkdir(join(root, relPath, '..'), { recursive: true })
  await writeFile(join(root, relPath), 'one\n')
  await git('add', '-A')
  await git('commit', '-qm', 'first')
  const { stdout } = await git('rev-parse', 'HEAD')
  await writeFile(join(root, relPath), 'two\n')
  await git('add', '-A')
  await git('commit', '-qm', 'second')
  await writeFile(join(root, relPath), 'one\n')
  await git('add', '-A')
  await git('commit', '-qm', 'third — back to the first content')
  return stdout.trim()
}

test('a path whose history moved but whose content did not is NOT reported (M143-07)', async () => {
  // The squash-merge shape, which is how every milestone lands here: one commit touching every path
  // the branch touched, so `<commit>..HEAD -- <rel>` is non-empty for every stamp taken on that
  // branch. Measured on the real repo when this row was filed — `M143-01` and `M143-02` reported
  // drifted against `c5cfd83` with an empty `git diff` on their paths.
  const root = await mkdtemp(join(tmpdir(), 'tflw-revert-'))
  try {
    const sha = await revertedRepo(root, 'src/thing.ts')
    const rows = [{ id: 'B3-04', status: `open — **rv 2026-08-19 @${sha} reproduces** · \`src/thing.ts:1\` · e`, line: 1 }]
    const { lines, checked, unavailable } = staleReport(rows, root)
    assert.equal(checked, 1, 'the citation must still be CHECKED — going quiet by not looking is the D527 failure')
    assert.equal(unavailable, 0)
    assert.deepEqual(lines, [], lines.join('\n'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a cited path that git cannot resolve at HEAD still gets the history answer', async () => {
  // `scripts/exec.mjs` is untracked in both repos (`D14`) and is cited by an open row, so
  // `HEAD:<rel>` does not resolve for it. The blob question must fall through rather than throw,
  // and the fallback's answer — no commit touched it — must survive.
  const root = await mkdtemp(join(tmpdir(), 'tflw-untracked-'))
  try {
    const sha = await twoCommitRepo(root, 'src/thing.ts')
    await mkdir(join(root, 'scripts'), { recursive: true })
    await writeFile(join(root, 'scripts', 'exec.mjs'), 'untracked\n')
    const rows = [{ id: 'M143-06', status: `open — **rv 2026-08-19 @${sha} reproduces** · \`scripts/exec.mjs:630\` · e`, line: 1 }]
    const { lines, checked, unavailable } = staleReport(rows, root)
    assert.equal(checked, 1)
    assert.equal(unavailable, 0)
    assert.deepEqual(lines, [], lines.join('\n'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// ---- 8. a conformance pointer must name an OPEN row (`M147a`, `M147-01`) ----------------------
//
// The manifest is handed in as text rather than read from disk, for the same reason the ledger is:
// a check that only works against the real repo can only be tested by breaking the real repo.

/** A `RUNTIME_RULES`-shaped fragment. The doc-comment line is deliberately present in every fixture. */
const manifest = (...ids) =>
  [
    '// The `REVIEW_FINDINGS.md` row tracking the gap, written in prose here as',
    "//   `filedRow: 'M97a-NN'` — a shape, not a pointer.",
    'export const RUNTIME_RULES = [',
    ...ids.flatMap((id) => ['  {', "    id: 'a-rule',", "    decidable: 'static',", `    filedRow: '${id}',`, '  },']),
    '];',
  ].join('\n')

const withManifest = (...ids) => sound({ manifests: [{ file: 'conformance.ts', text: manifest(...ids) }] })

test('a pointer at an open row is fine', () => {
  const { problems } = check(withManifest('B3-04'))
  assert.deepEqual(problems, [], problems.join('\n'))
})

test('a pointer at a CLOSED row is caught — the rule reads answered and is not', () => {
  const { problems } = check(withManifest('A3-05'))
  assert.equal(problems.length, 1, problems.join('\n'))
  assert.match(problems[0], /`A3-05`.*says it is closed/)
})

test('a pointer at a WITHDRAWN row is caught too — the row was filed wrong, so the verdict was as well', () => {
  const { problems } = check(withManifest('M98c-02'))
  assert.equal(problems.length, 1, problems.join('\n'))
  assert.match(problems[0], /says it is withdrawn/)
})

test('a 🟨 partial is NOT caught — a partial is a live claim about the half that did not ship', () => {
  // Same rule the stamp check applies, and for the same reason: `classify` counts `🟨` open.
  assert.deepEqual(check(withManifest('A4-07')).problems, [])
})

test('a pointer at a row §6 has never heard of is its own problem, not a silent skip', () => {
  const { problems } = check(withManifest('ZZ-99'))
  assert.equal(problems.length, 1, problems.join('\n'))
  assert.match(problems[0], /not a row in §6/)
})

test('a manifest yielding NO pointers is a problem — a scan matching nothing passes everything', () => {
  // The failure this check would otherwise have: rename the field, and the guard reports clean
  // forever. `M141`'s Order-1 subject exactly, so it is asserted here rather than assumed.
  const { problems } = check(sound({ manifests: [{ file: 'conformance.ts', text: 'export const RUNTIME_RULES = [];' }] }))
  assert.equal(problems.length, 1, problems.join('\n'))
  assert.match(problems[0], /yielded no `filedRow` pointers/)
})

test("the field's own doc comment is not read as a pointer", () => {
  // `conformance.ts` documents the field by writing its literal shape, naming a row id that has
  // never existed. Anchoring at line start is what keeps that from being a permanent false alarm —
  // and this fixture carries the comment while declaring one real pointer, so the assertion is that
  // exactly one is seen, not that none is.
  const { problems } = check(withManifest('A3-05'))
  assert.equal(problems.length, 1, 'the comment line must not add a second problem')
  assert.doesNotMatch(problems[0], /M97a-NN/)
})

test('the same pointer written twice is reported once', () => {
  const { problems } = check(withManifest('A3-05', 'A3-05'))
  assert.equal(problems.length, 1, problems.join('\n'))
})

test('no manifest means no manifest problems — `check` is pure over what it is handed', () => {
  // `main` is what guarantees the real caller always passes one; a missing file there exits 1.
  assert.deepEqual(check(sound()).problems, [])
})

