#!/usr/bin/env node
// `M234` — per-package coverage floors, because one global average cannot see a regression.
//
// ## Why the global number stopped being enough
//
// `.c8rc.json` carried one floor — 94/88/94 — measured 2026-08-05 across six `src` directories.
// `M234` added a seventh, `packages/ui/src`, and had to: the package was already leaking into the
// report one file at a time as unit tests imported it, so the denominator was moving with no
// decision behind it and a branch that *added* tests made the number *fall*. Declaring the scope
// fixed that and made the global average meaningless in a second way — the seven packages now span
// **68.44% to 98.26%**, so a single figure is an average over populations that have nothing to do
// with each other. At 94 the run is red forever; re-pinned at ~91 it would let `@tflw/lang` shed
// seven points in silence. Neither is a gate.
//
// So the floor is per package, each pinned one point under its own measured value — `M86`'s rule
// applied per population instead of once: *"Raise it when the number rises and stays risen. Do not
// lower it to make a red run green."* A package that improves gets re-pinned upward; a package that
// slips is named, with its own number, rather than being averaged out of sight.
//
// ## Read it against the report, never instead of it
//
// This reads `coverage/lcov.info`, which c8 has already written. It computes nothing c8 did not —
// the aggregation is `LF`/`LH`, `BRF`/`BRH`, `FNF`/`FNH` summed per package — so a disagreement
// between this and the text report is a defect in this file and not a second opinion.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LCOV = join(ROOT, 'coverage', 'lcov.info');
const FLOORS = join(ROOT, 'coverage-floors.json');

/** `packages/<name>` for anything under a package, the first path segment otherwise. */
export function packageOf(file) {
  const m = /^packages\/([^/]+)\//.exec(file);
  return m ? `packages/${m[1]}` : file.split('/')[0];
}

/** Sum lcov's own counters per package. No derivation, no rounding until the end. */
export function aggregate(lcov) {
  const totals = new Map();
  let file = null;
  for (const line of lcov.split('\n')) {
    if (line.startsWith('SF:')) {
      file = line.slice(3).trim().replace(`${ROOT}/`, '');
      continue;
    }
    if (file === null) continue;
    const key = packageOf(file);
    const t = totals.get(key) ?? { lines: [0, 0], branches: [0, 0], functions: [0, 0] };
    const n = Number(line.slice(line.indexOf(':') + 1));
    if (line.startsWith('LF:')) t.lines[0] += n;
    else if (line.startsWith('LH:')) t.lines[1] += n;
    else if (line.startsWith('BRF:')) t.branches[0] += n;
    else if (line.startsWith('BRH:')) t.branches[1] += n;
    else if (line.startsWith('FNF:')) t.functions[0] += n;
    else if (line.startsWith('FNH:')) t.functions[1] += n;
    totals.set(key, t);
    if (line.startsWith('end_of_record')) file = null;
  }
  return totals;
}

const pct = ([found, hit]) => (found === 0 ? 100 : (hit / found) * 100);

export function check(totals, floors) {
  const rows = [];
  const problems = [];
  for (const [pkg, t] of [...totals].sort()) {
    const got = { lines: pct(t.lines), branches: pct(t.branches), functions: pct(t.functions) };
    const floor = floors[pkg];
    rows.push({ pkg, got, floor });
    if (floor === undefined) {
      problems.push(
        `${pkg} has coverage in the report and no floor in coverage-floors.json — a package nobody ` +
          `pinned is a package nobody is holding, which is the defect this file was written for. ` +
          `Measured now: ${got.lines.toFixed(2)}/${got.branches.toFixed(2)}/${got.functions.toFixed(2)}.`,
      );
      continue;
    }
    for (const k of ['lines', 'branches', 'functions'])
      if (got[k] < floor[k])
        problems.push(`${pkg} ${k} ${got[k].toFixed(2)}% is under its floor of ${floor[k]}%`);
  }
  // The other direction, and it is the half that keeps the floors honest (`M86`): a floor nobody
  // can reach describes a package that no longer exists under that name.
  for (const pkg of Object.keys(floors))
    if (!totals.has(pkg)) problems.push(`coverage-floors.json pins ${pkg}, which the report does not mention at all`);
  return { rows, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!existsSync(LCOV)) {
    console.error(`no coverage/lcov.info — run \`npm run coverage\` first`);
    process.exit(1);
  }
  const totals = aggregate(readFileSync(LCOV, 'utf8'));
  const floors = existsSync(FLOORS) ? JSON.parse(readFileSync(FLOORS, 'utf8')) : {};
  const { rows, problems } = check(totals, floors);
  const w = Math.max(...rows.map((r) => r.pkg.length));
  console.log(`${'package'.padEnd(w)}   lines   branch    funcs    floor (l/b/f)`);
  for (const { pkg, got, floor } of rows)
    console.log(
      `${pkg.padEnd(w)}  ${got.lines.toFixed(2).padStart(6)}  ${got.branches.toFixed(2).padStart(6)}  ` +
        `${got.functions.toFixed(2).padStart(6)}    ${floor ? `${floor.lines}/${floor.branches}/${floor.functions}` : '— unpinned —'}`,
    );
  if (problems.length > 0) {
    console.error(`\n✗ coverage floors:\n${problems.map((p) => `  · ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`\n✓ coverage floors: ${rows.length} package(s), each at or above its own pin`);
}
