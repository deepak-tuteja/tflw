// M138a (`M136a-02`) — the gate set, held to the workflows that actually decide a merge.
//
// THE ROW said the gate set a contributor must run before pushing is written down nowhere, and
// that this repo has no `CONTRIBUTING.md`. Both halves are wrong in a way that matters. The file is
// absent, but the *artifact* is not: `README.md` has carried a section titled "Contributing
// (working in this monorepo)" listing three commands for as long as the row has been open. The
// problem was never absence. It was **five incomplete copies, none of them checked** —
// `README.md` here, `README.md` in the sibling repo (twice), the row itself, and the plan written
// to close the row.
//
// AND THE COPIES KEPT MISSING DIFFERENT GATES. `M136a-02`'s own list omits `test:links`. The
// milestone seed written five days later to fix the row omits `verify:external-targets`, which had
// arrived in the sibling repo's CI in the meantime. Three consecutive artifacts about the
// missing-gate problem, each missing a gate, each authored by someone reading a source carefully
// and looking for exactly this. That sequence is the argument: prose cannot hold this set, so the
// set is held here and the prose is held to it.
//
// DIRECTION OF AUTHORITY, which is the decision this file encodes (`D452`). `ci.yml` is not a
// description of the gate set — it is the thing that decides whether a merge is allowed. So the
// workflows are authoritative and `CONTRIBUTING.md` is the prose checked against them. That is the
// opposite direction from `M139`'s `plants.mjs` ↔ `VULNS.md` pair, and for a concrete reason: there,
// no machine-readable ledger existed, so one had to be authored and made the source. Here the source
// already exists and already executes.
//
// WHAT IT ACTUALLY ASSERTS, in the order it matters:
//
//   1. Every `run:` step in every workflow is classified below as `gate` / `setup` / `ci-only`,
//      with a written reason. **A step matching no entry fails.** This is the property that would
//      have caught `test:links` and `verify:external-targets`: a new CI step cannot arrive without
//      somebody deciding, in writing, whether a contributor has to run it.
//   2. Every entry still matches a live step, so a deleted step cannot leave a fossil behind.
//   3. Every `gate` carries the command a contributor runs **locally**, which is not always the CI
//      form (the mutation sweep is sharded in CI and positional locally), and `CONTRIBUTING.md`
//      must contain that string **exactly** — not a keyword, the literal command, `xvfb-run -a`
//      prefix included.
//   4. And the reverse: `CONTRIBUTING.md` cannot present a command as a gate that is not in this
//      table.
//
// WHAT IT DELIBERATELY DOES NOT CHECK (`D503`). A gate conditional in YAML — `Coverage` runs only
// on the Node 22 leg — is required to carry a footnote *marker* in `CONTRIBUTING.md`; the
// footnote's prose is not read. Checking sentences for "Node 22" is keyword-guessing, the exact
// failure `verify-coverage-comment.test.mjs` was rewritten to avoid ("a substring ban cannot
// distinguish a claim from a citation"). The same limit is why the box section of `CONTRIBUTING.md`
// is labelled there as unguarded: `scripts/exec.mjs` is untracked (`D14`) and has no CI
// counterpart to be compared against, so nothing here can hold it honest.
//
// SCOPE, and it is wider than the plan measured. `PLAN_M138_CONTRIBUTING.md` classified `ci.yml`.
// This walks **every** workflow in `.github/workflows/`, because scoping a completeness check to one
// filename leaves a hole of precisely the shape the milestone is about — a gate could arrive in
// `docs.yml` and nothing would ask about it. The extra rows cost six lines and close that.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WORKFLOW_DIR = join(ROOT, '.github', 'workflows');

