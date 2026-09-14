// A run as it arrives (`M192` U2): the stream reduced into the shape `results.json` will have,
// so the live pane and the finished view are one renderer. `run:start`/`run:end` are per file
// (`D111`) and `run:end` carries that file's report, not the merged one; the merged report is
// read from the kept directory once the server says the run ended. Pure, so a test can hold it.

import type { ReportEntry, RunEvent, StepResult } from './contract';

export interface LiveTest {
  readonly file: string | undefined;
  readonly name: string;
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
      return { ...state, tests: [...state.tests, { file: event.file, name: event.name, steps: [], result: null }] };
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
