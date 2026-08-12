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
  MISSING_FILE: 'TF043',
  CALL_CYCLE: 'TF044',
  UNBALANCED_BRACKET: 'TF045',
  EMPTY_TAG: 'TF046',
  UNKNOWN_ESCAPE: 'TF047',
  TAB_INDENT: 'TF048',
  HIDDEN_CHAR: 'TF049',
  CONFUSABLE_WORD: 'TF050',
  // M116 (`PLAN_M97_CHECKER_CONTRACT.md`, D148-D150) — three rules the runtime enforced alone,
  // closing eight `M97a`/`M97c` rows. Each is config × AST or AST × AST: nothing here needs a
  // response, a value or the filesystem, which is why they were rule-2 violations and not the
  // runtime's to keep.
  NO_BASE_URL_FOR_STEP: 'TF051',
  MASK_WITHOUT_SNAPSHOT: 'TF052',
  SUBJECT_NOT_CAPTURABLE: 'TF053',
  // M124 (`PLAN_M124_LITERAL_DECIDABILITY.md`, D232-D233) — the `'static-if-literal'` residue of
  // the same enumeration. One sentence across all three: an operand *written in the file* that the
  // runtime inspects and refuses is decidable before the run starts. Three codes for five rows,
  // because rows get filed per `throw` site and rules are fewer (M116's finding).
  INVALID_LITERAL_OPERAND: 'TF054',
  HOLD_EXCEEDS_WAIT_TIMEOUT: 'TF055',
  DATA_TABLE_EXTENSION: 'TF056',
  // M125b1 (`FU-18`, D245/D246/D266) — an absolute URL is now legal in `api` and `open`, and these
  // three say what it costs. The first two are **warnings** and the tier is D147: `allow hosts` and
  // the env's base URLs come from `tflw.config` and differ per env, so the checker is predicting
  // what *this* run would do rather than observing something settled. The third is an **error**,
  // and the difference is the whole of D147 in one place — both of its operands are written in the
  // file, so no config can make it right.
  ABSOLUTE_URL_NOT_PORTABLE: 'TF057',
  ABSOLUTE_URL_NEEDS_ALLOW_HOSTS: 'TF058',
  SERVICE_WITH_ABSOLUTE_URL: 'TF059',
  // M128b (`PLAN_M128_PENTEST_TIER1.md`, D291) — D21's declaration layer, and the two ways to get
  // it wrong. Both are **errors**, and both are decidable from config × AST with no I/O, which is
  // what makes them the checker's rather than the runtime's (D137 clause 2).
  //
  // The tier is worth stating, because `TF057`/`TF058` directly above are warnings for a
  // superficially similar reason (a config-derived prediction about what a run would do). The
  // difference is what is being predicted: those predict a *refusal*, which a different env could
  // legitimately change. These predict nothing. A security assertion with no declaration behind it
  // is not permitted to run in any env, and a wildcard target is not a claim anyone can make.
  SECURITY_ASSERTION_UNAUTHORIZED: 'TF060',
  AUTHORIZED_TARGET_WILDCARD: 'TF061',
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
 *
 * The threshold is keyed on the **longer** of the typed word and the candidate (M125b2, `FU-20c`,
 * D261), not on the typed word alone. Keyed on the typed word, *abbreviating* is judged against the
 * abbreviation's own budget: `prodId` for `productId` is distance 3 against a 6-character word's
 * budget of 2, so it falls out — which is exactly backwards, since the longer the intended name,
 * the further a plausible typo can diverge from it. Ranked selection and the single-best return are
 * unchanged, so the only new behaviour is admitting a best-match that was previously discarded.
 *
 * `suggest` is the single suggestion engine for the whole language — methods, keywords, matchers,
 * variables, actions, services, sessions — so this widens every "did you mean" at once, and a
 * confidently wrong suggestion is worse than none. That is why the ladder in
 * `suggestThreshold.test.ts` pins the *non*-suggestions as hard as the suggestions.
 */
export function suggest(word: string, candidates: readonly string[]): string | undefined {
  const w = word.toLowerCase();
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
  if (best === undefined) return undefined;
  return bestDist <= suggestThreshold(Math.max(w.length, best.length)) ? best : undefined;
}

