// Test discovery — the walk a bare `tflw run` performs (`M192` U1 moved it here from `cli.ts`,
// unchanged, because `tflw ui`'s server needs the same walk and must not import the CLI entry).

import { readdir } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';

/** `exclude` (SPEC §3, D127, PLAN_DISCOVERY_EXCLUDE.md) — paths relative to `cwd` (== the
 * `tflw.config` directory, see `loadAndValidate`) that this walk skips: a directory is not
 * descended into, a `.tflw` file is not collected. Matched by exact relative-path equality at any
 * depth, not a glob (decision 5) — a no-op for a path that doesn't exist, same tolerance a
 * `.gitignore` line has for a pattern matching nothing (decision 4). Only affects this bare,
 * no-file-args walk — an explicit file arg inside an excluded path is resolved elsewhere and still
 * runs. */
export async function discoverTests(cwd: string, exclude: readonly string[] = [], reportDir?: string): Promise<string[]> {
  const found: string[] = [];
  // M137d — tflw's OWN output directory is never a source of tests, and this is a correctness fix
  // rather than tidiness. The repro emitter writes runnable `.tflw` files under `reportDir`
  // (`authz-repro/`, `input-repro/`), so without this the *next* bare `tflw run` in the same project
  // discovers them and runs them as part of the suite — and they are designed to FAIL until the bug is
  // fixed, so a run that found one weakness reports two failures, one of which is tflw's own artifact.
  //
  // **Latent since `M130b`**, not new here: `report/` starts with no dot and is not `node_modules`, so
  // authorization repros have always been discoverable this way. Nothing had triggered it because no
  // test ran twice in one directory with a finding; Tier 3's e2e does exactly that, and it turned up as
  // `FAIL 1/6 passed` where five of the six "tests" were emitted repros.
  //
  // Deliberately not folded into `exclude`: that list is the user's statement about their own tree, it
  // is echoed back in diagnostics, and a path the user never wrote does not belong in it.
  const skipReport = reportDir === undefined ? undefined : relative(cwd, resolve(cwd, reportDir)).split('\\').join('/');
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = join(dir, e.name);
      // The equality test used to live inside the `isDirectory()` branch, so a file entry could
      // never match and `exclude "b.tflw"` was a silent no-op (M73, review finding B6-10) — while
      // §3.9 opens by calling these "paths" and a user who wants one known-broken file out of the
      // default sweep has no reason to read that as directories-only. It is checked for both kinds
      // now. Separators are normalised because `relative()` returns them platform-style, and
      // nobody writes `exclude "a\\b"` — that mismatch was the same silent no-op on Windows.
      const rel = relative(cwd, full).split('\\').join('/');
      if (exclude.includes(rel)) continue;
      // `''` would mean the report dir IS `cwd`, which cannot be skipped without discovering nothing —
      // so a project configured that way keeps the old behaviour rather than silently finding no tests.
      if (skipReport !== undefined && skipReport !== '' && rel === skipReport) continue;
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.endsWith('.tflw')) found.push(full);
    }
  };
  await walk(cwd);
  return found.sort();
}
