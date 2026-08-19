// LSP semantic tokens (post-M13 follow-up, PLAN.md decision 105): closes a coloring gap the static
// `syntaxes/tflw.tmLanguage.json` grammar structurally can't — matcher/operator words and numeric
// literals ARE tagged correctly by that grammar, but VS Code's own default theme defines no color
// rule for their scopes (`keyword.operator`/`constant.numeric`), so they render unstyled; and
// object-literal field keys / variable / parameter names can never be grammar-colored at all since
// they're arbitrary user-chosen text, not fixed vocabulary. Semantic tokens sidestep both: VS Code
// colors them from its own rich built-in default palette, independent of the active theme.
//
// Two independent passes, merged and sorted by start offset at the end (`SemanticTokensBuilder`
// requires strictly ascending push order):
//
//   1. AST-derived, from the already-computed `SymbolTable` — zero new AST walking. Covers
//      variable/parameter/action names in both bare and string/path-interpolation position for
//      free, since `collectSymbols`'s spans are already precise there.
//   2. Lexer-driven — a single flat lex of the whole document, classifying `ident`/`number` tokens
//      by wordlist membership (mirroring tflw.tmLanguage.json's own keyword lists — same
//      independent-copy tradeoff already accepted for that file, since `parser.ts` doesn't
//      centralize most of these into exported arrays) plus an exact (not heuristic) colon-lookahead
//      for object-literal field keys, reusing the same lookahead `parser.ts`'s own object-field
//      parsing uses (`colon` has no other role in this grammar).

import { lex } from './lexer.js';
import type { Span } from './token.js';
import type { SymbolKind, SymbolTable } from './symbols.js';

export type SemanticTokenType = 'keyword' | 'operator' | 'type' | 'function' | 'number' | 'variable' | 'parameter' | 'property';

/** Which of tflw's two grammars a buffer is written in (`M136b`, D427/D427a). `parseSource` and
 * `parseConfigSource` have always been separate entry points; this is the same distinction reaching
 * the colouring pass, which until now had one flat wordlist serving both and therefore could serve
 * neither correctly. Deliberately a *required* parameter on `collectSemanticTokens` rather than one
 * defaulting to `'test'`: there is exactly one call site today, and a default is how a future second
 * caller silently gets the wrong dialect's vocabulary with nothing going red. */
export type Dialect = 'test' | 'config';

export interface SemanticToken {
  readonly span: Span;
  readonly type: SemanticTokenType;
}

/** Statement keywords + HTTP methods (tflw.tmLanguage.json's `keywords-statement` + `http-request`),
 * plus the M3a-M3e browser-step keywords (M4a catch-up — parser.ts's `STATEMENT_KEYWORDS` plus the
 * handful of non-leading sub-clause words those steps' grammars also use: `on`/`to`/`onto`/`dialog`/
 * `new`/`tab`/`frame`/`respond`), M4b's `mask <locator>` clause keyword, M28's `log` (PLAN_LOG_LSP.md
 * — M27 added `log` to `STATEMENT_KEYWORDS` but never caught this independent copy up), and the
 * M29-M32 load-testing leading keywords (M33 catch-up — `ramp`/`over`/`threshold`/`cleanup`/
 * `pause` (`think` until FS-05); it was already in parser.ts's `STATEMENT_KEYWORDS` since M29 but never caught up
 * here either). M50 (D93) removed `scenario` itself — every load-testing keyword now lives
 * inside an ordinary `test` body, so there's no separate leading keyword to list here for it.
 * Phase 2b (D105-D107) added `parallel`/`sequential` as an optional header modifier on `test`,
 * same slot as `retry N` — legal on any test, not just workload-bearing ones.
 *
 * M133 (D24b catch-up) adds the pentest arc's **config-dialect** vocabulary: `authorized`/`target`/
 * `reason` and the indented `probe mutating` sub-clause (`M128b`/`M130b`, D291/D311), plus
 * `privileged` — the `session` header modifier (D307/D310) that sits in the same slot as `oauth2`.
 * This pass serves `tflw.config` buffers as well as `.tflw` ones (`server.ts` hands it whatever the
 * store analyzed), which is why config keywords belong in this list at all.
 *
 * `M136b` (D427) makes that last sentence structural instead of incidental. This set is now the
 * **shared** vocabulary only; the config dialect's own words live in `CONFIG_KEYWORDS` below and are
 * consulted only for a config buffer. `M133`'s six stay here rather than moving: `probe`/`mutating`
 * are also `.tflw` step vocabulary, and `authorized`/`target`/`reason`/`privileged` were added here
 * as shared and moving them now would be a colouring change to test files under a milestone that is
 * about config files. Being in both is harmless — a word in the shared set is a keyword in both
 * dialects, which is exactly what these are.
 *
 * `M137a` (`D384`'s residue) adds `oversized`/`traversal`, `probe`'s two other sub-clauses
 * (`parser.ts`'s `PROBE_SUB_CLAUSES`, D372). `M134a` shipped them and caught up
 * `tflw.tmLanguage.json` alone, whose own comment then claimed the catch-up complete — true of that
 * file and of no other. That is `B5-09` for the fourth arc running, and the three guard tests added
 * alongside this line are the first thing in the repo that would have failed on the gap; the
 * standing fix, one guard holding all three wordlists to the parser's own arrays, is `M136b-01`. */
