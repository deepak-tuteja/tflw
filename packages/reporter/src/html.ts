// Render a RunReport into report.html (SPEC §13): a step timeline that mirrors the source, req/res
// panels per API step, failures shown as source line + message. Secrets are already redacted in
// the report data (interpreter, P#30) — this file only escapes.
//
// M3c (D12): a run with no screenshots/traces still renders the exact same single self-contained
// file as before. `assetHrefs` (from `resolveReportAssets`, assets.ts) names which screenshots and
// traces were written out to `report/assets/` instead of inlined — this function stays pure (no
// I/O) by taking that decision as data rather than making it itself.
//
// M56 (Phase 3, D120) folds in what was the separate `load-html.ts`/`load-report.html`: a
// `WorkloadTestResult` entry renders through `renderWorkloadTest` below, reusing
// `renderMetricsSection`/`renderThresholdsTable`/`renderEndpointsSection` (moved in verbatim) and
// `load-charts.ts`'s chart functions (unchanged, already pure/per-block) — one entry, one panel,
// same sidebar/tab mechanism a functional test already used.

import type { AttemptResult, BackOffDiagnosis, LoadMetrics, LoadScenarioReport, LoadThresholdResult, LogLevel, ReportEntry, RequestTrace, ResponseTrace, RunReport, SelfDiagnosis, StepResult, TestResult, WorkloadTestResult } from '@tflw/runtime';
import { LOG_LEVEL_ORDER, MIN_REDACTABLE_LENGTH } from '@tflw/runtime';
import { assetHash } from './assets.js';
import { esc } from './escape.js';
import { fileOf, groupByFile } from './group-by-file.js';
import { describeWorkload } from './workload-format.js';
import { CHART_STYLE, renderErrorRateChart, renderHistogramChart, renderLatencyOverTimeChart, renderThroughputChart } from './load-charts.js';
import { formatThresholdActual, formatThresholdTarget } from './threshold-format.js';
import { runBadgeText } from './run-verdict.js';

/** A test's slot in the sidebar tree + `<main>`'s panel list — computed once, shared by both. */
interface TestSlot {
  readonly id: string;
  readonly file: string;
  readonly test: ReportEntry;
}

export function renderReportHtml(report: RunReport, assetHrefs: ReadonlyMap<string, string> = new Map(), logLevelThreshold: LogLevel = 'debug'): string {
  const title = `testFlow report — ${report.passed}/${report.total} passed`;
  const slots: TestSlot[] = report.tests.map((test, i) => ({ id: `t${i}`, file: fileOf(test), test }));
  const groups = groupByFile(slots, (s) => s.file);

  const firstFailing = slots.find((s) => !s.test.ok);
  const defaultActiveId = (firstFailing ?? slots[0])?.id;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}${CHART_STYLE}</style>
</head>
<body>
<header class="run ${runBadgeText(report) === 'PASS' ? 'ok' : 'fail'}">
  <h1>testFlow report</h1>
  <div class="meta">
    <span class="badge ${runBadgeText(report) === 'PASS' ? 'ok' : 'fail'}">${runBadgeText(report)}</span>
    <span>${report.passed}/${report.total} passed${report.failed ? ` · ${report.failed} failed` : ''}</span>
    <span>env <code>${esc(report.env)}</code></span>
    <span>seed <code>${report.seed}</code></span>
    <span>now <code>${esc(report.now)}</code></span>
    <span>${report.durationMs} ms</span>
    <span>${esc(report.startedAt)}</span>
  </div>
  ${report.insecure ? '<div class="insecure-warning">⚠ insecure: true — TLS certificate verification was disabled for this run</div>' : ''}
  ${renderUnmaskableWarning(report.unmaskableSecrets)}
  ${report.browserEngine ? `<div class="engine-badge">browser <code>${esc(report.browserEngine)}</code></div>` : ''}
  ${report.aborted ? `<div class="insecure-warning">⚠ ${esc(report.abortedMessage ?? 'aborted before its planned duration elapsed')} — every workload number below reflects only what completed before Ctrl-C.</div>` : ''}
  ${report.inconclusive ? '<div class="insecure-warning">⚠ tflw\'s own generator process saturated during this run — see any workload test\'s "generator" line below. These workload numbers reflect tflw contending with itself, not the system under test.</div>' : ''}
