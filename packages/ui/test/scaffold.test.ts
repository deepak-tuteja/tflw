// `M222` — what `+ new test` writes, per door (`D1042`, implemented at last).
//
// `D1042` has said since `M200` `A0-3` that *"a door decides where you land and **what the
// new-test button scaffolds**, and nothing else"*, and only the first half was ever code:
// `newSource` built `buildApiStep` + `buildExpect(status equals 200)` for all four doors. On
// BROWSER that produced a test whose only step is an `ApiStep` — a kind **not in that door's own
// `constructs`** — so the pane drew the create gesture's own output as a dead code line with
// `data-stmt-editable="no"`, which is precisely the 650 statements `M219` `C` spent a slice
// removing. The page's create gesture was manufacturing new instances of the defect that round
// closed.
//
// The gate that carries this round is `the door scaffolds only what it can edit`: it is that
// defect stated as a property, and it holds for a door nobody has written yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, type Lens } from '@tflw/lang';

import { VOCABULARY } from '../src/vocabulary.ts';
import { newSource } from '../src/NewThing.tsx';

const DOORS: readonly Lens[] = ['api', 'browser', 'load', 'scan'];

/** A real file, so `insertIntoSource` has something to splice into and the result is a `.tflw`
 *  the parser actually reads. A synthetic two-liner would test the builders and not the round. */
const INTO = 'test "the first"\n  open "/"\n';

function wrote(door: Lens, over: { name?: string; method?: string; path?: string } = {}): string {
  const out = newSource({
    scaffold: VOCABULARY[door].scaffold,
    name: over.name ?? 'a new one',
    method: over.method ?? 'GET',
    path: over.path ?? '/orders',
    into: INTO,
  });
  if (!out.ok) assert.fail(`${door} refused to scaffold: ${out.reason}`);
  return out.text.slice(INTO.length);
}

// GATE 1 — the API door's output does not move. This round is about the other three; a change
// here would be a regression wearing a refactor. **Mutation: change the method default, or drop
// the `expect`.**
test('`M222` `A`: the API door scaffolds exactly what every door used to get', () => {
  assert.equal(wrote('api'), '\ntest "a new one"\n  api GET /orders\n  expect status equals 200\n');
  assert.equal(wrote('api', { method: 'POST', path: '/carts' }), '\ntest "a new one"\n  api POST /carts\n  expect status equals 200\n');
});

// GATE 2 — BROWSER scaffolds an `open` and nothing else (`D1192`). The absence of an assertion is
// a decision measured off the corpora, not an omission: 58.3% of the `open`s `discoverTests` can
// see are followed by a gesture, the language has no url or title matcher to derive one from, and
// what text is on the page is the one thing the author has not seen yet.
// **Mutation: give `browser` the `api` scaffold.**
test('`M222` `A`: the BROWSER door scaffolds `open`, with no `api` step anywhere in it', () => {
  const text = wrote('browser', { path: '/checkout' });
  assert.equal(text, '\ntest "a new one"\n  open "/checkout"\n');
  assert.ok(!/\bapi\b/.test(text), `the BROWSER scaffold contains an api step: ${JSON.stringify(text)}`);
});

// GATE 3 — **the one that matters.** Every statement a door scaffolds is a kind that door's own
// pane can construct. `1.3` as a property: it is true of the two doors that exist and of every
// door added later, because it asks the table rather than naming a kind.
// **Mutation: scaffold an `ApiStep` on BROWSER — `scaffold: 'api'` on that row reddens it.**
test('`M222` `A`: a door scaffolds only statements it can edit — the defect `M219` `C` removed, stated as a rule', () => {
  /* **Qualified by `adds.length > 0`, and the qualifier is not a let-out.** `constructs` describes
     what a door's Compose *sequence* can build; SCAN draws no sequence (`adds: []` — `App.tsx`
     hands it `ScanForm`), so its entry is not a claim about anything on the screen and holding a
     scaffold to it would be holding it to a pane that is not rendered. For every door that does
     draw one, the rule is absolute.

     **LOAD joined this set in `M224` `D`** (`D1210`/`D1211`), which is exactly what this gate was
     written to notice: the set is read off the table rather than listed, so a door that starts
     drawing a sequence is held to the rule from the moment its row says so. */
  const withASequence = DOORS.filter((d) => VOCABULARY[d].adds.length > 0);
  assert.deepEqual(withASequence, ['api', 'browser', 'load'], 'the set of doors with a Compose sequence moved — this gate ranges over it');
  for (const door of withASequence) {
    const parsed = parseSource(INTO + wrote(door, { path: '/x' }));
    assert.equal(parsed.diagnostics.length, 0, `${door}'s scaffold does not parse`);
    const made = parsed.program.tests[parsed.program.tests.length - 1]!;
    assert.ok(made.body.length > 0, `${door} scaffolds a body and it is empty`);
    for (const step of made.body) {
      assert.ok(
        VOCABULARY[door].constructs.has(step.type),
        `the ${door.toUpperCase()} door scaffolds a \`${step.type}\`, which is not in its own \`constructs\` — ` +
          'so its create gesture writes a row its own pane draws dead (`D1082`)',
      );
    }
  }
});

