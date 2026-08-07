// Hand-rolled lexer for the testFlow M0 surface (GRAMMAR.md § Lexical). Offside rule:
// significant indentation is turned into synthetic `indent`/`dedent`/`newline` tokens so the
// parser can stay indentation-agnostic. No parser generator (PLAN P#12). Pure: input string in,
// tokens + diagnostics out. No I/O.
//
// The reason for hand-rolling it was stated here as owning "source positions and error recovery",
// which the M98 audit (`A1-OS-07`) read as a claim and checked. It was not one yet: positions were
// counted in UTF-16 code units and rendered as terminal cells, `newline` sat past a trailing
// comment, an unclosed bracket was known and never reported, and non-ASCII was rejected one code
// unit at a time. What the lexer owns *now*, after M98a–c:
//
//   - every diagnostic's caret, in display cells (M98a, `A1-08`);
//   - the boundary between code and a trailing comment, which is where `newline` sits (D159);
//   - the facts it computes and used to discard — an unclosed `{`, an empty `@`, an unknown string
//     escape, a foreign numeric notation (M98b, `TF045`–`TF047`);
//   - recovery that reports one mistake once: a run of rejected characters is one diagnostic, and
//     the tab rule is one diagnostic per file (D161, D163).

import type { Position, Span, Token, TokenType } from './token.js';
import { type Diagnostic, Codes } from './diagnostic.js';

export interface LexResult {
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly Diagnostic[];
}

/** Characters that may appear in a `/`-initiated PATH token.
 *
 * M59 (A1-06): this was the RFC-3986 *unreserved* set plus a handful of delimiters, which rejected
 * perfectly ordinary URLs — `?q=hello+world` and `?ids=1,2,3` both failed to lex, and the help line
 * said `expected end of line` without ever mentioning the path. It now covers every character RFC
 * 3986 permits unescaped in a path or query (unreserved + sub-delims + `[`/`]`/`@`), so a path stops
 * only at whitespace or a genuine comment.
 *
 * `#` is deliberately still excluded: it starts a comment, and no widening can change that without
 * making trailing comments unparseable after a path. The silent-truncation bug it used to cause
 * (A1-02 — a green run against a request the author never wrote) is handled at the scan site
 * instead, by diagnosing the collision rather than swallowing it. */
const PATH_CHARS = /[A-Za-z0-9_\-./{}?=&:%~!$'()*+,;[\]@]/;

/** A byte-order mark is invisible, so left as an "unexpected character" it produces a diagnostic
 * whose message quotes nothing a user can see (A1-04). Treated as whitespace wherever whitespace is
 * skipped; it is a zero-width no-break space, so this is harmless anywhere it appears. */
const BOM = '﻿';

/** Ceiling on "unexpected character" diagnostics from one lex (M59, A1-01) — see `unexpectedChars`.
 * Well past any real typo count, far below the point where rendering them costs anything. */
const MAX_UNEXPECTED_CHARS = 50;

/** Longest run of rejected characters coalesced into one diagnostic (M98c, `A1-16`, D163) — a
 * bound on the *message*, where `MAX_UNEXPECTED_CHARS` is a bound on the count. See the recovery
 * branch in `lexContent` for why both are needed. */
const MAX_RUN_CHARS = 16;

/** HTTP method words — a `/` right after one of these starts a PATH token; elsewhere `/` is the
 * arithmetic divide operator (M2, P#25). Case-insensitive to match the parser's method check. */
const METHOD_WORDS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}
function isIdentCont(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}
function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/** True when nothing in the grammar can start with this character — the recovery path's input
 * (M98c, `A1-16`, D163). Derived from the branches of `lexContent` rather than listed independently,
 * so a character class that gains a meaning cannot start being swallowed as garbage as well. */
function isUnlexable(ch: string): boolean {
  return !(ch === ' ' || ch === '\t' || ch === BOM || ch === '#' || ch === '"' || ch === '/' || ch === '@' || isDigit(ch) || isIdentStart(ch) || PUNCT[ch] !== undefined);
}

/** Characters with no visible glyph — format controls, combining marks, non-ASCII spaces, C0/C1
 * controls, and the line/paragraph separators. Quoting one of these in a diagnostic prints something
 * the reader cannot tell from a space or from nothing at all, which is how `unexpected character
 * " "` (U+00A0) came to be a real message that a user could stare at indefinitely. */
const INVISIBLE = /^(?:\p{Cf}|\p{Cc}|\p{Zs}|\p{Zl}|\p{Zp}|\p{Mn}|\p{Me})$/u;

/** Names for the invisible characters that actually reach a `.tflw` file — pasted from a browser, a
 * word processor, a chat client, or a PDF. Unicode ships no name database in the runtime, so this is
 * a hand table by necessity; anything absent still gets its code point printed, which is the part
 * that makes the message actionable. `﻿` is only reachable mid-line — `lexer.ts`'s whitespace
 * scan already strips a leading BOM (M59, `A1-04`). */
const INVISIBLE_NAMES: Record<string, string> = {
  '‪': 'LEFT-TO-RIGHT EMBEDDING',
  '‫': 'RIGHT-TO-LEFT EMBEDDING',
  '‬': 'POP DIRECTIONAL FORMATTING',
  '‭': 'LEFT-TO-RIGHT OVERRIDE',
  '‮': 'RIGHT-TO-LEFT OVERRIDE',
  '⁦': 'LEFT-TO-RIGHT ISOLATE',
  '⁧': 'RIGHT-TO-LEFT ISOLATE',
  '⁨': 'FIRST STRONG ISOLATE',
  '⁩': 'POP DIRECTIONAL ISOLATE',
  ' ': 'NO-BREAK SPACE',
  '­': 'SOFT HYPHEN',
  ' ': 'FIGURE SPACE',
  ' ': 'THIN SPACE',
  '​': 'ZERO WIDTH SPACE',
  '‌': 'ZERO WIDTH NON-JOINER',
  '‍': 'ZERO WIDTH JOINER',
  ' ': 'LINE SEPARATOR',
  ' ': 'PARAGRAPH SEPARATOR',
  ' ': 'NARROW NO-BREAK SPACE',
  '⁠': 'WORD JOINER',
  '　': 'IDEOGRAPHIC SPACE',
  '﻿': 'ZERO WIDTH NO-BREAK SPACE (byte-order mark)',
};

/** How a rejected character is named in a diagnostic. A visible one is quoted, as before; an
 * invisible one is *described*, because quoting it prints a message whose evidence is unreadable. */
