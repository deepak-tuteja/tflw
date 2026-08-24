// The anchor gate, run against the shapes that fool it (`M152c`, `D677`).
//
// A gate over addresses has one hard job and it is not resolution — it is telling an address from a
// mention of one. `verify-citations.mjs` learned that about citations (`D697`); the first draft of
// this gate had to learn it again about fragments, and produced four findings that were all the same
// mistake: `CONTRIBUTING.md` illustrating a fragment's shape in backticks, two script comments
// quoting one, and a synthetic link inside a test fixture. So every exclusion below is tested as a
// **pair** — the excluded form beside the near-identical form that must still be caught — because an
// exclusion that swallowed the real defect too would otherwise pass silently.
//
// `clean()` comes first for the same reason it does in the sibling: a gate that always complains
// proves nothing, and the cheapest way to be accidentally green is to be accidentally red.

import test from 'node:test';
import assert from 'node:assert/strict';
import { findDeadReferences } from './verify-anchors.mjs';

// Two headings, one of which carries the punctuation that caused every real defect.
const SPEC = ['# testFlow — SPEC', '', '## 3. The config dialect (P#27–31) ✅', '', '## 12. CLI ✅', ''].join('\n');
const LIVE = '#3-the-config-dialect-p2731-';
const DEAD = '#3-the-config-dialect-p27-31';

const scan = (text, path = 'guide/config.md') => findDeadReferences(SPEC, [{ path, text }]);
const fragments = (text, path) => scan(text, path).dead.map((d) => d.fragment);
const url = (fragment) => `https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md${fragment}`;

test('a file with no reference at all produces nothing', () => {
  const { dead, references } = scan('Set `baseUrl` in `tflw.config`. See the config guide.');
  assert.deepEqual(dead, []);
  assert.equal(references, 0);
});

test('a live fragment passes and a dead one is reported', () => {
  assert.deepEqual(fragments(`Full reference: [SPEC.md §3](${url(LIVE)}).`), []);
  assert.deepEqual(fragments(`Full reference: [SPEC.md §3](${url(DEAD)}).`), ['3-the-config-dialect-p27-31']);
});

test('the report names the nearest real heading, because every real defect was a near miss', () => {
  const [finding] = scan(`See [§3](${url(DEAD)}).`).dead;
  assert.equal(finding.nearest, '3-the-config-dialect-p2731-');
  assert.equal(finding.line, 1);
  assert.equal(finding.file, 'guide/config.md');
});

test('a fragment nothing resembles gets no suggestion rather than a wrong one', () => {
  const [finding] = scan(`See [§9](${url('#9-ui-steps-and-selectors-and-shadow-dom')}).`).dead;
  assert.equal(finding.nearest, null);
});

test('a fragment quoted in a code span is not an address; the same fragment as a link is', () => {
  // `CONTRIBUTING.md:124` — `` a fragment like `SPEC.md#45-…-d122` is an address that has to
  // survive `` — teaching the reader what the shape looks like, with an ellipsis where the middle
  // would be. Checking it would be the gate objecting to its own documentation.
  assert.deepEqual(fragments('a fragment like `SPEC.md' + DEAD + '` is an address that has to survive'), []);
  assert.deepEqual(fragments(`a fragment like [this](./SPEC.md${DEAD}) is an address`), ['3-the-config-dialect-p27-31']);
});

test('a bare mention outside link syntax is not an address; the same text inside it is', () => {
  assert.deepEqual(fragments(`the anchor SPEC.md${DEAD} moved when the heading was renamed`), []);
  assert.deepEqual(fragments(`the anchor [moved](SPEC.md${DEAD}) when the heading was renamed`), ['3-the-config-dialect-p27-31']);
});

test('a product fence is excluded and an ordinary fence is not', () => {
  // The asymmetry `D697` paid for. ```` ```console ```` is tflw's own output reproduced verbatim,
  // so an address inside it belongs to the transcript. Every other fence holds authored prose —
  // `GRAMMAR.md` carries three of these references in EBNF comments — and a blanket fence rule
  // would drop them, which is the mistake the citation gate made first.
  const link = `[§3](${url(DEAD)})`;
  assert.deepEqual(fragments(['```console', link, '```'].join('\n')), []);
  assert.deepEqual(fragments(['```', link, '```'].join('\n')), ['3-the-config-dialect-p27-31']);
});

test('a relative link resolves against the same anchors as an absolute one', () => {
  // `M152e` will write relative links into the sibling repository, and a fragment is equally dead
  // whichever way the path to `SPEC.md` is spelled.
  assert.deepEqual(fragments(`[§3](../SPEC.md${LIVE})`), []);
  assert.deepEqual(fragments(`[§3](../SPEC.md${DEAD})`), ['3-the-config-dialect-p27-31']);
});

test('a percent-encoded fragment is decoded before it is resolved', () => {
  // A fragment copied out of a browser's address bar arrives encoded. Comparing the raw bytes
  // would report a dead link that resolves perfectly for the reader who reported it.
  assert.deepEqual(fragments(`[§12](${url('#12-cli%2D')})`), []);
});

test('references are counted whether or not they resolve', () => {
  // The summary line says "N of M resolve". If M only counted failures, a tree with every link
  // broken and a tree with one link would print the same reassuring shape.
  const { dead, references } = scan(`[a](${url(LIVE)}) [b](${url(DEAD)}) [c](${url(LIVE)})`);
  assert.equal(references, 3);
  assert.equal(dead.length, 1);
});

test('colliding headings are handed back rather than silently resolved', () => {
  // `anchorsOf` implements GitHub's -1/-2 suffix, but the pinned corpus contains no collision, so
  // nothing here has confirmed it. The gate refuses on a collision; this asserts it is told about
  // one, paired with the ordinary case where it is not.
  const collidingSpec = '# Limits\n\n# Limits!\n';
  assert.equal(findDeadReferences(collidingSpec, []).collisions.length, 1);
  assert.equal(findDeadReferences(SPEC, []).collisions.length, 0);
});