</header>
<div class="layout">
${renderSidebar(groups)}
<main>
${slots.map((s) => renderTest(s, s.id === defaultActiveId, assetHrefs, logLevelThreshold, report.selfDiagnosis)).join('\n')}
</main>
</div>
<footer>${renderFooter(report, assetHrefs)}</footer>
<script>${SCRIPT.replace('__DEFAULT_ID__', defaultActiveId ?? '')}</script>
</body>
</html>
`;
}

/**
 * FS-01 (review finding V2-01/FU-01) — the footer describes what this file actually contains
 * instead of asserting a fixed claim about it.
 *
 * It used to be the string literal *"report.html is self-contained and safe to attach to a
 * ticket."* Both halves could be false at once. **Safe** was false whenever the run captured
 * anything: at the default `evidence full` the file embeds whole response bodies and page
 * screenshots, and the fresh-user pass found 24 live JWTs sitting directly above that sentence.
 * **Self-contained** was false whenever an asset was large enough to be written out to
 * `assets/` instead of inlined (assets.ts) — from then on the file is one part of a directory.
 *
 * The replacement makes no promise at all; it lists what is in the file and lets the reader decide,
 * which is the only claim a report generator is in a position to make. A run that captured nothing
 * still gets a positive statement of that fact — "no bodies, screenshots or traces" is the
 * reassurance the old sentence was reaching for, and unlike the old sentence it is checkable.
 */
function renderFooter(report: RunReport, assetHrefs: ReadonlyMap<string, string>): string {
  const level = report.evidenceLevel ?? 'full';
  const contents: string[] = [];

  // What an API step contributes is exactly what the evidence level let through (interpreter's
  // `redactRequest`/`redactResponse`), so it is named at that granularity rather than lumped
  // together as "traces" — at `none` a reader learns the file holds URLs and nothing else.
  if (anyStep(report, (s) => s.request !== undefined)) {
    if (level === 'full') contents.push('request and response bodies');
    else if (level === 'headers-only') contents.push('request and response headers');
    else contents.push('request URLs and status codes');
  }
  // Below `evidence full` these are never captured at all (FS-01), so any of them appearing here
  // means the run really did run at `full`.
  if (anyStep(report, (s) => s.screenshot !== undefined || s.snapshotDiff !== undefined)) contents.push('page screenshots');
  if (report.tests.some((t) => t.kind === 'functional' && (t.trace !== undefined || (t.attempts ?? []).some((a) => a.trace !== undefined)))) {
    contents.push('browser trace archives');
  }

  const evidence = `evidence <code>${esc(level)}</code>`;
  const body =
    contents.length === 0
      ? `${evidence} — this report contains no request/response bodies, screenshots or traces.`
      : `${evidence} — this report contains ${joinWithAnd(contents)}. Review it before attaching to a ticket.`;
  // Only the *linked* case is worth calling out: an inlined asset is still one file, while a linked
  // one means `report.html` alone is incomplete — the exact thing "self-contained" got wrong.
  const packaging = assetHrefs.size > 0 ? ' Some assets live beside it in <code>assets/</code> — copy the whole report directory, not just this file.' : '';
  return `Generated by testFlow · ${body}${packaging}`;
}

function anyStep(report: RunReport, pred: (s: StepResult) => boolean): boolean {
  return report.tests.some((t) => {
    if (t.kind !== 'functional') return false;
    return t.steps.some(pred) || (t.attempts ?? []).some((a) => a.steps.some(pred));
  });
}

function joinWithAnd(parts: readonly string[]): string {
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]!}`;
}

/** `A12-01` — the report-header half of the CLI summary's `⚠ unmasked secret(s)` line. This file is
 * the artifact that gets attached to a ticket, so it is the one place the warning matters most: a
 * reader deciding whether `report.html` is safe to share needs to be told, in the header, that a
 * value the run was told to treat as a secret is sitting in the page in the clear. Names only —
 * printing the value here would be the very leak being warned about, twice over. */
function renderUnmaskableWarning(names: readonly string[] | undefined): string {
  if (!names?.length) return '';
  const plural = names.length === 1 ? '' : 's';
  const rendered = joinWithAnd(names.map((n) => `<code>${esc(n)}</code>`));
  return `<div class="insecure-warning">⚠ unmasked secret${plural}: ${rendered} — shorter than ${MIN_REDACTABLE_LENGTH} characters, so too short to mask without corrupting unrelated text in this report. ${names.length === 1 ? 'Its value appears' : 'Their values appear'} below in full.</div>`;
}

