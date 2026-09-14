// `M194` — the reading half of `npm run sweep`, testable without a box: a pulled `.sweep-out/`
// is a summary plus manifests, and what this asserts is that the verdict comes from those files
// and not from the hand-off. A summary reporting a survivor is red; a shard that exited non-zero
// is red; manifests that do not reassemble into THIS registry are red even when the box said they
// did — that last one is the check that the box swept the tree this command ran in.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { MUTATIONS, partition } from './mutate.mjs';
import { report } from './sweep.mjs';

function pulled(k, edit = (s) => s) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tflw-sweep-'));
  const shards = partition(MUTATIONS, k);
  shards.forEach((ms, i) => writeFileSync(path.join(dir, `shard-${i + 1}.json`), JSON.stringify({ shard: i + 1, of: k, registry: MUTATIONS.length, actualSeconds: 60, ids: ms.map((m) => m.id) })));
  const summary = edit({
    k,
    startedAt: '2026-09-15T00:00:00Z',
    wallSeconds: 1234,
    shards: shards.map((ms, i) => ({ shard: i + 1, exit: 0, seconds: 60, killed: ms.length, stale: 0, survivors: [] })),
    reassembled: true,
  });
  if (summary) writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const quiet = { log: () => {}, err: () => {} };
function run(dir) {
  const out = [];
  const code = report(dir, (l) => out.push(`L ${l}`), (l) => out.push(`E ${l}`));
  return { code, text: out.join('\n') };
}

test('a clean sweep is green, and says how many it killed and how long it took', () => {
  const { dir, cleanup } = pulled(3);
  try {
    const { code, text } = run(dir);
    assert.equal(code, 0, text);
    assert.match(text, /✓ sweep of \d+ mutation\(s\) in 20m34s across 3 tree\(s\): every mutation killed/);
    assert.match(text, /^L ✓ {2}shard 1\/3: \d+ killed, 0 stale, 0 survived, 1m00s, exit 0$/m);
  } finally {
    cleanup();
  }
});

test('a survivor is red, named, and the exit is 1', () => {
  const { dir, cleanup } = pulled(2, (s) => {
    s.shards[1].exit = 1;
    s.shards[1].survivors = ['some-mutation'];
    return s;
  });
  try {
    const { code, text } = run(dir);
    assert.equal(code, 1);
    assert.match(text, /SURVIVED: some-mutation/);
    assert.match(text, /NOT CLEAN/);
  } finally {
    cleanup();
  }
});

test('a stale mutation is red even when every shard exited 0 — NOT RUN is not killed', () => {
  const { dir, cleanup } = pulled(2, (s) => {
    s.shards[0].stale = 1;
    return s;
  });
  try {
    const { code, text } = run(dir);
    assert.equal(code, 1);
    assert.match(text, /1 mutation\(s\) NOT RUN/);
  } finally {
    cleanup();
  }
});

test('manifests that do not reassemble into this registry are red whatever the box said', () => {
  const { dir, cleanup } = pulled(2);
  try {
    // The box reassembled its copy; this tree's registry is what the manifests must add up to.
    // Drop one shard's manifest and the summary still says `reassembled: true`.
    rmSync(path.join(dir, 'shard-2.json'));
    const { code, text } = run(dir);
    assert.equal(code, 1);
    assert.match(text, /do not reassemble into this tree's registry/);
    assert.match(text, /shard 2 of 2 never reported/);
  } finally {
    cleanup();
  }
});

test('no summary at all is a 2, not a pass', () => {
  const { dir, cleanup } = pulled(2, () => null);
  try {
    assert.equal(report(dir, quiet.log, quiet.err), 2);
  } finally {
    cleanup();
  }
});
