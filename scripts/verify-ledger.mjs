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

/**
 * Every milestone a commit subject names, as `M125b1: …` → `['125b1', '125']`.
 *
 * Both forms, deliberately: the suffixed token so a staged plan can name the stage that finishes
 * it, the bare number so every unstaged plan keeps behaving exactly as it did. `M111+M112: …`
 * names two, which is why this splits on the subject head rather than taking the first match.
 */
export function milestoneTokens(subject) {
  const head = subject.split(':')[0] // `M111+M112` from `M111+M112: report honesty …`
  const out = new Set()
  for (const m of head.matchAll(/\bM(\d+[a-z]?\d*)/g)) {
    out.add(m[1])
    out.add(m[1].match(/^\d+/)[0])
  }
  return [...out]
}

/**
 * Milestones with a commit on the given ref. `M111+M112: …` counts as both.
 *
 * **Both the bare number and the full suffixed token are recorded** — `M125b1: …` yields `125` and
 * `125b1` — because a plan that ships in stages needs to name the stage that finishes it. See
 * `closesAt` in `loadPlans`, and the failure that forced it: with only the bare number, the *first*
 * stage of a staged plan marks the whole plan shipped, and every row its later stages owe is
 * reported stale from that moment on. That is not hypothetical — `M125b1` merging turned this
 * check red for ten rows `M125c`/`d`/`e` had not been written yet, and it did so *after* `M125b1`'s
 * own gate had passed, because a milestone is never on `main` while its gate is running.
 */
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
    for (const token of milestoneTokens(subject)) shipped.add(token)
  }
  return shipped
}

/** "…after `M113` is 76 open — S2 16 · S3 44 · S4 16 — 164 closed, 3 deferred, 4 withdrawn, 247 total" */
const TALLY =
  /(\d+) open — S2 (\d+) · S3 (\d+) · S4 (\d+) — (\d+) closed, (\d+) deferred, (\d+) withdrawn, (\d+) total/g

/** The marker that says which of the ledger's many tallies is the live one. */
const CURRENT = '<!-- tally:current -->'

/**
 * The current published tally — the one carrying `<!-- tally:current -->`.
 *
 * Two things make this less trivial than a per-line regex, and both are properties of the real file
 * rather than hypotheticals: a tally sentence **wraps across lines** (`M112`'s and `M113`'s both do)
 * and can sit **inside a blockquote** (`M113`'s does). The ledger deliberately keeps every
 * milestone's tally as history, so most matches are archive.
 *
 * **The marker exists because inferring "newest" from the milestone number is wrong, and this
 * function shipped with that bug for exactly one milestone.** `M113`'s first version took the
 * highest `M<N>` near each match. Then `M107b` — a follow-up to `M107`, shipped *after* `M113` —
 * published its tally, and the check went on silently validating `M113`'s: milestone names are not
 * a total order, because a suffixed milestone revisits an old number. Found by using the tool,
 * which is the only way this class is ever found. A marker also makes "two current tallies" a
 * detectable state rather than a silent tie-break.
 */
export function newestPublishedTally(text) {
  const found = []
  // Scoped by paragraph, not by character distance. A first attempt used a ±300-char window and
  // matched the *neighbouring* paragraph's tally as well — `M112`'s sits directly above `M113`'s,
  // and 300 characters does not respect a blank line. A paragraph is what "this sentence's marker"
  // actually means. Blockquote markers are stripped so a quoted tally reads like any other.
  //
  // **A `>`-only line separates paragraphs too, and missing that made "paragraph" meaningless for
  // most of this file.** The milestone log is one continuous blockquote whose blank lines are `>`,
  // not empty — so splitting on `\n\n` alone returned a single **17,000-character** "paragraph"
  // holding five milestones' tallies. It passed anyway, by luck: the marker happened to sit in a
  // window that contained exactly one tally, and it went red the first time a new entry pushed a
  // second one inside the same run of lines (`M118`). The unit tests could not have caught it —
  // their fixtures separate blockquote entries with genuinely empty lines, which the real file has
  // never done. Same shape as the rest of this arc: an instrument that cannot show the thing.
  for (const para of text.split(/\n[ \t]*>?[ \t]*\n/)) {
    const flat = para
      .split('\n')
      .map((l) => l.replace(/^>\s?/, ''))
      .join(' ')
    if (!flat.includes(CURRENT)) continue
    for (const t of flat.matchAll(TALLY)) {
      const [, open, s2, s3, s4, closed, deferred, withdrawn, total] = t.map(Number)
      // Purely for the error message: the last milestone named before the numbers.
      const labels = [...flat.slice(0, t.index).matchAll(/`(M\d+[a-z]?)`/g)]
      found.push({ milestone: labels.at(-1)?.[1] ?? '?', open, s2, s3, s4, closed, deferred, withdrawn, total })
    }
  }
  if (found.length > 1) return { ambiguous: found.length }
  return found[0] ?? null
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
  for (const { file, milestone, closesAt, ids } of plans) {
    // A staged plan is finished by its last stage, not its first. Without `closesAt` this asks
    // "has anything called M125 shipped?", which `M125b1` answers yes to while `M125c`/`d`/`e` are
    // still unwritten — so every row those stages owe reads as stale the day the first stage merges.
    const gate = closesAt ?? milestone
    if (shipped && !shipped.has(gate)) continue
    for (const id of ids) {
      const row = byId.get(id)
      if (!row) continue // the plan cites a row from another corpus, or a typo — not this check's business
      if (classify(row.status) === 'open' && !row.status.startsWith('🟨'))
        problems.push(
          `${file} says M${milestone} closes \`${id}\` and M${gate} is on main, but §6:${row.line} still reads "${row.status.slice(0, 40)}"`,
        )
    }
  }

  const derived = derive(rows)
  const published = newestPublishedTally(ledger)
  if (!published)
    problems.push(
      `no tally marked \`${CURRENT}\` — every milestone publishes one and marks it, so an unmarked ledger is a drift of its own`,
    )
  else if (published.ambiguous)
    problems.push(`${published.ambiguous} tallies are marked \`${CURRENT}\` — at most one can be the live count`)
  else
    for (const k of ['open', 's2', 's3', 's4', 'closed', 'deferred', 'withdrawn', 'total'])
      if (published[k] !== derived[k])
        problems.push(
          `the tally published for ${published.milestone} says ${k}=${published[k]}; the status column says ${k}=${derived[k]}`,
        )

  return { problems, derived, published, rows }
}

/**
 * The marker a plan uses to say it ships in stages, and which stage finishes it:
 * `<!-- plan:closes-at M125e -->`. Read from anywhere in the file rather than the 12-line header —
 * it is a single unambiguous token, and burning a header line (the one thing `planClaims` reads) on
 * bookkeeping would change what the plan claims.
 */
const CLOSES_AT = /<!--\s*plan:closes-at\s+M([0-9a-z]+)\s*-->/

/** Collect the shipped plans from the repo root. */
function loadPlans(root) {
  return readdirSync(root)
    .filter((f) => /^PLAN_M\d+_.*\.md$/.test(f))
    .sort()
    .map((f) => {
      const text = readFileSync(join(root, f), 'utf8')
      return {
        file: f,
        milestone: f.match(/^PLAN_M(\d+)_/)[1],
        closesAt: text.match(CLOSES_AT)?.[1] ?? null,
        ids: planClaims(text),
      }
    })
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
