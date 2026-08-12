#!/usr/bin/env node
// M127 (`M126-01`) — the mutation sweep runs in shards now, and this is what says they added up.
//
// WHY THIS EXISTS AT ALL, given that `partition()` already refuses to lose an entry. Because that
// guard runs *inside one process*, and the thing most likely to go wrong lives outside every
// process: the workflow's matrix is a list of numbers in YAML and the `/n` in the command is
// another, and nothing makes them agree. Delete `4` from `shard: [1, 2, 3, 4, 5, 6]` and five jobs
// run `--shard=i/6`, all five go green, the workflow goes green, and thirty mutations were never
// applied. Every one of those five jobs is telling the truth about itself.
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

import { MUTATIONS } from './mutate.mjs';

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

  const ran = manifests.reduce((a, m) => a + m.ids.length, 0);
  console.log(
    `✓ ${manifests.length} shard(s) reassemble into the whole registry: ${ran} of ${MUTATIONS.length} mutation(s), ` +
      `each run exactly once.`,
  );
  for (const m of [...manifests].sort((a, b) => a.shard - b.shard)) {
    console.log(`    shard ${m.shard}/${m.of}  ${String(m.ids.length).padStart(3)} mutation(s)`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
