// `M269` (`D1443`) — one rail per section, as VitePress drew it. See `src/lib/navigation.mjs`.
//
// Starlight builds one sidebar from every section's group; this keeps the group that matches the
// page and recomputes previous/next from it, so the footer links stay inside the section the
// reader is in, as they did before.
import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { sectionFor } from './lib/navigation.mjs';

type Entry = { type: 'link' | 'group'; label: string; isCurrent?: boolean; entries?: Entry[] };

const links = (entries: Entry[]): Entry[] => entries.flatMap((e) => (e.type === 'group' ? links(e.entries ?? []) : [e]));

export const onRequest = defineRouteMiddleware(({ locals }) => {
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
});
