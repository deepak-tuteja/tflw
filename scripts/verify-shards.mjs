#!/usr/bin/env node
// M127 (`M126-01`) — the mutation sweep runs in shards now, and this is what says they added up.
//
// WHY THIS EXISTS AT ALL, given that `partition()` already refuses to lose an entry. Because that
// guard runs *inside one process*, and the thing most likely to go wrong lives outside every
// process: the workflow's matrix is a list of numbers in YAML and the `/n` in the command is
// another, and nothing makes them agree. Delete `4` from `shard: [1, 2, … 12]` and eleven jobs run
// `--shard=i/12`, all eleven go green, the workflow goes green, and a twelfth of the registry was
// never applied. Every one of those eleven jobs is telling the truth about itself. (The count has
// been 6 and is 12 since `M137a`/D449 — which is the point: this file never learns it, and must not.
// It reassembles what the shards say they ran, so a widen needs no edit here and a *wrong* widen is
// still caught.)
//
// So each shard writes down the ids it actually ran and this reassembles the registry from those
// files in a job of its own. It is the only place in CI that can say "the sweep covered the
// registry", and it is deliberately the *only* thing it says — verdicts are the shards' own exit
// codes, and `needs:` is what carries them.
//
// This is `M114`'s rule kept intact under sharding: every mutation still runs on every pull
// request. The rule was always about coverage rather than about running one big job, and a scoped
// sweep breaks it the same way a dropped shard would — `M122-01` is what a green run over a
// registry with a hole in it looks like from the outside, which is to say indistinguishable.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MUTATIONS, RESHARD_AT, SHARD_BUDGET_SECONDS, SUITE_SECONDS } from './mutate.mjs';

/** Every `shard-*.json` under `dir`, at any depth — `actions/download-artifact` puts each artifact
 *  in a directory of its own when it downloads them all at once, so the layout is not flat. */
