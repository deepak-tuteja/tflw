// `helpers` and `--no-helpers` through the CLI (`M239` `D`, `D1319`): the policy `tflw check`
// applies, the line it prints per module, the refusal `tflw run --no-helpers` makes before its
// first request, and the project view that hands the same policy to the page.
//
// Spawned from the source entry under tsx, as `ui-server.test.ts` spawns runs, so the claim is
// about the command a reader types and not about a function the command may or may not call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_HELPER_DIRS } from '@tflw/lang';
import { readProject } from '../src/ui-server.js';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(here, '..', 'src', 'cli.ts');
const tsxLoader = fileURLToPath(import.meta.resolve('tsx'));

type Outcome = { code: number; stdout: string; stderr: string };
async function tflw(cwd: string, ...argv: string[]): Promise<Outcome> {
  try {
    const r = await execFileAsync(process.execPath, ['--import', tsxLoader, cliEntry, ...argv], { cwd, env: { ...process.env, FORCE_COLOR: '0' } });
    return { code: 0, ...r };
  } catch (e) {
    const r = e as { code?: number; stdout?: string; stderr?: string };
    return { code: r.code ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }
}

/** A project whose one test `use`s a module in `lib/`, beside the allowed `helpers/`. */
async function project(config: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-helpers-'));
  await writeFile(join(dir, 'tflw.config'), config, 'utf8');
  await mkdir(join(dir, 'lib'));
  await mkdir(join(dir, 'helpers'));
  await mkdir(join(dir, 'tests'));
  await writeFile(join(dir, 'lib', 'sign.ts'), 'export function sign(_ctx: unknown, s: string): string { return `signed:${s}`; }\n', 'utf8');
  await writeFile(join(dir, 'helpers', 'stamp.ts'), 'export function stamp(): string { return "now"; }\n', 'utf8');
  await writeFile(join(dir, 'tests', 'a.tflw'), 'use "../lib/sign.ts"\n\ntest "signed"\n  let s = sign("x")\n  api GET /health\n  expect status equals 200\n', 'utf8');
  await writeFile(join(dir, 'tests', 'b.tflw'), 'use "../helpers/stamp.ts"\n\ntest "stamped"\n  let s = stamp()\n  api GET /health\n  expect status equals 200\n', 'utf8');
  return dir;
}

const CONFIG = 'env local default\n  api "http://127.0.0.1:1"\n';

test('`tflw check` refuses a `use` outside the allowed directories as `TF083`, and passes it once `tflw.config` names the directory — printing one `helper` line per module', async () => {
  const dir = await project(CONFIG);
  try {
    const refused = await tflw(dir, 'check', '--no-color');
    assert.equal(refused.code, 2, `a check error is \`could not run\` (exit 2):\n${refused.stdout}${refused.stderr}`);
    assert.match(refused.stderr, /error\[TF083\]/);
    assert.match(refused.stderr, /`use "\.\.\/lib\/sign\.ts"` loads a module outside the directories `helpers` allows/);
    assert.match(refused.stderr, /helpers "\.\/lib"/, 'the hint names the repair');
    assert.doesNotMatch(refused.stderr, /stamp\.ts/, 'the module under `helpers/` is fine and is not reported');

    await writeFile(join(dir, 'tflw.config'), `helpers "./helpers", "./lib"\n${CONFIG}`, 'utf8');
    const allowed = await tflw(dir, 'check', '--no-color');
    assert.equal(allowed.code, 0, allowed.stdout + allowed.stderr);
    assert.match(allowed.stdout, /^helper helpers\/stamp\.ts — `use` in tests\/b\.tflw$/m);
    assert.match(allowed.stdout, /^helper lib\/sign\.ts — `use` in tests\/a\.tflw$/m);
    assert.match(allowed.stdout, /2 files checked, no problems found\./);
    // The lines come BEFORE the verdict, once per module, sorted — a reviewer reads them as the
    // executable surface of the suite.
    assert.ok(allowed.stdout.indexOf('helper helpers/stamp.ts') < allowed.stdout.indexOf('2 files checked'));

    // Declaring `./lib` alone drops the default: the module under `helpers/` is now the one refused.
    await writeFile(join(dir, 'tflw.config'), `helpers "./lib"\n${CONFIG}`, 'utf8');
    const swapped = await tflw(dir, 'check', '--no-color');
    assert.equal(swapped.code, 2);
    assert.match(swapped.stderr, /stamp\.ts/);
    assert.doesNotMatch(swapped.stderr, /sign\.ts/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('`tflw run --no-helpers` refuses every `use` before the first request, naming the flag; the same project runs its check clean without it', async () => {
  const dir = await project(`helpers "./helpers", "./lib"\n${CONFIG}`);
  try {
    const refused = await tflw(dir, 'run', '--no-helpers', '--no-color');
    assert.notEqual(refused.code, 0);
    assert.match(refused.stderr, /error\[TF083\]/);
    assert.match(refused.stderr, /refused: this run was started with `--no-helpers`/);
    assert.equal((refused.stderr.match(/error\[TF083\]/g) ?? []).length, 2, 'both files, both `use` lines');
    assert.doesNotMatch(refused.stdout + refused.stderr, /GET \/health/, 'nothing ran');
    const checked = await tflw(dir, 'check', '--no-color');
    assert.equal(checked.code, 0, checked.stderr);
    // `--help` carries the flag, from the same manifest the docs render.
    const help = await tflw(dir, '--help');
    assert.match(help.stdout + help.stderr, /--no-helpers/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the project view hands the page the same policy: the declared directories, or the defaults when a config declares none', async () => {
  const dir = await project(CONFIG);
  try {
    const undeclared = await readProject(dir);
    assert.deepEqual(undeclared.helpers, DEFAULT_HELPER_DIRS);
    await writeFile(join(dir, 'tflw.config'), `helpers "./lib"\n${CONFIG}`, 'utf8');
    const declared = await readProject(dir);
    assert.deepEqual(declared.helpers, ['./lib']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
