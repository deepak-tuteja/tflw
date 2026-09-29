// `report/runs/<id>/` — every run kept, not only the page's (`M249` `A`, `D1362`).
//
// Until `M249` a run was kept only when `tflw ui` started it: the page's server copied `report/`
// aside when its child exited. A run from the terminal, from CI or from `tflw watch` overwrote the
// previous one, so the only history there was, was a history of clicks. `tflw run` now keeps its
// own run the same way, into the same layout, so one reader (`history.ts`, the page's report list)
// serves every run however it was started — and the page's server stopped copying, because a
// second copy of the same run would be a second entry in every history.
//
// **What is copied is what the run wrote**: the four members every run writes and the conditional
// ones it wrote this time (`RUN_OWNED_CONDITIONAL_MEMBERS`). Not "every entry but `runs/`", which is
// what the page's copy did — a file the user keeps in `report/` is not part of a run, and copying it
// twenty times is how a notes file becomes twenty notes files.
//
// Ids are the run's `startedAt` with `:` and `.` replaced, so a directory listing sorts in time
// order and pruning is "drop the smallest names". A second run in the same millisecond gets `-2`.

import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { RUN_OWNED_CONDITIONAL_MEMBERS } from './report-dir.js';
import { ARTIFACT_CONTRACT } from './artifact-contract.js';

/** The members every run writes, beside the conditional ones. */
export const RUN_OWNED_MEMBERS = ['report.html', 'junit.xml', 'results.json', '.last-run.json'] as const;

/** The kept runs' directory — named in the artifact contract (`report.keptRuns`), which the sibling reads. */
export const RUNS_DIR = ARTIFACT_CONTRACT.report.keptRuns;

/** `2026-09-29T10:00:00.123Z` → `2026-09-29T10-00-00-123Z`, the page server's id since `D1317`. */
export function runIdFor(startedAt: string): string {
  return startedAt.replace(/[:.]/g, '-');
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export interface KeptRun {
  readonly id: string;
  /** Relative to the report directory: `runs/<id>`. */
  readonly dir: string;
  /** Kept runs removed to stay within `keep`, oldest first. */
  readonly pruned: readonly string[];
}

/**
 * Copy the run just written into `report/runs/<id>/` and prune to the newest `keep`. `id` is the
 * caller's when it has one (the page's server names its runs before they start), else derived from
 * `startedAt`. `keep < 1` keeps nothing and prunes nothing — the history is left as it was.
 */
export async function keepRun(reportDir: string, opts: { readonly startedAt: string; readonly keep: number; readonly id?: string }): Promise<KeptRun | null> {
  if (opts.keep < 1) return null;
  const root = resolve(reportDir);
  const runsRoot = join(root, RUNS_DIR);
  const base = opts.id ?? runIdFor(opts.startedAt);
  let id = base;
  for (let n = 2; await exists(join(runsRoot, id)); n++) id = `${base}-${n}`;
  const dest = join(runsRoot, id);
  await mkdir(dest, { recursive: true });
  for (const member of [...RUN_OWNED_MEMBERS, ...RUN_OWNED_CONDITIONAL_MEMBERS]) {
    const name = member.replace(/\/$/, '');
    if (await exists(join(root, name))) await cp(join(root, name), join(dest, name), { recursive: true });
  }
  const pruned = await pruneRuns(root, opts.keep);
  return { id, dir: `${RUNS_DIR}/${id}`, pruned };
}

/** Remove the oldest kept runs beyond `keep`. Only directories count, so a stray file is left. */
export async function pruneRuns(reportDir: string, keep: number): Promise<string[]> {
  const runsRoot = join(resolve(reportDir), RUNS_DIR);
  let ids: string[];
  try {
    ids = (await readdir(runsRoot, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
  const drop = ids.slice(0, Math.max(0, ids.length - keep));
  for (const id of drop) await rm(join(runsRoot, id), { recursive: true, force: true });
  return drop;
}

/** Kept run ids, newest first. */
export async function listKeptRuns(reportDir: string): Promise<string[]> {
  try {
    return (await readdir(join(resolve(reportDir), RUNS_DIR), { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** `report/.running.json` — `M250` `G15` (`D1392`): `{ pid, id, startedAt, files }` while a run
 *  started from a shell is in flight, so `tflw ui` can follow it. `tflw run` writes it and removes
 *  it once the run is kept; the page ignores one whose process is gone. */
export const RUNNING_MARKER = '.running.json';
/** `report/.running.ndjson` — that run's events so far, one redacted JSON line each, file-tagged
 *  as `--format ndjson` prints them. Removed with the marker. */
export const RUNNING_EVENTS = '.running.ndjson';
