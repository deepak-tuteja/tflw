#!/usr/bin/env node
// `M172e` — a check-phase diagnostic code cannot merge here and redden the sibling silently.
//
// ## The asymmetry this exists to end (`M155-02`)
//
// `testFlow-tests` demands a fixture for every check-phase `TF0xx` code the installed tflw assigns.
// That rule is real, documented, and enforced — in the repository that gets broken. Assign a code
// here, pass every gate here, merge, and the sibling's `main` goes red on its next run. Measured,
// not inferred: `M165` assigned `TF081` and merged as `cb42cce` at 17:26 UTC on 2026-08-30 with
// 23/23 green; the next PR to run over there failed `regression (safety)` on a code it had never
// heard of, and the `M165` closeout scored itself complete. The author of the breaking commit is
// never the one who sees the red, which is the finding the row files rather than the breakage.
//
// This gate reads the same fact one step earlier, on this side, before the merge.
//
// ## What it compares, and why each half comes from where it does
//
// **Assigned** is read from `packages/lang/dist/index.js` — the built bundle, not `spec-data.ts`
// (`D891`).
// That is deliberate symmetry: the sibling's `assignedCodes()` reads tflw's *published bundle*,
// because the bundle is what a user installs. A gate here that read the TypeScript source could
// disagree with the sibling about what tflw assigns while both were right about their own input.
// The bundle being older than the source is a different defect, and `verify:lang-build` (`M172d`)
// is what refuses it — so this gate may assume the two agree and does not re-check it.
//
// **Covered** is read from `scripts/sibling-citations.json`'s `checkFixtures`, which
// `refresh-sibling-citations.mjs` lifts out of the sibling's generated
// `scripts/check-fixture-coverage.json` at a pinned ref (`D709`/`D710`). The sibling *publishes*
// that set rather than this repository parsing it out of the sibling's source (`D889`), and what it
// publishes is what its fixture tables declare rather than what a run witnessed, because the
// stronger set depends on which tflw is installed (`D890`). A pin rather than a
// checkout, for `D710`'s reason unchanged: nothing in this repository's CI has ever checked out
// the sibling, and adding it would make `D511`'s accepted red window bidirectional.
//
// ## What it deliberately does not check
//
// A code in the pin that this repository does not assign, and a fixture the sibling *removed* since
// the pin was taken, are both invisible here — on purpose. The first is the sibling's `stale`
// assertion and the second is its `completeness` one, and both run over there against its real
// tree rather than against a snapshot. Re-implementing them here would put this repository in the
// business of grading fixtures it cannot see, and would go wrong in the direction that matters:
// a pin is a snapshot, so a *removal* is unobservable from a pin by construction. The claim this
// gate makes is exactly the one a pin can support — **at the pinned ref, the sibling had a fixture
// for every check-phase code this build assigns** — and the failure it prevents is the one that
// travels in this direction, an addition here.
//
// ## Why it is green the day it lands, and why that is not a reason to delete it
//
// The sibling's three completeness assertions together force its covered set to equal tflw's
// check-phase set whenever its `main` is green: nothing uncovered, nothing stale, nothing misfiled.
// Measured at `542f0e9`: 69 codes on both sides, identical. So this gate has never had anything to
// say and will not until the 70th code is assigned — which is the entire point, and is the shape
// (`M141`) of a guard someone tidies away because it has never fired. It fires on exactly one
// event, and that event is a merge the sibling's own CONTRIBUTING.md records happening three times
// before `M165` did it again.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export const PIN = 'scripts/sibling-citations.json'
export const BUNDLE = 'packages/lang/dist/index.js'
/** The sibling's own name for the file the pin's `checkFixtures` is lifted from, for the message. */
export const SIBLING_SOURCE = 'scripts/check-fixture-coverage.json'

/**
 * The check-phase codes a diagnostic manifest assigns.
 *
 * `D806d` derives the phase from the row's evidence rather than storing it beside it: a row whose
 * evidence is a `runtime` test is a `run` code and everything else is decided by `tflw check`. The
 * same derivation, read the same way, is what the sibling gets from `tflw spec --json`.
 */
export function checkCodes(diagnostics) {
  return diagnostics.filter((d) => !d.runtime).map((d) => d.code).sort()
}

/**
 * `null` when every assigned check-phase code is covered, otherwise the sentence to print.
 *
 * ABSENT COVERAGE IS A FAILURE, NOT A SKIP (`D880`). A pin with no `checkFixtures` — an old pin, a
 * hand-edit, a refresh against a ref predating the sibling's half of this milestone — is the state
 * where this gate has nothing to compare, and a guard that goes quiet when the thing it guards is
 * missing is the defect `M172d` planted a mutation for one stage ago. It is also the *likeliest*
 * state to arrive by accident, because it needs no code change at all.
 */
