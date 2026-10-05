// `M270` (`D-M270-6`) — the Changelog page: the newest entries open, the rest folded.
//
// `CHANGELOG.md` is one `## [Unreleased]` holding every entry since `0.1.0`, because nothing has been
// published, so there is no release to fold by: the page was 62 screens and its rail listed all 90
// entries. The record is untouched and still published whole. On the page, the first `OPEN` entries
// read as they always did; everything after them sits under an *Earlier changes* heading in one
// fold, and each older release in a fold of its own. Every entry keeps its heading and its id, so a
// link to one still lands — and opens its fold (`MarkdownContent.astro`). The rail lists what is
// open (`route-data.ts`), which reads `OPEN` and `EARLIER` from here.

/** How many of the newest entries the page shows open. */
export const OPEN = 10;
/** The id of the heading the fold of older entries sits under. */
export const EARLIER = 'earlier-changes';

const html = (value) => ({ type: 'html', value });
const isHeading = (n, depth) => n.type === 'heading' && n.depth === depth;

/** The record's nodes → the page's. */
export function changelogPage(nodes, record = 'CHANGELOG.md') {
  const releases = nodes.flatMap((n, i) => (isHeading(n, 2) ? [i] : []));
  if (releases.length === 0) throw new Error(`${record}: no \`## [version]\` section to publish`);
  const out = nodes.slice(0, releases[0]);
  releases.forEach((start, r) => {
    const end = releases[r + 1] ?? nodes.length;
    const section = nodes.slice(start + 1, end);
    out.push(nodes[start]);
    const entries = section.flatMap((n, i) => (isHeading(n, 3) ? [i] : []));
    if (r === 0) {
      // The open release: its preamble and the newest `OPEN` entries, then the rest in one fold.
      if (entries.length <= OPEN) {
        out.push(...section);
        return;
      }
      const cut = entries[OPEN];
      out.push(...section.slice(0, cut));
      out.push(
        { type: 'heading', depth: 3, children: [{ type: 'text', value: 'Earlier changes' }], data: { hProperties: { id: EARLIER } } },
        html(`<details class="tflw-fold">\n<summary>Show the ${entries.length - OPEN} earlier entries, newest first</summary>`),
        ...section.slice(cut),
        html('</details>'),
      );
      return;
    }
    // An older release: folded whole under its own heading.
    out.push(html(`<details class="tflw-fold">\n<summary>Show the ${entries.length} entries</summary>`), ...section, html('</details>'));
  });
  return out;
}
