#!/usr/bin/env node
// `verify:runbook` (`M259` `B`, `D1416`) — the walkthrough's commands, run the way a reader runs them.
//
// A page that tells a newcomer what to type is a claim about what happens when they type it, and
// the only check of that claim is typing it. So every fence in a walkthrough chapter
// (`packages/docs-site/runbook/start/`) tagged ` ```sh runbook ` is **executed**:
//
//   - in one fresh temp directory for the whole walkthrough, chapter after chapter in
//     `.vitepress/walkthrough.mjs`'s order, so the directory accumulates state the way a reader's
//     does — a `cd` in one fence, or an `export`, holds for the next;
//   - against the CLI packed from the tree under test (`npm pack -w tflw`, or `TFLW_TGZ` when the
//     caller already packed one), which reaches the fences as `$TFLW_TGZ`, the variable chapter 1's
//     pre-1.0 install path sets;
//   - with `bash -e -o pipefail`, so a fence passes only if every line in it does.
//
// The text is read **as the site renders it today**: of a page's `<Published>` twins, only the one
// `PUBLISHED` (`.vitepress/published.ts`) selects is run, so before 1.0 the gate runs the pre-1.0
// path (`D1419`), and on publish day the other one, with no change here.
//
// A ` ```text runbook-output ` fence directly after a command is that command's **expected output**,
// compared line for line after the normalisations in `NORMALISE` below. A line that is exactly `…`
// matches any run of lines, including none, so a page can show the line that teaches and elide the
// rest — and does not have to reproduce npm's chatter to show tflw's.
//
// ` ```sh runbook background ` starts a command that keeps running (the shop). The gate waits until
// its output matches the output fence after it — the shop saying where it is — and stops it, with
// everything it started, when the walkthrough ends.
//
// ` ```sh runbook-manual ` is a command the gate cannot run (a `git clone` of the repository it is
// testing; a window only a person can use). It is a **declared** exception, never a silent one: the
// gate prints the count and each one's page and line on every run. An untagged ` ```sh ` fence in a
// chapter fails the gate, so a command cannot leave the gate's reach by being left untagged.
//
// Usage:
//   node scripts/verify-runbook.mjs              run the walkthrough (needs `npm run build` first)
//   node scripts/verify-runbook.mjs --self-test  the negative controls, against fixture pages
//   node scripts/verify-runbook.mjs --keep       leave the temp directory behind, and say where
//   node scripts/verify-runbook.mjs --show       print every step's output, normalised, as it runs —
//                                                how an author reads what a fence should show
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractBlocks } from '../packages/docs-site/scripts/doc-blocks.mjs';
import { WALKTHROUGH } from '../packages/docs-site/.vitepress/walkthrough.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const DOCS = join(REPO, 'packages', 'docs-site');
const START = join(DOCS, 'runbook', 'start');
const FIXTURES = join(REPO, 'scripts', 'fixtures', 'runbook');

/** How long a background command has to print what its output fence says it prints. */
const BACKGROUND_MS = 30_000;

/**
 * What differs between two honest runs of the same command, and is therefore not compared. Each
 * entry is `[pattern, replacement, why]`; they apply in order to both the expected and the actual
 * text, so a page may write either the placeholder or a real value.
 */
