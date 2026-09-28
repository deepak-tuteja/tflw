// `M247` `D` (`D1356`) — `element <name> = <locator>`: declared once, used by bare name wherever a
// locator goes, importable like an action, inlined before a run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, print, Codes, detectElementReuse, elementRefs, elementsOf, inlineElements, proposeElementName, type Locator, type Program } from '../src/index.js';
import { checkProgram } from '../src/checker.js';

const FILE = [
  'element cartBadge = css "[data-test=cart-count]"',
  'element checkout = button "Checkout"',
  '',
  'test "the badge counts what was added"',
  '  open "/"',
  '  click checkout',
  '  expect cartBadge has count 1',
  '  within list "Items"',
  '    expect cartBadge is visible',
  '',
].join('\n');

function parsed(src: string): Program {
  const { program, diagnostics } = parseSource(src);
  assert.deepEqual(diagnostics, [], JSON.stringify(diagnostics));
  return program;
}

test('an `element` declaration parses to its name and locator, and is absent from a file that writes none', () => {
  const program = parsed(FILE);
  assert.deepEqual(program.elements?.map((e) => [e.name, e.locator.kind, e.locator.value.value]), [
    ['cartBadge', 'css', '[data-test=cart-count]'],
    ['checkout', 'button', 'Checkout'],
  ]);
  assert.equal(program.elements?.[0]?.nameSpan.start.column, 'element '.length + 1);
  assert.ok(!('elements' in parsed('test "t"\n  api GET /a\n')), 'every earlier tree keeps its shape');
});

test('a bare name is an element reference in an action, a subject, and anything `within` a scope', () => {
  const refs = elementRefs(parsed(FILE));
  assert.deepEqual(refs.map((r) => r.value.value).sort(), ['cartBadge', 'cartBadge', 'checkout']);
  for (const r of refs) assert.equal(r.kind, 'element');
});

test('a misspelt keyword with its selector keeps its did-you-mean, and so does a misspelt subject', () => {
  // `buton "Save"`: a string follows, so it is a keyword typo, not an element.
  const click = parseSource('test "t"\n  click buton "Save"\n').diagnostics;
  assert.match(click[0]?.hint ?? '', /did you mean `button`\?/);
  // `statuss` is one letter from `status`. The parser cannot know whether an element has that name,
  // so it reads a name and the checker reports the typo — same code, same did-you-mean.
  const program = parsed('test "t"\n  api GET /a\n  expect statuss equals 200\n');
  const subject = checkProgram(program);
  // One mistake, one diagnostic: no `TF042` about `equals` on a locator nobody declared.
  assert.deepEqual(subject.map((d) => d.code), [Codes.UNKNOWN_SUBJECT]);
  assert.equal(subject[0]?.message, 'unknown subject `statuss`');
  assert.match(subject[0]?.hint ?? '', /did you mean `status`\?/);
});

test('an element one letter from a subject word is usable once declared — `badge` is not a misspelt `page`', () => {
  const declared = checkProgram(parsed('element badge = css ".badge"\n\ntest "t"\n  open "/"\n  expect badge is visible\n'));
  assert.deepEqual(declared, []);
  // Control: undeclared, the same line is the typo it looks like.
  const undeclared = checkProgram(parsed('test "t"\n  open "/"\n  expect badge is visible\n'));
  assert.equal(undeclared[0]?.code, Codes.UNKNOWN_SUBJECT);
  assert.match(undeclared[0]?.hint ?? '', /did you mean `page`\?/);
  // A near *element* name beats a near subject word, and outside a subject there is no subject word
  // to be near: `click badg` is an unknown element.
  const near = checkProgram(parsed('element badges = css ".b"\n\ntest "t"\n  open "/"\n  expect badge is visible\n  click badg\n'));
  assert.deepEqual(near.map((d) => [d.code, d.hint]), [[Codes.UNKNOWN_ELEMENT, 'did you mean `badges`?'], [Codes.UNKNOWN_ELEMENT, 'did you mean `badges`?']]);
});

