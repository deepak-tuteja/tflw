// `M259` `A` — which of `examples/storefront/` is the example `tflw init --example` writes.
//
// **One source.** `examples/storefront/` stays the canonical Coffee Shelf: the docs' pictures are
// taken on it, the Action job dry-runs it, and `packages/lang/test/exampleCoverage.test.ts` holds it
// to every statement the printer can write. `bundle.mjs` copies it into `dist/example/` with this
// rule, and `init` writes whatever is there — so the shipped copy and the repository's copy cannot
// say different things, and a test compares them byte for byte with the same rule.
//
// Shared by `bundle.mjs` (which copies) and the test (which compares). `init` needs neither: it
// writes every file under `dist/example/`, which is this rule's output already.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** What stays in the repository, each with why. Matched against top-level names only. */
export const NOT_SHIPPED = new Map([
  ['report', 'what a run writes — generated, and gitignored in a project `init` makes'],
  ['run.mjs', "`npm run example`'s runner, which reaches for this repository's own `packages/cli/dist`"],
  ['README.md', "the repository's tour of the example, written in its `npm run example` commands"],
]);

/** Every file the example ships, as `/`-separated paths relative to `dir`, sorted. Dot-files are
 *  skipped at every depth: they are a run's or an editor's leftovers (`.tflw-*` scratches), never
 *  part of the shop. */
export function listExample(dir) {
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      if (name.startsWith('.')) continue;
      if (rel === '' && NOT_SHIPPED.has(name)) continue;
      const path = rel === '' ? name : `${rel}/${name}`;
      if (statSync(join(dir, path)).isDirectory()) walk(path);
      else out.push(path);
    }
  };
  walk('');
  return out;
}
