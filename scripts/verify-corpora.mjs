// Every guard declares the corpus it reads, and the declaration is checked (`M171a`, `D867`).
//
// `M167` diagnosed *a guard narrower than its repair*. Ten instances later the general form is:
// **each guard's subject was stated in prose in its docblock, and its corpus was stated in code, and
// nothing compared the two.** The failure is always in the same direction — a guard whose corpus is
// narrower than its subject does not report a smaller number, it reports a *clean* one, which is why
// every instance so far was found by something other than the guard.
//
// So a corpus stops being a fact of the implementation and becomes data the guard publishes: a
// resolver that answers *how many units are in it, right now, in this checkout*, beside the
// one-line subject the guard claims. Three assertions per declaration — it resolves, it is
// non-empty, and every plant lands.
//
// **The third is the load-bearing one.** A declaration nothing can be planted inside is a sentence,
// not a guard; this is `M168`'s rule (*a vacuity control must mutate what the code ignores*) pointed
// at the corpus instead of the assertion. Negative controls are plants too and are named as such:
// a corpus is defined as much by what it refuses — a quoted specimen, a row a plan declined to
// close — as by what it reads.
//
// Two tiers, for `D683`'s reason and in its shape (`D874`). Tier 1 is the plants: synthetic inputs,
// no records, runs on any checkout including CI. Tier 2 resolves each corpus against the live
// records, which are gitignored, so it **says it could not run** rather than passing quietly — the
// distinction this repository has had to learn separately in four instruments (`D527`, `D683`,
// `D855`, and here).

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CORPORA as SCRUB_CORPORA } from './gen-decisions.mjs'
import { CORPORA as LEDGER_CORPORA, closeClaims, planClaims } from './verify-ledger.mjs'
import { CORPORA as LANG_BUILD_CORPORA } from './verify-lang-build.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LEDGER = join(ROOT, 'REVIEW_FINDINGS.md')

/** Every declaration in the repository. One import per guard that has taken `M171`'s shape. */
export const CORPORA = [...LEDGER_CORPORA, ...SCRUB_CORPORA, ...LANG_BUILD_CORPORA]

/**
 * The checkout, when `git` can enumerate it, and `null` when it cannot.
 *
 * A separate field from `root` because they are different facts and only one of them is a corpus.
 * `root` is always a directory; `repo` is a directory whose tracked set can be listed. The offload
 * driver rsyncs this tree to the build host **without `.git/`**, so on that machine `root` is fine
 * and `repo` is `null` — and a corpus declared over the tracked set has to be *skipped by name*
 * there, not resolved to zero and not thrown out of.
 */
function repoOrNull(root) {
  try {
    execFileSync('git', ['-C', root, 'rev-parse', '--git-dir'], { stdio: ['ignore', 'ignore', 'ignore'] })
    return root
  } catch {
    return null
  }
}

/**
 * What this checkout can supply a resolver, field by field. A field is `null` when the checkout
 * does not have it, and each declaration says in its `needs` which fields it wants (`M171b`).
 *
 * Per-field rather than all-or-nothing, because the second guard to declare a corpus needed a
 * different half of the tree: the ledger's two corpora need the gitignored records, the scrub
 * gate's two need only the repository. Returning `null` for the whole object — which is what this
 * did while one guard was the only guard — would have skipped a corpus it could have resolved and
 * printed `corpus resolution did not run` over it. That is this milestone's own property, in the
 * gate that exists to catch it, and it took a second instance to make visible.
 */
export function records(root = ROOT) {
  const ledgerPath = join(root, 'REVIEW_FINDINGS.md')
  if (!existsSync(ledgerPath)) return { root, repo: repoOrNull(root), ledger: null, plans: null }
  const plans = readdirSync(root)
    .filter((f) => /^PLAN_M\d+_.*\.md$/.test(f))
    .sort()
    .map((f) => {
      const text = readFileSync(join(root, f), 'utf8')
      return { file: f, text, ids: planClaims(text), claims: closeClaims(text) }
    })
  return { root, repo: repoOrNull(root), ledger: readFileSync(ledgerPath, 'utf8'), plans }
}

