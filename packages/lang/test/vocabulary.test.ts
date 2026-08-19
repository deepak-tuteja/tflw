// M142 (Order 3 of the ledger drawdown) — the question nothing in this repo could answer:
// **what is tflw's keyword vocabulary?**
//
// tflw colours source through two independent paths: a TextMate grammar that runs the instant a
// file opens, and LSP semantic tokens that arrive once the language server attaches. Neither knows
// what the language is — both are hand-typed copies of vocabulary `parser.ts` already owns, and
// nothing has ever checked that the three agree. Four milestones (`M4a`, `M33`, `M133`, `M136b`)
// have each caught the lists up by hand, each found a different subset, and each believed it was
// done. `semanticTokens.test.ts` and `grammar.test.ts` hold ~40 tests between them, every one of
// the form "tokenizes X as Y" and not one of them a completeness assertion — an example test
// covers only the words its author thought of.
//
// Seven extractions of that vocabulary have been attempted (`PLAN_M142_VOCABULARY_GUARD.md` §3) and
// **all seven were wrong**, every one of them by silently losing words while looking correct:
//
//   * `isKw([^)]*,` cannot cross the inner `)` in `isKw(this.peek(), 'schema')`. It dropped 24
//     words, including `schema` — the very word the row it was written for names.
//   * a `/* … */` comment-stripping regex ate 516 lines of live code, taking `expectKw('respond')`
//     with it.
//   * hand-picking the vocabulary arrays by name missed `SCAN_KIND_PHRASES` entirely.
//
// A wrong scrape is indistinguishable from a right one, and it fails toward GREEN. That is the
// property this file is designed against. It walks `parser.ts`'s real AST with the TypeScript
// compiler API (`D550`): a parser cannot mis-read a paren, has no comments in it at all, and needs
// no list of array names to maintain — which is the disease itself, an eighth hand-typed list.
// The result is written to a committed golden file (`D553`), so a word appearing or vanishing is a
// diff line in a review rather than a guard that quietly keeps passing.
//
// Two honest limits, stated because neither is fixed here:
//
//   * A golden catches drift from day two, not a day-one error. The audit in
//     `PLAN_M142_VOCABULARY_GUARD.md` §2 is what stands behind the first committed contents.
//   * There is a **fourth** shape, found while building this and not in the plan's three: an object
//     literal whose *keys* are vocabulary. `BOUND_SECOND_WORDS` (`parser.ts:292`) is keyed by
//     `greater`/`less`/`more`/`fewer`/`at`, and this walk reads its values, not its keys. All five
//     happen to be reachable through some array as well, so nothing is lost today — but that is a
//     coincidence, not a property, and reading keys in general would flood the golden with `type`,
//     `span` and `value`. Filed as `M142-02` rather than guessed at here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { assertGolden } from './helpers.js';
import { COLOURED_VOCABULARY, DELIBERATELY_UNCOLOURED, REFUSED_ON_PURPOSE } from '../src/semanticTokens.js';

const PARSER_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'parser.ts');

/**
 * The three shapes `parser.ts` uses to recognise a word. No prior extraction knew about all three,
 * and the two the regex attempts kept losing are the last two.
 *
 *   `A`  a string literal inside an array literal — the 24 vocabulary arrays
 *   `K`  a string argument to `expectKw(…)` / `isKw(…)` — inline words that live in no array
 *   `V`  a `<expr>.value === '…'` comparison — 13 words, including every generator word
 *
 * Deliberately dumb: it matches syntax, and knows nothing whatever about tflw. Every word it finds
 * that is not really vocabulary is visible in the golden and carries a written reason in
 * `semanticTokens.ts`'s exemption lists — the cost of an extractor with no judgement in it, paid
 * once and in the open, rather than a smarter one whose judgement can silently be wrong.
 */
export type Mechanism = 'A' | 'K' | 'V';

/** The name a call is made through, whether `isKw(…)` or `this.isKw(…)`. */
function calleeName(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return undefined;
}

