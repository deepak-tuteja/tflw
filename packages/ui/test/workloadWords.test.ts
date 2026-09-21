// `M225` `C`–`F` — the composer's vocabulary (`D1219`, `D1220`, `D1221`, `D1222`).
//
// **THE DEFECT THESE GATES ARE ABOUT IS NOT A MISSING FEATURE, IT IS A MECHANISM.** The workload
// editor was the only block on the page using the browser's native `title`: 25 controls, 0 with
// `data-tip`, 16 with `title`, 6 with `aria-label` alone and 3 with nothing at all — page-wide,
// all sixteen of the page's titles were inside it. The text existed and was good; nothing showed
// it in the page's own voice.
//
// **And the mechanism was not the whole of it**, which is why gate 12 is here: the eight cells
// that pick the shape carried a tip built as `` `${label} ${u}` `` — the row label and the column
// label already printed beside them. Converting the attribute alone would have left the control
// that decides what kind of load this is saying the least of anything in the block.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildWorkload, print } from '@tflw/lang';
import type { Workload } from '@tflw/lang';
import {
  THRESHOLD_WHY,
  WORKLOAD_CELL_WHY,
  WORKLOAD_FIELD_WHY,
  WORKLOAD_ITERATION_SHAPES,
  WORKLOAD_PROFILES,
  WORKLOAD_UNITS,
  planProse,
  workloadCitation,
  workloadEditOf,
  workloadSpecOf,
  workloadWords,
  workloadSentenceOf,
  type WorkloadEdit,
  type WorkloadShape,
} from '../src/workloadEdit.ts';
import { planInputOf } from '../src/workloadEdit.ts';

const EDIT: WorkloadEdit = {
  shape: 'ramp',
  unit: 'users',
  target: '5',
  seconds: '2',
  count: '40',
  vus: '4',
  stages: [{ mode: 'jump', target: '2', seconds: '1' }, { mode: 'ramp', target: '6', seconds: '3' }],
};

/** The ten shapes the language has, as this form spells them — four profiles x two units, plus
 *  the two iteration shapes that have no unit axis to sit on. */
const TEN: readonly { readonly shape: WorkloadShape; readonly unit: 'users' | 'rps' }[] = [
  ...(['ramp', 'hold', 'step', 'spike'] as const).flatMap((shape) =>
    (['users', 'rps'] as const).map((unit) => ({ shape: shape as WorkloadShape, unit })),
  ),
  { shape: 'iterations', unit: 'users' },
  { shape: 'iterations-per-user', unit: 'users' },
];

const nodeOf = (edit: WorkloadEdit): Workload => {
  const built = buildWorkload(workloadSpecOf(edit));
  assert.ok(built.ok, `buildWorkload refused ${edit.shape}/${edit.unit}: ${built.ok ? '' : built.reason}`);
  return built.node;
};

const numbersIn = (s: string): readonly string[] => s.match(/\d+(?:\.\d+)?/g) ?? [];

test('every shape is one of the ten, and the form covers exactly them', () => {
  assert.equal(TEN.length, 10);
  assert.equal(WORKLOAD_PROFILES.length * WORKLOAD_UNITS.length + WORKLOAD_ITERATION_SHAPES.length, 10);
});

// ── GATE 12 ───────────────────────────────────────────────────────────────────────────────────
// The mutation: restore the old template. `` `${label} ${u}` `` is what shipped, and it is the
// row's own label plus the column's own label — two words the reader can already see.
test('a shape cell says what the PAIRING does, not its row label plus its column label — gate 12', () => {
  for (const [profile, label] of WORKLOAD_PROFILES) {
    for (const [u] of WORKLOAD_UNITS) {
      const why = WORKLOAD_CELL_WHY[`${profile}:${u}`];
      assert.ok(why, `${profile}:${u} has a tip`);
      assert.notEqual(why, `${label} ${u}`, `${profile}:${u}: the tip is not the two labels beside it`);
      assert.ok(why.length > 40, `${profile}:${u}: "${why}" is a label, not an explanation`);
      // And it is not the row's tip either — a cell that repeated its profile's sentence would
      // make the unit axis invisible, which is the axis the reader gets wrong.
      const rowWhy = WORKLOAD_PROFILES.find(([p]) => p === profile)![2];
      assert.notEqual(why, rowWhy, `${profile}:${u}: the cell is not the row`);
    }
  }
  assert.equal(Object.keys(WORKLOAD_CELL_WHY).length, 8, 'eight cells, eight sentences');
});

