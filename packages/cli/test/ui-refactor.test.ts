// `M218` `C`/`D`/`E` — what a move or a delete would do, asked without a filesystem.
//
// The module takes the project as a map and returns writes and unlinks, so every case below is the
// interesting one rather than the one a fixture happened to allow: a move that must rewrite four
// importers, a move whose own relative imports change meaning because its directory did, a delete
// of something two files depend on, and the failure that `D1151` exists for — one member of the
// edit set that would not parse, which must leave the whole plan with nothing to write.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importersOf, planDelete, planMove, resolveSpecifier } from '../src/ui-refactor.js';

const shared = 'test "signs in"\n  api GET /session\n  expect status equals 200\n';
const importer = (spec: string) => `import "${spec}"\n\ntest "checks out"\n  api GET /orders\n  expect status equals 200\n`;

/** A project whose `tests/checkout.tflw` and `tests/basket.tflw` both import `shared/login.tflw`. */
const project = () => new Map<string, string>([
  ['shared/login.tflw', shared],
  ['tests/checkout.tflw', importer('../shared/login.tflw')],
  ['tests/basket.tflw', importer('../shared/login.tflw')],
  ['tests/lonely.tflw', 'test "alone"\n  api GET /x\n  expect status equals 200\n'],
]);

test('`M218` `C1`: the reverse index finds every importer and nothing else', () => {
  const files = project();
  assert.deepEqual(importersOf(files, 'shared/login.tflw'), ['tests/basket.tflw', 'tests/checkout.tflw']);
  assert.deepEqual(importersOf(files, 'tests/lonely.tflw'), []);
  // A file does not import itself, however its own path is spelled.
  assert.deepEqual(importersOf(files, 'tests/checkout.tflw'), []);
});

test('`M218` `C1`: a specifier that escapes the project resolves to null, and is not an importer', () => {
  assert.equal(resolveSpecifier('tests/a.tflw', './b.tflw'), 'tests/b.tflw');
  assert.equal(resolveSpecifier('tests/a.tflw', '../shared/b.tflw'), 'shared/b.tflw');
  assert.equal(resolveSpecifier('tests/a.tflw', '../../outside.tflw'), null);
});

test('`M218` `E2`: a rename rewrites every importer, and every importer still resolves', () => {
  const files = project();
  const plan = planMove(files, 'shared/login.tflw', 'shared/signin.tflw');
  assert.deepEqual(plan.refusals, []);
  assert.deepEqual(plan.removes, ['shared/login.tflw']);
  assert.deepEqual(plan.edits.map((e) => e.path), ['shared/signin.tflw', 'tests/basket.tflw', 'tests/checkout.tflw']);

  // The property, not the string: apply the plan and ask the index again.
  const after = new Map(files);
  for (const r of plan.removes) after.delete(r);
  for (const e of plan.edits) after.set(e.path, e.text);
  assert.deepEqual(importersOf(after, 'shared/signin.tflw'), ['tests/basket.tflw', 'tests/checkout.tflw']);
  assert.deepEqual(importersOf(after, 'shared/login.tflw'), []);
});

test('`M218` `E3`: a moved file’s OWN relative imports are re-pointed for its new directory', () => {
  // `tests/checkout.tflw` imports `../shared/login.tflw`. Moved to the root, that same file is
  // `./shared/login.tflw` — the half of the rewrite that fires on 4 of the sibling’s 275 files.
  const files = project();
  const plan = planMove(files, 'tests/checkout.tflw', 'checkout.tflw');
  assert.deepEqual(plan.refusals, []);
  const moved = plan.edits.find((e) => e.path === 'checkout.tflw');
  assert.ok(moved, 'the moved file is in the edit set');
  assert.match(moved.text, /import "\.\/shared\/login\.tflw"/);

  const after = new Map(files);
  after.delete('tests/checkout.tflw');
  for (const e of plan.edits) after.set(e.path, e.text);
  assert.deepEqual(importersOf(after, 'shared/login.tflw'), ['checkout.tflw', 'tests/basket.tflw']);
});

test('`M218` `E1`: one unwritable member and the whole plan writes nothing (`D1151`)', () => {
  const files = project();
  // A file that does not parse cannot be rewritten, and it is an importer — so the plan must abort
  // rather than move the subject and leave this one naming a file that is gone.
  files.set('tests/broken.tflw', 'import "../shared/login.tflw"\n\ntest "unterminated\n');
  const plan = planMove(files, 'shared/login.tflw', 'shared/signin.tflw');
  assert.ok(plan.refusals.length > 0, 'it refuses');
  assert.deepEqual(plan.edits, [], 'and offers no write at all');
  assert.deepEqual(plan.removes, [], 'and no unlink');
});

