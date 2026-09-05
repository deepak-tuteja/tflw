// The lang bundle is not older than the sources it was built from (`M172d`, `M165-01`, `D886`).
//
// `packages/lang/package.json` publishes `./dist/index.js`, and `node_modules/@tflw/lang` is a
// workspace symlink at the *package* root, so `import { … } from '@tflw/lang'` inside
// `packages/runtime/test/**` resolves to `packages/lang/dist/index.js` — measured through
// `createRequire(...).resolve`, not inferred. `packages/lang`'s own tests import `../src/index.js`
// and are unaffected, which is what makes this invisible: the suite that would notice is the one
// that does not read the bundle.
//
// So an edit to `packages/lang/src/**` is invisible to every `@tflw/runtime` test until somebody
// rebuilds, and **the tests go green rather than stale** — 61 import sites in that suite silently
// exercising the previous build. That is the row's complaint, and it is what this guard kills, for
// a `statSync` loop and no build.
//
// **It does not satisfy the row's first branch and does not pretend to.** A runtime test still does
// not observe lang source. `D886` declined both costs the row named — a `pretest` build (a `tsc` on
// every run of a suite usually unaffected by lang, and pure waste in CI, which already builds
// before it tests) and pointing the runtime tests at `../../lang/src/index.js` (zero cost, but they
// then exercise something CI does not ship, so an `exports`-map mistake goes invisible in exactly
// the suite that would have caught it — one silent green traded for another). This closes the
// second branch: a decision, plus a line where a contributor reads it.
//
// **Absent is a failure, not a skip** — the `D880` direction, decided on a measurement rather than
// on principle. `dist/` is gitignored, so a fresh clone has none until `npm run build`; but the
// same fact means `@tflw/lang` cannot resolve at all, and the runtime suite dies with
// `ERR_MODULE_NOT_FOUND` at 61 import sites. So the absent case is *already* loud, and the only
// thing this guard changes there is which sentence the reader gets. Skipping would have been the
// one option that made it quieter.

import { readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The built entry point every cross-workspace import of `@tflw/lang` resolves to. */
export const BUNDLE = 'packages/lang/dist/index.js'

/** The sources it is built from. */
export const SOURCE_DIR = 'packages/lang/src'

/** Every `.ts` under a directory, recursively, as repo-relative paths with their mtimes. */
export function sources(root = ROOT, dir = SOURCE_DIR) {
  const out = []
  const walk = (abs) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const p = join(abs, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.ts')) out.push({ path: relative(root, p), mtimeMs: statSync(p).mtimeMs })
    }
  }
  walk(join(root, dir))
  return out
}

/**
 * The comparison, as a pure function of two facts, so a plant can state a tree that does not exist.
 *
 * `bundleMtimeMs` is `null` when the bundle is absent — a third state, not a very old timestamp,
 * because the two produce different sentences and collapsing them would make the absent case
 * read as an ordinary staleness.
 */
export function compare(srcs, bundleMtimeMs) {
  if (bundleMtimeMs === null) return { kind: 'absent', stale: srcs.map((s) => s.path) }
  const stale = srcs.filter((s) => s.mtimeMs > bundleMtimeMs).map((s) => s.path)
  return { kind: stale.length ? 'stale' : 'fresh', stale }
}

/** What a caller should print, or `null` when there is nothing to say. */
export function problem(result, { bundle = BUNDLE, source = SOURCE_DIR, build = 'npm run build -w @tflw/lang' } = {}) {
  if (result.kind === 'fresh') return null
  if (result.kind === 'absent')
    return (
      `\`${bundle}\` does not exist, and every cross-workspace import of \`@tflw/lang\` resolves to it.\n` +
      `  Run \`${build}\` — without it the runtime suite fails at its import sites rather than here,\n` +
      `  which is the same fact told less usefully.`
    )
  const shown = result.stale.slice(0, 5)
  return (
    `${result.stale.length} file(s) under \`${source}\` are newer than \`${bundle}\`:\n` +
    shown.map((p) => `    ${p}`).join('\n') +
    (result.stale.length > shown.length ? `\n    … and ${result.stale.length - shown.length} more` : '') +
    `\n  Every \`@tflw/runtime\` test importing \`@tflw/lang\` is reading the PREVIOUS build, and will\n` +
    `  pass or fail on it without saying so (\`M165-01\`, \`D886\`). Run \`${build}\`.`
  )
}

/** `M171a`/`D867` — the corpus this guard reads, declared as data and checked by `verify:corpora`. */
export const CORPORA = [
  {
    id: 'verify-lang-build/lang-sources',
    subject: 'every TypeScript source under `packages/lang/src/**` that the published bundle is built from',
    needs: ['root'],
    resolve: ({ root }) => {
      const n = sources(root).length
      return { units: n, describe: `${n} source file(s) under \`${SOURCE_DIR}\`` }
    },
    plants: [
      {
        what: 'a source newer than the bundle is caught',
        run: () => compare([{ path: 'packages/lang/src/a.ts', mtimeMs: 200 }], 100).stale.length === 1,
      },
      {
        what: 'the newest source decides, not the first — an old file beside a new one still reports the new one only',
        run: () => {
          const r = compare(
            [
              { path: 'packages/lang/src/old.ts', mtimeMs: 50 },
              { path: 'packages/lang/src/new.ts', mtimeMs: 200 },
            ],
            100,
          )
          return r.kind === 'stale' && r.stale.length === 1 && r.stale[0] === 'packages/lang/src/new.ts'
        },
      },
      {
        what: 'an absent bundle is its own kind, not a stale one, and names every source rather than none',
        run: () => {
          const r = compare([{ path: 'packages/lang/src/a.ts', mtimeMs: 1 }], null)
          return r.kind === 'absent' && r.stale.length === 1 && problem(r).includes('does not exist')
        },
      },
      {
        what: 'NEGATIVE CONTROL — a bundle newer than every source says nothing at all',
        run: () => {
          const r = compare(
            [
              { path: 'packages/lang/src/a.ts', mtimeMs: 10 },
              { path: 'packages/lang/src/b.ts', mtimeMs: 20 },
            ],
            100,
          )
          return r.kind === 'fresh' && problem(r) === null
        },
      },
      {
        what: 'NEGATIVE CONTROL — a source with the SAME mtime as the bundle is not stale, so a build that writes within the same millisecond does not accuse itself',
        run: () => compare([{ path: 'packages/lang/src/a.ts', mtimeMs: 100 }], 100).kind === 'fresh',
      },
      {
        what: 'the message names the build command, which is the only thing a reader has to do',
        run: () => problem(compare([{ path: 'packages/lang/src/a.ts', mtimeMs: 200 }], 100)).includes('npm run build -w @tflw/lang'),
      },
    ],
  },
]

/** The live reading, for a caller that wants the verdict rather than the process's exit code. */
export function check(root = ROOT) {
  let bundleMtimeMs
  try {
    bundleMtimeMs = statSync(join(root, BUNDLE)).mtimeMs
  } catch {
    bundleMtimeMs = null
  }
  return compare(sources(root), bundleMtimeMs)
}

function main() {
  const why = problem(check())
  if (why === null) {
    console.log(`✓ \`${BUNDLE}\` is not older than any source under \`${SOURCE_DIR}\``)
    return 0
  }
  console.error(`✗ ${why}`)
  return 1
}

if (process.argv[1] && process.argv[1].endsWith('verify-lang-build.mjs')) process.exit(main())