export function findManifests(dir, readDir = readdirSync, stat = statSync) {
  const out = [];
  const walk = (d) => {
    for (const name of readDir(d).sort()) {
      const full = path.join(d, name);
      if (stat(full).isDirectory()) walk(full);
      else if (/^shard-.*\.json$/.test(name)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/**
 * The check itself, over already-parsed manifests. Returns a list of problems — empty means the
 * shards reassemble into exactly the registry.
 *
 * `expected` is the id list every shard together must equal. Missing ids are the failure this file
 * was written for; unexpected ids mean a manifest from a different revision got mixed in, which is
 * worth as loud a failure because it means one of these files is describing a registry that is not
 * the one under test.
 */
export function checkManifests(manifests, expected = MUTATIONS.map((m) => m.id), declaredOf) {
  const problems = [];
  if (manifests.length === 0) {
    return [
      'no shard manifests were found at all. Either no shard ran, or none of them uploaded — and an ' +
        'empty directory is not evidence of a sweep.',
    ];
  }

  const ofs = [...new Set(manifests.map((m) => m.of))];
  if (ofs.length > 1) problems.push(`the manifests disagree about how many shards there are: ${ofs.sort((a, b) => a - b).join(', ')}.`);
  const of = ofs.length === 1 ? ofs[0] : Math.max(...ofs);
  if (declaredOf !== undefined && ofs.length === 1 && of !== declaredOf) {
    problems.push(`the shards say they are ${of} of a set, and --of=${declaredOf} says ${declaredOf}. One of the two is stale.`);
  }

  const byIndex = new Map();
  for (const m of manifests) {
    if (!Number.isInteger(m.shard) || m.shard < 1 || m.shard > of) {
      problems.push(`a manifest claims to be shard ${m.shard} of ${of}, which is not a shard number.`);
      continue;
    }
    if (byIndex.has(m.shard)) problems.push(`shard ${m.shard} reported twice — two manifests, so one of them is from another run.`);
    byIndex.set(m.shard, m);
  }
  const absent = [];
  for (let i = 1; i <= of; i++) if (!byIndex.has(i)) absent.push(i);
  if (absent.length > 0) {
    problems.push(
      `shard${absent.length > 1 ? 's' : ''} ${absent.join(', ')} of ${of} never reported. ` +
        `The other ${byIndex.size} passing says nothing about the mutations ${absent.length > 1 ? 'those shards' : 'that shard'} was holding.`,
    );
  }

  const seen = new Map();
  for (const m of manifests) {
    for (const id of m.ids ?? []) {
      if (seen.has(id)) problems.push(`\`${id}\` was run by both shard ${seen.get(id)} and shard ${m.shard}; the shards overlap, so the split is not a partition.`);
      else seen.set(id, m.shard);
    }
  }

  const missing = expected.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    problems.push(
      `${missing.length} of ${expected.length} mutation(s) were run by no shard: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? `, … (+${missing.length - 8} more)` : ''}. ` +
        `A registry with a hole in it is green for the same reason a covered one is.`,
    );
  }
  const extra = [...seen.keys()].filter((id) => !expected.includes(id));
  if (extra.length > 0) {
    problems.push(`${extra.length} id(s) came back that this registry does not contain: ${extra.slice(0, 8).join(', ')}. The manifests are from a different revision.`);
  }
  for (const m of manifests) {
    if (m.registry !== undefined && m.registry !== expected.length) {
      problems.push(`shard ${m.shard} ran against a registry of ${m.registry} mutation(s); this one has ${expected.length}.`);
    }
  }
  return problems;
}

/** Minutes, for a message a human reads under time pressure. */
const mins = (s) => `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;

/**
 * A package's measured cost may exceed its `SUITE_SECONDS` entry by this much before the entry is
 * called stale — with an absolute floor, because a package whose suite runs in a second doubles on
 * runner noise alone and being wrong about it costs nothing.
 */
const COST_DRIFT = 1.5;
const COST_FLOOR_SECONDS = 15;

/**
 * M148 (`M147-11`) — the half no shard can attest to about *itself*.
 *
 * A shard knows how long it took and cannot know whether that was normal; the packer knows what it
 * modelled and never finds out what happened. Both numbers are in the manifests, so this is where
 * they meet. Two failures, in the order they bite:
 *
 * 1. **A shard reached the re-shard trigger.** Not the limit — the trigger, at two-thirds of it.
 *    A shard that has already died leaves no manifest at all and fails the reassembly check above
 *    instead, which is a worse message for the same problem and arrives one run too late.
 *
 *    This is not a threshold that was missing. `mutate.mjs` has printed `⚠ OVER BUDGET` at this
 *    exact number since `D573`, and on run 32416405841 it printed it — 25m02s against 20m, on
 *    `main`, in a job that went green, one run before shard 12 was cancelled at the limit. What was
 *    missing is an observer that is not the thing being observed. A warning from a passing job is
 *    invisible; the same fact from a *different* job, as an exit code, is not.
 * 2. **`SUITE_SECONDS` is light for some package.** This is the upstream cause of (1) and the thing
 *    that had no gate: `costProblem()` in `mutate.mjs` asserts every package *has* a measured suite
 *    time, and until now nothing asserted the measurement was still true. It had drifted 3.5× on
 *    the root suite.
 *
 * A *heavy* entry is reported and does not fail. Heavy over-provisions — it can scatter a package
 * across more shards than it needs, which costs baselines, but it can never pack a shard that
 * cannot pay for itself. Only light does that, and only light is worth a red build.
 */
export function checkShardCost(manifests, costs = SUITE_SECONDS, budget = SHARD_BUDGET_SECONDS) {
  const problems = [];
  const notes = [];
  const timed = manifests.filter((m) => Number.isFinite(m.actualSeconds));
  if (timed.length === 0) {
    // Not a failure: manifests written before M148 carry no timings, and a check that goes red on
    // the first run after it ships teaches everyone to ignore it.
    notes.push('no shard reported a duration — these manifests predate the cost telemetry, so the shard budget was not checked.');
    return { problems, notes };
  }

  const trigger = budget * RESHARD_AT;
  for (const m of [...timed].sort((a, b) => b.actualSeconds - a.actualSeconds)) {
    if (m.actualSeconds > trigger) {
      problems.push(
        `shard ${m.shard}/${m.of} took ${mins(m.actualSeconds)} of a ${mins(budget)} limit — past the ${Math.round(RESHARD_AT * 100)}% ` +
          `re-shard trigger at ${mins(trigger)}. Widen the \`shard:\` list in ci.yml; the model in mutate.mjs prices every ` +
          `count, so pick one whose longest shard is well under the trigger rather than the next number up.`,
      );
    }
  }

  const worst = new Map();
  for (const m of timed) {
    for (const [pkg, seconds] of Object.entries(m.costs ?? {})) {
      if (!(worst.get(pkg) >= seconds)) worst.set(pkg, seconds);
    }
  }
  for (const [pkg, measured] of [...worst].sort(([a], [b]) => a.localeCompare(b))) {
    const declared = costs[pkg];
    if (declared === undefined) {
      problems.push(`a shard baselined \`${pkg}\`, which has no SUITE_SECONDS entry — the packer priced it at a default it did not measure.`);
      continue;
    }
    if (measured > declared * COST_DRIFT && measured - declared >= COST_FLOOR_SECONDS) {
      problems.push(
        `SUITE_SECONDS['${pkg}'] is ${declared}s and its baseline measured ${measured}s — ${(measured / declared).toFixed(1)}× light. ` +
          `partition() packs by that number, so a light entry does not merely mispredict a shard, it decides which mutations go in it.`,
      );
    } else if (declared > measured * COST_DRIFT && declared - measured >= COST_FLOOR_SECONDS) {
      notes.push(`SUITE_SECONDS['${pkg}'] is ${declared}s against a measured ${measured}s — heavy, so it over-provisions rather than overruns. Not a failure; correct it when convenient.`);
    }
  }
  return { problems, notes };
}

