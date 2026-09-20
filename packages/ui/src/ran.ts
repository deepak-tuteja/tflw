// Joining a run's verdicts to the file on screen — `M213` `S2` (`D1093`, `D1099`, `D1108`).
//
// THE REPORT IS LINE-ADDRESSED AND THE PANE IS LINE-ADDRESSED, AND NOTHING HAD JOINED THEM.
// `StepResult` has carried `source`, `line`, `ok` and `durationMs` since the runtime's first
// milestone; `ComposePane` draws a row per statement with a line on it. The only thing that ever
// crossed between them was `M210` `S6`'s send, positionally, for one request, for as long as you
// did not type.
//
// **A LINE NUMBER IS THE MOST FRAGILE JOIN KEY THERE IS**, which is `D1093` verbatim: insert one
// request at the top of a test and every verdict below it attaches to the wrong row — and attaches
// *plausibly*, because the rows below a request are assertions and an assertion is where a ✓ is
// supposed to be. Nothing about the picture would look wrong.
//
// SO THE KEY IS `(line, source)` AND NOT `line` (`D1108`). Every `StepResult` carries the line it
// ran **and the text that was on it**, trimmed — `interpreter.ts` reads it straight out of the
// file it ran. So this module does not have to trust the line: it checks it. A verdict is shown
// where the buffer's line `n` still reads exactly what ran on line `n`, and nowhere else.
//
// That check is what makes the whole `D1099` arrangement safe rather than merely convenient. A
// report on disk may be four days old and the file may have been rewritten twice since; the join
// does not care how old it is, because it re-establishes the claim against the bytes in front of
// the reader every time it runs. And it is what makes tick-to-verify usable: writing an assertion
// *under* a request leaves that request's own line where it was, so the response you ticked is
// still there when the file comes back — while every row below the insertion has moved, and every
// one of those verdicts is correctly dropped rather than shifted by one.

import type { RunReport, StepResult } from './contract';
import type { Ran, RanIndex, Verdict } from './parts';

/**
 * How many reports are opened, newest first, looking for one that ran the open file.
 *
 * **A cap exists because `ReportEntry` cannot answer the question** (`M213-19`): its `files` field
 * is the artefacts in the directory, not the `.tflw` files the run executed, so which tests a
 * report holds is only in its own `results.json` — 412 KB on this repository's own fixture
 * project. Three is the depth at which *the last run, the one before it, and the one before that*
 * stops being a useful answer and starts being a search: a file that has not been run in three
 * runs is a file whose last verdict is not evidence about now anyway.
 */
export const REPORT_LOOKBACK = 3;

/** The buffer's lines, trimmed, 1-based — the shape `StepResult.source` is recorded in. */
function linesOf(text: string): readonly string[] {
  return text.split('\n').map((l) => l.trim());
}

/** True when the buffer's line `line` still reads exactly what ran on it. Out-of-range is false,
 *  which is the right answer: a file that has lost the line cannot be showing that verdict. */
function stillReads(lines: readonly string[], line: number, source: string): boolean {
  return line >= 1 && line <= lines.length && lines[line - 1] === source.trim();
}

function verdictOf(step: StepResult): Verdict {
  return {
    ok: step.ok,
    // The report's own sentence, never a second one written here — `detail` is what the run wrote
    // (`status = 200`, `orderId = 42 (captured)`, or why it failed).
    detail: step.detail ?? step.source,
    source: step.source,
    durationMs: step.durationMs,
  };
}

/**
 * Does this report entry belong to the open file?
 *
 * `TestResult.file` is relative to the **run's** cwd and the UI's path is relative to the
 * **project root**, and those are the same directory in every arrangement the server serves — but
 * they are not the same *string* when one carries a `./`. So the comparison is on normalised
 * path text, and it is a suffix match in the one direction that cannot be wrong: a report entry
 * for `tests/checkout.tflw` answers for the open `tests/checkout.tflw`, and never the other way
 * round, so a file named `out.tflw` cannot claim the verdicts of `checkout.tflw`.
 */