test('`M218` `E`: a move refuses a target that exists, a non-`.tflw`, and a no-op', () => {
  const files = project();
  const onto = planMove(files, 'tests/lonely.tflw', 'tests/basket.tflw');
  assert.ok(onto.refusals.some((r) => r.includes('already exists')), onto.refusals.join(' | '));
  const ext = planMove(files, 'tests/lonely.tflw', 'tests/lonely.txt');
  assert.ok(ext.refusals.some((r) => r.includes('`.tflw`')), ext.refusals.join(' | '));
  const same = planMove(files, 'tests/lonely.tflw', 'tests/lonely.tflw');
  assert.ok(same.refusals.length > 0);
  const out = planMove(files, 'tests/lonely.tflw', '../escape.tflw');
  assert.ok(out.refusals.length > 0, 'a path leaving the project is refused');
});

test('`M218` `D1`: delete refuses an imported file and names the importers (`D1153`)', () => {
  const files = project();
  const plan = planDelete(files, 'shared/login.tflw');
  assert.deepEqual(plan.removes, [], 'nothing to unlink');
  assert.equal(plan.importers.length, 2);
  assert.ok(plan.refusals.some((r) => r.includes('tests/checkout.tflw') && r.includes('tests/basket.tflw')), plan.refusals.join(' | '));
});

test('`M218` `D1`: delete of a file nobody imports is allowed, and names one unlink', () => {
  const plan = planDelete(project(), 'tests/lonely.tflw');
  assert.deepEqual(plan.refusals, []);
  assert.deepEqual(plan.removes, ['tests/lonely.tflw']);
  assert.deepEqual(plan.edits, [], 'a delete never writes');
});

test('`M218` `C1`: a `use` of a `.ts` helper counts as an importer, so the refusal can see it', () => {
  const files = new Map<string, string>([
    ['tests/a.tflw', 'use "./sign.ts"\n\ntest "t"\n  api GET /x\n  expect status equals 200\n'],
    ['tests/sign.ts', 'export const x = 1;\n'],
  ]);
  assert.deepEqual(importersOf(files, 'tests/sign.ts'), ['tests/a.tflw']);
});

test('`M218` `E1`: a file that does not parse cannot be renamed — the validation pass is what says so', () => {
  // **This case exists because a mutation survived.** `D1151`'s validate-everything-first pass was
  // removed from `planMove` and all nine gates above stayed green: every one of them reaches its
  // refusal through a *rewrite* that fails, never through the validation that follows it. So the
  // round's safety property was asserted by nothing, which is `M168`'s rule — a check that passes
  // because it was handed nothing is not a check.
  //
  // The subject here is the file being moved and it does not parse, so `fileRefs` finds no
  // declarations, no rewrite is attempted, and the edit set is built from the source verbatim.
  // `validate` is the only thing between that and a `422` discovered mid-apply with the old file
  // already unlinked.
  //
  // And refusing is the right answer rather than a conservative one: a file that does not parse has
  // no readable `import` list, so there is no way to know what moving it breaks.
  const files = new Map<string, string>([
    ['tests/broken.tflw', 'test "unterminated\n  api GET /x\n'],
    ['tests/fine.tflw', 'test "fine"\n  api GET /x\n  expect status equals 200\n'],
  ]);
  const plan = planMove(files, 'tests/broken.tflw', 'tests/renamed.tflw');
  assert.ok(plan.refusals.some((r) => r.includes('would not parse')), plan.refusals.join(' | '));
  assert.deepEqual(plan.edits, [], 'nothing to write');
  assert.deepEqual(plan.removes, [], 'and nothing to unlink');
});

test('`M218` `E1`: a file `format` would still change is refused rather than written', () => {
  // The second thing only `validate` sees. `writeProjectFile` refuses text `format` would rewrite
  // (`D1049`), so an edit set carrying unformatted bytes is a `422` waiting to happen — and for a
  // **pure rename** the moved file's text is the source verbatim, never passed through a splice
  // that would have normalised it. The plan says so before anything moves.
  const files = new Map<string, string>([
    // Valid tflw, and not what `format` writes: four-space indentation, which lexes fine and is
    // re-emitted at two. (A blank line inside the body was the first guess and `format` keeps it —
    // measured rather than assumed, because a fixture that is accidentally already formatted makes
    // this gate vacuous in the one direction it is about.)
    ['tests/loose.tflw', 'test "loose"\n    api GET /x\n    expect status equals 200\n'],
  ]);
  const plan = planMove(files, 'tests/loose.tflw', 'tests/tight.tflw');
  assert.ok(plan.refusals.some((r) => r.includes('formatted')), plan.refusals.join(' | '));
  assert.deepEqual(plan.removes, []);
});