const KEYWORDS = new Set([
  'test', 'action', 'before', 'after', 'session', 'import', 'use', 'api', 'expect', 'check', 'let', 'capture',
  'log', 'wait', 'until', 'give', 'require', 'env', 'default', 'defaults', 'workers', 'report', 'timeout', 'retry',
  'with', 'each', 'from', 'as', 'without', 'redirects', 'upload', 'form', 'header', 'body', 'type',
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS',
  'open', 'click', 'double', 'right', 'fill', 'select', 'tick', 'untick', 'uncheck', 'press', 'hover', 'scroll', 'within',
  'accept', 'dismiss', 'switch', 'close', 'download', 'drag', 'drop', 'screenshot', 'stub',
  'on', 'to', 'onto', 'dialog', 'new', 'tab', 'frame', 'respond', 'mask',
  'ramp', 'over', 'threshold', 'cleanup', 'pause',
  'hold', 'step', 'spike', 'run', 'iterations', 'per', 'user', 'across', 'for',
  'parallel', 'sequential', 'exclude',
  // M137c (D432/D450) — the crawl's four words. `exclude` is already above it, added by D127 for the
  // config dialect and shared here because a crawl means the same verb over a different set (D466).
  // All four are test-dialect and unambiguous in it: `crawl`/`seed` are leading keywords, `openapi`
  // and `traffic` only ever follow `seed`. That is the test D427a applies — unlike `send` or `up`,
  // none of them is a plausible ordinary identifier in a `.tflw` file.
  //
  // M137f (D442) adds `spider` and passes the same test for the same reason: it only ever follows
  // `seed`. **Its two sub-clause bounds are deliberately NOT here** — `max pages 200` / `max depth 3`
  // would put `max`, `pages` and `depth` into a flat list that colours every occurrence anywhere, and
  // all three are entirely plausible identifiers in a `.tflw` file (`capture body.pages as pages` is
  // ordinary). D427a's test is about the word, not about the position the parser accepts it in, and
  // this list has no way to say "only after `max`". So the bounds render as plain identifiers on
  // purpose: an uncoloured keyword is a cosmetic gap, a wrongly-coloured identifier is `M133-01`.
  'crawl', 'seed', 'openapi', 'traffic', 'spider',
  'authorized', 'target', 'reason', 'probe', 'mutating', 'oversized', 'traversal', 'ciphers', 'privileged',
]);