function main(argv = process.argv) {
  const args = argv.slice(2);
  const dir = args.find((a) => !a.startsWith('-'));
  const ofFlag = args.find((a) => a.startsWith('--of='));
  const unknown = args.filter((a) => a.startsWith('-') && !a.startsWith('--of='));
  if (unknown.length > 0 || !dir) {
    console.error(`usage: verify-shards.mjs <directory-of-manifests> [--of=<n>]`);
    return 2;
  }
  const declaredOf = ofFlag ? Number(ofFlag.slice('--of='.length)) : undefined;

  let files;
  try {
    files = findManifests(dir);
  } catch (err) {
    console.error(`✗ cannot read ${dir}: ${err.message}`);
    console.error(`  Nothing was verified. A missing artifact directory means the shards did not upload, which is`);
    console.error(`  the failure this check exists for — not a reason to pass.`);
    return 2;
  }

  const manifests = [];
  for (const f of files) {
    try {
      manifests.push(JSON.parse(readFileSync(f, 'utf8')));
    } catch (err) {
      console.error(`✗ ${f} is not readable as a manifest: ${err.message}`);
      return 2;
    }
  }

  const problems = checkManifests(manifests, MUTATIONS.map((m) => m.id), declaredOf);
  if (problems.length > 0) {
    console.error(`✗ the mutation shards do not reassemble into this registry:`);
    for (const p of problems) console.error(`    ${p}`);
    console.error(`\n  Every mutation runs on every pull request (M114) — that rule is what these manifests measure.`);
    return 2;
  }

  // Coverage first, cost second, and both before the summary: a sweep with a hole in it is a worse
  // fact than a slow one, and printing the reassembly line above a cost failure would read as a
  // pass with a footnote.
  const { problems: costProblems, notes } = checkShardCost(manifests);
  for (const n of notes) console.log(`  · ${n}`);
  if (costProblems.length > 0) {
    console.error(`✗ the sweep reassembles, and its cost model no longer describes it:`);
    for (const p of costProblems) console.error(`    ${p}`);
    console.error(
      `\n  This is not a mutation failing. Every mutation that ran, ran correctly — the shards are simply\n` +
        `  packed by numbers that have stopped being true, and a shard that overruns \`timeout-minutes\` is\n` +
        `  reported as a sweep that never happened.`,
    );
    return 2;
  }

  const ran = manifests.reduce((a, m) => a + m.ids.length, 0);
  console.log(
    `✓ ${manifests.length} shard(s) reassemble into the whole registry: ${ran} of ${MUTATIONS.length} mutation(s), ` +
      `each run exactly once.`,
  );
  for (const m of [...manifests].sort((a, b) => a.shard - b.shard)) {
    // The two timings are printed even when they pass. A budget you can only see when it is blown
    // is how the 20m trigger went unnoticed for four milestones.
    const timing = Number.isFinite(m.actualSeconds)
      ? `  ${mins(m.actualSeconds).padStart(7)} actual  (modelled ${mins(m.modelledSeconds ?? 0)})`
      : '';
    console.log(`    shard ${m.shard}/${m.of}  ${String(m.ids.length).padStart(3)} mutation(s)${timing}`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
