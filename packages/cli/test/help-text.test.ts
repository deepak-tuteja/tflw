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
// `M243-05`: a URL, not a path — Node on Windows refuses an absolute path as an `--import` specifier
// (`ERR_UNSUPPORTED_ESM_URL_SCHEME`, protocol `d:`), and a `file://` URL is what every OS accepts.
const tsxLoader = import.meta.resolve('tsx');

const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['a milestone id', /\bM\d{2,3}[a-z]?(-\d+)?\b/],
  ['a decision id', /\bD\d{1,4}\b/],
  ['a numbered decision', /\bdecision \d+/],
  ['a SPEC section', /§/],
  ['SPEC.md', /SPEC\.md/],
];

test('`tflw --help` and every verb\'s `--help` name no milestone, decision or SPEC section, and point at the docs site', async () => {
  // `M249` `E`: the flags moved under each verb, rendered from `CLI_FLAGS` whose effects carry record
  // ids for the docs site — `plainEffect` strips them, and this is what says it did, on every page.
  const run = async (...args: string[]) => (await execFileAsync(process.execPath, ['--import', tsxLoader, cliEntry, ...args], { env: { ...process.env, FORCE_COLOR: '0' } })).stdout;
  const global = await run('--help');
  const verbs = [...global.matchAll(/^  tflw ([a-z-]+) /gm)].map((m) => m[1]!);
  assert.ok(verbs.length >= 15, `the global help lists ${verbs.length} verbs — the command printed something else`);
  const pages: [string, string][] = [['--help', global], ...(await Promise.all(verbs.map(async (v) => [`${v} --help`, await run(v, '--help')] as [string, string])))];
  const found = pages.flatMap(([page, text]) =>
    text.split('\n').flatMap((line, i) => PATTERNS.filter(([, re]) => re.test(line)).map(([what]) => `${page} line ${i + 1}: ${what} — ${line.trim()}`)),
  );
  assert.deepEqual(found, [], found.join('\n'));
  for (const [page, text] of pages) assert.match(text, /https:\/\/deepak-tuteja\.github\.io\/tflw\//, `${page} says where the long form is`);
});
