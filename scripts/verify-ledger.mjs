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
// `M140` added a fourth, after a sweep re-measured all 58 open rows and found that nothing had ever
// asked whether an open row still reproduces (`M136a-01`): a row fixed in passing by a later
// milestone stays open indefinitely, and the queue plans around a defect that is not there. The
// sweep is a one-off; this is what makes it an invariant.
//
//   4. **Every open row carries a re-verification stamp** — `rv <date> @<commit> <verdict>` plus
//      evidence naming at least one real path (`D516`/`D526`). Missing is **fatal** (`D517`): it is
//      a known gap, and the rejected alternative — counting unstamped rows without failing — is the
//      awk one-liner's shape all over again, a number nobody is obliged to act on.
//
// …and one thing that is deliberately **not** a check but a **report**: whether a stamp has gone
// stale, i.e. whether the path it cites has changed since the commit it was taken at (`D525`). A
// stale stamp is a suspicion, not a known gap, and a gate that reddens whenever someone edits a hot
// file is a gate that gets routed around. It needs git, so where git is absent it says
// `stale check UNAVAILABLE — no git here` and never `0 stale` (`D527`) — a check reporting zero when
// it could not look is the whole failure class this file is about.
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

/**
 * `D526`'s re-verification stamp, as it is written inside an open row's status cell:
 *
 *     open — **rv 2026-08-19 @cfb256a reproduces** · `packages/lang/src/checker.ts:3071` · evidence
 *
 * `fixed` is deliberately not a verdict here — a row that no longer reproduces is *closed*, and the
 * corpus's existing `✅ **fixed \`M<N>\`**` idiom already carries that. So the vocabulary is exactly
 * the two states an open row can be in: it still does the thing, or it does a different thing.
 */
const STAMP = /\brv (\d{4}-\d{2}-\d{2}) @([0-9a-f]{7,40}) (reproduces|drifted)\b/

/**
 * A backticked token that could be a path: ends in an extension, optionally with a `:<line>` suffix.
 * Whitespace is excluded, which is what keeps a backticked *command* — `env -u DISPLAY node
 * scripts/verify-watch.mjs` — from being read as a citation. That matters: `D526` requires the stamp
 * to name the source the behaviour lives in, never the command that showed it, because a command is
 * not something git can be asked about.
 *
 * A slash is **not** required, and requiring one was this check's first defect: it rejected
 * `SPEC.md` and `CONTRIBUTING.md`, which are repo-relative paths that happen to live at the root.
 * The cost of the looser rule is that prose tokens like `body.id` are also *candidates* — harmless,
 * since resolution is what decides, and the failure message names everything it tried.
 */
const CITED = /`([^`\s]+\.[A-Za-z0-9]+)(?::\d+)?`/g

/** Parse a status cell's stamp. Returns null when there is none — the caller decides if that is fatal. */
export function parseStamp(status) {
  const m = status.match(STAMP)
  if (!m) return null
  const evidence = status.slice(m.index + m[0].length)
  return {
    date: m[1],
    commit: m[2],
    verdict: m[3],
    paths: [...new Set([...evidence.matchAll(CITED)].map((c) => c[1]))],
  }
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

/**
 * Run every check. Pure — each input is passed in, so the tests need no repo.
 *
 * `resolve(path)` answers *does this path exist somewhere in the workspace* (`D528`). It is injected
 * rather than imported so this function stays free of the filesystem; `main()` supplies the real
 * one. Its default is permissive, which only ever affects a caller that declined to pass one — every
 * fixture that cares about resolution passes a fake, and the live run always passes the real thing.
 */
export function check({ ledger, plans, shipped, resolve = () => true }) {
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

    // `D517`. Only open rows: a closed row's truth is its close, and a deferred one is not a claim
    // about the code. `🟨` classifies open and is therefore included, which is right — a partial is
    // a live claim about the half that did not ship.
    if (classify(r.status) !== 'open') continue
    const stamp = parseStamp(r.status)
    if (!stamp) {
      problems.push(
        `§6:${r.line} \`${r.id}\` is open with no re-verification stamp — write \`rv <date> @<commit> ` +
          `reproduces|drifted\` and cite a path. Nobody has measured whether this still happens: "${r.status.slice(0, 50)}"`,
      )
      continue
    }
    if (!stamp.paths.some(resolve))
      problems.push(
        `§6:${r.line} \`${r.id}\` is stamped but cites no path that exists` +
          `${stamp.paths.length ? ` (tried ${stamp.paths.slice(0, 4).map((x) => `\`${x}\``).join(', ')})` : ''} — ` +
          'a stamp with no live path cannot be checked for staleness, which is most of what it is for',
      )
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

