// `M269` (`D1443`) — one rail per section, as VitePress drew it. See `src/lib/navigation.mjs`.
//
// Starlight builds one sidebar from every section's group; this keeps the group that matches the
// page and recomputes previous/next from it, so the footer links stay inside the section the
// reader is in, as they did before.
import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { EARLIER } from './lib/changelog.mjs';
import { sectionFor } from './lib/navigation.mjs';

type Entry = { type: 'link' | 'group'; label: string; isCurrent?: boolean; entries?: Entry[] };

const links = (entries: Entry[]): Entry[] => entries.flatMap((e) => (e.type === 'group' ? links(e.entries ?? []) : [e]));

export const onRequest = defineRouteMiddleware(({ locals, site }) => {
  const route = locals.starlightRoute;
  const index = /(^|\/)index\.mdx?$/.test(route.entry.filePath ?? '');
  const path = `/${route.id}${index && route.id !== '' ? '/' : ''}`;
  const key = sectionFor(path);
  const section = (route.sidebar as Entry[]).find((g) => g.type === 'group' && g.label === key);
  route.sidebar = (section?.entries ?? []) as typeof route.sidebar;
  const flat = links(section?.entries ?? []);
  const at = flat.findIndex((e) => e.isCurrent);
  route.pagination = {
    prev: (at > 0 ? flat[at - 1] : undefined) as typeof route.pagination.prev,
    next: (at >= 0 && at < flat.length - 1 ? flat[at + 1] : undefined) as typeof route.pagination.next,
  };
  route.head = withAddress(route.head, path, site);
  if (route.toc !== undefined) route.toc = { ...route.toc, items: openOnly(route.toc.items) };
});

type TocItem = { slug: string; text: string; depth: number; children: TocItem[] };

/**
 * The rail lists what the page shows open (`M270`, `D-M270-6`). On the Changelog the entries after
 * the newest few sit in a fold (`src/lib/changelog.mjs`): they keep their headings and ids, so a link
 * still lands, but listing all 90 on the rail is what made it useless. So under the release that
 * holds the *Earlier changes* heading the rail stops there, and a release after it lists no entries.
 * Every other page has no such heading and its rail is untouched.
 */
export function openOnly<T extends TocItem>(items: T[]): T[] {
  const at = items.findIndex((i) => i.children.some((c) => c.slug === EARLIER));
  if (at === -1) return items;
  return items.map((item, i) => {
    if (i < at) return item;
    if (i === at) return { ...item, children: item.children.slice(0, item.children.findIndex((c) => c.slug === EARLIER) + 1) };
    return { ...item, children: [] };
  });
}

/**
 * The page's own address, in the canonical link and `og:url`. Starlight formats the canonical for
 * `build.format: 'file'` and `'directory'` but not `'preserve'`, which this site needs (`D1441`). It
 * builds it from the output file's path and then appends a slash, so every page claimed an address
 * like `…/guide/config.html/` that GitHub Pages does not serve. This writes the address the sitemap
 * lists and a reader types instead: `…/guide/config`, `…/ui/`, `…/`.
 */
export function withAddress<T extends { tag: string; attrs?: Record<string, string | boolean | undefined> }>(head: T[], path: string, site: URL | undefined): T[] {
  if (site === undefined) return head;
  const href = new URL(`${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`, site).href;
  return head.map((e) => {
    if (e.tag === 'link' && e.attrs?.rel === 'canonical') return { ...e, attrs: { ...e.attrs, href } };
    if (e.tag === 'meta' && e.attrs?.property === 'og:url') return { ...e, attrs: { ...e.attrs, content: href } };
    return e;
  });
}