/** Edit-distance budget for a word of length `len`. Unchanged from M61 in shape and in every
 * boundary; only what gets *passed* to it moved (D261). */
function suggestThreshold(len: number): number {
  return len <= 4 ? 1 : len <= 7 ? 2 : 3;
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

// ---------------------------------------------------------------------------
// The display coordinate (M98a, `A1-08` / D147-D151).
//
// tflw has two coordinate systems and used one type for both. `Position.column` is a **machine**
// coordinate — a 1-based UTF-16 code-unit column, which is what `String.prototype.slice` and LSP
// both want — and this renderer consumed it as a **display** coordinate, `' '.repeat(column - 1)`.
// The two agree only on lines that are pure single-cell ASCII, so every caret under a tab, a CJK
// run, an emoji or a combining mark was misaligned by exactly the difference.
//
// `Position` stays UTF-16 and is now documented as such (`token.ts`): it is a frozen exported type
// under an additive-only freeze, and changing a field's unit is not an additive change. The display
// coordinate is derived here instead, which is the only place that wants terminal cells — the LSP
// publishes structured ranges and `report.html` renders in a proportional font, where counting
// cells means nothing.
// ---------------------------------------------------------------------------

/** Cells a tab advances to. Eight is the near-universal terminal default. */
const TAB_STOP = 8;

/** Code points that occupy no cells: combining marks (`Mn`/`Me`, including variation selectors) and
 * format characters (`Cf` — zero-width space/non-joiner/joiner, the bidi overrides, and `U+FEFF`).
 *
 * Expressed as Unicode property escapes rather than a hand-copied range table so it tracks the
 * engine's Unicode version instead of the version whoever wrote it happened to have open. */
const ZERO_WIDTH = /[\p{Mn}\p{Me}\p{Cf}]/u;

/** Code points that occupy two cells — East Asian Wide and Fullwidth, plus the emoji planes.
 *
 * This one *is* a table: ECMAScript exposes General_Category and Script as property escapes but not
 * `East_Asian_Width`, so there is nothing to delegate to. Ranges follow Unicode 15.1's `W`/`F`
 * classes, condensed. */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // Hangul Jamo initial consonants
  [0x2e80, 0x303e], // CJK radicals, Kangxi, CJK symbols & punctuation
  [0x3041, 0x33ff], // kana, Hangul compatibility jamo, CJK compatibility
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi
  [0xa960, 0xa97f], // Hangul Jamo Extended-A
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe19], // vertical forms
  [0xfe30, 0xfe6f], // CJK compatibility forms, small form variants
  [0xff00, 0xff60], // fullwidth forms
  [0xffe0, 0xffe6], // fullwidth signs
  [0x1f300, 0x1faff], // emoji: symbols & pictographs through extended-A
  [0x20000, 0x2fffd], // CJK Extension B-F
  [0x30000, 0x3fffd], // CJK Extension G+
];

/** Terminal cells one code point occupies. */
function cellWidth(ch: string): number {
  if (ZERO_WIDTH.test(ch)) return 0;
  const cp = ch.codePointAt(0)!;
  for (const [lo, hi] of WIDE_RANGES) {
    if (cp < lo) break;
    if (cp <= hi) return 2;
  }
  return 1;
}

/**
 * Lay a source line out for the terminal: expand tabs to spaces, and translate the caret's
 * code-unit range into a cell range.
 *
 * **Tabs are expanded rather than measured** (D150). Measuring alone is not enough: the printed
 * line would still contain the raw tab, and where a terminal puts that tab depends on the tab stop
 * *relative to the gutter prefix* (`2 | `), which this renderer does not control. Expanding makes
 * the rendered line's geometry a property of the string instead of a property of the reader's
 * terminal, and then the caret padding is exact by construction rather than by coincidence.
 *
 * Runs after `windowLine`, never before (D151): the 200-column cap exists to bound `A1-01`'s
 * quadratic allocation, which is a code-unit concern. Capping in cells would make the bound depend
 * on the content's script for no gain.
 */
