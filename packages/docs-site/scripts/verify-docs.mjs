// Doc truth (M62, review finding OBS-01) — the guard that keeps the documentation honest.
//
// Three properties, in the order they matter:
//
//  1. **Nothing is silently skipped.** Every fenced block on the site is classified; an unlabelled
//     or unknown one fails the run. The predecessor of this script recognised two tags and dropped
//     the other 58 blocks without counting them, behind a line reading `31/31 … parse cleanly`.
//  2. **Samples are checked, not merely parsed.** Full checker pipeline, so a `TF030` unbound
//     `{id}` — the defect that actually shipped in `load-testing.md` at review baseline `c6409d1`
//     while the green line said `28/28` — is caught.
//  3. **Checked against the shipped CLI**, `packages/cli/dist/cli.cjs`, not the workspace `@tflw/lang`.
//     A guard verifying the docs against a different build than the reader will run is verifying the
//     wrong artifact — the exact seam M60 found drifted three ways.
//
// Plus: every `tflw …` invocation the docs show is validated against the real flag registry.
// See PLAN_DOC_TRUTH.md for the decisions (DT-01 … DT-09).

import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { census, findMarkdownFiles, DECLARED_UNCHECKED } from './doc-blocks.mjs';
import { CLI_FLAGS } from '@tflw/lang';

const execFileAsync = promisify(execFile);
const here = fileURLToPath(new URL('.', import.meta.url));
// Overridable so the guard's own tests can point it at a fixture corpus — a doc-truth guard that
// is never itself run against a known-bad input is the unearned confidence it exists to remove.
const ROOT = process.env.TFLW_DOCS_ROOT ?? join(here, '..');
const CLI = join(here, '../../cli/dist/cli.cjs');
const FIXTURE_CONFIG = join(here, 'fixtures/tflw.config');
const FIXTURE_SESSIONS = join(here, 'fixtures/sessions.config');

const problems = [];
const fail = (where, message, detail) => problems.push({ where, message, detail });

// ---------------------------------------------------------------------------
// The census. Unclassified is a failure, not a skip (DT-01).
// ---------------------------------------------------------------------------

const blocks = census(ROOT);

for (const b of blocks) {
  if (b.kind === 'unclassified') {
    fail(`${b.file}:${b.startLine}`, b.why, 'Tag it: `tflw`, `tflw fragment`, `tflw-config`, `console`, `text`, `sh`, `ts`, `json`, `yaml`, `xml`, `csv`.');
  }
}

// ---------------------------------------------------------------------------
// Materialise every sample and check it with the shipped CLI (DT-03, DT-04).
// ---------------------------------------------------------------------------

/**
 * A fragment is steps without their enclosing `test`, which is how most of the guide teaches — the
 * browser interaction list, the workload forms, the assertion shapes. It is wrapped here rather
 * than in the page so the docs keep showing the reader the lines they care about.
 *
 * `binds` declares the illustrative variables a fragment interpolates but never captures
 * (`{orderId}`, `{email}`). Declaring them per-block keeps `TF030` live for the case this guard
 * exists to catch: a doc still interpolating `{orderid}` after a rename.
 */
function materialise(block, source, startLine) {
  if (block.kind === 'file') return { source, lineOffset: 0, startLine };
  const preamble = ['test "docs fragment"', ...block.binds.map((name) => `  let ${name} = "docs-fixture"`)];
  const body = source.split('\n').map((line) => (line.trim() === '' ? line : '  ' + line));
  // A workload excerpt is one line of a *workload-bearing* test, and such a test with no
  // `threshold` can never fail (M60/A4-01, TF033). Supplying one here checks the excerpt as what
  // the page says it is, instead of failing it for the surrounding lines it deliberately omits.
  const tail = block.directives.workload ? ['  threshold error rate is less than 1%'] : [];
  return { source: [...preamble, ...body, ...tail].join('\n') + '\n', lineOffset: preamble.length, startLine };
}