test('every control in the block has words, and no two controls share them', () => {
  const all = [
    ...Object.values(WORKLOAD_CELL_WHY),
    ...Object.values(WORKLOAD_FIELD_WHY),
    ...Object.values(THRESHOLD_WHY),
    ...WORKLOAD_PROFILES.map(([, , why]) => why),
    ...WORKLOAD_UNITS.map(([, , why]) => why),
    ...WORKLOAD_ITERATION_SHAPES.map(([, , why]) => why),
  ];
  for (const why of all) assert.ok(why.trim().length > 20, `"${why}" is not an explanation`);
  assert.equal(new Set(all).size, all.length, 'a repeated sentence is a control that has not been thought about');
});

// ── GATE 13 ───────────────────────────────────────────────────────────────────────────────────
// The mutation: change one shape's sentence. The plot, the sentence and the printed clause are
// one fact stated three ways (`D985`), so a sentence that drifts from the numbers the printer
// writes is a page disagreeing with the file it is editing.
test('the sentence, the plot input and the printed clause agree for all ten shapes — gate 13', () => {
  for (const { shape, unit } of TEN) {
    const edit: WorkloadEdit = { ...EDIT, shape, unit };
    const printed = print(nodeOf(edit));
    assert.ok(printed.ok, `${shape}/${unit} prints`);
    const said = workloadSentenceOf(edit);
    const plan = planInputOf(edit);

    // Every number the sentence states is a number the file states. Not the other way round: the
    // printer writes `2s` where the sentence writes `2s` but also writes a default the sentence
    // has no reason to repeat.
    for (const n of numbersIn(said)) {
      assert.ok(
        numbersIn(printed.text).includes(n),
        `${shape}/${unit}: the sentence says ${n} and the file says ${printed.text.trim()}`,
      );
    }
    // And the plot is reading the same edit, so its own numbers are the same numbers.
    assert.equal(plan.shape, shape);
    assert.equal(plan.unit, unit);
    assert.ok(said.length > 30, `${shape}/${unit}: "${said}" is a label, not a sentence`);
  }
  // Non-vacuity: the ten sentences are ten different sentences.
  const said = TEN.map(({ shape, unit }) => workloadSentenceOf({ ...EDIT, shape, unit }));
  assert.equal(new Set(said).size, 10, 'ten shapes, ten sentences');
});

test('the sentence says CLOSED for users and OPEN for rps, which is the distinction the grid is for', () => {
  for (const shape of ['ramp', 'hold', 'step', 'spike'] as const) {
    assert.match(workloadSentenceOf({ ...EDIT, shape, unit: 'users' }), /Closed/, `${shape}/users`);
    assert.match(workloadSentenceOf({ ...EDIT, shape, unit: 'rps' }), /Open/, `${shape}/rps`);
  }
  // An iteration shape is closed whatever the unit field happens to hold, because it has no unit.
  assert.match(workloadSentenceOf({ ...EDIT, shape: 'iterations', unit: 'rps' }), /shared across/);
});

// ── GATE 14 ───────────────────────────────────────────────────────────────────────────────────
// The mutation: restore `type.replace(/Workload$/, '')`, which put `SpikeUsers` on screen and let
// the stylesheet lowercase it to `spikeusers`.
test('the clause label is the language s own spelling, not the node type — gate 14', () => {
  for (const { shape, unit } of TEN) {
    const edit: WorkloadEdit = { ...EDIT, shape, unit };
    const node = nodeOf(edit);
    const printed = print(node);
    assert.ok(printed.ok);
    const words = workloadWords(shape, unit);

    // It is not the type name, in any casing.
    assert.notEqual(words, node.type.replace(/Workload$/, ''));
    /* And it is two words the language writes with a space between them. The destroyed form —
       lowercase, spaces removed — is exactly what the shipped label was, so asserting the
       *difference* there would assert nothing: `spikeusers` is `spikeusers` either way. */
    assert.equal(words, words.toLowerCase(), `${shape}/${unit}: a label is not a type name`);
    assert.ok(words.includes(' '), `${shape}/${unit}: "${words}" is one word`);

    // And every word of it occurs, in this order, in the line the printer writes. That is what
    // makes it *the language's* spelling rather than a second vocabulary that happens to look
    // like one — `D1094`, the failure this project keeps recording.
    const line = printed.text;
    let from = 0;
    for (const word of words.split(' ')) {
      const at = line.indexOf(word, from);
      assert.ok(at >= 0, `${shape}/${unit}: "${word}" of "${words}" is not in \`${line.trim()}\``);
      from = at + word.length;
    }
    // Reading back the node gives the same words, which is the path the band actually takes.
    const back = workloadEditOf(node);
    assert.equal(workloadWords(back.shape, back.unit), words);
  }
});