export const NORMALISE = [
  [/\x1b\[[0-9;]*m/g, '', 'colour — the gate sets `NO_COLOR`, and a tool that ignores it is not a docs defect'],
  [/[ \t]+$/gm, '', 'trailing whitespace, which a page cannot show'],
  [/\b\d{4}-\d{2}-\d{2}T\d{2}[:-]\d{2}[:-]\d{2}(?:[.,-]\d+)?Z?/g, '<time>', 'timestamps — `now`, and a kept run\'s directory name, whose milliseconds follow a `-` (`…T09-30-14-902Z`)'],
  [/\b\d{2}:\d{2}:\d{2}\.\d{3}\b/g, '<clock>', 'the wall-clock prefix `tflw run` puts on every console line unless `--no-timestamps`'],
  [/\bseed \d+/g, 'seed <seed>', 'a run mints a fresh seed unless `--seed` fixes one'],
  [/\b\d+(?:\.\d+)? ?(?:ms|s)\b/g, '<t>', 'durations — the run line, `npm install`, a test that waited'],
  [/\b(127\.0\.0\.1|localhost):\d+/g, '$1:<port>', 'ports — the gate moves the shop off 4720 with `SHOP_URL`, as a reader with 4720 taken does'],
  [/\btoken=[\w-]+/g, 'token=<token>', "`tflw ui`'s per-start token"],
  [/\btflw([ @-])\d+\.\d+\.\d+(?:-[\w.]+)?/g, 'tflw$1<version>', "tflw's own version, which the page should not have to chase"],
  [/\bNode v\d+\.\d+\.\d+/g, 'Node v<node>', 'the Node a reader has — the page asks for 22 or newer, not for one patch'],
  [/\bplaywright \d+\.\d+\.\d+/g, 'playwright <version>', 'the Playwright `npm install` resolved today'],
  [/\b(?:added|changed|removed) \d+ packages?\b/g, '<npm>', "npm's package arithmetic, which depends on its cache"],
];

export function normalise(text, workDirs = []) {
  let out = text.replace(/\r\n/g, '\n');
  // The work directory first, by both spellings: macOS reports `/var/…` and `/private/var/…` for
  // one directory, and either can reach a line.
  for (const d of workDirs) out = out.split(d).join('<dir>');
  for (const [pattern, replacement] of NORMALISE) out = out.replace(pattern, replacement);
  return out.replace(/^\n+|\n+$/g, '');
}

/** Whether `actual` is `expected`, line for line, where an expected line `…` is any run of lines. */
export function outputMatches(expected, actual) {
  const e = expected === '' ? [] : expected.split('\n');
  const a = actual === '' ? [] : actual.split('\n');
  const memo = new Map();
  const at = (i, j) => {
    const key = i * (a.length + 1) + j;
    if (memo.has(key)) return memo.get(key);
    let ok;
    if (i === e.length) ok = j === a.length;
    else if (e[i].trim() === '…') ok = at(i + 1, j) || (j < a.length && at(i, j + 1));
    else ok = j < a.length && e[i] === a[j] && at(i + 1, j + 1);
    memo.set(key, ok);
    return ok;
  };
  return at(0, 0);
}

/** The page as the site renders it: the `<Published>` twin `published` does not select is removed. */
export function activeText(page, published) {
  const inactive = published ? /<Published :when="false">[\s\S]*?<\/Published>/g : /<Published>[\s\S]*?<\/Published>/g;
  // Replaced by as many newlines as it held, so every line number the gate reports is the file's.
  return page.replace(inactive, (m) => m.replace(/[^\n]/g, ''));
}

/**
 * A page's runnable steps and its problems. A step is `{ line, source, background, expected? }`;
 * `expected` is the `text runbook-output` fence when it is the very next fence on the page.
 */
export function readChapter(page, published) {
  const blocks = extractBlocks(activeText(page, published));
  const steps = [];
  const manual = [];
  const problems = [];
  blocks.forEach((b, i) => {
    const isOutput = b.lang === 'text' && b.directives['runbook-output'];
    if (isOutput) {
      const prev = blocks[i - 1];
      if (!prev || prev.lang !== 'sh' || !prev.directives.runbook) problems.push({ line: b.startLine, why: 'a `runbook-output` fence must follow a `sh runbook` fence directly' });
      // `M260`: a fence of nothing but `…` matches every output, including an error's, so it is a
      // claim that cannot fail — the placeholder an author meant to fill. Show the line that
      // teaches, or drop the fence.
      else if (b.source.split('\n').every((l) => l.trim() === '…' || l.trim() === '')) problems.push({ line: b.startLine, why: 'a `runbook-output` fence of only `…` asserts nothing — show at least one line the command prints, or drop the fence', placeholder: true });
      return;
    }
    if (b.lang !== 'sh' && b.lang !== 'bash' && b.lang !== 'shell') return;
    if (b.directives['runbook-manual']) return manual.push({ line: b.startLine });
    if (!b.directives.runbook) return problems.push({ line: b.startLine, why: 'an untagged shell fence in a walkthrough chapter — tag it `runbook`, or `runbook-manual` with the reason in the prose' });
    const next = blocks[i + 1];
    steps.push({
      line: b.startLine,
      source: b.source,
      background: b.directives.background === true,
      expected: next && next.lang === 'text' && next.directives['runbook-output'] ? next.source : undefined,
    });
  });
  return { steps, manual, problems };
}

export function readPublished() {
  const src = readFileSync(join(DOCS, '.vitepress', 'published.ts'), 'utf8');
  const m = /^export const PUBLISHED = (true|false);$/m.exec(src);
  if (!m) throw new Error('`.vitepress/published.ts` no longer declares `PUBLISHED` as a literal — read it here the way the site does');
  return m[1] === 'true';
}

/** The walkthrough's chapters as files, and any page under `runbook/start/` the order leaves out. */
export function walkthroughFiles() {
  const listed = WALKTHROUGH.map((c) => join(DOCS, `${c.link}.md`));
  const onDisk = existsSync(START) ? readdirSync(START).filter((f) => f.endsWith('.md')).map((f) => join(START, f)) : [];
  return { listed, unlisted: onDisk.filter((f) => !listed.includes(f)) };
}

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function pack() {
  const dist = join(REPO, 'packages', 'cli', 'dist', 'cli.cjs');
  if (!existsSync(dist)) throw new Error('no `packages/cli/dist/cli.cjs` — `npm run build` first; the gate packs what was built and does not build it');
  const dest = mkdtempSync(join(tmpdir(), 'tflw-runbook-pack-'));
  // `--ignore-scripts`: `prepack` would rebuild every workspace, and the tree under test is already built.
  const r = spawnSync('npm', ['pack', '-w', 'tflw', '--ignore-scripts', '--pack-destination', dest], { cwd: REPO, encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`npm pack failed:\n${r.stderr}`);
  const tgz = readdirSync(dest).find((f) => f.endsWith('.tgz'));
  if (!tgz) throw new Error(`npm pack wrote no tarball into ${dest}`);
  return join(dest, tgz);
}

/** The environment a reader's shell has, less what running under `npm run` added. */
function readerEnv(extra) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('npm_') && k !== 'INIT_CWD' && k !== 'FORCE_COLOR') env[k] = v;
  return { ...env, NO_COLOR: '1', ...extra };
}

