// Golden-file test harness (no external deps). A golden is a committed expected-output file;
// on mismatch the test fails and prints how to regenerate. Run with UPDATE_GOLDEN=1 to (re)write
// goldens after an intentional change — then review the diff. Errors and ASTs are both snapshotted
// this way (PLAN M0: "errors are a feature — snapshot them").

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Program } from '../src/index.js';

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '__golden__');

export function assertGolden(name: string, actual: string): void {
  const path = join(GOLDEN_DIR, name);
  const normalized = actual.replace(/\s+$/, '') + '\n';
  if (process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, normalized);
    return;
  }
  // A missing golden must fail loudly, not manufacture a "passing" baseline from whatever the code
  // currently does (decision 69) — a typo'd filename or a golden dropped from a commit by accident
  // would otherwise silently stop testing anything.
  if (!existsSync(path)) {
    assert.fail(`missing golden ${name} — run \`npm run test:update -w @tflw/lang\` to create it, then review the diff before committing`);
  }
  const expected = readFileSync(path, 'utf8');
  assert.equal(normalized, expected, `golden mismatch for ${name} — run \`npm run test:update -w @tflw/lang\` to accept`);
}

/** Serialise an AST to stable JSON with `span` fields stripped (structure over positions). */
export function astJson(program: Program): string {
  return JSON.stringify(program, (key, value) => (key === 'span' ? undefined : value), 2);
}
