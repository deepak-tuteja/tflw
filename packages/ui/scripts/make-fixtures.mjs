// Regenerates the page gate's corpus (`M192` U2): `fixtures/reports/<env>/` is what `tflw run`
// wrote over `fixtures/project/` under that env, kept whole. The corpus is never hand-written —
// a hand-written `results.json` would be a second account of the artefact contract, and the
// gate's whole claim is that the page shows what the *run* wrote (`D986`). Re-run this when the
// contract changes, and commit the result; the gate reads the committed copy.
//
//   node packages/ui/scripts/make-fixtures.mjs
//
// Runs the source entry under tsx, so the corpus is the checked-out tflw's, not the last build's.

import { spawn } from 'node:child_process';
import { cp, rm, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const project = join(here, '..', 'fixtures', 'project');
const reports = join(here, '..', 'fixtures', 'reports');
const cliEntry = join(here, '..', '..', 'cli', 'src', 'cli.ts');
// Absolute: `--import tsx` by name resolves from the child's cwd, which is the fixture project.
const tsx = fileURLToPath(import.meta.resolve('tsx'));

const { startFixtureServer } = await import(join(project, 'server.mjs'));

const run = (args) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', tsx, cliEntry, ...args], { cwd: project, stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, FORCE_COLOR: '0' } });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => (out += c));
    child.on('close', (code) => resolve({ code, out }));
  });

// The fixtures are graded by `verify:fmt-roundtrip -- --check` like every `.tflw` under
// `packages/`; format them first so the corpus and the source agree.
await run(['fmt', 'tests']);
for (const env of ['full', 'headers']) {
  // A fresh server per env: `/warmup` fails its first call *per server*, and the retry the
  // corpus exists to show would otherwise happen under the first env only.
  const server = await startFixtureServer();
  try {
    await rm(join(project, 'report'), { recursive: true, force: true });
    // The `headers` env runs against the project's baseline, so that corpus holds a finding the
    // gate withheld (*known/accepted*) beside `full`'s, where the same finding gates (U5).
    const baseline = env === 'headers' ? ['--baseline', 'security-baseline.json'] : [];
    const { code, out } = await run(['run', '--env', env, '--format', 'ndjson', '--no-color', ...baseline]);
    if (!existsSync(join(project, 'report', 'results.json'))) throw new Error(`no results.json after env ${env} (exit ${code})\n${out}`);
    const dest = join(reports, env);
    await rm(dest, { recursive: true, force: true });
    await mkdir(dest, { recursive: true });
    await cp(join(project, 'report'), dest, { recursive: true });
    const members = (await readdir(dest)).sort();
    process.stdout.write(`${env}: exit ${code}, ${out.split('\n').filter(Boolean).length} events, kept ${members.join(' ')}\n`);
  } finally {
    server.close();
  }
}
await rm(join(project, 'report'), { recursive: true, force: true });
