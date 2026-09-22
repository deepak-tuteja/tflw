// `M215-01`, second half — a sixth walk cannot appear without the walker (`M232`, `D1274`).
//
// **A SHARED HELPER NOBODY IS REQUIRED TO USE DOES NOT ANSWER THIS ROW.** `scripts/tflw-corpus.mjs`
// removes the copies that exist; the row's own sentence is about the copy that has not been
// written yet — *the day a fourth walk appears it will not have the guard* — and only a gate that
// reads source can make that false. This repository already scans its own source this way
// (`self-mutations.mjs`, `verify-own-identifiers.mjs`).
//
// The row was filed as three copies, corrected to four, counted at five, and the build that closed
// it found **eight**: five recursive walks and three flat reads. So the scan looks for the shape
// rather than for the walk — a directory read whose result is filtered by `.tflw` — which is what
// the three flat reads were and what no count of "walks" was ever going to catch.
//
// **THE PLANT IS NOT OPTIONAL.** A source-scanning gate with no negative control is this arc's
// vacuity class in a new costume: it passes on a repository it cannot read, on a pattern that
// matches nothing, and on a scan that was silently pointed at an empty directory. So `problems`
// takes its corpus as an argument and the plant is a string.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tflwFiles, tflwIn } from './tflw-corpus.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The one file entitled to read a directory and keep the `.tflw` files out of it. */
const WALKER = 'scripts/tflw-corpus.mjs';

/**
 * **The product walks a user's project, and that is a different subject** — one reason, stated
 * once, covering both places rather than a list.
 *
 * `tflw fmt` and the LSP's `discoverProjectFiles` find `.tflw` files in **somebody else's**
 * directory, as shipped features with their own rules about what to skip. The corpus walk is about
 * *this repository's own authored corpus*, and its dot-prefix guard exists because the product
 * writes `.scratch.tflw` and `.play.tflw` into projects that gates here happen to read. Pointing
 * either of these at `tflwFiles` would be replacing a feature's rule with a gate's.
 *
 * This file is the third, for the reason `gen-decisions.mjs` already records about its own scrub:
 * **a guard whose corpus contains its own source cannot spell its own specimens.** The plants below
 * are the shape being forbidden, written out.
 */
const EXEMPT = new Set([WALKER, 'packages/cli/src/cli.ts', 'packages/lsp-server/src/workspace/workspaceIndex.ts', 'scripts/corpus-walk.test.mjs']);

/**
 * How near a `.tflw` mention has to be to count as *this read is for the corpus*.
 *
 * Twelve lines, because a read and its filter are adjacent in every shape this repository has
 * written — the tightest was one line apart and the loosest (`verify-fmt-roundtrip.mjs`'s old
 * walk, with the dot-guard comment between them) was nine. A whole-file rule was tried first and
 * is wrong: `ui-server.ts` reads report directories and separately names `.scratch.tflw`, and
 * flagging it would make the gate a list of exemptions rather than a rule.
 */
const NEAR = 12;

/**
 * The shape, not the mention. A corpus walk **filters entries by extension**; a test that asserts
 * `readdir` returned `['object-leak-….tflw']` merely names one, and `ui-server.ts` reads a report
 * directory ten lines from a `.scratch.tflw` constant. Matching the mention flagged all three and
 * would have made this a list of exemptions rather than a rule.
 */
const FILTERS_BY_TFLW = /endsWith\(\s*['"`]\.tflw['"`]\s*\)|\/\\\.tflw\$\/\s*\.test\(|extname\([^)]*\)\s*===\s*['"`]\.tflw['"`]/;

/**
 * @param {{path: string, text: string}[]} files
 * @returns {{file: string, line: number, excerpt: string}[]}
 */
export function problems(files) {
  const found = [];
  for (const { path, text } of files) {
    if (EXEMPT.has(path)) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (!/\breaddirSync\s*\(|\breaddir\s*\(/.test(lines[i])) continue;
      const window = lines.slice(i, i + NEAR + 1).join('\n');
      if (!FILTERS_BY_TFLW.test(window)) continue;
      found.push({ file: path, line: i + 1, excerpt: lines[i].trim() });
    }
  }
  return found;
}

const SKIP_DIR = /^(node_modules|dist|coverage|runs|report)$/;
const SOURCE = /\.(ts|tsx|mjs|js)$/;

/** This repository's own source, which is the corpus this gate reads (`D874`). */
function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) {
        if (SKIP_DIR.test(e.name)) continue;
        walk(join(dir, e.name));
      } else if (SOURCE.test(e.name)) {
        out.push(join(dir, e.name));
      }
    }
  };
  for (const root of ['packages', 'scripts', 'examples']) walk(join(ROOT, root));
  return out.sort().map((p) => ({ path: relative(ROOT, p).split('\\').join('/'), text: readFileSync(p, 'utf8') }));
}

test('THE CLAIM: nothing reads a directory for `.tflw` files except the corpus walker', () => {
  const files = sourceFiles();
  // **The corpus asserts itself**, because a scan pointed at nothing passes every rule it has.
  assert.ok(files.length > 300, `the source scan found ${files.length} files — it is not reading this repository`);
  const found = problems(files);
  assert.deepEqual(
    found,
    [],
    `these read a directory for \`.tflw\` files outside \`${WALKER}\` — import \`tflwFiles\` or \`tflwIn\` instead, ` +
      `so the dot-prefix guard is not written a ninth time:\n${found.map((f) => `  ${f.file}:${f.line}  ${f.excerpt}`).join('\n')}`,
  );
});

