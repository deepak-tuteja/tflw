#!/usr/bin/env node
// Re-pin `sibling-citations.json` — every identifier `testFlow-tests` cites, and which of its files
// cite it.
//
// WHY THIS EXISTS (`D709`). `DECISIONS.md` answers the notation for readers of tracked prose, and
// `collectCitations` decides what to publish from `git ls-files '*.md'` in THIS repository — because
// `D666` was written about this repository's prose. The dogfood target's prose cites the same
// notation and is read by the same people: 185 distinct identifiers, of which the index published
// 91. A sentence telling that reader their citations resolve here would have been false for the
// other 94, which is `§1.2`'s *strictly worse than the dead pointer it replaces*. All 94 resolve
// against these records the moment they are asked for. This file is the asking.
//
// WHY A PIN RATHER THAN A CHECKOUT (`D710`). `verify:decisions` runs in the `test` job, which checks
// out this repository only, and nothing in this repository's CI has ever checked out the sibling.
// Adding that would make `D511`'s accepted red window bidirectional — today a cross-repo change
// reddens the SIBLING's main between the two merges, never this one — and skip-if-absent is refused
// (`M131-03`). So the cheap comparison runs everywhere and the credentialed fetch runs where a human
// is, which is exactly `refresh-spec-anchors.mjs`'s asymmetry.
//
// IT TAKES A REF, AND IT DEFAULTS TO `main`. The pin records what the sibling PUBLISHES, not what a
// working tree happens to hold — a local read would let unmerged sibling prose decide what this
// repository's tracked index contains, and it would look identical to a correct pin. A cross-repo
// change in flight pins its own branch, the same way `M152c` pinned its anchors:
//
//     node scripts/refresh-sibling-citations.mjs --ref <branch>
//
// FILES, NOT LINES (`D686`). The provenance line names files, so lines would buy nothing and cost
// the property that makes this file readable in a diff: a line-level pin churns on every edit to the
// sibling, a file-level one moves only when the sibling starts or stops citing something.
//
// IT READS THE SIBLING'S CODE TOO, SINCE `M169d3` (`D864`). Until then this pinned `*.md` only,
// which made the index answer for the corpus `D666` was written about and stay silent about the one
// a reader is far more likely to be standing in. Measured at `552e545`: the sibling's 763 tracked
// non-prose files cite **456 identifiers**, of which 89 are anchored here and were never published
// because nothing had asked. The exclusions below are the sibling's own five, re-implemented rather
// than imported — across a repository boundary there is no other choice, and `D711` would want it
// this way regardless.
//
// THE MANIFEST DECIDES WHOSE SEQUENCE A CODE FILE MEANS. A `.ts` file cannot carry a `**Notation.**`
// paragraph, so the per-FILE default above has nothing to read; `M169d2`'s `own-identifiers.json`
// gives a per-IDENTIFIER one instead. An identifier the sibling declares it defines is not asked of
// this index — that is what stops `M22` in its `docker-compose.yml`, the nginx mTLS sidecar, being
// answered with this repository's coverage audit. `tflw M22` at the site is the override, and it is
// the one form that puts a claimed identifier back into the demand (`D-M164-06-8`).
//
// THE PIN'S CONTRACT, STATED SO `M169d4` CAN CHECK IT. The pin holds
// `citationsOf(sibling code) − claimed + explicitly-qualified`, with ranges expanded. The sibling's
// own reading subtracts nothing, because it needs the claimed ones to compute its ambiguity census
// — so its half of the comparison has to subtract its claims before it compares, or it will report
// every one of its own milestones as missing from a pin that is right to omit them.
//
// ONE REQUEST, NOT 780. The tree listing names the blobs and the tarball carries them; fetching
// `contents/<path>` per file was fine for 14 markdown files and is not fine for 763.
//
// THE PIN CANNOT SILENTLY DRIFT, and the check for that is not here. `testFlow-tests`'
// `acceptance-check` is the only job in either repository that checks out both trees — the stated
// reason `verify-contributing.mjs` lives there — and its `verify:citation-pin` compares this file
// against the sibling's real citations in both directions. The repository that can drift the pin is
// the one that checks it.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectCitations } from './gen-decisions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'scripts', 'sibling-citations.json');

