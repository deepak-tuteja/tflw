#!/usr/bin/env node
// sweep.mjs — `npm run sweep`: the whole mutation registry, on the box, K trees at once (`M194`).
//
// The runners' 33-shard matrix is gone (`PLAN_M194_BOX_SWEEP.md`): a sweep is something the
// author runs before a milestone closes, on the one machine this repository does its heavy work
// on, and its result is recorded in the milestone's plan. This is the Mac half — it hands off to
// `scripts/sweep-box.sh` through `exec.mjs` (sync, lease, display), pulls `.sweep-out/` back into
// `runs/`, and reads the summary. Nothing here runs a suite on this machine.
//
// The verdict is read from the pulled artefacts, never from `exec.mjs`'s exit: that driver's exit
// carries the wrapper's status, not the command's (`M190-03`), and a sweep whose summary says a
// shard exited non-zero is red however the hand-off returned. The manifests are reassembled a
// second time here against THIS tree's registry, which is the check that the tree the box swept is
// the tree this command was run in.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MUTATIONS } from './mutate.mjs';
import { checkManifests, findManifests } from './verify-shards.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EXEC = path.join(ROOT, 'scripts', 'exec.mjs');

function git(...args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function main(argv = process.argv.slice(2)) {
  const k = process.env.TFLW_SWEEP_K;
  if (argv.length > 0) {
    console.error('usage: npm run sweep            (TFLW_SWEEP_K=<n> for a tree count other than 8)');
    return 2;
  }

  // What is being swept is what is on disk, uncommitted edits included — `exec.mjs` syncs the
  // working tree. Said out loud rather than refused: a sweep of a dirty tree is still a sweep of
  // what will be committed, and refusing it would only move the sweep to after the commit.
  const dirty = git('status', '--porcelain', '--untracked-files=no');
  const head = git('rev-parse', '--short', 'HEAD');
  if (dirty) console.log(`sweep: the tree has uncommitted changes to tracked files — the box sweeps what is on disk, not ${head}:\n${dirty.split('\n').map((l) => `    ${l}`).join('\n')}`);
  else console.log(`sweep: tree clean at ${head}${k ? `, K=${k}` : ''}`);

  const hand = spawnSync(process.execPath, [EXEC, 'exec', '--heavy', '--', 'bash', 'scripts/sweep-box.sh'], { cwd: ROOT, stdio: 'inherit', env: process.env });
  if (hand.error) {
    console.error(`sweep: could not start exec.mjs: ${hand.error.message}`);
    return 2;
  }

  const pull = spawnSync(process.execPath, [EXEC, 'pull', '.sweep-out'], { cwd: ROOT, encoding: 'utf8', env: process.env });
  process.stdout.write(pull.stdout ?? '');
  process.stderr.write(pull.stderr ?? '');
  const dir = newestPull();
  if (!dir) {
    console.error('sweep: nothing came back from the box — no runs/*-fedora-.sweep-out/ directory. The box-side driver did not get as far as writing its output; read the hand-off above.');
    return 2;
  }
  return report(dir);
}

/** The most recent `runs/<stamp>-fedora-.sweep-out/` — `exec.mjs pull` stamps its destination. */
function newestPull() {
  const runs = path.join(ROOT, 'runs');
  if (!existsSync(runs)) return null;
  const dirs = readdirSync(runs).filter((d) => d.endsWith('-fedora-.sweep-out')).sort();
  return dirs.length ? path.join(runs, dirs[dirs.length - 1], '.sweep-out') : null;
}

/** Read a pulled sweep and say what it found. Exported so the reading is testable without a box. */
export function report(dir, log = console.log, err = console.error) {
  const summaryPath = path.join(dir, 'summary.json');
  if (!existsSync(summaryPath)) {
    err(`sweep: ${path.relative(ROOT, dir)} has no summary.json — the box-side driver died before the verdicts. Its shard logs, if any, are beside this message's path.`);
    return 2;
  }
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  let red = false;
  for (const s of summary.shards) {
    const line = `  shard ${s.shard}/${summary.k}: ${s.killed} killed, ${s.stale} stale, ${s.survivors.length} survived, ${Math.floor(s.seconds / 60)}m${String(s.seconds % 60).padStart(2, '0')}s, exit ${s.exit}`;
    if (s.exit !== 0 || s.survivors.length > 0 || s.stale > 0) {
      red = true;
      err(`✗${line}${s.survivors.length ? `\n      SURVIVED: ${s.survivors.join(', ')}` : ''}${s.stale ? `\n      ${s.stale} mutation(s) NOT RUN — the source moved and the registry did not follow (read shard-${s.shard}.log)` : ''}`);
    } else log(`✓${line}`);
  }

  // Reassembled here as well as on the box: the box checked the manifests against the registry it
  // was handed, and this checks them against the registry in this tree. They differ only if the
  // sync was of another tree, which is the one thing the box cannot know.
  let manifests;
  try {
    manifests = findManifests(dir).map((f) => JSON.parse(readFileSync(f, 'utf8')));
  } catch (e) {
    err(`✗ the pulled manifests cannot be read: ${e.message}`);
    return 2;
  }
  const problems = checkManifests(manifests, MUTATIONS.map((m) => m.id), summary.k);
  if (problems.length > 0) {
    red = true;
    err('✗ the shards do not reassemble into this tree\'s registry:');
    for (const p of problems) err(`    ${p}`);
  }
  if (summary.reassembled !== true) {
    red = true;
    err('✗ the box-side reassembly failed (read reassembly.log)');
  }

  const wall = `${Math.floor(summary.wallSeconds / 60)}m${String(summary.wallSeconds % 60).padStart(2, '0')}s`;
  if (red) {
    err(`\n✗ sweep of ${MUTATIONS.length} mutation(s) in ${wall} across ${summary.k} tree(s): NOT CLEAN — see above. Record it in the milestone's plan as what it is.`);
    return 1;
  }
  log(`\n✓ sweep of ${MUTATIONS.length} mutation(s) in ${wall} across ${summary.k} tree(s): every mutation killed, every shard reassembled. ${path.relative(ROOT, dir)}/`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