test('the plant: a sixth walk is caught', () => {
  /* The shape a person would write without knowing the walker exists — and it is the shape that
     was already written eight times, so this is not a hypothetical. */
  const planted = `
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        if (entry.endsWith('.tflw')) out.push(join(dir, entry));
      }
    };`;
  assert.deepEqual(problems([{ path: 'packages/lang/test/sixth.test.ts', text: planted }]).map((p) => p.line), [3]);
  /* And the flat form, which is what the three reads the row never counted actually looked like. */
  const flat = `const files = readdirSync(EXAMPLE).filter((n) => n.endsWith('.tflw'));`;
  assert.equal(problems([{ path: 'packages/lang/test/flat.test.ts', text: flat }]).length, 1);
});

test('the control for the plant: a directory read that is not about `.tflw` is not a problem', () => {
  /* Without this, a gate that flagged every `readdirSync` in the repository would pass both tests
     above and be unusable — which is the failure mode a plant alone cannot see. */
  const unrelated = `
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.json')) out.push(name);
    }`;
  assert.deepEqual(problems([{ path: 'scripts/whatever.mjs', text: unrelated }]), []);
  /* And distance is real: a read here and a `.tflw` constant far below it are two facts, not one. */
  const far = `readdirSync(reportDir);\n${'\n'.repeat(NEAR + 2)}const SCRATCH = '.scratch.tflw';`;
  assert.deepEqual(problems([{ path: 'packages/cli/src/ui-server.ts', text: far }]), []);
});

test('the exemptions are four, each still a file, and a copy of the walker under another name is not one', () => {
  const walkerText = readFileSync(join(ROOT, WALKER), 'utf8');
  assert.equal(problems([{ path: WALKER, text: walkerText }]).length, 0, 'the walker is allowed to be the walk');
  assert.ok(problems([{ path: 'scripts/tflw-corpus-copy.mjs', text: walkerText }]).length > 0, 'and a copy of it under any other name is not');
  /* Every exemption still has to name a file that exists, or the set becomes a place where a rule
     goes to be forgotten. */
  for (const f of EXEMPT) assert.ok(existsSync(join(ROOT, f)), `${f} is exempted and is not here`);
});

/* ── And the walker does what the five copies did — `M215-01` (`D1274`) ────────────────────────
 *
 * The scan above is about *nobody writing a ninth copy*. It says nothing at all about whether the
 * one copy is **correct**, and without these a mutation that dropped the dot-prefix guard would
 * redden nothing in this repository: the guard only matters when the product has written a
 * `.scratch.tflw` or a `.play.tflw`, which no checkout has by default and which is precisely why
 * the defect `M215` records cost three corpus failures before anyone saw it.
 */

test('the guard: a dot-prefixed `.tflw` is not part of the authored corpus, at any depth', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-corpus-'));
  try {
    await mkdir(join(dir, 'tests'), { recursive: true });
    await writeFile(join(dir, 'tests', 'shop.tflw'), 'test "t"\n');
    /* The two the product writes on purpose: `SCRATCH_PATH` at the project root (`M215`), and
       `PLAY_SCRATCH` in the file's own directory (`D1184`) — which is the one that arrived later
       and reached two gates the row never counted. */
    await writeFile(join(dir, '.scratch.tflw'), 'test "sent"\n');
    await writeFile(join(dir, 'tests', '.play.tflw'), 'test "played"\n');
    /* A dot-prefixed DIRECTORY too, which is where the five copies had actually drifted apart. */
    await mkdir(join(dir, '.checkonly'), { recursive: true });
    await writeFile(join(dir, '.checkonly', 'broken.tflw'), 'this is not tflw\n');

    assert.deepEqual(
      tflwFiles(dir).map((p) => relative(dir, p).split('\\').join('/')),
      ['tests/shop.tflw'],
      'deleting a file the product writes on purpose is not a repair — the walk has to decline it',
    );
    assert.deepEqual(tflwIn(join(dir, 'tests')).map((p) => relative(dir, p).split('\\').join('/')), ['tests/shop.tflw'], 'and the flat read applies the same rule');

    /* **The control**, because every assertion above is an absence: a walk that returned nothing at
       all would satisfy all three. */
    await writeFile(join(dir, 'tests', 'cart.tflw'), 'test "t"\n');
    assert.equal(tflwFiles(dir).length, 2, 'an ordinary `.tflw` added beside them is found');
    assert.equal(tflwIn(join(dir, 'tests')).length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('…and the skipped directories are skipped, while a missing root is not an error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-corpus-skip-'));
  try {
    for (const d of ['node_modules', 'dist', 'runs', 'coverage', 'report']) {
      await mkdir(join(dir, d), { recursive: true });
      await writeFile(join(dir, d, 'copy.tflw'), 'test "t"\n');
    }
    await writeFile(join(dir, 'real.tflw'), 'test "t"\n');
    assert.deepEqual(tflwFiles(dir).map((p) => relative(dir, p)), ['real.tflw'], 'build output and pulled run artefacts are copies, not sources');
    /* `print.test.ts` and `outline.test.ts` point one root at the sibling repository, which is
       **pressure and never a number** (`D1056`) and is simply absent on a machine without it. */
    assert.deepEqual(tflwFiles(join(dir, 'no-such-directory')), [], 'an absent root contributes nothing rather than throwing');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
