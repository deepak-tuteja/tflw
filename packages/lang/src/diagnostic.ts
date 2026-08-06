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
  /** Present on a diagnostic whose fix is a single-token rewrite: `replacement` is the exact text
   * `tflw migrate` (P#38, the 1.0-gate deliverable) splices in at `span` to mechanically upgrade
   * the suite — the same "generate a fully-prepared rewrite alongside the diagnostic" shape the
   * reuse pass (M6) already uses for its own hints. `renderDiagnostic` derives migrate's offer from
   * this field alone (D-M90-4), so a rule that sets it advertises the tool and a rule that doesn't
   * stays quiet, with no second list to keep in step.
   *
   * **Any severity, not only `'warning'` (D-M90-0).** This used to say "present only on a
   * `severity: 'warning'` deprecation diagnostic (decision 38)" — the lifecycle where removed
   * syntax spends ≥1 release as a checker warning first. That lifecycle has never once been used:
   * all four pre-1.0 removals (`scenario`, `think`, `uncheck`, bare `check <locator>`) went
   * straight to hard errors, because there was no released version to spend a warning in. Honouring
   * the old contract literally would have meant un-removing four keywords so they could parse and
   * run again — shipping 1.0 with four zombie keywords and a promise to remove them in 2.0 — since
   * a token-span splice needs a lexer, not a parse tree. Decision 38 is restated rather than
   * abandoned: *a rename spends at least one release as a warning when there is a release to spend
   * it in; a pre-1.0 removal is an error that carries its own replacement, and `tflw migrate`
   * applies it.* */
  readonly deprecation?: { readonly replacement: string };
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
  LOAD_INVALID: 'TF033',
  THRESHOLD_SCOPE_UNKNOWN: 'TF034',
  DUPLICATE_ACTION: 'TF035',
  ALLOW_HOSTS_EXCLUDES_BASE_URL: 'TF036',
  UNKNOWN_CALL: 'TF037',
  CALL_ARITY: 'TF038',
  NO_RESPONSE_YET: 'TF039',
  CALL_NOT_EVALUATED: 'TF040',
  VALUE_SUBJECT_INVALID: 'TF041',
  MATCHER_SUBJECT_MISMATCH: 'TF042',
} as const;

// ---------------------------------------------------------------------------
// "did you mean" — Levenshtein-based nearest keyword.
// ---------------------------------------------------------------------------

/**
 * Optimal string alignment distance — Levenshtein plus a one-step **transposition**, so a swapped
 * pair of adjacent characters costs 1 edit instead of 2 (M61, review finding A4-08, secondary).
 * That single case earns its keep here: a transposition is what hand-typing produces (`nmae` for
 * `name`, `ordreId` for `orderId`), and under plain Levenshtein it cost the same as two unrelated
 * wrong letters — which pushed it past the threshold for exactly the short names it happens to
 * most, so `{nmae}` against a `name` column got the generic fallback and no suggestion at all.
 */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Three rolling rows rather than two: the transposition case reads the row *two* back.
  let prev2 = new Array<number>(n + 1).fill(0);
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, prev2[j - 2]! + 1);
      curr[j] = best;
    }
    [prev2, prev, curr] = [prev, curr, prev2];
  }
  return prev[n]!;
}

/**
 * The closest candidate to `word` within an edit distance threshold that scales with word
 * length, or `undefined` if nothing is close enough. Used to produce "did you mean" hints.
 *
 * Matching is case-insensitive but a **case-only** difference is a suggestion, not a non-answer
 * (M61, review finding A4-08). This used to require `bestDist > 0`, which read a distance of zero
 * as "the user already typed a candidate, there is nothing to say" — true of the *lowercased*
 * word, and false of the one on screen. So `orderid` for `orderId`, `userid` for `userId`,
 * `productID` for `productId` all fell through to the generic fallback while a one-character
 * deletion got a hint. Capture names are camelCase by convention and interpolations are hand-typed,
 * which makes case drift *the* characteristic typo of this language — and the hole was language-
 * wide, since `TF011`/`TF012`/`TF013`/`TF014`/`TF020`/`TF026`/`TF027`/`TF028`/`TF030` all come
 * through here. `SPEC.md` §17's own worked `TF030` example — propagated into the docs site and LSP
 * hover by `gen-spec-tables.mjs` — was of a case-only typo, and could not be reproduced.
 *
 * A word that *exactly* equals a candidate still gets nothing: the caller is erroring for some
 * other reason, and "did you mean `x`?" about the `x` already typed is noise.
 */