function describeChar(ch: string): string {
  if (!INVISIBLE.test(ch)) return JSON.stringify(ch);
  const cp = ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
  const name = INVISIBLE_NAMES[ch];
  return name ? `U+${cp} ${name}` : `U+${cp}`;
}

/** Characters that could plausibly have been meant as part of a word — a letter, a mark, or a digit
 * in any script. Distinguishes `let café = 1` (an identifier cut short, and the truncated `caf` is
 * about to flow into the checker's did-you-mean machinery) from a stray non-breaking space, where
 * nothing was truncated and saying so would be a guess. */
const WORDLIKE = /^[\p{L}\p{M}\p{N}]$/u;

/** The Trojan Source characters (M98d, `A1-17`, D165): the ones whose presence makes rendered source
 * and parsed source two different texts. `bidi` reorders the glyphs after it, so a comment can be
 * made to *display* as an assertion that is not the one being run; `zeroWidth` has no glyph at all,
 * so `"admin​user"` and `"adminuser"` are indistinguishable on screen and unequal in a
 * comparison. CVE-2021-42574; Rust, Go and the major C++ compilers all added a rule after it.
 *
 * `U+FEFF` is the third category and needs its own, because `BOM` is *deliberately* skipped as
 * whitespace everywhere (M59, `A1-04`) — which is the very thing that makes it dangerous away from
 * offset 0, where it can sit inside what reads as one name and split it into two tokens in silence.
 * At offset 0 it is an ordinary byte-order mark and stays legal. */
const HIDDEN: Record<string, 'bidi' | 'zeroWidth' | 'bom'> = {
  '‪': 'bidi', '‫': 'bidi', '‬': 'bidi', '‭': 'bidi', '‮': 'bidi',
  '⁦': 'bidi', '⁧': 'bidi', '⁨': 'bidi', '⁩': 'bidi',
  '​': 'zeroWidth', '‌': 'zeroWidth', '‍': 'zeroWidth',
  '﻿': 'bom',
};

/** Why each category is refused, and — since D166 makes this a rule with a legal alternative rather
 * than a removed capability — how to write the character when the value genuinely needs it. */
const HIDDEN_HELP: Record<'bidi' | 'zeroWidth' | 'bom', string> = {
  bidi: 'this character has no glyph of its own; it reorders the text that follows it. A line containing one can display in an editor or a pull request as saying something quite different from what tflw reads, and the reader has no way to see the difference',
  zeroWidth: 'this character has no glyph, so the text containing it renders exactly like the text without it — identical on screen, unequal in any comparison',
  bom: 'a byte-order mark is only meaningful as the very first character of a file. Anywhere else tflw skips it as whitespace, so it can sit inside what reads as a single name and split it into two tokens with nothing to see',
};

/** The other half of the Trojan Source class (M103, `M98d-02`, D178-D180): characters that are not
 * invisible but are **not the letter they look like**. `TF049` can reject its set outright because
 * nothing legitimate needs a zero-width space inline; a Cyrillic `а` is an ordinary letter in
 * ordinary text, so this rule has to be about *context* rather than about a character list.
 *
 * The unit is one **word** — a maximal run of letters/marks/digits — and not one string (D178).
 * A `.tflw` string is prose, and prose is legitimately multilingual: `"Willkommen — добро
 * пожаловать"` is two scripts in one string with no mixed word in it. Rust's
 * `mixed_script_confusables` gets to be per-token because its tokens are identifiers. */
const WORD_RUN = /[\p{L}\p{M}\p{N}]+/gu;
const HAS_LATIN = /\p{scx=Latn}/u;

/** The scripts that actually contain Latin lookalikes, and therefore the only ones whose presence
 * beside Latin *in the same word* is evidence of a spoof rather than of bilingual text (D179).
 *
 * Not "any two scripts": `"東京Tower"` mixes Latin and Han in one word and deceives nobody, because
 * Han has no Latin homoglyphs. Restricting the non-Latin side to these four is what buys the rule a
 * measured-zero false-positive rate on the corpora without shipping the UTS #39 confusables table.
 * Common and Inherited are never counted — that is where `—`, `§`, `…`, `→` and `×` live. */
const LOOKALIKE_SCRIPTS: readonly (readonly [string, RegExp])[] = [
  ['Cyrillic', /\p{scx=Cyrl}/u],
  ['Greek', /\p{scx=Grek}/u],
  ['Cherokee', /\p{scx=Cher}/u],
  ['Armenian', /\p{scx=Armn}/u],
];

class Lexer {
  private readonly tokens: Token[] = [];
  private readonly diagnostics: Diagnostic[] = [];
  /** Indentation column stack; always begins with the base level 0. */
  private readonly indentStack: number[] = [0];
  /** The last token pushed, of *any* type — `newline`, `indent` and `dedent` included. Used to
   * decide whether `/` starts a PATH.
   *
   * M98c (`A1-OS-05`, D164): this was called `lastMeaningful`, a name that promises the opposite of
   * what it holds. `canStartPath()` reads it and depends on the synthetics being in there, so the
   * name was an invitation to "fix" the field to match it and change PATH lexing silently. */
  private lastToken: Token | null = null;
  /** The `{`/`[` tokens opened and not yet closed. While non-empty, a physical line is a
   * *continuation* of the same logical line: its own indentation is irrelevant (no
   * `indent`/`dedent`), and no `newline` is emitted at its end — this is what lets an object/array
   * literal span several hand-formatted lines.
   *
   * M98b (`A1-10`, `A1-20`): this used to be a bare `number`. A count is enough to decide
   * *continuation*, and that is all it was ever asked, so a `{` that was never closed simply
   * swallowed the rest of the file and the lexer had nothing left to point at. Keeping the opening
   * tokens costs one array and makes `TF045` a lookup rather than an analysis. */
  private readonly openBrackets: Token[] = [];
  /** How many "unexpected character" diagnostics have been emitted (M59, A1-01). Recovery skips a
   * single character and reports it, so a file the lexer cannot read at all — a binary blob, a
   * minified bundle, the wrong file extension — produced one diagnostic *per byte*, each rendered
   * with a full copy of the offending line plus O(n) caret padding. That is quadratic: 50 KB of
   * unlexable input reached 3.6 GB and aborted the process. Past the cap the lexer keeps lexing
   * (recovery is unchanged) but stops accumulating, and says once that it has stopped. */
  private unexpectedChars = 0;
  /** How many `TF049`s have been emitted (M98d). Bounded for the reason `unexpectedChars` is: a
   * diagnostic renders a copy of its line plus O(n) caret padding, so one-per-character over a large
   * hostile or machine-generated file is the same quadratic blow-up `A1-01` exists to prevent.
   * Counted separately rather than sharing that budget, because a file with 50 ordinary typos must
   * not be the reason a hidden character goes unreported. */
  private hiddenChars = 0;
  /** How many `TF050`s have been emitted (M103). Bounded, and counted separately from `hiddenChars`,
   * for the same reasons that counter is separate from `unexpectedChars`: one diagnostic per word
   * over a hostile or machine-generated file is the quadratic blow-up `A1-01` exists to prevent, and
   * a file with 50 invisible characters must not be the reason a spoofed word goes unreported. */
  private confusableWords = 0;
  /** Where the first tab-indented line was found, and how many more followed (M98c, `A1-12`, D161).
   *
   * The rule used to fire once per *line*, so one wrong editor setting produced 100 identical
   * `TF003`s on a 100-line file — no dedup, no count, no `= help:` line, and (before M98a) 100
   * misaligned carets to go with them. The per-line span buys nothing: every one of those lines has
   * the same cause and the same one-setting fix. Held here and reported once at EOF, because the
   * count belongs in the help line and is not known until the file has been read. */
  private tabIndent: { span: Span; more: number } | null = null;

