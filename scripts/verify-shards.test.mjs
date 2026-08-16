// M127 (`M126-01`) — the check that says the shards added up, tested.
//
// `verify-shards.mjs` exists because `partition()`'s own guard runs inside one process and the
// thing most likely to go wrong lives between processes: the workflow's matrix and the `/n` in the
// command are two numbers with nothing holding them together. So the failure this file cares most
// about is the quiet one — five shards of six, all green, thirty mutations never applied — and the
// tests are written against that rather than against malformed input.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MUTATIONS, partition } from './mutate.mjs';
import { checkManifests, findManifests } from './verify-shards.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'verify-shards.mjs');

/** The manifests a correct six-way run of *this* registry would leave behind — built by the same
 *  `partition()` CI uses, so the round trip is the real one rather than a hand-written stand-in. */
function realManifests(n = 6) {
  return partition(MUTATIONS, n).map((shard, i) => ({
    shard: i + 1,
    of: n,
    registry: MUTATIONS.length,
    ids: shard.map((m) => m.id),
  }));
}

test('a complete set of shards reassembles into exactly the registry', () => {
  assert.deepEqual(checkManifests(realManifests()), []);
  assert.deepEqual(checkManifests(realManifests(1)), []);
  assert.deepEqual(checkManifests(realManifests(11), undefined, 11), []);
});

test('a shard that never reported is named, and the others passing does not cover for it', () => {
  // The failure this file was written for. Every surviving manifest is telling the truth.
  const manifests = realManifests().filter((m) => m.shard !== 4);
  const problems = checkManifests(manifests);
  assert.equal(problems.length, 2, problems.join('\n'));
  assert.match(problems[0], /shard 4 of 6 never reported/);
  assert.match(problems[0], /The other 5 passing says nothing about the mutations that shard was holding/);
  assert.match(problems[1], /mutation\(s\) were run by no shard/);
});

test('no manifests at all is a failure, not an empty success', () => {
  const problems = checkManifests([]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /an empty directory is not evidence of a sweep/);
});

test('overlapping shards are refused — a split that double-runs is not a partition', () => {
  const manifests = realManifests();
  manifests[0].ids.push(manifests[1].ids[0]);
  const problems = checkManifests(manifests);
  assert.match(problems[0], /was run by both shard 2 and shard 1|was run by both shard 1 and shard 2/);
});

test('a mutation that no shard ran is named even when every shard reported', () => {
  // The subtler sibling of a missing shard: all six manifests arrive, and one is short. A shard
  // that crashed after its first mutation and still wrote its manifest looks like this.
  const manifests = realManifests();
  const dropped = manifests[2].ids.splice(0, 3);
  const problems = checkManifests(manifests);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /3 of \d+ mutation\(s\) were run by no shard/);
  for (const id of dropped) assert.ok(problems[0].includes(id), `${id} was dropped but not named`);
});

test('manifests that disagree about the shard count are refused', () => {
  const manifests = realManifests();
  manifests[5].of = 7;
  const problems = checkManifests(manifests);
  assert.match(problems[0], /disagree about how many shards there are: 6, 7/);
});

test('--of is cross-checked against what the shards say, so a stale workflow is caught', () => {
  const problems = checkManifests(realManifests(6), undefined, 8);
  assert.match(problems[0], /the shards say they are 6 of a set, and --of=8 says 8/);
});

test('manifests from another revision are refused rather than counted', () => {
  // Both directions: an id this registry does not have, and a registry size that disagrees.
  const extra = realManifests();
  extra[0].ids.push('a-mutation-from-another-branch');
  assert.match(checkManifests(extra).join('\n'), /came back that this registry does not contain/);

  const resized = realManifests();
  resized[0].registry = 999;
  assert.match(checkManifests(resized).join('\n'), /ran against a registry of 999 mutation\(s\)/);
});