/**
 * Every `run:` command in every workflow, and what a contributor is supposed to do about it.
 *
 *   `gate`    — a contributor runs this before pushing. Carries `local`: the exact command they
 *               type, which may differ from the CI form.
 *   `setup`   — makes a gate runnable. Not a gate itself; a clone does it once, or per environment.
 *   `ci-only` — has no local form at all (log annotations, artifact reassembly across matrix legs).
 *
 * Keyed by `(workflow, job, cmd)` because **class is a property of the step, not of the command**:
 * `npm run build` is a gate in `ci.yml`'s `test` job and setup in its `mutations` job, where it
 * exists only so the sweep has a bundle to mutate.
 *
 * Adding an entry is a deliberate act with a written `why`. That is the whole mechanism.
 */
const CLASSIFIED = [
  // --- ci.yml, job `test` (matrix Node 22/24) ---------------------------------------------------
  { wf: 'ci.yml', job: 'test', cmd: 'npm ci', class: 'setup', why: 'dependency install' },
  {
    wf: 'ci.yml',
    job: 'test',
    cmd: 'npx playwright install chromium firefox',
    class: 'setup',
    why: 'playwright has no postinstall download hook; the browser-arc suites launch real Chromium/Firefox. Once per clone locally, not per run. No `--with-deps` since `M143a` — CONTRIBUTING keeps it because a fresh developer machine may genuinely lack the libraries, and pays the apt cost once rather than fourteen times per run',
  },
  { wf: 'ci.yml', job: 'test', cmd: 'npm run build', class: 'gate', local: 'npm run build', why: 'every workspace compiles, and produces the same bundle `npm publish` would ship' },
  { wf: 'ci.yml', job: 'test', cmd: 'npm run typecheck', class: 'gate', local: 'npm run typecheck', why: 'types across all seven workspaces' },
  {
    wf: 'ci.yml',
    job: 'test',
    cmd: 'xvfb-run -a npm test',
    class: 'gate',
    local: 'xvfb-run -a npm test',
    why: 'the whole suite plus the headcount: `npm test` is `verify-test-counts.mjs`, which chains `test:raw` (seven workspaces) and `test:scripts` and then asserts each ran the number of tests it contains. `xvfb-run -a` is not optional — the watch/pick suites launch real headed browsers and HANG without a display rather than failing',
  },
  { wf: 'ci.yml', job: 'test', cmd: 'npm run verify:observability', class: 'gate', local: 'npm run verify:observability', why: 'a test naming a `TF0xx` its harness cannot emit is a passing test of nothing. Static, seconds' },
  {
    wf: 'ci.yml',
    job: 'test',
    cmd: 'npm run test:links -w @tflw/docs-site',
    class: 'gate',
    local: 'npm run test:links -w @tflw/docs-site',
    why: 'docs anchors and sidebars, read off the built `.vitepress/dist`, so it needs `npm run build` first. Separate from `npm test` for that reason — and it is the gate `M136a-02`\'s own list forgot',
  },
  {
    wf: 'ci.yml',
    job: 'test',
    cmd: 'xvfb-run -a npm run coverage',
    class: 'gate',
    local: 'xvfb-run -a npm run coverage',
    note: '†',
    why: 'GATES since `M86` put `check-coverage` in `.c8rc.json`. Conditional in YAML (`if: matrix.node-version == 22`), which is why it carries a footnote marker rather than a checked sentence',
  },

  // --- ci.yml, job `mutations` (20 shards) ------------------------------------------------------
  { wf: 'ci.yml', job: 'mutations', cmd: 'npm ci', class: 'setup', why: 'dependency install, again — this job is a fresh runner' },
  { wf: 'ci.yml', job: 'mutations', cmd: 'npx playwright install chromium firefox', class: 'setup', why: 'the sweep baselines `tflw`, whose cli suite launches real headed Chromium. `M143a` dropped `--with-deps` here first: this step stalled at 30m on nine of the then-twelve shards of run 32272901684, which applied zero mutations between them' },
  {
    wf: 'ci.yml',
    job: 'mutations',
    cmd: 'npm run build',
    class: 'setup',
    why: 'THE SAME COMMAND AS THE GATE ABOVE, and setup here: the sweep needs a bundle to mutate. This row is why the table is keyed by step rather than by command',
  },
  {
    wf: 'ci.yml',
    job: 'mutations',
    cmd: 'xvfb-run -a node scripts/mutate.mjs --shard=${{ matrix.shard }}/20 --manifest=shard-${{ matrix.shard }}.json',
    class: 'gate',
    local: 'node scripts/mutate.mjs <milestone>',
    why: 'the CI form is a shard of the whole registry and is NOT what anybody types locally: `--shard` is a slice, `--scope` is not a flag, and a bare `npm run verify:mutations` runs the entire registry (tens of minutes). Locally you run the milestone you just wrote. This divergence is the reason `local` exists as a field',
  },

  // --- ci.yml, job `mutation-controls` ----------------------------------------------------------
  {
    wf: 'ci.yml',
    job: 'mutation-controls',
    cmd: 'echo "::error::the mutation shards did not all pass (${{ needs.mutations.result }}) — read the shard jobs for which mutation survived"',
    class: 'ci-only',
    why: 'a log annotation over `needs.mutations.result`; there is no local matrix to collapse',
  },
  { wf: 'ci.yml', job: 'mutation-controls', cmd: 'exit 1', class: 'ci-only', why: 'the second line of that annotation step' },
  {
    wf: 'ci.yml',
    job: 'mutation-controls',
    cmd: 'node scripts/verify-shards.mjs shards --of=20',
    class: 'ci-only',
    why: 'reads the twenty uploaded shard manifests and asserts their union is the registry, and \u2014 since M148 \u2014 that the cost model they were packed by still describes what they cost. Locally the sweep is one process and covers itself',
  },

  // --- docs.yml, job `build` --------------------------------------------------------------------
  { wf: 'docs.yml', job: 'build', cmd: 'npm ci', class: 'setup', why: 'dependency install' },
  { wf: 'docs.yml', job: 'build', cmd: 'npm run build -w @tflw/lang', class: 'setup', why: 'the playground/editor pages import it directly; built subset of the `npm run build` gate' },
  { wf: 'docs.yml', job: 'build', cmd: 'npm run build -w @tflw/runtime', class: 'setup', why: 'ditto, transitively via @tflw/lsp-server' },
  { wf: 'docs.yml', job: 'build', cmd: 'npm run build -w @tflw/lsp-server', class: 'setup', why: 'ditto' },
  { wf: 'docs.yml', job: 'build', cmd: 'npm run build -w @tflw/docs-site', class: 'setup', why: 'renders the site the deploy publishes' },
  {
    wf: 'docs.yml',
    job: 'build',
    cmd: 'npm run test:links -w @tflw/docs-site',
    class: 'ci-only',
    why: 'the deploy\'s own copy of the `ci.yml` gate, on push to `main` after review. A contributor has already run it via the row above, so this step adds no obligation — the class differs from the identical command in `ci.yml` for exactly that reason',
  },
];