/** Keywords the **config dialect alone** uses (`M136b`, D427/D427a) — added to `KEYWORDS` only when
 * colouring a `tflw.config` buffer. This is the half of `M133-01` that could not be fixed by adding
 * words to one flat list: `key`, `web` and `destination` are ordinary identifiers in a `.tflw` file,
 * and painting them as keywords everywhere would be a worse defect than leaving them uncoloured in
 * the one dialect that means them.
 *
 * **Eighteen words, not the row's nine.** `M133-01` enumerated `allow`/`hosts`/`insecure`/
 * `evidence`/`web`/`cert`/`key`/`oauth2`/`destination` and prescribed its own fix as *"measure which
 * of the nine the parser actually treats as keywords"*. Asking that question of every word
 * `parser.ts` puts in keyword position — rather than of the nine — turned up nine more in the same
 * dialect: the `oauth2` session block's `token`/`client`/`id`/`secret`/`scope` (P#20/31/42),
 * `redact` and `viewport` (both sitting in `CONFIG_KEYS` beside the five the row did list), and
 * `log`'s `level`/`destination` sub-clauses plus `redact`'s `header`/`query` roots. Every entry here
 * is reachable from `parser.ts:1211-1828`, between the `-- config dialect --` marker at `:1129` and
 * `-- tests --` at `:1989`.
 *
 * **The test dialect has four gaps of its own** — `honoring`, `up`, `method`, `schema` — which are
 * deliberately *not* fixed here (`M136b-01`). They belong in the shared set, so adding them changes
 * colouring in every existing `.tflw` file, and `up`/`method` are plausible ordinary identifiers;
 * that is a different risk from this one and wants its own measurement rather than a ride on a
 * milestone whose charter is the config dialect. */
const CONFIG_KEYWORDS = new Set([
  'web', 'insecure', 'cert', 'key', 'allow', 'hosts', 'evidence', 'redact', 'viewport',
  'oauth2', 'token', 'client', 'id', 'secret', 'scope',
  'destination', 'level', 'query',
  // M137b (D433) — `csrf from <subject> send as header "<name>"`. Both words belong *here* rather
  // than in the shared list above, by D427a's own test: they are reachable only from the config
  // dialect's session-block production, and `send` in particular is a plausible ordinary identifier
  // in a `.tflw` file, which is the exact risk that kept `up`/`method` out of the shared set.
  'csrf', 'send',
]);

/** Matcher/comparison words (tflw.tmLanguage.json's `keywords-matcher`), plus the M3d/M3e words
 * `was`/`made` (`was made`) and `no`/`a11y`/`violations`/the severity floor words (`has no
 * [<severity>] a11y violations`, M4a catch-up), M4b's `snapshot` (`matches snapshot "<name>"`), and
 * M29's threshold comparator words `greater`/`less`/`than`/`is` — already present here from the
 * expect-matcher vocabulary, load thresholds just reuse the same words (M33 catch-up: nothing new
 * to add, confirmed by audit). M133 adds `authorization` (`has no [<severity>] authorization
 * violations`, M130b/D304) — `security` (M128b) was already here, so the arc had shipped one of its
 * two scans into this list and not the other; `violations` and all four severity words were already
 * shared with a11y and needed nothing. */
const OPERATORS = new Set([
  'equals', 'contains', 'matches', 'subset', 'file', 'has', 'is', 'not', 'count', 'value', 'greater', 'less', 'than',
  'visible', 'hidden', 'enabled', 'disabled', 'checked', 'any', 'all', 'connects', 'fails', 'matching',
  // M134a adds `input`/`handling` — the third scan's two words (`has no [<severity>] input handling
  // violations`, D366). Caught up **in the milestone that ships the grammar**, which is the whole
  // point: `M133` found this list and `tflw.tmLanguage.json` both missing `authorization` four
  // milestones after `M130b` shipped it, because a wordlist is the one consumer nothing fails
  // without.
  'was', 'made', 'no', 'a11y', 'security', 'authorization', 'input', 'handling', 'violations', 'minor', 'moderate', 'serious', 'critical', 'snapshot',
]);

