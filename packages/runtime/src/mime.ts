// Shared file-extension → MIME-type inference (decision 22/M19). Originally lived in
// interpreter.ts for `upload`'s Content-Type inference; extracted here (M3b) so `browser.ts`'s
// `drop file … onto …` can reuse the same small curated table without a circular import between
// the two modules.

import { extname } from 'node:path';

/** A small curated extension→MIME table, not an exhaustive MIME database (keeps the zero-new-
 * runtime-dependency policy, decision 13, intact). An extension not listed here falls back to
 * `application/octet-stream` — never a hard error. An explicit `upload … type "…"` clause (or
 * `drop file`'s own inference) always wins over this table when the caller overrides it. */
const EXTENSION_MIME_TABLE: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
};

export function inferContentType(filePath: string): string {
  return EXTENSION_MIME_TABLE[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}