  constructor(private readonly source: string) {}

  lex(): LexResult {
    const src = this.source;
    let lineStart = 0;
    let lineNo = 1;
    const n = src.length;

    let i = 0;
    while (i <= n) {
      // Find end of this physical line.
      let eol = src.indexOf('\n', i);
      const atEof = eol === -1;
      if (atEof) eol = n;
      // M59 (A1-03): drop a CRLF's `\r` before lexing. Nothing else in the toolchain normalizes
      // line endings, so without this a Windows-authored file produced one `TF001: unexpected
      // character "\r"` per line, each with the caret parked past the end of the visible text.
      // Only the *trailing* `\r` is removed, so every column on the line is unchanged.
      let line = src.slice(lineStart, eol);
      if (line.endsWith('\r')) line = line.slice(0, -1);

      this.processLine(line, lineStart, lineNo);

      if (atEof) break;
      lineStart = eol + 1;
      lineNo += 1;
      i = lineStart;
    }

    // M98b (`A1-10`, D154): anything still on the bracket stack at EOF was never closed. Report the
    // **innermost** one only: while a bracket is open the lexer emits no `newline`/`indent`/`dedent`
    // at all (see `processLine`), so a single stray `{` absorbs every line after it and the outer
    // entries are almost certainly consequences of the same typo — one diagnostic per nesting level
    // would be noise proportional to depth, all of it pointing at the same mistake.
    //
    // The caret used to land on a `dedent` synthesized at EOF: `printf 'test "x"\n  api POST /o body
    // {\n'` reported `TF010: expected a field name, found a dedent` at line 3 of a 2-line file,
    // underlining nothing. The opening bracket is the only position that names the actual mistake.
    const unclosed = this.openBrackets[this.openBrackets.length - 1];
    if (unclosed) {
      const closer = unclosed.value === '{' ? '}' : ']';
      this.diag(Codes.UNBALANCED_BRACKET, 'error', `this \`${unclosed.value}\` is never closed`, unclosed.span, `add the matching \`${closer}\`. While a \`{\` or \`[\` is open, tflw reads the following lines as a continuation of the same step rather than as steps of their own, so everything after this point was absorbed into it.`);
    }

    this.reportTabIndent();

    // Close any open indentation blocks, then EOF.
    const endPos = this.posAt(n, lineStart, lineNo);
    while (this.indentStack.length > 1) {
      this.indentStack.pop();
      this.push('dedent', '', '', { start: endPos, end: endPos });
    }
    this.push('eof', '', '', { start: endPos, end: endPos });

    return { tokens: this.tokens, diagnostics: this.diagnostics };
  }

  // -- per-line handling -----------------------------------------------------

  private processLine(line: string, lineStart: number, lineNo: number): void {
    // Measure leading whitespace / indentation.
    let col = 0;
    let sawTab = false;
    while (col < line.length && (line[col] === ' ' || line[col] === '\t' || line[col] === BOM)) {
      if (line[col] === '\t') sawTab = true;
      col++;
    }
    const firstNonWs = col;

    // M98d: indentation is consumed without producing a token, so nothing downstream will ever look
    // at it again. In practice only a `U+FEFF` can be in here — every other hidden character stops
    // the loop above and falls through to recovery — but scanning the range is what makes that a
    // consequence rather than an assumption.
    this.scanHidden(line, 0, firstNonWs, lineStart, lineNo, 'the indentation');

    // Blank or comment-only lines carry no structure.
    const rest = line.slice(firstNonWs);
    if (rest === '' || rest.startsWith('#')) {
      if (rest !== '') this.scanHidden(line, firstNonWs, line.length, lineStart, lineNo, 'a comment');
      return;
    }

    // M98c (`A1-12`/`A1-13`, D161): recorded, not reported — see `tabIndent` and `reportTabIndent`.
    if (sawTab) {
      if (this.tabIndent) this.tabIndent.more += 1;
      else {
        this.tabIndent = {
          span: {
            start: this.posAt(lineStart, lineStart, lineNo),
            end: this.posAt(lineStart + firstNonWs, lineStart, lineNo),
          },
          more: 0,
        };
      }
    }

    // A line continuing an already-open `{`/`[` from a previous line carries no indentation
    // structure of its own (P#46 gap, found dogfooding restful-booker: a hand-formatted
    // multi-line `body { … }` must be usable, the way Python suppresses NEWLINE inside brackets).
    const continuingBracket = this.openBrackets.length > 0;
    // M98d (`M98d-01`, found by this milestone's own BOM probe and **pre-existing** — measured
    // failing identically on the M98c build). A byte-order mark is skipped as whitespace (M59,
    // `A1-04`), but skipping it still *counted* it, so the first line of any UTF-8-with-BOM file
    // measured one column of indentation and every such file failed to parse at all:
    // `TF016: expected a `test` … found an indented block`, on a file whose first line starts at
    // column 1. Windows editors and PowerShell redirection write that BOM by default. It is
    // subtracted from the indent width only — the column of every token on the line is unchanged.
    const bomCol = lineStart === 0 && line[0] === BOM ? 1 : 0;
    if (!continuingBracket) this.handleIndent(firstNonWs - bomCol, lineStart, lineNo);
    const stop = this.lexContent(line, firstNonWs, lineStart, lineNo); // may open/close brackets

    // Only a logical end-of-line — i.e. we're not left inside an open `{`/`[` — gets a `newline`.
    if (this.openBrackets.length === 0) {
      // M98c (`A1-09`, D159): the `newline` used to sit at `lineStart + line.length`, the *physical*
      // end of the line — which is past a trailing comment. Every "found end of line" caret then
      // landed inside the comment text: `api GET   # TODO fill in the path later` put the caret at
      // column 73 under the word "later", when the missing path belongs at column 11.
      //
      // `lexContent` is the only place that knows where the code stopped (it breaks at `#`, and a
      // `#` inside a string is not a comment, so the offset cannot be recovered by scanning
      // afterwards) — hence its return value. Trailing spaces come off too, for the same reason.
      const eolOffset = lineStart + line.slice(0, stop).replace(/[ \t]+$/, '').length;
      const eolPos = this.posAt(eolOffset, lineStart, lineNo);
      this.push('newline', '', '', { start: eolPos, end: eolPos });
    }
  }

