// The `tflw docs` topic listing (M125e, `FU-29`, D252/D281).
//
// Its own module rather than a function in `cli.ts`, for one reason worth stating: `cli.ts` calls
// `main()` at the bottom of the file, so importing it *runs the CLI*. Every existing cli test is
// therefore end-to-end, spawning the binary. That is the right shape for a command, and the wrong
// shape for a pure string-builder whose interesting cases are per-group column widths and heading
// order. Split so it can be asserted directly.

import { DOCS_TOPICS } from './docs-data.generated.js';

/**
 * The topic list, grouped by SPEC's own section hierarchy with each line carrying its title.
 *
 * Sixty slugs in one alphabetical run is a wall, and `the-one-form`/`subset`/`quantifiers`/
 * `retry-split` are opaque without one. Both halves of the fix were already in the data: `group` is
 * the enclosing `##` heading and `title` is the topic's own, so there is no authored taxonomy here
 * to fall out of step with the language — the shape is SPEC's, and it cannot drift from SPEC because
 * it *is* SPEC. (D252 rejected a hand-curated taxonomy for exactly that reason: sixty hand-written
 * strings with no mechanical check holding them to the grammar is the `C13` failure re-entered.)
 *
 * Groups appear in SPEC's order, not alphabetically: the document is written to be read from the
 * top, and sorting them would replace an argued order with an arbitrary one. Slugs stay sorted
 * within their group, since inside a group there is no such argument.
 */
export function renderTopicIndex(topics: readonly string[]): string {
  // Group order comes from `DOCS_TOPICS`' own key order, which `gen-docs.mjs` writes in walk order
  // — i.e. SPEC's order. Reading it off `topics` instead would order the groups by whichever slug
  // happened to sort first inside each, which is alphabetical order wearing a disguise.
  const byGroup = new Map<string, string[]>();
  for (const slug of Object.keys(DOCS_TOPICS)) byGroup.set(DOCS_TOPICS[slug]!.group, []);
  for (const slug of topics) byGroup.get(DOCS_TOPICS[slug]?.group ?? '')?.push(slug);

  const lines: string[] = [];
  for (const [group, slugs] of byGroup) {
    if (slugs.length === 0) continue;
    lines.push(group);
    // Column width per group, not across all sixty: one 45-character outlier
    // (`frames-tabs-downloads-drag-drop-wait-until-ui`) would otherwise open a gutter that wide on
    // every line in the list. Alignment only has to hold where the eye is scanning, which is inside
    // a group.
    const width = Math.max(...slugs.map((s) => s.length));
    for (const slug of slugs) {
      // A `##` section's own topic has the group heading printed directly above it, so repeating
      // the identical title in the second column says nothing twice.
      const title = DOCS_TOPICS[slug]?.title ?? '';
      lines.push(title === group ? `  ${slug}` : `  ${slug.padEnd(width)}  ${title}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
