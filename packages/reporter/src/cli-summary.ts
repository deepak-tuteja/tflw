// A compact terminal summary of a run (SPEC §13). Secrets are already redacted in the report.

import { exhaustiveEntry, MIN_REDACTABLE_LENGTH, SCAN_KIND_LABEL, WITHHELD_LABEL } from '@tflw/runtime';
import type { CrawlResult, LoadDurationStats, LoadMetrics, RunReport, SelfDiagnosis, StepResult, TestResult, WorkloadTestResult } from '@tflw/runtime';
import { grantedProbeClauses } from './probe-clauses.js';
import { findingsSummaryLine, sortFindings } from './findings.js';
import { formatThresholdActual, formatThresholdTarget } from './threshold-format.js';
import { describeWorkload } from './workload-format.js';
import { noVerdictReason, runBadgeText, type NoVerdictReason } from './run-verdict.js';

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  /** `M159c` — the first non-red warning colour here. A runtime warning does not change the
   * verdict, and red on a passing test's line would say it did. */
  yellow: '\x1b[33m',
  bold: '\x1b[1m',
};

export function renderCliSummary(report: RunReport, color = true): string {
  const c = color ? C : { reset: '', dim: '', red: '', green: '', yellow: '', bold: '' };
  const lines: string[] = [];
  const noVerdict = noVerdictReason(report);
  for (const test of report.tests) {
    // D462 — exhaustive: the console summary is the surface a person actually reads, so an entry kind
    // this loop does not know about must be a compile error rather than a line that looks familiar.
    if (test.kind === 'workload') {
      lines.push(...workloadLines(test, c, noVerdict));
      continue;
    }
    if (test.kind === 'crawl') {
      lines.push(...crawlLines(test, c));
      continue;
    }
    if (test.kind !== 'functional') return exhaustiveEntry(test);
    lines.push(testLine(test, c));
    lines.push(...warningLines(test, c));
    lines.push(...failureLines(test, c));
  }
  const tally = `${report.passed}/${report.total} passed${report.failed ? `, ${report.failed} failed` : ''}`;
  // `FU-07` — three states, not two. `report.ok` alone said `PASS` over a run that was Ctrl-C'd
  // at 6s of a 30s plan; the `⚠ aborted` line four rows below is not where a skimming reader or a
  // log-scraping CI job looks. Same red as `FAIL`, because the one thing an aborted run is not is
  // a green one.
  const badgeText = runBadgeText(report);
  const badge = badgeText === 'PASS' ? `${c.green}${c.bold}PASS${c.reset}` : `${c.red}${c.bold}${badgeText}${c.reset}`;
  lines.push('');
  lines.push(`${badge} ${tally} ${c.dim}· env ${report.env} · seed ${report.seed} · now ${report.now} · ${report.durationMs} ms${c.reset}`);
  // Never a silent trade-off: `insecure true` disables TLS certificate verification for the whole
  // run (decision 78) — every summary says so, loudly, in red, not just in `tflw.config`.
  if (report.insecure) lines.push(`${c.red}${c.bold}⚠ insecure: true${c.reset}${c.dim} — TLS certificate verification was disabled for this run${c.reset}`);
  // M118 (`FU-04`, D202), same principle: this run proved something about tflw's own demo service
  // and nothing whatsoever about the reader's system. The quickstart's whole job is to produce a
  // green run in an empty directory, which makes it the one green run that must never be quotable.
  // `D785` (`M157d`) — any teardown level but `always` announces itself, on every run, on the
  // advisory channel (never the exit code). A config key is a footgun a flag is not: set to debug
  // one afternoon, committed, and every subsequent run leaks in silence. The line carries the
  // **count**, not just the mode — `0 of 8000` tells the operator the setting cost them nothing
  // this time, which is the whole reason to look. `M126`'s rule: the denominator is on the line.
  if (report.teardown) {
    const t = report.teardown;
    const iters = `${t.iterations} iteration${t.iterations === 1 ? '' : 's'}`;
    lines.push(
      t.level === 'never'
        ? `${c.dim}ℹ teardown: disabled (\`teardown never\`) — ${iters} left their data in place${c.reset}`
        : `${c.dim}ℹ teardown: on success — ${t.skipped} of ${iters} failed and left their data in place${c.reset}`,
    );
  }
  if (report.demo) lines.push(`${c.dim}ℹ demo: this run targeted tflw's built-in demo service, not a service of yours — point \`api\` at your own in tflw.config${c.reset}`);
  // `A12-01`, same principle one row down: a value declared secret but too short to substring-mask
  // safely (decision 64's `MIN_REDACTABLE_LENGTH`) ships in the clear. The floor is deliberate; the
  // silence was not. Naming the vars is the whole point — "some secret was too short" would send a
  // reader hunting through their env, and the value itself must obviously never be printed.
  if (report.unmaskableSecrets?.length) {
    const names = report.unmaskableSecrets.join(', ');
    lines.push(`${c.red}${c.bold}⚠ unmasked secret${report.unmaskableSecrets.length === 1 ? '' : 's'}: ${names}${c.reset}${c.dim} — shorter than ${MIN_REDACTABLE_LENGTH} characters, so too short to mask without corrupting unrelated report text; ${report.unmaskableSecrets.length === 1 ? 'its value appears' : 'their values appear'} in full above and in report.html${c.reset}`);
  }
  // D291 — the affirmation that permitted this run's security scans, printed beside the findings it
  // produced. Not a warning, so not red: a declared target is a run doing the right thing. It is
  // here because a scan's *result* and the claim that authorized it belong in the same artifact,
  // and the CLI summary is the artifact most runs are actually read from.
  for (const t of report.authorizedTargets ?? []) {
    // M134a — **every** granted sub-clause, not just `probe mutating`. The list is derived rather
    // than spelled out here for the reason D291 put the reason in the artifact in the first place:
    // a report that named two of three opt-ins would understate what this run was permitted to send,
    // and the understatement would be invisible to exactly the reader the line exists for.
    const probes = grantedProbeClauses(t);
    lines.push(`${c.dim}ℹ authorized target ${t.target} — ${t.reason}${c.reset}${probes.length ? `${c.dim} (${probes.join(', ')})${c.reset}` : ''}`);
  }
  // D331 — printed here, beside the claim that authorized the scans, because this is the sentence
  // that keeps the scans' *results* from being read as broader than they are. Not a warning and
  // not red: a suite with a small authorization footprint is not doing anything wrong, it is doing
  // something bounded, and the bound is the fact worth stating.
  lines.push(...scanBlindSpotLines(report, c));
  // M134b (D386/D387) — the run's security findings, and what the gate did with them. Printed
  // whenever any scan produced one, including on a green run: a finding the gate withheld still
  // happened, and a summary that showed only what failed would make `--baseline` invisible in
  // exactly the runs it is doing its work in.
  lines.push(...scanFindingLines(report, c));
  if (report.selfDiagnosis) lines.push(generatorLine(report.selfDiagnosis, c));
  if (report.inconclusive) lines.push(`${c.red}${c.bold}⚠ inconclusive${c.reset}${c.dim} — tflw itself is the bottleneck; workload numbers above reflect tflw contending with itself, not the system under test${c.reset}${backOffRelation(report, c)}`);
  if (report.aborted) lines.push(`${c.red}${c.bold}⚠ aborted${c.reset}${c.dim} — ${report.abortedMessage ?? 'stopped before its planned duration elapsed'}${c.reset}`);
  return lines.join('\n');
}

