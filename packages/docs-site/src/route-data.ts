// `M269` (`D1443`) — one rail per section, as VitePress drew it. See `src/lib/navigation.mjs`.
//
// Starlight builds one sidebar from every section's group; this keeps the group that matches the
// page and recomputes previous/next from it, so the footer links stay inside the section the
// reader is in, as they did before.
import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
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
});

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
