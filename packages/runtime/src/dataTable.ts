// M2.5: `with each` row loading (SPEC §4.3). Inline rows are unevaluated `Value` expressions —
// generators inside them (e.g. `unique email`) only draw a value at case-execution time, via the
// normal `evalValue` path with that case's own EvalCtx. File-backed rows are already-resolved
// data (a CSV/JSON file has no notion of testFlow expressions), bound straight into scope.

import { readFile } from 'node:fs/promises';
import { resolve as resolvePath, extname } from 'node:path';
import type { DataTable } from '@tflw/lang';
import type { Value } from '@tflw/lang';
import { RuntimeError } from './eval.js';

/** One table cell, bound into a case's scope under `name` — either an expression to evaluate
 * fresh at case start (inline table) or an already-resolved literal (file-backed table). */
export interface RowCell {
  readonly name: string;
  readonly expr?: Value;
  readonly value?: unknown;
}

export async function loadTableRows(table: DataTable, baseDir: string): Promise<RowCell[][]> {
  if (table.type === 'InlineDataTable') {
    return table.rows.map((row) => table.columns.map((name, i) => ({ name, expr: row[i]! })));
  }
  const abs = resolvePath(baseDir, table.path.value);
  let text: string;
  try {
    text = await readFile(abs, 'utf8');
  } catch (err) {
    throw new RuntimeError(`could not read data table file "${table.path.value}" (resolved ${abs}): ${(err as Error).message}`);
  }
  const ext = extname(table.path.value).toLowerCase();
  if (ext === '.json') return parseJsonRows(text, table.path.value);
  if (ext === '.csv') return parseCsvRows(text, table.path.value);
  throw new RuntimeError(`data table file "${table.path.value}" must be \`.csv\` or \`.json\` (got "${ext || 'no extension'}")`);
}

function parseJsonRows(text: string, label: string): RowCell[][] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new RuntimeError(`data table file "${label}" is not valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(data)) throw new RuntimeError(`data table file "${label}" must be a JSON array of row objects`);
  return data.map((row, i) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      throw new RuntimeError(`data table file "${label}": row ${i + 1} must be a JSON object`);
    }
    return Object.entries(row as Record<string, unknown>).map(([name, value]) => ({ name, value }));
  });
}

/** Minimal RFC-4180 support (quoted fields, `""` as an escaped quote) — enough for a
 * comma-containing value (`"Smith, John",30`) to survive without desyncing every later column
 * (decision 65). Numeric-looking cells are coerced to real numbers so `expect body.qty equals
 * {qty}` against a real JSON number matches the way a `.json`-backed table already does (JSON
 * preserves types natively; CSV never had them). Every row's cell count is validated against the
 * header — a short or long row is a clear error, not silently padded/truncated. */
function parseCsvRows(text: string, label: string): RowCell[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]!);
  return lines.slice(1).map((line, i) => {
    const cells = parseCsvLine(line);
    if (cells.length !== header.length) {
      throw new RuntimeError(
        `data table file "${label}": row ${i + 2} has ${cells.length} cell${cells.length === 1 ? '' : 's'}, expected ${header.length} ` +
          `(matching the header's ${header.length} column${header.length === 1 ? '' : 's'}) — check for an unquoted comma inside a field`,
      );
    }
    return header.map((name, idx) => ({ name, value: coerceCsvValue(cells[idx]!) }));
  });
}

/** Splits one CSV line on unquoted commas; `"..."` may contain commas verbatim and `""` is an
 * escaped quote inside a quoted field. Trims surrounding whitespace like the previous naive
 * `split(',')` did, for unquoted cells. */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"' && cur === '') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

const NUMERIC_CELL = /^-?\d+(\.\d+)?$/;

function coerceCsvValue(raw: string): unknown {
  if (!NUMERIC_CELL.test(raw)) return raw;
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}
