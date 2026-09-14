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
// the repository does not have. `node_modules/`, `.git/`, `dist/` and `report/` are skipped.
// `.checkonly/` fixtures that are broken on purpose are expected to be refused and are listed as
// such rather than counted against the gate — a file that does not lex is not formatted, and
// those files exist to not lex.
//
//   node scripts/verify-fmt-roundtrip.mjs [--check] [root...]     default root: packages/
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, roundTrip } from '../packages/lang/dist/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const roots = argv.filter((a) => a !== '--check');
if (roots.length === 0) roots.push(path.resolve(HERE, '..', 'packages'));
const SKIP = new Set(['node_modules', '.git', 'dist', 'report']);

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (name.endsWith('.tflw')) files.push(p);
  }
};
for (const r of roots) walk(path.resolve(r));

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
const deliberate = refused.filter((r) => /\.checkonly\//.test(r));
const surprising = refused.filter((r) => !/\.checkonly\//.test(r));
for (const r of surprising) console.error(`✗ refused outside .checkonly: ${r}`);
console.log(`fmt round-trip: ${files.length} file(s) — ${files.length - refused.length - problems} round-trip${CHECK ? `, ${files.length - refused.length - unformatted} already formatted` : ''}, ${deliberate.length} refused by design (.checkonly), ${surprising.length} refused elsewhere`);
const failures = problems + unformatted + surprising.length;
if (failures > 0) {
  console.error(`✗ fmt round-trip: ${problems} round-trip problem(s), ${unformatted} unformatted file(s), ${surprising.length} unexpected refusal(s)`);
  process.exit(1);
}
console.log(`✓ fmt round-trip holds${CHECK ? ' and the tree is formatted' : ''}`);