/**
 * Where a cited path actually lives (`D528`).
 *
 * The ledger sits in tflw, but a third of the corpus is about testFlow-tests, so the stamp's path
 * space is the **workspace**: `<root>/<path>` first, then `<root>/../<first-segment>/<rest>`. Order
 * matters and is not arbitrary — `scripts/verify-watch.mjs` names a real file in testFlow-tests and
 * nothing at all in tflw, so an unprefixed sibling path is a citation of a file the reader cannot
 * open. Hence the prefix requirement, and hence own-repo-wins here.
 */
export function locate(path, root) {
  if (existsSync(join(root, path))) return { dir: root, rel: path, sibling: false }
  const seg = path.indexOf('/')
  if (seg > 0) {
    const dir = join(root, '..', path.slice(0, seg))
    const rel = path.slice(seg + 1)
    if (existsSync(join(dir, rel))) return { dir, rel, sibling: true }
  }
  return null
}

/** Has `rel` changed in `dir` since the stamp was taken? `null` means git could not answer. */
function changedSince({ dir, rel, sibling }, { commit, date }) {
  // `D529`. In this repo the stamped sha is a real ref and the question is exact. In a sibling repo
  // it is a tflw sha and means nothing, so the question falls back to the stamp's date — coarser,
  // and said to be coarser wherever this is printed. The alternative, skipping sibling paths, is
  // `0 stale` wearing a hat, which is the one thing `D527` forbids.
  const range = sibling ? [`--since=${date} 00:00`] : [`${commit}..HEAD`]
  try {
    const out = execFileSync('git', ['log', '--format=%h', '-1', ...range, '--', rel], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString()
    return out.trim().length > 0
  } catch {
    return null // no git here, or the stamped commit is not in this checkout
  }
}

/**
 * `D525`'s report: which stamps sit on paths that have moved under them.
 *
 * Deliberately not a problem. A missing stamp is a known gap and blocks; a stale one is a suspicion
 * and informs, because a gate that reddens every time somebody edits a hot file is a gate people
 * learn to run with `|| true`. Age is not the measure either — a ten-milestone-old stamp against
 * untouched code is current, and a week-old stamp against a file edited yesterday is not.
 */
export function staleReport(rows, root) {
  const lines = []
  let checked = 0
  let unavailable = 0
  for (const r of rows) {
    if (classify(r.status) !== 'open') continue
    const stamp = parseStamp(r.status)
    if (!stamp) continue
    for (const path of stamp.paths) {
      const at = locate(path, root)
      if (!at) continue
      const moved = changedSince(at, stamp)
      if (moved === null) {
        unavailable++
        continue
      }
      checked++
      if (moved)
        lines.push(
          `  · \`${r.id}\` — \`${path}\` has changed since ${stamp.commit}` +
            `${at.sibling ? ` (by date: anything after ${stamp.date}, the sha is not a ref in that repo)` : ''}`,
        )
    }
  }
  return { lines, checked, unavailable }
}

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
  const { problems, derived, rows } = check({
    ledger,
    plans: loadPlans(ROOT),
    shipped,
    resolve: (p) => locate(p, ROOT) !== null,
  })

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
      'vocabulary, plan claims, the published tally and every open row\'s stamp all agree',
  )

  // `D527`: this must never print `0 stale` when it could not look. The stale check needs git per
  // cited path, and `exec.mjs` rsyncs the worktree without `.git` — the same reason `verify:ledger`
  // cannot run on the box at all (`M131-03`). So absence is announced, not rounded down to zero.
  const { lines, checked, unavailable } = staleReport(rows, ROOT)
  if (checked === 0) {
    console.log(`  stale check UNAVAILABLE — no git here (${unavailable} citation${unavailable === 1 ? '' : 's'} unread)`)
  } else {
    // Partial blindness gets said too, not just total blindness: a citation whose commit is not in
    // this checkout (another branch, a rewritten history) is one git could not answer for, and
    // rolling it into "none moved" is the same lie as `0 stale`, only smaller.
    const blind = unavailable ? ` — ${unavailable} more could not be read here` : ''
    if (lines.length) {
      console.log(`  ${lines.length} stamp${lines.length === 1 ? '' : 's'} may be stale — the cited path has moved since:`)
      for (const l of lines) console.log(l)
      console.log(`  (${checked} citations checked${blind}. This informs; it does not fail — re-measure the row when you touch it.)`)
    } else {
      console.log(`  ${checked} citations checked, none moved since their stamp${blind}`)
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main()
