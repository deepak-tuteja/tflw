// The `tflw docs` topic listing (M125e, `FU-29`, D252/D281; `M263`).
//
// Its own module rather than a function in `cli.ts`, for one reason worth stating: `cli.ts` calls
// `main()` at the bottom of the file, so importing it *runs the CLI*. Every existing cli test is
// therefore end-to-end, spawning the binary. That is the right shape for a command, and the wrong
// shape for a pure string-builder whose interesting cases are per-group column widths and heading
// order. Split so it can be asserted directly.

import { DOCS_TOPICS } from './docs-topics.js';

/**
 * The topic list, grouped the way the docs site's sidebar groups the same pages, each line carrying
 * the sidebar's name for the page.
 *
 * There is no authored taxonomy here (D252 rejected one: hand-written strings with no mechanical
 * check holding them to anything). Since `M263` the grouping is the site's, read off its sidebar by
 * `gen-docs.mjs`, so the terminal and the site cannot list the same pages differently.
 *
 * Groups appear in the sidebar's order, not alphabetically: the sidebar is written to be read from
 * the top. Slugs stay in that order within their group too, for the same reason.
 */
export function renderTopicIndex(topics: readonly string[]): string {
  // Group order comes from `DOCS_TOPICS`' own key order, which `gen-docs.mjs` writes in sidebar
  // order. Reading it off `topics` instead would order the groups by whichever slug happened to
  // sort first inside each, which is alphabetical order wearing a disguise.
  const byGroup = new Map<string, string[]>();
  for (const slug of Object.keys(DOCS_TOPICS)) byGroup.set(DOCS_TOPICS[slug]!.group, []);
  const wanted = new Set(topics);
  for (const slug of Object.keys(DOCS_TOPICS)) if (wanted.has(slug)) byGroup.get(DOCS_TOPICS[slug]!.group)?.push(slug);

  const lines: string[] = [];
  for (const [group, slugs] of byGroup) {
    if (slugs.length === 0) continue;
    lines.push(group);
    // Column width per group, not across the whole list: alignment only has to hold where the eye
    // is scanning, which is inside a group.
    const width = Math.max(...slugs.map((s) => s.length));
    for (const slug of slugs) {
      // A group's overview page is named by the group heading printed directly above it, so
      // repeating the identical name in the second column says nothing twice.
      const title = DOCS_TOPICS[slug]?.listTitle ?? '';
      lines.push(title === group ? `  ${slug}` : `  ${slug.padEnd(width)}  ${title}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
