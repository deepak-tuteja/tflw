// The `/ui/` pictures describe the page as it is now (`M233` `B`, `D1283`).
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
const PAGE_MD_DIR = join(SITE, 'ui');
const DIST = join(SITE, '.vitepress', 'dist');
const MANIFEST_PATH = join(DOCS_PAGE_DIR, 'manifest.json');
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RECUT = 'run: node --import tsx packages/ui/scripts/make-screenshots.mjs';

/** Every `![alt](/ui/NAME.png){.class}` the `/ui/` surface writes, wherever it writes it. */
function embeds() {
  const out = [];
  if (!existsSync(PAGE_MD_DIR)) return out;
  for (const name of readdirSync(PAGE_MD_DIR).sort()) {
    if (!name.endsWith('.md')) continue;
    const text = readFileSync(join(PAGE_MD_DIR, name), 'utf8');
    for (const m of text.matchAll(/!\[([^\]]*)\]\(\/ui\/([A-Za-z0-9._-]+)\)(\{[^}]*\})?/g)) {
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

test('the `/ui/` surface embeds every shot, and embeds nothing that is not there', () => {
  // Both directions, and `M201`'s carry is why: *a floor is blind in exactly one direction*. A
  // rule that only checks "every embed resolves" is satisfied by a page that embeds nothing; one
  // that only checks "every shot is embedded" is satisfied by a page embedding a file that 404s.
  const found = embeds();
  assert.ok(found.length > 0, `the /ui/ surface embeds no pictures at all — ${PAGE_MD_DIR} has no image reference`);
  const referenced = new Set(found.map((e) => e.shot));
  for (const name of SHOTS) assert.ok(referenced.has(name), `no /ui/ page embeds ${name}`);
  for (const e of found) assert.ok(shotExists(e.shot), `${e.page} embeds /ui/${e.shot}, which does not exist`);
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

test('the appearance tag is a rule the built stylesheet actually carries', () => {
  // THE TEST ABOVE IS NOT ENOUGH, and `M233` `I` found out the expensive way: it asserts the
  // author wrote `{.light-only}`, which was true from the day the shots landed and stayed true
  // while every page in this section rendered both halves of every pair.
  //
  // `{.light-only}` is not a VitePress feature. It is an attrs block that markdown-it copies onto
  // the `<img>` as a class, and a class does nothing until a stylesheet claims it. VitePress ships
  // `html:not(.dark) .VPImage.dark` for its own logo component, which a markdown image never
  // becomes — so the attribute looks supported, the build is clean, the gate above is green, and
  // the reader gets the light screenshot stacked on top of the dark one.
  //
  // So the claim is made about the ARTEFACT: the stylesheet `dist` actually serves must contain a
  // rule for each appearance class. Reading `custom.css` instead would re-make the original
  // mistake in a new place — asserting what the author typed, one layer further down.
  assert.ok(existsSync(DIST), `the site is not built — expected ${DIST}`);
  const assets = join(DIST, 'assets');
  const css = readdirSync(assets)
    .filter((n) => n.endsWith('.css'))
    .map((n) => readFileSync(join(assets, n), 'utf8'))
    .join('\n');
  assert.ok(css.length > 0, 'the built site ships no stylesheet at all — every rule below would pass over an empty string');
  for (const [theme] of THEMES) {
    const cls = appearanceOf(`x-${theme}.png`);
    assert.notEqual(cls, null, `${theme} has no appearance class`);
    // `.light-only` as a selector token, not as a substring of the markdown the minifier never
    // sees. A rule is a selector followed by a declaration block; anything less is a class name
    // mentioned in a comment.
    // `assert.ok` and not `assert.match`: the built stylesheet is 113 KB of minified font-face
    // declarations, and a failed `match` prints the whole subject. A gate whose red output has to
    // be scrolled past is a gate people stop reading.
    assert.ok(
      new RegExp(`\\.${cls}-only[^{}]*\\{[^}]*\\}`).test(css),
      `the built stylesheet has no rule for .${cls}-only — the tag is written on the <img> and the cascade ignores it, so both halves of every pair render`,
    );
  }
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
    assert.ok(existsSync(join(DIST, 'ui', name)), `${name} did not reach dist/ui/ — it will 404 on the deployed site`);
  }
  const html = readdirSync(join(DIST, 'ui'), { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.html'))
    .map((d) => readFileSync(join(DIST, 'ui', d.name), 'utf8'))
    .join('\n');
  assert.ok(html.length > 0, 'the built site has no /ui/ HTML at all');
  for (const name of SHOTS) {
    assert.ok(html.includes(`/tflw/ui/${name}`), `the built /ui/ HTML does not reference /tflw/ui/${name} — the base path was not applied`);
  }
});
