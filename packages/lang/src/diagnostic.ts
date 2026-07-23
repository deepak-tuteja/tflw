// Structured diagnostics + a Rust/Elm-style renderer. Errors are a feature (PLAN P#6):
// every diagnostic carries a stable code, a message, a source span, and an optional hint,
// and renders with the offending source line and a caret underline.

import type { Span } from './token.js';

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  /** Stable machine code, e.g. `TF001`. Referenced by docs and snapshot tests. */
  readonly code: string;
  readonly severity: Severity;
  /** One-line summary shown on the `error[CODE]:` header line. */
  readonly message: string;
  /** Primary source range the caret underlines. */
  readonly span: Span;
  /** Short message printed next to the caret (defaults to none). */
  readonly label?: string;
  /** A `= help:` line, e.g. a "did you mean `expect`?" suggestion. */
  readonly hint?: string;
}

/** Thrown for a fatal parse stop (rare — the parser prefers recovery + collected diagnostics). */
export class TflwSyntaxError extends Error {
  readonly diagnostics: readonly Diagnostic[];
  constructor(diagnostics: readonly Diagnostic[]) {
    super(diagnostics[0]?.message ?? 'syntax error');
    this.name = 'TflwSyntaxError';
    this.diagnostics = diagnostics;
  }
}

/** Diagnostic codes used by the M0 lexer/parser. Kept in one place so they stay unique. Meanings:
 * see `DIAGNOSTICS` in `spec-data.ts` (decision 20.7, docs-site polish cluster 9) — the single
 * source of truth for what each code means, feeding SPEC.md §17, the docs-site Reference page,
 * and LSP hover. */
export const Codes = {
  UNEXPECTED_CHAR: 'TF001',
  UNTERMINATED_STRING: 'TF002',
  INCONSISTENT_INDENT: 'TF003',
  UNEXPECTED_TOKEN: 'TF010',
  UNKNOWN_STATEMENT: 'TF011',
  UNKNOWN_METHOD: 'TF012',
  UNKNOWN_SUBJECT: 'TF013',
  UNKNOWN_MATCHER: 'TF014',
  EMPTY_BLOCK: 'TF015',
  UNEXPECTED_TOP_LEVEL: 'TF016',
  CONFIG_UNKNOWN_KEY: 'TF020',
  CONFIG_TEST_NOT_ALLOWED: 'TF021',
  CONFIG_UNEXPECTED: 'TF022',
  UNKNOWN_DURATION_UNIT: 'TF023',
  CONFIG_ENV_CONFLICT: 'TF024',
  CONFIG_KEY_CONTEXT: 'TF025',
  UNKNOWN_SERVICE: 'TF026',
  UNKNOWN_TABLE_COLUMN: 'TF027',
  UNKNOWN_SESSION: 'TF028',
  CONFIG_SESSION_CONFLICT: 'TF029',
  UNKNOWN_VARIABLE: 'TF030',
  REQUEST_ASSERTION_INVALID: 'TF031',
  INVALID_CONTENT_TYPE: 'TF032',
} as const;

// ---------------------------------------------------------------------------
// "did you mean" — Levenshtein-based nearest keyword.
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/**
 * The closest candidate to `word` within an edit distance threshold that scales with word
 * length, or `undefined` if nothing is close enough. Used to produce "did you mean" hints.
 */
export function suggest(word: string, candidates: readonly string[]): string | undefined {
  const w = word.toLowerCase();
  const threshold = w.length <= 4 ? 1 : w.length <= 7 ? 2 : 3;
  let best: string | undefined;
  let bestDist = Infinity;
  for (const cand of candidates) {
    const d = levenshtein(w, cand.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  if (best !== undefined && bestDist > 0 && bestDist <= threshold) return best;
  return undefined;
}

// ---------------------------------------------------------------------------
// Rendering.
// ---------------------------------------------------------------------------

export interface RenderOptions {
  /** File path shown in the `-->` locator line. Defaults to `<input>`. */
  readonly filename?: string;
  /** Include ANSI colour codes. Defaults to `false` (snapshot- and pipe-friendly). */
  readonly color?: boolean;
}

/**
 * Render a single diagnostic against its source text, Rust/Elm-style:
 *
 * ```
 * error[TF011]: unknown step `expct`
 *   --> checkout.tflw:2:3
 *    |
 *  2 |   expct status equals 200
 *    |   ^^^^^ not a known step keyword
 *    |
 *    = help: did you mean `expect`?
 * ```
 */
export function renderDiagnostic(diag: Diagnostic, source: string, opts: RenderOptions = {}): string {
  const filename = opts.filename ?? '<input>';
  const lines = source.split('\n');
  const { start, end } = diag.span;
  const lineText = lines[start.line - 1] ?? '';

  // Caret spans from the start column to the end column, clamped to this line.
  const caretStart = start.column - 1;
  const sameLine = end.line === start.line;
  const caretEnd = sameLine ? Math.max(end.column - 1, caretStart + 1) : lineText.length;
  const caretLen = Math.max(1, caretEnd - caretStart);

  const gutterWidth = String(start.line).length;
  const pad = ' '.repeat(gutterWidth);
  const lineNo = String(start.line).padStart(gutterWidth);

  const c = opts.color
    ? {
        red: (s: string) => `[31m${s}[0m`,
        bold: (s: string) => `[1m${s}[0m`,
        blue: (s: string) => `[34m${s}[0m`,
        cyan: (s: string) => `[36m${s}[0m`,
      }
    : { red: (s: string) => s, bold: (s: string) => s, blue: (s: string) => s, cyan: (s: string) => s };

  const header = `${c.bold(`${diag.severity}[${diag.code}]`)}: ${diag.message}`;
  const locator = `${pad}${c.blue('-->')} ${filename}:${start.line}:${start.column}`;
  const caretLine = ' '.repeat(caretStart) + c.red('^'.repeat(caretLen)) + (diag.label ? ' ' + c.red(diag.label) : '');

  const out: string[] = [
    header,
    locator,
    `${pad} ${c.blue('|')}`,
    `${c.blue(lineNo)} ${c.blue('|')} ${lineText}`,
    `${pad} ${c.blue('|')} ${caretLine}`,
  ];
  if (diag.hint) {
    out.push(`${pad} ${c.blue('|')}`);
    out.push(`${pad} ${c.blue('=')} ${c.bold('help')}: ${diag.hint}`);
  }
  return out.join('\n');
}

/** Render several diagnostics separated by blank lines. */
export function renderDiagnostics(diags: readonly Diagnostic[], source: string, opts: RenderOptions = {}): string {
  return diags.map((d) => renderDiagnostic(d, source, opts)).join('\n\n');
}
