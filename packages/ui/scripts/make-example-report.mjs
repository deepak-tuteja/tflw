// Regenerates the canonical report the docs shots are taken of — `M234` `D` (`D1302`).
//
// `fixtures/example-reports/local/` is what `tflw run` wrote over `examples/storefront/` under its
// one env, kept whole. Never hand-written: `D986` forbids a second account of the artefact
// contract, and `D1302` permits committing a *generated* one — which is what this produces.
//
// ## Why this exists at all, rather than the shoot running the example itself
//
// `examples/storefront/report/` is gitignored, deliberately: un-ignoring it would make
// `npm run example` dirty the tree on every local run. So the shoot cannot read the example's own
// output — it reads this committed copy, exactly as it already read `fixtures/reports/<env>` for
// the fixture project. The only difference is the number of envs, and that difference is a
// decision rather than an accident (`M234` §3.1 `D-3`): the example declares `env local default`
// and one env, and it is not widened to two in order to make the new screenshot resemble the old
// one.
//
// ## The layout, which is not the layout `tflw run` writes
//
// `tflw run` writes the report **flat** — `report/report.html`, `results.json`, `junit.xml`,
// `.last-run.json`, `findings.sarif` — and there is no `report/runs/` in its output at all.
// `runs/<name>/` is the *page's* run history, so the shoot copies this directory to
// `report/runs/local` inside its scratch tree and the page reads it as one run. That indirection
// is `make-fixtures.mjs`'s, unchanged; this file is its sibling for the example.
//
//   node packages/ui/scripts/make-example-report.mjs
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..', '..', '..');
const EXAMPLE = join(REPO, 'examples', 'storefront');
const DEST = join(here, '..', 'fixtures', 'example-reports', 'local');

// The CLI from source under tsx, not `dist/cli.cjs`. `run.mjs` uses the branch build because that
// is what a *reader* of this repository has; this script is repository tooling, and a shot cut from
// a stale `dist/` would be a picture of a build nobody is looking at — the whole hazard `D1283`
// exists for.
const tsx = fileURLToPath(import.meta.resolve('tsx'));
const cliEntry = join(REPO, 'packages', 'cli', 'src', 'cli.ts');

const { startStorefront, PORT } = await import(join(EXAMPLE, 'server.mjs'));
const server = await startStorefront(PORT);

try {
  const { code, out } = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--import', tsx, cliEntry, 'run', '--format', 'ndjson', '--no-color'],
      { cwd: EXAMPLE, stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, FORCE_COLOR: '0' } },
    );
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.on('exit', (c) => resolve({ code: c ?? 1, out }));
  });

  // **The run has to have produced something before anything is copied.** A green exit with no
  // `results.json` is the shape that would commit an empty canonical report and leave every
  // downstream gate reading it as the truth about a passing suite.
  if (!existsSync(join(EXAMPLE, 'report', 'results.json'))) {
    throw new Error(`no results.json after the example run (exit ${code})\n${out}`);
  }

  await rm(DEST, { recursive: true, force: true });
  await mkdir(dirname(DEST), { recursive: true });
  await cp(join(EXAMPLE, 'report'), DEST, { recursive: true });

  // `report/runs/` is the page's own history and accumulates a directory per `tflw ui` run. It is
  // not part of what `tflw run` wrote, it is machine-local, and copying it would put a growing pile
  // of timestamped duplicates into the input hash. Dropped, and said out loud so its absence is not
  // read as an oversight the next time this is run by hand.
  await rm(join(DEST, 'runs'), { recursive: true, force: true });

  const members = readdirSync(DEST).sort();
  process.stdout.write(`local: exit ${code}, ${out.split('\n').filter(Boolean).length} events, kept ${members.join(' ')}\n`);
} finally {
  server.close();
}
