// GitHub's heading-anchor rule, written out here, and pinned to GitHub's own answer.
//
// WHY THIS FILE EXISTS. `SPEC.md` is referenced 23 times from tracked files as an absolute
// `https://github.com/…/blob/main/SPEC.md#<fragment>` URL. Nothing watched those fragments, and six
// of them were already dead (`D693`). `verify-anchors.mjs` is the gate that watches them, and to do
// that it has to know what fragment GitHub will mint for a given heading.
//
// WHY IT IS NOT `verify-links.mjs`'s ANSWER. The docs-site gate solves the same problem by refusing
// to have a slugifier at all: it reads element ids out of the *built* HTML, on the argument that a
// local copy of VitePress's rule "would have had the same em-dash bug, and agreed with itself".
// That argument is right and it does not transfer. There is no build step that renders `SPEC.md` —
// GitHub does, on its servers, from a ref that has already been pushed. A gate that could only
// answer for pushed commits would tell a contributor their heading edit broke three links *after*
// it broke them.
//
// SO THE RULE IS WRITTEN OUT, AND THEN PROVED AGAINST GITHUB. `spec-anchors.json` holds the
// anchors GitHub itself minted for `SPEC.md`, fetched by `refresh-spec-anchors.mjs`, and
// `github-slug.test.mjs` asserts this file reproduces every one of them. The rule below computes
// from the working tree, so it answers offline and before a push; the corpus is what stops it from
// being an approximation that agrees with itself. Neither half is sufficient alone, which is why
// there are two.
//
// THE RULE, as GitHub applies it to a heading's rendered text:
//
//   1. lowercase
//   2. delete every punctuation, symbol, control and no-break-space character, except `-` and `_`
//   3. replace each remaining space with `-`
//
// Step 2 running before step 3 is the whole of `D693`'s six dead links. `(P#27–31)` loses its
// en-dash to step 2 and never reaches step 3, so it slugs to `p2731` — while every author who
// hand-wrote the link typed the ASCII hyphen they could see, `p27-31`. The same ordering is why a
// trailing `✅` leaves a trailing `-`: the emoji is deleted, and the space that preceded it is not.
//
// WHAT THE CORPUS DOES NOT COVER, stated rather than assumed: `SPEC.md` has no two headings that
// slug alike, so GitHub has never been asked here what it does on a collision. `anchorsOf` implements
// the documented `-1`/`-2` suffix rule, and reports collisions separately so the caller can refuse
// to rely on an unproven answer. `SPEC.md` also has no heading containing a link, emphasis or an
// HTML entity, so this file slugs the raw markdown text; if one ever appears, the corpus refresh
// will disagree and say so.

/**
 * Characters GitHub deletes outright. `-` and `_` survive — they are the two that appear in the
 * output alphabet — and everything else in Unicode's punctuation, symbol and control categories
 * goes, along with the no-break space — written `\u00A0`, never as a literal, because an
 * invisible character inside a character class is the one edit no review path can see.
 *
 * That is not hypothetical. A literal U+00A0 reached the first draft of this class, where it did
 * two things at once: it deleted no-break spaces (correct, and what the escape now says out loud)
 * and it stopped the class from deleting ordinary ones (also correct — a `\p{Z}` here would have
 * eaten every space before step 3 could turn it into a `-`). The draft scored 75/75 against the
 * corpus while being a rule nobody had written. Only dumping the codepoints of `.source` found it.
 * The corpus is why that was recoverable: a rule this file gets wrong is a rule GitHub contradicts.
 */
export const DELETED = /(?![-_])[\p{P}\p{S}\p{C}\u00A0]/gu;

/** GitHub's slug for one heading's text, without deduplication. */
export function slug(text) {
  return text.toLowerCase().replace(DELETED, '').replace(/ /g, '-');
}

/**
 * Every ATX heading in a markdown document, outside fenced code.
 *
 * Fence-awareness is not a nicety: `SPEC.md` carries two `#`-prefixed lines inside fences that are
 * sample output, not headings, and counting them would shift every subsequent duplicate suffix and
 * silently misreport the anchor set. A fence closes only on the same character it opened with, so
 * a ``` inside a ~~~ block stays content.
 */
export function headingsOf(markdown) {
  const out = [];
  let fence = null;
  markdown.split('\n').forEach((text, i) => {
    const open = /^\s*(`{3,}|~{3,})/.exec(text);
    if (open) {
      const char = open[1][0];
      if (fence === null) fence = char;
      else if (fence === char) fence = null;
      return;
    }
    if (fence !== null) return;
    const heading = /^(#{1,6}) (.*)$/.exec(text);
    if (heading) out.push({ line: i + 1, level: heading[1].length, text: heading[2].trim() });
  });
  return out;
}

/**
 * The anchors GitHub will mint for a document, in order.
 *
 * Returns `{ anchors, collisions }`. `anchors` is one entry per heading — `{ anchor, heading }` —
 * with the `-1`/`-2` suffix applied on repeats, the rule GitHub's own slugger documents.
 * `collisions` lists the headings that needed a suffix, because this repo's corpus contains none
 * and so cannot vouch for that half of the rule. A caller that finds a collision is looking at an
 * answer no measurement backs.
 */
export function anchorsOf(markdown) {
  const seen = new Map();
  const anchors = [];
  const collisions = [];
  for (const heading of headingsOf(markdown)) {
    const base = slug(heading.text);
    let anchor = base;
    while (seen.has(anchor)) {
      seen.set(base, seen.get(base) + 1);
      anchor = `${base}-${seen.get(base)}`;
    }
    if (anchor !== base) collisions.push({ ...heading, base, anchor });
    seen.set(anchor, 0);
    anchors.push({ anchor, heading });
  }
  return { anchors, collisions };
}