function renderSidebar(groups: ReadonlyMap<string, TestSlot[]>): string {
  return `<nav class="sidebar">
  <div class="filterbar">
    <input type="search" id="tf-filter" placeholder="filter tests…" autocomplete="off">
    <div class="statusfilter" id="tf-statusfilter">
      <button type="button" data-status="all" class="active">All</button>
      <button type="button" data-status="fail">Failed</button>
      <button type="button" data-status="ok">Passed</button>
    </div>
  </div>
  <div class="tree">
${[...groups.entries()].map(([file, slots]) => renderFileGroup(file, slots)).join('\n')}
  </div>
</nav>`;
}

function renderFileGroup(file: string, slots: readonly TestSlot[]): string {
  const failed = slots.filter((s) => !s.test.ok).length;
  const status = failed > 0 ? 'fail' : 'ok';
  return `    <details class="filegroup ${status}"${failed > 0 ? ' open' : ''} data-file="${esc(file)}">
      <summary><span class="fgdot ${status}"></span><span class="fgname">${esc(file)}</span><span class="fgcount">(${slots.length}${failed > 0 ? `, ${failed} failed` : ''})</span></summary>
      <ul class="testlist">
${slots.map((s) => renderTestLink(s)).join('\n')}
      </ul>
    </details>`;
}

function renderTestLink(slot: TestSlot): string {
  const status = slot.test.ok ? 'ok' : 'fail';
  return `        <li><button type="button" class="testlink ${status}" data-target="${slot.id}">${slot.test.ok ? '✓' : '✗'} ${esc(slot.test.name)}</button></li>`;
}

function renderTest(slot: TestSlot, active: boolean, assetHrefs: ReadonlyMap<string, string>, logLevelThreshold: LogLevel, selfDiagnosis?: SelfDiagnosis): string {
  return slot.test.kind === 'workload'
    ? renderWorkloadTest(slot, active, selfDiagnosis)
    : renderFunctionalTest(slot, slot.test, active, assetHrefs, logLevelThreshold);
}

/** D115 — same inline-badge pattern as the existing `flaky` badge, for any entry (functional or
 * workload) whose `TestDecl` declared `parallel` (M56). */
function parallelBadge(concurrency: 'parallel' | 'sequential' | undefined): string {
  return concurrency === 'parallel' ? ' <span class="parallel">parallel</span>' : '';
}

function renderFunctionalTest(slot: TestSlot, test: TestResult, active: boolean, assetHrefs: ReadonlyMap<string, string>, logLevelThreshold: LogLevel): string {
  const priorAttempts = test.attempts ? test.attempts.slice(0, -1) : [];
  return `<section class="test ${test.ok ? 'ok' : 'fail'}${active ? ' active' : ''}" id="${slot.id}" data-file="${esc(slot.file)}">
  <h2><span class="dot ${test.ok ? 'ok' : 'fail'}"></span>${esc(test.name)}${test.flaky ? ' <span class="flaky">flaky</span>' : ''}${parallelBadge(test.concurrency)} <span class="tms">${test.durationMs} ms</span></h2>
  ${test.error ? `<p class="error">${esc(test.error)}</p>` : ''}
  ${priorAttempts.map((a) => renderAttempt(a, assetHrefs, logLevelThreshold)).join('\n')}
  ${test.attempts ? `<p class="attempt-final-label"><span class="attempt-badge ok">attempt ${test.attempts.length} of ${test.attempts.length} — passed</span></p>` : ''}
  ${renderTraceLink(test.trace, assetHrefs)}
  <ol class="steps">
${test.steps.map((s) => renderStep(s, assetHrefs, logLevelThreshold)).join('\n')}
  </ol>
</section>`;
}

/** M56 (Phase 3, D120) — a workload test's panel: the workload description in place of a duration
 * badge (no single "this took Nms" figure applies — a workload's declared span is *planned*, not
 * an outcome), then metrics/thresholds/charts reusing the same building blocks `load-report.html`
 * (pre-M56) rendered a whole scenario section with. `selfDiagnosis` (run-level, not per-test) is
 * shown once per workload panel rather than hoisted into the header — a reader looking at *this*
 * test's numbers gets the generator-health context right next to them. */