/**
 * Runs `chapters` (`[{ file, text }]`) in one fresh directory. Returns `{ ok, failures, ran, manual, problems }`.
 * A failure is `{ file, line, why, output }`; the first one stops the run, because every fence after
 * it would be running in a directory the page never described.
 */
export async function runWalkthrough(chapters, { tgz, keep = false, show = false, published = readPublished(), log = () => {} } = {}) {
  const problems = [];
  const manual = [];
  const plan = [];
  for (const { file, text } of chapters) {
    const ch = readChapter(text, published);
    for (const p of ch.problems) problems.push({ file, ...p });
    for (const m of ch.manual) manual.push({ file, ...m });
    for (const s of ch.steps) plan.push({ file, ...s });
  }
  // Under `--show` an author is reading outputs in order to write the fences, so a placeholder is
  // reported but does not stop the run; it still fails the result.
  const blocking = show ? problems.filter((p) => !p.placeholder) : problems;
  if (blocking.length > 0) return { ok: false, failures: blocking.map((p) => ({ ...p, output: '' })), ran: 0, manual, problems };

  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'tflw-runbook-')));
  const work = join(scratch, 'reader');
  const state = join(scratch, 'state');
  mkdirSync(work);
  mkdirSync(state);
  writeFileSync(join(state, 'cwd'), work);
  writeFileSync(join(state, 'env'), '');
  writeFileSync(join(state, 'bg'), '');
  const workDirs = [work, work.replace(/^\/private\//, '/'), scratch];
  const port = await freePort();
  const env = readerEnv({ TFLW_TGZ: tgz, SHOP_URL: `http://127.0.0.1:${port}`, HOME: process.env.HOME ?? scratch });
  const failures = [];
  let ran = 0;
  try {
    for (const [n, step] of plan.entries()) {
      const where = `${relative(REPO, step.file)}:${step.line}`;
      log(`  ▸ ${where}${step.background ? ' (background)' : ''}`);
      const script = join(state, `step-${n}.sh`);
      const outFile = join(state, `step-${n}.out`);
      // The state a reader's terminal carries from one command to the next: where they are, and
      // what they exported. Saved on the way out, restored on the way in. `set -m` gives each
      // background job its own process group, so the gate can stop a shop and its `node` child.
      writeFileSync(
        script,
        [
          `cd "$(cat '${state}/cwd')"`,
          `source '${state}/env'`,
          // Readonly variables are left out: re-declaring one in the next fence is an error.
          `trap 'pwd > "${state}/cwd"; export -p | sed "/^declare -[a-zA-Z]*r[a-zA-Z]* /d" > "${state}/env"; jobs -p >> "${state}/bg"' EXIT`,
          step.background ? 'set -m' : '',
          step.source,
        ].join('\n'),
      );
      const fd = openSync(outFile, 'w');
      const r = spawnSync('bash', ['-e', '-o', 'pipefail', script], { env, stdio: ['ignore', fd, fd], timeout: 10 * 60_000 });
      closeSync(fd);
      ran++;
      const read = () => normalise(readFileSync(outFile, 'utf8'), workDirs);
      if (r.status !== 0) {
        failures.push({ file: step.file, line: step.line, why: r.error ? `did not finish: ${r.error.message}` : `exited ${r.status ?? r.signal}`, output: read() });
        break;
      }
      const shown = () => show && log(read().split('\n').map((l) => `    │ ${l}`).join('\n'));
      // A background command has only begun when its fence returns; under `--show` give it time to
      // print what an author needs to see (a watch's first run, a browser's banner).
      if (show && step.background) await new Promise((resolve) => setTimeout(resolve, BACKGROUND_MS / 2));
      if (step.expected === undefined) {
        shown();
        continue;
      }
      const expected = normalise(step.expected, workDirs);
      const deadline = Date.now() + (step.background ? BACKGROUND_MS : 0);
      let actual = read();
      while (!outputMatches(expected, actual) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        actual = read();
      }
      shown();
      if (!outputMatches(expected, actual)) {
        failures.push({ file: step.file, line: step.line, why: 'its output is not what the page shows', output: `--- the page shows\n${expected}\n--- the run printed\n${actual}` });
        // An author reading every output under `--show` wants the rest of the walkthrough too; an
        // output that differs leaves the directory as a reader's would be, unlike a failed command.
        if (show) continue;
        break;
      }
    }
  } finally {
    for (const pid of readFileSync(join(state, 'bg'), 'utf8').split('\n').filter(Boolean)) {
      try {
        process.kill(-Number(pid), 'SIGTERM');
      } catch {
        // already gone — the job ended on its own, which is fine
      }
    }
    if (keep) log(`  kept ${scratch}`);
    else rmSync(scratch, { recursive: true, force: true });
  }
  const placeholders = problems.filter((p) => p.placeholder).map((p) => ({ ...p, output: '' }));
  return { ok: failures.length === 0 && placeholders.length === 0, failures: [...failures, ...placeholders], ran, manual, problems };
}

function report(result, label) {
  const lines = [];
  for (const f of result.failures) {
    lines.push(`✗ ${relative(REPO, f.file)}:${f.line} — ${f.why}`);
    if (f.output) lines.push(f.output.split('\n').slice(-40).map((l) => `    ${l}`).join('\n'));
  }
  lines.push(
    `${result.ok ? '✓' : '✗'} ${label}: ${result.ran} fence(s) run · ${result.manual.length} manual` +
      (result.manual.length ? ` (${result.manual.map((m) => `${relative(REPO, m.file)}:${m.line}`).join(', ')})` : ''),
  );
  return lines.join('\n');
}

async function main(argv) {
  const keep = argv.includes('--keep');
  const show = argv.includes('--show');
  const tgz = process.env.TFLW_TGZ ?? pack();
  if (argv.includes('--self-test')) return selfTest(tgz);
  const { listed, unlisted } = walkthroughFiles();
  if (listed.length === 0) {
    process.stderr.write('✗ `walkthrough.mjs` lists no chapter — a gate with nothing to run proves nothing\n');
    return 1;
  }
  if (unlisted.length > 0) {
    process.stderr.write(`✗ under runbook/start/ but not in walkthrough.mjs, so never run: ${unlisted.map((f) => relative(REPO, f)).join(', ')}\n`);
    return 1;
  }
  const chapters = listed.map((file) => ({ file, text: readFileSync(file, 'utf8') }));
  const result = await runWalkthrough(chapters, { tgz, keep, show, log: (l) => process.stdout.write(`${l}\n`) });
  process.stdout.write(`${report(result, `the walkthrough, ${chapters.length} chapter(s)`)}\n`);
  return result.ok ? 0 : 1;
}

/**
 * The negative controls (`D1416`), each against a fixture page beside a known-good one. A gate
 * that has only ever been green has not shown it can see anything, so each control must turn it red
 * **at the fence it was built to catch** — red somewhere else would be a different defect passing.
 */
async function selfTest(tgz) {
  const fixture = (name) => ({ file: join(FIXTURES, name), text: readFileSync(join(FIXTURES, name), 'utf8') });
  const cases = [
    { name: 'the unchanged fixture', pages: ['install.md', 'good.md'], expect: { ok: true, manual: 1 } },
    { name: 'a flag that no longer exists', pages: ['install.md', 'gone-flag.md'], expect: { ok: false, at: 'gone-flag.md', why: /exited 2/ } },
    { name: 'an output fence that drifted', pages: ['install.md', 'drifted.md'], expect: { ok: false, at: 'drifted.md', why: /not what the page shows/ } },
    { name: 'an untagged shell fence', pages: ['install.md', 'untagged.md'], expect: { ok: false, at: 'untagged.md', why: /untagged shell fence/, ran: 0 } },
    { name: 'a pre-1.0 twin read under the flag', pages: ['install.md', 'twins.md'], expect: { ok: true, manual: 1 } },
  ];
  let bad = 0;
  for (const c of cases) {
    const result = await runWalkthrough(c.pages.map(fixture), { tgz, published: false });
    const f = result.failures[0];
    const holds =
      result.ok === c.expect.ok &&
      (c.expect.manual === undefined || result.manual.length === c.expect.manual) &&
      (c.expect.ran === undefined || result.ran === c.expect.ran) &&
      (c.expect.at === undefined || (f && f.file.endsWith(c.expect.at) && c.expect.why.test(f.why)));
    process.stdout.write(`${holds ? '✓' : '✗'} ${c.name}: ${result.ok ? 'green' : `red at ${f ? `${relative(REPO, f.file)}:${f.line} — ${f.why}` : '?'}`}\n`);
    if (!holds) {
      bad++;
      process.stdout.write(`${report(result, c.name)}\n`);
    }
  }
  process.stdout.write(bad === 0 ? `✓ verify:runbook self-test: ${cases.length} controls behave\n` : `✗ verify:runbook self-test: ${bad} of ${cases.length} controls did not behave\n`);
  return bad === 0 ? 0 : 1;
}

// `pathToFileURL`, not a `file://` string: the hand-built form is `M243-18`'s and `M259-06`'s defect.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`✗ verify:runbook: ${e.message}\n`);
      process.exit(1);
    },
  );
}
