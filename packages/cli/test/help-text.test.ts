// `tflw --help` carries the reason, never the record's identifier — `M240` `D` (`D1313`).
//
// The help text is the third surface `D1313` names, beside the runtime's strings and the page, and
// the one `scripts/verify-no-internal-refs.mjs` cannot reach: it is assembled at run time, so the
// gate reads what the command prints. Its lines used to cite `SPEC §9.12`, `(M200, D1053)` and
// `decision 38/45`, and ended in a footer pointing at `SPEC.md` so a reader could follow them —
// into a build-side file and a ledger that is not published. The patterns are the static gate's
// `EVERYWHERE`, spelled again here because this package cannot import from `scripts/`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(here, '..', 'src', 'cli.ts');
const tsxLoader = fileURLToPath(import.meta.resolve('tsx'));

const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['a milestone id', /\bM\d{2,3}[a-z]?(-\d+)?\b/],
  ['a decision id', /\bD\d{1,4}\b/],
  ['a numbered decision', /\bdecision \d+/],
  ['a SPEC section', /§/],
  ['SPEC.md', /SPEC\.md/],
];

test('`tflw --help` names no milestone, decision or SPEC section, and points at the docs site', async () => {
  const { stdout } = await execFileAsync(process.execPath, ['--import', tsxLoader, cliEntry, '--help'], { env: { ...process.env, FORCE_COLOR: '0' } });
  const lines = stdout.split('\n');
  assert.ok(lines.length > 60, `the help is ${lines.length} lines — the command printed something else`);
  const found = lines.flatMap((line, i) => PATTERNS.filter(([, re]) => re.test(line)).map(([what]) => `line ${i + 1}: ${what} — ${line.trim()}`));
  assert.deepEqual(found, [], found.join('\n'));
  assert.match(stdout, /https:\/\/deepak-tuteja\.github\.io\/tflw\//, 'the long form is the docs site, and the help says where it is');
});