/**
 * Gates that are real and are deliberately NOT in any workflow.
 *
 * Checked in **one direction only** — the string must appear in `CONTRIBUTING.md` — because there is
 * no CI step to compare against. That is an honest limit and it is stated rather than papered over.
 */
const ABSENT_FROM_CI = [
  {
    local: 'npm run verify:ledger',
    why: 'its corpus (`REVIEW_FINDINGS.md`) is gitignored on purpose, and a check that skips when its input is missing is green about nothing (`M131-03`). So the guard runs locally before a milestone is called done, and the *suite* verifying the guard runs in CI inside `npm test`',
  },
];

// --- reading the workflows ----------------------------------------------------------------------

/** Every `run:` command in a workflow, as `{job, cmd}`.
 *
 *  Multi-line `run: |` blocks are split into one entry per command line, because a block can mix
 *  classes — the sibling repo's apiV2 block is `npm ci` (setup) followed by two gates. Classifying
 *  the block as a unit would be either blind or noisy.
 *
 *  `${{ ... }}` is left as written. Expanding YAML here would mean reimplementing the matrix, and
 *  the `local` field already answers the question the expansion would be for. */
function runSteps(text) {
  const lines = text.split('\n');
  const out = [];
  let job = null;
  let inJobs = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
    const jobMatch = inJobs && /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (jobMatch) { job = jobMatch[1]; continue; }

    const runMatch = /^(\s*)(?:- )?run:(.*)$/.exec(line);
    if (!runMatch) continue;
    const col = line.indexOf('run:');
    const value = runMatch[2].trim();

    if (value !== '|' && value !== '|-' && value !== '>' && value !== '>-') {
      out.push({ job, cmd: value });
      continue;
    }
    // A block scalar: every following line indented past the `run:` key belongs to it.
    for (let j = i + 1; j < lines.length; j += 1) {
      const body = lines[j];
      if (body.trim() === '') continue;
      const indent = body.length - body.trimStart().length;
      if (indent <= col) break;
      if (body.trim().startsWith('#')) continue;
      out.push({ job, cmd: body.trim() });
    }
  }
  return out;
}

