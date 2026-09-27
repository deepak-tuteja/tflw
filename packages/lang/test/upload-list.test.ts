// `M245` — an `upload` names a list of files, one line, comma-separated.
//
// Before it, `UploadBody` held exactly one `filePath`/`fieldName`/`contentType`, so a request with
// two attachments, or an avatar and a cover, could not be written at all. Each negative control
// below names what the one-file grammar did with the same input.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, print, format, checkUnknownVariables, checkReferencedFiles, collectFileReferences, Codes } from '../src/index.js';
import type { ApiStep, UploadBody } from '../src/index.js';

function uploadOf(line: string): { body: UploadBody | null; errors: string[] } {
  const { program, diagnostics } = parseSource(`test "t"\n  ${line}\n`);
  const errors = diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
  const step = program.tests[0]?.body[0] as ApiStep | undefined;
  const body = step?.body?.type === 'UploadBody' ? step.body : null;
  return { body, errors };
}

const THREE = 'api POST /tickets/7/attachments upload "./a.png" as "files", "./b.pdf" as "files" type "application/pdf", "./c.txt" as "note" form title="Bug 42", urgent=true';

// ---- parser ------------------------------------------------------------------------------------

test('one file parses to a one-entry list, with the same three fields it always had', () => {
  const { body, errors } = uploadOf('api POST /me upload "./avatar.png" as "avatar" type "image/png"');
  assert.deepEqual(errors, []);
  assert.ok(body);
  assert.equal(body.files.length, 1);
  assert.deepEqual(
    body.files.map((f) => [f.type, f.filePath.value, f.fieldName.value, f.contentType?.value ?? null]),
    [['UploadFile', './avatar.png', 'avatar', 'image/png']],
  );
  assert.deepEqual(body.extra, []);
});

test('three files keep their written order, each with its own `type`, and a repeated field is legal', () => {
  // Before: `, "./b.pdf"` after the first file was an unexpected token and the step did not parse.
  const { body, errors } = uploadOf(THREE);
  assert.deepEqual(errors, []);
  assert.ok(body);
  assert.deepEqual(
    body.files.map((f) => [f.filePath.value, f.fieldName.value, f.contentType?.value ?? null]),
    [
      ['./a.png', 'files', null],
      ['./b.pdf', 'files', 'application/pdf'],
      ['./c.txt', 'note', null],
    ],
  );
  assert.deepEqual(body.extra.map((f) => f.key), ['title', 'urgent']);
});

test("each file's span is its own entry, not the whole body", () => {
  const { body } = uploadOf(THREE);
  assert.ok(body);
  const [a, b, c] = body.files;
  assert.ok(a && b && c);
  assert.ok(a.span.end.offset <= b.span.start.offset && b.span.end.offset <= c.span.start.offset, 'entries do not overlap and run left to right');
  assert.ok(c.span.end.offset < body.span.end.offset, 'the form fields lie after the last file');
});

test('a missing `as` in the second entry is refused, and the refusal is on that entry', () => {
  const { errors } = uploadOf('api POST /me upload "./a.png" as "one", "./b.png" "two"');
  assert.equal(errors.length > 0, true);
  assert.match(errors[0]!, /`as`/);
});

test('a trailing comma is refused — the list is one line and there is no continuation (D637)', () => {
  const { errors } = uploadOf('api POST /me upload "./a.png" as "one",');
  assert.equal(errors.length > 0, true);
  assert.match(errors[0]!, /file 2 of the `upload` list/);
  assert.match(errors[0]!, /trailing comma/);
});

test('an `upload` with no file at all is refused', () => {
  const { errors } = uploadOf('api POST /me upload form a=1');
  assert.equal(errors.length > 0, true);
  assert.match(errors[0]!, /a file path string/);
});

test('a second file after `form` is not a file — `form` ends the list', () => {
  // `form a=1, "./b.png" as "f"` would need a form key; the comma belongs to the form's own list.
  const { errors } = uploadOf('api POST /me upload "./a.png" as "one" form a=1, "./b.png" as "two"');
  assert.equal(errors.length > 0, true);
});

// ---- printer and fmt ---------------------------------------------------------------------------

test('the printer writes the list back as written, `type` per file and `form` last', () => {
  const { body } = uploadOf(THREE);
  assert.ok(body);
  const out = print(body);
  assert.equal(out.ok, true, out.reason);
  assert.equal(out.text, THREE.slice(THREE.indexOf('upload ')));
});

test('a one-file upload prints byte-identical to the one-file grammar', () => {
  for (const line of [
    'api POST /me upload "./avatar.png" as "avatar"',
    'api POST /me upload "./avatar.png" as "avatar" type "image/png"',
    'api POST /me upload "./avatar.png" as "avatar" type "image/png" form owner="bob"',
  ]) {
    const { body } = uploadOf(line);
    assert.ok(body, line);
    assert.equal(print(body).text, line.slice(line.indexOf('upload ')));
  }
});

test('every parser case round-trips through the printer to the same AST shape', () => {
  for (const line of [THREE, 'api POST /me upload "./a.png" as "avatar", "./b.jpg" as "cover"']) {
    const first = uploadOf(line).body;
    assert.ok(first);
    const again = uploadOf(`api POST /x ${print(first).text}`).body;
    assert.ok(again);
    const shape = (b: UploadBody) => [b.files.map((f) => [f.filePath.value, f.fieldName.value, f.contentType?.value ?? null]), b.extra.map((f) => f.key)];
    assert.deepEqual(shape(again), shape(first));
  }
});

test('`fmt` leaves a well-formed multi-file upload alone', () => {
  const src = `test "t"\n  ${THREE}\n`;
  const out = format(src);
  assert.equal(out.ok, true, out.reason);
  assert.equal(out.formatted, src);
});

// ---- checker -----------------------------------------------------------------------------------

test('TF043: the second of two literal paths is reported alone, at its own line position', () => {
  const src = 'test "t"\n  api POST /me upload "./here.png" as "a", "./gone.png" as "b"\n';
  const { program } = parseSource(src);
  // Before: the table read `UploadBody.filePath`, so only the first path was ever seen.
  assert.deepEqual(collectFileReferences(program).map((r) => r.path.value), ['./here.png', './gone.png']);
  const diags = checkReferencedFiles(program, { missingFiles: new Set(['./gone.png']) });
  assert.deepEqual(diags.map((d) => d.code), [Codes.MISSING_FILE]);
  assert.match(diags[0]!.message, /"\.\/gone\.png"/);
  assert.equal(diags[0]!.span.start.column, src.split('\n')[1]!.indexOf('"./gone.png"') + 1);
});

test('TF032: one malformed `type` among good ones is reported once, on that file', () => {
  const src = 'test "t"\n  api POST /me upload "./a.png" as "a" type "image/png", "./b.pdf" as "b" type "pdf", "./c.txt" as "c" type "text/plain"\n';
  const { program } = parseSource(src);
  const diags = checkUnknownVariables(program);
  assert.deepEqual(diags.map((d) => d.code), ['TF032']);
  assert.match(diags[0]!.message, /invalid content type "pdf"/);
  assert.equal(diags[0]!.span.start.column, src.split('\n')[1]!.indexOf('"pdf"') + 1);
});

test('an unknown variable in the third file\'s path is reported', () => {
  const { program } = parseSource('test "t"\n  api POST /me upload "./a.png" as "a", "./b.png" as "b", "./{missing}.png" as "c"\n');
  const diags = checkUnknownVariables(program);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.message, /unknown variable "missing"/);
});
