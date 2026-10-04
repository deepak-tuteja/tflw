// `M269` (`D1443`) — `src/sidebar.mjs`'s VitePress-shaped navigation, given to Starlight.
//
// VitePress chose a sidebar by the longest key of `SIDEBARS` that prefixes the page's path, so the
// guide, the UI section, the runbook and the reference each have their own rail. Starlight has one
// sidebar. So each key becomes one top-level group, labelled with the key, and
// `src/route-data.ts` replaces the sidebar with that group's entries on every page — the same
// longest-prefix choice, made per request instead of by the theme.
//
// A VitePress group can carry a `link` of its own — `D654`'s pillar overview, the thing the
// chapters are under. A Starlight group cannot, so the overview becomes the group's first entry,
// labelled `Overview`; the data keeps the `link`, and `gen-docs.mjs` still reads it as the overview.
import { SIDEBARS } from '../sidebar.mjs';

const toItem = (i) => ({ label: i.text, link: i.link });

function toGroup(g) {
  const items = [...(g.link ? [{ label: 'Overview', link: g.link }] : []), ...(g.items ?? []).map(toItem)];
  return { label: g.text, collapsed: g.collapsed ?? false, items };
}

/** Starlight's `sidebar` config: one group per `SIDEBARS` key, labelled with the key. */
export function starlightSidebar() {
  return Object.entries(SIDEBARS).map(([key, groups]) => ({ label: key, items: groups.map(toGroup) }));
}

/** The `SIDEBARS` key VitePress would have picked for a page path: the longest that prefixes it. */
export function sectionFor(path) {
  return Object.keys(SIDEBARS)
    .filter((key) => path.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
}