function layoutLine(line: string, caretStart: number, caretLen: number): { text: string; caretCells: number; caretWidth: number } {
  const caretEnd = caretStart + caretLen;
  let text = '';
  let cells = 0;
  let units = 0;
  let startCells = -1;
  let endCells = -1;
  // `for…of` iterates code points, so an astral character is one step, not two lone surrogates.
  // The boundary tests are `>=` because a span could in principle start mid-surrogate.
  for (const ch of line) {
    if (startCells < 0 && units >= caretStart) startCells = cells;
    if (endCells < 0 && units >= caretEnd) endCells = cells;
    if (ch === '\t') {
      const next = (Math.floor(cells / TAB_STOP) + 1) * TAB_STOP;
      text += ' '.repeat(next - cells);
      cells = next;
    } else {
      text += ch;
      cells += cellWidth(ch);
    }
    units += ch.length;
  }
  if (startCells < 0) startCells = cells;
  if (endCells < 0) endCells = cells;
  return { text, caretCells: startCells, caretWidth: Math.max(1, endCells - startCells) };
}

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

// ---------------------------------------------------------------------------
// The display line (M106, `M98c-01` / D191-D196).
//
// A zero-extent span is the *normal* case, not an anomaly: measured over every `.tflw` in
// testFlow-tests and every line-boundary truncation of each — 19,143 parses — 89% of diagnostics
// carry one, because "expected X, found end of line" points at a position rather than at a lexeme.
// Nearly all of them render correctly, with the caret one cell past the last character of a real
// line, which is how Rust prints "found EOF" too.
//
// The 801 that do not are the ones anchored at end-of-source — the `eof` push and the `dedent` loop
// that closes open blocks, both at `posAt(n)`. `source.split('\n')` turns a file's trailing newline
// into a phantom empty last element, so the caret lands on a line that is not in the file:
//
//   test "x"\n                          test "x"          ← the same program, no trailing newline
//    --> x.tflw:2:1                      --> x.tflw:1:9
//     |                                   |
//   2 |                                 1 | test "x"
//     | ^                                 |         ^
//
// Both are `TF015: this `test` has no steps`, and the right-hand one is already right. Every real
// `.tflw` ends with a newline, so every author gets the left one. This is therefore not a new layout
// design — it is the renderer being made to agree with itself, and the round-trip is the test:
// `render(src)` and `render(src.replace(/\n$/, ''))` must produce the same snippet and column.
//
// Derived here rather than fixed by moving the token (D191), for the reason M98a derived the
// terminal cell here rather than changing `Position`: `tflw check --format json` hands the raw
// `Diagnostic` to its consumer, so moving a span to fix a human surface silently moves a machine
// one. `diag.span` is untouched; `--format json` and the LSP are byte-identical across this change.
// ---------------------------------------------------------------------------

/** A line the caret may be anchored to: it has content, and that content is not a comment.
 *
 * The comment half is not decoration (D193). Blank-lines-only would leave **156 of 957** carets
 * pointing past the end of a comment — several of them a hundred characters of prose — which is
 * exactly the defect D159 fixed for `newline`, reproduced in a new place. The test is the lexer's
 * own: `processLine` treats a line whose first non-whitespace character is `#` as comment-only
 * *before* it looks at bracket continuation, so the two agree by construction rather than by a
 * second copy of the rule. */
function isCodeLine(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed !== '' && !trimmed.startsWith('#');
}

/** Where a diagnostic should be *shown*, as opposed to where its span is (M106, D191-D196).
 *
 * Returns `span.start`'s line/column unchanged for everything except a zero-extent span pointing at
 * a line with no code, which is re-anchored past the last non-whitespace character of the nearest
 * preceding line that has some. Exported so the LSP can adopt the same derivation; it deliberately
 * does not yet (D197 — what an editor draws for a zero-width range past the last line has not been
 * measured, and published ranges are what quick-fix positioning keys off).
 *
 * The trigger is what is under the caret, not which token produced it (D192): this function is
 * handed a `Diagnostic` and a string and has no provenance, and a layout rule that reconstructed one
 * would depend on lexer internals. Measurement says the two sets coincide exactly today.
 *
 * Total by construction (D196): a prefix that is entirely blank and comment lines has nothing to
 * fall back to, so the original position is returned. Measured 0 times in the corpus, and reachable. */
