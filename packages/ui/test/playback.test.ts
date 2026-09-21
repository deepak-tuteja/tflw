// `M221` — ▶ runs the buffer, and the stage shows what it did (`D1181`–`D1186`).
//
// These are the claims that are cheap here and expensive in a browser: where the scratch lands,
// which report entries count as "this file" once a play has written one, and which trace the stage
// picks out of a report holding several. The page gate can show that a frame appeared; it cannot
// cheaply show that a test in `tests/ui/storefront/` played from a scratch at the project **root**
// would resolve its imports four directories away, which is the defect `D1184` exists to refuse
// and the one that would have been invisible until a project with a relative `use` met it.
//
// Every test states its negative control (`M92d`).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { belongsTo, playScratchOf, sameFile } from '../src/ran.ts';
import { traceOf } from '../src/Stage.tsx';
import type { RunReport, TraceAsset } from '../src/contract.ts';

const PLAY = '.play.tflw';

test('the play scratch lands BESIDE the file, because a relative import resolves against its own directory', () => {
  // `D1184`. `imports.ts` — "`resolve(dirname(filePath), literal)` is not a choice — it is what
  // `buildRegistry`, the checker and the CLI all do". So the only correct directory is the file's.
  assert.equal(playScratchOf('tests/ui/storefront/accessibility-demo.tflw', PLAY), 'tests/ui/storefront/.play.tflw');
  assert.equal(playScratchOf('tests/checkout.tflw', PLAY), 'tests/.play.tflw');
  // A file at the project root has no directory to join, and gets the basename alone.
  assert.equal(playScratchOf('checkout.tflw', PLAY), '.play.tflw');
  // NEGATIVE CONTROL: the root path `send` uses is NOT what this produces for a nested file —
  // which is the whole difference between the two scratches, and the reason there are two.
  assert.notEqual(playScratchOf('tests/ui/storefront/accessibility-demo.tflw', PLAY), PLAY);
});

test('a play’s report is about the file it copied, and a report about any other file is not', () => {
  const file = 'tests/ui/storefront/accessibility-demo.tflw';
  const scratch = playScratchOf(file, PLAY);
  // The ordinary case, unchanged: a run of the file itself.
  assert.equal(belongsTo(file, file, PLAY), true);
  assert.equal(belongsTo(`./${file}`, file, PLAY), true);
  // `M221` `B` — and a run of the scratch ▶ wrote beside it.
  assert.equal(belongsTo(scratch, file, PLAY), true);
  // NEGATIVE CONTROL, and the one that matters: a scratch in ANOTHER directory is another file's
  // play, not this one's. Without this the pane would draw a sibling test's verdicts on its rows
  // whenever two files in one project were played in turn.
  assert.equal(belongsTo('tests/.play.tflw', file, PLAY), false);
  assert.equal(belongsTo('tests/ui/other.tflw', file, PLAY), false);
  // …and with no play scratch named, this is `sameFile` exactly — what every caller before
  // `M221` gets, so the widening cannot leak into one that did not ask for it.
  assert.equal(belongsTo(scratch, file), false);
  assert.equal(belongsTo(file, file), sameFile(file, file));
});

const reportWith = (tests: readonly { name: string; trace?: TraceAsset }[]): RunReport =>
  ({
    ok: true,
    env: 'local',
    startedAt: '2026-09-21T10:00:00.000Z',
    durationMs: 10,
    total: tests.length,
    passed: tests.length,
    failed: 0,
    seed: 1,
    now: '2026-09-21T10:00:00.000Z',
    insecure: false,
    tests: tests.map((t) => ({ kind: 'functional', name: t.name, ok: true, durationMs: 10, file: 'tests/a.tflw', steps: [], ...(t.trace ? { trace: t.trace } : {}) })),
  }) as RunReport;

test('the stage shows the trace of the declaration ▶ was pressed on, and of no other', () => {
  // `D1182`. A whole-suite run writes a trace for every browser test it touched; drawing one of
  // them under an editor nobody played would be the stage answering a question nobody asked.
  const report = reportWith([
    { name: 'first', trace: { path: 'assets/traces/aaaa000000000001.zip' } },
    { name: 'second', trace: { path: 'assets/traces/bbbb000000000002.zip' } },
  ]);
  assert.deepEqual(traceOf(report, 'second', 'r1'), { reportId: 'r1', path: 'assets/traces/bbbb000000000002.zip' });
  // NEGATIVE CONTROL: a name the report does not hold draws nothing, rather than falling back to
  // the first trace in the file — which is what "show the newest trace" would have done.
  assert.equal(traceOf(report, 'third', 'r1'), null);
});

test('the stage reads `trace.path` and never hashes `trace.base64`', () => {
  // `D1171`'s own defect, deliberately not reintroduced. `TraceLink` accepts both shapes because
  // it renders reports of any age; the stage's subject is a play THIS pane just pressed, and every
  // such run writes a path. Hashing 800 KB in the browser to recover a filename that is already in
  // the report is the work `D1171` removed.
  const legacy = reportWith([{ name: 'first', trace: { base64: 'AAAA' } }]);
  assert.equal(traceOf(legacy, 'first', 'r1'), null, 'the stage tried to read a pre-M220 report');
  // NEGATIVE CONTROL: the same test WITH a path is found, so the null above is about the shape
  // and not about the lookup failing for some other reason.
  assert.deepEqual(traceOf(reportWith([{ name: 'first', trace: { path: 'p.zip' } }]), 'first', 'r1'), { reportId: 'r1', path: 'p.zip' });
});

test('a run that kept no trace is a stage with nothing in it, not a stage with a broken frame', () => {
  // `D1187` — the region says which of its states it is in. `null` here is what makes the hint
  // render instead of an `<iframe src="undefined">`.
  assert.equal(traceOf(reportWith([{ name: 'first' }]), 'first', 'r1'), null);
});
