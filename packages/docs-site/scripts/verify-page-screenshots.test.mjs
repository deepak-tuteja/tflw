// The `/page/` pictures describe the page as it is now (`M233` `B`, `D1283`).
//
// Every other claim this site makes is checked against something: a construct against the
// manifest, an invocation against `CLI_FLAGS`, a sample against the shipped checker. **A PNG is
// checked against nothing at all** — it is the one artefact that goes on describing a build that
// no longer exists without anyone touching it. So the pictures are held by their *inputs*:
// `packages/ui/scripts/screenshot-inputs.mjs` hashes everything the generator reads, and a
// manifest whose hash has moved means the shots are stale until the script is re-run.
//
// PIXELS ARE NOT THE SUBJECT. They differ by font, by machine and by Chromium build; the inputs do
// not. Nothing here opens an image beyond its first eight bytes.
//
// THREE DRAFT DEFECTS ARE FIXED HERE, and each is named because each is a class this repository
// has paid for (`M233` §0):
//
//  1. **The hash was narrower than the picture it guarded.** `M192` U8's draft hashed six paths
//     while its generator read the whole fixture corpus and imported `ui-server.ts` — `M167`'s
//     family, a gate that reads one of the things it is guarding. Fixed in `screenshot-inputs.mjs`.
//  2. **Nothing checked the picture renders.** Asserting the markdown *string* contains a file name
//     passes green while the deployed page 404s, and this site is served from a project subpath
//     (`base: '/tflw/'`) that has already cost one scar in `config.ts`. So the last test reads
//     `.vitepress/dist` — the artefact, not the label.
//  3. **The draft was anchored on a file name.** It asserted against one `guide/the-page.md` and a
//     flat shot list, both of which `D1277` and `D1282` change out from under it. Everything here
//     is anchored on a *structure* instead: the `page/` directory, whatever it holds, and the
//     manifest's own declared set. That is `M228`'s carry — *a string-anchored edit must be
//     anchored on a structure* — applied to a gate rather than to an edit.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DOCS_PAGE_DIR, SHOTS, THEMES, appearanceOf, screenshotInputsHash, shotExists } from '../../ui/scripts/screenshot-inputs.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const SITE = join(here, '..');
const PAGE_MD_DIR = join(SITE, 'page');
const DIST = join(SITE, '.vitepress', 'dist');
const MANIFEST_PATH = join(DOCS_PAGE_DIR, 'manifest.json');
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RECUT = 'run: node --import tsx packages/ui/scripts/make-screenshots.mjs';

/** Every `![alt](/page/NAME.png){.class}` the `/page/` surface writes, wherever it writes it. */
function embeds() {
  const out = [];
  if (!existsSync(PAGE_MD_DIR)) return out;
  for (const name of readdirSync(PAGE_MD_DIR).sort()) {
    if (!name.endsWith('.md')) continue;
    const text = readFileSync(join(PAGE_MD_DIR, name), 'utf8');
    for (const m of text.matchAll(/!\[([^\]]*)\]\(\/page\/([A-Za-z0-9._-]+)\)(\{[^}]*\})?/g)) {
      out.push({ page: name, alt: m[1], shot: m[2], attrs: m[3] ?? '' });
    }
  }
  return out;
}

test('the manifest was cut from the page as it is now', () => {
  assert.ok(existsSync(MANIFEST_PATH), `there is no ${MANIFEST_PATH} — ${RECUT}`);
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  assert.deepEqual(manifest.shots, SHOTS, 'the manifest names a different set of shots than the generator cuts');
  assert.equal(
    manifest.inputs,
    screenshotInputsHash(),
    `the page, its fixture corpus, the server or the generator changed since the shots were cut — ${RECUT}`,
  );
});

test('every declared shot exists and is a PNG', () => {
  // The manifest is a claim about a set; this is the set. A manifest naming ten files while two of
  // them are absent is the shape the hash check alone cannot see, because the hash is over the
  // *inputs* and says nothing about the outputs.
  assert.ok(SHOTS.length > 0, 'the generator declares no shots at all — every rule below would pass over an empty set');
  for (const name of SHOTS) {
    assert.ok(shotExists(name), `${name} is missing — ${RECUT}`);
    const head = [...readFileSync(join(DOCS_PAGE_DIR, name)).subarray(0, 8)];
    assert.deepEqual(head, PNG_MAGIC, `${name} is not a PNG`);
  }
});

test('the `/page/` surface embeds every shot, and embeds nothing that is not there', () => {
  // Both directions, and `M201`'s carry is why: *a floor is blind in exactly one direction*. A
  // rule that only checks "every embed resolves" is satisfied by a page that embeds nothing; one
  // that only checks "every shot is embedded" is satisfied by a page embedding a file that 404s.
  const found = embeds();
  assert.ok(found.length > 0, `the /page/ surface embeds no pictures at all — ${PAGE_MD_DIR} has no image reference`);
  const referenced = new Set(found.map((e) => e.shot));
  for (const name of SHOTS) assert.ok(referenced.has(name), `no /page/ page embeds ${name}`);
  for (const e of found) assert.ok(shotExists(e.shot), `${e.page} embeds /page/${e.shot}, which does not exist`);
});

test('each embed is tagged for the appearance its theme belongs to', () => {
  // `D1282`'s whole claim: a picture ships as a light/dark PAIR and VitePress swaps them off the
  // reader's appearance. An untagged pair renders BOTH, one above the other, which is not a
  // broken build and not a visible error — it is a page that quietly shows the same picture twice.
  // Nothing else on this site would catch that.
  const found = embeds();
  assert.equal(THEMES.length, 2, 'this rule is written for exactly two appearances');
  for (const e of found) {
    const want = appearanceOf(e.shot);
    assert.notEqual(want, null, `${e.shot} does not end in a known theme, so no appearance class can be right for it`);
    assert.match(
      e.attrs,
      new RegExp(`\\.${want}-only\\b`),
      `${e.page} embeds ${e.shot} without {.${want}-only} — both halves of the pair will render`,
    );
  }
  // And every alt text says something, because a picture carrying the whole description of a
  // surface is exactly the one a screen reader must not be handed empty.
  for (const e of found) assert.ok(e.alt.trim().length > 0, `${e.page} embeds ${e.shot} with no alt text`);
});

test('the built site serves the pictures at the deployed base path', () => {
  // `M233` §0 defect 2, and the reason it is worth a test of its own: this site is served from
  // `base: '/tflw/'`, and a path that is right in the markdown can still be wrong in `dist` —
  // `config.ts` already carries a scar from exactly that asymmetry (`themeConfig.logo` is
  // base-prefixed automatically and a `head` link is not). Asserting the markdown proves the
  // author's intent; this asserts the artefact.
  assert.ok(
    existsSync(DIST),
    `the site is not built — expected ${DIST}.\n       Run \`npm run build -w @tflw/docs-site\` first (CI's \`npm run build\` does this).`,
  );
  for (const name of SHOTS) {
    assert.ok(existsSync(join(DIST, 'page', name)), `${name} did not reach dist/page/ — it will 404 on the deployed site`);
  }
  const html = readdirSync(join(DIST, 'page'), { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.html'))
    .map((d) => readFileSync(join(DIST, 'page', d.name), 'utf8'))
    .join('\n');
  assert.ok(html.length > 0, 'the built site has no /page/ HTML at all');
  for (const name of SHOTS) {
    assert.ok(html.includes(`/tflw/page/${name}`), `the built /page/ HTML does not reference /tflw/page/${name} — the base path was not applied`);
  }
});
