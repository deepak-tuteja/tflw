// The docs guard, run against corpora whose defects are known (M62, DT-08).
//
// `OBS-03` is this failure mode one level down: a test *named* for redaction that never asserted
// the secret was absent, so redaction looked covered for months. A guard nothing ever fails is the
// same shape — its green line is an assumption, not a result. Each case here breaks the docs in one
// specific way and asserts the guard notices.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const SCRIPT = fileURLToPath(new URL('verify-docs.mjs', import.meta.url));

/**
 * Write `pages` into a scratch corpus and run the guard over it.
 *
 * `docsRoot` points `TFLW_DOCS_ROOT` at a *subdirectory* of the corpus instead of its top. Only the
 * roadmap check needs it, and it needs it for the reason `D658` exists: two of the files that check
 * reads — `README.md` and `CHANGELOG.md` — are not under the docs root at all, they are two levels
 * above it. A corpus laid out flat cannot tell whether the guard reaches them, so the one test that
 * makes that claim reproduces the real `packages/docs-site` layout instead of asserting around it.
 */
async function guard(pages, { docsRoot = '.' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tflw-doc-truth-test-'));
  try {
    for (const [name, body] of Object.entries(pages)) {
      const path = join(root, name);
      if (name.includes('/')) await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, body, 'utf8');
    }
    const env = { ...process.env, TFLW_DOCS_ROOT: join(root, docsRoot), NO_COLOR: '1' };
    return await execFileAsync(process.execPath, [SCRIPT], { env })
      .then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }))
      .catch((e) => ({ code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const SOUND = `# A page

\`\`\`tflw
test "health check"
  api GET /health
  expect status equals 200
\`\`\`

\`\`\`tflw fragment
expect status equals 200
\`\`\`

\`\`\`sh
npx tflw run --bail
\`\`\`

\`\`\`console
✓ health check (16 ms)
\`\`\`
`;

test('a sound corpus passes, and says what it covered', async () => {
  const { code, stdout } = await guard({ 'index.md': SOUND });
  assert.equal(code, 0, stdout);
  assert.match(stdout, /1 tflw files/);
  assert.match(stdout, /1 tflw fragments/);
  assert.match(stdout, /0 unclassified/);
  assert.match(stdout, /2 declared unchecked/);
});

test('an untagged fence fails the run — the hole OBS-01 filed', async () => {
  const { code, stderr } = await guard({ 'index.md': '# x\n\n```\napi GET /health\n```\n' });
  assert.equal(code, 1);
  assert.match(stderr, /untagged fence/);
});

test('a checker-level defect is caught, which parse-only checking missed', async () => {
  // The exact sample that shipped broken at review baseline c6409d1 while the guard printed
  // `28/28 … parse cleanly`: `{id}` is bound nowhere, and TF030 is a checker diagnostic.
  const { code, stderr } = await guard({
    'index.md': '# x\n\n```tflw\ntest "browsing"\n  api GET /products/{id}\n  expect status equals 200\n```\n',
  });
  assert.equal(code, 1);
  assert.match(stderr, /TF030/);
  assert.match(stderr, /unknown variable "id"/);
});

test('a diagnostic is reported at the line of the page, not of the temp file', async () => {
  const page = ['# x', '', 'prose', '', '```tflw fragment', 'api GET /orders', 'api GET /orders/{nope}', '```', ''].join('\n');
  const { stderr } = await guard({ 'index.md': page });
  // `{nope}` is the 7th line of the page; a fragment is wrapped in a synthetic `test`, so an
  // off-by-one in the offset maths would point the reader at a neighbouring line.
  assert.match(stderr, /index\.md:7/);
});

test('a fragment may declare the variables it illustrates — and only those', async () => {
  const ok = await guard({ 'index.md': '# x\n\n```tflw fragment binds=orderId\nopen "/orders/{orderId}"\n```\n' });
  assert.equal(ok.code, 0, ok.stderr);

  // A typo in an interpolation still fails: `binds` names one variable, the sample uses another.
  const typo = await guard({ 'index.md': '# x\n\n```tflw fragment binds=orderId\nopen "/orders/{orderid}"\n```\n' });
  assert.equal(typo.code, 1);
  assert.match(typo.stderr, /TF030/);
});

test('a documented flag that does not exist fails', async () => {
  // `--skip-load` was renamed to `--skip-workload` in M53. A page still showing the old name reads
  // as current and fails on the reader's machine, not ours.
  const { code, stderr } = await guard({ 'index.md': '# x\n\n```sh\nnpx tflw run --skip-load\n```\n' });
  assert.equal(code, 1);
  assert.match(stderr, /has no flag `--skip-load`/);
});

test('a flag documented for the wrong subcommand fails', async () => {
  const { code, stderr } = await guard({ 'index.md': '# x\n\n```sh\nnpx tflw check --bail\n```\n' });
  assert.equal(code, 1);
  assert.match(stderr, /`tflw check` has no flag `--bail`/);
});

test('a subcommand that does not exist fails', async () => {
  const { code, stderr } = await guard({ 'index.md': '# x\n\n```sh\nnpx tflw frobnicate\n```\n' });
  assert.equal(code, 1);
  assert.match(stderr, /does not exist/);
});

test('prose is not scanned for invocations — only code the reader would copy', async () => {
  // index.md really does contain "what tflw replaces is the glue". A guard that reports
  // `tflw replaces` as an unknown command trains people to ignore it.
  const { code } = await guard({ 'index.md': '# x\n\nWhat tflw replaces is the glue between steps.\n' });
  assert.equal(code, 0);
});

test('an inline code span is scanned — a flag is just as wrong there', async () => {
  const { code, stderr } = await guard({ 'index.md': '# x\n\nRun `tflw run --skip-load` to skip them.\n' });
  assert.equal(code, 1);
  assert.match(stderr, /--skip-load/);
});

test('a tflw.config sample is validated, not just parsed', async () => {
  const { code, stderr } = await guard({ 'index.md': '# x\n\n```tflw-config\ndefaults\n  web "http://x"\n```\n' });
  assert.equal(code, 1, stderr);
  assert.match(stderr, /tflw\.config sample is not valid/);
});

// --- command coverage (M110, `V4-02`) ---------------------------------------
//
// The direction `DT-05` never checked. Above, a *documented* command must exist; here, an existing
// command must be documented. `tflw lsp` shipped in M13 and was absent from both reader-facing
// surfaces for eleven milestones, because six hand-written copies of the command list existed and
// nothing compared any two of them.
//
// A corpus with no `reference/cli.md` skips the check rather than passing it — asserted below,
// because a skip that reads as a pass is how the gap survived in the first place.

/** A reference page covering every command the shipped binary dispatches, minus `omit`. */
const cliPage = (omit) =>
  ['run', 'check', 'init', 'docs', 'lsp', 'install-browsers', 'pick', 'watch', 'refactor', 'migrate']
    .filter((c) => c !== omit)
    .map((c) => `## \`tflw ${c}\`\n\nProse.\n`)
    .join('\n');

test('a shipped subcommand with no section in the CLI reference fails', async () => {
  const { code, stderr } = await guard({ 'index.md': '# x\n', 'reference/cli.md': cliPage('lsp') });
  assert.equal(code, 1, stderr);
  assert.match(stderr, /`tflw lsp` ships but has no section here/);
});

test('a CLI-reference section for a command that is not dispatched fails', async () => {
  // The M57 bug class in the other direction: `spec-data.ts` documented a `tflw load` for weeks
  // after M53 folded it into `tflw run`. An extra section is as wrong as a missing one.
  const { code, stderr } = await guard({ 'index.md': '# x\n', 'reference/cli.md': `${cliPage()}\n## \`tflw load\`\n\nProse.\n` });
  assert.equal(code, 1, stderr);
  assert.match(stderr, /`tflw load` is documented but not dispatched/);
});

test('a complete CLI reference passes', async () => {
  // NEGATIVE CONTROL for the two above. Without it they would both pass against a guard that
  // rejected every corpus carrying a reference page at all.
  const { code, stdout, stderr } = await guard({ 'index.md': '# x\n', 'reference/cli.md': cliPage() });
  assert.equal(code, 0, stderr);
  assert.match(stdout, /10 shipped subcommands/);
});

test('a corpus with no CLI reference reports the check as skipped, not as passed', async () => {
  const { code, stdout } = await guard({ 'index.md': '# x\n' });
  assert.equal(code, 0);
  assert.match(stdout, /command coverage skipped/);
});

// --- roadmap truth (M149b, `D657`/`D658`) ------------------------------------
//
// `doc-blocks.test.mjs` covers the matching rule against injected allowlists. These two cover the
// wiring the pure function cannot see: that the guard fails the whole run on a stale claim, and
// that its file set actually reaches the repo root.

test('a forward-looking claim about tflw fails the run', async () => {
  const { code, stderr } = await guard({ 'index.md': '# x\n\nSecurity testing is next.\n' });
  assert.equal(code, 1);
  assert.match(stderr, /undeclared forward-looking claim/);
  assert.match(stderr, /index\.md:3/);
});

test("the repo root's README.md is scanned — `D658`, the file the class last fired in", async () => {
  // `M135b` fixed this exact class *in README.md*, and README.md is `srcExclude`d from the site and
  // sits two levels above the docs root. Every other check here walks the docs root and would
  // therefore have been a guard that could not see the file it was written about.
  const { code, stderr } = await guard(
    {
      'packages/docs-site/index.md': '# x\n',
      'README.md': '# tflw\n\nAPI, browser and load testing — security testing is next.\n',
    },
    { docsRoot: 'packages/docs-site' },
  );
  assert.equal(code, 1, stderr);
  assert.match(stderr, /README\.md:3/);
  assert.match(stderr, /undeclared forward-looking claim/);
});

test('a corpus with no repo-root prose still reports what it scanned', async () => {
  // NEGATIVE CONTROL for the two above: without it they would both pass against a guard that
  // rejected every corpus, and the count line is what proves the check ran rather than no-opped.
  const { code, stdout } = await guard({ 'index.md': '# x\n\nFour pillars, all shipped.\n' });
  assert.equal(code, 0);
  assert.match(stdout, /0 forward-looking claims found across 1 files/);
  assert.match(stdout, /stale-exemption check skipped/);
});