const workflows = readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
const steps = workflows.flatMap((wf) => runSteps(readFileSync(join(WORKFLOW_DIR, wf), 'utf8')).map((s) => ({ wf, ...s })));

const key = (s) => `${s.wf} · ${s.job} · ${s.cmd}`;
const contributing = readFileSync(join(ROOT, 'CONTRIBUTING.md'), 'utf8');

/** The delimited region of `CONTRIBUTING.md` that presents commands as gates. Everything outside it
 *  is free prose; everything inside it is checked both ways. Delimiters rather than heading text so
 *  the section can be retitled without silently turning the guard off. */
function gateRegion() {
  const start = contributing.indexOf('<!-- gates:begin -->');
  const end = contributing.indexOf('<!-- gates:end -->');
  assert.ok(start !== -1 && end > start, 'CONTRIBUTING.md has lost its `<!-- gates:begin -->` / `<!-- gates:end -->` markers — the guard reads that region, so removing them disarms it. Retarget this test rather than deleting them.');
  return contributing.slice(start, end);
}

/** Command lines inside fenced blocks in that region, each split from any trailing `#` comment.
 *  The comment is where a footnote marker lives; the command is what is matched exactly. */
function claimedGates() {
  const region = gateRegion();
  const out = [];
  let fenced = false;
  for (const raw of region.split('\n')) {
    if (/^\s*```/.test(raw)) { fenced = !fenced; continue; }
    if (!fenced) continue;
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const hash = line.indexOf(' #');
    out.push({ cmd: (hash === -1 ? line : line.slice(0, hash)).trim(), comment: hash === -1 ? '' : line.slice(hash + 1) });
  }
  return out;
}

// --- the assertions -------------------------------------------------------------------------------

test('every run: step in every workflow is classified', () => {
  const known = new Set(CLASSIFIED.map(key));
  const unknown = steps.filter((s) => !known.has(key(s)));
  assert.deepEqual(
    unknown.map(key),
    [],
    `unclassified CI step(s). A step must not arrive without somebody deciding, in writing, whether a contributor has to run it before pushing — that decision going unmade is M136a-02 itself.\n` +
      `    Add an entry to CLASSIFIED in this file: gate (and name its local form in CONTRIBUTING.md), setup, or ci-only, each with a why.`,
  );
});

test('every classification entry still matches a live step', () => {
  const live = new Set(steps.map(key));
  const fossils = CLASSIFIED.filter((c) => !live.has(key(c)));
  assert.deepEqual(
    fossils.map(key),
    [],
    'classification entr(ies) matching no CI step. A deleted or edited step leaves a fossil that reads as coverage — this is the direction that makes the table a pair with the workflows rather than a list beside them. Delete the entry, or fix the command text it no longer matches.',
  );
});

test('every gate names the exact command a contributor runs, and CONTRIBUTING.md carries it verbatim', () => {
  const region = gateRegion();
  for (const entry of CLASSIFIED.filter((c) => c.class === 'gate')) {
    assert.ok(entry.local, `${key(entry)} is classed \`gate\` but names no local form — a gate a contributor cannot type is not a gate`);
    assert.ok(
      region.includes(entry.local),
      `CONTRIBUTING.md's gate list does not contain \`${entry.local}\` (the local form of ${key(entry)}).\n` +
        `    Exact string, not a keyword — wrong flags are a mismatch, which is the entire objection this check exists to answer.`,
    );
  }
});

