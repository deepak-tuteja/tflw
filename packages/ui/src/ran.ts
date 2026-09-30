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

import type { RunReport, StepKind, StepResult } from './contract';
import type { Ran, RanIndex, Verdict } from './parts';

/* **`REPORT_LOOKBACK` IS GONE** — `M232` (`M213-19`, `D1271`).
 *
 * It capped how many reports were opened, newest first, looking for one that ran the open file,
 * and its own docblock said why it had to exist: *`ReportEntry` cannot answer the question* — its
 * `files` field was the artefacts in the directory, not the `.tflw` files the run executed, so
 * which tests a report held was only in its own `results.json`, 412 KB on this repository's own
 * fixture project.
 *
 * `ReportEntry.tests` answers it now, for no extra I/O at all: `listReports` already parsed every
 * `results.json` to build `summary`. So the two walks are filters, and a constant whose whole
 * justification was the cost of a search outlives the search by exactly nothing. Three was also a
 * **wrong answer** while it stood — a file not run in the last three runs showed no verdicts at
 * all, which reads identically to a file nobody has ever run.
 */

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
 * The play scratch for a file — `M221` `B` (`D1184`). The file's own directory, the given
 * basename. A path with no directory (a test at the project root) gets the basename alone.
 */
export function playScratchOf(path: string, basename: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? basename : `${path.slice(0, cut + 1)}${basename}`;
}

/**
 * **Whether a report entry is about this file** — either because it IS this file, or because it is
 * the scratch a ▶ copied this file into (`M221` `B`).
 *
 * The second case is not a widening of `sameFile`, which means what it says and is used elsewhere
 * to mean it. It is the pane's own question: `D1183` runs the buffer from a scratch beside the
 * file, so the newest run that is *about* what the author is looking at has the scratch's name on
 * it. The verdicts still join safely because the scratch is the buffer **verbatim** — identical
 * line numbers, identical line text — and `stillReads` compares the line's own source, never its
 * path.
 *
 * With no `playScratch` this is `sameFile` exactly, which is what every caller predating `M221`
 * gets.
 */