/** Extract every word `parser.ts` recognises, tagged with the mechanisms that recognise it. */
export function extractVocabulary(source: string): Map<string, Set<Mechanism>> {
  // `setParentNodes` is off and no Program is built: this is a pure syntactic parse of one file,
  // no type checker, no module resolution, nothing to configure and nothing to go stale.
  const sf = ts.createSourceFile('parser.ts', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const found = new Map<string, Set<Mechanism>>();
  const add = (word: string, mechanism: Mechanism) => {
    const set = found.get(word) ?? new Set<Mechanism>();
    set.add(mechanism);
    found.set(word, set);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) if (ts.isStringLiteral(element)) add(element.text, 'A');
    } else if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name === 'expectKw' || name === 'isKw') {
        for (const arg of node.arguments) if (ts.isStringLiteral(arg)) add(arg.text, 'K');
      }
    } else if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)
    ) {
      // `tok.value === 'unique'` and `this.peek().value !== 'x'` alike: one side is a string, the
      // other ends in `.value`. Order-insensitive, because both are written in this file.
      const { left, right } = node;
      const literal = ts.isStringLiteral(left) ? left : ts.isStringLiteral(right) ? right : undefined;
      const other = literal === left ? right : left;
      if (literal && ts.isPropertyAccessExpression(other) && other.name.text === 'value') {
        add(literal.text, 'V');
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return found;
}

/** `A`/`K`/`V` in a fixed order, so a word's flags never reorder between runs. */
function flagsOf(mechanisms: Set<Mechanism>): string {
  return (['A', 'K', 'V'] as const).filter((m) => mechanisms.has(m)).join('');
}

export function renderVocabulary(found: Map<string, Set<Mechanism>>): string {
  const words = [...found.keys()].sort();
  const lines = [
    '# tflw parser vocabulary — GENERATED from packages/lang/src/parser.ts. Do not hand-edit.',
    '# Regenerate with `npm run test:update -w @tflw/lang`, then review the diff (M142, D553).',
    '#',
    '# Mechanism flags — how parser.ts recognises the word:',
    '#   A  a string literal in an array literal',
    "#   K  a string argument to expectKw(…) / isKw(…)",
    "#   V  a `<expr>.value === '…'` comparison",
    '#',
    `# ${words.length} words`,
    '',
  ];
  for (const word of words) lines.push(`${flagsOf(found.get(word)!).padEnd(3)} ${word}`);
  return lines.join('\n');
}

const vocabulary = extractVocabulary(readFileSync(PARSER_PATH, 'utf8'));

test('the vocabulary parser.ts recognises, as a committed golden (M142, D553)', () => {
  assertGolden('vocabulary.txt', renderVocabulary(vocabulary));
});

// The self-test (`D550`, and `M140-5`'s throwaway-repo pattern applied to a scrape): a guard built
// out of an extraction is worth exactly what the extraction is worth, and this one's six ancestors
// all passed while wrong. Each witness below is a word a *specific* earlier attempt lost, so a
// regression to any of their shapes fails here by name rather than shifting a number in the golden.
const WITNESSES: ReadonlyArray<readonly [Mechanism, string, string]> = [
  ['A', 'security', 'SCAN_KIND_PHRASES — the array attempt 5 missed by hand-picking array names'],
  ['A', 'input handling', 'a multi-word phrase: splitting the vocabulary on whitespace loses it'],
  ['A', 'ms', 'DURATION_UNITS — B5-10 is the disagreement about this very array'],
  ['A', 'most', 'parser.ts:297 is its ONLY site: a nested array inside an object literal, which an\n' +
    '    extraction that hand-picks top-level `const` arrays by name cannot reach at all'],
  ['A', 'fewer', 'likewise reachable only from an array literal written inline inside a function body'],
  ['K', 'schema', 'attempt 3 could not cross the inner paren of isKw(this.peek(), ...)'],
  ['K', 'respond', 'attempt 4 stripped comments with a regex and ate the 516 lines holding it'],
  ['K', 'honoring', 'M136b-01: filed, in no array, reachable only through expectKw'],
  ['K', 'up', 'M136b-01: two letters, and a plausible identifier — see D442'],
  ['K', 'method', 'M136b-01'],
  ['V', 'unique', 'a generator word, recognised only by a bare tok.value comparison'],
  ['V', 'today', 'ditto — the date-offset head'],
  ['V', 'null', 'ditto — a literal, not a keyword, and still a word the parser matches'],
];

test('the extraction finds the words each earlier attempt silently lost (M142)', () => {
  for (const [mechanism, word, why] of WITNESSES) {
    const mechanisms = vocabulary.get(word);
    assert.ok(mechanisms, `\`${word}\` is missing from the extraction entirely — ${why}`);
    assert.ok(
      mechanisms!.has(mechanism),
      `\`${word}\` was found, but not through mechanism ${mechanism} — ${why}. ` +
        `Found through: ${flagsOf(mechanisms!) || '(none)'}`,
    );
  }
});

test('every one of the three mechanisms contributes words the others do not (M142)', () => {
  // A mechanism that has quietly stopped matching would still leave the other two producing a
  // plausible-looking golden. This is the assertion that notices, and it is the shape of the
  // failure all seven earlier attempts had.
  for (const mechanism of ['A', 'K', 'V'] as const) {
    const only = [...vocabulary].filter(([, ms]) => ms.size === 1 && ms.has(mechanism));
    assert.ok(
      only.length > 0,
      `mechanism ${mechanism} contributed no word of its own — it has probably stopped matching`,
    );
  }
});

// The exemption maps (`D551`) are the other half of the completeness answer, and they rot in a way
// the sets they sit beside do not: a wordlist that falls behind the parser is a gap somebody will
// eventually see in an editor, but an exemption for a word the parser no longer has is INVISIBLE —
// it makes the guard weaker while leaving it green, which is this milestone's whole subject wearing
// a different hat. So each entry is held to the extraction, and the two maps are held apart.
test('every exemption names a word the parser still recognises, and nothing is exempted twice (M142, D551)', () => {
  for (const [map, name] of [
    [DELIBERATELY_UNCOLOURED, 'DELIBERATELY_UNCOLOURED'],
    [REFUSED_ON_PURPOSE, 'REFUSED_ON_PURPOSE'],
  ] as const) {
    for (const [word, why] of map) {
      assert.ok(
        vocabulary.has(word),
        `${name} exempts \`${word}\`, which parser.ts no longer recognises — delete the entry rather than ` +
          'leaving a dead exemption standing in for a check',
      );
      assert.ok(why.trim().length > 0, `${name}'s entry for \`${word}\` has no reason, which is the only thing it is for`);
    }
  }

  const both = [...DELIBERATELY_UNCOLOURED.keys()].filter((word) => REFUSED_ON_PURPOSE.has(word));
  assert.deepEqual(
    both,
    [],
    'a word cannot be both a keyword this pass declines to paint and a word the language does not have',
  );
});

// THE ASSERTION THIS WHOLE MILESTONE EXISTS FOR (`M136b-01`). Four milestones — `M4a`, `M33`,
// `M133`, `M136b` — each caught the LSP wordlists up to `parser.ts` by hand, each found a different
// subset, and each recorded the catch-up as complete. None of them was lying: there was no way to
// ask the question, so "I went through the parser and added what was missing" was the strongest
// claim anyone could make, and it happened to be false four times running.
//
// This is that question, asked by a program. Every word `parser.ts` recognises must be accounted
// for — painted, or named in an exemption map with a reason. **Unclassified fails.** What it buys
// is not the words it finds today (§2 of the plan found those by hand); it is that the fifth
// catch-up cannot be believed without being true.
test('every word parser.ts recognises is either coloured or exempted with a reason (M136b-01, M142)', () => {
  const unclassified = [...vocabulary.keys()]
    .filter((word) => !COLOURED_VOCABULARY.has(word))
    .filter((word) => !DELIBERATELY_UNCOLOURED.has(word) && !REFUSED_ON_PURPOSE.has(word))
    .sort();

  assert.deepEqual(
    unclassified,
    [],
    'these words are in parser.ts and in nothing else — colour them, or add them to ' +
      'DELIBERATELY_UNCOLOURED / REFUSED_ON_PURPOSE with the reason. Leaving one here is how the ' +
      'previous four catch-ups each recorded themselves as complete',
  );
});

// The same assertion pointed the other way, and it is the half that rots quietly. An exemption for a
// word that has SINCE been coloured is invisible: everything is painted, everything passes, and a
// map whose entries are supposed to be reasons is quietly carrying a lie about one of them.
test('no word is both painted and exempted from being painted (M142, D551)', () => {
  const contradictory = [...DELIBERATELY_UNCOLOURED.keys(), ...REFUSED_ON_PURPOSE.keys()]
    .filter((word) => COLOURED_VOCABULARY.has(word))
    .sort();

  assert.deepEqual(
    contradictory,
    [],
    'these words are coloured AND carry a written reason for not being coloured — delete the ' +
      'exemption, which is now describing something that is not happening',
  );
});