function renderWorkloadTest(slot: TestSlot, active: boolean, selfDiagnosis?: SelfDiagnosis): string {
  const test = slot.test as WorkloadTestResult;
  return `<section class="test ${test.ok ? 'ok' : 'fail'}${active ? ' active' : ''}" id="${slot.id}" data-file="${esc(slot.file)}">
  <h2><span class="dot ${test.ok ? 'ok' : 'fail'}"></span>${esc(test.name)}${parallelBadge(test.concurrency)} <span class="tms">workload</span></h2>
  ${selfDiagnosis ? renderGeneratorLine(selfDiagnosis) : ''}
  ${renderMetricsSection(test.workload, test.metrics, test.thresholds, test.backOff)}
  ${renderEndpointsSection(test.endpoints)}
</section>`;
}

function renderGeneratorLine(d: SelfDiagnosis): string {
  const stats = `avg event-loop lag ${d.avgEventLoopLagMs.toFixed(1)}ms · max ${d.maxEventLoopLagMs.toFixed(1)}ms · cpu ${d.cpuPercent.toFixed(0)}%`;
  return `<p class="generator-line ${d.saturated ? 'saturated' : ''}">${d.saturated ? `⚠ generator: ${esc(stats)} — tflw itself was the bottleneck` : `generator: ${esc(stats)}`}</p>`;
}

/** Moved from `load-html.ts` (M56, D120) — unchanged besides dropping the `heading`/`workload`-
 * label params `load-report.html` needed for its per-scenario/per-endpoint sections; here the
 * enclosing `<h2>` already names the test, and `renderEndpointsSection` calls this once per
 * endpoint with no workload description of its own. */
