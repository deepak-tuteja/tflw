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
// THE PIN CANNOT SILENTLY DRIFT, and the check for that is not here. `testFlow-tests`'
// `acceptance-check` is the only job in either repository that checks out both trees — the stated
// reason `verify-contributing.mjs` lives there — and its `verify:citation-pin` compares this file
// against the sibling's real citations in both directions. The repository that can drift the pin is
// the one that checks it.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectCitations } from './gen-decisions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'scripts', 'sibling-citations.json');

/** The sibling, named here rather than derived: this repository's `origin` is not it. */
export const SIBLING = 'deepak-tuteja/tflw-tests';

const refFlag = process.argv.indexOf('--ref');
const ref = refFlag === -1 ? 'main' : process.argv[refFlag + 1];
if (!ref) {
  console.error('usage: node scripts/refresh-sibling-citations.mjs [--ref <git-ref>]');
  process.exit(2);
}

function gh(args) {
  return execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const sha = gh(['api', `repos/${SIBLING}/commits/${encodeURIComponent(ref)}`, '--jq', '.sha']).trim();

// `git ls-files '*.md'` at that ref. The tree API's `recursive` listing is the only reading of
// "tracked" available without a checkout, and `type == "blob"` is what excludes the directories.
const paths = gh([
  'api', `repos/${SIBLING}/git/trees/${sha}?recursive=1`,
  '--jq', '.tree[] | select(.type == "blob") | .path',
]).split('\n').filter((p) => p.endsWith('.md'));

if (!paths.length) throw new Error(`no markdown found in ${SIBLING}@${ref} — the tree listing was empty or truncated`);

const files = paths.map((path) => ({
  path,
  text: gh(['api', `repos/${SIBLING}/contents/${path}?ref=${sha}`, '-H', 'Accept: application/vnd.github.raw']),
}));

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
const citations = {};
for (const id of [...cited.keys()].sort()) {
  const e = cited.get(id);
  citations[id] = [...new Set(e.sites.map((s) => s.file))];
}

const corpus = {
  comment:
    'Every identifier testFlow-tests cites in tracked prose, and which of its files cite it, read '
    + 'from the ref below (D709/D710). Never hand-edit — refresh with '
    + '`node scripts/refresh-sibling-citations.mjs --ref <ref>`, and note that the sibling\'s own '
    + '`verify:citation-pin` is what fails when this goes stale.',
  repo: SIBLING,
  ref,
  sha,
  source: `https://github.com/${SIBLING}/tree/${sha}`,
  files: paths,
  citations,
};

writeFileSync(OUT, `${JSON.stringify(corpus, null, 2)}\n`);
console.log(`✓ pinned ${Object.keys(citations).length} cited identifiers from ${paths.length} files in ${SIBLING}@${sha.slice(0, 7)} (${ref})`);
