#!/usr/bin/env node
// The launch-review ledger's own guard (M113, review finding `M113-01`).
//
// `REVIEW_FINDINGS.md` §6 is both the master index and the fix queue, and its header says so:
// "a status left stale here makes the whole ledger lie about how much work is left." The section
// then hands you an awk one-liner to re-derive the severity totals — and **that derivation reads
// the very column that goes stale**, so it counted three fixed rows as `open` for six milestones
// with complete fidelity, and a fourth whose status cell said the word `withdrawn` in plain English
// with no `🚫`. A check that runs, passes, and is structurally incapable of seeing the defect is
// this arc's vacuous-control class; the awk is one.
//
// `M113-01` proposed re-running every open row's reproduction. Scoping killed that plan: repros are
// prose, and the twelve per-track ledgers have no common schema (`A3`/`B3`/`B4`/`B6`/`OBS`/`V4`
// carry a `disposition` column, `A2`'s findings table has none, `A1`/`A4`/`FU`/`B2` are prose
// sections), so there is nothing to parse and nothing to cross-check §6 against — which is exactly
// why §6 drifts unnoticed: it is the only machine-readable status in the corpus. What is left is
// three checks that are total, cheap, and were each measured against the real ledger before being
// written here:
//
//   1. **Status vocabulary.** A status cell starts `✅`, `⏸`, `🚫`, `🟨` or `open`. Anything else is
//      free prose to the awk, which silently classifies it `open`. Measured: 1 violation in 246
//      rows, and it was real (`M98c-02`, withdrawn 2026-08-07, counted open ever since).
//
//   2. **Plan ↔ ledger.** A `PLAN_M<N>_*.md` names the rows its milestone will close, in its
//      opening paragraph. Once a commit for `M<N>` is on `main`, none of those rows may still read
//      `open`. Measured: 12 plans, 44 named rows, 1 flag — and that flag (`A4-07`) is a deliberate
//      `🟨` partial, so the instrument is quiet enough to run every milestone. Pointed at the
//      pre-`M113` ledger it flags `A3-05`, `A3-08` and `M98c-03`: all three, which is the whole
//      reason this file exists.
//
//   3. **Published tally ↔ derived tally.** Every milestone writes "ledger after `M<N>`: X open —
//      S2 a · S3 b · S4 c — Y closed …" into the prose. That sentence is typed by hand from a
//      command run minutes earlier, against a file still being edited. The newest one must match
//      what the column actually says now.
//
// **This is deliberately not a CI step.** `REVIEW_FINDINGS.md` is gitignored (the pre-1.0
// launch-review corpus is local-only), so in CI the file is simply absent — and a guard that skips
// when its input is missing is green about nothing, which is the failure this whole tool exists to
// stop. So it hard-fails on a missing ledger and runs locally, before a milestone is called done.
// What CI *does* verify is the tool: `scripts/verify-ledger.test.mjs` runs it over fixture ledgers
// whose defects are known, including one that reproduces the `M99` staleness this was built for.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.TFLW_LEDGER_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..')
const LEDGER = join(ROOT, 'REVIEW_FINDINGS.md')

/** The sanctioned status prefixes. Order matters only for reporting. */
const MARKERS = [
  ['✅', 'closed'],
  ['⏸', 'deferred'],
  ['🚫', 'withdrawn'],
  ['🟨', 'open'], // a deliberate partial: shipped in part, remainder tracked. Counted open, as the awk does.
]

/** Classify a status cell exactly as §6's awk one-liner does, so the two can never disagree. */
export function classify(status) {
  for (const [marker, kind] of MARKERS) if (status.startsWith(marker)) return kind
  return 'open'
}

/** A status cell is well-formed if it opens with a marker or the bare word `open`. */
export function isWellFormed(status) {
  return MARKERS.some(([m]) => status.startsWith(m)) || /^open\b/.test(status)
}

/** Split a markdown table row into its data cells, tolerant of `|` inside prose. */
function cells(line) {
  let l = line.trim()
  if (l.startsWith('|')) l = l.slice(1)
  if (l.endsWith('|')) l = l.slice(0, -1)
  return l.split('|')
}

