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
// file is a gate that gets routed around. It needs git, so where it cannot read a citation it says
// so and never `0 stale` (`D527`) — a check reporting zero when it could not look is the whole
// failure class this file is about.
//
// That tier has **three** states and shipped with two (`M147-15`). "Nothing to check" and "could not
// check" both arrive as zero citations read, and reading the second onto both is `D527` with its
// sign flipped: an unavailability nobody established. The drawdown reaching zero open rows produced
// the first state for the first time in this repo's history, and the run announced git was missing
// while the plan-claims tier — which needs `git log main` — answered in the same breath.
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
const STAMP = /\brv (\d{4}-\d{2}-\d{2}) @([0-9a-f]{7,40}) (reproduces|drifted)\b/g

/**
 * The same grammar, anchored nowhere, used to find a cell's *intent* to carry a stamp: `rv `
 * followed by a date, through any emphasis in between. What it matches and `STAMP` does not is a
 * stamp somebody meant to write and mis-spelled — which is the whole of `M169-07` (`D869`).
 */
const STAMP_CANDIDATE = /\brv (?=[\s*_]*\d{4}-\d{2}-\d{2})/g

/**
 * The stamp grammar's corpus, stated as data rather than as prose (`D867`): **a status cell's own
 * text, with code spans removed.**
 *
 * A code span in this ledger is a quotation — the two rows `M169-07` was found on quote the
 * malformed stamp that made them, verbatim, as their evidence — and a guard that reads a quotation
 * as an instance reports the specimen instead of the disease. Spaces, not deletion, so every index
 * this returns is an index into the original cell and evidence can be sliced from the real text.
 */
export function maskCodeSpans(text) {
  return text.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length))
}

/**
 * Every stamp in a status cell: the well-formed ones in the order they are written, and the
 * mis-spelled ones as text (`D869`).
 *
 * Both halves are returned because the caller needs both and neither implies the other. A cell can
 * carry three good stamps and one malformed one, and before `M171a` that cell was certified at the
 * first of the three with nothing said about the fourth.
 */
export function allStamps(status) {
  const masked = maskCodeSpans(status)
  const good = [...masked.matchAll(STAMP)].map((m) => ({
    index: m.index,
    length: m[0].length,
    date: m[1],
    commit: m[2],
    verdict: m[3],
  }))
  const malformed = [...masked.matchAll(STAMP_CANDIDATE)]
    .map((m) => m.index)
    .filter((i) => !good.some((g) => g.index === i))
    .map((i) => status.slice(i, i + 48).replace(/\s+/g, ' '))
  return { good, malformed }
}

/** The stamps a cell meant to carry and mis-spelled. Empty is the normal answer. */
export function stampProblems(status) {
  return allStamps(status).malformed
}

/**
 * A backticked token that could be a path: ends in an extension, optionally with a `:<line>` or
 * `:<line>-<line>` suffix. The range half is `M171a`'s: three of the nine rows re-stamped on
 * 2026-09-05 cited a whole test as `` `tests/mixed/storefront.tflw:336-379` ``, and every one of
 * them read as citing **no path at all** — a stamp whose evidence the gate could not see, in a
 * check whose entire subject is evidence the gate can see (`D870`).
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
const CITED = /`([^`\s]+\.[A-Za-z0-9]+)(?::\d+(?:-\d+)?)?`/g

/**
 * A `filedRow` pointer as `packages/lang/src/conformance.ts` writes one (`M147a`, `M147-01`).
 *
 * Anchored at the start of a line so the field's own **doc comment** — which spells the shape out
 * as `` `filedRow: 'M97a-NN'` `` — is not read as a nineteenth pointer. That is not a hypothetical
 * nicety: the comment sits forty lines above the table and would otherwise be a permanent false
 * positive naming a row id that has never existed.
 *
 * The manifest is TypeScript and this is a regex, which is the same trade `conformance.test.ts`
 * made and defended (D138): the failure mode is a pointer this cannot see, never a row it invents.
 * `check` guards that direction — a scan matching nothing passes every check below it silently.
 *
 * **What "nothing" means changed in `M147c-4`, and it changed by the manifest succeeding.** The
 * guard originally read zero pointers as broken outright, on the evidence that the file had never
 * had none. It has none now: `M147a` corrected eighteen stale pointers, and closing `M140-03`
 * retired the nineteenth, which is the instrument arriving at the state it was built to produce.
 * A guard whose alarm cannot tell "the scan broke" from "there is nothing left to track" would
 * have made finishing the work indistinguishable from breaking the tool — `M145`'s one-level-above
 * class, arriving this time as a false *positive*. So the two are separated by asking a question
 * only the first can fail: `FILED_ROW_DECLARED` looks for the field's own declaration in the
 * interface. Field present and no pointers is an empty ledger of gaps; field gone is a rename this
 * regex would otherwise sail past.
 */
