// `expect body bytes matches file "<path>"` (gap #17, TFLW-GAPS.md) — byte-for-byte comparison
// against a file on disk. Mirrors `contract.ts`'s dedicated-module precedent for
// `evaluateSchemaMatch`: kept out of `matcher.ts` (pure, synchronous by design, P#13) because this
// one needs filesystem I/O, so `interpreter.ts`'s `evaluateExpect` dispatches it directly, the same
// way it already does for `matchesSchema`.

import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { RuntimeError } from './eval.js';
import { repr, truncate, type MatchOutcome } from './matcher.js';

/** Runs `expect body bytes matches file "<path>"` (and its negated form). `filePath` is resolved
 * against `baseDir` (the test file's own directory) — same relative-path convention every other
 * file-reading feature in this language already uses (`import`/`use`/`upload`/`cert`/`key`).
 * Message shape mirrors `evalMatcher`'s own "expected ... but got ..." convention. */
export async function evaluateFileMatch(
  subjectLabel: string,
  actual: Buffer,
  filePath: string,
  baseDir: string,
  negated: boolean,
): Promise<MatchOutcome> {
  const abs = resolvePath(baseDir, filePath);
  let expected: Buffer;
  try {
    expected = await readFile(abs);
  } catch (err) {
    throw new RuntimeError(`could not read file "${filePath}" for \`matches file\`: ${(err as Error).message}`);
  }
  const valid = actual.equals(expected);
  const ok = negated ? !valid : valid;
  const not = negated ? 'not ' : '';
  const expectation = `${subjectLabel} ${not}to match file "${filePath}"`;
  if (ok) return { ok: true, message: expectation };
  if (valid) return { ok: false, message: `expected ${expectation}, but got ${truncate(repr(actual))} (negated match unexpectedly succeeded)` };
  return { ok: false, message: `expected ${expectation}, but got ${truncate(repr(actual))} (expected file is ${repr(expected)})` };
}