export function problem(assigned, covered) {
  // Split out so the refusal is one line and can be mutated back to the silence it refuses. An
  // empty array is the same state as an absent field on purpose: a pin that covers nothing is not
  // a pin that agrees with everything, it is a pin nobody filled in.
  const unknown = !Array.isArray(covered) || covered.length === 0
  if (unknown) return coverageUnknown()
  const have = new Set(covered)
  const missing = assigned.filter((c) => !have.has(c))
  if (missing.length === 0) return null
  return (
    `${missing.join(', ')} ${missing.length === 1 ? 'is a check-phase diagnostic' : 'are check-phase diagnostics'} this build assigns,\n` +
    `  and the sibling pinned in \`${PIN}\` has no fixture for ${missing.length === 1 ? 'it' : 'them'}.\n` +
    `  Merging this would leave testFlow-tests' \`main\` red — its \`verify-check-diagnostics.mjs\` demands a\n` +
    `  fixture for every check-phase code the installed tflw assigns, and there is no additive path.\n` +
    `  The two repositories are one unit of work here (D511, tflw merges first):\n` +
    `    1. add the fixture in testFlow-tests (tests/.checkonly/ or CONFIG_FIXTURES), on a branch;\n` +
    `    2. regenerate its published set there:  npm run refresh:check-coverage\n` +
    `    3. re-pin from that branch, here:       node scripts/refresh-sibling-citations.mjs --ref <branch>\n` +
    `    4. merge this repository, then the sibling, then re-pin to \`main\` — the second step is the\n` +
    `       one 1bf108f skipped, and \`M172-01\` is the row that records what it cost.`
  )
}

/**
 * The built manifest, read the way the sibling reads it — from the bundle a user would install,
 * not from `spec-data.ts`. Loaded once, at import, because `verify-corpora.mjs` resolves a corpus
 * synchronously and the bundle is ESM: there is no synchronous read of it, so the await belongs at
 * the top of the module rather than inside a function that cannot have one.
 *
 * `null` when the bundle is absent, so the failure is stated by whoever asks rather than thrown out
 * of an import and blamed on the importer.
 */
const DIAGNOSTICS = await import(new URL(`../${BUNDLE}`, import.meta.url).href)
  .then((m) => m.DIAGNOSTICS)
  .catch(() => null)

/** The `D880` sentence, kept whole so `problem`'s refusal of an unreadable pin is one statement. */
function coverageUnknown() {
  return (
    `\`${PIN}\` carries no \`checkFixtures\`, so what the sibling has a fixture for is unknown.\n` +
    `  This is not a green state: it is the comparison not running. Re-pin against a ref that\n` +
    `  carries the sibling's \`${SIBLING_SOURCE}\`:\n` +
    `      node scripts/refresh-sibling-citations.mjs --ref main`
  )
}

export const CORPORA = [
  {
    id: 'verify-check-coverage/assigned-check-codes',
    subject: "every `phase: check` diagnostic code the built `@tflw/lang` bundle assigns, against what the pinned sibling has a fixture for",
    needs: ['root'],
    resolve: () => {
      if (DIAGNOSTICS === null) {
        throw new Error(
          `\`${BUNDLE}\` is not built, so the corpus this guard reads cannot be resolved.\n` +
          `  Absent is a failure and not a skip here, for M172d's reason (\`D886\`): \`dist/\` is gitignored, so a\n` +
          `  tree without it fails to resolve \`@tflw/lang\` at 61 import sites already. Run: npm run build -w @tflw/lang`,
        )
      }
      const n = checkCodes(DIAGNOSTICS).length
      return { units: n, describe: `${n} check-phase diagnostic code(s) in \`${BUNDLE}\`` }
    },
    plants: [
      {
        what: 'a code the pin does not cover is reported by name',
        run: () => {
          const why = problem(['TF001', 'TF082'], ['TF001'])
          return why !== null && why.includes('TF082') && !why.includes('TF001,')
        },
      },
      {
        what: 'the phase split is read off the evidence, so a `runtime` row is not demanded of the sibling',
        run: () => {
          const codes = checkCodes([
            { code: 'TF001', probes: [{}] },
            { code: 'TF079', runtime: { as: 'a dialog nobody consumed' } },
          ])
          return codes.length === 1 && codes[0] === 'TF001'
        },
      },
      {
        what: 'an absent `checkFixtures` fails rather than passing quietly (D880)',
        run: () => {
          const why = problem(['TF001'], undefined)
          return why !== null && why.includes('carries no `checkFixtures`')
        },
      },
      {
        what: 'an EMPTY `checkFixtures` is the same failure as an absent one — a pin that covers nothing is not a pin that agrees',
        run: () => problem(['TF001'], []) !== null,
      },
      {
        what: 'the message names the four-step cross-repository order, which is the whole of what a reader has to do',
        run: () => {
          const why = problem(['TF082'], ['TF001'])
          return why.includes('refresh:check-coverage') && why.includes('D511') && why.includes('--ref <branch>')
        },
      },
      {
        what: 'NEGATIVE CONTROL — a pin covering every assigned code says nothing at all',
        run: () => problem(['TF001', 'TF002'], ['TF001', 'TF002']) === null,
      },
      {
        what: 'NEGATIVE CONTROL — a pin covering MORE than this build assigns is silent, because a retired code is the sibling\'s own `stale` assertion and not readable from a snapshot',
        run: () => problem(['TF001'], ['TF001', 'TF002', 'TF003']) === null,
      },
    ],
  },
]

export function readPin(root = ROOT) {
  return JSON.parse(readFileSync(join(root, PIN), 'utf8'))
}

function main() {
  const assigned = checkCodes(DIAGNOSTICS)
  const pin = readPin()
  const why = problem(assigned, pin.checkFixtures)
  if (why === null) {
    console.log(
      `✓ all ${assigned.length} check-phase diagnostic code(s) have a fixture in ` +
        `${pin.repo}@${String(pin.sha).slice(0, 7)} (${pin.ref})`,
    )
    return 0
  }
  console.error(`✗ ${why}`)
  return 1
}

if (process.argv[1] && process.argv[1].endsWith('verify-check-coverage.mjs')) process.exit(main())
