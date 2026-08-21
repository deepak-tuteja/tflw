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

import { MUTATIONS, RESHARD_AT, SHARD_BUDGET_SECONDS, partition } from './mutate.mjs';
import { checkManifests, checkShardCost, findManifests } from './verify-shards.mjs';

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

  // M148 — a FOURTH copy, found by moving the other three. The job's display name carries the count
  // too, and it is the only one a reader sees: `mutation controls (shard 3/12)` sitting in the
  // checks list of a run that dealt eighteen ways is a job lying about its own scope, in a repo that
  // has spent four milestones on reports that describe something other than what ran. It cannot
  // under-apply the registry, so it is here rather than in a job — cheap, static, and it moves with
  // the rest.
  const named = [...ci.matchAll(/name: mutation controls \(shard \$\{\{ matrix\.shard \}\}\/(\d+)\)/g)].map((m) => Number(m[1]));
  assert.ok(named.length > 0, "ci.yml no longer names the shard job `mutation controls (shard i/n)`");

  for (const n of [...perShard, ...of, ...named]) {
    assert.equal(
      n,
      matrixCount,
      `ci.yml's shard count disagrees with itself: the matrix lists ${matrixCount} shards, and another copy says ${n}. Every shard will pass and the registry will be under-applied, or the reassembly job will fail after a full sweep. All three copies move together.`,
    );
  }
});

// ---------------------------------------------------------------------------
// M148 (`M147-11`) — the cost half.

test('SHARD_BUDGET_SECONDS is the shard job\'s timeout-minutes, in seconds', () => {
  const ci = readFileSync(path.join(HERE, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  const job = ci.slice(ci.indexOf('\n  mutations:'));
  const m = job.match(/^\s*timeout-minutes: (\d+)/m);
  assert.ok(m, 'the mutations job no longer declares timeout-minutes');
  assert.equal(
    SHARD_BUDGET_SECONDS,
    Number(m[1]) * 60,
    `mutate.mjs budgets a shard at ${SHARD_BUDGET_SECONDS}s and ci.yml gives it ${Number(m[1]) * 60}s. The re-shard trigger is a fraction of the limit, so a wrong limit moves the trigger and the check goes quiet at exactly the wrong moment.`,
  );
});

test('a shard past the re-shard trigger fails, and one under it does not', () => {
  const trigger = SHARD_BUDGET_SECONDS * RESHARD_AT;
  const under = checkShardCost([{ shard: 1, of: 2, actualSeconds: Math.floor(trigger) - 1, costs: {} }]);
  assert.deepEqual(under.problems, [], 'a shard just under the trigger is not a problem');

  const over = checkShardCost([{ shard: 1, of: 2, actualSeconds: Math.ceil(trigger) + 1, costs: {} }]);
  assert.equal(over.problems.length, 1);
  assert.match(over.problems[0], /re-shard trigger/);
  assert.match(over.problems[0], /shard 1\/2/);

  // The trigger is not the limit. This is the whole point of the number, and the assertion is here
  // because writing the trigger *at* the limit is the mistake `M131-06` made in prose and `M148`
  // then paid for: a check that only fires once a shard has died reports the death, not the cause.
  assert.ok(trigger < SHARD_BUDGET_SECONDS, 'the trigger must be strictly below the limit');
});

test('a SUITE_SECONDS entry that has gone light fails; one that has gone heavy is only reported', () => {
  const manifests = [{ shard: 1, of: 1, actualSeconds: 60, costs: { '@tflw/slow': 108, '@tflw/fast': 4 } }];

  // Light: this is M147-11 itself, 31 against a measured 108.
  const light = checkShardCost(manifests, { '@tflw/slow': 31, '@tflw/fast': 4 });
  assert.equal(light.problems.length, 1);
  assert.match(light.problems[0], /is 31s and its baseline measured 108s — 3\.5× light/);

  // Heavy is safe: it over-provisions. Reported so it can be corrected, never red.
  const heavy = checkShardCost(manifests, { '@tflw/slow': 300, '@tflw/fast': 4 });
  assert.deepEqual(heavy.problems, []);
  assert.equal(heavy.notes.length, 1);
  assert.match(heavy.notes[0], /heavy, so it over-provisions rather than overruns/);
});

test('a small package that doubles on noise is not a stale constant', () => {
  // `tflw-vscode` measured 1s against a table entry of 3. That is 3× and it means nothing: the
  // absolute floor is what keeps this check about shards that overrun rather than about rounding.
  const { problems, notes } = checkShardCost([{ shard: 1, of: 1, actualSeconds: 60, costs: { 'tflw-vscode': 3 } }], { 'tflw-vscode': 1 });
  assert.deepEqual(problems, [], 'a 2s absolute error is not worth a red build whatever the ratio');
  assert.deepEqual(notes, []);
});

test('a package baselined with no SUITE_SECONDS entry is a problem, not a default', () => {
  const { problems } = checkShardCost([{ shard: 1, of: 1, actualSeconds: 60, costs: { '@tflw/unpriced': 90 } }], {});
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no SUITE_SECONDS entry/);
});

test('manifests written before the cost telemetry are noted, not failed', () => {
  // The transition run. A check that goes red the first time it ships, for a reason that is not the
  // thing it checks, is a check everybody learns to click past.
  const { problems, notes } = checkShardCost([{ shard: 1, of: 1, ids: [] }]);
  assert.deepEqual(problems, []);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /predate the cost telemetry/);
});

test('a real sweep of this registry is priced by constants that would pass their own check', () => {
  // The round trip: partition by the shipped constants, pretend every shard cost exactly what the
  // model says, and assert the check is happy. It fails if a constant is edited without the model
  // being re-run — which is how the 31 survived eleven milestones.
  const n = 18;
  const manifests = partition(MUTATIONS, n).map((shard, i) => ({
    shard: i + 1,
    of: n,
    registry: MUTATIONS.length,
    actualSeconds: 1,
    costs: {},
    ids: shard.map((m) => m.id),
  }));
  const { problems } = checkShardCost(manifests);
  assert.deepEqual(problems, []);
});