/**
 * M134b (D386/D387) — the findings tally, then one line per finding the gate withheld.
 *
 * **Gating findings are deliberately NOT listed here.** Each of them already failed its own
 * assertion, and that failure printed above with the full detail; repeating it would double every
 * security failure in the summary. What has no other voice is the withheld half — a finding that
 * happened, was reported, and did not fail the build. That is precisely the thing an operator must
 * be able to see, because it is the thing they turned off.
 */
function scanFindingLines(report: RunReport, c: typeof C): string[] {
  const findings = report.findings ?? [];
  if (!findings.length) return [];
  const lines: string[] = [`${c.dim}\u2139 ${findingsSummaryLine(findings)}${c.reset}`];
  for (const f of sortFindings(findings)) {
    if (!f.withheld) continue;
    const where = [f.endpoint, f.location].filter(Boolean).join(' \u00b7 ');
    lines.push(`${c.dim}  \u00b7 [${f.severity}] ${f.rule} \u2014 ${where} (${WITHHELD_LABEL[f.withheld]}${f.fingerprint ? `, ${f.fingerprint}` : ''})${c.reset}`);
  }
  return lines;
}

/**
 * D331's two lines: the suite's static bound, then this run's own declines.
 *
 * **The label says "of the suite's", never "of this run's"** — the census is computed over every
 * discovered file, before `--tags`/`--only`/`--failed` narrow anything, and a number whose base
 * silently moved with the filter is the next thing in this codebase that would read confidently and
 * mean something else. `M126`'s rule, applied: the denominator travels on the same line.
 *
 * The percentage is floored, not rounded — `41 of 1035` reads `3%`, not `4%`. A blind-spot figure
 * that rounds *up* toward coverage is the one direction this line must never fail in.
 */