/** Subject words (tflw.tmLanguage.json's `keywords-subject`), plus the M3a/M3e locator-noun and
 * `page` subjects (M4a catch-up — parser.ts's `LOCATOR_KEYWORDS` plus `page`), and the M29 load-
 * testing metric/target nouns `users`/`rps` (`ramp to N users|rps over …`) and `error`/`rate`
 * (`threshold error rate is …`) — M33 catch-up, same "noun the value is measured in/against" role
 * `duration`/`status` already play here. */
const TYPES = new Set(['status', 'duration', 'text', 'bytes', 'csv', 'pdf', 'request', 'button', 'field', 'list', 'css', 'xpath', 'page', 'response', 'users', 'rps', 'error', 'rate']);

/** `p50`/`p90`/`p95`/`p99`/… (M29 `threshold p95 duration is less than 800ms`, D24a) — a dynamic
 * ident, not fixed vocabulary (parser.ts's `parseThresholdDecl` accepts any `/^p([1-9][0-9]?)$/`),
 * so it can't join `TYPES` as a literal wordlist entry; checked separately below (M33 catch-up). */
const PERCENTILE_RE = /^p([1-9][0-9]?)$/;

/** Generator words (tflw.tmLanguage.json's `keywords-generator`). */
const FUNCTIONS = new Set([
  'unique', 'random', 'like', 'of', 'number', 'decimal', 'date', 'in', 'past', 'future', 'between', 'and',
  'string', 'email', 'today', 'now', 'format', 'uuid', 'password', 'base64', 'hex', 'url', 'encode', 'decode',
]);

/** Duration unit suffixes the lexer splits off a number — `parser.ts`'s `DURATION_UNITS`, and
 * nothing beyond it. A fourth entry `h` sat here until `M142` (`B5-10`): `parser.ts:443` explains
 * the hour/day/week family is *deliberately* absent, so `timeout step 5h` is `TF023` — and this
 * list rendered it as a finished duration literal on the way to that error. Under-colouring is
 * cosmetic (`D442`); over-colouring is the editor asserting something false about the language,
 * which is why this direction of drift is the one that always fixes. */
const DURATION_UNITS = new Set(['ms', 's', 'm']);

/**
 * The other half of the answer to "does this pass colour every word the language has?" — `M142`
 * (`D551`), and the reason `packages/lang/test/vocabulary.test.ts` can assert completeness at all.
 *
 * That test walks `parser.ts`'s AST and collects every word the parser recognises, through all three
 * of its recognition mechanisms. Held against the sets above, a residue is left over, and the
 * residue is NOT one thing — it is a handful of quite different situations that a bare count cannot
 * tell apart, which is how four separate milestones (`M4a`, `M33`, `M133`, `M136b`) each caught up a
 * different subset and each believed it had finished. So every word in the residue is named here
 * with the reason it is there, and the assertion is that **nothing is unclassified**: a word that is
 * neither coloured nor listed below fails the build and has to be thought about once.
 *
 * The reasons are not new. They were already in this file, as prose, in the comment bodies of the
 * sets above; this makes them machine-readable without moving them out of the argument they belong
 * to. Same manoeuvre as `M138`, where the gate set lived in five prose places and `ci.yml` was made
 * the authority.
 *
 * Two maps rather than one, because the two situations fail differently. A word in
 * `DELIBERATELY_UNCOLOURED` is one the editor *could* paint and must not; a word in
 * `REFUSED_ON_PURPOSE` is one the language does not have, which the parser knows only in order to
 * say so.
 */

/**
 * Real vocabulary this pass declines to colour, and strings the extraction finds that were never
 * words at all. Both belong here for the same reason — the editor leaves them alone on purpose —
 * and each entry says which it is.
 *
 * The first three are `D442`'s, argued at length in `KEYWORDS` above: a flat `Set` colours every
 * occurrence anywhere and has no way to say "only after `max`", and under-colouring a keyword is a
 * cosmetic gap where wrongly colouring an identifier is `M133-01`. The rest are strings that live in
 * `parser.ts` arrays without being words a user types, and they are listed rather than filtered out
 * of the extraction on purpose: a filter is a judgement inside a scrape, and every one of the seven
 * earlier scrapes failed by exercising judgement it turned out not to have.
 */
