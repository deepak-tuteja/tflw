// `M213` `S2` — ticking a response into an assertion (`D1100`).
//
// THE INSTRUMENT UNDER TEST IS A TRANSLATION, so the claims are about what it writes and not about
// what it draws: a path the language cannot spell, a subset that changes what the author meant, and
// a one-versus-several rule that has to hold in both directions. Every sentence built here is put
// through `buildExpect` and the printer as well as compared as a spec — because a spec that builds
// into a node the printer refuses is a button that does nothing, and that is a state a shape
// comparison cannot see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCapture, buildExpect, print } from '@tflw/lang';

import { captureName, captureSpecs, leaves, subsetText, verifySpec, LEAF_CAP } from '../src/response.ts';

/** A spec, all the way to the line it writes. `null` when the builder or the printer refuses,
 *  which is the thing several of these tests are about. */
function sentence(spec: Parameters<typeof buildExpect>[0]): string | null {
  const built = buildExpect(spec);
  if (!built.ok) return null;
  const printed = print(built.node, { indent: 0 });
  return printed.ok ? printed.text.trim() : null;
}

test('every scalar in a body is a tickable leaf, with the language spelling for its path', () => {
  const found = leaves('{"user":{"id":4021,"status":"active"},"ok":true,"none":null}');
  assert.deepEqual(
    found.leaves.map((l) => `${l.path} = ${l.valueText}`),
    ['user.id = 4021', 'user.status = "active"', 'ok = true', 'none = null'],
  );
  assert.equal(found.skipped, 0);
  assert.equal(found.capped, false);
});

test('an empty object and an empty array are leaves — they are things an author asserts about', () => {
  const found = leaves('{"errors":[],"meta":{}}');
  assert.deepEqual(found.leaves.map((l) => `${l.path} = ${l.valueText}`), ['errors = []', 'meta = {}']);
  // And the sentence each one writes is one the language accepts.
  const out = verifySpec([found.leaves[0]!]);
  assert.ok(out?.ok);
  assert.equal(sentence(out.spec), 'expect body.errors equals []');
});

test('a body that is not JSON offers nothing to tick, and does not throw', () => {
  const found = leaves('<html><body>nope</body></html>');
  assert.deepEqual(found.leaves, []);
  assert.equal(found.skipped, 0);
});

test('a leaf under an array index is not subsetable, and every other one is', () => {
  const found = leaves('{"total":2,"items":[{"id":7},{"id":8}]}');
  const by = new Map(found.leaves.map((l) => [l.path, l.subsetable]));
  assert.equal(by.get('total'), true);
  assert.equal(by.get('items[0].id'), false, 'a path that crosses `[0]` cannot join a subset');
  assert.equal(by.get('items[1].id'), false);
});

test('one tick is a path assertion', () => {
  const found = leaves('{"user":{"id":4021}}');
  const out = verifySpec(found.leaves);
  assert.ok(out?.ok);
  assert.equal(sentence(out.spec), 'expect body.user.id equals 4021');
});

test('several ticks are one `matches subset`, nested the way the response is', () => {
  const found = leaves('{"user":{"id":4021,"status":"active"}}');
  const out = verifySpec(found.leaves);
  assert.ok(out?.ok);
  /* `D1100`'s own example, printed by the language rather than by this test — **and the quotes
     `subsetText` writes are gone**, because `print` emits a bare key wherever the grammar admits
     one. That is why quoting every key unconditionally is safe: the operand is parsed and
     reprinted before it reaches a file, so the one rule and the two-rule version land on the same
     bytes. It holds for every key this module can produce, since a key needing quotes is one
     `body.<path>` cannot spell and is filtered out of the tick list before it gets here. */
  assert.equal(sentence(out.spec), 'expect body matches subset { user: { id: 4021, status: "active" } }');
});

test('the subset is nested and not flattened — a dotted key would name a key with a dot in it', () => {
  const text = subsetText([
    { path: 'a.b.c', valueText: '1', subsetable: true },
    { path: 'a.b.d', valueText: '2', subsetable: true },
    { path: 'e', valueText: 'true', subsetable: true },
  ]);
  assert.equal(text, '{ "a": { "b": { "c": 1, "d": 2 } }, "e": true }');
  assert.ok(!text.includes('a.b'), 'a flattened key would assert a top-level key spelled with dots');
});

test('`M230` `B`: a quoted key nests by its own name, and a dot inside it is part of the key', () => {
  // The regression `D1262` created and this gate closes: `subsetText` split the path on `.`, which
  // was correct for exactly as long as a key could not contain one. `a."b.c"` is two segments; a
  // split makes it three, and the subset then asserts against keys the response does not have.
  const text = subsetText([
    { path: 'a."b.c"', valueText: '1', subsetable: true },
    { path: '"content-type"', valueText: '"json"', subsetable: true },
  ]);
  assert.equal(text, '{ "a": { "b.c": 1 }, "content-type": "json" }');
});

test('ticking an array leaf WITH anything else is refused, with the reason — it would widen the claim', () => {
  const found = leaves('{"total":2,"items":[{"id":7}]}');
  const both = found.leaves.filter((l) => l.path === 'total' || l.path === 'items[0].id');
  assert.equal(both.length, 2);
  const out = verifySpec(both);
  assert.ok(out !== null && !out.ok);
  assert.match(out.reason, /items\[0\]\.id/);
  assert.match(out.reason, /compares a list exactly/);
});

test('…and on its own that same leaf is a perfectly ordinary path assertion', () => {
  const found = leaves('{"items":[{"id":7}]}');
  const out = verifySpec(found.leaves.filter((l) => l.path === 'items[0].id'));
  assert.ok(out?.ok);
  assert.equal(sentence(out.spec), 'expect body.items[0].id equals 7');
});

