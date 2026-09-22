#!/usr/bin/env node
// `M191` (`D997`) — the formatter's gate over a tree of `.tflw` files: for every file, the same
// tokens in the same order with trivia excluded, every comment equal in text and order, the
// indent/dedent structure unchanged, and a second pass changing nothing (`roundTrip` in
// `@tflw/lang`). Under `--check`, also that every file is already formatted — the CI form.
//
// Walks the filesystem rather than `git ls-files` because the tree this runs over on the build box
// is an rsync copy with no `.git` — and for the same reason the default root is `packages/`, where
// every `.tflw` this repository tracks lives, rather than the repository root: the rsync carries
// this machine's untracked scratch directories too, and a gate that walked them would grade files
// the repository does not have. That walk is `scripts/tflw-corpus.mjs` since `M232` (`D1274`) —
// it was written here and in four other places, each with its own skip list.
//
// **`.checkonly/` IS GONE FROM THIS DESCRIPTION BECAUSE IT WAS NEVER REACHABLE** (`M232-01`).
// It said such fixtures are refused by design and listed rather than counted; no such directory
// exists anywhere in this repository, and the dot-prefix rule the corpus walk applies would skip
// one if it did. Two counters that could only ever print zero, one of them printing it in the
// gate's own summary line for as long as the gate has existed.
//
//   node scripts/verify-fmt-roundtrip.mjs [--check] [root...]     default root: packages/
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, roundTrip } from '../packages/lang/dist/index.js';
import { tflwFiles } from './tflw-corpus.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const roots = argv.filter((a) => a !== '--check');
// The declared corpus (`D874`): `packages/` **and** `examples/`. It was `packages/` alone until
// `M203` `S4`, and the omission was silent in the worst way — the example project added four
// tracked `.tflw` files and this gate went on reporting the same 17 it had reported before them,
// green. A corpus expressed as one hard-coded root does not grow when the repository does, and
// nothing said so; the count only looked wrong beside a number from a different gate.
if (roots.length === 0) {
  roots.push(path.resolve(HERE, '..', 'packages'), path.resolve(HERE, '..', 'examples'));
}
const files = tflwFiles(roots.map((r) => path.resolve(r)));

let problems = 0;
let unformatted = 0;
const refused = [];
for (const f of files) {
  const rel = path.relative(process.cwd(), f);
  const src = readFileSync(f, 'utf8');
  const r = format(src);
  if (!r.ok) { refused.push(`${rel}: ${r.reason}`); continue; }
  const bad = roundTrip(src);
  if (bad.length > 0) { problems += 1; console.error(`✗ ${rel}: ${bad.join('; ')}`); }
  if (CHECK && r.formatted !== src) { unformatted += 1; console.error(`✗ ${rel}: not formatted`); }
}
/* **EVERY REFUSAL IS A FAILURE NOW** (`M232-01`). There was a `.checkonly/` exemption here — a
   file that does not lex is not formatted, and those files existed to not lex — and it had two
   independent reasons it could never fire: no such directory exists anywhere in this repository,
   and `tflwFiles` skips dot-prefixed entries, so one would not be walked if it did. A gate's
   summary line printed `0 refused by design` for its whole life, which reads like a measurement
   and was a constant. The exemption can come back the day a fixture needs it, under a name the
   corpus walk does not skip. */
for (const r of refused) console.error(`✗ refused: ${r}`);
console.log(`fmt round-trip: ${files.length} file(s) — ${files.length - refused.length - problems} round-trip${CHECK ? `, ${files.length - refused.length - unformatted} already formatted` : ''}, ${refused.length} refused`);
const failures = problems + unformatted + refused.length;
if (failures > 0) {
  console.error(`✗ fmt round-trip: ${problems} round-trip problem(s), ${unformatted} unformatted file(s), ${refused.length} refusal(s)`);
  process.exit(1);
}
console.log(`✓ fmt round-trip holds${CHECK ? ' and the tree is formatted' : ''}`);