/**
 * Parse §6's rows. Every table in the section puts the id first, the severity second and the
 * status last, whatever sits between (Track B's tables carry an extra `component` column).
 */
export function parseIndex(text) {
  const rows = []
  let inSection = false
  text.split('\n').forEach((line, i) => {
    if (/^## 6\. Full index/.test(line)) inSection = true
    else if (inSection && /^## /.test(line)) inSection = false
    if (!inSection || !/^\| `[A-Z0-9]/.test(line)) return
    const c = cells(line)
    rows.push({
      id: c[0].replace(/[`*\s]/g, ''),
      sev: c[1].replace(/~~S[1-4]~~/g, '').replace(/[*`\s]/g, ''),
      status: c[c.length - 1].trim(),
      line: i + 1,
    })
  })
  return rows
}

/** Row ids as they are written in prose: `A3-05`, `M97a-04`, `FU-11`, `V4-16`, `B6-15`. */
const ROW_ID = /`([A-Z]+\d*[a-z]?-\d+)`/g

/**
 * The rows a plan says it closes. Only the opening paragraph counts: a plan's body cites dozens of
 * rows as context, its header states the charter. Measured on all 12 shipped plans — 44 ids, no
 * false positives beyond `A4-07`'s intentional partial.
 */
export function planClaims(text, headerLines = 12) {
  const head = text.split('\n').slice(0, headerLines).join('\n')
  return [...new Set([...head.matchAll(ROW_ID)].map((m) => m[1]))]
}

/** Milestone numbers with a commit on the given ref. `M111+M112: …` counts as both. */
function shippedMilestones(ref = 'main') {
  let log = ''
  try {
    // stderr ignored: outside a checkout git prints its own "not a git repository" before we get
    // to say the useful thing, and the fallback below is a supported mode, not an error.
    log = execFileSync('git', ['log', '--no-merges', '--format=%s', ref], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString()
  } catch {
    return null // not a git checkout, or no such ref — the caller decides what that means
  }
  const shipped = new Set()
  for (const subject of log.split('\n')) {
    const head = subject.split(':')[0] // `M111+M112` from `M111+M112: report honesty …`
    for (const m of head.matchAll(/\bM(\d+)/g)) shipped.add(m[1])
  }
  return shipped
}

/** "…after `M113` is 76 open — S2 16 · S3 44 · S4 16 — 164 closed, 3 deferred, 4 withdrawn, 247 total" */
const TALLY =
  /(\d+) open — S2 (\d+) · S3 (\d+) · S4 (\d+) — (\d+) closed, (\d+) deferred, (\d+) withdrawn, (\d+) total/g

/**
 * The newest published tally. Three things make this less trivial than a per-line regex, and all
 * three are properties of the real file rather than hypotheticals: a tally sentence **wraps across
 * lines** (both `M112`'s and `M113`'s do), it can sit **inside a blockquote** (`M113`'s does), and
 * the ledger deliberately keeps **every** milestone's tally as history — so "current" is the one
 * attached to the highest milestone number, not the first or last in file order. `M112`'s paragraph
 * physically precedes `M113`'s. A tally naming no milestone within reach is history, and is skipped.
 */
export function newestPublishedTally(text) {
  const flat = text
    .split('\n')
    .map((l) => l.replace(/^>\s?/, ''))
    .join(' ')
  let best = null
  for (const t of flat.matchAll(TALLY)) {
    // The milestone is named just before the numbers ("ledger after `M113` is 76 open …"). Look
    // back far enough to clear the sentence's own preamble, not so far as to catch the last one.
    const ms = [...flat.slice(Math.max(0, t.index - 200), t.index).matchAll(/`M(\d+)`/g)].map((m) => Number(m[1]))
    if (!ms.length) continue
    const milestone = ms[ms.length - 1]
    if (best && milestone <= best.milestone) continue
    const [, open, s2, s3, s4, closed, deferred, withdrawn, total] = t.map(Number)
    best = { milestone, open, s2, s3, s4, closed, deferred, withdrawn, total }
  }
  return best
}

/** Derive the tally from the status column — the same arithmetic §6's awk performs. */
export function derive(rows) {
  const t = { open: 0, closed: 0, deferred: 0, withdrawn: 0, total: rows.length, s2: 0, s3: 0, s4: 0 }
  for (const r of rows) {
    const k = classify(r.status)
    t[k]++
    if (k === 'open' && (r.sev === 'S2' || r.sev === 'S3' || r.sev === 'S4')) t[r.sev.toLowerCase()]++
  }
  return t
}

/** Run all three checks. Pure — every input is passed in, so the tests need no repo. */
export function check({ ledger, plans, shipped }) {
  const problems = []
  const rows = parseIndex(ledger)
  if (!rows.length) problems.push('§6 "Full index" has no rows — the section heading may have been renamed')

  const seen = new Map()
  for (const r of rows) {
    if (!isWellFormed(r.status))
      problems.push(
        `§6:${r.line} \`${r.id}\` status cell starts with none of ✅ ⏸ 🚫 🟨 open — the awk reads it as prose and counts the row OPEN: "${r.status.slice(0, 60)}"`,
      )
    if (seen.has(r.id)) problems.push(`§6:${r.line} \`${r.id}\` is listed twice (also at §6:${seen.get(r.id)})`)
    else seen.set(r.id, r.line)
  }

  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const { file, milestone, ids } of plans) {
    if (shipped && !shipped.has(milestone)) continue
    for (const id of ids) {
      const row = byId.get(id)
      if (!row) continue // the plan cites a row from another corpus, or a typo — not this check's business
      if (classify(row.status) === 'open' && !row.status.startsWith('🟨'))
        problems.push(
          `${file} says M${milestone} closes \`${id}\` and M${milestone} is on main, but §6:${row.line} still reads "${row.status.slice(0, 40)}"`,
        )
    }
  }

  const derived = derive(rows)
  const published = newestPublishedTally(ledger)
  if (!published) problems.push('no published tally found — every milestone writes one, so this is a drift of its own')
  else
    for (const k of ['open', 's2', 's3', 's4', 'closed', 'deferred', 'withdrawn', 'total'])
      if (published[k] !== derived[k])
        problems.push(
          `the tally published for M${published.milestone} says ${k}=${published[k]}; the status column says ${k}=${derived[k]}`,
        )

  return { problems, derived, published, rows }
}

/** Collect the shipped plans from the repo root. */
function loadPlans(root) {
  return readdirSync(root)
    .filter((f) => /^PLAN_M\d+_.*\.md$/.test(f))
    .sort()
    .map((f) => ({
      file: f,
      milestone: f.match(/^PLAN_M(\d+)_/)[1],
      ids: planClaims(readFileSync(join(root, f), 'utf8')),
    }))
}

function main() {
  if (!existsSync(LEDGER)) {
    console.error(`verify:ledger — ${LEDGER} not found.`)
    console.error('')
    console.error('  This guard checks a gitignored, local-only corpus, so it cannot run in CI and')
    console.error('  does not pretend to: a missing ledger is a hard failure, never a skip. If you')
    console.error('  are in CI, you want `npm run test:scripts`, which checks this tool itself.')
    process.exit(1)
  }
  const ledger = readFileSync(LEDGER, 'utf8')
  const shipped = shippedMilestones()
  if (shipped === null) console.error('note: not a git checkout — the plan↔ledger check is running over every plan\n')
  const { problems, derived } = check({ ledger, plans: loadPlans(ROOT), shipped })

  if (problems.length) {
    console.error(`✗ ledger: ${problems.length} problem${problems.length === 1 ? '' : 's'}\n`)
    for (const p of problems) console.error(`  - ${p}`)
    console.error('\n  A stale status is not a bookkeeping slip — §6 is the queue, so it changes how')
    console.error('  much work the project believes is left. Fix the row, then re-run.')
    process.exit(1)
  }
  console.log(
    `✓ ledger: ${derived.total} rows — ${derived.open} open (S2 ${derived.s2} · S3 ${derived.s3} · S4 ${derived.s4}), ` +
      `${derived.closed} closed, ${derived.deferred} deferred, ${derived.withdrawn} withdrawn; ` +
      'vocabulary, plan claims and the published tally all agree',
  )
}

if (import.meta.url === `file://${process.argv[1]}`) main()