test('manifests are found however the artifact download nests them', () => {
  // `actions/download-artifact` without a name puts each artifact in a directory of its own, so the
  // layout this reads is never flat. A finder that only looked at the top level would find nothing
  // and — before the empty-set check above — would have called that success.
  const dir = mkdtempSync(path.join(tmpdir(), 'tflw-shards-'));
  try {
    for (const m of realManifests()) {
      const sub = path.join(dir, `mutation-shard-${m.shard}`);
      mkdirSync(sub, { recursive: true });
      writeFileSync(path.join(sub, `shard-${m.shard}.json`), JSON.stringify(m));
    }
    writeFileSync(path.join(dir, 'not-a-manifest.txt'), 'ignored');
    const found = findManifests(dir);
    assert.equal(found.length, 6);
    const parsed = found.map((f) => JSON.parse(readFileSync(f, 'utf8')));
    assert.deepEqual(checkManifests(parsed), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the CLI exits 0 on a complete set and 2 on a short one, and says which', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tflw-shards-'));
  try {
    for (const m of realManifests()) writeFileSync(path.join(dir, `shard-${m.shard}.json`), JSON.stringify(m));
    const ok = spawnSync(process.execPath, [SCRIPT, dir, '--of=6'], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, new RegExp(`6 shard\\(s\\) reassemble into the whole registry: ${MUTATIONS.length} of ${MUTATIONS.length}`));

    rmSync(path.join(dir, 'shard-3.json'));
    const short = spawnSync(process.execPath, [SCRIPT, dir, '--of=6'], { encoding: 'utf8' });
    assert.equal(short.status, 2);
    assert.match(short.stderr, /shard 3 of 6 never reported/);
    assert.match(short.stderr, /Every mutation runs on every pull request \(M114\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing artifact directory fails the check rather than passing it', () => {
  const r = spawnSync(process.execPath, [SCRIPT, path.join(tmpdir(), 'tflw-no-such-shard-dir')], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot read/);
  assert.match(r.stderr, /not a reason to pass/);
});

// M137a (`D449`) — the three copies of the shard count in `ci.yml`, held to each other statically.
//
// This file's own header names the hazard: *"the workflow's matrix and the `/n` in the command are
// two numbers with nothing holding them together"*. `D449`'s re-shard proved the count is written
// three times, not two — `shard:`, `--shard=i/n`, and `mutation-controls`' `--of=n` — by widening
// the first two to 12 and leaving the third at 6. All twelve shards passed and the reassembly job
// failed, which is `verify-shards.mjs` doing exactly its job.
//
// So why add this. That catch cost a full CI round trip: twelve sweeps, ~14 minutes of the longest
// shard, and a red run whose failure is three jobs away from the line that caused it. Nothing about
// the mismatch needs a mutation sweep to detect — it is two integers in one file. The runtime check
// stays, because it is the only thing that can see a shard that *never reported*; this one just
// moves the cheapest half of its work to the front, where a re-shard is being typed.
test('ci.yml writes the same shard count in all three places (D449)', () => {
  const ci = readFileSync(path.join(HERE, '..', '.github', 'workflows', 'ci.yml'), 'utf8');

  const matrix = ci.match(/^\s*shard: \[([^\]]+)\]/m);
  assert.ok(matrix, 'ci.yml no longer has a `shard:` matrix — if the sweep was restructured, retarget this test rather than deleting it');
  const matrixCount = matrix[1].split(',').length;

  const perShard = [...ci.matchAll(/--shard=\$\{\{ matrix\.shard \}\}\/(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(perShard.length > 0, 'ci.yml no longer passes --shard=i/n to mutate.mjs');

  const of = [...ci.matchAll(/verify-shards\.mjs \S+ --of=(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(of.length > 0, 'ci.yml no longer passes --of=n to verify-shards.mjs');

  for (const n of [...perShard, ...of]) {
    assert.equal(
      n,
      matrixCount,
      `ci.yml's shard count disagrees with itself: the matrix lists ${matrixCount} shards, and another copy says ${n}. Every shard will pass and the registry will be under-applied, or the reassembly job will fail after a full sweep. All three copies move together.`,
    );
  }
});
