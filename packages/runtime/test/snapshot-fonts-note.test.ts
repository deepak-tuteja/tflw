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
