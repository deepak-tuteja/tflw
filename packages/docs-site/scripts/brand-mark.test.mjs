// The mark has one geometry, and the UI's copy of it is generated (`M233` `H`, `D1287`).
//
// `generate-brand-assets.mjs` has emitted seven files from one `GEOMETRY` block since the brand
// round, on the argument printed in its own docblock: *"The alternative — seven hand-exported
// files — drifts the first time anyone nudges a curve, which is exactly what this script exists to
// prevent."* Nothing has ever checked that. There is no `--check`; `brand` is a hand-run script,
// and for seven files that a browser loads directly the cost of drift is a wrong picture.
//
// The eighth output is different in kind and that is why the guard lands with it: it is **source**,
// in a typechecked package, imported by two components. A stale `.tsx` does not look wrong — it
// compiles, renders, and shows a mark whose curves no longer match the favicon beside it.
//
// TWO PROPERTIES, AND THE SECOND IS NOT IMPLIED BY THE FIRST. Equality holds the file against the
// emitter, which is the whole of "is this stale". It says nothing about whether the emitter still
// honours the decision it was written for: an emitter rewritten to bake `#f2a93b` would satisfy it
// perfectly the moment someone regenerated. So the second reads the emission for `D1286`'s actual
// claim — ink deferred to the caller, rail on the token, no colour of its own anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wordmarkTsx, WORDMARK, PALETTE } from './generate-brand-assets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const COMPONENT = join(REPO, 'packages', 'ui', 'src', 'Wordmark.tsx');

test("the UI's wordmark is what the generator emits now", () => {
  const onDisk = readFileSync(COMPONENT, 'utf8');
  const emitted = wordmarkTsx();
  assert.equal(
    onDisk,
    emitted,
    `${relative(REPO, COMPONENT)} is stale — run \`npm run brand -w @tflw/docs-site\`. ` +
      'It is generated from the GEOMETRY block in generate-brand-assets.mjs and must never be hand-edited.',
  );
});

test('the emitted component defers every colour to the page it lands on', () => {
  const src = wordmarkTsx();

  // The geometry is really carried, and carried verbatim — the property the file's whole reason
  // for being generated rests on. Asserting the colours alone would pass on an empty <svg/>.
  for (const d of WORDMARK.ink) assert.ok(src.includes(`d="${d}"`), `ink stroke missing from the emission: ${d}`);
  assert.ok(src.includes(`d="${WORDMARK.rail}"`), 'the rail is missing from the emission');
  assert.ok(src.includes(`viewBox="${WORDMARK.viewBox}"`), 'the viewBox is missing');

  // `D1286` — the two token references, in the right places.
  assert.ok(src.includes('stroke="currentColor"'), 'ink must inherit the surrounding text colour');
  assert.ok(src.includes('stroke="var(--accent)"'), 'the rail must read the theme accent');

  // …and NO colour of its own. Every hex this script knows, from both palettes and the plate,
  // named rather than pattern-matched, so a new palette entry is caught by name too.
  const forbidden = [PALETTE.light.ink, PALETTE.light.rail, PALETTE.dark.ink, PALETTE.dark.rail];
  for (const hex of forbidden) {
    assert.ok(!src.toLowerCase().includes(hex.toLowerCase()), `the UI's mark must carry no baked colour, found ${hex}`);
  }
  // The general case of the same rule: the docs site's amber is one palette, and a page with four
  // themes cannot wear it (`D1286`). Any `#rrggbb` at all is the defect, not just a known one.
  const anyHex = src.match(/#[0-9a-fA-F]{3,8}\b/g);
  assert.equal(anyHex, null, `the emission must contain no colour literal, found ${anyHex?.join(', ')}`);

  // `D1289` — replacing a text node with a picture deletes an accessible name unless it is restated.
  assert.ok(src.includes('role="img"'), 'the mark must announce as an image');
  assert.ok(src.includes('aria-label="tflw"'), 'the mark must carry the name the text node had');
});
