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

// A stream's extent comes from its dict's `/Length`, never from a scan of its bytes (D173,
// `PLAN_M100_PDF_STREAM_LENGTH.md`). Stream data is *binary*, and locating its end by text has two
// failure modes:
//
//  1. The EOL a writer puts before `endstream` is indistinguishable from data. This code used to
//     slice to `endstream` and strip one trailing EOL; when the compressed data's own last byte is
//     CR (0x0D) that strip eats the CR *and* the writer's LF, losing a real byte, and `inflateSync`
//     throws `unexpected end of file`. **0.36% of receipt-shaped payloads end in CR** — measured,
//     not estimated — which is how an order receipt failed testFlow-tests' CI and passed on the
//     re-run. Not a flake: the draw changed, not the code.
//  2. `endstream`/`endobj` occurring inside the compressed bytes. ~1e-11 per receipt, so it was
//     never the cause here, but a scan has no way to tell it from the real terminator.
//
// `/Length` states the byte count, so neither has to be inferred. Scanning survives only as a
// fallback for a dict with no usable `/Length` — where failure mode 1 is genuinely undecidable.
function parseObjects(raw: string): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();
  const headerRe = /(\d+)\s+0\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(raw)) !== null) {
    const objNum = Number(m[1]!);
    const bodyStart = m.index + m[0].length;
    const endobjIdx = raw.indexOf('endobj', bodyStart);
    const streamKw = /stream\r?\n/.exec(raw.slice(bodyStart, endobjIdx === -1 ? undefined : endobjIdx));
    if (!streamKw) {
      objects.set(objNum, { dict: raw.slice(bodyStart, endobjIdx === -1 ? undefined : endobjIdx), stream: null });
      continue;
    }
    const dict = raw.slice(bodyStart, bodyStart + streamKw.index);
    const dataStart = bodyStart + streamKw.index + streamKw[0].length;
    const declared = streamLength(raw, dict);
    let dataEnd: number;
    if (declared !== null && raw.startsWith('endstream', skipEol(raw, dataStart + declared))) {
      dataEnd = dataStart + declared;
    } else {
      const scanned = raw.indexOf('endstream', dataStart);
      dataEnd = scanned === -1 ? raw.length : trimTrailingEol(raw, scanned);
    }
    objects.set(objNum, { dict, stream: Buffer.from(raw.slice(dataStart, dataEnd), 'latin1') });
    // Resume *after* the stream: `N 0 obj` occurs inside binary data too, and a header matched
    // there invents an object that shadows the real one in the map.
    headerRe.lastIndex = dataEnd;
  }
  return objects;
}

/** `/Length` as a byte count, resolving the indirect `/Length N 0 R` spelling (the one a writer
 * emits when it streams the object out before knowing its own size). `null` when absent or
 * unresolvable, which sends the caller to the scan fallback. */
function streamLength(raw: string, dict: string): number | null {
  const indirect = dict.match(/\/Length\s+(\d+)\s+0\s+R/);
  if (indirect) {
    const target = raw.match(new RegExp(`(?:^|[^0-9])${indirect[1]!}\\s+0\\s+obj\\s*(\\d+)\\s*endobj`));
    return target ? Number(target[1]!) : null;
  }
  const direct = dict.match(/\/Length\s+(\d+)/);
  return direct ? Number(direct[1]!) : null;
}

/** Index of the first non-EOL character at or after `i` — the spec allows an EOL between the
 * stream data and the `endstream` keyword, and writers differ on emitting it. */
function skipEol(raw: string, i: number): number {
  let j = i;
  while (j < raw.length && (raw[j] === '\r' || raw[j] === '\n')) j++;
  return j;
}

/** `end`, minus one trailing EOL. The scan fallback's equivalent of `skipEol`, and it carries the
 * CR ambiguity described above: with no `/Length` there is no way to tell a writer's EOL from data
 * that ends in one. Kept because guessing right ~99.6% of the time beats refusing the PDF. */
function trimTrailingEol(raw: string, end: number): number {
  if (raw[end - 1] === '\n') return raw[end - 2] === '\r' ? end - 2 : end - 1;
  return end;
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
