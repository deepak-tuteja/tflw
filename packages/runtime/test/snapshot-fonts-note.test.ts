// `M243-15` — a same-key mismatch names the cause the platform key cannot rule out.
//
// The key is OS + engine + browser build; the fonts are not in it, so a baseline cut on Fedora meets
// Ubuntu under one key and a page with text fails on its dimensions. The message used to offer only
// `--update-snapshots`, which accepts the second machine's picture and reddens the first. Driven
// through `evaluateSnapshot` directly with two hand-made PNGs, so no browser and no fonts are needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { evaluateSnapshot, snapshotPaths } from '../src/snapshot.js';

const KEY = 'linux-chromium-151.0.7922.34';

function png(width: number, height: number, red: number): Buffer {
  const img = new PNG({ width, height });
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = red;
    img.data[i + 3] = 255;
  }
  return PNG.sync.write(img);
}

async function against(baseline: Buffer, actual: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-fonts-note-'));
  try {
    const paths = snapshotPaths(dir, 'tests/t.tflw', 't', 'shot');
    await evaluateSnapshot(paths, 'shot', baseline, KEY, true, false);
    return (await evaluateSnapshot(paths, 'shot', actual, KEY, false, false)).message;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('dimensions that differ under one key name the fonts and the baseline key', async () => {
  const message = await against(png(20, 12, 0), png(20, 10, 0));
  assert.match(message, /dimensions differ \(baseline 20x12, actual 20x10\)/);
  assert.match(message, /different fonts/);
  assert.ok(message.includes(`\`${KEY}\``), message);
});

test('pixels that differ under one key say the same', async () => {
  const message = await against(png(8, 8, 0), png(8, 8, 255));
  assert.match(message, /does not match baseline.*px.*%.*--update-snapshots.*different fonts/);
});

test('a match says nothing about fonts — the note is for a failure only', async () => {
  const message = await against(png(8, 8, 0), png(8, 8, 0));
  assert.doesNotMatch(message, /fonts/);
});

test('`--update-snapshots` re-records a baseline cut on another platform, and says which two', async () => {
  // Before: the platform check ran ahead of the flag, so a browser upgrade left every baseline
  // unrecordable while the refusal told the user to run exactly this flag.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-fonts-note-'));
  try {
    const paths = snapshotPaths(dir, 'tests/t.tflw', 't', 'shot');
    await evaluateSnapshot(paths, 'shot', png(8, 8, 0), 'linux-chromium-1.0', true, false);
    const refused = await evaluateSnapshot(paths, 'shot', png(8, 8, 0), KEY, false, false);
    assert.equal(refused.ok, false, 'without the flag a platform change still refuses');
    assert.match(refused.message, /not a tolerance knob/);

    const updated = await evaluateSnapshot(paths, 'shot', png(8, 8, 0), KEY, true, false);
    assert.equal(updated.ok, true);
    assert.equal(updated.updated, true);
    assert.ok(updated.message.includes(`"${KEY}" (was "linux-chromium-1.0")`), updated.message);
    assert.equal((await evaluateSnapshot(paths, 'shot', png(8, 8, 0), KEY, false, false)).message, 'snapshot "shot": matches baseline');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('`--update-snapshots` never writes from a `not matches snapshot` step — the picture meant to differ does not become the baseline', async () => {
  // Before: every write branch ignored `negated`, so a test that records a name and then asserts a
  // changed state `not matches` it ended the update run with the changed state as its baseline.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-fonts-note-'));
  try {
    const paths = snapshotPaths(dir, 'tests/t.tflw', 't', 'shot');
    await evaluateSnapshot(paths, 'shot', png(8, 8, 0), KEY, true, false);
    const negated = await evaluateSnapshot(paths, 'shot', png(8, 8, 255), KEY, true, true);
    assert.equal(negated.ok, true);
    assert.equal(negated.updated, false);
    assert.match(negated.message, /differs from baseline as expected/);
    assert.equal((await evaluateSnapshot(paths, 'shot', png(8, 8, 0), KEY, false, false)).message, 'snapshot "shot": matches baseline');
    // Nor from a negated step with nothing to compare against: there is no picture it could accept.
    const fresh = snapshotPaths(dir, 'tests/t.tflw', 't', 'fresh');
    assert.equal((await evaluateSnapshot(fresh, 'fresh', png(8, 8, 0), KEY, true, true)).updated, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
