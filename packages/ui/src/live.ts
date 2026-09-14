// A run as it arrives (`M192` U2): the stream reduced into the shape `results.json` will have,
// so the live pane and the finished view are one renderer. `run:start`/`run:end` are per file
// (`D111`) and `run:end` carries that file's report, not the merged one; the merged report is
// read from the kept directory once the server says the run ended. Pure, so a test can hold it.

import type { ReportEntry, RunEvent, StepResult } from './contract';

export interface LiveTest {
  readonly file: string | undefined;
  readonly name: string;
  /** Set when the pair is a file hook's (`RunEvent.hook`); a passing one is work, not a test. */
  readonly hook?: 'before file' | 'after file';
  /** Steps so far; replaced by `result.steps` when the test ends. */
  readonly steps: readonly StepResult[];
  readonly result: ReportEntry | null;
}

export interface LiveState {
  readonly files: readonly string[];
  readonly tests: readonly LiveTest[];
  /** What each file's `run:start` announced, summed. */
  readonly announced: number;
  readonly noise: readonly string[];
}

export const EMPTY_LIVE: LiveState = { files: [], tests: [], announced: 0, noise: [] };

export function reduceLive(state: LiveState, event: RunEvent): LiveState {
  switch (event.type) {
    case 'run:start':
      return { ...state, files: event.file && !state.files.includes(event.file) ? [...state.files, event.file] : state.files, announced: state.announced + event.total };
    case 'test:start':
      return { ...state, tests: [...state.tests, { file: event.file, name: event.name, hook: event.hook, steps: [], result: null }] };
    case 'step:end':
      return { ...state, tests: patch(state.tests, event.file, event.test, (t) => ({ ...t, steps: [...t.steps, event.step] })) };
    case 'test:end':
      return {
        ...state,
        tests: patch(state.tests, event.file, event.result.name, (t) => ({ ...t, steps: 'steps' in event.result ? event.result.steps : t.steps, result: event.result })),
      };
    case 'run:end':
      return state;
  }
}

/** What the live counter says: tests ended, tests failed. A *passing* file hook emits a
 * `test:start`/`test:end` pair the report will never hold (`interpreter.ts` `runFileHooks`, SPEC
 * §13: the pair tracks work in flight, `run:start.total` counts tests), so it is shown as work and
 * not counted as a test — a failing one enters the report and is counted. Found by `M192` U7 on
 * the dogfood corpus, whose first file has a `before file`: the pane read "106 of 105 done". By
 * the pair's `hook` field since `M192b` (`M192-02`): until then the stream marked a hook no other
 * way than its name, and a test named `before file` was a hook to this counter. */
export function liveCounts(state: LiveState): { readonly done: number; readonly failed: number } {
  let done = 0;
  let failed = 0;
  for (const t of state.tests) {
    if (t.result === null) continue;
    if (t.hook && t.result.ok) continue;
    done += 1;
    if (!t.result.ok) failed += 1;
  }
  return { done, failed };
}

export function addNoise(state: LiveState, line: string): LiveState {
  return { ...state, noise: [...state.noise, line] };
}

/** The last test of that name in that file still running — a `with each` expands to several
 * tests of one name, and the open one is always the most recent. */
function patch(tests: readonly LiveTest[], file: string | undefined, name: string, fn: (t: LiveTest) => LiveTest): readonly LiveTest[] {
  for (let i = tests.length - 1; i >= 0; i--) {
    const t = tests[i]!;
    if (t.name === name && t.file === file && t.result === null) {
      const next = tests.slice();
      next[i] = fn(t);
      return next;
    }
  }
  // A step for a test that never announced itself — kept rather than dropped, so a stream the
  // page did not expect is still visible.
  return [...tests, fn({ file, name, steps: [], result: null })];
}