  /**
   * M98c (`A1-12`/`A1-13`, D161): the tab rule gets its own code, a help line, and one diagnostic
   * per file.
   *
   * It used to be emitted as `TF003` — the *same* code as "indentation does not match any enclosing
   * block". Two unrelated conditions with two different fixes under one code makes all four
   * surfaces wrong at once, because `spec-data.ts` is the declared single source of truth for what a
   * code means and it documented only the second: SPEC §17, the docs-site Reference page and LSP
   * hover all described the wrong rule for half of `TF003`'s firings. Widening the manifest row to
   * cover both would have kept one code honest at the cost of a reference entry naming two fixes.
   */
  private reportTabIndent(): void {
    const tab = this.tabIndent;
    if (!tab) return;
    const more =
      tab.more === 0
        ? ''
        : ` ${tab.more} more line${tab.more === 1 ? '' : 's'} in this file ${tab.more === 1 ? 'is' : 'are'} indented with tabs; they are not listed separately because one editor setting fixes all of them.`;
    this.diag(
      Codes.TAB_INDENT,
      'error',
      'tabs are not allowed in indentation; use spaces',
      tab.span,
      `set your editor to insert spaces for \`.tflw\` files — SPEC.md indents two spaces per level.${more}`,
    );
  }

  private handleIndent(indentCol: number, lineStart: number, lineNo: number): void {
    const top = this.indentStack[this.indentStack.length - 1]!;
    const pos = this.posAt(lineStart + indentCol, lineStart, lineNo);
    const span: Span = { start: pos, end: pos };
    if (indentCol > top) {
      this.indentStack.push(indentCol);
      this.push('indent', '', '', span);
    } else if (indentCol < top) {
      while (this.indentStack.length > 1 && this.indentStack[this.indentStack.length - 1]! > indentCol) {
        this.indentStack.pop();
        this.push('dedent', '', '', span);
      }
      if (this.indentStack[this.indentStack.length - 1]! !== indentCol) {
        this.diag(
          Codes.INCONSISTENT_INDENT,
          'error',
          'indentation does not match any enclosing block',
          span,
          'each nested block must line up with its siblings',
        );
        // Recover: treat this level as the current one.
        this.indentStack.push(indentCol);
      }
    }
  }

  // -- inline token scanning -------------------------------------------------

