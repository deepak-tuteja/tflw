// The members of `report/` a run owns and does not always write (`M192b`, closing `M192-03`).
//
// `results.json`, `report.html`, `junit.xml` and `.last-run.json` are written by every run, so
// every run overwrites them. The members below are written only when the run has something for
// them — `findings.sarif` when a security assertion ran (D404), `events.ndjson` under `--format
// ndjson` (D111.4), `assets/` when a screenshot or trace was kept, the two repro directories when
// a scan produced subjects (D332) — and until this file none of them was removed by a run that did
// not produce it. On 2026-09-14 a two-file run left `report/` holding a `findings.sarif` from the
// whole-corpus scan before it, listed by `tflw ui` among that run's files; a CI step that uploads
// it would have re-reported the earlier run's findings as this one's. A run owns the directory
// whole: what is present after it is what it wrote. `runs/` is not in the list — it is where the
// page keeps earlier runs, each in a directory of its own — and neither is anything a user put
// there: only these names, only what a run of tflw writes.

import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AUTHZ_REPRO_DIR, INPUT_REPRO_DIR } from './repro.js';

/** Relative to the report directory. A directory entry ends in `/`. */
export const RUN_OWNED_CONDITIONAL_MEMBERS = ['findings.sarif', 'events.ndjson', 'assets/', `${AUTHZ_REPRO_DIR}/`, `${INPUT_REPRO_DIR}/`] as const;

/** Remove every conditional member a previous run may have left, so the run about to write owns
 *  the directory whole. Absent members are not an error; a missing `report/` is not one either. */
export async function clearRunOwnedMembers(dir: string): Promise<void> {
  const root = resolve(dir);
  for (const member of RUN_OWNED_CONDITIONAL_MEMBERS) {
    await rm(join(root, member.replace(/\/$/, '')), { recursive: true, force: true });
  }
}