function scanBlindSpotLines(report: RunReport, c: typeof C): string[] {
  const blind = report.scanBlindSpot;
  if (!blind) return [];
  const lines: string[] = [];
  const cov = blind.coverage;
  if (cov && cov.apiSteps > 0) {
    const pct = Math.floor((cov.withOwner / cov.apiSteps) * 100);
    lines.push(
      `${c.dim}ℹ authz coverage: ${cov.withOwner} of ${cov.apiSteps} api step${cov.apiSteps === 1 ? '' : 's'} in the suite sit in a test that declares an owner (${pct}%) — the rest are unjudgeable by \`authorization violations\`, which needs \`as <session>\` (SPEC §3.3)${c.reset}`,
    );
  }
  // D418a — the scan is named because two tiers now report here, and `shopper` refused for CSRF
  // and `traversal` never granted are different repairs. `SCAN_KIND_LABEL` rather than the raw key,
  // so the terminal, the HTML and SARIF cannot drift into three spellings of one tier.
  for (const d of blind.declines ?? []) {
    lines.push(`${c.dim}ℹ ${SCAN_KIND_LABEL[d.scan]} declined ${d.count}×: \`${d.subject}\` — ${d.reason}${c.reset}`);
  }
  return lines;
}

/** `FU-19` — the row filed "adjacent lines blaming opposite parties": a per-test back-off warning
 * ("the target slowed down") printed directly above the run-level saturation verdict ("tflw is the
 * bottleneck"). `M125a` failed to reproduce the pair across ten configurations and found out why —
 * throttling the target 8× drove generator CPU *down*, 36 % → 8-10 %, because a generator waiting
 * on a slow system is definitionally not saturated. Under a closed model the two conditions are
 * close to mutually exclusive, so the pair is rare rather than impossible.
 *
 * That measurement is what decides the wording. They are not contradictory and there is nothing to
 * reconcile: they are two readings of one overloaded machine, and the useful thing to say is which
 * of the two to believe. A saturated generator times its own requests badly, so the back-off
 * estimate is derived from numbers the saturation already distorted — the generator is the one to
 * fix first, and the target's verdict is not evidence until it has been re-measured with headroom.
 *
 * Emitted only when both actually fired, so the ordinary single-warning run reads exactly as before. */
function backOffRelation(report: RunReport, c: typeof C): string {
  const backedOff = report.tests.some((t) => t.kind === 'workload' && (t as WorkloadTestResult).backOff?.warning);
  if (!backedOff) return '';
  return `\n${c.dim}    ↳ a back-off warning above blames the target system instead — these are two readings of one overloaded machine, not a contradiction. Believe this line first: a saturated generator mistimes its own requests, so the back-off estimate is computed from numbers this saturation already distorted. Give tflw more headroom, re-run, and only then read the target's verdict.${c.reset}`;
}

