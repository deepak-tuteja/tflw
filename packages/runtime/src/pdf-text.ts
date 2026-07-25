// `body pdf text` (gap #19, TFLW-GAPS.md, PLAN_GAPS_19.md D19.6) — text extraction from a PDF
// response body. Walks the same trailer/xref/objects structure a simple, hand-built PDF (like
// `order-receipt.util.ts`'s own) writes: resolves `/Root` -> `/Catalog` -> `/Pages`, recurses
// through `/Kids` arrays to visit every page (not just the first), and for each page's
// `/Contents` stream, inflates it when `/Filter /FlateDecode` is present (else treats it as raw
// bytes). Text comes from the `Tj`/`TJ`/`T*` operators — the ones this app's own generator (and
// typical simple PDF writers) actually emit.
//
// Explicitly out of scope (D19.6, documented limitation, not a silent gap): embedded/custom font
// encodings (assumes standard/WinAnsi-equivalent text), the `'`/`"` text-showing shorthands,
// annotations/form fields/images. This targets PDFs shaped like the ones this app's fixtures
// actually produce, not an arbitrary real-world PDF.

import { inflateSync } from 'node:zlib';
import { RuntimeError } from './eval.js';

interface PdfObject {
  readonly dict: string;
  readonly stream: Buffer | null;
}

const NOT_A_PDF_HINT = '(is this response actually a PDF?)';

/** Extracts all text from `buffer`, a PDF response body. Pages join with a blank line (`\n\n`);
 * lines within a page join with `\n` — keeps the result a plain string with no special
 * page-break character a test author needs to know about or escape in `contains`/`matches
 * regex`. Throws `RuntimeError` (D19.7) on anything not shaped like a PDF this can walk. */
export function extractPdfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const objects = parseObjects(raw);
  const rootNum = findRootObjectNum(raw);
  const catalog = objects.get(rootNum);
  if (!catalog) {
    throw new RuntimeError(`body pdf text: no /Catalog object found ${NOT_A_PDF_HINT}`);
  }
  const pagesRef = catalog.dict.match(/\/Pages\s+(\d+)\s+0\s+R/);
  if (!pagesRef) {
    throw new RuntimeError(`body pdf text: catalog has no /Pages reference ${NOT_A_PDF_HINT}`);
  }
  const pageNums = collectPageObjectNums(objects, Number(pagesRef[1]!));
  if (pageNums.length === 0) {
    throw new RuntimeError(`body pdf text: no pages found ${NOT_A_PDF_HINT}`);
  }
  return pageNums.map((pageNum) => extractPageText(objects, pageNum)).join('\n\n');
}

function findRootObjectNum(raw: string): number {
  const trailerIdx = raw.lastIndexOf('trailer');
  if (trailerIdx === -1) {
    throw new RuntimeError(`body pdf text: no /trailer found ${NOT_A_PDF_HINT}`);
  }
  const m = raw.slice(trailerIdx).match(/\/Root\s+(\d+)\s+0\s+R/);
  if (!m) {
    throw new RuntimeError(`body pdf text: trailer has no /Root reference ${NOT_A_PDF_HINT}`);
  }
  return Number(m[1]!);
}

function parseObjects(raw: string): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();
  const objRe = /(\d+)\s+0\s+obj\s*([\s\S]*?)endobj/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(raw)) !== null) {
    const objNum = Number(m[1]!);
    const body = m[2]!;
    const streamKw = body.match(/stream\r?\n/);
    if (!streamKw) {
      objects.set(objNum, { dict: body, stream: null });
      continue;
    }
    const dataStart = streamKw.index! + streamKw[0].length;
    const dict = body.slice(0, streamKw.index);
    const endstreamIdx = body.indexOf('endstream', dataStart);
    const rawData = endstreamIdx === -1 ? body.slice(dataStart) : body.slice(dataStart, endstreamIdx);
    objects.set(objNum, { dict, stream: Buffer.from(rawData.replace(/\r?\n$/, ''), 'latin1') });
  }
  return objects;
}

/** Recurses through `/Kids` arrays (an intermediate `/Pages` node) down to leaf `/Page` objects,
 * in `Kids` order — `visited` guards against a malformed circular tree looping forever. */
function collectPageObjectNums(objects: Map<number, PdfObject>, objNum: number, visited = new Set<number>()): number[] {
  if (visited.has(objNum)) return [];
  visited.add(objNum);
  const obj = objects.get(objNum);
  if (!obj) {
    throw new RuntimeError(`body pdf text: object ${objNum} 0 R referenced but not found ${NOT_A_PDF_HINT}`);
  }
  const kids = obj.dict.match(/\/Kids\s*\[([^\]]*)\]/);
  if (kids) {
    const kidNums = [...kids[1]!.matchAll(/(\d+)\s+0\s+R/g)].map((mm) => Number(mm[1]!));
    return kidNums.flatMap((kidNum) => collectPageObjectNums(objects, kidNum, visited));
  }
  return [objNum];
}

function extractPageText(objects: Map<number, PdfObject>, pageNum: number): string {
  const page = objects.get(pageNum)!;
  const contentsRef = page.dict.match(/\/Contents\s+(\d+)\s+0\s+R/);
  const contentObj = contentsRef ? objects.get(Number(contentsRef[1]!)) : undefined;
  if (!contentsRef || !contentObj || !contentObj.stream) {
    throw new RuntimeError(`body pdf text: no /Contents stream found on page ${pageNum} 0 R ${NOT_A_PDF_HINT}`);
  }
  const isFlate = /\/Filter\s*\/FlateDecode\b/.test(contentObj.dict);
  let content: string;
  try {
    content = (isFlate ? inflateSync(contentObj.stream) : contentObj.stream).toString('latin1');
  } catch (err) {
    throw new RuntimeError(`body pdf text: could not decompress content stream on page ${pageNum} 0 R: ${(err as Error).message}`);
  }
  return extractTextOperators(content).join('\n');
}

/** Scans a decompressed content stream for `(str) Tj`, `[(str) n (str) n ...] TJ` (numeric
 * kerning operands discarded — they affect glyph spacing, not content), and `T*` (line break),
 * in stream order, so multi-line text reassembles in the right order. */
function extractTextOperators(content: string): string[] {
  const lines: string[] = [];
  let current = '';
  const tokenRe = /\(((?:\\.|[^\\)])*)\)\s*Tj|\[((?:[^\]])*)\]\s*TJ|T\*/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(content)) !== null) {
    if (m[0] === 'T*') {
      lines.push(current);
      current = '';
    } else if (m[1] !== undefined) {
      current += unescapePdfString(m[1]);
    } else if (m[2] !== undefined) {
      const strRe = /\(((?:\\.|[^\\)])*)\)/g;
      let sm: RegExpExecArray | null;
      while ((sm = strRe.exec(m[2])) !== null) current += unescapePdfString(sm[1]!);
    }
  }
  lines.push(current);
  return lines;
}

/** Reverses `order-receipt.util.ts`'s own `pdfEscape()`: any backslash-prefixed char yields just
 * that char (covers `\\` -> `\`, `\(` -> `(`, `\)` -> `)`). */
function unescapePdfString(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      out += s[i + 1];
      i++;
    } else {
      out += s[i];
    }
  }
  return out;
}