  /** Scans one line's content and returns **the offset it stopped at** — the `#` of a trailing
   * comment, or the end of the line. M98c (`A1-09`, D159): only this method ever sees that boundary,
   * because a `#` inside a string is not a comment and so cannot be found by scanning the line
   * afterwards. `processLine` needs it to place `newline`. */
  private lexContent(line: string, from: number, lineStart: number, lineNo: number): number {
    let c = from;
    const len = line.length;
    const at = (off: number): Position => this.posAt(lineStart + off, lineStart, lineNo);

    while (c < len) {
      const ch = line[c]!;

      if (ch === ' ' || ch === '\t' || ch === BOM) {
        // M98d: a `BOM` between two tokens is skipped as whitespace, which is exactly why it has to
        // be reported here — `let a﻿b = 1` otherwise lexes as two idents and reads as one name.
        if (ch === BOM) this.reportHidden(ch, lineStart + c, lineStart, lineNo, 'the middle of a line');
        c++;
        continue;
      }
      if (ch === '#') {
        // Trailing comment — `c` is where the code ends (D159). The text after it is discarded
        // unexamined, which is half of `A1-17`'s root cause.
        this.scanHidden(line, c, len, lineStart, lineNo, 'a comment');
        return c;
      }

      const startCol = c;
      const startPos = at(startCol);

      // string
      if (ch === '"') {
        c = this.lexString(line, c, lineStart, lineNo);
        continue;
      }

      // path (right after an HTTP method) vs. arithmetic divide (M2, P#25) — see METHOD_WORDS.
      if (ch === '/') {
        if (this.canStartPath()) {
          c++;
          while (c < len && PATH_CHARS.test(line[c]!)) c++;
          const raw = line.slice(startCol, c);
          this.push('path', raw, raw, { start: startPos, end: at(c) });
          // M59 (A1-02): `#` ends the path and starts a comment, so `/items?color=#fff&size=large`
          // used to shrink to `/items?color=` with *no* diagnostic anywhere — `tflw check` said "no
          // problems found", the run said `PASS`, and the request that left the machine was not the
          // one written. A silent wrong request is the one failure a testing tool must never
          // produce, so the collision is now reported at the point it happens.
          if (c < len && line[c] === '#') {
            this.diag(
              Codes.UNEXPECTED_CHAR,
              'error',
              `\`#\` ends the path \`${raw}\` and starts a comment`,
              { start: at(c), end: at(c + 1) },
              'write `%23` for a literal `#`. A URL fragment is never sent to the server, so it cannot be part of a request path.',
            );
          }
        } else {
          c++;
          this.push('slash', '/', '/', { start: startPos, end: at(c) });
        }
        continue;
      }

      // number
      if (isDigit(ch)) {
        c++;
        while (c < len && isDigit(line[c]!)) c++;
        if (c < len && line[c] === '.' && c + 1 < len && isDigit(line[c + 1]!)) {
          c++;
          while (c < len && isDigit(line[c]!)) c++;
        }
        const raw = line.slice(startCol, c);
        this.push('number', raw, raw, { start: startPos, end: at(c) });
        this.checkNumberNotation(line, startCol, c, raw, at);
        continue;
      }

      // tag
      if (ch === '@') {
        c++;
        const nameStart = c;
        while (c < len && isIdentCont(line[c]!)) c++;
        const name = line.slice(nameStart, c);
        const raw = line.slice(startCol, c);
        // M98b (`A1-11`, D156): the push used to be unconditional, so `@` alone produced `tag:""`
        // and `tflw check` reported no problems. A tag that is not a writable name can never be
        // named in a `--tag` expression, so the test carrying it can be neither selected nor
        // excluded — silently. That is the failure class where a filter appears to work and runs the
        // wrong set, which is worse than a filter that errors.
        if (name === '' || !isIdentStart(name[0]!)) {
          // The `@ smoke` case — one stray space — is worth its own help line. Left to the parser it
          // becomes ``expected `test`, found `smoke``` with a caret on `smoke` and no mention of the
          // `@` at all; the lexer is the last layer that can still see the two together.
          const spaced = name === '' && /^[ \t]+[A-Za-z_]/.test(line.slice(c));
          this.diag(
            Codes.EMPTY_TAG,
            'error',
            name === '' ? 'a tag needs a name after the `@`' : `\`@${name}\` is not a usable tag name`,
            { start: startPos, end: at(c) },
            spaced
              ? 'delete the space — a tag is written `@smoke`, with the name attached to the `@`.'
              : 'a tag name starts with a letter or `_` and continues with letters, digits or `_`, so that `--tag` can name it.',
          );
        }
        this.push('tag', name, raw, { start: startPos, end: at(c) });
        continue;
      }

      // identifier / keyword lexeme
      if (isIdentStart(ch)) {
        c++;
        while (c < len && isIdentCont(line[c]!)) c++;
        const raw = line.slice(startCol, c);
        this.push('ident', raw, raw, { start: startPos, end: at(c) });
        continue;
      }

      // punctuation
      const punct = PUNCT[ch];
      if (punct) {
        c++;
        this.push(punct, ch, ch, { start: startPos, end: at(c) });
        continue;
      }

      // Anything else: report and skip (recovery).
      //
      // M98c (`A1-16`, D163). Two changes, both in what is *reported* — recovery still consumes
      // exactly the characters no rule can start with.
      //
      // 1. **By code point, coalesced into a run.** Advancing one UTF-16 code unit at a time made
      //    `let a = 🚀` print two diagnostics naming lone surrogates (`"\ud83d"`, `"\ude80"`) —
      //    mojibake, and neither half is a character the author typed. Advancing one *character* at
      //    a time still made `let 名前 = 1` two errors for one word. A consecutive run is one
      //    mistake and gets one diagnostic spanning it.
      // 2. **Invisible characters are named, not quoted.** `unexpected character " "` for U+00A0 is
      //    a message whose evidence is indistinguishable from a space.
      //
      // Not fixed here, deliberately: the identifier class itself. Accepting non-ASCII identifiers
      // is a grammar change, not a diagnostic one, and `IDENT` is frozen at 1.0.
      // The run is capped, and `A1-01`'s own guard is what found that it had to be: coalescing an
      // unbounded run put the whole of a 50 KB unlexable file inside a single message, which is the
      // quadratic blow-up that guard exists to prevent, re-entering by the other door. Past the cap
      // the next characters simply start another run, so the `MAX_UNEXPECTED_CHARS` ceiling still
      // bounds the total. A mistyped word is far shorter than this.
      const runStart = c;
      let runChars = 0;
      while (c < len && isUnlexable(line[c]!) && runChars < MAX_RUN_CHARS) {
        c += (line.codePointAt(c) ?? 0) > 0xffff ? 2 : 1;
        runChars++;
      }
      const run = line.slice(runStart, c);
      const chars = [...run];
      this.unexpectedChars += 1;
      if (this.unexpectedChars < MAX_UNEXPECTED_CHARS) {
        // A run of ordinary visible characters is quoted whole (`"名前"`), which reads as the one
        // word it is. Once anything invisible is in there the run has to be spelled out per
        // character, since a quoted string containing it shows the reader nothing.
        const anyInvisible = chars.some((ch2) => INVISIBLE.test(ch2));
        const named = anyInvisible ? chars.map(describeChar).join(', ') : JSON.stringify(run);
        // `let café = 1` pushes a valid-looking `ident:"caf"` before reaching here, and that token
        // goes on to the checker, which reports an unknown variable `caf` the author never wrote.
        // Suppressing the token is not the fix — recovery needs it — but the truncation has to be
        // named here, next to the character that caused it, or the two diagnostics read as unrelated.
        const prev = this.lastToken;
        const cutShort =
          prev?.type === 'ident' && prev.span.end.offset === lineStart + runStart && WORDLIKE.test(chars[0]!)
            ? `the name \`${prev.value}\` was cut short here — `
            : '';
        this.diag(
          Codes.UNEXPECTED_CHAR,
          'error',
          chars.length === 1 ? `unexpected character ${named}` : `unexpected characters ${named}`,
          { start: startPos, end: at(c) },
          `${cutShort}outside strings and comments, tflw source is ASCII: a name is a letter or \`_\` followed by letters, digits or \`_\`. Accented or non-Latin text belongs inside a \`"…"\` string.`,
        );
      } else if (this.unexpectedChars === MAX_UNEXPECTED_CHARS) {
        this.diag(
          Codes.UNEXPECTED_CHAR,
          'error',
          `too many unreadable characters — stopping after ${MAX_UNEXPECTED_CHARS}`,
          { start: startPos, end: at(c) },
          'this usually means the file is not tflw source at all (a binary, a minified bundle, or the wrong extension), rather than that it has hundreds of separate typos.',
        );
      }
    }
    return c;
  }