function renderMetricsSection(workload: LoadScenarioReport['workload'] | undefined, metrics: LoadMetrics, thresholds: readonly LoadThresholdResult[], backOff?: BackOffDiagnosis): string {
  const d = metrics.durations;
  return `<div class="metrics-block">
  ${workload ? `<p class="workload">${esc(describeWorkload(workload))}</p>` : ''}
  <table class="stats">
    <tr><th>iterations</th><td>${metrics.iterations}</td><th>failures</th><td>${metrics.failures}</td><th>error rate</th><td>${(metrics.errorRate * 100).toFixed(2)}%</td></tr>
    <tr><th>min</th><td>${d.min}ms</td><th>avg</th><td>${Math.round(d.avg)}ms</td><th>max</th><td>${d.max}ms</td></tr>
    <tr><th>p50</th><td>${d.p50}ms</td><th>p90</th><td>${d.p90}ms</td><th>p95</th><td>${d.p95}ms</td><th>p99</th><td>${d.p99}ms</td></tr>
  </table>
  ${backOff?.warning ? `<p class="backoff-warning">⚠ your load backed off — an estimated ${(backOff.ratio * 100).toFixed(0)}% of this scenario's available VU time was lost to the target system slowing down; results understate real latency (coordinated omission, D17)</p>` : ''}
  ${renderThresholdsTable(thresholds)}
  <div class="charts">
    ${renderLatencyOverTimeChart(metrics.timeline)}
    ${renderThroughputChart(metrics.timeline)}
    ${renderErrorRateChart(metrics.timeline)}
    ${renderHistogramChart(metrics.histogram)}
  </div>
</div>`;
}

/** Moved from `load-html.ts` (M56, D120) — unchanged. One collapsed `<details>` per endpoint
 * identity (M43, D69), only when there's more than one to break down. */
function renderEndpointsSection(endpoints: WorkloadTestResult['endpoints']): string {
  if (endpoints.length === 0) return '';
  const rows = endpoints
    .map(
      (e) =>
        `<details class="endpoint"><summary>${esc(e.identity)} — ${e.metrics.iterations} iterations, p95 ${e.metrics.durations.p95}ms, ${(e.metrics.errorRate * 100).toFixed(2)}% errors</summary><h4>${esc(e.identity)}</h4>${renderMetricsSection(undefined, e.metrics, [])}</details>`,
    )
    .join('\n');
  return `<div class="endpoints"><h3>Endpoints</h3>${rows}</div>`;
}

function renderThresholdsTable(thresholds: readonly LoadThresholdResult[]): string {
  if (thresholds.length === 0) return '';
  const rows = thresholds
    .map((t) => {
      const cmp = t.op === 'lessThan' ? '&lt;' : '&gt;';
      return `<tr class="${t.ok ? 'ok' : 'fail'}"><td>${t.ok ? '✓' : '✗'}</td><td>${esc(t.label)} ${cmp} ${esc(formatThresholdTarget(t))}</td><td>actual: ${esc(formatThresholdActual(t))}</td></tr>`;
    })
    .join('');
  return `<table class="thresholds">${rows}</table>`;
}

/** A failed prior `retry` attempt, rendered as a collapsed native `<details>` block above the
 * final (kept) attempt's already-visible steps — no JavaScript, so the report stays self-contained
 * (PLAN decision 86, closing SPEC §4.4's known evidence gap). */
function renderAttempt(attempt: AttemptResult, assetHrefs: ReadonlyMap<string, string>, logLevelThreshold: LogLevel): string {
  return `<details class="attempt">
    <summary><span class="attempt-badge fail">attempt ${attempt.attempt} — failed</span>${attempt.error ? ` <span class="attempt-error">${esc(attempt.error)}</span>` : ''}</summary>
    ${renderTraceLink(attempt.trace, assetHrefs)}
    <ol class="steps">
${attempt.steps.map((s) => renderStep(s, assetHrefs, logLevelThreshold)).join('\n')}
    </ol>
  </details>`;
}

/** A Playwright trace archive (M3c, D12) — always an external file (`resolveReportAssets` never
 * inlines one), so this only renders anything when `assetHrefs` actually has it; a report built
 * directly from a `RunReport` with a `.trace` but no matching `assetHrefs` entry (e.g. a unit test
 * exercising `renderReportHtml` in isolation) degrades to no link rather than a broken `href`. */
function renderTraceLink(trace: { readonly base64: string } | undefined, assetHrefs: ReadonlyMap<string, string>): string {
  if (!trace) return '';
  const href = assetHrefs.get(assetHash(trace.base64));
  if (!href) return '';
  return `<p class="trace-link">🔍 <a href="${esc(href)}" download>trace.zip</a> — open with <code>npx playwright show-trace ${esc(href)}</code></p>`;
}

function renderScreenshot(shot: { readonly base64: string } | undefined, assetHrefs: ReadonlyMap<string, string>): string {
  if (!shot) return '';
  const href = assetHrefs.get(assetHash(shot.base64));
  const src = href ?? `data:image/png;base64,${shot.base64}`;
  return `<div class="screenshot"><img src="${esc(src)}" alt="screenshot" loading="lazy"></div>`;
}

/** Before/after/diff triptych (M4b, D15) for a `matches snapshot` step — `snapshotDiff` is only
 * ever set when there's something worth showing (a new/updated baseline, a mismatch, a platform
 * error), so this renders unconditionally once present; a clean pass never reaches here at all
 * (`SnapshotOutcome`'s own doc comment, `snapshot.ts`). Each of the up-to-three images resolves
 * independently through `assetHrefs` — they're deduped/inlined exactly like an ordinary screenshot,
 * `resolveReportAssets`'s `addSnapshotStep` reuses `addScreenshot` for all three. */
function renderSnapshotDiff(diff: StepResult['snapshotDiff'], assetHrefs: ReadonlyMap<string, string>): string {
  if (!diff) return '';
  const img = (label: string, base64: string): string => {
    const href = assetHrefs.get(assetHash(base64));
    const src = href ?? `data:image/png;base64,${base64}`;
    return `<figure><figcaption>${esc(label)}</figcaption><img src="${esc(src)}" alt="${esc(label)}" loading="lazy"></figure>`;
  };
  return `<div class="snapshot-diff">
    ${diff.baseline ? img('baseline', diff.baseline) : ''}
    ${img('actual', diff.actual)}
    ${diff.diff ? img('diff', diff.diff) : ''}
  </div>`;
}

function renderStep(step: StepResult, assetHrefs: ReadonlyMap<string, string>, logLevelThreshold: LogLevel): string {
  // A `log` step is filtered by *destination* (must include `html`) and *level* (must clear the
  // resolved threshold) rather than rendered like every other step (M27, PLAN_LOG.md decisions
  // 117/119/122) — never by `ok`/`--verbose`, since a log step has neither. A filtered-out step
  // renders as an empty string: still present in `report.tests[].steps` (decision 119's "always
  // recorded"), just not one of this page's `<li>`s.
  if (step.kind === 'log') return renderLogStep(step, logLevelThreshold);
  const panels = step.request ? renderTrace(step.request, step.response) : '';
  return `<li class="step ${step.ok ? 'ok' : 'fail'} kind-${step.kind}">
    <div class="line"><span class="mark">${step.ok ? '✓' : '✗'}</span><code>${esc(step.source)}</code><span class="sms">${step.durationMs} ms</span></div>
    ${step.detail ? `<div class="detail ${step.ok ? '' : 'baddetail'}">${esc(step.detail)}</div>` : ''}
    ${renderScreenshot(step.screenshot, assetHrefs)}
    ${renderSnapshotDiff(step.snapshotDiff, assetHrefs)}
    ${panels}
  </li>`;
}

function renderLogStep(step: StepResult, logLevelThreshold: LogLevel): string {
  const destination = step.destination ?? 'both';
  if (destination === 'console' || destination === 'none') return '';
  const level = step.level ?? 'info';
  if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[logLevelThreshold]) return '';
  return `<li class="step ok kind-log level-${level}">
    <div class="line"><span class="log-badge log-${level}">${level.toUpperCase()}</span><code>${esc(step.source)}</code><span class="sms">${step.durationMs} ms</span></div>
    ${step.detail ? `<div class="detail">${esc(step.detail)}</div>` : ''}
  </li>`;
}

function renderTrace(req: RequestTrace, res?: ResponseTrace): string {
  const reqBody = req.body ? `<pre class="body">${esc(pretty(req.body))}</pre>` : '';
  const resBlock = res
    ? `<div class="panel res">
        <div class="phead">← ${res.status} ${esc(res.statusText)} · ${res.durationMs} ms</div>
        ${renderHeaders(res.headers)}
        ${res.bodyText ? `<pre class="body">${esc(pretty(res.bodyText))}</pre>` : ''}
      </div>`
    : '';
  return `<div class="trace">
    <div class="panel req">
      <div class="phead">→ ${esc(req.method)} ${esc(req.url)}</div>
      ${renderHeaders(req.headers)}
      ${reqBody}
    </div>
    ${resBlock}
  </div>`;
}

function renderHeaders(headers: Record<string, string>): string {
  const rows = Object.entries(headers);
  if (rows.length === 0) return '';
  return `<table class="headers">${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
}

function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

const STYLE = `
:root{--bg:#0f1115;--card:#171a21;--fg:#e6e8ec;--mut:#9aa3b2;--ok:#3fb950;--fail:#f85149;--warn:#d29922;--info:#58a6ff;--line:#262b36;--code:#0b0d11}
@media (prefers-color-scheme: light){:root{--bg:#f6f7f9;--card:#fff;--fg:#1b1f27;--mut:#5b6472;--ok:#1a7f37;--fail:#cf222e;--warn:#9a6700;--info:#0969da;--line:#e5e8ec;--code:#f3f4f6}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
header.run{padding:20px 24px;border-bottom:1px solid var(--line)}h1{margin:0 0 8px;font-size:18px}
.meta{display:flex;gap:14px;flex-wrap:wrap;color:var(--mut);align-items:center}
.insecure-warning{margin-top:10px;padding:6px 10px;border-radius:6px;background:var(--warn);color:#1b1f27;font-weight:700}
.engine-badge{margin-top:8px;color:var(--mut);font-size:12px}
.badge{padding:2px 10px;border-radius:20px;font-weight:700;color:#fff}.badge.ok{background:var(--ok)}.badge.fail{background:var(--fail)}
code{background:var(--code);padding:1px 5px;border-radius:4px}
.layout{display:flex;align-items:flex-start}
.sidebar{flex:0 0 300px;width:300px;max-height:100vh;position:sticky;top:0;overflow-y:auto;border-right:1px solid var(--line);padding:12px}
.filterbar{position:sticky;top:0;background:var(--bg);padding-bottom:8px;margin-bottom:6px}
#tf-filter{width:100%;padding:6px 8px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--fg);font:inherit;margin-bottom:6px}
.statusfilter{display:flex;gap:4px}
.statusfilter button{flex:1;padding:4px 0;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--mut);font:inherit;cursor:pointer}
.statusfilter button.active{background:var(--fg);color:var(--bg);border-color:var(--fg)}
details.filegroup{margin:0 0 4px;border-radius:6px}
details.filegroup summary{cursor:pointer;list-style:none;display:flex;gap:6px;align-items:center;padding:5px 6px;border-radius:6px}
details.filegroup summary::-webkit-details-marker{display:none}
details.filegroup summary:hover{background:var(--card)}
.fgdot{width:8px;height:8px;border-radius:50%;flex:0 0 auto}.fgdot.ok{background:var(--ok)}.fgdot.fail{background:var(--fail)}
.fgname{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.fgcount{color:var(--mut);font-size:11px}
ul.testlist{list-style:none;margin:0;padding:2px 0 2px 18px}
.testlink{display:block;width:100%;text-align:left;padding:4px 6px;border:none;background:transparent;color:var(--mut);font:inherit;font-size:12px;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.testlink:hover{background:var(--card)}
.testlink.fail{color:var(--fail)}
.testlink.selected{background:var(--card);color:var(--fg);font-weight:700}
.testlink.hidden-by-filter,details.filegroup.hidden-by-filter{display:none}
main{flex:1;min-width:0;padding:16px 24px;max-width:1000px}
.test{display:none}
.test.active{display:block}
.test{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--line);border-radius:8px;margin:0 0 16px;padding:12px 16px}
.test.ok{border-left-color:var(--ok)}.test.fail{border-left-color:var(--fail)}
h2{font-size:15px;margin:0 0 8px;display:flex;align-items:center;gap:8px}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block}.dot.ok{background:var(--ok)}.dot.fail{background:var(--fail)}
.flaky{color:var(--warn);border:1px solid var(--warn);border-radius:10px;padding:0 8px;font-size:11px;font-weight:700;text-transform:uppercase}
.parallel{color:var(--info);border:1px solid var(--info);border-radius:10px;padding:0 8px;font-size:11px;font-weight:700;text-transform:uppercase}
.generator-line{margin:0 0 8px;color:var(--mut);font-size:12px}
.generator-line.saturated{color:var(--warn);font-weight:700}
.metrics-block .workload{color:var(--mut);margin:0 0 8px}
.metrics-block table.stats{border-collapse:collapse;width:100%;margin-bottom:8px}
.metrics-block table.stats th{text-align:left;color:var(--mut);font-weight:400;padding:3px 8px 3px 0}
.metrics-block table.stats td{padding:3px 16px 3px 0}
.metrics-block table.thresholds{border-collapse:collapse;width:100%;margin-bottom:8px}
.metrics-block table.thresholds td{padding:3px 10px 3px 0}
.metrics-block table.thresholds tr.ok td:first-child{color:var(--ok)}
.metrics-block table.thresholds tr.fail td:first-child{color:var(--fail)}
.metrics-block .backoff-warning{margin:0 0 8px;padding:6px 10px;border-radius:6px;background:var(--warn);color:#1b1f27;font-weight:700}
.metrics-block .charts{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media (max-width:700px){.metrics-block .charts{grid-template-columns:1fr}}
.endpoints{margin:8px 0 0;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg)}
.endpoints h3{font-size:13px;color:var(--mut);margin:0 0 6px;text-transform:uppercase;letter-spacing:.04em}
.endpoint{margin-bottom:6px}
.endpoint summary{cursor:pointer;padding:4px 0;color:var(--fg)}
.endpoint summary:hover{color:var(--info)}
.endpoint .metrics-block{margin:8px 0 0}
details.attempt{margin:6px 0;border:1px solid var(--line);border-left:3px solid var(--fail);border-radius:6px;background:var(--card)}
details.attempt summary{cursor:pointer;padding:6px 10px;list-style:none;display:flex;gap:8px;align-items:center}
details.attempt summary::-webkit-details-marker{display:none}
details.attempt[open] summary{border-bottom:1px solid var(--line)}
.attempt-badge{padding:1px 8px;border-radius:10px;font-size:11px;font-weight:700;text-transform:uppercase}
.attempt-badge.fail{background:var(--fail);color:#fff}
.attempt-badge.ok{background:var(--ok);color:#fff}
.attempt-error{color:var(--mut);font-size:12px}
.attempt-final-label{margin:6px 0 4px}
details.attempt ol.steps{padding:4px 12px 4px 12px}
.tms,.sms{color:var(--mut);font-weight:400;font-size:12px;margin-left:auto}
.error{color:var(--fail);margin:4px 0 10px;white-space:pre-wrap;overflow-wrap:anywhere}
ol.steps{list-style:none;margin:0;padding:0}
.step{padding:6px 0;border-top:1px solid var(--line)}
.line{display:flex;align-items:center;gap:8px}.line code{background:transparent;padding:0}
.mark{width:14px;text-align:center;font-weight:700}.step.ok .mark{color:var(--ok)}.step.fail .mark{color:var(--fail)}
.detail{color:var(--mut);margin:2px 0 2px 22px;white-space:pre-wrap;overflow-wrap:anywhere}
.detail.baddetail{color:var(--fail)}
.log-badge{display:inline-block;width:40px;flex:0 0 auto;padding:0 4px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:.03em;text-align:center;color:#fff}
.log-badge.log-debug{background:var(--mut)}
.log-badge.log-info{background:var(--info)}
.log-badge.log-warn{background:var(--warn);color:#1b1f27}
.log-badge.log-error{background:var(--fail)}
.step.kind-log .detail{color:var(--fg)}
.trace{margin:6px 0 4px 22px;display:grid;gap:8px}
.screenshot{margin:6px 0 4px 22px}
.screenshot img{max-width:min(640px,100%);border:1px solid var(--line);border-radius:6px;display:block}
.snapshot-diff{margin:6px 0 4px 22px;display:flex;flex-wrap:wrap;gap:10px}
.snapshot-diff figure{margin:0}
.snapshot-diff figcaption{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px}
.snapshot-diff img{max-width:min(320px,100%);border:1px solid var(--line);border-radius:6px;display:block}
.trace-link{margin:4px 0 4px 22px;color:var(--mut);font-size:12px}
.trace-link code{font-size:11px}
.panel{background:var(--code);border:1px solid var(--line);border-radius:6px;overflow:hidden}
.phead{padding:6px 10px;border-bottom:1px solid var(--line);color:var(--mut);overflow-wrap:anywhere}
table.headers{width:100%;border-collapse:collapse;font-size:12px}
table.headers td{padding:3px 10px;border-bottom:1px solid var(--line);vertical-align:top;color:var(--mut);overflow-wrap:anywhere}
table.headers td:first-child{width:180px;color:var(--fg)}
pre.body{margin:0;padding:8px 10px;overflow-x:auto;white-space:pre;font-size:12px}
footer{padding:16px 24px;color:var(--mut);border-top:1px solid var(--line)}
@media print{.sidebar{display:none}.test{display:block!important}main{max-width:none}}
`;

/** Tab-switching, filtering, and default-selection — the report's one bit of interactivity. Still
 * fully self-contained (no external requests, opens via file:// the same as before), just no
 * longer JS-free (decision 92: gap-#3/#8's "reuse existing mechanism" pattern doesn't apply here,
 * since there's no existing mechanism for a tab UI — a pure-CSS `:checked` hack couldn't do
 * default-select-first-failure or the filter box). `__DEFAULT_ID__` is substituted with the id of
 * the section that should be active on load (the first failing test, or the first test if the run
 * is all green) before this string is embedded — done as a literal substitution rather than
 * templating the whole script, so the script body itself stays a plain, readable constant. */
const SCRIPT = `
(function(){
  var sidebar = document.querySelector('.sidebar');
  var main = document.querySelector('main');
  if (!sidebar || !main) return;

  function activate(id){
    main.querySelectorAll('.test.active').forEach(function(el){ el.classList.remove('active'); });
    var panel = id && document.getElementById(id);
    if (panel) panel.classList.add('active');
    sidebar.querySelectorAll('.testlink.selected').forEach(function(el){ el.classList.remove('selected'); });
    var link = id && sidebar.querySelector('.testlink[data-target="' + id + '"]');
    if (link) link.classList.add('selected');
  }

  sidebar.querySelectorAll('.testlink').forEach(function(link){
    link.addEventListener('click', function(){ activate(link.getAttribute('data-target')); });
  });

  var statusFilter = 'all';
  function applyFilter(){
    var q = (document.getElementById('tf-filter').value || '').toLowerCase();
    sidebar.querySelectorAll('details.filegroup').forEach(function(group){
      var links = group.querySelectorAll('.testlink');
      var visibleCount = 0;
      links.forEach(function(link){
        var matchesText = link.textContent.toLowerCase().indexOf(q) !== -1;
        var matchesStatus = statusFilter === 'all' || link.classList.contains(statusFilter);
        var show = matchesText && matchesStatus;
        link.parentElement.classList.toggle('hidden-by-filter', !show);
        if (show) visibleCount++;
      });
      group.classList.toggle('hidden-by-filter', visibleCount === 0);
    });
  }
  document.getElementById('tf-filter').addEventListener('input', applyFilter);
  document.querySelectorAll('#tf-statusfilter button').forEach(function(btn){
    btn.addEventListener('click', function(){
      statusFilter = btn.getAttribute('data-status');
      document.querySelectorAll('#tf-statusfilter button').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      applyFilter();
    });
  });

  activate('__DEFAULT_ID__');
})();
`;