/**
 * Most fragments are one excerpt. `alternatives` marks the other shape the guide uses: a fence
 * listing forms that are *mutually exclusive* — two `run … iterations` lines a reader picks between,
 * which in one test would be `TF033` ("a test has at most one workload line"). Each unindented line,
 * with any indented continuation, is checked as its own sample.
 */
function expand(block) {
  if (!block.directives.alternatives) return [materialise(block, block.source, block.startLine)];
  const lines = block.source.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '' || /^\s/.test(lines[i])) continue;
    let end = i + 1;
    while (end < lines.length && (lines[end].trim() === '' || /^\s/.test(lines[end]))) end++;
    out.push(materialise(block, lines.slice(i, end).join('\n'), block.startLine + i));
    i = end - 1;
  }
  return out;
}

/** Temp-file line → the markdown line the reader would look at. */
const toDocLine = (startLine, offset, line) => startLine + line - offset;

async function checkSamples() {
  const samples = blocks.filter((b) => b.kind === 'file' || b.kind === 'fragment');
  const configs = blocks.filter((b) => b.kind === 'config' || b.kind === 'config-fragment');
  if (samples.length === 0 && configs.length === 0) return;

  const dir = await mkdtemp(join(tmpdir(), 'tflw-doc-truth-'));
  try {
    // One shared directory for the .tflw samples: they all resolve against the same fixture config,
    // whose declared services/sessions are the surface the docs are allowed to assume.
    const fixture = await readFile(FIXTURE_CONFIG, 'utf8');
    const sessions = await readFile(FIXTURE_SESSIONS, 'utf8');
    await writeFile(join(dir, 'tflw.config'), `${fixture}\n${sessions}`, 'utf8');

    const prepared = await Promise.all(
      samples.flatMap((block) => expand(block).map((piece) => ({ block, ...piece }))).map(async (piece, i) => {
        const path = join(dir, `sample-${String(i).padStart(3, '0')}.tflw`);
        await writeFile(path, piece.source, 'utf8');
        return { ...piece, path };
      }),
    );

    // One `tflw check` for the whole corpus. This used to be one process per sample in a pool of
    // 8, because `check --format json` flattened every file's diagnostics into a single array with
    // no file attribution, so batching would have lost which sample failed. M70 (B6-07) gave each
    // entry its own `file`, which is exactly what makes the batch addressable — so the workaround
    // goes, and ~45 process spawns become one.
    if (prepared.length > 0) {
      const byName = new Map(prepared.map((p) => [basename(p.path), p]));
      const { stdout, stderr, code } = await runCli(['check', '--format', 'json', ...prepared.map((p) => p.path)], dir);
      const files = safeJson(stdout);
      if (files === undefined) {
        fail('docs samples', `\`tflw check\` produced no JSON (exit ${code})`, stderr.trim());
      } else if (files.length !== prepared.length) {
        // Every sample must come back, clean ones included (M70 lists them with an empty batch).
        // A short array means the run died before checking them all — a broken `tflw.config`, say
        // — which would otherwise read as "no diagnostics" and pass the guard silently.
        fail('docs samples', `\`tflw check\` reported on ${files.length} of ${prepared.length} samples (exit ${code})`, stderr.trim());
      } else {
        for (const { file, diagnostics } of files) {
          const piece = byName.get(basename(file));
          if (!piece) {
            fail('docs samples', `\`tflw check\` reported on an unexpected file: ${file}`);
            continue;
          }
          for (const d of diagnostics) {
            fail(
              `${piece.block.file}:${toDocLine(piece.startLine, piece.lineOffset, d.span.start.line)}`,
              `${d.code}: ${d.message}`,
              d.hint ? `help: ${d.hint}` : undefined,
            );
          }
        }
      }
    }

    // A `tflw.config` sample is only a config in a directory of its own — `tflw check` validates
    // the config in its cwd. Each gets a scratch directory with an empty suite file, so what runs
    // is the shipped config parser + `validateConfig` + `checkSessionServices`, none of which the
    // old parse-only guard reached. Config diagnostics print as text on stderr with exit 2
    // (decision 94 keeps stdout's JSON to the target file's own diagnostics), so the CLI's own
    // rendered error is what gets reported.
    //
    // A `tflw-config fragment` is one section of a config — `require env …`, a lone `defaults`
    // block — shown without the `env` block every real config must also have. It is completed with
    // the fixture's, so "this section is well-formed" is what gets tested rather than "this section
    // is a whole file", which the page never claimed.
    await pool(configs, 8, async (block, i) => {
      const cdir = join(dir, `config-${String(i).padStart(3, '0')}`);
      await mkdir(cdir);
      const source = block.kind === 'config-fragment' ? `${block.source}\n\n${fixture}` : `${block.source}\n`;
      await writeFile(join(cdir, 'tflw.config'), source, 'utf8');
      await writeFile(join(cdir, 'empty.tflw'), '# doc-truth: an empty suite, so only the config is under test\n', 'utf8');
      const { stderr, code } = await runCli(['check', '--format', 'json', 'empty.tflw'], cdir);
      if (code !== 0) fail(`${block.file}:${block.startLine}`, 'tflw.config sample is not valid', stderr.trim());
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runCli(args, cwd) {
  return execFileAsync(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, NO_COLOR: '1' } })
    .then(({ stdout, stderr }) => ({ stdout, stderr, code: 0 }))
    .catch((e) => ({ stdout: e.stdout ?? '', stderr: e.stderr ?? String(e), code: e.code ?? 1 }));
}

function safeJson(text) {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function pool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

// ---------------------------------------------------------------------------
// Documented `tflw …` invocations, against the real flag registry (DT-05).
// ---------------------------------------------------------------------------

/**
 * `CLI_FLAGS` is already the single source `tflw --help` and `reference/cli.md` are both checked
 * against (`cli/test/e2e.test.ts`). The *guide prose* was the one surface that wasn't: twenty-odd
 * invocations spread over nine pages, each naming a subcommand and its flags. A page still showing
 * `--skip-load` after M53 renamed it to `--skip-workload` fails here.
 *
 * Commands come from the shipped binary's own `--help`, not a list kept here — a second list of
 * subcommands is a second thing to forget.
 */
async function checkInvocations(commands) {
  const flagsByCommand = new Map();
  for (const entry of CLI_FLAGS) {
    for (const name of entry.flag.matchAll(/`?(--[a-z-]+|-[a-z])`?/g)) {
      if (!flagsByCommand.has(entry.command)) flagsByCommand.set(entry.command, new Set());
      flagsByCommand.get(entry.command).add(name[1]);
    }
  }
  const global = flagsByCommand.get('global') ?? new Set();

  let count = 0;
  for (const file of findMarkdownFiles(ROOT)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const { line, text } of commandCandidates(lines)) {
      for (const m of text.matchAll(/(?:^|\s)(?:npx )?tflw ([a-z][a-z-]*)([^#|]*)/g)) {
        const [, command, tail] = m;
        count++;
        const where = `${file.slice(ROOT.length + 1)}:${line}`;
        if (!commands.has(command)) {
          fail(where, `documented command \`tflw ${command}\` does not exist`, `\`tflw --help\` knows: ${[...commands].sort().join(', ')}`);
          continue;
        }
        const allowed = new Set([...(flagsByCommand.get(command) ?? []), ...global]);
        for (const f of tail.matchAll(/(?<![\w-])(--[a-z][a-z-]*)/g)) {
          if (!allowed.has(f[1])) {
            fail(where, `\`tflw ${command}\` has no flag \`${f[1]}\``, `CLI_FLAGS lists for \`${command}\`: ${[...allowed].sort().join(' ') || '(none)'}`);
          }
        }
      }
    }
  }
  return count;
}

/**
 * The strings on a page a reader would actually copy and run: a line inside a `sh` fence, and the
 * contents of any inline code span. Prose is deliberately excluded — `index.md` says "what tflw
 * replaces is the glue", and a scanner that reads that as `tflw replaces` reports a command that
 * doesn't exist. A guard whose failures need triage teaches people to ignore it.
 */
function* commandCandidates(lines) {
  let fence;
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s*(`{3,})(.*)$/.exec(lines[i]);
    if (open) {
      if (fence && open[1].length >= fence.ticks.length && open[2].trim() === '') fence = undefined;
      else if (!fence) fence = { ticks: open[1], lang: open[2].trim().split(/\s+/)[0] };
      continue;
    }
    if (fence !== undefined) {
      if (fence.lang === 'sh' && lines[i].trim() !== '') yield { line: i + 1, text: lines[i] };
      continue;
    }
    for (const span of lines[i].matchAll(/`([^`]+)`/g)) yield { line: i + 1, text: span[1] };
  }
}

/** The subcommands the shipped binary actually dispatches, read out of its own usage text. */
async function shippedCommands() {
  const { stdout, code } = await runCli(['--help'], ROOT);
  if (code !== 0) return undefined;
  const found = new Set();
  for (const m of stdout.matchAll(/^\s*tflw ([a-z][a-z-]*)/gm)) found.add(m[1]);
  return found.size > 0 ? found : undefined;
}

// ---------------------------------------------------------------------------
// Run, and report what was covered — including what wasn't (DT-06).
// ---------------------------------------------------------------------------

try {
  readFileSync(CLI);
} catch {
  console.error(`error: the shipped CLI is not built — expected ${CLI}.\n       Run \`npm run build -w @tflw/cli\` first (CI's \`npm run build\` does this).`);
  process.exit(1);
}

await checkSamples();
const commands = await shippedCommands();
let invocations = 0;
if (commands === undefined) fail('tflw --help', 'could not read the shipped CLI\'s command list', 'the invocation check cannot run without it');
else invocations = await checkInvocations(commands);

const count = (kind) => blocks.filter((b) => b.kind === kind).length;
const files = new Set(blocks.map((b) => b.file)).size;
const declaredBy = new Map();
for (const b of blocks) if (b.kind === 'declared') declaredBy.set(b.lang, (declaredBy.get(b.lang) ?? 0) + 1);

const report = [
  `${blocks.length} fenced blocks in ${files} pages`,
  `  ${String(count('file')).padStart(3)} tflw files       parse + checker, via dist/cli.cjs`,
  `  ${String(count('fragment')).padStart(3)} tflw fragments   parse + checker, wrapped in a test`,
  `  ${String(count('config')).padStart(3)} tflw configs     parse + validateConfig, via dist/cli.cjs`,
  `  ${String(count('config-fragment')).padStart(3)} config fragments parse + validateConfig, completed with the fixture env`,
  `  ${String(count('declared')).padStart(3)} declared unchecked: ${[...declaredBy].sort().map(([tag, n]) => `${n} ${tag}`).join(', ') || '(none)'}`,
  `  ${String(count('unclassified')).padStart(3)} unclassified`,
  `${invocations} documented \`tflw …\` invocations checked against CLI_FLAGS`,
];

if (problems.length > 0) {
  for (const p of problems) {
    console.error(`\n✗ ${p.where}\n  ${p.message}`);
    if (p.detail) console.error(`  ${p.detail.split('\n').join('\n  ')}`);
  }
  console.error(`\n${problems.length} doc-truth problem${problems.length === 1 ? '' : 's'}.\n${report.join('\n')}`);
  process.exit(1);
}

console.log(report.join('\n'));
console.log(`${DECLARED_UNCHECKED.size} fence tags are declared unverifiable by design — see PLAN_DOC_TRUTH.md DT-06.`);