  /**
   * M98b (`A1-18`, D158): teach the numeric notations tflw does not have, at the number itself.
   *
   * `1e3` lexes as `number:"1"` + `ident:"e3"` and reached the author as ``TF010: unexpected `e3` at
   * end of step`` / `= help: expected end of line`. Diagnosed, so never silent — but this is the case
   * where the lexed reading (`1`) and the intended reading (`1000`) differ by 1000×, and the help
   * line pointed at the end of the line rather than at the number.
   *
   * **Deliberately narrow, and this is the whole design.** The obvious rule — "a `number` directly
   * followed by an ident-start character" — is wrong here, because that is exactly how every
   * *duration* in the language lexes: `pause 30s`, `timeout step 10s`, `expect duration is less than
   * 500ms` are all `number` + adjacent `ident`, and all legal. So the check fires only on the five
   * shapes that are unambiguously a foreign numeric notation and can never be a duration unit.
   *
   * **Recovery is unchanged**: the tokens are still `number` + `ident`, the parser behaves exactly as
   * before, and no golden moves except by gaining a better message. The code is `TF001` rather than a
   * fourth new one — this is "the lexer cannot read this" with a specific known cause, and §17's row
   * carries the cause.
   *
   * `.5` is **not** covered: `dot` + `number` is a legal pair in a path and in a field access, and
   * the lexer cannot tell `let a = .5` from a fragment of one without parser context.
   */
  private checkNumberNotation(line: string, startCol: number, numEnd: number, raw: string, at: (off: number) => Position): void {
    const len = line.length;
    let end = numEnd;
    while (end < len && (isIdentCont(line[end]!) || line[end] === '_')) end++;
    // An exponent's sign is not an ident character, so `1e-3` needs one extra look.
    if (end === numEnd + 1 && /[eE]/.test(line[numEnd] ?? '') && /[+-]/.test(line[end] ?? '')) {
      let signed = end + 1;
      while (signed < len && isDigit(line[signed]!)) signed++;
      if (signed > end + 1) end = signed;
    }
    if (end === numEnd) return;
    const suffix = line.slice(numEnd, end);

    let message: string | undefined;
    let value: number | undefined;
    if (/^[eE][+-]?\d+$/.test(suffix)) {
      message = 'exponent notation is not supported';
      value = Number(raw + suffix);
    } else if (raw === '0' && /^[xX][0-9a-fA-F]+$/.test(suffix)) {
      message = 'hexadecimal literals are not supported';
      value = Number('0' + suffix);
    } else if (raw === '0' && /^[bB][01]+$/.test(suffix)) {
      message = 'binary literals are not supported';
      value = Number('0' + suffix);
    } else if (raw === '0' && /^[oO][0-7]+$/.test(suffix)) {
      message = 'octal literals are not supported';
      value = Number('0' + suffix);
    } else if (/^_[\d_]*\d$/.test(suffix)) {
      message = 'digit separators are not supported';
      value = Number((raw + suffix).replace(/_/g, ''));
    }
    if (message === undefined) return;

    const written = value !== undefined && Number.isFinite(value) ? `write the value out: \`${value}\`.` : 'write the value out in plain decimal digits.';
    this.diag(Codes.UNEXPECTED_CHAR, 'error', `${message} — this reads as \`${raw}\` followed by the name \`${suffix}\``, { start: at(startCol), end: at(end) }, `tflw numbers are plain decimal digits with an optional \`.\` fraction; ${written}`);
  }

  /** Lex a double-quoted string starting at `line[c] === '"'`. Returns the index past the string. */
  private lexString(line: string, c: number, lineStart: number, lineNo: number): number {
    const at = (off: number): Position => this.posAt(lineStart + off, lineStart, lineNo);
    const startCol = c;
    const startPos = at(startCol);
    const len = line.length;
    c++; // opening quote
    let value = '';
    let terminated = false;
    while (c < len) {
      const ch = line[c]!;
      if (ch === '"') {
        c++;
        terminated = true;
        break;
      }
      if (ch === '\\' && c + 1 < len) {
        const next = line[c + 1]!;
        // M98d (D166): the braced form is not in `ESCAPES` because it is the only escape that takes
        // an argument, so it is dispatched before the table lookup.
        if (next === 'u') {
          const u = this.lexUnicodeEscape(line, c, at);
          value += u.text;
          c = u.next;
          continue;
        }
        const decoded = ESCAPES[next];
        if (decoded === undefined) {
          this.diag(
            Codes.UNKNOWN_ESCAPE,
            'error',
            `unknown escape \`\\${next}\` in a string`,
            { start: at(c), end: at(c + 2) },
            `tflw strings support ${ESCAPE_LIST}. To put a backslash in the string itself — a regular expression, a Windows path — write it twice: \`matches "^\\\\d+$"\` hands the pattern \`^\\d+$\` to the engine.`,
          );
        }
        // Recovery is deliberately unchanged (the old `?? next`, i.e. drop the backslash). The value
        // is now attached to an *error*, so nothing runs with it; keeping the old behaviour means
        // this milestone changes exactly one thing — whether the fact is reported — and every token
        // golden stays put.
        value += decoded ?? next;
        c += 2;
        continue;
      }
      // M98d (`A1-17`): string content was copied verbatim, which is the other half of the root
      // cause. Scanned on the *raw* text, so a character written as `\u{200B}` — decoded above and
      // never seen here — stays legal. That is the whole point of D166: the rule has an alternative.
      this.reportHidden(ch, lineStart + c, lineStart, lineNo, 'a string');
      value += ch;
      c++;
    }
    const raw = line.slice(startCol, c);
    // M103 (`M98d-02`): on `raw`, not on `value` — that is what makes `\u{0430}` the escape hatch,
    // since the escape's own text is all-Latin. Scanned once over the finished string rather than
    // per character like `TF049`, because the unit here is a word and a word spans characters.
    this.scanConfusable(raw, startCol, lineStart, lineNo);
    const span: Span = { start: startPos, end: at(c) };
    if (!terminated) {
      this.diag(Codes.UNTERMINATED_STRING, 'error', 'string literal is missing a closing quote', span);
    }
    this.push('string', value, raw, span);
    return c;
  }