test('the right-hand side is a locator: an element naming an element, or a keyword as a name, is refused', () => {
  assert.match(parseSource('element a = css ".a"\nelement b = a\n').diagnostics[0]!.message, /is a name/);
  assert.match(parseSource('element button = css ".a"\n').diagnostics[0]!.message, /locator keyword/);
  assert.ok(parseSource('element a css ".a"\n').diagnostics.length > 0, 'the `=` is required');
});

test('the printer writes the declaration and each reference back as written, and a round trip is exact', () => {
  const printed = print(parsed(FILE));
  assert.ok(printed.ok, printed.reason);
  assert.equal(printed.text + '\n', FILE);
  const again = print(parsed(printed.text + '\n'));
  assert.equal(again.text, printed.text);
});

test('element declarations print as their own block, a blank line below the imports', () => {
  const printed = print(parsed('import "./shared.tflw"\nelement a = css ".a"\nelement b = css ".b"\n\ntest "t"\n  click a\n'));
  assert.ok(printed.ok);
  assert.equal(printed.text, 'import "./shared.tflw"\n\nelement a = css ".a"\nelement b = css ".b"\n\ntest "t"\n  click a');
});

test('`TF089`: an unknown name, with a did-you-mean against every known one, and the `{name}` reading offered', () => {
  const src = 'element cartBadge = css ".b"\n\ntest "t"\n  open "/"\n  click cartBadg\n  expect total is visible\n';
  const diags = checkProgram(parsed(src)).filter((d) => d.code === Codes.UNKNOWN_ELEMENT);
  assert.deepEqual(diags.map((d) => d.message), ['unknown element `cartBadg`', 'unknown element `total`']);
  assert.equal(diags[0]!.hint, 'did you mean `cartBadge`?');
  assert.match(diags[1]!.hint ?? '', /write `\{total\}`/);
  assert.equal(diags[0]!.span.start.line, 5);
});

test('`TF089` is decided only in a closed world: with an unread import it says nothing, and an imported name is known', () => {
  const src = 'import "./shared.tflw"\n\ntest "t"\n  click cartBadge\n';
  assert.deepEqual(checkProgram(parsed(src)).filter((d) => d.code === Codes.UNKNOWN_ELEMENT), [], 'imports not read — no verdict');
  const known = checkProgram(parsed(src), { importedElements: [{ name: 'cartBadge', from: './shared.tflw' }] });
  assert.deepEqual(known.filter((d) => d.code === Codes.UNKNOWN_ELEMENT), []);
  const unknown = checkProgram(parsed(src), { importedElements: [] });
  assert.equal(unknown.filter((d) => d.code === Codes.UNKNOWN_ELEMENT).length, 1, 'read and absent is unknown');
});

test('`TF035` covers element names: twice in a file, and once here and once through an import', () => {
  const twice = checkProgram(parsed('element a = css ".a"\nelement a = css ".b"\n')).filter((d) => d.code === Codes.DUPLICATE_ACTION);
  assert.deepEqual(twice.map((d) => d.message), ['duplicate element "a"']);
  assert.equal(twice[0]!.span.start.line, 2, 'reported at the second declaration');
  const imported = checkProgram(parsed('import "./shared.tflw"\nelement a = css ".a"\n'), { importedElements: [{ name: 'a', from: './shared.tflw' }] });
  assert.deepEqual(imported.filter((d) => d.code === Codes.DUPLICATE_ACTION).map((d) => d.message), ['duplicate element "a" (imported from "./shared.tflw")']);
});

test('`inlineElements` replaces every reference with its locator, keeping the reference\'s span; an unknown name is left alone', () => {
  const program = parsed(FILE + 'test "u"\n  click nowhere\n');
  const inlined = inlineElements(program, elementsOf(program));
  assert.deepEqual(elementRefs(inlined).map((r) => r.value.value), ['nowhere'], 'only the undeclared name is still a reference');
  const click = inlined.tests[0]!.body[1] as unknown as { locator: Locator };
  assert.equal(click.locator.kind, 'button');
  assert.equal(click.locator.value.value, 'Checkout');
  assert.equal(click.locator.span.start.line, 6, 'the span is the line that used the name');
  // Nothing to inline returns the same object — the fast path the runtime takes on every file
  // that never wrote an element.
  const plain = parsed('test "t"\n  api GET /a\n');
  assert.equal(inlineElements(plain, new Map()), plain);
});