export function displayAnchor(span: Span, source: string): { readonly line: number; readonly column: number } {
  const { start, end } = span;
  const here = { line: start.line, column: start.column };
  if (start.offset !== end.offset) return here;

  const lines = source.split('\n');
  // Past the last non-whitespace character, which is where D159 puts `newline` — matching it is what
  // makes the two renderings above identical. `\r` is included because `split('\n')` leaves it on
  // every line of a CRLF file while the lexer strips it before measuring columns.
  const afterCode = (line: string): number => line.replace(/[ \t\r]+$/, '').length + 1;

  const atCaret = lines[start.line - 1];
  // D194b: a caret on its own code line still clamps to the end of that code. Trailing whitespace is
  // the one thing that separates the two forms once the walk-back exists — `test "x"   ` with no
  // final newline puts `eof` at `posAt(n)`, three cells into the spaces, while the same file *with*
  // a final newline re-anchors and trims them. Measured 0 times across the corpus, because these
  // files have no trailing whitespace; kept because a stated invariant with a known counterexample
  // is the shape of claim this review has had to withdraw before. On the 1,355 spans that do land on
  // their own code line the clamp is a no-op: `newline` already sits exactly there.
  if (atCaret !== undefined && isCodeLine(atCaret)) return { line: start.line, column: Math.min(start.column, afterCode(atCaret)) };

  let i = Math.min(start.line - 2, lines.length - 1);
  while (i >= 0 && !isCodeLine(lines[i]!)) i--;
  if (i < 0) return here;
  return { line: i + 1, column: afterCode(lines[i]!) };
}

export function renderDiagnostic(diag: Diagnostic, source: string, opts: RenderOptions = {}): string {
  const filename = opts.filename ?? '<input>';
  const lines = source.split('\n');
  const { start, end } = diag.span;
  const anchor = displayAnchor(diag.span, source);
  const moved = anchor.line !== start.line || anchor.column !== start.column;
  const rawLine = lines[anchor.line - 1] ?? '';

  // Caret spans from the start column to the end column, clamped to this line. A re-anchored caret
  // is always one cell wide: `displayAnchor` only moves a zero-extent span, so there is by
  // definition no width to carry over, and `end.column` belongs to a different line.
  const rawCaretStart = anchor.column - 1;
  const sameLine = end.line === start.line;
  const rawCaretEnd = moved ? rawCaretStart + 1 : sameLine ? Math.max(end.column - 1, rawCaretStart + 1) : rawLine.length;
  const windowed = windowLine(rawLine, rawCaretStart, rawCaretEnd);
  // M98a (`A1-08`): the caret is placed in terminal cells, not code units. See `layoutLine`.
  const { text: lineText, caretCells, caretWidth } = layoutLine(windowed.lineText, windowed.caretStart, windowed.caretLen);

  const gutterWidth = String(anchor.line).length;
  const pad = ' '.repeat(gutterWidth);
  const lineNo = String(anchor.line).padStart(gutterWidth);

  const c = opts.color
    ? {
        red: (s: string) => `[31m${s}[0m`,
        bold: (s: string) => `[1m${s}[0m`,
        blue: (s: string) => `[34m${s}[0m`,
        cyan: (s: string) => `[36m${s}[0m`,
      }
    : { red: (s: string) => s, bold: (s: string) => s, blue: (s: string) => s, cyan: (s: string) => s };

  const header = `${c.bold(`${diag.severity}[${diag.code}]`)}: ${diag.message}`;
  // D195: the locator moves with the caret. A `-->` naming a line the snippet does not print is
  // incoherent, and the locator is what a terminal linkifies and an editor jumps to — a display
  // coordinate as much as the caret is. `diag.span` still does not move.
  const locator = `${pad}${c.blue('-->')} ${filename}:${anchor.line}:${anchor.column}`;
  const caretLine = ' '.repeat(caretCells) + c.red('^'.repeat(caretWidth)) + (diag.label ? ' ' + c.red(diag.label) : '');

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