  /**
   * M98d (D166): `\u{XXXX}`, the escape hatch `TF049` requires in order to be a lint at all.
   *
   * The dependency is worth stating, because it is the reason this ships in the same milestone as
   * the rule and not later. D157 (M98b) closed the escape set: an escape outside the table is an
   * error. tflw had no `\u`. So the moment `TF049` rejects a literal zero-width character, there is
   * **no way whatever** to put one in a `.tflw` string — and a rule with no legal alternative is not
   * a lint, it is a capability being removed.
   *
   * Braced only. `\uXXXX` cannot express a character above U+FFFF except as a surrogate pair, which
   * is an encoding detail leaking into a surface the author is supposed to read; `\u{1F600}` is one
   * character written as one escape. `A1-05` measured users already reaching for the sequence —
   * `"é"` was found producing `u00e9`, which is somebody having typed it and had the backslash eaten.
   *
   * Every failure here is `TF047`. That is a widening of one code rather than a second one, and the
   * distinction from `TF003`'s split (M98c, D161) is the *fix*: `TF003` carried two conditions whose
   * corrections were unrelated (re-indent a block vs. change an editor setting), while every case
   * below is "the escape is not spelled the way tflw spells it", correctable by reading one row.
   */
  private lexUnicodeEscape(line: string, c: number, at: (off: number) => Position): { text: string; next: number } {
    const len = line.length;
    // Recovery contributes **nothing**, which is a deliberate departure from the unknown-escape
    // recovery next door (D157: drop the backslash, keep the letter). That rule is safe only because
    // every escape it covers is a single character; `\u{…}` is the one whose text contains braces,
    // and braces are interpolation syntax. Keeping it verbatim made `"\u{ZZ}"` recover to `u{ZZ}`
    // and produce a second, unrelated `TF030: unknown variable "ZZ"` — the checker reporting a name
    // the author never wrote, which is the follow-on-noise class M98c spent `A1-16` removing.
    const bad = (message: string, end: number, hint: string): { text: string; next: number } => {
      this.diag(Codes.UNKNOWN_ESCAPE, 'error', message, { start: at(c), end: at(end) }, hint);
      return { text: '', next: end };
    };
    const spelling = 'a `\\u` escape is written `\\u{...}` with the braces, holding hexadecimal digits up to `\\u{10FFFF}`.';

    if (line[c + 2] !== '{') {
      // The case JS, Java and C# authors' fingers produce. Worth its own sentence: the fix is
      // mechanical and the reader is otherwise left comparing two nearly identical spellings.
      const four = /^[0-9A-Fa-f]{4}/.exec(line.slice(c + 2))?.[0];
      return bad('the `\\u` escape needs braces', c + 2 + (four?.length ?? 0), four ? `write \`\\u{${four}}\`. tflw has only the braced form, because it is the one that can also write a character above U+FFFF.` : spelling);
    }
    let e = c + 3;
    while (e < len && /[0-9A-Fa-f]/.test(line[e]!)) e++;
    const digits = line.slice(c + 3, e);
    if (line[e] !== '}') return bad(digits === '' ? 'this `\\u{` is not closed' : `\`\\u{${digits}\` is not closed`, e, spelling);
    const end = e + 1;
    if (digits === '') return bad('`\\u{}` has no code point in it', end, spelling);
    const cp = parseInt(digits, 16);
    if (cp > 0x10ffff) return bad(`\`\\u{${digits}}\` is above the highest code point`, end, 'the largest character is `\\u{10FFFF}`.');
    if (cp >= 0xd800 && cp <= 0xdfff) {
      return bad(`\`\\u{${digits}}\` is half of a surrogate pair, not a character`, end, 'surrogates only exist inside UTF-16 encoding. Write the character itself — an emoji is a single `\\u{1F600}`, not two halves.');
    }
    return { text: String.fromCodePoint(cp), next: end };
  }

  /**
   * M98d (`A1-17`, D165): report a Trojan Source character.
   *
   * **Called only from the paths that consume a character without turning it into a token** —
   * indentation, inter-token whitespace, a comment, and the inside of a string. That is the whole
   * placement rule, and it is deliberate rather than partial coverage. Everywhere else these
   * characters are *already* rejected: none of them can start a token, so `isUnlexable` sends them
   * to recovery, and `let a​ = 1`, `api GET /hea​lth` and `@sm​oke` were all measured
   * reporting `TF001: unexpected character U+200B ZERO WIDTH SPACE` before this milestone existed.
   * A whole-source pre-pass would have reported those a second time, which is the rule M98c had just
   * finished establishing (D161, D163: one mistake, one diagnostic).
   *
   * The invariant is therefore split across two mechanisms, and a split invariant is how a hole
   * reopens — so it is pinned by a test that asserts the *property* (no file containing one of these
   * characters checks clean, in any position) rather than either mechanism.
   *
   * `U+FEFF` is the one that could not have been left to the other half: it is explicitly *not*
   * unlexable, being skipped as whitespace since M59.
   */
  private reportHidden(ch: string, offset: number, lineStart: number, lineNo: number, where: string): void {
    const kind = HIDDEN[ch];
    // Offset 0 is a real byte-order mark, and stays legal — the carve-out that keeps `A1-04` fixed.
    if (kind === undefined || (kind === 'bom' && offset === 0)) return;
    this.hiddenChars += 1;
    if (this.hiddenChars > MAX_UNEXPECTED_CHARS) return;
    const span = { start: this.posAt(offset, lineStart, lineNo), end: this.posAt(offset + ch.length, lineStart, lineNo) };
    if (this.hiddenChars === MAX_UNEXPECTED_CHARS) {
      this.diag(Codes.HIDDEN_CHAR, 'error', `too many hidden characters — stopping after ${MAX_UNEXPECTED_CHARS}`, span, 'a file with this many is not a stray paste; treat the whole file as untrusted rather than fixing them one at a time.');
      return;
    }
    const cp = ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
    this.diag(
      Codes.HIDDEN_CHAR,
      'error',
      `hidden character U+${cp} ${INVISIBLE_NAMES[ch] ?? ''}`.trimEnd() + ` in ${where}`,
      span,
      // D166: naming the escape is not politeness, it is what makes this a lint rather than a
      // removed capability. Without `\u{…}` there would be no way at all to put one of these
      // characters in a string, since D157 made every unknown escape an error.
      `${HIDDEN_HELP[kind]}. Delete it — or, where the value genuinely needs the character, write it inside a string as \`\\u{${cp}}\`, which says so in plain sight.`,
    );
  }