export const DELIBERATELY_UNCOLOURED: ReadonlyMap<string, string> = new Map([
  ['max', "D442 — `max pages`/`max depth` are position-dependent, and `max` alone is an ordinary identifier"],
  ['pages', 'D442 — plausible as an identifier: `capture body.pages as pages` is ordinary tflw'],
  ['depth', 'D442 — same, and this list cannot say "only after `max`"'],
  ['non', 'not a word: a NEGATION_PREFIXES morpheme, used to decompose a mis-typed `nonvisible`'],
  ['un', 'not a word: same — the morpheme behind `unchecked`, never a token on its own'],
  ['im', 'not a word: same'],
  ['dis', 'not a word: same'],
  ['Retry-After', 'not a keyword: a header NAME the parser validates against, written as a string'],
  // `M142` commit 4, and the plan's `D552` REVERSED BY MEASUREMENT. These nine are the enumerated
  // values of `evidence`, `log level` and `log destination`, and `D552` decided to colour them by
  // adding them to `CONFIG_KEYWORDS`. They cannot be reached that way: every one is written as a
  // STRING — `parseEvidenceDecl` and `parseLogConfigDecl` both call `expectString` — so the lexer
  // hands this pass one `string` token and `CONFIG_KEYWORDS`, which is consulted against `ident`
  // tokens, would never see them. Nine entries that can never fire is the disease, not the cure.
  //
  // `D552`'s reason was an inconsistency that measurement says does not exist: it held that
  // `log level "error"` lights up while `log level "debug"` stays grey, because `threshold error
  // rate` had put `error` in `TYPES`. In that clause NEITHER lights up — `error` is inside a string
  // there too, and it colours as a `type` only in the other dialect and a different construction.
  // Measured on 2026-08-19; the boundary is pinned by a test in `semanticTokens.test.ts`.
  //
  // What is left is a real question this milestone does not answer: whether the editor should paint
  // enumerated values *inside* strings at all. That is a new capability, not a wordlist entry, and
  // it is a product decision (`D538`).
  ['debug', 'not a keyword: an enumerated STRING value — `log level "debug"`, coloured as the string it is'],
  ['info', 'not a keyword: same, LOG_LEVELS'],
  ['warn', 'not a keyword: same, LOG_LEVELS'],
  ['console', 'not a keyword: same, LOG_DESTINATIONS — `log destination "console"`'],
  ['html', 'not a keyword: same, LOG_DESTINATIONS'],
  ['both', 'not a keyword: same, LOG_DESTINATIONS'],
  ['full', 'not a keyword: same, EVIDENCE_LEVELS — `evidence "full"`'],
  ['headers-only', 'not a keyword: same, and it could not be one — `-` lexes as `minus`, so no bare tflw keyword is hyphenated'],
  ['none', 'not a keyword: same, EVIDENCE_LEVELS'],
]);

/**
 * Words the parser recognises **only in order to refuse them**. Colouring one teaches the reader a
 * word the language does not have — the same direction of error as `B5-10`'s `h`, where a
 * highlighter finished a literal the checker then rejected.
 *
 * That "a word is refused" is expressed three unrelated ways in `parser.ts` —
 * `RETIRED_STATEMENT_KEYWORDS` (`:251`), a `removedKeyword()` call (`:616`), and a bare did-you-mean
 * hint (`:641`) — is a real defect and a different subject (diagnostics, not colouring). Filed as
 * `M142-01` rather than fixed here (`D556`).
 *
 * NOTE, for the commit that turns the completeness assertion on: `uncheck` is in `KEYWORDS` above
 * and so is coloured today, and `tflw.tmLanguage.json` colours `think` as well. Whether a retired
 * spelling should be painted — the editor saying "I know this word" while the checker explains it
 * was renamed — is a real question with a defensible answer either way, and it is deliberately NOT
 * settled by this commit, which only classifies. It is settled where colouring changes belong.
 */