/**
 * `M146a` (`B4-12`, `M113-02`) — the block that prints beneath a failing entry, in one place.
 *
 * It used to be two byte-identical copies, one in `renderCliSummary` and one in `crawlLines`, and
 * both indented only the **first** line of a detail. That was survivable while a detail was one
 * line; the pentest arc's scan listings made multi-line the common case, and a finding rendered at
 * column 2 inside a block indented to 6 reads as a new entry rather than as evidence for the one
 * above it. Splitting on newlines here is the whole fix, and it is one function so the two callers
 * cannot drift apart again.
 *
 * The `error` clause is `M113-02`: a test that died before any step ran has nothing to iterate, so
 * the loop printed the name and stopped. The reason was never missing — it reached `results.json`,
 * `report.html`, `junit.xml` and both ndjson streams — the console, the one surface a person is
 * actually watching while the command runs, was the only sink that dropped it. It renders **only**
 * when no failing step did, because a test that failed at a step already says why there; printing
 * both would duplicate the message rather than add to it.
 */
function failureLines(entry: { readonly ok: boolean; readonly steps: readonly StepResult[]; readonly error?: string }, c: typeof C): string[] {
  const lines: string[] = [];
  for (const step of entry.steps) {
    if (!step.ok) lines.push(`    ${c.red}✗ ${step.source}${c.reset}`, ...indentedBlock(step.detail, c));
  }
  if (!entry.ok && lines.length === 0) lines.push(...indentedBlock(entry.error, c));
  return lines;
}

/** One line per source line, every one of them at the detail column. Colour is re-opened per line
 * rather than spanning the block, so a pager or a `grep` that cuts the text mid-block cannot leave
 * a terminal holding an unterminated red. */
function indentedBlock(text: string | undefined, c: typeof C): string[] {
  if (!text) return [];
  return text.split('\n').map((line) => `      ${c.red}${line}${c.reset}`);
}

/** `D801`, `M159c` — runtime diagnostics under the test that raised them.
 *
 * Printed on a **passing** test as well as a failing one, which is the whole point: the condition
 * `TF080` reports is one a green run hides. It reads `warning[TF080]` because that is what the same
 * severity and code look like coming out of `tflw check` — a reader who has seen one has seen both,
 * and the string greps the same in a CI log.
 *
 * Yellow, not red: the verdict is unaffected. Red here would put a colour on a passing line that
 * every other part of this report reserves for failure. */
function warningLines(test: TestResult, c: typeof C): string[] {
  if (!test.warnings || test.warnings.length === 0) return [];
  return test.warnings.flatMap((w) => [
    `    ${c.yellow}⚠ warning[${w.code}]${c.reset}: ${w.message}`,
    `      ${c.dim}${w.line}: ${w.source.trim()}${c.reset}`,
  ]);
}

function testLine(test: TestResult, c: typeof C): string {
  const mark = test.ok ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
  const flaky = test.flaky ? ` ${c.dim}(flaky)${c.reset}` : '';
  return `  ${mark} ${test.name}${flaky}${attemptSuffix(test, c)} ${c.dim}(${test.durationMs} ms)${c.reset}`;
}

/**
 * `M137c` (`D435`) — a crawl's console lines: the verdict, then the surface, then the failures.
 *
 * **The surface line prints on a pass**, which is the whole reason this is not `testLine`. Every other
 * entry kind's console line answers *did it hold*, and for a crawl that answer is not the interesting
 * one: `✓ the v1 API surface` is equally true of a crawl that reached fifty-three routes and one that
 * reached two, and the console is where somebody notices. It reads as a subtraction on purpose —
 * discovered, then what came off it — because the numbers that matter here are the ones between what
 * the application documents and what tflw was able to judge.
 */