// --- the reuse pass's locator half (`M247` `D`) ---

function entry(path: string, source: string) {
  return { path, source, program: parsed(source) };
}

test('a selector written in two files is one hint: every site, one declaration, the name from its words', () => {
  const a = entry('tests/a.tflw', 'test "a"\n  open "/"\n  click css "[data-test=cart-count]"\n  expect css "[data-test=cart-count]" has count 1\n');
  const b = entry('tests/b.tflw', 'test "b"\n  open "/"\n  expect css "[data-test=cart-count]" is visible\n');
  const hints = detectElementReuse([a, b], 4);
  assert.equal(hints.length, 1);
  const h = hints[0]!;
  assert.equal(h.id, 'RF004', 'numbered on from where the action pass stopped');
  assert.equal(h.elementName, 'cartCount');
  assert.equal(h.declaration, 'element cartCount = css "[data-test=cart-count]"');
  assert.deepEqual(h.occurrences.map((o) => `${o.path}:${o.line}`), ['tests/a.tflw:3', 'tests/a.tflw:4', 'tests/b.tflw:3']);
  const o = h.occurrences[0]!;
  assert.equal(a.source.slice(o.span.start.offset, o.span.end.offset), 'css "[data-test=cart-count]"', 'the span is the whole locator, keyword to quote');
});

test('not offered: one file only, a keyword locator, an interpolated selector, or a selector an element already names', () => {
  const one = entry('a.tflw', 'test "a"\n  click css ".x"\n  click css ".x"\n');
  assert.deepEqual(detectElementReuse([one, entry('b.tflw', 'test "b"\n  api GET /a\n')]), [], 'repetition inside one file is that file\'s business');
  assert.deepEqual(detectElementReuse([entry('a.tflw', 'test "a"\n  click button "Go"\n'), entry('b.tflw', 'test "b"\n  click button "Go"\n')]), []);
  assert.deepEqual(detectElementReuse([entry('a.tflw', 'test "a"\n  let n = 1\n  click css ".row-{n}"\n'), entry('b.tflw', 'test "b"\n  let n = 1\n  click css ".row-{n}"\n')]), []);
  const declared = entry('shared/elements.tflw', 'element go = css ".x"\n');
  assert.deepEqual(detectElementReuse([declared, entry('a.tflw', 'test "a"\n  click css ".x"\n'), entry('b.tflw', 'test "b"\n  click css ".x"\n')]), []);
});

test('a proposed name never collides with a declared one, and a selector with no words is still named', () => {
  const declared = entry('shared/elements.tflw', 'element cartCount = css ".other"\n');
  const hints = detectElementReuse([declared, entry('a.tflw', 'test "a"\n  click css "#cart-count"\n'), entry('b.tflw', 'test "b"\n  click css "#cart-count"\n')]);
  assert.equal(hints[0]!.elementName, 'cartCount2');
  assert.equal(proposeElementName('> *'), 'element');
  assert.equal(proposeElementName('.checkout-btn'), 'checkoutBtn');
  assert.equal(proposeElementName("//nav//a[@href='/cart']"), 'navCart');
});

test('every proposed declaration parses, and the name reads back as an element reference at a site', () => {
  const a = entry('a.tflw', 'test "a"\n  click xpath "//nav//a[@href=\'/cart\']"\n');
  const b = entry('b.tflw', 'test "b"\n  click xpath "//nav//a[@href=\'/cart\']"\n');
  const h = detectElementReuse([a, b])[0]!;
  const decl = parseSource(h.declaration + '\n');
  assert.deepEqual(decl.diagnostics, []);
  assert.equal(decl.program.elements?.[0]?.locator.value.value, "//nav//a[@href='/cart']");
  const o = h.occurrences[0]!;
  const rewritten = a.source.slice(0, o.span.start.offset) + h.elementName + a.source.slice(o.span.end.offset);
  assert.equal(elementRefs(parsed(rewritten))[0]?.value.value, h.elementName);
});