  /**
   * M103 (`M98d-02`, D178-D180): report a word that mixes Latin with a script that has Latin
   * lookalikes.
   *
   * **Scanned on the raw text, and that is the escape hatch** — `"\u{0430}dmin"` reads here as the
   * ASCII characters `\u{0430}dmin`, whose words are all-Latin, so a value that genuinely needs the
   * character can still be written. Same mechanism `TF049` uses (D166), for the same reason: a rule
   * with no way to comply is a capability removed, not a lint.
   *
   * **Strings only** (D180). `TF049` also fires in comments; this does not, because a comment has no
   * escape hatch, and because the harm is different in kind — a bidi control reorders the glyphs of
   * the text *after* it, so it can make a following line display as an assertion that is not the one
   * being run, whereas a confusable letter in a comment misspells a comment.
   *
   * What this does **not** catch: a word written entirely in one non-Latin script that still reads
   * as Latin (`"аԁmіn"` in all Cyrillic). That needs the UTS #39 confusables table, and by shape it
   * is indistinguishable from legitimate Russian data. Recorded in the SPEC rather than left
   * implied, so the guarantee is not read as wider than it is.
   */
  private scanConfusable(raw: string, rawStart: number, lineStart: number, lineNo: number): void {
    for (const m of raw.matchAll(WORD_RUN)) {
      const word = m[0];
      // No Latin in the word at all means the word is not pretending to be Latin — `"привет"` and
      // `"東京"` are data, not disguises. This clause is what keeps the rule off multilingual text.
      if (!HAS_LATIN.test(word)) continue;
      const script = LOOKALIKE_SCRIPTS.find(([, re]) => re.test(word))?.[0];
      if (script === undefined) continue;
      this.confusableWords += 1;
      if (this.confusableWords > MAX_UNEXPECTED_CHARS) return;
      const from = rawStart + m.index;
      const span = { start: this.posAt(lineStart + from, lineStart, lineNo), end: this.posAt(lineStart + from + word.length, lineStart, lineNo) };
      if (this.confusableWords === MAX_UNEXPECTED_CHARS) {
        this.diag(Codes.CONFUSABLE_WORD, 'error', `too many mixed-script words — stopping after ${MAX_UNEXPECTED_CHARS}`, span, 'a file with this many is not a stray paste; treat the whole file as untrusted rather than fixing them one at a time.');
        return;
      }
      // Name the offending characters by code point, not by quoting them. Quoting would print two
      // spellings that look identical — the problem restated rather than the evidence the reader
      // needs. `U+0430` is the only unambiguous way to say which letter is not what it seems, and it
      // doubles as the text of the `\u{…}` that makes the word legal if it was deliberate.
      const re = LOOKALIKE_SCRIPTS.find(([n]) => n === script)![1];
      const points = [...new Set([...word].filter((ch) => re.test(ch)).map((ch) => ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')))];
      this.diag(
        Codes.CONFUSABLE_WORD,
        'error',
        `the word \`${word}\` mixes Latin with ${script} — ${points.map((p) => `U+${p}`).join(', ')}`,
        span,
        `${script} letters with Latin lookalikes render exactly like the all-Latin spelling and compare unequal to it, so the two are indistinguishable on screen and in a diff. In a \`not equals\`/\`not contains\` assertion that means the check passes without asserting anything. Retype the word in one script — or, where the value genuinely needs the character, write it as \`\\u{${points[0]}}\`, which says so in plain sight.`,
      );
    }
  }

  /** `reportHidden` over a half-open range of one line. */
  private scanHidden(line: string, from: number, to: number, lineStart: number, lineNo: number, where: string): void {
    for (let i = from; i < to; i++) {
      if (HIDDEN[line[i]!] !== undefined) this.reportHidden(line[i]!, lineStart + i, lineStart, lineNo, where);
    }
  }

  // -- helpers ---------------------------------------------------------------

  private posAt(offset: number, lineStart: number, lineNo: number): Position {
    return { offset, line: lineNo, column: offset - lineStart + 1 };
  }

  private canStartPath(): boolean {
    const t = this.lastToken;
    if (!t || t.type !== 'ident' || !METHOD_WORDS.has(t.value.toUpperCase())) return false;
    // `t` must actually sit in HTTP-method position — right after the `api` keyword, optionally
    // with a named service in between (`api billing GET …`, `wait until api GET …`) — not just any
    // ident whose text happens to read like a method word (decision 60: `let ratio = get / 2` must
    // lex `/` as divide, not mistake a variable named `get` for `api GET`).
    const n = this.tokens.length;
    const prev = n >= 2 ? this.tokens[n - 2]! : null;
    if (prev && prev.type === 'ident' && prev.value === 'api') return true;
    const prevPrev = n >= 3 ? this.tokens[n - 3]! : null;
    return !!(prev && prev.type === 'ident' && prevPrev && prevPrev.type === 'ident' && prevPrev.value === 'api');
  }

  private push(type: TokenType, value: string, raw: string, span: Span): void {
    const tok: Token = { type, value, raw, span };
    this.tokens.push(tok);
    this.lastToken = tok;
    if (type === 'lbrace' || type === 'lbracket') {
      this.openBrackets.push(tok);
    } else if (type === 'rbrace' || type === 'rbracket') {
      // M98b (`A1-20`): a closer at depth 0 used to be clamped out of the accounting and reported
      // nowhere. It is the same fact as an unclosed opener — bracket accounting does not balance —
      // seen from the other side, so it carries the same code (D155) rather than a second manifest
      // row saying the same thing about a case the parser also catches downstream.
      if (this.openBrackets.length > 0) this.openBrackets.pop();
      else {
        this.diag(
          Codes.UNBALANCED_BRACKET,
          'error',
          `\`${value}\` closes a bracket that was never opened`,
          span,
          `every \`${value}\` needs a matching \`${value === '}' ? '{' : '['}\` before it — either delete this one or add the opener it was meant to close.`,
        );
      }
    }
  }

  private diag(code: string, severity: 'error' | 'warning', message: string, span: Span, hint?: string): void {
    this.diagnostics.push({ code, severity, message, span, ...(hint ? { hint } : {}) });
  }
}

const PUNCT: Record<string, TokenType | undefined> = {
  '{': 'lbrace',
  '}': 'rbrace',
  '[': 'lbracket',
  ']': 'rbracket',
  '(': 'lparen',
  ')': 'rparen',
  ':': 'colon',
  ',': 'comma',
  '.': 'dot',
  '=': 'equals',
  '+': 'plus',
  '-': 'minus',
  '*': 'star',
  '|': 'pipe',
  '%': 'percent',
};

/** The complete set of string escapes. M98b (`A1-05`, D157): an escape *outside* this table is an
 * error (`TF047`), not a silently deleted backslash — `"^\d+$"` used to decode to `^d+$` and run
 * against a pattern nobody wrote.
 *
 * The alternative worth naming, because it is the tempting one: *preserve* the backslash, so `"\d"`
 * means `\d` and regexes just work. It is the one option that cannot be revised. Under it the
 * meaning of `"\q"` depends on whether `q` is in this table, so every escape added here later would
 * silently change the value of existing suites — while an error becoming legal is additive, which is
 * the only direction a frozen 1.0 surface can move. Erroring also matches JS, Java and non-raw
 * Python, which is what a `.tflw` author's fingers already know. */
const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '"': '"',
  '\\': '\\',
};

/** The supported escapes, rendered for `TF047`'s help line. Derived from `ESCAPES` rather than typed
 * out, so a sixth escape cannot ship with a help line that denies it exists — which is exactly the
 * drift GRAMMAR.md had already accumulated, listing four of these five. */
const ESCAPE_LIST = [...Object.keys(ESCAPES).map((k) => `\`\\${k}\``), '`\\u{…}`']
  .join(', ')
  .replace(/, ([^,]*)$/, ' and $1');

export function lex(source: string): LexResult {
  return new Lexer(source).lex();
}