function crawlLines(crawl: CrawlResult, c: typeof C): string[] {
  const mark = crawl.ok ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
  const { discovered, withheld, sent, reached } = crawl.surface;
  const lines = [`  ${mark} ${crawl.name} ${c.dim}(crawl, ${crawl.durationMs} ms)${c.reset}`];
  const seeds = crawl.surface.seeds.map((s) => `${s.seed}${s.source ? ` "${s.source}"` : ''} → ${s.discovered}`).join(', ');
  // `M137f`/`D483` — the walk's own total, and it is rendered *only* when a spider ran. A zero here
  // for a crawl that never had a `spider` seed would read as a walk that found nothing, which is a
  // different fact from no walk at all. `TRUNCATED` is deliberately not dimmed: a capped walk is the
  // one number in this line a reader must not skim past, because every figure after it is a floor
  // rather than a total.
  const walk =
    crawl.surface.walked === undefined
      ? ''
      : ` · ${crawl.surface.walked} walked${crawl.surface.walkCapped ? `${c.reset}${c.bold} TRUNCATED at its cap${c.reset}${c.dim}` : ''}`;
  lines.push(`    ${c.dim}surface: ${discovered} discovered (${seeds}) · ${withheld} withheld · ${sent} sent · ${reached} reached${walk}${c.reset}`);
  lines.push(...failureLines(crawl, c));
  return lines;
}

/** `FU-25` — `(flaky)` only ever marks a *later-attempt pass*, so a test that exhausted its `retry`
 * budget failing every time printed exactly what a test that ran once and failed printed. Measured
 * on both: byte-identical lines, while `results.json` carried `attempts: 2` for one and no
 * `attempts` field at all for the other. The number was always there; the console just never read it.
 *
 * `attempts` is present only when more than one ran (`types.ts`), so its presence is the condition —
 * no `> 1` guard that could drift from the field's own meaning. Suppressed when `flaky` already
 * rendered, because "(flaky)" on a passing test is the same fact stated better: it says a retry
 * saved this test, where a bare count would only say retries happened. */
function attemptSuffix(test: TestResult, c: typeof C): string {
  if (!test.attempts || test.flaky) return '';
  return ` ${c.dim}(${test.attempts.length} attempts)${c.reset}`;
}

/** M56 (Phase 3, D122) — a workload test's console lines, folded into the one final summary
 * alongside functional ones instead of a separate `renderLoadSummary` block: name + ok/fail mark
 * + workload description, the same iterations/failures/error-rate/duration line the old
 * `renderLoadMetricsLine` printed per scenario, one tick-marked line per declared `threshold`
 * (empty when it declared none, matching `junit.ts`'s D119 "nothing to gate on" treatment), and a
 * per-endpoint breakdown (M43/D69) when there's more than one identity to break down. */
function workloadLines(test: WorkloadTestResult, c: typeof C, noVerdict: NoVerdictReason | null): string[] {
  // Not `✗` — a withdrawn verdict is not a failure, and marking it one would contradict the
  // `N/N passed` tally on the badge line, which still counts what `report.passed` says ran. The
  // dash is the same mark the thresholds below get, and means the same thing in both places.
  const mark = noVerdict !== null ? `${c.dim}–${c.reset}` : test.ok ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
  const lines = [`  ${mark} ${test.name} ${c.dim}(workload — ${describeWorkload(test.workload)})${c.reset}`, ...metricsLines(test.metrics, c)];
  for (const t of test.thresholds) {
    const cmp = t.op === 'lessThan' ? '<' : '>';
    // `FU-07`, and R11 one cause over: a threshold measured against a sample that was cut short
    // (aborted) or that tflw's own generator distorted (inconclusive) has no verdict to report, so
    // it gets neither tick. `junit.xml` renders exactly this case as `<skipped/>` — the three sinks
    // agree because they now ask the same function.
    const tickMark = noVerdict !== null ? `${c.dim}–${c.reset}` : t.ok ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
    const suffix = noVerdict !== null ? ` ${c.dim}— no verdict, run ${noVerdict}${c.reset}` : '';
    lines.push(`      ${tickMark} ${t.label} ${cmp} ${formatThresholdTarget(t)} ${c.dim}(actual: ${formatThresholdActual(t)})${c.reset}${suffix}`);
  }
  if (test.backOff?.warning) {
    const pct = (test.backOff.ratio * 100).toFixed(0);
    lines.push(`    ${c.red}⚠ your load backed off — an estimated ${pct}% of this test's available VU time was lost to the target system slowing down; results understate real latency${c.reset}`);
  }
  if (test.endpoints.length > 1) {
    lines.push(`    ${c.dim}endpoints:${c.reset}`);
    for (const e of test.endpoints) {
      const d = e.metrics.durations;
      lines.push(`      ${c.dim}${e.identity}: iterations ${e.metrics.iterations}  error rate ${(e.metrics.errorRate * 100).toFixed(2)}%  p50 ${d.p50}ms  p95 ${d.p95}ms  p99 ${d.p99}ms${c.reset}`);
    }
  }
  return lines;
}

