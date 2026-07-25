// `body csv` (gap #19, TFLW-GAPS.md, PLAN_GAPS_19.md D19.3) — hand-rolled RFC 4180 CSV parsing.
// Mirrors `binary-match.ts`'s own dedicated-module precedent. Comma delimiter, double-quote
// escaping (embedded commas/newlines/escaped `""` inside a quoted field), `\r\n`/`\n` line
// endings. No configurable delimiter, no headerless mode (D19.11 — v1 scoped to what the dogfood
// app actually emits). Distinct from `dataTable.ts`'s own `parseCsvRows`: that one splits on
// newlines *before* quote-aware parsing (so a quoted embedded newline would desync it) and coerces
// numeric-looking cells to numbers for `with each` table binding — `body csv` instead returns
// every cell as a plain string (`Array<Record<string, string>>`), matching what a JSON-less
// response body actually contains, with no line-splitting step to desync.

import { RuntimeError } from './eval.js';

/** Parses `text` as RFC 4180 CSV with a required header row. Throws `RuntimeError` (not a silent
 * empty/partial result — D19.4) if a data row's field count doesn't match the header's. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows = tokenizeCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0]!;
  return rows.slice(1).map((row, i) => {
    if (row.length !== header.length) {
      throw new RuntimeError(
        `body csv: row ${i + 2} has ${row.length} field${row.length === 1 ? '' : 's'}, expected ${header.length} (from the header row)`,
      );
    }
    const record: Record<string, string> = {};
    header.forEach((name, idx) => {
      record[name] = row[idx]!;
    });
    return record;
  });
}

/** Char-by-char state machine — quote-aware, so a quoted field may itself contain commas and raw
 * newlines without them being mistaken for delimiters/row breaks. */
function tokenizeCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        cur += ch;
        i++;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
    } else if (ch === ',') {
      row.push(cur);
      cur = '';
      i++;
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
      i++;
    } else if (ch === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
      i++;
    } else {
      cur += ch;
      i++;
    }
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}
