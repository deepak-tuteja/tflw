// `M245` — several files in one multipart request, against a real loopback server.
//
// Before it, an `upload` body held one file, so none of these requests could be written; the
// negative control for each assertion is that one-file shape (one file part, then the fields).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';
import { asEntry } from './__helpers__/entry.js';

interface Part {
  readonly name: string;
  readonly filename: string | null;
  readonly contentType: string | null;
  readonly body: string;
}

/** The parts of a multipart body in wire order — enough of RFC 7578 for a text-only fixture. */
function parts(contentTypeHeader: string, body: string): Part[] {
  const boundary = /boundary=(.+)$/.exec(contentTypeHeader)?.[1];
  assert.ok(boundary, `no boundary in ${contentTypeHeader}`);
  return body
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((raw) => {
      const [head = '', ...rest] = raw.replace(/^\r\n/, '').split('\r\n\r\n');
      return {
        name: /name="([^"]*)"/.exec(head)?.[1] ?? '',
        filename: /filename="([^"]*)"/.exec(head)?.[1] ?? null,
        contentType: /content-type: ([^\r\n]+)/i.exec(head)?.[1] ?? null,
        body: rest.join('\r\n\r\n').replace(/\r\n$/, ''),
      };
    });
}

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-upload-list-'));
  await writeFile(join(dir, 'a.png'), 'png-bytes-A');
  await writeFile(join(dir, 'b.pdf'), 'pdf-bytes-B');
  await writeFile(join(dir, 'c.txt'), 'text-bytes-C');
  return dir;
}

test('every file reaches the server as its own part, in written order, then the form fields', async () => {
  const dir = await project();
  const server = await startFixtureServer({ '/attachments': (_req, res) => json(res, 201, { ok: true }) });
  const source = `test "three files"
  api POST /attachments upload "./a.png" as "files", "./b.pdf" as "files" type "application/x-custom", "./c.txt" as "note" form title="Bug 42", urgent=true
  expect status equals 201
`;
  try {
    const { program } = parseSource(source);
    const { report } = await runProgram(program, testConfig(server.baseUrl), { source, baseDir: dir });
    assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

    const got = server.received.get('/attachments')![0]!;
    const seen = parts(String(got.headers['content-type']), got.body);
    assert.deepEqual(
      seen.map((p) => [p.name, p.filename, p.contentType, p.body]),
      [
        ['files', 'a.png', 'image/png', 'png-bytes-A'],
        // The written `type` wins over the extension's `application/pdf`.
        ['files', 'b.pdf', 'application/x-custom', 'pdf-bytes-B'],
        ['note', 'c.txt', 'text/plain', 'text-bytes-C'],
        ['title', null, null, 'Bug 42'],
        ['urgent', null, null, 'true'],
      ],
    );

    const step = asEntry(report.tests[0], 'functional').steps.find((s) => s.kind === 'api')!;
    assert.equal(
      step.request!.body,
      '[multipart form: files=a.png (image/png), files=b.pdf (application/x-custom), note=c.txt (text/plain), title=Bug 42, urgent=true]',
    );
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a repeated field name arrives as two parts, never one merged value', async () => {
  const dir = await project();
  const server = await startFixtureServer({ '/bulk': (_req, res) => json(res, 201, { ok: true }) });
  const source = `test "bulk"\n  api POST /bulk upload "./a.png" as "files[]", "./c.txt" as "files[]"\n  expect status equals 201\n`;
  try {
    const { program } = parseSource(source);
    const { report } = await runProgram(program, testConfig(server.baseUrl), { source, baseDir: dir });
    assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
    const got = server.received.get('/bulk')![0]!;
    const seen = parts(String(got.headers['content-type']), got.body);
    assert.deepEqual(seen.map((p) => [p.name, p.filename]), [['files[]', 'a.png'], ['files[]', 'c.txt']]);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a missing second file fails the step and names that file, and nothing is sent', async () => {
  const dir = await project();
  const server = await startFixtureServer({ '/attachments': (_req, res) => json(res, 201, { ok: true }) });
  const source = `test "missing"\n  api POST /attachments upload "./a.png" as "one", "./gone.png" as "two"\n`;
  try {
    const { program } = parseSource(source);
    const { report } = await runProgram(program, testConfig(server.baseUrl), { source, baseDir: dir });
    assert.equal(report.ok, false);
    const entry = asEntry(report.tests[0], 'functional');
    assert.match(String(entry.error), /could not read `upload` file "\.\/gone\.png" \(file 2 of 2\)/);
    assert.equal(server.received.get('/attachments'), undefined);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
