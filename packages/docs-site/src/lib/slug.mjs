// `M269` (`D1441`) — VitePress's heading-id rule, so every anchor the VitePress site published
// still resolves. Used by `markdown.mjs` for headings and by `PageTitle.astro` for the title.
//
/** `@mdit-vue/shared`'s `slugify`, which VitePress 1.6 gives `markdown-it-anchor`. */
const rControl = /[\u0000-\u001f]/g;
const rSpecial = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g;
const rCombining = /[\u0300-\u036F]/g;
export const vitepressSlug = (str) =>
  str
    .normalize('NFKD')
    .replace(rCombining, '')
    .replace(rControl, '')
    .replace(rSpecial, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase();