/** The sibling's generated statement of what it has a check-phase fixture for (`M172e`). */
const COVERAGE_FILE = 'scripts/check-fixture-coverage.json';

/** The sibling, named here rather than derived: this repository's `origin` is not it. */
export const SIBLING = 'deepak-tuteja/tflw-tests';

const refFlag = process.argv.indexOf('--ref');
const ref = refFlag === -1 ? 'main' : process.argv[refFlag + 1];
const fromFlag = process.argv.indexOf('--from-checkout');
const fromCheckout = fromFlag === -1 ? null : process.argv[fromFlag + 1];
if (!ref || (fromFlag !== -1 && !fromCheckout)) {
  console.error('usage: node scripts/refresh-sibling-citations.mjs [--ref <git-ref>] [--from-checkout <path>]');
  process.exit(2);
}

/**
 * `--from-checkout` (`M169d3`, `D865`) — read the sibling from a local clone instead of GitHub, so
 * a cross-repository change can be verified BEFORE either half is pushed.
 *
 * WHY THIS IS NOT A HOLE IN `D710`. That decision refuses a pin built from *a working tree*, and
 * the reason it gives is precise: a local read would let unmerged sibling prose decide this
 * repository's tracked index and *"would look identical to a correct pin"*. Both halves are
 * answered here rather than argued around. It reads `HEAD`, never the working tree, and **refuses a
 * dirty checkout** — so what it reads is a commit, the same kind of object `--ref` names. And the
 * pin it writes is *not* identical to a correct one: it carries `local: true`, and
 * `gen-decisions.mjs` refuses to check or publish against a pin that has it.
 *
 * WHY IT IS WORTH HAVING. Until now nothing could evaluate a two-repository change until both sides
 * were pushed, which is why every divergence this pair has ever had — `M154d`, `M164-10`, and the
 * two `M169d3` found — was discovered by a red build rather than by a measurement. A milestone
 * whose subject is that the two implementations must agree should not require a push to ask them.
 */
function localTree(path) {
  const git = (args) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const dirty = git(['status', '--porcelain', '--untracked-files=no']).trim();
  if (dirty) {
    throw new Error(
      `${path} has uncommitted changes, and this reads commits rather than working trees (D710/D865):\n` +
      `${dirty.split('\n').map((l) => `    ${l}`).join('\n')}\n` +
      `  Commit them. A pin built from an edit nobody else can see is the state D710 refuses, and it\n` +
      `  is the one shape of wrong pin that looks exactly like a right one.`,
    );
  }
  return { sha: git(['rev-parse', 'HEAD']).trim(), tracked: git(['ls-files']).split('\n').filter(Boolean), git };
}

