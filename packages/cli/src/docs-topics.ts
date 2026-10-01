// What `tflw docs` prints (`M263`): the docs site's Guide and Reference pages, one topic per page.
//
// `scripts/gen-docs.mjs` turns each page into text plus, for the reference pages' tables, a
// description of the rows (which manifest, which filter, which columns). This module renders those
// rows from the same `spec-data.ts` manifests the site renders them from, so a flag, a matcher or a
// diagnostic reads the same in the terminal as on the page and neither can drift from the other.

import { CLI_FLAGS, DIAGNOSTICS, GENERATORS, MATCHERS } from '@tflw/lang';
import { DOCS_PAGES } from './docs-data.generated.js';

export interface DocsColumn {
  readonly label: string;
  readonly key: string;
  /** The status ternary: the value `when` prints `yes`, any other value prints `no`. */
  readonly when?: string;
  readonly yes?: string;
  readonly no?: string;
}

export interface DocsTable {
  readonly source: 'CLI_FLAGS' | 'DIAGNOSTICS' | 'GENERATORS' | 'MATCHERS';
  readonly where?: { readonly key: string; readonly value: string };
  readonly cols: readonly DocsColumn[];
}

export type DocsSegment = string | { readonly table: DocsTable };

export interface DocsPageSource {
  readonly slug: string;
  readonly title: string;
  readonly listTitle: string;
  readonly group: string;
  readonly intro: readonly DocsSegment[];
  readonly sections: readonly { readonly slug: string; readonly title: string; readonly body: readonly DocsSegment[] }[];
}

export interface DocsSection {
  readonly slug: string;
  readonly title: string;
  readonly body: string;
}

export interface DocsTopic {
  /** The page's own `#` title, printed over it. */
  readonly title: string;
  /** What the listing calls it: the sidebar's words, which are what the site calls it too. */
  readonly listTitle: string;
  readonly group: string;
  /** The whole page. */
  readonly body: string;
  readonly sections: readonly DocsSection[];
}

const MANIFEST: Record<DocsTable['source'], readonly object[]> = { CLI_FLAGS, DIAGNOSTICS, GENERATORS, MATCHERS };

/** A table as a list a terminal can wrap: each row's first column on a line of its own, the rest
 * indented under it — labelled when there is more than one, since a lone second column (a flag's
 * effect) needs no name. */
export function renderTable(t: DocsTable): string {
  const rows = MANIFEST[t.source].filter((r) => t.where === undefined || (r as Record<string, unknown>)[t.where.key] === t.where.value);
  const cell = (r: object, c: DocsColumn): string => {
    const v = (r as Record<string, unknown>)[c.key];
    // A status column prints only its exception: `✅` on every shipped matcher says nothing, and the
    // one row that is planned is the row a reader needs told.
    if (c.when !== undefined) return v === c.when ? '' : (c.no ?? '');
    return v === undefined || v === null ? '' : String(v);
  };
  const [head, ...rest] = t.cols;
  return rows
    .map((r) => {
      const lines = [`  ${cell(r, head!)}`];
      for (const c of rest) {
        const v = cell(r, c);
        if (v !== '') lines.push(rest.length === 1 ? `      ${v}` : `      ${c.label}: ${v}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

function renderSegments(segs: readonly DocsSegment[]): string {
  return segs.map((s) => (typeof s === 'string' ? s : renderTable(s.table))).join('\n\n');
}

/** A section as it sits inside its page: its title underlined, then its body. */
export function sectionText(s: DocsSection): string {
  return `${s.title}\n${'-'.repeat(s.title.length)}\n\n${s.body}`;
}

function build(): Record<string, DocsTopic> {
  const topics: Record<string, DocsTopic> = {};
  for (const p of DOCS_PAGES) {
    const sections = p.sections.map((s) => ({ slug: s.slug, title: s.title, body: renderSegments(s.body) }));
    const body = [renderSegments(p.intro), ...sections.map(sectionText)].filter((s) => s !== '').join('\n\n');
    topics[p.slug] = { title: p.title, listTitle: p.listTitle, group: p.group, body, sections };
  }
  return topics;
}

/** Every topic, keyed by slug, in the site's sidebar order. */
export const DOCS_TOPICS: Readonly<Record<string, DocsTopic>> = build();

/**
 * The sections a word names. `tflw docs cli run` and, for a word that is no topic at all,
 * `tflw docs unique` both come here: a section matches when the query's words are consecutive words
 * of its title (`run` matches `` `tflw run` ``, not `` `tflw runs` ``). An exact title wins outright.
 */
export function findSections(query: string, within?: string): { topic: string; section: DocsSection }[] {
  const words = query.toLowerCase().replace(/`/g, '').replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter(Boolean);
  if (words.length === 0) return [];
  // Three ranks, the best non-empty one wins: the whole title, the title's opening words, any run
  // of its words. `unique` names *`unique` vs. `random`* before *identity per VU … and `unique`*.
  const ranks: { topic: string; section: DocsSection }[][] = [[], [], []];
  for (const [topic, t] of Object.entries(DOCS_TOPICS)) {
    if (within !== undefined && topic !== within) continue;
    for (const section of t.sections) {
      const parts = section.slug.split('-');
      const at = (i: number): boolean => words.every((w, k) => parts[i + k] === w);
      if (parts.length === words.length && at(0)) ranks[0]!.push({ topic, section });
      else if (at(0)) ranks[1]!.push({ topic, section });
      else if (parts.some((_, i) => at(i))) ranks[2]!.push({ topic, section });
    }
  }
  return ranks.find((r) => r.length > 0) ?? [];
}
