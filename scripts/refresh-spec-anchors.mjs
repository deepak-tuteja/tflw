// Re-pin `spec-anchors.json` — the anchors GitHub itself mints for `SPEC.md`.
//
// This is the half of the anchor gate that cannot be computed. `github-slug.mjs` writes out
// GitHub's rule so the gate can answer offline; this script asks GitHub what the rule actually
// produced, so that written-out rule can be contradicted. Run it when `github-slug.test.mjs` says
// the corpus no longer covers a heading:
//
//     node scripts/refresh-spec-anchors.mjs --ref main
//
// IT TAKES A REF ON PURPOSE. GitHub renders any ref it has, not only the default branch, so a
// milestone that edits headings can push its branch and pin the answer for its own tree:
//
//     git push -u origin <branch> && node scripts/refresh-spec-anchors.mjs --ref <branch>
//
// Without that, a milestone like `M152c` — which normalises four headings — could only ever pin
// anchors for the tree it was replacing.
//
// THE PIN IS A COMMIT, AND THE BRANCH IT NAMES GETS SQUASHED. `sha` here will not be reachable from
// `main` after a squash merge; it stays resolvable through the closed pull request, which is enough
// for a reader following `source`, and re-pinning against `main` afterwards is never *wrong* — only
// unnecessary, because the bytes are identical and the corpus records where the answer came from
// rather than where the file now lives.
//
// IT IS NOT A CI STEP. It needs the network and an authenticated `gh`; CI runs the comparison, not
// the fetch. That asymmetry is deliberate and it is the same one `verify-decisions` lives with: the
// expensive, credentialed half runs where a human is, and the cheap half runs everywhere.
//
// BOTH HALVES COME FROM THE REF, not from the working tree. The markdown is fetched as well as the
// HTML, so the heading text and the anchor beside it are two readings of the same bytes. Pairing
// GitHub's anchors against a locally-modified `SPEC.md` would record a correspondence that never
// existed, and it would look exactly like a correct corpus.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { headingsOf } from './github-slug.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'scripts', 'spec-anchors.json');

const refFlag = process.argv.indexOf('--ref');
const ref = refFlag === -1 ? 'main' : process.argv[refFlag + 1];
if (!ref) {
  console.error('usage: node scripts/refresh-spec-anchors.mjs [--ref <git-ref>]');
  process.exit(2);
}

function gh(args, encoding = 'utf8') {
  return execFileSync('gh', args, { cwd: ROOT, encoding, maxBuffer: 64 * 1024 * 1024 });
}

/** `deepak-tuteja/tflw` from whatever shape `origin` happens to be written in. */
function slugOfRepo() {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const m = /github\.com[:/](.+?)(?:\.git)?$/.exec(url);
  if (!m) throw new Error(`origin is not a GitHub remote: ${url}`);
  return m[1];
}

const repo = slugOfRepo();
const sha = gh(['api', `repos/${repo}/commits/${encodeURIComponent(ref)}`, '--jq', '.sha']).trim();

const markdown = gh(['api', `repos/${repo}/contents/SPEC.md?ref=${encodeURIComponent(ref)}`, '-H', 'Accept: application/vnd.github.raw']);
const html = gh(['api', `repos/${repo}/contents/SPEC.md?ref=${encodeURIComponent(ref)}`, '-H', 'Accept: application/vnd.github.html']);

// GitHub prefixes every heading id with `user-content-` in the blob view. Order is document order,
// and duplicates in the HTML (the id also appears on the anchor's `href`) collapse to the first.
const seen = new Set();
const anchors = [];
for (const [, id] of html.matchAll(/id="user-content-([^"]*)"/g)) {
  if (seen.has(id)) continue;
  seen.add(id);
  anchors.push(id);
}

const headings = headingsOf(markdown);
if (headings.length !== anchors.length) {
  console.error(
    `error: ${headings.length} headings parsed from SPEC.md at ${ref}, but GitHub rendered ${anchors.length} anchors.\n` +
      '       The two must correspond one-to-one and in order, or the corpus records a pairing that\n' +
      '       does not exist. This usually means headingsOf() and GitHub disagree about what a\n' +
      '       heading is — a setext underline, a heading inside an HTML block, or a fence that does\n' +
      '       not close. Fix github-slug.mjs before re-pinning.',
  );
  process.exit(1);
}

const corpus = {
  comment:
    'GitHub\'s own heading anchors for SPEC.md, fetched from the ref below. Never hand-edit: ' +
    'the point of this file is that nothing in this repository computed it. Refresh with ' +
    '`node scripts/refresh-spec-anchors.mjs --ref <ref>`.',
  repo,
  ref,
  sha,
  source: `https://github.com/${repo}/blob/${sha}/SPEC.md`,
  headings: headings.map((h, i) => [h.text, anchors[i]]),
};

writeFileSync(OUT, `${JSON.stringify(corpus, null, 2)}\n`);
console.log(`✓ pinned ${headings.length} anchors from ${repo}@${sha.slice(0, 7)} (${ref})`);