// GATE 5 — **`D1190` is refuted, and this gate is the refutation kept.** The decision said LOAD
// and SCAN would scaffold nothing: a named test with an empty body. The language does not allow
// it — `test "x"` with nothing under it is `TF015`, *this `test` has no steps* — and the scoping
// probe that reported it legal was reading `parsed.errors`, a property `ParsedSource` does not
// have, so `?? []` made every file clean. There is also no `buildCrawl` and no crawl member on
// `insertIntoSource`, so SCAN's own shape cannot go through the one construction path at all.
//
// SCAN keeps `'api'`, and this gate pins the two facts that decided it rather than the preference.
// **Mutation: make it scaffold nothing — the `TF015` assertion below reddens.**
test('`M222` `A`: SCANS keeps the API scaffold, because the language refuses the empty test `D1190` asked for', () => {
  for (const door of ['scan'] as const) {
    assert.equal(VOCABULARY[door].scaffold, 'api', `${door}'s scaffold moved — see \`Scaffold\`'s docblock for why it is 'api'`);
    assert.equal(wrote(door), '\ntest "a new one"\n  api GET /orders\n  expect status equals 200\n');
  }
  // The refutation itself, so a later round cannot re-take `D1190` without meeting this first.
  const empty = parseSource(INTO + '\ntest "a new one"\n');
  assert.equal(empty.diagnostics.length, 1, 'an empty-bodied test now parses — `D1190` may be worth re-taking');
  assert.equal(empty.diagnostics[0]!.code, 'TF015');
  // …and the probe's own mistake, so the vacuity cannot come back the same way: `errors` is not
  // a field, and reading one that is not there is how a check passes without checking.
  assert.equal((empty as unknown as { errors?: unknown }).errors, undefined, '`ParsedSource` grew an `errors` field — the probe that read one would now be right');
});

// The refusals are per-scaffold too, and they have to be: *the request needs a path* is the wrong
// sentence on a door that issues no request. The `null` scaffold asks for no path at all, which is
// what makes the dialog on LOAD two fields rather than two fields and a dead refusal.
test('`M222` `B`: an empty path refuses in the scaffold’s own words', () => {
  const api = newSource({ scaffold: 'api', name: 'n', method: 'GET', path: '  ', into: INTO });
  assert.equal(api.ok, false);
  assert.match((api as { reason: string }).reason, /request needs a path/);

  // *the request needs a path* is the wrong sentence on a door that issues no request — the
  // dialog's refusal is part of the field set, not a string beside it.
  const browser = newSource({ scaffold: 'open', name: 'n', method: 'GET', path: '  ', into: INTO });
  assert.equal(browser.ok, false);
  assert.match((browser as { reason: string }).reason, /path to open/);

  // The name is asked for on every door, because every door's test is reported by it.
  for (const scaffold of ['api', 'open'] as const) {
    const out = newSource({ scaffold, name: '   ', method: 'GET', path: '/x', into: INTO });
    assert.equal(out.ok, false, `a nameless test was accepted with scaffold ${scaffold}`);
  }
});

// ---- `M224` `F` — the LOAD scaffold (`D1213`) -------------------------------------------------

// GATE 14 — **four statements, and every one of them is accounted for.** `TF015` forces a body,
// `TF033` forces a threshold, and the two values are measured rather than chosen: `ramp` is 35 of
// the corpora's 85 workload lines (against the old form's `iterations` default), and
// `error rate is less than 1%` is 61 of 88 threshold lines.
// **Mutation: drop the threshold → `TF033`; drop the step → `TF015`.**
test('`M224` `F`: the LOAD door scaffolds a workload, a threshold, a request and its assertion', () => {
  assert.equal(VOCABULARY.load.scaffold, 'workload');
  /* **The threshold lands at the foot of the body, which is `printTest`'s order and not the
     plan's.** `D1213` wrote the four lines in the order `examples/storefront` uses — workload,
     threshold, request, assertion — and both orders are format-stable, because `format` is not a
     reprint and leaves an author's position alone. What a *printed* test says is the printer's,
     and `D1087` means the scaffold goes through it rather than around it. Amended in place in the
     plan; pinned here as bytes. */
  assert.equal(
    wrote('load', { path: '/' }),
    '\ntest "a new one"\n  ramp to 5 users over 2s\n  api GET /\n  expect status equals 200\n  threshold error rate is less than 1%\n',
  );
  // It is a load test by derivation and not by anything anyone wrote down — the workload line is
  // the whole of what makes it one (`D99`), and the tag list is empty.
  const made = parseSource(INTO + wrote('load', { path: '/' })).program.tests.at(-1)!;
  assert.ok(made.workload !== null, 'the scaffold writes no workload, so the LOAD door creates a functional test');
  assert.equal(made.thresholds.length, 1, '`TF033` — a workload-bearing test with no threshold can never fail');
  assert.deepEqual(made.tags, []);
});

// GATE 15 — **the bound it refuses.** About 25 corpus lines carry a `p95 duration` threshold, with
// **eight distinct values** from 50 ms to 100 000 ms: it is the number only the author knows, and a
// guessed one is `D1087`'s receipt again — the legacy form offering *"the orders endpoint answers"*
// for whatever file happened to be open. **Mutation: add one → this reddens.**
test('`M224` `F`: the LOAD scaffold writes no `duration` bound, because nobody can guess it', () => {
  const text = wrote('load', { path: '/' });
  assert.ok(!/duration/.test(text), `the scaffold guessed a duration bound: ${JSON.stringify(text)}`);
  const made = parseSource(INTO + text).program.tests.at(-1)!;
  assert.deepEqual(made.thresholds.map((t) => t.metric.kind), ['errorRate']);
});

// And the dialog's refusals are still the scaffold's own: a `'workload'` test issues a request, so
// it asks for a path and says so in the same words `'api'` does. The control beside it is the
// BROWSER refusal above, which names a page rather than a request.
test('`M224` `F`: the LOAD scaffold refuses an empty path in the request’s words', () => {
  const out = newSource({ scaffold: 'workload', name: 'n', method: 'GET', path: '  ', into: INTO });
  assert.equal(out.ok, false);
  assert.match((out as { reason: string }).reason, /request needs a path/);
});