test('the gates absent from CI are named too, in the one direction that exists', () => {
  const region = gateRegion();
  for (const entry of ABSENT_FROM_CI) {
    assert.ok(
      region.includes(entry.local),
      `CONTRIBUTING.md's gate list does not contain \`${entry.local}\`, which is a real gate with no CI step to compare against — so this assertion is the only thing holding it, and it must not be quietly dropped`,
    );
  }
});

test('CONTRIBUTING.md claims no gate the classification does not carry', () => {
  const allowed = new Set([...CLASSIFIED.filter((c) => c.class === 'gate').map((c) => c.local), ...ABSENT_FROM_CI.map((c) => c.local)]);
  const invented = claimedGates().filter((g) => !allowed.has(g.cmd));
  assert.deepEqual(
    invented.map((g) => g.cmd),
    [],
    'CONTRIBUTING.md presents command(s) as gates that this file does not classify. Prose cannot invent a gate any more than it can omit one — either classify it here, or move it out of the gates region (setup and environment notes belong outside it).',
  );
});

test('a gate that is conditional in YAML is flagged in CONTRIBUTING.md', () => {
  // The marker is checked; the footnote's sentence is NOT read. See this file's header — asserting
  // that prose contains "Node 22" is keyword-guessing, and a check that cannot tell a claim from a
  // citation punishes the comments that document themselves.
  const claimed = claimedGates();
  for (const entry of CLASSIFIED.filter((c) => c.class === 'gate' && c.note)) {
    const line = claimed.find((g) => g.cmd === entry.local);
    assert.ok(line, `\`${entry.local}\` is not in the gate list at all`);
    assert.ok(
      line.comment.includes(entry.note),
      `\`${entry.local}\` does not run unconditionally in CI, and its line in CONTRIBUTING.md carries no \`${entry.note}\` marker. The marker is what sends a reader to the footnote; the footnote's wording is deliberately not checked.`,
    );
  }
});

test('README.md points at CONTRIBUTING.md rather than listing commands of its own', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  assert.match(
    readme,
    /CONTRIBUTING\.md/,
    'README.md no longer points at CONTRIBUTING.md. It listed three of the eight gates for the whole life of M136a-02; a pointer is the only version of that section that cannot go stale.',
  );
  for (const entry of CLASSIFIED.filter((c) => c.class === 'gate')) {
    assert.ok(
      !readme.includes(`\n${entry.local}\n`),
      `README.md carries \`${entry.local}\` as a standalone command line again. That is the second copy this milestone deleted — the gate list has one home, and every other place points at it.`,
    );
  }
});

test('CONTRIBUTING.md points at the sibling repo for the cross-repo pair', () => {
  // Owned there (`D502`): it is the repo where it fails, and its README has documented it correctly
  // and at length. Duplicating the command into both files re-creates the drift this milestone
  // exists to stop. That the pointer *resolves* is asserted on the other side, in the one CI job
  // that checks out both trees.
  assert.match(
    contributing,
    /testFlow-tests\/CONTRIBUTING\.md/,
    'CONTRIBUTING.md must point at `testFlow-tests/CONTRIBUTING.md` for the cross-repo diagnostic-code pair. A tflw milestone that assigns a TF0xx code is not done until its companion PR there has merged, and nothing automatic catches it.',
  );
});
