// Doc truth (M62, review finding OBS-01) — the guard that keeps the documentation honest.
//
// Four properties, in the order they matter:
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
//  4. **A forward-looking claim is declared or it fails** (`M149b`/`D657`). The other three checks
//     all ask whether a sample still *works*. This one asks whether a sentence is still *true*, for
//     the one class that reliably stops being true without anyone touching the page: a statement
//     about what tflw will do next. It had shipped twice.
//  5. **A shipped construct is documented or declared** (`M149f`/`D659`). (4) is a denylist and
//     catches the sentence that went wrong; this is its positive dual and catches the sentence that
//     was never written — the larger half. Three constructs fully specified in `SPEC.md` appeared on
//     no page at all, and no phrase list could have found them: an absent page matches no grep.
//
// Plus: every `tflw …` invocation the docs show is validated against the real flag registry.
// See PLAN_DOC_TRUTH.md for the decisions (DT-01 … DT-09).

import { execFile } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { census, findMarkdownFiles, roadmapFiles, scanRoadmapClaims, scanConstructCoverage, scanPrivateNotation, DECLARED_ROADMAP, DECLARED_UNCHECKED, DECLARED_UNDOCUMENTED, INCLUDED_RECORDS, NOTATION, ROADMAP_PHRASES } from './doc-blocks.mjs';
import { CLI_FLAGS } from '@tflw/lang';
// The whole namespace, because the *page* decides which manifest it renders: `constructCorpus`
// reads each page's own `import { … } from '…spec-data.ts'` and matches it against a `v-for`. Naming
// a subset here would silently drop a table — `reference/diagnostics.md` was the one it dropped.
import * as manifests from '@tflw/lang';

const execFileAsync = promisify(execFile);
const here = fileURLToPath(new URL('.', import.meta.url));
// Overridable so the guard's own tests can point it at a fixture corpus — a doc-truth guard that
// is never itself run against a known-bad input is the unearned confidence it exists to remove.
const ROOT = process.env.TFLW_DOCS_ROOT ?? join(here, '..');
const CLI = join(here, '../../cli/dist/cli.cjs');
const FIXTURE_CONFIG = join(here, 'fixtures/tflw.config');
const FIXTURE_SESSIONS = join(here, 'fixtures/sessions.config');
const FIXTURE_SUITE = join(here, 'fixtures/suite');

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
  // The synthetic `api` step is the same kind of scaffolding as the `threshold` below, for M87's
  // `TF039`: a fragment teaching `expect body …` or `capture …` is *about* a response, and the
  // request that produced it is exactly the enclosing context the page omits on purpose. Supplied
  // unconditionally rather than behind a directive — every fragment is checked as steps inside a
  // real test, and a real test made a request before it asserted on one.
  const preamble = [
    'test "docs fragment"',
    '  api GET /docs-fixture',
    ...block.binds.map((name) => `  let ${name} = "docs-fixture"`),
  ];
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

    // The docs' *file* surface, alongside the fixture config's service/session surface (M97c).
    // `TF043` checks that a path literal names something real, and a guide sample naming
    // `./shared/create.tflw` is describing a project layout it expects the reader to have — so the
    // sandbox gets that layout rather than the rule getting an exemption. Two things follow, both
    // wanted: a doc that names a path with no fixture fails with `TF043` pointing at the line, and
    // an `import` that now *resolves* closes `checkCalls`' world, so a sample calling an action the
    // imported file does not declare is caught instead of waved through as "world unknown".
    await cp(FIXTURE_SUITE, dir, { recursive: true });

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

// ---------------------------------------------------------------------------
// Command coverage — every shipped subcommand is documented (M110, `V4-02`/`V4-03`).
// ---------------------------------------------------------------------------

