// `M250` `A` (`D1361`) — the page's editor offers what the language server offers.
//
// One cursor per completion kind the grammar instruments, in both dialects. At each, the editor's
// list is compared with `getCompletions` asked the same question with the same names, so the page
// and the editor extension cannot drift apart; the kind itself is asserted first, so a corpus row
// that stopped reaching its production fails here rather than comparing two empty lists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectSymbols, getCompletionContext, getConfigCompletionContext, parseSource, type CompletionKind, type Dialect } from '@tflw/lang';
import { getCompletions, variablesInScopeAt } from '@tflw/lsp-server/pure';
import { completeAt } from '../src/complete.ts';

const SESSIONS = ['admin', 'shopper'];
const AUTHORIZED = 'defaults\n  authorized target "http://localhost:4001" reason "self-hosted test fixture"\n';

const CORPUS: readonly [CompletionKind, Dialect, string][] = [
  ['step', 'test', 'test "ok"\n  ex'],
  ['subject', 'test', 'test "ok"\n  let orderId = 1\n  expect or'],
  ['locator', 'test', 'element basket = css ".basket"\n\ntest "t"\n  click b'],
  ['matcher', 'test', 'test "ok"\n  expect status e'],
  ['session', 'test', 'test "ok" as s'],
  ['unique', 'test', 'test "ok"\n  let x = unique e'],
  ['random', 'test', 'test "ok"\n  let x = random n'],
  ['transform', 'test', 'test "ok"\n  let x = base64 e'],
  ['config-directive', 'config', 'sess'],
  ['defaults-key', 'config', 'defaults\n  wor'],
  ['env-key', 'config', 'env local default\n  ap'],
  ['probe', 'config', `${AUTHORIZED}    pro`],
  ['probe-class', 'config', `${AUTHORIZED}    probe mut`],
];

test('every completion kind is in the corpus', () => {
  const kinds = new Set(CORPUS.map(([k]) => k));
  const all: CompletionKind[] = ['step', 'subject', 'locator', 'matcher', 'session', 'unique', 'random', 'transform', 'config-directive', 'defaults-key', 'env-key', 'probe', 'probe-class'];
  assert.deepEqual([...kinds].sort(), [...all].sort());
});

for (const [kind, dialect, source] of CORPUS) {
  test(`the editor offers the language server's list — ${kind}`, () => {
    const ctx = dialect === 'test' ? getCompletionContext(source, source.length) : getConfigCompletionContext(source, source.length);
    assert.equal(ctx?.kind, kind, `the corpus row reaches \`${kind}\``);
    const { program } = parseSource(source);
    const expected = getCompletions(ctx!, {
      knownSessions: SESSIONS,
      knownElements: dialect === 'test' ? (program.elements ?? []).map((e) => e.name) : undefined,
      knownVariables: kind === 'subject' ? variablesInScopeAt(program, collectSymbols(program, source), source.length) : undefined,
    });
    assert.ok(expected.length > 0, 'the row asks a question with an answer');
    const at = completeAt(source, source.length, dialect, SESSIONS, false);
    assert.deepEqual(at?.options.map((o) => o.displayLabel ?? o.label), expected.map((c) => c.label));
    assert.equal(at?.from, source.length - ctx!.prefix.length);
  });
}

test('a value is matched on its name and inserted braced, and a typed brace is not doubled', () => {
  const bare = 'test "ok"\n  let orderId = 1\n  expect or';
  const value = completeAt(bare, bare.length, 'test', [], false)!.options.find((o) => o.apply === '{orderId}');
  assert.deepEqual(value && { label: value.label, displayLabel: value.displayLabel }, { label: 'orderId', displayLabel: '{orderId}' });

  const braced = 'test "ok"\n  let orderId = 1\n  expect {or';
  const at = completeAt(braced, braced.length, 'test', [], false);
  assert.ok(at !== null, 'a typed brace still reaches the subject position');
  assert.equal(braced.slice(at.from), '{or', 'the insertion replaces the brace the author typed');
  assert.ok(at.options.some((o) => o.apply === '{orderId}'));
});

test('nothing typed opens no list, unless the list was asked for', () => {
  const source = 'test "ok"\n  expect status ';
  assert.equal(completeAt(source, source.length, 'test', [], false), null);
  const asked = completeAt(source, source.length, 'test', [], true);
  assert.ok(asked !== null && asked.options.some((o) => o.label === 'equals'), 'Ctrl+Space at an empty position lists the matchers');
});

test('the sessions come from the caller, and only the named ones are offered', () => {
  const source = 'test "ok" as ';
  assert.deepEqual(completeAt(source, source.length, 'test', SESSIONS, true)?.options.map((o) => o.label), SESSIONS);
  assert.equal(completeAt(source, source.length, 'test', [], true), null, 'a project with no sessions offers none');
});