export const REFUSED_ON_PURPOSE: ReadonlyMap<string, string> = new Map([
  ['think', 'retired by FS-05, renamed to `pause` — RETIRED_STATEMENT_KEYWORDS'],
  ['uncheck', 'retired by FS-04, renamed to `untick` — RETIRED_STATEMENT_KEYWORDS'],
  ['scenario', 'removed by M50/D93 — parser.ts:616 answers it with a D103 migration diagnostic'],
  ['tests', 'never a keyword: parser.ts:641 recognises it only to answer "did you mean `test`?"'],
  ['empty', 'never a matcher: parser.ts:3471 answers `is not empty` with the construction that works'],
]);

function spanLength(span: Span): number {
  return span.end.offset - span.start.offset;
}

/** Resolve a ref's *actual* def kind — `symbols.ts` tags every ref `kind: 'variable'` regardless of
 * whether it points at a variable or a param def (only defs distinguish the two), so a ref's true
 * kind has to come from looking its `defSpan` up against the def list. */
function refSemanticType(refKind: SymbolKind, defSpan: Span | undefined, defKindByOffset: ReadonlyMap<number, SymbolKind>): SemanticTokenType | null {
  const kind = defSpan ? (defKindByOffset.get(defSpan.start.offset) ?? refKind) : refKind;
  return symbolKindToTokenType(kind);
}

function symbolKindToTokenType(kind: SymbolKind): SemanticTokenType | null {
  switch (kind) {
    case 'variable':
      return 'variable';
    case 'param':
      return 'parameter';
    case 'action':
    case 'importedAction':
      return 'function';
    case 'session':
      return null; // sessions already get grammar coloring parity via `as`/keyword handling; not part of this pass
  }
}

export function collectSemanticTokens(source: string, symbols: SymbolTable, dialect: Dialect): readonly SemanticToken[] {
  const tokens: SemanticToken[] = [];
  const claimed = new Set<number>();
  const defKindByOffset = new Map<number, SymbolKind>();
  for (const def of symbols.defs) defKindByOffset.set(def.span.start.offset, def.kind);

  for (const def of symbols.defs) {
    const type = symbolKindToTokenType(def.kind);
    if (!type) continue;
    tokens.push({ span: def.span, type });
    claimed.add(def.span.start.offset);
  }
  for (const ref of symbols.refs) {
    const type = refSemanticType(ref.kind, ref.defSpan, defKindByOffset);
    if (!type) continue;
    tokens.push({ span: ref.span, type });
    claimed.add(ref.span.start.offset);
  }

  const { tokens: lexTokens } = lex(source);
  for (let i = 0; i < lexTokens.length; i++) {
    const tok = lexTokens[i]!;
    if (tok.type === 'number') {
      const next = lexTokens[i + 1];
      if (next && next.type === 'ident' && DURATION_UNITS.has(next.value) && next.span.start.offset === tok.span.end.offset) {
        tokens.push({ span: { start: tok.span.start, end: next.span.end }, type: 'number' });
        i++;
      } else {
        tokens.push({ span: tok.span, type: 'number' });
      }
      continue;
    }
    if (tok.type !== 'ident') continue;
    if (claimed.has(tok.span.start.offset)) continue;

    const next = lexTokens[i + 1];
    if (next && next.type === 'colon') {
      tokens.push({ span: tok.span, type: 'property' });
      continue;
    }
    if (KEYWORDS.has(tok.value) || (dialect === 'config' && CONFIG_KEYWORDS.has(tok.value))) tokens.push({ span: tok.span, type: 'keyword' });
    else if (OPERATORS.has(tok.value)) tokens.push({ span: tok.span, type: 'operator' });
    else if (TYPES.has(tok.value)) tokens.push({ span: tok.span, type: 'type' });
    else if (FUNCTIONS.has(tok.value)) tokens.push({ span: tok.span, type: 'function' });
    else if (PERCENTILE_RE.test(tok.value)) tokens.push({ span: tok.span, type: 'type' });
  }

  tokens.sort((a, b) => a.span.start.offset - b.span.start.offset);
  return tokens.filter((t) => spanLength(t.span) > 0);
}
