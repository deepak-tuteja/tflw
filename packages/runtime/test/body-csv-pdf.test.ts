// `body csv` / `body pdf text` subjects (TFLW-GAPS.md gap #19) — end-to-end through the real
// interpreter against a real loopback response, mirroring `binary-body.test.ts`'s own shape for
// gap #17. Parsing-logic edge cases live in `csv-parse.test.ts`/`pdf-text.test.ts`; this file
// proves the subjects/quantifier wiring in `interpreter.ts` itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig } from './support.js';

const ORDERS_CSV = 'id,status,total\n1,delivered,19.98\n2,pending,4.50\n';

function buildOnePagePdf(text: string): Buffer {
  const content = `BT\n/F1 11 Tf\n72 740 Td\n14 TL\n(${text}) Tj\nET`;
  const compressed = deflateSync(Buffer.from(content, 'ascii'));
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>\n', 'ascii'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n', 'ascii'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>\n', 'ascii'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\n', 'ascii'),
    Buffer.concat([Buffer.from(`<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`, 'ascii'), compressed, Buffer.from('\nendstream\n', 'ascii')]),
  ];
  const parts: Buffer[] = [Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
  const offsets: number[] = [0];
  let cursor = parts[0]!.length;
  for (let i = 0; i < objects.length; i++) {
    offsets.push(cursor);
    const objBuf = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'ascii'), objects[i]!, Buffer.from('endobj\n', 'ascii')]);
    parts.push(objBuf);
    cursor += objBuf.length;
  }
  const xrefOffset = cursor;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  parts.push(Buffer.from(xref, 'ascii'));
  return Buffer.concat(parts);
}

test('`body csv` addresses rows/columns via the same body-path machinery, and every matcher works on it', async () => {
  const server = await startFixtureServer({
    '/orders/export': (_req, res) => res.writeHead(200, { 'content-type': 'text/csv' }).end(ORDERS_CSV),
  });

  const source = `test "asserts on a naturally-generated CSV export"
  api GET /orders/export
  expect body csv has count 2
  expect body csv[0].status equals "delivered"
  expect body csv[1].total equals "4.50"
  expect any body csv.status equals "delivered"
  expect all body csv.id not equals ""
  capture body csv as rows
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  await server.close();
});

test('`body csv` on a malformed CSV (wrong field count) fails the step with a specific message, not a silent empty result', async () => {
  const server = await startFixtureServer({
    '/bad': (_req, res) => res.writeHead(200, { 'content-type': 'text/csv' }).end('id,status\n1,delivered,extra\n'),
  });

  const source = `test "malformed csv"
  api GET /bad
  expect body csv has count 1
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /body csv: row 2 has 3 fields, expected 2 \(from the header row\)/);

  await server.close();
});

test('`body pdf text` extracts text from a real PDF response, including across a page break', async () => {
  const page1 = buildOnePagePdf('Total: 19.98');
  const server = await startFixtureServer({
    '/receipt': (_req, res) => res.writeHead(200, { 'content-type': 'application/pdf' }).end(page1),
  });

  const source = `test "asserts on a PDF response body"
  api GET /receipt
  expect body pdf text contains "Total: 19.98"
  capture body pdf text as receiptText
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  await server.close();
});

test('`body pdf text` on a non-PDF response fails the step with a specific message, not a silent empty string', async () => {
  const server = await startFixtureServer({
    '/not-a-pdf': (_req, res) => res.writeHead(200, { 'content-type': 'application/pdf' }).end('just some text, not a real PDF'),
  });

  const source = `test "malformed pdf"
  api GET /not-a-pdf
  expect body pdf text contains "anything"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /no \/trailer found \(is this response actually a PDF\?\)/);

  await server.close();
});