/**
 * `DT-05` above already refuses a documented command that does not exist. This is the other
 * direction — a command that exists and is documented **nowhere** — and it is the one that was
 * actually wrong.
 *
 * `tflw lsp` shipped in M13 and reached `--help`, the extension, and its own `/editor` page, but
 * never got a row in SPEC §12 or a section in `reference/cli.md`. It stayed missing for eleven
 * milestones because the command list is written out by hand six times (the `switch` in `cli.ts`,
 * its unknown-command message, `printUsage()`, SPEC §12, this reference page, and
 * `CliFlagEntry.command`'s union) and nothing compared any two of them. Three of the six were
 * wrong, each differently.
 *
 * Both surfaces are read the way a reader meets them: the reference page as its own markdown, and
 * SPEC §12 through `tflw docs cli` — the *shipped binary's* copy, per `DT-04`, since that is what
 * `docs-data.generated.ts` bakes in and what a user without the repo actually gets.
 *
 * Symmetric on purpose. A command deleted from the dispatch but left in the docs is the M57 bug
 * class (`spec-data.ts` documenting a `tflw load` that no longer existed), so an extra row fails
 * here exactly like a missing one.
 */
async function checkCommandCoverage(commands) {
  let page;
  try {
    page = readFileSync(join(ROOT, 'reference/cli.md'), 'utf8');
  } catch {
    // `DT-08`'s scratch corpora are a handful of pages, not the site; there is no reference page to
    // cover. Reported as skipped rather than passed — a check that quietly returns green on an
    // empty corpus is the thing this file exists to catch.
    return null;
  }
  const sections = new Set([...page.matchAll(/^## `tflw ([a-z][a-z-]*)/gm)].map((m) => m[1]));

  const { stdout, code } = await runCli(['docs', 'cli'], ROOT);
  // Only the ✅ Shipped table counts: a command listed under 🔮 Planned is documented as *absent*,
  // which is worse than silence for something that ships.
  const shipped = code === 0 ? stdout.split(/\*\*🔮 Planned/)[0] : undefined;
  const rows = shipped === undefined ? undefined : new Set([...shipped.matchAll(/^\| `tflw ([a-z][a-z-]*)/gm)].map((m) => m[1]));
  if (rows === undefined) fail('tflw docs cli', 'could not read SPEC §12 out of the shipped binary', 'the command-coverage check cannot run without it');

  for (const command of [...commands].sort()) {
    if (!sections.has(command)) {
      fail('reference/cli.md', `\`tflw ${command}\` ships but has no section here`, `add a \`## \\\`tflw ${command}\\\`\` heading — this page claims to cover every subcommand`);
    }
    if (rows !== undefined && !rows.has(command)) {
      fail('SPEC.md §12', `\`tflw ${command}\` ships but has no row in the ✅ Shipped table`, 'SPEC §12 is what `tflw docs cli` prints, so a missing row is missing from the shipped binary too');
    }
  }
  for (const documented of [...sections].sort()) {
    if (!commands.has(documented)) fail('reference/cli.md', `\`tflw ${documented}\` is documented but not dispatched`, `\`tflw --help\` knows: ${[...commands].sort().join(', ')}`);
  }
  for (const documented of [...(rows ?? [])].sort()) {
    if (!commands.has(documented)) fail('SPEC.md §12', `\`tflw ${documented}\` is in the ✅ Shipped table but not dispatched`, `\`tflw --help\` knows: ${[...commands].sort().join(', ')}`);
  }
  return commands.size;
}

// ---------------------------------------------------------------------------
// Flag prose — the cross-references inside `CLI_FLAGS`' own `effect` text (M86).
// ---------------------------------------------------------------------------

/** Flag spellings that no longer exist and are named in prose on purpose, each with the reason.
 *  A name here that is *also* a live flag fails the run: the entry has outlived its excuse. */
const RETIRED_FLAGS = new Map([
  ['--skip-load', 'renamed to `--skip-workload` (M53/D110); the entry names the old spelling so a reader searching for it lands on the new one'],
]);

/**
 * `checkInvocations` above validates flag names in *guide prose*. This validates flag names inside
 * `CLI_FLAGS`' own `effect` strings — the fourth surface, and the one with the widest reach: the
 * same sentence is printed by `tflw --help`, rendered on `reference/cli.md`, and quoted into
 * `docs-data.generated.ts`. Nothing checked it, so a flag renamed in one place kept being named by
 * its dead spelling in another's explanation.
 *
 * **What this cannot do, stated plainly.** It checks that every flag a flag's prose *names* exists.
 * It cannot check that the prose is *true*. `B5-04` — `--workers`' description asserting what
 * `--parallel` does — is invisible here and to every other name-based guard, because both names
 * exist and both are spelled correctly. That class survived two `CLI_FLAGS` entries until M78 and
 * would survive this guard too. The summary line says so rather than letting "docs verified" be
 * read as "docs are right"; a guard that overstates its own reach is the defect it exists to catch.
 */
function checkFlagProse() {
  const declared = new Set();
  for (const entry of CLI_FLAGS) {
    for (const m of entry.flag.matchAll(/(--[a-z][a-z-]*)/g)) declared.add(m[1]);
  }

  for (const [name, why] of RETIRED_FLAGS) {
    if (declared.has(name)) {
      fail('spec-data.ts CLI_FLAGS', `\`${name}\` is in RETIRED_FLAGS but is a live flag again`, `the exemption reads: ${why}`);
    }
  }

  let references = 0;
  for (const entry of CLI_FLAGS) {
    for (const m of entry.effect.matchAll(/(?<![\w-])(--[a-z][a-z-]*)/g)) {
      references++;
      const name = m[1];
      if (declared.has(name) || RETIRED_FLAGS.has(name)) continue;
      fail(
        `spec-data.ts CLI_FLAGS \`${entry.flag}\` (${entry.command})`,
        `its description names \`${name}\`, which no flag declares`,
        `\`tflw --help\` and reference/cli.md both print this sentence. If \`${name}\` was renamed, name the new flag; if the mention is deliberate history, add it to RETIRED_FLAGS with the reason.`,
      );
    }
  }
  return references;
}

// ---------------------------------------------------------------------------
// Roadmap truth — a forward-looking claim is declared, or it fails (`D657`/`D658`).
// ---------------------------------------------------------------------------


/**
 * `D659`. The manifests come from `@tflw/lang` and the grammar from the file `grammarCoverage.test.ts`
 * holds to the parser, so nothing here is a wordlist this script maintains — see
 * `scanConstructCoverage`.
 *
 * **Skipped for a scratch corpus, and said out loud** — the third check here to need that and the
 * clearest case for it. The manifests and the grammar describe *this* language; a `DT-08` fixture
 * documents an invented one, so every construct in the real language would be missing from it and
 * the guard's own tests could never be green. The break this check has to demonstrate is asserted
 * against `scanConstructCoverage` directly in `doc-blocks.test.mjs`, where the corpus and the
 * grammar are supplied together and a fixture can be genuinely incomplete.
 */
function checkConstructCoverage() {
  if (process.env.TFLW_DOCS_ROOT !== undefined) return null;
  const files = findMarkdownFiles(ROOT).map((path) => ({ key: relative(ROOT, path), text: readFileSync(path, 'utf8') }));
  const constructs = manifests.specConstructs();
  // `D538`'s class: a consumer that reads a manifest without pinning its shape is a gate that goes
  // quietly empty when the shape changes. The version is the pin; the count is not, and must not be.
  if (manifests.SPEC_MANIFEST_VERSION !== 1) {
    fail(
      'spec-data.ts',
      `the construct manifest is at version ${manifests.SPEC_MANIFEST_VERSION}, and this gate was written against 1`,
      'Re-read constructMatchers against the new shape before bumping the number here — see D790.',
    );
  }
  const result = scanConstructCoverage({ files, constructs, manifests });
  for (const p of result.problems) fail(p.where, p.message, p.detail);
  return result;
}

// ---------------------------------------------------------------------------
// The private notation stays off the pages a user reads (`D673`, `D706`).
// ---------------------------------------------------------------------------

/**
 * `D706`'s file set: the pages a human wrote, and **not** the repo records the site `@include`s.
 *
 * The contrast with `roadmapFiles()` above is the point and is deliberate. That one reaches
 * *through* the shims by hand-adding `CHANGELOG.md`, because a stale roadmap claim is a lie
 * wherever it renders. This one stops at them, because a citation inside a declared record is
 * provenance rather than an artifact. Both are decisions; neither is the shape of the file walk.
 *
 * So this passes the shim pages **in** rather than filtering them out here — `scanPrivateNotation`
 * skips them by name and checks each is still a shim, which a filter written at this call site
 * could not do.
 */
function checkPrivateNotation() {
  const files = findMarkdownFiles(ROOT).map((path) => ({ key: relative(ROOT, path), text: readFileSync(path, 'utf8') }));
  const { problems: found, scanned } = scanPrivateNotation(files);
  for (const p of found) fail(p.where, p.message, p.detail);
  return { scanned, pages: files.length };
}

function checkRoadmapClaims() {
  // `DT-08`'s scratch corpora name their page `index.md`, which is a real page here — so the
  // staleness half of the allowlist is real-corpus only. Reported below rather than dropped.
  const checkStale = process.env.TFLW_DOCS_ROOT === undefined;
  const { problems: found, claims, files } = scanRoadmapClaims(roadmapFiles(ROOT), { checkStale });
  for (const p of found) fail(p.where, p.message, p.detail);
  return { claims, files, checkStale };
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
let covered = null;
if (commands === undefined) fail('tflw --help', 'could not read the shipped CLI\'s command list', 'the invocation and coverage checks cannot run without it');
else {
  invocations = await checkInvocations(commands);
  covered = await checkCommandCoverage(commands);
}
const flagReferences = checkFlagProse();
const roadmap = checkRoadmapClaims();
const coverage = checkConstructCoverage();
const notation = checkPrivateNotation();

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
  covered === null
    ? 'command coverage skipped — this corpus has no reference/cli.md'
    : `${covered} shipped subcommands, each with a reference/cli.md section and a SPEC §12 shipped row`,
  `${flagReferences} flag references inside CLI_FLAGS' own descriptions checked — names, not effects:`,
  `    a description that names a flag correctly and describes the wrong behaviour still passes (B5-04).`,
  `${notation.scanned} hand-written pages checked for this project's private notation (${NOTATION.length} shapes),`,
  `    fenced blocks and <script> blocks excluded — plus the ${INCLUDED_RECORDS.size} pages that @include a repo record`,
  `    verbatim, which keep their citations because each record is declared and resolves in DECISIONS.md (D706).`,
  `${roadmap.claims} forward-looking claims found across ${roadmap.files} files (${ROADMAP_PHRASES.length} idioms,`,
  `    raw text including frontmatter, plus README.md and the ${INCLUDED_RECORDS.size} records the site @includes) — each one`,
  `    declared in DECLARED_ROADMAP with the reason it is legitimately future.`,
  roadmap.checkStale
    ? `    ${[...DECLARED_ROADMAP.values()].flat().length} declared exemptions, each still matching a line it names.`
    : '    stale-exemption check skipped — this corpus is a scratch one, not the site.',
  ...(coverage === null
    ? ['construct coverage skipped — this corpus is a scratch one, documenting an invented language']
    : [
        `${coverage.constructs} shipped constructs checked against ${coverage.corpus} code strings on the site`,
        `    (spec-data.ts's specConstructs(), held to parser.ts by specManifest.test.ts — matched on`,
        `    each construct's own syntax shape, never on its bare id, so an ordinary English word is`,
        `    not coverage), less the ${manifests.DIAGNOSTICS.length} diagnostics that diagnosticsCoverage.test.ts already holds.`,
        `    ${DECLARED_UNDOCUMENTED.size} declared deliberately undocumented.`,
        coverage.onlyGenerated.length === 0
          ? '    every one of them is named in prose or a sample.'
          : `    ${coverage.onlyGenerated.length} appear only in a generated reference table — listed, not explained:`,
        ...(coverage.onlyGenerated.length === 0 ? [] : [`      ${coverage.onlyGenerated.join(', ')}`]),
      ]),
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