/** Tier 1 — the plants. Synthetic in, boolean out; no records, no repository, no excuses. */
export function plants(corpora = CORPORA) {
  const results = []
  for (const c of corpora) {
    if (!c.plants?.length) {
      results.push({ id: c.id, what: '(declares no plant)', ok: false, why: 'a corpus nothing can be planted inside is a sentence, not a guard' })
      continue
    }
    for (const p of c.plants) {
      let ok = false
      let why = null
      try {
        ok = p.run() === true
        if (!ok) why = 'the guard did not catch it'
      } catch (e) {
        why = `threw: ${e.message}`
      }
      results.push({ id: c.id, what: p.what, ok, why })
    }
  }
  return results
}

/**
 * Tier 2 — resolve each declared corpus against what this checkout has. A declaration whose `needs`
 * are not met is reported as **skipped, by name**, never as resolved and never as empty (`D874`).
 */
export function resolve(rec, corpora = CORPORA) {
  if (!rec) return null
  return corpora.map((c) => {
    const missing = (c.needs ?? []).filter((n) => rec[n] == null)
    if (missing.length)
      return { id: c.id, subject: c.subject, skipped: `needs ${missing.join(' + ')}, absent from this checkout` }
    try {
      const { units, describe } = c.resolve(rec)
      return { id: c.id, subject: c.subject, units, describe, ok: units > 0 }
    } catch (e) {
      return { id: c.id, subject: c.subject, units: 0, describe: `threw: ${e.message}`, ok: false }
    }
  })
}

function main() {
  const planted = plants()
  const failed = planted.filter((p) => !p.ok)
  for (const p of planted) console.log(`  ${p.ok ? '✓' : '✗'} ${p.id} — ${p.what}${p.ok ? '' : `  (${p.why})`}`)

  const rec = records()
  const resolved = resolve(rec) ?? []
  console.log('')
  for (const r of resolved) {
    console.log(`  ${r.skipped ? '·' : r.ok ? '✓' : '✗'} ${r.id}`)
    console.log(`      subject: ${r.subject}`)
    console.log(`      corpus:  ${r.skipped ? `NOT RESOLVED HERE — ${r.skipped}` : r.describe}`)
  }

  const skipped = resolved.filter((r) => r.skipped)
  const empty = resolved.filter((r) => !r.skipped && !r.ok)
  if (failed.length || empty.length) {
    console.error('')
    if (failed.length) console.error(`✗ corpora: ${failed.length} plant(s) did not land`)
    if (empty.length) console.error(`✗ corpora: ${empty.length} declared corpus/corpora resolved empty`)
    console.error('')
    console.error('  A plant that does not land means the declared corpus and the code that reads it')
    console.error('  have come apart — which is the defect this gate exists for, arriving in the one')
    console.error('  place it can still be seen before a green check hides it.')
    process.exit(1)
  }

  const done = resolved.length - skipped.length
  console.log('')
  console.log(
    `✓ corpora: ${CORPORA.length} declaration(s), ${planted.length} plant(s) landed` +
      (done ? `, ${done} corpus/corpora resolved non-empty` : ''),
  )
  // `D874`. Never silent about what did not run: the records are gitignored, so on a CI checkout
  // the declarations that need them have no subject — and they are named, one line each, rather
  // than folded into a single sentence about the whole tier. Which declarations were skipped is the
  // fact a reader needs; that *some* were is the fact a green line would otherwise imply away.
  for (const r of skipped) console.log(`  · ${r.id} — ${r.skipped}`)
  if (skipped.length && !existsSync(LEDGER))
    console.log(`      (${LEDGER} is not in this checkout)`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
