// D677 — every `SPEC.md#<fragment>` referenced from a tracked file resolves to a real heading.
//
// THE HOLE THIS CLOSES. `SPEC.md` is the repository's reference document, and the docs site sends
// readers into it 20 times with an absolute `https://github.com/…/blob/main/SPEC.md#…` URL. Because
// the URL is absolute, nothing in this repository ever looked at it: `verify-links.mjs` checks
// anchors *within* the built site and skips external hosts, which is correct for its job and leaves
// every one of these unwatched. `D693` measured the consequence — six of the seventeen distinct
// fragments were already dead, and had been for as long as the headings had carried an en-dash.
//
// WHY A DEAD FRAGMENT IS WORSE THAN A DEAD LINK. It does not 404. GitHub serves the page and
// ignores the fragment, so the reader arrives at the top of a 3,700-line specification having asked
// for §7 — with no error, and nothing to tell them the pointer was wrong rather than the section
// missing. That is the same failure mode as the notation this milestone exists to repair: an
// address that looks like it resolves.
//
// HOW IT ANSWERS. `github-slug.mjs` computes the anchors from the working tree's `SPEC.md`; see
// that file for why the rule is written out rather than read off a build, and how it is kept honest
// against GitHub's own answer. This gate then checks membership, and on a failure prints the
// nearest real anchor — because every one of `D693`'s six is a near miss of one or two characters,
// and a bare "not found" would send the reader back to guessing.
//
// SCOPE, measured rather than assumed. Tracked markdown, outside product fences and outside inline
// code spans — the same corpus and the same two exclusions `verify-citations.mjs` uses, sharing
// `scanLines` and `inCodeSpan` rather than re-deriving them (`D697`). All 23 references live in
// markdown. A first draft scanned every tracked file and matched a bare `SPEC.md#…` anywhere, which
// added four findings and all four were the same mistake in a new costume: `CONTRIBUTING.md`
// illustrating a fragment's *shape* inside backticks, two script comments quoting one, and a
// synthetic link inside a test fixture. A quotation of an address is not an address.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anchorsOf } from './github-slug.mjs';
import { inCodeSpan, scanLines } from './gen-decisions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A fragment reference into `SPEC.md`. Both shapes that occur, and no more: the absolute GitHub URL
 * every docs-site page uses, and a relative `](…SPEC.md#…)` link target. Requiring link syntax for
 * the relative form is what separates an address from a mention of one.
 */
export const REFERENCE = /(?:https?:\/\/\S*?blob\/[^/\s]+\/SPEC\.md|\]\([^)\s]*SPEC\.md)#([^)\s"'`<>\]]+)/g;

/** Tracked markdown, or a clear message about why the question cannot be answered here. */
export function trackedMarkdown(root = ROOT) {
  try {
    return execFileSync('git', ['ls-files', '*.md'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
      .toString('utf8')
      .split('\n')
      .filter(Boolean);
  } catch {
    throw new Error(
      'verify-anchors needs `git ls-files` and this tree has no .git — it is an rsync of the\n' +
        'working tree, which is how scripts/exec.mjs offloads to the box. Run this gate on the Mac.',
    );
  }
}

/** Levenshtein, small and local, only ever run against the ~75 anchors of one document. */
function distance(a, b) {
  let prev = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * The nearest real anchor, or null when nothing is near enough to be worth naming.
 *
 * The bound is a third of the fragment's length. A quarter was tried first and it declined to
 * suggest anything for `#36-client-certificates--mtls-plan-decision-99b-` -> `…-mtls-p99b-`,
 * where the heading is plainly the same one and only the citation inside it was rewritten. A
 * suggestion is advisory — the dead fragment is printed either way — so the cost of being
 * generous is a wrong hint, and the cost of being strict is silence exactly where a heading was
 * deliberately renamed, which is the case a contributor is most likely to be looking at.
 */
function nearest(fragment, anchors) {
  let best = null;
  for (const anchor of anchors) {
    const d = distance(fragment, anchor);
    if (best === null || d < best.d) best = { anchor, d };
  }
  return best && best.d <= Math.max(4, Math.ceil(fragment.length / 3)) ? best.anchor : null;
}

/**
 * The gate's whole judgement, over prose handed in rather than read — so its tests can hand it the
 * shapes that fool it instead of building a repository to hold them.
 *
 * @param {string} spec `SPEC.md`'s text, the only source of anchors
 * @param {{path: string, text: string}[]} files tracked markdown to search for references
 */
export function findDeadReferences(spec, files) {
  const { anchors, collisions } = anchorsOf(spec);
  const known = new Set(anchors.map((a) => a.anchor));

  const dead = [];
  let references = 0;
  for (const { path, text } of files) {
    if (!text.includes('SPEC.md#')) continue;
    for (const { line, inProductFence, text: ln } of scanLines(text)) {
      if (inProductFence) continue;
      for (const m of ln.matchAll(REFERENCE)) {
        if (inCodeSpan(ln.slice(0, m.index))) continue;
        references++;
        const fragment = decodeURIComponent(m[1]);
        if (known.has(fragment)) continue;
        dead.push({ file: path, line, fragment, nearest: nearest(fragment, known) });
      }
    }
  }
  return { dead, references, anchors: known.size, collisions };
}

/** The same judgement, over the working tree. */
export function fromDisk(root = ROOT) {
  const files = trackedMarkdown(root).map((path) => ({ path, text: readFileSync(join(root, path), 'utf8') }));
  return findDeadReferences(readFileSync(join(root, 'SPEC.md'), 'utf8'), files);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { dead, references, anchors, collisions } = fromDisk();

  // A collision is an anchor this repository computed from a rule GitHub has never been asked to
  // confirm here (see `anchorsOf`). Refusing is the honest answer: the alternative is a gate that
  // passes a reference on the strength of a guess.
  if (collisions.length > 0) {
    console.error(
      `error: ${collisions.length} SPEC.md heading(s) slug identically, and the pinned corpus\n` +
        '       contains no collision, so the -1/-2 suffix rule is unverified against GitHub here:\n' +
        collisions.map((c) => `         SPEC.md:${c.line} — "${c.text}" -> ${c.anchor}`).join('\n') +
        '\n       Rename one heading, or re-pin the corpus from a pushed ref and confirm the suffix:\n' +
        '         node scripts/refresh-spec-anchors.mjs --ref <branch>',
    );
    process.exit(1);
  }

  if (dead.length > 0) {
    console.error(`error: ${dead.length} of ${references} SPEC.md fragment reference(s) resolve to no heading:\n`);
    for (const d of dead) {
      console.error(`  ${d.file}:${d.line}`);
      console.error(`      #${d.fragment}`);
      console.error(d.nearest ? `      did you mean #${d.nearest}\n` : '      no heading is close to this\n');
    }
    console.error(
      'GitHub does not 404 on a bad fragment — it serves SPEC.md and drops the reader at the top,\n' +
        'so these fail silently for readers and have to fail loudly here. Heading slugs come from\n' +
        'scripts/github-slug.mjs; the rule that surprises people is that punctuation is deleted\n' +
        'before spaces become hyphens, so "(P#27–31)" is "p2731" and never "p27-31".',
    );
    process.exit(1);
  }

  console.log(`✓ ${references} SPEC.md fragment references all resolve, against ${anchors} headings`);
}