export function suggest(word: string, candidates: readonly string[]): string | undefined {
  const w = word.toLowerCase();
  const threshold = w.length <= 4 ? 1 : w.length <= 7 ? 2 : 3;
  let best: string | undefined;
  let bestDist = Infinity;
  for (const cand of candidates) {
    if (cand === word) return undefined;
    const d = editDistance(w, cand.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  return best !== undefined && bestDist <= threshold ? best : undefined;
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
/** Widest source line `renderDiagnostic` will print in full (M59, A1-01). */
const MAX_RENDERED_LINE = 200;

/** Keep a diagnostic's rendered source line bounded (M59, A1-01).
 *
 * Rendering used to emit the whole line plus one space of caret padding per preceding column, so a
 * diagnostic on a minified bundle or a single-line JSON blob cost O(line length) *each* — with one
 * diagnostic per unreadable byte, that was quadratic, and 50 KB of input took the process to 3.6 GB
 * and an abort. A window around the caret is bounded and strictly more readable: 50 KB of source in
 * a terminal helps nobody. */
function windowLine(line: string, caretStart: number, caretEnd: number): { lineText: string; caretStart: number; caretLen: number } {
  const caretLen = Math.max(1, caretEnd - caretStart);
  if (line.length <= MAX_RENDERED_LINE) return { lineText: line, caretStart, caretLen };

  const ellipsis = '…';
  const context = Math.floor((MAX_RENDERED_LINE - Math.min(caretLen, 40)) / 2);
  const from = Math.max(0, caretStart - context);
  const to = Math.min(line.length, from + MAX_RENDERED_LINE);
  const head = from > 0 ? ellipsis : '';
  const tail = to < line.length ? ellipsis : '';
  return {
    lineText: head + line.slice(from, to) + tail,
    caretStart: caretStart - from + head.length,
    caretLen: Math.max(1, Math.min(caretLen, to - caretStart)),
  };
}

export function renderDiagnostic(diag: Diagnostic, source: string, opts: RenderOptions = {}): string {
  const filename = opts.filename ?? '<input>';
  const lines = source.split('\n');
  const { start, end } = diag.span;
  const rawLine = lines[start.line - 1] ?? '';

  // Caret spans from the start column to the end column, clamped to this line.
  const rawCaretStart = start.column - 1;
  const sameLine = end.line === start.line;
  const rawCaretEnd = sameLine ? Math.max(end.column - 1, rawCaretStart + 1) : rawLine.length;
  const { lineText, caretStart, caretLen } = windowLine(rawLine, rawCaretStart, rawCaretEnd);

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
  // D-M90-4: the offer to migrate is *derived* from the payload, never hand-written next to a
  // rule. The advertisement and the capability become the same fact, so they cannot drift — which
  // is exactly what cluster C8 was: four surfaces describing a `tflw migrate` that could not act.
  // A rule that deliberately carries no payload (`TF014`'s bare `check <locator>`, D-M90-3, where
  // the fix needs a human decision between `tick` and an assertion) therefore makes no offer, for
  // free and without a second list to keep in step.
  if (diag.deprecation) {
    if (!diag.hint) out.push(`${pad} ${c.blue('|')}`);
    out.push(`${pad} ${c.blue('=')} ${c.bold('fix')}: run \`tflw migrate\` to apply this automatically`);
  }
  return out.join('\n');
}

/** Render several diagnostics separated by blank lines. */
export function renderDiagnostics(diags: readonly Diagnostic[], source: string, opts: RenderOptions = {}): string {
  return diags.map((d) => renderDiagnostic(d, source, opts)).join('\n\n');
}