export function sameFile(entryFile: string | undefined, path: string): boolean {
  if (entryFile === undefined) return false;
  const a = entryFile.replace(/^\.\//, '');
  const b = path.replace(/^\.\//, '');
  if (a === b) return true;
  return a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

/**
 * Every request's last verdicts and response, read off a report already on disk — `D1099`'s
 * default scope, which costs one fetch for a whole file and no run at all.
 *
 * **THE GROUPING IS THE PANE'S OWN, ARRIVED AT INDEPENDENTLY.** `outline.ts` groups a body by
 * *a request and the statements between it and the next one*; the report's step list has exactly
 * that shape for the same reason — both are reading the same file in the same order. So a group
 * here opens at each `api` step and runs to the one before the next, which needs no knowledge of
 * the outline and produces keys the outline's own rows look up directly.
 *
 * `wait until api` issues a request too and `outline.ts` treats it as one; its nested expects are
 * inside its block and carry no step of their own in the report, so such a group is a response
 * with no verdicts under it. That is the truth about it, not a gap.
 */
export function indexFromReport(report: RunReport, path: string, bufferText: string): RanIndex {
  const lines = linesOf(bufferText);
  const out = new Map<number, Ran>();
  for (const entry of report.tests) {
    if (entry.kind !== 'functional' && entry.kind !== 'crawl') continue;
    if (!sameFile(entry.file, path)) continue;
    let open: { step: StepResult; verdicts: Map<number, Verdict> } | null = null;
    const close = (): void => {
      if (open === null) return;
      const { step, verdicts } = open;
      open = null;
      // **The request's own line is what the whole group hangs on.** If it has moved or been
      // retyped, the response is not about what is written there and neither is anything under it.
      if (!stillReads(lines, step.line, step.source)) return;
      out.set(step.line, {
        line: step.line,
        source: step.source,
        scope: 'run',
        at: report.startedAt,
        steps: verdicts,
        response:
          step.response === undefined
            ? null
            : {
                status: step.response.status,
                url: step.request?.url ?? '',
                method: step.request?.method ?? '',
                bodyText: step.response.bodyText,
              },
      });
    };
    for (const step of entry.steps) {
      if (step.kind === 'api') {
        close();
        open = { step, verdicts: new Map() };
        continue;
      }
      if (open === null) continue;
      // Each statement is checked on its own, because each can move on its own: adding an
      // assertion to a request pushes the ones under it down by a line and leaves the request
      // where it was, which is exactly the shape tick-to-verify produces.
      if (stillReads(lines, step.line, step.source)) open.verdicts.set(step.line, verdictOf(step));
    }
    close();
  }
  return out;
}

/**
 * One request's **response** from a scoped send — `D1099`'s second scope, narrowed by `M215` `A1`.
 *
 * **The send runs a printed scratch, so its line numbers are not this file's** and `indexFromReport`
 * cannot be pointed at it. What holds the two together is the order: the scratch is this
 * declaration cut off after the selected request, so its last `api` step is that request.
 *
 * The scratch carries no assertions any more, so there is nothing after that step to grade and
 * this returns a `Ran` with an empty verdict map — see the note on `steps` below.
 */
export function indexFromSend(args: {
  readonly steps: readonly StepResult[];
  readonly requestLine: number;
  readonly bufferText: string;
  readonly startedAt: string;
}): Ran | null {
  const lines = linesOf(args.bufferText);
  let from = -1;
  for (const [i, step] of args.steps.entries()) if (step.kind === 'api') from = i;
  if (from < 0) return null;
  const request = args.steps[from]!;
  return {
    line: args.requestLine,
    source: lines[args.requestLine - 1] ?? '',
    scope: 'send',
    at: args.startedAt,
    /**
     * **A send carries no verdicts, because it ran no assertions** (`M215` `A1`, amending `D1108`).
     *
     * This used to map the report's steps after the request onto the buffer's attached lines by
     * position and show a ✓ or a ✗ beside each. It cannot any more and should not: `withoutAssertions`
     * takes every `expect` out of the scratch, so the steps that follow a request are its captures,
     * and pairing those with assertion rows by position would put a mark on a row nothing graded.
     *
     * `D1108`'s rule — *a verdict is shown where the buffer's line still reads what ran on it* —
     * is unchanged and still governs the other scope. What changed is which scopes produce a
     * verdict at all: a run does, a send does not. The response is the send's whole answer.
     */
    steps: new Map(),
    response:
      request.response === undefined
        ? null
        : {
            status: request.response.status,
            url: request.request?.url ?? '',
            method: request.request?.method ?? '',
            bodyText: request.response.bodyText,
          },
  };
}