test('no ticks build nothing at all — never an empty subset, which asserts nothing and passes', () => {
  assert.equal(verifySpec([]), null);
});

/**
 * **`M213-18` is closed, and this is the test that used to record it as open** (`M230` `B`,
 * `D1262`). The assertion is inverted deliberately rather than deleted: this count is the row's
 * own instrument — it is what made the gap visible in the first place, by enumerating paths no
 * person would have typed — so the cheapest honest proof that the repair reached the *product*
 * and not only the grammar is that the same three keys now produce three offers and a `skipped`
 * of zero.
 *
 * Its previous body is worth keeping in view, because the difference is the whole round:
 *
 *     assert.deepEqual(found.leaves.map((l) => l.path), ['fine']);
 *     assert.equal(found.skipped, 2, 'a hyphenated key and a numeric key are both unspellable');
 */
test('`M230` `B`: a hyphenated and a numeric key are offered, quoted, and build (`M213-18` closed)', () => {
  const found = leaves('{"content-type":"json","0":"first","fine":1}');
  // `"0"` leads because `Object.keys` puts integer-like keys first — the walk reads the body, not
  // the source text, and this order is the browser's rather than anyone's choice.
  assert.deepEqual(
    found.leaves.map((l) => l.path),
    ['"0"', '"content-type"', 'fine'],
  );
  assert.equal(found.skipped, 0, 'nothing in this body is unspellable any more');
  // The control that matters: an offered path is one the builder really takes, in the language's
  // own spelling. A pane that *listed* a key it could not write would be the defect this replaced,
  // pointing the other way.
  const one = verifySpec(found.leaves.filter((l) => l.path === '"content-type"'));
  assert.ok(one?.ok);
  assert.equal(sentence(one.spec), 'expect body."content-type" equals "json"');
  // …and all three together are a subset, keyed by the **decoded** names rather than by the path's
  // spelling. `fine` comes back bare and the other two keep their quotes, which is `print`
  // reapplying the grammar's own rule — see `subsetText`'s docblock: this module quotes every key
  // it writes and the printer un-quotes the ones that do not need it.
  const all = verifySpec(found.leaves);
  assert.ok(all?.ok);
  assert.equal(sentence(all.spec), 'expect body matches subset { "0": "first", "content-type": "json", fine: 1 }');
});

test('the tick list is capped and says so; the cap is on the list, never on the body', () => {
  const big = JSON.stringify(Object.fromEntries(Array.from({ length: LEAF_CAP + 50 }, (_, i) => [`k${i}`, i])));
  const found = leaves(big);
  assert.equal(found.leaves.length, LEAF_CAP);
  assert.equal(found.capped, true);
});

test('a scalar body ticks as `body` itself, and not as `body text` — the types differ', () => {
  const found = leaves('42');
  assert.deepEqual(found.leaves.map((l) => `${l.path}=${l.valueText}`), ['=42']);
  const out = verifySpec(found.leaves);
  assert.ok(out?.ok);
  // `body text` would compare the string "42"; `body` compares the value 42.
  assert.equal(sentence(out.spec), 'expect body equals 42');
});

test('a ticked string carrying a quote survives, because nothing here concatenates', () => {
  const found = leaves('{"note":"say \\"hi\\""}');
  const out = verifySpec(found.leaves);
  assert.ok(out?.ok);
  assert.equal(sentence(out.spec), 'expect body.note equals "say \\"hi\\""');
});

// ---------------------------------------------------------------------------------------------
// `M213` `S3` — the same ticks, bound instead of asserted (`D1102`).

test('a ticked path binds the name the author already calls it — the last segment', () => {
  const found = leaves('{"data":{"orderId":9,"token":"abc"}}');
  assert.deepEqual(captureSpecs(found.leaves).map((c) => c.name), ['orderId', 'token']);
  // **Not the dotted path flattened.** `dataOrderId` reads like nothing anybody wrote, and the
  // same value under a different envelope would bind a different name.
  assert.deepEqual(captureSpecs(found.leaves).map((c) => c.subject), [
    { kind: 'body', path: 'data.orderId' },
    { kind: 'body', path: 'data.token' },
  ]);
});

test('an index is not a name character, so it is not in the name', () => {
  assert.equal(captureName('items[0].id'), 'id');
  assert.equal(captureName('items[0]'), 'items');
});

test('N ticks are N captures — a capture binds one name to one value and there is no n-ary form', () => {
  const found = leaves('{"a":1,"b":2,"c":3}');
  const specs = captureSpecs(found.leaves);
  assert.equal(specs.length, 3);
  // And each one builds and prints, which is what makes the single insertion legal.
  for (const spec of specs) {
    const built = buildCapture(spec);
    assert.ok(built.ok, built.ok ? '' : built.reason);
    const printed = print(built.node, { indent: 0 });
    assert.ok(printed.ok);
    assert.match(printed.text.trim(), /^capture body\.[abc] as [abc]$/);
  }
});

test('an array leaf CAN be captured, unlike in a subset — it reads one value and claims nothing about the list', () => {
  const found = leaves('{"items":[{"id":7}]}');
  const only = found.leaves.filter((l) => l.path === 'items[0].id');
  assert.equal(only[0]!.subsetable, false, 'the subset rule still bars it');
  const built = buildCapture(captureSpecs(only)[0]!);
  assert.ok(built.ok, built.ok ? '' : built.reason);
  const printed = print(built.node, { indent: 0 });
  assert.equal(printed.ok ? printed.text.trim() : '', 'capture body.items[0].id as id');
});
