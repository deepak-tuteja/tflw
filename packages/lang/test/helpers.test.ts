// Decision 69: `assertGolden` must fail loudly when a referenced golden file is missing, not
// silently manufacture a "passing" baseline from whatever the code currently produces.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertGolden } from './helpers.js';

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '__golden__');

test('a missing golden fails the test instead of silently being created, when UPDATE_GOLDEN is unset', () => {
  const name = 'decision-69-never-created/missing.json';
  const path = join(GOLDEN_DIR, name);
  const prev = process.env.UPDATE_GOLDEN;
  delete process.env.UPDATE_GOLDEN;
  try {
    assert.throws(() => assertGolden(name, 'anything'), /missing golden/);
    assert.equal(existsSync(path), false, 'a missing golden must not be silently written as a new baseline');
  } finally {
    if (prev === undefined) delete process.env.UPDATE_GOLDEN;
    else process.env.UPDATE_GOLDEN = prev;
  }
});