// ── GATES 15 and 16 ───────────────────────────────────────────────────────────────────────────
test('a never-run test reads "not run here yet", never a blank and never a zero — gate 15', () => {
  const said = workloadCitation(null);
  assert.match(said, /not run here yet/);
  assert.ok(said.trim().length > 0);
  assert.doesNotMatch(said, /\b0\b/, 'a zero would read as a measurement');
});

test('an INCONCLUSIVE last run says so, and says every threshold was skipped — gate 16', () => {
  const bad = workloadCitation({ iterations: 1053717, p95Ms: 0.62, inconclusive: true });
  const ordinary = workloadCitation({ iterations: 1053717, p95Ms: 0.62, inconclusive: false });
  assert.match(bad, /INCONCLUSIVE/);
  assert.match(bad, /skipped/);
  assert.match(bad, /bottleneck/);
  assert.doesNotMatch(ordinary, /INCONCLUSIVE/, 'the ordinary case is not a warning');
  // Both cite; neither predicts. The numbers are the run's own, thousands separated so a reader
  // can tell 1,053,717 from 105,371 at a glance — the storefront case is exactly that number.
  assert.match(bad, /1,053,717 iterations/);
  assert.match(ordinary, /1,053,717 iterations/);
  assert.match(ordinary, /p95 0\.62ms/);
});

// ── GATE 17 ───────────────────────────────────────────────────────────────────────────────────
// The mutation: print one string for both. A `users` plan and an `rps` plan are not one picture
// with a different label on it, and the difference is the one a reader gets wrong.
test('the plan prose differs between a users plan and an rps one — gate 17', () => {
  const users = planProse('ramp', 'users');
  const rps = planProse('ramp', 'rps');
  assert.notEqual(users, rps);
  assert.match(users, /CLOSED/);
  assert.match(rps, /OPEN/);
  // The iteration shapes get their own, because they have no rate axis at all.
  const iter = planProse('iterations', 'users');
  assert.notEqual(iter, users);
  assert.notEqual(iter, rps);
  assert.match(iter, /amount of work/);
  assert.equal(planProse('iterations-per-user', 'rps'), iter, 'the unit field is meaningless for these two');
});

// ── The trap the round's own tip describes ────────────────────────────────────────────────────
//
// `stageMode`'s tip says *a `step` block has no spelling for a ramp, which is why it does not
// offer one* — and the editor does not offer one: a `step` draws a bare `to` where a `spike`
// draws the select. What it did do was carry the mode in the edit, so building a `spike` with a
// ramped stage and then pressing `step` refused the whole clause with *use `spike` for a ramp*,
// against a control that was no longer on screen.
test('switching a ramped spike to a step builds, because a step stage is a jump by definition', () => {
  const ramped: WorkloadEdit = { ...EDIT, shape: 'spike', unit: 'users' };
  assert.ok(ramped.stages.some((s) => s.mode === 'ramp'), 'the fixture has a ramped stage, or this proves nothing');
  const asSpike = buildWorkload(workloadSpecOf(ramped));
  assert.ok(asSpike.ok, 'a spike takes a ramped stage');
  const asStep = buildWorkload(workloadSpecOf({ ...ramped, shape: 'step' }));
  assert.ok(asStep.ok, asStep.ok ? '' : `a step refused what it gives the author no control to fix: ${asStep.reason}`);
  const printed = print(asStep.node);
  assert.ok(printed.ok && !printed.text.includes(' over '), 'and it prints as a staircase, which is the only shape a step has');
});