function metricsLines(metrics: LoadMetrics, c: typeof C): string[] {
  // `M146b` (`B3-17`) — the assertion count sits on the same line as `iterations`, deliberately.
  // Every other figure here is a statement about the instrument: `iterations`, `failures` and
  // `errorRate` say that requests went out and came back, and they say it identically whether the
  // scenario asserted fifty things or nothing. Reading `assertions: 0` beside them is the one thing
  // that tells a person which of those two runs they are looking at. It is **not** dimmed away into
  // a footnote and not rendered only when zero: a count that appears only on the bad run is a count
  // nobody learns to read. `null` (endpoint scope) prints nothing — see `LoadMetrics.assertions`.
  const assertions = metrics.assertions === null ? '' : `  assertions: ${metrics.assertions}`;
  const lines = [`    ${c.dim}iterations: ${metrics.iterations}  failures: ${metrics.failures}${assertions}  error rate: ${(metrics.errorRate * 100).toFixed(2)}%${c.reset}`];
  // M89a (D-M89-0) — **both** populations, labelled. Thresholds read the successful-only line, so
  // that one is what an author needs to reconcile a verdict against; the all-iterations line stays
  // because it is the run that actually happened, and seeing the two diverge is itself the signal
  // that failures are fast (`B3-02`'s whole mechanism). When nothing failed they are identical and
  // the second line is suppressed — a run with no failures shouldn't pay for a distinction that
  // has no content in it.
  lines.push(`    ${c.dim}duration (ms, pause-excluded, all ${metrics.iterations}): ${durationDigits(metrics.durations)}${c.reset}`);
  if (metrics.failures > 0) {
    const s = metrics.successful;
    const detail = s.iterations === 0 ? 'none — every iteration failed, so thresholds on duration cannot be evaluated' : durationDigits(s.durations);
    lines.push(`    ${c.dim}duration (ms, successful ${s.iterations} — what thresholds read): ${detail}${c.reset}`);
  }
  return lines;
}

function durationDigits(d: LoadDurationStats): string {
  // `M160`/`D809`: every field here is already the rendered value — `summarizeHistogram` applies
  // the one rounding rule when it builds the report. `avg` used to be rounded right here, the
  // only field that needed it because it was the only float; that local `Math.round` is gone
  // rather than kept as a no-op, since below 10 ms it would round 0.37 back to 0.
  return `min ${d.min}  avg ${d.avg}  p50 ${d.p50}  p90 ${d.p90}  p95 ${d.p95}  p99 ${d.p99}  max ${d.max}`;
}

/** M31 (D19/D28): the generator's own event-loop-lag/CPU reading, once per run (not per workload
 * test — `SelfDiagnosis` is a run-level property). Healthy — dim, one line; saturated — the
 * "tflw itself is the bottleneck" warning D28 asks the report to say out loud. */
function generatorLine(d: SelfDiagnosis, c: typeof C): string {
  const stats = `avg event-loop lag ${d.avgEventLoopLagMs.toFixed(1)}ms  max ${d.maxEventLoopLagMs.toFixed(1)}ms  cpu ${d.cpuPercent.toFixed(0)}%`;
  if (!d.saturated) return `${c.dim}generator: ${stats}${c.reset}`;
  return `${c.red}${c.bold}⚠ tflw itself is the bottleneck${c.reset}${c.dim} (${stats}) — measured latency/throughput reflects tflw's own generator process, not your system under test${c.reset}`;
}