export function belongsTo(entryFile: string | undefined, path: string, playScratch?: string): boolean {
  if (sameFile(entryFile, path)) return true;
  return playScratch !== undefined && sameFile(entryFile, playScratchOf(path, playScratch));
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
/**
 * **What opens a verdict group** — `M220-02`, `M232` (`D1270`).
 *
 * This was `step.kind === 'api'` written inline, and the consequence was not that browser verdicts
 * were grouped badly: they were **dropped**. Nothing opened a group in a browser test, `open ===
 * null` skipped every step, and the map came back empty *by construction* — so the pane drew no
 * marks beside assertions whose status chip said they had run.
 *
 * The rule is the API door's own, stated once instead of twice: **a request groups the assertions
 * that read its response; an action groups the assertions that read the page it left.** So every
 * gesture that can change what the page says opens one.
 *
 * What is deliberately **not** here is as load-bearing as what is:
 *
 *  · `expect` and `check` are what a group *holds*, not what opens one.
 *  · `screenshot`, `stub`, `pause`, `log`, `let`, `capture`, `give`, `call` change nothing a later
 *    assertion reads, so opening a group on one would cut the previous action's group in half and
 *    strand its marks under a step that did not produce them.
 *  · `within` and `download` are blocks; the gesture inside them carries its own step.
 *  · `header`, `csrf` and `seed` are not test-body steps at all.
 *
 * Two shapes were refused. *The test is one group* — every mark in the test vanishes when any
 * character of the declaration line changes, and a mark stops saying which action produced what it
 * read. *Only a navigation opens one* — one `open` and twenty clicks collapse to a single group,
 * which is the shape `M220-02` is complaining about.
 */
export const OPENS_GROUP: ReadonlySet<StepKind> = new Set<StepKind>([
  'api',
  'open', 'click', 'fill', 'select', 'checkbox', 'uncheckbox', 'press',
  'hover', 'scroll', 'drag', 'dropFile', 'dialog', 'switchTab', 'closeTab',
]);

/**
 * **The group a statement's verdict lives in** — `M220-02`, `M232` (`D1270`).
 *
 * `ComposePane` found it by asking which **request** the statement is attached to, which is the
 * right question on the API door and unanswerable on every other one: a browser test has no
 * requests, so the lookup returned `null` and no mark was drawn — which is the half of `M220-02`
 * that `indexFromReport` alone does not fix. Populating the index and never reading it would have
 * closed the row on paper.
 *
 * So when there is no request, the group is the **nearest action at or above this statement**,
 * which is `indexFromReport`'s own rule read from the other end: an action groups the assertions
 * that read the page it left.
 *
 * **Bounded to the declaration**, because a group belongs to the test that produced it. Without
 * `declLine` a statement in a browser test with nothing above it would attach to the last action
 * of the *previous* declaration — a mark in exactly the place a mark belongs, about something
 * else, which is the failure `D1093` exists to refuse.
 */
export function groupFor(index: RanIndex, declLine: number, statementLine: number): Ran | null {
  let best: Ran | null = null;
  for (const [line, ran] of index) {
    if (line > statementLine || line < declLine) continue;
    if (best === null || line > best.line) best = ran;
  }
  return best;
}

export function indexFromReport(report: RunReport, path: string, bufferText: string, playScratch?: string): RanIndex {
  const lines = linesOf(bufferText);
  const out = new Map<number, Ran>();
  for (const entry of report.tests) {
    if (entry.kind !== 'functional' && entry.kind !== 'crawl') continue;
    if (!belongsTo(entry.file, path, playScratch)) continue;
    let open: { step: StepResult; verdicts: Map<number, Verdict>; screenshot: string | null } | null = null;
    const close = (): void => {
      if (open === null) return;
      const { step, verdicts, screenshot } = open;
      open = null;
      // **The request's own line is what the whole group hangs on.** If it has moved or been
      // retyped, the response is not about what is written there and neither is anything under it.
      if (!stillReads(lines, step.line, step.source)) return;
      out.set(step.line, ranOf(report, step, verdicts, screenshot, false));
    };
    for (const step of entry.steps) {
      // `M240-03` — a step of an action imported from another file is a line of *that* file. Before
      // the runtime said so it carried the caller's text at the action's line numbers, so
      // `stillReads` matched and an imported action's request drew its response on whatever line of
      // this buffer shared its number — `hook-first.tflw`'s `import` line, in the corpus.
      if (step.file !== undefined) continue;
      if (OPENS_GROUP.has(step.kind)) {
        close();
        open = { step, verdicts: new Map(), screenshot: step.screenshot?.base64 ?? null };
        continue;
      }
      if (open === null) continue;
      if (open.screenshot === null && step.screenshot !== undefined) open.screenshot = step.screenshot.base64;
      // Each statement is checked on its own, because each can move on its own: adding an
      // assertion to a request pushes the ones under it down by a line and leaves the request
      // where it was, which is exactly the shape tick-to-verify produces.
      if (stillReads(lines, step.line, step.source)) open.verdicts.set(step.line, verdictOf(step));
    }
    close();
  }
  return out;
}

/** One group, as the pane carries it — the two joins below build the same shape from the same
 *  step, so they cannot disagree about what a recorded response is. */
function ranOf(report: RunReport, step: StepResult, verdicts: ReadonlyMap<number, Verdict>, screenshot: string | null, changed: boolean): Ran {
  return {
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
            headers: step.response.headers,
          },
    evidence: report.evidenceLevel ?? null,
    changed,
    screenshot,
  };
}

/**
 * **What the last run recorded for one step, even when its text has changed since** — `M256` `B`
 * (`D1406`).
 *
 * The evidence column opens on the last run, so a picked request shows what came back for it
 * without a send. `indexFromReport` is the wrong instrument for that and deliberately so: it drops
 * a group whose opening line no longer reads what ran, because every verdict under it would be a
 * claim about words nobody ran. A response is a different kind of claim — *this is what came back
 * the last time this step ran* — and an author who has just retyped a path is exactly the reader
 * who wants to see the old answer beside the new question. So this looks in three places, in the
 * order they are trustworthy, and says which one it found:
 *
 *  1. **the step's own line, still reading what ran** — the same answer `indexFromReport` gives;
 *  2. **the step's text, on another line** — a request that moved because something above it was
 *     added is the same step, keyed on its words and not its line (`D1406`'s own wording), and is
 *     not flagged; it answers only when exactly one recorded step reads those words, because two
 *     identical requests in one file are two steps and a join cannot tell which is which;
 *  3. **the step's own line, reading something else** — the step has been edited since, and the
 *     response comes back with `changed` set so the column can say so (`⚠ this step changed
 *     since · send to refresh`).
 *
 * `null` when none of the three holds: the step has not run, or has moved *and* changed, which is
 * a new step as far as any evidence can tell.
 */
