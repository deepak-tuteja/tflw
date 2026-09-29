// `M253` `F` (`D1351`) — every sentence the site declares true only before 1.0 sits behind the
// `PUBLISHED` flag, beside the text 1.0 day needs.
//
// `DECLARED_ROADMAP` already names each pre-1.0 sentence and why it is true today, and its header
// calls the list a publish-time worklist. That worklist was a promise to edit thirteen sentences on
// the day; this makes the edit happen now, reviewed and gated, so publish day is one flag
// (`.vitepress/published.ts`). A site page's declared sentence must sit inside a
// `<Published :when="false">` block with a `<Published>` block after it on the same page — or, for
// the home page's hero tagline, carry a `taglinePublished` twin in its frontmatter. The repository's
// own files (`README.md`, `CHANGELOG.md`, `packages/…`) are read on GitHub, where no flag reaches,
// and carry both install paths instead.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DECLARED_ROADMAP } from './doc-blocks.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const isSitePage = (key) => !['README.md', 'CHANGELOG.md'].includes(key) && !key.startsWith('packages/');

/** Where `includes` sits on `page`: inside a pre-1.0 block with a published twin, in the hero tagline with a twin, or neither. */
export function placement(page, includes) {
  const at = page.indexOf(includes);
  if (at === -1) return 'absent';
  const line = page.slice(page.lastIndexOf('\n', at) + 1, page.indexOf('\n', at));
  if (/^\s*tagline:/.test(line)) return /^\s*taglinePublished:/m.test(page) ? 'tagline-paired' : 'tagline-unpaired';
  const open = page.lastIndexOf('<Published :when="false">', at);
  const close = page.indexOf('</Published>', at);
  if (open === -1 || close === -1 || page.lastIndexOf('</Published>', at) > open) return 'unguarded';
  return page.indexOf('<Published>', close) === -1 ? 'unpaired' : 'paired';
}

test('every pre-1.0 sentence a site page declares is behind the PUBLISHED flag, with its published twin (M253 F)', () => {
  const found = [];
  for (const [key, entries] of DECLARED_ROADMAP) {
    if (!isSitePage(key)) continue;
    const page = readFileSync(join(ROOT, key), 'utf8');
    for (const e of entries) found.push([key, e.includes, placement(page, e.includes)]);
  }
  assert.ok(found.length > 0, 'the gate reads something: at least one site page declares a pre-1.0 sentence');
  assert.deepEqual(found.filter(([, , p]) => p !== 'paired' && p !== 'tagline-paired'), []);
});

test('the flag is false until the owner\'s word (D1379)', () => {
  const src = readFileSync(join(ROOT, '.vitepress', 'published.ts'), 'utf8');
  assert.match(src, /^export const PUBLISHED = false;$/m, 'flipping this is publish day\'s step 5, not a code change');
});

test('placement tells a guarded sentence from an unguarded, an unpaired and a tagline one (M253 F)', () => {
  const guarded = 'a\n<Published :when="false">\n\nnot yet X\n\n</Published>\n\n<Published>\n\nX\n\n</Published>\n';
  assert.equal(placement(guarded, 'not yet X'), 'paired');
  assert.equal(placement('a\nnot yet X\n', 'not yet X'), 'unguarded');
  assert.equal(placement('<Published :when="false">\nnot yet X\n</Published>\n', 'not yet X'), 'unpaired');
  assert.equal(placement('<Published :when="false">\n</Published>\nnot yet X\n<Published>\n</Published>\n', 'not yet X'), 'unguarded');
  assert.equal(placement('hero:\n  tagline: T. not yet X\n', 'not yet X'), 'tagline-unpaired');
  assert.equal(placement('hero:\n  tagline: T. not yet X\n  taglinePublished: T.\n', 'not yet X'), 'tagline-paired');
});