const FILED_ROW = /^\s*filedRow: '([^']+)'/gm

/** The `filedRow` field's declaration in `RuntimeRule`/`RuntimeGap`. Its absence is what a rename
 *  looks like; see `FILED_ROW` above for why that has to be asked separately from the count. */
const FILED_ROW_DECLARED = /^\s*filedRow\?: string/m

/**
 * The cell's **current** re-verification. Null when there is none — the caller decides if that is
 * fatal.
 *
 * **Newest by date, not by position** (`D868`). This read `status.match(STAMP)` — the first match —
 * against a convention that appends, so a row carrying a newer measurement went on being certified
 * at an older one: `M169-07`, measured at 3 rows and 5 uncounted re-verifications. The obvious
 * repair is *read the last*, and it is wrong, which is the part worth keeping. The nine rows
 * re-stamped on 2026-09-05 were written at the **front** precisely to defeat the first-match bug, so
 * by the time the repair was built the live corpus was 19 multi-stamp rows with the newest at the
 * front and **none** with it at the back — the fix stated in `PLAN_M171` §4 would have certified
 * every one of them at its oldest stamp. Position was never the fact; the date is, and a date is
 * what the convention was always writing down.
 *
 * Ties resolve to the later-written stamp: two measurements on one day are one day's answer, and the
 * second one is the one somebody bothered to add.
 *
 * The evidence read is the text from this stamp to the **next** stamp, not to the end of the cell.
 * That is what makes the answer the newest stamp's own rather than the union of every stamp's — and
 * it is a narrowing, so it is the half of this repair that can turn a row red. It did, three times,
 * and all three were true: two stamps citing no path at all (`M149f-01`, `M159-01`), and one whose
 * citation the *other* half of this milestone could not read (`M154h-01`, a `:336-379` range).
 */
export function parseStamp(status) {
  const { good } = allStamps(status)
  if (!good.length) return null
  let newest = good[0]
  for (const g of good) if (g.date >= newest.date) newest = g
  const next = good.find((g) => g.index > newest.index)
  const evidence = status.slice(newest.index + newest.length, next ? next.index : status.length)
  return {
    date: newest.date,
    commit: newest.commit,
    verdict: newest.verdict,
    paths: [...new Set([...evidence.matchAll(CITED)].map((c) => c[1]))],
  }
}

/**
 * Split a markdown table row into its data cells.
 *
 * The header of this function used to say "tolerant of `|` inside prose" and it was not: it split
 * on every `|`, and since the status is read as the **last** cell, a pipe anywhere in a row's prose
 * silently made a fragment of that prose the status — which fails the "starts with a status word"
 * test and reports the row as OPEN. `M147c-3` hit it writing up `TF072`, whose whole subject is a
 * `with each` header, so its close stamp cannot describe itself without quoting one.
 *
 * Now it honours GFM's own escape: `\|` is a literal pipe and does not end a cell. Same rule the
 * SPEC table generator learnt in the same commit, and the same one `M134` recorded from the plan
 * side — three instruments, one markdown fact, and each of them had to meet it separately.
 */