export function evidenceFor(report: RunReport, path: string, bufferText: string, line: number, playScratch?: string): Ran | null {
  const lines = linesOf(bufferText);
  const text = lines[line - 1] ?? '';
  let byLine: Ran | null = null;
  const byText: Ran[] = [];
  for (const entry of report.tests) {
    if (entry.kind !== 'functional' && entry.kind !== 'crawl') continue;
    if (!belongsTo(entry.file, path, playScratch)) continue;
    const steps = entry.steps.filter((s) => s.file === undefined);
    for (const [i, step] of steps.entries()) {
      if (!OPENS_GROUP.has(step.kind)) continue;
      const atLine = step.line === line;
      const sameText = text !== '' && step.source.trim() === text;
      if (!atLine && !sameText) continue;
      /* The group's screenshot, read to the next opener — the same extent `indexFromReport` gives
         it. Verdicts are not carried: see `Ran.changed`. */
      let screenshot = step.screenshot?.base64 ?? null;
      for (const later of steps.slice(i + 1)) {
        if (OPENS_GROUP.has(later.kind)) break;
        if (screenshot === null && later.screenshot !== undefined) screenshot = later.screenshot.base64;
      }
      if (atLine && sameText) return { ...ranOf(report, step, new Map(), screenshot, false), line };
      if (sameText) byText.push({ ...ranOf(report, step, new Map(), screenshot, false), line });
      else if (byLine === null) byLine = ranOf(report, step, new Map(), screenshot, true);
    }
  }
  if (byText.length === 1) return byText[0]!;
  return byLine;
}

/**
 * A send's responses, joined to the buffer — `D1099`'s second scope, widened by `M225` `A`
 * (`D1216`).
 *
 * **A send indexes every request it issued, not one.** It used to take the *last* `api` step in
 * the report and record it against the one line the pane was pointing at, which was true of the
 * one press that existed: `send this` shows one response. It is false of `send all`, and it was
 * already lossy for `send this`, whose prefix issues more than one request and only ever recorded
 * the last.
 *
 * **THE JOIN IS BY THE SCRATCH'S OWN LINE, NOT BY POSITION IN THE REPORT**, and that is the half
 * worth stating. The plan said *by position from the first*, and position from either end is
 * wrong for a reason the runtime settles: a `before each` hook's steps are inside the test's own
 * step list (`interpreter.ts`'s `runTestAttemptBody` pushes them there) and an `after each`'s are
 * after them, so neither end of the list is reliably the declaration's. What is reliable is that
 * the caller PRINTED the scratch and can parse it back: `lines` maps the scratch line a request
 * was printed on to the buffer line it came from, and a step whose line is not a key is a hook's
 * and is skipped rather than mis-attributed. Amended in `PLAN_M225_SEND_AND_COMPOSER.md` §3
 * rather than done quietly.
 *
 * The scratch carries no assertions, so each `Ran` has an empty verdict map — see the note below.
 */
export function indexFromSend(args: {
  readonly steps: readonly StepResult[];
  /** Scratch line → buffer line, for the declaration's own requests. */
  readonly lines: ReadonlyMap<number, number>;
  readonly bufferText: string;
  readonly startedAt: string;
}): RanIndex {
  const lines = linesOf(args.bufferText);
  const out = new Map<number, Ran>();
  for (const step of args.steps) {
    if (step.kind !== 'api' || step.file !== undefined) continue;
    const at = args.lines.get(step.line);
    if (at === undefined) continue;
    out.set(at, {
      line: at,
      source: lines[at - 1] ?? '',
      scope: 'send',
      at: args.startedAt,
      /**
       * **A send carries no verdicts, because it ran no assertions** (`M215` `A1`, amending
       * `D1108`).
       *
       * This used to map the report's steps after the request onto the buffer's attached lines by
       * position and show a ✓ or a ✗ beside each. It cannot any more and should not:
       * `withoutAssertions` takes every `expect` out of the scratch, so the steps that follow a
       * request are its captures, and pairing those with assertion rows by position would put a
       * mark on a row nothing graded.
       *
       * `D1108`'s rule — *a verdict is shown where the buffer's line still reads what ran on it* —
       * is unchanged and still governs the other scope. What changed is which scopes produce a
       * verdict at all: a run does, a send does not. The response is the send's whole answer.
       */
      steps: new Map(),
      response:
        step.response === undefined
          ? null
          : {
              status: step.response.status,
              url: step.request?.url ?? '',
              method: step.request?.method ?? '',
              bodyText: step.response.bodyText,
              headers: step.response.headers,
            },
      // A send is `--evidence full` by construction (`sendPrefix`), and is about the buffer as it
      // was pressed — so its level is the full one and nothing about it has changed yet.
      evidence: 'full',
      changed: false,
      screenshot: null,
    });
  }
  return out;
}