function gh(args) {
  return execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const local = fromCheckout ? localTree(fromCheckout) : null;
const sha = local ? local.sha : gh(['api', `repos/${SIBLING}/commits/${encodeURIComponent(ref)}`, '--jq', '.sha']).trim();

// `git ls-files` at that ref. The tree API's `recursive` listing is the only reading of "tracked"
// available without a checkout, and `type == "blob"` is what excludes the directories.
const tracked = local ? local.tracked : gh([
  'api', `repos/${SIBLING}/git/trees/${sha}?recursive=1`,
  '--jq', '.tree[] | select(.type == "blob") | .path',
]).split('\n').filter(Boolean);

if (!tracked.length) throw new Error(`no tracked file found in ${SIBLING}@${ref} — the tree listing was empty or truncated`);

/**
 * The whole tree, in one request. `gh api .../tarball/<sha>` follows GitHub's redirect and writes
 * the archive to stdout; the alternative is one `contents/<path>` call per blob, which was
 * unremarkable at 14 files and is 780 round trips at the widened corpus.
 *
 * Read back through the `tracked` list rather than by walking the extracted directory, so the
 * corpus stays *what git tracks at that ref* and cannot pick up anything the archive adds.
 */
function fetchTree() {
  const dir = mkdtempSync(join(tmpdir(), 'tflw-sibling-'));
  if (local) {
    // `git archive` is the local half of the same one-shot idea: one process for the whole tree,
    // and it serves `HEAD` rather than the checkout, so an edit in flight cannot reach the pin.
    const tar = join(dir, 'tree.tar');
    writeFileSync(tar, execFileSync('git', ['-C', fromCheckout, 'archive', sha], { maxBuffer: 512 * 1024 * 1024 }));
    execFileSync('tar', ['-xf', tar, '-C', dir]);
    return {
      read: (path) => { try { return readFileSync(join(dir, path)); } catch { return null; } },
      done: () => rmSync(dir, { recursive: true, force: true }),
    };
  }
  const tgz = join(dir, 'tree.tar.gz');
  writeFileSync(tgz, execFileSync('gh', ['api', `repos/${SIBLING}/tarball/${sha}`], { cwd: ROOT, maxBuffer: 512 * 1024 * 1024 }));
  execFileSync('tar', ['-xzf', tgz, '-C', dir]);
  const prefix = readdirSync(dir).find((n) => n !== 'tree.tar.gz');
  if (!prefix) throw new Error(`the tarball for ${SIBLING}@${sha.slice(0, 7)} extracted to nothing`);
  const read = (path) => {
    try { return readFileSync(join(dir, prefix, path)); } catch { return null; }
  };
  return { read, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const tree = fetchTree();

// ---------------------------------------------------------------------------------------------
// The two corpora (`M169d3`, `D864`) — the sibling's own split, re-implemented on this side
// ---------------------------------------------------------------------------------------------
//
// The sibling states these five in `verify-provenance.mjs`'s `EXCLUSIONS`, each with the defect it
// prevents; the reasons are not repeated here, only the rules, because a reason copied across a
// repository boundary is a reason that goes stale in one of the two places. What matters here is
// that both sides exclude the same files: an exclusion only on this side would put an identifier in
// the pin that the sibling never asks for, and one only on that side would demand an entry this pin
// does not carry. Either way the red is unclearable.
const IMAGE_EXT = new Set(['.png', '.svg', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.avif']);
const MANIFEST = 'scripts/own-identifiers.json';
const EXCLUDED = (path) => path.endsWith('.md')
  || IMAGE_EXT.has(extname(path).toLowerCase())
  || /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(path)
  || path === MANIFEST
  || path.endsWith('.jsonl');

const paths = tracked.filter((p) => p.endsWith('.md'));
if (!paths.length) throw new Error(`no markdown found in ${SIBLING}@${ref} — the tree listing was empty or truncated`);

const files = paths.map((path) => ({ path, text: String(tree.read(path)) }));

const codeFiles = [];
for (const path of tracked) {
  if (EXCLUDED(path)) continue;
  const buf = tree.read(path);
  if (buf === null || buf.includes(0)) continue; // binary on content, the sibling's rule
  codeFiles.push({ path, text: buf.toString('utf8') });
}

/**
 * What the sibling says it defines (`M169d2`). NOT OPTIONAL, for `M131-03`'s reason: without it
 * every one of the sibling's own milestones enters the demand and this index answers them with its
 * own same-numbered entries — `D711`'s worst case, 63 times, silently.
 */
function claimedIdentifiers() {
  const raw = tree.read(MANIFEST);
  if (raw === null) {
    throw new Error(
      `${SIBLING}@${ref} has no ${MANIFEST}.\n` +
      `  The code corpus needs it to tell whose sequence an unqualified identifier means (M169d2);\n` +
      `  a .ts file carries no **Notation.** paragraph, so there is nothing else to read. Pin a ref\n` +
      `  that has the manifest rather than a ref that silently means everything is ours.`,
    );
  }
  const parsed = JSON.parse(raw.toString('utf8'));
  if (!Array.isArray(parsed.identifiers) || !parsed.identifiers.length) throw new Error(`${MANIFEST} at ${ref} has no \`identifiers\` array`);
  return { claimed: new Set(parsed.identifiers), unresolvable: new Map(Object.entries(parsed.unresolvable ?? {})) };
}

// `D711`'s per-file default, applied before collecting. Both repositories number their milestones
// from 1 and 35 identifiers are defined in both record sets, so the sibling's prose declares which
// sequence its unqualified `M<n>` indexes and spells out the minority: `tflw M128a`,
// `testFlow-tests M22`. A pin that ignored that would ask this index to publish tflw's `M22` — the
// test-coverage audit — as the resolution for a sentence about the sibling's nginx sidecar, which is
// `§1.2`'s *strictly worse than the dead pointer*: a real entry about the wrong thing.
//
// The sibling's own `verify:provenance` implements this rule a second time, independently, and the
// two are held together by that gate failing. Neither imports the other; a shared implementation
// would agree with itself.
//
// `M164-10`: the D-form reads `D\d{1,3}`, not `D\d{2,3}`. `M154d` found these two implementations
// disagreeing about single-digit decisions, widened the sibling's `CITATION`, `OWN` and `THEIRS`,
// and left this file — the other half of the same pair — narrow, so the divergence it closed stayed
// open in the direction nothing had exercised. Its own comment there states the rule it did not
// finish applying: leaving these narrow rebuilds the divergence that just cost a red.
//
// Measured before changing (`D716`): across all 14 tracked markdown files in the sibling, no
// qualified citation is a single-digit D-form today, so this pins the same 287 identifiers it did —
// which is the point. What it stops is the state `M154d` names, reproduced against both
// implementations before the edit: a `testFlow-tests D4` this file cannot blank enters the pin as a
// citation of tflw, the sibling's gate blanks it correctly and so does not cite it, and
// `verify:provenance` reports a stale pin that no edit to either document can clear.
//
// `M169b`'s demand check reads that example and asks tflw's records for a `D4`. Two things are true
// of it and neither is repairable here, which is why `D4` is declared in `gen-decisions.mjs`'s
// `DECLARED_UNRESOLVABLE` rather than edited out of this comment.
//
// First, the `testFlow-tests` qualifier is invisible to `collectCitations`, which reads the bare
// `D4` — the exact distinction `OWN`/`THEIRS` below exist to draw, unimplemented in the other half
// of the pair. Teaching it there was measured rather than assumed: the qualified form is house
// convention in the sibling, ~40 sites across its prose, and appears in tflw **exactly once** —
// here. A grammar generalised from a single instance is the shape `M167` names and `D861` refused,
// and `M164-12` is where a rule this pair should share belongs.
//
// Second, and decisively: **`D4` is defined in neither repository.** It survives in one section
// heading, copied between the two plans, naming a decision nobody ever wrote. There is no anchor to
// point it at in either tree, so the example cannot be made to resolve — only stated, which is what
// the declaration does and what makes it checkable if `D4` is ever minted for real.
const OWN = /`?testFlow-tests\s+(?:M\d{1,3}[a-z]?\d?|D\d{1,3}[a-z]?)`?/g;
const THEIRS = /`?tflw\s+(M\d{1,3}[a-z]?\d?|D\d{1,3}[a-z]?)`?/g;
const UNQUALIFIED_M = /(?<![\w#])M\d{1,3}[a-z]?\d?\b/g;

const resolved = files.map(({ path, text }) => {
  const defaultsToOwn = /here is this repository's own/.test(text);
  // A file with no declaration at all contributes nothing rather than contributing a guess. The
  // sibling's gate is what refuses that state; this only declines to invent an answer for it.
  if (!/\*\*Notation\.\*\*/.test(text)) return { path, text: '' };
  if (!defaultsToOwn) return { path, text: text.replace(OWN, ' ') };
  const kept = [...text.matchAll(THEIRS)].map((m) => m[1]).join(' ');
  return { path, text: `${text.replace(UNQUALIFIED_M, ' ')}\n${kept}\n` };
});

const cited = collectCitations(resolved);

// ---------------------------------------------------------------------------------------------
// The code half
// ---------------------------------------------------------------------------------------------
//
// RANGES EXPAND HERE, and `D861` says they do not expand in code. Both are right, because they are
// about different corpora — `D862` records the measurement that separates them: all 15 range-shaped
// strings in the sibling's code are tight, same-sequence and written by a person in a comment,
// where this repository's one counterexample is a coverage span used as a test fixture. Refusing to
// expand would drop seven interior identifiers the sibling's own gate reads, and a pin that
// disagrees with the reading it is compared against is `M154d`'s unclearable red.
const { claimed, unresolvable } = claimedIdentifiers();
const codeCited = collectCitations(codeFiles.map(({ path, text }) => ({ path, text: text.replace(OWN, ' ') })), () => true);

// The override, per site (`D-M164-06-8`). Everything else the sibling claims is its own and is not
// asked of this index; `tflw M22` is the one spelling that says otherwise, and it is deliberately
// the *only* one — an identifier is claimed or qualified, never inferred from context.
//
// `D866` — AND THE SITE IS THE UNIT, which is what the sentence above always said and is not what
// this file did until `M169d5`. It built one `Set` over the whole corpus, so a single `tflw M22`
// anywhere re-admitted every bare `M22` everywhere: 7 identifiers, **47 pin sites** that mean the
// sibling's own sequence, pinned as citations of this index. `M22`'s two qualifying sites are both
// prose *about* the collision — `CONTRIBUTING.md` and `refresh-own-identifiers.mjs`'s docblock, the
// file that generates `claimed` — so the sentence explaining the override was what spent it. The
// last clause above is the tell: reading another file's context IS inferring from context.
const qualifiedAt = new Map();
for (const { path, text } of codeFiles) {
  const here = new Set();
  for (const [, id] of text.matchAll(THEIRS)) here.add(id);
  if (here.size) qualifiedAt.set(path, here);
}
const qualifiesAt = (path, id) => qualifiedAt.get(path)?.has(id) === true;

const citations = {};
for (const id of [...cited.keys()].sort()) {
  const e = cited.get(id);
  citations[id] = [...new Set(e.sites.map((s) => s.file))];
}
let fromCode = 0;
for (const id of [...codeCited.keys()].sort()) {
  // Declared unresolvable on the sibling's side (`M169d3`). NOT pinned, and the reason is a test
  // in this repository: *a pin naming an identifier the records do not define is unresolved,
  // exactly like a local citation*. That rule is worth more than the convenience of carrying these
  // five, so the exemption lives where the reason lives and the pin stays a set this repository can
  // define in full.
  if (unresolvable.has(id)) continue;
  // `D866` — a claimed identifier is asked of this index from the files that qualify it and from
  // no others. An unclaimed one is asked from every site that cites it, since code carries no
  // `**Notation.**` declaration and this index is the only sequence a bare form there can mean.
  let sites = [...new Set(codeCited.get(id).sites.map((s) => s.file))];
  if (claimed.has(id)) {
    sites = sites.filter((f) => qualifiesAt(f, id));
    // Emptied BY THE FILTER means every site meant the sibling's own sequence, so nothing asks this
    // index. The test is deliberately inside the `claimed` branch: an unclaimed identifier can also
    // arrive with no sites — a range interior has none of its own — and it is still a demand. The
    // first draft skipped on `!sites.length` unconditionally and dropped `D18`, `D342` and `D344`,
    // which the sibling's gate reported within the minute. That is the pair doing its job, and it
    // only worked because this half moved and the other did not.
    if (!sites.length) continue;
  }
  if (!citations[id]) { citations[id] = sites; fromCode++; continue; }
  citations[id] = [...new Set([...citations[id], ...sites])];
}
/**
 * The sibling's check-phase fixture coverage (`M172e`, closing `M155-02`).
 *
 * WHY THE PIN GREW A FIELD THAT IS NOT A CITATION. Everything else in this file answers *which of
 * this repository's identifiers does the sibling cite*. This answers the opposite kind of question
 * — *what does the sibling already have a fixture for* — and it is here rather than in a pin of its
 * own because the two want the identical machinery: a commit, a tarball, one request, and a value
 * that must come from a published ref rather than from somebody's working tree (`D710`).
 *
 * WHAT IT IS FOR. `testFlow-tests`' `verify-check-diagnostics.mjs` demands a fixture for every
 * check-phase `TF0xx` code the installed tflw assigns. That rule is real and enforced, and it is
 * enforced **one repository away from the change that breaks it** — assign a code here, merge green
 * here, and the sibling's `main` goes red on its next run with no warning to whoever caused it.
 * `M155-02` calls that asymmetry the finding. `verify-check-coverage.mjs` is the answer, and this
 * field is what it reads.
 *
 * ABSENT IS A HARD ERROR, NOT AN OMITTED FIELD. A pin that quietly drops the field would leave
 * `verify-check-coverage.mjs` with nothing to compare and — if that gate were written to shrug —
 * green about a repository it never read (`D880`). It is not written to shrug, and this end refuses
 * too, so the two failures name the same cause from both sides. A ref predating the sibling's half
 * of this milestone genuinely cannot be pinned, and saying so is the correct answer.
 */
const coverageRaw = tree.read(COVERAGE_FILE);
if (coverageRaw === null) {
  throw new Error(
    `${SIBLING}@${sha.slice(0, 7)} (${ref}) has no ${COVERAGE_FILE}.\n` +
    `  That file is generated there by \`node scripts/verify-check-diagnostics.mjs --write\` and is what\n` +
    `  this repository's verify:check-coverage reads. A ref from before the sibling's half of M172e\n` +
    `  cannot be pinned: merge that half, or pin the branch carrying it (--ref <branch>).`,
  );
}
let checkFixtures;
try {
  const parsed = JSON.parse(coverageRaw.toString('utf8'));
  checkFixtures = parsed.codes;
} catch (e) {
  throw new Error(`${COVERAGE_FILE} at ${sha.slice(0, 7)} is not JSON: ${e.message}`);
}
// Shape, not trust. The sibling generates this file and its own gate compares it against the
// fixture tables every run — but a pin is read by a guard that fails closed, so a malformed value
// arriving as `undefined` would reach `verify-check-coverage.mjs` as *no coverage at all* and
// redden this repository for a defect that is not in it. Refuse it here, where the cause is legible.
if (!Array.isArray(checkFixtures) || !checkFixtures.length
    || !checkFixtures.every((c) => typeof c === 'string' && /^TF\d{3}$/.test(c))) {
  throw new Error(
    `${COVERAGE_FILE} at ${sha.slice(0, 7)} does not carry a non-empty \`codes\` array of TF0xx strings.\n` +
    `  Its shape changed on the sibling's side; read that file before changing this check.`,
  );
}
checkFixtures = [...new Set(checkFixtures)].sort();

tree.done();

const corpus = {
  comment:
    'Every identifier testFlow-tests cites — in tracked prose and, since M169d3, in tracked code — '
    + 'and which of its files cite it, read from the ref below (D709/D710/D864). The code half is '
    + 'what that repository does NOT claim in its own scripts/own-identifiers.json, plus whatever a '
    + 'site qualifies as `tflw <id>`. Never hand-edit — refresh with '
    + '`node scripts/refresh-sibling-citations.mjs --ref <ref>`, and note that the sibling\'s own '
    + '`verify:provenance` is what fails when this goes stale. `checkFixtures` is a different kind '
    + 'of fact and is documented where it is read, in scripts/verify-check-coverage.mjs (M172e).',
  repo: SIBLING,
  ref: local ? `${ref} (local checkout)` : ref,
  sha,
  ...(local ? { local: true } : {}),
  source: local
    ? `LOCAL CHECKOUT ${fromCheckout} — not a published ref; re-pin with --ref before committing (D865)`
    : `https://github.com/${SIBLING}/tree/${sha}`,
  files: paths,
  codeFiles: codeFiles.length,
  checkFixtures,
  citations,
};

writeFileSync(OUT, `${JSON.stringify(corpus, null, 2)}\n`);
console.log(
  `${local ? '⚠ LOCAL' : '✓'} pinned ${Object.keys(citations).length} cited identifiers from ${SIBLING}@${sha.slice(0, 7)} (${ref})\n` +
  `  prose: ${paths.length} markdown file(s), ${cited.size} identifier(s)\n` +
  `  code:  ${codeFiles.length} tracked non-prose file(s), ${codeCited.size} identifier(s) read, ` +
  `${[...codeCited.keys()].filter((id) => !unresolvable.has(id) && (!claimed.has(id)
    || codeCited.get(id).sites.some((s) => qualifiesAt(s.file, id)))).length} asked of this index ` +
  `(${claimed.size} claimed by the sibling, ${unresolvable.size} declared unresolvable there, ` +
  `${[...qualifiedAt.values()].reduce((n, s) => n + s.size, 0)} \`tflw <id>\` override(s) at ${qualifiedAt.size} site(s), D866)\n` +
  `  ${fromCode} identifier(s) reach the index only through code\n` +
  `  fixtures: ${checkFixtures.length} check-phase TF0xx code(s) the sibling covers (M172e)`,
);
if (local) {
  console.log(
    '\n  This pin is marked `local: true` and CANNOT be committed: `verify:decisions` refuses it.\n' +
    `  Push the sibling branch, then re-run without --from-checkout:\n` +
    `    node scripts/refresh-sibling-citations.mjs --ref ${ref}`,
  );
}