function cells(line) {
  let l = line.trim()
  if (l.startsWith('|')) l = l.slice(1)
  if (l.endsWith('|')) l = l.slice(0, -1)
  return l.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|'))
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

/** Ids inside an explicit claim list, backticked or bare: `<!-- plan:closes A3-05, `M97a-04` -->`. */
const ROW_ID_BARE = /\b([A-Z]+\d*[a-z]?-\d+)\b/g

/**
 * An explicit statement of what a plan closes (`M143-08`).
 *
 * Deliberately the same shape as `plan:closes-at` one function down — a plan already declares
 * bookkeeping in HTML comments, and this needs no parser that understands English. The `\s+` after
 * `closes` is what keeps `plan:closes-at` from matching here: `-` is not whitespace.
 */
const CLOSES = /<!--\s*plan:closes\s+([^>]*?)\s*-->/

/**
 * The rows a plan says it closes.
 *
 * **Two sources, explicit first** (`M143-08`). If the plan carries a `<!-- plan:closes … -->`
 * comment, that list is the answer and the header is not read at all — including when the list is
 * empty, which is a plan declaring outright that it closes nothing.
 *
 * Otherwise the opening paragraph counts, as it always has: a plan's body cites dozens of rows as
 * context, its header states the charter. That heuristic was measured on all 12 shipped plans — 44
 * ids, no false positives beyond `A4-07`'s intentional partial — and the measurement was true of
 * the plans that existed and false of the ones written next. `PLAN_M142` said `M125e-01` *leaves
 * the cluster*; `PLAN_M143`'s header listed what it had FILED, three of them open. Both read as
 * unfulfilled close-claims the moment their milestone reached `main`. **The guard cannot read the
 * verb**, and the fix is not to teach it to — it is to let the plan say which ids are claims.
 *
 * The heuristic is kept rather than replaced because replacing it would silently disarm the check
 * for every plan written before this comment existed: no marker would mean no claims, and a guard
 * that goes quiet on twelve plans at once is worse than one with two false positives on two.
 */
export function planClaims(text, headerLines = 12) {
  const explicit = text.match(CLOSES)
  if (explicit) return [...new Set([...explicit[1].matchAll(ROW_ID_BARE)].map((m) => m[1]))]
  const head = text.split('\n').slice(0, headerLines).join('\n')
  return [...new Set([...head.matchAll(ROW_ID)].map((m) => m[1]))]
}

/**
 * Every close-claim a plan states in prose, wherever it is written (`D871`).
 *
 * `planClaims` above decides what the gate *reads*; this decides what the plan *said*. They are two
 * different questions and the whole of `M169-08` is that nothing had ever asked the second one: a
 * `**Closes:** …` on line sixteen of a marker-less plan is not missed loudly, it is not seen at all,
 * and the gate goes on reporting that every plan claim agrees. `PLAN_M160` wrote exactly that, and
 * made *"verify-ledger shows it closed"* its own acceptance clause 7 — an acceptance criterion
 * unsatisfiable by construction, with nothing in a position to say so.
 *
 * **The claim's corpus is the clause, not the line** (`D872`), and that is not a nicety: the two
 * plans this fires on today write `**Closes:** …` and `**Disposes without closing:** …` *on one
 * line*, so a line-granular rule reads a row a plan explicitly declined to close as a row it
 * claimed. Segments are split at bold runs and attributed to the label that opens them; a bare
 * `Closes` before the first bold run opens its own segment, because three of this corpus's oldest
 * plans state the verb unbolded.
 *
 * Detection runs over `maskCodeSpans`, ids come from the real text at the same indices. A close
 * verb inside a code span is a **quotation** — `PLAN_M171` quotes `PLAN_M160`'s defective line
 * while describing it — and quoting a defect must not commit one.
 */
export function closeClaims(text) {
  const out = []
  text.split('\n').forEach((raw, i) => {
    const masked = maskCodeSpans(raw)
    const bolds = [...masked.matchAll(/\*\*([^*]+)\*\*/g)]
    const marks = [{ label: null, from: 0 }, ...bolds.map((b) => ({ label: b[1], from: b.index + b[0].length }))]
    marks.forEach((mark, k) => {
      const to = k < bolds.length ? bolds[k].index : raw.length
      let { label, from } = mark
      if (label === null) {
        const bare = masked.slice(from, to).search(/\bCloses\b/)
        if (bare < 0) return
        from += bare
        label = 'Closes'
      }
      if (!/\bcloses\b/i.test(label) || /without closing/i.test(label)) return
      const ids = [...new Set([...raw.slice(from, to).matchAll(ROW_ID_BARE)].map((m) => m[1]))]
      if (ids.length) out.push({ line: i + 1, ids, text: raw.slice(from, to).trim() })
    })
  })
  return out
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
 * `resolve(path)` answers *where does this path stand in the workspace* (`D528`) — `'here'`,
 * `'absent'` or `'unavailable'` (`D855`). It is injected rather than imported so this function stays
 * free of the filesystem; `main()` supplies the real one (`availability`). Its default is permissive,
 * which only ever affects a caller that declined to pass one — every fixture that cares about
 * resolution passes a fake, and the live run always passes the real thing.
 */
export function check({ ledger, plans, shipped, resolve = () => 'here', manifests = [] }) {
  const problems = []
  const unresolvable = []
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
    // `D869`. A mis-spelled stamp used to be invisible: it did not match, so it did not count, and
    // the row went on being certified at whatever older stamp was still well-formed. Loud, and
    // before the missing-stamp branch, because "you wrote one and it is wrong" is a different
    // instruction from "you wrote none".
    for (const bad of stampProblems(r.status))
      problems.push(
        `§6:${r.line} \`${r.id}\` carries a re-verification stamp the grammar cannot read, so it does ` +
          `not count and the row is certified at an older one — write ` +
          `\`rv <date> @<commit> reproduces|drifted\`, or put the specimen in a code span if you are ` +
          `quoting one: "${bad}"`,
      )
    const stamp = parseStamp(r.status)
    if (!stamp) {
      problems.push(
        `§6:${r.line} \`${r.id}\` is open with no re-verification stamp — write \`rv <date> @<commit> ` +
          `reproduces|drifted\` and cite a path. Nobody has measured whether this still happens: "${r.status.slice(0, 50)}"`,
      )
      continue
    }
    // `D855`: three states, and this branched on two. A row is a problem only when every path it
    // cites is `absent` — reported missing by a tree that was in a position to know. If any path is
    // merely `unavailable` the environment could not look, so the row is banked and announced
    // instead of accused; `main()` prints the count, because a silence this gate does not name is
    // the same defect one layer out (`D527`).
    const stands = stamp.paths.map(resolve)
    if (!stands.includes('here')) {
      if (stands.includes('unavailable')) unresolvable.push(r.id)
      else
        problems.push(
          `§6:${r.line} \`${r.id}\` is stamped but cites no path that exists` +
            `${stamp.paths.length ? ` (tried ${stamp.paths.slice(0, 4).map((x) => `\`${x}\``).join(', ')})` : ''} — ` +
            'a stamp with no live path cannot be checked for staleness, which is most of what it is for',
        )
    }
  }

  const byId = new Map(rows.map((r) => [r.id, r]))
  // `M147f` (`M131-03`) — this check needs `git log main`, and it is the one check here that used
  // to *guess* when it could not have it. `shipped === null` means "not a git checkout", which
  // `exec.mjs` produces on every box run because it rsyncs the worktree without `.git`; the old
  // `shipped &&` made that falsy, skipped the `continue`, and ran the check over **every** plan as
  // though all of them had merged. So writing `PLAN_M131_SAFETY_COMPLETION.md` was enough to make
  // the box assert `` M131 says it closes `M130-09` and M131 is on main `` — with nothing built,
  // nothing committed and nothing merged.
  //
  // The false red is not the danger; its **wording** is. It states a merge as fact, names a row and
  // a line, and the cheapest way to make it pass is to mark that row closed — which is the exact
  // corruption §6 exists to prevent, reached by obeying the guard.
  //
  // This file already had the rule and applied it twice — `D527` refuses to print `0 stale` when it
  // could not look, and the summary line drops its conformance-pointer clause when no manifest was
  // read. The idea was never missing here; this was the one check that inverted it.
  const planClaimsChecked = shipped !== null
  // `D871`/`D873`. Every close-claim a plan states that `planClaims` does not return, announced
  // whether or not git could answer — the count is the size of the blind spot and it is knowable
  // without a repository. The *failure* underneath it needs both git and an open row, and is
  // guarded accordingly.
  const unreadClaims = []
  for (const { file, milestone, closesAt, ids, claims = [] } of plans) {
    // A staged plan is finished by its last stage, not its first. Without `closesAt` this asks
    // "has anything called M125 shipped?", which `M125b1` answers yes to while `M125c`/`d`/`e` are
    // still unwritten — so every row those stages owe reads as stale the day the first stage merges.
    const gate = closesAt ?? milestone
    for (const c of claims) {
      for (const id of c.ids) {
        if (ids.includes(id)) continue
        const row = byId.get(id)
        // Not a row in this corpus: a plan's prose cites ids from the sibling and from decision
        // tables (`D-M91-3` reads as `M91-3`), and inventing a subject for those is how a guard
        // starts maintaining a wordlist.
        if (!row) continue
        unreadClaims.push(`${file}:${c.line} \`${id}\``)
        if (!planClaimsChecked || !shipped.has(gate)) continue
        if (classify(row.status) === 'open' && !row.status.startsWith('🟨'))
          problems.push(
            `${file}:${c.line} states that M${milestone} closes \`${id}\` and M${gate} is on main, but ` +
              `\`planClaims\` cannot read that claim and §6:${row.line} still reads "${row.status.slice(0, 40)}" ` +
              `— add \`<!-- plan:closes ${id} -->\` so the claim is read where it is made`,
          )
      }
    }
    if (!planClaimsChecked) continue
    if (!shipped.has(gate)) continue
    for (const id of ids) {
      const row = byId.get(id)
      if (!row) continue // the plan cites a row from another corpus, or a typo — not this check's business
      if (classify(row.status) === 'open' && !row.status.startsWith('🟨'))
        problems.push(
          `${file} says M${milestone} closes \`${id}\` and M${gate} is on main, but §6:${row.line} still reads "${row.status.slice(0, 40)}"`,
        )
    }
  }

  // `M147a` / `M147-01` — a conformance manifest's `filedRow` must name a row that is still OPEN.
  //
  // `conformance.test.ts` passes a statically decidable rule that carries *either* a `checkerCode`
  // *or* a `filedRow`, and it cannot ask whether the row still tracks anything, because the ledger
  // is gitignored and that test runs in CI. So the question lands here, which is the only guard
  // that reads both halves. It went unasked for eleven milestones: eighteen of nineteen pointers
  // named a closed or withdrawn row, and seven of those carried no `checkerCode` either — seven
  // statically decidable rules the checker does not decide, all reading as answered.
  //
  // A pointer at a **closed** row is the interesting failure, not a missing one: the rule was
  // answered by something, and the answer belongs in the manifest as a `checkerCode` or a changed
  // `decidable`. A pointer at a row this ledger has never heard of is likelier a typo than a
  // cross-corpus reference, and is reported as its own thing rather than skipped.
  for (const { file, text } of manifests) {
    const pointers = [...text.matchAll(FILED_ROW)].map((m) => m[1])
    if (!FILED_ROW_DECLARED.test(text)) {
      problems.push(
        `${file} no longer declares a \`filedRow\` field — either it was renamed or this scan broke. ` +
          'A scan that matches nothing passes every check below it, which is the one outcome this must not report as clean',
      )
      continue
    }
    // Zero pointers with the field still declared is the manifest tracking no open gap, which is
    // the state this whole guard exists to make reachable. Silence, not an alarm.
    if (!pointers.length) continue
    for (const id of new Set(pointers)) {
      const row = byId.get(id)
      if (!row) {
        problems.push(`${file} points at \`${id}\`, which is not a row in §6 — a typo, or a row that was renamed and left a dangling pointer`)
        continue
      }
      const kind = classify(row.status)
      if (kind !== 'open')
        problems.push(
          `${file} points at \`${id}\` as an outstanding gap, but §6:${row.line} says it is ${kind} — ` +
            'a rule held answered by a row that tracks nothing. Put what closed it in the manifest (a `checkerCode`, or a corrected `decidable`) and take the pointer out',
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

  return { problems, derived, published, rows, planClaimsChecked, unresolvable, unreadClaims }
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

/** Is `dir` a real checkout? `.git` is a directory in a clone and a file in a worktree. */
const isCheckout = (dir) => existsSync(join(dir, '.git'))

/**
 * Can this tree answer *where does this cited path live* — and if it can, does the path exist?
 * `'here'` | `'absent'` | `'unavailable'` (`D855`).
 *
 * `locate` returns one bit and the caller read it as two different facts. A path that does not
 * resolve is "this row cites a file that does not exist" only when the trees it would have resolved
 * against are trustworthy. Under `scripts/exec.mjs` they are not: the box sandbox is an rsync of the
 * worktree with no `.git`, and — the case that actually fired — **the tflw driver syncs only
 * `testFlow`**, so the sibling half of `D528`'s workspace path space can sit arbitrarily far behind
 * the Mac. Measured 2026-09-02: `M164-02` was reported as citing no path that exists, on a box whose
 * `testFlow-tests` was missing `M164`'s own artefacts; the sibling driver's next sync moved 31 files
 * and the same command went green with the ledger untouched.
 *
 * That is `D527` one level over. `D527` says this gate must never print `0 stale` when it could not
 * look, and `changedSince`/`staleReport` implement it carefully for *staleness* (`M147f`, `M131-03`,
 * the `UNAVAILABLE` lines). Path existence had no such distinction, so the degraded environment
 * produced not a silence but a **claim about the ledger** — in the one gate whose whole job is that
 * §6 does not lie about how much work is left, and the only one of this repo's four record gates
 * that fails plausibly rather than refusing (`verify-anchors`, `verify-citations` and
 * `gen-decisions` all detect the missing `.git` and say "run this on the Mac").
 *
 * **Only non-resolution degrades, and that asymmetry is the whole safety argument.** A path that
 * resolves is trustworthy wherever it is found — the file is there. So the check keeps its full
 * force on a real checkout, including the negative control that a bogus path still hard-fails, and
 * declines to answer only where an answer would be invented.
 */
export function availability(path, root) {
  if (locate(path, root)) return 'here'
  // Nothing missing is trustworthy from a tree that is not a checkout — an rsync's absence is
  // indistinguishable from a real one, and that is the whole finding.
  if (!isCheckout(root)) return 'unavailable'

  const seg = path.indexOf('/')
  if (seg < 0) return 'absent' // a root-level file, and root is a checkout that looked
  const first = path.slice(0, seg)

  // `D856`. Which tier was this path addressed to? `locate` tries own-repo then the sibling hop, and
  // the first segment is what tells them apart — but only when it names a real directory. `packages/…`
  // makes `<root>/../packages` a path that means nothing, so a rule keyed on the *shape* of the
  // citation would route every own-repo miss through the sibling tier and answer `unavailable` for
  // all of them. That is `0 stale` wearing a hat one tier down, and it failed this milestone's own
  // negative control before it was written this way.
  if (existsSync(join(root, first))) return 'absent' // own-repo path; root is a checkout and looked

  const sib = join(root, '..', first)
  // Absent entirely and present-but-not-a-checkout are the same answer for the same reason: the
  // half of the workspace this path names was never looked at here.
  if (!isCheckout(sib)) return 'unavailable'
  return 'absent' // the sibling is a checkout, so its `no` is a real no
}

/**
 * Has `rel` changed in `dir` since the stamp was taken? `null` means git could not answer.
 *
 * **Content, not history** (`M143-07`). This asked `git log <commit>..HEAD -- <rel>` and called any
 * non-empty answer drift, which is a question about the *commit graph* wearing the costume of a
 * question about the file. A squash merge produces exactly one commit touching every path the
 * branch touched, so every stamp a milestone takes on its own branch went stale the moment it
 * landed — byte-identical or not. Measured: `M143-01` and `M143-02` were both reported drifted
 * against `c5cfd83` while `git diff c5cfd83 origin/main --` on their paths was **empty**.
 *
 * That is the failure `D527` was written to avoid one level up. A report with routine false
 * positives is a report people skim, and the true positive sitting next to them is what gets
 * skimmed — `M131-03` was in that list on the day this was measured.
 *
 * So the exact question is asked first: same blob at the stamp as at `HEAD`? It is only askable
 * when the stamped sha resolves *in this repo*, so two cases still fall back to the history
 * question, and both keep their previous answers exactly:
 *
 *   · **a sibling path** (`D529`) — the stamped sha is a tflw commit and means nothing in
 *     testFlow-tests, so the question is the stamp's date. Coarser, and said to be coarser
 *     wherever this is printed. Skipping sibling paths instead would be `0 stale` wearing a hat.
 *   · **an untracked or unreachable path** — `scripts/exec.mjs` is untracked in both repos
 *     (`D14`) and is cited by an open row, so `HEAD:<rel>` does not resolve for it. The log
 *     question returns empty there, as it always has.
 */
function changedSince({ dir, rel, sibling }, { commit, date }) {
  const git = (...args) =>
    execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()

  if (!sibling) {
    try {
      // Throws when the sha is not a ref here, or when the path did not exist at either end —
      // all three are "cannot answer exactly", and all three fall through on purpose.
      return git('rev-parse', `${commit}:${rel}`) !== git('rev-parse', `HEAD:${rel}`)
    } catch {
      // fall through to the history question
    }
  }

  const range = sibling ? [`--since=${date} 00:00`] : [`${commit}..HEAD`]
  try {
    return git('log', '--format=%h', '-1', ...range, '--', rel).length > 0
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
 *
 * Returns the workload as well as the finding, because the caller cannot otherwise tell an empty
 * report from an unread one (`M147-15`): `openRows` is how many rows were walked, `cited` how many
 * citations they carry, `checked` how many git actually answered for, and `unread` the rest.
 */
export function staleReport(rows, root) {
  const lines = []
  let openRows = 0
  let cited = 0
  let checked = 0
  for (const r of rows) {
    if (classify(r.status) !== 'open') continue
    openRows++
    const stamp = parseStamp(r.status)
    if (!stamp) continue
    for (const path of stamp.paths) {
      // Counted here, before anything can drop it, and `unread` is derived by subtraction rather
      // than incremented in the branches. The old counter sat inside ONE of the two `continue`s, so
      // a citation naming a path that is not in this checkout left both the numerator and the
      // denominator — dropped without trace by a report whose entire job is to say what it could
      // not see. A complement cannot be forgotten by whoever adds the third `continue`.
      cited++
      const at = locate(path, root)
      if (!at) continue
      const moved = changedSince(at, stamp)
      if (moved === null) continue
      checked++
      if (moved)
        lines.push(
          `  · \`${r.id}\` — \`${path}\` has changed since ${stamp.commit}` +
            `${at.sibling ? ` (by date: anything after ${stamp.date}, the sha is not a ref in that repo)` : ''}`,
        )
    }
  }
  return { lines, openRows, cited, checked, unread: cited - checked }
}

/**
 * `M171`'s subject, applied to this file's own two guards (`D867`).
 *
 * Each entry states the corpus a guard reads **as data** — a function that resolves it against the
 * live records and returns the units found — beside the one-line subject the guard's docblock
 * claims. `verify-corpora.mjs` then asserts three things per entry: the corpus resolves, it is
 * non-empty, and every plant lands. The third clause is the one that makes this more than a
 * docblock convention, and it is `M168`'s rule (*a vacuity control must mutate what the code
 * ignores*) pointed at the corpus rather than at the assertion: a declared corpus nothing can be
 * planted inside is a sentence, not a guard.
 *
 * A plant returns `true` when the guard **caught** it. Negative controls are plants too, and say so
 * in their own name — a corpus is defined as much by what it refuses as by what it reads, and the
 * two quotation rules here (`D867`, `D872`) are exactly the refusals `M169-07` and `M169-08` needed.
 */
export const CORPORA = [
  {
    id: 'verify-ledger/stamp-grammar',
    subject: "every re-verification stamp written in an open row's status cell, newest first",
    needs: ['ledger'],
    resolve: ({ ledger }) => {
      const cells = parseIndex(ledger).filter((r) => classify(r.status) === 'open')
      const n = cells.reduce((a, r) => {
        const { good, malformed } = allStamps(r.status)
        return a + good.length + malformed.length
      }, 0)
      return { units: n, describe: `${n} stamp(s) across ${cells.length} open row(s)` }
    },
    plants: [
      {
        what: 'a newer stamp appended below an older one is the one read',
        run: () => {
          const cell =
            'open — **rv 2026-08-01 @aaaaaaa reproduces** · `a/b.ts:1` · first' +
            ' · **rv 2026-09-01 @bbbbbbb drifted** · `a/c.ts:2` · second'
          const st = parseStamp(cell)
          return st?.date === '2026-09-01' && st.paths.length === 1 && st.paths[0] === 'a/c.ts'
        },
      },
      {
        what: 'a newer stamp written at the front is the one read',
        run: () => {
          const cell =
            'open — **rv 2026-09-01 @bbbbbbb drifted** · `a/c.ts:2` · newest' +
            ' · prior stamp, kept verbatim: **rv 2026-08-01 @aaaaaaa reproduces** · `a/b.ts:1`'
          return parseStamp(cell)?.date === '2026-09-01'
        },
      },
      {
        what: 'a mis-spelled stamp is reported rather than skipped',
        run: () => stampProblems('open — **rv 2026-08-30 @566cc5d**, no verdict word').length === 1,
      },
      {
        what: 'NEGATIVE CONTROL — a mis-spelled stamp inside a code span is a quotation, not an instance',
        run: () => stampProblems('open — the row below spells `**rv 2026-08-30 @566cc5d**,` wrongly').length === 0,
      },
      {
        what: 'a citation carrying a line range is evidence, not silence',
        run: () =>
          parseStamp('open — **rv 2026-09-05 @7b2617a drifted** · `tests/mixed/storefront.tflw:336-379`')
            ?.paths.length === 1,
      },
    ],
  },
  {
    id: 'verify-ledger/plan-close-claims',
    subject: 'every close-claim a plan states, wherever in the record it is written',
    needs: ['plans'],
    resolve: ({ plans }) => {
      const n = plans.reduce((a, p) => a + (p.claims?.length ?? 0), 0)
      return { units: n, describe: `${n} close-claim clause(s) across ${plans.length} plan record(s)` }
    },
    plants: [
      {
        what: 'a close-claim below the twelve-line window, on a shipped milestone, over an open row',
        run: () => {
          const { problems } = checkPlanted({ line: 20, label: '**Closes:**' })
          return problems.some((p) => /planClaims` cannot read that claim/.test(p))
        },
      },
      {
        what: 'NEGATIVE CONTROL — the same id under `Disposes without closing:` is not a claim',
        run: () => {
          const { problems } = checkPlanted({ line: 20, label: '**Disposes without closing:**' })
          return problems.length === 0
        },
      },
      {
        what: 'NEGATIVE CONTROL — a close-claim quoted inside a code span is not a claim',
        run: () => checkPlanted({ line: 20, label: null }).problems.length === 0,
      },
    ],
  },
]

/**
 * One planted plan, run through the real `check` (`D867`). Written here rather than in the test
 * file on purpose: a corpus declaration whose plant is proved somewhere else is a corpus
 * declaration nobody can read, and the plant is the load-bearing half.
 */
function checkPlanted({ line, label }) {
  const claim = label ? `${label} \`X-01\`` : 'a plan wrote `**Closes:** X-01` and was wrong to'
  const text = ['# PLAN_M900', ...Array.from({ length: line - 2 }, () => ''), claim].join('\n')
  return check({
    ledger: [
      '**Ledger: 1 open — S2 0 · S3 1 · S4 0 — 0 closed, 0 deferred, 0 withdrawn, 1 total.**',
      '<!-- tally:current -->',
      '',
      '## 6. Full index',
      '| id | sev | claim | status |',
      '|---|---|---|---|',
      '| `X-01` | S3 | a claim | open — **rv 2026-09-01 @aaaaaaa reproduces** · `a/b.ts:1` |',
    ].join('\n'),
    plans: [{ file: 'PLAN_M900_PLANTED.md', milestone: '900', ids: planClaims(text), claims: closeClaims(text) }],
    shipped: new Set(['900']),
  })
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
        claims: closeClaims(text),
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
  // The conformance manifests, whose `filedRow` pointers this holds to an open row.
  //
  // **Announced when absent, never skipped quietly** — `D527`'s rule for the stale tier, which
  // applies for the same reason: `TFLW_LEDGER_ROOT` can point anywhere, and a root without the
  // manifest must not read as a root whose pointers all check out. It is announced rather than
  // fatal because a manifest genuinely missing from this repo turns the whole `lang` suite red
  // first — this guard is not that one's backstop. The vacuity it *is* the backstop for is the
  // field being renamed while the file stays: that surfaces inside `check`, as zero pointers.
  const MANIFESTS = ['packages/lang/src/conformance.ts']
  const manifests = []
  const missing = []
  for (const rel of MANIFESTS) {
    const f = join(ROOT, rel)
    if (existsSync(f)) manifests.push({ file: rel, text: readFileSync(f, 'utf8') })
    else missing.push(rel)
  }
  const shipped = shippedMilestones()
  const { problems, derived, rows, planClaimsChecked, unresolvable, unreadClaims } = check({
    ledger,
    plans: loadPlans(ROOT),
    shipped,
    manifests,
    resolve: (p) => availability(p, ROOT),
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
      // The summary names only what was actually read. Claiming the pointers agree when no manifest
      // was found would be this file's own subject, one layer out. `M147f` (`M131-03`) puts the
      // plan claims under the same rule: off a git checkout they are not checked, so they are not
      // claimed.
      `vocabulary, ${planClaimsChecked ? 'plan claims, ' : ''}the published tally` +
      `${manifests.length ? ', every conformance pointer' : ''} ` +
      "and every open row's stamp all agree",
  )

  // `D873`. Announced, never silent, and deliberately not a failure on its own: a close-claim the
  // gate cannot read is a *readability* defect, and it only costs something when the row it names is
  // still open. Printing the count keeps the blind spot's size a published number instead of a thing
  // somebody has to go and measure again — `D527`'s rule, applied to the claim side.
  if (unreadClaims.length)
    console.log(
      `  · ${unreadClaims.length} prose close-claim${unreadClaims.length === 1 ? '' : 's'} \`planClaims\` ` +
        `does not read: ${unreadClaims.join(', ')}`,
    )

  if (!planClaimsChecked)
    console.log(
      '  plan claims UNAVAILABLE — not a git checkout, so `git log main` cannot say which plans have merged.\n' +
        '  Not run, and therefore not reported as passing (`M131-03`). Run this on a machine with `.git`.',
    )

  for (const rel of missing) console.log(`  conformance pointers UNAVAILABLE — no manifest at ${rel}`)

  // `D855`. Sits beside the other two UNAVAILABLE lines on purpose: they are one rule stated three
  // times, and the row-existence tier is the one that used to state it as an accusation instead.
  if (unresolvable.length)
    console.log(
      `  cited paths UNAVAILABLE for ${unresolvable.length} open row${unresolvable.length === 1 ? '' : 's'} ` +
        `(${unresolvable.slice(0, 6).join(', ')}${unresolvable.length > 6 ? ', …' : ''}) — the tree that would\n` +
        '  answer is not a checkout here (an rsync, or absent), so "missing from the ledger\'s workspace"\n' +
        '  and "never synced to this machine" are the same observation.\n' +
        '  Not checked, and therefore not reported as passing. Run this on a machine with `.git`.',
    )

  // `D527`: this must never print `0 stale` when it could not look. The stale check needs git per
  // cited path, and `exec.mjs` rsyncs the worktree without `.git`, which is also why a box run
  // cannot answer the plan-claims tier (`M131-03`). It *does* run there — the older wording here
  // said `verify:ledger` "cannot run on the box at all", and `M147f` established that it can, and
  // that the answer it used to give was invented. So absence is announced, not rounded to zero.
  //
  // `M147-15`: three states, and this branched on two. `checked === 0` was read as "could not look",
  // which is true where git is absent and false where there was simply nothing to look at — the
  // state the ledger reached at `03f6793`, when the last open row closed and this line announced
  // `no git here` in a checkout that had just answered a `git log main`. What is asked now is
  // whether there was a workload at all, and only then whether it could be read.
  //
  // The second message no longer names a cause, either. `changedSince` returns `null` for two
  // reasons — no git, and a stamped sha that is not a ref here — and its own comment has said so
  // since `M143-07` while the line reporting it said only the first. A rebase that rewrites a
  // stamped commit out of history is enough to make `no git here` false in a perfectly good
  // checkout, which is a smaller instance of exactly the defect above.
  const { lines, checked, unread, cited, openRows } = staleReport(rows, ROOT)
  if (cited === 0) {
    console.log(
      openRows === 0
        ? '  stale check: nothing to check — no open rows, so there is no stamp that could have gone stale.'
        : `  stale check: nothing to check — ${openRows} open row${openRows === 1 ? '' : 's'}, none of them citing a path.`,
    )
  } else if (checked === 0) {
    console.log(
      `  stale check UNAVAILABLE — none of the ${cited} citation${cited === 1 ? '' : 's'} could be read here ` +
        '(no git, or the stamped commits are not in this checkout)',
    )
  } else {
    // Partial blindness gets said too, not just total blindness: a citation whose commit is not in
    // this checkout (another branch, a rewritten history) is one git could not answer for, and
    // rolling it into "none moved" is the same lie as `0 stale`, only smaller.
    const blind = unread ? ` — ${unread} more could not be read here` : ''
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
