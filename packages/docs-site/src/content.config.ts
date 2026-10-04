// `M269` (`D1440`) — the pages are Starlight's `docs` collection, with two additions.
//
// **A page's title is its own `# H1`.** Every page here opens with one and 56 of 61 carry no
// `title:` frontmatter, because VitePress read the H1. Starlight requires `title` before a page
// renders, so the loader lifts it from the H1 when the frontmatter has none, rather than every page
// stating its title twice. `remarkTflwPages` then drops that H1 from the body, since Starlight
// draws the title itself. `titleSource` keeps the H1 as written, so a title carrying inline code
// (`` `if` ``) is drawn as code by `PageTitle.astro` while `<title>` gets the plain words.
//
// **The schema knows the fields this site's pages use that Starlight's does not:** `pageClass`
// (the two page-scoped style hooks, `D1443`), and the home page's `features` and
// `taglinePublished` (`M253` `F`). Zod drops unknown keys, so an unlisted field would vanish
// without an error.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { firstH1, titleFrom } from './lib/title.mjs';

function pagesLoader() {
  const inner = docsLoader();
  return {
    ...inner,
    load: (context: Parameters<typeof inner.load>[0]) =>
      inner.load({
        ...context,
        parseData: (props) => {
          const data = props.data as Record<string, unknown>;
          if (data.title === undefined && props.filePath !== undefined) {
            const h1 = firstH1(readFileSync(resolve(props.filePath), 'utf8'));
            if (h1 !== undefined) Object.assign(data, titleFrom(h1));
          }
          return context.parseData(props);
        },
      }),
  };
}

const feature = z.object({
  title: z.string(),
  details: z.string(),
  link: z.string().optional(),
  linkText: z.string().optional(),
});

export const collections = {
  docs: defineCollection({
    loader: pagesLoader(),
    schema: docsSchema({
      extend: z.object({
        titleSource: z.string().optional(),
        pageClass: z.string().optional(),
        features: z.array(feature).optional(),
        taglinePublished: z.string().optional(),
      }),
    }),
  }),
};
